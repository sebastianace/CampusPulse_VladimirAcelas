-- Esquema inicial de Campus Pulse. Las columnas siguen los objetos que hoy
-- guarda data/db.json. Las fechas son TIMESTAMP sin zona: hora local de
-- Bogotá, igual que el contrato de la API (YYYY-MM-DDTHH:mm).
-- Los CHECK de valores cerrados repiten los de src/config/reglas.js; un test
-- (tests/esquema.test.js) comprueba que no se desincronicen.

CREATE TABLE espacios (
  id     text PRIMARY KEY,
  nombre text NOT NULL,
  tipo   text NOT NULL,
  aforo  integer CHECK (aforo > 0),   -- NULL en los registros inconsistentes del CSV
  estado text NOT NULL CHECK (estado IN ('disponible', 'inhabilitado', 'inconsistente'))
);

CREATE TABLE recursos (
  id         text PRIMARY KEY,
  nombre     text NOT NULL,
  tipo       text NOT NULL,
  espacio_id text REFERENCES espacios (id),   -- NULL: el equipo no tiene sala asignada
  estado     text NOT NULL CHECK (estado IN ('disponible', 'prestado', 'danado', 'en_reparacion')),
  ficticio   boolean NOT NULL DEFAULT false
);

CREATE TABLE reservas (
  id          text PRIMARY KEY,
  espacio_id  text NOT NULL REFERENCES espacios (id),
  responsable text NOT NULL,
  asistentes  integer NOT NULL CHECK (asistentes > 0),
  inicio      timestamp NOT NULL,
  fin         timestamp NOT NULL,
  CHECK (fin > inicio),
  -- Regla 6 en la base de datos: dos reservas del mismo espacio no pueden cruzarse,
  -- aunque lleguen al mismo tiempo. El rango '[)' incluye el inicio y excluye el fin,
  -- así que 10:00-12:00 y 12:00-14:00 sí se permiten (franjas pegadas).
  EXCLUDE USING gist (espacio_id WITH =, tsrange(inicio, fin, '[)') WITH &&)
);
CREATE INDEX reservas_inicio_idx ON reservas (inicio);

CREATE TABLE prestamos (
  id               text PRIMARY KEY,
  recurso_id       text NOT NULL REFERENCES recursos (id),
  persona          text NOT NULL,
  estado           text NOT NULL CHECK (estado IN ('activo', 'devuelto')),
  fecha            timestamp NOT NULL,
  fecha_devolucion timestamp
);

CREATE TABLE incidencias (
  id               text PRIMARY KEY,
  descripcion      text NOT NULL,
  categoria        text NOT NULL CHECK (categoria IN ('infraestructura', 'tecnologia', 'aseo', 'seguridad', 'bienestar', 'otro')),
  prioridad        text NOT NULL CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
  area             text NOT NULL CHECK (area IN ('Infraestructura', 'Soporte TI', 'Servicios generales', 'Seguridad', 'Bienestar')),
  espacio_id       text REFERENCES espacios (id),
  recurso_id       text REFERENCES recursos (id),
  origen           text NOT NULL CHECK (origen IN ('ia', 'manual')),
  ia               jsonb,   -- lo que sugirió la IA (razón, modelo, sugerencia...)
  estado           text NOT NULL CHECK (estado IN ('abierta', 'resuelta')),
  inhabilito       boolean NOT NULL DEFAULT false,
  fecha            timestamp NOT NULL,
  fecha_resolucion timestamp
);

CREATE TABLE usuarios (
  usuario    text PRIMARY KEY,
  nombre     text NOT NULL,
  rol        text NOT NULL CHECK (rol IN ('admin', 'profesor', 'soporte_tecnico')),
  clave_hash text NOT NULL,   -- scrypt con sal; nunca la clave en texto plano
  creado     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
  token_hash text PRIMARY KEY,   -- hash del token de la cookie, no el token
  usuario    text NOT NULL REFERENCES usuarios (usuario) ON DELETE CASCADE,
  expira     timestamptz NOT NULL
);

-- Reporte de calidad del CSV oficial: una sola fila.
CREATE TABLE calidad_datos (
  id              integer PRIMARY KEY CHECK (id = 1),
  cargados        integer NOT NULL,
  validos         integer NOT NULL,
  inconsistentes  jsonb NOT NULL DEFAULT '[]'
);
