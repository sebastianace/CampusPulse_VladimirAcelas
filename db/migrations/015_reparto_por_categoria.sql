-- Reparto automático de incidencias: en el campus hay 2 técnicos de TI y cada uno atiende una categoría
-- (infraestructura o tecnología). Esta tabla dice quién es el responsable de cada una; la administra un admin
-- desde la pestaña Usuarios. Sin fila, la categoría no tiene responsable y sus incidencias quedan sin asignar.
CREATE TABLE responsables_categoria (
  categoria text PRIMARY KEY CHECK (categoria IN ('infraestructura', 'tecnologia')),
  usuario   text NOT NULL REFERENCES usuarios (usuario) ON DELETE CASCADE
);

-- A quién le tocó la incidencia al crearla (o a quién la reasignó un admin). No es lo mismo que atendida_por:
-- asignada_a es el responsable; atendida_por es quien de verdad la tomó (puede ser otro si el responsable no está).
ALTER TABLE incidencias
  ADD COLUMN asignada_a text REFERENCES usuarios (usuario) ON DELETE SET NULL;
