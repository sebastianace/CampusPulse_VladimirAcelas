// Pestaña "Solicitudes": pedidos de un salón ocupado (src/domain/solicitudes.js).
// - El admin ve todas, con Aprobar y Rechazar, y un contador de pendientes.
// - Los demás ven las que pidieron y las que tocan su reserva.
// Avisos en la app: con cada recarga (cada 5 s) se compara con lo que ya se
// había visto y se muestra un toast cuando llega algo nuevo para esta persona.

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { puede, sesionActual } from './sesion.js';
import * as toasts from './toasts.js';

let refrescar = async () => {};
let espacios = [];

const ESTADOS = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const CLASE_ESTADO = { pendiente: 'etiqueta--alta', aprobada: 'etiqueta--resuelta', rechazada: 'etiqueta--critica' };

// id -> estado de lo último que se vio; null antes de la primera carga (para no avisar de lo viejo)
let vistas = null;

export function iniciarSolicitudes(dependencias) {
  ({ refrescar } = dependencias);
}

const hora = (fechaHora) => fechaHora?.slice(11, 16) ?? '';
const nombreSala = (id) => espacios.find((e) => e.id === id)?.nombre ?? id;

/** Se redibuja con cada carga de datos (suscrito al estado). */
export function dibujarSolicitudes(estado) {
  espacios = estado.espacios;
  const solicitudes = estado.solicitudes ?? [];
  avisarCambios(solicitudes);

  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente');
  const contador = document.getElementById('contador-solicitudes');
  const cuantas = puede('decidirSolicitudes') ? pendientes.length : 0;
  contador.textContent = String(cuantas);
  contador.hidden = cuantas === 0;

  const lista = document.getElementById('lista-solicitudes');
  if (!solicitudes.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, puede('decidirSolicitudes')
      ? 'No hay solicitudes. Cuando alguien pida un salón ocupado, aparece aquí.'
      : 'No tienes solicitudes. Si un salón está reservado pero nadie lo usa, en Reservar aparece "Solicitar este salón".'));
    return;
  }
  // Pendientes primero; dentro de cada grupo, las más nuevas arriba (así llegan del servidor)
  const ordenadas = [...pendientes, ...solicitudes.filter((s) => s.estado !== 'pendiente')];
  lista.replaceChildren(...ordenadas.map(item));
}

function item(s) {
  const original = s.reservaOriginal;
  const yo = sesionActual()?.usuario;
  const quien = s.solicitante === yo ? 'Tú pides' : `${s.responsable} pide`;
  return el('li', { className: 'item' },
    el('div', { className: 'item__cabeza' },
      el('span', { className: 'item__titulo' }, `${quien} ${nombreSala(s.espacioId)} hasta las ${hora(s.fin)}`),
      el('span', { className: `etiqueta ${CLASE_ESTADO[s.estado] ?? ''}` }, ESTADOS[s.estado] ?? s.estado)),
    el('span', { className: 'item__meta' }, [
      `${s.asistentes} asistentes`,
      original ? `Reservado por ${original.responsable} (${hora(original.inicio)}–${hora(original.fin)})` : null,
      `Pedido a las ${hora(s.fecha)}`,
    ].filter(Boolean).join(' · ')),
    el('p', { className: 'item__texto' }, `"${s.motivo}"`),
    s.estado !== 'pendiente'
      ? el('span', { className: 'item__meta' }, `${ESTADOS[s.estado]} a las ${hora(s.fechaDecision)}${s.notaDecision ? `: ${s.notaDecision}` : ''}`)
      : null,
    s.estado === 'pendiente' && puede('decidirSolicitudes') ? accionesAdmin(s) : null);
}

function accionesAdmin(s) {
  const nota = el('input', { type: 'text', className: 'solicitud__nota', maxLength: 300, placeholder: 'Nota para quien la pidió (opcional)', 'aria-label': 'Nota' });
  const decidir = (decision) => async (e) => {
    try {
      await conCarga(e.currentTarget, decision === 'aprobar' ? 'Aprobando…' : 'Rechazando…', () =>
        pedir(`/api/solicitudes/${encodeURIComponent(s.id)}`, { metodo: 'PATCH', cuerpo: { decision, nota: nota.value.trim() } }));
      toasts.exito(decision === 'aprobar'
        ? `Aprobada: ${nombreSala(s.espacioId)} es de ${s.responsable} hasta las ${hora(s.fin)}. La reserva anterior terminó ahora.`
        : `Rechazada la solicitud de ${s.responsable}.`);
      await refrescar();
    } catch (error) {
      toasts.error(error);
    }
  };
  return el('div', { className: 'solicitud__decision' }, nota,
    el('div', { className: 'item__acciones' },
      el('button', { type: 'button', className: 'btn btn--primario btn--chico', onClick: decidir('aprobar') }, 'Aprobar'),
      el('button', { type: 'button', className: 'btn btn--peligro btn--chico', onClick: decidir('rechazar') }, 'Rechazar')));
}

// Toasts de lo que cambió desde la última carga, solo para quien le interesa.
function avisarCambios(solicitudes) {
  const yo = sesionActual()?.usuario;
  const primeraVez = vistas === null;
  const anteriores = vistas ?? new Map();
  vistas = new Map(solicitudes.map((s) => [s.id, s.estado]));
  if (primeraVez) return;

  for (const s of solicitudes) {
    const antes = anteriores.get(s.id);
    if (antes === s.estado) continue;
    const sala = nombreSala(s.espacioId);
    if (antes === undefined && s.estado === 'pendiente') {
      if (puede('decidirSolicitudes') && s.solicitante !== yo) toasts.aviso(`Nueva solicitud: ${s.responsable} pide ${sala} hasta las ${hora(s.fin)}. Revísala en Solicitudes.`);
      else if (s.afectado === yo) toasts.aviso(`${s.responsable} pidió ${sala}, que tienes reservado ahora. Si lo estás usando, avísale a un admin.`);
    } else if (s.estado === 'aprobada') {
      if (s.solicitante === yo) toasts.aviso(`Te asignaron ${sala}: es tuyo hasta las ${hora(s.fin)}.`);
      else if (s.afectado === yo) toasts.aviso(`Tu reserva de ${sala} terminó a las ${hora(s.fechaDecision)}: un admin se lo asignó a ${s.responsable}.`);
    } else if (s.estado === 'rechazada' && s.solicitante === yo) {
      toasts.aviso(`Tu solicitud de ${sala} fue rechazada${s.notaDecision ? `: ${s.notaDecision}` : '.'}`);
    }
  }
}
