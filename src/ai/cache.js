// =====================================================================
// CACHÉ DE RESPUESTAS DE LA IA
// ---------------------------------------------------------------------
// Si llega el mismo texto otra vez, se devuelve la respuesta guardada y
// no se gasta la cuota gratis de Gemini. Dura CACHE_IA_MINUTOS.
// - La clave es el texto sin diferencias de mayúsculas ni espacios.
// - Solo se guardan respuestas buenas: los errores de la IA no se cachean.
// - En memoria, con tope de entradas para no crecer sin límite.
// =====================================================================

import { REGLAS } from '../config/reglas.js';

const DURACION_MS = REGLAS.CACHE_IA_MINUTOS * 60_000;
const MAX_ENTRADAS = 200;

// clave -> { valor, vence }
const guardadas = new Map();

const claveDe = (texto) => texto.trim().toLowerCase().replace(/\s+/g, ' ');

/** Respuesta guardada para ese texto, o undefined si no hay o ya venció. */
export function leerCache(texto, ahora = Date.now()) {
  const clave = claveDe(texto);
  const entrada = guardadas.get(clave);
  if (!entrada) return undefined;
  if (entrada.vence <= ahora) {
    guardadas.delete(clave);
    return undefined;
  }
  return entrada.valor;
}

/** Guarda la respuesta de ese texto. Si se llena, descarta la entrada más antigua. */
export function guardarCache(texto, valor, ahora = Date.now()) {
  const clave = claveDe(texto);
  guardadas.delete(clave); // así la entrada renovada queda como la más reciente
  if (guardadas.size >= MAX_ENTRADAS) guardadas.delete(guardadas.keys().next().value);
  guardadas.set(clave, { valor, vence: ahora + DURACION_MS });
}

/** Vacía la caché (para los tests). */
export function vaciarCache() {
  guardadas.clear();
}
