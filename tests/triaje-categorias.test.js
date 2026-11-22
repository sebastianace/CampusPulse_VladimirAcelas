// =====================================================================
// TESTS: SOLO INFRAESTRUCTURA Y TECNOLOGÍA (node:test)
// ---------------------------------------------------------------------
// En el campus hay 2 técnicos de TI, uno por categoría. La IA marca con
// paraTI: false lo que TI no resuelve (aseo, seguridad, bienestar...) y la
// validación deja la categoría en null. No llaman a Gemini.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { CATEGORIAS, CATEGORIAS_ANTERIORES, REGLAS } = await import('../src/config/reglas.js');
const { validarTriaje } = await import('../src/ai/validar.js');
const { crearSchema, avisoFueraDeTI } = await import('../src/ai/triaje.js');

const CATALOGO = { espacios: [{ id: 'apolo' }], recursos: [{ id: 'rec-01' }] };
const base = { prioridad: 'media', espacioId: 'apolo', recursoId: null, inhabilitar: false, razon: 'x' };

describe('Categorías de incidencia', () => {
  test('solo quedan infraestructura y tecnología; las anteriores se guardan aparte', () => {
    assert.deepEqual(CATEGORIAS, ['infraestructura', 'tecnologia']);
    assert.deepEqual(CATEGORIAS_ANTERIORES, ['aseo', 'seguridad', 'bienestar', 'otro']);
    assert.ok(!CATEGORIAS.some((c) => CATEGORIAS_ANTERIORES.includes(c)));
  });
});

describe('validarTriaje con paraTI', () => {
  test('un reporte para TI conserva su categoría', () => {
    const t = validarTriaje({ ...base, paraTI: true, categoria: 'tecnologia' }, CATALOGO);
    assert.equal(t.paraTI, true);
    assert.equal(t.categoria, 'tecnologia');
  });

  test('un reporte que no es para TI queda sin categoría aunque la IA mande una', () => {
    const t = validarTriaje({ ...base, paraTI: false, categoria: 'infraestructura' }, CATALOGO);
    assert.equal(t.paraTI, false);
    assert.equal(t.categoria, null);
  });

  test('una categoría anterior (aseo) ya no se acepta: queda en null para elegirla a mano', () => {
    assert.equal(validarTriaje({ ...base, paraTI: true, categoria: 'aseo' }, CATALOGO).categoria, null);
  });

  test('si la IA no dice paraTI, se asume que sí: la persona decide en el formulario', () => {
    const t = validarTriaje({ ...base, categoria: 'infraestructura' }, CATALOGO);
    assert.equal(t.paraTI, true);
    assert.equal(t.categoria, 'infraestructura');
  });
});

describe('Schema y aviso', () => {
  const schema = crearSchema({ espacios: [{ id: 'apolo' }], recursos: [{ id: 'rec-01' }] });

  test('paraTI es obligatorio y va primero; la categoría puede ser null', () => {
    assert.equal(schema.propertyOrdering[0], 'paraTI');
    assert.ok(schema.required.includes('paraTI'));
    assert.equal(schema.properties.paraTI.type, 'BOOLEAN');
    assert.deepEqual(schema.properties.categoria.enum, CATEGORIAS);
    assert.equal(schema.properties.categoria.nullable, true);
  });

  test('el aviso dice a quién acudir (configurable en reglas.js)', () => {
    assert.ok(avisoFueraDeTI().includes(REGLAS.CONTACTO_FUERA_DE_TI));
    assert.match(avisoFueraDeTI(), /Soporte TI no lo atiende/);
  });
});
