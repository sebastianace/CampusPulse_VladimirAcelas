// Repositorio de incidencias (tabla "incidencias").
// "ia" es jsonb: lo que sugirió la IA (razón, modelo, sugerencia...). "fechaResolucion" solo
// aparece en el objeto cuando la incidencia ya se resolvió.

export const incidencias = {
  tabla: 'incidencias',
  columnas: ['id', 'descripcion', 'categoria', 'prioridad', 'area', 'espacio_id', 'recurso_id', 'origen', 'ia', 'estado', 'inhabilito', 'fecha', 'fecha_resolucion'],
  desdeFila: (f) => ({
    id: f.id, descripcion: f.descripcion, categoria: f.categoria, prioridad: f.prioridad, area: f.area,
    espacioId: f.espacio_id, recursoId: f.recurso_id, origen: f.origen, ia: f.ia, estado: f.estado,
    inhabilito: f.inhabilito, fecha: f.fecha,
    ...(f.fecha_resolucion && { fechaResolucion: f.fecha_resolucion }),
  }),
  aFila: (i) => [
    i.id, i.descripcion, i.categoria, i.prioridad, i.area, i.espacioId ?? null, i.recursoId ?? null, i.origen,
    i.ia == null ? null : JSON.stringify(i.ia), i.estado, i.inhabilito === true, i.fecha, i.fechaResolucion ?? null,
  ],
};
