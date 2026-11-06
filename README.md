# Campus Pulse

MVP construido en la Hackatón de Campuslands (5 horas, equipo de 5) que unifica en un solo
panel los **espacios** del campus, los **recursos tecnológicos** y las **incidencias**, con una
IA que ayuda a clasificar reportes y a recomendar salas.

> Principio del proyecto: **la IA sugiere, las reglas deciden.**

## Problema

Hoy la información del campus está repartida: qué sala está libre, qué equipo está prestado o
dañado y qué incidencias hay abiertas se consultan en lugares distintos. Eso provoca reservas
que se cruzan, salas con sobrecupo, equipos dañados que se vuelven a prestar y reportes que no
llegan al área correcta.

## Solución

- **Mapa de espacios** con su aforo y estado en tiempo real (disponible, ocupado, inhabilitado o
  inconsistente).
- **Reservas** de espacios (crear, editar y cancelar) y **préstamos** de equipos, validados con
  reglas de negocio.
- **Incidencias en lenguaje natural**: la IA sugiere categoría, prioridad, área responsable y
  espacio o equipo afectado. La persona confirma y, si es grave, el espacio o equipo queda
  inhabilitado de inmediato.
- **Asistente de reservas (Ctrl+K)**: "Necesito un salón para 30 personas mañana de 2 a 4 pm"
  → opciones reales que cumplen todas las reglas, explicadas por la IA.
- **Panel de calidad de datos**: muestra los registros del CSV oficial que son inconsistentes,
  sin que rompan la aplicación.

## Historia del proyecto

### v1 — Hackatón de Campuslands (trabajo en equipo)

La primera versión se construyó en equipo durante la Hackatón de Campuslands, en 5 horas, con
el liderazgo de Sebastián Vladimir Acelas (P1). Cada integrante tuvo un rol definido:

| Rol | Integrante | Responsabilidad |
|---|---|---|
| P1 | Sebastián Vladimir Acelas (líder) | Backend: datos, reglas de negocio y API |
| P2 | Jaime Naranjo | IA, integración Git y README |
| P3 | Junior Cuajaro | Frontend y experiencia de usuario |
| P4 | Thomas Serrano | Datos oficiales y pruebas de datos y fechas |
| P5 | Sebastian Diaz | Documentación de la demo y del reto en vivo |

El resultado de la hackatón es la versión `v1.1.1` (ver [CHANGELOG.md](CHANGELOG.md)).

> El historial de Git de la hackatón quedó en el repositorio del equipo. Este repositorio parte
> de la `v1.1.1` tal como quedó al terminar (commit `chore(repo): importar el estado actual de la
> v1.1.1`), y desde ahí registra todo el trabajo de la v2.

### v2 — Desarrollo individual

A partir de la `v1.1.1`, Sebastián Vladimir Acelas continúa el proyecto de forma individual como proyecto
final del curso Inteligencia Artificial 2 (Campuslands). La v2 se enfoca en seguridad (roles y
límites), una base de datos real y más uso de IA, siempre con el mismo principio: la IA sugiere,
las reglas deciden. Los cambios de la v2 se registran en [CHANGELOG.md](CHANGELOG.md).

## Stack

- **Node.js 24** + **Express 5**, módulos ES (`"type": "module"`).
- **Frontend** en HTML, CSS y JavaScript nativo, sin frameworks ni build.
- **Persistencia** en `data/db.json` con escritura atómica (archivo temporal + rename).
- **IA**: Google Gemini mediante `@google/genai`.
- **Tests** con `node:test` (sin dependencias extra).

## Arquitectura

```
public/            Frontend (P3): login, mapa, formularios, incidencias, Ctrl+K
src/server.js      Express: sirve public/ y monta /api/*; exige sesión; manejador global de errores
src/routes/        Rutas HTTP (una por recurso). ia.js -> /api/ia/*, auth.js -> /api/auth/*
src/auth/          usuarios.js: cuentas (clave con hash scrypt) y sesiones
src/domain/        Reglas de negocio: reservas, préstamos, incidencias, fechas, errores
src/config/        reglas.js: TODAS las constantes de negocio y valores cerrados
src/data/          loader.js (lee el CSV) y store.js (lee/escribe db.json)
src/ai/            cliente.js, validar.js, triaje.js, asistente.js
data/raw/          espacios.csv oficial (nunca se modifica)
data/seed/         recursos.json con equipos ficticios
docs/              contrato-api.md, demo.md, reto-en-vivo.md y capturas
tests/             pruebas de reglas, datos, fechas y API (node:test)
```

El contrato completo de la API está en [docs/contrato-api.md](docs/contrato-api.md). Todos los
errores responden `{error: {codigo, mensaje}}` con el mensaje en español: 422 datos mal formados,
409 regla de negocio violada, 404 ID inexistente, 401 sin sesión y 503 IA no disponible.

## Inicio de sesión

- Toda la API (salvo `/api/auth/*`) exige una sesión. Sin sesión, la interfaz lleva a
  `login.html` y, al entrar, vuelve a la página que se estaba usando (también `movil.html`).
- **No hay usuarios ni contraseñas en el repositorio.** La primera vez se crea una cuenta desde
  "Crear una cuenta" (usuario de 3 a 30 caracteres y contraseña de al menos 8): esa cuenta es
  `admin`. Después el registro se cierra y el admin crea las demás con `POST /api/usuarios`.
- **Tres roles:** `admin` (crea cuentas y restaura datos), `profesor` (reserva, presta y reporta)
  y `soporte_tecnico` (además resuelve incidencias, lo que rehabilita espacios y equipos). La
  tabla de permisos está en [docs/contrato-api.md](docs/contrato-api.md).
- Las contraseñas se guardan con hash `scrypt` y sal aleatoria, y las sesiones con el hash de su
  token, en `data/auth.json` (ignorado por Git). La sesión dura 8 horas y viaja en una cookie
  `HttpOnly`, que además es `Secure` (solo HTTPS) cuando `NODE_ENV=production`.
- Tras **5 intentos fallidos** del mismo usuario desde la misma IP en 15 minutos, el login
  responde `429` hasta que pase la ventana (`src/auth/intentos.js`). Los contadores viven en
  memoria y se borran al reiniciar el servidor.
- **Restaurar datos** no borra las cuentas, y las sesiones sobreviven a los reinicios de
  `npm run dev` (útil en el reto en vivo).

## Rol de la IA y cómo se controla

La IA solo **sugiere** en dos puntos. Nunca escribe en la base de datos ni decide si algo está
permitido.

### 1. Triaje de incidencias — `POST /api/ia/triaje`

1. La persona describe el problema: _"El video beam de Apolo no prende y huele a quemado"_.
2. El prompt incluye el **catálogo real** (IDs y nombres de espacios y recursos), los valores
   cerrados y la regla de cuándo inhabilitar.
3. Gemini responde un JSON forzado por **schema**: los enums y los IDs van como listas cerradas.
4. `src/ai/validar.js` vuelve a comprobar todo: un valor fuera de los enums o un ID que no existe
   se convierte en `null` y la interfaz pide elegirlo a mano.
5. La interfaz muestra la sugerencia como **"Sugerido por IA"**, con la razón, y la persona la
   puede editar. Solo al confirmar se llama a `POST /api/incidencias`, donde las reglas deciden.

### 2. Asistente de reservas — `POST /api/ia/recomendar`

1. La IA **extrae** `{asistentes, inicio, fin}` del texto, con la fecha actual y la zona
   `America/Bogota`.
2. Las **reglas** filtran: `buscarEspaciosDisponibles` devuelve solo los espacios que cumplen
   aforo, horario, días hábiles, duración, estado y no solapamiento, ordenados por mejor ajuste.
3. La IA solo **redacta** la explicación de esas opciones ya filtradas. Si menciona un espacio
   que no estaba en la lista, se descarta.

### Controles

- Salida JSON por schema, temperatura 0.2, timeout de 15 s y un reintento (`src/ai/cliente.js`).
- El texto del usuario va delimitado y se le indica a la IA que es un dato, no instrucciones.
- **Sin respuestas simuladas**: si la IA falla o no hay key, la API responde
  `503 {error: {codigo: "IA_NO_DISPONIBLE", mensaje}}` y la interfaz ofrece el formulario manual.
- **Límite por usuario:** 5 consultas a la IA por minuto (`src/ai/limite.js`). Al pasarse responde
  `429 LIMITE_IA` en español y la interfaz ofrece el formulario manual.
- **Caché del triaje:** un texto idéntico se responde desde la memoria durante 10 minutos
  (`src/ai/cache.js`) y no gasta cuota de Gemini. La recomendación de salas no se cachea porque
  depende de la disponibilidad y de la fecha.
- Cambiar de proveedor de IA solo exige tocar `src/ai/cliente.js`.

## Uso de IA en el desarrollo

Campus Pulse usa IA en dos lugares distintos, y conviene no confundirlos:

1. **IA dentro del producto** (Gemini): sugiere en el triaje de incidencias y en el asistente de
   reservas. Está descrita arriba, en "Rol de la IA y cómo se controla".
2. **IA como herramienta de desarrollo** (esta sección): desde el 2 de noviembre de 2026, la v2 se
   desarrolla con ayuda de un asistente de programación (Claude Code, de Anthropic).

### Quién hace qué

- **Sebastián Vladimir Acelas decide y responde por el proyecto.** Define el alcance en el plan de
  la v2, revisa cada cambio antes de integrarlo y es el único que hace `push` y abre los pull
  requests. Todo el código publicado es responsabilidad suya y debe poder explicarlo.
- **El asistente propone y escribe borradores** de código, pruebas y documentación en ramas
  locales, y explica cada decisión de diseño.
- Las piezas que hay que defender en la sustentación (reglas de negocio, prompts y RAG) las
  escribe el autor; el asistente las revisa y las explica.

### Controles

- Una rama por tarea y un pull request a `develop`: ningún cambio llega sin revisión humana.
- `npm test` debe pasar antes de cada commit; cada función nueva trae sus pruebas.
- Los commits son del autor. Sin firmas ni coautores automáticos: la trazabilidad está aquí y en
  el historial de pull requests.
- Nunca se suben claves: `.env`, `data/db.json` y `data/auth.json` están en `.gitignore`, y el
  asistente no lee ni imprime claves.
- Cuando una decisión de diseño es dudosa, el asistente no la toma: la deja anotada como pregunta
  para que el autor decida.
- La documentación no afirma nada que no se haya comprobado (por ejemplo, el CHANGELOG solo
  describe lo que consta en el repositorio).

## Reglas de negocio

Todas viven en [`src/config/reglas.js`](src/config/reglas.js). Para cambiar una regla basta con
editar un valor y guardar (`npm run dev` reinicia el servidor solo).

| Regla | Constante | Valor actual |
|---|---|---|
| Los asistentes no superan el aforo (× margen) | `MARGEN_AFORO` | `1.0` |
| Horario del campus | `HORA_APERTURA` / `HORA_CIERRE` | 7:00 a 21:00 |
| Anticipación mínima para reservar (0 = no se reserva en el pasado) | `ANTICIPACION_MINIMA_MINUTOS` | `0` |
| Duración máxima de una reserva | `MAX_HORAS_RESERVA` | 4 horas |
| Días en que se puede reservar (0 = domingo) | `DIAS_HABILES` | lunes a sábado |
| Reservas por persona y día | `MAX_RESERVAS_POR_PERSONA_DIA` | 3 |
| Préstamos activos por persona | `MAX_PRESTAMOS_POR_PERSONA` | 2 |
| Estados de espacio que no se pueden reservar | `ESTADOS_NO_ASIGNABLES` | inhabilitado, inconsistente |
| Prioridades que inhabilitan automáticamente | `PRIORIDADES_QUE_INHABILITAN` | critica |
| Estado al que pasa un equipo cuando una incidencia lo inhabilita | `ESTADO_RECURSO_INHABILITADO` | en_reparacion |
| Cambios de estado de un equipo | `TRANSICIONES_RECURSO` | disponible → prestado / en reparación; prestado → disponible / dañado; dañado → en reparación; en reparación → disponible |
| Salas con computadores (si el pedido los necesita, solo se recomiendan estas) | `ESPACIOS_CON_COMPUTADORES` | apolo, spooki, artemis, skilab |
| Tipos de espacio que la IA nunca recomienda | `TIPOS_FUERA_DE_RECOMENDACION` | mesa_juego |
| Consultas a la IA por usuario en la ventana | `LIMITE_IA_PETICIONES` / `LIMITE_IA_VENTANA_MINUTOS` | 5 por minuto |
| Minutos que se guarda la respuesta del triaje | `CACHE_IA_MINUTOS` | 10 |

Además:

- Dos reservas del mismo espacio no se pueden cruzar (las franjas pegadas, como 10–12 y 12–14,
  sí se permiten).
- **Editar** una reserva (`PATCH /api/reservas/:id`) vuelve a pasar por todas las reglas de arriba;
  la reserva no choca consigo misma. **Cancelar** (`DELETE /api/reservas/:id`) la elimina.
- Una reserva que **ya empezó** no se puede editar ni cancelar.
- Una incidencia con `inhabilitar: true` o con una prioridad de `PRIORIDADES_QUE_INHABILITAN`
  inhabilita el espacio o equipo afectado. Al resolverla se rehabilita, salvo que otra incidencia
  abierta lo siga inhabilitando.

## Instalación y ejecución

Requisitos: **Node.js 24** o superior.

```bash
git clone https://github.com/sebastianace/CampusPulse_VladimirAcelas.git
cd CampusPulse_VladimirAcelas
npm install
cp .env.example .env
```

Edita `.env` (nunca lo subas al repositorio):

```
GEMINI_API_KEY=tu_key_de_google_ai_studio
GEMINI_MODEL=gemini-3.6-flash
PORT=3000
```

`GEMINI_MODEL` es el id exacto del modelo (por ejemplo `gemini-3.6-flash`, el que usamos en la
demo). Si `npm run probar-ia` responde 503 ("high demand"), el modelo está saturado en ese
momento: prueba otro modelo flash de tu cuenta. La capa gratis de Gemini permite **5 peticiones
por minuto por modelo**; el triaje usa 1 y la recomendación 2. Si se supera, la app responde con el
error claro y el formulario manual, nunca con una respuesta inventada.

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor en `http://localhost:3000` |
| `npm run dev` | Igual, pero se reinicia solo al guardar un archivo |
| `npm test` | Ejecuta las pruebas de las reglas |
| `npm run probar-ia` | Comprueba que la key y el modelo de Gemini responden |

Abre `http://localhost:3000` y crea una cuenta con **Crear una cuenta** (solo la primera vez).

Sin `.env` la aplicación funciona igual: las funciones de IA muestran un error claro y se usa el
formulario manual.

La primera vez que arranca, el servidor crea `data/db.json` a partir de `data/raw/espacios.csv`,
`data/seed/espacios-extra.json` y `data/seed/recursos.json`. El botón **Restaurar** (`POST /api/restaurar`) vuelve a ese estado
inicial.

## Suposiciones sobre los datos

- `data/raw/espacios.csv` contiene la **capacidad instalada compartida por la organización**
  (9 espacios: Auditorio 100, Cosmos 25, Skilab 20, Spooki 38, Apolo 34, Blanca 12, Azul 10,
  Amarillas verdes 6, Artemis 32) y **nunca se modifica**. Un test verifica que se carga completo.
- Los nombres se normalizan (espacios sobrantes, mayúsculas) y el ID se genera del nombre:
  `Amarillas verdes` → `amarillas-verdes`.
- Un registro con aforo vacío, no numérico, decimal o menor o igual a 0 se carga como
  **inconsistente**: se ve en gris y no se puede reservar.
- Las filas sin nombre y los nombres duplicados solo aparecen en el reporte de calidad (se
  conserva la primera fila válida).
- Un registro inválido nunca detiene la carga.
- Los recursos tecnológicos son **ficticios** (`"ficticio": true` en `data/seed/recursos.json`),
  porque no se entregó un inventario oficial.
- **Salas con computadores:** Apolo, Spooki, Artemis y Skilab tienen computadores; Cosmos, Blanca,
  Azul, Amarillas verdes y el Auditorio no. El CSV oficial no trae este dato: lo aportó el equipo
  a partir de su conocimiento de las salas del campus. Vive en `ESPACIOS_CON_COMPUTADORES` de
  `src/config/reglas.js` y se puede cambiar en vivo.
- **Mesas de ping-pong:** `Ping-pong 1` y `Ping-pong 2` (aforo 4) no están en el CSV oficial; se
  agregan desde `data/seed/espacios-extra.json`, que no altera `data/raw/` ni el reporte de calidad.
- Todas las fechas usan el formato `YYYY-MM-DDTHH:mm` en hora local de Bogotá, sin zona horaria.

## Demo y reto en vivo

- [Guion de la demo](docs/demo.md): los pasos de la demostración con capturas.
- [Guía del reto en vivo](docs/reto-en-vivo.md): qué valor de `src/config/reglas.js` cambiar para
  cada pedido del jurado y cómo comprobarlo.

## Flujo de trabajo (Gitflow)

- `main`: versión estable. Cada versión publicada lleva su etiqueta (`v1.1.1`, `v2.0.0`…).
- `develop`: integración. Todo entra aquí por pull request.
- `feature/<tema>`: una rama por tarea (por ejemplo `feature/fase-1-seguridad`). Sale de
  `develop` y vuelve a `develop` por pull request con merge commit (sin squash), aunque el
  trabajo sea individual: el PR queda como evidencia de la revisión.
- `release/<versión>`: congelamiento antes de publicar (solo correcciones y documentación);
  se integra a `main` con su etiqueta y de vuelta a `develop`.

Reglas de cada commit:

- Formato `tipo(ámbito): descripción en español`, por ejemplo `feat(auth): agregar roles`.
  Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- `npm test` pasa antes de cada commit.
- `.env`, `data/db.json` y `data/auth.json` nunca se suben (están en `.gitignore`).

En la hackatón (v1) cada integrante trabajó en su rama (`feature/backend`, `feature/ia`,
`feature/frontend`) y se integró a `develop` por pull request.
