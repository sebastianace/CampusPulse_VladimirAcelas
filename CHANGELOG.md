# Changelog

Todos los cambios importantes de Campus Pulse se registran en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Cambiado (pedidos de Campuslands, 21 nov 2026)
- **Nuevo diseño del inicio de sesión.** Sigue la estética de Campuslands (cielo oscuro, brillo morado, dos tarjetas)
  con un cielo vivo: estrellas en tres capas que se desplazan a distinta velocidad y titilan (canvas 2D), estrellas
  fugaces, y donas y esferas 3D lisas y brillantes, con degradé iridiscente azul, violeta, blanco y rosa. Los objetos se
  dibujan con WebGL directo, sin librerías (`public/js/acceso/cristal.js`): la luz se calcula píxel por píxel (difusa,
  destello y borde claro), por eso no se ven facetas. Las mallas y las rotaciones están en
  `public/js/acceso/geometria.js`, con tests. El mouse inclina la escena; con "reducir movimiento" se dibuja un solo
  cuadro quieto y la animación se detiene con la pestaña oculta. Si el script o WebGL fallan, el login funciona igual
  (con estrellas, o con estrellas fijas de CSS). Se quitó la línea amarilla "Campus Bucaramanga". Tarjetas de vidrio que
  brillan al escribir, botón **Mostrar / Ocultar** contraseña y aviso de **Bloq Mayús**.
- **Importar el inventario real desde un CSV de Excel.** `npm run importar-inventario -- archivo.csv`: ensayo por
  defecto (qué equipos entran, cuáles cambian y los errores con su línea del archivo) y `--aplicar` para guardar;
  `--quitar-ficticios` quita los 12 equipos de demostración, salvo los que ya tienen incidencias. Todo o nada, el código
  de inventario (`id`) es la clave (volver a importar no duplica) y el estado de un equipo que ya existe no se pisa.
  Lee el CSV como lo guarda Excel en español (`;`, Windows-1252, BOM) y reconoce columnas como "Código", "Equipo" o
  "Ubicación". Plantilla en `data/plantillas/inventario.csv`; los datos reales van en `data/privado/` (ignorada por git).
  Guía y riesgos (el catálogo completo entra en cada prompt del triaje) en `docs/inventario-importar.md`.
- **Reparto automático de incidencias al técnico de su categoría.** Un admin define en Usuarios quién atiende
  infraestructura y quién tecnología (tabla `responsables_categoria`, migración 015); cada incidencia nueva nace asignada
  (`asignadaA`) a esa persona y le llega un correo. Las abiertas sin dueño pasan a él al configurarlo (un solo correo).
  Asignar no es atender: otro técnico puede tomarla y un admin puede reasignarla (`POST /api/incidencias/:id/asignar`).
  Sin responsable configurado, queda sin asignar. El panel de Soporte TI muestra "Te tocó a ti" y "N para ti". Las listas
  ya no se redibujan mientras está abierto el selector de reasignar.
- **Solo dos categorías de incidencia: Infraestructura y Tecnología.** En el campus hay 2 técnicos de TI y cada uno
  atiende una. Aseo, seguridad, bienestar y "otro" ya no se pueden elegir (`POST /api/incidencias` responde 422), pero
  las incidencias anteriores conservan su categoría (`CATEGORIAS_ANTERIORES`; la base las sigue aceptando).
- **"Esto no es para Soporte TI".** El triaje (prompt 1.5) decide primero `paraTI`: si el reporte es de aseo,
  seguridad, bienestar o convivencia, la categoría queda vacía y la pantalla dice que hay que avisarle a Coordinación
  (`REGLAS.CONTACTO_FUERA_DE_TI`). La persona puede elegir la categoría a mano si cree que sí es para TI. Medido con
  Gemini: los 4 reportes que no son de TI se detectan en los 12 casos de prueba (ver `docs/biblioteca-prompts.md`).

### Corregido (revisión general antes de la reunión)
- **Aprobar una solicitud de salón ya no borra una reserva de otra sala.** Si el dueño había movido su reserva a otra
  sala mientras la solicitud esperaba, aprobarla se la cancelaba igual (solo se comparaban las horas). Ahora solo se le
  quita la franja si sigue en el salón pedido, y en ese caso no le llega el correo de "tu reserva se canceló".
- **Los mismos nombres de sala en todas partes.** La IA, los documentos del RAG, los correos y los mensajes de error
  decían Spooki, Skilab y Amarillas verdes, y el tablero decía Sputnik, Skylabs y Sala de reuniones. La traducción vive en
  un solo lugar (`src/config/nombres.js`): el repositorio de espacios entrega el nombre del campus y conserva el del CSV
  oficial en `nombreOficial` (el CSV no se toca). Migración `013_nombres_en_campus.sql` (el televisor de Skylabs).
- Un error en Pulse (por ejemplo, el límite de consultas) ya no borra la conversación de la pantalla: aparece debajo.
- Hacer clic en el plano o en la línea de tiempo mientras se edita una reserva ya no la mueve: sale de la edición y
  empieza una reserva nueva (lo avisa con un toast). El Modo demo también sale de la edición antes de llenar.
- Una sala cerrada a mano desde Inventario sigue cerrada al resolver una incidencia de esa sala.
- Si el dueño cancela una reserva que alguien pidió, la solicitud se cierra sola ("el salón quedó libre") en vez de
  quedar pendiente para siempre, y a quien la pidió le llega un correo.
- La documentación de espacios aclara que no tiene el estado en vivo de los equipos (Pulse respondía "computadores
  funcionales" con los puestos de la sala) y dice cómo se llama cada sala en el archivo oficial.
- Detalles: el mapa ya no menciona la pestaña Datos; una cuenta nueva aparece enseguida en las sugerencias de
  responsable; "la está atendiendo" dice el nombre y no el usuario; en el celular, una contraseña temporal lleva al
  tablero para cambiarla y no aparece "0 salas en servicio"; si el tablero queda abierto pasada la medianoche, la línea
  de tiempo pasa al día nuevo.

### Agregado
- **Aviso por correo cuando una sala queda fuera de servicio** (por una incidencia o desde Inventario): a cada dueño de
  una reserva de esa sala que todavía no termina, para que busque otra.
- **Avisos por correo** de lo que cambia en una reserva: a quien tiene la reserva cuando se la piden, a los admins
  cuando llega una solicitud, a quien la pidió cuando se aprueba o rechaza, a quien la tenía cuando se aprueba (cómo
  quedó su reserva o que se canceló) y al dueño cuando un admin le edita o cancela una reserva. Campus Pulse decide a
  quién y qué (`src/domain/avisos.js`) y n8n lo entrega con el flujo nuevo **Aviso de cambio en una reserva**
  (`pulseAvisoReserva`, webhook firmado). Cada cuenta tiene un **correo opcional** (al crearla o con "Agregar correo"
  en Usuarios; `PATCH /api/usuarios/:usuario`, migración `012_correo.sql`). Un correo que falla nunca deshace el cambio.
- **Tiempo de respuesta de TI** en el panel Soporte TI (admin y soporte técnico): cuánto tarda TI en tomar una
  incidencia y en resolverla en los últimos 7 días, en total y por prioridad, más la incidencia que más lleva esperando
  sin que nadie la tome. Usa la mediana (una incidencia olvidada no dispara el número) y muestra el promedio como
  referencia. Se calcula con las fechas que ya se guardaban, sin migración: `GET /api/incidencias/indicadores`
  (`src/domain/indicadores.js`).
- **Cuentas:** cada cuenta guarda qué admin la creó (la lista de Usuarios lo muestra, con la fecha) y un admin puede
  crear otros admins. **Contraseñas:** un admin da una contraseña temporal a quien olvidó la suya (se muestra una vez,
  cierra sus sesiones y obliga a cambiarla al entrar), botón **Contraseña** para cambiar la propia y
  `npm run restablecer-admin` para cuando el único admin la olvidó. Migración `009_cuentas.sql`.
- El responsable de una reserva sugiere los nombres de las cuentas reales (`GET /api/usuarios/nombres`) y por defecto es
  quien inició sesión, en vez de una lista de nombres escrita a mano en el HTML.
- Panel **Soporte TI** (soporte técnico y admin): todo daño reportado llega ahí, de la incidencia más urgente a la menos
  (y dentro de cada prioridad, primero las que nadie ha tomado y las más viejas), con cuánto llevan esperando, un resumen
  del inventario fuera de servicio y un aviso en la app cuando llega una nueva. Es la pestaña con la que abre la app para
  soporte técnico. Botón **Atender**: la incidencia queda "en atención" a nombre de quien la tomó
  (`POST /api/incidencias/:id/atender`, migración `008_atencion_incidencias.sql`).
- **Solicitudes de salón:** si el salón que alguien necesita ya está reservado, lo pide a un admin, que aprueba o
  rechaza en la pestaña **Solicitudes** (contador y avisos en la app, ya no por correo a TI). Sirve para una reserva en
  curso (nadie llegó: al aprobar, la original termina en ese momento) y para una futura (al aprobar, la original
  conserva lo que le sobre antes o después de la franja pedida, o se cancela si la cubría entera). Se pide con
  "Solicitar este salón" en la lista de reservas o con "Pedirle el salón a un admin" en el aviso de "ya está
  reservado", que llena la solicitud con lo que se intentó reservar. Todo en la misma transacción. Migraciones
  `007_solicitudes_salon.sql` y `011_solicitud_franja.sql`; rutas `GET`, `POST` y `PATCH /api/solicitudes`.
- Las reservas guardan quién las creó (`creadaPor`) y solo esa persona o un admin las edita o cancela.
- Pestaña **Inventario** (admin y soporte técnico): la lista de trabajo de TI. Muestra solo los equipos **dañados o en
  reparación**, primero los dañados, y deja enviarlos a reparación o marcarlos disponibles (`PATCH /api/recursos/:id`);
  al quedar disponible, el equipo sale de la lista. Las salas no aparecen: una sala se inhabilita y se rehabilita con su
  incidencia. Lo que una incidencia abierta tiene fuera de servicio no se cambia a mano (se resuelve la incidencia).
  `GET /api/recursos` trae `cambiosPermitidos`, así los botones salen de `TRANSICIONES_RECURSO`.

### Quitado
- **Las mesas de ping-pong ya no se reservan.** En el campus no se reservan: están en Hunters, una zona común. En su
  lugar aparece **Zona Hunters** como espacio afectado al reportar un daño, pero no se reserva: es de tipo
  `zona_comun` (`REGLAS.TIPOS_NO_RESERVABLES`, que reemplaza a `TIPOS_FUERA_DE_RECOMENDACION`), `POST /api/reservas`
  responde `409 ESPACIO_NO_RESERVABLE` y no sale en el mapa de reservas, la línea de tiempo, el formulario ni las
  recomendaciones. `GET /api/espacios` trae `reservable`. Migración `014_zona_hunters.sql`: crea Hunters, le pasa las
  incidencias que tenían las mesas y borra las mesas con sus reservas.
- **Préstamos de equipos:** en el campus no se prestan equipos. Sale la pestaña **Prestar**, las rutas `/api/prestamos`,
  las reglas de préstamo (`MAX_PRESTAMOS_POR_PERSONA`) y el estado "prestado" de los equipos. La migración
  `010_sin_prestamos.sql` cierra los préstamos activos, devuelve a disponible lo que figuraba prestado y quita "prestado"
  del `CHECK`; la tabla `prestamos` se queda como historial. La base de conocimiento ahora dice que el campus no presta
  equipos, y las preguntas 5 y 11 de la evaluación del RAG cambian en consecuencia (hay que volver a correr
  `npm run evaluar-rag` para actualizar `docs/evaluacion-rag.md`).
- La pestaña **Datos** y el botón "Restaurar". La validación del CSV oficial sigue igual (la sala inválida queda en gris
  en el plano) y el reporte sigue en `GET /api/calidad-datos`. Restaurar los datos iniciales
  pasa a la terminal: `npm run restaurar` (sin borrar cuentas). Se quita `POST /api/restaurar`.

### Cambiado
- **Pantalla de inicio de sesión nueva**, con el estilo de la de Campuslands (cielo oscuro, brillo morado, dos tarjetas
  y botones morados, sin usar su logo ni sus imágenes): a la derecha "Inicia sesión" (primero en el celular) y a la
  izquierda qué es Campus Pulse; mientras no hay cuentas, ahí se crea la primera (admin).
- **Mapa del ala este** como la usa el campus: Clonai (dos mesas largas), las Cabinas y solo dos salas amarillas en la
  franja bajo Hunters; sin el balcón de condensadores. El **Salón Morado** es privado (no se reserva, nadie entra a
  pasear) y ahí está Diego Tarazona con su equipo. El espacio oficial de 6 puestos ("Amarillas verdes") ahora es la
  **Sala de reuniones** (la antigua sala de juntas), que se reserva.
- El almacén escribe primero todos los `DELETE` (de hijos a padres) y luego, tabla por tabla, los `UPDATE` y después los
  `INSERT` (antes, los `INSERT` primero y los `DELETE` al final): así cortar o cancelar una reserva y crear la que la
  reemplaza no choca con la restricción `EXCLUDE`.
- **Toda incidencia va a Soporte TI** (`REGLAS.AREA_RESPONSABLE`): en el campus, TI es el único equipo que resuelve los
  problemas técnicos y de infraestructura. El campo "Área responsable" sale del formulario, la IA ya no lo decide (prompt
  de triaje 1.4) y el flujo de n8n deja el Switch por área y avisa directo a Soporte TI. Las incidencias y los avisos
  anteriores conservan el área con la que se registraron.
- Un equipo dañado puede volver directo a disponible y uno disponible se puede marcar dañado (`TRANSICIONES_RECURSO`).
- Semilla más realista: todos los equipos empiezan disponibles salvo el Portátil HP 03 (dañado), que usa el Modo demo.

### Corregido
- En el celular, el botón "Modo demo" (fijo abajo) tapaba los últimos botones de la página y su transparencia mezclaba
  los textos: ahora es opaco y la página deja espacio al final.
- Ícono de Campus Pulse en la pestaña del navegador (`public/favicon.svg`); antes el navegador pedía `/favicon.ico` y
  recibía 404.
- `npm run n8n:preparar` copia los flujos al contenedor con `docker compose cp` y comprueba cuántos importó. Antes los
  leía del volumen `./n8n:/workflows`, que en macOS puede aparecer vacío: n8n se quedaba con los flujos viejos sin avisar
  (por ejemplo, con el Switch por área que ya se había quitado).
- Una incidencia de un equipo ya no deja fuera de servicio toda la sala. Se inhabilita **lo más específico**: el equipo si
  lo hay; la sala completa solo si se elige "Toda la sala" (`inhabilitarEspacio: true`) o si no hay equipo. Al resolverla
  se rehabilita exactamente lo que se apagó. El formulario cambia la casilla por tres opciones: "Nada", "Solo el equipo"
  y "Toda la sala". La migración `006_inhabilito_espacio.sql` agrega la columna `inhabilito_espacio` y conserva el
  comportamiento de las incidencias que ya existían.

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
