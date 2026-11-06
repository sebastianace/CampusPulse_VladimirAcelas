// Rutas de usuarios (solo admin; el control está en server.js).
// GET  /api/usuarios -> [{usuario, nombre, rol}] (nunca trae las claves)
// POST /api/usuarios {usuario, nombre, clave, rol: "profesor" | "soporte_tecnico"} -> 201 {usuario, nombre, rol}
// No abre sesión: el admin sigue con la suya.
import { Router } from 'express';
import { crearCuenta, listarUsuarios } from '../auth/usuarios.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listarUsuarios());
});

router.post('/', (req, res) => {
  res.status(201).json(crearCuenta(req.body));
});

export default router;
