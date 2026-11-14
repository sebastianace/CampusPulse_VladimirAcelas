// =====================================================================
// NOTIFICACIONES DE INCIDENCIAS (consultas SQL)
// ---------------------------------------------------------------------
// n8n avisa al área responsable cuando se crea una incidencia y luego llama a Campus Pulse para dejar constancia:
// quién fue notificado, por qué canal y cuándo. Aquí solo hay consultas; el formato de la petición lo valida la ruta.
// =====================================================================

import { NoEncontradoError } from '../domain/errors.js';
import { ahoraBogota } from '../domain/fechas.js';
import { obtenerPool } from './pg.js';

/**
 * Registra que se avisó de una incidencia. Si ese mismo aviso ya estaba registrado (n8n reintentó), no lo duplica.
 * Devuelve {registrada: boolean} (false = ya existía). 404 si la incidencia no existe.
 */
export async function registrarNotificacion({ incidenciaId, canal, destinatario, area }) {
  const pool = obtenerPool();
  const { rowCount: existe } = await pool.query('SELECT 1 FROM incidencias WHERE id = $1', [incidenciaId]);
  if (!existe) throw new NoEncontradoError(`No existe la incidencia "${incidenciaId}"`);
  const { rowCount } = await pool.query(
    `INSERT INTO incidencias_notificaciones (incidencia_id, canal, destinatario, area, enviado)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (incidencia_id, canal, destinatario) DO NOTHING`,
    [incidenciaId, canal, destinatario, area, ahoraBogota()],
  );
  return { registrada: rowCount === 1 };
}

/** Las notificaciones de cada incidencia: Map(incidenciaId -> [{canal, area, enviado}]). */
export async function notificacionesPorIncidencia() {
  const { rows } = await obtenerPool().query(
    'SELECT incidencia_id, canal, area, enviado FROM incidencias_notificaciones ORDER BY id',
  );
  const mapa = new Map();
  for (const f of rows) {
    if (!mapa.has(f.incidencia_id)) mapa.set(f.incidencia_id, []);
    mapa.get(f.incidencia_id).push({ canal: f.canal, area: f.area, enviado: f.enviado });
  }
  return mapa;
}
