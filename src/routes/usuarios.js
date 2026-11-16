// Rutas de usuarios.
// GET  /api/usuarios/nombres -> [{usuario, nombre}] de todas las cuentas. Cualquier sesión: es para sugerir
//                               el responsable al reservar (en vez de una lista de nombres escrita a mano).
// Lo demás es solo admin:
// GET  /api/usuarios         -> [{usuario, nombre, rol, creado, creadoPor, creadoPorNombre, debeCambiarClave}] (nunca las claves)
// POST /api/usuarios         {usuario, nombre, clave, rol: "admin" | "profesor" | "soporte_tecnico"} -> 201 {usuario, nombre, rol}
//                               No abre sesión: el admin sigue con la suya. La cuenta guarda quién la creó.
// POST /api/usuarios/:usuario/clave -> 200 {usuario, claveTemporal}: contraseña temporal para quien la olvidó.
//                               Cierra sus sesiones y la obliga a cambiarla al entrar. La propia se cambia en
//                               POST /api/auth/clave (409 USA_CAMBIAR_CLAVE).
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { crearCuenta, listarCuentas, listarUsuarios, restablecerClave } from '../auth/usuarios.js';
import { ReglaNegocioError } from '../domain/errors.js';

const router = Router();

router.get('/nombres', async (req, res) => {
  res.json((await listarUsuarios()).map(({ usuario, nombre }) => ({ usuario, nombre })));
});

router.use(exigirRol('admin'));

router.get('/', async (req, res) => {
  res.json(await listarCuentas());
});

router.post('/', async (req, res) => {
  res.status(201).json(await crearCuenta(req.body, req.usuario.usuario));
});

router.post('/:usuario/clave', async (req, res) => {
  if (req.params.usuario === req.usuario.usuario) {
    throw new ReglaNegocioError('USA_CAMBIAR_CLAVE', 'Tu propia contraseña cámbiala con "Cambiar mi contraseña"');
  }
  res.json(await restablecerClave(req.params.usuario));
});

export default router;
