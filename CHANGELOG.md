# Changelog

Todos los cambios importantes de Campus Pulse se registran en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

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
