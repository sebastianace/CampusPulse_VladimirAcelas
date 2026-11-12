// Rutas de préstamos.
// GET  /api/prestamos                -> [{id, recursoId, persona, estado, fecha}]
// POST /api/prestamos                {recursoId, persona} -> 201 + el préstamo
// POST /api/prestamos/:id/devolver   {estadoFinal: "disponible" | "danado"} -> 200 + el préstamo
import { Router } from 'express';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { crearPrestamo, devolverPrestamo } from '../domain/prestamos.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json((await leerDB()).prestamos);
});

router.post('/', async (req, res) => {
  const prestamo = await actualizarDB((db) => crearPrestamo(db, req.body));
  res.status(201).json(prestamo);
});

router.post('/:id/devolver', async (req, res) => {
  res.json(await actualizarDB((db) => devolverPrestamo(db, req.params.id, req.body)));
});

export default router;
