// =====================================================================
// RESPONSABLES POR CATEGORÍA (reparto automático de incidencias)
// ---------------------------------------------------------------------
// En el campus hay 2 técnicos de TI y cada uno atiende una categoría. Esta tabla (responsables_categoria,
// migración 015) dice quién; la administra un admin desde la pestaña Usuarios. Las reglas de cómo se asigna
// una incidencia están en src/domain/incidencias.js: aquí solo se lee y se guarda la configuración.
// =====================================================================

import { CATEGORIAS } from '../config/reglas.js';
import { DatosInvalidosError, NoEncontradoError } from '../domain/errors.js';
import { obtenerPool } from './pg.js';

// Quién puede ser responsable: quien puede atender y resolver incidencias (los mismos roles de PERMISOS.resolverIncidencias)
export const ROLES_RESPONSABLES = ['soporte_tecnico', 'admin'];

/** Map categoría -> usuario. */
export async function leerResponsables(ejecutor = obtenerPool()) {
  const { rows } = await ejecutor.query('SELECT categoria, usuario FROM responsables_categoria');
  return new Map(rows.map((f) => [f.categoria, f.usuario]));
}

/** Lista para la API: [{categoria, usuario, nombre}] con una fila por cada categoría (usuario null si no hay responsable). */
export async function listarResponsables() {
  const { rows } = await obtenerPool().query(
    'SELECT r.categoria, r.usuario, u.nombre FROM responsables_categoria r JOIN usuarios u USING (usuario)');
  const por = new Map(rows.map((f) => [f.categoria, f]));
  return CATEGORIAS.map((categoria) => ({ categoria, usuario: por.get(categoria)?.usuario ?? null, nombre: por.get(categoria)?.nombre ?? null }));
}

/**
 * Define quién atiende una categoría (usuario null = quitar el responsable). Valida que la categoría sea una
 * de las vigentes y que la cuenta exista y pueda atender incidencias. Devuelve la cuenta o null.
 */
export async function fijarResponsable(categoria, usuario) {
  if (!CATEGORIAS.includes(categoria)) throw new DatosInvalidosError(`La categoría debe ser una de: ${CATEGORIAS.join(', ')}`);
  const pool = obtenerPool();
  if (usuario === null || usuario === undefined || usuario === '') {
    await pool.query('DELETE FROM responsables_categoria WHERE categoria = $1', [categoria]);
    return null;
  }
  const cuenta = await cuentaQuePuedeAtender(usuario);
  await pool.query(
    `INSERT INTO responsables_categoria (categoria, usuario) VALUES ($1, $2)
     ON CONFLICT (categoria) DO UPDATE SET usuario = EXCLUDED.usuario`, [categoria, cuenta.usuario]);
  return cuenta;
}

/** La cuenta {usuario, nombre, rol} si existe y su rol puede atender incidencias; 404 si no existe, 422 si no puede. */
export async function cuentaQuePuedeAtender(usuario) {
  const { rows } = await obtenerPool().query('SELECT usuario, nombre, rol FROM usuarios WHERE usuario = $1', [String(usuario)]);
  if (!rows.length) throw new NoEncontradoError(`No existe la cuenta "${usuario}"`);
  if (!ROLES_RESPONSABLES.includes(rows[0].rol)) {
    throw new DatosInvalidosError(`${rows[0].nombre} no puede atender incidencias: elige a alguien de soporte técnico o un administrador`, 'ROL_NO_PUEDE_ATENDER');
  }
  return rows[0];
}
