// Barra de comando (Ctrl+K): pedir sala en lenguaje natural.
//   texto -> POST /api/ia/recomendar -> la IA entiende {asistentes, inicio, fin},
//   las reglas del backend filtran las salas y la IA solo explica las opciones.
//   "Reservar" vuelve a pasar por POST /api/reservas: las reglas deciden otra vez.

import { pedir, esFallaDeIA } from './api.js';
import { el, conCarga } from './dom.js';
import { cambiarFecha, hoyISO, obtenerEstado } from './estado.js';
import * as toasts from './toasts.js';
import { avisoLlegada } from './formularios.js';

let mostrarPestana = () => {};

const dialogo = () => document.getElementById('comando');
const resultado = () => document.getElementById('resultado-comando');

export function iniciarComando(opciones) {
  mostrarPestana = opciones.mostrarPestana;
  document.getElementById('form-comando').addEventListener('submit', buscarSala);
}

// ---------- 1. Pedir la recomendación ----------

async function buscarSala(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const texto = form.texto.value.trim();
  if (!texto) {
    form.texto.focus();
    return;
  }

  const boton = form.querySelector('button[type="submit"]');
  resultado().replaceChildren(el('p', { className: 'nota' }, 'La IA está interpretando tu pedido y las reglas están revisando las salas…'));
  try {
    const respuesta = await conCarga(boton, 'Buscando…', () => pedir('/api/ia/recomendar', { metodo: 'POST', cuerpo: { texto } }));
    dibujarRecomendacion(respuesta);
  } catch (error) {
    dibujarError(error);
  }
}

// ---------- 2. Mostrar lo que entendió la IA y las opciones ----------

function dibujarRecomendacion({ solicitud, opciones = [], explicacion, modelo }) {
  const responsable = el('input', {
    type: 'text', name: 'responsable', autocomplete: 'off', required: true, placeholder: 'Elige o escribe un nombre',
  });
  responsable.setAttribute('list', 'lista-responsables'); // la lista está en index.html

  resultado().replaceChildren(
    el('div', { className: 'solicitud', 'aria-label': 'Lo que entendió la IA' },
      el('span', { className: 'etiqueta etiqueta--ia' }, `${solicitud.asistentes} personas`),
      el('span', { className: 'etiqueta etiqueta--ia' }, diaLegible(solicitud.inicio)),
      el('span', { className: 'etiqueta etiqueta--ia' }, `${hora(solicitud.inicio)}–${hora(solicitud.fin)}`),
      typeof solicitud.necesitaComputadores === 'boolean'
        ? el('span', { className: 'etiqueta etiqueta--ia' }, solicitud.necesitaComputadores ? 'Con computadores' : 'Sin computadores')
        : null,
      el('button', { type: 'button', className: 'enlace', onClick: () => ajustarEnFormulario(solicitud) }, 'Ajustar en el formulario')),

    explicacion ? el('div', { className: 'tarjeta-ia' },
      el('p', { className: 'sello-ia' }, 'Recomendación de la IA',
        el('span', { className: 'sello-ia__modelo' }, modelo ? ` · ${modelo}` : '')),
      el('p', { className: 'razon-ia' }, explicacion)) : '', // '' y no null: replaceChildren pintaría "null"

    opciones.length ? el('label', { className: 'campo' }, el('span', {}, 'Responsable de la reserva'), responsable) : '',

    opciones.length
      ? el('ol', { className: 'lista opciones' },
        opciones.map((opcion, i) => crearOpcion(opcion, i, solicitud, responsable)))
      : el('p', { className: 'vacio' }, 'Prueba con otro horario o menos personas.'),
  );

  responsable.focus();
}

function crearOpcion({ espacioId, motivo }, indice, solicitud, campoResponsable) {
  const espacio = obtenerEstado().espacios.find((e) => e.id === espacioId);
  const nombre = espacio?.nombre ?? espacioId;
  const aforo = Number.isFinite(espacio?.aforo) ? ` · ${espacio.aforo} puestos` : '';

  return el('li', { className: 'opcion' },
    el('div', {},
      el('p', { className: 'opcion__nombre' },
        indice === 0 ? el('span', { className: 'opcion__mejor' }, 'Mejor ajuste') : null,
        `${nombre}${aforo}`),
      el('p', { className: 'opcion__motivo' }, motivo)),
    el('button', {
      type: 'button',
      className: indice === 0 ? 'btn btn--primario' : 'btn btn--secundario',
      onClick: (e) => reservar(e.currentTarget, { espacioId, nombre, solicitud, campoResponsable }),
    }, `Reservar ${nombre}`));
}

// ---------- 3. Reservar la opción elegida ----------

async function reservar(boton, { espacioId, nombre, solicitud, campoResponsable }) {
  const responsable = campoResponsable.value.trim();
  if (!responsable) {
    campoResponsable.setAttribute('aria-invalid', 'true');
    campoResponsable.focus();
    toasts.error('Escribe a nombre de quién va la reserva.');
    return;
  }
  campoResponsable.removeAttribute('aria-invalid');

  const cuerpo = { espacioId, responsable, asistentes: solicitud.asistentes, inicio: solicitud.inicio, fin: solicitud.fin };
  try {
    const reserva = await conCarga(boton, 'Reservando…', () => pedir('/api/reservas', { metodo: 'POST', cuerpo }));
    toasts.exito(`Reserva creada: ${nombre}, ${diaLegible(solicitud.inicio)} ${hora(solicitud.inicio)}–${hora(solicitud.fin)}.${avisoLlegada(reserva)}`);
    document.dispatchEvent(new CustomEvent('reserva-creada', { detail: reserva }));
    dialogo().close();
    document.getElementById('form-comando').reset();
    resultado().replaceChildren();
    await cambiarFecha(solicitud.inicio.slice(0, 10));
  } catch (error) {
    // Las reglas pueden rechazarla (p. ej. alguien reservó la sala hace un momento)
    toasts.error(error);
  }
}

// Lleva la solicitud al formulario de reserva para corregirla a mano
function ajustarEnFormulario(solicitud) {
  const form = document.getElementById('form-reserva');
  form.asistentes.value = solicitud.asistentes ?? '';
  form.fecha.value = solicitud.inicio?.slice(0, 10) ?? '';
  form.horaInicio.value = hora(solicitud.inicio);
  form.horaFin.value = hora(solicitud.fin);
  dialogo().close();
  mostrarPestana('p-reservar');
  form.espacioId.focus();
}

// ---------- Errores ----------

function dibujarError(error) {
  const iaCaida = esFallaDeIA(error);
  resultado().replaceChildren(
    el('p', { className: 'aviso', role: 'alert' }, error.message),
    iaCaida
      ? el('button', {
        type: 'button', className: 'btn btn--secundario',
        onClick: () => { dialogo().close(); mostrarPestana('p-reservar'); document.querySelector('#form-reserva select').focus(); },
      }, 'Reservar con el formulario')
      : el('p', { className: 'nota' }, 'Reescribe el pedido con cuántas personas, qué día y de qué hora a qué hora.'),
  );
}

// ---------- Formato ----------

const hora = (fechaHora) => fechaHora?.slice(11, 16) ?? '';

// "2026-10-17T14:00" -> "viernes 17/10" (o "hoy" / "mañana")
function diaLegible(fechaHora) {
  if (!fechaHora) return '';
  const fecha = fechaHora.slice(0, 10);
  if (fecha === hoyISO()) return 'hoy';
  if (fecha === hoyISO(new Date(Date.now() + 24 * 60 * 60 * 1000))) return 'mañana';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const nombreDia = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' });
  return `${nombreDia} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}
