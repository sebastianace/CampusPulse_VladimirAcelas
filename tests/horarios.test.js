// =====================================================================
// TESTS DE LOS HORARIOS DE LAS CLASES (node:test)
// ---------------------------------------------------------------------
// Software, Inglés y SER tienen horarios fijos que Coordinación prepara en Excel. Lo que más importa:
// que una sala con clase no se reserve (pero solo con días CONFIRMADOS: no se cierra una sala con un dato
// que no se sabe), que el importador entienda el Excel real (separador ;, tildes, "Sala Azul") y que
// encuentre los problemas de planeación. Las reglas se prueban sin base; el recorrido, contra PostgreSQL.
// Los datos de estos tests son inventados: el archivo real de Coordinación no va al repositorio.
// =====================================================================

import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { sembrar } = await import('../src/data/semilla.js');
const { leerDB } = await import('../src/data/almacen.js');
const { analizarHorarios, claseEnCurso, claseQueOcupa, describirDias, normalizarHora, parsearDias } = await import('../src/domain/horarios.js');
const { COLUMNAS, importarHorarios, leerTablaHorarios } = await import('../src/domain/horarios-importar.js');
const { crearReserva, buscarEspaciosDisponibles } = await import('../src/domain/reservas.js');
const { estaOcupado, listarEspacios } = await import('../src/domain/espacios.js');
const { buscarSala, plano } = await import('../src/domain/salas.js');
const { parsearCSV } = await import('../src/data/csv.js');
const { importarHorariosDesdeCSV, formatearInforme } = await import('../src/data/importar-horarios.js');
after(() => bd.cerrar());

// Lunes 1 de marzo de 2027, martes 2 y sábado 6 (comprobados): fechas futuras para que las reservas no sean "del pasado".
const LUNES = '2027-03-01';
const MARTES = '2027-03-02';

const ESPACIOS = [
  { id: 'apolo', nombre: 'Apolo', nombreOficial: 'Apolo', tipo: 'sala', aforo: 34, estado: 'disponible' },
  { id: 'artemis', nombre: 'Artemis', nombreOficial: 'Artemis', tipo: 'sala', aforo: 32, estado: 'disponible' },
  { id: 'azul', nombre: 'Azul', nombreOficial: 'Azul', tipo: 'sala', aforo: 10, estado: 'disponible' },
  { id: 'skilab', nombre: 'Skylabs', nombreOficial: 'Skilab', tipo: 'sala', aforo: 20, estado: 'disponible' },
];
const bloque = (extra = {}) => ({ id: 'h1', tipo: 'software', espacioId: 'apolo', horaInicio: '06:00', horaFin: '09:30', dias: [1, 2, 3, 4, 5], grupo: 'J1 Dic-25', estudiantes: 20, docente: 'Ana', ...extra });
const crearDB = (horarios = []) => ({ espacios: ESPACIOS.map((e) => ({ ...e })), recursos: [], reservas: [], solicitudes: [], prestamos: [], incidencias: [], horarios });

describe('horas y días', () => {
  test('las horas se normalizan a HH:MM y lo que no es hora se rechaza', () => {
    assert.equal(normalizarHora('7:00'), '07:00');
    assert.equal(normalizarHora('07:00:00'), '07:00');
    assert.equal(normalizarHora(' 18:15 '), '18:15');
    for (const mala of ['', null, '25:00', '7:60', '7', '7pm', 'mediodía']) assert.equal(normalizarHora(mala), null, String(mala));
  });

  test('los días se entienden como los escriba Coordinación', () => {
    const dias = (t) => parsearDias(t).dias;
    assert.deepEqual(dias('L-V'), [1, 2, 3, 4, 5]);
    assert.deepEqual(dias('Lunes a Viernes'), [1, 2, 3, 4, 5]);
    assert.deepEqual(dias('lun - sáb'), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(dias('L, X, V'), [1, 3, 5]);
    assert.deepEqual(dias('lun, mie, vie'), [1, 3, 5]);
    assert.deepEqual(dias('martes y jueves'), [2, 4]);
    assert.deepEqual(dias('LXV'), [1, 3, 5]);
    assert.deepEqual(dias('Sábado'), [6]);
    assert.deepEqual(dias('sab a dom'), [6, 7]);
    assert.deepEqual(dias('Domingo'), [7]);
    assert.deepEqual(dias('Miércoles'), [3]);
    assert.deepEqual(dias('todos'), [1, 2, 3, 4, 5, 6, 7]);
  });

  test('vacío = días sin confirmar (null), no "todos los días"', () => {
    assert.deepEqual(parsearDias(''), { dias: null });
    assert.deepEqual(parsearDias(undefined), { dias: null });
  });

  test('la "M" sola es ambigua y se rechaza: un error vale más que adivinar mal; lo ilegible también', () => {
    assert.match(parsearDias('L M V').error, /ambigua/);
    assert.match(parsearDias('LMV').error, /no se entienden/);
    assert.match(parsearDias('v-l').error, /al revés/);
    assert.match(parsearDias('quincena').error, /no se entienden/);
  });

  test('describirDias', () => {
    assert.equal(describirDias([1, 2, 3, 4, 5]), 'lunes a viernes');
    assert.equal(describirDias([1, 3, 5]), 'lunes, miércoles, viernes');
    assert.equal(describirDias(null), 'días sin confirmar');
  });
});

describe('buscar la sala por el nombre que usa Coordinación', () => {
  test('por id, nombre del campus u oficial, sin tildes, mayúsculas ni "Sala"', () => {
    for (const texto of ['Sala Azul', 'AZUL', 'sala  azul']) assert.equal(buscarSala(texto, ESPACIOS).espacio?.id, 'azul', texto);
    assert.equal(buscarSala('Skilab', ESPACIOS).espacio?.id, 'skilab');
    assert.equal(buscarSala('Skylabs', ESPACIOS).espacio?.id, 'skilab');
  });

  test('singular y plural son la misma sala ("Skylab" y "Skylabs")', () => {
    assert.equal(buscarSala('Skylab', ESPACIOS).espacio?.id, 'skilab');
    assert.equal(buscarSala('Apolos', ESPACIOS).espacio?.id, 'apolo');
  });

  test('un nombre que no existe no se adivina: sugiere la más parecida', () => {
    const r = buscarSala('Apol', ESPACIOS);
    assert.equal(r.espacio, undefined);
    assert.equal(r.sugerencia?.id, 'apolo');
    assert.equal(buscarSala('Sala Nueva', ESPACIOS).espacio, undefined);
  });

  test('un alias confirmado por una persona resuelve el nombre', () => {
    assert.equal(buscarSala('Sala Nueva', ESPACIOS, { 'Sala nueva': 'azul' }).espacio?.id, 'azul');
    assert.equal(buscarSala('Sala Nueva', ESPACIOS, { 'Sala nueva': 'no-existe' }).espacio, undefined);
  });
});

describe('ocupación de las salas', () => {
  test('una clase con días confirmados ocupa la sala solo en su día y su hora', () => {
    const db = crearDB([bloque()]);
    assert.ok(claseQueOcupa(db, 'apolo', `${LUNES}T07:00`, `${LUNES}T09:00`));
    assert.ok(claseQueOcupa(db, 'apolo', `${LUNES}T09:00`, `${LUNES}T10:00`), 'se cruza de 09:00 a 09:30');
    assert.equal(claseQueOcupa(db, 'apolo', `${LUNES}T09:30`, `${LUNES}T11:00`), undefined, 'pegada al final no cruza');
    assert.equal(claseQueOcupa(db, 'apolo', `${LUNES}T05:00`, `${LUNES}T06:00`), undefined, 'pegada al inicio no cruza');
    assert.equal(claseQueOcupa(db, 'apolo', '2027-03-06T07:00', '2027-03-06T09:00'), undefined, 'el sábado no hay clase');
    assert.equal(claseQueOcupa(db, 'artemis', `${LUNES}T07:00`, `${LUNES}T09:00`), undefined, 'es de otra sala');
  });

  test('un bloque SIN días no bloquea nada: no se cierra una sala con un dato que no se sabe', () => {
    const db = crearDB([bloque({ dias: null })]);
    assert.equal(claseQueOcupa(db, 'apolo', `${LUNES}T07:00`, `${LUNES}T09:00`), undefined);
    assert.equal(claseEnCurso(db, 'apolo', `${LUNES}T07:30`), undefined);
  });

  test('claseEnCurso mira el instante: incluye el inicio y excluye el fin', () => {
    const db = crearDB([bloque()]);
    assert.ok(claseEnCurso(db, 'apolo', `${LUNES}T06:00`));
    assert.ok(claseEnCurso(db, 'apolo', `${LUNES}T09:29`));
    assert.equal(claseEnCurso(db, 'apolo', `${LUNES}T09:30`), undefined);
  });

  test('reservar una sala con clase da 409 SALA_CON_CLASE y dice qué clase es', () => {
    const db = crearDB([bloque()]);
    assert.throws(
      () => crearReserva(db, { espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${LUNES}T08:00`, fin: `${LUNES}T09:00` }),
      { codigo: 'SALA_CON_CLASE', status: 409, message: /Apolo tiene clase de Software \(J1 Dic-25\) de 06:00 a 09:30/ });
    assert.equal(db.reservas.length, 0);
  });

  test('en otro día, en otra sala o pegada a la clase sí se puede reservar', () => {
    const db = crearDB([bloque()]);
    const reservar = (datos) => crearReserva(db, { responsable: 'Ana', asistentes: 5, ...datos });
    assert.ok(reservar({ espacioId: 'apolo', inicio: '2027-03-06T08:00', fin: '2027-03-06T09:00' }));
    assert.ok(reservar({ espacioId: 'artemis', inicio: `${LUNES}T08:00`, fin: `${LUNES}T09:00` }));
    assert.ok(reservar({ espacioId: 'apolo', inicio: `${LUNES}T09:30`, fin: `${LUNES}T10:30` }));
  });

  test('la recomendación de salas no ofrece una sala con clase', () => {
    const db = crearDB([bloque()]);
    const ids = buscarEspaciosDisponibles({ asistentes: 5, inicio: `${LUNES}T08:00`, fin: `${LUNES}T09:00` }, db).map((e) => e.id);
    assert.ok(!ids.includes('apolo') && ids.includes('artemis'));
  });

  test('con clase en curso la sala aparece ocupada ahora; sin horarios todo sigue igual', () => {
    const db = crearDB([bloque()]);
    assert.equal(estaOcupado(db, 'apolo', `${LUNES}T07:00`), true);
    assert.equal(estaOcupado(db, 'apolo', `${LUNES}T10:00`), false);
    assert.equal(listarEspacios(db, `${LUNES}T07:00`).find((e) => e.id === 'apolo').ocupadoAhora, true);
    const sin = crearDB();
    delete sin.horarios; // una base en memoria de otro test no tiene horarios
    assert.equal(estaOcupado(sin, 'apolo', `${LUNES}T07:00`), false);
  });
});

describe('analizarHorarios', () => {
  // Un bloque de Software suelto siempre "no tiene SER": en estos tests eso es ruido, salvo en el que lo prueba
  const todos = (bloques) => analizarHorarios(bloques, ESPACIOS);
  const hallazgos = (bloques) => todos(bloques).filter((h) => h.tipo !== 'sin-contraparte');
  const tipos = (bloques) => hallazgos(bloques).map((h) => h.tipo);

  test('dos clases a la vez en la misma sala, con días en común: cruce', () => {
    const h = hallazgos([bloque({ id: 'a', linea: 2 }), bloque({ id: 'b', grupo: 'K2 Ene-26', horaInicio: '08:00', horaFin: '11:00', linea: 3, docente: 'Luis' })]);
    assert.deepEqual(h.map((x) => x.tipo), ['cruce-sala']);
    assert.match(h[0].mensaje, /Apolo tiene dos clases a la vez/);
    assert.deepEqual(h[0].lineas, [2, 3]);
  });

  test('pegadas (09:30 y 09:30) o en días distintos no es cruce', () => {
    assert.deepEqual(tipos([bloque(), bloque({ id: 'b', horaInicio: '09:30', horaFin: '11:00', docente: 'Luis' })]), []);
    assert.deepEqual(tipos([bloque({ dias: [1, 3, 5] }), bloque({ id: 'b', dias: [2, 4], docente: 'Luis' })]), []);
  });

  test('si a un bloque le faltan los días, el cruce es "posible" y lo dice', () => {
    const h = hallazgos([bloque({ dias: null }), bloque({ id: 'b', horaInicio: '08:00', horaFin: '10:00', docente: 'Luis' })]);
    assert.equal(h.filter((x) => x.tipo === 'cruce-sala').length, 1);
    assert.match(h.find((x) => x.tipo === 'cruce-sala').mensaje, /Puede que no: a alguno le faltan los días/);
  });

  test('un docente en dos salas a la vez', () => {
    const h = hallazgos([bloque(), bloque({ id: 'b', espacioId: 'artemis', grupo: 'K2 Ene-26', horaInicio: '08:00', horaFin: '09:00', docente: 'ANA' })]);
    assert.deepEqual(h.map((x) => x.tipo), ['cruce-docente']);
    assert.match(h[0].mensaje, /Ana está en dos lugares a la vez/);
  });

  test('la misma cohorte con Software y SER a la vez', () => {
    const h = hallazgos([bloque(), bloque({ id: 'b', tipo: 'ser', espacioId: 'artemis', horaInicio: '08:00', horaFin: '09:00', docente: undefined })]);
    assert.ok(h.some((x) => x.tipo === 'cruce-cohorte' && /J1 Dic-25 tiene Software y SER al mismo tiempo/.test(x.mensaje)));
  });

  test('aforo: más estudiantes que el aforo de la sala', () => {
    const h = hallazgos([bloque({ tipo: 'ingles', espacioId: 'azul', grupo: 'Grupo 2', estudiantes: 14 })]);
    assert.deepEqual(h.map((x) => x.tipo), ['aforo']);
    assert.match(h[0].mensaje, /Azul admite 10 personas y Inglés Grupo 2 \(06:00-09:30\) tiene 14 estudiantes/);
    assert.deepEqual(tipos([bloque({ espacioId: 'azul', estudiantes: 10 })]), [], 'justo el aforo es válido');
  });

  test('una cohorte con distinto mes o año entre Software y SER se marca, aunque se escriba "Sep" o "Sept"', () => {
    const h = hallazgos([
      bloque({ id: 'a', grupo: 'D1 Oct-25', linea: 4 }),
      bloque({ id: 'b', tipo: 'ser', espacioId: 'artemis', grupo: 'D1 Oct-26', horaInicio: '10:00', horaFin: '11:00', docente: undefined, linea: 9 }),
      bloque({ id: 'c', grupo: 'C4 Sept-25', espacioId: 'artemis', horaInicio: '18:15', horaFin: '21:45', docente: 'Luis' }),
      bloque({ id: 'd', tipo: 'ser', grupo: 'C4 Sep-25', horaInicio: '16:00', horaFin: '17:00', docente: undefined }),
    ]);
    const c = h.filter((x) => x.tipo === 'cohorte');
    assert.equal(c.length, 1, 'C4 Sept-25 y C4 Sep-25 son la misma fecha');
    assert.match(c[0].mensaje, /D1 aparece con fechas distintas: Software dice "D1 Oct-25" y SER dice "D1 Oct-26"/);
  });

  test('una cohorte de Software sin SER (o al revés) se avisa', () => {
    const h = todos([bloque({ grupo: 'K4 Feb-26' })]);
    assert.ok(h.some((x) => x.tipo === 'sin-contraparte' && /K4 Feb-26 tiene Software pero no aparece en SER/.test(x.mensaje)));
  });

  test('el módulo que nombra otra sala (intercambiado) se marca; "Virtual 5" no', () => {
    assert.ok(tipos([bloque({ modulo: 'Artemis 1' })]).includes('modulo'));
    assert.ok(!tipos([bloque({ modulo: 'Apolo 1' })]).includes('modulo'));
    assert.ok(!tipos([bloque({ modulo: 'Virtual 5' })]).includes('modulo'));
  });

  test('datos incompletos: Software o Inglés sin docente, Software con 0 estudiantes', () => {
    const h = hallazgos([bloque({ docente: undefined, estudiantes: 0 }), bloque({ id: 'b', tipo: 'ingles', espacioId: 'azul', horaInicio: '15:00', horaFin: '16:00', grupo: 'Grupo 1', docente: undefined, estudiantes: 5 }), bloque({ id: 'c', tipo: 'ser', espacioId: 'skilab', horaInicio: '15:00', horaFin: '16:00', docente: undefined })]);
    assert.equal(h.filter((x) => x.tipo === 'incompleto').length, 3, 'sin docente x2 + 0 estudiantes; el SER sin docente es normal');
  });

  test('los bloques sin días se resumen en un solo hallazgo', () => {
    const h = hallazgos([bloque({ dias: null }), bloque({ id: 'b', espacioId: 'artemis', dias: null, grupo: 'K2 Ene-26' })]);
    assert.equal(h.filter((x) => x.tipo === 'sin-dias').length, 1);
    assert.match(h.find((x) => x.tipo === 'sin-dias').mensaje, /2 de 2 bloques no traen los días/);
  });
});

describe('importar horarios: la tabla y las filas', () => {
  const tabla = (...lineas) => leerTablaHorarios(parsearCSV(['Tipo;Sala;Hora inicio;Hora fin;Días;Grupo / Cohorte;Estudiantes;Nivel / Programa;Docente;Módulo;Dato 2 (sin rotular);Días restantes (captura);Observación', ...lineas].join('\n'), ';').registros);

  test('entiende el encabezado del Excel real y nombra las columnas que ignora', () => {
    const t = tabla('SER;Auditorio;07:00;08:00;;J2 Abr-26;;;;;;;');
    assert.deepEqual(t.ignoradas, ['Dato 2 (sin rotular)', 'Días restantes (captura)']);
    assert.ok(['tipo', 'sala', 'inicio', 'fin', 'dias', 'grupo', 'estudiantes', 'nivel', 'docente', 'modulo', 'observacion'].every((c) => t.columnas.includes(c)));
  });

  test('los alias están normalizados: si no, nunca coincidirían', () => {
    for (const alias of Object.values(COLUMNAS).flat()) assert.equal(plano(alias), alias, alias);
  });

  test('sin las columnas obligatorias explica qué falta', () => {
    assert.throws(() => leerTablaHorarios(parsearCSV('Sala;Docente\nApolo;Ana', ';').registros), /Faltan columnas obligatorias: tipo, inicio, fin, grupo/);
    assert.throws(() => leerTablaHorarios([]), /vacío/);
  });

  test('cada error dice la línea y qué corregir; los válidos no se mezclan', () => {
    const db = crearDB();
    const informe = importarHorarios(db, tabla(
      'Software;Sala Nueva;06:00;09:30;L-V;J1 Dic-25;20;;Ana;;;;',
      'Matemáticas;Apolo;06:00;09:30;;J1;;;;;;;',
      'SER;Apolo;25:00;08:00;;J1 Dic-25;;;;;;;',
      'SER;Apolo;09:00;08:00;;J1 Dic-25;;;;;;;',
      'SER;Apolo;07:00;08:00;L M V;J1 Dic-25;diez;;;;;;',
      'SER;Apolo;07:00;08:00;;;;;;;;;'));
    assert.deepEqual(informe.errores.map((e) => e.linea), [2, 3, 4, 5, 6, 6, 7], 'la línea 6 tiene dos problemas y se informan los dos');
    assert.match(informe.errores[0].mensaje, /la sala "Sala Nueva" no existe/);
    assert.match(informe.errores[1].mensaje, /el tipo "Matemáticas" no se entiende/);
    assert.match(informe.errores[2].mensaje, /hora de inicio "25:00" no sirve/);
    assert.match(informe.errores[3].mensaje, /termina \(08:00\) antes/);
    assert.match(informe.errores[4].mensaje, /ambigua/);
    assert.match(informe.errores[5].mensaje, /los estudiantes "diez" no son un número entero/);
    assert.match(informe.errores[6].mensaje, /falta el grupo/);
  });

  test('todo o nada: con un error de formato no se guarda ninguna fila', () => {
    const db = crearDB();
    const informe = importarHorarios(db, tabla('SER;Apolo;07:00;08:00;L-V;J1 Dic-25;;;;;;;', 'SER;Apolo;25:00;08:00;;J1 Dic-25;;;;;;;'), { aplicar: true });
    assert.equal(informe.aplicado, false);
    assert.equal(db.horarios.length, 0);
  });

  test('los problemas de planeación NO impiden guardar: son hallazgos', () => {
    const db = crearDB();
    const informe = importarHorarios(db, tabla('Inglés;Azul;08:00;09:00;L-V;Grupo 2;14;B2.2;Leo;;;;'), { aplicar: true });
    assert.equal(informe.aplicado, true);
    assert.ok(informe.hallazgos.some((h) => h.tipo === 'aforo'));
    assert.equal(db.horarios.length, 1);
  });

  test('el ensayo no modifica nada', () => {
    const db = crearDB();
    importarHorarios(db, tabla('SER;Apolo;07:00;08:00;L-V;J1 Dic-25;;;;;;;'));
    assert.equal(db.horarios.length, 0);
  });

  test('solo se reemplazan los tipos que trae el archivo: uno solo de Inglés no toca Software ni SER', () => {
    const db = crearDB([bloque({ id: 'viejo-sw' }), bloque({ id: 'viejo-en', tipo: 'ingles', espacioId: 'azul', horaInicio: '08:00', horaFin: '09:00', grupo: 'Grupo 1', estudiantes: 5 })]);
    const informe = importarHorarios(db, tabla('Inglés;Azul;10:00;11:00;L-V;Grupo 9;6;A1.1;Karla;;;;'), { aplicar: true });
    assert.deepEqual(informe.reemplaza, { tipos: ['ingles'], bloquesActuales: 1 });
    assert.deepEqual(db.horarios.map((b) => b.grupo).sort(), ['Grupo 9', 'J1 Dic-25']);
  });

  test('los bloques guardados llevan id, días y los campos limpios (sin la línea del archivo)', () => {
    const db = crearDB();
    importarHorarios(db, tabla('Software;Skylab;18:15;21:45;L-V;R4 Ago-26;20;;  Camilo   R ;Virtual 5;;;'), { aplicar: true });
    const [b] = db.horarios;
    assert.match(b.id, /^hor-[0-9a-f]{8}$/);
    assert.deepEqual({ ...b, id: undefined }, { id: undefined, tipo: 'software', espacioId: 'skilab', horaInicio: '18:15', horaFin: '21:45', dias: [1, 2, 3, 4, 5], grupo: 'R4 Ago-26', estudiantes: 20, docente: 'Camilo R', modulo: 'Virtual 5' });
  });
});

describe('recorrido completo contra PostgreSQL', () => {
  beforeEach(() => sembrar(bd.pool));
  const EXCEL = (texto) => Buffer.from(texto, 'latin1'); // Excel en español: Windows-1252 y ";"
  const ARCHIVO = 'Tipo;Sala;Hora inicio;Hora fin;Días;Grupo / Cohorte;Estudiantes;Docente\r\n'
    + 'Software;Apolo;6:00;9:30;L-V;J1 Dic-25;20;Camilo\r\n'
    + 'Inglés;Sala Azul;08:00;09:00;L-V;Grupo 2;14;Leo\r\n'
    + 'SER;Auditorio;07:00;08:00;;J1 Dic-25;;\r\n';

  test('el ensayo lee el CSV de Excel y no escribe nada', async () => {
    const informe = await importarHorariosDesdeCSV(EXCEL(ARCHIVO));
    assert.equal(informe.codificacion, 'windows-1252');
    assert.equal(informe.aplicado, false);
    assert.deepEqual(informe.porTipo, { software: 1, ingles: 1, ser: 1 });
    assert.equal((await leerDB()).horarios.length, 0);
  });

  test('aplicar guarda los bloques (con el arreglo de días) y reemplazar por tipo funciona en la base', async () => {
    await importarHorariosDesdeCSV(EXCEL(ARCHIVO), { aplicar: true });
    const { horarios } = await leerDB();
    assert.equal(horarios.length, 3);
    const sw = horarios.find((b) => b.tipo === 'software');
    assert.deepEqual([sw.espacioId, sw.horaInicio, sw.horaFin, sw.dias, sw.estudiantes], ['apolo', '06:00', '09:30', [1, 2, 3, 4, 5], 20]);
    assert.equal(horarios.find((b) => b.tipo === 'ser').dias, null);
    await importarHorariosDesdeCSV(EXCEL('Tipo;Sala;Hora inicio;Hora fin;Días;Grupo\r\nInglés;Cosmos;09:00;10:00;L-V;Grupo 7\r\n'), { aplicar: true });
    const despues = (await leerDB()).horarios;
    assert.deepEqual(despues.map((b) => b.tipo).sort(), ['ingles', 'ser', 'software']);
    assert.deepEqual(despues.find((b) => b.tipo === 'ingles').grupo, 'Grupo 7');
  });

  test('el alias resuelve "Sala Nueva" y un error no cambia la base', async () => {
    const archivo = 'Tipo;Sala;Hora inicio;Hora fin;Grupo\r\nInglés;Sala Nueva;08:00;09:00;Grupo 3\r\n';
    const malo = await importarHorariosDesdeCSV(EXCEL(archivo), { aplicar: true });
    assert.equal(malo.aplicado, false);
    assert.equal((await leerDB()).horarios.length, 0);
    const bueno = await importarHorariosDesdeCSV(EXCEL(archivo), { aplicar: true, alias: { 'Sala Nueva': 'blanca' } });
    assert.equal(bueno.aplicado, true);
    assert.equal((await leerDB()).horarios[0].espacioId, 'blanca');
  });

  test('con los días confirmados, la API rechaza reservar la sala en clase (409) y GET /api/horarios la lista', async () => {
    await importarHorariosDesdeCSV(EXCEL(ARCHIVO), { aplicar: true });
    const servidor = app.listen(0);
    const base = `http://localhost:${servidor.address().port}`;
    try {
      const pedir = async (ruta, metodo = 'GET', cuerpo, cookie = '') => {
        const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
        return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
      };
      assert.equal((await pedir('/api/horarios')).status, 401, 'sin sesión no se ve');
      const { cookie } = await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: 'clave-de-prueba-1' });
      const lista = await pedir('/api/horarios', 'GET', undefined, cookie);
      assert.equal(lista.status, 200);
      assert.equal(lista.cuerpo.length, 3);
      const choque = await pedir('/api/reservas', 'POST', { espacioId: 'apolo', responsable: 'Jefa', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }, cookie);
      assert.deepEqual([choque.status, choque.cuerpo.error.codigo], [409, 'SALA_CON_CLASE']);
      assert.match(choque.cuerpo.error.mensaje, /clase de Software \(J1 Dic-25\) de 06:00 a 09:30/);
      const libre = await pedir('/api/reservas', 'POST', { espacioId: 'apolo', responsable: 'Jefa', asistentes: 5, inicio: `${LUNES}T10:00`, fin: `${LUNES}T11:00` }, cookie);
      assert.equal(libre.status, 201);
      const sinDias = await pedir('/api/reservas', 'POST', { espacioId: 'auditorio', responsable: 'Jefa', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }, cookie);
      assert.equal(sinDias.status, 201, 'el SER sin días no bloquea');
    } finally {
      servidor.close();
    }
  });

  test('el informe en texto agrupa los hallazgos y explica los errores', async () => {
    const ok = formatearInforme(await importarHorariosDesdeCSV(EXCEL(ARCHIVO)));
    assert.match(ok, /ENSAYO: todavía no se guardó nada/);
    assert.match(ok, /Bloques válidos: 3 \(Software 1, Inglés 1, SER 1\)/);
    assert.match(ok, /Aforo excedido/);
    assert.match(ok, /guarda con --aplicar/);
    const malo = formatearInforme(await importarHorariosDesdeCSV(EXCEL('Tipo;Sala;Hora inicio;Hora fin;Grupo\r\nSER;Nada;07:00;08:00;J1 Dic-25\r\n')));
    assert.match(malo, /ERRORES DE FORMATO \(1\)/);
    assert.match(malo, /Línea 2: la sala "Nada" no existe/);
    assert.doesNotMatch(malo, /guarda con --aplicar/);
  });
});
