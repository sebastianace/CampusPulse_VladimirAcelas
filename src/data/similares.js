// =====================================================================
// DATOS DE INCIDENCIAS PARECIDAS (PostgreSQL + pgvector)
// ---------------------------------------------------------------------
// - guardarEmbedding / buscarCandidatas: el vector de cada incidencia y la búsqueda por significado.
// - agregarReporte / listarReportes / contarReportes: los reportes que se suman a una incidencia
//   existente cuando alguien confirma que es "la misma".
// Las reglas (umbral, filtro de lugar) viven en src/domain/similares.js; aquí solo hay consultas.
// =====================================================================

import { DatosInvalidosError, NoEncontradoError, ReglaNegocioError } from '../domain/errors.js';
import { ahoraBogota } from '../domain/fechas.js';
import { filtroDeLugar } from '../domain/similares.js';
import { obtenerPool } from './pg.js';

const MAX_CARACTERES_REPORTE = 1000;
const CANDIDATAS_MAX = 10; // cuántas trae la consulta; las reglas recortan después

// pgvector recibe el vector como texto: "[0.1,0.2,...]".
const comoVector = (vector) => `[${vector.join(',')}]`;

/** Guarda (o reemplaza) el embedding de una incidencia. */
export async function guardarEmbedding(incidenciaId, vector, modelo) {
  await obtenerPool().query(
    `INSERT INTO incidencias_embeddings (incidencia_id, embedding, modelo) VALUES ($1, $2::vector, $3)
     ON CONFLICT (incidencia_id) DO UPDATE SET embedding = EXCLUDED.embedding, modelo = EXCLUDED.modelo, creado = now()`,
    [incidenciaId, comoVector(vector), modelo]);
}

/**
 * Incidencias ABIERTAS cuyo embedding está más cerca del vector, con su similitud coseno (1 - distancia).
 * Solo compara vectores del mismo modelo y aplica el filtro de lugar de src/domain/similares.js.
 */
export async function buscarCandidatas(vector, modelo, lugar = {}) {
  const valores = [comoVector(vector), modelo];
  const filtro = filtroDeLugar(lugar);
  let clausulaLugar = '';
  if (filtro) {
    valores.push(filtro.valor);
    clausulaLugar = `AND i.${filtro.columna} = $3`; // la columna sale de una lista fija, nunca del usuario
  }
  const { rows } = await obtenerPool().query(
    `SELECT i.id, i.descripcion, i.categoria, i.prioridad, i.area, i.espacio_id, i.recurso_id, i.fecha,
            1 - (e.embedding <=> $1::vector) AS similitud,
            (SELECT count(*)::int FROM incidencias_reportes r WHERE r.incidencia_id = i.id) AS reportes_adicionales
       FROM incidencias_embeddings e JOIN incidencias i ON i.id = e.incidencia_id
      WHERE i.estado = 'abierta' AND e.modelo = $2 ${clausulaLugar}
      ORDER BY e.embedding <=> $1::vector
      LIMIT ${CANDIDATAS_MAX}`, valores);
  return rows.map((f) => ({
    id: f.id, descripcion: f.descripcion, categoria: f.categoria, prioridad: f.prioridad, area: f.area,
    espacioId: f.espacio_id, recursoId: f.recurso_id, fecha: f.fecha,
    similitud: Number(f.similitud), reportesAdicionales: f.reportes_adicionales,
  }));
}

/** Incidencias que todavía no tienen embedding: [{id, descripcion}] (las usa el script de relleno). */
export async function incidenciasSinEmbedding() {
  const { rows } = await obtenerPool().query(
    `SELECT i.id, i.descripcion FROM incidencias i LEFT JOIN incidencias_embeddings e ON e.incidencia_id = i.id
      WHERE e.incidencia_id IS NULL ORDER BY i.posicion`);
  return rows;
}

// ---------- reportes que se suman a una incidencia ----------

const filaDeReporte = (f) => ({ id: Number(f.id), incidenciaId: f.incidencia_id, descripcion: f.descripcion, reportadoPor: f.reportado_por, fecha: f.fecha });

/**
 * Suma un reporte a una incidencia ABIERTA. 404 si no existe, 409 si ya está resuelta, 422 si el texto
 * está vacío o es muy largo. Devuelve {reporte, totalReportes}. Se revisa el estado con FOR SHARE para
 * que, si la incidencia se resuelve a la vez, el reporte no se cuele en una ya resuelta.
 */
export async function agregarReporte(incidenciaId, descripcion, usuario) {
  const texto = typeof descripcion === 'string' ? descripcion.trim() : '';
  if (!texto) throw new DatosInvalidosError('Falta la descripción del reporte');
  if (texto.length > MAX_CARACTERES_REPORTE) {
    throw new DatosInvalidosError(`La descripción no puede pasar de ${MAX_CARACTERES_REPORTE} caracteres`);
  }
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query('SELECT estado FROM incidencias WHERE id = $1 FOR SHARE', [incidenciaId]);
    if (!rows[0]) throw new NoEncontradoError(`No existe la incidencia "${incidenciaId}"`);
    if (rows[0].estado !== 'abierta') {
      throw new ReglaNegocioError('INCIDENCIA_YA_RESUELTA', 'Esta incidencia ya fue resuelta: no admite más reportes');
    }
    const insertado = await cliente.query(
      'INSERT INTO incidencias_reportes (incidencia_id, descripcion, reportado_por, fecha) VALUES ($1, $2, $3, $4) RETURNING *',
      [incidenciaId, texto, usuario, ahoraBogota()]);
    const { rows: total } = await cliente.query('SELECT count(*)::int AS n FROM incidencias_reportes WHERE incidencia_id = $1', [incidenciaId]);
    await cliente.query('COMMIT');
    return { reporte: filaDeReporte(insertado.rows[0]), totalReportes: total[0].n };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

/** Reportes adicionales de una incidencia, del más antiguo al más nuevo. 404 si la incidencia no existe. */
export async function listarReportes(incidenciaId) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query('SELECT 1 FROM incidencias WHERE id = $1', [incidenciaId]);
  if (!rowCount) throw new NoEncontradoError(`No existe la incidencia "${incidenciaId}"`);
  const { rows } = await pool.query('SELECT * FROM incidencias_reportes WHERE incidencia_id = $1 ORDER BY id', [incidenciaId]);
  return rows.map(filaDeReporte);
}

/** Cuántos reportes adicionales tiene cada incidencia: Map(incidenciaId -> n). */
export async function contarReportes() {
  const { rows } = await obtenerPool().query('SELECT incidencia_id, count(*)::int AS n FROM incidencias_reportes GROUP BY incidencia_id');
  return new Map(rows.map((f) => [f.incidencia_id, f.n]));
}
