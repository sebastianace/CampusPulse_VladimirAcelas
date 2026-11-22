// =====================================================================
// CONJUNTO DE PRUEBA DEL TRIAJE
// ---------------------------------------------------------------------
// 12 reportes con la clasificación que el autor espera. Sirven para medir
// si los ejemplos few-shot mejoran el triaje frente al zero-shot
// (npm run medir-triaje).
// - Son DISTINTOS a los 4 ejemplos de src/ai/prompts/ejemplos-triaje.js:
//   evaluar con los mismos casos que se enseñaron sería hacer trampa.
// - Las prioridades son criterio del autor; marcados "discutible" son los
//   casos donde otra persona podría clasificar distinto.
// - Los IDs deben existir en el catálogo (un test lo comprueba).
// - Desde el prompt 1.5 solo hay 2 categorías (infraestructura y tecnología):
//   los reportes de aseo, bienestar y seguridad esperan paraTI false y
//   categoría null, porque Soporte TI no los atiende.
// =====================================================================

export const CASOS_TRIAJE = [
  { reporte: 'El proyector de Cosmos no enciende y en una hora hay clase',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'media', espacioId: 'cosmos', recursoId: 'rec-02', inhabilitar: false } },
  { reporte: 'Hay una gotera en el techo de Spooki y el agua cae cerca de los tomacorrientes',
    esperado: { paraTI: true, categoria: 'infraestructura', prioridad: 'critica', espacioId: 'spooki', recursoId: null, inhabilitar: true } },
  { reporte: 'El micrófono inalámbrico 1 del auditorio tiene la batería muerta',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'baja', espacioId: 'auditorio', recursoId: 'rec-04', inhabilitar: false } },
  { reporte: 'Se regó café en el piso del pasillo y alguien puede resbalar', // discutible: media o baja
    esperado: { paraTI: false, categoria: null, prioridad: 'media', espacioId: null, recursoId: null, inhabilitar: false } },
  { reporte: 'Varios estudiantes dicen que se sienten muy estresados por la carga de trabajo y piden hablar con alguien',
    esperado: { paraTI: false, categoria: null, prioridad: 'media', espacioId: null, recursoId: null, inhabilitar: false } },
  { reporte: 'Los cables de la consola de sonido del auditorio están pelados y hacen corto',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'critica', espacioId: 'auditorio', recursoId: 'rec-03', inhabilitar: true } },
  { reporte: 'El televisor de Skilab no muestra imagen, solo pantalla negra',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'media', espacioId: 'skilab', recursoId: 'rec-06', inhabilitar: false } },
  { reporte: 'El portátil HP 03 tiene la pantalla rota',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'media', espacioId: null, recursoId: 'rec-10', inhabilitar: false } },
  { reporte: 'Las sillas de la sala Amarillas verdes están rotas, a dos les faltan las patas',
    esperado: { paraTI: true, categoria: 'infraestructura', prioridad: 'media', espacioId: 'amarillas-verdes', recursoId: null, inhabilitar: false } },
  { reporte: 'Se acabó el jabón y el papel en los baños de la entrada',
    esperado: { paraTI: false, categoria: null, prioridad: 'baja', espacioId: null, recursoId: null, inhabilitar: false } },
  { reporte: 'Alguien dejó una mochila abandonada frente a Apolo y nadie sabe de quién es', // discutible: alta o media
    esperado: { paraTI: false, categoria: null, prioridad: 'alta', espacioId: 'apolo', recursoId: null, inhabilitar: false } },
  { reporte: 'El parlante JBL no se conecta por bluetooth',
    esperado: { paraTI: true, categoria: 'tecnologia', prioridad: 'baja', espacioId: null, recursoId: 'rec-12', inhabilitar: false } },
];
