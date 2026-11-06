// =====================================================================
// TESTS DEL FEW-SHOT Y DE LA MEDICIÓN DEL TRIAJE (node:test)
// ---------------------------------------------------------------------
// No llaman a Gemini: comprueban que los ejemplos y el conjunto de prueba
// sean coherentes con el catálogo y con las reglas, que el prompt los
// incluya (o no) según corresponda y que la comparación funcione.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-fewshot-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
const { leerDB } = await import('../src/data/store.js');
const { AREAS, CATEGORIAS, PRIORIDADES, REGLAS } = await import('../src/config/reglas.js');
const { EJEMPLOS_TRIAJE } = await import('../src/ai/prompts/ejemplos-triaje.js');
const { promptTriaje } = await import('../src/ai/prompts/triaje.js');
const { construirPrompt } = await import('../src/ai/prompts/estructura.js');
const { CASOS_TRIAJE } = await import('../evaluacion/triaje-casos.js');
const { CAMPOS, compararTriaje, resumir } = await import('../src/ai/medir-triaje.js');

const { espacios, recursos } = leerDB();
const CATALOGO = { espacios, recursos };
rmSync(CARPETA, { recursive: true, force: true });

// Revisa que una clasificación sea válida: enums, IDs del catálogo y la regla de inhabilitar.
function assertClasificacionValida(c, nombre) {
  assert.ok(CATEGORIAS.includes(c.categoria), `${nombre}: categoría`);
  assert.ok(PRIORIDADES.includes(c.prioridad), `${nombre}: prioridad`);
  assert.ok(AREAS.includes(c.area), `${nombre}: área`);
  assert.ok(c.espacioId === null || espacios.some((e) => e.id === c.espacioId), `${nombre}: espacioId ${c.espacioId} no existe`);
  assert.ok(c.recursoId === null || recursos.some((r) => r.id === c.recursoId), `${nombre}: recursoId ${c.recursoId} no existe`);
  assert.equal(typeof c.inhabilitar, 'boolean', `${nombre}: inhabilitar`);
  if (REGLAS.PRIORIDADES_QUE_INHABILITAN.includes(c.prioridad)) {
    assert.equal(c.inhabilitar, true, `${nombre}: una prioridad que inhabilita siempre debe tener inhabilitar: true`);
  }
}

describe('Ejemplos few-shot', () => {
  test('son los 4 casos aprobados y cada uno es una clasificación válida', () => {
    assert.equal(EJEMPLOS_TRIAJE.length, 4);
    for (const { reporte, respuesta } of EJEMPLOS_TRIAJE) {
      assertClasificacionValida(respuesta, reporte);
      assert.ok(respuesta.razon.length > 0, `${reporte}: falta la razón`);
    }
  });

  test('cubren prioridades distintas y casos con espacio o equipo null', () => {
    const respuestas = EJEMPLOS_TRIAJE.map((e) => e.respuesta);
    assert.deepEqual([...new Set(respuestas.map((r) => r.prioridad))].sort(), ['alta', 'baja', 'critica', 'media']);
    assert.ok(respuestas.some((r) => r.espacioId === null));
    assert.ok(respuestas.some((r) => r.recursoId === null));
    assert.equal(respuestas.filter((r) => r.inhabilitar).length, 1);
  });
});

describe('Conjunto de prueba', () => {
  test('tiene 12 reportes con una clasificación esperada válida', () => {
    assert.equal(CASOS_TRIAJE.length, 12);
    for (const { reporte, esperado } of CASOS_TRIAJE) assertClasificacionValida(esperado, reporte);
  });

  test('ningún reporte repite uno de los ejemplos (evaluar con lo enseñado sería trampa)', () => {
    const enseñados = new Set(EJEMPLOS_TRIAJE.map((e) => e.reporte.toLowerCase()));
    for (const { reporte } of CASOS_TRIAJE) assert.ok(!enseñados.has(reporte.toLowerCase()), reporte);
  });
});

describe('Prompt con y sin ejemplos', () => {
  test('por defecto incluye los ejemplos entre el procedimiento y la entrada', () => {
    const prompt = promptTriaje('algo', CATALOGO);
    const [procedimiento, ejemplos, entrada] = ['## Procedimiento', '## Ejemplos', '## Entrada'].map((t) => prompt.indexOf(t));
    assert.ok(procedimiento < ejemplos && ejemplos < entrada);
    for (const { reporte } of EJEMPLOS_TRIAJE) assert.ok(prompt.includes(`Reporte: "${reporte}"`), reporte);
    assert.match(prompt, /Los IDs de los ejemplos son solo ilustrativos/);
  });

  test('con conEjemplos: false es zero-shot: no hay sección de ejemplos', () => {
    const prompt = promptTriaje('algo', CATALOGO, { conEjemplos: false });
    assert.doesNotMatch(prompt, /## Ejemplos/);
    assert.doesNotMatch(prompt, /Ejemplo 1/);
  });

  test('el reporte real sigue siendo el único entre <reporte>, también con ejemplos', () => {
    const prompt = promptTriaje('Reporte de prueba', CATALOGO);
    assert.equal(prompt.split('<reporte>').length - 1, 2, 'una mención en los límites y el delimitador real; los ejemplos usan otro formato');
    assert.match(prompt, /<reporte>\nReporte de prueba\n<\/reporte>/);
  });

  test('construirPrompt sin ejemplos no agrega la sección', () => {
    const prompt = construirPrompt({ rol: 'R', tono: 'T', politicas: ['p'], limites: ['l'], procedimiento: ['s'], entrada: 'E' });
    assert.doesNotMatch(prompt, /## Ejemplos/);
  });
});

describe('Medición', () => {
  const esperado = { categoria: 'tecnologia', prioridad: 'media', area: 'Soporte TI', espacioId: 'apolo', recursoId: 'rec-01', inhabilitar: false };

  test('compararTriaje marca acierto o fallo por campo', () => {
    const parcial = compararTriaje(esperado, { ...esperado, prioridad: 'alta', inhabilitar: true });
    assert.equal(parcial.exacto, false);
    assert.deepEqual(Object.keys(parcial.campos), CAMPOS);
    assert.equal(parcial.campos.categoria, true);
    assert.equal(parcial.campos.prioridad, false);
    assert.equal(parcial.campos.inhabilitar, false);
    assert.equal(compararTriaje(esperado, { ...esperado }).exacto, true);
  });

  test('un fallo de la IA (sin triaje) cuenta como error en todos los campos', () => {
    const { campos, exacto } = compararTriaje(esperado, null);
    assert.equal(exacto, false);
    assert.ok(Object.values(campos).every((v) => v === false));
  });

  test('un null esperado se compara con null (no con undefined)', () => {
    const sinSala = { ...esperado, espacioId: null };
    assert.equal(compararTriaje(sinSala, { ...sinSala }).campos.espacioId, true);
    assert.equal(compararTriaje(sinSala, { ...sinSala, espacioId: 'apolo' }).campos.espacioId, false);
  });

  test('resumir cuenta aciertos por campo, casos exactos y errores', () => {
    const resultados = [
      { comparacion: compararTriaje(esperado, { ...esperado }) },
      { comparacion: compararTriaje(esperado, { ...esperado, area: 'Seguridad' }) },
      { error: 'IA caída', comparacion: compararTriaje(esperado, null) },
    ];
    const resumen = resumir(resultados);
    assert.equal(resumen.total, 3);
    assert.equal(resumen.exactos, 1);
    assert.equal(resumen.errores, 1);
    assert.equal(resumen.porCampo.categoria, 2);
    assert.equal(resumen.porCampo.area, 1);
  });

  test('el script se detiene con un mensaje claro si no hay clave, sin llamar a Gemini', () => {
    // env vacío: ni siquiera hay PATH; no se carga el .env (eso lo hace el script de npm)
    const { status, stderr } = spawnSync(process.execPath, ['src/ai/medir-triaje.js'], { env: {}, encoding: 'utf8', cwd: join(import.meta.dirname, '..') });
    assert.equal(status, 1);
    assert.match(stderr, /Falta GEMINI_API_KEY o GEMINI_MODEL/);
  });
});
