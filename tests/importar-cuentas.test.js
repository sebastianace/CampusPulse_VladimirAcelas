// =====================================================================
// TESTS DEL IMPORTADOR DE CUENTAS (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Copian las cuentas de un data/auth.json de la versión anterior a la tabla usuarios.
// =====================================================================

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { importarCuentas } = await import('../src/data/importar-cuentas.js');
const { autenticar } = await import('../src/auth/usuarios.js');

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-importar-'));
after(async () => {
  await bd.cerrar();
  rmSync(CARPETA, { recursive: true, force: true });
});
beforeEach(async () => { await bd.pool.query('TRUNCATE usuarios CASCADE'); });

// Hash en el formato de la versión anterior: "sal:scrypt".
function hashAntiguo(clave) {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(clave, sal, 64).toString('hex')}`;
}

// Escribe un auth.json de la versión anterior y devuelve su ruta.
function archivo(usuarios, nombre = 'auth.json') {
  const ruta = join(CARPETA, nombre);
  writeFileSync(ruta, JSON.stringify({ usuarios, sesiones: [{ token: 'x', usuario: 'ana', expira: 1 }] }));
  return ruta;
}

const roles = async () => Object.fromEntries((await bd.pool.query('SELECT usuario, rol FROM usuarios')).rows.map((f) => [f.usuario, f.rol]));

describe('importarCuentas', () => {
  test('copia las cuentas y quien tenía una contraseña sigue entrando con la misma', async () => {
    const ruta = archivo([
      { usuario: 'jefa', nombre: 'Jefa', rol: 'admin', clave: hashAntiguo('clave-de-la-jefa') },
      { usuario: 'luis', nombre: 'Luis', rol: 'soporte_tecnico', clave: hashAntiguo('clave-de-luis') },
    ]);
    assert.deepEqual(await importarCuentas(bd.pool, ruta), { importadas: 2, yaExistian: 0, adminAscendido: null });
    assert.deepEqual(await roles(), { jefa: 'admin', luis: 'soporte_tecnico' });
    assert.deepEqual(await autenticar({ usuario: 'luis', clave: 'clave-de-luis' }), { usuario: 'luis', nombre: 'Luis', rol: 'soporte_tecnico' });
    await assert.rejects(autenticar({ usuario: 'luis', clave: 'otra-clave-cualquiera' }), { codigo: 'CREDENCIALES_INVALIDAS' });
  });

  test('un rol que ya no existe (camper, coordinador) o ausente pasa a profesor', async () => {
    const ruta = archivo([
      { usuario: 'jefa', nombre: 'Jefa', rol: 'admin', clave: hashAntiguo('x1x1x1x1') },
      { usuario: 'a', nombre: 'A', rol: 'camper', clave: hashAntiguo('x2x2x2x2') },
      { usuario: 'b', nombre: 'B', rol: 'coordinador', clave: hashAntiguo('x3x3x3x3') },
      { usuario: 'c', nombre: 'C', clave: hashAntiguo('x4x4x4x4') },
    ]);
    await importarCuentas(bd.pool, ruta);
    assert.deepEqual(await roles(), { jefa: 'admin', a: 'profesor', b: 'profesor', c: 'profesor' });
  });

  test('si no queda ningún admin, la primera cuenta importada pasa a serlo', async () => {
    const ruta = archivo([
      { usuario: 'primera', nombre: 'Primera', clave: hashAntiguo('x1x1x1x1') },
      { usuario: 'segunda', nombre: 'Segunda', rol: 'camper', clave: hashAntiguo('x2x2x2x2') },
    ]);
    const resultado = await importarCuentas(bd.pool, ruta);
    assert.equal(resultado.adminAscendido, 'primera');
    assert.deepEqual(await roles(), { primera: 'admin', segunda: 'profesor' });
  });

  test('correrlo dos veces no duplica ni pisa una cuenta que ya existe', async () => {
    const ruta = archivo([{ usuario: 'jefa', nombre: 'Jefa', rol: 'admin', clave: hashAntiguo('clave-original') }]);
    await importarCuentas(bd.pool, ruta);
    const otra = archivo([{ usuario: 'jefa', nombre: 'Cambiada', rol: 'profesor', clave: hashAntiguo('otra-clave-distinta') }], 'otra.json');
    assert.deepEqual(await importarCuentas(bd.pool, otra), { importadas: 0, yaExistian: 1, adminAscendido: null });
    assert.deepEqual(await roles(), { jefa: 'admin' });
    assert.equal((await autenticar({ usuario: 'jefa', clave: 'clave-original' })).nombre, 'Jefa');
  });

  test('no importa las sesiones', async () => {
    await importarCuentas(bd.pool, archivo([{ usuario: 'jefa', nombre: 'Jefa', rol: 'admin', clave: hashAntiguo('x1x1x1x1') }]));
    assert.equal((await bd.pool.query('SELECT count(*)::int AS n FROM sesiones')).rows[0].n, 0);
  });

  test('si algo falla a mitad, no se importa nada', async () => {
    const ruta = archivo([
      { usuario: 'buena', nombre: 'Buena', rol: 'admin', clave: hashAntiguo('x1x1x1x1') },
      { usuario: 'rota', nombre: null, rol: 'admin', clave: hashAntiguo('x2x2x2x2') }, // nombre obligatorio: la base lo rechaza
    ]);
    await assert.rejects(importarCuentas(bd.pool, ruta));
    assert.deepEqual(await roles(), {});
  });

  test('un archivo que no existe da un error claro', async () => {
    await assert.rejects(importarCuentas(bd.pool, join(CARPETA, 'no-existe.json')), /No existe/);
  });
});
