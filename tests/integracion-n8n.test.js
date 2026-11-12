// =====================================================================
// TESTS DE LA INTEGRACIÓN CON n8n (node:test)
// ---------------------------------------------------------------------
// Aquí n8n es FALSO (un servidor HTTP de mentira): se prueba lo que es de Express: la firma del webhook, que
// un fallo de n8n no impide crear la incidencia, la autenticación por secreto de las rutas /api/integraciones y el
// registro de notificaciones. Que n8n de verdad reciba y procese el webhook se verifica con los flujos reales
// (docs/workflows.md). Requiere `docker compose up -d db`.
// =====================================================================

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { firmar, verificarFirma, secretoValido, notificarIncidenciaNueva, TOLERANCIA_SEGUNDOS } = await import('../src/integraciones/n8n.js');

const SECRETO = 'secreto-de-prueba-n8n';
const CLAVE = 'clave-de-prueba-1';

// ---------- n8n falso ----------
let n8n;
let recibidos;
let respuestaN8n;
function levantarN8n() {
  return new Promise((resolver) => {
    n8n = createServer(async (req, res) => {
      let cuerpo = '';
      for await (const trozo of req) cuerpo += trozo;
      recibidos.push({ cabeceras: req.headers, cuerpo });
      const { status = 200, demora = 0 } = respuestaN8n();
      setTimeout(() => { res.writeHead(status); res.end('{}'); }, demora);
    });
    n8n.listen(0, () => resolver(`http://localhost:${n8n.address().port}/webhook/incidencia-nueva`));
  });
}

// ---------- app ----------
let servidor;
let base;
let urlN8n;
let admin;
async function pedir(ruta, { metodo = 'GET', cuerpo, cookie = '', token } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie, ...(token && { 'x-pulse-token': token }) },
    body: cuerpo && JSON.stringify(cuerpo),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json(), cookie: respuesta.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const INCIDENCIA = {
  descripcion: 'El video beam de Apolo no prende', categoria: 'tecnologia', prioridad: 'critica', area: 'Soporte TI',
  espacioId: 'apolo', inhabilitar: true, origen: 'manual',
};
const esperarHasta = async (condicion, ms = 3000) => {
  const limite = Date.now() + ms;
  while (!condicion() && Date.now() < limite) await new Promise((r) => setTimeout(r, 20));
};

before(async () => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
  urlN8n = await levantarN8n();
  admin = (await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE } })).cookie;
});
after(async () => {
  delete process.env.N8N_SECRETO;
  delete process.env.N8N_WEBHOOK_URL;
  servidor.close();
  n8n.closeAllConnections();
  n8n.close();
  await bd.cerrar();
});
beforeEach(() => {
  recibidos = [];
  respuestaN8n = () => ({});
  process.env.N8N_SECRETO = SECRETO;
  process.env.N8N_WEBHOOK_URL = urlN8n;
});

describe('firma del webhook', () => {
  test('una firma correcta se verifica; con otro secreto, otro cuerpo o un timestamp distinto, no', () => {
    const t = '1700000000';
    const firma = `sha256=${firmar(SECRETO, t, '{"a":1}')}`;
    const ok = { secreto: SECRETO, timestamp: t, cuerpo: '{"a":1}', firma, ahora: 1700000010 };
    assert.equal(verificarFirma(ok), true);
    assert.equal(verificarFirma({ ...ok, secreto: 'otro' }), false);
    assert.equal(verificarFirma({ ...ok, cuerpo: '{"a":2}' }), false);
    assert.equal(verificarFirma({ ...ok, timestamp: '1700000001' }), false, 'el timestamp forma parte de lo firmado');
    assert.equal(verificarFirma({ ...ok, firma: 'sha256=' + 'a'.repeat(64) }), false);
    assert.equal(verificarFirma({ ...ok, firma: undefined }), false);
    assert.equal(verificarFirma({ ...ok, secreto: '' }), false);
  });

  test(`rechaza mensajes de hace más de ${TOLERANCIA_SEGUNDOS} s o del futuro (repetición)`, () => {
    const t = '1700000000';
    const base = { secreto: SECRETO, timestamp: t, cuerpo: 'x', firma: `sha256=${firmar(SECRETO, t, 'x')}` };
    assert.equal(verificarFirma({ ...base, ahora: 1700000000 + TOLERANCIA_SEGUNDOS }), true);
    assert.equal(verificarFirma({ ...base, ahora: 1700000000 + TOLERANCIA_SEGUNDOS + 1 }), false);
    assert.equal(verificarFirma({ ...base, ahora: 1700000000 - TOLERANCIA_SEGUNDOS - 1 }), false);
    assert.equal(verificarFirma({ ...base, timestamp: 'abc', ahora: 1700000000 }), false);
  });

  test('secretoValido compara el secreto y es falso si no hay ninguno configurado', () => {
    assert.equal(secretoValido(SECRETO, SECRETO), true);
    assert.equal(secretoValido('otro-secreto-distinto', SECRETO), false);
    assert.equal(secretoValido(undefined, SECRETO), false);
    assert.equal(secretoValido('', ''), false);
  });
});

describe('al crear una incidencia se avisa a n8n', () => {
  test('envía un webhook firmado con los datos públicos de la incidencia', async () => {
    const creada = await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin });
    assert.equal(creada.status, 201);
    await esperarHasta(() => recibidos.length === 1);
    assert.equal(recibidos.length, 1);
    const { cabeceras, cuerpo } = recibidos[0];
    assert.equal(verificarFirma({ secreto: SECRETO, timestamp: cabeceras['x-pulse-timestamp'], cuerpo, firma: cabeceras['x-pulse-firma'] }), true);
    const datos = JSON.parse(cuerpo);
    assert.equal(datos.evento, 'incidencia.creada');
    assert.equal(datos.incidencia.id, creada.cuerpo.id);
    assert.deepEqual(Object.keys(datos.incidencia).sort(),
      ['area', 'categoria', 'descripcion', 'espacioId', 'fecha', 'id', 'origen', 'prioridad', 'recursoId']);
    assert.ok(!cuerpo.includes('"ia"') && !cuerpo.includes('reportado'), 'sin datos personales ni lo que sugirió la IA');
  });

  test('si n8n responde un error, la incidencia se crea igual', async () => {
    respuestaN8n = () => ({ status: 500 });
    assert.equal((await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin })).status, 201);
    await esperarHasta(() => recibidos.length === 1);
    assert.equal(recibidos.length, 1);
  });

  test('si n8n no está levantado, la incidencia se crea igual', async () => {
    process.env.N8N_WEBHOOK_URL = 'http://localhost:1/webhook/incidencia-nueva';
    assert.equal((await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin })).status, 201);
    const resultado = await notificarIncidenciaNueva({ id: 'x', ...INCIDENCIA });
    assert.equal(resultado.enviado, false);
  });

  test('sin N8N_SECRETO o sin URL la integración está apagada: no se envía nada', async () => {
    delete process.env.N8N_SECRETO;
    await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin });
    process.env.N8N_SECRETO = SECRETO;
    delete process.env.N8N_WEBHOOK_URL;
    await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(recibidos.length, 0);
  });

  test('si n8n tarda más del tiempo máximo, la respuesta de la API no espera', async () => {
    respuestaN8n = () => ({ demora: 1500 });
    const inicio = Date.now();
    assert.equal((await pedir('/api/incidencias', { metodo: 'POST', cuerpo: INCIDENCIA, cookie: admin })).status, 201);
    assert.ok(Date.now() - inicio < 1000, 'el aviso va en segundo plano');
  });
});

describe('/api/integraciones (lo que n8n llama)', () => {
  let incidenciaId;
  before(async () => {
    incidenciaId = (await pedir('/api/incidencias', { metodo: 'POST', cuerpo: { ...INCIDENCIA, prioridad: 'media', inhabilitar: false }, cookie: admin })).cuerpo.id;
  });

  test('sin secreto o con uno incorrecto es 401, aunque haya sesión de admin', async () => {
    assert.equal((await pedir('/api/integraciones/incidencias')).status, 401);
    assert.equal((await pedir('/api/integraciones/incidencias', { token: 'incorrecto' })).status, 401);
    const conSesion = await pedir('/api/integraciones/incidencias', { cookie: admin });
    assert.equal(conSesion.status, 401, 'la sesión de una persona no sirve: es otra puerta');
    assert.equal(conSesion.cuerpo.error.codigo, 'SECRETO_INVALIDO');
  });

  test('sin N8N_SECRETO configurado responden 503 y nunca quedan abiertas', async () => {
    delete process.env.N8N_SECRETO;
    const { status, cuerpo } = await pedir('/api/integraciones/incidencias', { token: 'cualquiera' });
    assert.equal(status, 503);
    assert.equal(cuerpo.error.codigo, 'INTEGRACION_NO_CONFIGURADA');
  });

  test('lista las incidencias sin datos personales y filtra por fecha y estado', async () => {
    const todas = await pedir('/api/integraciones/incidencias', { token: SECRETO });
    assert.equal(todas.status, 200);
    assert.ok(todas.cuerpo.length >= 1);
    assert.deepEqual(Object.keys(todas.cuerpo[0]).sort(),
      ['area', 'categoria', 'descripcion', 'espacioId', 'estado', 'fecha', 'id', 'prioridad', 'recursoId', 'reportesAdicionales']);
    const hoy = await pedir('/api/integraciones/incidencias?fecha=hoy&estado=abierta', { token: SECRETO });
    assert.equal(hoy.cuerpo.length, todas.cuerpo.filter((i) => i.estado === 'abierta').length);
    assert.equal((await pedir('/api/integraciones/incidencias?fecha=2001-01-01', { token: SECRETO })).cuerpo.length, 0);
    assert.equal((await pedir('/api/integraciones/incidencias?estado=rara', { token: SECRETO })).status, 422);
    assert.equal((await pedir('/api/integraciones/incidencias?fecha=ayer', { token: SECRETO })).status, 422);
  });

  test('registra la notificación y no la duplica si n8n reintenta', async () => {
    const aviso = { canal: 'correo', destinatario: 'soporte-ti@campus.local', area: 'Soporte TI' };
    const ruta = `/api/integraciones/incidencias/${incidenciaId}/notificada`;
    const primera = await pedir(ruta, { metodo: 'POST', cuerpo: aviso, token: SECRETO });
    assert.equal(primera.status, 201);
    assert.deepEqual(primera.cuerpo, { registrada: true });
    const repetida = await pedir(ruta, { metodo: 'POST', cuerpo: aviso, token: SECRETO });
    assert.equal(repetida.status, 200);
    assert.deepEqual(repetida.cuerpo, { registrada: false });
    const { rows } = await bd.pool.query('SELECT count(*)::int AS n FROM incidencias_notificaciones WHERE incidencia_id = $1', [incidenciaId]);
    assert.equal(rows[0].n, 1);
  });

  test('la lista de incidencias de la app trae sus notificaciones', async () => {
    const lista = await pedir('/api/incidencias', { cookie: admin });
    const incidencia = lista.cuerpo.find((i) => i.id === incidenciaId);
    assert.equal(incidencia.notificaciones.length, 1);
    assert.deepEqual(Object.keys(incidencia.notificaciones[0]).sort(), ['area', 'canal', 'enviado']);
    assert.ok(lista.cuerpo.filter((i) => i.id !== incidenciaId).every((i) => Array.isArray(i.notificaciones)));
  });

  test('valida el canal, el área y el destinatario; y una incidencia que no existe es 404', async () => {
    const ruta = `/api/integraciones/incidencias/${incidenciaId}/notificada`;
    const bueno = { canal: 'correo', destinatario: 'a@b.c', area: 'Soporte TI' };
    for (const malo of [{ ...bueno, canal: 'paloma' }, { ...bueno, area: 'Cafetería' }, { ...bueno, destinatario: '  ' }, { ...bueno, destinatario: 'x'.repeat(201) }, {}]) {
      assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: malo, token: SECRETO })).status, 422, JSON.stringify(malo).slice(0, 50));
    }
    assert.equal((await pedir('/api/integraciones/incidencias/no-existe/notificada', { metodo: 'POST', cuerpo: bueno, token: SECRETO })).status, 404);
  });

  test('borrar la incidencia borra sus notificaciones (ON DELETE CASCADE)', async () => {
    await bd.pool.query('DELETE FROM incidencias WHERE id = $1', [incidenciaId]);
    const { rows } = await bd.pool.query('SELECT count(*)::int AS n FROM incidencias_notificaciones WHERE incidencia_id = $1', [incidenciaId]);
    assert.equal(rows[0].n, 0);
  });
});
