// Quién inició sesión y qué le toca ver. Solo es comodidad de la interfaz:
// quien de verdad impide las acciones es el servidor (403), aquí únicamente
// se ocultan los botones que darían error.

// Debe coincidir con los permisos de docs/contrato-api.md
const PERMISOS = {
  restaurar: ['admin'],
  resolverIncidencias: ['admin', 'soporte_tecnico'],
  gestionarUsuarios: ['admin'],
};

const NOMBRES_ROL = {
  admin: 'Administrador',
  profesor: 'Profesor',
  soporte_tecnico: 'Soporte técnico',
};

let sesion = null;

export function guardarSesion(datos) {
  sesion = datos;
}

export const nombreDeRol = (rol) => NOMBRES_ROL[rol] ?? rol;

/** ¿El usuario actual puede hacer esa acción? Sin sesión conocida, no. */
export function puede(accion) {
  return Boolean(sesion && PERMISOS[accion]?.includes(sesion.rol));
}
