-- incidencias_notificaciones: a quién avisó n8n de cada incidencia y por qué canal.
-- n8n recibe un webhook firmado cuando se crea una incidencia, avisa al área responsable y llama de vuelta
-- a Campus Pulse (POST /api/integraciones/incidencias/:id/notificada) para dejar constancia aquí.
CREATE TABLE incidencias_notificaciones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incidencia_id text NOT NULL REFERENCES incidencias (id) ON DELETE CASCADE,
  canal         text NOT NULL CHECK (canal IN ('correo', 'telegram')),
  destinatario  text NOT NULL,
  area          text NOT NULL CHECK (area IN ('Infraestructura', 'Soporte TI', 'Servicios generales', 'Seguridad', 'Bienestar')),
  enviado       timestamp NOT NULL,   -- hora local de Bogotá, como el resto de las fechas
  -- n8n reintenta las llamadas que fallan: el mismo aviso no se registra dos veces
  UNIQUE (incidencia_id, canal, destinatario)
);
