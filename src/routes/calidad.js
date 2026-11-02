// Reporte de calidad del CSV. GET /api/calidad-datos -> {cargados, validos, inconsistentes: [{fila, motivo}]}
import { Router } from 'express';
import { leerDB } from '../data/store.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(leerDB().calidadDatos);
});

export default router;
