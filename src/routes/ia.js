// =====================================================================
// RUTAS DE IA (dueño: P2)
// ---------------------------------------------------------------------
// P1 las monta en server.js con app.use('/api/ia', iaRouter).
// Los errores (422 datos, 503 IA caída) los responde el manejador
// global de server.js con el formato {error: {codigo, mensaje}}.
// =====================================================================

import { Router } from 'express';
import { DatosInvalidosError } from '../domain/errors.js';
import { triarIncidencia } from '../ai/triaje.js';
import { recomendarEspacios } from '../ai/asistente.js';

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

// POST /api/ia/triaje  {descripcion}
// -> {categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon, modelo}
router.post('/triaje', async (req, res) => {
  const descripcion = exigirTexto(req.body?.descripcion, 'la descripción de la incidencia');
  res.json(await triarIncidencia(descripcion));
});

// POST /api/ia/recomendar  {texto}
// -> {solicitud: {asistentes, inicio, fin}, opciones: [{espacioId, motivo}], explicacion, modelo}
router.post('/recomendar', async (req, res) => {
  const texto = exigirTexto(req.body?.texto, 'el texto de la petición');
  res.json(await recomendarEspacios(texto));
});

export default router;
