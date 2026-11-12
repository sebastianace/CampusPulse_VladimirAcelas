# Decisiones de diseño

Aquí está el **porqué** de las decisiones más grandes de la parte de IA, para poder defenderlas. Cada una dice qué se
decidió, qué se descartó, con qué evidencia del propio proyecto y qué **no** se midió.

> Regla de honestidad de este documento: lo que salió de una medición del proyecto lo marco como tal; lo que es
> razonamiento o conocimiento general lo marco como tal. No se hizo ningún fine-tuning ni se probó Qdrant o Chroma en
> este proyecto, así que esas comparaciones son **conceptuales**, no benchmarks.

---

## 1. RAG y no fine-tuning

### Qué hace cada uno

| | Fine-tuning | RAG |
|---|---|---|
| **Qué cambia** | Los pesos del modelo: se reentrena con ejemplos | Nada del modelo: se le entregan documentos en cada pregunta |
| **Sirve para** | Enseñar un **estilo, formato o habilidad** (clasificar, escribir de cierta forma) | Darle **conocimiento** que cambia o que es privado |
| **Dónde queda el conocimiento** | Mezclado en los pesos, sin poder señalarlo | En documentos que se pueden leer, citar y editar |

### Por qué RAG para Campus Pulse

1. **Los reglamentos cambian.** Todo el proyecto está hecho para que una regla cambie en vivo (`reglas.js`): hoy la
   duración máxima es 4 horas, mañana puede ser 3. Con RAG se edita el `.md`, se corre `npm run conocimiento` y la
   respuesta cambia en segundos. Un modelo con fine-tuning seguiría diciendo "4 horas" hasta reentrenarlo.
2. **Cita sus fuentes.** Pulse dice de qué documento y sección salió el dato, y la interfaz lo muestra (*Ver fuentes*).
   Un modelo con fine-tuning no puede señalar de dónde sacó algo: no se puede verificar.
3. **Puede decir "no sé".** Como la respuesta debe apoyarse en fragmentos recuperados, si no hay fragmentos útiles se
   sabe y se dice (`docs/rag.md`, tres capas). Con fine-tuning, el modelo tiende a responder siempre, sea o no cierto.
4. **Costo y datos.** El fine-tuning pide cientos o miles de ejemplos bien etiquetados y tiempo de entrenamiento. Aquí
   hay cinco documentos y 15 preguntas de prueba. RAG funciona desde el primer documento.
5. **Control y privacidad.** Los documentos se quedan en nuestra base y se pueden borrar. Lo que se "enseña" a un modelo
   por fine-tuning no se puede retirar fácilmente.

### Evidencia en el proyecto
- La evaluación (`docs/evaluacion-rag.md`) mide si Pulse acierta, cita bien y dice "no sé". Algo equivalente en un modelo
  con fine-tuning no se podría auditar fragmento por fragmento.
- El comportamiento que sí quisimos "enseñar" (el tono de Pulse y la forma de clasificar incidencias) se logró con
  **prompting**: personalidad Big Five y ejemplos few-shot (`docs/personalidad.md`, `docs/biblioteca-prompts.md`), que es
  gratis, inmediato y reversible. **La medición del few-shot del triaje todavía no se ha corrido** (`npm run medir-triaje`),
  así que no se puede afirmar cuánto mejora.

### Cuándo SÍ usaría fine-tuning
- **Clasificar a gran escala:** si el triaje procesara miles de incidencias al día, y el few-shot dejara de ser
  suficiente, se podría ajustar un modelo pequeño con miles de incidencias ya clasificadas por personas. Sería más rápido
  y barato por llamada que un prompt largo con ejemplos.
- **Un formato o tono muy estricto** que el prompt no logra mantener de forma estable.
- **Lenguaje muy especializado** que el modelo base no conoce.
- **Lo mejor suele ser combinarlos:** fine-tuning para el *cómo* (formato, estilo) y RAG para el *qué* (datos vigentes).

### Lo que no verifiqué
No consulté qué modelos de Gemini ofrecen ajuste fino hoy ni su costo; cambia seguido. Antes de decidir en serio, hay que
mirar la documentación vigente del proveedor.

---

## 2. pgvector y no Qdrant o Chroma

En clase se usaron **Qdrant Cloud** y **Chroma** (en notebooks). En Campus Pulse la base vectorial es **PostgreSQL con
pgvector**. Es una comparación conceptual, no un benchmark.

| Criterio | pgvector | Qdrant | Chroma |
|---|---|---|---|
| **Qué es** | Extensión de PostgreSQL | Base de datos vectorial dedicada | Base vectorial ligera, pensada para prototipar |
| **Servicio extra que operar** | No (ya hay PostgreSQL) | Sí (o su nube) | Sí (o embebida en el proceso de Python) |
| **Datos relacionales y vectores juntos** | Sí, en la misma consulta SQL | No: los datos viven aparte | No |
| **Transacciones y claves foráneas** | Sí (ACID) | No en el sentido relacional | No |
| **Filtrar por metadatos** | Cualquier `WHERE` o `JOIN` de SQL | Filtros sobre el *payload* (muy completos) | Filtros sobre metadatos (más básicos) |
| **Índices** | HNSW e IVFFlat | HNSW, con cuantización y otras optimizaciones | HNSW |
| **Crecer a muchos millones de vectores** | Se escala hacia arriba; más limitado | Pensada para eso (distribuida) | No es su foco |
| **Para quién es ideal** | Quien ya usa PostgreSQL y tiene volúmenes moderados | Búsqueda vectorial a gran escala o con filtros complejos | Notebooks, pruebas y prototipos |

### Por qué pgvector aquí
1. **Una sola base.** Datos del campus, cuentas, incidencias, embeddings de incidencias y fragmentos del RAG: un solo
   contenedor, una sola copia de seguridad, una sola conexión.
2. **El filtro híbrido es un `WHERE`.** "Incidencias *abiertas* del *mismo equipo* más parecidas a este texto" es una
   consulta SQL (`src/data/similares.js`). En una base vectorial aparte habría que copiar al *payload* el estado de cada
   incidencia y **actualizarlo cada vez que cambia** (por ejemplo, al resolverla); el riesgo es que se desincronice.
3. **Integridad.** La tabla de embeddings tiene `ON DELETE CASCADE` hacia `incidencias`: si se borra una incidencia, su
   vector desaparece solo. Es una propiedad que una base aparte no da.
4. **El volumen es pequeño.** Decenas de fragmentos y unas pocas incidencias: aquí el rendimiento no diferencia a ninguna.

### Un límite real que apareció
Un índice HNSW de pgvector (tipo `vector`) **no admite más de 2000 dimensiones**, y `gemini-embedding-001` devuelve 3072 por
defecto. Fue un error real al crear el índice; se resolvió pidiendo 768 dimensiones al modelo (`docs/incidencias-parecidas.md`).

### Cuándo cambiaría
- **Millones de vectores** o búsquedas con muchos filtros a la vez, donde un motor dedicado como Qdrant rinde mejor.
- Si el equipo de búsqueda necesitara **escalar aparte** de la base transaccional.
- **Chroma** lo usaría para explorar rápido en un notebook, como se hizo en clase, no para producción.

### Lo que no medí
No comparé tiempos ni calidad entre las tres con datos de este proyecto. Con tan pocos vectores no tendría sentido
(todas responderían en milisegundos).

---

## 3. LangChain en un servicio de Python

- **Decisión:** el RAG vive en `pulse-ai/` (Python, FastAPI y LangChain) y Express lo llama por HTTP.
- **Por qué:** LangChain es la herramienta del curso y su versión de Python es la más completa. Separarlo aísla los
  fallos: si `pulse-ai` cae, solo falla la parte de preguntas (hay un test que lo comprueba).
- **Qué aportó LangChain:** los *splitters* de texto, el almacén `PGVectorStore` (tabla, índice HNSW, búsqueda), los
  embeddings de Gemini y la salida estructurada con Pydantic.
- **Qué NO lo decide LangChain y lo escribimos nosotros:** el reranking, la validación de citas y la regla "sin fuente
  válida es no sé". Las garantías de que Pulse no invente son código nuestro, con tests.
- **Costo:** un contenedor más, un salto de red por pregunta y versiones que cambian rápido (por eso `requirements.txt`
  fija las versiones exactas).

---

## 4. n8n para lo que rodea a las incidencias, código para las reglas

- **Decisión:** las **reglas de negocio** (reservas, aforo, qué se inhabilita) viven en código con tests; las
  **automatizaciones alrededor** (avisar, resumir, ingerir documentos) viven en n8n.
- **Por qué n8n ahí:** son flujos de pasos con servicios externos (correo, IA, base vectorial) donde se quiere ver el flujo,
  cambiar un destinatario o agregar un canal sin tocar ni desplegar el backend, y tener reintentos y manejo de errores ya
  resueltos. Un cambio como "avisar también a Seguridad" es arrastrar un nodo.
- **Por qué NO las reglas en n8n:** las reglas tienen que ser probables con tests, versionables en Git y no depender de una
  interfaz. Aquí hay cientos de tests; los flujos de n8n solo se pueden probar con las partes de código que contienen (por eso la
  validación del resumen y la firma son Code nodes que se ejecutan en un test) o a mano.
- **El costo de n8n:** otro servicio que operar, otra herramienta que aprender, JSON exportados difíciles de leer en un
  *diff*, y la lógica queda repartida en dos lugares (la firma está implementada en Express *y* en un Code node; un test
  comprueba que sigan siendo compatibles).
- **Límite real que apareció:** el nodo de embeddings de Gemini de n8n no deja elegir las dimensiones (3072), así que n8n
  usa su propia tabla vectorial y no puede compartir la de `pulse-ai` (768). Ver `docs/workflows.md`.

---

## 5. Preguntas que pueden hacerme y mi respuesta corta

**¿Por qué RAG y no fine-tuning?** Porque el conocimiento cambia, quiero citar fuentes y poder decir "no sé", y no tengo
miles de ejemplos. Fine-tuning sirve para estilo o clasificación a gran escala, no para datos vigentes.

**¿Cómo evitas que la IA invente?** Tres capas: si el mejor fragmento no es relevante, ni se llama al modelo; el prompt
obliga a usar solo los fragmentos; y el código descarta toda respuesta sin una cita válida. Está medido con preguntas
que no tienen respuesta (`docs/evaluacion-rag.md`).

**¿Qué pasa si Gemini o `pulse-ai` se caen?** La app sigue: reservas, préstamos e incidencias funcionan con los
formularios. Solo falla la parte de IA, con un mensaje claro y nunca con una respuesta inventada.

**¿Por qué pgvector y no Qdrant?** Porque ya tengo PostgreSQL, quiero filtrar con SQL por estado y equipo en la misma
consulta, y tengo integridad referencial. Cambiaría a Qdrant con millones de vectores.

**¿Qué es la similitud coseno?** El coseno del ángulo entre dos vectores: 1 si apuntan igual, 0 si no se parecen. Mide
significado, no palabras. En pgvector el operador `<=>` da la distancia coseno y la similitud es `1 - distancia`.

**¿Qué pasa si n8n se cae?** La incidencia se crea igual (el webhook va en segundo plano y falla en silencio). Se pierde la
alerta inmediata de esa incidencia, pero el resumen diario la incluye. Es un límite conocido: no hay cola de reintentos.

**¿Cómo sabes que el webhook es de Campus Pulse y no de un atacante?** Va firmado con HMAC-SHA256 con un secreto compartido
sobre `timestamp.cuerpo`; n8n rechaza una firma incorrecta, un cuerpo alterado y un mensaje de hace más de 5 minutos.

**¿Qué hiciste tú y qué la IA?** Ver `README.md` ("Uso de IA en el desarrollo").
