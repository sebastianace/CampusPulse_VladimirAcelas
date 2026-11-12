# Contrato de la API — Campus Pulse

Este contrato no se cambia sin avisar al equipo. Con él, P3 construye la interfaz y P2 la IA
sin esperar a que P1 termine.

## Rutas

| Método y ruta | Cuerpo que recibe | Respuesta OK | Dueño |
|---|---|---|---|
| `GET /api/espacios` | — | `[{id, nombre, tipo, aforo, estado, ocupadoAhora, computadores}]` | P1 |
| `GET /api/recursos` | — | `[{id, nombre, tipo, espacioId, estado}]` | P1 |
| `GET /api/reservas?fecha=YYYY-MM-DD` | — | `[{id, espacioId, responsable, asistentes, inicio, fin}]` | P1 |
| `POST /api/reservas` | `{espacioId, responsable, asistentes, inicio, fin}` | `201` + la reserva | P1 |
| `PATCH /api/reservas/:id` | Los campos a cambiar de `{espacioId, responsable, asistentes, inicio, fin}` | `200` + la reserva editada (vuelve a pasar por todas las reglas) | P1 |
| `DELETE /api/reservas/:id` | — | `200` + la reserva cancelada | P1 |
| `GET /api/prestamos` | — | `[{id, recursoId, persona, estado, fecha}]` | P1 |
| `POST /api/prestamos` | `{recursoId, persona}` | `201` + el préstamo | P1 |
| `POST /api/prestamos/:id/devolver` | `{estadoFinal: "disponible" \| "danado"}` | `200` + el préstamo | P1 |
| `GET /api/incidencias` | — | `[{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia, reportesAdicionales}]` (`reportesAdicionales`: personas que confirmaron que era la misma) | P1 |
| `POST /api/incidencias/:id/reportes` | `{descripcion}` | `201 {reporte: {id, incidenciaId, descripcion, reportadoPor, fecha}, totalReportes}`. Suma el reporte a una incidencia abierta; `404` si no existe, `409 INCIDENCIA_YA_RESUELTA` si ya se resolvió | P1 |
| `GET /api/incidencias/:id/reportes` | — | `[{id, incidenciaId, descripcion, reportadoPor, fecha}]` | P1 |
| `POST /api/incidencias` | `{descripcion, categoria, prioridad, area, espacioId, recursoId, inhabilitar, origen, ia}` | `201` + la incidencia (y cambia el estado del espacio o recurso) | P1 |
| `PATCH /api/incidencias/:id` | `{estado: "resuelta"}` | `200` (rehabilita el espacio o recurso). Solo `admin` y `soporte_tecnico`; otro rol → `403` | P1 |
| `GET /api/calidad-datos` | — | `{cargados, validos, inconsistentes: [{fila, motivo}]}` | P1 |
| `POST /api/restaurar` | — | `200` (recrea `db.json` desde `raw` y `seed`). Solo `admin`; otro rol → `403` | P1 |
| `POST /api/auth/registro` | `{usuario, nombre, clave}` | `201 {usuario, nombre, rol}` y abre sesión (cookie). Solo crea la primera cuenta (`admin`); después `403 REGISTRO_CERRADO` | P2 |
| `GET /api/auth/estado` | — | `200 {registroAbierto}`; es público. El login lo usa para ocultar "Crear una cuenta" | P2 |
| `GET /api/usuarios` | — | `200 [{usuario, nombre, rol}]` (nunca trae las claves). Solo `admin` | P2 |
| `POST /api/usuarios` | `{usuario, nombre, clave, rol: "profesor" \| "soporte_tecnico"}` | `201 {usuario, nombre, rol}`. Solo `admin`; no abre sesión | P2 |
| `POST /api/auth/login` | `{usuario, clave}` | `200 {usuario, nombre, rol}` y abre sesión (cookie) | P2 |
| `POST /api/auth/logout` | — | `200` y cierra la sesión | P2 |
| `GET /api/auth/yo` | — | `200 {usuario, nombre, rol}` o `401` | P2 |
| `POST /api/ia/triaje` | `{descripcion}` | `{categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon, modelo}` | P2 |
| `POST /api/ia/similares` | `{descripcion, espacioId?, recursoId?}` | `{candidatas: [{id, descripcion, categoria, prioridad, area, espacioId, recursoId, fecha, similitud, reportesAdicionales}], umbral, modelo}`. Incidencias **abiertas** parecidas, de la más a la menos parecida. `503` si el servicio de embeddings falla | P2 |
| `POST /api/ia/recomendar` | `{texto}` | `{solicitud: {asistentes, inicio, fin, necesitaComputadores}, opciones: [{espacioId, motivo}], explicacion, modelo}` | P2 |
| `POST /api/ia/preguntar` | `{pregunta, historial?: [{rol: "usuario" \| "pulse", texto}]}` | `{respondido, respuesta, areaSugerida, fragmentos: [{documento, seccion, archivo, texto, similitud, puntaje, usado, ejemplo}], consulta, reranking, modelo}`. Responde con los documentos de `knowledge/` (RAG en `pulse-ai`) y marca en `fragmentos` cuáles usó. Si no están en los documentos, `respondido: false` y no inventa. `503` si `pulse-ai` o Gemini fallan; `422` si el historial es inválido | P2 |
| `POST /api/ia/asistente` | `{texto, historial?}` | La barra Ctrl+K. La IA decide la intención: `{intencion: "reservar", solicitud, opciones, explicacion, modelo}` (igual que `/recomendar`) o `{intencion: "preguntar", ...}` (igual que `/preguntar`). Gasta un solo cupo de IA | P2 |
| `POST /api/ia/conocimiento/ingestar` | — | `200 {documentos, fragmentos, retirados}`. Vuelve a cargar `knowledge/` en la base vectorial. Solo `admin`; otro rol → `403` | P2 |

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
| 403 | Hay sesión, pero el rol no tiene permiso (`PERMISO_DENEGADO`) |
| 429 | Demasiados intentos de login fallidos (`DEMASIADOS_INTENTOS`): 5 del mismo usuario e IP en 15 minutos. Trae la cabecera `Retry-After` en segundos |
| 429 | Demasiadas consultas a la IA (`LIMITE_IA`): 5 por usuario por minuto entre `/api/ia/triaje` y `/api/ia/recomendar`. Trae `Retry-After` y el mensaje sugiere el formulario manual |
| 503 | La IA no responde (`codigo: "IA_NO_DISPONIBLE"`) |

## Límite y caché de la IA

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
demás las crea un `admin` con `POST /api/usuarios` (solo `profesor` o `soporte_tecnico`). Una
cuenta antigua sin rol, o con un rol que ya no existe (`camper`, `coordinador`), se trata como
`profesor`.

| Acción | admin | profesor | soporte_tecnico |
|---|---|---|---|
| Reservar, prestar y reportar incidencias | sí | sí | sí |
| Resolver incidencias (rehabilita espacios y equipos) | sí | no | sí |
| Crear cuentas | sí | no | no |
| Restaurar datos | sí | no | no |

## Fechas

Formato `YYYY-MM-DDTHH:mm` en hora local de Bogotá, sin zona horaria.

## Valores cerrados

Son los únicos válidos y viven en `src/config/reglas.js`:

- Estados de espacio: `disponible`, `inhabilitado`, `inconsistente`.
- Estados de recurso: `disponible`, `prestado`, `danado`, `en_reparacion`.
- Categorías: `infraestructura`, `tecnologia`, `aseo`, `seguridad`, `bienestar`, `otro`.
- Prioridades: `baja`, `media`, `alta`, `critica`.
- Áreas: `Infraestructura`, `Soporte TI`, `Servicios generales`, `Seguridad`, `Bienestar`.

## Interfaces internas entre módulos

Lo que P2 (IA) importa de P1. Si P1 cambia un nombre, avisa antes.

| Archivo (dueño P1) | Export | Qué devuelve |
|---|---|---|
| `src/config/reglas.js` | `CATEGORIAS`, `PRIORIDADES`, `AREAS` | Arrays con los valores cerrados de arriba |
| `src/config/reglas.js` | `REGLAS` | Objeto con las constantes (usa `PRIORIDADES_QUE_INHABILITAN`) |
| `src/data/store.js` | `leerDB()` | `{espacios, recursos, ...}` (puede ser síncrona o `async`) |
| `src/domain/reservas.js` | `buscarEspaciosDisponibles({asistentes, inicio, fin})` | Espacios que cumplen todas las reglas, ordenados por mejor ajuste de aforo |

Y lo que P1 importa de P2:

| Archivo (dueño P2) | Export | Uso |
|---|---|---|
| `src/routes/ia.js` | `default` (un `express.Router`) | P1 lo monta en `src/server.js` con `app.use('/api/ia', iaRouter)` |
