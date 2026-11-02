# Changelog

Todos los cambios importantes de Campus Pulse se registran en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Seguridad

- Roles `admin`, `coordinador` y `camper`: la primera cuenta es `admin` y las demás `camper`.
  Middleware `exigirRol(...roles)` que responde 403 `PERMISO_DENEGADO`.
- `POST /api/restaurar` solo lo puede usar un `admin`.
- Límite de intentos de login: 5 fallos del mismo usuario e IP en 15 minutos → 429
  `DEMASIADOS_INTENTOS` con cabecera `Retry-After`.

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
