// =====================================================================
// USUARIOS Y SESIONES (inicio de sesión)
// ---------------------------------------------------------------------
// - No hay usuarios ni contraseñas en el repositorio: cada equipo crea
//   su cuenta desde la pantalla de inicio (registro).
// - Las contraseñas se guardan con hash scrypt y sal aleatoria; nunca
//   en texto plano. Las sesiones se guardan con el hash del token.
// - Todo vive en data/auth.json (ignorado por Git). "Restaurar datos"
//   no lo toca, y las sesiones sobreviven a los reinicios de npm run dev.
// =====================================================================

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatosInvalidosError, ErrorApi } from '../domain/errors.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

// AUTH_PATH permite usar otro archivo en los tests.
const RUTA_AUTH = process.env.AUTH_PATH ?? join(RAIZ, 'data', 'auth.json');

// Reglas del inicio de sesión
export const HORAS_SESION = 8;          // tiempo que dura una sesión
const MIN_LARGO_CLAVE = 8;              // largo mínimo de la contraseña
const FORMATO_USUARIO = /^[a-z0-9._-]{3,30}$/; // minúsculas, números, punto, guion

// Roles: el primer usuario registrado es admin; los demás entran como camper.
export const ROLES = ['admin', 'coordinador', 'camper'];
const ROL_POR_DEFECTO = 'camper'; // también para cuentas antiguas que no tienen rol

// 401: no hay sesión o las credenciales no son válidas.
export class NoAutorizadoError extends ErrorApi {
  constructor(mensaje, codigo = 'SESION_REQUERIDA') {
    super(401, codigo, mensaje);
  }
}

// ---------- archivo data/auth.json ----------

function leer() {
  if (!existsSync(RUTA_AUTH)) return { usuarios: [], sesiones: [] };
  return JSON.parse(readFileSync(RUTA_AUTH, 'utf8'));
}

// Escritura atómica, igual que store.js: temporal + rename.
function guardar(datos) {
  mkdirSync(dirname(RUTA_AUTH), { recursive: true });
  const temporal = `${RUTA_AUTH}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(datos, null, 2), 'utf8');
  renameSync(temporal, RUTA_AUTH);
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
const publico = ({ usuario, nombre, rol }) => ({ usuario, nombre, rol: rol ?? ROL_POR_DEFECTO });

// ---------- validación de datos (422) ----------

function validarCredenciales(datos) {
  const usuario = String(datos?.usuario ?? '').trim().toLowerCase();
  const clave = typeof datos?.clave === 'string' ? datos.clave : '';
  if (!usuario || !clave) throw new DatosInvalidosError('Escribe tu usuario y tu contraseña');
  return { usuario, clave };
}

// ---------- funciones públicas ----------

/** Crea una cuenta nueva. Devuelve {usuario, nombre, rol}. */
export function registrar(datos) {
  const { usuario, clave } = validarCredenciales(datos);
  const nombre = String(datos?.nombre ?? '').trim();
  if (!FORMATO_USUARIO.test(usuario)) {
    throw new DatosInvalidosError('El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto o guion');
  }
  if (!nombre) throw new DatosInvalidosError('Escribe tu nombre');
  if (clave.length < MIN_LARGO_CLAVE) {
    throw new DatosInvalidosError(`La contraseña debe tener al menos ${MIN_LARGO_CLAVE} caracteres`);
  }

  const auth = leer();
  if (auth.usuarios.some((u) => u.usuario === usuario)) {
    throw new ErrorApi(409, 'USUARIO_EXISTE', `El usuario "${usuario}" ya existe`);
  }
  const rol = auth.usuarios.length === 0 ? 'admin' : ROL_POR_DEFECTO;
  const nuevo = { usuario, nombre, rol, clave: hashClave(clave) };
  auth.usuarios.push(nuevo);
  guardar(auth);
  return publico(nuevo);
}

/** Comprueba usuario y contraseña. Devuelve {usuario, nombre, rol} o lanza 401. */
export function autenticar(datos) {
  const { usuario, clave } = validarCredenciales(datos);
  const encontrado = leer().usuarios.find((u) => u.usuario === usuario);
  // Mismo mensaje si el usuario no existe o la clave falla: no se revela cuál de los dos
  if (!encontrado || !claveCorrecta(clave, encontrado.clave)) {
    throw new NoAutorizadoError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
  }
  return publico(encontrado);
}

/** Abre una sesión para el usuario y devuelve el token (va en la cookie). */
export function crearSesion(usuario) {
  const token = randomBytes(32).toString('hex');
  const auth = leer();
  const ahora = Date.now();
  // De paso se limpian las sesiones vencidas
  auth.sesiones = auth.sesiones.filter((s) => s.expira > ahora);
  auth.sesiones.push({ token: hashToken(token), usuario, expira: ahora + HORAS_SESION * 3_600_000 });
  guardar(auth);
  return token;
}

/** Usuario dueño del token, o null si no hay sesión válida. */
export function usuarioDeSesion(token) {
  if (!token) return null;
  const auth = leer();
  const sesion = auth.sesiones.find((s) => s.token === hashToken(token) && s.expira > Date.now());
  const usuario = sesion && auth.usuarios.find((u) => u.usuario === sesion.usuario);
  return usuario ? publico(usuario) : null;
}

/** Cierra la sesión del token (si existe). */
export function cerrarSesion(token) {
  if (!token) return;
  const auth = leer();
  auth.sesiones = auth.sesiones.filter((s) => s.token !== hashToken(token));
  guardar(auth);
}
