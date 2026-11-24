// Rutas de los horarios de las clases (Software, Inglés y SER).
// GET /api/horarios            -> [{id, tipo, espacioId, horaInicio, horaFin, dias, grupo, estudiantes?, nivel?, docente?, modulo?, observacion?}]
//                                 Cualquier sesión. dias: [1..7] (1 = lunes) o null si todavía no se confirmaron. Solo los bloques con
//                                 días confirmados bloquean reservas (409 SALA_CON_CLASE).
// GET /api/horarios/hallazgos  -> [{tipo, titulo, mensaje}] los problemas de planeación (cruces, aforo, datos incompletos...).
//                                 Solo admin: es trabajo de Coordinación y menciona docentes y grupos.
// Los horarios se cargan desde la terminal: npm run importar-horarios (ver docs/horarios.md).
import { Router } from 'express';
import { leerDB } from '../data/almacen.js';
import { TITULOS_HALLAZGO, analizarHorarios } from '../domain/horarios.js';
import { exigirRol } from './auth.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await leerDB()).horarios);
});

// Se calcula al pedirlo con lo que hay guardado: nunca queda desactualizado respecto de los bloques.
// "sin-dias" no se manda: ya lo dice la propia pantalla (cuántos bloques no tienen días).
router.get('/hallazgos', exigirRol('admin'), async (req, res) => {
  const db = await leerDB();
  const orden = Object.keys(TITULOS_HALLAZGO);
  res.json(analizarHorarios(db.horarios, db.espacios)
    .filter((h) => h.tipo !== 'sin-dias')
    .sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))
    .map(({ tipo, mensaje }) => ({ tipo, titulo: TITULOS_HALLAZGO[tipo], mensaje })));
});

export default router;
