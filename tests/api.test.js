// =====================================================================
// TEST DEL FORMATO DE ERRORES DE LA API (node:test)
// ---------------------------------------------------------------------
// Levanta el servidor en un puerto libre con una base temporal y
// comprueba que todos los errores salen como {error: {codigo, mensaje}}.
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARPETA = mkdtempSync(join(tmpdir(), 'campus-pulse-api-'));
process.env.DB_PATH = join(CARPETA, 'db.json');
process.env.AUTH_PATH = join(CARPETA, 'auth.json');
const { app } = await import('../src/server.js');

let servidor;
let base;
let cookie = ''; // la API exige sesión: se crea una cuenta de prueba antes de los tests
before(async () => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
  const registro = await fetch(`${base}/api/auth/registro`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'prueba', nombre: 'Prueba', clave: 'clave-de-prueba' }),
  });
  cookie = registro.headers.get('set-cookie').split(';')[0];
});
after(() => {
  servidor.close();
  rmSync(CARPETA, { recursive: true, force: true });
});

// Hace la petición y devuelve {status, cuerpo}.
async function pedir(ruta, metodo = 'GET', cuerpo) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie },
    body: typeof cuerpo === 'string' ? cuerpo : cuerpo && JSON.stringify(cuerpo),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

test('las rutas GET responden 200 con listas', async () => {
  for (const ruta of ['/api/espacios', '/api/recursos', '/api/reservas', '/api/prestamos', '/api/incidencias']) {
    const { status, cuerpo } = await pedir(ruta);
    assert.equal(status, 200, ruta);
    assert.ok(Array.isArray(cuerpo), ruta);
  }
});

test('datos mal formados -> 422 con {error:{codigo, mensaje}}', async () => {
  const { status, cuerpo } = await pedir('/api/reservas', 'POST', { asistentes: 0 });
  assert.equal(status, 422);
  assert.equal(typeof cuerpo.error.codigo, 'string');
  assert.equal(typeof cuerpo.error.mensaje, 'string');
});

test('JSON inválido -> 422 y ruta inexistente -> 404', async () => {
  assert.equal((await pedir('/api/reservas', 'POST', '{mal json')).cuerpo.error.codigo, 'JSON_INVALIDO');
  const { status, cuerpo } = await pedir('/api/no-existe');
  assert.equal(status, 404);
  assert.equal(cuerpo.error.codigo, 'RUTA_NO_ENCONTRADA');
});

test('regla de negocio violada -> 409', async () => {
  // Un recurso semilla dañado no se puede prestar (si el seed tiene alguno).
  const recursos = (await pedir('/api/recursos')).cuerpo;
  const danado = recursos.find((r) => r.estado === 'danado');
  if (!danado) return; // sin recursos dañados en el seed no hay caso que probar
  const { status, cuerpo } = await pedir('/api/prestamos', 'POST', { recursoId: danado.id, persona: 'Ana' });
  assert.equal(status, 409);
  assert.equal(cuerpo.error.codigo, 'TRANSICION_INVALIDA');
});
