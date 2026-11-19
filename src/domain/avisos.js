// =====================================================================
// DOMINIO: AVISOS POR CORREO DE LO QUE CAMBIA EN UNA RESERVA
// ---------------------------------------------------------------------
// Decide A QUIÉN avisar y QUÉ decirle cuando cambia algo que le toca a
// una persona. Entregarlo es otro asunto (src/integraciones/avisos.js ->
// n8n -> correo): si mañana el canal es otro, estas reglas no cambian.
// Cada aviso es {para: usuario, asunto, mensaje}.
// Reglas:
//   1. Solicitud de salón nueva: a quien tiene la reserva (para que avise
//      si lo va a usar) y a los admins (que deciden).
//   2. Solicitud decidida: a quien la pidió (aprobada o rechazada) y, si se
//      aprobó, a quien tenía la reserva (cómo quedó o que se canceló).
//   3. Reserva editada o cancelada por OTRA persona (un admin): a su dueño.
//   4. Nunca se avisa a quien hizo el cambio, ni a una reserva sin dueño
//      conocido (anterior a la migración 007).
//   5. El dueño canceló una reserva que alguien había pedido: a quien la
//      pidió, que el salón quedó libre.
//   6. Una sala queda fuera de servicio (incidencia o Inventario): a cada
//      dueño de una reserva de esa sala que todavía no termina.
// =====================================================================

const hora = (f) => f.slice(11, 16);
const dia = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const franja = (r) => `el ${dia(r.inicio)} de ${hora(r.inicio)} a ${hora(r.fin)}`;
// Lo que pide una solicitud: con inicio (reserva futura) o desde que se apruebe (reserva en curso).
const franjaPedida = (s) => (s.inicio ? franja(s) : `el ${dia(s.fin)} hasta las ${hora(s.fin)}`);
const nombreSala = (db, id) => db.espacios.find((e) => e.id === id)?.nombre ?? id;
const conNota = (s) => (s.notaDecision ? ` Nota del admin: "${s.notaDecision}".` : '');

// Regla 4
const sinAutor = (avisos, autor) => avisos.filter((a) => a.para && a.para !== autor);

/**
 * Regla 1. solicitud: la recién creada; admins: usuarios con rol admin.
 * La reserva pedida se busca en db (todavía no cambia: solo cambia al aprobar).
 */
export function avisosDeSolicitudNueva(db, solicitud, admins) {
  const sala = nombreSala(db, solicitud.espacioId);
  const original = db.reservas.find((r) => r.id === solicitud.reservaId);
  const pedido = `${solicitud.responsable} pide ${sala} ${franjaPedida(solicitud)} para ${solicitud.asistentes} personas. Motivo: "${solicitud.motivo}".`;
  return sinAutor([
    {
      para: solicitud.afectado,
      asunto: `Pidieron tu salón ${sala}`,
      mensaje: `${pedido}${original ? ` Tú lo tienes reservado ${franja(original)}.` : ''}`
        + ' Un admin decidirá. Si lo vas a usar, avísale a un admin cuanto antes.',
    },
    ...admins.map((admin) => ({
      para: admin,
      asunto: `Solicitud de salón: ${sala} ${franjaPedida(solicitud)}`,
      mensaje: `${pedido}${original ? ` Está reservado por ${original.responsable} (${hora(original.inicio)}–${hora(original.fin)}).` : ''}`
        + ' Apruébala o recházala en Campus Pulse, pestaña Solicitudes.',
    })),
  ], solicitud.solicitante);
}

/**
 * Regla 2. decididas: las solicitudes que acaban de pasar de pendiente a aprobada o rechazada (la que
 * decidió el admin y las que se rechazaron solas por aprobar otra). originalAntes: copia de la reserva
 * pedida ANTES de aprobar (null si no había). autor: el admin que decidió.
 */
export function avisosDeDecision(db, decididas, originalAntes, autor) {
  const avisos = [];
  for (const s of decididas) {
    const sala = nombreSala(db, s.espacioId);
    if (s.estado === 'rechazada') {
      avisos.push({ para: s.solicitante, asunto: `Tu solicitud de ${sala} fue rechazada`,
        mensaje: `Un admin rechazó tu solicitud de ${sala} ${franjaPedida(s)}.${conNota(s)}` });
      continue;
    }
    const nueva = db.reservas.find((r) => r.id === s.reservaNuevaId);
    avisos.push({ para: s.solicitante, asunto: `Te asignaron ${sala}`,
      mensaje: `Un admin aprobó tu solicitud: ${sala} es tuyo ${nueva ? franja(nueva) : franjaPedida(s)}, a nombre de ${s.responsable}.${conNota(s)}` });
    // Si el dueño había movido su reserva a otra sala, no perdió nada: no hay aviso para él
    if (originalAntes && s.afectado && originalAntes.espacioId === s.espacioId) {
      // Lo que le quedó al dueño: sus reservas de esa sala que caen dentro de la franja que tenía
      const quedan = db.reservas
        .filter((r) => r.creadaPor === s.afectado && r.espacioId === originalAntes.espacioId
          && r.inicio < originalAntes.fin && originalAntes.inicio < r.fin)
        .sort((a, b) => a.inicio.localeCompare(b.inicio));
      const asi = quedan.length
        ? `quedó así: ${quedan.map((r) => `${hora(r.inicio)}–${hora(r.fin)}`).join(' y ')}`
        : 'se canceló';
      avisos.push({ para: s.afectado, asunto: `Tu reserva de ${sala} ${quedan.length ? 'cambió' : 'se canceló'}`,
        mensaje: `Un admin le asignó ${sala} ${nueva ? franja(nueva) : franjaPedida(s)} a ${s.responsable}. `
          + `Tu reserva ${franja(originalAntes)} ${asi}.${conNota(s)}` });
    }
  }
  return sinAutor(avisos, autor);
}

/**
 * Regla 3. antes: copia de la reserva antes del cambio; despues: la reserva editada, o null si se canceló.
 * autor: quien hizo el cambio (si es el dueño, no hay aviso).
 */
export function avisosDeReservaCambiada(db, antes, despues, autor) {
  if (!antes?.creadaPor) return [];
  const sala = nombreSala(db, antes.espacioId);
  const describir = (r) => `${nombreSala(db, r.espacioId)} ${franja(r)}, ${r.asistentes} asistentes, a nombre de ${r.responsable}`;
  const aviso = despues
    ? { para: antes.creadaPor, asunto: `Cambiaron tu reserva de ${sala}`,
      mensaje: `Un admin cambió tu reserva. Antes: ${describir(antes)}. Ahora: ${describir(despues)}.` }
    : { para: antes.creadaPor, asunto: `Cancelaron tu reserva de ${sala}`,
      mensaje: `Un admin canceló tu reserva de ${describir(antes)}. Si la necesitas, vuelve a reservar o habla con un admin.` };
  return sinAutor([aviso], autor);
}

/** Regla 5. cerradas: las solicitudes que se cerraron al cancelar la reserva (cerrarSolicitudesDe). autor: quien canceló. */
export function avisosDeSolicitudesCerradas(db, cerradas, autor) {
  return sinAutor(cerradas.map((s) => {
    const sala = nombreSala(db, s.espacioId);
    return {
      para: s.solicitante,
      asunto: `${sala} quedó libre`,
      mensaje: `Quien tenía reservado ${sala} canceló su reserva, así que tu solicitud ${franjaPedida(s)} se cerró: `
        + 'el salón quedó libre. Si todavía lo necesitas, resérvalo directamente en Campus Pulse.',
    };
  }), autor);
}

/**
 * Regla 6. espacioId: la sala que acaba de quedar fuera de servicio. motivo: por qué (texto corto).
 * ahora ("YYYY-MM-DDTHH:mm"): solo se avisa de las reservas que todavía no terminan. autor: quien la inhabilitó.
 */
export function avisosDeSalaInhabilitada(db, espacioId, motivo, autor, ahora) {
  const sala = nombreSala(db, espacioId);
  const reservas = db.reservas
    .filter((r) => r.espacioId === espacioId && r.fin > ahora && r.creadaPor)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  return sinAutor(reservas.map((r) => ({
    para: r.creadaPor,
    asunto: `${sala} quedó fuera de servicio`,
    mensaje: `${sala} quedó fuera de servicio (${motivo}). Tienes una reserva ahí ${franja(r)}, a nombre de ${r.responsable}: `
      + 'mientras la sala no se rehabilite no se podrá usar. Busca otra sala en Campus Pulse o habla con un admin.',
  })), autor);
}
