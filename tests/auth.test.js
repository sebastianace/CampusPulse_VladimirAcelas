// =====================================================================
// TESTS DEL INICIO DE SESIÓN (node:test)
// ---------------------------------------------------------------------
// Levanta el servidor con una base y un archivo de usuarios temporales
// y prueba registro, login, rutas protegidas y cierre de sesión.
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-auth-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
process.env.AUTH_PATH = join(CARPETA, 'auth.json');
const { app } = await import('../src/server.js');

let servidor;
let base;
before(() => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
});
after(() => {
  servidor.close();
  rmSync(CARPETA, { recursive: true, force: true });
});

// Hace la petición y devuelve {status, cuerpo, cookie}.
async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie },
    body: cuerpo && JSON.stringify(cuerpo),
  });
  return {
    status: respuesta.status,
    cuerpo: await respuesta.json(),
    cookie: respuesta.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}

const ANA = { usuario: 'ana.gomez', nombre: 'Ana Gómez', clave: 'segura-123' };

test('sin sesión, la API responde 401 SESION_REQUERIDA', async () => {
  const { status, cuerpo } = await pedir('/api/espacios');
  assert.equal(status, 401);
  assert.equal(cuerpo.error.codigo, 'SESION_REQUERIDA');
});

test('registro: crea la cuenta, abre sesión y no guarda la clave en texto plano', async () => {
  const { status, cuerpo, cookie } = await pedir('/api/auth/registro', 'POST', ANA);
  assert.equal(status, 201);
  assert.deepEqual(cuerpo, { usuario: 'ana.gomez', nombre: 'Ana Gómez', rol: 'admin' }); // primera cuenta
  assert.match(cookie, /^sesion=/);
  assert.equal((await pedir('/api/espacios', 'GET', null, cookie)).status, 200);
  assert.ok(!readFileSync(process.env.AUTH_PATH, 'utf8').includes(ANA.clave));
});

test('registro: usuario repetido -> 409 y datos inválidos -> 422', async () => {
  assert.equal((await pedir('/api/auth/registro', 'POST', ANA)).cuerpo.error.codigo, 'USUARIO_EXISTE');
  assert.equal((await pedir('/api/auth/registro', 'POST', { ...ANA, usuario: 'otra', clave: 'corta' })).status, 422);
  assert.equal((await pedir('/api/auth/registro', 'POST', { ...ANA, usuario: 'Con Espacios' })).status, 422);
});

test('login: clave correcta abre sesión; clave o usuario incorrectos -> 401', async () => {
  const ok = await pedir('/api/auth/login', 'POST', { usuario: 'ANA.GOMEZ', clave: ANA.clave });
  assert.equal(ok.status, 200);
  assert.equal((await pedir('/api/auth/yo', 'GET', null, ok.cookie)).cuerpo.usuario, 'ana.gomez');
  for (const malo of [{ usuario: 'ana.gomez', clave: 'otra-clave' }, { usuario: 'nadie', clave: ANA.clave }]) {
    const { status, cuerpo } = await pedir('/api/auth/login', 'POST', malo);
    assert.equal(status, 401);
    assert.equal(cuerpo.error.codigo, 'CREDENCIALES_INVALIDAS');
  }
});

test('la cookie de sesión es Secure solo cuando NODE_ENV=production', async () => {
  // Devuelve la cabecera set-cookie completa de un login correcto.
  const cookieDeLogin = async () => (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: ANA.usuario, clave: ANA.clave }),
  })).headers.get('set-cookie');

  const anterior = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    const desarrollo = await cookieDeLogin();
    assert.match(desarrollo, /HttpOnly/);
    assert.doesNotMatch(desarrollo, /Secure/);

    process.env.NODE_ENV = 'production';
    const produccion = await cookieDeLogin();
    assert.match(produccion, /HttpOnly/);
    assert.match(produccion, /Secure/);
  } finally {
    if (anterior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = anterior;
  }
});

test('logout: la sesión deja de servir', async () => {
  const { cookie } = await pedir('/api/auth/login', 'POST', { usuario: ANA.usuario, clave: ANA.clave });
  assert.equal((await pedir('/api/auth/logout', 'POST', null, cookie)).status, 200);
  assert.equal((await pedir('/api/espacios', 'GET', null, cookie)).status, 401);
});
