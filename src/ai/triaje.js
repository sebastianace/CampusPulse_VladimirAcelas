// =====================================================================
// TRIAJE DE INCIDENCIAS CON IA
// ---------------------------------------------------------------------
// Recibe la descripción en lenguaje natural y la IA SUGIERE:
// categoría, prioridad, espacio y recurso afectados,
// si conviene inhabilitar y una razón corta. El área no: toda incidencia va a TI
// (REGLAS.AREA_RESPONSABLE), así que no se gasta la IA en decidirla.
// - El prompt (src/ai/prompts/triaje.js) lleva el catálogo real (la base de datos) y los valores cerrados.
// - La respuesta se valida con validar.js: lo que no existe queda en null.
// - Nada se guarda aquí: la persona confirma y luego el frontend llama
//   POST /api/incidencias, donde las reglas de P1 deciden.
// =====================================================================

import { CATEGORIAS, PRIORIDADES, REGLAS } from '../config/reglas.js';
import { leerDB } from '../data/almacen.js';
import { generarJSON } from './cliente.js';
import { promptTriaje } from './prompts/triaje.js';
import { validarTriaje } from './validar.js';

// ---------- schema de la respuesta ----------

// Obliga a la IA a responder solo con valores de las listas cerradas.
// Los IDs también van como enum para que no invente espacios ni recursos.
export function crearSchema(catalogo) {
  const lista = (valores) => ({ type: 'STRING', format: 'enum', enum: valores });
  const idOpcional = (elementos) => ({ ...lista(elementos.map((e) => e.id)), nullable: true });
  return {
    type: 'OBJECT',
    properties: {
      paraTI: { type: 'BOOLEAN' },
      categoria: { ...lista(CATEGORIAS), nullable: true },
      prioridad: lista(PRIORIDADES),
      espacioId: catalogo.espacios.length ? idOpcional(catalogo.espacios) : { type: 'STRING', nullable: true },
      recursoId: catalogo.recursos.length ? idOpcional(catalogo.recursos) : { type: 'STRING', nullable: true },
      inhabilitar: { type: 'BOOLEAN' },
      razon: { type: 'STRING' },
    },
    // paraTI va primero: decidir si es para TI antes de elegir la categoría.
    required: ['paraTI', 'categoria', 'prioridad', 'espacioId', 'recursoId', 'inhabilitar', 'razon'],
    propertyOrdering: ['paraTI', 'categoria', 'prioridad', 'espacioId', 'recursoId', 'inhabilitar', 'razon'],
  };
}

// ---------- función pública ----------

/** Texto que ve la persona cuando su reporte no es para Soporte TI. */
export function avisoFueraDeTI() {
  return `Esto no parece un problema técnico ni de infraestructura, así que Soporte TI no lo atiende: avísale a ${REGLAS.CONTACTO_FUERA_DE_TI}. Si hay riesgo para alguien, hazlo de inmediato. Si crees que sí es para TI, elige la categoría y regístralo.`;
}

/**
 * Pide a la IA el triaje de una descripción y lo valida contra el catálogo.
 * Devuelve {paraTI, categoria, prioridad, espacioId, recursoId, inhabilitar, razon, aviso, modelo}.
 * aviso es null si el reporte es para TI.
 * Si la IA falla lanza IANoDisponibleError (503).
 */
export async function triarIncidencia(descripcion) {
  const { espacios, recursos } = await leerDB();
  const catalogo = { espacios, recursos };
  const { datos, modelo } = await generarJSON(promptTriaje(descripcion, catalogo), crearSchema(catalogo));
  const triaje = validarTriaje(datos, catalogo);
  return { ...triaje, aviso: triaje.paraTI ? null : avisoFueraDeTI(), modelo };
}
