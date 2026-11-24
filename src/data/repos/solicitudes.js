// Repositorio de solicitudes de salón (tabla "solicitudes_salon").
// Los campos de la decisión solo aparecen en el objeto cuando ya se decidió.
// inicio = null: la reserva pedida estaba en curso y la nueva empieza al aprobarla (migración 011).

export const solicitudes = {
  tabla: 'solicitudes_salon',
  columnas: ['id', 'reserva_id', 'espacio_id', 'solicitante', 'afectado', 'responsable', 'asistentes', 'inicio', 'fin', 'motivo',
    'estado', 'fecha', 'decidida_por', 'fecha_decision', 'nota_decision', 'reserva_nueva_id'],
  desdeFila: (f) => ({
    id: f.id, reservaId: f.reserva_id, espacioId: f.espacio_id, solicitante: f.solicitante, afectado: f.afectado,
    responsable: f.responsable, asistentes: f.asistentes, inicio: f.inicio, fin: f.fin, motivo: f.motivo, estado: f.estado, fecha: f.fecha,
    ...(f.fecha_decision && {
      decididaPor: f.decidida_por, fechaDecision: f.fecha_decision, notaDecision: f.nota_decision, reservaNuevaId: f.reserva_nueva_id,
    }),
  }),
  aFila: (s) => [s.id, s.reservaId, s.espacioId, s.solicitante, s.afectado, s.responsable, s.asistentes, s.inicio ?? null, s.fin, s.motivo,
    s.estado, s.fecha, s.decididaPor ?? null, s.fechaDecision ?? null, s.notaDecision ?? null, s.reservaNuevaId ?? null],
};
