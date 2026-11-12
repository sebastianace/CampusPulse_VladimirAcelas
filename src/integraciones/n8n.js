// =====================================================================
// INTEGRACIÓN CON n8n
// ---------------------------------------------------------------------
// Campus Pulse y n8n se hablan en los dos sentidos:
//
//   Campus Pulse -> n8n   Al crear una incidencia se envía un webhook FIRMADO (notificarIncidenciaNueva).
//   n8n -> Campus Pulse   n8n llama a /api/integraciones/* con el secreto compartido en la cabecera x-pulse-token
//                         (ver src/routes/integraciones.js).
//
// El secreto compartido es N8N_SECRETO (en .env). Sin él la integración está APAGADA: no se envía nada y las
// rutas /api/integraciones responden 503. Un fallo de n8n nunca impide crear la incidencia.
//
// Firma: HMAC-SHA256 de "<timestamp>.<cuerpo>" con el secreto, en la cabecera x-pulse-firma ("sha256=<hex>").
// El timestamp (segundos) viaja en x-pulse-timestamp: n8n rechaza peticiones de hace más de 5 minutos, así que
// alguien que capture un mensaje no puede repetirlo más tarde (ataque de repetición o *replay*).
// =====================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCIA_SEGUNDOS = 300; // 5 minutos: lo que acepta n8n entre el envío y la recepción
const TIMEOUT_MS = 5000;

/** Firma hexadecimal de un cuerpo (texto) enviado en `timestamp` (segundos). */
export function firmar(secreto, timestamp, cuerpo) {
  return createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex');
}

/**
 * Comprueba una firma recibida ("sha256=<hex>"). Compara en tiempo constante y rechaza timestamps
 * viejos o futuros. `ahora` en segundos (parámetro para probarlo sin esperar).
 */
export function verificarFirma({ secreto, timestamp, cuerpo, firma, ahora = Math.floor(Date.now() / 1000) }) {
  const marca = Number(timestamp);
  if (!secreto || !Number.isFinite(marca) || Math.abs(ahora - marca) > TOLERANCIA_SEGUNDOS) return false;
  const esperada = Buffer.from(`sha256=${firmar(secreto, timestamp, cuerpo)}`);
  const recibida = Buffer.from(String(firma ?? ''));
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/** ¿El secreto recibido de n8n coincide con el nuestro? (tiempo constante; falso si no hay secreto configurado) */
export function secretoValido(recibido, secreto = process.env.N8N_SECRETO) {
  if (!secreto || typeof recibido !== 'string') return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Los datos de la incidencia que salen hacia n8n. Nunca va quién reportó ni lo que sugirió la IA.
function datosPublicos(i) {
  return {
    id: i.id, descripcion: i.descripcion, categoria: i.categoria, prioridad: i.prioridad, area: i.area,
    espacioId: i.espacioId ?? null, recursoId: i.recursoId ?? null, origen: i.origen, fecha: i.fecha,
  };
}

/**
 * Avisa a n8n de una incidencia nueva. Devuelve {enviado: boolean, motivo?}. NUNCA lanza: si n8n no está
 * configurado, está caído o responde un error, la incidencia ya se creó y solo se deja un aviso en el log.
 * Un solo intento: los reintentos son cosa de n8n; si n8n está caído el aviso se pierde y el resumen diario
 * (que lee las incidencias desde la API) igual la incluye.
 */
export async function notificarIncidenciaNueva(incidencia, { url = process.env.N8N_WEBHOOK_URL, secreto = process.env.N8N_SECRETO } = {}) {
  if (!url || !secreto) return { enviado: false, motivo: 'n8n no está configurado' };
  const cuerpo = JSON.stringify({ evento: 'incidencia.creada', incidencia: datosPublicos(incidencia) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pulse-timestamp': timestamp,
        'x-pulse-firma': `sha256=${firmar(secreto, timestamp, cuerpo)}`,
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      console.warn(`[n8n] El webhook respondió ${respuesta.status}; la incidencia ${incidencia.id} no se notificó.`);
      return { enviado: false, motivo: `n8n respondió ${respuesta.status}` };
    }
    return { enviado: true };
  } catch (error) {
    console.warn(`[n8n] No se pudo avisar a n8n de ${incidencia.id} (${error.cause?.code ?? error.name}).`);
    return { enviado: false, motivo: 'n8n no respondió' };
  }
}
