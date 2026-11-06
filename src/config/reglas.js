// =====================================================================
// REGLAS DE NEGOCIO DE CAMPUS PULSE
// ---------------------------------------------------------------------
// Este es el ÚNICO lugar donde viven los valores de negocio.
// Ningún otro archivo debe escribir un número o un estado "a mano":
// todos leen desde aquí. Para cambiar una regla en vivo basta con
// editar un valor y guardar (npm run dev reinicia el servidor solo).
// =====================================================================

export const REGLAS = {
  // Multiplicador del aforo de cada espacio.
  // 1.0 = no se permite superar el aforo; 1.1 = permite 10 % más.
  MARGEN_AFORO: 1.0,

  // Hora (0-23, hora de Bogotá) a partir de la cual se puede empezar una reserva.
  HORA_APERTURA: 7,

  // Hora (0-23) a la que debe haber terminado toda reserva. 21 = 9:00 p. m.
  HORA_CIERRE: 21,

  // Duración máxima de una reserva, en horas.
  MAX_HORAS_RESERVA: 4,

  // Minutos mínimos entre "ahora" y el inicio de una reserva.
  // 0 = solo se prohíbe reservar en el pasado; 60 = con al menos 1 hora de anticipación.
  ANTICIPACION_MINIMA_MINUTOS: 0,

  // Días de la semana en que se puede reservar (0 = domingo ... 6 = sábado).
  // Para prohibir los sábados basta con quitar el 6.
  DIAS_HABILES: [1, 2, 3, 4, 5, 6],

  // Cuántas reservas puede tener un mismo responsable en un mismo día.
  MAX_RESERVAS_POR_PERSONA_DIA: 3,

  // Cuántos préstamos activos (sin devolver) puede tener una persona a la vez.
  MAX_PRESTAMOS_POR_PERSONA: 2,

  // Espacios (por id) que tienen computadores. Si un pedido los necesita,
  // solo se recomiendan estos. Para agregar una sala basta con sumar su id.
  ESPACIOS_CON_COMPUTADORES: ['apolo', 'spooki', 'artemis', 'skilab'],

  // Tipos de espacio que se reservan directo pero la IA nunca recomienda
  // (las mesas de ping-pong de Hunters no sirven para una reunión o una clase).
  TIPOS_FUERA_DE_RECOMENDACION: ['mesa_juego'],

  // Estados de espacio que impiden reservarlo o recomendarlo.
  ESTADOS_NO_ASIGNABLES: ['inhabilitado', 'inconsistente'],

  // Prioridades de incidencia que inhabilitan automáticamente el espacio o
  // recurso afectado, aunque no se marque "inhabilitar".
  // Ejemplo de cambio: ['alta', 'critica'].
  PRIORIDADES_QUE_INHABILITAN: ['critica'],

  // Estado al que pasa un recurso cuando una incidencia lo inhabilita.
  // (Los recursos no tienen estado "inhabilitado"; al resolver vuelve a "disponible").
  ESTADO_RECURSO_INHABILITADO: 'en_reparacion',

  // Cambios de estado permitidos para un recurso tecnológico.
  // Clave = estado actual; valor = estados a los que puede pasar.
  // Ejemplo: para que un equipo dañado vuelva directo a disponible,
  // poner  danado: ['en_reparacion', 'disponible'].
  TRANSICIONES_RECURSO: {
    disponible: ['prestado', 'en_reparacion'],
    prestado: ['disponible', 'danado'],
    danado: ['en_reparacion'],
    en_reparacion: ['disponible'],
  },

  // Uso de la IA (la capa gratis de Gemini tiene cuota limitada).
  // Peticiones a /api/ia que puede hacer cada usuario en la ventana indicada.
  // Al pasarse responde 429 y la interfaz ofrece el formulario manual.
  LIMITE_IA_PETICIONES: 5,
  LIMITE_IA_VENTANA_MINUTOS: 1,

  // Minutos que se guarda la respuesta del triaje para un texto idéntico.
  CACHE_IA_MINUTOS: 10,
};

// =====================================================================
// VALORES CERRADOS (ENUMS) DEL CONTRATO DE LA API
// ---------------------------------------------------------------------
// Son los únicos valores válidos. Los usan el backend, la validación
// de la IA (src/ai/validar.js) y los selects del frontend.
// Cambiarlos implica avisar al equipo (docs/contrato-api.md).
// =====================================================================

// Estados posibles de un espacio físico.
export const ESTADOS_ESPACIO = ['disponible', 'inhabilitado', 'inconsistente'];

// Estados posibles de un recurso tecnológico (portátil, video beam, etc.).
export const ESTADOS_RECURSO = ['disponible', 'prestado', 'danado', 'en_reparacion'];

// Categorías de una incidencia.
export const CATEGORIAS = ['infraestructura', 'tecnologia', 'aseo', 'seguridad', 'bienestar', 'otro'];

// Prioridades de una incidencia, de menor a mayor.
export const PRIORIDADES = ['baja', 'media', 'alta', 'critica'];

// Áreas responsables a las que se enruta una incidencia.
export const AREAS = ['Infraestructura', 'Soporte TI', 'Servicios generales', 'Seguridad', 'Bienestar'];

// Estados de una incidencia. El contrato solo nombra "resuelta" (PATCH);
// "abierta" es el estado con el que nace toda incidencia.
export const ESTADOS_INCIDENCIA = ['abierta', 'resuelta'];

// Origen de una incidencia: sugerida por la IA y confirmada, o llenada a mano.
export const ORIGENES_INCIDENCIA = ['ia', 'manual'];

// Estados de un préstamo: activo mientras el recurso no se ha devuelto.
export const ESTADOS_PRESTAMO = ['activo', 'devuelto'];
