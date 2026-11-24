// Rutas de los horarios de las clases (Software, Inglés y SER).
// GET /api/horarios -> [{id, tipo, espacioId, horaInicio, horaFin, dias, grupo, estudiantes?, nivel?, docente?, modulo?, observacion?}]
//                      Cualquier sesión. dias: [1..7] (1 = lunes) o null si todavía no se confirmaron. Solo los bloques con
//                      días confirmados bloquean reservas (409 SALA_CON_CLASE).
// Los horarios se cargan desde la terminal: npm run importar-horarios (ver docs/horarios.md).
import { Router } from 'express';
import { leerDB } from '../data/almacen.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await leerDB()).horarios);
});

export default router;
