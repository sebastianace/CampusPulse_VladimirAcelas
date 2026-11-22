// =====================================================================
// TESTS DEL LECTOR DE CSV (src/data/csv.js)
// ---------------------------------------------------------------------
// Excel en español guarda los CSV con ";" y, según la opción, en Windows-1252.
// Si el lector no lo maneja, "Micrófono" llega como "Micr?fono" o todo el
// archivo queda en una sola columna. No necesitan base de datos.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodificarTexto, detectarSeparador, leerCSV, parsearCSV } from '../src/data/csv.js';

const celdas = (texto, separador) => parsearCSV(texto, separador).registros.map((r) => r.celdas);

describe('decodificarTexto', () => {
  test('UTF-8 normal y UTF-8 con BOM (el "CSV UTF-8" de Excel) se leen igual', () => {
    const utf8 = Buffer.from('Micrófono;ñandú', 'utf8');
    assert.deepEqual(decodificarTexto(utf8), { texto: 'Micrófono;ñandú', codificacion: 'utf-8' });
    const conBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]);
    assert.deepEqual(decodificarTexto(conBom), { texto: 'Micrófono;ñandú', codificacion: 'utf-8' });
  });

  test('un archivo de Excel en Windows-1252 conserva las tildes y la ñ', () => {
    const ansi = Buffer.from('Micrófono;Cámara;Año', 'latin1'); // latin1 coincide con Windows-1252 en estas letras
    assert.deepEqual(decodificarTexto(ansi), { texto: 'Micrófono;Cámara;Año', codificacion: 'windows-1252' });
  });
});

describe('detectarSeparador', () => {
  test('elige ; , o tabulador según la línea de encabezado', () => {
    assert.equal(detectarSeparador('id;nombre;tipo\nA;B;C'), ';');
    assert.equal(detectarSeparador('id,nombre,tipo\nA,B,C'), ',');
    assert.equal(detectarSeparador('id\tnombre\ttipo\nA\tB\tC'), '\t');
  });

  test('ignora los separadores que están entre comillas y salta líneas vacías al inicio', () => {
    assert.equal(detectarSeparador('"a,b,c,d";x;y'), ';');
    assert.equal(detectarSeparador('\n\nid;nombre'), ';');
  });

  test('sin ningún separador usa la coma', () => {
    assert.equal(detectarSeparador('solo una columna\notra'), ',');
    assert.equal(detectarSeparador(''), ',');
  });
});

describe('parsearCSV', () => {
  test('separa filas y columnas, con CRLF, LF o CR', () => {
    for (const salto of ['\n', '\r\n', '\r']) {
      assert.deepEqual(celdas(`a;b${salto}c;d`, ';'), [['a', 'b'], ['c', 'd']], JSON.stringify(salto));
    }
  });

  test('un texto entre comillas puede llevar el separador, comillas dobles y saltos de línea', () => {
    assert.deepEqual(celdas('"Pantalla 55"", marca X";"dos\nlíneas";fin', ';'), [['Pantalla 55", marca X', 'dos\nlíneas', 'fin']]);
  });

  test('conserva las celdas vacías en su posición', () => {
    assert.deepEqual(celdas('a;;c\n;b;', ';'), [['a', '', 'c'], ['', 'b', '']]);
  });

  test('salta las filas vacías (Excel deja ";;;" al final) pero no las que tienen algo', () => {
    assert.deepEqual(celdas('id;nombre\nA;B\n;;\n\n   ;  \nC;D\n', ';'), [['id', 'nombre'], ['A', 'B'], ['C', 'D']]);
  });

  test('la línea de cada registro es la del archivo, aunque haya celdas con varias líneas', () => {
    const { registros } = parsearCSV('id;nota\nA;"uno\ndos"\n\nB;x', ';');
    assert.deepEqual(registros.map((r) => [r.linea, r.celdas[0]]), [[1, 'id'], [2, 'A'], [5, 'B']]);
  });

  test('una comilla sin cerrar da un error que dice en qué línea empezó', () => {
    assert.throws(() => parsearCSV('a;b\nc;"sin cerrar\nd;e', ';'), /comilla sin cerrar.*línea 2/);
  });

  test('una comilla en medio de una celda sin comillas es un carácter normal', () => {
    assert.deepEqual(celdas('Televisor 55";x', ';'), [['Televisor 55"', 'x']]);
  });

  test('sin salto de línea al final también lee el último registro', () => {
    assert.deepEqual(celdas('a;b\nc;d', ';'), [['a', 'b'], ['c', 'd']]);
  });
});

describe('leerCSV', () => {
  test('de bytes de Excel (Windows-1252, ";") a registros, detectando todo solo', () => {
    const bytes = Buffer.from('id;nombre\nEQ-1;Micrófono\n', 'latin1');
    const { codificacion, separador, registros } = leerCSV(bytes);
    assert.equal(codificacion, 'windows-1252');
    assert.equal(separador, ';');
    assert.deepEqual(registros.map((r) => r.celdas), [['id', 'nombre'], ['EQ-1', 'Micrófono']]);
  });
});
