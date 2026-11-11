// =====================================================================
// SERVIDOR DE CAMPUS PULSE
// ---------------------------------------------------------------------
// Express sirve el frontend (public/) y la API (/api/...).
// Todos los errores pasan por manejarErrores() y salen con el formato
// del contrato: { error: { codigo, mensaje } }.
// =====================================================================

import express from 'express';
import { fileURLToPath } from 'node:url';
import { ErrorApi } from './domain/errors.js';
import { prepararBase } from './data/arranque.js';
import { explicarErrorDeConexion } from './data/pg.js';
import espaciosRouter from './routes/espacios.js';
import recursosRouter from './routes/recursos.js';
import reservasRouter from './routes/reservas.js';
import prestamosRouter from './routes/prestamos.js';
import incidenciasRouter from './routes/incidencias.js';
import calidadRouter from './routes/calidad.js';
import restaurarRouter from './routes/restaurar.js';
import usuariosRouter from './routes/usuarios.js';
import iaRouter from './routes/ia.js';
import authRouter, { exigirRol, exigirSesion } from './routes/auth.js';

const CARPETA_PUBLICA = fileURLToPath(new URL('../public', import.meta.url));

export const app = express();

app.use(express.json());
app.use(express.static(CARPETA_PUBLICA));

// ---------- rutas de la API ----------
// Inicio de sesión: es lo único de /api que se puede usar sin sesión.
app.use('/api/auth', authRouter);
// Todo lo demás de /api exige una sesión válida (si no, 401).
app.use('/api', exigirSesion);

app.use('/api/espacios', espaciosRouter);
app.use('/api/recursos', recursosRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api/prestamos', prestamosRouter);
app.use('/api/incidencias', incidenciasRouter);
app.use('/api/calidad-datos', calidadRouter);
app.use('/api/restaurar', exigirRol('admin'), restaurarRouter); // borra reservas e incidencias: solo admin
app.use('/api/usuarios', exigirRol('admin'), usuariosRouter); // crear cuentas: solo admin
app.use('/api/ia', iaRouter); // dueño: P2

// Cualquier otra ruta /api que no exista responde 404 en formato JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: `No existe la ruta ${req.method} ${req.originalUrl}` } });
});

// ---------- manejador global de errores ----------

// Convierte cualquier error en { status, codigo, mensaje }.
function traducirError(error) {
  // Nuestros errores (409 regla, 422 datos, 404 no encontrado) y los de la IA (503)
  // traen status y codigo propios.
  if (error instanceof ErrorApi || (error.status && error.codigo)) {
    return { status: error.status, codigo: error.codigo, mensaje: error.message };
  }
  // JSON mal escrito en el cuerpo de la petición.
  if (error.type === 'entity.parse.failed') {
    return { status: 422, codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la petición no es un JSON válido' };
  }
  // Cualquier otro error es un fallo nuestro: se registra y se responde genérico.
  console.error('[server] Error inesperado:', error);
  return { status: 500, codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado en el servidor' };
}

// Express reconoce el manejador de errores porque recibe 4 parámetros.
// eslint-disable-next-line no-unused-vars
function manejarErrores(error, req, res, next) {
  const { status, codigo, mensaje } = traducirError(error);
  res.status(status).json({ error: { codigo, mensaje } });
}

app.use(manejarErrores);

// ---------- arranque ----------
// Solo escucha si se ejecuta directamente (npm start / npm run dev), no al importarlo en tests.
if (import.meta.main) {
  const PUERTO = process.env.PORT ?? 3000;
  // Aplica las migraciones y, la primera vez, carga la semilla. Sin PostgreSQL no tiene sentido arrancar.
  try {
    await prepararBase();
  } catch (error) {
    console.error(`[server] ${explicarErrorDeConexion(error)}`);
    process.exit(1);
  }
  app.listen(PUERTO, () => console.log(`Campus Pulse escuchando en http://localhost:${PUERTO}`));
}
