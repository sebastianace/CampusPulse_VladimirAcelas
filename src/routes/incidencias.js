// Rutas de incidencias.
// GET   /api/incidencias      -> [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia}]
// POST  /api/incidencias      {descripcion, categoria, prioridad, area, espacioId, recursoId, inhabilitar, origen, ia}
//                             -> 201 + la incidencia (y cambia el estado del espacio o recurso)
// PATCH /api/incidencias/:id  {estado: "resuelta"} -> 200 (rehabilita el espacio o recurso).
//                             Solo admin y soporte_tecnico: quien arregla es quien rehabilita.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { actualizarDB, leerDB } from '../data/store.js';
import { crearIncidencia, resolverIncidencia } from '../domain/incidencias.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(leerDB().incidencias);
});

router.post('/', (req, res) => {
  const incidencia = actualizarDB((db) => crearIncidencia(db, req.body));
  res.status(201).json(incidencia);
});

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), (req, res) => {
  res.json(actualizarDB((db) => resolverIncidencia(db, req.params.id, req.body)));
});

export default router;
