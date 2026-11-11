// =====================================================================
// TEST DE LOS ESPACIOS EXTRA (data/seed/espacios-extra.json)
// ---------------------------------------------------------------------
// Las mesas de ping-pong de Hunters no están en el CSV oficial: se suman
// desde seed/ al armar el estado inicial, sin tocar data/raw/.
// =====================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoInicial } from '../src/data/estado-inicial.js';

test('el estado inicial incluye las mesas de ping-pong además de los 9 espacios oficiales', () => {
  const { espacios, calidadDatos } = crearEstadoInicial();
  const ids = espacios.map((e) => e.id);
  assert.ok(ids.includes('ping-pong-1') && ids.includes('ping-pong-2'));
  assert.equal(espacios.length, 11);
  // El reporte de calidad sigue hablando solo del CSV oficial
  assert.equal(calidadDatos.cargados, 9);
});
