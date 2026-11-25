// =====================================================================
// DOMINIO: IMPORTAR LOS HORARIOS DESDE UN CSV
// ---------------------------------------------------------------------
// Carga los horarios que prepara Coordinación en Excel (una fila por bloque) en la base. Trabaja sobre `db`
// como el resto de reglas: no toca la base. src/data/importar-horarios.js la llama con leerDB() (ensayo) o
// con actualizarDB() (aplicar), y así hereda la transacción y el bloqueo de escritura.
// Reglas:
//   1. Ensayo primero: sin `aplicar` solo se informa.
//   2. Errores de FORMATO (sala que no existe, hora inválida, tipo desconocido...) impiden aplicar, y se
//      informan todos juntos con su línea: todo o nada.
//   3. Los problemas de PLANEACIÓN (cruces, aforo, cohortes que no cuadran) NO impiden aplicar: son hallazgos
//      para Coordinación, que es justo lo que se quiere ver. src/domain/horarios.js los calcula.
//   4. Se reemplazan los horarios de los TIPOS que trae el archivo (Software, Inglés, SER). Un archivo solo
//      de Inglés no toca Software ni SER: cada clase se actualiza por separado.
//   5. Una columna que no se usa (por ejemplo "Días restantes", que es una foto de un día y envejece) se ignora
//      y se nombra en el informe.
// =====================================================================

import { randomUUID } from 'node:crypto';
import { DatosInvalidosError } from './errors.js';
import { TIPOS_CLASE, analizarHorarios, describirDias, normalizarHora, minutosDeHora, parsearDias, reservasQueChocan } from './horarios.js';
import { buscarSala, plano } from './salas.js';

export const MAX_FILAS = 1000;

// Columnas que se entienden y cómo pueden llamarse en el Excel (sin tildes, en minúscula, con "/" y "-" como espacio).
export const COLUMNAS = {
  tipo: ['tipo', 'clase', 'tipo de clase'],
  sala: ['sala', 'espacio', 'salon', 'ubicacion', 'aula'],
  inicio: ['hora inicio', 'inicio', 'desde', 'hora de inicio'],
  fin: ['hora fin', 'fin', 'hasta', 'hora de fin', 'hora final'],
  dias: ['dias', 'dia', 'dias de la semana'],
  grupo: ['grupo cohorte', 'grupo', 'cohorte'],
  estudiantes: ['estudiantes', 'alumnos', 'campers', 'cantidad'],
  nivel: ['nivel programa', 'nivel', 'programa'],
  docente: ['docente', 'profesor', 'profe', 'instructor', 'trainer'],
  modulo: ['modulo'],
  observacion: ['observacion', 'observaciones', 'nota', 'notas'],
};
const OBLIGATORIAS = ['tipo', 'sala', 'inicio', 'fin', 'grupo'];

const TIPOS = { software: 'software', ingles: 'ingles', ser: 'ser' };

// ---------- 1. de registros CSV a una tabla con columnas conocidas ----------

/**
 * Registros de src/data/csv.js -> {filas, columnas, ignoradas}. La primera fila es el encabezado.
 * Lanza DatosInvalidosError si falta una columna obligatoria o no hay datos.
 */
export function leerTablaHorarios(registros) {
  if (!registros.length) throw new DatosInvalidosError('El archivo está vacío.', 'ARCHIVO_VACIO');
  const [encabezado, ...datos] = registros;
  const nombres = encabezado.celdas.map((c) => plano(c));
  const columnas = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const posicion = nombres.findIndex((n) => alias.includes(n));
    if (posicion >= 0) columnas[campo] = posicion;
  }
  const faltan = OBLIGATORIAS.filter((c) => columnas[c] === undefined);
  if (faltan.length) {
    throw new DatosInvalidosError(
      `Faltan columnas obligatorias: ${faltan.join(', ')}. El archivo trae: ${encabezado.celdas.map((c) => `"${c.trim()}"`).join(', ')}. `
      + 'Mira data/plantillas/horarios.csv.', 'COLUMNAS_FALTANTES');
  }
  if (!datos.length) throw new DatosInvalidosError('El archivo solo tiene el encabezado: no hay bloques de horario.', 'ARCHIVO_VACIO');
  if (datos.length > MAX_FILAS) throw new DatosInvalidosError(`El archivo tiene ${datos.length} filas y el máximo es ${MAX_FILAS}. ¿Es el archivo correcto?`, 'DEMASIADAS_FILAS');
  const usadas = new Set(Object.values(columnas));
  const ignoradas = encabezado.celdas.map((c, i) => [c.trim(), i]).filter(([c, i]) => c && !usadas.has(i)).map(([c]) => c);
  const celda = (r, campo) => (columnas[campo] === undefined ? '' : String(r.celdas[columnas[campo]] ?? '').trim());
  const filas = datos.map((r) => ({ linea: r.linea, ...Object.fromEntries(Object.keys(COLUMNAS).map((campo) => [campo, celda(r, campo)])) }));
  return { filas, columnas: Object.keys(columnas), ignoradas };
}

// ---------- 2. validar cada fila ----------

/**
 * Valida una fila. Devuelve {bloque, conDiasPorDefecto} (el bloque sin id) o {errores: [texto], salaDesconocida?}.
 * diasPorDefecto: los días que se le ponen a una fila que no trae ninguno (el Excel de Coordinación no tiene esa columna).
 */
function validarFila(fila, espacios, alias, diasPorDefecto) {
  const errores = [];
  const tipo = TIPOS[plano(fila.tipo)];
  if (!tipo) errores.push(`el tipo "${fila.tipo}" no se entiende. Usa: Software, Inglés o SER`);

  let espacioId = null;
  let salaDesconocida = null;
  if (!fila.sala) errores.push('falta la sala');
  else {
    const { espacio, sugerencia } = buscarSala(fila.sala, espacios, alias);
    if (espacio) espacioId = espacio.id;
    else salaDesconocida = { nombre: fila.sala, sugerencia: sugerencia?.id ?? null };
    if (!espacio) errores.push(`la sala "${fila.sala}" no existe en el campus${sugerencia ? `. ¿Quisiste decir "${sugerencia.nombre}"?` : ''} (si es otro nombre de una sala que sí existe, indica cuál es)`);
  }

  const horaInicio = normalizarHora(fila.inicio);
  const horaFin = normalizarHora(fila.fin);
  if (!horaInicio) errores.push(`la hora de inicio "${fila.inicio}" no sirve (usa HH:MM, por ejemplo 07:00)`);
  if (!horaFin) errores.push(`la hora de fin "${fila.fin}" no sirve (usa HH:MM, por ejemplo 08:00)`);
  if (horaInicio && horaFin && minutosDeHora(horaFin) <= minutosDeHora(horaInicio)) errores.push(`la clase termina (${horaFin}) antes o a la misma hora en que empieza (${horaInicio})`);

  const { dias: diasDelArchivo, error: errorDias } = parsearDias(fila.dias);
  if (errorDias) errores.push(errorDias);
  const conDiasPorDefecto = !errorDias && !diasDelArchivo && Boolean(diasPorDefecto);
  const dias = conDiasPorDefecto ? diasPorDefecto : diasDelArchivo;

  if (!fila.grupo) errores.push('falta el grupo o cohorte');

  let estudiantes = null;
  if (fila.estudiantes !== '') {
    estudiantes = Number(fila.estudiantes);
    if (!Number.isInteger(estudiantes) || estudiantes < 0) errores.push(`los estudiantes "${fila.estudiantes}" no son un número entero`);
  }
  if (errores.length) return { errores, salaDesconocida };
  const limpio = (t) => t.replace(/\s+/g, ' ').trim() || undefined;
  return {
    bloque: {
      tipo, espacioId, horaInicio, horaFin, dias: dias ?? null, grupo: limpio(fila.grupo),
      ...(estudiantes !== null && { estudiantes }),
      ...(limpio(fila.nivel) && { nivel: limpio(fila.nivel) }),
      ...(limpio(fila.docente) && { docente: limpio(fila.docente) }),
      ...(limpio(fila.modulo) && { modulo: limpio(fila.modulo) }),
      ...(limpio(fila.observacion) && { observacion: limpio(fila.observacion) }),
    },
    conDiasPorDefecto,
  };
}

// ---------- 3. el informe y los cambios ----------

/**
 * Importa los horarios. `tabla` es lo que devuelve leerTablaHorarios().
 * Opciones: {aplicar = false, alias = {}, diasPorDefecto = null}: alias = nombre de sala del archivo -> id de espacio;
 * diasPorDefecto = [1..7] para las filas que no traen días.
 * Sin `aplicar` no modifica `db`; con `aplicar`, solo si no hay errores de formato.
 * Devuelve {aplicado, total, errores, hallazgos, reemplaza, bloques, sinDias, porTipo, dias, salasSinReconocer, diasPorDefecto,
 * reservasEnConflicto}.
 */
export function importarHorarios(db, tabla, { aplicar = false, alias = {}, diasPorDefecto = null } = {}) {
  const errores = [];
  const nuevos = [];
  const desconocidas = new Map(); // nombre de sala que no se reconoció -> {nombre, sugerencia}
  let rellenadas = 0;
  for (const fila of tabla.filas) {
    const { bloque, conDiasPorDefecto, errores: malos, salaDesconocida } = validarFila(fila, db.espacios, alias, diasPorDefecto);
    if (salaDesconocida) desconocidas.set(salaDesconocida.nombre, salaDesconocida);
    if (malos) malos.forEach((mensaje) => errores.push({ linea: fila.linea, mensaje }));
    else {
      nuevos.push({ ...bloque, linea: fila.linea });
      if (conDiasPorDefecto) rellenadas++;
    }
  }

  const tipos = TIPOS_CLASE.filter((t) => nuevos.some((b) => b.tipo === t));
  const actuales = (db.horarios ?? []).filter((b) => tipos.includes(b.tipo));
  const resultante = [...(db.horarios ?? []).filter((b) => !tipos.includes(b.tipo)), ...nuevos];
  const hallazgos = analizarHorarios(resultante, db.espacios);

  const informe = {
    aplicado: false,
    total: tabla.filas.length,
    errores,
    hallazgos,
    reemplaza: { tipos, bloquesActuales: actuales.length },
    bloques: nuevos.length,
    sinDias: nuevos.filter((b) => !b.dias).length,
    porTipo: Object.fromEntries(tipos.map((t) => [t, nuevos.filter((b) => b.tipo === t).length])),
    dias: [...new Set(nuevos.filter((b) => b.dias).map((b) => describirDias(b.dias)))],
    salasSinReconocer: [...desconocidas.values()],
    diasPorDefecto: rellenadas,
    // Reservas futuras que quedarían encima de una clase nueva: se avisa, no se borran (decide Coordinación)
    reservasEnConflicto: [...new Map(nuevos.flatMap((b) => reservasQueChocan(db, b)).map((r) => [r.id, r])).values()],
  };
  if (aplicar && !errores.length) {
    // Se modifica el arreglo en su sitio (como el resto de reglas): actualizarDB compara contra la foto por id
    db.horarios ??= [];
    for (let i = db.horarios.length - 1; i >= 0; i--) if (tipos.includes(db.horarios[i].tipo)) db.horarios.splice(i, 1);
    for (const { linea, ...bloque } of nuevos) db.horarios.push({ id: `hor-${randomUUID().slice(0, 8)}`, ...bloque });
    informe.aplicado = true;
  }
  return informe;
}
