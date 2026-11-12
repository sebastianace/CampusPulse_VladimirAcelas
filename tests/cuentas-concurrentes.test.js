// =====================================================================
// TESTS DE CUENTAS CON PETICIONES SIMULTÁNEAS (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Con data/auth.json bastaba con que Node atendiera una escritura a la vez. Con PostgreSQL dos
// registros pueden llegar juntos, y sin cuidado ambos verían "no hay cuentas" y serían admin.
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');

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

async function pedir(ruta, metodo, cuerpo, cookie = '') {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(cuerpo),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json(), cookie: respuesta.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

const CLAVE = 'clave-de-prueba-1';
const contar = async (sql) => (await bd.pool.query(sql)).rows[0].n;

test('cinco registros a la vez en una base sin cuentas: solo uno se crea (admin) y los otros reciben 403', async () => {
  const resultados = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    pedir('/api/auth/registro', 'POST', { usuario: `persona${i}`, nombre: `Persona ${i}`, clave: CLAVE })));

  assert.equal(resultados.filter((r) => r.status === 201).length, 1);
  assert.equal(resultados.filter((r) => r.status === 403 && r.cuerpo.error.codigo === 'REGISTRO_CERRADO').length, 4);
  assert.equal(await contar('SELECT count(*)::int AS n FROM usuarios'), 1);
  assert.equal(await contar("SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'"), 1, 'exactamente un admin');
});

test('el admin crea el mismo usuario dos veces a la vez: una cuenta y un 409 USUARIO_EXISTE', async () => {
  const [ganador] = (await bd.pool.query('SELECT usuario FROM usuarios')).rows;
  const { cookie } = await pedir('/api/auth/login', 'POST', { usuario: ganador.usuario, clave: CLAVE });
  const nueva = { usuario: 'profe.repetido', nombre: 'Profe', clave: CLAVE, rol: 'profesor' };
  const resultados = await Promise.all([pedir('/api/usuarios', 'POST', nueva, cookie), pedir('/api/usuarios', 'POST', nueva, cookie)]);

  assert.deepEqual(resultados.map((r) => r.status).sort(), [201, 409]);
  assert.equal(resultados.find((r) => r.status === 409).cuerpo.error.codigo, 'USUARIO_EXISTE');
  assert.equal(await contar("SELECT count(*)::int AS n FROM usuarios WHERE usuario = 'profe.repetido'"), 1);
});
