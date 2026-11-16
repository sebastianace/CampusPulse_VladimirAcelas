// =====================================================================
// DOMINIO: SOLICITUDES DE SALÓN
// ---------------------------------------------------------------------
// Casos del campus:
//   - El profesor de las 9:00 no llegó y otra persona necesita ese salón
//     (reserva EN CURSO).
//   - Un profesor necesita Cosmos mañana de 9 a 11, pero otro ya lo
//     reservó (reserva FUTURA).
// En vez de escribirle a TI por correo, lo solicita en la app y un admin decide.
// Reglas:
//   1. Se solicita un salón cuya reserva no ha terminado: en curso o futura.
//      En curso, la nueva reserva empieza en el momento de aprobarla (solo
//      se elige hasta qué hora). Futura, se pide una franja (inicio y fin)
//      que se cruce con esa reserva.
//   2. No se solicita la reserva propia ni dos veces la misma. La franja no
//      puede cruzarse con OTRA reserva del salón: se pide una a la vez.
//   3. La solicitud se "ensaya" al crearla: si al aprobarla violaría una
//      regla de reservas (aforo, horario, máximo de horas, límite por
//      persona...), se rechaza de una vez con ese motivo.
//   4. Al aprobar, en una sola transacción, se le quita a la reserva original
//      la franja pedida y se crea la nueva a nombre de quien la solicitó:
//        - En curso: la original termina en ese momento (quien no llegó
//          pierde lo que le quedaba).
//        - Futura: la original conserva lo que le sobre antes o después de la
//          franja pedida (si sobra a los dos lados, queda en dos partes); si
//          la franja pedida la cubre entera, se cancela.
//      Las demás solicitudes pendientes de la misma reserva quedan rechazadas.
//   5. Solo un admin aprueba o rechaza (lo exige la ruta).
// Avisos: solo en la app (la pestaña Solicitudes y los toasts).
// =====================================================================

import { randomUUID } from 'node:crypto';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { ahoraBogota, esFechaHoraValida, seSolapan } from './fechas.js';
import { crearReserva } from './reservas.js';

const MAX_MOTIVO = 300;
const DECISIONES = ['aprobar', 'rechazar'];
const hora = (fechaHora) => fechaHora.slice(11, 16);

function buscar(coleccion, id, nombre) {
  const elemento = coleccion.find((e) => e.id === id);
  if (!elemento) throw new NoEncontradoError(`No existe la ${nombre} "${id}"`);
  return elemento;
}

/** Revisa {reservaId, responsable, asistentes, inicio?, fin, motivo} y los devuelve limpios. */
function validarDatos(datos) {
  const responsable = String(datos?.responsable ?? '').trim();
  const motivo = String(datos?.motivo ?? '').trim();
  const asistentes = Number(datos?.asistentes);
  if (!datos?.reservaId) throw new DatosInvalidosError('Falta la reserva del salón que solicitas');
  if (responsable === '') throw new DatosInvalidosError('Falta el nombre del responsable');
  if (!Number.isInteger(asistentes) || asistentes <= 0) throw new DatosInvalidosError('El número de asistentes debe ser un entero mayor que 0');
  if (datos.inicio != null && !esFechaHoraValida(datos.inicio)) throw new DatosInvalidosError('inicio debe tener el formato YYYY-MM-DDTHH:mm');
  if (!esFechaHoraValida(datos.fin)) throw new DatosInvalidosError('fin debe tener el formato YYYY-MM-DDTHH:mm');
  if (motivo === '') throw new DatosInvalidosError('Cuéntale al admin por qué necesitas el salón');
  if (motivo.length > MAX_MOTIVO) throw new DatosInvalidosError(`El motivo puede tener máximo ${MAX_MOTIVO} caracteres`);
  return { reservaId: datos.reservaId, responsable, asistentes, inicio: datos.inicio ?? null, fin: datos.fin, motivo };
}

// Borra una reserva y quita las referencias de las solicitudes que la apuntaban, para que el
// almacén no las guarde apuntando a una reserva borrada (src/data/almacen.js borra primero).
function quitarReserva(db, reserva) {
  db.reservas.splice(db.reservas.indexOf(reserva), 1);
  db.solicitudes.forEach((s) => { if (s.reservaId === reserva.id) s.reservaId = null; });
}

// Regla 4: le quita a la reserva original la franja [inicio, fin). Modifica db.
function liberarFranja(db, original, inicio, fin, ahora) {
  if (!seSolapan(original.inicio, original.fin, inicio, fin)) return;
  const enCurso = original.inicio <= ahora;
  const sobraAntes = original.inicio < inicio;
  const sobraDespues = !enCurso && original.fin > fin; // en curso, quien no llegó pierde el resto
  if (sobraAntes && sobraDespues) {
    db.reservas.push({ ...original, id: `res-${randomUUID().slice(0, 8)}`, inicio: fin });
    original.fin = inicio;
  } else if (sobraAntes) {
    original.fin = inicio;
  } else if (sobraDespues) {
    original.inicio = fin;
  } else {
    quitarReserva(db, original);
  }
}

// Regla 4: libera la franja en la reserva original y crea la nueva. Modifica db y devuelve la reserva nueva.
function aplicarAprobacion(db, solicitud, ahora) {
  // Lo que ya pasó no se puede dar: la nueva empieza, como pronto, ahora.
  const inicio = solicitud.inicio && solicitud.inicio > ahora ? solicitud.inicio : ahora;
  if (solicitud.fin <= inicio) {
    throw new ReglaNegocioError('SOLICITUD_VENCIDA', `La franja pedida terminó a las ${hora(solicitud.fin)}: ya no se puede aprobar`);
  }
  const original = db.reservas.find((r) => r.id === solicitud.reservaId);
  if (original && original.fin > ahora) liberarFranja(db, original, inicio, solicitud.fin, ahora);
  return crearReserva(db, {
    espacioId: solicitud.espacioId, responsable: solicitud.responsable, asistentes: solicitud.asistentes, inicio, fin: solicitud.fin,
  }, { creadaPor: solicitud.solicitante, desdeAhora: true });
}

/**
 * Crea una solicitud pendiente. usuario = {usuario, rol} de quien la pide.
 * ahora ("YYYY-MM-DDTHH:mm") es la hora de Bogotá; se recibe como parámetro para poder probarlo a cualquier hora.
 */
export function crearSolicitud(db, datos, usuario, ahora = ahoraBogota()) {
  const limpia = validarDatos(datos);
  const reserva = buscar(db.reservas, limpia.reservaId, 'reserva');

  if (reserva.fin <= ahora) {
    throw new ReglaNegocioError('RESERVA_TERMINADA', 'Esa reserva ya terminó: el salón está libre, resérvalo normal.');
  }
  if (reserva.creadaPor && reserva.creadaPor === usuario.usuario) {
    throw new ReglaNegocioError('ES_TU_RESERVA', `Esta reserva es tuya: el salón ya es tuyo de ${hora(reserva.inicio)} a ${hora(reserva.fin)}`);
  }

  // Regla 1: en curso, la nueva empieza al aprobarla; futura, se pide una franja que se cruce con ella.
  const enCurso = reserva.inicio <= ahora;
  const inicio = enCurso ? null : limpia.inicio;
  if (!enCurso) {
    if (!inicio) throw new DatosInvalidosError('Falta desde qué hora necesitas el salón');
    if (inicio < ahora) throw new DatosInvalidosError('La hora de inicio ya pasó');
  }
  const desde = inicio ?? ahora;
  if (limpia.fin <= desde) throw new DatosInvalidosError(enCurso ? 'La hora de fin debe ser posterior a este momento' : 'La hora de fin debe ser posterior a la de inicio');
  if (!seSolapan(reserva.inicio, reserva.fin, desde, limpia.fin)) {
    throw new ReglaNegocioError('FRANJA_LIBRE', `De ${hora(desde)} a ${hora(limpia.fin)} el salón no está ocupado por esa reserva: resérvalo normal.`);
  }
  // Regla 2: una reserva a la vez.
  const otra = db.reservas.find((r) => r.id !== reserva.id && r.espacioId === reserva.espacioId && seSolapan(r.inicio, r.fin, desde, limpia.fin));
  if (otra) {
    throw new ReglaNegocioError('CHOCA_CON_OTRA_RESERVA',
      `Esa franja también se cruza con la reserva de ${otra.responsable} (${hora(otra.inicio)}–${hora(otra.fin)}). Pide solo la parte que ocupa una reserva.`);
  }
  const repetida = db.solicitudes.some((s) => s.estado === 'pendiente' && s.reservaId === reserva.id && s.solicitante === usuario.usuario);
  if (repetida) throw new ReglaNegocioError('SOLICITUD_REPETIDA', 'Ya tienes una solicitud pendiente para este salón');

  const solicitud = {
    id: `sol-${randomUUID().slice(0, 8)}`, ...limpia, inicio, espacioId: reserva.espacioId,
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

  // Se guarda antes de aprobar: si la reserva original se cancela entera, las solicitudes pierden su reservaId.
  const otrasPendientes = db.solicitudes.filter((s) => s !== solicitud && s.estado === 'pendiente' && s.reservaId === solicitud.reservaId);
  const nueva = aplicarAprobacion(db, solicitud, ahora);
  decidir(solicitud, 'aprobada', nota, nueva.id);
  // Regla 4: el salón ya tiene dueño en esa franja; las otras solicitudes de la misma reserva no se pueden aprobar.
  otrasPendientes.forEach((s) => decidir(s, 'rechazada', 'Se aprobó otra solicitud para este salón'));
  return solicitud;
}

/**
 * Las solicitudes que le tocan al usuario, de la más nueva a la más vieja:
 * el admin ve todas; los demás, las que pidieron y las que tocan su reserva.
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
