// =====================================================================
// DOMINIO: INDICADORES DE SOPORTE TI (tiempo de atención)
// ---------------------------------------------------------------------
// Responde con números la pregunta de la dirección: "¿qué tan rápido
// responde TI cuando algo se daña?". Se calcula con lo que ya se guarda en
// cada incidencia, sin tablas nuevas:
//   fecha            -> cuándo la reportaron
//   fechaAtencion    -> cuándo alguien de TI la tomó ("en atención")
//   fechaResolucion  -> cuándo la resolvieron
// Definiciones:
//   - Tiempo de atención: del reporte a la primera respuesta de TI. La primera
//     respuesta es "en atención"; si la resolvieron sin tomarla antes, es la
//     resolución (TI respondió resolviéndola).
//   - Tiempo de resolución: del reporte a la resolución.
//   - Se usa la MEDIANA y no el promedio: con pocas incidencias, una sola que
//     se quedó un fin de semana dispararía el promedio y escondería cómo
//     trabaja TI normalmente. El promedio se entrega también, como referencia.
//   - Ventana: las incidencias REPORTADAS en los últimos DIAS_VENTANA días.
// =====================================================================

import { ahoraBogota, minutosEntre } from './fechas.js';

export const DIAS_VENTANA = 7;
const PRIORIDADES = ['critica', 'alta', 'media', 'baja'];

// "YYYY-MM-DDTHH:mm" de hace n días a la misma hora.
function haceDias(ahora, dias) {
  const f = new Date(`${ahora}:00Z`);
  f.setUTCDate(f.getUTCDate() - dias);
  return f.toISOString().slice(0, 16);
}

function mediana(valores) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return Math.round(orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2);
}

/** {casos, medianaMin, promedioMin} de una lista de minutos (null si no hay casos). */
function resumir(minutos) {
  return {
    casos: minutos.length,
    medianaMin: mediana(minutos),
    promedioMin: minutos.length ? Math.round(minutos.reduce((s, m) => s + m, 0) / minutos.length) : null,
  };
}

/** Minutos del reporte a la primera respuesta de TI, o null si todavía nadie respondió. */
export function minutosHastaAtencion(incidencia) {
  const respuesta = incidencia.fechaAtencion ?? incidencia.fechaResolucion;
  return respuesta ? Math.max(0, minutosEntre(incidencia.fecha, respuesta)) : null;
}

/** Minutos del reporte a la resolución, o null si sigue abierta. */
export function minutosHastaResolucion(incidencia) {
  return incidencia.fechaResolucion ? Math.max(0, minutosEntre(incidencia.fecha, incidencia.fechaResolucion)) : null;
}

function medir(incidencias) {
  const valores = (fn) => incidencias.map(fn).filter((m) => m !== null);
  return { reportadas: incidencias.length, atencion: resumir(valores(minutosHastaAtencion)), resolucion: resumir(valores(minutosHastaResolucion)) };
}

/**
 * Indicadores de TI. ahora ("YYYY-MM-DDTHH:mm", hora de Bogotá) se recibe para poder probarlo a cualquier hora.
 * Devuelve:
 *   { ventanaDias, desde,
 *     ventana: {reportadas, resueltas, atencion, resolucion},          (atencion/resolucion = {casos, medianaMin, promedioMin})
 *     porPrioridad: [{prioridad, reportadas, atencion, resolucion}],   (solo las prioridades con incidencias en la ventana)
 *     historico: {reportadas, atencion, resolucion},
 *     abiertas, sinAtender,
 *     masAntiguaSinAtender: {id, descripcion, prioridad, minutosEsperando} | null }
 */
export function indicadoresTI(incidencias, ahora = ahoraBogota()) {
  const desde = haceDias(ahora, DIAS_VENTANA);
  const enVentana = incidencias.filter((i) => i.fecha >= desde);
  const abiertas = incidencias.filter((i) => i.estado === 'abierta');
  const sinAtender = abiertas.filter((i) => !i.atendidaPor).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const masAntigua = sinAtender[0];

  return {
    ventanaDias: DIAS_VENTANA,
    desde,
    ventana: { ...medir(enVentana), resueltas: enVentana.filter((i) => i.estado === 'resuelta').length },
    porPrioridad: PRIORIDADES
      .map((prioridad) => ({ prioridad, ...medir(enVentana.filter((i) => i.prioridad === prioridad)) }))
      .filter((p) => p.reportadas > 0),
    historico: medir(incidencias),
    abiertas: abiertas.length,
    sinAtender: sinAtender.length,
    masAntiguaSinAtender: masAntigua
      ? { id: masAntigua.id, descripcion: masAntigua.descripcion, prioridad: masAntigua.prioridad, minutosEsperando: Math.max(0, minutosEntre(masAntigua.fecha, ahora)) }
      : null,
  };
}
