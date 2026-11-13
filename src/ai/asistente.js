// =====================================================================
// ASISTENTE DE RESERVAS CON IA
// ---------------------------------------------------------------------
// Flujo de POST /api/ia/recomendar:
//   1. La IA EXTRAE {asistentes, inicio, fin, necesitaComputadores} del texto
//      libre (se le pasa la fecha actual y la zona America/Bogota).
//   2. Las REGLAS filtran: buscarEspaciosDisponibles (P1) devuelve solo
//      los espacios que cumplen aforo, horario, solapamiento, etc. y, si
//      el pedido necesita computadores, solo los que tienen.
//   3. La IA solo REDACTA la explicación de esas opciones ya filtradas.
// La IA nunca decide qué sala está libre.
// =====================================================================

import { REGLAS } from '../config/reglas.js';
import { leerDB } from '../data/almacen.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { ahoraBogota } from '../domain/fechas.js';
import { buscarEspaciosDisponibles, capacidadMaxima, tieneComputadores } from '../domain/reservas.js';
import { generarJSON } from './cliente.js';
import { promptExplicacion } from './prompts/explicacion.js';
import { promptSolicitud } from './prompts/solicitud.js';
import { validarComputadores, validarMotivos, validarSolicitud } from './validar.js';

// Cuántas opciones se muestran como máximo (las de mejor ajuste de aforo).
const MAX_OPCIONES = 3;

// ---------- paso 1: extraer la solicitud ----------

const SCHEMA_SOLICITUD = {
  type: 'OBJECT',
  properties: {
    asistentes: { type: 'INTEGER', nullable: true },
    inicio: { type: 'STRING', nullable: true },
    fin: { type: 'STRING', nullable: true },
    necesitaComputadores: { type: 'BOOLEAN', nullable: true },
  },
  required: ['asistentes', 'inicio', 'fin', 'necesitaComputadores'],
  propertyOrdering: ['asistentes', 'inicio', 'fin', 'necesitaComputadores'],
};

/** Pide a la IA la solicitud y exige que los tres campos vengan bien (si no, 422). */
async function extraerSolicitud(texto) {
  const { datos, modelo } = await generarJSON(promptSolicitud(texto, ahoraBogota()), SCHEMA_SOLICITUD);
  const solicitud = validarSolicitud(datos);
  const faltan = Object.keys(solicitud).filter((campo) => solicitud[campo] === null);
  if (faltan.length) {
    throw new DatosInvalidosError(
      `No pude entender ${faltan.join(', ')} en tu petición. Indica cuántas personas, el día y la hora de inicio y fin.`,
      'SOLICITUD_INCOMPLETA');
  }
  // Los computadores no son obligatorios en el pedido: null = no importa
  return { solicitud: { ...solicitud, necesitaComputadores: validarComputadores(datos?.necesitaComputadores) }, modelo };
}

// ---------- paso 3: redactar la explicación ----------

function schemaExplicacion(espacios) {
  return {
    type: 'OBJECT',
    properties: {
      opciones: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            espacioId: { type: 'STRING', format: 'enum', enum: espacios.map((e) => e.id) },
            motivo: { type: 'STRING' },
          },
          required: ['espacioId', 'motivo'],
        },
      },
      explicacion: { type: 'STRING' },
    },
    required: ['opciones', 'explicacion'],
  };
}

// Arma las opciones en el orden de las reglas. Si la IA no dio motivo para
// alguna, el motivo queda vacío: nunca se rellena con texto propio.
function armarOpciones(espacios, motivos) {
  return espacios.map((e) => ({
    espacioId: e.id,
    motivo: motivos.get(e.id) ?? '',
  }));
}

// ---------- función pública ----------

// Motivo escrito por las reglas (no por la IA) para el modo ahorro: solo datos que las reglas ya conocen.
const motivoPorReglas = (espacio, solicitud) =>
  `Caben ${solicitud.asistentes} personas (${capacidadMaxima(espacio)} puestos)${tieneComputadores(espacio) ? ', con computadores' : ''}`;

/**
 * Recomienda espacios a partir de un texto libre.
 * Devuelve {solicitud: {asistentes, inicio, fin, necesitaComputadores}, opciones: [{espacioId, motivo}], explicacion, modelo}.
 * Errores: 422 si no se entiende la petición, 409 si la franja viola una regla
 * (domingo, fuera de horario...), 503 si la IA falla.
 *
 * `explicarConIA: false` es el MODO AHORRO (hay mucha demanda y quedan pocas llamadas a Gemini): se entiende el pedido
 * con la IA (1 llamada) y las reglas filtran igual, pero la explicación la escriben las reglas, sin la segunda llamada.
 * La respuesta lleva modoAhorro: true y no trae `explicacion`, para que la interfaz no la muestre como texto de la IA.
 */
export async function recomendarEspacios(texto, { explicarConIA = true } = {}) {
  const { solicitud, modelo } = await extraerSolicitud(texto);
  const espacios = buscarEspaciosDisponibles(solicitud, await leerDB())
    .filter((e) => !REGLAS.TIPOS_FUERA_DE_RECOMENDACION.includes(e.tipo))
    .slice(0, MAX_OPCIONES);

  // Sin opciones no hay nada que explicar: la explicación va vacía (no se
  // escribe un texto propio que la UI mostraría como si fuera de la IA).
  if (espacios.length === 0) return { solicitud, opciones: [], explicacion: '', modelo };

  if (!explicarConIA) {
    return {
      solicitud, modelo, explicacion: '', modoAhorro: true,
      opciones: espacios.map((e) => ({ espacioId: e.id, motivo: motivoPorReglas(e, solicitud) })),
    };
  }

  const { datos } = await generarJSON(promptExplicacion(texto, solicitud, espacios), schemaExplicacion(espacios));
  const explicacion = typeof datos?.explicacion === 'string' ? datos.explicacion.trim() : '';
  return { solicitud, opciones: armarOpciones(espacios, validarMotivos(datos?.opciones, espacios)), explicacion, modelo };
}
