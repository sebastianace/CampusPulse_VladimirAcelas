// =====================================================================
// DOMINIO: INCIDENCIAS
// ---------------------------------------------------------------------
// Al crear una incidencia, algo queda fuera de servicio si:
//   - el reporte trae inhabilitar: true (o inhabilitarEspacio: true), o
//   - su prioridad está en REGLAS.PRIORIDADES_QUE_INHABILITAN.
// Qué queda fuera de servicio: LO MÁS ESPECÍFICO.
//   - Si hay equipo afectado, solo el equipo: un video beam dañado no
//     impide dar clase en la sala.
//   - La sala completa solo si se pide (inhabilitarEspacio: true, por
//     ejemplo agua cerca de los enchufes) o si no hay equipo afectado.
// Espacio inhabilitado -> estado "inhabilitado" (no se puede reservar).
// Recurso inhabilitado -> REGLAS.ESTADO_RECURSO_INHABILITADO.
// Al resolverla se rehabilita exactamente lo que se apagó, salvo que otra
// incidencia abierta lo siga inhabilitando.
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

/**
 * Qué queda fuera de servicio: {espacio, recurso} (true o false cada uno).
 * Lo más específico: el equipo si lo hay; la sala solo si se pide o si no hay equipo.
 */
export function queInhabilitar({ inhabilitar, inhabilitarEspacio, prioridad, espacioId, recursoId }) {
  const pideSala = inhabilitarEspacio === true;
  if (!debeInhabilitar(inhabilitar === true || pideSala, prioridad)) return { espacio: false, recurso: false };
  return {
    recurso: Boolean(recursoId),
    espacio: Boolean(espacioId) && (pideSala || !recursoId),
  };
}

// Cambia el estado del espacio y del recurso indicados (null = no tocarlo).
// Un espacio "inconsistente" no se toca: su problema es de datos, no de una incidencia.
function aplicarEstado(db, { espacioId, recursoId }, estadoEspacio, estadoRecurso) {
  const espacio = db.espacios.find((e) => e.id === espacioId);
  if (espacio && espacio.estado !== 'inconsistente') espacio.estado = estadoEspacio;
  const recurso = db.recursos.find((r) => r.id === recursoId);
  if (recurso) recurso.estado = estadoRecurso;
}

// ¿Esta incidencia dejó fuera de servicio la sala? ¿Y el equipo?
const apagoEspacio = (i) => i.inhabilitoEspacio === true && i.espacioId !== null;
const apagoRecurso = (i) => i.inhabilito === true && i.recursoId !== null;

// true si otra incidencia abierta mantiene fuera de servicio la misma sala (o el mismo equipo).
function sigueInhabilitado(db, incidencia, apago, campo) {
  return db.incidencias.some((otra) =>
    otra.id !== incidencia.id && otra.estado === 'abierta' && apago(otra) && otra[campo] === incidencia[campo]);
}

// ---------- funciones públicas ----------

/** Crea la incidencia y, si corresponde, deja fuera de servicio el equipo o la sala (ver queInhabilitar). */
export function crearIncidencia(db, datos) {
  const limpia = validarDatosIncidencia(db, datos);
  const apagar = queInhabilitar({ ...limpia, inhabilitar: datos.inhabilitar, inhabilitarEspacio: datos.inhabilitarEspacio });
  const incidencia = {
    id: `inc-${randomUUID().slice(0, 8)}`, ...limpia, estado: 'abierta',
    inhabilito: apagar.espacio || apagar.recurso, inhabilitoEspacio: apagar.espacio, fecha: ahoraBogota(),
  };

  aplicarEstado(db, {
    espacioId: apagar.espacio ? limpia.espacioId : null,
    recursoId: apagar.recurso ? limpia.recursoId : null,
  }, 'inhabilitado', REGLAS.ESTADO_RECURSO_INHABILITADO);
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
  // Solo se rehabilita lo que esta incidencia apagó y que ninguna otra abierta mantiene apagado.
  aplicarEstado(db, {
    espacioId: apagoEspacio(incidencia) && !sigueInhabilitado(db, incidencia, apagoEspacio, 'espacioId') ? incidencia.espacioId : null,
    recursoId: apagoRecurso(incidencia) && !sigueInhabilitado(db, incidencia, apagoRecurso, 'recursoId') ? incidencia.recursoId : null,
  }, 'disponible', 'disponible');
  return incidencia;
}
