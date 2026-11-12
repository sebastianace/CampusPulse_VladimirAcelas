// =====================================================================
// DOMINIO: INCIDENCIAS PARECIDAS
// ---------------------------------------------------------------------
// La IA solo convierte el texto en un vector; quien decide si una incidencia es "parecida" son estas
// reglas, con valores de src/config/reglas.js:
//   1. Filtro de lugar (híbrido): si el triaje identificó un equipo, solo se comparan incidencias de ese
//      equipo; si no, y identificó un espacio, solo las de ese espacio; si no identificó nada, se
//      compara con todas las abiertas. Los embeddings capturan el tema, no el lugar: "el video beam
//      de Cosmos no prende" saca 0.95 de similitud con el de Apolo y no es la misma incidencia.
//   2. Umbral: solo cuentan las que llegan a UMBRAL_SIMILITUD_INCIDENCIA.
//   3. Se muestran como máximo MAX_INCIDENCIAS_PARECIDAS, de la más parecida a la menos.
// Solo se comparan incidencias abiertas: una resuelta ya no admite más reportes.
// =====================================================================

import { REGLAS } from '../config/reglas.js';

/**
 * Regla 1: por qué columna se filtra el lugar. Devuelve {columna, valor} o null (sin filtro).
 * El equipo manda sobre el espacio: es más específico.
 */
export function filtroDeLugar({ espacioId, recursoId } = {}) {
  if (recursoId) return { columna: 'recurso_id', valor: recursoId };
  if (espacioId) return { columna: 'espacio_id', valor: espacioId };
  return null;
}

/**
 * Reglas 2 y 3: de las candidatas [{similitud, ...}] deja las que pasan el umbral, ordenadas de mayor
 * a menor similitud y recortadas al máximo.
 */
export function incidenciasParecidas(candidatas, { umbral = REGLAS.UMBRAL_SIMILITUD_INCIDENCIA, max = REGLAS.MAX_INCIDENCIAS_PARECIDAS } = {}) {
  return candidatas
    .filter((c) => c.similitud >= umbral)
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, max);
}
