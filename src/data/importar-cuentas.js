// =====================================================================
// IMPORTAR CUENTAS DEL VIEJO data/auth.json
// ---------------------------------------------------------------------
// Antes las cuentas vivían en data/auth.json; ahora viven en PostgreSQL. Este script copia las
// cuentas a la tabla usuarios para no perderlas. Se corre una sola vez:  npm run importar-cuentas
// - Los hashes de las claves se copian tal cual: la gente entra con la misma contraseña.
// - Las sesiones no se importan: hay que volver a iniciar sesión.
// - Un rol que ya no existe (camper, coordinador) o ausente pasa a profesor.
// - Una cuenta que ya está en la base no se toca (se puede correr dos veces sin duplicar).
// - Si al terminar no hay ningún admin, la primera cuenta importada pasa a admin: es la misma
//   regla de siempre ("la primera cuenta es admin"), y sin admin nadie podría crear cuentas.
// =====================================================================

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLES } from '../auth/usuarios.js';
import { crearPool, explicarErrorDeConexion } from './pg.js';

const RUTA_POR_DEFECTO = fileURLToPath(new URL('../../data/auth.json', import.meta.url));
const ROL_POR_DEFECTO = 'profesor';

/**
 * Copia las cuentas de un auth.json a la tabla usuarios.
 * Devuelve {importadas, yaExistian, adminAscendido} (adminAscendido: usuario promovido, o null).
 */
export async function importarCuentas(pool, ruta = RUTA_POR_DEFECTO) {
  if (!existsSync(ruta)) throw new Error(`No existe ${ruta}`);
  const { usuarios = [] } = JSON.parse(readFileSync(ruta, 'utf8'));
  const cliente = await pool.connect();
  let importadas = 0;
  let yaExistian = 0;
  let primera = null;
  try {
    await cliente.query('BEGIN');
    for (const u of usuarios) {
      const rol = ROLES.includes(u.rol) ? u.rol : ROL_POR_DEFECTO;
      const { rowCount } = await cliente.query(
        'INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (usuario) DO NOTHING',
        [u.usuario, u.nombre, rol, u.clave]);
      if (rowCount === 1) {
        importadas += 1;
        primera ??= u.usuario;
      } else {
        yaExistian += 1;
      }
    }
    let adminAscendido = null;
    const { rows } = await cliente.query("SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'");
    if (rows[0].n === 0 && primera) {
      await cliente.query("UPDATE usuarios SET rol = 'admin' WHERE usuario = $1", [primera]);
      adminAscendido = primera;
    }
    await cliente.query('COMMIT');
    return { importadas, yaExistian, adminAscendido };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

if (import.meta.main) {
  const pool = crearPool();
  try {
    const { importadas, yaExistian, adminAscendido } = await importarCuentas(pool, process.argv[2]);
    console.log(`Cuentas importadas: ${importadas}. Ya existían: ${yaExistian}.`);
    if (adminAscendido) console.log(`No había ningún admin: "${adminAscendido}" pasó a ser admin.`);
    console.log('Las sesiones no se importan: vuelve a iniciar sesión.');
  } catch (error) {
    console.error(explicarErrorDeConexion(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
