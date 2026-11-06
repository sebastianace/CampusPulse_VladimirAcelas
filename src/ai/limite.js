// =====================================================================
// LÍMITE DE PETICIONES A LA IA (por usuario)
// ---------------------------------------------------------------------
// Cada usuario puede hacer LIMITE_IA_PETICIONES consultas a la IA en
// LIMITE_IA_VENTANA_MINUTOS (ventana deslizante). Al pasarse responde 429
// con un mensaje en español y la interfaz ofrece el formulario manual.
// - Cuenta en memoria: un reinicio del servidor borra los contadores.
// - `ahora` es un parámetro para probar la ventana sin esperar.
// =====================================================================

import { REGLAS } from '../config/reglas.js';
import { DemasiadasPeticionesError } from '../domain/errors.js';

const VENTANA_MS = REGLAS.LIMITE_IA_VENTANA_MINUTOS * 60_000;

// usuario -> horas (en ms) de sus consultas que siguen dentro de la ventana
const consultas = new Map();

/**
 * Anota una consulta del usuario. Si ya gastó su cupo lanza 429 (LIMITE_IA)
 * con los segundos de espera en `esperaSegundos`; esa consulta no se anota.
 */
export function consumirCupoIA(usuario, ahora = Date.now()) {
  const vigentes = (consultas.get(usuario) ?? []).filter((hora) => ahora - hora < VENTANA_MS);
  if (vigentes.length >= REGLAS.LIMITE_IA_PETICIONES) {
    consultas.set(usuario, vigentes);
    const espera = Math.ceil((vigentes[0] + VENTANA_MS - ahora) / 1000);
    const error = new DemasiadasPeticionesError(
      `Hiciste muchas consultas a la IA seguidas. Espera ${espera} segundo(s) o usa el formulario manual.`,
      'LIMITE_IA',
    );
    error.esperaSegundos = espera;
    throw error;
  }
  consultas.set(usuario, [...vigentes, ahora]);
}
