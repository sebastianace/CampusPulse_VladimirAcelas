// Repositorio de los bloques de horario de las clases (tabla "bloques_horario").
// En el objeto db es db.horarios. "dias" es un arreglo de 1 (lunes) a 7 (domingo), o null si aún no se confirmó.
// Los campos opcionales solo aparecen cuando tienen valor.

export const horarios = {
  tabla: 'bloques_horario',
  columnas: ['id', 'tipo', 'espacio_id', 'hora_inicio', 'hora_fin', 'dias', 'grupo', 'estudiantes', 'nivel', 'docente', 'modulo', 'observacion'],
  desdeFila: (f) => ({
    id: f.id, tipo: f.tipo, espacioId: f.espacio_id, horaInicio: f.hora_inicio, horaFin: f.hora_fin, dias: f.dias ?? null, grupo: f.grupo,
    ...(f.estudiantes !== null && { estudiantes: f.estudiantes }),
    ...(f.nivel && { nivel: f.nivel }),
    ...(f.docente && { docente: f.docente }),
    ...(f.modulo && { modulo: f.modulo }),
    ...(f.observacion && { observacion: f.observacion }),
  }),
  aFila: (b) => [b.id, b.tipo, b.espacioId, b.horaInicio, b.horaFin, b.dias ?? null, b.grupo, b.estudiantes ?? null, b.nivel ?? null, b.docente ?? null, b.modulo ?? null, b.observacion ?? null],
};
