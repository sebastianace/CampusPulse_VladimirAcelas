// =====================================================================
// TESTS DEL LECTOR DE EXCEL (.xlsx) (node:test)
// ---------------------------------------------------------------------
// El lector (src/data/xlsx.js) abre el ZIP, lee los textos, las horas y las celdas sin ninguna librería. Lo que
// más importa: que lea igual un Excel guardado por Excel (textos compartidos, horas como fracción del día)
// que uno de otra herramienta (textos en línea), que las horas salgan "07:00" y no "0.2916", y que un archivo
// dañado o malicioso falle con un mensaje claro en vez de colgar o llenar la memoria. Datos inventados.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { esXlsx, leerXlsx } from '../src/data/xlsx.js';
import { crearXlsx } from './ayuda-xlsx.js';

const FILAS = [
  ['Tipo', 'Sala', 'Hora inicio', 'Hora fin', 'Estudiantes', 'Grupo / Cohorte'],
  ['SER', 'Auditorio', { hora: '07:00' }, { hora: '08:00' }, 20, 'J2 Abr-26'],
  ['Inglés', 'Sala Azul', { hora: '18:15' }, { hora: '21:45' }, null, 'Grupo 4'],
];
const celdas = (xlsx, hoja = 0) => leerXlsx(xlsx).hojas[hoja].registros.map((r) => r.celdas);

describe('leer un .xlsx', () => {
  test('lee textos, números y horas; las horas salen HH:MM (no la fracción del día)', () => {
    const esperado = [
      ['Tipo', 'Sala', 'Hora inicio', 'Hora fin', 'Estudiantes', 'Grupo / Cohorte'],
      ['SER', 'Auditorio', '07:00', '08:00', '20', 'J2 Abr-26'],
      ['Inglés', 'Sala Azul', '18:15', '21:45', '', 'Grupo 4'],
    ];
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'Horarios', filas: FILAS }])), esperado, 'textos en línea');
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'Horarios', filas: FILAS }], { compartidos: true })), esperado, 'textos compartidos, como Excel');
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'Horarios', filas: FILAS }], { comprimir: false })), esperado, 'ZIP sin comprimir');
  });

  test('las horas con redondeo de coma flotante caen en el minuto exacto (0,29166… = 07:00)', () => {
    const horas = ['06:00', '07:15', '08:30', '13:45', '18:15', '21:45', '23:59'].map((hora) => ({ hora }));
    const leidas = celdas(crearXlsx([{ nombre: 'H', filas: [horas] }]))[0];
    assert.deepEqual(leidas, ['06:00', '07:15', '08:30', '13:45', '18:15', '21:45', '23:59']);
  });

  test('guarda el número de fila para decir "error en la línea 12", y salta las filas vacías', () => {
    const { hojas } = leerXlsx(crearXlsx([{ nombre: 'H', filas: [['A'], [null, null], ['B'], [], ['C']] }]));
    assert.deepEqual(hojas[0].registros.map((r) => [r.linea, r.celdas[0]]), [[1, 'A'], [3, 'B'], [5, 'C']]);
  });

  test('una celda vacía en el medio mantiene las columnas alineadas', () => {
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'H', filas: [['a', null, 'c']] }]))[0], ['a', '', 'c']);
  });

  test('una fórmula devuelve su último valor guardado (no se ejecuta nada)', () => {
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'H', filas: [[{ formula: 'J1 Dic-25' }]] }]))[0], ['J1 Dic-25']);
  });

  test('varias hojas: salen en el orden del libro y las ocultas no', () => {
    const { hojas } = leerXlsx(crearXlsx([
      { nombre: 'Horarios', filas: [['x']] },
      { nombre: 'Borrador', filas: [['y']], oculta: true },
      { nombre: 'Notas', filas: [['z']] },
    ]));
    assert.deepEqual(hojas.map((h) => h.nombre), ['Horarios', 'Notas']);
  });

  test('entidades XML y tildes se leen bien ("Tom & Jerry <3", "Micrófono")', () => {
    assert.deepEqual(celdas(crearXlsx([{ nombre: 'H', filas: [['Tom & Jerry <3', 'Micrófono "A"']] }], { compartidos: true }))[0], ['Tom & Jerry <3', 'Micrófono "A"']);
  });
});

describe('archivos que no son un Excel válido', () => {
  test('esXlsx distingue un ZIP de un CSV', () => {
    assert.equal(esXlsx(crearXlsx([{ nombre: 'H', filas: [['a']] }])), true);
    assert.equal(esXlsx(Buffer.from('Tipo;Sala;Hora inicio\r\nSER;Auditorio;07:00\r\n')), false);
    assert.equal(esXlsx(Buffer.from('')), false);
  });

  test('un archivo que empieza como ZIP pero está dañado falla con un mensaje claro (422)', () => {
    const bueno = crearXlsx([{ nombre: 'H', filas: [['a']] }]);
    for (const roto of [bueno.subarray(0, 40), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]), bueno.subarray(0, bueno.length - 10)]) {
      assert.throws(() => leerXlsx(roto), (e) => e.status === 422 && e.codigo === 'XLSX_INVALIDO' && /guárdalo de nuevo como \.xlsx/.test(e.message));
    }
  });

  test('un ZIP que se descomprime a más del límite (zip bomb) se rechaza sin llenar la memoria', () => {
    // 40 MB de ceros comprimen a unos 40 KB: el lector debe cortar en 30 MB
    const bomba = deflateRawSync(Buffer.alloc(40 * 1024 * 1024));
    assert.ok(bomba.length < 100 * 1024, 'la bomba pesa poco comprimida');
    assert.throws(() => leerXlsx(libroConHoja(bomba)), (e) => e.codigo === 'XLSX_INVALIDO' && /demasiado grande/.test(e.message));
  });

  test('un ZIP sin libro de Excel adentro se rechaza', () => {
    assert.throws(() => leerXlsx(crearZipSuelto({ 'hola.txt': 'hola' })), (e) => e.codigo === 'XLSX_INVALIDO');
  });
});

// ---------- ayudas para armar ZIPs raros ----------

/** Un ZIP con archivos sueltos (para probar uno que no es un Excel). */
function crearZipSuelto(archivos) {
  return zipConEntradas(Object.entries(archivos).map(([nombre, texto]) => ({ nombre, datos: Buffer.from(texto), comprimido: deflateRawSync(Buffer.from(texto)), tamano: Buffer.byteLength(texto) })));
}

/** Un libro válido cuya hoja 1 son estos bytes ya comprimidos (declara 40 MB sin comprimir). */
function libroConHoja(comprimidoDeLaHoja) {
  const libro = '<workbook xmlns:r="x"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
  const entradas = [
    { nombre: 'xl/workbook.xml', datos: Buffer.from(libro), comprimido: deflateRawSync(Buffer.from(libro)), tamano: libro.length },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: Buffer.from(rels), comprimido: deflateRawSync(Buffer.from(rels)), tamano: rels.length },
    { nombre: 'xl/worksheets/sheet1.xml', datos: Buffer.alloc(0), comprimido: comprimidoDeLaHoja, tamano: 40 * 1024 * 1024 },
  ];
  return zipConEntradas(entradas);
}

function zipConEntradas(entradas) {
  const locales = [];
  const centrales = [];
  let posicion = 0;
  for (const { nombre, datos, comprimido, tamano } of entradas) {
    const n = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(datos), 14);
    local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(tamano, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(tamano, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(posicion, 42);
    locales.push(local, n, comprimido);
    centrales.push(central, n);
    posicion += local.length + n.length + comprimido.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(posicion, 16);
  return Buffer.concat([...locales, dir, fin]);
}
