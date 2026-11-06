// =====================================================================
// MIGRACIONES
// ---------------------------------------------------------------------
// Aplica en orden los archivos db/migrations/NNN_nombre.sql que aún no se
// hayan aplicado. Cada archivo corre en su propia transacción: si falla,
// no queda a medias. Lo aplicado se anota en la tabla schema_migrations.
// Uso:  npm run migrar
// =====================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearPool, explicarErrorDeConexion } from './pg.js';

const CARPETA = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const BLOQUEO = 727274; // número cualquiera: evita que dos procesos migren a la vez

/** Aplica las migraciones pendientes. Devuelve los nombres de las que aplicó. */
export async function migrar(pool, carpeta = CARPETA) {
  const cliente = await pool.connect();
  const aplicadas = [];
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [BLOQUEO]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`);
    const hechas = new Set((await cliente.query('SELECT version FROM schema_migrations')).rows.map((f) => f.version));

    const archivos = readdirSync(carpeta).filter((a) => /^\d+_.+\.sql$/.test(a)).sort();
    for (const archivo of archivos.filter((a) => !hechas.has(a))) {
      try {
        await cliente.query('BEGIN');
        await cliente.query(readFileSync(join(carpeta, archivo), 'utf8'));
        await cliente.query('INSERT INTO schema_migrations (version) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        aplicadas.push(archivo);
      } catch (error) {
        await cliente.query('ROLLBACK');
        error.message = `La migración ${archivo} falló: ${error.message}`;
        throw error;
      }
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [BLOQUEO]).catch(() => {});
    cliente.release();
  }
  return aplicadas;
}

if (import.meta.main) {
  const pool = crearPool();
  try {
    const aplicadas = await migrar(pool);
    console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'La base ya está al día.');
  } catch (error) {
    console.error(explicarErrorDeConexion(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
