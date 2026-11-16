-- Solicitudes de salón también para reservas futuras (antes, solo para una reserva en curso).
-- Caso del campus: un profesor necesita Cosmos mañana de 9 a 11, pero otro ya lo reservó. En vez de
-- quedarse con el "ya está reservado", le pide el salón a un admin.
-- inicio: desde cuándo se pide el salón. null = la reserva estaba en curso: la nueva empieza en el
--   momento en que el admin la aprueba (como hasta ahora, y como quedan las solicitudes anteriores).
ALTER TABLE solicitudes_salon ADD COLUMN inicio timestamp;
