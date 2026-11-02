// =====================================================================
// CLIENTE DE IA (Gemini vía @google/genai)
// ---------------------------------------------------------------------
// Único archivo que habla con el proveedor de IA. Si el mentor pide
// otro proveedor, solo se cambia este archivo.
// - Salida JSON forzada con un schema (responseSchema).
// - Temperatura baja para respuestas estables.
// - Timeout de 15 s con AbortController y un reintento.
// - Si falla, lanza IANoDisponibleError -> la ruta responde 503.
// NUNCA se devuelve una respuesta simulada o de respaldo.
// =====================================================================

import { GoogleGenAI } from '@google/genai';

const TEMPERATURA = 0.2;
const TIMEOUT_MS = 15_000;
const INTENTOS = 2; // el primero + un reintento

// 503: la IA no respondió o respondió algo inutilizable.
// Lleva status y codigo para que el manejador global de server.js lo traduzca.
export class IANoDisponibleError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'IANoDisponibleError';
    this.status = 503;
    this.codigo = 'IA_NO_DISPONIBLE';
  }
}

// Se crea al primer uso para leer el .env vigente y poder fallar con un mensaje claro.
let cliente = null;

function obtenerCliente() {
  const { GEMINI_API_KEY, GEMINI_MODEL } = process.env;
  if (!GEMINI_API_KEY || !GEMINI_MODEL) {
    throw new IANoDisponibleError('La IA no está configurada (falta GEMINI_API_KEY o GEMINI_MODEL). Usa el formulario manual.');
  }
  cliente ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return { ai: cliente, modelo: GEMINI_MODEL };
}

// Un intento: llama a Gemini y corta la espera a los TIMEOUT_MS.
async function intentar(ai, modelo, prompt, schema) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const respuesta = await ai.models.generateContent({
      model: modelo,
      contents: prompt,
      config: {
        temperature: TEMPERATURA,
        responseMimeType: 'application/json',
        responseSchema: schema,
        abortSignal: control.signal,
      },
    });
    return JSON.parse(respuesta.text);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Pide a la IA un objeto JSON que cumpla "schema".
 * Devuelve { datos, modelo }. Si tras el reintento sigue fallando,
 * lanza IANoDisponibleError con un mensaje en español.
 */
export async function generarJSON(prompt, schema) {
  const { ai, modelo } = obtenerCliente();
  let ultimoError;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const datos = await intentar(ai, modelo, prompt, schema);
      return { datos, modelo };
    } catch (error) {
      ultimoError = error;
      console.warn(`[ia] Intento ${intento} de ${INTENTOS} falló: ${error.message}`);
    }
  }
  const motivo = ultimoError?.name === 'AbortError'
    ? `no respondió en ${TIMEOUT_MS / 1000} segundos`
    : 'no respondió correctamente';
  throw new IANoDisponibleError(`La IA ${motivo}. Intenta de nuevo o usa el formulario manual.`);
}
