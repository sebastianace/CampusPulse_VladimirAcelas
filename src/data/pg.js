// =====================================================================
// CONEXIÓN A POSTGRESQL
// ---------------------------------------------------------------------
// - La conexión sale de DATABASE_URL o, si no existe, de las variables
//   POSTGRES_* del .env (la contraseña nunca está en el repositorio).
// - Los TIMESTAMP sin zona se devuelven como texto "YYYY-MM-DDTHH:mm", el
//   mismo formato que ya usan las reglas de src/domain/ y la API.
// =====================================================================

import pg from 'pg';

const { Pool, types } = pg;

// OID 1114 = timestamp sin zona. Sin esto, pg lo convertiría a un Date de JavaScript
// y las comparaciones de texto de las reglas dejarían de funcionar.
types.setTypeParser(1114, (valor) => valor.replace(' ', 'T').slice(0, 16));

/** URL de conexión. baseDeDatos opcional para apuntar a otra base del mismo servidor. */
export function urlDeConexion(baseDeDatos) {
  const { DATABASE_URL, POSTGRES_PASSWORD, POSTGRES_USER = 'campus', POSTGRES_HOST = '127.0.0.1', POSTGRES_PUERTO = '5433', POSTGRES_DB = 'campus_pulse' } = process.env;
  if (!baseDeDatos && DATABASE_URL) return DATABASE_URL;
  if (!POSTGRES_PASSWORD) throw new Error('Falta POSTGRES_PASSWORD en .env (ver .env.example).');
  // Con URL() la contraseña se codifica sola si tiene caracteres especiales.
  const url = new URL(`postgres://${POSTGRES_HOST}:${POSTGRES_PUERTO}/${baseDeDatos ?? POSTGRES_DB}`);
  url.username = POSTGRES_USER;
  url.password = POSTGRES_PASSWORD;
  return url.toString();
}

/** Pool de conexiones a la base indicada (o a la de Campus Pulse). */
export function crearPool(baseDeDatos) {
  return new Pool({ connectionString: urlDeConexion(baseDeDatos) });
}

/** Traduce un error de conexión en un mensaje que diga qué hacer. */
export function explicarErrorDeConexion(error) {
  const codigo = error.code ?? error.errors?.[0]?.code;
  if (codigo === 'ECONNREFUSED') return 'No hay conexión con PostgreSQL. Levántalo con: docker compose up -d db';
  if (codigo === '28P01') return 'PostgreSQL rechazó la contraseña. Revisa POSTGRES_PASSWORD en .env (si cambiaste la contraseña después de crear el volumen: docker compose down -v).';
  return error.message;
}
