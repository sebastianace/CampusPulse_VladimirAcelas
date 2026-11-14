# Sustentación de Campus Pulse

Guion de la demo, plan B, preguntas difíciles y plan de estudio. Pensado para una sustentación de 5 a 7 minutos más preguntas.

## 1. La víspera: lista de comprobación

- [ ] `docker compose up -d --build` y `npm run n8n:preparar` sin errores; `docker compose ps` muestra los 5 servicios.
- [ ] `npm test` en verde (y los tests de Python de `pulse-ai`).
- [ ] Botón **Restaurar** (admin) para empezar con los datos iniciales; Mailpit vacío (<http://localhost:8025>).
- [ ] Una cuenta de **profesor** creada para mostrar los permisos.
- [ ] Probar una vez cada paso del guion: la cuota de Gemini se recupera en un minuto; **no ensayar justo antes** de presentar.
- [ ] Capturas o un video corto de respaldo por si falla internet (ver plan B).
- [ ] `src/config/reglas.js` abierto en el editor para el cambio de regla en vivo.

## 2. Guion de la demo (6 minutos)

| Min. | Qué muestro | Qué digo (idea, no texto de memoria) |
|---|---|---|
| 0:00 | Portada del README | **Problema:** reservas en hojas sueltas, incidencias por WhatsApp, nadie sabe qué sala está libre ni qué está dañado. **Solución:** un tablero en vivo con reglas claras y una IA que ayuda, pero no decide. |
| 0:40 | Mapa del campus | Los colores salen de las reglas: libre, ocupada, inhabilitada. Datos oficiales del CSV con su reporte de calidad. |
| 1:10 | Reservar Skilab para 40 personas | **Rechazada por la regla de aforo** (20 puestos). Luego dos reservas que se cruzan: la base de datos también lo impide. |
| 1:50 | Reportar "El video beam de Apolo no prende y huele a quemado" | **Triaje con IA:** sugiere categoría, prioridad crítica, área y equipo, y explica por qué. **Yo confirmo**: la IA no guarda nada sola. Apolo se pone en rojo. |
| 2:40 | Reportar "El proyector de Apolo no enciende, sale olor a quemado" | **Embeddings:** "¿Es la misma incidencia?" con ~97 % de parecido. Sumo el reporte en vez de duplicar. |
| 3:10 | Mailpit | **n8n:** llegó el correo a Soporte TI (webhook firmado → Switch por área → subworkflow). En la lista: "Avisada: Soporte TI". |
| 3:40 | Ctrl+K: "¿Cuántas horas puedo reservar una sala?" | **RAG:** responde y muestra **Ver fuentes** (documento y sección). |
| 4:10 | Ctrl+K: "¿Cuánto cuesta el almuerzo?" | **Dice que no sabe** en vez de inventar, y sugiere a quién preguntar. |
| 4:30 | Ctrl+K: "Necesito un salón para 30 personas el martes de 2 a 4 pm" | Entiende la intención y los datos; **las reglas** eligen las salas; la IA solo explica. Botón Escuchar (voz). |
| 5:10 | Cambio de regla en vivo: `MAX_HORAS_RESERVA` de 4 a 3 en `reglas.js` | Guardo, el servidor se reinicia y una reserva de 4 horas ya se rechaza. **Bonus honesto:** `npm test` avisa que el documento del reglamento quedó desactualizado: así el RAG no responde algo viejo. |
| 5:50 | Cierre | Lo que aprendí: la IA es útil si está rodeada de reglas, validaciones y un humano que confirma. |

## 3. Plan B (si algo falla en vivo)

| Falla | Qué hago |
|---|---|
| Sin internet o Gemini caído | La app sigue: muestro el **formulario manual** de reservas e incidencias. "Esto es justo lo que diseñé: la IA es opcional." Luego el video o las capturas de la parte de IA. |
| "La IA está atendiendo a muchas personas" | Es el presupuesto de la capa gratis (`docs/capacidad-ia.md`). Lo explico y espero 60 s, o sigo con el formulario. |
| n8n no envía el correo | Muestro la ejecución en <http://localhost:5678> (Executions) y el correo de la prueba anterior. |
| Docker no arranca | `open -a Docker`, esperar a que diga "Docker listo" y `docker compose up -d`. |

## 4. Preguntas difíciles (respuestas cortas)

Las de RAG, fine-tuning, pgvector, n8n y reservas simultáneas están en `docs/decisiones.md`, sección 7. Además:

- **¿Qué es la similitud coseno y por qué 0.93?** El coseno del ángulo entre dos vectores: cerca de 1, mismo significado. El 0.93
  quedó entre la más alta de las distintas del mismo equipo (0.90) y la más baja de las iguales (0.96) en una medición de 10
  reportes; es **provisional** y lo digo así (`docs/incidencias-parecidas.md`).
- **¿Por qué además del umbral filtras por lugar?** Porque los embeddings capturan el tema, no el lugar: "el video beam de
  Cosmos huele a quemado" sacó 0.949 contra Apolo sin ser la misma incidencia.
- **¿Cómo cuidas la seguridad?** Claves con scrypt, sesión en cookie HttpOnly (Secure en producción), límite de intentos de
  login, roles con 403 en el servidor (no solo ocultar botones), webhook firmado con HMAC y protección contra repetición,
  ninguna clave en el repositorio.
- **¿Qué pasa con 30 profesores a la vez?** La capa gratis da 15 llamadas por minuto para todos. Con las mejoras se atienden
  8 reservas con IA por minuto; el resto recibe un aviso al instante y usa el formulario, que no tiene límite. Para más,
  plan de pago (`docs/capacidad-ia.md`).
- **¿Qué hiciste tú y qué hizo la IA?** v1: en equipo en la hackatón, yo lideré. v2: con un asistente de programación; en la
  Fase 3 le pedí el código completo para cumplir el plazo y lo integré por pull request. Lo digo tal cual: está en el README.
  Las decisiones de producto, el alcance y la revisión son míos.
- **¿Qué cambiarías si tuvieras más tiempo?** Ver `docs/hoja-de-ruta.md`.

## 5. Plan de estudio: lo que tienes que poder explicar

Para cada pieza: **lee el archivo, explica el flujo en voz alta sin mirar y haz el ejercicio**. Si el ejercicio sale, la
dominas.

| Pieza | Archivos | Debes poder explicar | Ejercicio para practicar |
|---|---|---|---|
| Reglas de reservas | `src/config/reglas.js`, `src/domain/reservas.js` | Cada regla y por qué el solapamiento también está en la base | Cambiar `MAX_RESERVAS_POR_PERSONA_DIA` a 2 y ver qué tests fallan |
| Triaje | `src/ai/triaje.js`, `src/ai/prompts/triaje.js`, `src/ai/validar.js` | Las 6 secciones del prompt, el few-shot y por qué se valida la salida | Agregar un quinto ejemplo few-shot y correr `npm test` |
| Embeddings | `src/ai/similares.js`, `src/domain/similares.js` | Vector, coseno, umbral y filtro de lugar | Bajar el umbral a 0.85 y ver qué incidencias se proponen como "la misma" |
| RAG | `pulse-ai/app/rag.py`, `fragmentos.py`, `almacen.py`, `prompts.py` | Partir → embeber → buscar → (reordenar) → responder con citas; las 3 capas contra inventar | Agregar un documento a `knowledge/`, `npm run conocimiento` y preguntarle algo de él |
| Memoria del RAG | `pulse-ai/app/llm.py` (`reformular`) | Por qué el modelo decide `depende_del_historial` antes de reescribir | Hacer en Ctrl+K una pregunta, un seguimiento y una de otro tema |
| Intención y cuota | `src/ai/intencion.js`, `src/ai/limite.js`, `src/routes/ia.js` | Reglas antes que IA, presupuesto global, modo ahorro | Escribir 5 frases y predecir si van a reglas o a la IA; comprobar con `intencionPorReglas` |
| n8n | `n8n/*.json`, `src/integraciones/n8n.js`, `src/routes/integraciones.js` | Firma HMAC, Switch, subworkflow, Merge, Error Workflow | Abrir el flujo en el editor de n8n y cambiar el destinatario de un área |
| Voz | `public/js/voz.js`, `public/js/voz-texto.js` | STT y TTS del navegador, qué pasa si no hay soporte | Dictar un reporte en Chrome y escucharlo |

Orden sugerido (una sesión por fila, de arriba abajo). Las primeras tres son de las Fases 1 y 2, que ya conoces; desde el RAG
en adelante es lo que más conviene estudiar.
