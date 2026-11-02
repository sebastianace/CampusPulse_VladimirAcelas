// POST /api/restaurar -> recrea data/db.json desde data/raw/ y data/seed/ (raw/ nunca se modifica).
import { Router } from 'express';
import { restaurarDB } from '../data/store.js';

const router = Router();

router.post('/', (req, res) => {
  const db = restaurarDB();
  res.json({ mensaje: 'Datos restaurados al estado inicial', calidadDatos: db.calidadDatos });
});

export default router;
