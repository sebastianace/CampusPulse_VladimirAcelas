-- Cuentas: quién creó cada una y contraseñas temporales.
-- creado_por: el admin que creó la cuenta. null = la primera cuenta (se registró sola desde la pantalla de
--   inicio) o una cuenta anterior a esta migración.
-- debe_cambiar_clave: true cuando un admin (o npm run restablecer-admin) le puso una contraseña temporal;
--   la persona no puede usar la app hasta cambiarla.
ALTER TABLE usuarios
  ADD COLUMN creado_por         text REFERENCES usuarios (usuario) ON DELETE SET NULL,
  ADD COLUMN debe_cambiar_clave boolean NOT NULL DEFAULT false;
