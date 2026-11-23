// =====================================================================
// DOMINIO: IMPORTAR EL INVENTARIO DESDE UN CSV
// ---------------------------------------------------------------------
// Para cargar el inventario real del campus (el que pasa Coordinación en una hoja de Excel) en lugar
// de los equipos de demostración. Trabaja sobre el objeto `db` como el resto de reglas de src/domain/:
// no toca la base. src/data/importar-inventario.js la llama con leerDB() (ensayo) o con
// actualizarDB() (aplicar): así hereda la transacción y el bloqueo de escritura de siempre.
//
// Reglas:
//   1. Ensayo primero: sin `aplicar` solo se informa qué pasaría.
//   2. Todo o nada: si una sola fila tiene un error, no se aplica ninguna. Es mejor arreglar el archivo
//      que dejar el inventario a medias.
//   3. La clave de cada equipo es su `id` (el código de inventario o placa). Con el mismo id, volver a
//      importar actualiza en lugar de duplicar (sin distinguir mayúsculas).
//   4. Un equipo que YA existe conserva su estado: el estado lo manda Soporte TI y las incidencias
//      abiertas (src/domain/inventario.js). El archivo solo actualiza nombre, tipo y sala.
//      Un equipo nuevo entra con el estado del archivo (o "disponible").
//   5. Los equipos de demostración ("ficticio") solo se quitan si se pide, y nunca los que ya tienen
//      incidencias o préstamos: dejarían huérfano ese historial.
//   6. Nunca se borra un equipo real por no aparecer en el archivo: solo se avisa cuántos faltan.
// =====================================================================

import { DatosInvalidosError } from './errors.js';

export const MAX_FILAS = 2000;

// Columnas que se entienden y los nombres con que pueden venir en el Excel (sin tildes, en minúscula).
export const COLUMNAS = {
  id: ['id', 'codigo', 'cod', 'placa', 'codigo de inventario', 'numero de inventario', 'no inventario', 'inventario'],
  nombre: ['nombre', 'equipo', 'descripcion', 'item', 'elemento', 'articulo', 'activo'],
  tipo: ['tipo', 'clase', 'categoria', 'tipo de equipo'],
  sala: ['sala', 'espacio', 'salon', 'ubicacion', 'lugar', 'aula'],
  estado: ['estado', 'condicion', 'estado actual'],
};
const OBLIGATORIAS = ['id', 'nombre'];

// Cómo puede venir escrito el estado (ya sin tildes ni mayúsculas) y a cuál de los del sistema equivale.
export const SINONIMOS_ESTADO = {
  disponible: 'disponible', bueno: 'disponible', bien: 'disponible', ok: 'disponible', operativo: 'disponible', funcional: 'disponible',
  funcionando: 'disponible', activo: 'disponible', 'en servicio': 'disponible',
  danado: 'danado', malo: 'danado', 'fuera de servicio': 'danado', inservible: 'danado', roto: 'danado',
  'en reparacion': 'en_reparacion', reparacion: 'en_reparacion', 'en mantenimiento': 'en_reparacion', mantenimiento: 'en_reparacion',
  en_reparacion: 'en_reparacion',
};
// Texto que significa "este equipo no tiene sala fija"
const SIN_SALA = new Set(['', '-', 'ninguna', 'ninguno', 'sin sala', 'n/a', 'na', 'portatil', 'movil']);

const FORMATO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
const LARGO_MAXIMO_NOMBRE = 120;
const LARGO_MAXIMO_TIPO = 40;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// ---------- normalizar texto ----------

/** Minúsculas, sin tildes y con todo lo que no es letra o número reducido a un espacio. */
export function plano(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Video Beam" -> "video_beam": como se guardan los tipos de equipo. */
export function tipoNormalizado(texto) {
  return plano(texto).replace(/ /g, '_').slice(0, LARGO_MAXIMO_TIPO);
}

function distancia(a, b) {
  // Distancia de Levenshtein: cuántas letras hay que cambiar, quitar o agregar para pasar de a a b
  const previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = previa[0];
    previa[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = previa[j];
      previa[j] = Math.min(previa[j] + 1, previa[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return previa[b.length];
}

// ---------- 1. de registros CSV a una tabla con columnas conocidas ----------

/**
 * Registros de src/data/csv.js -> {filas, columnas, ignoradas}.
 * La primera fila es el encabezado. Cada fila: {linea, id, nombre, tipo, sala, estado} con los textos tal cual venían
 * (recortados). Lanza DatosInvalidosError si falta una columna obligatoria o no hay datos.
 */
export function leerTabla(registros) {
  if (!registros.length) throw new DatosInvalidosError('El archivo está vacío.', 'ARCHIVO_VACIO');
  const [encabezado, ...datos] = registros;
  const nombres = encabezado.celdas.map((c) => plano(c));
  const columnas = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const posicion = nombres.findIndex((n) => alias.includes(n));
    if (posicion >= 0) columnas[campo] = posicion;
  }
  const faltan = OBLIGATORIAS.filter((c) => columnas[c] === undefined);
  if (faltan.length) {
    throw new DatosInvalidosError(
      `Faltan columnas obligatorias: ${faltan.join(', ')}. El archivo trae: ${encabezado.celdas.map((c) => `"${c.trim()}"`).join(', ')}. `
      + `Cada equipo necesita "id" (su código de inventario) y "nombre"; mira data/plantillas/inventario.csv.`, 'COLUMNAS_FALTANTES');
  }
  if (!datos.length) throw new DatosInvalidosError('El archivo solo tiene el encabezado: no hay equipos.', 'ARCHIVO_VACIO');
  if (datos.length > MAX_FILAS) {
    throw new DatosInvalidosError(`El archivo tiene ${datos.length} filas y el máximo es ${MAX_FILAS}. ¿Es el archivo correcto?`, 'DEMASIADAS_FILAS');
  }
  const usadas = new Set(Object.values(columnas));
  const ignoradas = encabezado.celdas.map((c, i) => [c.trim(), i]).filter(([c, i]) => c && !usadas.has(i)).map(([c]) => c);
  const celda = (r, campo) => (columnas[campo] === undefined ? '' : String(r.celdas[columnas[campo]] ?? '').trim());
  const filas = datos.map((r) => ({ linea: r.linea, id: celda(r, 'id'), nombre: celda(r, 'nombre'), tipo: celda(r, 'tipo'), sala: celda(r, 'sala'), estado: celda(r, 'estado') }));
  return { filas, columnas: Object.keys(columnas), ignoradas };
}

// ---------- 2. validar cada fila ----------

function buscarSala(texto, espacios) {
  const buscado = plano(texto).replace(/^(sala|salon|aula) /, '');
  const claves = (e) => [plano(e.id), plano(e.nombre), plano(e.nombre).replace(/^(sala|salon|aula) /, '')];
  const exacta = espacios.find((e) => claves(e).includes(buscado));
  if (exacta) return { espacio: exacta };
  // No se adivina: se sugiere la más parecida (hasta 2 letras de diferencia, o una contenida en la otra)
  const cercana = espacios
    .map((e) => ({ e, d: Math.min(...claves(e).map((k) => (k && (k.includes(buscado) || buscado.includes(k)) ? 1 : distancia(k, buscado)))) }))
    .filter(({ d }) => d <= 2).sort((a, b) => a.d - b.d)[0];
  return { sugerencia: cercana?.e };
}

/** Valida una fila. Devuelve {recurso} (con la forma de db.recursos) o {errores: [texto]}. */
function validarFila(fila, espacios) {
  const errores = [];
  if (!FORMATO_ID.test(fila.id)) {
    errores.push(fila.id
      ? `el código "${fila.id}" no sirve: usa de 2 a 40 letras, números, punto o guion (ej. EQ-001)`
      : 'falta el código del equipo (columna "id"): es lo que identifica al equipo si se vuelve a importar');
  }
  const nombre = fila.nombre.replace(/\s+/g, ' ');
  if (!nombre) errores.push('falta el nombre del equipo');
  else if (nombre.length > LARGO_MAXIMO_NOMBRE) errores.push(`el nombre es muy largo (${nombre.length} letras; máximo ${LARGO_MAXIMO_NOMBRE})`);

  const tipo = tipoNormalizado(fila.tipo) || 'otro';

  let espacioId = null;
  if (!SIN_SALA.has(plano(fila.sala))) {
    const { espacio, sugerencia } = buscarSala(fila.sala, espacios);
    if (espacio) espacioId = espacio.id;
    else errores.push(`la sala "${fila.sala}" no existe${sugerencia ? `. ¿Quisiste decir "${sugerencia.nombre}"?` : ''}`);
  }

  let estado = 'disponible';
  if (fila.estado) {
    estado = SINONIMOS_ESTADO[plano(fila.estado)];
    if (!estado) errores.push(`el estado "${fila.estado}" no se entiende. Usa: disponible, dañado o en reparación`);
  }
  return errores.length ? { errores } : { recurso: { id: fila.id, nombre, tipo, espacioId, estado } };
}

// ---------- 3. el informe y los cambios ----------

const nombreSala = (db, id) => (id ? db.espacios.find((e) => e.id === id)?.nombre ?? id : 'sin sala');

/**
 * Importa el inventario. `tabla` es lo que devuelve leerTabla().
 * Opciones: {aplicar = false, quitarFicticios = false}. Sin `aplicar` no modifica `db`.
 * Con `aplicar`, solo modifica `db` si no hay ningún error.
 * Devuelve el informe: {aplicado, total, nuevos, actualizados, sinCambios, estadoConservado, errores, avisos, ficticios, ausentes}.
 */
export function importarInventario(db, tabla, { aplicar = false, quitarFicticios = false } = {}) {
  const errores = [];
  const nuevos = [];
  const actualizados = [];
  let sinCambios = 0;
  let estadoConservado = 0;
  const vistos = new Map(); // id en minúscula -> línea donde apareció
  const aActualizar = [];

  for (const fila of tabla.filas) {
    const { recurso, errores: malos } = validarFila(fila, db.espacios);
    if (malos) {
      malos.forEach((mensaje) => errores.push({ linea: fila.linea, mensaje }));
      continue;
    }
    const clave = recurso.id.toLowerCase();
    if (vistos.has(clave)) {
      errores.push({ linea: fila.linea, mensaje: `el código "${recurso.id}" ya apareció en la línea ${vistos.get(clave)}: cada equipo debe tener un código distinto` });
      continue;
    }
    vistos.set(clave, fila.linea);

    const existente = db.recursos.find((r) => r.id.toLowerCase() === clave);
    if (!existente) {
      nuevos.push(recurso);
      continue;
    }
    if (existente.estado !== recurso.estado && fila.estado) estadoConservado += 1;
    const cambios = [];
    if (existente.nombre !== recurso.nombre) cambios.push(`nombre: "${existente.nombre}" → "${recurso.nombre}"`);
    if (existente.tipo !== recurso.tipo) cambios.push(`tipo: ${existente.tipo} → ${recurso.tipo}`);
    if ((existente.espacioId ?? null) !== recurso.espacioId) cambios.push(`sala: ${nombreSala(db, existente.espacioId)} → ${nombreSala(db, recurso.espacioId)}`);
    // Un equipo de demostración que aparece en el archivo pasa a ser real aunque no cambie nada
    if (existente.ficticio) cambios.push('deja de ser de demostración');
    if (cambios.length) {
      actualizados.push({ id: existente.id, nombre: recurso.nombre, cambios });
      aActualizar.push({ existente, recurso });
    } else {
      sinCambios += 1;
    }
  }

  // Equipos de demostración: los que ya están en el archivo se vuelven reales y no cuentan aquí
  const enElArchivo = new Set(vistos.keys());
  const demostracion = db.recursos.filter((r) => r.ficticio && !enElArchivo.has(r.id.toLowerCase()));
  const conHistorial = (r) => db.incidencias.some((i) => i.recursoId === r.id) || (db.prestamos ?? []).some((p) => p.recursoId === r.id);
  const ficticios = {
    hay: demostracion.length,
    aQuitar: quitarFicticios ? demostracion.filter((r) => !conHistorial(r)).map((r) => r.id) : [],
    conservados: quitarFicticios ? demostracion.filter(conHistorial).map((r) => r.id) : [],
  };
  const avisos = [];
  if (demostracion.length && !quitarFicticios) {
    avisos.push(`Hay ${plural(demostracion.length, 'equipo', 'equipos')} de demostración en la base. Si este archivo es el inventario real, agrega --quitar-ficticios para quitarlos.`);
  }
  if (ficticios.conservados.length) {
    avisos.push(`No se ${ficticios.conservados.length === 1 ? 'quita' : 'quitan'} ${plural(ficticios.conservados.length, 'equipo', 'equipos')} de demostración porque ya ${ficticios.conservados.length === 1 ? 'tiene' : 'tienen'} incidencias: ${ficticios.conservados.join(', ')}.`);
  }
  if (estadoConservado) avisos.push(`${plural(estadoConservado, 'equipo ya existía', 'equipos ya existían')} con otro estado: se conserva el de la base (el estado se cambia en Inventario o con una incidencia).`);
  if (tabla.ignoradas.length) avisos.push(`Columnas que no se usan: ${tabla.ignoradas.join(', ')}.`);

  // Equipos reales de la base que el archivo no menciona: solo se cuentan
  const ausentes = db.recursos.filter((r) => !r.ficticio && !enElArchivo.has(r.id.toLowerCase())).length;

  const informe = { aplicado: false, total: tabla.filas.length, nuevos: nuevos.map((r) => ({ ...r, sala: nombreSala(db, r.espacioId) })), actualizados, sinCambios, estadoConservado, errores, avisos, ficticios, ausentes };
  if (aplicar && !errores.length) {
    for (const { existente, recurso } of aActualizar) {
      Object.assign(existente, { nombre: recurso.nombre, tipo: recurso.tipo, espacioId: recurso.espacioId });
      delete existente.ficticio; // lo que está en el archivo es real
    }
    // Se modifica el arreglo en su sitio (como el resto de reglas): actualizarDB compara contra la foto por id
    const quitar = new Set(ficticios.aQuitar);
    for (let i = db.recursos.length - 1; i >= 0; i--) if (quitar.has(db.recursos[i].id)) db.recursos.splice(i, 1);
    db.recursos.push(...nuevos);
    informe.aplicado = true;
  }
  return informe;
}

