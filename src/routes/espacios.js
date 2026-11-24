// Rutas de espacios.
// GET   /api/espacios      -> [{id, nombre, tipo, aforo, estado, ocupadoAhora, computadores}]
// PATCH /api/espacios/:id  {estado: "disponible" | "inhabilitado"} -> 200 + el espacio (Inventario).
//                          Solo admin y soporte_tecnico. 409 si una incidencia abierta la inhabilita o si es inconsistente.
//                          Al inhabilitarla, a los dueños de sus reservas que no han terminado les llega un correo.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { listarEspacios } from '../domain/espacios.js';
import { actualizarEstadoEspacio } from '../domain/inventario.js';
import { ahoraBogota } from '../domain/fechas.js';
import { avisosDeSalaInhabilitada } from '../domain/avisos.js';
import { enviarAvisos } from '../integraciones/avisos.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(listarEspacios(await leerDB(), ahoraBogota()));
});

router.patch('/:id', exigirRol('admin', 'soporte_tecnico'), async (req, res) => {
  const { espacio, avisos } = await actualizarDB((db) => {
    const antes = db.espacios.find((e) => e.id === req.params.id)?.estado;
    const cambiado = actualizarEstadoEspacio(db, req.params.id, req.body);
    const recienInhabilitado = antes !== 'inhabilitado' && cambiado.estado === 'inhabilitado';
    return {
      espacio: cambiado,
      avisos: recienInhabilitado ? avisosDeSalaInhabilitada(db, cambiado.id, 'la marcó Inventario', req.usuario.usuario, ahoraBogota()) : [],
    };
  });
  res.json(espacio);
  enviarAvisos(avisos);
});

export default router;
