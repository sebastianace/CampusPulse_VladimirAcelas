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

/** Devuelve el último cupo que consumió el usuario (cuando la petición no llegó a atenderse). */
export function devolverCupoIA(usuario) {
  const horas = consultas.get(usuario);
  if (horas?.length) horas.pop();
}

// ---------- presupuesto global de llamadas a Gemini ----------
// El límite de Gemini es por proyecto, no por persona: 30 profesores usando la IA a la vez se reparten las mismas
// 15 llamadas por minuto. Aquí se cuentan las llamadas (estimadas) de TODAS las personas en el último minuto.

const VENTANA_GLOBAL_MS = 60_000;
let llamadas = []; // una hora (ms) por cada llamada estimada a Gemini

const vigentes = (ahora) => (llamadas = llamadas.filter((hora) => ahora - hora < VENTANA_GLOBAL_MS));

/** Cuántas llamadas quedan en el presupuesto del último minuto. */
export function presupuestoRestante(ahora = Date.now()) {
  return Math.max(0, REGLAS.LIMITE_IA_GLOBAL_LLAMADAS_MINUTO - vigentes(ahora).length);
}

/**
 * Reserva `cantidad` llamadas del presupuesto global. Si no alcanza lanza 429 IA_OCUPADA enseguida (con los segundos
 * de espera en `esperaSegundos`) y no reserva nada: es mejor avisar al instante que hacer esperar y fallar.
 */
export function reservarPresupuesto(cantidad, ahora = Date.now()) {
  const actuales = vigentes(ahora);
  if (actuales.length + cantidad > REGLAS.LIMITE_IA_GLOBAL_LLAMADAS_MINUTO) {
    // Cuándo se libera lo suficiente: cuando salgan del minuto las llamadas más antiguas que sobran.
    const sobran = actuales.length + cantidad - REGLAS.LIMITE_IA_GLOBAL_LLAMADAS_MINUTO;
    const espera = Math.max(1, Math.ceil((actuales[Math.min(sobran, actuales.length) - 1] + VENTANA_GLOBAL_MS - ahora) / 1000));
    const error = new DemasiadasPeticionesError(
      `La IA está atendiendo a muchas personas en este momento. Intenta de nuevo en ${espera} segundo(s) o usa el formulario manual.`,
      'IA_OCUPADA',
    );
    error.esperaSegundos = espera;
    throw error;
  }
  for (let i = 0; i < cantidad; i++) actuales.push(ahora);
}

/** Vacía el presupuesto (para los tests). */
export function reiniciarPresupuesto() {
  llamadas = [];
}
