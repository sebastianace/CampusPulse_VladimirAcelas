-- Zona Hunters reemplaza a las mesas de ping-pong (21 nov 2026).
-- Las mesas no se reservan en el campus: están en Hunters, una zona común. Hunters existe como espacio
-- para poder reportar un daño ahí, pero es de tipo 'zona_comun' (REGLAS.TIPOS_NO_RESERVABLES) y no se
-- reserva. No tiene aforo: la columna admite NULL (002_esquema.sql).

-- Solo en una base que ya tiene espacios: en una base nueva (vacía) la semilla carga Hunters desde
-- data/seed/espacios-extra.json, y src/data/arranque.js siembra solo si la tabla espacios está vacía.
INSERT INTO espacios (id, nombre, tipo, aforo, estado)
SELECT 'hunters', 'Zona Hunters', 'zona_comun', NULL, 'disponible'
WHERE EXISTS (SELECT 1 FROM espacios)
ON CONFLICT (id) DO NOTHING;

-- Lo que se reportó en una mesa sigue en el historial, ahora en Hunters.
UPDATE incidencias SET espacio_id = 'hunters' WHERE espacio_id IN ('ping-pong-1', 'ping-pong-2');
UPDATE recursos    SET espacio_id = 'hunters' WHERE espacio_id IN ('ping-pong-1', 'ping-pong-2');

-- Las reservas de las mesas no correspondían a algo real: se borran con sus solicitudes.
DELETE FROM solicitudes_salon WHERE espacio_id IN ('ping-pong-1', 'ping-pong-2');
DELETE FROM reservas          WHERE espacio_id IN ('ping-pong-1', 'ping-pong-2');
DELETE FROM espacios          WHERE id IN ('ping-pong-1', 'ping-pong-2');
