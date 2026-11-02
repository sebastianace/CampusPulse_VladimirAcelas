// =====================================================================
// DOMINIO: PRÉSTAMOS DE RECURSOS TECNOLÓGICOS
// ---------------------------------------------------------------------
// Reglas (valores en src/config/reglas.js):
//   1. Un recurso solo cambia de estado si TRANSICIONES_RECURSO lo
//      permite (por ejemplo, un equipo "danado" no se puede prestar).
//   2. Una persona tiene como máximo MAX_PRESTAMOS_POR_PERSONA activos.
// =====================================================================

import { randomUUID } from 'node:crypto';
import { ESTADOS_RECURSO, REGLAS } from '../config/reglas.js';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { ahoraBogota } from './fechas.js';

// Cómo se muestra cada estado en los mensajes de error.
const NOMBRES_ESTADO = { disponible: 'disponible', prestado: 'prestado', danado: 'dañado', en_reparacion: 'en reparación' };

// ---------- búsquedas ----------

function buscarRecurso(db, recursoId) {
  const recurso = db.recursos.find((r) => r.id === recursoId);
  if (!recurso) throw new NoEncontradoError(`No existe el recurso "${recursoId}"`);
  return recurso;
}

function buscarPrestamo(db, prestamoId) {
  const prestamo = db.prestamos.find((p) => p.id === prestamoId);
  if (!prestamo) throw new NoEncontradoError(`No existe el préstamo "${prestamoId}"`);
  return prestamo;
}

// ---------- reglas ----------

/** Regla 1: cambia el estado del recurso solo si la transición está permitida. */
export function cambiarEstadoRecurso(recurso, nuevoEstado) {
  const permitidos = REGLAS.TRANSICIONES_RECURSO[recurso.estado] ?? [];
  if (!permitidos.includes(nuevoEstado)) {
    throw new ReglaNegocioError('TRANSICION_INVALIDA',
      `${recurso.nombre} está ${NOMBRES_ESTADO[recurso.estado] ?? recurso.estado} y no puede pasar a ${NOMBRES_ESTADO[nuevoEstado] ?? nuevoEstado}`);
  }
  recurso.estado = nuevoEstado;
}

// Regla 2: límite de préstamos activos por persona (sin distinguir mayúsculas).
function validarLimitePersona(db, persona) {
  const clave = persona.toLowerCase();
  const activos = db.prestamos.filter((p) => p.estado === 'activo' && p.persona.toLowerCase() === clave);
  if (activos.length >= REGLAS.MAX_PRESTAMOS_POR_PERSONA) {
    throw new ReglaNegocioError('LIMITE_PRESTAMOS_PERSONA',
      `${persona} ya tiene ${REGLAS.MAX_PRESTAMOS_POR_PERSONA} préstamos activos, que es el máximo`);
  }
}

// ---------- funciones públicas ----------

/** Presta un recurso: {recursoId, persona} -> {id, recursoId, persona, estado, fecha}. */
export function crearPrestamo(db, datos) {
  const persona = String(datos?.persona ?? '').trim();
  if (!datos?.recursoId) throw new DatosInvalidosError('Falta el recurso a prestar');
  if (persona === '') throw new DatosInvalidosError('Falta el nombre de la persona');

  const recurso = buscarRecurso(db, datos.recursoId);
  validarLimitePersona(db, persona);
  cambiarEstadoRecurso(recurso, 'prestado');

  const prestamo = { id: `pre-${randomUUID().slice(0, 8)}`, recursoId: recurso.id, persona, estado: 'activo', fecha: ahoraBogota() };
  db.prestamos.push(prestamo);
  return prestamo;
}

/** Devuelve un préstamo: {estadoFinal: "disponible" | "danado"} -> el préstamo actualizado. */
export function devolverPrestamo(db, prestamoId, datos) {
  const estadoFinal = datos?.estadoFinal;
  if (!ESTADOS_RECURSO.includes(estadoFinal)) {
    throw new DatosInvalidosError('estadoFinal debe ser "disponible" o "danado"');
  }
  const prestamo = buscarPrestamo(db, prestamoId);
  if (prestamo.estado !== 'activo') {
    throw new ReglaNegocioError('PRESTAMO_YA_DEVUELTO', 'Este préstamo ya fue devuelto');
  }

  cambiarEstadoRecurso(buscarRecurso(db, prestamo.recursoId), estadoFinal);
  prestamo.estado = 'devuelto';
  prestamo.fechaDevolucion = ahoraBogota();
  return prestamo;
}
