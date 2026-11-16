// =====================================================================
// TEST DEL FORMATO DE ERRORES DE LA API (node:test)
// ---------------------------------------------------------------------
// Levanta el servidor en un puerto libre con una base temporal y
// comprueba que todos los errores salen como {error: {codigo, mensaje}}.
// =====================================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp(); // la app corre contra una base PostgreSQL temporal
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
after(async () => {
  servidor.close();
  await bd.cerrar();
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
  for (const ruta of ['/api/espacios', '/api/recursos', '/api/reservas', '/api/incidencias']) {
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

test('el campus no presta equipos: /api/prestamos ya no existe (404)', async () => {
  assert.equal((await pedir('/api/prestamos')).status, 404);
  assert.equal((await pedir('/api/prestamos', 'POST', { recursoId: 'rec-01', persona: 'Ana' })).status, 404);
});

test('una incidencia del video beam deja fuera de servicio solo el equipo, también guardado en la base', async () => {
  const videoBeam = (await pedir('/api/recursos')).cuerpo.find((r) => r.tipo === 'video_beam' && r.espacioId && r.estado === 'disponible');
  const { status, cuerpo: creada } = await pedir('/api/incidencias', 'POST', {
    descripcion: 'El video beam no prende', categoria: 'tecnologia', prioridad: 'media', area: 'Soporte TI',
    espacioId: videoBeam.espacioId, recursoId: videoBeam.id, inhabilitar: true, origen: 'manual',
  });
  assert.equal(status, 201);
  const estadoSala = async () => (await pedir('/api/espacios')).cuerpo.find((e) => e.id === videoBeam.espacioId).estado;
  const estadoEquipo = async () => (await pedir('/api/recursos')).cuerpo.find((r) => r.id === videoBeam.id).estado;
  assert.equal(await estadoSala(), 'disponible');
  assert.equal(await estadoEquipo(), 'en_reparacion');
  // La columna inhabilito_espacio se guarda y se lee de PostgreSQL
  const guardada = (await pedir('/api/incidencias')).cuerpo.find((i) => i.id === creada.id);
  assert.equal(guardada.inhabilito, true);
  assert.equal(guardada.inhabilitoEspacio, false);

  assert.equal((await pedir(`/api/incidencias/${creada.id}`, 'PATCH', { estado: 'resuelta' })).status, 200);
  assert.equal(await estadoEquipo(), 'disponible');
  assert.equal(await estadoSala(), 'disponible');
});
