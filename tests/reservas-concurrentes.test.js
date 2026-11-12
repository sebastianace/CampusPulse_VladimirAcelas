// =====================================================================
// TESTS DE RESERVAS SIMULTÁNEAS (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Con db.json, Node atendía una escritura a la vez y la regla 6 bastaba. Con PostgreSQL varias
// peticiones pueden llegar a la vez. Estos tests comprueban las dos defensas:
//   1. El bloqueo de escritura de actualizarDB: las reglas siempre ven el estado más reciente.
//   2. La restricción EXCLUDE de la base: aunque las reglas no lo noten, la base rechaza el cruce.
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { actualizarDB, leerDB } = await import('../src/data/almacen.js');
const { REGLAS } = await import('../src/config/reglas.js');
const { crearReserva } = await import('../src/domain/reservas.js');

let servidor;
let base;
let cookie;
before(async () => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
  const registro = await fetch(`${base}/api/auth/registro`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: 'jefa', nombre: 'Jefa', clave: 'clave-de-prueba-1' }),
  });
  cookie = registro.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  servidor.close();
  await bd.cerrar();
});

// Un día hábil futuro distinto para cada test, así no se estorban entre sí.
function diaHabil(desdeDias) {
  const f = new Date();
  f.setDate(f.getDate() + desdeDias);
  while (!REGLAS.DIAS_HABILES.includes(f.getDay())) f.setDate(f.getDate() + 1);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

// POST /api/reservas -> {status, cuerpo}
async function reservar(datos) {
  const respuesta = await fetch(`${base}/api/reservas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(datos),
  });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

const reservasDe = async (espacioId, dia) => (await leerDB()).reservas.filter((r) => r.espacioId === espacioId && r.inicio.startsWith(dia));

describe('Por la API: peticiones simultáneas', () => {
  test('dos reservas de la misma sala y franja a la vez: una sola se guarda (201) y la otra recibe 409', async () => {
    const dia = diaHabil(11);
    const franja = { espacioId: 'apolo', asistentes: 5, inicio: `${dia}T10:00`, fin: `${dia}T12:00` };
    const resultados = await Promise.all([reservar({ ...franja, responsable: 'Ana' }), reservar({ ...franja, responsable: 'Luis' })]);

    assert.deepEqual(resultados.map((r) => r.status).sort(), [201, 409]);
    const rechazada = resultados.find((r) => r.status === 409);
    assert.equal(rechazada.cuerpo.error.codigo, 'RESERVA_SOLAPADA');
    assert.equal((await reservasDe('apolo', dia)).length, 1, 'en la base queda una sola reserva');
  });

  test('diez peticiones a la vez por la misma franja: solo una gana', async () => {
    const dia = diaHabil(12);
    const resultados = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      reservar({ espacioId: 'cosmos', responsable: `Persona ${i}`, asistentes: 3, inicio: `${dia}T14:00`, fin: `${dia}T16:00` })));

    assert.equal(resultados.filter((r) => r.status === 201).length, 1);
    assert.equal(resultados.filter((r) => r.status === 409 && r.cuerpo.error.codigo === 'RESERVA_SOLAPADA').length, 9);
    assert.equal((await reservasDe('cosmos', dia)).length, 1);
  });

  test('franjas pegadas pedidas a la vez (10-12 y 12-14) se guardan las dos', async () => {
    const dia = diaHabil(13);
    const resultados = await Promise.all([
      reservar({ espacioId: 'azul', responsable: 'Ana', asistentes: 4, inicio: `${dia}T10:00`, fin: `${dia}T12:00` }),
      reservar({ espacioId: 'azul', responsable: 'Luis', asistentes: 4, inicio: `${dia}T12:00`, fin: `${dia}T14:00` }),
    ]);
    assert.deepEqual(resultados.map((r) => r.status), [201, 201]);
  });

  test('el límite de reservas por persona y día también aguanta peticiones simultáneas', async () => {
    // Esta regla no la cubre la restricción de la base: depende del bloqueo de escritura.
    const dia = diaHabil(14);
    const horas = [8, 9, 10, 11, 12, 13];
    const resultados = await Promise.all(horas.map((h) => reservar({
      espacioId: 'spooki', responsable: 'Maria', asistentes: 5, inicio: `${dia}T${String(h).padStart(2, '0')}:00`, fin: `${dia}T${String(h + 1).padStart(2, '0')}:00`,
    })));

    assert.equal(resultados.filter((r) => r.status === 201).length, REGLAS.MAX_RESERVAS_POR_PERSONA_DIA);
    assert.ok(resultados.filter((r) => r.status === 409).every((r) => r.cuerpo.error.codigo === 'LIMITE_RESERVAS_PERSONA'));
  });
});

describe('Sin el bloqueo de escritura: la restricción de la base es la última defensa', () => {
  // Dos escrituras que leen la base antes de que cualquiera guarde (sin bloqueo). Cada una lee una
  // foto vacía, así que la regla 6 de JavaScript no ve ningún cruce en ninguna de las dos.
  // Con escalonar: true, la segunda espera a que la primera termine antes de aplicar su cambio
  // (resultado determinista); sin escalonar, las dos escriben exactamente a la vez (una carrera pura).
  async function dosEscrituras(espacioId, dia, { escalonar }) {
    let llegaron = 0;
    let abrir;
    const puerta = new Promise((resolver) => { abrir = resolver; });
    let primeraTermino = Promise.resolve();
    const entreLecturaYEscritura = (esLaSegunda) => async () => {
      llegaron += 1;
      if (llegaron === 2) abrir();
      await puerta;
      if (escalonar && esLaSegunda) await primeraTermino;
    };
    let reglasQueDejaronPasar = 0;
    const intentar = (responsable, esLaSegunda) => actualizarDB((db) => {
      const reserva = crearReserva(db, { espacioId, responsable, asistentes: 5, inicio: `${dia}T10:00`, fin: `${dia}T12:00` });
      reglasQueDejaronPasar += 1; // la regla 6 de JavaScript no vio ningún cruce
      return reserva;
    }, { serializar: false, entreLecturaYEscritura: entreLecturaYEscritura(esLaSegunda) });

    const primera = intentar('Ana', false);
    primeraTermino = primera.catch(() => {});
    const resultados = await Promise.allSettled([primera, intentar('Luis', true)]);
    return { resultados, reglasQueDejaronPasar };
  }

  test('con una foto desactualizada: las reglas dejan pasar a ambas y la base rechaza la segunda con el error de la regla', async () => {
    const dia = diaHabil(15);
    const { resultados, reglasQueDejaronPasar } = await dosEscrituras('artemis', dia, { escalonar: true });

    assert.equal(reglasQueDejaronPasar, 2, 'las reglas de JavaScript fueron ciegas al cruce');
    assert.deepEqual(resultados.map((r) => r.status), ['fulfilled', 'rejected']);
    const rechazada = resultados[1].reason;
    assert.equal(rechazada.codigo, 'RESERVA_SOLAPADA', 'la base lo rechazó (23P01) y se tradujo al error de la regla');
    assert.equal(rechazada.status, 409);
    assert.match(rechazada.message, /Artemis ya está reservado en esa franja/);
    assert.equal((await reservasDe('artemis', dia)).length, 1);
  });

  test('en una carrera pura (escrituras exactamente a la vez), la base deja pasar solo una', async () => {
    const dia = diaHabil(16);
    const { resultados } = await dosEscrituras('blanca', dia, { escalonar: false });

    assert.deepEqual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    // PostgreSQL rechaza a la perdedora de una de dos formas: el cruce (23P01, que aquí se traduce
    // a RESERVA_SOLAPADA) o, en una carrera muy ajustada, un deadlock (40P01) que detecta tras ~1 s.
    // Por eso la aplicación mantiene el bloqueo de escritura: con él, la respuesta es siempre un 409 limpio.
    const rechazada = resultados.find((r) => r.status === 'rejected').reason;
    assert.ok(rechazada.codigo === 'RESERVA_SOLAPADA' || rechazada.code === '40P01', `rechazo inesperado: ${rechazada.code ?? rechazada.codigo}`);
    assert.equal((await reservasDe('blanca', dia)).length, 1, 'no hay doble reserva');
  });
});
