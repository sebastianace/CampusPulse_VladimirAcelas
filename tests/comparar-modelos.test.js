// Tests de la parte pura del comparador de modelos (src/ai/comparar-modelos.js). No llaman a Gemini.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AHORA_FIJO, CASOS_SOLICITUD, compararSolicitud, resumirLlamadas } from '../src/ai/comparar-modelos.js';
import { diaDeLaSemana } from '../src/domain/fechas.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

describe('casos de extracción de la solicitud', () => {
  test('"ahora" es viernes 13 de noviembre de 2026', () => {
    assert.equal(DIAS[diaDeLaSemana(AHORA_FIJO)], 'viernes');
  });

  test('cada fecha esperada cae en el día que nombra el pedido (hoy, mañana o el día de la semana)', () => {
    for (const { texto, esperado } of CASOS_SOLICITUD) {
      const dia = DIAS[diaDeLaSemana(esperado.inicio)];
      if (/\bhoy\b/.test(texto)) assert.equal(esperado.inicio.slice(0, 10), AHORA_FIJO.slice(0, 10), texto);
      else if (/\bmañana\b/.test(texto)) assert.equal(esperado.inicio.slice(0, 10), '2026-11-14', texto);
      else assert.match(texto, new RegExp(dia), `${texto}: el ${esperado.inicio} es ${dia}`);
      assert.ok(esperado.inicio > AHORA_FIJO && esperado.fin > esperado.inicio, texto);
    }
  });
});

describe('compararSolicitud y resumirLlamadas', () => {
  const esperado = { asistentes: 30, inicio: '2026-11-17T14:00', fin: '2026-11-17T16:00' };

  test('acierta solo si personas, inicio y fin coinciden', () => {
    assert.equal(compararSolicitud(esperado, { ...esperado }), true);
    assert.equal(compararSolicitud(esperado, { ...esperado, fin: '2026-11-17T15:00' }), false);
    assert.equal(compararSolicitud(esperado, { ...esperado, asistentes: null }), false);
    assert.equal(compararSolicitud(esperado, null), false);
  });

  test('resume aciertos, errores y promedios solo de las llamadas que respondieron', () => {
    const r = resumirLlamadas([
      { acierto: true, ms: 1000, tokensEntrada: 100, tokensSalida: 20, tokensRazonamiento: 0 },
      { acierto: false, ms: 3000, tokensEntrada: 300, tokensSalida: 40, tokensRazonamiento: 50 },
      { error: '503', acierto: false },
    ]);
    assert.deepEqual(r, { total: 3, aciertos: 1, errores: 1, msPromedio: 2000, tokensEntrada: 200, tokensSalida: 30, tokensRazonamiento: 25 });
    assert.equal(resumirLlamadas([{ error: 'x', acierto: false }]).msPromedio, null);
  });
});
