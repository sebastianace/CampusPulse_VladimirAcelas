// =====================================================================
// RUTAS DE INICIO DE SESIÓN
// ---------------------------------------------------------------------
// POST /api/auth/registro {usuario, nombre, clave} -> 201 {usuario, nombre, rol} y abre sesión
// POST /api/auth/login    {usuario, clave}         -> 200 {usuario, nombre, rol} y abre sesión
//                                                     (429 tras 5 fallos en 15 min, ver intentos.js)
// POST /api/auth/logout                            -> 200 y cierra la sesión
// GET  /api/auth/yo                                -> 200 {usuario, nombre, rol} o 401
// La sesión viaja en la cookie "sesion" (HttpOnly: el JavaScript de la
// página no la puede leer).
// =====================================================================

import { Router } from 'express';
import { HORAS_SESION, NoAutorizadoError, autenticar, cerrarSesion, crearSesion, registrar, usuarioDeSesion } from '../auth/usuarios.js';
import { limpiarFallos, registrarFallo, segundosDeBloqueo } from '../auth/intentos.js';
import { DemasiadasPeticionesError, ProhibidoError } from '../domain/errors.js';

const COOKIE = 'sesion';

const router = Router();

/** Lee el token de la cookie "sesion" de la petición. */
export function tokenDe(req) {
  const cookies = req.headers.cookie ?? '';
  const par = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return par ? decodeURIComponent(par.slice(COOKIE.length + 1)) : null;
}

function abrirSesion(res, usuario) {
  const token = crearSesion(usuario.usuario);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: HORAS_SESION * 3_600_000 });
}

router.post('/registro', (req, res) => {
  const usuario = registrar(req.body);
  abrirSesion(res, usuario);
  res.status(201).json(usuario);
});

router.post('/login', (req, res) => {
  // Mismo formato que usa autenticar(): así "ANA" y "ana" cuentan como el mismo usuario
  const pedido = String(req.body?.usuario ?? '').trim().toLowerCase();
  const espera = segundosDeBloqueo(pedido, req.ip);
  if (espera > 0) {
    res.set('Retry-After', String(espera));
    throw new DemasiadasPeticionesError(
      `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(espera / 60)} minuto(s)`,
      'DEMASIADOS_INTENTOS',
    );
  }

  let usuario;
  try {
    usuario = autenticar(req.body);
  } catch (error) {
    if (error.codigo === 'CREDENCIALES_INVALIDAS') registrarFallo(pedido, req.ip);
    throw error;
  }
  limpiarFallos(pedido, req.ip);
  abrirSesion(res, usuario);
  res.json(usuario);
});

router.post('/logout', (req, res) => {
  cerrarSesion(tokenDe(req));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ mensaje: 'Sesión cerrada' });
});

router.get('/yo', (req, res) => {
  const usuario = usuarioDeSesion(tokenDe(req));
  if (!usuario) throw new NoAutorizadoError('Inicia sesión para continuar');
  res.json(usuario);
});

/** Middleware: deja pasar solo peticiones con sesión válida (si no, 401). */
export function exigirSesion(req, res, next) {
  const usuario = usuarioDeSesion(tokenDe(req));
  if (!usuario) throw new NoAutorizadoError('Inicia sesión para continuar');
  req.usuario = usuario;
  next();
}

/**
 * Middleware: deja pasar solo a los roles indicados (si no, 403).
 * Va después de exigirSesion, que es quien pone req.usuario.
 * Uso: router.post('/', exigirRol('admin', 'coordinador'), ...)
 */
export function exigirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) throw new NoAutorizadoError('Inicia sesión para continuar');
    if (!roles.includes(req.usuario.rol)) {
      throw new ProhibidoError('Tu rol no tiene permiso para hacer esta acción');
    }
    next();
  };
}

export default router;
