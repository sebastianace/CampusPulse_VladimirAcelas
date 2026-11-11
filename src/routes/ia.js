// =====================================================================
// RUTAS DE IA (dueño: P2)
// ---------------------------------------------------------------------
// P1 las monta en server.js con app.use('/api/ia', iaRouter).
// Los errores (422 datos, 429 límite, 503 IA caída) los responde el manejador
// global de server.js con el formato {error: {codigo, mensaje}}.
// Orden en cada ruta: validar (422) -> caché -> límite por usuario (429) -> IA.
// Una petición inválida o respondida desde la caché no gasta cupo.
// =====================================================================

import { Router } from 'express';
import { DatosInvalidosError } from '../domain/errors.js';
import { triarIncidencia } from '../ai/triaje.js';
import { recomendarEspacios } from '../ai/asistente.js';
import { consumirCupoIA } from '../ai/limite.js';
import { guardarCache, leerCache } from '../ai/cache.js';
import { buscarSimilares, embeddingEnCache } from '../ai/similares.js';

// Largo máximo del texto que se envía a la IA.
const MAX_CARACTERES = 1000;

const router = Router();

// Revisa que el cuerpo traiga un texto usable y lo devuelve limpio.
function exigirTexto(valor, campo) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto === '') throw new DatosInvalidosError(`Falta ${campo}`);
  if (texto.length > MAX_CARACTERES) {
    throw new DatosInvalidosError(`${campo} no puede pasar de ${MAX_CARACTERES} caracteres`);
  }
  return texto;
}

// Consume un cupo del usuario; si ya no le quedan, responde 429 con Retry-After.
function gastarCupo(req, res) {
  try {
    consumirCupoIA(req.usuario.usuario);
  } catch (error) {
    if (error.esperaSegundos) res.set('Retry-After', String(error.esperaSegundos));
    throw error;
  }
}

// POST /api/ia/triaje  {descripcion}
// -> {categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon, modelo}
// Un texto idéntico se responde desde la caché (cabecera X-Cache: HIT).
// Solo el triaje se cachea: depende del texto y del catálogo, que casi no cambia.
router.post('/triaje', async (req, res) => {
  const descripcion = exigirTexto(req.body?.descripcion, 'la descripción de la incidencia');
  const guardada = leerCache(descripcion);
  if (guardada) {
    res.set('X-Cache', 'HIT');
    return res.json(guardada);
  }
  gastarCupo(req, res);
  const sugerencia = await triarIncidencia(descripcion);
  guardarCache(descripcion, sugerencia);
  res.json(sugerencia);
});

// POST /api/ia/similares  {descripcion, espacioId?, recursoId?}
// -> {candidatas: [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, fecha, similitud, reportesAdicionales}], umbral, modelo}
// Incidencias ABIERTAS parecidas, para preguntar "¿es la misma?". Si el servicio de embeddings falla
// responde 503 y la interfaz sigue sin la sugerencia. Si el embedding del texto ya está en la caché
// (porque se acaba de pedir), no gasta cupo.
router.post('/similares', async (req, res) => {
  const descripcion = exigirTexto(req.body?.descripcion, 'la descripción de la incidencia');
  const idOpcional = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);
  if (!embeddingEnCache(descripcion)) gastarCupo(req, res);
  res.json(await buscarSimilares({ descripcion, espacioId: idOpcional(req.body?.espacioId), recursoId: idOpcional(req.body?.recursoId) }));
});

// POST /api/ia/recomendar  {texto}
// -> {solicitud: {asistentes, inicio, fin}, opciones: [{espacioId, motivo}], explicacion, modelo}
router.post('/recomendar', async (req, res) => {
  const texto = exigirTexto(req.body?.texto, 'el texto de la petición');
  gastarCupo(req, res); // sin caché: la disponibilidad y "mañana" cambian
  res.json(await recomendarEspacios(texto));
});

export default router;
