// Repositorio de recursos tecnológicos (tabla "recursos").
// "ficticio" solo aparece en el objeto cuando es true, como en data/seed/recursos.json.

export const recursos = {
  tabla: 'recursos',
  columnas: ['id', 'nombre', 'tipo', 'espacio_id', 'estado', 'ficticio'],
  desdeFila: (f) => ({
    id: f.id, nombre: f.nombre, tipo: f.tipo, espacioId: f.espacio_id, estado: f.estado,
    ...(f.ficticio && { ficticio: true }),
  }),
  aFila: (r) => [r.id, r.nombre, r.tipo, r.espacioId ?? null, r.estado, r.ficticio === true],
};
