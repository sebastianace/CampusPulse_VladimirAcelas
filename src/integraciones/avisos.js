// =====================================================================
// ENTREGA DE AVISOS POR CORREO
// ---------------------------------------------------------------------
// Recibe los avisos que decidió src/domain/avisos.js ({para, asunto, mensaje}),
// busca el nombre y el correo de cada persona y le pide a n8n que los entregue
// (webhook firmado, src/integraciones/n8n.js).
// - Quien no tiene correo en su cuenta no recibe correo (sigue viendo el aviso en la app).
// - Se llama DESPUÉS de guardar el cambio y sin esperarlo: un correo que falla nunca
//   deshace ni demora una reserva o una solicitud. NUNCA lanza.
// =====================================================================

import { contactosDe } from '../auth/usuarios.js';
import { enviarAvisoReserva } from './n8n.js';

/** Envía los avisos. Devuelve cuántos se enviaron y cuántos no (para los tests y el log). */
export async function enviarAvisos(avisos) {
  try {
    const conDestino = avisos.filter((a) => a.para);
    if (!conDestino.length) return { enviados: 0, sinCorreo: 0, fallidos: 0 };
    const contactos = await contactosDe([...new Set(conDestino.map((a) => a.para))]);
    const resultado = { enviados: 0, sinCorreo: 0, fallidos: 0 };
    await Promise.all(conDestino.map(async ({ para, asunto, mensaje }) => {
      const contacto = contactos.get(para);
      if (!contacto?.correo) {
        resultado.sinCorreo += 1;
        return;
      }
      const { enviado } = await enviarAvisoReserva({ correo: contacto.correo, nombre: contacto.nombre, asunto, mensaje });
      resultado[enviado ? 'enviados' : 'fallidos'] += 1;
    }));
    return resultado;
  } catch (error) {
    console.warn(`[avisos] No se pudieron enviar los avisos (${error.message}).`);
    return { enviados: 0, sinCorreo: 0, fallidos: avisos.length };
  }
}
