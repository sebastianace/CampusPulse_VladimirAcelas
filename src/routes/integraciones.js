// =====================================================================
// RUTAS PARA n8n (/api/integraciones)
// ---------------------------------------------------------------------
// n8n no es una persona con sesión: se autentica con el secreto compartido N8N_SECRETO en la cabecera
// x-pulse-token. Estas rutas se montan ANTES de exigir sesión (src/server.js) y tienen su propia comprobación.
// Sin N8N_SECRETO configurado responden 503: nunca quedan abiertas.
//
// GET  /api/integraciones/incidencias?fecha=hoy|YYYY-MM-DD&estado=abierta|resuelta|todas
//        -> [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, fecha, reportesAdicionales}]
//        Sin datos personales (ni quién reportó ni lo que sugirió la IA). Lo usan el resumen diario y el agente.
// POST /api/integraciones/incidencias/:id/notificada  {canal, destinatario, area}
//        -> 201 {registrada: true} | 200 {registrada: false} si ese aviso ya estaba registrado
// =====================================================================

import { Router } from 'express';
import { AREAS, CANALES_NOTIFICACION } from '../config/reglas.js';
import { leerDB } from '../data/almacen.js';
import { registrarNotificacion } from '../data/notificaciones.js';
import { contarReportes } from '../data/similares.js';
import { NoAutorizadoError } from '../auth/usuarios.js';
import { DatosInvalidosError, ErrorApi } from '../domain/errors.js';
import { ahoraBogota } from '../domain/fechas.js';
import { secretoValido } from '../integraciones/n8n.js';

const router = Router();

// 503 si la integración no está configurada; 401 si el secreto no coincide.
router.use((req, res, next) => {
  if (!process.env.N8N_SECRETO) {
    throw new ErrorApi(503, 'INTEGRACION_NO_CONFIGURADA', 'La integración con n8n no está configurada (falta N8N_SECRETO).');
  }
  if (!secretoValido(req.headers['x-pulse-token'])) {
    throw new NoAutorizadoError('Falta el secreto de la integración o no es válido.', 'SECRETO_INVALIDO');
  }
  next();
});

const ESTADOS = ['abierta', 'resuelta', 'todas'];

router.get('/incidencias', async (req, res) => {
  const estado = req.query.estado ?? 'todas';
  if (!ESTADOS.includes(estado)) throw new DatosInvalidosError(`estado debe ser uno de: ${ESTADOS.join(', ')}`);
  const fecha = req.query.fecha === 'hoy' ? ahoraBogota().slice(0, 10) : req.query.fecha;
  if (fecha !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new DatosInvalidosError('fecha debe ser "hoy" o YYYY-MM-DD');

  const [db, reportes] = await Promise.all([leerDB(), contarReportes()]);
  res.json(db.incidencias
    .filter((i) => (estado === 'todas' || i.estado === estado) && (!fecha || i.fecha.startsWith(fecha)))
    .map((i) => ({
      id: i.id, descripcion: i.descripcion, categoria: i.categoria, prioridad: i.prioridad, area: i.area,
      espacioId: i.espacioId ?? null, recursoId: i.recursoId ?? null, estado: i.estado, fecha: i.fecha,
      reportesAdicionales: reportes.get(i.id) ?? 0,
    })));
});

router.post('/incidencias/:id/notificada', async (req, res) => {
  const { canal, destinatario, area } = req.body ?? {};
  if (!CANALES_NOTIFICACION.includes(canal)) throw new DatosInvalidosError(`canal debe ser uno de: ${CANALES_NOTIFICACION.join(', ')}`);
  if (!AREAS.includes(area)) throw new DatosInvalidosError(`area debe ser una de: ${AREAS.join(', ')}`);
  if (typeof destinatario !== 'string' || destinatario.trim() === '' || destinatario.length > 200) {
    throw new DatosInvalidosError('Falta el destinatario (máximo 200 caracteres)');
  }
  const resultado = await registrarNotificacion({ incidenciaId: req.params.id, canal, destinatario: destinatario.trim(), area });
  res.status(resultado.registrada ? 201 : 200).json(resultado);
});

export default router;
