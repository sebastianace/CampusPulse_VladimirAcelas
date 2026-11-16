// =====================================================================
// RESTABLECER LA CONTRASEÑA DE UN ADMIN DESDE LA TERMINAL
// ---------------------------------------------------------------------
// Para cuando el único admin olvidó su contraseña y no hay otro admin que
// se la restablezca desde la app. Solo lo puede correr quien tiene acceso
// al servidor y a la base de datos (no es una ruta de la API).
//   npm run restablecer-admin              -> lista las cuentas admin
//   npm run restablecer-admin -- <usuario>  -> contraseña temporal para ese admin
// La contraseña temporal se muestra UNA vez: entrégala en persona. Al
// entrar, la app obliga a cambiarla. Sus sesiones abiertas se cierran.
// Si no hay ninguna cuenta, no hace falta: la pantalla de inicio deja
// registrar la primera, que es admin.
// =====================================================================

import { migrar } from '../data/migrar.js';
import { crearPool, explicarErrorDeConexion } from '../data/pg.js';
import { restablecerClave } from './usuarios.js';

/**
 * Lógica del script, separada para poder probarla. Devuelve {admins} si no se pidió usuario,
 * o {usuario, claveTemporal}. Lanza un Error con un mensaje claro si el usuario no existe o no es admin.
 */
export async function restablecerAdmin(pool, usuario) {
  const { rows: admins } = await pool.query("SELECT usuario, nombre FROM usuarios WHERE rol = 'admin' ORDER BY creado");
  if (!usuario) return { admins };
  const { rows } = await pool.query('SELECT rol FROM usuarios WHERE usuario = $1', [usuario]);
  if (!rows[0]) throw new Error(`No existe el usuario "${usuario}". Admins: ${admins.map((a) => a.usuario).join(', ') || 'ninguno'}`);
  if (rows[0].rol !== 'admin') throw new Error(`"${usuario}" no es admin: su contraseña la restablece un admin desde la pestaña Usuarios`);
  return restablecerClave(usuario, pool);
}

if (import.meta.main) {
  const usuario = process.argv[2]?.trim().toLowerCase();
  const pool = crearPool();
  try {
    await migrar(pool);
    const resultado = await restablecerAdmin(pool, usuario);
    if (resultado.admins) {
      console.log(resultado.admins.length
        ? `Cuentas admin: ${resultado.admins.map((a) => `${a.usuario} (${a.nombre})`).join(', ')}\nUso: npm run restablecer-admin -- <usuario>`
        : 'No hay cuentas admin. Si no hay ninguna cuenta, registra la primera desde la pantalla de inicio: será admin.');
    } else {
      console.log(`Contraseña temporal de ${resultado.usuario}: ${resultado.claveTemporal}`);
      console.log('Se muestra solo esta vez. Al entrar, Campus Pulse pedirá cambiarla. Sus sesiones abiertas se cerraron.');
    }
  } catch (error) {
    console.error(error.code ? explicarErrorDeConexion(error) : error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
