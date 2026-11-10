// =====================================================================
// TESTS DEL ESQUEMA DE POSTGRESQL (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Prueban las migraciones, las restricciones (sobre todo que la base
// rechace reservas solapadas) y la semilla. Usan una base temporal.
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDePrueba } from './ayuda-bd.js';
import { migrar } from '../src/data/migrar.js';
import { sembrar } from '../src/data/semilla.js';
import { crearEstadoInicial } from '../src/data/store.js';
import {
  AREAS, CATEGORIAS, ESTADOS_ESPACIO, ESTADOS_INCIDENCIA, ESTADOS_PRESTAMO, ESTADOS_RECURSO, ORIGENES_INCIDENCIA, PRIORIDADES,
} from '../src/config/reglas.js';

const TABLAS = ['calidad_datos', 'espacios', 'incidencias', 'prestamos', 'recursos', 'reservas', 'schema_migrations', 'sesiones', 'usuarios'];

let bd;
let pool;
before(async () => {
  bd = await crearBaseDePrueba();
  pool = bd.pool;
});
after(async () => { await bd.cerrar(); });

// Ejecuta una consulta que debe fallar y devuelve el código de error de PostgreSQL.
async function codigoDeError(sql, params = []) {
  try {
    await pool.query(sql, params);
  } catch (error) {
    return error.code;
  }
  return null;
}

const espacio = (id, estado = 'disponible') => pool.query(
  'INSERT INTO espacios (id, nombre, tipo, aforo, estado) VALUES ($1, $1, $2, $3, $4) ON CONFLICT DO NOTHING', [id, 'sala', 10, estado]);
const reservar = (id, espacioId, inicio, fin) => pool.query(
  'INSERT INTO reservas (id, espacio_id, responsable, asistentes, inicio, fin) VALUES ($1, $2, $3, $4, $5, $6)', [id, espacioId, 'Ana', 5, inicio, fin]);

describe('Migraciones', () => {
  test('crean las tablas del esquema y las extensiones vector y btree_gist', async () => {
    const tablas = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((f) => f.tablename);
    assert.deepEqual(tablas, TABLAS);
    const extensiones = (await pool.query("SELECT extname FROM pg_extension WHERE extname IN ('vector', 'btree_gist') ORDER BY extname")).rows.map((f) => f.extname);
    assert.deepEqual(extensiones, ['btree_gist', 'vector']);
  });

  test('volver a migrar no repite nada', async () => {
    assert.deepEqual(await migrar(pool), []);
    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map((f) => f.version), ['001_extensiones.sql', '002_esquema.sql', '003_orden.sql']);
  });
});

describe('Reservas: no solapamiento en la base de datos', () => {
  before(async () => { await espacio('sala-a'); await espacio('sala-b'); });

  test('dos reservas del mismo espacio que se cruzan: la base rechaza la segunda (23P01)', async () => {
    await reservar('r-1', 'sala-a', '2026-11-09T10:00', '2026-11-09T12:00');
    assert.equal(await codigoDeError(
      'INSERT INTO reservas (id, espacio_id, responsable, asistentes, inicio, fin) VALUES ($1, $2, $3, $4, $5, $6)',
      ['r-2', 'sala-a', 'Luis', 3, '2026-11-09T11:00', '2026-11-09T13:00']), '23P01');
  });

  test('una reserva que contiene a otra, o que queda dentro de ella, también se rechaza', async () => {
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-3', 'sala-a', 'Luis', 3, '2026-11-09T09:00', '2026-11-09T13:00']), '23P01');
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-4', 'sala-a', 'Luis', 3, '2026-11-09T10:30', '2026-11-09T11:00']), '23P01');
  });

  test('franjas pegadas (10-12 y 12-14) sí se permiten', async () => {
    await reservar('r-5', 'sala-a', '2026-11-09T12:00', '2026-11-09T14:00');
    await reservar('r-6', 'sala-a', '2026-11-09T08:00', '2026-11-09T10:00');
  });

  test('la misma franja en otro espacio, o en otro día, sí se permite', async () => {
    await reservar('r-7', 'sala-b', '2026-11-09T10:00', '2026-11-09T12:00');
    await reservar('r-8', 'sala-a', '2026-11-10T10:00', '2026-11-10T12:00');
  });

  test('al cancelar (borrar) una reserva, la franja queda libre', async () => {
    await pool.query("DELETE FROM reservas WHERE id = 'r-1'");
    await reservar('r-9', 'sala-a', '2026-11-09T10:00', '2026-11-09T12:00');
  });

  test('fin antes o igual al inicio (23514) y asistentes <= 0 (23514)', async () => {
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-10', 'sala-b', 'Ana', 3, '2026-11-11T12:00', '2026-11-11T10:00']), '23514');
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-11', 'sala-b', 'Ana', 3, '2026-11-11T12:00', '2026-11-11T12:00']), '23514');
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-12', 'sala-b', 'Ana', 0, '2026-11-11T10:00', '2026-11-11T12:00']), '23514');
  });

  test('un espacio que no existe se rechaza (23503)', async () => {
    assert.equal(await codigoDeError('INSERT INTO reservas VALUES ($1, $2, $3, $4, $5, $6)', ['r-13', 'no-existe', 'Ana', 3, '2026-11-11T10:00', '2026-11-11T12:00']), '23503');
  });

  test('las fechas vuelven como texto YYYY-MM-DDTHH:mm, el formato de las reglas', async () => {
    const { rows } = await pool.query("SELECT inicio, fin FROM reservas WHERE id = 'r-5'");
    assert.deepEqual(rows[0], { inicio: '2026-11-09T12:00', fin: '2026-11-09T14:00' });
  });
});

describe('Valores cerrados: la base y src/config/reglas.js coinciden', () => {
  // Intenta insertar cada valor de reglas.js; si la base tuviera un CHECK distinto, falla.
  test('estados de espacio y de recurso', async () => {
    for (const [i, estado] of ESTADOS_ESPACIO.entries()) await espacio(`esp-estado-${i}`, estado);
    for (const [i, estado] of ESTADOS_RECURSO.entries()) {
      await pool.query('INSERT INTO recursos (id, nombre, tipo, estado) VALUES ($1, $1, $2, $3)', [`rec-estado-${i}`, 'video_beam', estado]);
    }
  });

  test('categorías, prioridades, áreas, orígenes y estados de incidencia', async () => {
    const insertar = (id, c, p, a, o, e) => pool.query(
      `INSERT INTO incidencias (id, descripcion, categoria, prioridad, area, origen, estado, fecha)
       VALUES ($1, 'x', $2, $3, $4, $5, $6, '2026-11-09T10:00')`, [id, c, p, a, o, e]);
    for (const [i, c] of CATEGORIAS.entries()) await insertar(`inc-c-${i}`, c, 'media', 'Soporte TI', 'manual', 'abierta');
    for (const [i, p] of PRIORIDADES.entries()) await insertar(`inc-p-${i}`, 'otro', p, 'Soporte TI', 'manual', 'abierta');
    for (const [i, a] of AREAS.entries()) await insertar(`inc-a-${i}`, 'otro', 'media', a, 'manual', 'abierta');
    for (const [i, o] of ORIGENES_INCIDENCIA.entries()) await insertar(`inc-o-${i}`, 'otro', 'media', 'Soporte TI', o, 'abierta');
    for (const [i, e] of ESTADOS_INCIDENCIA.entries()) await insertar(`inc-e-${i}`, 'otro', 'media', 'Soporte TI', 'manual', e);
  });

  test('estados de préstamo', async () => {
    for (const [i, estado] of ESTADOS_PRESTAMO.entries()) {
      await pool.query("INSERT INTO prestamos (id, recurso_id, persona, estado, fecha) VALUES ($1, 'rec-estado-0', 'Ana', $2, '2026-11-09T10:00')", [`pre-${i}`, estado]);
    }
  });

  test('un valor que no existe se rechaza (23514)', async () => {
    assert.equal(await codigoDeError("INSERT INTO espacios VALUES ('x', 'x', 'sala', 5, 'roto')"), '23514');
    assert.equal(await codigoDeError("INSERT INTO incidencias (id, descripcion, categoria, prioridad, area, origen, estado, fecha) VALUES ('i', 'x', 'magia', 'media', 'Soporte TI', 'manual', 'abierta', '2026-11-09T10:00')"), '23514');
  });
});

describe('Usuarios y sesiones', () => {
  test('solo se aceptan los roles admin, profesor y soporte_tecnico', async () => {
    for (const rol of ['admin', 'profesor', 'soporte_tecnico']) {
      await pool.query("INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ($1, $1, $2, 'hash')", [`u-${rol}`, rol]);
    }
    for (const rol of ['camper', 'coordinador']) {
      assert.equal(await codigoDeError("INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ($1, $1, $2, 'hash')", [`u-${rol}`, rol]), '23514', rol);
    }
  });

  test('al borrar un usuario se borran sus sesiones', async () => {
    await pool.query("INSERT INTO sesiones (token_hash, usuario, expira) VALUES ('t1', 'u-admin', now() + interval '8 hours')");
    await pool.query("DELETE FROM usuarios WHERE usuario = 'u-admin'");
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM sesiones')).rows[0].n, 0);
  });
});

describe('Semilla', () => {
  test('carga los espacios, recursos y el reporte de calidad que hoy carga db.json', async () => {
    const resultado = await sembrar(pool);
    const esperado = crearEstadoInicial();
    assert.deepEqual(resultado, { espacios: esperado.espacios.length, recursos: esperado.recursos.length });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM espacios')).rows[0].n, 11);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM recursos')).rows[0].n, 12);
    const { rows } = await pool.query('SELECT cargados, validos, inconsistentes FROM calidad_datos');
    assert.deepEqual(rows, [{ cargados: esperado.calidadDatos.cargados, validos: esperado.calidadDatos.validos, inconsistentes: esperado.calidadDatos.inconsistentes }]);
  });

  test('un recurso sin sala queda con espacio_id NULL', async () => {
    const { rows } = await pool.query("SELECT espacio_id FROM recursos WHERE id = 'rec-09'");
    assert.equal(rows[0].espacio_id, null);
  });

  test('sembrar de nuevo no duplica y borra reservas e incidencias, pero conserva usuarios', async () => {
    await pool.query("INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ('conservada', 'x', 'profesor', 'hash')");
    await pool.query("INSERT INTO reservas VALUES ('res-semilla', 'apolo', 'Ana', 5, '2026-11-12T10:00', '2026-11-12T11:00')");
    await sembrar(pool);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM espacios')).rows[0].n, 11);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM reservas')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM incidencias')).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM usuarios WHERE usuario = 'conservada'")).rows[0].n, 1);
  });
});
