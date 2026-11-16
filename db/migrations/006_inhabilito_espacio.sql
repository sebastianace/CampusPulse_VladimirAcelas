-- inhabilito_espacio: ¿la incidencia dejó fuera de servicio TODA la sala?
-- Antes, una incidencia con sala y equipo apagaba los dos. Ahora se inhabilita lo más específico (el equipo, si lo hay)
-- y la sala solo si se pide de forma explícita o si no hay equipo. Al resolver se rehabilita exactamente lo que se apagó:
--   - el equipo, si inhabilito = true y hay recurso_id;
--   - la sala, si inhabilito_espacio = true.
ALTER TABLE incidencias ADD COLUMN inhabilito_espacio boolean NOT NULL DEFAULT false;

-- Las incidencias anteriores sí apagaron la sala (era la regla vieja): al resolverlas debe volver a quedar disponible.
UPDATE incidencias SET inhabilito_espacio = true WHERE inhabilito AND espacio_id IS NOT NULL;
