// =====================================================================
// TESTS DE EDITAR Y SUBIR LOS HORARIOS DESDE LA PANTALLA (node:test)
// ---------------------------------------------------------------------
// Mafe (admin) agrega, cambia y quita clases, y sube el Excel desde el navegador. Lo que más importa:
// que SOLO el admin pueda (los demás ven la grilla pero no la tocan), que el Excel se lea igual que el CSV
// (con las horas como fracción del día), que el "ensayo" no escriba nada, que un error de formato no guarde
// nada, y que si una clase queda encima de una reserva futura se avise en vez de callar ni borrarla.
// Las reglas se prueban sin base; la API, contra PostgreSQL. Los datos son inventados.
// =====================================================================

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';
import { crearXlsx } from './ayuda-xlsx.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { leerDB } = await import('../src/data/almacen.js');
const { reservasQueChocan } = await import('../src/domain/horarios.js');
const { crearBloque, modificarBloque, normalizarBloque, quitarBloque } = await import('../src/domain/horarios-editar.js');
const { importarHorarios, leerTablaHorarios } = await import('../src/domain/horarios-importar.js');
const { importarHorariosDesdeArchivo, leerArchivoDeHorarios, formatearInforme } = await import('../src/data/importar-horarios.js');
after(() => bd.cerrar());

const ESPACIOS = [
  { id: 'apolo', nombre: 'Apolo', tipo: 'sala', aforo: 34, estado: 'disponible' },
  { id: 'azul', nombre: 'Azul', tipo: 'sala', aforo: 10, estado: 'disponible' },
  { id: 'blanca', nombre: 'Blanca', tipo: 'sala', aforo: 12, estado: 'disponible' },
];
const crearDB = (extra = {}) => ({ espacios: ESPACIOS.map((e) => ({ ...e })), recursos: [], reservas: [], solicitudes: [], prestamos: [], incidencias: [], horarios: [], ...extra });
const DATOS = { tipo: 'software', espacioId: 'apolo', horaInicio: '06:00', horaFin: '09:30', dias: [1, 2, 3, 4, 5], grupo: 'J1 Dic-25', estudiantes: 20, docente: 'Ana' };

// Un lunes dentro de dos semanas (siempre futuro) y su fecha en texto
function proximoLunes() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const LUNES = proximoLunes();

describe('validar un bloque', () => {
  test('un bloque correcto se limpia: texto sin espacios de más, días ordenados y sin repetir', () => {
    const b = normalizarBloque({ ...DATOS, grupo: '  J1   Dic-25 ', dias: [5, 1, 1, 3], horaInicio: '6:00', docente: '  ', estudiantes: '20' }, crearDB().espacios);
    assert.deepEqual(b, { tipo: 'software', espacioId: 'apolo', horaInicio: '06:00', horaFin: '09:30', dias: [1, 3, 5], grupo: 'J1 Dic-25', estudiantes: 20 });
  });

  test('los días pueden venir como texto ("L-V") o vacíos (sin confirmar: no bloquean)', () => {
    assert.deepEqual(normalizarBloque({ ...DATOS, dias: 'L-V' }, ESPACIOS).dias, [1, 2, 3, 4, 5]);
    for (const vacio of [null, undefined, '', []]) assert.equal(normalizarBloque({ ...DATOS, dias: vacio }, ESPACIOS).dias, null);
  });

  test('todos los problemas se informan juntos, en español y con 422', () => {
    assert.throws(
      () => normalizarBloque({ tipo: 'yoga', espacioId: 'nada', horaInicio: '25:00', horaFin: '08:00', dias: [0, 9], grupo: '', estudiantes: -3 }, ESPACIOS),
      (e) => e.status === 422 && e.codigo === 'HORARIO_INVALIDO'
        && /Elige la clase/.test(e.message) && /sala que exista/.test(e.message) && /hora de inicio no sirve/.test(e.message)
        && /Los días no sirven/.test(e.message) && /Falta el grupo/.test(e.message) && /estudiantes/.test(e.message),
    );
  });

  test('la clase no puede terminar antes de empezar, ni a la misma hora', () => {
    for (const fin of ['06:00', '05:00']) {
      assert.throws(() => normalizarBloque({ ...DATOS, horaFin: fin }, ESPACIOS), /antes o a la misma hora/);
    }
  });

  test('límites: textos largos y más de 1000 estudiantes se rechazan', () => {
    assert.throws(() => normalizarBloque({ ...DATOS, docente: 'x'.repeat(81) }, ESPACIOS), /"docente" es demasiado largo/);
    assert.throws(() => normalizarBloque({ ...DATOS, estudiantes: 1001 }, ESPACIOS), /entre 0 y 1000/);
    assert.throws(() => normalizarBloque({ ...DATOS, estudiantes: 2.5 }, ESPACIOS), /número entero/);
  });
});

describe('agregar, cambiar y quitar', () => {
  test('crear agrega el bloque con id propio y devuelve las reservas que quedan encima', () => {
    const db = crearDB({ reservas: [
      { id: 'r1', espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` },
      { id: 'r2', espacioId: 'apolo', responsable: 'Luis', asistentes: 5, inicio: `${LUNES}T10:00`, fin: `${LUNES}T11:00` }, // después de la clase
      { id: 'r3', espacioId: 'azul', responsable: 'Eva', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }, // otra sala
    ] });
    const { bloque, reservasEnConflicto } = crearBloque(db, DATOS);
    assert.match(bloque.id, /^hor-[0-9a-f]{8}$/);
    assert.equal(db.horarios.length, 1);
    assert.deepEqual(reservasEnConflicto.map((r) => r.id), ['r1'], 'solo la que cruza horas, sala y día');
    assert.equal(db.reservas.length, 3, 'las reservas NO se borran: decide Coordinación');
  });

  test('un bloque sin días no genera conflictos (no bloquea), y una reserva que ya terminó tampoco', () => {
    const reservas = [{ id: 'r1', espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }];
    assert.deepEqual(crearBloque(crearDB({ reservas }), { ...DATOS, dias: null }).reservasEnConflicto, []);
    assert.deepEqual(reservasQueChocan(crearDB({ reservas }), { ...DATOS }, `${LUNES}T09:00`), [], 'ya pasó');
  });

  test('cambiar es parcial: lo que no viene se queda; un texto vacío quita un dato opcional', () => {
    const db = crearDB();
    const { bloque } = crearBloque(db, { ...DATOS, nivel: 'Java', observacion: 'nota' });
    const { bloque: cambiado } = modificarBloque(db, bloque.id, { espacioId: 'azul', docente: '', observacion: '' });
    assert.equal(cambiado, db.horarios[0], 'se cambia el mismo objeto');
    assert.deepEqual(cambiado, { id: bloque.id, tipo: 'software', espacioId: 'azul', horaInicio: '06:00', horaFin: '09:30', dias: [1, 2, 3, 4, 5], grupo: 'J1 Dic-25', estudiantes: 20, nivel: 'Java' });
  });

  test('cambiar con datos malos no toca el bloque', () => {
    const db = crearDB();
    const { bloque } = crearBloque(db, DATOS);
    assert.throws(() => modificarBloque(db, bloque.id, { horaFin: '05:00' }), /antes o a la misma hora/);
    assert.equal(db.horarios[0].horaFin, '09:30');
  });

  test('un id que no existe da 404 al cambiar y al quitar', () => {
    const db = crearDB();
    for (const f of [() => modificarBloque(db, 'nada', {}), () => quitarBloque(db, 'nada')]) {
      assert.throws(f, (e) => e.status === 404 && e.codigo === 'HORARIO_NO_ENCONTRADO');
    }
  });

  test('quitar saca el bloque y lo devuelve', () => {
    const db = crearDB();
    const { bloque } = crearBloque(db, DATOS);
    assert.equal(quitarBloque(db, bloque.id).id, bloque.id);
    assert.deepEqual(db.horarios, []);
  });
});

// ---------- el archivo: Excel o CSV ----------

const ENCABEZADO = ['Tipo', 'Sala', 'Hora inicio', 'Hora fin', 'Días', 'Grupo / Cohorte', 'Estudiantes', 'Docente'];
const FILAS = [
  ENCABEZADO,
  ['Software', 'Apolo', { hora: '06:00' }, { hora: '09:30' }, null, 'J1 Dic-25', 20, 'Ana'],
  ['Inglés', 'Sala Nueva', { hora: '08:00' }, { hora: '09:00' }, null, 'Grupo 2', 9, 'Leo'],
  ['SER', 'Azul', { hora: '10:00' }, { hora: '11:00' }, 'L-V', 'J1 Dic-25', null, null],
];
const EXCEL = (hojas = [{ nombre: 'Horarios', filas: FILAS }]) => crearXlsx(hojas, { compartidos: true });
const CSV_EQUIVALENTE = Buffer.from('Tipo;Sala;Hora inicio;Hora fin;Días;Grupo / Cohorte;Estudiantes;Docente\r\nSoftware;Apolo;06:00;09:30;;J1 Dic-25;20;Ana\r\n');

describe('leer el archivo de horarios', () => {
  test('el Excel y el CSV dan la misma tabla', () => {
    const delExcel = leerArchivoDeHorarios(EXCEL([{ nombre: 'Horarios', filas: FILAS.slice(0, 2) }]));
    const delCSV = leerArchivoDeHorarios(CSV_EQUIVALENTE);
    assert.equal(delExcel.formato, 'xlsx');
    assert.equal(delCSV.formato, 'csv');
    assert.deepEqual(delExcel.tabla.filas.map(({ linea, ...r }) => r), delCSV.tabla.filas.map(({ linea, ...r }) => r));
  });

  test('un Excel con varias hojas usa la que tiene las columnas, empezando por "Horarios"', () => {
    const grilla = { nombre: 'Grilla mañana', filas: [['Sala', '6:00', '7:00'], ['Apolo', 'x', 'y']] };
    assert.equal(leerArchivoDeHorarios(EXCEL([grilla, { nombre: 'Horarios', filas: FILAS }])).hoja, 'Horarios');
    assert.equal(leerArchivoDeHorarios(EXCEL([grilla, { nombre: 'Mi hoja', filas: FILAS }])).hoja, 'Mi hoja', 'sin una llamada Horarios, la primera que sirva');
  });

  test('si ninguna hoja tiene las columnas, el error dice cuáles faltan', () => {
    assert.throws(() => leerArchivoDeHorarios(EXCEL([{ nombre: 'Otra', filas: [['Sala', 'Hora'], ['Apolo', '7']] }])), (e) => e.codigo === 'COLUMNAS_FALTANTES' && /Faltan columnas obligatorias/.test(e.message));
  });
});

describe('importar con días por defecto, salas sin reconocer y reservas', () => {
  const tabla = () => leerArchivoDeHorarios(EXCEL()).tabla;

  test('una sala que no se reconoce se lista aparte (para elegir a cuál corresponde), y con el alias entra', () => {
    const sin = importarHorarios(crearDB(), tabla());
    assert.deepEqual(sin.salasSinReconocer, [{ nombre: 'Sala Nueva', sugerencia: null }]);
    assert.equal(sin.errores.length, 1);
    const con = importarHorarios(crearDB(), tabla(), { alias: { 'Sala Nueva': 'blanca' } });
    assert.deepEqual([con.salasSinReconocer, con.errores], [[], []]);
  });

  test('los días por defecto solo se ponen a las filas que no traen días, y se cuentan', () => {
    const db = crearDB();
    const i = importarHorarios(db, tabla(), { aplicar: true, alias: { 'Sala Nueva': 'blanca' }, diasPorDefecto: [1, 2, 3, 4, 5] });
    assert.equal(i.diasPorDefecto, 2, 'dos filas no traían días');
    assert.equal(i.sinDias, 0);
    assert.deepEqual(db.horarios.map((b) => b.dias), [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]);
    const sin = importarHorarios(crearDB(), tabla(), { alias: { 'Sala Nueva': 'blanca' } });
    assert.equal(sin.sinDias, 2, 'sin la opción, quedan sin confirmar (no bloquean)');
  });

  test('avisa de las reservas futuras que quedarían encima de las clases nuevas', () => {
    const db = crearDB({ reservas: [{ id: 'r1', espacioId: 'apolo', responsable: 'Ana', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }] });
    const i = importarHorarios(db, tabla(), { alias: { 'Sala Nueva': 'blanca' }, diasPorDefecto: [1, 2, 3, 4, 5] });
    assert.deepEqual(i.reservasEnConflicto.map((r) => r.id), ['r1']);
    assert.match(formatearInforme({ ...i, formato: 'xlsx', hoja: 'Horarios', columnas: [], ignoradas: [] }), /OJO: 1 reserva futura quedaría encima de una clase/);
  });
});

// ---------- la API: solo el admin ----------

describe('API de horarios (contra PostgreSQL)', () => {
  const CLAVE = 'clave-de-prueba-1';
  let servidor;
  let base;
  let admin;
  let profe;

  // /api/auth/registro solo admite la primera cuenta: se crea una vez para todo el grupo (el resto, con /api/usuarios)
  before(async () => {
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
    const registro = await fetch(`${base}/api/auth/registro`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'jefa', nombre: 'Jefa', clave: CLAVE }) });
    admin = registro.headers.get('set-cookie').split(';')[0];
    await pedir('/api/usuarios', { metodo: 'POST', cuerpo: { usuario: 'profe', nombre: 'Profe', clave: CLAVE, rol: 'profesor' }, cookie: admin });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'profe', clave: CLAVE }) });
    profe = login.headers.get('set-cookie').split(';')[0];
  });
  after(() => servidor.close());
  beforeEach(async () => {
    // Cada test parte sin horarios ni reservas (las cuentas se conservan)
    await bd.pool.query('TRUNCATE bloques_horario, reservas CASCADE');
  });

  async function pedir(ruta, { metodo = 'GET', cuerpo, bytes, cookie = '' } = {}) {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { cookie, ...(bytes ? { 'content-type': 'application/octet-stream' } : cuerpo ? { 'content-type': 'application/json' } : {}) },
      body: bytes ?? (cuerpo && JSON.stringify(cuerpo)),
    });
    return { status: r.status, cuerpo: await r.json() };
  }

  test('un profesor no puede agregar, cambiar, quitar ni subir; sin sesión, 401', async () => {
    const { cuerpo: { bloque } } = await pedir('/api/horarios', { metodo: 'POST', cuerpo: DATOS, cookie: admin });
    const intentos = [
      ['/api/horarios', { metodo: 'POST', cuerpo: DATOS }],
      [`/api/horarios/${bloque.id}`, { metodo: 'PATCH', cuerpo: { grupo: 'X' } }],
      [`/api/horarios/${bloque.id}`, { metodo: 'DELETE' }],
      ['/api/horarios/importar', { metodo: 'POST', bytes: EXCEL() }],
    ];
    for (const [ruta, opciones] of intentos) {
      assert.equal((await pedir(ruta, { ...opciones, cookie: profe })).status, 403, `${opciones.metodo} ${ruta}`);
      assert.equal((await pedir(ruta, opciones)).status, 401, `sin sesión ${opciones.metodo} ${ruta}`);
    }
    assert.equal((await leerDB()).horarios.length, 1, 'no cambió nada');
  });

  test('el admin agrega, cambia y quita; las reservas encima se avisan, no se borran', async () => {
    const reserva = await pedir('/api/reservas', { metodo: 'POST', cuerpo: { espacioId: 'apolo', responsable: 'Jefa', asistentes: 5, inicio: `${LUNES}T07:00`, fin: `${LUNES}T08:00` }, cookie: admin });
    assert.equal(reserva.status, 201);

    const creado = await pedir('/api/horarios', { metodo: 'POST', cuerpo: DATOS, cookie: admin });
    assert.equal(creado.status, 201);
    assert.deepEqual(creado.cuerpo.reservasEnConflicto.map((r) => r.id), [reserva.cuerpo.id]);
    assert.equal((await pedir('/api/reservas', { metodo: 'POST', cuerpo: { espacioId: 'apolo', responsable: 'Jefa', asistentes: 5, inicio: `${LUNES}T08:00`, fin: `${LUNES}T09:00` }, cookie: admin })).cuerpo.error.codigo, 'SALA_CON_CLASE', 'la regla 12 ya aplica a la clase nueva');

    const id = creado.cuerpo.bloque.id;
    const cambiado = await pedir(`/api/horarios/${id}`, { metodo: 'PATCH', cuerpo: { espacioId: 'azul', docente: '' }, cookie: admin });
    assert.equal(cambiado.status, 200);
    assert.deepEqual(cambiado.cuerpo.reservasEnConflicto, [], 'ya no está en Apolo');
    assert.equal(cambiado.cuerpo.bloque.docente, undefined);
    assert.equal((await leerDB()).horarios[0].espacioId, 'azul');

    assert.equal((await pedir('/api/horarios', { metodo: 'POST', cuerpo: { ...DATOS, horaFin: '05:00' }, cookie: admin })).cuerpo.error.codigo, 'HORARIO_INVALIDO');
    assert.equal((await pedir('/api/horarios/nada', { metodo: 'PATCH', cuerpo: {}, cookie: admin })).status, 404);
    assert.equal((await pedir(`/api/horarios/${id}`, { metodo: 'DELETE', cookie: admin })).status, 200);
    assert.equal((await leerDB()).horarios.length, 0);
    assert.equal((await leerDB()).reservas.length, 1, 'la reserva sigue ahí');
  });

  test('subir el Excel: el ensayo no guarda; con aplicar guarda; un error de formato no guarda nada', async () => {
    const alias = encodeURIComponent(JSON.stringify({ 'Sala Nueva': 'blanca' }));
    const ensayo = await pedir(`/api/horarios/importar?alias=${alias}&dias=L-V`, { metodo: 'POST', bytes: EXCEL(), cookie: admin });
    assert.equal(ensayo.status, 200);
    assert.deepEqual([ensayo.cuerpo.aplicado, ensayo.cuerpo.formato, ensayo.cuerpo.hoja, ensayo.cuerpo.bloques, ensayo.cuerpo.diasPorDefecto], [false, 'xlsx', 'Horarios', 3, 2]);
    assert.deepEqual(ensayo.cuerpo.porTipo, { software: 1, ingles: 1, ser: 1 });
    assert.equal((await leerDB()).horarios.length, 0, 'el ensayo no escribe nada');

    const aplicado = await pedir(`/api/horarios/importar?aplicar=true&alias=${alias}&dias=L-V`, { metodo: 'POST', bytes: EXCEL(), cookie: admin });
    assert.equal(aplicado.cuerpo.aplicado, true);
    const guardados = (await leerDB()).horarios;
    assert.equal(guardados.length, 3);
    assert.deepEqual(guardados.find((b) => b.tipo === 'ingles').espacioId, 'blanca');
    assert.deepEqual(guardados.find((b) => b.tipo === 'software').horaInicio, '06:00', 'las horas del Excel salen HH:MM');

    // Sin el alias, "Sala Nueva" es un error de formato: nada cambia
    const malo = await pedir('/api/horarios/importar?aplicar=true', { metodo: 'POST', bytes: EXCEL(), cookie: admin });
    assert.equal(malo.status, 200);
    assert.equal(malo.cuerpo.aplicado, false);
    assert.match(malo.cuerpo.errores[0].mensaje, /la sala "Sala Nueva" no existe/);
    assert.deepEqual(malo.cuerpo.salasSinReconocer, [{ nombre: 'Sala Nueva', sugerencia: null }]);
    assert.equal((await leerDB()).horarios.length, 3, 'el error no tocó lo guardado');
  });

  test('subir también acepta un CSV; archivo vacío, dañado, alias o días inválidos y archivos enormes dan errores claros', async () => {
    assert.equal((await pedir('/api/horarios/importar', { metodo: 'POST', bytes: CSV_EQUIVALENTE, cookie: admin })).cuerpo.formato, 'csv');
    assert.equal((await pedir('/api/horarios/importar', { metodo: 'POST', bytes: Buffer.alloc(0), cookie: admin })).cuerpo.error.codigo, 'ARCHIVO_VACIO');
    assert.equal((await pedir('/api/horarios/importar', { metodo: 'POST', bytes: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(80)]), cookie: admin })).cuerpo.error.codigo, 'XLSX_INVALIDO');
    assert.equal((await pedir('/api/horarios/importar?alias=no-es-json', { metodo: 'POST', bytes: EXCEL(), cookie: admin })).cuerpo.error.codigo, 'ALIAS_INVALIDO');
    assert.equal((await pedir('/api/horarios/importar?dias=M', { metodo: 'POST', bytes: EXCEL(), cookie: admin })).cuerpo.error.codigo, 'DIAS_INVALIDOS');
    const enorme = await pedir('/api/horarios/importar', { metodo: 'POST', bytes: Buffer.alloc(6 * 1024 * 1024, 1), cookie: admin });
    assert.deepEqual([enorme.status, enorme.cuerpo.error.codigo], [413, 'ARCHIVO_MUY_GRANDE']);
  });
});
