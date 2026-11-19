// Rutas de reservas.
// GET  /api/reservas?fecha=YYYY-MM-DD -> reservas que empiezan ese día (sin fecha = hoy en Bogotá), con creadaPor.
// POST /api/reservas {espacioId, responsable, asistentes, inicio, fin} -> 201 + la reserva (creadaPor = usuario con sesión).
// PATCH /api/reservas/:id {campos a cambiar} -> 200 + la reserva editada. Solo quien la creó o un admin (si no, 403).
// DELETE /api/reservas/:id -> 200 + la reserva cancelada. Solo quien la creó o un admin (si no, 403).
import { Router } from 'express';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { esFechaValida, hoyBogota } from '../domain/fechas.js';
import { cancelarReserva, crearReserva, editarReserva } from '../domain/reservas.js';

const router = Router();

router.get('/', async (req, res) => {
  const fecha = req.query.fecha ?? hoyBogota();
  if (!esFechaValida(fecha)) {
    throw new DatosInvalidosError('La fecha debe tener el formato YYYY-MM-DD y ser una fecha real');
  }
  res.json((await leerDB()).reservas.filter((r) => r.inicio.startsWith(fecha)));
});

// Si alguna regla falla, crearReserva lanza el error y no se guarda nada.
router.post('/', async (req, res) => {
  const reserva = await actualizarDB((db) => crearReserva(db, req.body, { creadaPor: req.usuario.usuario }));
  res.status(201).json(reserva);
});

// Editar vuelve a pasar por todas las reglas; si alguna falla no se guarda nada.
router.patch('/:id', async (req, res) => {
  res.json(await actualizarDB((db) => editarReserva(db, req.params.id, req.body ?? {}, req.usuario)));
});

router.delete('/:id', async (req, res) => {
  res.json(await actualizarDB((db) => cancelarReserva(db, req.params.id, req.usuario)));
});

export default router;
