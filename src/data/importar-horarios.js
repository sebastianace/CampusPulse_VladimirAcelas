// =====================================================================
// IMPORTAR LOS HORARIOS DESDE UN EXCEL (.xlsx) O UN CSV
// ---------------------------------------------------------------------
// Carga los horarios de las clases (Software, Inglés y SER) que prepara Coordinación en Excel. Las reglas están
// en src/domain/horarios-importar.js y el análisis de problemas en src/domain/horarios.js; aquí solo se lee el
// archivo (.xlsx con src/data/xlsx.js, o CSV con src/data/csv.js), se habla con la base y se muestra el informe.
// Lo usan la terminal (abajo) y la pantalla de horarios del admin (POST /api/horarios/importar).
//
//   npm run importar-horarios -- data/privado/horarios.xlsx                         ENSAYO: solo informa
//   npm run importar-horarios -- data/privado/horarios.xlsx --aplicar               guarda
//   npm run importar-horarios -- archivo.csv --alias "Sala Nueva=blanca"            nombre de sala -> id de sala
//   npm run importar-horarios -- archivo.xlsx --dias L-V                            días para las filas que no traen
//
// Siempre se hace primero el ensayo. Los errores de formato impiden guardar; los hallazgos de planeación
// (cruces, aforo...) se muestran y NO impiden guardar. Guía: docs/horarios.md. Plantilla: data/plantillas/horarios.csv.
// =====================================================================

import { readFileSync } from 'node:fs';
import { actualizarDB, leerDB } from './almacen.js';
import { leerCSV } from './csv.js';
import { esXlsx, leerXlsx } from './xlsx.js';
import { cerrarPool, explicarErrorDeConexion } from './pg.js';
import { ETIQUETAS_CLASE, TITULOS_HALLAZGO, parsearDias } from '../domain/horarios.js';
import { importarHorarios, leerTablaHorarios } from '../domain/horarios-importar.js';
import { ErrorApi } from '../domain/errors.js';

/**
 * Elige la tabla de horarios de un archivo (bytes). Un Excel puede traer varias hojas (la del horario, las grillas, las
 * notas): sirve la primera, empezando por la que se llama "Horarios", que tenga las columnas obligatorias.
 * Devuelve {tabla, formato, hoja?, codificacion?, separador?}.
 */
export function leerArchivoDeHorarios(bytes) {
  if (!esXlsx(bytes)) {
    const { codificacion, separador, registros } = leerCSV(bytes);
    return { tabla: leerTablaHorarios(registros), formato: 'csv', codificacion, separador };
  }
  const { hojas } = leerXlsx(bytes);
  const ordenadas = [...hojas].sort((a, b) => Number(/horario/i.test(b.nombre)) - Number(/horario/i.test(a.nombre)));
  let primerError = null;
  for (const hoja of ordenadas) {
    try {
      return { tabla: leerTablaHorarios(hoja.registros), formato: 'xlsx', hoja: hoja.nombre };
    } catch (error) {
      if (!(error instanceof ErrorApi)) throw error;
      primerError ??= error;
    }
  }
  throw primerError;
}

/**
 * Lee un archivo (bytes de un .xlsx o un CSV) y lo importa. Sin `aplicar` es un ensayo y no escribe nada.
 * alias: {"Sala Nueva": "blanca"}. diasPorDefecto: [1..5] para las filas sin días.
 * Devuelve el informe de importarHorarios() más {formato, hoja?, separador?, codificacion?, columnas, ignoradas}.
 */
export async function importarHorariosDesdeArchivo(bytes, { aplicar = false, alias = {}, diasPorDefecto = null } = {}) {
  const { tabla, ...origen } = leerArchivoDeHorarios(bytes);
  const informe = aplicar
    ? await actualizarDB((db) => importarHorarios(db, tabla, { aplicar: true, alias, diasPorDefecto }))
    : importarHorarios(await leerDB(), tabla, { alias, diasPorDefecto });
  return { ...informe, ...origen, columnas: tabla.columnas, ignoradas: tabla.ignoradas };
}

/** Nombre anterior (solo aceptaba CSV): sigue funcionando porque ahora el mismo código lee los dos formatos. */
export const importarHorariosDesdeCSV = importarHorariosDesdeArchivo;

/** El informe como texto para la terminal. */
export function formatearInforme(i) {
  const nombreSeparador = i.separador === '\t' ? 'tabulador' : `"${i.separador}"`; // solo se usa con CSV
  const porTipo = Object.entries(i.porTipo).map(([t, n]) => `${ETIQUETAS_CLASE[t]} ${n}`).join(', ');
  const lineas = [
    i.formato === 'xlsx'
      ? `Archivo leído: Excel, hoja "${i.hoja}" · ${i.total} filas`
      : `Archivo leído: ${i.total} filas · separador ${nombreSeparador} · codificación ${i.codificacion}`,
    `Columnas que se usan: ${i.columnas.join(', ')}${i.ignoradas.length ? `  (se ignoran: ${i.ignoradas.join(', ')})` : ''}`,
    '',
    i.aplicado ? 'RESULTADO: SE GUARDÓ EN LA BASE' : 'ENSAYO: todavía no se guardó nada',
    `  Bloques válidos: ${i.bloques}${porTipo ? ` (${porTipo})` : ''}`,
    i.reemplaza.tipos.length
      ? `  Reemplaza los horarios actuales de ${i.reemplaza.tipos.map((t) => ETIQUETAS_CLASE[t]).join(', ')}: ${i.reemplaza.bloquesActuales} bloques`
      : '  No hay bloques válidos para guardar',
    `  Días de la semana: ${i.bloques - i.sinDias ? i.dias.join(' · ') : 'ninguno confirmado'}${i.sinDias && i.bloques - i.sinDias ? ` (${i.sinDias} sin confirmar)` : ''}`,
  ];
  if (i.diasPorDefecto) lineas.push(`  ${i.diasPorDefecto} filas no traían días: se les puso el día por defecto que indicaste`);
  if (i.reservasEnConflicto.length) {
    lineas.push(`  OJO: ${i.reservasEnConflicto.length} reserva${i.reservasEnConflicto.length === 1 ? '' : 's'} futura${i.reservasEnConflicto.length === 1 ? '' : 's'} quedaría${i.reservasEnConflicto.length === 1 ? '' : 'n'} encima de una clase. No se borran: hay que reubicarlas a mano.`);
  }
  if (i.errores.length) {
    lineas.push('', `ERRORES DE FORMATO (${i.errores.length}): no se guardó nada. Corrige el archivo y vuelve a probar.`,
      ...i.errores.map((e) => `  Línea ${e.linea}: ${e.mensaje}`));
  }
  if (i.hallazgos.length) {
    lineas.push('', `HALLAZGOS PARA COORDINACIÓN (${i.hallazgos.filter((h) => h.tipo !== 'sin-dias').length}): no impiden guardar, pero hay que revisarlos`);
    for (const tipo of Object.keys(TITULOS_HALLAZGO)) {
      const grupo = i.hallazgos.filter((h) => h.tipo === tipo);
      if (!grupo.length) continue;
      lineas.push('', `  ${TITULOS_HALLAZGO[tipo]}`, ...grupo.map((h) => `    - ${h.mensaje}${h.lineas.length ? ` (línea${h.lineas.length > 1 ? 's' : ''} ${[...new Set(h.lineas)].join(', ')})` : ''}`));
    }
  }
  if (!i.aplicado && !i.errores.length) lineas.push('', 'Si el informe está bien, guarda con --aplicar.');
  return lineas.join('\n');
}

const AYUDA = `Uso: npm run importar-horarios -- <archivo.xlsx|archivo.csv> [--aplicar] [--alias "Nombre=id-de-sala"] [--dias L-V]

  <archivo>       el Excel (.xlsx) de Coordinación, o un CSV guardado desde Excel (separador ; o ,)
  --aplicar       guarda en la base. Sin esto solo se hace el ensayo.
  --alias         una sala que el archivo llama distinto: --alias "Sala Nueva=blanca" (se puede repetir)
  --dias          días de clase para las filas que no traen la columna Días: --dias L-V

Plantilla: data/plantillas/horarios.csv. Guía: docs/horarios.md`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const alias = {};
  let diasPorDefecto = null;
  const posicionales = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--alias') {
      const [nombre, id] = String(args[++k] ?? '').split('=');
      if (!nombre || !id) { console.error('--alias necesita el formato "Nombre de sala=id-de-sala"'); process.exit(1); }
      alias[nombre.trim()] = id.trim();
    } else if (args[k] === '--dias') {
      const { dias, error } = parsearDias(args[++k]);
      if (error || !dias) { console.error(`--dias: ${error ?? 'escribe los días, por ejemplo L-V'}`); process.exit(1); }
      diasPorDefecto = dias;
    } else if (!args[k].startsWith('--')) posicionales.push(args[k]);
  }
  const ruta = posicionales[0];
  if (!ruta || args.includes('--ayuda')) {
    console.log(AYUDA);
    process.exit(ruta ? 0 : 1);
  }
  try {
    const informe = await importarHorariosDesdeArchivo(readFileSync(ruta), { aplicar: args.includes('--aplicar'), alias, diasPorDefecto });
    console.log(formatearInforme(informe));
    if (informe.errores.length) process.exitCode = 1;
  } catch (error) {
    if (error.code === 'ENOENT') console.error(`No existe el archivo ${ruta}`);
    else if (error instanceof ErrorApi || error.message?.startsWith('Hay una comilla')) console.error(error.message);
    else console.error(explicarErrorDeConexion(error));
    process.exitCode = 1;
  } finally {
    await cerrarPool();
  }
}
