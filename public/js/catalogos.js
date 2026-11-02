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
  prestado: 'Prestado',
  danado: 'Dañado',
  en_reparacion: 'En reparación',
};

export const CATEGORIAS = {
  infraestructura: 'Infraestructura',
  tecnologia: 'Tecnología',
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

export const AREAS = ['Infraestructura', 'Soporte TI', 'Servicios generales', 'Seguridad', 'Bienestar'];

// Etiqueta legible para cualquier valor; si llega uno desconocido se muestra tal cual
export function etiqueta(catalogo, valor) {
  return catalogo[valor] ?? valor ?? '—';
}
