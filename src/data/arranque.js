// Prepara la base al arrancar el servidor: aplica las migraciones pendientes y, si la base está
// vacía (primera vez), carga la semilla. Así `npm run dev` funciona sin pasos manuales extra,
// siempre que PostgreSQL esté levantado (docker compose up -d db).

import { migrar } from './migrar.js';
import { obtenerPool } from './pg.js';
import { sembrar } from './semilla.js';

export async function prepararBase() {
  const pool = obtenerPool();
  await migrar(pool);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM espacios');
  if (rows[0].n === 0) await sembrar(pool);
}
