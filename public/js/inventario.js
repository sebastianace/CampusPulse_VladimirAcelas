// Pestaña "Inventario" (admin y soporte técnico): la lista de trabajo de TI.
// Solo muestra los equipos dañados o en reparación (PATCH /api/recursos/:id);
// los disponibles no necesitan nada y alargaban la pantalla sin aportar.
// Un equipo se daña al reportar una incidencia (pestaña Reportar).
// Los botones de cada equipo salen de cambiosPermitidos (lo calcula el
// servidor con TRANSICIONES_RECURSO), así nunca se ofrece un cambio prohibido.

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { ESTADOS_RECURSO, etiqueta } from './catalogos.js';
import { puede } from './sesion.js';
import * as toasts from './toasts.js';

let refrescar = async () => {};
let mostrarPestana = () => {};

// Texto del botón que lleva un equipo a cada estado.
const ACCION_RECURSO = {
  disponible: 'Marcar disponible',
  en_reparacion: 'Enviar a reparación',
  danado: 'Marcar dañado',
};

// Color de la etiqueta de estado.
const CLASE_ESTADO = { danado: 'etiqueta--critica', en_reparacion: 'etiqueta--alta' };

// Estados que aparecen en la lista: los que necesitan a Soporte TI. Primero los dañados.
const PENDIENTES = ['danado', 'en_reparacion'];

export function iniciarInventario(dependencias) {
  if (!puede('gestionarInventario')) return; // la pestaña sigue oculta
  ({ refrescar, mostrarPestana } = dependencias);
  document.getElementById('p-inventario').hidden = false;
}

/** Se redibuja con cada carga de datos (suscrito al estado). */
export function dibujarInventario({ espacios, recursos, incidencias }) {
  if (!puede('gestionarInventario')) return;
  const nombreSala = (id) => espacios.find((e) => e.id === id)?.nombre;
  const abiertas = incidencias.filter((i) => i.estado === 'abierta');

  const equipos = recursos
    .filter((r) => PENDIENTES.includes(r.estado))
    .sort((a, b) => PENDIENTES.indexOf(a.estado) - PENDIENTES.indexOf(b.estado));
  const lista = document.getElementById('lista-inventario-equipos');
  if (!equipos.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, 'No hay equipos dañados ni en reparación. Todo está funcionando.'));
    return;
  }
  lista.replaceChildren(...equipos.map((recurso) => {
    const bloqueo = abiertas.find((i) => i.inhabilito && i.recursoId === recurso.id);
    const acciones = recurso.estado === 'prestado'
      ? [el('span', { className: 'item__meta' }, 'Prestado: se devuelve en la pestaña Prestar.')]
      : bloqueo ? [botonIncidencia()]
        : (recurso.cambiosPermitidos ?? []).map((estado) => el('button', {
          type: 'button', className: `btn btn--chico ${estado === 'danado' ? 'btn--peligro' : 'btn--secundario'}`,
          onClick: (e) => cambiar(`/api/recursos/${encodeURIComponent(recurso.id)}`, estado, recurso.nombre, ESTADOS_RECURSO, e.currentTarget),
        }, ACCION_RECURSO[estado] ?? etiqueta(ESTADOS_RECURSO, estado)));
    return item(recurso.nombre, etiqueta(ESTADOS_RECURSO, recurso.estado), recurso.estado,
      recurso.espacioId ? `En ${nombreSala(recurso.espacioId) ?? recurso.espacioId}` : 'Para préstamo', bloqueo, acciones);
  }));
}

function item(titulo, textoEstado, estado, meta, bloqueo, acciones) {
  return el('li', { className: 'item' },
    el('div', { className: 'item__cabeza' },
      el('span', { className: 'item__titulo' }, titulo),
      el('span', { className: `etiqueta ${CLASE_ESTADO[estado] ?? ''}` }, textoEstado)),
    el('span', { className: 'item__meta' }, meta),
    bloqueo && el('span', { className: 'item__meta' }, `Fuera de servicio por la incidencia: "${bloqueo.descripcion}"`),
    el('div', { className: 'item__acciones' }, acciones));
}

function botonIncidencia() {
  return el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => mostrarPestana('p-incidencias') },
    'Ver la incidencia');
}

async function cambiar(ruta, estado, nombre, catalogo, boton) {
  try {
    await conCarga(boton, 'Guardando…', () => pedir(ruta, { metodo: 'PATCH', cuerpo: { estado } }));
    toasts.exito(`${nombre} quedó ${etiqueta(catalogo, estado).toLowerCase()}.`);
    await refrescar();
  } catch (error) {
    toasts.error(error);
  }
}
