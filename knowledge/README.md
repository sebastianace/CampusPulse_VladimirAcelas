# Base de conocimiento de Pulse

Documentos que el asistente Pulse (RAG) usa para responder preguntas con fuentes.

> **Documentos de ejemplo.** Los redactó el autor de Campus Pulse a partir de las reglas reales de la
> aplicación (`src/config/reglas.js`) y de los datos de prueba. **No son un reglamento oficial de
> Campuslands.** Si una regla cambia en `reglas.js`, hay que actualizar el documento (un test avisa).

Cómo se leen: cada archivo `.md` se parte por sus títulos (`#`, `##`, `###`). El título del archivo es el
*documento* y el título de la sección es la *sección* que Pulse cita en sus respuestas. Por eso cada sección
debe poder entenderse sola y empezar con la idea principal.

Cómo cargarlos en la base vectorial (colección `conocimiento`): `npm run conocimiento` (ver README principal).
