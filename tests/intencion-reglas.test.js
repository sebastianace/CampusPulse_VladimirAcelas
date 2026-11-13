// Tests de las reglas que deciden la intención de Ctrl+K sin gastar una llamada a Gemini.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { intencionPorReglas } from '../src/ai/intencion.js';

describe('intencionPorReglas: reservar', () => {
  test('pedir un espacio con cuántas personas y cuándo, aunque sea en forma de pregunta', () => {
    for (const texto of [
      'Necesito un salón para 30 personas el próximo martes de 2 a 4 pm',
      'Una sala para 10 personas el lunes de dos a cuatro',
      '¿Puedo reservar una sala para 20 personas mañana a las 3 pm?',
      'Quiero reservar Apolo mañana de 2 a 4',
      'busco un aula con computadores para 25 estudiantes el viernes de 8 a 12',
      'Agéndame el auditorio el sábado a las 9 am para 80 personas',
      'reserva Cosmos el jueves de 10 a 12 para 15 campers',
      'Sala para 12 personas el 20/11 de 3 a 5 pm',
      '¿Hay salas libres mañana de 2 a 4?',
    ]) assert.equal(intencionPorReglas(texto), 'reservar', texto);
  });
});

describe('intencionPorReglas: preguntar', () => {
  test('preguntas sobre las reglas, los roles o el campus', () => {
    for (const texto of [
      '¿Cuántas horas puedo reservar una sala como máximo?',
      '¿Qué salas tienen computadores?',
      '¿Quién puede marcar una incidencia como resuelta?',
      '¿Cuántas personas caben en Apolo?',
      '¿Cuántas reservas puedo tener en un mismo día?',
      'cómo reporto un equipo dañado',
      'explícame las reglas de los préstamos',
      '¿Quién ganó el mundial de fútbol de 2014?',
    ]) assert.equal(intencionPorReglas(texto), 'preguntar', texto);
  });

  test('las preguntas de seguimiento, que empiezan con "y"', () => {
    assert.equal(intencionPorReglas('¿y los domingos?'), 'preguntar');
    assert.equal(intencionPorReglas('y cuántos equipos puedo llevar a la vez'), 'preguntar');
  });

  test('no distingue mayúsculas ni tildes', () => {
    assert.equal(intencionPorReglas('CUANTAS HORAS PUEDO RESERVAR UNA SALA'), 'preguntar');
    assert.equal(intencionPorReglas('NECESITO UNA SALA PARA 10 PERSONAS MANANA A LAS 3 PM'), 'reservar');
  });
});

describe('intencionPorReglas: ante la duda no decide (null: que decida la IA)', () => {
  test('mensajes ambiguos, vacíos o sin señales', () => {
    for (const texto of ['hola', 'gracias', 'necesito una sala', 'Reservar', '', '   ', undefined, null]) {
      assert.equal(intencionPorReglas(texto), null, String(texto));
    }
  });

  test('una pregunta que pide sala con fecha u hora no se manda al RAG por error', () => {
    // "¿Hay salas libres mañana?" tiene forma de pregunta pero es una búsqueda de sala: nunca debe ser "preguntar"
    assert.notEqual(intencionPorReglas('¿Hay salas libres mañana?'), 'preguntar');
    assert.notEqual(intencionPorReglas('¿Tienen un salón disponible hoy a las 4 pm?'), 'preguntar');
  });
});
