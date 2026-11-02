// =====================================================================
// DOMINIO: INCIDENCIAS
// ---------------------------------------------------------------------
// Al crear una incidencia, el espacio o recurso afectado se inhabilita si:
//   - el reporte trae inhabilitar: true, o
//   - su prioridad está en REGLAS.PRIORIDADES_QUE_INHABILITAN.
// Espacio inhabilitado -> estado "inhabilitado" (no se puede reservar).
// Recurso inhabilitado -> REGLAS.ESTADO_RECURSO_INHABILITADO.
// Al resolverla se rehabilita, salvo que otra incidencia abierta lo
// siga inhabilitando.
// =====================================================================

import { randomUUID } from 'node:crypto';
import { AREAS, CATEGORIAS, ORIGENES_INCIDENCIA, PRIORIDADES, REGLAS } from '../config/reglas.js';
import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from './errors.js';
import { ahoraBogota } from './fechas.js';

// ---------- validación de datos (422 / 404) ----------

// Lanza 422 si el valor no está en la lista de valores cerrados.
function exigirValor(lista, valor, campo) {
  if (!lista.includes(valor)) {
    throw new DatosInvalidosError(`${campo} debe ser uno de: ${lista.join(', ')}`);
  }
}

// Devuelve el ID si existe en la colección, null si no se envió, o lanza 404.
function idOpcional(coleccion, id, nombre) {
  if (id === undefined || id === null || id === '') return null;
  if (!coleccion.some((elemento) => elemento.id === id)) {
    throw new NoEncontradoError(`No existe el ${nombre} "${id}"`);
  }
  return id;
}

/** Revisa el cuerpo de POST /api/incidencias y lo devuelve limpio. */
function validarDatosIncidencia(db, datos) {
  const descripcion = String(datos?.descripcion ?? '').trim();
  if (descripcion === '') throw new DatosInvalidosError('Falta la descripción de la incidencia');
  exigirValor(CATEGORIAS, datos.categoria, 'La categoría');
  exigirValor(PRIORIDADES, datos.prioridad, 'La prioridad');
  exigirValor(AREAS, datos.area, 'El área');
  const origen = datos.origen ?? 'manual';
  exigirValor(ORIGENES_INCIDENCIA, origen, 'El origen');
  return {
    descripcion,
    categoria: datos.categoria,
    prioridad: datos.prioridad,
    area: datos.area,
    espacioId: idOpcional(db.espacios, datos.espacioId, 'espacio'),
    recursoId: idOpcional(db.recursos, datos.recursoId, 'recurso'),
    origen,
    ia: typeof datos.ia === 'object' ? datos.ia : null, // lo que sugirió la IA (razon, modelo...), o null
  };
}

// ---------- inhabilitar y rehabilitar ----------

/** true si la incidencia debe dejar fuera de servicio lo afectado. */
export function debeInhabilitar(inhabilitar, prioridad) {
  return inhabilitar === true || REGLAS.PRIORIDADES_QUE_INHABILITAN.includes(prioridad);
}

// Cambia el estado del espacio y del recurso afectados.
// Un espacio "inconsistente" no se toca: su problema es de datos, no de una incidencia.
function aplicarEstado(db, { espacioId, recursoId }, estadoEspacio, estadoRecurso) {
  const espacio = db.espacios.find((e) => e.id === espacioId);
  if (espacio && espacio.estado !== 'inconsistente') espacio.estado = estadoEspacio;
  const recurso = db.recursos.find((r) => r.id === recursoId);
  if (recurso) recurso.estado = estadoRecurso;
}

// true si otra incidencia abierta mantiene inhabilitado el mismo espacio o recurso.
function sigueInhabilitado(db, incidencia, campo) {
  return incidencia[campo] !== null && db.incidencias.some((otra) =>
    otra.id !== incidencia.id && otra.estado === 'abierta' && otra.inhabilito && otra[campo] === incidencia[campo]);
}

// ---------- funciones públicas ----------

/** Crea la incidencia y, si corresponde, inhabilita el espacio o recurso. */
export function crearIncidencia(db, datos) {
  const limpia = validarDatosIncidencia(db, datos);
  const inhabilito = debeInhabilitar(datos.inhabilitar, limpia.prioridad) && Boolean(limpia.espacioId || limpia.recursoId);
  const incidencia = { id: `inc-${randomUUID().slice(0, 8)}`, ...limpia, estado: 'abierta', inhabilito, fecha: ahoraBogota() };

  if (inhabilito) aplicarEstado(db, incidencia, 'inhabilitado', REGLAS.ESTADO_RECURSO_INHABILITADO);
  db.incidencias.push(incidencia);
  return incidencia;
}

/** Marca la incidencia como resuelta ({estado: "resuelta"}) y rehabilita lo afectado. */
export function resolverIncidencia(db, incidenciaId, datos) {
  if (datos?.estado !== 'resuelta') throw new DatosInvalidosError('El único cambio permitido es {estado: "resuelta"}');
  const incidencia = db.incidencias.find((i) => i.id === incidenciaId);
  if (!incidencia) throw new NoEncontradoError(`No existe la incidencia "${incidenciaId}"`);
  if (incidencia.estado === 'resuelta') throw new ReglaNegocioError('INCIDENCIA_YA_RESUELTA', 'Esta incidencia ya estaba resuelta');

  incidencia.estado = 'resuelta';
  incidencia.fechaResolucion = ahoraBogota();
  if (incidencia.inhabilito) {
    aplicarEstado(db, {
      espacioId: sigueInhabilitado(db, incidencia, 'espacioId') ? null : incidencia.espacioId,
      recursoId: sigueInhabilitado(db, incidencia, 'recursoId') ? null : incidencia.recursoId,
    }, 'disponible', 'disponible');
  }
  return incidencia;
}
