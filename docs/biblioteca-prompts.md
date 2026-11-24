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
| Triaje de incidencias | `prompts/triaje.js` | `POST /api/ia/triaje` | 1.5 |
| Extracción de la solicitud de reserva | `prompts/solicitud.js` | `POST /api/ia/recomendar`, paso 1 | 1.0 |
| Explicación de las salas recomendadas | `prompts/explicacion.js` | `POST /api/ia/recomendar`, paso 3 | 1.1 |
| Intención del mensaje (reservar o preguntar) | `prompts/intencion.js` | `POST /api/ia/asistente` | 1.0 |
| Reformular la pregunta con la conversación (few-shot) | `pulse-ai/app/prompts.py` | RAG, `pulse-ai` | 1.1 |
| Reordenar fragmentos (reranking) | `pulse-ai/app/prompts.py` | RAG, `pulse-ai` | 1.0 |
| Responder con citas o decir "no sé" | `pulse-ai/app/prompts.py` | RAG, `pulse-ai` | 1.1 |

Los prompts del RAG viven en Python (`pulse-ai/`) porque ahí corre LangChain, con la misma plantilla de seis secciones
y la misma personalidad de Pulse. Un test de Node comprueba que las conductas de la personalidad sean idénticas en los dos
lugares (`tests/conocimiento-docs.test.js`).

## Historial de versiones

### 1.5: solo infraestructura y tecnología, y "esto no es para TI"
- **Decisión de negocio (21 nov 2026):** en el campus hay 2 técnicos de TI y cada uno atiende una categoría. Aseo,
  seguridad, bienestar y "otro" se quitaron de `CATEGORIAS` y quedan en `CATEGORIAS_ANTERIORES` solo para el historial.
- **Problema que evita:** con 2 categorías, la IA metería "se regó café en el pasillo" a la fuerza en infraestructura y
  le llegaría a TI, que no lo resuelve. Por eso el prompt pide primero `paraTI` (true o false) y la categoría solo si
  es para TI. Con `paraTI: false` la respuesta trae `aviso` (a quién acudir, `REGLAS.CONTACTO_FUERA_DE_TI`) y la persona
  igual puede elegir la categoría a mano si cree que sí es para TI.
- `validar.js` deja la categoría en `null` cuando `paraTI` es `false`, aunque la IA mande una. Si la IA no manda
  `paraTI`, se asume `true`: decide la persona.
- El conjunto de prueba y los ejemplos few-shot cambian: los casos de aseo, bienestar y seguridad esperan
  `paraTI: false` y categoría `null`, y la medición cuenta el campo `paraTI`.
- **Medido el 22 nov 2026** con `gemini-3.5-flash-lite` (`evaluacion/resultados/triaje-2026-11-22.json`):

  | | Zero-shot | Few-shot |
  |---|---|---|
  | `paraTI` | 12/12 | 12/12 |
  | categoría | 11/12 | 11/12 |
  | prioridad | 9/12 | 10/12 |
  | espacio, equipo, inhabilitar | 12/12 | 12/12 |
  | casos exactos | 8/12 | 9/12 |

  **Lo nuevo funciona:** los 4 reportes que no son de TI (café, estrés, jabón, mochila) se detectan en los dos modos.
  Los fallos son de prioridad en casos ya marcados como discutibles (café, mochila) o en el proyector que no enciende
  "en una hora hay clase" (dijo alta, se esperaba media), y uno de categoría: los cables pelados de la consola de sonido
  salieron como infraestructura (se esperaba tecnología). Ninguno cambia a quién llega el reporte: los dos técnicos son
  de TI. Los casos exactos bajan frente a 1.3 (10/12) porque ahora se mide un campo más y la prioridad de un reporte
  que no es de TI ya no importa para el registro. El few-shot gana por un caso (ruido con 12 casos), así que sigue
  desactivado (`USAR_EJEMPLOS_TRIAJE = false`).

### 1.4: el triaje ya no decide el área
- **Decisión de negocio:** en el campus, TI es el único equipo que resuelve los problemas técnicos y de infraestructura.
  Toda incidencia va a `REGLAS.AREA_RESPONSABLE` (`Soporte TI`), así que el área la pone el código, no la IA ni la persona.
- Se quitaron del prompt la guía "categoría → área" y el campo `area` del procedimiento, y `area` del schema de la
  respuesta. La salida es más corta y la IA tiene una decisión menos en la que equivocarse.
- La categoría sigue: dice **qué tipo** de problema es (tecnología, infraestructura, aseo…), no quién lo atiende.
- Las mediciones de 1.2 y 1.3 de abajo incluyen el campo área porque se hicieron antes de este cambio.

### 1.3: el criterio de "inhabilitar" es el riesgo para las personas
- La política decía "inhabilitar si el espacio o equipo no se puede usar con seguridad"; el modelo marcaba como inhabilitado
  cualquier equipo que no funcionara. Ahora dice: **solo si usarlo pone en riesgo a las personas**; un equipo dañado sin
  riesgo se reporta pero no se inhabilita; sin espacio ni equipo identificado, no se inhabilita nada.
- Medido antes y después (ver "Medición"): "inhabilitar" pasó de 7 y 10 aciertos de 12 a 12 de 12 en los dos modos.
- Con este resultado, el triaje queda **sin ejemplos few-shot** por defecto.

### RAG 1.1: la reformulación decide antes de reescribir
- **Problema encontrado probando con Gemini real** (`gemini-3.5-flash-lite`): con una conversación previa sobre
  "domingos", la pregunta independiente *"¿Quién ganó el mundial de fútbol de 2014?"* se reescribía como *"¿Cuál es el
  tiempo máximo de reserva los domingos?"* en 2 de 4 intentos, y Pulse respondía sobre domingos. La v1.0 del prompt pedía
  "reescribe la pregunta para que se entienda sola", y el modelo la reescribía siempre, mezclando temas.
- **Cambio:** el modelo primero decide en un campo `depende_del_historial` (true solo si la pregunta no se entiende
  sin los mensajes anteriores); si es `false`, el código usa la pregunta original sin tocarla aunque el modelo la haya
  reescrito. Además se agregó la sección de **ejemplos (few-shot)** con cuatro casos, entre ellos el del mundial.
- **Resultado:** el mismo escenario, 8 de 8 intentos sin contaminar (antes 2 de 4). Los seguimientos legítimos
  ("¿y los domingos?") siguen reformulándose bien (5 de 5 en una prueba directa).
- Si la reformulación falla (Gemini caído), el código une la última pregunta de la persona con la nueva, sin IA.
- **Prompt de respuesta 1.1:** se agregó "ve directo a la respuesta, sin saludar" porque la primera respuesta empezó con
  "Hola.".

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

**Resultado** (13 nov 2026, `gemini-3.5-flash-lite`, dos rondas; detalle en `evaluacion/resultados/triaje-2026-11-13-prompt-v1.2.json`
y `…-v1.3.json`):

| Campo (de 12) | Zero-shot, prompt 1.2 | Few-shot, prompt 1.2 | Zero-shot, prompt 1.3 | Few-shot, prompt 1.3 |
|---|---|---|---|---|
| **Casos exactos (los 6 campos)** | **9** | **7** | **10** | **10** |
| Categoría | 11 | 12 | 11 | 11 |
| Prioridad | 11 | 10 | 11 | 11 |
| Área | 11 | 12 | 11 | 11 |
| Espacio | 12 | 12 | 12 | 12 |
| Equipo | 12 | 12 | 12 | 12 |
| Inhabilitar | 10 | **7** | **12** | **12** |

**Qué pasó:**
1. **Primera ronda (prompt 1.2): el few-shot salió peor** (7 frente a 9). Mejoraba la categoría y el área, pero marcaba
   "inhabilitar" en un televisor sin imagen, un portátil con la pantalla rota y unas sillas rotas, que según el criterio del
   autor no se inhabilitan.
2. **Causa:** la política decía "inhabilitar si el espacio o equipo **no se puede usar** con seguridad". Un equipo que no
   funciona "no se puede usar", y el modelo lo tomó literal. El criterio real es **riesgo para las personas**.
3. **Corrección (prompt 1.3):** la política lo dice explícito, con ejemplos de lo que no se inhabilita, y agrega que sin
   espacio ni equipo identificado no hay nada que inhabilitar.
4. **Segunda ronda: empate** (10 y 10) y "inhabilitar" perfecto en los dos modos. Los 2 fallos que quedan en cada modo son
   casos discutibles: el café derramado (ya marcado como discutible), el proyector de Cosmos ("alta" en vez de "media") y los
   cables pelados (clasificados como seguridad o infraestructura en vez de tecnología).

**Decisión:** el few-shot **no mejoró** y agrega **420 tokens por llamada** (1531 frente a 1111, +38 %), así que, por la regla
de abajo, el triaje queda **sin ejemplos** (`USAR_EJEMPLOS_TRIAJE = false` en `src/ai/prompts/triaje.js`). Los ejemplos se
conservan y se reactivan cambiando ese valor.

**Lección:** el mayor cambio no lo dio el few-shot sino **redactar bien una política** (de 7 a 10 casos exactos). Los
ejemplos no corrigen una instrucción ambigua; a veces la amplifican.

**Cómo leerla con cuidado:**
- 12 reportes son pocos: una diferencia de 1 o 2 casos puede ser ruido. Además la IA no es
  determinista aunque la temperatura sea baja (0.2).
- Si el few-shot no mejora, se desactiva cambiando el valor por defecto de `conEjemplos`.

## Pendiente

- Repetir la medición con más reportes (12 son pocos: 1 o 2 casos de diferencia pueden ser ruido) y con otros modelos
  (`npm run comparar-modelos`, ver `docs/matriz-modelos.md`).
