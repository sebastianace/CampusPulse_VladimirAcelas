// =====================================================================
// DOMINIO: RESERVAS DE ESPACIOS
// ---------------------------------------------------------------------
// Reglas (todos los valores salen de src/config/reglas.js):
//   1. El espacio no puede estar en un estado no asignable.
//   2. Los asistentes no pueden superar aforo x MARGEN_AFORO.
//   3. Solo se reserva en DIAS_HABILES.
//   4. La reserva va entre HORA_APERTURA y HORA_CIERRE del mismo día.
//   5. Dura como máximo MAX_HORAS_RESERVA.
//   6. No se puede cruzar con otra reserva del mismo espacio.
//   7. Una persona tiene como máximo MAX_RESERVAS_POR_PERSONA_DIA por día.
//   8. No se reserva en el pasado: el inicio debe estar al menos
//      ANTICIPACION_MINIMA_MINUTOS después de ahora (hora de Bogotá).
//   9. Si el pedido necesita computadores, solo sirven los espacios de
//      ESPACIOS_CON_COMPUTADORES (lo usa la recomendación con IA).
//  10. Una reserva que ya empezó no se puede editar ni cancelar.
// Editar una reserva vuelve a pasar por las reglas 1 a 8.
// Datos mal formados -> 422, espacio inexistente -> 404,
// regla violada -> ReglaNegocioError (409).
// =====================================================================

import { randomUUID } from 'node:crypto';
import { REGLAS } from '../config/reglas.js';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { ahoraBogota, diaDeLaSemana, esFechaHoraValida, minutosDelDia, minutosEntre, seSolapan } from './fechas.js';

// Nombres de los días en plural para los mensajes de error (0 = domingo).
const NOMBRES_DIAS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

// ---------- validación de datos (422) ----------

/** Revisa {asistentes, inicio, fin} y los devuelve limpios. */
function validarSolicitud(datos) {
  const asistentes = Number(datos?.asistentes);
  if (!Number.isInteger(asistentes) || asistentes <= 0) {
    throw new DatosInvalidosError('El número de asistentes debe ser un entero mayor que 0');
  }
  if (!esFechaHoraValida(datos.inicio) || !esFechaHoraValida(datos.fin)) {
    throw new DatosInvalidosError('Inicio y fin deben tener el formato YYYY-MM-DDTHH:mm');
  }
  if (datos.fin <= datos.inicio) {
    throw new DatosInvalidosError('La hora de fin debe ser posterior a la de inicio');
  }
  return { asistentes, inicio: datos.inicio, fin: datos.fin };
}

/** Revisa el cuerpo completo de POST /api/reservas y lo devuelve limpio. */
function validarDatosReserva(datos) {
  const solicitud = validarSolicitud(datos);
  const responsable = String(datos.responsable ?? '').trim();
  if (!datos.espacioId) throw new DatosInvalidosError('Falta el espacio a reservar');
  if (responsable === '') throw new DatosInvalidosError('Falta el nombre del responsable');
  return { espacioId: datos.espacioId, responsable, ...solicitud };
}

// ---------- reglas sobre la franja horaria ----------

// Regla 8: no reservar en el pasado ni con menos anticipación de la mínima.
function validarAnticipacion(inicio) {
  const anticipacion = REGLAS.ANTICIPACION_MINIMA_MINUTOS;
  if (minutosEntre(ahoraBogota(), inicio) < anticipacion) {
    const mensaje = anticipacion > 0
      ? `Las reservas deben hacerse con al menos ${anticipacion} minutos de anticipación`
      : 'No se puede reservar en una fecha u hora que ya pasó';
    throw new ReglaNegocioError('RESERVA_EN_PASADO', mensaje);
  }
}

// Regla 3: día hábil.
function validarDiaHabil(inicio) {
  const dia = diaDeLaSemana(inicio);
  if (!REGLAS.DIAS_HABILES.includes(dia)) {
    throw new ReglaNegocioError('DIA_NO_HABIL', `No se puede reservar los ${NOMBRES_DIAS[dia]}`);
  }
}

// Regla 4: dentro del horario del campus y sin pasar a otro día.
function validarHorario(inicio, fin) {
  const mismoDia = inicio.slice(0, 10) === fin.slice(0, 10);
  const abreAntes = minutosDelDia(inicio) >= REGLAS.HORA_APERTURA * 60;
  const cierraDespues = minutosDelDia(fin) <= REGLAS.HORA_CIERRE * 60;
  if (!mismoDia || !abreAntes || !cierraDespues) {
    throw new ReglaNegocioError('FUERA_DE_HORARIO',
      `Las reservas deben estar entre las ${REGLAS.HORA_APERTURA}:00 y las ${REGLAS.HORA_CIERRE}:00 del mismo día`);
  }
}

// Regla 5: duración máxima.
function validarDuracion(inicio, fin) {
  if (minutosEntre(inicio, fin) > REGLAS.MAX_HORAS_RESERVA * 60) {
    throw new ReglaNegocioError('DURACION_EXCEDIDA',
      `Una reserva puede durar como máximo ${REGLAS.MAX_HORAS_RESERVA} horas`);
  }
}

/** Reglas que dependen solo de la franja, no del espacio (8, 3, 4 y 5). */
function validarFranja(inicio, fin) {
  validarAnticipacion(inicio);
  validarDiaHabil(inicio);
  validarHorario(inicio, fin);
  validarDuracion(inicio, fin);
}

// ---------- reglas sobre el espacio ----------

/** Máximo de personas que admite el espacio con el margen actual. */
export function capacidadMaxima(espacio) {
  return Math.floor(espacio.aforo * REGLAS.MARGEN_AFORO);
}

// Regla 1: espacio asignable.
function esAsignable(espacio) {
  return !REGLAS.ESTADOS_NO_ASIGNABLES.includes(espacio.estado);
}

// Regla 2: aforo.
function cabenAsistentes(espacio, asistentes) {
  return asistentes <= capacidadMaxima(espacio);
}

// Regla 9: el espacio tiene computadores.
export function tieneComputadores(espacio) {
  return REGLAS.ESPACIOS_CON_COMPUTADORES.includes(espacio.id);
}

// Regla 6: true si el espacio ya tiene una reserva que se cruza con la franja.
// Al editar se pasa ignorarId para que la reserva no choque consigo misma.
function estaReservado(db, espacioId, inicio, fin, ignorarId = null) {
  return db.reservas.some((r) => r.id !== ignorarId && r.espacioId === espacioId && seSolapan(r.inicio, r.fin, inicio, fin));
}

/** Aplica las reglas 1, 2 y 6 a un espacio concreto y explica cuál falla. */
function validarEspacio(db, espacio, { asistentes, inicio, fin }, ignorarId = null) {
  if (!esAsignable(espacio)) {
    throw new ReglaNegocioError('ESPACIO_NO_ASIGNABLE', `${espacio.nombre} está ${espacio.estado} y no se puede reservar`);
  }
  if (!cabenAsistentes(espacio, asistentes)) {
    throw new ReglaNegocioError('AFORO_EXCEDIDO',
      `${espacio.nombre} admite máximo ${capacidadMaxima(espacio)} personas y pediste ${asistentes}`);
  }
  if (estaReservado(db, espacio.id, inicio, fin, ignorarId)) {
    throw new ReglaNegocioError('RESERVA_SOLAPADA', `${espacio.nombre} ya está reservado en esa franja`);
  }
}

// ---------- regla sobre la persona ----------

// Regla 7: límite de reservas por persona y día (sin distinguir mayúsculas).
function validarLimitePersona(db, responsable, inicio, ignorarId = null) {
  const persona = responsable.toLowerCase();
  const fecha = inicio.slice(0, 10);
  const delDia = db.reservas.filter((r) => r.id !== ignorarId && r.responsable.toLowerCase() === persona && r.inicio.startsWith(fecha));
  if (delDia.length >= REGLAS.MAX_RESERVAS_POR_PERSONA_DIA) {
    throw new ReglaNegocioError('LIMITE_RESERVAS_PERSONA',
      `${responsable} ya tiene ${REGLAS.MAX_RESERVAS_POR_PERSONA_DIA} reservas ese día, que es el máximo`);
  }
}

// ---------- funciones públicas ----------

/**
 * Valida y agrega una reserva a la base (db se modifica).
 * Devuelve la reserva creada: {id, espacioId, responsable, asistentes, inicio, fin}.
 */
export function crearReserva(db, datos) {
  const reserva = validarDatosReserva(datos);
  const espacio = db.espacios.find((e) => e.id === reserva.espacioId);
  if (!espacio) throw new NoEncontradoError(`No existe el espacio "${reserva.espacioId}"`);

  validarEspacio(db, espacio, reserva);
  validarFranja(reserva.inicio, reserva.fin);
  validarLimitePersona(db, reserva.responsable, reserva.inicio);

  const nueva = { id: `res-${randomUUID().slice(0, 8)}`, ...reserva };
  db.reservas.push(nueva);
  return nueva;
}

// ---------- editar y cancelar ----------

// Devuelve la reserva con ese id o lanza 404.
function buscarReserva(db, id) {
  const reserva = db.reservas.find((r) => r.id === id);
  if (!reserva) throw new NoEncontradoError(`No existe la reserva "${id}"`);
  return reserva;
}

// Regla 10: una reserva que ya empezó (o terminó) no se puede editar ni cancelar.
function validarNoIniciada(reserva, accion) {
  if (reserva.inicio <= ahoraBogota()) {
    throw new ReglaNegocioError('RESERVA_YA_INICIADA', `No se puede ${accion} una reserva que ya empezó`);
  }
}

/**
 * Cambia una reserva existente (db se modifica). Recibe solo los campos a cambiar;
 * los demás se conservan. Pasa por TODAS las reglas de crearReserva, sin que la
 * reserva choque consigo misma en el solapamiento ni cuente en el límite por persona.
 * Devuelve la reserva actualizada.
 */
export function editarReserva(db, id, cambios) {
  const actual = buscarReserva(db, id);
  validarNoIniciada(actual, 'editar');
  const reserva = validarDatosReserva({ ...actual, ...cambios });
  const espacio = db.espacios.find((e) => e.id === reserva.espacioId);
  if (!espacio) throw new NoEncontradoError(`No existe el espacio "${reserva.espacioId}"`);

  validarEspacio(db, espacio, reserva, id);
  validarFranja(reserva.inicio, reserva.fin);
  validarLimitePersona(db, reserva.responsable, reserva.inicio, id);

  Object.assign(actual, reserva);
  return actual;
}

/** Cancela (elimina) una reserva que todavía no empieza. Devuelve la reserva cancelada. */
export function cancelarReserva(db, id) {
  const reserva = buscarReserva(db, id);
  validarNoIniciada(reserva, 'cancelar');
  db.reservas.splice(db.reservas.indexOf(reserva), 1);
  return reserva;
}

/**
 * Espacios que cumplen TODAS las reglas para {asistentes, inicio, fin},
 * ordenados por mejor ajuste de aforo (el más pequeño en el que caben primero).
 * Con necesitaComputadores: true solo quedan los espacios con computadores.
 * Si la franja misma viola una regla (domingo, fuera de horario, muy larga)
 * lanza la ReglaNegocioError correspondiente para que el usuario sepa por qué.
 * La usa P2 en POST /api/ia/recomendar: la IA nunca decide sola qué sala está libre.
 */
export function buscarEspaciosDisponibles(datos, db) {
  const { asistentes, inicio, fin } = validarSolicitud(datos);
  validarFranja(inicio, fin);
  const conComputadores = datos.necesitaComputadores === true;
  return db.espacios
    .filter((e) => esAsignable(e) && cabenAsistentes(e, asistentes) && !estaReservado(db, e.id, inicio, fin))
    .filter((e) => !conComputadores || tieneComputadores(e))
    .sort((a, b) => capacidadMaxima(a) - capacidadMaxima(b));
}
