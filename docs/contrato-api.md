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
| `GET /api/incidencias` | — | `[{id, descripcion, categoria, prioridad, area, espacioId, recursoId, estado, origen, ia}]` | P1 |
| `POST /api/incidencias` | `{descripcion, categoria, prioridad, area, espacioId, recursoId, inhabilitar, origen, ia}` | `201` + la incidencia (y cambia el estado del espacio o recurso) | P1 |
| `PATCH /api/incidencias/:id` | `{estado: "resuelta"}` | `200` (rehabilita el espacio o recurso) | P1 |
| `GET /api/calidad-datos` | — | `{cargados, validos, inconsistentes: [{fila, motivo}]}` | P1 |
| `POST /api/restaurar` | — | `200` (recrea `db.json` desde `raw` y `seed`) | P1 |
| `POST /api/auth/registro` | `{usuario, nombre, clave}` | `201 {usuario, nombre}` y abre sesión (cookie) | P2 |
| `POST /api/auth/login` | `{usuario, clave}` | `200 {usuario, nombre}` y abre sesión (cookie) | P2 |
| `POST /api/auth/logout` | — | `200` y cierra la sesión | P2 |
| `GET /api/auth/yo` | — | `200 {usuario, nombre}` o `401` | P2 |
| `POST /api/ia/triaje` | `{descripcion}` | `{categoria, prioridad, area, espacioId, recursoId, inhabilitar, razon, modelo}` | P2 |
| `POST /api/ia/recomendar` | `{texto}` | `{solicitud: {asistentes, inicio, fin, necesitaComputadores}, opciones: [{espacioId, motivo}], explicacion, modelo}` | P2 |

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
| 503 | La IA no responde (`codigo: "IA_NO_DISPONIBLE"`) |

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
