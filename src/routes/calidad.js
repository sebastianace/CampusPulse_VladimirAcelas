// Reporte de calidad del CSV. GET /api/calidad-datos -> {cargados, validos, inconsistentes: [{fila, motivo}]}
import { Router } from 'express';
import { leerDB } from '../data/almacen.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await leerDB()).calidadDatos);
});

export default router;
