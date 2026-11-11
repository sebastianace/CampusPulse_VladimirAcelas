// =====================================================================
// TESTS DE LA CAPA DE DATOS EN POSTGRESQL (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Comprueban que src/data/almacen.js (foto + diferencias) devuelve y guarda los datos
// con la misma forma que db.json y respeta las transacciones.
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { leerDB, actualizarDB, restaurarDB } = await import('../src/data/almacen.js');
const { crearEstadoInicial } = await import('../src/data/store.js');
const { REGLAS } = await import('../src/config/reglas.js');
const { cancelarReserva, crearReserva, editarReserva } = await import('../src/domain/reservas.js');
const { crearIncidencia, resolverIncidencia } = await import('../src/domain/incidencias.js');
const { crearPrestamo, devolverPrestamo } = await import('../src/domain/prestamos.js');

after(async () => { await bd.cerrar(); });

// Un día hábil futuro (para que las reglas de fecha no rechacen la reserva), como YYYY-MM-DD.
function diaHabilFuturo(desdeDias = 10) {
  const f = new Date();
  f.setDate(f.getDate() + desdeDias);
  while (!REGLAS.DIAS_HABILES.includes(f.getDay())) f.setDate(f.getDate() + 1);
  const dos = (n) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}
const DIA = diaHabilFuturo();
const reserva = (cambios = {}) => ({ espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${DIA}T10:00`, fin: `${DIA}T12:00`, ...cambios });

describe('Lectura', () => {
  test('devuelve los mismos espacios, recursos y calidad de datos que db.json, en el mismo orden', async () => {
    const db = await leerDB();
    const esperado = crearEstadoInicial();
    assert.deepEqual(db.espacios, esperado.espacios);
    assert.deepEqual(db.recursos, esperado.recursos);
    assert.deepEqual(db.calidadDatos, esperado.calidadDatos);
    assert.deepEqual([db.reservas, db.prestamos, db.incidencias], [[], [], []]);
  });
});

describe('Reservas: crear, editar y cancelar', () => {
  test('lo que crea una regla queda guardado, con la misma forma', async () => {
    const creada = await actualizarDB((db) => crearReserva(db, reserva()));
    assert.deepEqual((await leerDB()).reservas, [creada]);
    assert.deepEqual(Object.keys(creada), ['id', 'espacioId', 'responsable', 'asistentes', 'inicio', 'fin']);
  });

  test('editar actualiza solo esa fila y conserva el id', async () => {
    const [existente] = (await leerDB()).reservas;
    const editada = await actualizarDB((db) => editarReserva(db, existente.id, { asistentes: 8 }));
    const [guardada] = (await leerDB()).reservas;
    assert.equal(guardada.id, existente.id);
    assert.equal(guardada.asistentes, 8);
    assert.deepEqual(guardada, editada);
  });

  test('cancelar borra la fila', async () => {
    const [existente] = (await leerDB()).reservas;
    await actualizarDB((db) => cancelarReserva(db, existente.id));
    assert.deepEqual((await leerDB()).reservas, []);
  });
});

describe('Transacciones', () => {
  test('si la regla lanza un error, no se guarda nada (ni lo que se alcanzó a cambiar)', async () => {
    await assert.rejects(
      actualizarDB((db) => {
        crearReserva(db, reserva());
        db.espacios[0].estado = 'inhabilitado';
        throw new Error('falla a mitad');
      }),
      { message: 'falla a mitad' },
    );
    const db = await leerDB();
    assert.deepEqual(db.reservas, []);
    assert.equal(db.espacios[0].estado, 'disponible');
  });

  test('si la base rechaza una fila (clave foránea), se revierte también lo demás del mismo cambio', async () => {
    await assert.rejects(actualizarDB((db) => {
      db.espacios[0].estado = 'inhabilitado';
      db.reservas.push({ id: 'res-rota', espacioId: 'no-existe', responsable: 'Ana', asistentes: 1, inicio: `${DIA}T10:00`, fin: `${DIA}T11:00` });
    }), { code: '23503' });
    assert.equal((await leerDB()).espacios[0].estado, 'disponible');
  });

  test('un UPDATE no cambia el orden de las filas', async () => {
    const idsAntes = (await leerDB()).espacios.map((e) => e.id);
    await actualizarDB((db) => { db.espacios[0].aforo = 101; });
    await actualizarDB((db) => { db.espacios[0].aforo = 100; });
    assert.deepEqual((await leerDB()).espacios.map((e) => e.id), idsAntes);
  });
});

describe('Incidencias y préstamos: cambios en varias tablas a la vez', () => {
  const critica = { descripcion: 'El video beam de Apolo huele a quemado', categoria: 'tecnologia', prioridad: 'critica', area: 'Soporte TI', espacioId: 'apolo', recursoId: 'rec-01', origen: 'ia', ia: { razon: 'Riesgo', modelo: 'prueba', sugerencia: { prioridad: 'critica' } } };

  test('una incidencia crítica se guarda junto con el estado nuevo del espacio y del equipo', async () => {
    const creada = await actualizarDB((db) => crearIncidencia(db, critica));
    const db = await leerDB();
    assert.equal(db.espacios.find((e) => e.id === 'apolo').estado, 'inhabilitado');
    assert.equal(db.recursos.find((r) => r.id === 'rec-01').estado, REGLAS.ESTADO_RECURSO_INHABILITADO);
    assert.deepEqual(db.incidencias, [creada]);
    assert.deepEqual(db.incidencias[0].ia, critica.ia, 'el jsonb vuelve igual');
    assert.ok(!('fechaResolucion' in db.incidencias[0]), 'abierta: sin fechaResolucion');
  });

  test('resolverla rehabilita ambos y agrega fechaResolucion', async () => {
    const [abierta] = (await leerDB()).incidencias;
    await actualizarDB((db) => resolverIncidencia(db, abierta.id, { estado: 'resuelta' }));
    const db = await leerDB();
    assert.equal(db.espacios.find((e) => e.id === 'apolo').estado, 'disponible');
    assert.equal(db.recursos.find((r) => r.id === 'rec-01').estado, 'disponible');
    assert.equal(db.incidencias[0].estado, 'resuelta');
    assert.match(db.incidencias[0].fechaResolucion, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  test('un préstamo cambia el estado del equipo y devolverlo agrega fechaDevolucion', async () => {
    const prestamo = await actualizarDB((db) => crearPrestamo(db, { recursoId: 'rec-08', persona: 'Ana' }));
    assert.equal((await leerDB()).recursos.find((r) => r.id === 'rec-08').estado, 'prestado');
    assert.ok(!('fechaDevolucion' in prestamo));
    await actualizarDB((db) => devolverPrestamo(db, prestamo.id, { estadoFinal: 'disponible' }));
    const db = await leerDB();
    assert.equal(db.recursos.find((r) => r.id === 'rec-08').estado, 'disponible');
    assert.equal(db.prestamos[0].estado, 'devuelto');
    assert.ok(db.prestamos[0].fechaDevolucion);
  });
});

describe('Restaurar', () => {
  test('deja la base como al principio: sin reservas, préstamos ni incidencias', async () => {
    await actualizarDB((db) => crearReserva(db, reserva()));
    const db = await restaurarDB();
    assert.deepEqual([db.reservas, db.prestamos, db.incidencias], [[], [], []]);
    assert.deepEqual(db.espacios, crearEstadoInicial().espacios);
  });
});
