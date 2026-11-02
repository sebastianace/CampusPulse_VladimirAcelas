// =====================================================================
// TESTS DE LAS UTILIDADES DE FECHA (node:test)
// ---------------------------------------------------------------------
// src/domain/fechas.js es la base de las reglas de horario, días hábiles,
// duración, anticipación y solapamiento. Si estas funciones fallan,
// fallan todas esas reglas, por eso se prueban por separado.
// Formato del contrato: "YYYY-MM-DDTHH:mm" en hora de Bogotá.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ahoraBogota, hoyBogota, esFechaValida, esFechaHoraValida,
  minutosDelDia, diaDeLaSemana, minutosEntre, seSolapan,
} from '../src/domain/fechas.js';

describe('Formato de fechas', () => {
  test('acepta fechas reales en formato YYYY-MM-DD', () => {
    assert.equal(esFechaValida('2026-10-16'), true);
    assert.equal(esFechaValida('2024-02-29'), true); // año bisiesto
  });

  test('rechaza fechas que no existen o con otro formato', () => {
    assert.equal(esFechaValida('2026-02-29'), false); // 2026 no es bisiesto
    assert.equal(esFechaValida('2026-02-30'), false);
    assert.equal(esFechaValida('2026-13-01'), false);
    assert.equal(esFechaValida('16/10/2026'), false);
    assert.equal(esFechaValida('hoy'), false);
    assert.equal(esFechaValida(undefined), false);
  });

  test('acepta fecha y hora en formato YYYY-MM-DDTHH:mm', () => {
    assert.equal(esFechaHoraValida('2026-10-16T00:00'), true);
    assert.equal(esFechaHoraValida('2026-10-16T23:59'), true);
  });

  test('rechaza horas imposibles, segundos o zona horaria', () => {
    assert.equal(esFechaHoraValida('2026-10-16T24:00'), false);
    assert.equal(esFechaHoraValida('2026-10-16T10:60'), false);
    assert.equal(esFechaHoraValida('2026-10-16T10:00:00'), false);
    assert.equal(esFechaHoraValida('2026-10-16T10:00Z'), false);
    assert.equal(esFechaHoraValida('2026-10-16 10:00'), false);
  });
});

describe('Hora actual de Bogotá', () => {
  test('ahoraBogota devuelve el formato del contrato', () => {
    assert.match(ahoraBogota(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  test('convierte a hora de Bogotá (UTC-5) aunque el servidor esté en otra zona', () => {
    // 16 de octubre de 2026 a las 03:30 UTC = 15 de octubre a las 22:30 en Bogotá.
    assert.equal(ahoraBogota(new Date('2026-10-16T03:30:00Z')), '2026-10-15T22:30');
  });

  test('hoyBogota devuelve solo la fecha', () => {
    assert.match(hoyBogota(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Cálculos', () => {
  test('minutosDelDia cuenta desde la medianoche', () => {
    assert.equal(minutosDelDia('2026-10-16T00:00'), 0);
    assert.equal(minutosDelDia('2026-10-16T08:30'), 510);
    assert.equal(minutosDelDia('2026-10-16T21:00'), 1260);
  });

  test('diaDeLaSemana: 0 = domingo ... 6 = sábado', () => {
    assert.equal(diaDeLaSemana('2026-10-18T10:00'), 0); // domingo
    assert.equal(diaDeLaSemana('2026-10-19T10:00'), 1); // lunes
    assert.equal(diaDeLaSemana('2026-10-17T10:00'), 6); // sábado
  });

  test('minutosEntre mide la duración, incluso entre días distintos', () => {
    assert.equal(minutosEntre('2026-10-16T10:00', '2026-10-16T12:30'), 150);
    assert.equal(minutosEntre('2026-10-16T23:00', '2026-10-17T01:00'), 120);
  });
});

describe('Solapamiento de franjas', () => {
  test('franjas que se cruzan se solapan', () => {
    assert.equal(seSolapan('2026-10-16T10:00', '2026-10-16T12:00', '2026-10-16T11:00', '2026-10-16T13:00'), true);
    // Una franja dentro de otra
    assert.equal(seSolapan('2026-10-16T10:00', '2026-10-16T14:00', '2026-10-16T11:00', '2026-10-16T12:00'), true);
  });

  test('franjas pegadas o separadas no se solapan', () => {
    // 10-12 y 12-14: una termina justo cuando empieza la otra
    assert.equal(seSolapan('2026-10-16T10:00', '2026-10-16T12:00', '2026-10-16T12:00', '2026-10-16T14:00'), false);
    assert.equal(seSolapan('2026-10-16T08:00', '2026-10-16T09:00', '2026-10-16T15:00', '2026-10-16T16:00'), false);
  });
});
