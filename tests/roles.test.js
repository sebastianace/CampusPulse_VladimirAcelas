// =====================================================================
// TESTS DE ROLES Y PERMISOS (node:test)
// ---------------------------------------------------------------------
// Roles admin, profesor y soporte_tecnico; middleware exigirRol(...roles).
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

const CLAVE = 'clave-de-prueba-1';
const entrar = (usuario) => pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE });

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

test('la primera cuenta registrada es admin y después el registro público se cierra', async () => {
  const admin = await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE });
  assert.equal(admin.status, 201);
  assert.equal(admin.cuerpo.rol, 'admin');
  const segunda = await pedir('/api/auth/registro', 'POST', { usuario: 'intruso', nombre: 'Intruso', clave: CLAVE });
  assert.equal(segunda.status, 403);
  assert.equal(segunda.cuerpo.error.codigo, 'REGISTRO_CERRADO');
});

test('el admin crea profesores y soporte técnico, y ellos pueden entrar', async () => {
  const admin = await entrar('jefa');
  for (const [usuario, rol] of [['profe', 'profesor'], ['tecnico', 'soporte_tecnico']]) {
    const creada = await pedir('/api/usuarios', 'POST', { usuario, nombre: usuario, clave: CLAVE, rol }, admin.cookie);
    assert.equal(creada.status, 201);
    assert.deepEqual(creada.cuerpo, { usuario, nombre: usuario, rol });
    assert.equal((await entrar(usuario)).cuerpo.rol, rol);
  }
});

test('el admin no puede crear otro admin ni un rol que no existe (422)', async () => {
  const admin = await entrar('jefa');
  for (const rol of ['admin', 'camper', undefined]) {
    const { status } = await pedir('/api/usuarios', 'POST', { usuario: 'nuevo', nombre: 'Nuevo', clave: CLAVE, rol }, admin.cookie);
    assert.equal(status, 422, `rol ${rol}`);
  }
});

test('profesor y soporte técnico no pueden crear cuentas (403) y sin sesión es 401', async () => {
  for (const usuario of ['profe', 'tecnico']) {
    const { cookie } = await entrar(usuario);
    const { status, cuerpo } = await pedir('/api/usuarios', 'POST', { usuario: 'x-nuevo', nombre: 'X', clave: CLAVE, rol: 'profesor' }, cookie);
    assert.equal(status, 403, usuario);
    assert.equal(cuerpo.error.codigo, 'PERMISO_DENEGADO');
  }
  assert.equal((await pedir('/api/usuarios', 'POST', {})).status, 401);
});

test('POST /api/restaurar: solo admin (profesor y soporte -> 403, sin sesión -> 401)', async () => {
  for (const usuario of ['profe', 'tecnico']) {
    assert.equal((await pedir('/api/restaurar', 'POST', null, (await entrar(usuario)).cookie)).status, 403, usuario);
  }
  assert.equal((await pedir('/api/restaurar', 'POST', null, (await entrar('jefa')).cookie)).status, 200);
  assert.equal((await pedir('/api/restaurar', 'POST')).status, 401);
});

test('resolver una incidencia: admin y soporte técnico sí; profesor -> 403', async () => {
  const profe = await entrar('profe');
  const crear = () => pedir('/api/incidencias', 'POST', {
    descripcion: 'El proyector no enciende', categoria: 'tecnologia', prioridad: 'media',
    area: 'Soporte TI', espacioId: 'apolo', inhabilitar: false, origen: 'manual',
  }, profe.cookie);

  const primera = await crear();
  assert.equal(primera.status, 201, 'el profesor sí puede reportar');
  const prohibido = await pedir(`/api/incidencias/${primera.cuerpo.id}`, 'PATCH', { estado: 'resuelta' }, profe.cookie);
  assert.equal(prohibido.status, 403);
  assert.equal(prohibido.cuerpo.error.codigo, 'PERMISO_DENEGADO');

  const tecnico = await entrar('tecnico');
  assert.equal((await pedir(`/api/incidencias/${primera.cuerpo.id}`, 'PATCH', { estado: 'resuelta' }, tecnico.cookie)).status, 200);

  const segunda = await crear();
  assert.equal((await pedir(`/api/incidencias/${segunda.cuerpo.id}`, 'PATCH', { estado: 'resuelta' }, (await entrar('jefa')).cookie)).status, 200);
});

test('una cuenta antigua con rol camper, coordinador o sin rol se trata como profesor', async () => {
  const auth = JSON.parse(readFileSync(process.env.AUTH_PATH, 'utf8'));
  auth.usuarios.find((u) => u.usuario === 'profe').rol = 'camper';
  auth.usuarios.find((u) => u.usuario === 'tecnico').rol = 'coordinador';
  writeFileSync(process.env.AUTH_PATH, JSON.stringify(auth));
  assert.equal((await entrar('profe')).cuerpo.rol, 'profesor');
  assert.equal((await entrar('tecnico')).cuerpo.rol, 'profesor');

  delete auth.usuarios.find((u) => u.usuario === 'profe').rol;
  writeFileSync(process.env.AUTH_PATH, JSON.stringify(auth));
  assert.equal((await entrar('profe')).cuerpo.rol, 'profesor');
});

test('exigirRol deja pasar a los roles indicados', () => {
  assert.equal(probarMiddleware(exigirRol('admin'), { usuario: 'a', rol: 'admin' }), null);
  assert.equal(probarMiddleware(exigirRol('admin', 'soporte_tecnico'), { usuario: 's', rol: 'soporte_tecnico' }), null);
});

test('exigirRol responde 403 PERMISO_DENEGADO a los demás roles', () => {
  const error = probarMiddleware(exigirRol('admin', 'soporte_tecnico'), { usuario: 'p', rol: 'profesor' });
  assert.equal(error.status, 403);
  assert.equal(error.codigo, 'PERMISO_DENEGADO');
});

test('exigirRol sin usuario en la petición responde 401', () => {
  const error = probarMiddleware(exigirRol('admin'), undefined);
  assert.equal(error.status, 401);
});
