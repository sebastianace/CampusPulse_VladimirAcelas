// =====================================================================
// TEST DE LOS ESPACIOS EXTRA (data/seed/espacios-extra.json)
// ---------------------------------------------------------------------
// Las mesas de ping-pong de Hunters no están en el CSV oficial: se suman
// desde seed/ al crear la base, sin tocar data/raw/.
// =====================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-extra-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
const { restaurarDB } = await import('../src/data/store.js');

test('la base incluye las mesas de ping-pong además de los 9 espacios oficiales', () => {
  try {
    const { espacios, calidadDatos } = restaurarDB();
    const ids = espacios.map((e) => e.id);
    assert.ok(ids.includes('ping-pong-1') && ids.includes('ping-pong-2'));
    assert.equal(espacios.length, 11);
    // El reporte de calidad sigue hablando solo del CSV oficial
    assert.equal(calidadDatos.cargados, 9);
  } finally {
    rmSync(CARPETA, { recursive: true, force: true });
  }
});
