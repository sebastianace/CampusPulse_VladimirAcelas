-- "En atención": quién de soporte técnico tomó la incidencia y desde cuándo.
-- No es un estado nuevo (sigue "abierta" hasta que se resuelve): así no cambian los filtros de la API,
-- n8n ni el resumen diario. Una incidencia abierta con atendida_por está "en atención".
ALTER TABLE incidencias
  ADD COLUMN atendida_por   text REFERENCES usuarios (usuario) ON DELETE SET NULL,
  ADD COLUMN fecha_atencion timestamp;
