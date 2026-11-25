// Valores cerrados del contrato de la API (docs/contrato-api.md).
// Son los mismos que define el backend en src/config/reglas.js;
// aquí solo se usan para llenar selects y mostrar etiquetas legibles.

export const ESTADOS_ESPACIO = {
  disponible: 'Disponible',
  inhabilitado: 'Inhabilitada',
  inconsistente: 'Dato inconsistente',
};

export const ESTADOS_RECURSO = {
  disponible: 'Disponible',
  danado: 'Dañado',
  en_reparacion: 'En reparación',
};

// Las que se pueden elegir al reportar: en el campus hay 2 técnicos de TI, uno por categoría.
export const CATEGORIAS = {
  infraestructura: 'Infraestructura',
  tecnologia: 'Tecnología',
};

// Etiquetas de todas las categorías, incluidas las anteriores al 21 nov 2026 (aseo, seguridad...):
// las incidencias viejas se siguen mostrando con su categoría.
export const ETIQUETAS_CATEGORIA = {
  ...CATEGORIAS,
  aseo: 'Aseo',
  seguridad: 'Seguridad',
  bienestar: 'Bienestar',
  otro: 'Otro',
};

export const PRIORIDADES = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

// Clases fijas del campus (horarios) y días de la semana (1 = lunes, igual que los días de un bloque en la API)
export const ETIQUETAS_CLASE = { software: 'Software', ingles: 'Inglés', ser: 'SER' };
export const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Solo los espacios que se reservan: deja fuera las zonas comunes como Hunters (reservable: false en la API),
// que existen para reportar daños pero no van en el mapa de reservas, la línea de tiempo ni el formulario.
export const soloReservables = (espacios) => espacios.filter((e) => e.reservable !== false);

// Etiqueta legible para cualquier valor; si llega uno desconocido se muestra tal cual
export function etiqueta(catalogo, valor) {
  return catalogo[valor] ?? valor ?? '—';
}
