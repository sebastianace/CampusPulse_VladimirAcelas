// =====================================================================
// SEMILLA DE LA BASE DE DATOS
// ---------------------------------------------------------------------
// Carga espacios, recursos y el reporte de calidad desde los mismos orígenes
// que usa data/db.json: data/raw/espacios.csv (oficial, nunca se modifica),
// data/seed/espacios-extra.json y data/seed/recursos.json.
// - Borra y vuelve a cargar espacios, recursos, reservas, préstamos e
//   incidencias, todo en una transacción. NO toca usuarios ni sesiones
//   (igual que "Restaurar datos", que no borra las cuentas).
// Uso:  npm run semilla
// =====================================================================

import { crearEstadoInicial } from './store.js';
import { migrar } from './migrar.js';
import { crearPool, explicarErrorDeConexion } from './pg.js';

/** Deja la base en el estado inicial. Devuelve cuántos espacios y recursos cargó. */
export async function sembrar(pool) {
  const { espacios, recursos, calidadDatos } = crearEstadoInicial();
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // Una sola sentencia: TRUNCATE exige listar también las tablas que apuntan a espacios y recursos.
    // RESTART IDENTITY reinicia la columna "posicion", que guarda el orden de las filas.
    await cliente.query('TRUNCATE reservas, prestamos, incidencias, recursos, espacios, calidad_datos RESTART IDENTITY');
    for (const e of espacios) {
      await cliente.query('INSERT INTO espacios (id, nombre, tipo, aforo, estado) VALUES ($1, $2, $3, $4, $5)',
        [e.id, e.nombre, e.tipo, e.aforo ?? null, e.estado]);
    }
    for (const r of recursos) {
      await cliente.query('INSERT INTO recursos (id, nombre, tipo, espacio_id, estado, ficticio) VALUES ($1, $2, $3, $4, $5, $6)',
        [r.id, r.nombre, r.tipo, r.espacioId ?? null, r.estado, r.ficticio === true]);
    }
    await cliente.query('INSERT INTO calidad_datos (id, cargados, validos, inconsistentes) VALUES (1, $1, $2, $3)',
      [calidadDatos.cargados, calidadDatos.validos, JSON.stringify(calidadDatos.inconsistentes)]);
    await cliente.query('COMMIT');
    return { espacios: espacios.length, recursos: recursos.length };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

if (import.meta.main) {
  const pool = crearPool();
  try {
    await migrar(pool);
    const { espacios, recursos } = await sembrar(pool);
    console.log(`Semilla cargada: ${espacios} espacios y ${recursos} recursos.`);
  } catch (error) {
    console.error(explicarErrorDeConexion(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
