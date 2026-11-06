// =====================================================================
// MEDICIÓN DEL TRIAJE: ZERO-SHOT vs FEW-SHOT
// ---------------------------------------------------------------------
// Uso:  npm run medir-triaje
// Para cada reporte de evaluacion/triaje-casos.js pide el triaje a Gemini
// dos veces (sin ejemplos y con los 4 ejemplos) y compara cada campo con
// lo esperado. Imprime el resumen y guarda el detalle en
// evaluacion/resultados/triaje-<fecha>.json.
// - Usa la clave de .env y GASTA CUOTA: son 24 llamadas. La capa gratis
//   permite 5 por minuto, así que espera 13 s entre llamadas (~5 minutos).
// - No pasa por el límite ni la caché de la API: habla directo con el cliente.
// - Un fallo de la IA cuenta como error en todos los campos de ese caso.
// =====================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { leerDB } from '../data/store.js';
import { CASOS_TRIAJE } from '../../evaluacion/triaje-casos.js';
import { generarJSON } from './cliente.js';
import { promptTriaje } from './prompts/triaje.js';
import { crearSchema } from './triaje.js';
import { validarTriaje } from './validar.js';

export const CAMPOS = ['categoria', 'prioridad', 'area', 'espacioId', 'recursoId', 'inhabilitar'];
const PAUSA_MS = 13_000; // 5 peticiones por minuto en la capa gratis de Gemini

/** Compara el triaje obtenido con el esperado campo por campo. Sin triaje (error), todo falla. */
export function compararTriaje(esperado, obtenido) {
  const campos = Object.fromEntries(CAMPOS.map((campo) => [campo, obtenido != null && obtenido[campo] === esperado[campo]]));
  return { campos, exacto: Object.values(campos).every(Boolean) };
}

/** Resume una lista de comparaciones: aciertos por campo, casos exactos y errores de la IA. */
export function resumir(resultados) {
  const porCampo = Object.fromEntries(CAMPOS.map((campo) => [campo, resultados.filter((r) => r.comparacion.campos[campo]).length]));
  return {
    total: resultados.length,
    errores: resultados.filter((r) => r.error).length,
    exactos: resultados.filter((r) => r.comparacion.exacto).length,
    porCampo,
  };
}

// Pide el triaje con o sin ejemplos y lo valida igual que la API.
async function triar(reporte, catalogo, conEjemplos) {
  const { datos, modelo } = await generarJSON(promptTriaje(reporte, catalogo, { conEjemplos }), crearSchema(catalogo));
  return { triaje: validarTriaje(datos, catalogo), modelo };
}

async function medirCaso(caso, catalogo, conEjemplos) {
  try {
    const { triaje, modelo } = await triar(caso.reporte, catalogo, conEjemplos);
    return { reporte: caso.reporte, obtenido: triaje, modelo, comparacion: compararTriaje(caso.esperado, triaje) };
  } catch (error) {
    return { reporte: caso.reporte, obtenido: null, error: error.message, comparacion: compararTriaje(caso.esperado, null) };
  }
}

const porcentaje = (parte, total) => `${Math.round((parte / total) * 100)}%`;

function imprimir(titulo, resumen) {
  console.log(`\n${titulo}`);
  console.log(`  exactos (los 6 campos): ${resumen.exactos}/${resumen.total} (${porcentaje(resumen.exactos, resumen.total)})   errores de la IA: ${resumen.errores}`);
  for (const campo of CAMPOS) console.log(`  ${campo.padEnd(10)} ${resumen.porCampo[campo]}/${resumen.total} (${porcentaje(resumen.porCampo[campo], resumen.total)})`);
}

async function main() {
  // Solo se comprueba que existan, sin imprimir su valor
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) {
    console.error('Falta GEMINI_API_KEY o GEMINI_MODEL en .env. Revisa .env.example.');
    process.exit(1);
  }
  const { espacios, recursos } = leerDB();
  const catalogo = { espacios, recursos };
  console.log(`Midiendo ${CASOS_TRIAJE.length} reportes en dos modos (${CASOS_TRIAJE.length * 2} llamadas, unos 5 minutos)...`);

  const zero = [];
  const few = [];
  for (const [i, caso] of CASOS_TRIAJE.entries()) {
    console.log(`  caso ${i + 1}/${CASOS_TRIAJE.length}: ${caso.reporte.slice(0, 60)}`);
    zero.push(await medirCaso(caso, catalogo, false));
    await esperar(PAUSA_MS);
    few.push(await medirCaso(caso, catalogo, true));
    if (i < CASOS_TRIAJE.length - 1) await esperar(PAUSA_MS);
  }

  const resumenZero = resumir(zero);
  const resumenFew = resumir(few);
  imprimir('ZERO-SHOT (sin ejemplos)', resumenZero);
  imprimir('FEW-SHOT (4 ejemplos)', resumenFew);

  const fecha = new Date().toISOString().slice(0, 10);
  const carpeta = fileURLToPath(new URL('../../evaluacion/resultados/', import.meta.url));
  mkdirSync(carpeta, { recursive: true });
  const archivo = `${carpeta}triaje-${fecha}.json`;
  const modelo = [...zero, ...few].find((r) => r.modelo)?.modelo ?? null;
  writeFileSync(archivo, JSON.stringify({ fecha, modelo, resumen: { zeroShot: resumenZero, fewShot: resumenFew }, zeroShot: zero, fewShot: few }, null, 2));
  console.log(`\nDetalle guardado en evaluacion/resultados/triaje-${fecha}.json`);
}

if (import.meta.main) await main();
