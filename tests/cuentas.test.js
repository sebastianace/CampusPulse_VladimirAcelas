// =====================================================================
// TESTS DE CUENTAS Y CONTRASEÑAS (node:test)
// ---------------------------------------------------------------------
// Quién creó cada cuenta, admins que crean admins, contraseña temporal
// (la pone un admin o npm run restablecer-admin), "Cambiar mi contraseña"
// y la lista de nombres para sugerir el responsable de una reserva.
// Base PostgreSQL temporal (docker compose up -d db).
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { restablecerAdmin } = await import('../src/auth/restablecer-admin.js');

let servidor;
let base;
before(() => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
});
after(async () => {
  servidor.close();
  await bd.cerrar();
});

async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
  return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const CLAVE = 'clave-de-prueba-1';
const entrar = (usuario, clave = CLAVE) => pedir('/api/auth/login', 'POST', { usuario, clave });

test('la primera cuenta se registra sola; las demás guardan qué admin las creó, y un admin crea otros admins', async () => {
  const jefa = await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE });
  const segunda = await pedir('/api/usuarios', 'POST', { usuario: 'diego', nombre: 'Diego', clave: CLAVE, rol: 'admin' }, jefa.cookie);
  assert.equal(segunda.status, 201);
  assert.equal(segunda.cuerpo.rol, 'admin');
  const diego = await entrar('diego');
  await pedir('/api/usuarios', 'POST', { usuario: 'ana', nombre: 'Ana', clave: CLAVE, rol: 'profesor' }, diego.cookie);

  const cuentas = (await pedir('/api/usuarios', 'GET', undefined, jefa.cookie)).cuerpo;
  const de = (u) => cuentas.find((c) => c.usuario === u);
  assert.equal(de('jefa').creadoPor, null, 'la primera cuenta se registró sola');
  assert.deepEqual([de('diego').creadoPor, de('diego').creadoPorNombre], ['jefa', 'Jefa']);
  assert.deepEqual([de('ana').creadoPor, de('ana').creadoPorNombre], ['diego', 'Diego']);
  assert.match(de('ana').creado, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('cualquier sesión ve los nombres de las cuentas (para sugerir el responsable), sin roles ni claves', async () => {
  const ana = await entrar('ana');
  const { status, cuerpo } = await pedir('/api/usuarios/nombres', 'GET', undefined, ana.cookie);
  assert.equal(status, 200);
  assert.deepEqual(cuerpo.map((u) => Object.keys(u).join()), ['usuario,nombre', 'usuario,nombre', 'usuario,nombre']);
  assert.equal((await pedir('/api/usuarios', 'GET', undefined, ana.cookie)).status, 403, 'la lista completa sigue siendo solo admin');
});

test('contraseña temporal: cierra sus sesiones, la vieja deja de servir y la app queda bloqueada hasta cambiarla', async () => {
  const jefa = await entrar('jefa');
  const anaAntes = await entrar('ana');
  assert.equal((await pedir('/api/usuarios/ana/clave', 'POST', undefined, anaAntes.cookie)).status, 403, 'un profesor no restablece');

  const { status, cuerpo } = await pedir('/api/usuarios/ana/clave', 'POST', undefined, jefa.cookie);
  assert.equal(status, 200);
  assert.match(cuerpo.claveTemporal, /^[a-zA-Z0-9]{12}$/);
  assert.equal((await pedir('/api/espacios', 'GET', undefined, anaAntes.cookie)).status, 401, 'su sesión abierta se cerró');
  assert.equal((await entrar('ana')).status, 401, 'la contraseña vieja ya no sirve');

  const ana = await entrar('ana', cuerpo.claveTemporal);
  assert.equal(ana.cuerpo.debeCambiarClave, true);
  const bloqueada = await pedir('/api/espacios', 'GET', undefined, ana.cookie);
  assert.deepEqual([bloqueada.status, bloqueada.cuerpo.error.codigo], [403, 'CAMBIO_DE_CLAVE_REQUERIDO']);
  assert.equal((await pedir('/api/auth/yo', 'GET', undefined, ana.cookie)).cuerpo.debeCambiarClave, true);

  assert.equal((await pedir('/api/auth/clave', 'POST', { claveActual: 'otra-cosa', claveNueva: 'nueva-clave-1' }, ana.cookie)).status, 401);
  assert.equal((await pedir('/api/auth/clave', 'POST', { claveActual: cuerpo.claveTemporal, claveNueva: 'corta' }, ana.cookie)).status, 422);
  assert.equal((await pedir('/api/auth/clave', 'POST', { claveActual: cuerpo.claveTemporal, claveNueva: 'nueva-clave-1' }, ana.cookie)).status, 200);
  assert.equal((await pedir('/api/espacios', 'GET', undefined, ana.cookie)).status, 200, 'ya puede usar la app con la misma sesión');
  assert.equal((await entrar('ana', 'nueva-clave-1')).cuerpo.debeCambiarClave, undefined);
});

test('"Cambiar mi contraseña" cierra las otras sesiones; la propia no se restablece como temporal (409)', async () => {
  const jefa = await entrar('jefa');
  const otraJefa = await entrar('jefa');
  assert.equal((await pedir('/api/usuarios/jefa/clave', 'POST', undefined, jefa.cookie)).cuerpo.error.codigo, 'USA_CAMBIAR_CLAVE');
  assert.equal((await pedir('/api/auth/clave', 'POST', { claveActual: CLAVE, claveNueva: 'clave-nueva-jefa' }, jefa.cookie)).status, 200);
  assert.equal((await pedir('/api/espacios', 'GET', undefined, jefa.cookie)).status, 200);
  assert.equal((await pedir('/api/espacios', 'GET', undefined, otraJefa.cookie)).status, 401, 'la otra sesión se cerró');
  assert.equal((await pedir('/api/usuarios/nadie/clave', 'POST', undefined, jefa.cookie)).status, 404);
});

test('npm run restablecer-admin: lista los admins y solo restablece admins', async () => {
  const { admins } = await restablecerAdmin(bd.pool);
  assert.deepEqual(admins.map((a) => a.usuario), ['jefa', 'diego']);
  await assert.rejects(restablecerAdmin(bd.pool, 'ana'), /no es admin/);
  await assert.rejects(restablecerAdmin(bd.pool, 'nadie'), /No existe/);
  const { claveTemporal } = await restablecerAdmin(bd.pool, 'jefa');
  assert.equal((await entrar('jefa', claveTemporal)).cuerpo.debeCambiarClave, true);
});
