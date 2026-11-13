// =====================================================================
// EVALUACIÓN DEL RAG: npm run evaluar-rag
// ---------------------------------------------------------------------
// Hace las 15 preguntas de evaluacion/rag-preguntas.js al servicio pulse-ai, con reranking y sin él, y
// mide por caso si acertó, si citó bien y si el fragmento correcto llegó a los 4 que ve Gemini.
// Guarda el detalle en evaluacion/resultados-rag.json y imprime una tabla en Markdown para
// docs/evaluacion-rag.md. Gasta cuota de Gemini (unas 60 llamadas), por eso espacia las peticiones.
//   Opciones:  --solo=1,5,12   corre solo esos casos   |   --pausa=15   segundos entre peticiones
// =====================================================================

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CASOS_RAG } from '../../evaluacion/rag-preguntas.js';

/**
 * Compara la respuesta de pulse-ai con lo esperado de un caso. Función pura (se prueba sin red).
 * Devuelve {acerto, cito, recupero, motivo}.
 *   acerto   : respondió/no supo como se esperaba (y, si respondió, dijo lo que debía).
 *   cito     : en un caso 'responde', se apoyó en un fragmento del documento esperado.
 *   recupero : el documento esperado estaba entre los fragmentos que vio Gemini (null en 'no_se').
 */
export function evaluarCaso(caso, respuesta) {
  const fragmentos = respuesta.fragmentos ?? [];
  if (caso.tipo === 'no_se') {
    const acerto = respuesta.respondido === false;
    return { acerto, cito: null, recupero: null, motivo: acerto ? '' : 'respondió algo que no está en los documentos' };
  }
  const recupero = fragmentos.some((f) => f.archivo === caso.archivo);
  const cito = fragmentos.some((f) => f.usado && f.archivo === caso.archivo);
  if (!respuesta.respondido) return { acerto: false, cito, recupero, motivo: 'dijo que no sabía' };
  const faltan = caso.debeDecir.filter((patron) => !patron.test(respuesta.respuesta));
  if (faltan.length) return { acerto: false, cito, recupero, motivo: `no menciona ${faltan.map(String).join(', ')}` };
  return { acerto: true, cito, recupero, motivo: cito ? '' : 'acertó pero no citó el documento esperado' };
}

const esperar = (segundos) => new Promise((resolver) => setTimeout(resolver, segundos * 1000));

async function preguntar({ caso, reranking }) {
  const cabeceras = { 'content-type': 'application/json' };
  if (process.env.PULSE_AI_TOKEN) cabeceras['x-pulse-token'] = process.env.PULSE_AI_TOKEN;
  const url = (process.env.PULSE_AI_URL || 'http://localhost:8000').replace(/\/$/, '');
  const respuesta = await fetch(`${url}/preguntar`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({ pregunta: caso.pregunta, historial: caso.historial ?? [], reranking }),
    signal: AbortSignal.timeout(90_000),
  });
  const cuerpo = await respuesta.json();
  if (!respuesta.ok) throw new Error(cuerpo?.error?.mensaje ?? `HTTP ${respuesta.status}`);
  return cuerpo;
}

// Un 503 de Gemini ("alta demanda") es pasajero: se reintenta una vez tras esperar. Si vuelve a fallar queda como error.
async function preguntarConReintento(args, pausa) {
  try {
    return await preguntar(args);
  } catch (error) {
    console.warn(`   (falló: ${error.message}; reintento en ${pausa * 2} s)`);
    await esperar(pausa * 2);
    return preguntar(args);
  }
}

async function main() {
  const argumento = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];
  const solo = argumento('solo')?.split(',').map(Number);
  const pausa = Number(argumento('pausa') ?? 8);
  const casos = CASOS_RAG.filter((c) => !solo || solo.includes(c.id));
  const resultados = [];

  for (const caso of casos) {
    for (const reranking of [false, true]) {
      const inicio = Date.now();
      let fila;
      try {
        const respuesta = await preguntarConReintento({ caso, reranking }, pausa);
        fila = { id: caso.id, reranking, ...evaluarCaso(caso, respuesta), respondido: respuesta.respondido,
          respuesta: respuesta.respuesta, consulta: respuesta.consulta,
          fragmentos: respuesta.fragmentos.map(({ archivo, seccion, similitud, puntaje, usado }) => ({ archivo, seccion, similitud, puntaje, usado })),
          segundos: Math.round((Date.now() - inicio) / 100) / 10 };
      } catch (error) {
        fila = { id: caso.id, reranking, acerto: false, cito: false, recupero: false, motivo: `error: ${error.message}`, error: true };
      }
      resultados.push(fila);
      console.log(`#${String(caso.id).padStart(2)} ${reranking ? 'con ' : 'sin '} reranking: ${fila.acerto ? 'OK ' : 'MAL'} ${fila.motivo}`);
      await esperar(pausa);
    }
  }

  const fecha = new Date().toISOString().slice(0, 10);
  writeFileSync(fileURLToPath(new URL('../../evaluacion/resultados-rag.json', import.meta.url)), JSON.stringify({ fecha, resultados }, null, 2));
  console.log(resumenMarkdown(resultados, casos));
}

/** Tabla en Markdown con los totales por modo. */
export function resumenMarkdown(resultados, casos) {
  const por = (reranking) => resultados.filter((r) => r.reranking === reranking);
  const contar = (filas, campo, soloTipo) => filas.filter((r) => casos.find((c) => c.id === r.id).tipo === soloTipo && r[campo] === true).length;
  const total = (tipo) => casos.filter((c) => c.tipo === tipo).length;
  const linea = (nombre, filas) => `| ${nombre} | ${contar(filas, 'acerto', 'responde')}/${total('responde')} | ${contar(filas, 'cito', 'responde')}/${total('responde')} | ${contar(filas, 'recupero', 'responde')}/${total('responde')} | ${contar(filas, 'acerto', 'no_se')}/${total('no_se')} |`;
  return [
    '| Modo | Respuestas correctas | Citó el documento correcto | Documento correcto entre los 4 fragmentos | "No sé" cuando correspondía |',
    '|---|---|---|---|---|',
    linea('Sin reranking', por(false)),
    linea('Con reranking', por(true)),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
