// =====================================================================
// ALMACÉN DE DATOS EN POSTGRESQL
// ---------------------------------------------------------------------
// Almacén de datos (reemplazó al viejo data/db.json). Interfaz asíncrona:
//   leerDB()              -> { espacios, recursos, reservas, prestamos, incidencias, calidadDatos }
//   actualizarDB(cambio)  -> lee, aplica "cambio(db)" y guarda, todo en una transacción
//   restaurarDB()         -> deja la base en el estado inicial (semilla)
// Las reglas de src/domain/ no cambian: siguen recibiendo y modificando un objeto "db".
//
// Cómo funciona actualizarDB ("foto + diferencias"):
//   1. BEGIN y bloqueo de escritura (solo una escritura a la vez).
//   2. Foto: se leen las tablas y se arma el objeto db.
//   3. Se llama a cambio(db): las reglas modifican db. Si lanzan un error, ROLLBACK y no se guarda nada.
//   4. Diferencias: se compara db con la foto y se hacen solo los INSERT, UPDATE y DELETE necesarios.
//   5. COMMIT.
// Con el bloqueo, las reglas ven siempre el estado más reciente, igual que con el viejo db.json (donde Node
// atendía una escritura a la vez). Si por algún motivo dos escrituras se cruzan, la restricción EXCLUDE
// de la base sigue impidiendo reservas solapadas: es la última defensa.
// =====================================================================

import { obtenerPool } from './pg.js';
import { sembrar } from './semilla.js';
import { espacios } from './repos/espacios.js';
import { incidencias } from './repos/incidencias.js';
import { prestamos } from './repos/prestamos.js';
import { recursos } from './repos/recursos.js';
import { reservas } from './repos/reservas.js';

// Orden de los padres a los hijos: los INSERT van en este orden y los DELETE en el inverso,
// para no romper las claves foráneas.
const REPOS = { espacios, recursos, reservas, prestamos, incidencias };
const NOMBRES = Object.keys(REPOS);
const BLOQUEO_ESCRITURA = 727275; // número cualquiera; distinto al de las migraciones

// ---------- lectura ----------

async function leerTodo(cliente) {
  const db = {};
  for (const nombre of NOMBRES) {
    const { rows } = await cliente.query(`SELECT * FROM ${REPOS[nombre].tabla} ORDER BY posicion`);
    db[nombre] = rows.map(REPOS[nombre].desdeFila);
  }
  const { rows } = await cliente.query('SELECT cargados, validos, inconsistentes FROM calidad_datos');
  db.calidadDatos = rows[0] ?? { cargados: 0, validos: 0, inconsistentes: [] };
  return db;
}

/** Devuelve toda la base. Las tablas se leen con una foto consistente (una sola transacción de solo lectura). */
export async function leerDB() {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const db = await leerTodo(cliente);
    await cliente.query('COMMIT');
    return db;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

// ---------- escritura: foto + diferencias ----------

// Guarda cada objeto como texto, por id, para poder detectar después cuáles cambiaron.
const fotografiar = (db) => Object.fromEntries(NOMBRES.map((n) => [n, new Map(db[n].map((o) => [o.id, JSON.stringify(o)]))]));

// Ejecuta una sentencia; si falla, deja que el repositorio la traduzca a un error de negocio.
async function ejecutar(cliente, repo, objeto, db, sql, valores) {
  try {
    await cliente.query(sql, valores);
  } catch (error) {
    throw repo.traducirError?.(error, objeto, db) ?? error;
  }
}

async function guardarDiferencias(cliente, antes, db) {
  const nuevos = [];
  const cambiados = [];
  const borrados = [];
  for (const nombre of NOMBRES) {
    const vistos = new Set();
    for (const objeto of db[nombre]) {
      vistos.add(objeto.id);
      const anterior = antes[nombre].get(objeto.id);
      if (anterior === undefined) nuevos.push([nombre, objeto]);
      else if (anterior !== JSON.stringify(objeto)) cambiados.push([nombre, objeto]);
    }
    for (const id of antes[nombre].keys()) if (!vistos.has(id)) borrados.push([nombre, id]);
  }

  for (const [nombre, objeto] of nuevos) {
    const { tabla, columnas, aFila } = REPOS[nombre];
    const marcas = columnas.map((_, i) => `$${i + 1}`).join(', ');
    await ejecutar(cliente, REPOS[nombre], objeto, db, `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${marcas})`, aFila(objeto));
  }
  for (const [nombre, objeto] of cambiados) {
    const { tabla, columnas, aFila } = REPOS[nombre];
    const asignaciones = columnas.slice(1).map((c, i) => `${c} = $${i + 2}`).join(', ');
    await ejecutar(cliente, REPOS[nombre], objeto, db, `UPDATE ${tabla} SET ${asignaciones} WHERE ${columnas[0]} = $1`, aFila(objeto));
  }
  for (const [nombre, id] of borrados.reverse()) {
    const { tabla, columnas } = REPOS[nombre];
    await cliente.query(`DELETE FROM ${tabla} WHERE ${columnas[0]} = $1`, [id]);
  }
}

/**
 * Lee la base, aplica un cambio y guarda las diferencias, todo en una transacción.
 * Si "cambio" lanza un error (por ejemplo una ReglaNegocioError) no se guarda nada.
 * Uso: const reserva = await actualizarDB((db) => crearReserva(db, datos));
 *
 * Las opciones son para los tests: serializar: false quita el bloqueo de escritura (para probar que
 * la restricción de la base basta por sí sola) y entreLecturaYEscritura es una función que se espera
 * después de leer y antes de aplicar el cambio (para forzar que dos escrituras se crucen).
 */
export async function actualizarDB(cambio, { serializar = true, entreLecturaYEscritura } = {}) {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    if (serializar) await cliente.query('SELECT pg_advisory_xact_lock($1)', [BLOQUEO_ESCRITURA]);
    const db = await leerTodo(cliente);
    const antes = fotografiar(db);
    await entreLecturaYEscritura?.();
    const resultado = await cambio(db);
    await guardarDiferencias(cliente, antes, db);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

/** Deja la base en el estado inicial (borra reservas, préstamos e incidencias; no toca las cuentas). */
export async function restaurarDB() {
  await sembrar(obtenerPool());
  return leerDB();
}
