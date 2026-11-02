// Panel "Datos": reporte de calidad del CSV oficial (GET /api/calidad-datos)
// y botón para volver al estado inicial (POST /api/restaurar).

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { obtenerEstado } from './estado.js';
import * as toasts from './toasts.js';

let refrescar = async () => {};

export function iniciarCalidad(opciones) {
  refrescar = opciones.refrescar;
  document.getElementById('btn-restaurar').addEventListener('click', pedirConfirmacion);
  // Recargar el reporte cada vez que se abre la pestaña
  document.getElementById('p-datos').addEventListener('click', cargarCalidad);
}

export async function cargarCalidad() {
  const panel = document.getElementById('calidad-datos');
  try {
    dibujarCalidad(await pedir('/api/calidad-datos'));
  } catch (error) {
    panel.replaceChildren(el('p', { className: 'aviso', role: 'alert' }, `No se pudo cargar el reporte de calidad: ${error.message}`));
  }
}

function dibujarCalidad({ cargados = 0, validos = 0, inconsistentes = [] }) {
  const panel = document.getElementById('calidad-datos');
  const enGris = obtenerEstado().espacios.filter((e) => e.estado === 'inconsistente');

  panel.replaceChildren(
    el('p', { className: 'nota calidad__fuente' }, 'Fuente: archivo oficial de espacios de Campuslands. Nunca se modifica; la app trabaja sobre una copia.'),
    el('div', { className: 'metricas' },
      metrica(cargados, 'Registros leídos'),
      metrica(validos, 'Válidos'),
      metrica(inconsistentes.length, 'Con problemas', inconsistentes.length > 0)),
    inconsistentes.length
      ? tablaInconsistentes(inconsistentes)
      : el('p', { className: 'vacio' }, 'Todos los registros del archivo oficial son válidos.'),
    enGris.length
      ? el('p', { className: 'nota' },
        `En el plano aparecen en gris y no se pueden reservar: ${enGris.map((e) => e.nombre).join(', ')}.`)
      : '', // replaceChildren pintaría "null" como texto
  );
}

function metrica(valor, nombre, alerta = false) {
  return el('div', { className: `metrica${alerta ? ' metrica--alerta' : ''}` },
    el('div', { className: 'metrica__valor' }, String(valor)),
    el('div', { className: 'metrica__nombre' }, nombre));
}

function tablaInconsistentes(inconsistentes) {
  return el('table', { className: 'tabla' },
    el('caption', { className: 'tabla__titulo' }, 'Registros que no se cargaron como válidos'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Fila'), el('th', { scope: 'col' }, 'Motivo'))),
    el('tbody', {}, inconsistentes.map(({ fila, motivo }) =>
      el('tr', {}, el('td', { className: 'dato' }, fila ? String(fila) : '—'), el('td', {}, motivo)))));
}

// ---------- Restaurar (pide confirmación en el mismo lugar) ----------

function pedirConfirmacion() {
  const boton = document.getElementById('btn-restaurar');
  boton.hidden = true;

  const confirmacion = el('div', { className: 'confirmacion', role: 'group', 'aria-label': 'Confirmar restauración' },
    el('p', {}, 'Se borrarán todas las reservas, préstamos e incidencias y los espacios y equipos volverán a su estado inicial.'),
    el('div', { className: 'item__acciones' },
      el('button', { type: 'button', className: 'btn btn--peligro', onClick: (e) => restaurar(e.currentTarget, confirmacion) }, 'Sí, restaurar datos'),
      el('button', { type: 'button', className: 'btn btn--secundario', onClick: () => cerrarConfirmacion(confirmacion) }, 'Cancelar')));

  boton.after(confirmacion);
  confirmacion.querySelector('button').focus();
}

function cerrarConfirmacion(confirmacion) {
  confirmacion.remove();
  const boton = document.getElementById('btn-restaurar');
  boton.hidden = false;
  boton.focus();
}

async function restaurar(boton, confirmacion) {
  try {
    const respuesta = await conCarga(boton, 'Restaurando…', () => pedir('/api/restaurar', { metodo: 'POST' }));
    toasts.exito(respuesta?.mensaje ?? 'Datos restaurados al estado inicial.');
    cerrarConfirmacion(confirmacion);
    await refrescar();
    if (respuesta?.calidadDatos) dibujarCalidad(respuesta.calidadDatos);
    else await cargarCalidad();
  } catch (error) {
    toasts.error(error);
  }
}
