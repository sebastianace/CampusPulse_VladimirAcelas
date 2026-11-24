// Repositorio de incidencias (tabla "incidencias").
// "ia" es jsonb: lo que sugirió la IA (razón, modelo, sugerencia...). "fechaResolucion" solo
// aparece en el objeto cuando la incidencia ya se resolvió.
// "inhabilito" = dejó algo fuera de servicio; "inhabilitoEspacio" = ese algo incluye toda la sala.
// "atendidaPor" y "fechaAtencion" solo aparecen cuando alguien de soporte la tomó ("en atención").
// "asignadaA" solo aparece cuando la categoría tiene un responsable (reparto automático) o un admin la reasignó.

export const incidencias = {
  tabla: 'incidencias',
  columnas: ['id', 'descripcion', 'categoria', 'prioridad', 'area', 'espacio_id', 'recurso_id', 'origen', 'ia', 'estado', 'inhabilito', 'inhabilito_espacio', 'fecha', 'fecha_resolucion', 'atendida_por', 'fecha_atencion', 'asignada_a'],
  desdeFila: (f) => ({
    id: f.id, descripcion: f.descripcion, categoria: f.categoria, prioridad: f.prioridad, area: f.area,
    espacioId: f.espacio_id, recursoId: f.recurso_id, origen: f.origen, ia: f.ia, estado: f.estado,
    inhabilito: f.inhabilito, inhabilitoEspacio: f.inhabilito_espacio, fecha: f.fecha,
    ...(f.fecha_resolucion && { fechaResolucion: f.fecha_resolucion }),
    ...(f.fecha_atencion && { atendidaPor: f.atendida_por, fechaAtencion: f.fecha_atencion }),
    ...(f.asignada_a && { asignadaA: f.asignada_a }),
  }),
  aFila: (i) => [
    i.id, i.descripcion, i.categoria, i.prioridad, i.area, i.espacioId ?? null, i.recursoId ?? null, i.origen,
    i.ia == null ? null : JSON.stringify(i.ia), i.estado, i.inhabilito === true, i.inhabilitoEspacio === true, i.fecha,
    i.fechaResolucion ?? null, i.atendidaPor ?? null, i.fechaAtencion ?? null, i.asignadaA ?? null,
  ],
};
