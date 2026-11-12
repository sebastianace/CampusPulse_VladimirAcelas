// Tests de la lógica pura de la voz (public/js/voz-texto.js). El micrófono y el altavoz se prueban a mano.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { elegirVoz, mensajeDeErrorDeVoz, textoDeRecomendacion, unirDictado } from '../public/js/voz-texto.js';

describe('unirDictado', () => {
  test('en un campo vacío empieza con mayúscula', () => {
    assert.equal(unirDictado('', 'el video beam de apolo no prende'), 'El video beam de apolo no prende');
  });

  test('si ya había texto, lo conserva y agrega el dictado con un espacio', () => {
    assert.equal(unirDictado('El proyector falla.', '  y huele a quemado '), 'El proyector falla. y huele a quemado');
  });

  test('colapsa espacios repetidos y no cambia nada si no se dictó nada', () => {
    assert.equal(unirDictado('Hola', 'uno   dos'), 'Hola uno dos');
    assert.equal(unirDictado('Hola ', ''), 'Hola');
    assert.equal(unirDictado(undefined, undefined), '');
  });

  test('re-dictar sobre el mismo texto inicial no acumula el dictado anterior', () => {
    // El navegador entrega resultados parciales que crecen: cada uno se une al texto INICIAL, no al anterior.
    const inicial = 'Ej.:';
    assert.equal(unirDictado(inicial, 'la sala'), 'Ej.: la sala');
    assert.equal(unirDictado(inicial, 'la sala azul'), 'Ej.: la sala azul');
  });
});

describe('elegirVoz', () => {
  const voz = (lang, name = lang) => ({ lang, name });

  test('prefiere es-CO, luego cualquier español, y si no hay devuelve null', () => {
    const voces = [voz('en-US'), voz('es-ES'), voz('es-CO'), voz('es-MX')];
    assert.equal(elegirVoz(voces).lang, 'es-CO');
    assert.equal(elegirVoz([voz('en-US'), voz('es-MX')]).lang, 'es-MX');
    assert.equal(elegirVoz([voz('en-US'), voz('fr-FR')]), null);
    assert.equal(elegirVoz([]), null);
    assert.equal(elegirVoz(undefined), null);
  });

  test('acepta el idioma con guion bajo (algunos Android lo reportan así)', () => {
    assert.equal(elegirVoz([voz('es_CO')]).lang, 'es_CO');
  });
});

describe('mensajeDeErrorDeVoz', () => {
  test('explica en español cada error conocido y no avisa cuando la persona detuvo el dictado', () => {
    for (const codigo of ['not-allowed', 'no-speech', 'audio-capture', 'network', 'service-not-allowed']) {
      assert.match(mensajeDeErrorDeVoz(codigo), /[a-záéíóú]{4,}/i, codigo);
    }
    assert.match(mensajeDeErrorDeVoz('not-allowed'), /micrófono/);
    assert.equal(mensajeDeErrorDeVoz('aborted'), null);
    assert.match(mensajeDeErrorDeVoz('algo-raro'), /escribe el texto a mano/i);
  });
});

describe('textoDeRecomendacion', () => {
  test('lee la explicación y los nombres de las salas, no sus identificadores', () => {
    const nombres = { apolo: 'Apolo', 'sala-azul': 'Sala Azul' };
    const texto = textoDeRecomendacion(
      { explicacion: 'Te recomiendo Apolo.', opciones: [{ espacioId: 'apolo' }, { espacioId: 'sala-azul' }] },
      (id) => nombres[id],
    );
    assert.equal(texto, 'Te recomiendo Apolo. Salas disponibles: Apolo, Sala Azul.');
  });

  test('sin opciones solo lee la explicación', () => {
    assert.equal(textoDeRecomendacion({ explicacion: 'No hay salas.', opciones: [] }), 'No hay salas.');
  });
});
