// =====================================================================
// INCIDENCIAS PARECIDAS CON EMBEDDINGS
// ---------------------------------------------------------------------
// Flujo de POST /api/ia/similares:
//   1. La IA convierte el texto en un vector (embedding). Es lo único que hace la IA.
//   2. PostgreSQL (pgvector) busca las incidencias abiertas con el vector más cercano.
//   3. Las REGLAS (src/domain/similares.js) deciden cuáles se sugieren: filtro de lugar y umbral.
// La IA sugiere, las reglas deciden, y la persona confirma si es "la misma".
//
// Resiliencia: si el servicio de embeddings falla, buscarSimilares lanza IANoDisponibleError (503) y la
// interfaz sigue creando la incidencia sin la sugerencia. La llamada a Gemini NUNCA va dentro de una
// transacción: retendría el bloqueo de escritura de la base y frenaría a todos los demás.
// =====================================================================

import { REGLAS } from '../config/reglas.js';
import { buscarCandidatas, guardarEmbedding, incidenciasSinEmbedding } from '../data/similares.js';
import { incidenciasParecidas } from '../domain/similares.js';
import { guardarCache, leerCache } from './cache.js';
import { generarEmbeddings } from './cliente.js';

const ESPACIO_CACHE = 'embedding'; // aparte del triaje: el mismo texto tiene un triaje y un embedding

// Quién genera los vectores. Los tests ponen uno falso para no llamar a Gemini.
let generador = generarEmbeddings;

/** Solo para tests: reemplaza el generador de embeddings. Devuelve una función que lo restaura. */
export function usarGeneradorDeEmbeddings(nuevo) {
  const anterior = generador;
  generador = nuevo ?? generarEmbeddings;
  return () => { generador = anterior; };
}

// Peticiones de embedding en curso, por texto. Si llegan varias iguales a la vez (un doble clic, por
// ejemplo), todas esperan la misma llamada a Gemini en vez de hacer una cada una: la caché sola no
// alcanza porque todavía no tiene la respuesta.
const enVuelo = new Map();
const claveDe = (texto) => texto.trim().toLowerCase().replace(/\s+/g, ' ');

/** ¿Ya hay un embedding de este texto en la caché o en camino? (si es así, pedirlo no gasta cuota de Gemini). */
export const embeddingEnCache = (texto) => leerCache(texto, Date.now(), ESPACIO_CACHE) !== undefined || enVuelo.has(claveDe(texto));

/** Embedding de un texto, de la caché si ya se pidió hace poco. Devuelve {vector, modelo}. */
export async function embeddingDe(texto) {
  const guardado = leerCache(texto, Date.now(), ESPACIO_CACHE);
  if (guardado) return guardado;
  const clave = claveDe(texto);
  if (enVuelo.has(clave)) return enVuelo.get(clave);

  const promesa = (async () => {
    const { vectores, modelo } = await generador([texto]);
    const resultado = { vector: vectores[0], modelo };
    guardarCache(texto, resultado, Date.now(), ESPACIO_CACHE);
    return resultado;
  })();
  enVuelo.set(clave, promesa);
  // Con éxito o con error, deja de estar "en vuelo": un fallo no se queda pegado, el siguiente intento vuelve a pedir.
  promesa.then(() => enVuelo.delete(clave), () => enVuelo.delete(clave));
  return promesa;
}

/**
 * Incidencias abiertas parecidas a una descripción.
 * Devuelve {candidatas: [{id, descripcion, ..., similitud, reportesAdicionales}], umbral, modelo}.
 */
export async function buscarSimilares({ descripcion, espacioId = null, recursoId = null }) {
  const { vector, modelo } = await embeddingDe(descripcion);
  const candidatas = await buscarCandidatas(vector, modelo, { espacioId, recursoId });
  return { candidatas: incidenciasParecidas(candidatas), umbral: REGLAS.UMBRAL_SIMILITUD_INCIDENCIA, modelo };
}

// ---------- guardar el embedding de una incidencia nueva ----------

const pendientes = new Set();

/**
 * Calcula y guarda el embedding de una incidencia recién creada, SIN hacer esperar la respuesta.
 * Si falla, la incidencia queda sin embedding (no se sugerirá como parecida) y se puede rellenar
 * después con `npm run embeddings`.
 */
export function guardarEmbeddingEnSegundoPlano(incidencia) {
  const tarea = (async () => {
    try {
      const { vector, modelo } = await embeddingDe(incidencia.descripcion);
      await guardarEmbedding(incidencia.id, vector, modelo);
    } catch (error) {
      console.warn(`[ia] La incidencia ${incidencia.id} quedó sin embedding (${error.message}). Se rellena con: npm run embeddings`);
    }
  })();
  pendientes.add(tarea);
  tarea.finally(() => pendientes.delete(tarea));
}

/** Espera a que terminen los embeddings que se están guardando (para los tests y para apagar el servidor). */
export async function esperarEmbeddingsPendientes() {
  await Promise.all([...pendientes]);
}

// ---------- relleno ----------

/**
 * Genera el embedding de las incidencias que no lo tienen, en lotes. Se detiene en el primer fallo del
 * servicio (si está caído, insistir no sirve). Devuelve {pendientes, rellenadas, error}.
 */
export async function rellenarEmbeddings({ generar = generarEmbeddings, tamanoLote = 20, pausaMs = 0 } = {}) {
  const faltantes = await incidenciasSinEmbedding();
  let rellenadas = 0;
  for (let i = 0; i < faltantes.length; i += tamanoLote) {
    const lote = faltantes.slice(i, i + tamanoLote);
    try {
      const { vectores, modelo } = await generar(lote.map((f) => f.descripcion));
      for (const [j, fila] of lote.entries()) await guardarEmbedding(fila.id, vectores[j], modelo);
      rellenadas += lote.length;
    } catch (error) {
      return { pendientes: faltantes.length, rellenadas, error: error.message };
    }
    if (pausaMs && i + tamanoLote < faltantes.length) await new Promise((r) => setTimeout(r, pausaMs));
  }
  return { pendientes: faltantes.length, rellenadas, error: null };
}
