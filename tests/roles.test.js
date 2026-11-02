// =====================================================================
// TESTS DE ROLES Y PERMISOS (node:test)
// ---------------------------------------------------------------------
// Roles admin, coordinador y camper; middleware exigirRol(...roles).
// Levanta el servidor con una base y un archivo de usuarios temporales.
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-roles-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
process.env.AUTH_PATH = join(CARPETA, 'auth.json');
const { app } = await import('../src/server.js');
const { exigirRol } = await import('../src/routes/auth.js');

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

// Ejecuta el middleware con un usuario falso y devuelve el error lanzado (o null si pasó).
function probarMiddleware(middleware, usuario) {
  let paso = false;
  try {
    middleware({ usuario }, {}, () => { paso = true; });
  } catch (error) {
    return error;
  }
  assert.ok(paso, 'si no lanza error, debe llamar a next()');
  return null;
}

test('el primer usuario registrado es admin y los siguientes son camper', async () => {
  const admin = await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: 'clave-admin-1' });
  assert.equal(admin.cuerpo.rol, 'admin');
  const camper = await pedir('/api/auth/registro', 'POST', { usuario: 'luis', nombre: 'Luis', clave: 'clave-camper-1' });
  assert.equal(camper.cuerpo.rol, 'camper');
  assert.equal((await pedir('/api/auth/yo', 'GET', null, camper.cookie)).cuerpo.rol, 'camper');
});

test('una cuenta antigua sin rol se trata como camper', async () => {
  await pedir('/api/auth/registro', 'POST', { usuario: 'antigua', nombre: 'Antigua', clave: 'clave-antigua' });
  const auth = JSON.parse(readFileSync(process.env.AUTH_PATH, 'utf8'));
  delete auth.usuarios.find((u) => u.usuario === 'antigua').rol;
  writeFileSync(process.env.AUTH_PATH, JSON.stringify(auth));
  const { cuerpo } = await pedir('/api/auth/login', 'POST', { usuario: 'antigua', clave: 'clave-antigua' });
  assert.equal(cuerpo.rol, 'camper');
});

test('POST /api/restaurar: camper -> 403, admin -> 200, sin sesión -> 401', async () => {
  const camper = await pedir('/api/auth/login', 'POST', { usuario: 'luis', clave: 'clave-camper-1' });
  const prohibido = await pedir('/api/restaurar', 'POST', null, camper.cookie);
  assert.equal(prohibido.status, 403);
  assert.equal(prohibido.cuerpo.error.codigo, 'PERMISO_DENEGADO');

  const admin = await pedir('/api/auth/login', 'POST', { usuario: 'jefa', clave: 'clave-admin-1' });
  assert.equal((await pedir('/api/restaurar', 'POST', null, admin.cookie)).status, 200);

  assert.equal((await pedir('/api/restaurar', 'POST')).status, 401);
});

test('exigirRol deja pasar a los roles indicados', () => {
  assert.equal(probarMiddleware(exigirRol('admin'), { usuario: 'a', rol: 'admin' }), null);
  assert.equal(probarMiddleware(exigirRol('admin', 'coordinador'), { usuario: 'c', rol: 'coordinador' }), null);
});

test('exigirRol responde 403 PERMISO_DENEGADO a los demás roles', () => {
  const error = probarMiddleware(exigirRol('admin', 'coordinador'), { usuario: 'c', rol: 'camper' });
  assert.equal(error.status, 403);
  assert.equal(error.codigo, 'PERMISO_DENEGADO');
});

test('exigirRol sin usuario en la petición responde 401', () => {
  const error = probarMiddleware(exigirRol('admin'), undefined);
  assert.equal(error.status, 401);
});
