// ⚡ Modo Demo Jurado: atajos que SOLO llenan los formularios con los casos
// del guion de la demo. Quien presenta pulsa el botón de enviar: la IA y
// las reglas del backend se ejecutan de verdad en cada caso.
// Se abre con el botón ⚡ o con Alt+D.

import { el } from './dom.js';
import { hoyISO, obtenerEstado } from './estado.js';
import * as toasts from './toasts.js';

let mostrarPestana = () => {};

// Días en que el campus permite reservar (0 = domingo). Debe coincidir con
// DIAS_HABILES de src/config/reglas.js; solo se usa para elegir la fecha de la demo.
const DIAS_HABILES_DEMO = [1, 2, 3, 4, 5, 6];
const NOMBRES_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const CASOS = [
  {
    titulo: 'Reserva válida',
    esperado: 'Se acepta',
    llenar: () => llenarReserva('Cosmos', { responsable: 'Maria Fernanda Cala', asistentes: 20, desde: '09:00', hasta: '11:00' }),
  },
  {
    titulo: 'Misma sala, misma franja',
    esperado: 'Se rechaza por solapamiento',
    llenar: () => llenarReserva('Cosmos', { responsable: 'Karen Celis', asistentes: 15, desde: '10:00', hasta: '12:00' }),
  },
  {
    titulo: 'Más personas que el aforo',
    esperado: 'Se rechaza por aforo',
    llenar: () => llenarReserva('Skilab', { responsable: 'Alexandra Villamizar', asistentes: 40, desde: '14:00', hasta: '16:00' }),
  },
  {
    titulo: 'Incidencia con IA',
    esperado: 'La IA la clasifica y la sala se pone roja',
    llenar: () => llenarIncidencia('El video beam de Apolo no prende y huele a quemado'),
  },
  {
    titulo: 'Reservar la sala inhabilitada',
    esperado: 'Se rechaza: la sala está fuera de servicio',
    llenar: () => llenarReserva('Apolo', { responsable: 'Dani Mendoza', asistentes: 20, desde: '16:00', hasta: '18:00' }),
  },
  {
    titulo: 'Prestar un equipo dañado',
    esperado: 'Se rechaza: el equipo no está disponible',
    llenar: llenarPrestamoDanado,
  },
  {
    titulo: 'Pedir sala con IA (Ctrl+K)',
    esperado: 'Recomienda la sala de mejor ajuste',
    llenar: () => llenarComando(`Necesito un salón para 30 personas ${textoDia(proximoDiaHabil())} de 2 a 4 pm`),
  },
];

export function iniciarDemo(opciones) {
  mostrarPestana = opciones.mostrarPestana;
  const panel = document.getElementById('panel-demo');
  const boton = document.getElementById('btn-demo');

  panel.append(
    el('p', { className: 'panel-demo__titulo' }, 'Casos de la demo'),
    el('p', { className: 'nota' }, 'Cada caso solo llena el formulario. Tú lo envías.'),
    el('ol', { className: 'panel-demo__lista' }, CASOS.map((caso) =>
      el('li', {},
        el('button', { type: 'button', className: 'panel-demo__caso', onClick: () => usarCaso(caso) },
          el('span', { className: 'panel-demo__nombre' }, caso.titulo),
          el('span', { className: 'panel-demo__esperado' }, caso.esperado))))),
  );

  boton.addEventListener('click', () => alternarPanel());
  document.addEventListener('keydown', (evento) => {
    if (evento.altKey && evento.key.toLowerCase() === 'd') {
      evento.preventDefault();
      alternarPanel();
    } else if (evento.key === 'Escape' && !panel.hidden) {
      alternarPanel(false);
      boton.focus();
    }
  });
}

function alternarPanel(abrir) {
  const panel = document.getElementById('panel-demo');
  const boton = document.getElementById('btn-demo');
  const mostrar = abrir ?? panel.hidden;
  panel.hidden = !mostrar;
  boton.setAttribute('aria-expanded', String(mostrar));
}

function usarCaso(caso) {
  alternarPanel(false);
  try {
    caso.llenar();
  } catch (error) {
    toasts.error(error.message);
  }
}

// ---------- Llenado de formularios ----------

function llenarReserva(nombreSala, { responsable, asistentes, desde, hasta }) {
  const espacio = buscarEspacio(nombreSala);
  const form = document.getElementById('form-reserva');
  mostrarPestana('p-reservar');
  form.espacioId.value = espacio.id;
  form.responsable.value = responsable;
  form.asistentes.value = String(asistentes);
  form.fecha.value = proximoDiaHabil();
  form.horaInicio.value = desde;
  form.horaFin.value = hasta;
  form.dispatchEvent(new Event('input')); // limpia avisos anteriores
  enfocarEnvio(form);
}

function llenarIncidencia(texto) {
  const form = document.getElementById('form-triaje');
  mostrarPestana('p-reportar');
  form.descripcion.value = texto;
  enfocarEnvio(form);
}

// Toma un equipo que la API reporte como dañado (no un ID escrito a mano)
function llenarPrestamoDanado() {
  // Se prefiere un equipo para llevar (sin sala): es el caso típico de préstamo
  const fuera = obtenerEstado().recursos.filter((r) => r.estado === 'danado' || r.estado === 'en_reparacion');
  const equipo = fuera.find((r) => !r.espacioId) ?? fuera[0];
  if (!equipo) throw new Error('No hay equipos dañados en este momento. Devuelve uno "con daño" para probar este caso.');
  const form = document.getElementById('form-prestamo');
  mostrarPestana('p-prestar');
  form.recursoId.value = equipo.id;
  form.persona.value = 'Valentina Ortiz';
  form.dispatchEvent(new Event('input'));
  enfocarEnvio(form);
}

function llenarComando(texto) {
  document.getElementById('abrir-comando').click();
  const form = document.getElementById('form-comando');
  form.texto.value = texto;
  form.querySelector('button[type="submit"]').focus();
}

// Lleva el formulario a la vista y deja el foco en su botón: basta con Enter
function enfocarEnvio(form) {
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  form.querySelector('button[type="submit"]').focus({ preventScroll: true });
}

function buscarEspacio(nombre) {
  const buscado = nombre.toLowerCase();
  const espacio = obtenerEstado().espacios.find((e) => [e.nombre, e.nombreApi].some((n) => n?.toLowerCase() === buscado));
  if (!espacio) throw new Error(`No se encontró el espacio ${nombre} en los datos cargados.`);
  return espacio;
}

// ---------- Fechas ----------

// Primer día hábil desde mañana (YYYY-MM-DD, hora de Bogotá)
function proximoDiaHabil() {
  for (let dias = 1; dias <= 7; dias += 1) {
    const fecha = hoyISO(new Date(Date.now() + dias * 24 * 60 * 60 * 1000));
    if (DIAS_HABILES_DEMO.includes(diaSemana(fecha))) return fecha;
  }
  return hoyISO();
}

function diaSemana(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

// "mañana" si el día hábil es mañana; si no, "el lunes", "el martes"…
function textoDia(fecha) {
  const manana = hoyISO(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return fecha === manana ? 'mañana' : `el ${NOMBRES_DIAS[diaSemana(fecha)]}`;
}
