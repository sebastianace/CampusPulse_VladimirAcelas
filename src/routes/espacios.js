// Rutas de espacios. GET /api/espacios -> [{id, nombre, tipo, aforo, estado, ocupadoAhora, computadores}]
import { Router } from 'express';
import { leerDB } from '../data/store.js';
import { listarEspacios } from '../domain/espacios.js';
import { ahoraBogota } from '../domain/fechas.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listarEspacios(leerDB(), ahoraBogota()));
});

export default router;
