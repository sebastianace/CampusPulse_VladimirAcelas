// =====================================================================
// TRIAJE DE INCIDENCIAS CON IA
// ---------------------------------------------------------------------
// Recibe la descripción en lenguaje natural y la IA SUGIERE:
// categoría, prioridad, área responsable, espacio y recurso afectados,
// si conviene inhabilitar y una razón corta.
// - El prompt (src/ai/prompts/triaje.js) lleva el catálogo real (db.json) y los valores cerrados.
// - La respuesta se valida con validar.js: lo que no existe queda en null.
// - Nada se guarda aquí: la persona confirma y luego el frontend llama
//   POST /api/incidencias, donde las reglas de P1 deciden.
// =====================================================================

import { AREAS, CATEGORIAS, PRIORIDADES } from '../config/reglas.js';
import { leerDB } from '../data/store.js';
import { generarJSON } from './cliente.js';
import { promptTriaje } from './prompts/triaje.js';
import { validarTriaje } from './validar.js';

// ---------- schema de la respuesta ----------

// Obliga a la IA a responder solo con valores de las listas cerradas.
// Los IDs también van como enum para que no invente espacios ni recursos.
function crearSchema(catalogo) {
  const lista = (valores) => ({ type: 'STRING', format: 'enum', enum: valores });
  const idOpcional = (elementos) => ({ ...lista(elementos.map((e) => e.id)), nullable: true });
  return {
    type: 'OBJECT',
    properties: {
      categoria: lista(CATEGORIAS),
      prioridad: lista(PRIORIDADES),
      area: lista(AREAS),
      espacioId: catalogo.espacios.length ? idOpcional(catalogo.espacios) : { type: 'STRING', nullable: true },
      recursoId: catalogo.recursos.length ? idOpcional(catalogo.recursos) : { type: 'STRING', nullable: true },
      inhabilitar: { type: 'BOOLEAN' },
      razon: { type: 'STRING' },
    },
    required: ['categoria', 'prioridad', 'area', 'espacioId', 'recursoId', 'inhabilitar', 'razon'],
    propertyOrdering: ['categoria', 'prioridad', 'area', 'espacioId', 'recursoId', 'inhabilitar', 'razon'],
  };
}

// ---------- función pública ----------

/**
 * Pide a la IA el triaje de una descripción y lo valida contra el catálogo.
 * Devuelve {categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon, modelo}.
 * Si la IA falla lanza IANoDisponibleError (503).
 */
export async function triarIncidencia(descripcion) {
  const { espacios, recursos } = leerDB();
  const catalogo = { espacios, recursos };
  const { datos, modelo } = await generarJSON(promptTriaje(descripcion, catalogo), crearSchema(catalogo));
  return { ...validarTriaje(datos, catalogo), modelo };
}
