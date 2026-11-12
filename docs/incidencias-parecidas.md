# Incidencias parecidas (embeddings + pgvector)

Cuando alguien reporta una incidencia, Campus Pulse busca si **ya existe una abierta que sea la
misma** y pregunta *"¿Es la misma?"*. Si la persona confirma, su reporte se suma a la existente en
vez de crear un duplicado.

> Principio de siempre: **la IA sugiere, las reglas deciden, la persona confirma.** La IA solo
> convierte el texto en un vector; quien decide si dos incidencias son "la misma" son las reglas de
> [`src/domain/similares.js`](../src/domain/similares.js), y la última palabra es de la persona.

## Cómo funciona

1. La persona escribe el reporte y la IA hace el triaje, como siempre.
2. Al pulsar **Confirmar**, se genera el **embedding** del texto (un vector de 768 números que
   representa su significado) con `gemini-embedding-001`.
3. PostgreSQL busca con **pgvector** las incidencias abiertas con el vector más cercano (distancia
   coseno, `<=>`; la similitud es `1 - distancia`).
4. Las **reglas** deciden cuáles se sugieren (filtro de lugar y umbral).
5. Si hay candidatas, la interfaz pregunta *"¿Es la misma incidencia?"* con su similitud. La persona
   elige **"Es la misma: sumar mi reporte"** o **"No, es distinta: crear una nueva"**.

```
texto ──► Gemini (embedding 768) ──► pgvector (HNSW, coseno) ──► reglas (lugar + umbral) ──► persona
```

## Por qué estas decisiones

### Un filtro de lugar además del umbral (regla híbrida)

Los embeddings capturan **el tema, no el lugar**. En una medición con el texto base *"El video beam
de Apolo no prende y huele a quemado"*:

| Caso | Similitud |
|---|---|
| **Misma** incidencia, otras palabras (4 casos) | **0.963 – 0.982** |
| Distinta, mismo equipo (borroso, sin control remoto) | 0.883 – 0.901 |
| Distinta, misma sala (aire acondicionado, sillas) | 0.838 – 0.860 |
| **Mismo problema en otra sala** (*"…de Cosmos…"*) | **0.949** |
| Fuera de dominio (*"¿A qué hora abre la cafetería?"*) | 0.634 |

El caso de Cosmos sale **por encima del umbral** aunque *no* es la misma incidencia. Un umbral más
alto no lo arregla sin dejar fuera a las que sí son la misma. Por eso la regla 1 mira el lugar que
identificó el triaje:

- si identificó un **equipo**, solo se comparan incidencias de ese equipo;
- si no, y identificó un **espacio**, solo las de ese espacio;
- si no identificó nada, se compara con todas las abiertas.

### Umbral: 0.93 (provisional)

Está en `UMBRAL_SIMILITUD_INCIDENCIA` de [`src/config/reglas.js`](../src/config/reglas.js). Queda entre
la más alta de las distintas del mismo equipo (0.901) y la más baja de las iguales (0.963). **Es
provisional:** sale de 10 reportes. Falta el notebook que lo justifique con más ejemplos reales
(parecidas, distintas y fuera de dominio), como pide el plan.

### 768 dimensiones

`gemini-embedding-001` devuelve 3072 por defecto, pero un índice HNSW de `vector` **no admite más
de 2000 dimensiones** (se comprobó con pgvector 0.8.7: *"column cannot have more than 2000
dimensions for hnsw index"*). El modelo permite pedir 768, que alcanza para textos cortos y es más
liviano. La alternativa era `halfvec(3072)`, que sí se indexa pero ocupa cuatro veces más.

### Índice HNSW

`incidencias_embeddings_hnsw_idx` (`vector_cosine_ops`): el mismo tipo de índice que se vio con
Qdrant en clase. Con pocas filas PostgreSQL puede preferir recorrer la tabla; el índice se vuelve útil
al crecer. (En pgvector el filtro de lugar se aplica junto a la búsqueda; con muchísimas filas
convendría revisar `hnsw.ef_search`.)

### Sumar el reporte, no duplicar

Cada confirmación guarda **quién, cuándo y qué escribió** en `incidencias_reportes`. La incidencia
muestra *"2 reportes más"*. Es información útil para priorizar. Solo se puede sumar a incidencias
**abiertas**: una resuelta responde `409 INCIDENCIA_YA_RESUELTA`.

## Qué pasa si algo falla

- **Si Gemini no responde** al buscar parecidas, la interfaz crea la incidencia igual, sin la
  sugerencia. Es opcional, como todo lo de la IA en este proyecto.
- **La llamada a Gemini nunca va dentro de una transacción de la base**: retendría el bloqueo de
  escritura y frenaría a todos los demás.
- **El embedding de una incidencia nueva se guarda en segundo plano**, sin hacer esperar la
  respuesta. Si falla, la incidencia queda sin embedding (no se sugerirá como parecida) y
  `npm run embeddings` rellena las que faltan.
- **Peticiones iguales a la vez** (un doble clic) comparten una sola llamada a Gemini.
- **Límite por usuario:** buscar parecidas cuenta como una consulta a la IA (5 por minuto), salvo que
  el embedding del texto ya esté en la caché.
- Los vectores de modelos distintos no se comparan (columna `modelo`): si algún día se cambia de
  modelo, hay que volver a generar los embeddings.

## Cómo se probó

Los tests (`tests/similares.test.js`) **nunca llaman a Gemini**: usan vectores falsos con ángulo
conocido (`cos(10°) = 0.985`, `cos(20°) = 0.940`, `cos(40°) = 0.766`) para controlar la similitud
exacta y comprobar el umbral, el filtro de lugar, los modelos, las incidencias resueltas, los
reportes, el límite de consultas y que, si el servicio cae, la incidencia se crea igual.

Además se verificó **de punta a punta con Gemini real** sobre una base temporal: el embedding de 768
dimensiones se guardó en pgvector, la misma incidencia con otras palabras dio 0.973, y el filtro por
equipo descartó la de otra sala y la de otro problema.

## Pendiente

- **Notebook `notebooks/umbral-similitud.ipynb`** que justifique el umbral con más ejemplos reales.
- Probar la interfaz en un navegador (el flujo "¿es la misma?" se verificó por API y con tests, no
  visualmente).
- Decidir si varios reportes iguales deberían subir la prioridad automáticamente (hoy no: la
  prioridad la deciden el triaje y las reglas).
