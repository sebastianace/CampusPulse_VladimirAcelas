// =====================================================================
// TESTS DEL LÍMITE DE INTENTOS DE LOGIN (node:test)
// ---------------------------------------------------------------------
// Primero el módulo src/auth/intentos.js con un reloj simulado (`ahora`)
// y después la ruta POST /api/auth/login con el servidor de verdad.
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-intentos-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
process.env.AUTH_PATH = join(CARPETA, 'auth.json');
const { app } = await import('../src/server.js');
const {
  MAX_INTENTOS_LOGIN, MINUTOS_VENTANA_LOGIN, limpiarFallos, registrarFallo, segundosDeBloqueo,
} = await import('../src/auth/intentos.js');

const MINUTO = 60_000;

describe('Módulo de intentos', () => {
  test(`con ${MAX_INTENTOS_LOGIN} fallos queda bloqueado; con uno menos no`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_INTENTOS_LOGIN - 1; i++) registrarFallo('u1', '1.1.1.1', t0);
    assert.equal(segundosDeBloqueo('u1', '1.1.1.1', t0), 0);
    registrarFallo('u1', '1.1.1.1', t0);
    assert.equal(segundosDeBloqueo('u1', '1.1.1.1', t0), MINUTOS_VENTANA_LOGIN * 60);
  });

  test('el bloqueo se levanta cuando el fallo más antiguo sale de la ventana', () => {
    const t0 = 5_000_000;
    registrarFallo('u2', '1.1.1.1', t0); // el más antiguo
    for (let i = 1; i < MAX_INTENTOS_LOGIN; i++) registrarFallo('u2', '1.1.1.1', t0 + 5 * MINUTO);
    const fin = t0 + MINUTOS_VENTANA_LOGIN * MINUTO;
    assert.equal(segundosDeBloqueo('u2', '1.1.1.1', fin - 1000), 1);
    assert.equal(segundosDeBloqueo('u2', '1.1.1.1', fin), 0);
  });

  test('cuenta por usuario e IP por separado, y limpiarFallos borra el contador', () => {
    const t0 = 9_000_000;
    for (let i = 0; i < MAX_INTENTOS_LOGIN; i++) registrarFallo('u3', '2.2.2.2', t0);
    assert.ok(segundosDeBloqueo('u3', '2.2.2.2', t0) > 0);
    assert.equal(segundosDeBloqueo('u3', '3.3.3.3', t0), 0, 'otra IP');
    assert.equal(segundosDeBloqueo('otro', '2.2.2.2', t0), 0, 'otro usuario');
    limpiarFallos('u3', '2.2.2.2');
    assert.equal(segundosDeBloqueo('u3', '2.2.2.2', t0), 0);
  });
});

describe('POST /api/auth/login', () => {
  let servidor;
  let base;
  before(async () => {
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
    for (const usuario of ['marta', 'pedro', 'sofia']) {
      await login({ usuario, nombre: usuario, clave: 'clave-correcta' }, '/api/auth/registro');
    }
  });
  after(() => {
    servidor.close();
    rmSync(CARPETA, { recursive: true, force: true });
  });

  // Hace la petición y devuelve {status, cuerpo, reintentar}.
  async function login(cuerpo, ruta = '/api/auth/login') {
    const respuesta = await fetch(base + ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    return { status: respuesta.status, cuerpo: await respuesta.json(), reintentar: respuesta.headers.get('retry-after') };
  }

  test(`tras ${MAX_INTENTOS_LOGIN} fallos responde 429, aunque la clave sea correcta`, async () => {
    for (let i = 0; i < MAX_INTENTOS_LOGIN; i++) {
      assert.equal((await login({ usuario: 'marta', clave: 'clave-mala' })).status, 401);
    }
    const bloqueado = await login({ usuario: 'MARTA', clave: 'clave-correcta' });
    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.cuerpo.error.codigo, 'DEMASIADOS_INTENTOS');
    assert.ok(Number(bloqueado.reintentar) > 0, 'cabecera Retry-After');
  });

  test('el bloqueo de un usuario no afecta a otro', async () => {
    assert.equal((await login({ usuario: 'pedro', clave: 'clave-correcta' })).status, 200);
  });

  test('un login correcto reinicia el contador de fallos', async () => {
    for (let i = 0; i < MAX_INTENTOS_LOGIN - 1; i++) await login({ usuario: 'sofia', clave: 'clave-mala' });
    assert.equal((await login({ usuario: 'sofia', clave: 'clave-correcta' })).status, 200);
    for (let i = 0; i < MAX_INTENTOS_LOGIN - 1; i++) await login({ usuario: 'sofia', clave: 'clave-mala' });
    assert.equal((await login({ usuario: 'sofia', clave: 'clave-correcta' })).status, 200);
  });
});
