# Changelog

Todos los cambios importantes de Campus Pulse se registran en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

## [v2.0.0] — 2026-11-13

Versión final del proyecto del curso Inteligencia Artificial 2. Sobre la `v1.1.1` de la hackatón agrega: roles y seguridad,
PostgreSQL con pgvector, prompts con personalidad, incidencias parecidas con embeddings, preguntas con fuentes (RAG con
LangChain), voz, automatización con n8n, control de la cuota de la IA y la documentación para sustentarlo. Se desarrolló con
un asistente de programación (ver "Uso de IA en el desarrollo" en el README).

### Revisión final y evidencias (Fase 4)

- **Seguridad:** `body-parser` 2.3.0 → 2.4.0 por una vulnerabilidad alta de denegación de servicio (GHSA-27r3-jxmh-p828).
  `npm audit` y `pip-audit` quedan sin vulnerabilidades conocidas.
- **Triaje, prompt 1.3:** la medición pendiente mostró que el few-shot empeoraba (7/12 frente a 9/12) por una política ambigua
  sobre cuándo inhabilitar. Con la política aclarada, 10/12 en los dos modos e "inhabilitar" 12/12; el few-shot quedó
  desactivado porque no mejora y cuesta 420 tokens más por llamada.
- **Matriz de modelos** (`npm run comparar-modelos`, `docs/matriz-modelos.md`): el modelo rápido acertó más, fue el doble de
  rápido y costó de 2 a 4 veces menos que uno que razona. Costo estimado para el campus: entre 13 y 26 USD al mes.
- **Documentación:** README nuevo con arquitectura en Mermaid y capturas; registro de depuración; guía de sustentación con
  plan de estudio; hoja de ruta con piloto, costos y riesgos; decisiones sobre por qué la IA no escribe en la base y por qué
  el no-solapamiento vive en la base.

### Rendimiento y cuota de la IA

- **Más rápida y más barata en llamadas** (medido con Gemini real): pedir sala 3.4 s → 2.5 s (3 → 2 llamadas); pregunta nueva
  4.1 s → 1.5 s (3 → 1 llamada); pregunta repetida 4 s → 0 s. La intención de Ctrl+K la decide el código cuando el mensaje es
  claro (22 de 24 frases de prueba, sin errores) y solo los ambiguos van a Gemini; el reranking del RAG queda apagado por
  defecto (no mejoró la exactitud y cuesta una llamada y ≈ 1.4 s); las preguntas respondidas se guardan 60 minutos.
- **Presupuesto global de llamadas** (la cuota de Gemini es de todo el campus, no por persona): si no alcanza, `429 IA_OCUPADA`
  al instante y sin cobrarle la consulta a la persona; y **modo ahorro** para las recomendaciones de sala. Capacidad por
  minuto: de ≈ 5 a 8 reservas y de ≈ 5 a 12 preguntas nuevas. Ver `docs/capacidad-ia.md`.
- **Interfaz:** botón para cerrar la conversación de Ctrl+K en el celular (donde no hay tecla Esc), cierre al tocar fuera y
  texto de ayuda que ya no se corta.

### Automatización con n8n y webhooks (Fase 3F)

- **n8n 2.47.4 y Mailpit** en `compose.yaml`. Seis flujos exportados en `n8n/`: **incidencia nueva** (webhook firmado con
  HMAC-SHA256 y protección contra repetición, IF por prioridad, Switch por área, subworkflow de notificación, Merge y llamada
  de vuelta), **notificar por correo**, **resumen diario con IA** (JSON validado en un Code node contra los datos reales),
  **Error Workflow**, **ingesta de documentos** (formulario, Document Loader, Embeddings, PGVector) y **agente de
  coordinación** (memoria, PGVector y HTTP como herramientas). `npm run n8n:preparar` los instala.
- **Express:** webhook de incidencias en segundo plano (nunca impide crear una incidencia), rutas `/api/integraciones` con
  autenticación por secreto compartido (`N8N_SECRETO`; apagadas si no está definido) y tabla `incidencias_notificaciones`
  (migración 005). La lista de incidencias muestra *"Avisada: <área>"*.
- Hallazgos documentados en `docs/workflows.md`: el nodo de embeddings de n8n no permite 768 dimensiones (tabla propia de 3072),
  el Error Workflow debe estar activo para atrapar fallas, y si n8n está caído la alerta inmediata se pierde.

### Decisiones documentadas (Fase 3E)

- `docs/decisiones.md`: por qué RAG y no fine-tuning (y cuándo sí usaría fine-tuning), por qué pgvector y no Qdrant ni
  Chroma, y qué aportó y qué no LangChain, con la evidencia del proyecto y lo que no se midió.

### Voz (Fase 3D)

- **Dictado por voz** (Web Speech API) en el reporte de incidencias y en la barra Ctrl+K, y botón **Escuchar** en las
  respuestas de Pulse y en las recomendaciones de salas. Sin soporte del navegador los botones no aparecen y todo sigue
  por texto. Avisos de error en español (permiso denegado, sin micrófono, sin conexión). Lógica pura probada en
  `tests/voz-texto.test.js`.

### Preguntas con fuentes: RAG (Fase 3C)

- **Servicio `pulse-ai`** (Python, FastAPI y LangChain, en `compose.yaml`): ingesta de `knowledge/` con
  `MarkdownHeaderTextSplitter` y `RecursiveCharacterTextSplitter`, embeddings de Gemini en pgvector (tabla
  `conocimiento`, índice HNSW), reformulación con memoria, **reranking** con Gemini y respuesta con citas.
  Si los documentos no tienen la respuesta, dice que no la sabe. Ver `docs/rag.md`.
- **`POST /api/ia/preguntar`** y **`POST /api/ia/asistente`**: la barra Ctrl+K decide si la persona quiere reservar
  una sala o hacer una pregunta, y las respuestas traen *Ver fuentes*. `POST /api/ia/conocimiento/ingestar` (solo
  admin) recarga los documentos. Si `pulse-ai` cae, solo falla esta función.
- **Documentos de ejemplo** en `knowledge/` (reglamento, espacios, préstamos, incidencias, preguntas frecuentes), con
  un test que avisa si una cifra deja de coincidir con `reglas.js`.
- **Evaluación**: 15 preguntas con y sin reranking (`npm run evaluar-rag`, `docs/evaluacion-rag.md`).
- Corregidos durante las pruebas: la reformulación mezclaba temas distintos (2 de 4 intentos), el servicio fallaba al
  reiniciar con la tabla ya creada y un fragmento "Introducción" ensuciaba la búsqueda.

### Incidencias parecidas (Fase 3B)

- Al confirmar un reporte, la app busca incidencias **abiertas parecidas** con embeddings de Gemini
  (`gemini-embedding-001`, 768 dimensiones) guardados en pgvector (índice HNSW, distancia coseno) y
  pregunta *"¿Es la misma incidencia?"*. Si se confirma, el reporte se suma a la existente
  (`POST /api/incidencias/:id/reportes`) en vez de crear un duplicado.
- Regla híbrida: solo se comparan incidencias del mismo equipo o espacio que identificó el triaje y que
  lleguen al umbral de similitud (`UMBRAL_SIMILITUD_INCIDENCIA`, 0.93, provisional). Si el servicio
  falla, la incidencia se crea igual. `npm run embeddings` rellena las que no tienen embedding.
- Ver `docs/incidencias-parecidas.md` (mediciones y decisiones).

### Base de datos

- PostgreSQL con pgvector en `compose.yaml` (`docker compose up -d db`), esquema SQL en
  `db/migrations/` con la restricción `EXCLUDE USING gist` que impide reservas solapadas, ejecutor
  de migraciones (`npm run migrar`) y semilla (`npm run semilla`). Ver `docs/base-de-datos.md`.
- **Espacios, recursos, reservas, préstamos e incidencias pasan de `data/db.json` a PostgreSQL**
  (`src/data/almacen.js` y `src/data/repos/`), sin cambiar las reglas de `src/domain/`. Cada
  escritura es una transacción con bloqueo; las reservas simultáneas a la misma franja dejan una
  sola, y la restricción de la base es la última defensa. Al arrancar, la app aplica las migraciones
  y carga la semilla la primera vez.
- **Cuentas y sesiones pasan de `data/auth.json` a PostgreSQL** (tablas `usuarios` y `sesiones`). El
  registro de la primera cuenta usa una transacción con bloqueo para que dos registros simultáneos no
  creen dos admins, y la clave primaria impide usuarios repetidos. `npm run importar-cuentas` copia
  las cuentas del archivo anterior.
- **Se retira el almacén en archivo** (`src/data/store.js` y `data/db.json`). La lógica que arma el
  estado inicial desde el CSV y las semillas pasa a `src/data/estado-inicial.js`. Los archivos
  `data/db.json` y `data/auth.json` de versiones anteriores ya no se usan y pueden borrarse.
- **La app corre en Docker:** `Dockerfile` y servicio `app` en `compose.yaml`, de modo que
  `docker compose up -d --build` levanta la aplicación y la base. La imagen no incluye `.env` y el
  proceso corre como usuario sin permisos de administrador.
- **Cambio de requisitos:** ahora hace falta PostgreSQL (`docker compose up -d db`) para arrancar la
  app y correr `npm test`.

### IA

- Los prompts salieron del código a `src/ai/prompts/`, uno por archivo, con la plantilla de seis
  secciones vista en clase (rol y objetivo, tono, políticas, límites, procedimiento y entrada).
  Documentados en `docs/biblioteca-prompts.md`.
- Triaje con 4 ejemplos few-shot del campus (`src/ai/prompts/ejemplos-triaje.js`) y script
  `npm run medir-triaje` para compararlo contra la versión sin ejemplos con 12 reportes de prueba
  (`evaluacion/`).
- Personalidad de **Pulse** con el modelo Big Five (`src/ai/prompts/personalidad.js`), aplicada al
  tono del triaje y de la explicación de salas. Justificada en `docs/personalidad.md`.

### Interfaz

- Pestaña **Usuarios** (solo admin): crear profesores y soporte técnico y ver las cuentas
  (`GET` y `POST /api/usuarios`).
- La interfaz oculta según el rol: "Restaurar" (solo admin), "Marcar como resuelta" (admin y
  soporte técnico) y la pestaña Usuarios (solo admin).
- El login oculta "Crear una cuenta" cuando el registro ya está cerrado (`GET /api/auth/estado`).

### Seguridad

- Límite de consultas a la IA por usuario: 5 por minuto → 429 `LIMITE_IA` con `Retry-After` y
  el formulario manual como alternativa en la interfaz.
- Caché de 10 minutos para el triaje de incidencias con texto idéntico (cabecera
  `X-Cache: HIT`), para cuidar la cuota gratis de Gemini.
- Roles `admin`, `profesor` y `soporte_tecnico`. La primera cuenta es `admin`; después el
  registro público se cierra (403 `REGISTRO_CERRADO`) y el admin crea a los profesores y al
  soporte técnico con `POST /api/usuarios`. Middleware `exigirRol(...roles)` que responde 403
  `PERMISO_DENEGADO`.
- Resolver una incidencia (`PATCH /api/incidencias/:id`, que rehabilita espacios y equipos) solo
  lo pueden hacer `admin` y `soporte_tecnico`.
- `POST /api/restaurar` solo lo puede usar un `admin`.
- Límite de intentos de login: 5 fallos del mismo usuario e IP en 15 minutos → 429
  `DEMASIADOS_INTENTOS` con cabecera `Retry-After`.
- La cookie de sesión es `Secure` cuando `NODE_ENV=production`.

## [v1.1.1] — versión de la hackatón

Versión construida en equipo durante la Hackatón de Campuslands (ver "Historia del proyecto" en
el README).

### Incluye

- Mapa de espacios con aforo y estado en tiempo real (disponible, ocupado, inhabilitado o
  inconsistente).
- Reservas de espacios (crear, editar y cancelar) y préstamos de equipos, validados con las
  reglas de negocio de `src/config/reglas.js`.
- Incidencias en lenguaje natural con triaje sugerido por IA (Gemini); la persona confirma y las
  reglas deciden si el espacio o equipo queda inhabilitado.
- Asistente de reservas (Ctrl+K): la IA extrae la solicitud, las reglas filtran las opciones y la
  IA solo redacta la explicación.
- Panel de calidad de datos para los registros inconsistentes de `data/raw/espacios.csv`.
- Inicio de sesión con contraseñas en hash `scrypt`, sesiones en cookie `HttpOnly` y API
  protegida (401 sin sesión).
- Si la IA falla, la API responde 503 y la interfaz ofrece el formulario manual.
- 68 pruebas con `node:test`.
