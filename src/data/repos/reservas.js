// Repositorio de reservas (tabla "reservas").
// La base impide por sí sola que dos reservas del mismo espacio se crucen (restricción EXCLUDE,
// db/migrations/002_esquema.sql). Si la regla 6 de src/domain/reservas.js llega tarde, por ejemplo
// con dos peticiones simultáneas, la base lanza el error 23P01 y aquí se traduce al mismo error
// RESERVA_SOLAPADA que lanzaría la regla.

import { ReglaNegocioError } from '../../domain/errors.js';

const EXCLUSION_VIOLADA = '23P01';

export const reservas = {
  tabla: 'reservas',
  columnas: ['id', 'espacio_id', 'responsable', 'asistentes', 'inicio', 'fin'],
  desdeFila: (f) => ({
    id: f.id, espacioId: f.espacio_id, responsable: f.responsable, asistentes: f.asistentes, inicio: f.inicio, fin: f.fin,
  }),
  aFila: (r) => [r.id, r.espacioId, r.responsable, r.asistentes, r.inicio, r.fin],
  traducirError(error, reserva, db) {
    if (error.code !== EXCLUSION_VIOLADA) return error;
    const nombre = db.espacios.find((e) => e.id === reserva.espacioId)?.nombre ?? reserva.espacioId;
    return new ReglaNegocioError('RESERVA_SOLAPADA', `${nombre} ya está reservado en esa franja`);
  },
};
