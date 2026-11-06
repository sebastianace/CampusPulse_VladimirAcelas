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

Entre el procedimiento y la entrada puede ir una sección opcional de **Ejemplos** (few-shot).

Principio de todos ellos: **la IA sugiere, las reglas deciden**. El texto del usuario siempre va
entre etiquetas y se declara como un dato, no como instrucciones, y la salida se fuerza con un
schema JSON y se vuelve a validar en `src/ai/validar.js`.

## Prompts

| Prompt | Archivo | Lo usa | Versión |
|---|---|---|---|
| Triaje de incidencias | `prompts/triaje.js` | `POST /api/ia/triaje` | 1.2 |
| Extracción de la solicitud de reserva | `prompts/solicitud.js` | `POST /api/ia/recomendar`, paso 1 | 1.0 |
| Explicación de las salas recomendadas | `prompts/explicacion.js` | `POST /api/ia/recomendar`, paso 3 | 1.1 |

## Historial de versiones

### 1.2: ejemplos few-shot en el triaje

- Se agregan 4 casos resueltos del campus (`prompts/ejemplos-triaje.js`), activos por defecto:

| # | Reporte | Prioridad | Qué enseña |
|---|---|---|---|
| 1 | El video beam de Apolo soltó chispas y huele a quemado | critica, inhabilita | El riesgo para personas |
| 2 | El portátil Lenovo 02 se apaga solo y no carga | media | Un equipo sin sala: `espacioId: null` |
| 3 | Quedó comida y basura en la sala Azul después del taller | baja | No todo reporte inhabilita |
| 4 | Un señor que no conozco entró a las salas sin carné | alta | Lo que no se sabe va en `null` |

- Los ejemplos se muestran como `Reporte: … / Respuesta: …` (distinto formato que el reporte real)
  y el prompt avisa que sus IDs son solo ilustrativos: manda el catálogo de la Entrada.
- Las clasificaciones son criterio del autor. Las más discutibles: la prioridad `alta` del caso 4
  y la `baja` del caso 3.
- `promptTriaje(descripcion, catalogo, { conEjemplos: false })` devuelve la versión zero-shot, que
  sirve para medir.

### 1.1: personalidad de Pulse (triaje y explicación)

- La sección **Tono** de `triaje.js` y `explicacion.js` ahora la arma `tonoDePulse()`
  (`prompts/personalidad.js`) con los cinco rasgos Big Five: Responsabilidad alta, Amabilidad alta,
  Extraversión media, Apertura media y Neuroticismo bajo. Justificación en
  [personalidad.md](personalidad.md).
- `solicitud.js` sigue en 1.0: solo extrae datos y no lleva personalidad.
- Políticas, límites y procedimiento no cambiaron.

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
- **Probado también:** que la personalidad esté en el triaje y la explicación, no en la extracción,
  y que los límites sigan presentes.
- **Probado también** (`tests/few-shot-triaje.test.js`): que los ejemplos y los 12 reportes de
  prueba usen IDs que existen en el catálogo y respeten la regla de inhabilitar, que ningún reporte
  de prueba repita un ejemplo, y que el prompt incluya o no los ejemplos según corresponda.
- **Sin medir:** cómo responde Gemini a la nueva redacción, a la personalidad y a los ejemplos. La reorganización no se comparó contra
  la versión anterior con el modelo real. Pendiente: armar un conjunto de reportes de prueba y
  comparar la clasificación antes y después (ver la medición del few-shot en la Fase 3A del plan).

## Medición: zero-shot vs few-shot

**Método.** Se piden a Gemini 12 reportes **distintos a los 4 ejemplos**
([`evaluacion/triaje-casos.js`](../evaluacion/triaje-casos.js)), cada uno sin ejemplos y con
ellos, y se compara cada campo con la clasificación esperada (categoría, prioridad, área, espacio,
equipo e inhabilitar). Las clasificaciones esperadas también son criterio del autor; dos están
marcadas como discutibles en el archivo.

**Cómo correrla** (gasta cuota de Gemini; son 24 llamadas, unos 5 minutos):

```bash
npm run medir-triaje
```

Guarda el detalle en `evaluacion/resultados/triaje-<fecha>.json`.

**Resultado:** _pendiente de correr_. Cuando se corra, pegar aquí la tabla (aciertos por campo y
casos exactos de 12 en cada modo) y la conclusión, aunque el few-shot no mejore.

**Cómo leerla con cuidado:**
- 12 reportes son pocos: una diferencia de 1 o 2 casos puede ser ruido. Además la IA no es
  determinista aunque la temperatura sea baja (0.2).
- Si el few-shot no mejora, se desactiva cambiando el valor por defecto de `conEjemplos`.

## Pendiente de la Fase 3A

- Correr la medición y registrar el resultado.
