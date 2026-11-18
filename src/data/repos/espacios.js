// Repositorio de espacios: traduce entre la tabla "espacios" y los objetos que usa src/domain/.
// Cada repositorio declara: tabla, columnas (la primera es la clave), desdeFila (fila -> objeto)
// y aFila (objeto -> valores en el orden de columnas). src/data/almacen.js hace el resto.
// nombre es el nombre que se usa hoy en el campus (src/config/nombres.js); la tabla guarda el
// del CSV oficial, que viaja en nombreOficial y es el que se vuelve a escribir.

import { nombreEnCampus } from '../../config/nombres.js';

export const espacios = {
  tabla: 'espacios',
  columnas: ['id', 'nombre', 'tipo', 'aforo', 'estado'],
  desdeFila: (f) => ({
    id: f.id, nombre: nombreEnCampus(f.id, f.nombre), nombreOficial: f.nombre, tipo: f.tipo, aforo: f.aforo, estado: f.estado,
  }),
  aFila: (e) => [e.id, e.nombreOficial ?? e.nombre, e.tipo, e.aforo ?? null, e.estado],
};
