// Rutas de usuarios (solo admin; el control está en server.js).
// POST /api/usuarios {usuario, nombre, clave, rol: "profesor" | "soporte_tecnico"} -> 201 {usuario, nombre, rol}
// No abre sesión: el admin sigue con la suya.
import { Router } from 'express';
import { crearCuenta } from '../auth/usuarios.js';

const router = Router();

router.post('/', (req, res) => {
  res.status(201).json(crearCuenta(req.body));
});

export default router;
