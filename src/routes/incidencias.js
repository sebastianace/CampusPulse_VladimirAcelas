// Rutas de incidencias.
// GET   /api/incidencias      -> [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia, reportesAdicionales, notificaciones}]
// POST  /api/incidencias      {descripcion, categoria, prioridad, espacioId, recursoId, inhabilitar, inhabilitarEspacio, origen, ia}
//                             (el área no se envía: siempre es REGLAS.AREA_RESPONSABLE)
//                             -> 201 + la incidencia (deja fuera de servicio lo más específico: el equipo si lo hay;
//                             la sala solo con inhabilitarEspacio: true o si no hay equipo)
// POST  /api/incidencias/:id/reportes {descripcion} -> 201 {reporte, totalReportes}: suma el reporte de
//                             quien confirmó que es "la misma" incidencia (en vez de crear un duplicado).
//                             404 si no existe, 409 si ya está resuelta.
// GET   /api/incidencias/:id/reportes -> los reportes adicionales (quién, cuándo y qué escribió)
// POST  /api/incidencias/:id/atender -> 200 + la incidencia "en atención" (atendidaPor, fechaAtencion).
//                             Solo admin y soporte_tecnico. 409 si ya está resuelta o la atiende otra persona.
// PATCH /api/incidencias/:id  {estado: "resuelta"} -> 200 (rehabilita el espacio o recurso).
//                             Solo admin y soporte_tecnico: quien arregla es quien rehabilita.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { listarUsuarios } from '../auth/usuarios.js';
import { guardarEmbeddingEnSegundoPlano } from '../ai/similares.js';
import { notificacionesPorIncidencia } from '../data/notificaciones.js';
import { notificarIncidenciaNueva } from '../integraciones/n8n.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { agregarReporte, contarReportes, listarReportes } from '../data/similares.js';
import { atenderIncidencia, crearIncidencia, resolverIncidencia } from '../domain/incidencias.js';

const router = Router();

// Cada incidencia trae reportesAdicionales (cuántas personas más confirmaron que era la misma),
// notificaciones (a qué área avisó n8n, por qué canal y cuándo) y, si está en atención, el nombre de quién la atiende.
router.get('/', async (req, res) => {
  const [db, reportes, notificaciones, usuarios] = await Promise.all([leerDB(), contarReportes(), notificacionesPorIncidencia(), listarUsuarios()]);
  const nombres = new Map(usuarios.map((u) => [u.usuario, u.nombre]));
  res.json(db.incidencias.map((i) => ({
    ...i, reportesAdicionales: reportes.get(i.id) ?? 0, notificaciones: notificaciones.get(i.id) ?? [],
    ...(i.atendidaPor && { atendidaPorNombre: nombres.get(i.atendidaPor) ?? i.atendidaPor }),
  })));
});

router.post('/', async (req, res) => {
  const incidencia = await actualizarDB((db) => crearIncidencia(db, req.body));
  guardarEmbeddingEnSegundoPlano(incidencia); // para que se sugiera como parecida; no hace esperar la respuesta
  notificarIncidenciaNueva(incidencia); // webhook firmado a n8n; no hace esperar la respuesta y nunca falla la creación
  res.status(201).json(incidencia);
});

router.post('/:id/reportes', async (req, res) => {
  res.status(201).json(await agregarReporte(req.params.id, req.body?.descripcion, req.usuario.usuario));
});

router.get('/:id/reportes', async (req, res) => {
  res.json(await listarReportes(req.params.id));
});

router.post('/:id/atender', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  res.json(await actualizarDB((db) => atenderIncidencia(db, req.params.id, req.usuario)));
});

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  res.json(await actualizarDB((db) => resolverIncidencia(db, req.params.id, req.body)));
});

export default router;
