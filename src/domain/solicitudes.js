// =====================================================================
// DOMINIO: SOLICITUDES DE SALÓN
// ---------------------------------------------------------------------
// Caso del campus: el profesor de las 9:00 no llegó y otra persona
// necesita ese salón. En vez de escribirle a TI por correo, lo solicita
// en la app y un admin decide.
// Reglas:
//   1. Solo se solicita un salón cuya reserva está EN CURSO (ya empezó y
//      no ha terminado). Para una franja futura libre se reserva normal.
//   2. No se solicita la reserva propia ni dos veces la misma.
//   3. La solicitud se "ensaya" al crearla: si al aprobarla violaría una
//      regla de reservas (aforo, horario, máximo de horas, cruce con la
//      siguiente reserva...), se rechaza de una vez con ese motivo.
//   4. Al aprobar, en una sola transacción: la reserva original se corta
//      en ese momento (fin = ahora) y se crea la nueva, desde ahora hasta
//      el fin pedido, a nombre de quien la solicitó. Las demás solicitudes
//      pendientes de la misma reserva quedan rechazadas.
//   5. Solo un admin aprueba o rechaza (lo exige la ruta).
// Avisos: solo en la app (la pestaña Solicitudes y los toasts).
// =====================================================================

import { randomUUID } from 'node:crypto';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { ahoraBogota, esFechaHoraValida } from './fechas.js';
import { crearReserva } from './reservas.js';

const MAX_MOTIVO = 300;
const DECISIONES = ['aprobar', 'rechazar'];

function buscar(coleccion, id, nombre) {
  const elemento = coleccion.find((e) => e.id === id);
  if (!elemento) throw new NoEncontradoError(`No existe la ${nombre} "${id}"`);
  return elemento;
}

/** Revisa {reservaId, responsable, asistentes, fin, motivo} y los devuelve limpios. */
function validarDatos(datos) {
  const responsable = String(datos?.responsable ?? '').trim();
  const motivo = String(datos?.motivo ?? '').trim();
  const asistentes = Number(datos?.asistentes);
  if (!datos?.reservaId) throw new DatosInvalidosError('Falta la reserva del salón que solicitas');
  if (responsable === '') throw new DatosInvalidosError('Falta el nombre del responsable');
  if (!Number.isInteger(asistentes) || asistentes <= 0) throw new DatosInvalidosError('El número de asistentes debe ser un entero mayor que 0');
  if (!esFechaHoraValida(datos.fin)) throw new DatosInvalidosError('fin debe tener el formato YYYY-MM-DDTHH:mm');
  if (motivo === '') throw new DatosInvalidosError('Cuéntale al admin por qué necesitas el salón');
  if (motivo.length > MAX_MOTIVO) throw new DatosInvalidosError(`El motivo puede tener máximo ${MAX_MOTIVO} caracteres`);
  return { reservaId: datos.reservaId, responsable, asistentes, fin: datos.fin, motivo };
}

// Regla 4: corta la reserva original en "ahora" y crea la nueva. Modifica db y devuelve la reserva nueva.
function aplicarAprobacion(db, solicitud, ahora) {
  const original = db.reservas.find((r) => r.id === solicitud.reservaId);
  if (original && original.fin > ahora) {
    if (original.inicio >= ahora) {
      throw new ReglaNegocioError('RESERVA_RECIEN_EMPEZADA', 'La reserva acaba de empezar: espera un minuto e inténtalo de nuevo');
    }
    original.fin = ahora;
  }
  return crearReserva(db, {
    espacioId: solicitud.espacioId, responsable: solicitud.responsable, asistentes: solicitud.asistentes, inicio: ahora, fin: solicitud.fin,
  }, { creadaPor: solicitud.solicitante, desdeAhora: true });
}

/**
 * Crea una solicitud pendiente. usuario = {usuario, rol} de quien la pide.
 * ahora ("YYYY-MM-DDTHH:mm") es la hora de Bogotá; se recibe como parámetro para poder probarlo a cualquier hora.
 */
export function crearSolicitud(db, datos, usuario, ahora = ahoraBogota()) {
  const limpia = validarDatos(datos);
  const reserva = buscar(db.reservas, limpia.reservaId, 'reserva');

  if (!(reserva.inicio <= ahora && ahora < reserva.fin)) {
    throw new ReglaNegocioError('RESERVA_NO_EN_CURSO', 'Solo se puede solicitar un salón cuya reserva está en curso. Para otra hora, resérvalo normal.');
  }
  if (reserva.creadaPor && reserva.creadaPor === usuario.usuario) {
    throw new ReglaNegocioError('ES_TU_RESERVA', 'Esta reserva es tuya: el salón ya es tuyo hasta las ' + reserva.fin.slice(11));
  }
  if (limpia.fin <= ahora) throw new DatosInvalidosError('La hora de fin debe ser posterior a este momento');
  const repetida = db.solicitudes.some((s) => s.estado === 'pendiente' && s.reservaId === reserva.id && s.solicitante === usuario.usuario);
  if (repetida) throw new ReglaNegocioError('SOLICITUD_REPETIDA', 'Ya tienes una solicitud pendiente para este salón');

  const solicitud = {
    id: `sol-${randomUUID().slice(0, 8)}`, ...limpia, espacioId: reserva.espacioId,
    solicitante: usuario.usuario, afectado: reserva.creadaPor ?? null, estado: 'pendiente', fecha: ahora,
  };
  // Regla 3: se ensaya la aprobación sobre una copia; si alguna regla falla, el error sale ya.
  aplicarAprobacion(structuredClone(db), solicitud, ahora);

  db.solicitudes.push(solicitud);
  return solicitud;
}

/** Aprueba o rechaza una solicitud pendiente: {decision: "aprobar" | "rechazar", nota?}. admin = {usuario, rol}. */
export function decidirSolicitud(db, id, datos, admin, ahora = ahoraBogota()) {
  if (!DECISIONES.includes(datos?.decision)) throw new DatosInvalidosError('decision debe ser "aprobar" o "rechazar"');
  const solicitud = buscar(db.solicitudes, id, 'solicitud');
  if (solicitud.estado !== 'pendiente') throw new ReglaNegocioError('SOLICITUD_YA_DECIDIDA', `Esta solicitud ya fue ${solicitud.estado}`);
  const nota = String(datos.nota ?? '').trim().slice(0, MAX_MOTIVO) || null;
  const decidir = (s, estado, notaDecision, reservaNuevaId = null) =>
    Object.assign(s, { estado, decididaPor: admin.usuario, fechaDecision: ahora, notaDecision, reservaNuevaId });

  if (datos.decision === 'rechazar') return decidir(solicitud, 'rechazada', nota);

  const nueva = aplicarAprobacion(db, solicitud, ahora);
  decidir(solicitud, 'aprobada', nota, nueva.id);
  // Regla 4: el salón ya tiene dueño; las otras solicitudes de la misma reserva no se pueden aprobar.
  db.solicitudes
    .filter((s) => s.estado === 'pendiente' && s.reservaId === solicitud.reservaId)
    .forEach((s) => decidir(s, 'rechazada', 'Se aprobó otra solicitud para este salón'));
  return solicitud;
}

/**
 * Las solicitudes que le tocan al usuario, de la más nueva a la más vieja:
 * el admin ve todas; los demás, las que pidieron y las que cortaron su reserva.
 */
export function solicitudesDe(db, usuario) {
  const mias = usuario.rol === 'admin'
    ? db.solicitudes
    : db.solicitudes.filter((s) => s.solicitante === usuario.usuario || s.afectado === usuario.usuario);
  return [...mias].reverse().map((s) => {
    const original = db.reservas.find((r) => r.id === s.reservaId);
    return { ...s, reservaOriginal: original ? { responsable: original.responsable, inicio: original.inicio, fin: original.fin } : null };
  });
}
