// =====================================================================
// TESTS DE LAS SOLICITUDES DE SALÓN Y DE QUIÉN TOCA CADA RESERVA (node:test)
// ---------------------------------------------------------------------
// El dominio recibe "ahora" como parámetro: así se prueba un lunes a las
// 9:20 aunque los tests corran un domingo en la noche.
// La aprobación se prueba también contra PostgreSQL: cortar la reserva y
// crear la nueva en la misma transacción no debe chocar con la
// restricción EXCLUDE (docker compose up -d db).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { actualizarDB, leerDB } = await import('../src/data/almacen.js');
const { crearSolicitud, decidirSolicitud, solicitudesDe } = await import('../src/domain/solicitudes.js');
const { cancelarReserva, crearReserva, editarReserva } = await import('../src/domain/reservas.js');
const { REGLAS } = await import('../src/config/reglas.js');

// Lunes 16 de noviembre de 2026, 9:20 a. m.: la clase de las 9:00 ya empezó y nadie llegó.
const AHORA = '2026-11-16T09:20';
const ANA = { usuario: 'ana', rol: 'profesor' };      // dueña de la reserva de las 9:00
const LUIS = { usuario: 'luis', rol: 'profesor' };    // necesita el salón
const SOFI = { usuario: 'sofi', rol: 'profesor' };
const JEFA = { usuario: 'jefa', rol: 'admin' };

function crearDB() {
  return {
    espacios: [{ id: 'apolo', nombre: 'Apolo', aforo: 34, estado: 'disponible' }],
    recursos: [], prestamos: [], incidencias: [], solicitudes: [],
    reservas: [
      { id: 'res-9', espacioId: 'apolo', responsable: 'Ana', asistentes: 20, inicio: '2026-11-16T09:00', fin: '2026-11-16T11:00', creadaPor: 'ana' },
      { id: 'res-14', espacioId: 'apolo', responsable: 'Karen', asistentes: 10, inicio: '2026-11-16T14:00', fin: '2026-11-16T16:00', creadaPor: 'karen' },
    ],
  };
}
const pedido = (cambios = {}) => ({ reservaId: 'res-9', responsable: 'Luis', asistentes: 15, fin: '2026-11-16T11:00', motivo: 'Taller de repaso', ...cambios });

describe('Solicitudes: crear', () => {
  test('pedir un salón en curso de otra persona deja la solicitud pendiente y avisa a la dueña', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, AHORA);
    assert.equal(s.estado, 'pendiente');
    assert.equal(s.espacioId, 'apolo');
    assert.equal(s.afectado, 'ana');
    assert.equal(db.reservas[0].fin, '2026-11-16T11:00', 'pedir no cambia la reserva: solo aprobar');
  });

  test('solo se piden reservas en curso (409 RESERVA_NO_EN_CURSO)', () => {
    assert.throws(() => crearSolicitud(crearDB(), pedido({ reservaId: 'res-14' }), LUIS, AHORA), { codigo: 'RESERVA_NO_EN_CURSO' });
    assert.throws(() => crearSolicitud(crearDB(), pedido(), LUIS, '2026-11-16T11:00'), { codigo: 'RESERVA_NO_EN_CURSO' });
  });

  test('no se pide la reserva propia ni dos veces la misma', () => {
    assert.throws(() => crearSolicitud(crearDB(), pedido(), ANA, AHORA), { codigo: 'ES_TU_RESERVA' });
    const db = crearDB();
    crearSolicitud(db, pedido(), LUIS, AHORA);
    assert.throws(() => crearSolicitud(db, pedido(), LUIS, AHORA), { codigo: 'SOLICITUD_REPETIDA' });
    assert.equal(crearSolicitud(db, pedido({ responsable: 'Sofía' }), SOFI, AHORA).estado, 'pendiente', 'otra persona sí puede pedirla');
  });

  test('se ensaya la aprobación: si violaría una regla de reservas, se rechaza al pedirla', () => {
    assert.throws(() => crearSolicitud(crearDB(), pedido({ asistentes: 50 }), LUIS, AHORA), { codigo: 'AFORO_EXCEDIDO' });
    assert.throws(() => crearSolicitud(crearDB(), pedido({ fin: '2026-11-16T15:00' }), LUIS, AHORA), { codigo: 'RESERVA_SOLAPADA' });
    const sinLaDeLaTarde = crearDB();
    sinLaDeLaTarde.reservas.pop();
    const muyLarga = `2026-11-16T${String(9 + REGLAS.MAX_HORAS_RESERVA + 1).padStart(2, '0')}:00`;
    assert.throws(() => crearSolicitud(sinLaDeLaTarde, pedido({ fin: muyLarga }), LUIS, AHORA), { codigo: 'DURACION_EXCEDIDA' });
  });

  test('datos incompletos -> 422; reserva que no existe -> 404', () => {
    assert.throws(() => crearSolicitud(crearDB(), pedido({ motivo: ' ' }), LUIS, AHORA), { status: 422 });
    assert.throws(() => crearSolicitud(crearDB(), pedido({ fin: '11:00' }), LUIS, AHORA), { status: 422 });
    assert.throws(() => crearSolicitud(crearDB(), pedido({ reservaId: 'nada' }), LUIS, AHORA), { status: 404 });
  });
});

describe('Solicitudes: decidir', () => {
  test('aprobar corta la reserva original en ese momento y crea la nueva a nombre de quien la pidió', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, AHORA);
    const otra = crearSolicitud(db, pedido({ responsable: 'Sofía' }), SOFI, AHORA);
    decidirSolicitud(db, s.id, { decision: 'aprobar' }, JEFA, '2026-11-16T09:30');

    assert.equal(db.reservas.find((r) => r.id === 'res-9').fin, '2026-11-16T09:30');
    const nueva = db.reservas.find((r) => r.id === s.reservaNuevaId);
    assert.deepEqual([nueva.inicio, nueva.fin, nueva.responsable, nueva.creadaPor], ['2026-11-16T09:30', '2026-11-16T11:00', 'Luis', 'luis']);
    assert.deepEqual([s.estado, s.decididaPor], ['aprobada', 'jefa']);
    assert.equal(otra.estado, 'rechazada', 'las otras solicitudes del mismo salón ya no se pueden aprobar');
    assert.match(otra.notaDecision, /otra solicitud/);
  });

  test('rechazar no toca las reservas y guarda la nota', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, AHORA);
    decidirSolicitud(db, s.id, { decision: 'rechazar', nota: 'Ana avisó que llega tarde' }, JEFA, AHORA);
    assert.deepEqual([s.estado, s.notaDecision], ['rechazada', 'Ana avisó que llega tarde']);
    assert.equal(db.reservas.length, 2);
    assert.equal(db.reservas[0].fin, '2026-11-16T11:00');
  });

  test('una solicitud ya decidida no se vuelve a decidir; decisión desconocida -> 422', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, AHORA);
    assert.throws(() => decidirSolicitud(db, s.id, { decision: 'tal vez' }, JEFA, AHORA), { status: 422 });
    decidirSolicitud(db, s.id, { decision: 'rechazar' }, JEFA, AHORA);
    assert.throws(() => decidirSolicitud(db, s.id, { decision: 'aprobar' }, JEFA, AHORA), { codigo: 'SOLICITUD_YA_DECIDIDA' });
  });

  test('si la reserva original ya terminó, aprobar solo crea la nueva', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido({ fin: '2026-11-16T12:00' }), LUIS, AHORA);
    decidirSolicitud(db, s.id, { decision: 'aprobar' }, JEFA, '2026-11-16T11:15');
    assert.equal(db.reservas.find((r) => r.id === 'res-9').fin, '2026-11-16T11:00', 'no se toca');
    assert.equal(db.reservas.find((r) => r.id === s.reservaNuevaId).inicio, '2026-11-16T11:15');
  });

  test('cada quien ve las suyas y las que cortaron su reserva; el admin ve todas', () => {
    const db = crearDB();
    crearSolicitud(db, pedido(), LUIS, AHORA);
    assert.equal(solicitudesDe(db, LUIS).length, 1);
    assert.equal(solicitudesDe(db, ANA).length, 1, 'la dueña de la reserva también la ve');
    assert.equal(solicitudesDe(db, SOFI).length, 0);
    assert.equal(solicitudesDe(db, JEFA).length, 1);
    assert.equal(solicitudesDe(db, JEFA)[0].reservaOriginal.responsable, 'Ana');
  });
});

describe('Reservas: solo quien la creó o un admin la edita o la cancela', () => {
  const futura = (creadaPor) => ({ id: 'res-f', espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: '2099-11-16T10:00', fin: '2099-11-16T11:00', creadaPor });

  test('otra persona recibe 403; la dueña y el admin sí pueden', () => {
    const db = crearDB();
    db.reservas.push(futura('ana'));
    assert.throws(() => cancelarReserva(db, 'res-f', LUIS), { status: 403, codigo: 'PERMISO_DENEGADO' });
    assert.throws(() => editarReserva(db, 'res-f', { asistentes: 6 }, LUIS), { status: 403 });
    assert.equal(cancelarReserva(crearDBCon(futura('ana')), 'res-f', ANA).id, 'res-f');
    assert.equal(cancelarReserva(crearDBCon(futura('ana')), 'res-f', JEFA).id, 'res-f');
  });

  test('una reserva sin dueño conocido (anterior a esta versión) solo la toca un admin', () => {
    assert.throws(() => cancelarReserva(crearDBCon(futura(null)), 'res-f', ANA), { status: 403 });
    assert.equal(cancelarReserva(crearDBCon(futura(null)), 'res-f', JEFA).id, 'res-f');
  });

  test('crear guarda quién la creó', () => {
    const db = crearDB();
    const nueva = crearReserva(db, { espacioId: 'apolo', responsable: 'Luis', asistentes: 5, inicio: '2099-11-16T17:00', fin: '2099-11-16T18:00' }, { creadaPor: 'luis' });
    assert.equal(nueva.creadaPor, 'luis');
  });

  function crearDBCon(reserva) {
    const db = crearDB();
    db.reservas.push(reserva);
    return db;
  }
});

describe('Con PostgreSQL', () => {
  let servidor;
  let base;
  before(async () => {
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
    cookies.jefa = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
    for (const usuario of ['ana', 'luis']) {
      await pedir('/api/usuarios', 'POST', { usuario, nombre: usuario, clave: CLAVE, rol: 'profesor' }, cookies.jefa);
      cookies[usuario] = (await pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE })).cookie;
    }
  });

  test('aprobar corta y crea en una sola transacción, sin chocar con la restricción EXCLUDE', async () => {
    // La reserva en curso se escribe directo (crearReserva no deja reservar en el pasado).
    await actualizarDB((db) => { db.reservas.push({ ...crearDB().reservas[0], id: 'res-pg' }); });
    const s = await actualizarDB((db) => crearSolicitud(db, pedido({ reservaId: 'res-pg' }), LUIS, AHORA));
    await actualizarDB((db) => decidirSolicitud(db, s.id, { decision: 'aprobar' }, JEFA, '2026-11-16T09:30'));

    const db = await leerDB();
    assert.equal(db.reservas.find((r) => r.id === 'res-pg').fin, '2026-11-16T09:30');
    const guardada = db.solicitudes.find((x) => x.id === s.id);
    assert.equal(guardada.estado, 'aprobada');
    const nueva = db.reservas.find((r) => r.id === guardada.reservaNuevaId);
    assert.deepEqual([nueva.inicio, nueva.fin, nueva.creadaPor], ['2026-11-16T09:30', '2026-11-16T11:00', 'luis']);
  });

  test('las reservas guardan quién las creó y otra persona no las puede cancelar (403)', async () => {
    const f = new Date();
    f.setDate(f.getDate() + 10);
    while (!REGLAS.DIAS_HABILES.includes(f.getDay())) f.setDate(f.getDate() + 1);
    const dia = f.toISOString().slice(0, 10);
    const creada = await pedir('/api/reservas', 'POST', { espacioId: 'cosmos', responsable: 'Ana', asistentes: 5, inicio: `${dia}T10:00`, fin: `${dia}T11:00` }, cookies.ana);
    assert.equal(creada.status, 201);
    assert.equal(creada.cuerpo.creadaPor, 'ana');
    assert.equal((await pedir(`/api/reservas/${creada.cuerpo.id}`, 'DELETE', undefined, cookies.luis)).status, 403);
    // Pedirla tampoco sirve: no está en curso.
    const pedirla = await pedir('/api/solicitudes', 'POST', pedido({ reservaId: creada.cuerpo.id, fin: `${dia}T11:00` }), cookies.luis);
    assert.equal(pedirla.cuerpo.error.codigo, 'RESERVA_NO_EN_CURSO');
    assert.equal((await pedir(`/api/reservas/${creada.cuerpo.id}`, 'DELETE', undefined, cookies.ana)).status, 200);
  });

  test('solo un admin decide (403 para un profesor) y cada quien ve sus solicitudes', async () => {
    const [s] = (await pedir('/api/solicitudes', 'GET', undefined, cookies.jefa)).cuerpo;
    const respuesta = await pedir(`/api/solicitudes/${s.id}`, 'PATCH', { decision: 'rechazar' }, cookies.luis);
    assert.equal(respuesta.status, 403);
    assert.equal((await pedir('/api/solicitudes', 'GET', undefined, cookies.luis)).cuerpo.length, 1);
    assert.equal((await pedir('/api/solicitudes', 'GET', undefined, cookies.ana)).cuerpo.length, 1, 'Ana ve la solicitud que cortó su reserva');
  });
});
