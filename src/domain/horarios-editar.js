// =====================================================================
// DOMINIO: AGREGAR, CAMBIAR Y QUITAR UN BLOQUE DE HORARIO
// ---------------------------------------------------------------------
// Lo que hace Coordinación (Mafe) desde la pantalla de horarios, sin pasar por la terminal. Trabaja sobre `db`
// como el resto de reglas y la ruta lo llama dentro de actualizarDB(), que pone la transacción y el bloqueo.
// Reglas:
//   1. Se valida el bloque completo con las mismas reglas del importador (clase, sala, horas, días): el CSV
//      y la pantalla no pueden guardar cosas distintas.
//   2. Los problemas de PLANEACIÓN (cruces, aforo) no impiden guardar: se ven en la lista de hallazgos. Aquí,
//      como en el importador, solo los errores de formato detienen el guardado.
//   3. Si un bloque con días queda encima de reservas futuras, se guarda y se DEVUELVEN esas reservas para que
//      la pantalla avise. No se cancelan solas: quién cede la sala es una decisión de Coordinación.
//   4. Cambiar es parcial (PATCH): lo que no viene se queda como estaba; un texto vacío quita ese dato opcional.
// =====================================================================

import { randomUUID } from 'node:crypto';
import { DatosInvalidosError, NoEncontradoError } from './errors.js';
import { TIPOS_CLASE, minutosDeHora, normalizarHora, parsearDias, reservasQueChocan } from './horarios.js';

const LIMITES = { grupo: 60, docente: 80, nivel: 60, modulo: 60, observacion: 200 };
const OPCIONALES = ['estudiantes', 'nivel', 'docente', 'modulo', 'observacion'];
const MAX_ESTUDIANTES = 1000;

/** Los días como llegan de la pantalla ([1,2,3]) o de un texto ("L-V") -> {dias: [1..7] | null} o {error}. */
function normalizarDias(valor) {
  if (valor === undefined || valor === null || valor === '') return { dias: null };
  if (typeof valor === 'string') return parsearDias(valor);
  if (!Array.isArray(valor)) return { error: 'los días deben ser una lista de números del 1 (lunes) al 7 (domingo)' };
  if (!valor.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return { error: 'los días deben ser números del 1 (lunes) al 7 (domingo)' };
  return { dias: valor.length ? [...new Set(valor)].sort((a, b) => a - b) : null };
}

/**
 * Valida y limpia los datos de un bloque completo. Devuelve el bloque (sin id) o lanza DatosInvalidosError con
 * todos los problemas juntos, para corregirlos de una vez.
 */
export function normalizarBloque(datos, espacios) {
  const errores = [];
  const tipo = TIPOS_CLASE.includes(datos.tipo) ? datos.tipo : null;
  if (!tipo) errores.push('Elige la clase: Software, Inglés o SER');

  const espacio = espacios.find((e) => e.id === datos.espacioId);
  if (!espacio) errores.push('Elige una sala que exista en el campus');

  const horaInicio = normalizarHora(datos.horaInicio);
  const horaFin = normalizarHora(datos.horaFin);
  if (!horaInicio) errores.push('La hora de inicio no sirve (usa HH:MM, por ejemplo 07:00)');
  if (!horaFin) errores.push('La hora de fin no sirve (usa HH:MM, por ejemplo 08:00)');
  if (horaInicio && horaFin && minutosDeHora(horaFin) <= minutosDeHora(horaInicio)) errores.push(`La clase termina (${horaFin}) antes o a la misma hora en que empieza (${horaInicio})`);

  const { dias, error: errorDias } = normalizarDias(datos.dias);
  if (errorDias) errores.push(`Los días no sirven: ${errorDias}`);

  const texto = (campo) => (datos[campo] === undefined || datos[campo] === null ? '' : String(datos[campo]).replace(/\s+/g, ' ').trim());
  for (const [campo, maximo] of Object.entries(LIMITES)) {
    if (texto(campo).length > maximo) errores.push(`"${campo}" es demasiado largo (máximo ${maximo} caracteres)`);
  }
  if (!texto('grupo')) errores.push('Falta el grupo o la cohorte (por ejemplo "J1 Dic-25" o "Grupo 4")');

  let estudiantes;
  if (datos.estudiantes !== undefined && datos.estudiantes !== null && datos.estudiantes !== '') {
    estudiantes = Number(datos.estudiantes);
    if (!Number.isInteger(estudiantes) || estudiantes < 0 || estudiantes > MAX_ESTUDIANTES) errores.push(`Los estudiantes deben ser un número entero entre 0 y ${MAX_ESTUDIANTES}`);
  }
  if (errores.length) throw new DatosInvalidosError(errores.join('. ') + '.', 'HORARIO_INVALIDO');

  return {
    tipo, espacioId: espacio.id, horaInicio, horaFin, dias, grupo: texto('grupo'),
    ...(estudiantes !== undefined && { estudiantes }),
    ...(texto('nivel') && { nivel: texto('nivel') }),
    ...(texto('docente') && { docente: texto('docente') }),
    ...(texto('modulo') && { modulo: texto('modulo') }),
    ...(texto('observacion') && { observacion: texto('observacion') }),
  };
}

/** Agrega un bloque. Devuelve {bloque, reservasEnConflicto}. */
export function crearBloque(db, datos, ahora) {
  const bloque = { id: `hor-${randomUUID().slice(0, 8)}`, ...normalizarBloque(datos, db.espacios) };
  (db.horarios ??= []).push(bloque);
  return { bloque, reservasEnConflicto: reservasQueChocan(db, bloque, ahora) };
}

/** Cambia un bloque (parcial). Devuelve {bloque, reservasEnConflicto}. */
export function modificarBloque(db, id, cambios, ahora) {
  const actual = (db.horarios ?? []).find((b) => b.id === id);
  if (!actual) throw new NoEncontradoError(`No existe el bloque de horario ${id}`, 'HORARIO_NO_ENCONTRADO');
  const nuevo = normalizarBloque({ ...actual, ...cambios }, db.espacios);
  // Se cambia el mismo objeto (no se reemplaza): actualizarDB compara contra la foto por id
  for (const campo of OPCIONALES) if (!(campo in nuevo)) delete actual[campo];
  Object.assign(actual, nuevo);
  return { bloque: actual, reservasEnConflicto: reservasQueChocan(db, actual, ahora) };
}

/** Quita un bloque. Devuelve el bloque quitado. */
export function quitarBloque(db, id) {
  const posicion = (db.horarios ?? []).findIndex((b) => b.id === id);
  if (posicion < 0) throw new NoEncontradoError(`No existe el bloque de horario ${id}`, 'HORARIO_NO_ENCONTRADO');
  return db.horarios.splice(posicion, 1)[0];
}
