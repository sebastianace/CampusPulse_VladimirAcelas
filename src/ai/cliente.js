// =====================================================================
// CLIENTE DE IA (Gemini vía @google/genai)
// ---------------------------------------------------------------------
// Único archivo que habla con el proveedor de IA. Si el mentor pide
// otro proveedor, solo se cambia este archivo.
// - Salida JSON forzada con un schema (responseSchema).
// - Temperatura baja para respuestas estables.
// - Timeout de 15 s con AbortController y un reintento.
// - Si falla, lanza IANoDisponibleError -> la ruta responde 503.
// - También genera embeddings (generarEmbeddings) para buscar incidencias parecidas.
// NUNCA se devuelve una respuesta simulada o de respaldo.
// =====================================================================

import { GoogleGenAI } from '@google/genai';

const TEMPERATURA = 0.2;
const TIMEOUT_MS = 15_000;
const INTENTOS = 2; // el primero + un reintento

// Embeddings. gemini-embedding-001 devuelve 3072 dimensiones por defecto, pero un índice HNSW de
// pgvector no admite más de 2000: se piden 768 (db/migrations/004_embeddings.sql).
export const MODELO_EMBEDDINGS = 'gemini-embedding-001';
export const DIMENSIONES_EMBEDDING = 768;
const TIMEOUT_EMBEDDINGS_MS = 8_000; // un solo intento: la sugerencia de parecidas es opcional

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

// Los embeddings solo necesitan la key (no el modelo de texto).
function obtenerClienteDeEmbeddings() {
  if (!process.env.GEMINI_API_KEY) {
    throw new IANoDisponibleError('La IA no está configurada (falta GEMINI_API_KEY). Se omite la búsqueda de incidencias parecidas.');
  }
  cliente ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return cliente;
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

/**
 * Convierte textos en vectores (embeddings) para comparar su significado.
 * Devuelve { vectores: number[][], modelo } con un vector de DIMENSIONES_EMBEDDING por texto, en el
 * mismo orden. Un solo intento y TIMEOUT_EMBEDDINGS_MS de espera; si falla, lanza IANoDisponibleError.
 */
export async function generarEmbeddings(textos) {
  const ai = obtenerClienteDeEmbeddings();
  let temporizador;
  try {
    const respuesta = await Promise.race([
      ai.models.embedContent({
        model: MODELO_EMBEDDINGS,
        contents: textos,
        config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: DIMENSIONES_EMBEDDING },
      }),
      new Promise((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(Object.assign(new Error('tiempo agotado'), { name: 'AbortError' })), TIMEOUT_EMBEDDINGS_MS);
      }),
    ]);
    const vectores = (respuesta.embeddings ?? []).map((e) => e.values);
    const validos = vectores.length === textos.length
      && vectores.every((v) => Array.isArray(v) && v.length === DIMENSIONES_EMBEDDING && v.every(Number.isFinite));
    if (!validos) throw new Error('la respuesta no trae los vectores esperados');
    return { vectores, modelo: MODELO_EMBEDDINGS };
  } catch (error) {
    console.warn(`[ia] Embeddings fallaron: ${error.message}`);
    const motivo = error.name === 'AbortError' ? `no respondió en ${TIMEOUT_EMBEDDINGS_MS / 1000} segundos` : 'no respondió correctamente';
    throw new IANoDisponibleError(`El servicio de embeddings ${motivo}.`);
  } finally {
    clearTimeout(temporizador);
  }
}
