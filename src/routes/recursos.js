// Rutas de recursos tecnológicos. GET /api/recursos -> [{id, nombre, tipo, espacioId, estado}]
import { Router } from 'express';
import { leerDB } from '../data/store.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(leerDB().recursos);
});

export default router;
