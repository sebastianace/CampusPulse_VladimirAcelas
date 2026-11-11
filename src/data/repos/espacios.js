// Repositorio de espacios: traduce entre la tabla "espacios" y los objetos que usa src/domain/.
// Cada repositorio declara: tabla, columnas (la primera es la clave), desdeFila (fila -> objeto)
// y aFila (objeto -> valores en el orden de columnas). src/data/almacen.js hace el resto.

export const espacios = {
  tabla: 'espacios',
  columnas: ['id', 'nombre', 'tipo', 'aforo', 'estado'],
  desdeFila: (f) => ({ id: f.id, nombre: f.nombre, tipo: f.tipo, aforo: f.aforo, estado: f.estado }),
  aFila: (e) => [e.id, e.nombre, e.tipo, e.aforo ?? null, e.estado],
};
