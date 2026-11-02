// Línea de tiempo del día: una fila por sala y un bloque por reserva
// (GET /api/reservas?fecha=YYYY-MM-DD). Clic en una franja libre
// prellena el formulario de reserva con esa sala, fecha y hora; clic en
// un bloque abre esa reserva para editarla o cancelarla.

import { el } from './dom.js';
import { ahoraBogota, cambiarFecha, hoyISO } from './estado.js';
import * as toasts from './toasts.js';

// Rango visible del día. Coincide con el horario del campus que valida
// el backend (HORA_APERTURA y HORA_CIERRE en src/config/reglas.js).
const HORA_INICIO_VISTA = 7;
const HORA_FIN_VISTA = 21;
const MINUTOS_VISTA = (HORA_FIN_VISTA - HORA_INICIO_VISTA) * 60;
const PASO_ETIQUETAS = 2; // una etiqueta de hora cada 2 h (las líneas siguen cada hora)

export function iniciarTimeline() {
  const selector = document.getElementById('fecha-timeline');
  selector.addEventListener('change', async () => {
    if (!selector.value) return;
    const { errores } = await cambiarFecha(selector.value);
    if (errores.length) toasts.error(errores[0]);
  });
  document.getElementById('btn-hoy').addEventListener('click', () => {
    selector.value = hoyISO();
    selector.dispatchEvent(new Event('change'));
  });
}

export function dibujarTimeline({ espacios, reservas, fecha }) {
  document.getElementById('fecha-timeline').value = fecha;
  const contenedor = document.getElementById('timeline');
  contenedor.style.setProperty('--horas', HORA_FIN_VISTA - HORA_INICIO_VISTA);

  if (!espacios.length) {
    contenedor.replaceChildren(el('p', { className: 'vacio' }, 'No hay espacios para mostrar.'));
    return;
  }

  const delDia = reservas.filter((r) => r.inicio?.startsWith(fecha));
  const salas = [...espacios].sort((a, b) => (b.aforo ?? 0) - (a.aforo ?? 0));

  const filas = salas.map((espacio) => crearFila(espacio, delDia.filter((r) => r.espacioId === espacio.id), fecha));
  const nota = delDia.length
    ? []
    : [el('p', { className: 'nota timeline__nota' }, 'No hay reservas este día. Haz clic en una franja libre para reservar.')];

  contenedor.replaceChildren(crearEscalaHoras(), ...filas, ...nota);
}

// Fila de etiquetas: 7:00, 9:00 … 21:00
function crearEscalaHoras() {
  const horas = [];
  for (let h = HORA_INICIO_VISTA; h <= HORA_FIN_VISTA; h += PASO_ETIQUETAS) {
    horas.push(el('span', { style: { left: `${porcentaje(h * 60)}%` } }, `${h}:00`));
  }
  return el('div', { className: 'timeline__fila timeline__fila--escala', 'aria-hidden': 'true' },
    el('span'),
    el('div', { className: 'timeline__horas' }, horas));
}

function crearFila(espacio, reservasSala, fecha) {
  const inhabilitada = espacio.estado === 'inhabilitado';
  const noAsignable = espacio.estado !== 'disponible';

  const pista = el('div', {
    className: 'timeline__pista',
    title: noAsignable ? `${espacio.nombre}: no disponible para reservar` : `Clic para reservar ${espacio.nombre}`,
    onClick: (evento) => {
      if (evento.target !== pista || espacio.estado === 'inconsistente') return;
      seleccionarFranja(espacio, fecha, evento, pista);
    },
  },
  reservasSala.map((reserva) => crearBloque(reserva, espacio, inhabilitada)),
  lineaAhora(fecha));

  return el('div', {
    className: `timeline__fila${inhabilitada ? ' timeline__fila--inhabilitado' : ''}`,
    dataset: { asignable: noAsignable ? 'no' : 'si' },
  },
    el('span', { className: 'timeline__sala' },
      espacio.nombre,
      el('small', { className: 'dato' }, Number.isFinite(espacio.aforo) ? ` ${espacio.aforo}` : '')),
    pista);
}

function crearBloque(reserva, espacio, enRiesgo) {
  const inicio = minutosDelDia(reserva.inicio);
  const fin = minutosDelDia(reserva.fin);
  const izquierda = porcentaje(inicio);
  const ancho = Math.max(porcentaje(fin) - izquierda, 0.5);
  const horario = `${reserva.inicio.slice(11, 16)}–${reserva.fin.slice(11, 16)}`;
  const ocupacion = Number.isFinite(espacio.aforo) ? `${reserva.asistentes}/${espacio.aforo}` : `${reserva.asistentes}`;

  return el('div', {
    className: 'bloque',
    dataset: { riesgo: enRiesgo ? 'si' : 'no' },
    style: { left: `${izquierda}%`, width: `${ancho}%` },
    title: `${espacio.nombre} · ${horario}\n${reserva.responsable} · ${reserva.asistentes} asistentes${enRiesgo ? '\nEn riesgo: la sala está inhabilitada' : ''}\nClic para editar o cancelar`,
    // Clic en el bloque -> el formulario de reserva pasa a modo edición
    onClick: () => document.dispatchEvent(new CustomEvent('reserva-seleccionada', { detail: reserva })),
  }, `${reserva.responsable} · ${ocupacion}`);
}

// Línea vertical en la hora actual (solo si se está viendo el día de hoy)
function lineaAhora(fecha) {
  const ahora = ahoraBogota();
  if (!ahora.startsWith(fecha)) return null;
  const minutos = minutosDelDia(ahora);
  if (minutos < HORA_INICIO_VISTA * 60 || minutos > HORA_FIN_VISTA * 60) return null;
  return el('span', { className: 'ahora', style: { left: `${porcentaje(minutos)}%` }, 'aria-hidden': 'true' });
}

// Convierte el punto del clic en una hora en punto y avisa al formulario de reserva
function seleccionarFranja(espacio, fecha, evento, pista) {
  const { left, width } = pista.getBoundingClientRect();
  const minutos = HORA_INICIO_VISTA * 60 + ((evento.clientX - left) / width) * MINUTOS_VISTA;
  const hora = Math.min(Math.floor(minutos / 60), HORA_FIN_VISTA - 1);
  document.dispatchEvent(new CustomEvent('espacio-seleccionado', {
    detail: { ...espacio, fecha, horaInicio: dosDigitos(hora), horaFin: dosDigitos(hora + 1) },
  }));
}

const dosDigitos = (hora) => `${String(hora).padStart(2, '0')}:00`;

// "2026-10-16T14:30" -> 870
function minutosDelDia(fechaHora) {
  const [h, m] = fechaHora.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

// Posición horizontal (0–100 %) de un minuto del día dentro del rango visible
function porcentaje(minutos) {
  const relativo = (minutos - HORA_INICIO_VISTA * 60) / MINUTOS_VISTA;
  return Math.min(Math.max(relativo, 0), 1) * 100;
}
