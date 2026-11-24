// =====================================================================
// TESTS DEL PANEL DE SOPORTE TI: "EN ATENCIÓN" (node:test)
// ---------------------------------------------------------------------
// Soporte técnico toma una incidencia para que el equipo sepa que ya
// alguien va en camino. Dominio en memoria y API contra una base
// PostgreSQL temporal (docker compose up -d db).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { atenderIncidencia, crearIncidencia, resolverIncidencia } = await import('../src/domain/incidencias.js');

const TECNICO = { usuario: 'tecnico', rol: 'soporte_tecnico' };
const OTRO = { usuario: 'otro', rol: 'soporte_tecnico' };

function crearDB() {
  return { espacios: [{ id: 'apolo', nombre: 'Apolo', estado: 'disponible' }], recursos: [], reservas: [], prestamos: [], incidencias: [] };
}
const nueva = (db) => crearIncidencia(db, { descripcion: 'No hay wifi en Apolo', categoria: 'tecnologia', prioridad: 'media', espacioId: 'apolo' });

describe('En atención: reglas', () => {
  test('quien la toma queda registrado con la hora, y la incidencia sigue abierta', () => {
    const db = crearDB();
    const i = atenderIncidencia(db, nueva(db).id, TECNICO, '2026-11-16T09:40');
    assert.deepEqual([i.estado, i.atendidaPor, i.fechaAtencion], ['abierta', 'tecnico', '2026-11-16T09:40']);
  });

  test('si ya la atiende otra persona -> 409; tomarla otra vez uno mismo no cambia nada', () => {
    const db = crearDB();
    const { id } = nueva(db);
    atenderIncidencia(db, id, TECNICO, '2026-11-16T09:40');
    assert.throws(() => atenderIncidencia(db, id, OTRO), { codigo: 'INCIDENCIA_EN_ATENCION', status: 409 });
    assert.equal(atenderIncidencia(db, id, TECNICO, '2026-11-16T10:00').fechaAtencion, '2026-11-16T09:40');
  });

  test('una resuelta no se atiende (409) y una en atención se resuelve normal', () => {
    const db = crearDB();
    const { id } = nueva(db);
    atenderIncidencia(db, id, TECNICO);
    assert.equal(resolverIncidencia(db, id, { estado: 'resuelta' }).estado, 'resuelta');
    assert.throws(() => atenderIncidencia(db, id, TECNICO), { codigo: 'INCIDENCIA_YA_RESUELTA' });
    assert.throws(() => atenderIncidencia(db, 'nada', TECNICO), { status: 404 });
  });
});

describe('En atención: API', () => {
  let servidor;
  let base;
  const cookies = {};
  const CLAVE = 'clave-de-prueba-1';
  async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  }

  before(async () => {
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
    cookies.admin = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
    for (const [usuario, nombre, rol] of [['profe', 'Profe', 'profesor'], ['tecnico', 'Técnico Uno', 'soporte_tecnico']]) {
      await pedir('/api/usuarios', 'POST', { usuario, nombre, clave: CLAVE, rol }, cookies.admin);
      cookies[rol] = (await pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE })).cookie;
    }
  });
  after(async () => {
    servidor.close();
    await bd.cerrar();
  });

  test('un profesor reporta, no puede atender (403); soporte la toma y todos ven su nombre', async () => {
    const { cuerpo: incidencia } = await pedir('/api/incidencias', 'POST',
      { descripcion: 'El televisor de Skilab no da imagen', categoria: 'tecnologia', prioridad: 'media', espacioId: 'skilab' }, cookies.profesor);
    assert.equal((await pedir(`/api/incidencias/${incidencia.id}/atender`, 'POST', undefined, cookies.profesor)).status, 403);

    const tomada = await pedir(`/api/incidencias/${incidencia.id}/atender`, 'POST', undefined, cookies.soporte_tecnico);
    assert.equal(tomada.status, 200);
    assert.equal(tomada.cuerpo.atendidaPor, 'tecnico');

    const lista = (await pedir('/api/incidencias', 'GET', undefined, cookies.profesor)).cuerpo;
    const vista = lista.find((i) => i.id === incidencia.id);
    assert.deepEqual([vista.estado, vista.atendidaPorNombre], ['abierta', 'Técnico Uno']);
    assert.equal((await pedir(`/api/incidencias/${incidencia.id}/atender`, 'POST', undefined, cookies.admin)).cuerpo.error.codigo, 'INCIDENCIA_EN_ATENCION');
  });
});
