// =====================================================================
// EJEMPLOS DEL TRIAJE (few-shot)
// ---------------------------------------------------------------------
// Casos resueltos del campus que se muestran a la IA para enseñarle el
// criterio. Cada uno cubre algo distinto:
//   1. Riesgo para personas: prioridad "critica" e inhabilitar.
//   2. Un equipo que no tiene sala asignada: espacioId null, sin inventar.
//   3. Un reporte de aseo: prioridad baja, no inhabilita nada.
//   4. Un reporte de seguridad sin lugar identificable: todo lo que no se
//      sabe va en null.
// Las clasificaciones son criterio del autor (ver docs/biblioteca-prompts.md).
// Los IDs deben existir en el catálogo: un test lo comprueba.
// La medición contra el zero-shot está en src/ai/medir-triaje.js.
// =====================================================================

export const EJEMPLOS_TRIAJE = [
  {
    reporte: 'El video beam de Apolo soltó chispas y huele a quemado',
    respuesta: {
      categoria: 'tecnologia',
      prioridad: 'critica',
      area: 'Soporte TI',
      espacioId: 'apolo',
      recursoId: 'rec-01',
      inhabilitar: true,
      razon: 'Las chispas y el olor a quemado son riesgo para las personas: prioridad crítica y se inhabilita el equipo.',
    },
  },
  {
    reporte: 'El portátil Lenovo 02 se apaga solo y no carga',
    respuesta: {
      categoria: 'tecnologia',
      prioridad: 'media',
      area: 'Soporte TI',
      espacioId: null,
      recursoId: 'rec-09',
      inhabilitar: false,
      razon: 'El equipo falla pero no hay riesgo; en el catálogo no tiene un espacio asignado, así que el espacio queda sin definir.',
    },
  },
  {
    reporte: 'Quedó comida y basura en la sala Azul después del taller',
    respuesta: {
      categoria: 'aseo',
      prioridad: 'baja',
      area: 'Servicios generales',
      espacioId: 'azul',
      recursoId: null,
      inhabilitar: false,
      razon: 'Es un tema de limpieza, sin riesgo ni daño: la sala sigue siendo utilizable.',
    },
  },
  {
    reporte: 'Un señor que no conozco entró a las salas sin carné',
    respuesta: {
      categoria: 'seguridad',
      prioridad: 'alta',
      area: 'Seguridad',
      espacioId: null,
      recursoId: null,
      inhabilitar: false,
      razon: 'Afecta la seguridad de las personas, pero no se sabe en qué espacio ocurrió, así que no se asigna ninguno.',
    },
  },
];
