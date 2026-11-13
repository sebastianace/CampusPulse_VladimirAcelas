// =====================================================================
// TESTS DEL LÍMITE Y LA CACHÉ DE LA IA (node:test)
// ---------------------------------------------------------------------
// Primero los módulos src/ai/limite.js y src/ai/cache.js con un reloj
// simulado (`ahora`); después las rutas /api/ia con el servidor de verdad.
// Sin GEMINI_API_KEY la IA responde 503: sirve para probar el límite sin
// gastar cuota real de Gemini (el 503 también cuenta como consulta).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp(); // la app corre contra una base PostgreSQL temporal
delete process.env.GEMINI_API_KEY; // la IA no está configurada: responde 503
delete process.env.GEMINI_MODEL;
const { app } = await import('../src/server.js');
const { REGLAS } = await import('../src/config/reglas.js');
const { consumirCupoIA, devolverCupoIA, presupuestoRestante, reiniciarPresupuesto, reservarPresupuesto } = await import('../src/ai/limite.js');
const { guardarCache, leerCache, vaciarCache } = await import('../src/ai/cache.js');

const MINUTO = 60_000;
const { LIMITE_IA_PETICIONES: LIMITE, LIMITE_IA_VENTANA_MINUTOS: VENTANA, CACHE_IA_MINUTOS: DURACION } = REGLAS;

describe('Módulo de límite', () => {
  test(`con ${LIMITE} consultas se agota el cupo; la siguiente lanza 429 LIMITE_IA`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMITE; i++) consumirCupoIA('u1', t0);
    assert.throws(() => consumirCupoIA('u1', t0), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.codigo, 'LIMITE_IA');
      assert.equal(error.esperaSegundos, VENTANA * 60);
      assert.match(error.message, /formulario manual/);
      return true;
    });
  });

  test('el cupo se recupera cuando la consulta más antigua sale de la ventana', () => {
    const t0 = 5_000_000;
    consumirCupoIA('u2', t0); // la más antigua
    for (let i = 1; i < LIMITE; i++) consumirCupoIA('u2', t0 + MINUTO / 2);
    assert.throws(() => consumirCupoIA('u2', t0 + MINUTO - 1000), (e) => e.esperaSegundos === 1);
    assert.doesNotThrow(() => consumirCupoIA('u2', t0 + VENTANA * MINUTO));
  });

  test('cada usuario tiene su propio cupo', () => {
    const t0 = 9_000_000;
    for (let i = 0; i < LIMITE; i++) consumirCupoIA('u3', t0);
    assert.throws(() => consumirCupoIA('u3', t0));
    assert.doesNotThrow(() => consumirCupoIA('u4', t0));
  });
});

describe('Módulo de caché', () => {
  test('un texto idéntico devuelve la respuesta guardada, sin importar mayúsculas ni espacios', () => {
    vaciarCache();
    guardarCache('El video beam NO prende', { categoria: 'tecnologia' }, 0);
    assert.deepEqual(leerCache('  el video   beam no prende ', 1000), { categoria: 'tecnologia' });
    assert.equal(leerCache('otro texto', 1000), undefined);
  });

  test(`la respuesta vence a los ${DURACION} minutos`, () => {
    vaciarCache();
    guardarCache('texto', { ok: true }, 0);
    assert.deepEqual(leerCache('texto', DURACION * MINUTO - 1), { ok: true });
    assert.equal(leerCache('texto', DURACION * MINUTO), undefined);
  });

  test('con la caché llena se descarta la entrada más antigua', () => {
    vaciarCache();
    for (let i = 0; i < 201; i++) guardarCache(`texto ${i}`, i, 0);
    assert.equal(leerCache('texto 0', 1), undefined);
    assert.equal(leerCache('texto 200', 1), 200);
  });
});

describe('Rutas /api/ia', () => {
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

  // Hace la petición y devuelve {status, cuerpo, cookie, reintentar}.
  async function pedir(ruta, cuerpo, cookie = '') {
    const respuesta = await fetch(base + ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(cuerpo),
    });
    return {
      status: respuesta.status,
      cuerpo: await respuesta.json(),
      cookie: respuesta.headers.get('set-cookie')?.split(';')[0] ?? '',
      reintentar: respuesta.headers.get('retry-after'),
    };
  }

  const triaje = (cookie, descripcion = 'El video beam de Apolo no prende') => pedir('/api/ia/triaje', { descripcion }, cookie);

  test(`tras ${LIMITE} consultas, la siguiente responde 429 en español con Retry-After`, async () => {
    const admin = await pedir('/api/auth/registro', { usuario: 'jefa', nombre: 'Jefa', clave: 'clave-de-prueba-1' });
    for (let i = 0; i < LIMITE; i++) assert.equal((await triaje(admin.cookie)).status, 503);
    const bloqueada = await triaje(admin.cookie);
    assert.equal(bloqueada.status, 429);
    assert.equal(bloqueada.cuerpo.error.codigo, 'LIMITE_IA');
    assert.match(bloqueada.cuerpo.error.mensaje, /formulario manual/);
    assert.ok(Number(bloqueada.reintentar) > 0, 'cabecera Retry-After');
    // /recomendar comparte el mismo cupo
    assert.equal((await pedir('/api/ia/recomendar', { texto: 'Una sala para 10 personas mañana' }, admin.cookie)).status, 429);
  });

  test('el límite de un usuario no afecta a otro', async () => {
    const admin = await pedir('/api/auth/login', { usuario: 'jefa', clave: 'clave-de-prueba-1' });
    await pedir('/api/usuarios', { usuario: 'profe', nombre: 'Profe', clave: 'clave-de-prueba-1', rol: 'profesor' }, admin.cookie);
    const profe = await pedir('/api/auth/login', { usuario: 'profe', clave: 'clave-de-prueba-1' });
    assert.equal((await triaje(profe.cookie)).status, 503, 'llega a la IA (no configurada), no al límite');
  });

  test('una petición inválida (422) no gasta cupo', async () => {
    const admin = await pedir('/api/auth/login', { usuario: 'jefa', clave: 'clave-de-prueba-1' });
    await pedir('/api/usuarios', { usuario: 'profe2', nombre: 'Profe 2', clave: 'clave-de-prueba-1', rol: 'profesor' }, admin.cookie);
    const { cookie } = await pedir('/api/auth/login', { usuario: 'profe2', clave: 'clave-de-prueba-1' });
    for (let i = 0; i < LIMITE + 2; i++) assert.equal((await triaje(cookie, '   ')).status, 422);
    assert.equal((await triaje(cookie)).status, 503, 'el cupo sigue completo');
  });
});

describe('Presupuesto global de llamadas a Gemini', () => {
  const TOPE = REGLAS.LIMITE_IA_GLOBAL_LLAMADAS_MINUTO;

  test('reserva llamadas hasta el tope; la que no cabe lanza 429 IA_OCUPADA y no reserva nada', () => {
    reiniciarPresupuesto();
    const t0 = 1_000_000;
    reservarPresupuesto(TOPE - 2, t0);
    assert.equal(presupuestoRestante(t0), 2);
    assert.throws(() => reservarPresupuesto(3, t0), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.codigo, 'IA_OCUPADA');
      assert.match(error.message, /formulario manual/);
      assert.ok(error.esperaSegundos >= 1);
      return true;
    });
    assert.equal(presupuestoRestante(t0), 2, 'el intento fallido no gastó nada');
    assert.doesNotThrow(() => reservarPresupuesto(2, t0));
    assert.equal(presupuestoRestante(t0), 0);
  });

  test('se recupera cuando las llamadas salen del último minuto, y avisa cuántos segundos faltan', () => {
    reiniciarPresupuesto();
    const t0 = 5_000_000;
    reservarPresupuesto(TOPE, t0);
    assert.throws(() => reservarPresupuesto(1, t0 + 20_000), (e) => e.esperaSegundos === 40);
    assert.equal(presupuestoRestante(t0 + MINUTO - 1), 0);
    assert.equal(presupuestoRestante(t0 + MINUTO), TOPE);
  });

  test('el presupuesto es de todos: lo que gastan varias personas se suma', () => {
    reiniciarPresupuesto();
    const t0 = 9_000_000;
    for (let persona = 0; persona < 4; persona++) reservarPresupuesto(3, t0);
    assert.equal(presupuestoRestante(t0), TOPE - 12);
  });

  test('reservar 0 llamadas (embeddings) nunca falla, ni con el presupuesto agotado', () => {
    reiniciarPresupuesto();
    reservarPresupuesto(TOPE, 1);
    assert.doesNotThrow(() => reservarPresupuesto(0, 1));
  });

  test('devolverCupoIA le regresa a la persona la consulta que no se atendió', () => {
    const t0 = 20_000_000;
    for (let i = 0; i < LIMITE; i++) consumirCupoIA('devuelto', t0);
    assert.throws(() => consumirCupoIA('devuelto', t0));
    devolverCupoIA('devuelto');
    assert.doesNotThrow(() => consumirCupoIA('devuelto', t0));
  });

  test('el tope deja margen bajo las 15 llamadas por minuto de la capa gratis', () => {
    assert.ok(TOPE <= 14);
    assert.ok(REGLAS.UMBRAL_MODO_AHORRO < TOPE);
  });
});

describe('Caché de respuestas del RAG', () => {
  test('una entrada dura el tiempo que se le pida (el RAG, más que el triaje)', () => {
    vaciarCache();
    guardarCache('pregunta', 'respuesta', 0, 'rag', REGLAS.CACHE_RAG_MINUTOS);
    guardarCache('triaje', 'sugerencia', 0, 'triaje');
    const despues = (REGLAS.CACHE_IA_MINUTOS + 1) * MINUTO;
    assert.equal(leerCache('pregunta', despues, 'rag'), 'respuesta');
    assert.equal(leerCache('triaje', despues, 'triaje'), undefined);
    assert.equal(leerCache('pregunta', (REGLAS.CACHE_RAG_MINUTOS + 1) * MINUTO, 'rag'), undefined);
  });
});
