# Biblioteca de prompts

Todos los prompts del sistema viven en [`src/ai/prompts/`](../src/ai/prompts/), uno por archivo,
y se arman con la misma plantilla de seis secciones
([`estructura.js`](../src/ai/prompts/estructura.js)):

1. **Rol y objetivo**: quién es la IA y qué debe lograr.
2. **Tono**: cómo habla.
3. **Políticas**: criterios de negocio que debe aplicar.
4. **Límites**: lo que nunca debe hacer.
5. **Procedimiento**: pasos y formato de la respuesta.
6. **Entrada**: los datos de esa petición (catálogo, texto del usuario, fecha).

Principio de todos ellos: **la IA sugiere, las reglas deciden**. El texto del usuario siempre va
entre etiquetas y se declara como un dato, no como instrucciones, y la salida se fuerza con un
schema JSON y se vuelve a validar en `src/ai/validar.js`.

## Prompts

| Prompt | Archivo | Lo usa | Versión |
|---|---|---|---|
| Triaje de incidencias | `prompts/triaje.js` | `POST /api/ia/triaje` | 1.0 |
| Extracción de la solicitud de reserva | `prompts/solicitud.js` | `POST /api/ia/recomendar`, paso 1 | 1.0 |
| Explicación de las salas recomendadas | `prompts/explicacion.js` | `POST /api/ia/recomendar`, paso 3 | 1.0 |

## Historial de versiones

### 1.0: reorganización a la plantilla de seis secciones

- Antes los prompts estaban escritos dentro de `triaje.js` y `asistente.js`. Se movieron a
  `src/ai/prompts/` y se reordenaron en las secciones de la plantilla.
- Se conservaron los criterios de cada prompt (valores cerrados, "crítica" si hay riesgo para
  personas, no inventar IDs, texto del usuario como dato). Cambió la redacción y el orden, no la
  intención.

## Qué está probado y qué no

- **Probado** (`tests/prompts.test.js`, sin llamar a Gemini): que cada prompt tenga las seis
  secciones en orden, lleve el catálogo y los valores cerrados, delimite el texto del usuario y
  deje un texto que da órdenes dentro de los delimitadores.
- **Sin medir:** cómo responde Gemini a la nueva redacción. La reorganización no se comparó contra
  la versión anterior con el modelo real. Pendiente: armar un conjunto de reportes de prueba y
  comparar la clasificación antes y después (ver la medición del few-shot en la Fase 3A del plan).

## Pendiente de la Fase 3A

- Personalidad de "Pulse" con el modelo Big Five (`docs/personalidad.md`).
- Ejemplos few-shot en el triaje, medidos contra zero-shot.
