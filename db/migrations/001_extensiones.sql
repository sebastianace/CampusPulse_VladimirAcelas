-- Extensiones que usa Campus Pulse.
-- vector:     embeddings para la búsqueda semántica (Fase 3).
-- btree_gist: permite usar "=" dentro de un índice gist; hace falta para la
--             restricción de no solapamiento de reservas (002_esquema.sql).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;
