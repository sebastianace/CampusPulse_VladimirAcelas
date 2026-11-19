// Rutas de espacios.
// GET   /api/espacios      -> [{id, nombre, tipo, aforo, estado, ocupadoAhora, computadores}]
// PATCH /api/espacios/:id  {estado: "disponible" | "inhabilitado"} -> 200 + el espacio (Inventario).
//                          Solo admin y soporte_tecnico. 409 si una incidencia abierta la inhabilita o si es inconsistente.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { listarEspacios } from '../domain/espacios.js';
import { actualizarEstadoEspacio } from '../domain/inventario.js';
import { ahoraBogota } from '../domain/fechas.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(listarEspacios(await leerDB(), ahoraBogota()));
});

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  res.json(await actualizarDB((db) => actualizarEstadoEspacio(db, req.params.id, req.body)));
});

export default router;
