// Repositorio de préstamos de equipos (tabla "prestamos").
// "fechaDevolucion" solo aparece en el objeto cuando ya se devolvió.

export const prestamos = {
  tabla: 'prestamos',
  columnas: ['id', 'recurso_id', 'persona', 'estado', 'fecha', 'fecha_devolucion'],
  desdeFila: (f) => ({
    id: f.id, recursoId: f.recurso_id, persona: f.persona, estado: f.estado, fecha: f.fecha,
    ...(f.fecha_devolucion && { fechaDevolucion: f.fecha_devolucion }),
  }),
  aFila: (p) => [p.id, p.recursoId, p.persona, p.estado, p.fecha, p.fechaDevolucion ?? null],
};
