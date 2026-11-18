// =====================================================================
// COHERENCIA DE LA BASE DE CONOCIMIENTO (node:test)
// ---------------------------------------------------------------------
// Los documentos de knowledge/ repiten datos que viven en el código (src/config/reglas.js, el CSV de
// aforos). Si alguien cambia una regla y olvida el documento, Pulse respondería algo desactualizado:
// estos tests avisan. Tampoco hace falta base de datos ni Gemini.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REGLAS } from '../src/config/reglas.js';
import { PERSONALIDAD_PULSE } from '../src/ai/prompts/personalidad.js';
import { MAX_INTENTOS_LOGIN, MINUTOS_VENTANA_LOGIN } from '../src/auth/intentos.js';
import { HORAS_SESION } from '../src/auth/usuarios.js';
import { nombreEnCampus } from '../src/config/nombres.js';
import { crearId } from '../src/data/loader.js';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const documentos = readdirSync(new URL('../knowledge/', import.meta.url)).filter((f) => f.endsWith('.md') && f !== 'README.md');
const doc = (nombre) => leer(`knowledge/${nombre}`);

describe('knowledge/ dice lo mismo que el código', () => {
  test('hay documentos y todos están marcados como ejemplo (no son un reglamento oficial)', () => {
    assert.ok(documentos.length >= 5);
    for (const f of documentos) assert.match(doc(f), /Documento de ejemplo/i, f);
  });

  test('horario, duración, límites por persona y anticipación del reglamento', () => {
    const r = doc('reglamento-de-uso-de-salas.md');
    assert.match(r, new RegExp(`${REGLAS.HORA_APERTURA}:00 a\\. m\\.`));
    assert.match(r, new RegExp(`${REGLAS.HORA_CIERRE - 12}:00 p\\. m\\.`));
    assert.match(r, new RegExp(`${REGLAS.MAX_HORAS_RESERVA} horas`));
    assert.match(r, new RegExp(`${REGLAS.MAX_RESERVAS_POR_PERSONA_DIA} reservas`));
    assert.deepEqual(REGLAS.DIAS_HABILES, [1, 2, 3, 4, 5, 6], 'el documento dice "lunes a sábado": si cambian los días, actualízalo');
    assert.match(r, /lunes a sábado/);
    assert.equal(REGLAS.MARGEN_AFORO, 1.0, 'el documento dice que no se puede superar el aforo');
    assert.equal(REGLAS.ANTICIPACION_MINIMA_MINUTOS, 0);
  });

  // Los documentos usan el nombre de la sala en el campus (Sputnik, Skylabs...), el mismo que muestra el tablero.
  test('las salas con computadores son las mismas', () => {
    const r = doc('reglamento-de-uso-de-salas.md');
    for (const id of REGLAS.ESPACIOS_CON_COMPUTADORES) {
      assert.match(r, new RegExp(nombreEnCampus(id, id.charAt(0).toUpperCase() + id.slice(1))), id);
    }
  });

  test('el campus no presta equipos', () => {
    assert.match(doc('prestamo-de-equipos.md'), /no presta equipos/);
    assert.equal(REGLAS.TRANSICIONES_RECURSO.prestado, undefined);
  });

  test('aforos del archivo oficial', () => {
    const csv = leer('data/raw/espacios.csv').trim().split('\n').slice(1).map((l) => l.split(','));
    const espacios = doc('espacios-del-campus.md');
    for (const [oficial, aforo] of csv) {
      const nombre = nombreEnCampus(crearId(oficial), oficial);
      assert.match(espacios, new RegExp(`${nombre} ${aforo}\\b`), `${nombre} ${aforo}`);
      // Si cambió de nombre, el documento también dice cómo se llama en el archivo oficial
      // (los saltos de línea del documento cuentan como espacios)
      const conEspacios = (texto) => texto.replace(/ /g, '\\s+');
      if (nombre !== oficial) assert.match(espacios, new RegExp(`${conEspacios(nombre)}\\s+\\(${conEspacios('en el archivo oficial,')}\\s+${conEspacios(oficial)}\\)`), oficial);
    }
  });

  test('límite de IA, intentos de login y duración de la sesión', () => {
    const f = doc('preguntas-frecuentes.md');
    assert.match(f, new RegExp(`${REGLAS.LIMITE_IA_PETICIONES} consultas a la IA por minuto`));
    assert.equal(REGLAS.LIMITE_IA_VENTANA_MINUTOS, 1);
    assert.match(f, new RegExp(`${MAX_INTENTOS_LOGIN} intentos fallidos en ${MINUTOS_VENTANA_LOGIN} minutos`));
    assert.match(f, new RegExp(`${HORAS_SESION} horas`));
  });
});

describe('la personalidad de Pulse es la misma en Node y en Python', () => {
  test('cada conducta de personalidad.js aparece idéntica en pulse-ai/app/prompts.py', () => {
    const python = leer('pulse-ai/app/prompts.py');
    for (const [rasgo, { nivel, conducta }] of Object.entries(PERSONALIDAD_PULSE)) {
      assert.ok(python.includes(conducta), `${rasgo}: la conducta cambió en Node y no en Python`);
      assert.ok(python.includes(`"${nivel}"`) || python.includes(nivel), `${rasgo}: nivel ${nivel}`);
    }
  });
});
