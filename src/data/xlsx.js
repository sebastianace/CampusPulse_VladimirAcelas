// =====================================================================
// LECTOR DE EXCEL (.xlsx) SIN LIBRERÍAS
// ---------------------------------------------------------------------
// Un .xlsx es un ZIP con XML adentro. Para leer una hoja como tabla basta con:
//   1. Abrir el ZIP (node:zlib ya sabe descomprimir; el ZIP se recorre por su "directorio central").
//   2. xl/workbook.xml          -> los nombres de las hojas y a qué archivo corresponde cada una.
//   3. xl/sharedStrings.xml     -> la tabla de textos (Excel guarda cada texto una sola vez y las celdas apuntan a él).
//   4. xl/styles.xml            -> para saber qué celdas son HORAS: Excel guarda 07:00 como el número 0,2916…
//                                  (la fracción del día) y solo el formato de la celda dice que es una hora.
//   5. xl/worksheets/sheetN.xml -> las filas y celdas.
// Devuelve los mismos "registros" que src/data/csv.js ({linea, celdas: [texto]}), así el resto del importador
// no sabe de qué formato vino la tabla. Solo lee: nunca ejecuta macros ni fórmulas (usa el último valor guardado).
// Límites contra archivos maliciosos (un ZIP que se descomprime a gigas): tamaño máximo por entrada y de filas.
// =====================================================================

import { inflateRawSync } from 'node:zlib';
import { DatosInvalidosError } from '../domain/errors.js';

const MAX_BYTES_POR_ENTRADA = 30 * 1024 * 1024;
const MAX_FILAS = 20000;
const MAX_COLUMNAS = 200;

const invalido = (detalle) => new DatosInvalidosError(`No se pudo leer el archivo de Excel (${detalle}). Ábrelo en Excel y guárdalo de nuevo como .xlsx.`, 'XLSX_INVALIDO');

/** ¿Estos bytes son un .xlsx (o cualquier ZIP)? Los CSV nunca empiezan con "PK\x03\x04". */
export const esXlsx = (bytes) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

// ---------- 1. el ZIP ----------

/** ZIP -> Map(nombre -> () => Buffer descomprimido). */
function abrirZip(buf) {
  const minimo = Math.max(0, buf.length - 22 - 65535);
  let fin = -1;
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw invalido('no es un ZIP válido');
  const entradas = buf.readUInt16LE(fin + 10);
  let posicion = buf.readUInt32LE(fin + 16);
  if (entradas === 0xffff || posicion === 0xffffffff) throw invalido('ZIP64 no está soportado');

  const archivos = new Map();
  for (let n = 0; n < entradas; n++) {
    if (posicion + 46 > buf.length || buf.readUInt32LE(posicion) !== 0x02014b50) throw invalido('directorio del ZIP dañado');
    const metodo = buf.readUInt16LE(posicion + 10);
    const comprimido = buf.readUInt32LE(posicion + 20);
    const largoNombre = buf.readUInt16LE(posicion + 28);
    const largoExtra = buf.readUInt16LE(posicion + 30);
    const largoComentario = buf.readUInt16LE(posicion + 32);
    const local = buf.readUInt32LE(posicion + 42);
    const nombre = buf.toString('utf8', posicion + 46, posicion + 46 + largoNombre);
    posicion += 46 + largoNombre + largoExtra + largoComentario;

    archivos.set(nombre, () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw invalido(`entrada "${nombre}" dañada`);
      const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const datos = buf.subarray(inicio, inicio + comprimido);
      if (metodo === 0) return datos;
      if (metodo !== 8) throw invalido(`compresión ${metodo} no soportada`);
      try {
        return inflateRawSync(datos, { maxOutputLength: MAX_BYTES_POR_ENTRADA });
      } catch {
        throw invalido(`"${nombre}" está dañado o es demasiado grande`);
      }
    });
  }
  return archivos;
}

// ---------- 2. utilidades de XML (el XML de Excel es regular: bastan expresiones regulares) ----------

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (texto) => texto.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
  if (e[0] !== '#') return ENTIDADES[e];
  const codigo = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return codigo >= 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : m;
});

/** Atributos de una etiqueta: ' r="A1" t="s"' -> {r: 'A1', t: 's'}. */
function atributos(texto) {
  const resultado = {};
  for (const [, nombre, valor] of texto.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) resultado[nombre] = decodificar(valor);
  return resultado;
}

/** Todos los textos <t> de un fragmento (un <si> o un <is>), sin la pronunciación fonética (<rPh>). */
function textosDe(fragmento) {
  const limpio = fragmento.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...limpio.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => decodificar(m[1] ?? '')).join('');
}

// ---------- 3. libro, textos y estilos ----------

function leerTextos(archivos) {
  const leer = archivos.get('xl/sharedStrings.xml');
  if (!leer) return [];
  const xml = leer().toString('utf8');
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textosDe(m[1] ?? ''));
}

const FORMATOS_HORA = new Set([18, 19, 20, 21, 45, 46, 47]); // los de hora que trae Excel de fábrica

/** Para cada estilo de celda (el atributo s=), ¿es una hora? */
function leerEstilosDeHora(archivos) {
  const leer = archivos.get('xl/styles.xml');
  if (!leer) return [];
  const xml = leer().toString('utf8');
  const personalizados = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1]);
    if (a.numFmtId) personalizados.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const esHora = (id) => {
    if (FORMATOS_HORA.has(id)) return true;
    const codigo = (personalizados.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').toLowerCase();
    return /[hs]/.test(codigo) && !/[yd]/.test(codigo); // "HH:MM", "h:mm AM/PM"; no "dd/mm/yyyy hh:mm" (una fecha)
  };
  const bloque = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...bloque.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => esHora(Number(atributos(m[1]).numFmtId ?? 0)));
}

/** [{nombre, ruta}] en el orden del libro. */
function leerHojas(archivos) {
  const libro = archivos.get('xl/workbook.xml');
  if (!libro) throw invalido('no tiene hojas');
  const rels = new Map();
  const relsXml = archivos.get('xl/_rels/workbook.xml.rels')?.().toString('utf8') ?? '';
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const hojas = [];
  for (const m of libro().toString('utf8').matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1]);
    const ruta = rels.get(a['r:id']);
    if (a.name && ruta && archivos.has(ruta) && a.state !== 'hidden' && a.state !== 'veryHidden') hojas.push({ nombre: a.name, ruta });
  }
  if (!hojas.length) throw invalido('no tiene hojas visibles');
  return hojas;
}

// ---------- 4. las celdas ----------

const columnaDe = (referencia) => {
  let n = 0;
  for (const c of referencia.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '') n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** 0,2916… -> "07:00" (se redondea al minuto: 0,2916666666666667 * 1440 da 420,0000000000001). */
function horaDeFraccion(numero) {
  const minutos = Math.round((numero - Math.floor(numero)) * 1440) % 1440;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

function valorDeCelda({ tipo, estilo }, interior, textos, estilosDeHora) {
  const v = interior.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  switch (tipo) {
    case 's': return textos[Number(v)] ?? '';
    case 'inlineStr': return textosDe(interior.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? '');
    case 'str': return decodificar(v ?? '');
    case 'b': return v === '1' ? 'VERDADERO' : 'FALSO';
    case 'e': return '';
    default: {
      if (v === undefined || v === '') return '';
      const numero = Number(v);
      if (!Number.isFinite(numero)) return decodificar(v);
      return estilosDeHora[estilo] ? horaDeFraccion(numero) : String(numero);
    }
  }
}

/** Una hoja -> registros [{linea, celdas}] (las filas vacías se saltan, como en el CSV). */
function leerHoja(xml, textos, estilosDeHora) {
  const registros = [];
  let filaAnterior = 0;
  for (const fila of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const numeroFila = Number(atributos(fila[1]).r) || filaAnterior + 1;
    filaAnterior = numeroFila;
    if (registros.length >= MAX_FILAS) throw invalido(`más de ${MAX_FILAS} filas`);
    const celdas = [];
    let columnaAnterior = -1;
    for (const c of (fila[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = atributos(c[1]);
      const columna = a.r ? columnaDe(a.r) : columnaAnterior + 1;
      columnaAnterior = columna;
      if (columna < 0 || columna >= MAX_COLUMNAS) continue;
      while (celdas.length < columna) celdas.push('');
      celdas[columna] = valorDeCelda({ tipo: a.t, estilo: Number(a.s ?? 0) }, c[2] ?? '', textos, estilosDeHora).trim();
    }
    if (celdas.some((c) => c !== '')) registros.push({ linea: numeroFila, celdas });
  }
  return registros;
}

/**
 * Bytes de un .xlsx -> {hojas: [{nombre, registros}]} (solo las hojas visibles, en el orden del libro).
 * Lanza DatosInvalidosError (422 XLSX_INVALIDO) si el archivo está dañado.
 */
export function leerXlsx(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const archivos = abrirZip(buf);
  const textos = leerTextos(archivos);
  const estilosDeHora = leerEstilosDeHora(archivos);
  return {
    hojas: leerHojas(archivos).map(({ nombre, ruta }) => ({
      nombre,
      registros: leerHoja(archivos.get(ruta)().toString('utf8'), textos, estilosDeHora),
    })),
  };
}
