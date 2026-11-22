// =====================================================================
// TESTS DE LA ZONA HUNTERS (data/seed/espacios-extra.json)
// ---------------------------------------------------------------------
// Las mesas de ping-pong ya no son espacios: no se reservan en el campus.
// Hunters, la zona común donde están, existe para reportar daños ahí,
// pero es de tipo zona_comun (REGLAS.TIPOS_NO_RESERVABLES) y no se reserva.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoInicial } from '../src/data/estado-inicial.js';
import { REGLAS } from '../src/config/reglas.js';
import { buscarEspaciosDisponibles, crearReserva, esReservable } from '../src/domain/reservas.js';
import { listarEspacios } from '../src/domain/espacios.js';
import { crearIncidencia } from '../src/domain/incidencias.js';

// Un martes dentro del horario, lejos en el futuro para no chocar con "no reservar en el pasado"
const FRANJA = { inicio: '2030-11-19T10:00', fin: '2030-11-19T11:00' };
const db = () => ({ ...crearEstadoInicial(), reservas: [], incidencias: [] });

describe('Zona Hunters', () => {
  test('el estado inicial trae Hunters además de los 9 espacios oficiales, y ya no las mesas de ping-pong', () => {
    const { espacios, calidadDatos } = crearEstadoInicial();
    const ids = espacios.map((e) => e.id);
    assert.ok(ids.includes('hunters'));
    assert.ok(!ids.includes('ping-pong-1') && !ids.includes('ping-pong-2'));
    assert.equal(espacios.length, 10);
    // El reporte de calidad sigue hablando solo del CSV oficial
    assert.equal(calidadDatos.cargados, 9);
  });

  test('es una zona común sin aforo, y la API la marca como no reservable', () => {
    const hunters = crearEstadoInicial().espacios.find((e) => e.id === 'hunters');
    assert.equal(hunters.nombre, 'Zona Hunters');
    assert.ok(REGLAS.TIPOS_NO_RESERVABLES.includes(hunters.tipo));
    assert.equal(hunters.aforo, null);
    assert.equal(esReservable(hunters), false);
    const lista = listarEspacios(db(), '2030-11-19T10:00');
    assert.equal(lista.find((e) => e.id === 'hunters').reservable, false);
    assert.equal(lista.find((e) => e.id === 'apolo').reservable, true);
  });

  test('reservarla se rechaza con un mensaje claro', () => {
    const base = db();
    assert.throws(() => crearReserva(base, { espacioId: 'hunters', responsable: 'Ana', asistentes: 4, ...FRANJA }),
      { status: 409, codigo: 'ESPACIO_NO_RESERVABLE', message: /zona común/ });
    assert.equal(base.reservas.length, 0);
  });

  test('nunca aparece entre los espacios disponibles ni en las recomendaciones', () => {
    const ids = buscarEspaciosDisponibles({ asistentes: 2, ...FRANJA }, db()).map((e) => e.id);
    assert.ok(ids.length > 0);
    assert.ok(!ids.includes('hunters'));
  });

  test('sí se puede reportar un daño en Hunters', () => {
    const base = db();
    const incidencia = crearIncidencia(base, {
      descripcion: 'La red de la mesa de ping-pong está rota', categoria: 'infraestructura', prioridad: 'baja',
      espacioId: 'hunters', recursoId: null, inhabilitar: false, origen: 'manual',
    });
    assert.equal(incidencia.espacioId, 'hunters');
  });
});
