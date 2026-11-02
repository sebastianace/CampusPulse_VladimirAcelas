// Rutas de reservas.
// GET  /api/reservas?fecha=YYYY-MM-DD -> reservas que empiezan ese día (sin fecha = hoy en Bogotá).
// POST /api/reservas {espacioId, responsable, asistentes, inicio, fin} -> 201 + la reserva.
// PATCH /api/reservas/:id {campos a cambiar} -> 200 + la reserva editada.
// DELETE /api/reservas/:id -> 200 + la reserva cancelada.
import { Router } from 'express';
import { actualizarDB, leerDB } from '../data/store.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { esFechaValida, hoyBogota } from '../domain/fechas.js';
import { cancelarReserva, crearReserva, editarReserva } from '../domain/reservas.js';

const router = Router();

router.get('/', (req, res) => {
  const fecha = req.query.fecha ?? hoyBogota();
  if (!esFechaValida(fecha)) {
    throw new DatosInvalidosError('La fecha debe tener el formato YYYY-MM-DD y ser una fecha real');
  }
  res.json(leerDB().reservas.filter((r) => r.inicio.startsWith(fecha)));
});

// Si alguna regla falla, crearReserva lanza el error y no se guarda nada.
router.post('/', (req, res) => {
  const reserva = actualizarDB((db) => crearReserva(db, req.body));
  res.status(201).json(reserva);
});

// Editar vuelve a pasar por todas las reglas; si alguna falla no se guarda nada.
router.patch('/:id', (req, res) => {
  res.json(actualizarDB((db) => editarReserva(db, req.params.id, req.body ?? {})));
});

router.delete('/:id', (req, res) => {
  res.json(actualizarDB((db) => cancelarReserva(db, req.params.id)));
});

export default router;
