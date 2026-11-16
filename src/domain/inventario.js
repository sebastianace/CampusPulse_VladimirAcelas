// =====================================================================
// DOMINIO: INVENTARIO (estado de equipos y salas, a mano)
// ---------------------------------------------------------------------
// Lo usa soporte técnico (y el admin) para dejar el inventario como está
// en la realidad: "el micrófono ya se arregló", "la sala está en obra".
// Reglas:
//   1. Un equipo solo cambia si TRANSICIONES_RECURSO lo permite.
//   2. "Prestado" no se pone a mano (se presta en Préstamos) y un equipo
//      prestado no se toca aquí (se devuelve en Préstamos).
//   3. Si una incidencia abierta tiene fuera de servicio el equipo o la
//      sala, no se cambia a mano: se resuelve la incidencia, así queda el
//      registro de quién lo arregló y cuándo.
//   4. Una sala "inconsistente" no se toca: su problema es del CSV oficial.
// =====================================================================

import { ESTADOS_RECURSO, REGLAS } from '../config/reglas.js';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { cambiarEstadoRecurso } from './prestamos.js';

// Estados de sala que se pueden poner a mano.
const ESTADOS_ESPACIO_MANUALES = ['disponible', 'inhabilitado'];

function buscar(coleccion, id, nombre) {
  const elemento = coleccion.find((e) => e.id === id);
  if (!elemento) throw new NoEncontradoError(`No existe el ${nombre} "${id}"`);
  return elemento;
}

// Regla 3: la incidencia abierta que mantiene fuera de servicio la sala o el equipo, o undefined.
function incidenciaQueLoInhabilita(db, { espacioId, recursoId }) {
  return db.incidencias.find((i) => i.estado === 'abierta' && (recursoId
    ? i.inhabilito === true && i.recursoId === recursoId
    : i.inhabilitoEspacio === true && i.espacioId === espacioId));
}

function exigirSinIncidencia(db, lugar, nombre) {
  const incidencia = incidenciaQueLoInhabilita(db, lugar);
  if (incidencia) {
    throw new ReglaNegocioError('INCIDENCIA_ABIERTA',
      `${nombre} está fuera de servicio por la incidencia ${incidencia.id}: resuélvela en Incidencias para rehabilitarlo`);
  }
}

/**
 * Estados a los que se puede pasar el equipo desde Inventario (sin "prestado").
 * Sale de TRANSICIONES_RECURSO: si la regla cambia, los botones de la pantalla cambian solos.
 */
export function cambiosManuales(recurso) {
  if (recurso.estado === 'prestado') return [];
  return (REGLAS.TRANSICIONES_RECURSO[recurso.estado] ?? []).filter((estado) => estado !== 'prestado');
}

/** Cambia el estado de un equipo: {estado} -> el recurso actualizado. */
export function actualizarEstadoRecurso(db, recursoId, datos) {
  const estado = datos?.estado;
  if (!ESTADOS_RECURSO.includes(estado)) throw new DatosInvalidosError(`estado debe ser uno de: ${ESTADOS_RECURSO.join(', ')}`);
  const recurso = buscar(db.recursos, recursoId, 'recurso');
  if (estado === 'prestado' || recurso.estado === 'prestado') {
    throw new ReglaNegocioError('USAR_PRESTAMOS', `Los préstamos se manejan en la pestaña Prestar: ${recurso.nombre} se presta o se devuelve allí`);
  }
  exigirSinIncidencia(db, { recursoId }, recurso.nombre);
  cambiarEstadoRecurso(recurso, estado);
  return recurso;
}

/** Cambia el estado de una sala: {estado: "disponible" | "inhabilitado"} -> el espacio actualizado. */
export function actualizarEstadoEspacio(db, espacioId, datos) {
  const estado = datos?.estado;
  if (!ESTADOS_ESPACIO_MANUALES.includes(estado)) {
    throw new DatosInvalidosError(`estado debe ser uno de: ${ESTADOS_ESPACIO_MANUALES.join(', ')}`);
  }
  const espacio = buscar(db.espacios, espacioId, 'espacio');
  if (espacio.estado === 'inconsistente') {
    throw new ReglaNegocioError('ESPACIO_INCONSISTENTE', `${espacio.nombre} tiene un dato inconsistente en el CSV oficial: hay que corregir el archivo`);
  }
  exigirSinIncidencia(db, { espacioId }, espacio.nombre);
  espacio.estado = estado;
  return espacio;
}
