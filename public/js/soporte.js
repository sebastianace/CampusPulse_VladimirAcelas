// Pestaña "Soporte TI" (soporte técnico y admin): el tablero de trabajo de TI.
// Todo daño reportado en el campus llega aquí (toda incidencia va a Soporte TI):
//   - las incidencias abiertas, de la más urgente a la menos, y dentro de cada
//     prioridad primero las que nadie ha tomado y las más viejas;
//   - cuánto llevan esperando y quién las está atendiendo;
//   - un resumen del inventario fuera de servicio, con acceso a Inventario.
// Para soporte técnico es la pestaña con la que abre la app. Con cada recarga
// (cada 5 s) avisa con un toast cuando llega una incidencia nueva.

import { el } from './dom.js';
import { PRIORIDADES, etiqueta } from './catalogos.js';
import { ahoraBogota } from './estado.js';
import { crearItemIncidencia } from './incidencias.js';
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

/** Se redibuja con cada carga de datos (suscrito al estado). */
export function dibujarSoporte({ incidencias, recursos, espacios }) {
  if (!puede('resolverIncidencias')) return;
  const abiertas = incidencias.filter((i) => i.estado === 'abierta');
  avisarNuevas(abiertas);

  const sinAtender = abiertas.filter((i) => !i.atendidaPor);
  const contador = document.getElementById('contador-soporte');
  contador.textContent = String(sinAtender.length);
  contador.hidden = sinAtender.length === 0;

  const equiposFuera = recursos.filter((r) => r.estado === 'danado' || r.estado === 'en_reparacion').length;
  const salasFuera = espacios.filter((e) => e.estado === 'inhabilitado').length;
  const criticas = abiertas.filter((i) => i.prioridad === 'critica').length;
  document.getElementById('resumen-soporte').replaceChildren(
    el('p', { className: 'item__meta' }, [
      `${abiertas.length} abierta${abiertas.length === 1 ? '' : 's'}`,
      `${sinAtender.length} sin atender`,
      criticas ? `${criticas} crítica${criticas === 1 ? '' : 's'}` : null,
      `${equiposFuera} equipo${equiposFuera === 1 ? '' : 's'} fuera de servicio`,
      `${salasFuera} sala${salasFuera === 1 ? '' : 's'} inhabilitada${salasFuera === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')),
    puede('gestionarInventario')
      ? el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => mostrarPestana('p-inventario') }, 'Ver inventario')
      : null);

  const lista = document.getElementById('lista-soporte');
  if (!abiertas.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, 'No hay incidencias abiertas. Cuando alguien reporte un daño, aparece aquí.'));
    return;
  }
  const ahora = ahoraBogota();
  const ordenadas = [...abiertas].sort((a, b) =>
    (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9)
    || Boolean(a.atendidaPor) - Boolean(b.atendidaPor)
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
    if (!anteriores.has(i.id)) toasts.aviso(`Nueva incidencia (${etiqueta(PRIORIDADES, i.prioridad).toLowerCase()}): "${i.descripcion}". Está en Soporte TI.`);
  }
}
