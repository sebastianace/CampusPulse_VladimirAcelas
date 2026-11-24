// Rutas de reservas.
// GET  /api/reservas?fecha=YYYY-MM-DD -> reservas que empiezan ese día (sin fecha = hoy en Bogotá), con creadaPor.
// POST /api/reservas {espacioId, responsable, asistentes, inicio, fin} -> 201 + la reserva (creadaPor = usuario con sesión).
// PATCH /api/reservas/:id {campos a cambiar} -> 200 + la reserva editada. Solo quien la creó o un admin (si no, 403).
// DELETE /api/reservas/:id -> 200 + la reserva cancelada. Solo quien la creó o un admin (si no, 403).
// Si quien edita o cancela no es el dueño (un admin), al dueño le llega un correo (src/domain/avisos.js).
// Al cancelar, las solicitudes pendientes de esa reserva se cierran y a quien las pidió le llega que el salón quedó libre.
import { Router } from 'express';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { avisosDeReservaCambiada, avisosDeSolicitudesCerradas } from '../domain/avisos.js';
import { enviarAvisos } from '../integraciones/avisos.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { esFechaValida, hoyBogota } from '../domain/fechas.js';
import { cancelarReserva, crearReserva, editarReserva } from '../domain/reservas.js';
import { cerrarSolicitudesDe } from '../domain/solicitudes.js';

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
// Copia de la reserva antes del cambio (para contarle al dueño qué cambió)
const copiaDe = (db, id) => structuredClone(db.reservas.find((r) => r.id === id));

router.patch('/:id', async (req, res) => {
  const { reserva, avisos } = await actualizarDB((db) => {
    const antes = copiaDe(db, req.params.id);
    const editada = editarReserva(db, req.params.id, req.body ?? {}, req.usuario);
    return { reserva: editada, avisos: avisosDeReservaCambiada(db, antes, editada, req.usuario.usuario) };
  });
  res.json(reserva);
  enviarAvisos(avisos); // después de guardar y sin esperar: un correo que falla no deshace el cambio
});

router.delete('/:id', async (req, res) => {
  const { reserva, avisos } = await actualizarDB((db) => {
    const cancelada = cancelarReserva(db, req.params.id, req.usuario);
    const cerradas = cerrarSolicitudesDe(db, cancelada.id, req.usuario);
    return {
      reserva: cancelada,
      avisos: [...avisosDeReservaCambiada(db, cancelada, null, req.usuario.usuario), ...avisosDeSolicitudesCerradas(db, cerradas, req.usuario.usuario)],
    };
  });
  res.json(reserva);
  enviarAvisos(avisos);
});

export default router;
