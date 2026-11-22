# Contrato de la API — Campus Pulse

Este contrato no se cambia sin avisar al equipo. Con él, P3 construye la interfaz y P2 la IA
sin esperar a que P1 termine.

## Rutas

| Método y ruta | Cuerpo que recibe | Respuesta OK | Dueño |
|---|---|---|---|
| `GET /api/espacios` | — | `[{id, nombre, nombreOficial, tipo, aforo, estado, ocupadoAhora, computadores}]`. `nombre` es el del campus (Sputnik, Skylabs, Sala de reuniones); `nombreOficial`, el del CSV (`src/config/nombres.js`) | P1 |
| `GET /api/recursos` | — | `[{id, nombre, tipo, espacioId, estado, cambiosPermitidos}]` (`cambiosPermitidos`: estados a los que Inventario lo puede pasar, según `TRANSICIONES_RECURSO`) | P1 |
| `PATCH /api/recursos/:id` | `{estado}` | `200` + el recurso. Inventario: respeta `TRANSICIONES_RECURSO` (`422` si el estado no existe; `prestado` ya no existe); `409 INCIDENCIA_ABIERTA` si una incidencia abierta lo tiene fuera de servicio. Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `PATCH /api/espacios/:id` | `{estado: "disponible" \| "inhabilitado"}` | `200` + el espacio. La interfaz ya no lo ofrece (Inventario solo lista equipos; una sala se inhabilita con su incidencia). `409 INCIDENCIA_ABIERTA` si una incidencia abierta la inhabilitó; `409 ESPACIO_INCONSISTENTE` si su dato del CSV es inconsistente. Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `GET /api/reservas?fecha=YYYY-MM-DD` | — | `[{id, espacioId, responsable, asistentes, inicio, fin, creadaPor}]` (`creadaPor`: usuario que la creó; `null` en las anteriores a la migración 007) | P1 |
| `POST /api/reservas` | `{espacioId, responsable, asistentes, inicio, fin}` | `201` + la reserva (`creadaPor` = el usuario con sesión) | P1 |
| `PATCH /api/reservas/:id` | Los campos a cambiar de `{espacioId, responsable, asistentes, inicio, fin}` | `200` + la reserva editada (vuelve a pasar por todas las reglas). Solo quien la creó o un `admin`; otra persona → `403` | P1 |
| `DELETE /api/reservas/:id` | — | `200` + la reserva cancelada. Solo quien la creó o un `admin`; otra persona → `403`. Sus solicitudes pendientes quedan rechazadas ("el salón quedó libre") y a quien las pidió le llega un correo | P1 |
| `GET /api/solicitudes` | — | `[{id, reservaId, espacioId, solicitante, afectado, responsable, asistentes, inicio, fin, motivo, estado, fecha, decididaPor?, fechaDecision?, notaDecision?, reservaNuevaId?, reservaOriginal}]`. El `admin` ve todas; los demás, las que pidieron y las que tocan su reserva (`afectado`) | P1 |
| `POST /api/solicitudes` | `{reservaId, responsable, asistentes, inicio?, fin, motivo}` (`inicio` solo si la reserva es futura; en curso, la nueva empieza al aprobar y `inicio` queda `null`) | `201` + la solicitud `pendiente`. `409 RESERVA_TERMINADA`, `ES_TU_RESERVA`, `FRANJA_LIBRE` (la franja no toca esa reserva: se reserva normal), `CHOCA_CON_OTRA_RESERVA`, `SOLICITUD_REPETIDA`, o el error de la regla de reservas que violaría al aprobarla | P1 |
| `PATCH /api/solicitudes/:id` | `{decision: "aprobar" \| "rechazar", nota?}` | `200` + la solicitud. Aprobar le quita a la reserva original la franja pedida y crea la nueva en la misma transacción (en curso: la original termina en ese momento; futura: conserva lo que le sobre antes o después, o se cancela si la franja la cubre entera). `409 SOLICITUD_VENCIDA` si la franja ya pasó; las otras pendientes de esa reserva quedan rechazadas. `409 SOLICITUD_YA_DECIDIDA`. Solo `admin`; otro rol → `403` | P1 |
| `GET /api/incidencias` | — | `[{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia, reportesAdicionales, notificaciones: [{canal, area, enviado}]}]` (`reportesAdicionales`: personas que confirmaron que era la misma). Si está en atención trae también `atendidaPor`, `fechaAtencion` y `atendidaPorNombre` | P1 |
| `GET /api/incidencias/indicadores` | — | Tiempo de respuesta de TI: `{ventanaDias, desde, ventana: {reportadas, resueltas, atencion, resolucion}, porPrioridad: [{prioridad, reportadas, atencion, resolucion}], historico, abiertas, sinAtender, masAntiguaSinAtender}`; `atencion` y `resolucion` son `{casos, medianaMin, promedioMin}`. Atención = del reporte a "en atención" (o a la resolución, si la resolvieron sin tomarla). Ventana: lo reportado en los últimos 7 días. Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `POST /api/incidencias/:id/reportes` | `{descripcion}` | `201 {reporte: {id, incidenciaId, descripcion, reportadoPor, fecha}, totalReportes}`. Suma el reporte a una incidencia abierta; `404` si no existe, `409 INCIDENCIA_YA_RESUELTA` si ya se resolvió | P1 |
| `GET /api/incidencias/:id/reportes` | — | `[{id, incidenciaId, descripcion, reportadoPor, fecha}]` | P1 |
| `POST /api/incidencias` | `{descripcion, categoria, prioridad, espacioId, recursoId, inhabilitar, inhabilitarEspacio, origen, ia}` | `201` + la incidencia con `area`, `inhabilito` e `inhabilitoEspacio`. El área siempre es `REGLAS.AREA_RESPONSABLE` (`Soporte TI`): no se envía y, si llega otra, se ignora. Se inhabilita lo más específico: el equipo si lo hay; la sala solo con `inhabilitarEspacio: true` (opcional) o si no hay equipo | P1 |
| `POST /api/incidencias/:id/atender` | — | `200` + la incidencia con `atendidaPor` y `fechaAtencion` ("en atención"; sigue `abierta`). `409 INCIDENCIA_EN_ATENCION` si ya la atiende otra persona; `409 INCIDENCIA_YA_RESUELTA`. Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `PATCH /api/incidencias/:id` | `{estado: "resuelta"}` | `200` (rehabilita exactamente lo que la incidencia dejó fuera de servicio). Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `GET /api/calidad-datos` | — | `{cargados, validos, inconsistentes: [{fila, motivo}]}` | P1 |
| `POST /api/auth/registro` | `{usuario, nombre, clave}` | `201 {usuario, nombre, rol}` y abre sesión (cookie). Solo crea la primera cuenta (`admin`); después `403 REGISTRO_CERRADO` | P2 |
| `GET /api/auth/estado` | — | `200 {registroAbierto}`; es público. El login lo usa para mostrar "Crea la primera cuenta" solo mientras no exista ninguna | P2 |
| `GET /api/usuarios` | — | `200 [{usuario, nombre, rol, creado, creadoPor, creadoPorNombre, debeCambiarClave}]` (nunca trae las claves). `creadoPor: null` = la primera cuenta o una anterior a la migración 009. Solo `admin` | P2 |
| `POST /api/usuarios` | `{usuario, nombre, clave, correo?, rol: "admin" \| "profesor" \| "soporte_tecnico"}` | `201 {usuario, nombre, rol}`. Solo `admin`; no abre sesión. Guarda qué admin la creó | P2 |
| `GET /api/usuarios/nombres` | — | `200 [{usuario, nombre}]`. Cualquier sesión: sugerencias para el responsable de una reserva | P2 |
| `PATCH /api/usuarios/:usuario` | `{correo}` (`""` lo quita) | `200 {usuario, correo}`: el correo al que le llegan los avisos de sus reservas y solicitudes (n8n). `422` si no tiene formato de correo; `404` si la cuenta no existe. Solo `admin` | P1 |
| `POST /api/usuarios/:usuario/clave` | — | `200 {usuario, claveTemporal}`: contraseña temporal para quien olvidó la suya; cierra sus sesiones y la obliga a cambiarla. `409 USA_CAMBIAR_CLAVE` para la propia. Solo `admin` | P2 |
| `POST /api/auth/clave` | `{claveActual, claveNueva}` | `200`: "Cambiar mi contraseña". Cierra las demás sesiones. `401` si la actual no es correcta; `422` si la nueva tiene menos de 8 caracteres | P2 |
| `POST /api/auth/login` | `{usuario, clave}` | `200 {usuario, nombre, rol}` y abre sesión (cookie) | P2 |
| `POST /api/auth/logout` | — | `200` y cierra la sesión | P2 |
| `GET /api/auth/yo` | — | `200 {usuario, nombre, rol, debeCambiarClave?}` o `401` (`debeCambiarClave: true` si la contraseña es temporal) | P2 |
| `POST /api/ia/triaje` | `{descripcion}` | `{paraTI, categoria, prioridad, espacioId, recursoId, inhabilitar, razon, aviso, modelo}` (el área no la decide la IA; si `paraTI` es `false`, `categoria` es `null` y `aviso` dice a quién acudir) | P2 |
| `POST /api/ia/similares` | `{descripcion, espacioId?, recursoId?}` | `{candidatas: [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, fecha, similitud, reportesAdicionales}], umbral, modelo}`. Incidencias **abiertas** parecidas, de la más a la menos parecida. `503` si el servicio de embeddings falla | P2 |
| `POST /api/ia/recomendar` | `{texto}` | `{solicitud: {asistentes, inicio, fin, necesitaComputadores}, opciones: [{espacioId, motivo}], explicacion, modelo}` | P2 |
| `POST /api/ia/preguntar` | `{pregunta, historial?: [{rol: "usuario" \| "pulse", texto}]}` | `{respondido, respuesta, areaSugerida, fragmentos: [{documento, seccion, archivo, texto, similitud, puntaje, usado, ejemplo}], consulta, reranking, modelo}`. Responde con los documentos de `knowledge/` (RAG en `pulse-ai`) y marca en `fragmentos` cuáles usó. Si no están en los documentos, `respondido: false` y no inventa. `503` si `pulse-ai` o Gemini fallan; `422` si el historial es inválido | P2 |
| `POST /api/ia/asistente` | `{texto, historial?}` | La barra Ctrl+K. La IA decide la intención: `{intencion: "reservar", solicitud, opciones, explicacion, modelo}` (igual que `/recomendar`) o `{intencion: "preguntar", ...}` (igual que `/preguntar`). Gasta un solo cupo de IA | P2 |
| `POST /api/ia/conocimiento/ingestar` | — | `200 {documentos, fragmentos, retirados}`. Vuelve a cargar `knowledge/` en la base vectorial. Solo `admin`; otro rol → `403` | P2 |
| `GET /api/integraciones/incidencias?fecha=hoy\|YYYY-MM-DD&estado=abierta\|resuelta\|todas` | — | `[{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, fecha, reportesAdicionales}]`, sin datos personales. **No usa sesión**: se autentica con el secreto `N8N_SECRETO` en la cabecera `x-pulse-token` (si no coincide, `401 SECRETO_INVALIDO`; sin `N8N_SECRETO` configurado, `503 INTEGRACION_NO_CONFIGURADA`). Lo llama n8n | P2 |
| `POST /api/integraciones/incidencias/:id/notificada` | `{canal: "correo" \| "telegram", destinatario, area}` | `201 {registrada: true}`, o `200 {registrada: false}` si ese aviso ya estaba registrado (n8n reintenta). Mismo secreto en `x-pulse-token`. `404` si la incidencia no existe | P2 |

Además de los 9 espacios del CSV oficial, `GET /api/espacios` incluye las mesas de ping-pong de
Hunters (`ping-pong-1`, `ping-pong-2`, tipo `mesa_juego`, aforo 4) desde `data/seed/espacios-extra.json`.
Se reservan con `POST /api/reservas` como cualquier sala, pero la IA no las recomienda.

## Errores

Todas las rutas responden errores así: `{error: {codigo, mensaje}}`, con el mensaje en español
listo para mostrar en un toast.

| HTTP | Cuándo |
|---|---|
| 422 | Datos mal formados |
| 409 | Regla de negocio violada (`ReglaNegocioError`) |
| 404 | ID que no existe |
| 401 | Sin sesión (`SESION_REQUERIDA`) o usuario/contraseña incorrectos (`CREDENCIALES_INVALIDAS`). Todas las rutas salvo `/api/auth/*` exigen sesión |
| 403 | Hay sesión, pero el rol no tiene permiso (`PERMISO_DENEGADO`), o la contraseña es temporal y hay que cambiarla primero (`CAMBIO_DE_CLAVE_REQUERIDO`) |
| 429 | Demasiados intentos de login fallidos (`DEMASIADOS_INTENTOS`): 5 del mismo usuario e IP en 15 minutos. Trae la cabecera `Retry-After` en segundos |
| 429 | Demasiadas consultas a la IA (`LIMITE_IA`): 5 por usuario por minuto entre `/api/ia/triaje` y `/api/ia/recomendar`. Trae `Retry-After` y el mensaje sugiere el formulario manual |
| 503 | La IA no responde (`codigo: "IA_NO_DISPONIBLE"`) |

## Límite y caché de la IA

- **Presupuesto global:** además del cupo por persona, hay un presupuesto de llamadas a Gemini por minuto para *todas* las
  personas (`LIMITE_IA_GLOBAL_LLAMADAS_MINUTO`, porque la capa gratis tiene un límite por proyecto). Si una petición no cabe,
  responde **`429 IA_OCUPADA`** al instante, con `Retry-After`, y no le cuenta como consulta a la persona. Ver
  `docs/capacidad-ia.md`.
- **Modo ahorro:** con poco presupuesto, `POST /api/ia/recomendar` y `POST /api/ia/asistente` (intención `reservar`) devuelven
  las salas con `modoAhorro: true`: las reglas escriben el `motivo` de cada opción y `explicacion` viene vacía.
- **Intención sin IA:** `POST /api/ia/asistente` decide con reglas cuando el mensaje es claro y solo le pregunta a Gemini si es
  ambiguo. Una pregunta ya respondida (sin conversación previa) sale de la caché con `X-Cache: HIT`.

- Cada usuario puede hacer `LIMITE_IA_PETICIONES` consultas a `/api/ia/*` cada
  `LIMITE_IA_VENTANA_MINUTOS` (valores en `src/config/reglas.js`). Una petición inválida (422) o
  respondida desde la caché no gasta cupo.
- `POST /api/ia/triaje` guarda la respuesta `CACHE_IA_MINUTOS` minutos: un texto idéntico (sin
  importar mayúsculas ni espacios) se responde desde la caché con la cabecera `X-Cache: HIT`.
  `POST /api/ia/recomendar` no se cachea porque depende de la disponibilidad y de la fecha.
- `POST /api/ia/preguntar` guarda en caché solo las preguntas **sin historial** y **respondidas** (un "no sé" puede
  cambiar al agregar un documento, y con historial la respuesta depende de la conversación). Recargar los documentos
  (`/conocimiento/ingestar`) vacía la caché. `POST /api/ia/asistente` no se cachea.
- Una consulta a `/preguntar` o `/asistente` cuenta como **un** cupo, aunque por dentro haga hasta cuatro llamadas a
  Gemini (intención, reformular, reordenar, responder). Ojo: el plan gratuito de Gemini permite 15 llamadas por minuto
  por modelo en total, no por usuario (ver `docs/rag.md`).
- `POST /api/ia/similares` cuenta como una consulta a la IA, salvo que el embedding del texto ya esté
  en la caché (o en camino, si llegan varias peticiones iguales a la vez).

## Roles

`rol` es `admin`, `profesor` o `soporte_tecnico`. La primera cuenta registrada es `admin`; las
demás las crea un `admin` con `POST /api/usuarios` (también otros `admin`). Una
cuenta antigua sin rol, o con un rol que ya no existe (`camper`, `coordinador`), se trata como
`profesor`.

| Acción | admin | profesor | soporte_tecnico |
|---|---|---|---|
| Reservar, pedir un salón ocupado y reportar incidencias | sí | sí | sí |
| Editar o cancelar una reserva | todas | las suyas | las suyas |
| Solicitar un salón ocupado | sí | sí | sí |
| Aprobar o rechazar solicitudes de salón | sí | no | no |
| Panel Soporte TI: atender y resolver incidencias (rehabilita espacios y equipos) | sí | no | sí |
| Crear cuentas (también admins) y dar contraseñas temporales | sí | no | no |
| Cambiar mi contraseña | sí | sí | sí |
| Actualizar el inventario (estado de equipos y salas) | sí | no | sí |

## Fechas

Formato `YYYY-MM-DDTHH:mm` en hora local de Bogotá, sin zona horaria.

## Valores cerrados

Son los únicos válidos y viven en `src/config/reglas.js`:

- Estados de espacio: `disponible`, `inhabilitado`, `inconsistente`.
- Estados de recurso: `disponible`, `prestado`, `danado`, `en_reparacion`.
- Categorías de una incidencia nueva: `infraestructura`, `tecnologia` (las de los 2 técnicos de TI).
  Las anteriores (`aseo`, `seguridad`, `bienestar`, `otro`) solo aparecen en incidencias registradas antes del
  21 nov 2026: la base las acepta, pero `POST /api/incidencias` responde 422 si llegan (`CATEGORIAS_ANTERIORES`).
- Prioridades: `baja`, `media`, `alta`, `critica`.
- Áreas: `Infraestructura`, `Soporte TI`, `Servicios generales`, `Seguridad`, `Bienestar`.

## Interfaces internas entre módulos

Lo que P2 (IA) importa de P1. Si P1 cambia un nombre, avisa antes.

| Archivo (dueño P1) | Export | Qué devuelve |
|---|---|---|
| `src/config/reglas.js` | `CATEGORIAS`, `CATEGORIAS_ANTERIORES`, `PRIORIDADES`, `AREAS` | Arrays con los valores cerrados de arriba |
| `src/config/reglas.js` | `REGLAS` | Objeto con las constantes (usa `PRIORIDADES_QUE_INHABILITAN`) |
| `src/data/almacen.js` | `leerDB()` | `Promise<{espacios, recursos, reservas, prestamos, incidencias, ...}>`: la foto de PostgreSQL (siempre `async`) |
| `src/domain/reservas.js` | `buscarEspaciosDisponibles({asistentes, inicio, fin})` | Espacios que cumplen todas las reglas, ordenados por mejor ajuste de aforo |

Y lo que P1 importa de P2:

| Archivo (dueño P2) | Export | Uso |
|---|---|---|
| `src/routes/ia.js` | `default` (un `express.Router`) | P1 lo monta en `src/server.js` con `app.use('/api/ia', iaRouter)` |

## Webhook de incidencias hacia n8n

Al crear una incidencia, Express envía `POST $N8N_WEBHOOK_URL` (por defecto `/webhook/incidencia-nueva` de n8n) con
`{"evento": "incidencia.creada", "incidencia": {id, descripcion, categoria, prioridad, area, espacioId, recursoId, origen, fecha}}`
y las cabeceras `x-pulse-timestamp` (segundos) y `x-pulse-firma` (`sha256=` + HMAC-SHA256 de `"<timestamp>.<cuerpo>"` con
`N8N_SECRETO`). Es en segundo plano: un fallo de n8n nunca impide crear la incidencia. Ver `docs/workflows.md`.
