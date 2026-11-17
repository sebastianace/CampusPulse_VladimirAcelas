// =====================================================================
// TESTS DE LOS AVISOS POR CORREO (node:test)
// ---------------------------------------------------------------------
// - Reglas (src/domain/avisos.js): a quién se avisa y qué se le dice.
// - De punta a punta: la API guarda el cambio y le pide a un "n8n falso"
//   (un servidor HTTP local) que entregue el correo, con la firma que
//   valida el flujo pulseAvisoReserva. Base PostgreSQL temporal.
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { avisosDeDecision, avisosDeReservaCambiada, avisosDeSolicitudNueva } = await import('../src/domain/avisos.js');
const { crearSolicitud, decidirSolicitud } = await import('../src/domain/solicitudes.js');
const { verificarFirma } = await import('../src/integraciones/n8n.js');
const { REGLAS } = await import('../src/config/reglas.js');

const TEMPRANO = '2026-11-16T08:00';
const LUIS = { usuario: 'luis', rol: 'profesor' };
function crearDB() {
  return {
    espacios: [{ id: 'cosmos', nombre: 'Cosmos', aforo: 25, estado: 'disponible' }],
    recursos: [], incidencias: [], solicitudes: [],
    reservas: [{ id: 'res-9', espacioId: 'cosmos', responsable: 'Ana', asistentes: 20, inicio: '2026-11-16T09:00', fin: '2026-11-16T11:00', creadaPor: 'ana' }],
  };
}
const pedido = (cambios = {}) => ({ reservaId: 'res-9', responsable: 'Luis', asistentes: 15, inicio: '2026-11-16T09:00', fin: '2026-11-16T11:00', motivo: 'Sustentación', ...cambios });
const para = (avisos) => avisos.map((a) => a.para);

describe('Avisos: a quién y qué', () => {
  test('solicitud nueva: a quien tiene la reserva y a los admins, nunca a quien la pidió', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, TEMPRANO);
    const avisos = avisosDeSolicitudNueva(db, s, ['jefa', 'luis']);
    assert.deepEqual(para(avisos), ['ana', 'jefa']);
    assert.match(avisos[0].asunto, /Pidieron tu salón Cosmos/);
    assert.match(avisos[0].mensaje, /Luis pide Cosmos el 16\/11 de 09:00 a 11:00.*Tú lo tienes reservado el 16\/11 de 09:00 a 11:00/);
    assert.match(avisos[1].mensaje, /Sustentación.*pestaña Solicitudes/);
  });

  test('aprobada y la cubría entera: a quien la pidió "te asignaron" y a la dueña "se canceló"', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, TEMPRANO);
    const antes = structuredClone(db.reservas[0]);
    decidirSolicitud(db, s.id, { decision: 'aprobar', nota: 'Es la sustentación' }, { usuario: 'jefa', rol: 'admin' }, TEMPRANO);
    const [aLuis, aAna] = avisosDeDecision(db, [s], antes, 'jefa');
    assert.deepEqual([aLuis.para, aLuis.asunto], ['luis', 'Te asignaron Cosmos']);
    assert.deepEqual([aAna.para, aAna.asunto], ['ana', 'Tu reserva de Cosmos se canceló']);
    assert.match(aAna.mensaje, /Tu reserva el 16\/11 de 09:00 a 11:00 se canceló\. Nota del admin: "Es la sustentación"/);
  });

  test('aprobada en parte: a la dueña le dice cómo quedó su reserva', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido({ inicio: '2026-11-16T09:30', fin: '2026-11-16T10:30' }), LUIS, TEMPRANO);
    const antes = structuredClone(db.reservas[0]);
    decidirSolicitud(db, s.id, { decision: 'aprobar' }, { usuario: 'jefa', rol: 'admin' }, TEMPRANO);
    const aAna = avisosDeDecision(db, [s], antes, 'jefa').find((a) => a.para === 'ana');
    assert.equal(aAna.asunto, 'Tu reserva de Cosmos cambió');
    assert.match(aAna.mensaje, /quedó así: 09:00–09:30 y 10:30–11:00/);
  });

  test('rechazada: solo a quien la pidió, con la nota', () => {
    const db = crearDB();
    const s = crearSolicitud(db, pedido(), LUIS, TEMPRANO);
    decidirSolicitud(db, s.id, { decision: 'rechazar', nota: 'Ana sí viene' }, { usuario: 'jefa', rol: 'admin' }, TEMPRANO);
    const avisos = avisosDeDecision(db, [s], structuredClone(db.reservas[0]), 'jefa');
    assert.deepEqual(para(avisos), ['luis']);
    assert.match(avisos[0].mensaje, /rechazó.*"Ana sí viene"/);
  });

  test('reserva editada o cancelada por un admin: al dueño; si la cambia el dueño, a nadie', () => {
    const db = crearDB();
    const antes = db.reservas[0];
    const despues = { ...antes, inicio: '2026-11-16T10:00', fin: '2026-11-16T12:00' };
    const [editada] = avisosDeReservaCambiada(db, antes, despues, 'jefa');
    assert.equal(editada.para, 'ana');
    assert.match(editada.mensaje, /Antes: Cosmos el 16\/11 de 09:00 a 11:00.*Ahora: Cosmos el 16\/11 de 10:00 a 12:00/);
    assert.match(avisosDeReservaCambiada(db, antes, null, 'jefa')[0].asunto, /Cancelaron tu reserva de Cosmos/);
    assert.deepEqual(avisosDeReservaCambiada(db, antes, null, 'ana'), [], 'la cambió ella misma');
    assert.deepEqual(avisosDeReservaCambiada(db, { ...antes, creadaPor: null }, null, 'jefa'), [], 'sin dueño conocido');
  });
});

describe('Avisos: de punta a punta con un n8n falso', () => {
  const SECRETO = 'secreto-de-prueba-avisos';
  const recibidos = [];
  let n8n;
  let servidor;
  let base;
  const anterior = { url: process.env.N8N_WEBHOOK_URL, secreto: process.env.N8N_SECRETO };

  before(async () => {
    n8n = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; });
      req.on('end', () => {
        const firmaOk = verificarFirma({ secreto: SECRETO, timestamp: req.headers['x-pulse-timestamp'], cuerpo, firma: req.headers['x-pulse-firma'] });
        recibidos.push({ ruta: req.url, firmaOk, datos: JSON.parse(cuerpo) });
        res.writeHead(202, { 'content-type': 'application/json' }).end('{"recibido":true}');
      });
    }).listen(0);
    await new Promise((r) => n8n.once('listening', r));
    process.env.N8N_WEBHOOK_URL = `http://localhost:${n8n.address().port}/webhook/incidencia-nueva`;
    process.env.N8N_SECRETO = SECRETO;
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
  });
  after(async () => {
    process.env.N8N_WEBHOOK_URL = anterior.url;
    process.env.N8N_SECRETO = anterior.secreto;
    if (anterior.url === undefined) delete process.env.N8N_WEBHOOK_URL;
    if (anterior.secreto === undefined) delete process.env.N8N_SECRETO;
    servidor.close();
    n8n.close();
    await bd.cerrar();
  });

  async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  }
  const esperarAvisos = async (n) => {
    for (let i = 0; i < 50 && recibidos.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return recibidos.splice(0);
  };

  test('el correo de la cuenta es opcional, se valida y el admin lo cambia', async () => {
    const CLAVE = 'clave-de-prueba-1';
    const jefa = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Diego', clave: CLAVE })).cookie;
    assert.equal((await pedir('/api/usuarios', 'POST', { usuario: 'ana', nombre: 'Ana', clave: CLAVE, rol: 'profesor', correo: 'no-es-correo' }, jefa)).status, 422);
    assert.equal((await pedir('/api/usuarios', 'POST', { usuario: 'ana', nombre: 'Ana', clave: CLAVE, rol: 'profesor', correo: 'Ana@Campus.local' }, jefa)).status, 201);
    assert.equal((await pedir('/api/usuarios', 'POST', { usuario: 'luis', nombre: 'Luis', clave: CLAVE, rol: 'profesor' }, jefa)).status, 201);
    const cuentas = (await pedir('/api/usuarios', 'GET', undefined, jefa)).cuerpo;
    assert.deepEqual(cuentas.map((c) => [c.usuario, c.correo]), [['jefa', null], ['ana', 'ana@campus.local'], ['luis', null]]);
    assert.deepEqual((await pedir('/api/usuarios/luis', 'PATCH', { correo: 'luis@campus.local' }, jefa)).cuerpo, { usuario: 'luis', correo: 'luis@campus.local' });
    assert.equal((await pedir('/api/usuarios/nadie', 'PATCH', { correo: 'x@campus.local' }, jefa)).status, 404);
    const ana = (await pedir('/api/auth/login', 'POST', { usuario: 'ana', clave: CLAVE })).cookie;
    assert.equal((await pedir('/api/usuarios/ana', 'PATCH', { correo: 'otro@campus.local' }, ana)).status, 403, 'solo un admin');
  });

  test('pedir y aprobar un salón: los correos llegan firmados a la ruta de avisos, solo a quien tiene correo', async () => {
    const CLAVE = 'clave-de-prueba-1';
    const entrar = async (usuario) => (await pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE })).cookie;
    const [jefa, ana, luis] = [await entrar('jefa'), await entrar('ana'), await entrar('luis')];
    const f = new Date();
    f.setDate(f.getDate() + 10);
    while (!REGLAS.DIAS_HABILES.includes(f.getDay())) f.setDate(f.getDate() + 1);
    const dia = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`; // fecha local (toISOString es UTC: de noche ya es mañana)
    const deAna = (await pedir('/api/reservas', 'POST', { espacioId: 'cosmos', responsable: 'Ana', asistentes: 20, inicio: `${dia}T09:00`, fin: `${dia}T11:00` }, ana)).cuerpo;
    recibidos.splice(0);

    const s = await pedir('/api/solicitudes', 'POST', { reservaId: deAna.id, responsable: 'Luis', asistentes: 20, inicio: `${dia}T09:00`, fin: `${dia}T11:00`, motivo: 'Sustentación' }, luis);
    assert.equal(s.status, 201);
    // A Ana (tiene correo) le llega; a la jefa no, porque no tiene correo
    const alPedir = await esperarAvisos(1);
    assert.deepEqual(alPedir.map((r) => [r.ruta, r.firmaOk, r.datos.evento, r.datos.aviso.correo]), [['/webhook/aviso-reserva', true, 'aviso.reserva', 'ana@campus.local']]);
    assert.match(alPedir[0].datos.aviso.asunto, /Pidieron tu salón Cosmos/);

    assert.equal((await pedir(`/api/solicitudes/${s.cuerpo.id}`, 'PATCH', { decision: 'aprobar' }, jefa)).status, 200);
    const alAprobar = (await esperarAvisos(2)).map((r) => [r.datos.aviso.correo, r.datos.aviso.asunto]).sort();
    assert.deepEqual(alAprobar, [['ana@campus.local', 'Tu reserva de Cosmos se canceló'], ['luis@campus.local', 'Te asignaron Cosmos']]);
  });

  test('si n8n no responde, el cambio se guarda igual (el correo nunca lo deshace)', async () => {
    process.env.N8N_WEBHOOK_URL = 'http://localhost:9/webhook/incidencia-nueva'; // puerto cerrado
    const jefa = (await pedir('/api/auth/login', 'POST', { usuario: 'jefa', clave: 'clave-de-prueba-1' })).cookie;
    const f = new Date();
    f.setDate(f.getDate() + 12);
    while (!REGLAS.DIAS_HABILES.includes(f.getDay())) f.setDate(f.getDate() + 1);
    const dia = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`; // fecha local (toISOString es UTC: de noche ya es mañana)
    const ana = (await pedir('/api/auth/login', 'POST', { usuario: 'ana', clave: 'clave-de-prueba-1' })).cookie;
    const r = (await pedir('/api/reservas', 'POST', { espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${dia}T10:00`, fin: `${dia}T11:00` }, ana)).cuerpo;
    const cancelada = await pedir(`/api/reservas/${r.id}`, 'DELETE', undefined, jefa);
    assert.equal(cancelada.status, 200);
    assert.ok(!(await pedir(`/api/reservas?fecha=${dia}`, 'GET', undefined, jefa)).cuerpo.some((x) => x.id === r.id));
  });
});
