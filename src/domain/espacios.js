// =====================================================================
// DOMINIO: ESPACIOS
// ---------------------------------------------------------------------
// Funciones puras: reciben la base (db) y devuelven datos. No leen ni
// escriben archivos, así se pueden probar sin base de datos.
// =====================================================================

import { tieneComputadores } from './reservas.js';

// true si la reserva está ocurriendo en el instante "ahora" (inicio <= ahora < fin).
function reservaEnCurso(reserva, ahora) {
  return reserva.inicio <= ahora && ahora < reserva.fin;
}

/** true si el espacio tiene una reserva en curso en el instante "ahora". */
export function estaOcupado(db, espacioId, ahora) {
  return db.reservas.some((r) => r.espacioId === espacioId && reservaEnCurso(r, ahora));
}

/** Lista de espacios del contrato: [{id, nombre, tipo, aforo, estado, ocupadoAhora, computadores}]. */
export function listarEspacios(db, ahora) {
  return db.espacios.map((espacio) => ({
    ...espacio,
    ocupadoAhora: estaOcupado(db, espacio.id, ahora),
    computadores: tieneComputadores(espacio),
  }));
}
