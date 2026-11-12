// =====================================================================
// ESTRUCTURA DE UN PROMPT DEL SISTEMA
// ---------------------------------------------------------------------
// Todos los prompts de Campus Pulse se arman con las mismas secciones
// (la plantilla vista en clase), para que se lean y se comparen igual:
//   1. Rol y objetivo  quién es la IA y qué debe lograr
//   2. Tono            cómo habla
//   3. Políticas       criterios de negocio que debe aplicar
//   4. Límites         lo que nunca debe hacer
//   5. Procedimiento   pasos y formato de la respuesta
//   + Ejemplos         (opcional) casos resueltos para enseñar el criterio (few-shot)
//   + Entrada          los datos de esta petición (catálogo, texto del usuario...)
// Cada prompt vive en su propio archivo de esta carpeta y solo declara el
// contenido de cada sección; aquí se decide el orden y el formato.
// =====================================================================

const lineas = (items) => items.map((item) => `- ${item}`).join('\n');

/**
 * Arma el prompt a partir de sus secciones.
 * rol y tono son texto; politicas, limites y procedimiento son listas;
 * ejemplos es texto opcional (si viene vacío o no viene, la sección no aparece);
 * entrada es el texto ya armado con los datos de la petición.
 */
export function construirPrompt({ rol, tono, politicas, limites, procedimiento, ejemplos, entrada }) {
  return [
    `## Rol y objetivo\n${rol}`,
    `## Tono\n${tono}`,
    `## Políticas\n${lineas(politicas)}`,
    `## Límites\n${lineas(limites)}`,
    `## Procedimiento\n${lineas(procedimiento)}`,
    ejemplos ? `## Ejemplos\n${ejemplos}` : null,
    `## Entrada\n${entrada}`,
  ].filter(Boolean).join('\n\n');
}
