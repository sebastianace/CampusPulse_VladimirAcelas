// Cliente central de la API. Todas las llamadas al backend pasan por aquí.
// Si la API responde {error:{codigo, mensaje}}, se lanza un Error con ese mensaje
// (en español, listo para mostrar en un toast).

const TIEMPO_LIMITE_MS = 20000; // la IA puede tardar hasta 15 s + un reintento
export const TIEMPO_LIMITE_PREGUNTAS_MS = 45000; // el RAG hace varias llamadas a Gemini (reformular, reordenar, responder)

export class ErrorApi extends Error {
  constructor(mensaje, { codigo = 'ERROR', status = 0 } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.status = status;
  }
}

/**
 * Llama a la API y devuelve el JSON de la respuesta.
 * @param {string} ruta   ej. '/api/reservas?fecha=2026-10-16'
 * @param {object} opciones  { metodo: 'GET'|'POST'|'PATCH', cuerpo: objeto, tiempoMs: espera máxima }
 */
export async function pedir(ruta, { metodo = 'GET', cuerpo, tiempoMs = TIEMPO_LIMITE_MS } = {}) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), tiempoMs);

  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: control.signal,
    });
  } catch (error) {
    // Sin respuesta: servidor apagado, red caída o tiempo agotado
    const mensaje = error.name === 'AbortError'
      ? 'El servidor tardó demasiado en responder. Intenta de nuevo.'
      : 'No hay conexión con el servidor.';
    throw new ErrorApi(mensaje, { codigo: 'SIN_CONEXION' });
  } finally {
    clearTimeout(temporizador);
  }

  const datos = await leerJson(respuesta);

  if (!respuesta.ok) {
    const mensaje = datos?.error?.mensaje ?? mensajePorEstado(respuesta.status);
    const codigo = datos?.error?.codigo ?? `HTTP_${respuesta.status}`;
    // Sin sesión: ir a la pantalla de inicio y volver aquí después
    if (codigo === 'SESION_REQUERIDA' && !location.pathname.endsWith('/login.html')) irALogin();
    throw new ErrorApi(mensaje, { codigo, status: respuesta.status });
  }

  return datos;
}

/** Lleva a la pantalla de inicio de sesión recordando la página actual. */
export function irALogin() {
  location.href = `/login.html?volver=${encodeURIComponent(location.pathname)}`;
}

/** Cierra la sesión en el servidor y vuelve a la pantalla de inicio. */
export async function cerrarSesion() {
  try {
    await pedir('/api/auth/logout', { metodo: 'POST' });
  } finally {
    location.href = '/login.html';
  }
}

// Lee el cuerpo como JSON sin romperse si viene vacío o mal formado
async function leerJson(respuesta) {
  const texto = await respuesta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

// Mensaje de respaldo si el backend no envía {error:{mensaje}}
function mensajePorEstado(status) {
  if (status === 404) return 'No se encontró lo que buscabas.';
  if (status === 409) return 'La operación no cumple las reglas del campus.';
  if (status === 422) return 'Los datos enviados no son válidos.';
  if (status === 503) return 'El servicio de IA no está disponible en este momento.';
  return `El servidor respondió con un error (${status}).`;
}

// Atajo para saber si hay que ofrecer el formulario manual: IA caída (503),
// límite de consultas a la IA superado (429 LIMITE_IA) o sin conexión
export function esFallaDeIA(error) {
  return error instanceof ErrorApi
    && (error.status === 503 || error.codigo === 'LIMITE_IA' || error.codigo === 'SIN_CONEXION');
}
