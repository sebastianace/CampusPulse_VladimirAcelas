// Prompt que redacta la explicación de las salas que las reglas ya filtraron
// (tercer paso de POST /api/ia/recomendar). Versión 1.0
// Ver docs/biblioteca-prompts.md.

import { capacidadMaxima, tieneComputadores } from '../../domain/reservas.js';
import { construirPrompt } from './estructura.js';

/** Prompt para explicar las opciones. espacios = los que ya pasaron las reglas, en orden de ajuste. */
export function promptExplicacion(texto, solicitud, espacios) {
  const lista = espacios
    .map((e) => `- ${e.id}: ${e.nombre}, capacidad ${capacidadMaxima(e)} personas, ${tieneComputadores(e) ? 'con' : 'sin'} computadores`)
    .join('\n');
  const equipos = { true: ', con computadores', false: ', sin computadores' }[solicitud.necesitaComputadores] ?? '';
  return construirPrompt({
    rol: 'Redactas la explicación de las opciones de espacios que las reglas del campus ya filtraron para una petición. Respondes SOLO con el JSON pedido.',
    tono: 'En español, claro y breve.',
    politicas: [
      'Los espacios de la lista ya están libres y cumplen las reglas, en orden de mejor ajuste de aforo: la primera opción es la recomendada.',
      'Si el pedido necesita computadores, menciona que la sala los tiene.',
    ],
    limites: [
      'No agregues espacios que no estén en la lista.',
      'No decides qué sala está libre: eso ya lo decidieron las reglas.',
    ],
    procedimiento: [
      'opciones: para CADA espacio de la lista, un motivo corto (una frase) de por qué sirve.',
      'explicacion: dos frases como máximo que recomienden la primera opción.',
    ],
    entrada: `Un usuario pidió: "${texto}"\nSolicitud entendida: ${solicitud.asistentes} personas, de ${solicitud.inicio} a ${solicitud.fin}${equipos}.\n\nEspacios libres:\n${lista}`,
  });
}
