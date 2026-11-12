// =====================================================================
// VALIDACIÓN DE LAS RESPUESTAS DE LA IA
// ---------------------------------------------------------------------
// La IA sugiere, las reglas deciden. Todo lo que devuelve la IA se
// compara contra los valores cerrados de src/config/reglas.js y contra
// los IDs reales del catálogo (la base de datos).
// - Un valor fuera de la lista o un ID que no existe se convierte en
//   null: la UI le pide a la persona elegirlo a mano.
// - Nunca se inventa ni se "adivina" un valor de reemplazo.
// =====================================================================

import { AREAS, CATEGORIAS, PRIORIDADES } from '../config/reglas.js';

// Formato de fecha del contrato: YYYY-MM-DDTHH:mm (hora de Bogotá, sin zona).
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// ---------- utilidades ----------

/** Devuelve el valor si está en la lista permitida; si no, null. */
export function valorPermitido(valor, permitidos) {
  return permitidos.includes(valor) ? valor : null;
}

/** Devuelve el ID si existe en la lista de objetos {id}; si no, null. */
export function idDelCatalogo(id, elementos) {
  return elementos.some((e) => e.id === id) ? id : null;
}

/** Texto limpio o cadena vacía si la IA no mandó texto. */
function textoLimpio(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// ---------- triaje de incidencias ----------

/**
 * Valida la sugerencia de triaje contra los enums y el catálogo real.
 * catalogo = { espacios: [{id}], recursos: [{id}] }
 * Devuelve {categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon}.
 */
export function validarTriaje(datos, catalogo) {
  return {
    categoria: valorPermitido(datos?.categoria, CATEGORIAS),
    prioridad: valorPermitido(datos?.prioridad, PRIORIDADES),
    area: valorPermitido(datos?.area, AREAS),
    espacioId: idDelCatalogo(datos?.espacioId, catalogo.espacios),
    recursoId: idDelCatalogo(datos?.recursoId, catalogo.recursos),
    inhabilitar: datos?.inhabilitar === true,
    razon: textoLimpio(datos?.razon),
  };
}

// ---------- asistente de reservas ----------

/**
 * Valida la solicitud que la IA extrajo del texto.
 * Devuelve {asistentes, inicio, fin}; cada campo inválido queda en null.
 * (necesitaComputadores se valida aparte con validarComputadores.)
 * Las reglas de negocio (horario, aforo...) las aplica después reservas.js.
 */
export function validarSolicitud(datos) {
  const asistentes = Number.isInteger(datos?.asistentes) && datos.asistentes > 0 ? datos.asistentes : null;
  const inicio = FORMATO_FECHA.test(datos?.inicio) ? datos.inicio : null;
  const fin = FORMATO_FECHA.test(datos?.fin) ? datos.fin : null;
  return { asistentes, inicio, fin };
}

/** true o false si la IA lo dedujo del pedido; null si el pedido no dice nada. */
export function validarComputadores(valor) {
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * Se queda solo con los motivos de espacios que ya pasaron las reglas.
 * Si la IA menciona un espacio que no estaba en la lista filtrada, se descarta.
 * Devuelve un Map espacioId -> motivo.
 */
export function validarMotivos(opcionesIA, espaciosPermitidos) {
  const motivos = new Map();
  for (const opcion of Array.isArray(opcionesIA) ? opcionesIA : []) {
    const id = idDelCatalogo(opcion?.espacioId, espaciosPermitidos);
    const motivo = textoLimpio(opcion?.motivo);
    if (id && motivo) motivos.set(id, motivo);
  }
  return motivos;
}
