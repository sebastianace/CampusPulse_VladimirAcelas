// =====================================================================
// TESTS DE DATOS: loader del CSV (node:test)
// ---------------------------------------------------------------------
// Los CSV de prueba se escriben en una carpeta temporal: nunca se toca data/raw/.
// (El almacén de datos en PostgreSQL se prueba en tests/almacen.test.js.)
// =====================================================================

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-'));
const { cargarEspacios } = await import('../src/data/loader.js');

after(() => rmSync(CARPETA, { recursive: true, force: true }));

// Escribe un CSV en la carpeta temporal y devuelve su ruta.
function csv(nombre, contenido) {
  const ruta = join(CARPETA, nombre);
  writeFileSync(ruta, contenido, 'utf8');
  return ruta;
}

describe('Loader del CSV', () => {
  test('carga registros válidos y normaliza nombre y aforo', () => {
    const { espacios, calidad } = cargarEspacios(csv('bueno.csv', '﻿nombre;aforo\n  cosmos ;25\n"Amarillas  verdes";6\n'));
    assert.deepEqual(espacios.map((e) => [e.id, e.nombre, e.aforo, e.estado]), [
      ['cosmos', 'Cosmos', 25, 'disponible'],
      ['amarillas-verdes', 'Amarillas verdes', 6, 'disponible'],
    ]);
    assert.deepEqual(calidad, { cargados: 2, validos: 2, inconsistentes: [] });
  });

  test('marca como inconsistentes duplicados, vacíos, no numéricos y aforo <= 0 sin romperse', () => {
    const contenido = 'nombre,aforo\nCosmos,25\nCOSMOS,30\n,15\nLuna,abc\nMarte,-5\nVenus,0\nSaturno,12.5\nJupiter\n\n';
    const { espacios, calidad } = cargarEspacios(csv('sucio.csv', contenido));
    assert.equal(calidad.cargados, 8);
    assert.equal(calidad.validos, 1);
    assert.deepEqual(calidad.inconsistentes.map((i) => i.fila), [3, 4, 5, 6, 7, 8, 9]);
    // Los que tienen nombre quedan en el mapa como "inconsistente" (no reservables).
    assert.ok(espacios.filter((e) => e.id !== 'cosmos').every((e) => e.estado === 'inconsistente'));
    // El duplicado no crea un segundo Cosmos.
    assert.equal(espacios.filter((e) => e.id === 'cosmos').length, 1);
  });

  test('un archivo inexistente o sin columnas útiles no lanza error', () => {
    assert.equal(cargarEspacios(join(CARPETA, 'no-existe.csv')).espacios.length, 0);
    assert.equal(cargarEspacios(csv('raro.csv', 'a,b\n1,2\n')).calidad.inconsistentes.length, 1);
  });
});
