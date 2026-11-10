// =====================================================================
// AYUDANTE DE LOS TESTS CON POSTGRESQL (no es un test)
// ---------------------------------------------------------------------
// crearBaseDePrueba() crea una base temporal (campus_test_<aleatorio>) en el
// PostgreSQL de docker compose, le aplica las migraciones y devuelve el pool.
// cerrar() la borra. Cada archivo de test usa la suya, así corren en paralelo
// sin pisarse. Si PostgreSQL no está levantado, el error dice qué hacer.
// =====================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { migrar } from '../src/data/migrar.js';
import { cerrarPool, crearPool, explicarErrorDeConexion } from '../src/data/pg.js';
import { sembrar } from '../src/data/semilla.js';

// Toma del .env SOLO las variables de la base (no se carga la key de Gemini en los tests).
// Lo que ya esté en el entorno tiene prioridad.
function cargarVariablesDeBase() {
  const ruta = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(ruta)) return;
  for (const [clave, valor] of Object.entries(parseEnv(readFileSync(ruta, 'utf8')))) {
    if ((clave.startsWith('POSTGRES_') || clave === 'DATABASE_URL') && valor && process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  }
}

/** Crea una base temporal. Con migrada: false se queda vacía (para probar las migraciones). */
export async function crearBaseDePrueba({ migrada = true } = {}) {
  cargarVariablesDeBase();
  // DATABASE_URL apuntaría a la base real: en los tests nunca se usa.
  delete process.env.DATABASE_URL;
  const nombre = `campus_test_${randomBytes(4).toString('hex')}`;
  const admin = crearPool('postgres');
  try {
    await admin.query(`CREATE DATABASE ${nombre}`);
  } catch (error) {
    await admin.end();
    throw new Error(`No se pudo preparar la base de pruebas. ${explicarErrorDeConexion(error)}`);
  }
  const pool = crearPool(nombre);
  if (migrada) await migrar(pool);
  return {
    pool,
    nombre,
    async cerrar() {
      await pool.end();
      await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/**
 * Base temporal ya migrada y sembrada, y la deja como la base de la aplicación (POSTGRES_DB):
 * llámala ANTES de importar src/server.js. cerrar() cierra también el pool de la app y borra la base.
 */
export async function crearBaseDeLaApp() {
  const bd = await crearBaseDePrueba();
  await sembrar(bd.pool);
  process.env.POSTGRES_DB = bd.nombre;
  return {
    ...bd,
    async cerrar() {
      await cerrarPool();
      await bd.cerrar();
    },
  };
}
