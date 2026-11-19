// Rutas de solicitudes de salón (ver src/domain/solicitudes.js).
// GET   /api/solicitudes      -> [{id, reservaId, espacioId, solicitante, afectado, responsable, asistentes, fin, motivo,
//                                estado, fecha, decididaPor?, fechaDecision?, notaDecision?, reservaNuevaId?, reservaOriginal}]
//                                El admin ve todas; los demás, las suyas y las que cortaron su reserva.
// POST  /api/solicitudes      {reservaId, responsable, asistentes, fin, motivo} -> 201 + la solicitud (pendiente).
//                                409 si la reserva no está en curso, es tuya, ya la pediste o si al aprobarla violaría una regla.
// PATCH /api/solicitudes/:id  {decision: "aprobar" | "rechazar", nota?} -> 200 + la solicitud. Solo admin.
//                                Aprobar corta la reserva original en ese momento y crea la nueva (una transacción).
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { crearSolicitud, decidirSolicitud, solicitudesDe } from '../domain/solicitudes.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(solicitudesDe(await leerDB(), req.usuario));
});

router.post('/', async (req, res) => {
  res.status(201).json(await actualizarDB((db) => crearSolicitud(db, req.body, req.usuario)));
});

router.patch('/:id', exigirRol('admin'), async (req, res) => {
  res.json(await actualizarDB((db) => decidirSolicitud(db, req.params.id, req.body, req.usuario)));
});

export default router;
