// =====================================================================
// ESTADO INICIAL DE LOS DATOS
// ---------------------------------------------------------------------
// Arma los espacios, recursos y el reporte de calidad desde:
//   data/raw/espacios.csv          capacidad oficial (NUNCA se modifica)
//   data/seed/espacios-extra.json  mesas de ping-pong (no están en el CSV oficial)
//   data/seed/recursos.json        equipos ficticios
// No toca ninguna base de datos: src/data/semilla.js lo carga en PostgreSQL.
// =====================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEspacios } from './loader.js';

// Carpeta raíz del proyecto (dos niveles arriba de src/data/).
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

export const RUTAS = {
  espaciosCSV: join(RAIZ, 'data', 'raw', 'espacios.csv'),
  recursosSeed: join(RAIZ, 'data', 'seed', 'recursos.json'),
  espaciosExtra: join(RAIZ, 'data', 'seed', 'espacios-extra.json'),
};

// Lee los recursos ficticios. Si el archivo falta o está roto, arranca sin recursos.
function cargarRecursos(idsEspacios) {
  try {
    const recursos = JSON.parse(readFileSync(RUTAS.recursosSeed, 'utf8'));
    // Un recurso que apunte a un espacio inexistente queda sin espacio.
    return recursos.map((r) => ({ ...r, espacioId: idsEspacios.has(r.espacioId) ? r.espacioId : null }));
  } catch (error) {
    console.warn(`[estado-inicial] No se pudieron cargar los recursos semilla: ${error.message}`);
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
    if (existsSync(RUTAS.espaciosExtra)) console.warn(`[estado-inicial] No se pudieron cargar los espacios extra: ${error.message}`);
    return [];
  }
}

/**
 * Arma la base completa desde raw/ y seed/, con las listas de movimientos vacías.
 * El reporte de calidad es solo del CSV oficial.
 */
export function crearEstadoInicial() {
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
