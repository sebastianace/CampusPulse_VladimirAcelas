// =====================================================================
// RUTAS DE INICIO DE SESIÓN
// ---------------------------------------------------------------------
// POST /api/auth/registro {usuario, nombre, clave} -> 201 {usuario, nombre} y abre sesión
// POST /api/auth/login    {usuario, clave}         -> 200 {usuario, nombre} y abre sesión
// POST /api/auth/logout                            -> 200 y cierra la sesión
// GET  /api/auth/yo                                -> 200 {usuario, nombre} o 401
// La sesión viaja en la cookie "sesion" (HttpOnly: el JavaScript de la
// página no la puede leer).
// =====================================================================

import { Router } from 'express';
import { HORAS_SESION, NoAutorizadoError, autenticar, cerrarSesion, crearSesion, registrar, usuarioDeSesion } from '../auth/usuarios.js';

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
  const usuario = autenticar(req.body);
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

export default router;
