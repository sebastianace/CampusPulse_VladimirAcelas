// Pestaña "Soporte TI" (soporte técnico y admin): el tablero de trabajo de TI.
// Todo daño reportado en el campus llega aquí (toda incidencia va a Soporte TI):
//   - las incidencias abiertas, de la más urgente a la menos, y dentro de cada
//     prioridad primero las que nadie ha tomado y las más viejas;
//   - cuánto llevan esperando, a quién le tocó (reparto por categoría) y quién las está atendiendo;
//   - un resumen del inventario fuera de servicio, con acceso a Inventario;
//   - el tiempo de respuesta de TI de los últimos 7 días (mediana de cuánto tarda
//     en tomar una incidencia y en resolverla, por prioridad), calculado por el
//     servidor en GET /api/incidencias/indicadores (src/domain/indicadores.js).
// Para soporte técnico es la pestaña con la que abre la app. Con cada recarga
// (cada 5 s) avisa con un toast cuando llega una incidencia nueva.

import { pedir } from './api.js';
import { el } from './dom.js';
import { PRIORIDADES, etiqueta } from './catalogos.js';
import { ahoraBogota } from './estado.js';
import { crearItemIncidencia, hayReasignacionAbierta } from './incidencias.js';
import { puede, sesionActual } from './sesion.js';
import * as toasts from './toasts.js';

let mostrarPestana = () => {};
const ORDEN_PRIORIDAD = { critica: 0, alta: 1, media: 2, baja: 3 };
let vistas = null; // ids de incidencias ya vistas; null antes de la primera carga (no se avisa de lo viejo)

export function iniciarSoporte(dependencias) {
  if (!puede('resolverIncidencias')) return; // la pestaña sigue oculta
  ({ mostrarPestana } = dependencias);
  document.getElementById('p-soporte').hidden = false;
  if (sesionActual()?.rol === 'soporte_tecnico') mostrarPestana('p-soporte');
}

// Minutos entre dos fechas "YYYY-MM-DDTHH:mm" (las dos en hora de Bogotá).
function minutosEntre(desde, hasta) {
  const ms = (f) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10), +f.slice(11, 13), +f.slice(14, 16));
  return Math.max(0, Math.round((ms(hasta) - ms(desde)) / 60000));
}

function espera(minutos) {
  if (minutos < 1) return 'recién reportada';
  if (minutos < 60) return `esperando ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `esperando ${horas} h ${minutos % 60} min`;
  return `esperando ${Math.floor(horas / 24)} día${horas >= 48 ? 's' : ''}`;
}

/** "12 min", "2 h 5 min", "1 d 3 h"; "—" si no hay datos. */
export function duracion(minutos) {
  if (minutos === null || minutos === undefined) return '—';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
  return horas % 24 ? `${Math.floor(horas / 24)} d ${horas % 24} h` : `${Math.floor(horas / 24)} d`;
}

// Pide los indicadores al servidor y los dibuja. Se llama solo cuando cambian los datos (no cada 5 s).
async function dibujarIndicadores() {
  const cuerpo = document.getElementById('cuerpo-indicadores');
  let ind;
  try {
    ind = await pedir('/api/incidencias/indicadores');
  } catch {
    cuerpo.replaceChildren(el('p', { className: 'nota' }, 'No se pudieron calcular los tiempos ahora; se reintenta con la próxima actualización.'));
    return;
  }
  const { ventana } = ind;
  if (!ventana.reportadas) {
    cuerpo.replaceChildren(el('p', { className: 'nota' }, `No hay incidencias reportadas en los últimos ${ind.ventanaDias} días.`));
    return;
  }
  const cifra = (valor, texto) => el('div', { className: 'cifra' },
    el('span', { className: 'cifra__valor dato' }, duracion(valor)), el('span', { className: 'cifra__etiqueta' }, texto));
  const fila = (p) => el('tr', {},
    el('td', {}, etiqueta(PRIORIDADES, p.prioridad)),
    el('td', { className: 'dato' }, duracion(p.atencion.medianaMin)),
    el('td', { className: 'dato' }, duracion(p.resolucion.medianaMin)),
    el('td', { className: 'dato' }, String(p.reportadas)));
  const vieja = ind.masAntiguaSinAtender;
  cuerpo.replaceChildren(
    el('div', { className: 'indicadores__cifras' },
      cifra(ventana.atencion.medianaMin, 'en tomar una incidencia'),
      cifra(ventana.resolucion.medianaMin, 'en resolverla')),
    el('table', { className: 'indicadores__tabla' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Prioridad'), el('th', { scope: 'col', className: 'num' }, 'Tomarla'),
        el('th', { scope: 'col', className: 'num' }, 'Resolverla'), el('th', { scope: 'col', className: 'num' }, 'Casos'))),
      el('tbody', {}, ind.porPrioridad.map(fila))),
    el('p', { className: 'nota' },
      `Últimos ${ind.ventanaDias} días: ${ventana.reportadas} reportada${ventana.reportadas === 1 ? '' : 's'}, ${ventana.resueltas} resuelta${ventana.resueltas === 1 ? '' : 's'}. `
      + 'Mediana: lo que tarda TI normalmente (una incidencia olvidada no la dispara). '
      + `Promedio: ${duracion(ventana.atencion.promedioMin)} en tomarla y ${duracion(ventana.resolucion.promedioMin)} en resolverla.`),
    vieja ? el('p', { className: 'nota indicadores__alerta' },
      `Lleva más esperando sin que nadie la tome: "${vieja.descripcion}" (${etiqueta(PRIORIDADES, vieja.prioridad).toLowerCase()}), ${duracion(vieja.minutosEsperando)}.`) : null);
}

/** Se redibuja con cada carga de datos (suscrito al estado). */
export function dibujarSoporte({ incidencias, recursos, espacios }) {
  if (!puede('resolverIncidencias')) return;
  const abiertas = incidencias.filter((i) => i.estado === 'abierta');
  avisarNuevas(abiertas);
  dibujarIndicadores();

  const sinAtender = abiertas.filter((i) => !i.atendidaPor);
  const contador = document.getElementById('contador-soporte');
  contador.textContent = String(sinAtender.length);
  contador.hidden = sinAtender.length === 0;

  const equiposFuera = recursos.filter((r) => r.estado === 'danado' || r.estado === 'en_reparacion').length;
  const salasFuera = espacios.filter((e) => e.estado === 'inhabilitado').length;
  const paraMi = sinAtender.filter((i) => i.asignadaA === sesionActual()?.usuario).length;
  const criticas = abiertas.filter((i) => i.prioridad === 'critica').length;
  document.getElementById('resumen-soporte').replaceChildren(
    el('p', { className: 'item__meta' }, [
      `${abiertas.length} abierta${abiertas.length === 1 ? '' : 's'}`,
      `${sinAtender.length} sin atender`,
      paraMi ? `${paraMi} para ti` : null,
      criticas ? `${criticas} crítica${criticas === 1 ? '' : 's'}` : null,
      `${equiposFuera} equipo${equiposFuera === 1 ? '' : 's'} fuera de servicio`,
      `${salasFuera} sala${salasFuera === 1 ? '' : 's'} inhabilitada${salasFuera === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')),
    puede('gestionarInventario')
      ? el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => mostrarPestana('p-inventario') }, 'Ver inventario')
      : null);

  const lista = document.getElementById('lista-soporte');
  if (hayReasignacionAbierta()) return; // no borrar el selector de "Reasignar" que alguien está usando
  if (!abiertas.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, 'No hay incidencias abiertas. Cuando alguien reporte un daño, aparece aquí.'));
    return;
  }
  const ahora = ahoraBogota();
  const yo = sesionActual()?.usuario;
  const ordenadas = [...abiertas].sort((a, b) =>
    (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9)
    || Boolean(a.atendidaPor) - Boolean(b.atendidaPor)
    || (b.asignadaA === yo) - (a.asignadaA === yo) // dentro de lo no atendido, primero lo que me tocó
    || String(a.fecha).localeCompare(String(b.fecha)));
  lista.replaceChildren(...ordenadas.map((i) =>
    crearItemIncidencia(i, el('span', { className: 'item__meta' }, espera(minutosEntre(i.fecha, ahora))))));
}

function avisarNuevas(abiertas) {
  const primeraVez = vistas === null;
  const anteriores = vistas ?? new Set();
  vistas = new Set(abiertas.map((i) => i.id));
  if (primeraVez) return;
  for (const i of abiertas) {
    if (anteriores.has(i.id)) continue;
    const mia = i.asignadaA && i.asignadaA === sesionActual()?.usuario;
    // Si le tocó a otra persona se avisa igual (todo el equipo debe saberlo), pero se distingue la que es tuya
    toasts.aviso(`${mia ? 'Te tocó una incidencia' : 'Nueva incidencia'} (${etiqueta(PRIORIDADES, i.prioridad).toLowerCase()}): "${i.descripcion}". Está en Soporte TI.`);
  }
}
