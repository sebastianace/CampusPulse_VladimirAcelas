// Barra de comando (Ctrl+K): pedir una sala o hacerle una pregunta a Pulse.
//   texto -> POST /api/ia/asistente -> la IA decide la intención:
//     - "reservar": entiende {asistentes, inicio, fin}, las reglas del backend filtran las salas y la IA
//       solo explica las opciones. "Reservar" vuelve a pasar por POST /api/reservas: las reglas deciden otra vez.
//     - "preguntar": Pulse responde con base en los documentos del campus (RAG) y muestra sus fuentes.
//       Si los documentos no tienen la respuesta, lo dice en vez de inventar.
//   Las preguntas se recuerdan mientras el diálogo siga abierto (memoria corta de la conversación).

import { pedir, esFallaDeIA, TIEMPO_LIMITE_PREGUNTAS_MS } from './api.js';
import { el, conCarga } from './dom.js';
import { cambiarFecha, hoyISO, obtenerEstado } from './estado.js';
import * as toasts from './toasts.js';
import { avisoLlegada } from './formularios.js';
import { agregarDictado, crearBotonEscuchar, detenerLectura } from './voz.js';
import { textoDeRecomendacion } from './voz-texto.js';

let mostrarPestana = () => {};

// Conversación de preguntas: [{pregunta, respuesta: {respondido, respuesta, fragmentos, ...}}]. Se borra al cerrar.
let turnos = [];
const MAX_MENSAJES_ENVIADOS = 6; // el servidor también se queda con los últimos 6

const dialogo = () => document.getElementById('comando');
const resultado = () => document.getElementById('resultado-comando');

export function iniciarComando(opciones) {
  mostrarPestana = opciones.mostrarPestana;
  document.getElementById('form-comando').addEventListener('submit', enviar);
  dialogo().addEventListener('close', () => { detenerLectura(); nuevaConversacion(); });
  // Dictado por voz en la barra: escribe en el campo y la persona pulsa Enviar (si el navegador no lo soporta, no aparece).
  const campo = document.querySelector('#form-comando input[name="texto"]');
  agregarDictado(campo, campo);
}

function nuevaConversacion() {
  turnos = [];
  resultado().replaceChildren();
}

// Los turnos como mensajes para el servidor: lo que la persona preguntó y lo que Pulse respondió.
function historialParaEnviar() {
  return turnos
    .flatMap((t) => [{ rol: 'usuario', texto: t.pregunta }, { rol: 'pulse', texto: t.respuesta.respuesta }])
    .slice(-MAX_MENSAJES_ENVIADOS);
}

// ---------- 1. Enviar el mensaje ----------

async function enviar(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const texto = form.texto.value.trim();
  if (!texto) {
    form.texto.focus();
    return;
  }

  detenerLectura();
  const boton = form.querySelector('button[type="submit"]');
  const aviso = el('p', { className: 'nota', role: 'status' }, 'Pulse está pensando…');
  if (turnos.length) resultado().append(aviso);
  else resultado().replaceChildren(aviso);
  try {
    const cuerpo = { texto, historial: historialParaEnviar() };
    const respuesta = await conCarga(boton, 'Pensando…', () => pedir('/api/ia/asistente', { metodo: 'POST', cuerpo, tiempoMs: TIEMPO_LIMITE_PREGUNTAS_MS }));
    if (respuesta.intencion === 'reservar') {
      turnos = []; // una reserva no es parte de la conversación de preguntas
      dibujarRecomendacion(respuesta);
    } else {
      turnos.push({ pregunta: texto, respuesta });
      dibujarConversacion();
      form.reset();
    }
  } catch (error) {
    dibujarError(error);
  }
}

// ---------- 2a. Mostrar la conversación de preguntas ----------

function dibujarConversacion() {
  resultado().replaceChildren(
    ...turnos.map((turno, i) => crearTurno(turno, i === turnos.length - 1)),
    el('button', { type: 'button', className: 'enlace', onClick: nuevaConversacion }, 'Empezar una conversación nueva'),
  );
  const filas = resultado().querySelectorAll('.turno');
  filas[filas.length - 1]?.scrollIntoView({ block: 'nearest' });
}

function crearTurno({ pregunta, respuesta }, esElUltimo) {
  const { respondido, fragmentos = [], modelo } = respuesta;
  const usados = fragmentos.filter((f) => f.usado);
  return el('div', { className: 'turno' },
    el('p', { className: 'turno__pregunta' }, pregunta),
    el('div', { className: `tarjeta-ia${respondido ? '' : ' tarjeta-ia--sin-respuesta'}` },
      el('p', { className: 'sello-ia' }, respondido ? 'Respuesta de Pulse' : 'Pulse no encontró la respuesta',
        el('span', { className: 'sello-ia__modelo' }, modelo ? ` · ${modelo}` : '')),
      el('p', { className: 'razon-ia' }, respuesta.respuesta),
      crearBotonEscuchar(() => respuesta.respuesta),
      usados.some((f) => f.ejemplo)
        ? el('p', { className: 'nota' }, 'Basada en documentos de ejemplo del proyecto, no en un reglamento oficial.') : null,
      crearFuentes(fragmentos, respondido, esElUltimo)));
}

// "Ver fuentes": qué fragmentos se le dieron a Pulse y en cuáles se apoyó. También se muestra cuando no supo
// responder, para que se vea que sí buscó y qué encontró.
function crearFuentes(fragmentos, respondido, abierto) {
  if (!fragmentos.length) return null;
  const usados = fragmentos.filter((f) => f.usado).length;
  const titulo = respondido
    ? `Ver fuentes (${usados} ${usados === 1 ? 'usada' : 'usadas'} de ${fragmentos.length} consultadas)`
    : `Ver lo que consultó (${fragmentos.length} fragmentos)`;
  return el('details', { className: 'fuentes', open: abierto && !respondido },
    el('summary', {}, titulo),
    el('ol', { className: 'fuentes__lista' }, fragmentos.map((f) => el('li', { className: `fuente${f.usado ? ' fuente--usada' : ''}` },
      el('p', { className: 'fuente__titulo' },
        el('strong', {}, `${f.documento} › ${f.seccion}`),
        el('span', { className: `etiqueta ${f.usado ? 'etiqueta--ia' : ''}` }, f.usado ? 'usada' : 'consultada'),
        f.ejemplo ? el('span', { className: 'etiqueta' }, 'ejemplo') : null),
      el('p', { className: 'fuente__texto' }, f.texto),
      el('p', { className: 'nota' },
        `Parecido con la pregunta: ${Math.round(f.similitud * 100)} %`,
        typeof f.puntaje === 'number' ? ` · relevancia ${f.puntaje}/10` : '')))));
}

// ---------- 2b. Mostrar lo que entendió la IA y las opciones (reserva) ----------

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
      el('p', { className: 'razon-ia' }, explicacion),
      crearBotonEscuchar(() => textoDeRecomendacion({ explicacion, opciones }, nombreDeEspacio))) : '', // '' y no null: replaceChildren pintaría "null"

    opciones.length ? el('label', { className: 'campo' }, el('span', {}, 'Responsable de la reserva'), responsable) : '',

    opciones.length
      ? el('ol', { className: 'lista opciones' },
        opciones.map((opcion, i) => crearOpcion(opcion, i, solicitud, responsable)))
      : el('p', { className: 'vacio' }, 'Prueba con otro horario o menos personas.'),
  );

  responsable.focus();
}

const nombreDeEspacio = (id) => obtenerEstado().espacios.find((e) => e.id === id)?.nombre ?? id;

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
      : el('p', { className: 'nota' }, error.codigo === 'SOLICITUD_INCOMPLETA'
        ? 'Reescribe el pedido con cuántas personas, qué día y de qué hora a qué hora.'
        : 'Revisa el mensaje e inténtalo de nuevo.'),
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
