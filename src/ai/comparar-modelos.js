// =====================================================================
// MATRIZ DE MODELOS: npm run comparar-modelos -- --modelos=a,b,c
// ---------------------------------------------------------------------
// Mide varios modelos de Gemini con las MISMAS tareas reales de Campus Pulse y los mismos prompts de producción:
//   1. Triaje de incidencias (12 reportes de evaluacion/triaje-casos.js, con los ejemplos few-shot).
//   2. Extracción de la solicitud de reserva (6 pedidos con fecha fija y respuesta esperada).
// Registra aciertos, tiempo y tokens (entrada, salida y "de razonamiento") por llamada. Guarda el detalle en
// evaluacion/resultados/modelos-<fecha>-<modelos>.json. Resultado y análisis: docs/matriz-modelos.md.
// Gasta cuota de Gemini (18 llamadas por modelo); espacia las peticiones.
// =====================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { CASOS_TRIAJE } from '../../evaluacion/triaje-casos.js';
import { leerDB } from '../data/almacen.js';
import { cerrarPool } from '../data/pg.js';
import { SCHEMA_SOLICITUD } from './asistente.js';
import { compararTriaje } from './medir-triaje.js';
import { promptSolicitud } from './prompts/solicitud.js';
import { promptTriaje } from './prompts/triaje.js';
import { crearSchema } from './triaje.js';
import { validarSolicitud, validarTriaje } from './validar.js';

// "Ahora" fijo (viernes 13 de noviembre de 2026, 9:00 a. m., Bogotá) para que las fechas esperadas no cambien.
export const AHORA_FIJO = '2026-11-13T09:00';
export const CASOS_SOLICITUD = [
  { texto: 'Necesito una sala para 30 personas el próximo martes de 2 a 4 pm', esperado: { asistentes: 30, inicio: '2026-11-17T14:00', fin: '2026-11-17T16:00' } },
  { texto: 'Reunión de 8 personas mañana de 10 a 11:30 am', esperado: { asistentes: 8, inicio: '2026-11-14T10:00', fin: '2026-11-14T11:30' } },
  { texto: 'Taller de programación para 25 campers el lunes de 8 a 12', esperado: { asistentes: 25, inicio: '2026-11-16T08:00', fin: '2026-11-16T12:00' } },
  { texto: 'Una sala para 12 personas hoy a las 3 pm por dos horas', esperado: { asistentes: 12, inicio: '2026-11-13T15:00', fin: '2026-11-13T17:00' } },
  { texto: 'Charla para 60 personas el miércoles 18 de noviembre de 9 a 11 am', esperado: { asistentes: 60, inicio: '2026-11-18T09:00', fin: '2026-11-18T11:00' } },
  { texto: 'Necesito el auditorio el jueves de 2 a 5 de la tarde para 90 personas', esperado: { asistentes: 90, inicio: '2026-11-19T14:00', fin: '2026-11-19T17:00' } },
];

/** ¿La solicitud extraída coincide con la esperada en personas, inicio y fin? */
export function compararSolicitud(esperado, obtenido) {
  return obtenido != null && ['asistentes', 'inicio', 'fin'].every((campo) => obtenido[campo] === esperado[campo]);
}

/** Resumen de las llamadas de un modelo en una tarea: aciertos, errores, tiempo y tokens promedio. */
export function resumirLlamadas(llamadas) {
  const ok = llamadas.filter((l) => !l.error);
  const promedio = (campo) => (ok.length ? Math.round(ok.reduce((s, l) => s + (l[campo] ?? 0), 0) / ok.length) : null);
  return {
    total: llamadas.length,
    aciertos: llamadas.filter((l) => l.acierto).length,
    errores: llamadas.length - ok.length,
    msPromedio: promedio('ms'),
    tokensEntrada: promedio('tokensEntrada'),
    tokensSalida: promedio('tokensSalida'),
    tokensRazonamiento: promedio('tokensRazonamiento'),
  };
}

const PAUSA_MS = 6_000;

async function llamar(ai, modelo, prompt, schema) {
  const inicio = performance.now();
  const r = await ai.models.generateContent({
    model: modelo,
    contents: prompt,
    config: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, abortSignal: AbortSignal.timeout(60_000) },
  });
  const uso = r.usageMetadata ?? {};
  return {
    datos: JSON.parse(r.text),
    ms: Math.round(performance.now() - inicio),
    tokensEntrada: uso.promptTokenCount ?? 0,
    tokensSalida: uso.candidatesTokenCount ?? 0,
    tokensRazonamiento: uso.thoughtsTokenCount ?? 0,
  };
}

// Un reintento tras una espera larga si Gemini dice "alta demanda" o "sin cuota": se mide el modelo, no un pico.
async function llamarConReintento(...args) {
  try {
    return await llamar(...args);
  } catch (error) {
    await esperar(20_000);
    return llamar(...args);
  }
}

async function medirModelo(ai, modelo, catalogo) {
  const triaje = [];
  for (const caso of CASOS_TRIAJE) {
    try {
      const r = await llamarConReintento(ai, modelo, promptTriaje(caso.reporte, catalogo, { conEjemplos: true }), crearSchema(catalogo));
      const obtenido = validarTriaje(r.datos, catalogo);
      triaje.push({ ...r, datos: undefined, obtenido, acierto: compararTriaje(caso.esperado, obtenido).exacto });
    } catch (error) {
      triaje.push({ error: error.message.slice(0, 120), acierto: false });
    }
    console.log(`  ${modelo} · triaje ${triaje.length}/${CASOS_TRIAJE.length}${triaje.at(-1).error ? ' (error)' : ''}`);
    await esperar(PAUSA_MS);
  }
  const solicitud = [];
  for (const caso of CASOS_SOLICITUD) {
    try {
      const r = await llamarConReintento(ai, modelo, promptSolicitud(caso.texto, AHORA_FIJO), SCHEMA_SOLICITUD);
      const obtenido = validarSolicitud(r.datos);
      solicitud.push({ ...r, datos: undefined, obtenido, acierto: compararSolicitud(caso.esperado, obtenido) });
    } catch (error) {
      solicitud.push({ error: error.message.slice(0, 120), acierto: false });
    }
    console.log(`  ${modelo} · solicitud ${solicitud.length}/${CASOS_SOLICITUD.length}${solicitud.at(-1).error ? ' (error)' : ''}`);
    await esperar(PAUSA_MS);
  }
  return { modelo, triaje: { resumen: resumirLlamadas(triaje), llamadas: triaje }, solicitud: { resumen: resumirLlamadas(solicitud), llamadas: solicitud } };
}

async function main() {
  const modelos = process.argv.find((a) => a.startsWith('--modelos='))?.split('=')[1]?.split(',').filter(Boolean);
  if (!process.env.GEMINI_API_KEY || !modelos?.length) {
    console.error('Uso: npm run comparar-modelos -- --modelos=gemini-a,gemini-b   (necesita GEMINI_API_KEY en .env)');
    process.exit(1);
  }
  const { espacios, recursos } = await leerDB();
  await cerrarPool();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const resultados = [];
  for (const modelo of modelos) resultados.push(await medirModelo(ai, modelo, { espacios, recursos }));

  console.log('\n| Modelo | Triaje exacto | ms triaje | Solicitud exacta | ms solicitud | Tokens entrada / salida / razonamiento (triaje) |');
  console.log('|---|---|---|---|---|---|');
  for (const r of resultados) {
    const t = r.triaje.resumen;
    const s = r.solicitud.resumen;
    console.log(`| ${r.modelo} | ${t.aciertos}/${t.total}${t.errores ? ` (${t.errores} err.)` : ''} | ${t.msPromedio} | ${s.aciertos}/${s.total}${s.errores ? ` (${s.errores} err.)` : ''} | ${s.msPromedio} | ${t.tokensEntrada} / ${t.tokensSalida} / ${t.tokensRazonamiento} |`);
  }
  const fecha = new Date().toISOString().slice(0, 10);
  const carpeta = fileURLToPath(new URL('../../evaluacion/resultados/', import.meta.url));
  mkdirSync(carpeta, { recursive: true });
  const archivo = `${carpeta}modelos-${fecha}-${modelos.join('+')}.json`;
  writeFileSync(archivo, JSON.stringify({ fecha, ahoraFijo: AHORA_FIJO, resultados }, null, 2));
  console.log(`\nDetalle guardado en ${archivo.slice(archivo.indexOf('evaluacion/'))}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
