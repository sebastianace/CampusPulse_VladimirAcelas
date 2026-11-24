// =====================================================================
// IMPORTAR EL INVENTARIO DESDE UN CSV
// ---------------------------------------------------------------------
// Carga el inventario real del campus (una hoja de Excel guardada como CSV) en lugar de los equipos de
// demostración. Las reglas están en src/domain/inventario-importar.js; aquí solo se lee el archivo, se habla
// con la base y se muestra el informe.
//
//   npm run importar-inventario -- data/privado/inventario.csv                      ENSAYO: solo informa
//   npm run importar-inventario -- data/privado/inventario.csv --aplicar            guarda
//   npm run importar-inventario -- data/privado/inventario.csv --aplicar --quitar-ficticios
//
// Siempre se hace primero el ensayo. Si una fila tiene un error, no se guarda ninguna (todo o nada).
// La plantilla está en data/plantillas/inventario.csv y la guía en docs/inventario-importar.md.
// =====================================================================

import { readFileSync } from 'node:fs';
import { actualizarDB, leerDB } from './almacen.js';
import { leerCSV } from './csv.js';
import { cerrarPool, explicarErrorDeConexion } from './pg.js';
import { importarInventario, leerTabla } from '../domain/inventario-importar.js';
import { ErrorApi } from '../domain/errors.js';

/**
 * Lee un CSV (bytes) y lo importa. Sin `aplicar` es un ensayo y no escribe nada.
 * Devuelve el informe de importarInventario() más {separador, codificacion, columnas}.
 */
export async function importarInventarioDesdeCSV(bytes, { aplicar = false, quitarFicticios = false } = {}) {
  const { codificacion, separador, registros } = leerCSV(bytes);
  const tabla = leerTabla(registros);
  const informe = aplicar
    ? await actualizarDB((db) => importarInventario(db, tabla, { aplicar: true, quitarFicticios }))
    : importarInventario(await leerDB(), tabla, { quitarFicticios });
  return { ...informe, codificacion, separador, columnas: tabla.columnas };
}

const MOSTRAR = 15; // cuántos equipos se listan por grupo antes de poner "… y N más"
const lista = (items, linea) => [...items.slice(0, MOSTRAR).map(linea), ...(items.length > MOSTRAR ? [`    … y ${items.length - MOSTRAR} más`] : [])];

/** El informe como texto para la terminal. */
export function formatearInforme(i) {
  const nombreSeparador = i.separador === '\t' ? 'tabulador' : `"${i.separador}"`;
  const lineas = [
    `Archivo leído: ${i.total} filas · separador ${nombreSeparador} · codificación ${i.codificacion}`,
    `Columnas que se usan: ${i.columnas.join(', ')}`,
    '',
    i.aplicado ? 'RESULTADO: SE GUARDÓ EN LA BASE' : 'ENSAYO: todavía no se guardó nada',
    `  Nuevos: ${i.nuevos.length}`,
    ...lista(i.nuevos, (r) => `    + ${r.id}  ${r.nombre} (${r.tipo}) · ${r.sala} · ${r.estado}`),
    `  Actualizados: ${i.actualizados.length}`,
    ...lista(i.actualizados, (r) => `    ~ ${r.id}  ${r.cambios.join('; ')}`),
    `  Sin cambios: ${i.sinCambios}`,
  ];
  if (i.ficticios.aQuitar.length) lineas.push(`  Equipos de demostración que se quitan: ${i.ficticios.aQuitar.length}`);
  if (i.errores.length) {
    lineas.push('', `ERRORES (${i.errores.length}): no se guardó nada. Corrige el archivo y vuelve a probar.`,
      ...i.errores.map((e) => `  Línea ${e.linea}: ${e.mensaje}`));
  }
  if (i.avisos.length) lineas.push('', 'AVISOS', ...i.avisos.map((a) => `  - ${a}`));
  if (i.ausentes) lineas.push('', `Hay ${i.ausentes} ${i.ausentes === 1 ? 'equipo real' : 'equipos reales'} en la base que este archivo no menciona (no se tocan).`);
  if (!i.aplicado && !i.errores.length) lineas.push('', 'Si el informe está bien, guarda con --aplicar.');
  return lineas.join('\n');
}

const AYUDA = `Uso: npm run importar-inventario -- <archivo.csv> [--aplicar] [--quitar-ficticios]

  <archivo.csv>        inventario guardado desde Excel (separador ; o ,)
  --aplicar            guarda en la base. Sin esto solo se hace el ensayo.
  --quitar-ficticios   quita los equipos de demostración (los que tengan incidencias se conservan)

Plantilla: data/plantillas/inventario.csv. Guía: docs/inventario-importar.md`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const ruta = args.find((a) => !a.startsWith('--'));
  if (!ruta || args.includes('--ayuda')) {
    console.log(AYUDA);
    process.exit(ruta ? 0 : 1);
  }
  try {
    const informe = await importarInventarioDesdeCSV(readFileSync(ruta), {
      aplicar: args.includes('--aplicar'), quitarFicticios: args.includes('--quitar-ficticios'),
    });
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
