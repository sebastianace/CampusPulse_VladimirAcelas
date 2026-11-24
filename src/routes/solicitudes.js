// Rutas de solicitudes de salón (ver src/domain/solicitudes.js).
// GET   /api/solicitudes      -> [{id, reservaId, espacioId, solicitante, afectado, responsable, asistentes, inicio, fin, motivo,
//                                estado, fecha, decididaPor?, fechaDecision?, notaDecision?, reservaNuevaId?, reservaOriginal}]
//                                El admin ve todas; los demás, las suyas y las que cortaron su reserva.
// POST  /api/solicitudes      {reservaId, responsable, asistentes, inicio?, fin, motivo} -> 201 + la solicitud (pendiente).
//                                inicio: solo si la reserva es futura (en curso, la nueva empieza al aprobar).
//                                409 si la reserva ya terminó, es tuya, la franja no la toca o toca otra reserva,
//                                ya la pediste o si al aprobarla violaría una regla.
// PATCH /api/solicitudes/:id  {decision: "aprobar" | "rechazar", nota?} -> 200 + la solicitud. Solo admin.
//                                Aprobar le quita la franja a la reserva original (en curso: termina ya) y crea la nueva (una transacción).
// Avisos por correo (src/domain/avisos.js): al pedir, a quien tiene la reserva y a los admins; al decidir, a quien
// la pidió y a quien tenía la reserva. Se envían después de guardar y sin esperar.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { admins } from '../auth/usuarios.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { avisosDeDecision, avisosDeSolicitudNueva } from '../domain/avisos.js';
import { crearSolicitud, decidirSolicitud, solicitudesDe } from '../domain/solicitudes.js';
import { enviarAvisos } from '../integraciones/avisos.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(solicitudesDe(await leerDB(), req.usuario));
});

router.post('/', async (req, res) => {
  const listaAdmins = await admins();
  const { solicitud, avisos } = await actualizarDB((db) => {
    const creada = crearSolicitud(db, req.body, req.usuario);
    return { solicitud: creada, avisos: avisosDeSolicitudNueva(db, creada, listaAdmins) };
  });
  res.status(201).json(solicitud);
  enviarAvisos(avisos);
});

router.patch('/:id', exigirRol('admin'), async (req, res) => {
  const { solicitud, avisos } = await actualizarDB((db) => {
    const estadoAntes = new Map(db.solicitudes.map((s) => [s.id, s.estado]));
    const pedida = db.solicitudes.find((s) => s.id === req.params.id);
    const originalAntes = pedida?.reservaId ? structuredClone(db.reservas.find((r) => r.id === pedida.reservaId)) ?? null : null;
    const decidida = decidirSolicitud(db, req.params.id, req.body, req.usuario);
    // La que decidió el admin y las que se rechazaron solas por aprobar otra del mismo salón
    const decididas = db.solicitudes.filter((s) => estadoAntes.get(s.id) === 'pendiente' && s.estado !== 'pendiente');
    return { solicitud: decidida, avisos: avisosDeDecision(db, decididas, originalAntes, req.usuario.usuario) };
  });
  res.json(solicitud);
  enviarAvisos(avisos);
});

export default router;
