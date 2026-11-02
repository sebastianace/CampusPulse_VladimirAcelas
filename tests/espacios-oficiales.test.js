// =====================================================================
// TEST DEL CSV OFICIAL DE ESPACIOS (node:test)
// ---------------------------------------------------------------------
// Verifica que data/raw/espacios.csv, con la capacidad instalada que
// compartió la organización, se carga completo y sin inconsistencias.
// Si alguien modifica o daña el archivo oficial por error, este test
// lo detecta antes de la demo.
// =====================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cargarEspacios } from '../src/data/loader.js';

const RUTA_CSV = fileURLToPath(new URL('../data/raw/espacios.csv', import.meta.url));

// Capacidad instalada compartida por la organización de la hackatón.
const CAPACIDAD_OFICIAL = {
  'Auditorio': 100,
  'Cosmos': 25,
  'Skilab': 20,
  'Spooki': 38,
  'Apolo': 34,
  'Blanca': 12,
  'Azul': 10,
  'Amarillas verdes': 6,
  'Artemis': 32,
};

test('el CSV oficial carga los 9 espacios sin registros inconsistentes', () => {
  const { calidad } = cargarEspacios(RUTA_CSV);
  assert.equal(calidad.cargados, 9);
  assert.equal(calidad.validos, 9);
  assert.deepEqual(calidad.inconsistentes, []);
});

test('cada espacio tiene el aforo oficial y queda disponible', () => {
  const { espacios } = cargarEspacios(RUTA_CSV);
  const aforos = Object.fromEntries(espacios.map((e) => [e.nombre, e.aforo]));
  assert.deepEqual(aforos, CAPACIDAD_OFICIAL);
  assert.ok(espacios.every((e) => e.estado === 'disponible'));
});

test('los IDs se generan a partir del nombre', () => {
  const ids = cargarEspacios(RUTA_CSV).espacios.map((e) => e.id);
  assert.ok(ids.includes('amarillas-verdes'));
  assert.equal(new Set(ids).size, 9); // sin IDs repetidos
});
