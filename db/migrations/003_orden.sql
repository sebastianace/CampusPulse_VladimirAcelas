-- Orden de las filas.
-- Con db.json las listas conservaban el orden en que se guardaban (el del CSV oficial, por
-- ejemplo). En PostgreSQL una tabla no garantiza ningún orden, y un UPDATE puede mover la fila.
-- "posicion" es un contador que no se repite ni cambia con las actualizaciones: se lee con
-- ORDER BY posicion y así la API devuelve las listas en el mismo orden de siempre.
ALTER TABLE espacios    ADD COLUMN posicion bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE recursos    ADD COLUMN posicion bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE reservas    ADD COLUMN posicion bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE prestamos   ADD COLUMN posicion bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE incidencias ADD COLUMN posicion bigint GENERATED ALWAYS AS IDENTITY;
