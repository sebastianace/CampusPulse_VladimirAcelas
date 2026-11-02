// =====================================================================
// ERRORES DE LA API
// ---------------------------------------------------------------------
// Cada error lleva su código HTTP (status), un código corto en
// mayúsculas y un mensaje en español listo para mostrar en un toast.
// El manejador global de src/server.js responde siempre:
//   { error: { codigo, mensaje } }  con el status del error.
// =====================================================================

// Clase base: cualquier error que la API sabe responder.
export class ErrorApi extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
  }
}

// 409: se violó una regla de negocio (aforo, solapamiento, horario...).
export class ReglaNegocioError extends ErrorApi {
  constructor(codigo, mensaje) {
    super(409, codigo, mensaje);
  }
}

// 422: el cuerpo de la petición viene mal formado o le faltan campos.
export class DatosInvalidosError extends ErrorApi {
  constructor(mensaje, codigo = 'DATOS_INVALIDOS') {
    super(422, codigo, mensaje);
  }
}

// 403: hay sesión, pero el rol del usuario no tiene permiso para esa acción.
export class ProhibidoError extends ErrorApi {
  constructor(mensaje, codigo = 'PERMISO_DENEGADO') {
    super(403, codigo, mensaje);
  }
}

// 429: se superó un límite de intentos o de peticiones.
export class DemasiadasPeticionesError extends ErrorApi {
  constructor(mensaje, codigo = 'DEMASIADAS_PETICIONES') {
    super(429, codigo, mensaje);
  }
}

// 404: se pidió un ID que no existe.
export class NoEncontradoError extends ErrorApi {
  constructor(mensaje, codigo = 'NO_ENCONTRADO') {
    super(404, codigo, mensaje);
  }
}
