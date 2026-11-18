// =====================================================================
// NOMBRES DE LAS SALAS EN EL CAMPUS
// ---------------------------------------------------------------------
// El CSV oficial (data/raw/espacios.csv) conserva los nombres con los que
// la organización entregó la capacidad instalada. Algunas salas hoy se
// llaman distinto en el campus. Este es el ÚNICO lugar donde vive esa
// traducción: el repositorio de espacios (src/data/repos/espacios.js)
// entrega el nombre del campus y guarda el oficial en nombreOficial, así
// el tablero, la IA, los correos y los mensajes de error dicen lo mismo.
// Debe coincidir con los rótulos del plano (public/js/mapa/plano.js).
// =====================================================================

export const NOMBRES_EN_CAMPUS = {
  spooki: 'Sputnik',
  skilab: 'Skylabs',
  'amarillas-verdes': 'Sala de reuniones',
};

/** Nombre con el que se conoce la sala en el campus (o el oficial si no cambió). */
export const nombreEnCampus = (id, nombreOficial) => NOMBRES_EN_CAMPUS[id] ?? nombreOficial;
