// =====================================================================
// EMBEDDINGS FALSOS PARA LOS TESTS (no es un test)
// ---------------------------------------------------------------------
// Los tests nunca llaman a Gemini: usan generadores deterministas con la misma forma que
// generarEmbeddings(textos) -> {vectores, modelo}.
//   - generadorDeHash: cada palabra suma 1 en una posición fija del vector. Textos con palabras
//     en común quedan cerca; sirve de valor por defecto para cualquier test de la app.
//   - generadorPorTabla: vectores elegidos a mano con vectorConAngulo, para controlar la similitud.
//   - generadorQueFalla: simula el servicio caído.
// =====================================================================

import { IANoDisponibleError } from '../src/ai/cliente.js';

export const DIMENSIONES = 768;
export const MODELO_FALSO = 'embedding-falso';

/**
 * Vector de 768 dimensiones con solo dos componentes: [cos, sen, 0, ...].
 * La similitud coseno entre dos de estos vectores es cos(diferencia de ángulos):
 * 0° de diferencia = 1.0, 10° = 0.985, 20° = 0.940, 30° = 0.866, 90° = 0.
 */
export function vectorConAngulo(grados) {
  const radianes = (grados * Math.PI) / 180;
  const vector = new Array(DIMENSIONES).fill(0);
  vector[0] = Math.cos(radianes);
  vector[1] = Math.sin(radianes);
  return vector;
}

// Hash FNV-1a: un número estable por palabra.
function hash(palabra) {
  let h = 2166136261;
  for (const c of palabra) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export async function generadorDeHash(textos) {
  const vectores = textos.map((texto) => {
    const vector = new Array(DIMENSIONES).fill(0);
    for (const palabra of texto.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)) {
      vector[hash(palabra) % DIMENSIONES] += 1;
    }
    return vector;
  });
  return { vectores, modelo: MODELO_FALSO };
}

/** Generador con vectores elegidos a mano: tabla = {texto: vector}. Cuenta las llamadas en .llamadas. */
export function generadorPorTabla(tabla, modelo = MODELO_FALSO) {
  const generador = async (textos) => {
    generador.llamadas += 1;
    return {
      vectores: textos.map((t) => {
        if (!(t in tabla)) throw new Error(`el test no definió el vector de "${t}"`);
        return tabla[t];
      }),
      modelo,
    };
  };
  generador.llamadas = 0;
  return generador;
}

export function generadorQueFalla(mensaje = 'El servicio de embeddings no respondió correctamente.') {
  const generador = async () => {
    generador.llamadas += 1;
    throw new IANoDisponibleError(mensaje);
  };
  generador.llamadas = 0;
  return generador;
}
