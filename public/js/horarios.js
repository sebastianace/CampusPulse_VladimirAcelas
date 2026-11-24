// Panel "Horario de clases": las clases fijas del campus (Software, Inglés y SER) como una grilla de
// salas (filas) por horas (columnas), un día de la semana a la vez. Es solo lectura: los horarios se
// cargan desde la terminal (npm run importar-horarios) y GET /api/horarios los entrega.
// Solo se dibujan los bloques con días confirmados, que son los mismos que bloquean reservas en el
// servidor (409 SALA_CON_CLASE): lo que se ve aquí es lo que de verdad cierra una sala.
// El admin ve además los hallazgos de planeación (GET /api/horarios/hallazgos).
// También exporta clasesDelDia() para que la línea de tiempo de reservas muestre las clases de su día.

import { pedir } from './api.js';
import { soloReservables } from './catalogos.js';
import { el } from './dom.js';
import { hoyISO } from './estado.js';
import { puede } from './sesion.js';

export const ETIQUETAS_CLASE = { software: 'Software', ingles: 'Inglés', ser: 'SER' };
const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Rango de la grilla: las clases arrancan a las 6:00 y la última termina cerca de las 22:00
const HORA_INICIO_VISTA = 6;
const HORA_FIN_VISTA = 22;
const MINUTOS_VISTA = (HORA_FIN_VISTA - HORA_INICIO_VISTA) * 60;
const PASO_ETIQUETAS = 2;

// ---------- funciones compartidas (también las usa timeline.js) ----------

/** "2026-11-24" -> 1..7 (1 = lunes), igual que los días de un bloque. Se calcula a mediodía para esquivar husos horarios. */
export function diaDeLaSemana(fecha) {
  const d = new Date(`${fecha}T12:00:00`).getDay();
  return d === 0 ? 7 : d;
}

/** Los bloques con clase ese día. Un bloque sin días confirmados (dias null) no cuenta: tampoco bloquea reservas. */
export const clasesDelDia = (horarios, fecha) => {
  const dia = diaDeLaSemana(fecha);
  return horarios.filter((b) => b.dias?.includes(dia));
};

/** [1,2,3,4,5] -> "lunes a viernes"; [1,3,5] -> "lunes, miércoles, viernes". */
export function describirDias(dias) {
  if (!dias?.length) return 'días sin confirmar';
  const orden = [...dias].sort((a, b) => a - b);
  const seguidos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1);
  if (orden.length > 2 && seguidos) return `${NOMBRES_DIA[orden[0]]} a ${NOMBRES_DIA[orden.at(-1)]}`;
  return orden.map((d) => NOMBRES_DIA[d]).join(', ');
}

export const textoHorario = (b) => `${b.horaInicio}–${b.horaFin}`;

// ---------- estado del panel ----------

let dia = 1;              // día que se está viendo (1 = lunes)
let tipo = 'todos';       // filtro de clase
let seleccionado = null;  // id del bloque cuyo detalle se muestra
let ultimo = null;        // último estado dibujado, para redibujar al cambiar el día o el filtro
let huellaHorarios = '';  // para pedir los hallazgos solo cuando cambian los horarios

export function iniciarHorarios() {
  const hoy = diaDeLaSemana(hoyISO());
  dia = hoy <= 6 ? hoy : 1; // el domingo no hay clases: se abre en lunes

  const botones = document.getElementById('horarios-dias');
  for (let d = 1; d <= 6; d++) {
    botones.append(el('button', {
      type: 'button', className: 'dias__btn', dataset: { dia: String(d) }, title: NOMBRES_DIA[d],
      onClick: () => { dia = d; if (ultimo) dibujarHorarios(ultimo); },
    }, DIAS_CORTOS[d]));
  }
  document.getElementById('horarios-tipo').addEventListener('change', (evento) => {
    tipo = evento.target.value;
    if (ultimo) dibujarHorarios(ultimo);
  });
}

/** Se redibuja con cada carga de datos (suscrito al estado) y al cambiar el día o el filtro. */
export function dibujarHorarios(estado) {
  ultimo = estado;
  const { espacios, horarios } = estado;
  const grilla = document.getElementById('horarios-grilla');

  document.querySelectorAll('#horarios-dias .dias__btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.dia) === dia));
  });

  const sinDias = horarios.filter((b) => !b.dias).length;
  document.getElementById('horarios-nota').textContent = horarios.length
    ? `${horarios.length} bloques de clase${sinDias ? ` · ${sinDias} sin días confirmados (no se muestran ni cierran la sala)` : ''}`
    : 'Software, Inglés y SER.';

  if (!horarios.length) {
    grilla.replaceChildren(el('p', { className: 'vacio' }, puede('verHallazgosHorarios')
      ? 'Todavía no hay horarios cargados. Se cargan con npm run importar-horarios (guía en docs/horarios.md).'
      : 'Todavía no hay horarios cargados.'));
    dibujarDetalle(null, espacios);
    pedirHallazgos(horarios);
    return;
  }

  // Las filas son las salas que alguna vez tienen clase (no cambian al cambiar de día), de mayor a menor aforo
  const salas = soloReservables(espacios)
    .filter((e) => horarios.some((b) => b.espacioId === e.id))
    .sort((a, b) => (b.aforo ?? 0) - (a.aforo ?? 0));
  const delDia = horarios.filter((b) => b.dias?.includes(dia) && (tipo === 'todos' || b.tipo === tipo));

  grilla.style.setProperty('--horas', HORA_FIN_VISTA - HORA_INICIO_VISTA);
  grilla.replaceChildren(
    crearEscala(),
    ...salas.map((sala) => crearFila(sala, delDia.filter((b) => b.espacioId === sala.id))),
    ...(delDia.length ? [] : [el('p', { className: 'nota timeline__nota' }, `No hay clases de ${tipo === 'todos' ? '' : `${ETIQUETAS_CLASE[tipo]} `}el ${NOMBRES_DIA[dia]}.`)]),
  );
  dibujarDetalle(horarios.find((b) => b.id === seleccionado), espacios);
  pedirHallazgos(horarios);
}

function crearEscala() {
  const horas = [];
  for (let h = HORA_INICIO_VISTA; h <= HORA_FIN_VISTA; h += PASO_ETIQUETAS) {
    horas.push(el('span', { style: { left: `${porcentaje(h * 60)}%` } }, `${h}:00`));
  }
  return el('div', { className: 'timeline__fila timeline__fila--escala', 'aria-hidden': 'true' },
    el('span'),
    el('div', { className: 'timeline__horas' }, horas));
}

function crearFila(sala, bloques) {
  return el('div', { className: 'timeline__fila' },
    el('span', { className: 'timeline__sala' },
      sala.nombre,
      el('small', { className: 'dato' }, Number.isFinite(sala.aforo) ? ` ${sala.aforo}` : '')),
    el('div', { className: 'timeline__pista timeline__pista--clases' }, bloques.map(crearBloque)));
}

function crearBloque(bloque) {
  const izquierda = porcentaje(minutos(bloque.horaInicio));
  const ancho = Math.max(porcentaje(minutos(bloque.horaFin)) - izquierda, 0.5);
  return el('button', {
    type: 'button',
    className: 'bloque bloque--clase',
    dataset: { tipo: bloque.tipo },
    style: { left: `${izquierda}%`, width: `${ancho}%` },
    'aria-pressed': String(bloque.id === seleccionado),
    title: `${ETIQUETAS_CLASE[bloque.tipo]} · ${bloque.grupo}\n${textoHorario(bloque)}\nClic para ver el detalle`,
    onClick: () => {
      seleccionado = seleccionado === bloque.id ? null : bloque.id;
      if (ultimo) dibujarHorarios(ultimo);
    },
  }, etiquetaDelBloque(bloque));
}

/** Un bloque de una hora no cabe con "Grupo 12" ni "J2 Abr-26": ahí va "G12" o "J2" (el nombre completo sigue en el tooltip y el detalle). */
export function etiquetaDelBloque(bloque) {
  if (minutos(bloque.horaFin) - minutos(bloque.horaInicio) >= 90) return bloque.grupo;
  const ingles = bloque.grupo.match(/^grupo\s+(\d+)/i);
  if (ingles) return `G${ingles[1]}`;
  return bloque.grupo.match(/^[A-Za-z]\d/)?.[0] ?? bloque.grupo;
}

function dibujarDetalle(bloque, espacios) {
  const caja = document.getElementById('horarios-detalle');
  if (!bloque) {
    caja.hidden = true;
    caja.replaceChildren();
    return;
  }
  const sala = espacios.find((e) => e.id === bloque.espacioId)?.nombre ?? bloque.espacioId;
  const datos = [
    bloque.docente && `Docente: ${bloque.docente}`,
    bloque.estudiantes != null && `${bloque.estudiantes} estudiantes`,
    bloque.nivel && `Nivel: ${bloque.nivel}`,
    bloque.modulo && `Módulo: ${bloque.modulo}`,
  ].filter(Boolean);
  caja.hidden = false;
  // replaceChildren convierte un null o un false suelto en el texto "null": se filtran antes
  caja.replaceChildren(...[
    el('div', { className: 'item__cabeza' },
      el('span', { className: 'item__titulo' }, bloque.grupo),
      el('span', { className: 'etiqueta', dataset: { tipo: bloque.tipo } }, ETIQUETAS_CLASE[bloque.tipo])),
    el('span', { className: 'item__meta' }, `${sala} · ${textoHorario(bloque)} · ${describirDias(bloque.dias)}`),
    datos.length > 0 && el('span', { className: 'item__meta' }, datos.join(' · ')),
    bloque.observacion && el('span', { className: 'item__meta' }, `Observación: ${bloque.observacion}`),
  ].filter(Boolean));
}

// ---------- hallazgos de planeación (solo admin) ----------

async function pedirHallazgos(horarios) {
  const caja = document.getElementById('horarios-hallazgos');
  if (!puede('verHallazgosHorarios')) return;
  const huella = JSON.stringify(horarios);
  if (huella === huellaHorarios) return;
  huellaHorarios = huella;
  try {
    dibujarHallazgos(caja, await pedir('/api/horarios/hallazgos'));
  } catch {
    huellaHorarios = ''; // se vuelve a intentar en la próxima carga
  }
}

function dibujarHallazgos(caja, hallazgos) {
  caja.hidden = hallazgos.length === 0;
  const grupos = [...new Set(hallazgos.map((h) => h.titulo))];
  caja.replaceChildren(
    el('summary', {}, `Para revisar con Coordinación (${hallazgos.length})`),
    el('p', { className: 'nota' }, 'No impiden que los horarios funcionen: son datos que conviene confirmar.'),
    ...grupos.map((titulo) => el('div', { className: 'hallazgos__grupo' },
      el('h3', { className: 'subtitulo' }, titulo),
      el('ul', { className: 'hallazgos__lista' }, hallazgos.filter((h) => h.titulo === titulo).map((h) => el('li', {}, h.mensaje))))));
}

// ---------- utilidades ----------

// "06:00" -> 360
function minutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function porcentaje(min) {
  const relativo = (min - HORA_INICIO_VISTA * 60) / MINUTOS_VISTA;
  return Math.min(Math.max(relativo, 0), 1) * 100;
}
