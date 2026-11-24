-- Correo de cada cuenta, para los avisos por correo (n8n) cuando cambia algo que le toca a la persona:
-- le piden su salón, le aprueban o rechazan una solicitud, o alguien más le cambia o cancela una reserva.
-- Es opcional: sin correo, la persona sigue recibiendo los avisos dentro de la app.
ALTER TABLE usuarios
  ADD COLUMN correo text CHECK (correo IS NULL OR correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
