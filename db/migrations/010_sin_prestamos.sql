-- En el campus no se prestan equipos: se quita la función de préstamos.
-- La tabla "prestamos" se queda como historial (no se borra nada), pero ya no hay préstamos activos
-- ni equipos en estado "prestado".
--   1. Los préstamos activos se cierran: quedan devueltos en el momento de la migración.
--   2. El equipo que figuraba prestado vuelve a disponible.
--   3. "prestado" deja de ser un estado válido de un equipo.
UPDATE prestamos
   SET estado = 'devuelto', fecha_devolucion = date_trunc('minute', now() AT TIME ZONE 'America/Bogota')
 WHERE estado = 'activo';

UPDATE recursos SET estado = 'disponible' WHERE estado = 'prestado';

ALTER TABLE recursos DROP CONSTRAINT recursos_estado_check;
ALTER TABLE recursos ADD CONSTRAINT recursos_estado_check CHECK (estado IN ('disponible', 'danado', 'en_reparacion'));
