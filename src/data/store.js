// =====================================================================
// ALMACÉN DE DATOS (data/db.json)
// ---------------------------------------------------------------------
// - Si db.json no existe, se crea desde data/raw/espacios.csv,
//   data/seed/espacios-extra.json (mesas de ping-pong) y data/seed/recursos.json.
// - Escritura atómica: se escribe un archivo temporal y luego se
//   renombra encima de db.json. Si el proceso muere a mitad, db.json
//   queda con la versión anterior completa, nunca a medias.
// - Se usan funciones síncronas a propósito: Node atiende una petición
//   a la vez dentro de cada leer-modificar-guardar, así dos peticiones
//   no pueden mezclar sus escrituras.
// - data/raw/ NUNCA se modifica.
// =====================================================================

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEspacios } from './loader.js';

// Carpeta raíz del proyecto (dos niveles arriba de src/data/).
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

// Rutas de los archivos. DB_PATH permite usar otra base en los tests.
export const RUTAS = {
  db: process.env.DB_PATH ?? join(RAIZ, 'data', 'db.json'),
  espaciosCSV: join(RAIZ, 'data', 'raw', 'espacios.csv'),
  recursosSeed: join(RAIZ, 'data', 'seed', 'recursos.json'),
  espaciosExtra: join(RAIZ, 'data', 'seed', 'espacios-extra.json'),
};

// ---------- construcción del estado inicial ----------

// Lee los recursos ficticios. Si el archivo falta o está roto, arranca sin recursos.
function cargarRecursos(idsEspacios) {
  try {
    const recursos = JSON.parse(readFileSync(RUTAS.recursosSeed, 'utf8'));
    // Un recurso que apunte a un espacio inexistente queda sin espacio.
    return recursos.map((r) => ({ ...r, espacioId: idsEspacios.has(r.espacioId) ? r.espacioId : null }));
  } catch (error) {
    console.warn(`[store] No se pudieron cargar los recursos semilla: ${error.message}`);
    return [];
  }
}

// Espacios reservables que no están en el CSV oficial (las mesas de ping-pong de Hunters).
// Un id que ya exista en el CSV se ignora: el oficial manda. Si el archivo falta, no hay extras.
function cargarEspaciosExtra(idsOficiales) {
  try {
    const extras = JSON.parse(readFileSync(RUTAS.espaciosExtra, 'utf8'));
    return extras.filter((e) => e?.id && !idsOficiales.has(e.id) && Number.isInteger(e.aforo) && e.aforo > 0);
  } catch (error) {
    if (existsSync(RUTAS.espaciosExtra)) console.warn(`[store] No se pudieron cargar los espacios extra: ${error.message}`);
    return [];
  }
}

// Arma la base completa desde raw/ y seed/, con las listas de movimientos vacías.
// El reporte de calidad es solo del CSV oficial.
function crearEstadoInicial() {
  const { espacios: oficiales, calidad } = cargarEspacios(RUTAS.espaciosCSV);
  const espacios = [...oficiales, ...cargarEspaciosExtra(new Set(oficiales.map((e) => e.id)))];
  const idsEspacios = new Set(espacios.map((e) => e.id));
  return {
    espacios,
    recursos: cargarRecursos(idsEspacios),
    reservas: [],
    prestamos: [],
    incidencias: [],
    calidadDatos: calidad,
  };
}

// ---------- lectura y escritura ----------

/** Guarda la base completa de forma atómica (temporal + rename). */
export function guardarDB(db) {
  mkdirSync(dirname(RUTAS.db), { recursive: true });
  const temporal = `${RUTAS.db}.${process.pid}.tmp`;
  writeFileSync(temporal, JSON.stringify(db, null, 2), 'utf8');
  renameSync(temporal, RUTAS.db);
}

/** Recrea db.json desde raw/ y seed/ (lo usa POST /api/restaurar). */
export function restaurarDB() {
  const db = crearEstadoInicial();
  guardarDB(db);
  return db;
}

/**
 * Devuelve la base completa. Si db.json no existe la crea; si está
 * corrupto lo respalda como db.corrupto-<fecha>.json y la recrea.
 */
export function leerDB() {
  if (!existsSync(RUTAS.db)) return restaurarDB();
  try {
    return JSON.parse(readFileSync(RUTAS.db, 'utf8'));
  } catch (error) {
    const respaldo = `${RUTAS.db.replace(/\.json$/, '')}.corrupto-${Date.now()}.json`;
    console.warn(`[store] db.json corrupto (${error.message}). Respaldo en ${respaldo}`);
    renameSync(RUTAS.db, respaldo);
    return restaurarDB();
  }
}

/**
 * Lee la base, aplica un cambio y la guarda en un solo paso.
 * Si "cambio" lanza un error (por ejemplo una ReglaNegocioError),
 * no se guarda nada.
 * Uso: const reserva = actualizarDB((db) => { db.reservas.push(r); return r; });
 */
export function actualizarDB(cambio) {
  const db = leerDB();
  const resultado = cambio(db);
  guardarDB(db);
  return resultado;
}
