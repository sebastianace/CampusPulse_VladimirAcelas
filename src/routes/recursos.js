// Rutas de recursos tecnológicos. GET /api/recursos -> [{id, nombre, tipo, espacioId, estado}]
import { Router } from 'express';
import { leerDB } from '../data/almacen.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await leerDB()).recursos);
});

export default router;
