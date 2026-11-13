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
import { consumirCupoIA, devolverCupoIA, presupuestoRestante, reservarPresupuesto } from '../ai/limite.js';
import { guardarCache, leerCache, vaciarCache } from '../ai/cache.js';
import { buscarSimilares, embeddingEnCache } from '../ai/similares.js';
import { clasificarIntencion, intencionPorReglas } from '../ai/intencion.js';
import { ingestarConocimiento, preguntarAlConocimiento } from '../ai/conocimiento.js';
import { REGLAS } from '../config/reglas.js';
import { exigirRol } from './auth.js';

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

const ROLES_CONVERSACION = ['usuario', 'pulse'];

// Valida el historial de la conversación (memoria corta) y se queda con los últimos mensajes.
// El historial lo manda el navegador: solo afecta la respuesta de quien lo envía y se valida su forma.
function validarHistorial(valor) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.length > 20) throw new DatosInvalidosError('El historial no tiene el formato esperado');
  const mensajes = valor.map((m) => {
    const texto = typeof m?.texto === 'string' ? m.texto.trim() : '';
    if (!ROLES_CONVERSACION.includes(m?.rol) || texto === '' || texto.length > MAX_CARACTERES) {
      throw new DatosInvalidosError('El historial no tiene el formato esperado');
    }
    return { rol: m.rol, texto };
  });
  return mensajes.slice(-REGLAS.MAX_MENSAJES_HISTORIAL);
}

// Cuántas llamadas a Gemini se estima que gasta una pregunta al RAG: responder (1) y, si hay conversación previa,
// reformular la pregunta (1 más). El reranking está apagado por defecto (docs/evaluacion-rag.md).
const llamadasDePregunta = (historial) => (historial.length ? 2 : 1);

// Con poca cuota en el minuto, la recomendación de salas no gasta la llamada que redacta la explicación.
const hayQueAhorrar = () => presupuestoRestante() - 2 < REGLAS.UMBRAL_MODO_AHORRO;

function avisarEspera(res, error) {
  if (error.esperaSegundos) res.set('Retry-After', String(error.esperaSegundos));
}

// Consume un cupo del usuario y reserva `llamadas` del presupuesto global de Gemini. Si la persona ya gastó su cupo
// (429 LIMITE_IA) o la IA está saturada para todos (429 IA_OCUPADA), responde enseguida con Retry-After.
function gastarCupo(req, res, llamadas = 1) {
  try {
    consumirCupoIA(req.usuario.usuario);
    try {
      reservarPresupuesto(llamadas);
    } catch (error) {
      devolverCupoIA(req.usuario.usuario); // no se atendió: que no le cuente como consulta
      throw error;
    }
  } catch (error) {
    avisarEspera(res, error);
    throw error;
  }
}

// Reserva llamadas extra del presupuesto cuando la petición ya tiene su cupo de persona (p. ej. tras clasificar la intención).
function gastarLlamadas(res, llamadas) {
  try {
    reservarPresupuesto(llamadas);
  } catch (error) {
    avisarEspera(res, error);
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
  if (!embeddingEnCache(descripcion)) gastarCupo(req, res, 0); // el embedding tiene otra cuota: no gasta llamadas de generación
  res.json(await buscarSimilares({ descripcion, espacioId: idOpcional(req.body?.espacioId), recursoId: idOpcional(req.body?.recursoId) }));
});

// POST /api/ia/recomendar  {texto}
// -> {solicitud: {asistentes, inicio, fin}, opciones: [{espacioId, motivo}], explicacion, modelo}
router.post('/recomendar', async (req, res) => {
  const texto = exigirTexto(req.body?.texto, 'el texto de la petición');
  const ahorro = hayQueAhorrar(); // sin caché: la disponibilidad y "mañana" cambian
  gastarCupo(req, res, ahorro ? 1 : 2);
  res.json(await recomendarEspacios(texto, { explicarConIA: !ahorro }));
});

// POST /api/ia/preguntar  {pregunta, historial?}
// -> {respondido, respuesta, areaSugerida, fragmentos: [{documento, seccion, texto, similitud, puntaje, usado}], ...}
// Responde con base en los documentos de knowledge/ (RAG en pulse-ai) y cita los fragmentos usados.
// Si los documentos no tienen la respuesta, respondido es false: Pulse no inventa.
// Solo se cachea una pregunta sin historial (con historial la respuesta depende de la conversación)
// y solo si fue respondida (un "no sé" no se guarda: puede cambiar al agregar un documento).
router.post('/preguntar', async (req, res) => {
  const pregunta = exigirTexto(req.body?.pregunta, 'la pregunta');
  const historial = validarHistorial(req.body?.historial);
  const guardada = historial.length === 0 ? leerCache(pregunta, Date.now(), 'rag') : undefined;
  if (guardada) {
    res.set('X-Cache', 'HIT');
    return res.json(guardada);
  }
  gastarCupo(req, res, llamadasDePregunta(historial));
  const respuesta = await preguntarAlConocimiento({ pregunta, historial });
  if (historial.length === 0 && respuesta.respondido) guardarCache(pregunta, respuesta, Date.now(), 'rag', REGLAS.CACHE_RAG_MINUTOS);
  res.json(respuesta);
});

// POST /api/ia/asistente  {texto, historial?}
// La barra Ctrl+K: decide si la persona quiere reservar una sala o hacer una pregunta y responde en consecuencia.
// -> {intencion: 'reservar', ...respuesta de /recomendar}  o  {intencion: 'preguntar', ...respuesta de /preguntar}
router.post('/asistente', async (req, res) => {
  const texto = exigirTexto(req.body?.texto, 'el mensaje');
  const historial = validarHistorial(req.body?.historial);

  // 1. Una pregunta ya respondida antes (sin conversación previa) sale de la caché: no gasta cupo ni llamadas.
  const guardada = historial.length === 0 ? leerCache(texto, Date.now(), 'rag') : undefined;
  if (guardada) {
    res.set('X-Cache', 'HIT');
    return res.json({ intencion: 'preguntar', ...guardada });
  }

  // 2. La intención: primero las reglas (sin IA); solo si el mensaje es ambiguo se le pregunta a Gemini.
  let intencion = intencionPorReglas(texto);
  const porReglas = intencion !== null;
  if (!porReglas) {
    gastarCupo(req, res, 1); // el cupo de la persona (uno por mensaje) y la llamada que clasifica
    intencion = await clasificarIntencion(texto, historial.slice(-2));
  }

  // 3. Lo que sigue gasta llamadas del presupuesto; el cupo de la persona solo se cobra una vez por mensaje.
  const reservarLlamadas = (n) => (porReglas ? gastarCupo(req, res, n) : gastarLlamadas(res, n));
  if (intencion === 'reservar') {
    const ahorro = hayQueAhorrar();
    reservarLlamadas(ahorro ? 1 : 2);
    return res.json({ intencion, ...(await recomendarEspacios(texto, { explicarConIA: !ahorro })) });
  }
  reservarLlamadas(llamadasDePregunta(historial));
  const respuesta = await preguntarAlConocimiento({ pregunta: texto, historial });
  if (historial.length === 0 && respuesta.respondido) guardarCache(texto, respuesta, Date.now(), 'rag', REGLAS.CACHE_RAG_MINUTOS);
  res.json({ intencion, ...respuesta });
});

// POST /api/ia/conocimiento/ingestar  (solo admin)
// Vuelve a cargar los documentos de knowledge/ en la base vectorial. -> {documentos, fragmentos, retirados}
router.post('/conocimiento/ingestar', exigirRol('admin'), async (req, res) => {
  const resumen = await ingestarConocimiento();
  vaciarCache(); // las respuestas guardadas pudieron salir de documentos que cambiaron
  res.json(resumen);
});

export default router;
