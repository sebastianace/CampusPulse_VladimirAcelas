// =====================================================================
// TESTS DE LOS INDICADORES DE SOPORTE TI (node:test)
// ---------------------------------------------------------------------
// Tiempo de atención (reporte -> "en atención", o la resolución si la
// resolvieron sin tomarla) y de resolución, con mediana. El cálculo es una
// función pura; la ruta se prueba contra PostgreSQL (docker compose up -d db).
// =====================================================================

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { indicadoresTI, minutosHastaAtencion, minutosHastaResolucion } = await import('../src/domain/indicadores.js');

// Lunes 16 de noviembre de 2026, 6:00 p. m.
const AHORA = '2026-11-16T18:00';
const inc = (id, prioridad, fecha, extra = {}) => ({ id, descripcion: `Falla ${id}`, prioridad, fecha, estado: 'abierta', ...extra });
const resuelta = (fechaResolucion, extra = {}) => ({ estado: 'resuelta', fechaResolucion, ...extra });

describe('Indicadores de TI: cálculo', () => {
  test('atención = hasta "en atención"; si la resolvieron sin tomarla, hasta la resolución', () => {
    assert.equal(minutosHastaAtencion(inc('a', 'alta', '2026-11-16T09:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T09:15' })), 15);
    assert.equal(minutosHastaAtencion(inc('b', 'alta', '2026-11-16T09:00', resuelta('2026-11-16T10:30'))), 90);
    assert.equal(minutosHastaAtencion(inc('c', 'alta', '2026-11-16T09:00')), null, 'nadie ha respondido');
    assert.equal(minutosHastaResolucion(inc('d', 'alta', '2026-11-15T23:30', resuelta('2026-11-16T00:10'))), 40, 'cruza la medianoche');
  });

  test('usa la mediana: una incidencia olvidada no esconde cómo trabaja TI normalmente', () => {
    const lista = [
      inc('1', 'media', '2026-11-16T08:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T08:10' }),
      inc('2', 'media', '2026-11-16T09:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T09:20' }),
      inc('3', 'media', '2026-11-13T09:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T09:00' }), // se quedó el fin de semana
    ];
    const { atencion } = indicadoresTI(lista, AHORA).ventana;
    assert.deepEqual(atencion, { casos: 3, medianaMin: 20, promedioMin: 1450 });
  });

  test('mediana con un número par de casos: el punto medio', () => {
    const lista = ['10', '30'].map((m, n) => inc(`p${n}`, 'baja', '2026-11-16T08:00', resuelta(`2026-11-16T08:${m}`)));
    assert.equal(indicadoresTI(lista, AHORA).ventana.resolucion.medianaMin, 20);
  });

  test('la ventana son los últimos 7 días; el histórico, todo', () => {
    const lista = [
      inc('nueva', 'alta', '2026-11-16T08:00', resuelta('2026-11-16T09:00')),
      inc('vieja', 'alta', '2026-11-01T08:00', resuelta('2026-11-01T20:00')),
    ];
    const r = indicadoresTI(lista, AHORA);
    assert.equal(r.desde, '2026-11-09T18:00');
    assert.deepEqual([r.ventana.reportadas, r.ventana.resueltas, r.ventana.resolucion.medianaMin], [1, 1, 60]);
    assert.deepEqual([r.historico.reportadas, r.historico.resolucion.medianaMin], [2, 390]);
  });

  test('por prioridad, en orden de urgencia y solo las que tienen casos', () => {
    const lista = [
      inc('b', 'baja', '2026-11-16T08:00', resuelta('2026-11-16T12:00')),
      inc('c', 'critica', '2026-11-16T08:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T08:05' }),
    ];
    const r = indicadoresTI(lista, AHORA);
    assert.deepEqual(r.porPrioridad.map((p) => [p.prioridad, p.atencion.medianaMin, p.resolucion.medianaMin]), [['critica', 5, null], ['baja', 240, 240]]);
  });

  test('abiertas, sin atender y la que más lleva esperando', () => {
    const lista = [
      inc('reciente', 'media', '2026-11-16T17:00'),
      inc('olvidada', 'baja', '2026-11-16T10:00'),
      inc('tomada', 'alta', '2026-11-16T09:00', { atendidaPor: 't', fechaAtencion: '2026-11-16T09:30' }),
      inc('lista', 'alta', '2026-11-16T08:00', resuelta('2026-11-16T08:30')),
    ];
    const r = indicadoresTI(lista, AHORA);
    assert.deepEqual([r.abiertas, r.sinAtender], [3, 2]);
    assert.deepEqual(r.masAntiguaSinAtender, { id: 'olvidada', descripcion: 'Falla olvidada', prioridad: 'baja', minutosEsperando: 480 });
  });

  test('sin incidencias: todo en cero o null, sin dividir por cero', () => {
    const r = indicadoresTI([], AHORA);
    assert.deepEqual(r.ventana, { reportadas: 0, resueltas: 0, atencion: { casos: 0, medianaMin: null, promedioMin: null }, resolucion: { casos: 0, medianaMin: null, promedioMin: null } });
    assert.deepEqual([r.porPrioridad, r.masAntiguaSinAtender], [[], null]);
  });
});

describe('Indicadores de TI: API', () => {
  let servidor;
  let base;
  before(() => {
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}`;
  });
  after(async () => {
    servidor.close();
    await bd.cerrar();
  });

  async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, cuerpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  }

  test('admin y soporte técnico los ven; un profesor recibe 403', async () => {
    const CLAVE = 'clave-de-prueba-1';
    const jefa = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
    for (const [usuario, rol] of [['tecnico', 'soporte_tecnico'], ['profe', 'profesor']]) {
      await pedir('/api/usuarios', 'POST', { usuario, nombre: usuario, clave: CLAVE, rol }, jefa);
    }
    const tecnico = (await pedir('/api/auth/login', 'POST', { usuario: 'tecnico', clave: CLAVE })).cookie;
    const profe = (await pedir('/api/auth/login', 'POST', { usuario: 'profe', clave: CLAVE })).cookie;

    const creada = await pedir('/api/incidencias', 'POST', { descripcion: 'No hay wifi en Apolo', categoria: 'tecnologia', prioridad: 'media', espacioId: 'apolo', origen: 'manual' }, profe);
    await pedir(`/api/incidencias/${creada.cuerpo.id}/atender`, 'POST', undefined, tecnico);

    const { status, cuerpo } = await pedir('/api/incidencias/indicadores', 'GET', undefined, tecnico);
    assert.equal(status, 200);
    assert.deepEqual([cuerpo.ventanaDias, cuerpo.ventana.reportadas, cuerpo.ventana.atencion.casos, cuerpo.abiertas, cuerpo.sinAtender], [7, 1, 1, 1, 0]);
    assert.equal((await pedir('/api/incidencias/indicadores', 'GET', undefined, jefa)).status, 200);
    assert.equal((await pedir('/api/incidencias/indicadores', 'GET', undefined, profe)).status, 403);
  });
});
