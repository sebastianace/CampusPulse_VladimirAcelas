// =====================================================================
// TESTS DEL INVENTARIO (node:test)
// ---------------------------------------------------------------------
// Soporte técnico (y el admin) ponen equipos y salas en su estado real.
// Las reglas del dominio se prueban sin base; la API, contra una base
// PostgreSQL temporal (docker compose up -d db).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { actualizarEstadoEspacio, actualizarEstadoRecurso, cambiosManuales } = await import('../src/domain/inventario.js');
const { crearIncidencia } = await import('../src/domain/incidencias.js');

// Base mínima en memoria para las reglas.
function crearDB() {
  return {
    espacios: [
      { id: 'apolo', nombre: 'Apolo', estado: 'disponible' },
      { id: 'raro', nombre: 'Raro', estado: 'inconsistente' },
    ],
    recursos: [
      { id: 'mic', nombre: 'Micrófono', espacioId: 'apolo', estado: 'danado' },
      { id: 'vb', nombre: 'Video beam', espacioId: 'apolo', estado: 'disponible' },
    ],
    reservas: [], prestamos: [], incidencias: [],
  };
}
const incidencia = (cambios) => ({ descripcion: 'Falla', categoria: 'tecnologia', prioridad: 'alta', area: 'Soporte TI', espacioId: 'apolo', ...cambios });

describe('Inventario: reglas', () => {
  test('un micrófono dañado puede volver directo a disponible', () => {
    const db = crearDB();
    assert.equal(actualizarEstadoRecurso(db, 'mic', { estado: 'disponible' }).estado, 'disponible');
  });

  test('un equipo disponible se puede marcar dañado o enviar a reparación', () => {
    for (const estado of ['danado', 'en_reparacion']) {
      assert.equal(actualizarEstadoRecurso(crearDB(), 'vb', { estado }).estado, estado);
    }
  });

  test('"prestado" ya no es un estado: el campus no presta equipos (422)', () => {
    assert.throws(() => actualizarEstadoRecurso(crearDB(), 'vb', { estado: 'prestado' }), { status: 422 });
  });

  test('respeta TRANSICIONES_RECURSO: en reparación no pasa a dañado (409)', () => {
    const db = crearDB();
    db.recursos[1].estado = 'en_reparacion';
    assert.throws(() => actualizarEstadoRecurso(db, 'vb', { estado: 'danado' }), { codigo: 'TRANSICION_INVALIDA', status: 409 });
  });

  test('estado desconocido -> 422; equipo que no existe -> 404', () => {
    assert.throws(() => actualizarEstadoRecurso(crearDB(), 'vb', { estado: 'roto' }), { status: 422 });
    assert.throws(() => actualizarEstadoRecurso(crearDB(), 'nada', { estado: 'danado' }), { status: 404 });
  });

  test('lo que una incidencia abierta tiene fuera de servicio no se cambia a mano (409 INCIDENCIA_ABIERTA)', () => {
    const db = crearDB();
    crearIncidencia(db, incidencia({ recursoId: 'vb', inhabilitar: true }));
    assert.equal(db.recursos[1].estado, 'en_reparacion');
    assert.throws(() => actualizarEstadoRecurso(db, 'vb', { estado: 'disponible' }), { codigo: 'INCIDENCIA_ABIERTA', status: 409 });
    // La sala no la apagó esa incidencia: sí se puede inhabilitar a mano.
    assert.equal(actualizarEstadoEspacio(db, 'apolo', { estado: 'inhabilitado' }).estado, 'inhabilitado');
  });

  test('una sala se inhabilita y se habilita a mano, salvo si una incidencia la apagó', () => {
    const db = crearDB();
    actualizarEstadoEspacio(db, 'apolo', { estado: 'inhabilitado' });
    assert.equal(actualizarEstadoEspacio(db, 'apolo', { estado: 'disponible' }).estado, 'disponible');
    crearIncidencia(db, incidencia({ inhabilitar: true }));
    assert.throws(() => actualizarEstadoEspacio(db, 'apolo', { estado: 'disponible' }), { codigo: 'INCIDENCIA_ABIERTA' });
  });

  test('una sala inconsistente no se toca y "inconsistente" no se pone a mano', () => {
    assert.throws(() => actualizarEstadoEspacio(crearDB(), 'raro', { estado: 'disponible' }), { codigo: 'ESPACIO_INCONSISTENTE' });
    assert.throws(() => actualizarEstadoEspacio(crearDB(), 'apolo', { estado: 'inconsistente' }), { status: 422 });
  });

  test('cambiosManuales sale de las transiciones', () => {
    assert.deepEqual(cambiosManuales({ estado: 'danado' }), ['en_reparacion', 'disponible']);
    assert.deepEqual(cambiosManuales({ estado: 'disponible' }), ['en_reparacion', 'danado']);
    assert.deepEqual(cambiosManuales({ estado: 'en_reparacion' }), ['disponible']);
  });
});

describe('Inventario: API y permisos', () => {
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
  const cookies = {};

  before(async () => {
    cookies.admin = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
    for (const [usuario, rol] of [['profe', 'profesor'], ['tecnico', 'soporte_tecnico']]) {
      await pedir('/api/usuarios', 'POST', { usuario, nombre: usuario, clave: CLAVE, rol }, cookies.admin);
      cookies[rol] = (await pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE })).cookie;
    }
  });

  test('GET /api/recursos trae cambiosPermitidos', async () => {
    const { cuerpo } = await pedir('/api/recursos', 'GET', undefined, cookies.profesor);
    const danado = cuerpo.find((r) => r.estado === 'danado');
    assert.deepEqual(danado.cambiosPermitidos, ['en_reparacion', 'disponible']);
  });

  test('un profesor no puede cambiar el inventario (403)', async () => {
    assert.equal((await pedir('/api/recursos/rec-10', 'PATCH', { estado: 'disponible' }, cookies.profesor)).status, 403);
    assert.equal((await pedir('/api/espacios/apolo', 'PATCH', { estado: 'inhabilitado' }, cookies.profesor)).status, 403);
  });

  test('soporte técnico arregla el portátil dañado y queda guardado', async () => {
    const { status, cuerpo } = await pedir('/api/recursos/rec-10', 'PATCH', { estado: 'disponible' }, cookies.soporte_tecnico);
    assert.equal(status, 200);
    assert.equal(cuerpo.estado, 'disponible');
    const guardado = (await pedir('/api/recursos', 'GET', undefined, cookies.admin)).cuerpo.find((r) => r.id === 'rec-10');
    assert.equal(guardado.estado, 'disponible');
  });

  test('el admin inhabilita una sala a mano y soporte técnico la vuelve a habilitar', async () => {
    assert.equal((await pedir('/api/espacios/cosmos', 'PATCH', { estado: 'inhabilitado' }, cookies.admin)).status, 200);
    const sala = (await pedir('/api/espacios', 'GET', undefined, cookies.admin)).cuerpo.find((e) => e.id === 'cosmos');
    assert.equal(sala.estado, 'inhabilitado');
    assert.equal((await pedir('/api/espacios/cosmos', 'PATCH', { estado: 'disponible' }, cookies.soporte_tecnico)).cuerpo.estado, 'disponible');
  });
});
