// =====================================================================
// INTENCIÓN DEL MENSAJE (Ctrl+K)
// ---------------------------------------------------------------------
// La barra Ctrl+K atiende dos cosas: pedir una sala (flujo de asistente.js) y hacer una pregunta
// (RAG en pulse-ai). Un clasificador decide cuál. Si la respuesta de la IA no es una de las dos
// intenciones válidas, se usa "preguntar": es la opción inofensiva (solo muestra texto; nunca reserva).
//
// Primero decide un conjunto de REGLAS (intencionPorReglas): cuando el mensaje trae señales claras no se gasta una
// llamada a Gemini (ahorra ~1 s y 1 de las 15 llamadas por minuto de la capa gratis). Solo si el mensaje es ambiguo
// se le pregunta a la IA (clasificarIntencion). Las reglas son conservadoras: ante la duda devuelven null.
// =====================================================================

import { generarJSON } from './cliente.js';
import { INTENCIONES, promptIntencion } from './prompts/intencion.js';

const SCHEMA_INTENCION = {
  type: 'OBJECT',
  properties: { intencion: { type: 'STRING', format: 'enum', enum: INTENCIONES } },
  required: ['intencion'],
};

/** 'reservar' o 'preguntar' según la IA (para los mensajes que las reglas no deciden). Si falla lanza IANoDisponibleError (503). */
export async function clasificarIntencion(texto, historial = []) {
  const { datos } = await generarJSON(promptIntencion(texto, historial), SCHEMA_INTENCION);
  return INTENCIONES.includes(datos?.intencion) ? datos.intencion : 'preguntar';
}

// ---------- reglas: sin IA ----------

// Minúsculas y sin tildes, para que "mañana" y "manana" sean lo mismo.
const normalizar = (texto) => texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

const PERSONAS = /\b\d{1,3}\s*(personas?|asistentes?|estudiantes?|alumnos?|campers?|participantes?|puestos?)\b|\bpara\s+\d{1,3}\b/;
const HORA = /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])|\bde\s+\d{1,2}(:\d{2})?\s*(a|hasta)\s+\d{1,2}|\ba\s+las\s+\d{1,2}/;
const DIA = /\b(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|proximo|proxima|esta semana)\b|\b\d{1,2}\/\d{1,2}\b/;
const LUGAR = /\b(sala|salas|salon|salones|aula|aulas|espacio|espacios|auditorio|reservar|agendar)\b/;
const PIDE = /\b(necesito|quiero|busco|requiero|reservame|reservame|agendame|me sirve)\b/;
const FORMA_DE_PREGUNTA = /^[¿]|\?\s*$|^(que|cual|cuales|cuanto|cuantos|cuanta|cuantas|como|quien|quienes|donde|cuando|por que|puedo|se puede|hay|existe|tiene|tienen|es|son|y|entonces|ademas|explicame|dime)\b/;

/**
 * Decide la intención sin IA cuando el mensaje es claro: 'reservar', 'preguntar' o null (ambiguo: que decida la IA).
 *   reservar  : pide un espacio con cuántas personas y cuándo ("30 personas el martes de 2 a 4"), aunque sea en forma de pregunta.
 *   preguntar : tiene forma de pregunta ("¿cuántas horas...?", "y los domingos") y NO pide un espacio con fecha u hora.
 * Una pregunta con sala y fecha u hora ("¿hay salas libres mañana?") es ambigua a propósito: va a la IA.
 */
export function intencionPorReglas(texto) {
  const t = normalizar(String(texto ?? ''));
  if (!t) return null;
  const personas = PERSONAS.test(t);
  const hora = HORA.test(t);
  const dia = DIA.test(t);
  const lugar = LUGAR.test(t);

  if ((personas && (hora || dia || lugar)) || (lugar && hora && dia) || (lugar && PIDE.test(t) && (hora || dia))) return 'reservar';
  if (FORMA_DE_PREGUNTA.test(t) && !(lugar && (hora || dia))) return 'preguntar';
  return null;
}
