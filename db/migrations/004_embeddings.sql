-- Incidencias parecidas (Fase 3B).
--
-- incidencias_embeddings: el embedding del texto de cada incidencia, para buscar las parecidas por
-- significado. Se guarda aparte de "incidencias" porque el vector se calcula con un servicio externo
-- (Gemini) que puede fallar: una incidencia existe aunque todavía no tenga embedding.
--   - vector(768): gemini-embedding-001 devuelve 3072 por defecto, pero un índice HNSW de "vector" no
--     admite más de 2000 dimensiones; el modelo permite pedir 768 y alcanza para textos cortos.
--   - modelo: con qué modelo se generó. Vectores de modelos distintos no se pueden comparar.
CREATE TABLE incidencias_embeddings (
  incidencia_id text PRIMARY KEY REFERENCES incidencias (id) ON DELETE CASCADE,
  embedding     vector(768) NOT NULL,
  modelo        text NOT NULL,
  creado        timestamptz NOT NULL DEFAULT now()
);
-- HNSW con distancia coseno (operador <=>): la similitud es 1 - distancia.
CREATE INDEX incidencias_embeddings_hnsw_idx ON incidencias_embeddings USING hnsw (embedding vector_cosine_ops);

-- incidencias_reportes: cuando alguien confirma que su reporte es "la misma" incidencia que una que ya
-- existe, no se crea un duplicado: su reporte se suma aquí (quién, cuándo y qué escribió).
CREATE TABLE incidencias_reportes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incidencia_id text NOT NULL REFERENCES incidencias (id) ON DELETE CASCADE,
  descripcion   text NOT NULL,
  reportado_por text NOT NULL REFERENCES usuarios (usuario),
  fecha         timestamp NOT NULL   -- hora local de Bogotá, como el resto de las fechas
);
CREATE INDEX incidencias_reportes_incidencia_idx ON incidencias_reportes (incidencia_id);
