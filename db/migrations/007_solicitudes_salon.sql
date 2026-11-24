-- Solicitudes de salón: pedir una sala que está reservada pero nadie está usando.
-- Caso real del campus: el profesor de las 9:00 no llegó y otra persona necesita el salón. En vez de
-- escribirle a TI por correo, lo pide en la app; un admin aprueba o rechaza. Al aprobar, la reserva
-- original se corta en ese momento y se crea la nueva, en una sola transacción.

-- Quién creó cada reserva (el usuario con sesión). Las reservas anteriores quedan en null: solo un
-- admin las puede editar o cancelar, porque no se sabe de quién son.
ALTER TABLE reservas ADD COLUMN creada_por text REFERENCES usuarios (usuario) ON DELETE SET NULL;

CREATE TABLE solicitudes_salon (
  id               text PRIMARY KEY,
  -- La reserva en curso que se pide (null si después se borró).
  reserva_id       text REFERENCES reservas (id) ON DELETE SET NULL,
  espacio_id       text NOT NULL REFERENCES espacios (id),
  solicitante      text REFERENCES usuarios (usuario) ON DELETE SET NULL,
  -- Quién creó la reserva original: se le avisa en la app si se aprueba.
  afectado         text REFERENCES usuarios (usuario) ON DELETE SET NULL,
  -- La reserva nueva: desde que se aprueba hasta "fin".
  responsable      text NOT NULL,
  asistentes       integer NOT NULL CHECK (asistentes > 0),
  fin              timestamp NOT NULL,
  motivo           text NOT NULL,
  estado           text NOT NULL CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  fecha            timestamp NOT NULL,
  decidida_por     text REFERENCES usuarios (usuario) ON DELETE SET NULL,
  fecha_decision   timestamp,
  nota_decision    text,
  reserva_nueva_id text REFERENCES reservas (id) ON DELETE SET NULL,
  posicion         bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX solicitudes_salon_estado_idx ON solicitudes_salon (estado);
