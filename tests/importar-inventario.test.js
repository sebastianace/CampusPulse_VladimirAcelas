// =====================================================================
// TESTS DE IMPORTAR EL INVENTARIO (node:test)
// ---------------------------------------------------------------------
// El inventario real llega en una hoja de Excel y reemplaza a los equipos de demostración. Lo que más
// importa: un error en una fila no deja el inventario a medias, volver a importar no duplica, el estado
// de lo que ya existe no se pisa y no se rompe el historial de incidencias.
// Las reglas se prueban sin base; el recorrido completo, contra una base PostgreSQL temporal.
// =====================================================================

import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
after(() => bd.cerrar());
const { sembrar } = await import('../src/data/semilla.js');
const { actualizarDB, leerDB } = await import('../src/data/almacen.js');
const { ESTADOS_RECURSO } = await import('../src/config/reglas.js');
const { crearIncidencia } = await import('../src/domain/incidencias.js');
const { COLUMNAS, SINONIMOS_ESTADO, importarInventario, leerTabla, plano, tipoNormalizado } = await import('../src/domain/inventario-importar.js');
const { importarInventarioDesdeCSV, formatearInforme } = await import('../src/data/importar-inventario.js');
const { parsearCSV } = await import('../src/data/csv.js');

// Tabla lista para importar, armada con el mismo código que lee un CSV.
const tabla = (...lineas) => leerTabla(parsearCSV(['id;nombre;tipo;sala;estado', ...lineas].join('\n'), ';').registros);

function crearDB() {
  return {
    espacios: [
      { id: 'apolo', nombre: 'Apolo', estado: 'disponible' },
      { id: 'auditorio', nombre: 'Auditorio', estado: 'disponible' },
      { id: 'skilab', nombre: 'Skylabs', estado: 'disponible' },
      { id: 'amarillas-verdes', nombre: 'Salas amarillas y verdes', estado: 'disponible' },
    ],
    recursos: [
      { id: 'rec-01', nombre: 'Video beam demo', tipo: 'video_beam', espacioId: 'apolo', estado: 'disponible', ficticio: true },
      { id: 'rec-02', nombre: 'Micrófono demo', tipo: 'microfono', espacioId: 'auditorio', estado: 'disponible', ficticio: true },
      { id: 'EQ-100', nombre: 'Cámara real', tipo: 'camara', espacioId: 'apolo', estado: 'danado' },
    ],
    reservas: [], prestamos: [], incidencias: [],
  };
}

describe('leerTabla', () => {
  test('entiende los nombres de columna que usa Excel (con tildes, mayúsculas y sinónimos)', () => {
    const { filas, columnas, ignoradas } = leerTabla(parsearCSV('Código;Equipo;Categoría;Ubicación;Condición;Serial\nA-1;Mic;Audio;Apolo;Bueno;X99', ';').registros);
    assert.deepEqual(columnas.sort(), ['estado', 'id', 'nombre', 'sala', 'tipo']);
    assert.deepEqual(ignoradas, ['Serial']);
    assert.deepEqual(filas[0], { linea: 2, id: 'A-1', nombre: 'Mic', tipo: 'Audio', sala: 'Apolo', estado: 'Bueno' });
  });

  test('sin "id" o sin "nombre" explica qué falta y qué columnas trae el archivo', () => {
    assert.throws(() => leerTabla(parsearCSV('Equipo;Sala\nMic;Apolo', ';').registros), /Faltan columnas obligatorias: id.*"Equipo", "Sala"/);
  });

  test('un archivo vacío o solo con encabezado es un error claro', () => {
    assert.throws(() => leerTabla([]), /vacío/);
    assert.throws(() => leerTabla(parsearCSV('id;nombre', ';').registros), /solo tiene el encabezado/);
  });

  test('los alias están normalizados (sin tildes ni mayúsculas): si no, nunca coincidirían', () => {
    for (const alias of Object.values(COLUMNAS).flat()) assert.equal(plano(alias), alias, alias);
  });
});

describe('importarInventario: lo básico', () => {
  test('equipo nuevo, equipo que cambia y equipo igual', () => {
    const db = crearDB();
    const informe = importarInventario(db, tabla(
      'EQ-200;Video beam Epson;Video Beam;Apolo;disponible',
      'EQ-100;Cámara real;camara;Apolo;',                  // igual
      'rec-02;Otro;otro;;'),                                // existe: cambia de nombre, tipo y sala
    { aplicar: true });
    assert.equal(informe.aplicado, true);
    assert.deepEqual(informe.nuevos.map((n) => [n.id, n.tipo, n.sala, n.estado]), [['EQ-200', 'video_beam', 'Apolo', 'disponible']]);
    assert.equal(informe.sinCambios, 1);
    assert.equal(informe.actualizados.length, 1);
    assert.deepEqual(db.recursos.map((r) => r.id), ['rec-01', 'rec-02', 'EQ-100', 'EQ-200']);
    assert.deepEqual(db.recursos.find((r) => r.id === 'rec-02'), { id: 'rec-02', nombre: 'Otro', tipo: 'otro', espacioId: null, estado: 'disponible' });
  });

  test('el ensayo (sin aplicar) no modifica nada', () => {
    const db = crearDB();
    const antes = JSON.stringify(db);
    const informe = importarInventario(db, tabla('EQ-200;Nuevo;portatil;;', 'rec-01;Cambiado;video_beam;Apolo;'));
    assert.equal(informe.aplicado, false);
    assert.equal(informe.nuevos.length, 1);
    assert.equal(informe.actualizados.length, 1);
    assert.equal(JSON.stringify(db), antes);
  });

  test('volver a importar el mismo archivo no duplica ni cambia nada (el código de inventario es la clave, sin distinguir mayúsculas)', () => {
    const db = crearDB();
    const archivo = tabla('EQ-200;Nuevo;portatil;;', 'EQ-201;Otro;camara;Apolo;');
    importarInventario(db, archivo, { aplicar: true });
    const segunda = importarInventario(db, tabla('eq-200;Nuevo;portatil;;', 'EQ-201;Otro;camara;Apolo;'), { aplicar: true });
    assert.equal(segunda.nuevos.length, 0);
    assert.equal(segunda.actualizados.length, 0);
    assert.equal(segunda.sinCambios, 2);
    assert.equal(db.recursos.filter((r) => r.id.toLowerCase() === 'eq-200').length, 1);
  });

  test('el estado de un equipo que ya existe se conserva: lo manda Soporte TI, no el archivo', () => {
    const db = crearDB();
    const informe = importarInventario(db, tabla('EQ-100;Cámara real;camara;Apolo;disponible'), { aplicar: true });
    assert.equal(db.recursos.find((r) => r.id === 'EQ-100').estado, 'danado');
    assert.equal(informe.estadoConservado, 1);
    assert.ok(informe.avisos.some((a) => /conserva el de la base/.test(a)));
  });

  test('un equipo nuevo entra con el estado del archivo, o "disponible" si viene vacío', () => {
    const db = crearDB();
    importarInventario(db, tabla('N-1;A;x;;Dañado', 'N-2;B;x;;'), { aplicar: true });
    assert.deepEqual(db.recursos.filter((r) => r.id.startsWith('N-')).map((r) => r.estado), ['danado', 'disponible']);
  });

  test('los equipos reales que el archivo no menciona no se borran: solo se cuentan', () => {
    const db = crearDB();
    const informe = importarInventario(db, tabla('N-1;A;x;;'), { aplicar: true });
    assert.equal(informe.ausentes, 1); // EQ-100
    assert.ok(db.recursos.some((r) => r.id === 'EQ-100'));
  });
});

describe('importarInventario: validar cada fila', () => {
  test('todo o nada: con un solo error no se aplica ninguna fila, y se informan todos los errores con su línea', () => {
    const db = crearDB();
    const antes = JSON.stringify(db);
    const informe = importarInventario(db, tabla('OK-1;Bueno;x;Apolo;', 'MALO;;x;Apolo;', 'OK-2;Bueno 2;x;Apol;'), { aplicar: true });
    assert.equal(informe.aplicado, false);
    assert.deepEqual(informe.errores.map((e) => e.linea), [3, 4]); // la fila 2 está bien, pero igual no entra
    assert.equal(JSON.stringify(db), antes, 'la base queda igual');
  });

  test('cada error dice la línea del archivo y qué corregir', () => {
    const informe = importarInventario(crearDB(), tabla(';Sin código;x;;', 'A-1;Un nombre;x;Sala inventada;', 'B-1;Otro;x;;roto del todo'));
    assert.deepEqual(informe.errores.map((e) => e.linea), [2, 3, 4]);
    assert.match(informe.errores[0].mensaje, /falta el código/);
    assert.match(informe.errores[1].mensaje, /la sala "Sala inventada" no existe/);
    assert.match(informe.errores[2].mensaje, /el estado "roto del todo" no se entiende/);
  });

  test('códigos que no sirven: con espacios o símbolos, o de una sola letra', () => {
    const informe = importarInventario(crearDB(), tabla('A B;x;x;;', 'Z;x;x;;', 'ok/1;x;x;;', 'OK-1;x;x;;'));
    assert.deepEqual(informe.errores.map((e) => e.linea), [2, 3, 4]);
  });

  test('un código repetido en el archivo (aunque cambie la mayúscula) es un error que apunta a la primera línea', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;Uno;x;;', 'a-1;Dos;x;;'));
    assert.equal(informe.errores.length, 1);
    assert.match(informe.errores[0].mensaje, /ya apareció en la línea 2/);
  });

  test('la sala se busca por nombre o id, sin importar tildes, mayúsculas ni la palabra "Sala"', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;x;x;SKYLABS;', 'A-2;x;x;sala apolo;', 'A-3;x;x;skilab;', 'A-4;x;x;  Auditório ;', 'A-5;x;x;Salas amarillas y verdes;'));
    assert.deepEqual(informe.errores, []);
    assert.deepEqual(informe.nuevos.map((n) => n.sala), ['Skylabs', 'Apolo', 'Skylabs', 'Auditorio', 'Salas amarillas y verdes']);
  });

  test('una sala mal escrita sugiere la más parecida en lugar de adivinar', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;x;x;Apol;', 'A-2;x;x;Audtorio;'));
    assert.match(informe.errores[0].mensaje, /¿Quisiste decir "Apolo"\?/);
    assert.match(informe.errores[1].mensaje, /¿Quisiste decir "Auditorio"\?/);
  });

  test('"sin sala" se escribe vacío, "-", "ninguna" o "Portátil"', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;x;x;;', 'A-2;x;x;-;', 'A-3;x;x;Ninguna;', 'A-4;x;x;Portátil;'));
    assert.deepEqual(informe.errores, []);
    assert.ok(informe.nuevos.every((n) => n.espacioId === null));
  });

  test('el estado acepta sinónimos con tildes y mayúsculas, y todos equivalen a un estado válido del sistema', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;x;x;;En reparación', 'A-2;x;x;;DAÑADO', 'A-3;x;x;;bueno', 'A-4;x;x;;Fuera de servicio'));
    assert.deepEqual(informe.nuevos.map((n) => n.estado), ['en_reparacion', 'danado', 'disponible', 'danado']);
    for (const estado of Object.values(SINONIMOS_ESTADO)) assert.ok(ESTADOS_RECURSO.includes(estado), estado);
  });

  test('el tipo se guarda normalizado y, si falta, es "otro"', () => {
    assert.equal(tipoNormalizado('Video Beam'), 'video_beam');
    assert.equal(tipoNormalizado('  Cámara  Web (HD) '), 'camara_web_hd');
    const informe = importarInventario(crearDB(), tabla('A-1;x;Computador de Escritorio;;', 'A-2;x;;;'));
    assert.deepEqual(informe.nuevos.map((n) => n.tipo), ['computador_de_escritorio', 'otro']);
  });

  test('el nombre se limpia de espacios de más', () => {
    const informe = importarInventario(crearDB(), tabla('A-1;  Video   beam   Epson ;x;;'));
    assert.equal(informe.nuevos[0].nombre, 'Video beam Epson');
  });
});

describe('importarInventario: equipos de demostración', () => {
  test('sin pedirlo no se quitan, pero se avisa cuántos hay', () => {
    const db = crearDB();
    const informe = importarInventario(db, tabla('N-1;A;x;;'), { aplicar: true });
    assert.equal(informe.ficticios.hay, 2);
    assert.deepEqual(informe.ficticios.aQuitar, []);
    assert.ok(informe.avisos.some((a) => /2 equipos de demostración/.test(a) && /--quitar-ficticios/.test(a)));
    assert.equal(db.recursos.filter((r) => r.ficticio).length, 2);
  });

  test('con quitarFicticios se quitan, menos los que ya tienen incidencias', () => {
    const db = crearDB();
    db.incidencias.push({ id: 'inc-1', recursoId: 'rec-02', estado: 'resuelta' });
    const informe = importarInventario(db, tabla('N-1;A;x;;'), { aplicar: true, quitarFicticios: true });
    assert.deepEqual(informe.ficticios.aQuitar, ['rec-01']);
    assert.deepEqual(informe.ficticios.conservados, ['rec-02']);
    assert.deepEqual(db.recursos.map((r) => r.id), ['rec-02', 'EQ-100', 'N-1']);
    assert.ok(informe.avisos.some((a) => /No se quita 1 equipo de demostración porque ya tiene incidencias: rec-02/.test(a)));
  });

  test('también se conservan los que tienen préstamos (historial viejo)', () => {
    const db = crearDB();
    db.prestamos.push({ id: 'pre-1', recursoId: 'rec-01' });
    const informe = importarInventario(db, tabla('N-1;A;x;;'), { aplicar: true, quitarFicticios: true });
    assert.deepEqual(informe.ficticios.conservados, ['rec-01']);
  });

  test('con quitarFicticios pero sin aplicar (ensayo) solo se informa', () => {
    const db = crearDB();
    const informe = importarInventario(db, tabla('N-1;A;x;;'), { quitarFicticios: true });
    assert.deepEqual(informe.ficticios.aQuitar, ['rec-01', 'rec-02']);
    assert.equal(db.recursos.length, 3);
  });

  test('un equipo de demostración que sí aparece en el archivo pasa a ser real y no se quita', () => {
    const db = crearDB();
    importarInventario(db, tabla('rec-01;Video beam demo;video_beam;Apolo;'), { aplicar: true, quitarFicticios: true });
    const rec = db.recursos.find((r) => r.id === 'rec-01');
    assert.ok(rec && !('ficticio' in rec));
    assert.deepEqual(db.recursos.map((r) => r.id), ['rec-01', 'EQ-100']);
  });
});

// ---------------------------------------------------------------------
// Recorrido completo: bytes de Excel -> informe -> PostgreSQL (partiendo de la semilla de demostración)
// ---------------------------------------------------------------------

const EXCEL = (texto) => Buffer.from(texto, 'latin1'); // lo que guarda Excel con "CSV (delimitado por comas)": Windows-1252
const ARCHIVO = 'Código;Equipo;Tipo;Sala;Estado\r\nCL-001;Micrófono inalámbrico;Micrófono;Auditorio;Bueno\r\nCL-002;Cámara web;Cámara;;\r\nCL-003;Video beam BenQ;Video beam;Cosmos;Dañado\r\n;;;;\r\n';

describe('recorrido completo contra PostgreSQL', () => {
  beforeEach(() => sembrar(bd.pool));
  const nombresEnBase = async () => (await leerDB()).recursos.map((r) => r.id);

  test('el ensayo lee un CSV de Excel (; y Windows-1252) y no escribe nada', async () => {
    const informe = await importarInventarioDesdeCSV(EXCEL(ARCHIVO));
    assert.equal(informe.codificacion, 'windows-1252');
    assert.equal(informe.separador, ';');
    assert.equal(informe.aplicado, false);
    assert.deepEqual(informe.nuevos.map((n) => n.id), ['CL-001', 'CL-002', 'CL-003']);
    assert.equal((await nombresEnBase()).length, 12, 'los 12 de demostración siguen igual');
  });

  test('aplicar con --quitar-ficticios deja solo el inventario real, con tildes y estados bien', async () => {
    const informe = await importarInventarioDesdeCSV(EXCEL(ARCHIVO), { aplicar: true, quitarFicticios: true });
    assert.equal(informe.aplicado, true);
    const { recursos } = await leerDB();
    assert.deepEqual(recursos.map((r) => [r.id, r.nombre, r.tipo, r.espacioId, r.estado]), [
      ['CL-001', 'Micrófono inalámbrico', 'microfono', 'auditorio', 'disponible'],
      ['CL-002', 'Cámara web', 'camara', null, 'disponible'],
      ['CL-003', 'Video beam BenQ', 'video_beam', 'cosmos', 'danado'],
    ]);
    assert.ok(recursos.every((r) => !r.ficticio));
    const { rows } = await bd.pool.query('SELECT count(*)::int AS n FROM recursos WHERE ficticio');
    assert.equal(rows[0].n, 0);
  });

  test('volver a correr el mismo archivo no cambia nada', async () => {
    await importarInventarioDesdeCSV(EXCEL(ARCHIVO), { aplicar: true, quitarFicticios: true });
    const otra = await importarInventarioDesdeCSV(EXCEL(ARCHIVO), { aplicar: true });
    assert.equal(otra.nuevos.length + otra.actualizados.length, 0);
    assert.equal(otra.sinCambios, 3);
  });

  test('un error en el archivo no cambia la base (todo o nada)', async () => {
    const malo = ARCHIVO + 'CL-004;Sin sala buena;x;Sala inventada;\r\n';
    const informe = await importarInventarioDesdeCSV(EXCEL(malo), { aplicar: true, quitarFicticios: true });
    assert.equal(informe.aplicado, false);
    assert.equal(informe.errores.length, 1);
    assert.equal((await nombresEnBase()).length, 12);
  });

  test('los equipos de demostración con incidencias se conservan, y la incidencia sigue apuntando a su equipo', async () => {
    await actualizarDB((db) => crearIncidencia(db, {
      descripcion: 'Falla el micrófono', categoria: 'tecnologia', prioridad: 'media', area: 'Soporte TI', espacioId: 'auditorio', recursoId: 'rec-04',
    }));
    const informe = await importarInventarioDesdeCSV(EXCEL(ARCHIVO), { aplicar: true, quitarFicticios: true });
    assert.deepEqual(informe.ficticios.conservados, ['rec-04']);
    const { recursos, incidencias } = await leerDB();
    assert.deepEqual(recursos.map((r) => r.id).sort(), ['CL-001', 'CL-002', 'CL-003', 'rec-04']);
    assert.equal(incidencias[0].recursoId, 'rec-04');
  });

  test('la plantilla de data/plantillas/inventario.csv se importa sin errores', async () => {
    const informe = await importarInventarioDesdeCSV(readFileSync(new URL('../data/plantillas/inventario.csv', import.meta.url)));
    assert.deepEqual(informe.errores, []);
    assert.equal(informe.nuevos.length, 3);
    assert.equal(informe.separador, ';');
    assert.equal(informe.codificacion, 'utf-8');
  });

  test('el informe en texto muestra lo importante y es claro con los errores', async () => {
    const ok = formatearInforme(await importarInventarioDesdeCSV(EXCEL(ARCHIVO), { quitarFicticios: true }));
    assert.match(ok, /ENSAYO: todavía no se guardó nada/);
    assert.match(ok, /\+ CL-001 {2}Micrófono inalámbrico \(microfono\) · Auditorio · disponible/);
    assert.match(ok, /guarda con --aplicar/);
    const malo = formatearInforme(await importarInventarioDesdeCSV(EXCEL('id;nombre;sala\nA-1;x;Apol\n')));
    assert.match(malo, /ERRORES \(1\): no se guardó nada/);
    assert.match(malo, /Línea 2: la sala "Apol" no existe/);
    assert.doesNotMatch(malo, /guarda con --aplicar/);
  });
});
