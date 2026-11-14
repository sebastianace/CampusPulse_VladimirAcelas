// Rutas de incidencias.
// GET   /api/incidencias      -> [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia, reportesAdicionales, notificaciones}]
// POST  /api/incidencias      {descripcion, categoria, prioridad, area, espacioId, recursoId, inhabilitar, origen, ia}
//                             -> 201 + la incidencia (y cambia el estado del espacio o recurso)
// POST  /api/incidencias/:id/reportes {descripcion} -> 201 {reporte, totalReportes}: suma el reporte de
//                             quien confirmó que es "la misma" incidencia (en vez de crear un duplicado).
//                             404 si no existe, 409 si ya está resuelta.
// GET   /api/incidencias/:id/reportes -> los reportes adicionales (quién, cuándo y qué escribió)
// PATCH /api/incidencias/:id  {estado: "resuelta"} -> 200 (rehabilita el espacio o recurso).
//                             Solo admin y soporte_tecnico: quien arregla es quien rehabilita.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { guardarEmbeddingEnSegundoPlano } from '../ai/similares.js';
import { notificacionesPorIncidencia } from '../data/notificaciones.js';
import { notificarIncidenciaNueva } from '../integraciones/n8n.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { agregarReporte, contarReportes, listarReportes } from '../data/similares.js';
import { crearIncidencia, resolverIncidencia } from '../domain/incidencias.js';

const router = Router();

// Cada incidencia trae reportesAdicionales (cuántas personas más confirmaron que era la misma) y
// notificaciones (a qué área avisó n8n, por qué canal y cuándo).
router.get('/', async (req, res) => {
  const [db, reportes, notificaciones] = await Promise.all([leerDB(), contarReportes(), notificacionesPorIncidencia()]);
  res.json(db.incidencias.map((i) => ({
    ...i, reportesAdicionales: reportes.get(i.id) ?? 0, notificaciones: notificaciones.get(i.id) ?? [],
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

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  res.json(await actualizarDB((db) => resolverIncidencia(db, req.params.id, req.body)));
});

export default router;
