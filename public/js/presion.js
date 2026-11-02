// Termómetro "Presión del campus" (0–100 %), calculado en el navegador
// con los mismos datos de la API que ya muestra el tablero.
//
//   presión = PESO_SALAS   × % de salas ocupadas ahora o inhabilitadas
//           + PESO_EQUIPOS × % de equipos prestados, dañados o en reparación
//           + PUNTOS_POR_CRITICA × incidencias críticas abiertas
//           + PUNTOS_POR_ALTA    × incidencias altas abiertas
//   (con tope en 100)
//
// Es un indicador visual: no bloquea nada. Las reglas las aplica el backend.

import { el } from './dom.js';

const PESO_SALAS = 0.4;
const PESO_EQUIPOS = 0.3;
const PUNTOS_POR_CRITICA = 20;
const PUNTOS_POR_ALTA = 8;

const UMBRAL_MEDIA = 40; // desde aquí la barra se pone ámbar
const UMBRAL_ALTA = 70;  // desde aquí, roja: "Campus bajo presión alta"

/** Devuelve el valor total y el desglose de cada componente. */
export function calcularPresion({ espacios, recursos, incidencias }) {
  // Las salas con datos inconsistentes no cuentan: no forman parte de la operación
  const salas = espacios.filter((e) => e.estado !== 'inconsistente');
  const salasPresionadas = salas.filter((e) => e.estado === 'inhabilitado' || e.ocupadoAhora).length;
  const equiposFuera = recursos.filter((r) => r.estado !== 'disponible').length;
  const abiertas = incidencias.filter((i) => i.estado !== 'resuelta');
  const criticas = abiertas.filter((i) => i.prioridad === 'critica').length;
  const altas = abiertas.filter((i) => i.prioridad === 'alta').length;

  const pctSalas = salas.length ? (salasPresionadas / salas.length) * 100 : 0;
  const pctEquipos = recursos.length ? (equiposFuera / recursos.length) * 100 : 0;
  const puntosIncidencias = criticas * PUNTOS_POR_CRITICA + altas * PUNTOS_POR_ALTA;

  const total = Math.min(100, Math.round(PESO_SALAS * pctSalas + PESO_EQUIPOS * pctEquipos + puntosIncidencias));
  return {
    total,
    nivel: total >= UMBRAL_ALTA ? 'alta' : total >= UMBRAL_MEDIA ? 'media' : 'baja',
    desglose: { salasPresionadas, salas: salas.length, equiposFuera, equipos: recursos.length, criticas, altas },
  };
}

const TEXTO_NIVEL = {
  baja: 'Presión del campus',
  media: 'Campus bajo presión media',
  alta: 'Campus bajo presión alta',
};

export function dibujarPresion(estado) {
  if (!estado.espacios.length) return;
  const { total, nivel, desglose: d } = calcularPresion(estado);

  const contenedor = document.getElementById('presion');
  contenedor.hidden = false;
  contenedor.dataset.nivel = nivel;
  contenedor.title = [
    `Salas ocupadas o inhabilitadas: ${d.salasPresionadas} de ${d.salas}`,
    `Equipos fuera de uso: ${d.equiposFuera} de ${d.equipos}`,
    `Incidencias abiertas: ${d.criticas} críticas, ${d.altas} altas`,
  ].join('\n');

  const barra = contenedor.querySelector('.presion__barra');
  barra.setAttribute('aria-valuenow', String(total));
  barra.setAttribute('aria-valuetext', `${total} %, ${TEXTO_NIVEL[nivel].toLowerCase()}`);

  document.getElementById('presion-relleno').style.width = `${total}%`;
  document.getElementById('presion-valor').textContent = `${total} %`;
  document.getElementById('presion-etiqueta').textContent = TEXTO_NIVEL[nivel];
  document.body.dataset.presion = nivel;

  dibujarDesglose(d);
}

// Línea corta bajo la barra con los números que explican el valor
function dibujarDesglose(d) {
  document.getElementById('presion-desglose').replaceChildren(
    el('span', {}, `${d.salasPresionadas}/${d.salas} salas`),
    el('span', {}, `${d.equiposFuera}/${d.equipos} equipos fuera`),
    el('span', {}, `${d.criticas} ${d.criticas === 1 ? 'crítica' : 'críticas'}`),
  );
}
