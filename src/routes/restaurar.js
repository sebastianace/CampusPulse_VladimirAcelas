// POST /api/restaurar -> vuelve la base de datos al estado inicial desde data/raw/ y data/seed/ (raw/ nunca se modifica).
import { Router } from 'express';
import { restaurarDB } from '../data/almacen.js';

const router = Router();

router.post('/', async (req, res) => {
  const db = await restaurarDB();
  res.json({ mensaje: 'Datos restaurados al estado inicial', calidadDatos: db.calidadDatos });
});

export default router;
