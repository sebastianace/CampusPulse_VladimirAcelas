// Rutas de recursos tecnológicos.
// GET   /api/recursos      -> [{id, nombre, tipo, espacioId, estado, cambiosPermitidos}]
//                          (cambiosPermitidos: estados a los que Inventario lo puede pasar, según TRANSICIONES_RECURSO)
// PATCH /api/recursos/:id  {estado} -> 200 + el recurso (Inventario). Solo admin y soporte_tecnico.
//                          409 si la transición no está permitida o si una incidencia abierta lo inhabilita.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { actualizarEstadoRecurso, cambiosManuales } from '../domain/inventario.js';

const router = Router();

const conCambios = (recurso) => ({ ...recurso, cambiosPermitidos: cambiosManuales(recurso) });

router.get('/', async (req, res) => {
  res.json((await leerDB()).recursos.map(conCambios));
});

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  res.json(conCambios(await actualizarDB((db) => actualizarEstadoRecurso(db, req.params.id, req.body))));
});

export default router;
