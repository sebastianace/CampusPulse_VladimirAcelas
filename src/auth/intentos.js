// =====================================================================
// LÍMITE DE INTENTOS DE INICIO DE SESIÓN
// ---------------------------------------------------------------------
// Frena los ataques de fuerza bruta: con MAX_INTENTOS_LOGIN fallos del
// mismo usuario desde la misma IP en MINUTOS_VENTANA_LOGIN, el login
// responde 429 hasta que el fallo más antiguo salga de la ventana.
// - Se guarda en memoria: un reinicio del servidor borra los contadores.
// - Un login correcto borra los fallos de ese usuario e IP.
// - `ahora` es un parámetro para poder probar la ventana sin esperar.
// =====================================================================

export const MAX_INTENTOS_LOGIN = 5;
export const MINUTOS_VENTANA_LOGIN = 15;

const VENTANA_MS = MINUTOS_VENTANA_LOGIN * 60_000;
const MAX_CLAVES_EN_MEMORIA = 1000; // al pasar este número se limpian las claves vencidas

// "usuario|ip" -> horas (en ms) de los fallos que siguen dentro de la ventana
const fallos = new Map();

const claveDe = (usuario, ip) => `${usuario}|${ip}`;

// Fallos de la clave que siguen dentro de la ventana (y borra los viejos).
function fallosVigentes(clave, ahora) {
  const vigentes = (fallos.get(clave) ?? []).filter((hora) => ahora - hora < VENTANA_MS);
  if (vigentes.length) fallos.set(clave, vigentes);
  else fallos.delete(clave);
  return vigentes;
}

/** Segundos que faltan para poder intentar de nuevo (0 = puede intentar). */
export function segundosDeBloqueo(usuario, ip, ahora = Date.now()) {
  const vigentes = fallosVigentes(claveDe(usuario, ip), ahora);
  if (vigentes.length < MAX_INTENTOS_LOGIN) return 0;
  return Math.ceil((vigentes[0] + VENTANA_MS - ahora) / 1000);
}

/** Anota un intento fallido. */
export function registrarFallo(usuario, ip, ahora = Date.now()) {
  if (fallos.size > MAX_CLAVES_EN_MEMORIA) {
    for (const clave of fallos.keys()) fallosVigentes(clave, ahora);
  }
  const clave = claveDe(usuario, ip);
  fallos.set(clave, [...fallosVigentes(clave, ahora), ahora]);
}

/** Borra los fallos de ese usuario e IP (después de un login correcto). */
export function limpiarFallos(usuario, ip) {
  fallos.delete(claveDe(usuario, ip));
}
