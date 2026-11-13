// =====================================================================
// INTENCIÓN DEL MENSAJE (Ctrl+K)
// ---------------------------------------------------------------------
// La barra Ctrl+K atiende dos cosas: pedir una sala (flujo de asistente.js) y hacer una pregunta
// (RAG en pulse-ai). Un clasificador decide cuál. Si la respuesta de la IA no es una de las dos
// intenciones válidas, se usa "preguntar": es la opción inofensiva (solo muestra texto; nunca reserva).
// =====================================================================

import { generarJSON } from './cliente.js';
import { INTENCIONES, promptIntencion } from './prompts/intencion.js';

const SCHEMA_INTENCION = {
  type: 'OBJECT',
  properties: { intencion: { type: 'STRING', format: 'enum', enum: INTENCIONES } },
  required: ['intencion'],
};

/** 'reservar' o 'preguntar'. Si la IA falla lanza IANoDisponibleError (503). */
export async function clasificarIntencion(texto, historial = []) {
  const { datos } = await generarJSON(promptIntencion(texto, historial), SCHEMA_INTENCION);
  return INTENCIONES.includes(datos?.intencion) ? datos.intencion : 'preguntar';
}
