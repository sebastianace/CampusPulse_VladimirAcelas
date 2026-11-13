// =====================================================================
// CLIENTE DEL SERVICIO pulse-ai (RAG)
// ---------------------------------------------------------------------
// Express no hace RAG: se lo pide por HTTP a pulse-ai (Python + LangChain), que busca en pgvector y le
// pide a Gemini una respuesta con citas. Aquí solo se llama con timeout y se traducen los fallos:
//   - pulse-ai caído, lento o sin Gemini -> IANoDisponibleError (503) y el resto de la app sigue igual.
//   - token incorrecto -> 503 con un mensaje que dice qué revisar.
// =====================================================================

import { REGLAS } from '../config/reglas.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { IANoDisponibleError } from './cliente.js';

const urlBase = () => (process.env.PULSE_AI_URL || 'http://localhost:8000').replace(/\/$/, '');

const MENSAJE_CAIDO = 'El asistente de conocimiento no está disponible en este momento. Intenta más tarde.';

/** Hace POST a pulse-ai y devuelve el JSON, o lanza el error que corresponda a Express. */
async function llamar(ruta, cuerpo) {
  const cabeceras = { 'content-type': 'application/json' };
  if (process.env.PULSE_AI_TOKEN) cabeceras['x-pulse-token'] = process.env.PULSE_AI_TOKEN;

  let respuesta;
  try {
    respuesta = await fetch(`${urlBase()}${ruta}`, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo ?? {}),
      signal: AbortSignal.timeout(REGLAS.TIMEOUT_CONOCIMIENTO_SEGUNDOS * 1000),
    });
  } catch (error) {
    console.warn(`[conocimiento] pulse-ai no respondió (${error.name}: ${error.cause?.code ?? error.message})`);
    throw new IANoDisponibleError(MENSAJE_CAIDO);
  }

  const datos = await respuesta.json().catch(() => null);
  if (respuesta.ok) return datos;

  const mensaje = datos?.error?.mensaje;
  if (respuesta.status === 422) throw new DatosInvalidosError(mensaje ?? 'La pregunta no tiene el formato esperado');
  if (respuesta.status === 401) {
    console.warn('[conocimiento] pulse-ai rechazó el token: revisa que PULSE_AI_TOKEN sea igual en los dos servicios');
    throw new IANoDisponibleError('El asistente de conocimiento no está bien configurado.');
  }
  throw new IANoDisponibleError(mensaje ?? MENSAJE_CAIDO);
}

/**
 * Pregunta al conocimiento del campus.
 * historial: [{rol: 'usuario'|'pulse', texto}] (los últimos mensajes, para preguntas de seguimiento).
 * Devuelve {respondido, respuesta, areaSugerida, fragmentos: [{documento, seccion, texto, similitud, puntaje, usado}], consulta, reranking, modelo}.
 */
export async function preguntarAlConocimiento({ pregunta, historial = [] }) {
  const datos = await llamar('/preguntar', { pregunta, historial });
  if (typeof datos?.respondido !== 'boolean' || typeof datos?.respuesta !== 'string' || !Array.isArray(datos?.fragmentos)) {
    throw new IANoDisponibleError('El asistente de conocimiento respondió algo inesperado.');
  }
  return datos;
}

/** Pide a pulse-ai que vuelva a cargar knowledge/ en la base vectorial. Devuelve {documentos, fragmentos, retirados}. */
export async function ingestarConocimiento() {
  return llamar('/ingestar');
}
