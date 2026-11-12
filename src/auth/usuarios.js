// =====================================================================
// USUARIOS Y SESIONES (inicio de sesión)
// ---------------------------------------------------------------------
// - No hay usuarios ni contraseñas en el repositorio: la primera cuenta se
//   crea desde la pantalla de inicio (registro) y es admin; las demás las
//   crea un admin.
// - Las contraseñas se guardan con hash scrypt y sal aleatoria; nunca
//   en texto plano. Las sesiones se guardan con el hash del token.
// - Todo vive en PostgreSQL (tablas usuarios y sesiones). "Restaurar datos"
//   no lo toca, y las sesiones sobreviven a los reinicios del servidor.
// =====================================================================

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { obtenerPool } from '../data/pg.js';
import { DatosInvalidosError, ErrorApi } from '../domain/errors.js';

// Reglas del inicio de sesión
export const HORAS_SESION = 8;          // tiempo que dura una sesión
const MIN_LARGO_CLAVE = 8;              // largo mínimo de la contraseña
const FORMATO_USUARIO = /^[a-z0-9._-]{3,30}$/; // minúsculas, números, punto, guion

// Roles: el primer usuario registrado es admin; el admin crea a los demás (profesor o soporte técnico).
export const ROLES = ['admin', 'profesor', 'soporte_tecnico'];
export const ROLES_CREABLES = ['profesor', 'soporte_tecnico']; // los que un admin puede crear
const ROL_POR_DEFECTO = 'profesor'; // al importar cuentas antiguas sin rol o con un rol que ya no existe

// 401: no hay sesión o las credenciales no son válidas.
export class NoAutorizadoError extends ErrorApi {
  constructor(mensaje, codigo = 'SESION_REQUERIDA') {
    super(401, codigo, mensaje);
  }
}

// ---------- contraseñas y tokens ----------

function hashClave(clave, sal = randomBytes(16).toString('hex')) {
  return `${sal}:${scryptSync(clave, sal, 64).toString('hex')}`;
}

function claveCorrecta(clave, guardada) {
  const [sal, hash] = guardada.split(':');
  const calculado = scryptSync(clave, sal, 64);
  return timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Lo que se devuelve al cliente: nunca el hash de la clave.
const publico = ({ usuario, nombre, rol }) => ({ usuario, nombre, rol: ROLES.includes(rol) ? rol : ROL_POR_DEFECTO });

// ---------- validación de datos (422) ----------

function validarCredenciales(datos) {
  const usuario = String(datos?.usuario ?? '').trim().toLowerCase();
  const clave = typeof datos?.clave === 'string' ? datos.clave : '';
  if (!usuario || !clave) throw new DatosInvalidosError('Escribe tu usuario y tu contraseña');
  return { usuario, clave };
}

// ---------- funciones públicas ----------

const BLOQUEO_REGISTRO = 727276; // número cualquiera: evita que dos registros simultáneos creen dos admins
const USUARIO_REPETIDO = '23505'; // error de PostgreSQL: la clave primaria ya existe

// Valida los datos y calcula el hash de la clave (422 si algo está mal). No toca la base.
function prepararUsuario(datos) {
  const { usuario, clave } = validarCredenciales(datos);
  const nombre = String(datos?.nombre ?? '').trim();
  if (!FORMATO_USUARIO.test(usuario)) {
    throw new DatosInvalidosError('El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto o guion');
  }
  if (!nombre) throw new DatosInvalidosError('Escribe tu nombre');
  if (clave.length < MIN_LARGO_CLAVE) {
    throw new DatosInvalidosError(`La contraseña debe tener al menos ${MIN_LARGO_CLAVE} caracteres`);
  }
  return { usuario, nombre, claveHash: hashClave(clave) };
}

// Inserta el usuario con el rol indicado. La clave primaria impide repetidos, incluso si dos
// peticiones piden el mismo usuario a la vez.
async function insertarUsuario(ejecutor, { usuario, nombre, claveHash }, rol) {
  try {
    await ejecutor.query('INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ($1, $2, $3, $4)', [usuario, nombre, rol, claveHash]);
  } catch (error) {
    if (error.code === USUARIO_REPETIDO) throw new ErrorApi(409, 'USUARIO_EXISTE', `El usuario "${usuario}" ya existe`);
    throw error;
  }
  return publico({ usuario, nombre, rol });
}

/**
 * Registro público: solo sirve para crear la primera cuenta, que es admin.
 * Después el registro se cierra y las cuentas las crea un admin con crearCuenta().
 * Contar y crear van en una transacción con bloqueo: si dos personas se registran a la vez en una
 * base vacía, solo una crea la cuenta admin y la otra recibe 403.
 */
export async function registrar(datos) {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock($1)', [BLOQUEO_REGISTRO]);
    const { rows } = await cliente.query('SELECT count(*)::int AS n FROM usuarios');
    if (rows[0].n > 0) {
      throw new ErrorApi(403, 'REGISTRO_CERRADO', 'El registro está cerrado: pide a un administrador que cree tu cuenta');
    }
    const creada = await insertarUsuario(cliente, prepararUsuario(datos), 'admin');
    await cliente.query('COMMIT');
    return creada;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

/** ¿Está abierto el registro público? Solo mientras no exista ninguna cuenta. */
export async function registroAbierto() {
  const { rows } = await obtenerPool().query('SELECT NOT EXISTS (SELECT 1 FROM usuarios) AS abierto');
  return rows[0].abierto;
}

/** Todas las cuentas, sin claves: [{usuario, nombre, rol}]. */
export async function listarUsuarios() {
  const { rows } = await obtenerPool().query('SELECT usuario, nombre, rol FROM usuarios ORDER BY creado, usuario');
  return rows.map(publico);
}

/** Cuenta creada por un admin. El rol debe ser uno de ROLES_CREABLES. Devuelve {usuario, nombre, rol}. */
export async function crearCuenta(datos) {
  if (!ROLES_CREABLES.includes(datos?.rol)) {
    throw new DatosInvalidosError(`El rol debe ser uno de: ${ROLES_CREABLES.join(', ')}`);
  }
  return insertarUsuario(obtenerPool(), prepararUsuario(datos), datos.rol);
}

/** Comprueba usuario y contraseña. Devuelve {usuario, nombre, rol} o lanza 401. */
export async function autenticar(datos) {
  const { usuario, clave } = validarCredenciales(datos);
  const { rows } = await obtenerPool().query('SELECT usuario, nombre, rol, clave_hash FROM usuarios WHERE usuario = $1', [usuario]);
  const encontrado = rows[0];
  // Mismo mensaje si el usuario no existe o la clave falla: no se revela cuál de los dos
  if (!encontrado || !claveCorrecta(clave, encontrado.clave_hash)) {
    throw new NoAutorizadoError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }
  return publico(encontrado);
}

/** Abre una sesión para el usuario y devuelve el token (va en la cookie). */
export async function crearSesion(usuario) {
  const token = randomBytes(32).toString('hex');
  const pool = obtenerPool();
  await pool.query('DELETE FROM sesiones WHERE expira < now()'); // de paso se limpian las vencidas
  await pool.query('INSERT INTO sesiones (token_hash, usuario, expira) VALUES ($1, $2, now() + make_interval(hours => $3))',
    [hashToken(token), usuario, HORAS_SESION]);
  return token;
}

/** Usuario dueño del token, o null si no hay sesión válida. */
export async function usuarioDeSesion(token) {
  if (!token) return null;
  const { rows } = await obtenerPool().query(
    `SELECT u.usuario, u.nombre, u.rol FROM sesiones s JOIN usuarios u USING (usuario)
     WHERE s.token_hash = $1 AND s.expira > now()`, [hashToken(token)]);
  return rows[0] ? publico(rows[0]) : null;
}

/** Cierra la sesión del token (si existe). */
export async function cerrarSesion(token) {
  if (!token) return;
  await obtenerPool().query('DELETE FROM sesiones WHERE token_hash = $1', [hashToken(token)]);
}
