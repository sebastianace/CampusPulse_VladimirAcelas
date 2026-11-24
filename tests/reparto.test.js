// =====================================================================
// TESTS DEL REPARTO DE INCIDENCIAS POR CATEGORÍA (node:test)
// ---------------------------------------------------------------------
// En el campus hay 2 técnicos de TI y cada uno atiende una categoría. Al reportarse una incidencia queda
// asignada al responsable de su categoría; un admin define quién es y puede reasignar. Asignar NO es
// atender: asignadaA es a quién le toca; atendidaPor, quién la toma de verdad.
// Reglas en memoria; la API, contra una base PostgreSQL temporal (docker compose up -d db).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { asignarPendientes, atenderIncidencia, crearIncidencia, reasignarIncidencia, resolverIncidencia } = await import('../src/domain/incidencias.js');
const { avisoDeIncidenciaAsignada } = await import('../src/domain/avisos.js');

const RESPONSABLES = new Map([['tecnologia', 'ana'], ['infraestructura', 'luis']]);
const crearDB = () => ({
  espacios: [{ id: 'apolo', nombre: 'Apolo', estado: 'disponible' }],
  recursos: [{ id: 'vb', nombre: 'Video beam', espacioId: 'apolo', estado: 'disponible' }],
  reservas: [], prestamos: [], incidencias: [],
});
const reporte = (categoria, extra = {}) => ({ descripcion: 'Falla algo', categoria, prioridad: 'media', espacioId: 'apolo', ...extra });

describe('Reparto: al crear la incidencia', () => {
  test('queda asignada al responsable de su categoría', () => {
    const db = crearDB();
    assert.equal(crearIncidencia(db, reporte('tecnologia'), { responsables: RESPONSABLES }).asignadaA, 'ana');
    assert.equal(crearIncidencia(db, reporte('infraestructura'), { responsables: RESPONSABLES }).asignadaA, 'luis');
  });

  test('sin responsable para esa categoría (o sin configuración) queda sin asignar, y no se pierde', () => {
    const db = crearDB();
    const solo = new Map([['tecnologia', 'ana']]);
    const sinDueno = crearIncidencia(db, reporte('infraestructura'), { responsables: solo });
    assert.ok(!('asignadaA' in sinDueno));
    assert.ok(!('asignadaA' in crearIncidencia(db, reporte('tecnologia'))));
    assert.equal(db.incidencias.length, 2);
  });

  test('crearla así no la marca como "en atención": asignar no es atender', () => {
    const i = crearIncidencia(crearDB(), reporte('tecnologia'), { responsables: RESPONSABLES });
    assert.ok(!('atendidaPor' in i));
    assert.equal(i.estado, 'abierta');
  });

  test('otro técnico puede tomar la incidencia aunque le tocara a ana (si ella no está)', () => {
    const db = crearDB();
    const i = crearIncidencia(db, reporte('tecnologia'), { responsables: RESPONSABLES });
    atenderIncidencia(db, i.id, { usuario: 'luis', rol: 'soporte_tecnico' });
    assert.deepEqual([i.asignadaA, i.atendidaPor], ['ana', 'luis']);
  });
});

describe('Reparto: reasignar y asignar pendientes', () => {
  test('reasignar cambia a quién le toca y no toca quién la atiende', () => {
    const db = crearDB();
    const i = crearIncidencia(db, reporte('tecnologia'), { responsables: RESPONSABLES });
    atenderIncidencia(db, i.id, { usuario: 'ana', rol: 'soporte_tecnico' });
    reasignarIncidencia(db, i.id, 'luis');
    assert.deepEqual([i.asignadaA, i.atendidaPor], ['luis', 'ana']);
  });

  test('una resuelta no se reasigna (409) y una que no existe da 404', () => {
    const db = crearDB();
    const i = crearIncidencia(db, reporte('tecnologia'));
    resolverIncidencia(db, i.id, { estado: 'resuelta' });
    assert.throws(() => reasignarIncidencia(db, i.id, 'ana'), { codigo: 'INCIDENCIA_YA_RESUELTA', status: 409 });
    assert.throws(() => reasignarIncidencia(db, 'nada', 'ana'), { status: 404 });
  });

  test('asignarPendientes: solo las abiertas de esa categoría que nadie tenía; las que ya tienen dueño no se tocan', () => {
    const db = crearDB();
    const libre = crearIncidencia(db, reporte('tecnologia'));
    const conDueno = crearIncidencia(db, reporte('tecnologia'), { responsables: new Map([['tecnologia', 'otro']]) });
    const resuelta = crearIncidencia(db, reporte('tecnologia'));
    resolverIncidencia(db, resuelta.id, { estado: 'resuelta' });
    const otraCategoria = crearIncidencia(db, reporte('infraestructura'));
    assert.deepEqual(asignarPendientes(db, 'tecnologia', 'ana').map((i) => i.id), [libre.id]);
    assert.equal(libre.asignadaA, 'ana');
    assert.equal(conDueno.asignadaA, 'otro');
    assert.ok(!('asignadaA' in resuelta) && !('asignadaA' in otraCategoria));
  });
});

describe('Reparto: aviso por correo', () => {
  const db = crearDB();
  const incidencia = crearIncidencia(db, reporte('tecnologia', { recursoId: 'vb' }), { responsables: RESPONSABLES });

  test('se le avisa a quien le tocó, con la sala y el equipo', () => {
    const [aviso] = avisoDeIncidenciaAsignada(db, incidencia, 'profe');
    assert.equal(aviso.para, 'ana');
    assert.match(aviso.asunto, /media para ti: Apolo · Video beam/);
    assert.match(aviso.mensaje, /Falla algo/);
    assert.match(aviso.mensaje, /Atender/);
  });

  test('no se le avisa a quien se la asignó a sí mismo', () => {
    assert.deepEqual(avisoDeIncidenciaAsignada(db, incidencia, 'ana'), []);
  });
});

describe('Reparto: API', () => {
  let servidor;
  let base;
  const cookies = {};
  const CLAVE = 'clave-de-prueba-1';
  async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  }
  const reportar = (categoria, cookie = cookies.profe) => pedir('/api/incidencias', 'POST',
    { descripcion: `Falla de ${categoria}`, categoria, prioridad: 'media', espacioId: 'skilab' }, cookie);

  before(async () => {
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
    cookies.admin = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
    for (const [usuario, nombre, rol] of [['profe', 'Profe', 'profesor'], ['ana', 'Ana Técnica', 'soporte_tecnico'], ['luis', 'Luis Técnico', 'soporte_tecnico']]) {
      await pedir('/api/usuarios', 'POST', { usuario, nombre, clave: CLAVE, rol }, cookies.admin);
      cookies[usuario] = (await pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE })).cookie;
    }
  });
  after(async () => {
    servidor.close();
    await bd.cerrar();
  });

  test('al principio ninguna categoría tiene responsable y la incidencia queda sin asignar', async () => {
    const { cuerpo } = await pedir('/api/responsables', 'GET', undefined, cookies.profe);
    assert.deepEqual(cuerpo, [
      { categoria: 'infraestructura', usuario: null, nombre: null },
      { categoria: 'tecnologia', usuario: null, nombre: null },
    ]);
    const { cuerpo: i } = await reportar('tecnologia');
    assert.ok(!('asignadaA' in i));
  });

  test('configurar es solo del admin: un profesor y un técnico reciben 403', async () => {
    for (const quien of ['profe', 'ana']) {
      const r = await pedir('/api/responsables/tecnologia', 'PUT', { usuario: 'ana' }, cookies[quien]);
      assert.equal(r.status, 403, quien);
    }
  });

  test('al definir el responsable, las incidencias abiertas sin dueño de esa categoría pasan a él', async () => {
    const antes = (await pedir('/api/incidencias', 'GET', undefined, cookies.admin)).cuerpo;
    assert.equal(antes.filter((i) => i.categoria === 'tecnologia' && !i.asignadaA).length, 1);
    const r = await pedir('/api/responsables/tecnologia', 'PUT', { usuario: 'ana' }, cookies.admin);
    assert.deepEqual(r.cuerpo, { categoria: 'tecnologia', usuario: 'ana', nombre: 'Ana Técnica', asignadas: 1 });
    const despues = (await pedir('/api/incidencias', 'GET', undefined, cookies.admin)).cuerpo;
    assert.deepEqual(despues.map((i) => [i.asignadaA, i.asignadaANombre]), [['ana', 'Ana Técnica']]);
  });

  test('con responsable, la incidencia nueva sale asignada según su categoría', async () => {
    await pedir('/api/responsables/infraestructura', 'PUT', { usuario: 'luis' }, cookies.admin);
    const tec = (await reportar('tecnologia')).cuerpo;
    const infra = (await reportar('infraestructura')).cuerpo;
    assert.equal(tec.asignadaA, 'ana');
    assert.equal(infra.asignadaA, 'luis');
    const lista = (await pedir('/api/incidencias', 'GET', undefined, cookies.profe)).cuerpo;
    assert.equal(lista.find((i) => i.id === infra.id).asignadaANombre, 'Luis Técnico');
  });

  test('solo puede ser responsable quien puede atender; categorías y cuentas inexistentes se rechazan', async () => {
    assert.equal((await pedir('/api/responsables/tecnologia', 'PUT', { usuario: 'profe' }, cookies.admin)).cuerpo.error.codigo, 'ROL_NO_PUEDE_ATENDER');
    assert.equal((await pedir('/api/responsables/tecnologia', 'PUT', { usuario: 'fantasma' }, cookies.admin)).status, 404);
    assert.equal((await pedir('/api/responsables/aseo', 'PUT', { usuario: 'ana' }, cookies.admin)).status, 422);
    assert.equal((await pedir('/api/responsables', 'GET', undefined, cookies.admin)).cuerpo.find((r) => r.categoria === 'tecnologia').usuario, 'ana', 'no cambió');
  });

  test('un admin reasigna; un técnico o profesor no (403); la cuenta destino debe poder atender', async () => {
    const { cuerpo: i } = await reportar('tecnologia');
    assert.equal((await pedir(`/api/incidencias/${i.id}/asignar`, 'POST', { usuario: 'luis' }, cookies.ana)).status, 403);
    assert.equal((await pedir(`/api/incidencias/${i.id}/asignar`, 'POST', { usuario: 'luis' }, cookies.profe)).status, 403);
    assert.equal((await pedir(`/api/incidencias/${i.id}/asignar`, 'POST', { usuario: 'profe' }, cookies.admin)).cuerpo.error.codigo, 'ROL_NO_PUEDE_ATENDER');
    const r = await pedir(`/api/incidencias/${i.id}/asignar`, 'POST', { usuario: 'luis' }, cookies.admin);
    assert.deepEqual([r.status, r.cuerpo.asignadaA, r.cuerpo.asignadaANombre], [200, 'luis', 'Luis Técnico']);
    assert.equal((await pedir('/api/incidencias/inc-no-existe/asignar', 'POST', { usuario: 'luis' }, cookies.admin)).status, 404);
  });

  test('una incidencia resuelta no se reasigna (409)', async () => {
    const { cuerpo: i } = await reportar('tecnologia');
    await pedir(`/api/incidencias/${i.id}`, 'PATCH', { estado: 'resuelta' }, cookies.ana);
    assert.equal((await pedir(`/api/incidencias/${i.id}/asignar`, 'POST', { usuario: 'luis' }, cookies.admin)).cuerpo.error.codigo, 'INCIDENCIA_YA_RESUELTA');
  });

  test('quitar el responsable (usuario null) deja las nuevas sin asignar, y las que ya estaban asignadas se conservan', async () => {
    const r = await pedir('/api/responsables/tecnologia', 'PUT', { usuario: null }, cookies.admin);
    assert.deepEqual(r.cuerpo, { categoria: 'tecnologia', usuario: null, nombre: null, asignadas: 0 });
    const nueva = (await reportar('tecnologia')).cuerpo;
    assert.ok(!('asignadaA' in nueva));
    const lista = (await pedir('/api/incidencias', 'GET', undefined, cookies.admin)).cuerpo;
    assert.ok(lista.some((i) => i.asignadaA === 'ana'), 'las anteriores siguen con ana');
  });

  test('la base impide un responsable de una categoría que no existe (CHECK)', async () => {
    await assert.rejects(bd.pool.query("INSERT INTO responsables_categoria (categoria, usuario) VALUES ('aseo', 'ana')"), { code: '23514' });
  });
});
