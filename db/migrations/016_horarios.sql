-- Horarios fijos de las clases del campus (Software, Inglés y SER). Reemplaza la hoja de Excel de Coordinación
-- y la app EnglishFlow: aquí viven en la base, con las salas del campus y sus reglas.
-- Cada fila es un bloque semanal: una clase que se repite en una sala, a una hora, ciertos días.
-- dias: números 1 (lunes) a 7 (domingo). NULL = los días todavía no se han confirmado. Un bloque sin días
-- se guarda y se revisa, pero NO bloquea reservas: no se cierra una sala con un dato que no se sabe.
CREATE TABLE bloques_horario (
  id          text PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('software', 'ingles', 'ser')),
  espacio_id  text NOT NULL REFERENCES espacios (id),
  hora_inicio text NOT NULL CHECK (hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hora_fin    text NOT NULL CHECK (hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  dias        smallint[] CHECK (dias IS NULL OR (cardinality(dias) BETWEEN 1 AND 7 AND dias <@ ARRAY[1,2,3,4,5,6,7]::smallint[])),
  grupo       text NOT NULL,          -- la cohorte (Software y SER, ej. "J2 Abr-26") o el grupo de inglés ("Grupo 4")
  estudiantes integer CHECK (estudiantes >= 0),
  nivel       text,                   -- nivel de inglés (B1.1) o programa (Java, IA)
  docente     text,
  modulo      text,
  observacion text,
  posicion    bigint GENERATED ALWAYS AS IDENTITY,
  CHECK (hora_fin > hora_inicio)
);
CREATE INDEX bloques_horario_espacio_idx ON bloques_horario (espacio_id);
