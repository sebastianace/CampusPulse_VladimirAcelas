// Rutas del reparto de incidencias por categoría.
// GET /api/responsables            -> [{categoria, usuario, nombre}], una fila por categoría vigente
//                                     (usuario y nombre null si no tiene responsable). Cualquier sesión.
// PUT /api/responsables/:categoria {usuario: string | null} -> 200 {categoria, usuario, nombre, asignadas}
//                                     Solo admin. Define quién atiende esa categoría (null: quitar). Las incidencias
//                                     ABIERTAS de esa categoría que nadie tenía asignada pasan a esa persona
//                                     (asignadas = cuántas) y se le avisa por correo con un solo resumen. 422 si la categoría no existe o
//                                     la cuenta no puede atender incidencias; 404 si la cuenta no existe.
import { Router } from 'express';
import { exigirRol } from './auth.js';
import { fijarResponsable, listarResponsables } from '../data/responsables.js';
import { actualizarDB } from '../data/almacen.js';
import { asignarPendientes } from '../domain/incidencias.js';
import { enviarAvisos } from '../integraciones/avisos.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await listarResponsables());
});

router.put('/:categoria', exigirRol('admin'), async (req, res) => {
  const { categoria } = req.params;
  const cuenta = await fijarResponsable(categoria, req.body?.usuario);
  let asignadas = 0;
  if (cuenta) {
    asignadas = await actualizarDB((db) => asignarPendientes(db, categoria, cuenta.usuario).length);
  }
  // Un solo correo con el resumen (no uno por incidencia), y no a quien lo configuró si se eligió a sí mismo
  const avisos = asignadas && cuenta.usuario !== req.usuario.usuario ? [{
    para: cuenta.usuario,
    asunto: `${asignadas} incidencia${asignadas === 1 ? '' : 's'} abierta${asignadas === 1 ? '' : 's'} ahora ${asignadas === 1 ? 'es tuya' : 'son tuyas'}`,
    mensaje: `Ahora atiendes la categoría ${categoria}. Había ${asignadas} incidencia${asignadas === 1 ? '' : 's'} abierta${asignadas === 1 ? '' : 's'} sin responsable y quedaron a tu nombre. `
      + 'Revísalas en Campus Pulse, pestaña Soporte TI.',
  }] : [];
  enviarAvisos(avisos);
  res.json({ categoria, usuario: cuenta?.usuario ?? null, nombre: cuenta?.nombre ?? null, asignadas });
});

export default router;
