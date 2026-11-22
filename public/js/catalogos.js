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

// Etiqueta legible para cualquier valor; si llega uno desconocido se muestra tal cual
export function etiqueta(catalogo, valor) {
  return catalogo[valor] ?? valor ?? '—';
}
