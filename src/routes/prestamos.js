// Rutas de préstamos.
// GET  /api/prestamos                -> [{id, recursoId, persona, estado, fecha}]
// POST /api/prestamos                {recursoId, persona} -> 201 + el préstamo
// POST /api/prestamos/:id/devolver   {estadoFinal: "disponible" | "danado"} -> 200 + el préstamo
import { Router } from 'express';
import { actualizarDB, leerDB } from '../data/store.js';
import { crearPrestamo, devolverPrestamo } from '../domain/prestamos.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(leerDB().prestamos);
});

router.post('/', (req, res) => {
  const prestamo = actualizarDB((db) => crearPrestamo(db, req.body));
  res.status(201).json(prestamo);
});

router.post('/:id/devolver', (req, res) => {
  res.json(actualizarDB((db) => devolverPrestamo(db, req.params.id, req.body)));
});

export default router;
