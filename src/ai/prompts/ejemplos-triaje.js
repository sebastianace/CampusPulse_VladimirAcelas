// =====================================================================
// EJEMPLOS DEL TRIAJE (few-shot)
// ---------------------------------------------------------------------
// Casos resueltos del campus que se muestran a la IA para enseñarle el
// criterio. Cada uno cubre algo distinto:
//   1. Riesgo para personas: prioridad "critica" e inhabilitar.
//   2. Un equipo que no tiene sala asignada: espacioId null, sin inventar.
//   3. Un reporte de aseo: no es para TI (paraTI false, categoría null),
//      prioridad baja, no inhabilita nada.
//   4. Un reporte de seguridad sin lugar identificable: tampoco es para TI y
//      todo lo que no se sabe va en null.
// Las clasificaciones son criterio del autor (ver docs/biblioteca-prompts.md).
// Los IDs deben existir en el catálogo: un test lo comprueba.
// La medición contra el zero-shot está en src/ai/medir-triaje.js.
// =====================================================================

export const EJEMPLOS_TRIAJE = [
  {
    reporte: 'El video beam de Apolo soltó chispas y huele a quemado',
    respuesta: {
      paraTI: true,
      categoria: 'tecnologia',
      prioridad: 'critica',
      espacioId: 'apolo',
      recursoId: 'rec-01',
      inhabilitar: true,
      razon: 'Las chispas y el olor a quemado son riesgo para las personas: prioridad crítica y se inhabilita el equipo.',
    },
  },
  {
    reporte: 'El portátil Lenovo 02 se apaga solo y no carga',
    respuesta: {
      paraTI: true,
      categoria: 'tecnologia',
      prioridad: 'media',
      espacioId: null,
      recursoId: 'rec-09',
      inhabilitar: false,
      razon: 'El equipo falla pero no hay riesgo; en el catálogo no tiene un espacio asignado, así que el espacio queda sin definir.',
    },
  },
  {
    reporte: 'Quedó comida y basura en la sala Azul después del taller',
    respuesta: {
      paraTI: false,
      categoria: null,
      prioridad: 'baja',
      espacioId: 'azul',
      recursoId: null,
      inhabilitar: false,
      razon: 'Es un tema de limpieza, no técnico ni de infraestructura: no lo atiende Soporte TI y la sala sigue siendo utilizable.',
    },
  },
  {
    reporte: 'Un señor que no conozco entró a las salas sin carné',
    respuesta: {
      paraTI: false,
      categoria: null,
      prioridad: 'alta',
      espacioId: null,
      recursoId: null,
      inhabilitar: false,
      razon: 'Afecta la seguridad de las personas, no es un tema de Soporte TI y no se sabe en qué espacio ocurrió.',
    },
  },
];
