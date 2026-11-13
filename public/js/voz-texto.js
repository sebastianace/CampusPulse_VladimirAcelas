// Lógica pura de la voz (sin DOM ni APIs del navegador): se puede probar en Node (tests/voz-texto.test.js).

export const IDIOMA_VOZ = 'es-CO';

/**
 * Une lo que ya estaba escrito en el campo con lo dictado. Agrega un espacio entre los dos, quita
 * espacios sobrantes y, si el campo estaba vacío, empieza el dictado con mayúscula.
 */
export function unirDictado(actual, dictado) {
  const base = String(actual ?? '').trim();
  const nuevo = String(dictado ?? '').replace(/\s+/g, ' ').trim();
  if (!nuevo) return base;
  if (!base) return nuevo.charAt(0).toUpperCase() + nuevo.slice(1);
  return `${base} ${nuevo}`;
}

/**
 * Elige la mejor voz en español de la lista del navegador: primero el idioma exacto (es-CO), luego
 * cualquier "es" (es-MX, es-ES...) y si no hay ninguna devuelve null (se usa solo `lang`).
 */
export function elegirVoz(voces, idioma = IDIOMA_VOZ) {
  const lista = Array.from(voces ?? []);
  const comparar = (v) => String(v.lang ?? '').replace('_', '-').toLowerCase();
  return lista.find((v) => comparar(v) === idioma.toLowerCase())
    ?? lista.find((v) => comparar(v).startsWith(idioma.slice(0, 2).toLowerCase()))
    ?? null;
}

const ERRORES_DE_VOZ = {
  'not-allowed': 'No diste permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.',
  'service-not-allowed': 'Este navegador no permite el dictado por voz en esta página.',
  'no-speech': 'No escuché nada. Acércate al micrófono e inténtalo de nuevo.',
  'audio-capture': 'No encontré un micrófono. Conéctalo e inténtalo de nuevo.',
  network: 'El dictado necesita internet y no hay conexión con el servicio de voz del navegador.',
  'language-not-supported': 'Tu navegador no reconoce el español para el dictado.',
};

/** Mensaje en español para un código de error de SpeechRecognition; null si no vale la pena avisar (cancelación). */
export function mensajeDeErrorDeVoz(codigo) {
  if (codigo === 'aborted') return null; // la persona lo detuvo: no es un error
  return ERRORES_DE_VOZ[codigo] ?? 'El dictado por voz falló. Escribe el texto a mano.';
}

/**
 * Texto que Pulse lee en voz alta para una recomendación de salas: la explicación y las salas, sin símbolos.
 * `nombreDe(espacioId)` devuelve el nombre legible de una sala.
 */
export function textoDeRecomendacion({ explicacion, opciones = [] }, nombreDe = (id) => id) {
  const salas = opciones.map((o) => nombreDe(o.espacioId));
  const lista = salas.length ? `Salas disponibles: ${salas.join(', ')}.` : '';
  return [explicacion, lista].filter(Boolean).join(' ');
}
