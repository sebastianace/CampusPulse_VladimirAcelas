// Tests de la evaluación del RAG: que las 15 preguntas estén bien formadas y que evaluarCaso mida bien.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CASOS_RAG } from '../evaluacion/rag-preguntas.js';
import { evaluarCaso, resumenMarkdown } from '../src/ai/evaluar-rag.js';

const caso = (id) => CASOS_RAG.find((c) => c.id === id);
const fragmento = (archivo, usado) => ({ archivo, usado, seccion: 's', similitud: 0.8, puntaje: 5 });

describe('las 15 preguntas de evaluación', () => {
  test('son 15, con ids únicos, y mezclan respuestas, seguimientos y "no sé"', () => {
    assert.equal(CASOS_RAG.length, 15);
    assert.equal(new Set(CASOS_RAG.map((c) => c.id)).size, 15);
    assert.ok(CASOS_RAG.filter((c) => c.tipo === 'no_se').length >= 3);
    assert.ok(CASOS_RAG.filter((c) => c.historial).length >= 2, 'casos de memoria');
  });

  test('cada caso "responde" apunta a un documento que existe y dice qué debe mencionar', () => {
    for (const c of CASOS_RAG.filter((x) => x.tipo === 'responde')) {
      assert.ok(existsSync(new URL(`../knowledge/${c.archivo}`, import.meta.url)), `#${c.id} ${c.archivo}`);
      assert.ok(c.debeDecir.length > 0 && c.debeDecir.every((r) => r instanceof RegExp), `#${c.id}`);
    }
  });

  test('las preguntas de seguimiento no se entienden solas (por eso llevan historial)', () => {
    for (const c of CASOS_RAG.filter((x) => x.historial)) assert.ok(c.pregunta.length < 40, `#${c.id}`);
  });
});

describe('evaluarCaso', () => {
  test('respuesta correcta, con el documento citado', () => {
    const r = evaluarCaso(caso(1), { respondido: true, respuesta: 'Hasta 4 horas.', fragmentos: [fragmento('reglamento-de-uso-de-salas.md', true)] });
    assert.deepEqual(r, { acerto: true, cito: true, recupero: true, motivo: '' });
  });

  test('responde bien pero cita otro documento: acierta, no cita bien', () => {
    const r = evaluarCaso(caso(1), { respondido: true, respuesta: 'Hasta 4 horas.', fragmentos: [fragmento('reglamento-de-uso-de-salas.md', false), fragmentos2()[0]] });
    assert.equal(r.acerto, true);
    assert.equal(r.cito, false);
    assert.equal(r.recupero, true);
  });

  test('si no menciona lo que debía, no acierta', () => {
    const r = evaluarCaso(caso(4), { respondido: true, respuesta: 'Apolo y Skilab.', fragmentos: [fragmento('reglamento-de-uso-de-salas.md', true)] });
    assert.equal(r.acerto, false);
    assert.match(r.motivo, /Spooki/);
  });

  test('decir "no sé" cuando sí estaba la respuesta es un fallo, y se ve si el documento llegó a Gemini', () => {
    const r = evaluarCaso(caso(1), { respondido: false, respuesta: 'No sé', fragmentos: [fragmento('reglamento-de-uso-de-salas.md', false)] });
    assert.deepEqual([r.acerto, r.recupero], [false, true]);
  });

  test('caso "no_se": acierta si dice que no sabe y falla si responde', () => {
    assert.equal(evaluarCaso(caso(13), { respondido: false, respuesta: 'No sé', fragmentos: [] }).acerto, true);
    assert.equal(evaluarCaso(caso(13), { respondido: true, respuesta: 'Alemania', fragmentos: [fragmento('x.md', true)] }).acerto, false);
  });

  test('resumenMarkdown cuenta por modo', () => {
    const casos = [caso(1), caso(13)];
    const filas = [
      { id: 1, reranking: false, acerto: true, cito: true, recupero: true },
      { id: 13, reranking: false, acerto: true, cito: null, recupero: null },
      { id: 1, reranking: true, acerto: false, cito: false, recupero: true },
      { id: 13, reranking: true, acerto: false, cito: null, recupero: null },
    ];
    const tabla = resumenMarkdown(filas, casos);
    assert.match(tabla, /\| Sin reranking \| 1\/1 \| 1\/1 \| 1\/1 \| 1\/1 \|/);
    assert.match(tabla, /\| Con reranking \| 0\/1 \| 0\/1 \| 1\/1 \| 0\/1 \|/);
  });
});

function fragmentos2() {
  return [fragmento('espacios-del-campus.md', true)];
}
