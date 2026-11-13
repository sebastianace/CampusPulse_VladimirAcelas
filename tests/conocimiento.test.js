// =====================================================================
// TESTS DE LAS PREGUNTAS AL CONOCIMIENTO (RAG) Y DE LA BARRA CTRL+K (node:test)
// ---------------------------------------------------------------------
// Express no hace RAG: llama a pulse-ai por HTTP. Aquí pulse-ai y Gemini son FALSOS (un servidor HTTP
// de mentira y un generador de JSON de mentira): se prueba lo que es de Express (validación, límite,
// caché, traducción de errores, elección de intención) sin gastar cuota ni levantar Python.
// Requiere `docker compose up -d db` (la app corre contra una base PostgreSQL temporal).
// =====================================================================

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { crearBaseDeLaApp } from './ayuda-bd.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { REGLAS } = await import('../src/config/reglas.js');
const { usarGeneradorDeJSON } = await import('../src/ai/cliente.js');
const { vaciarCache } = await import('../src/ai/cache.js');

const CLAVE = 'clave-de-prueba-1';

// ---------- pulse-ai falso ----------

const RESPUESTA_OK = {
  respondido: true,
  respuesta: 'Máximo 4 horas.',
  areaSugerida: null,
  consulta: 'x',
  reranking: true,
  modelo: 'falso',
  fragmentos: [{ documento: 'Reglamento', seccion: 'Duración máxima', archivo: 'r.md', texto: 'Hasta 4 horas.', similitud: 0.8, puntaje: 9, usado: true, ejemplo: true }],
};

let pulseAi; // servidor falso
let recibidas; // peticiones que le llegaron
let comportamiento; // (cuerpo, req) => {status, cuerpo, demora?}

function levantarPulseAi() {
  return new Promise((resolver) => {
    pulseAi = createServer(async (req, res) => {
      let texto = '';
      for await (const trozo of req) texto += trozo;
      const cuerpo = texto ? JSON.parse(texto) : {};
      recibidas.push({ ruta: req.url, cuerpo, token: req.headers['x-pulse-token'] });
      const { status = 200, cuerpo: salida, demora = 0 } = comportamiento(cuerpo, req);
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(typeof salida === 'string' ? salida : JSON.stringify(salida));
      }, demora);
    });
    pulseAi.listen(0, () => {
      process.env.PULSE_AI_URL = `http://localhost:${pulseAi.address().port}`;
      resolver();
    });
  });
}

// ---------- servidor de la app ----------

let servidor;
let base;
async function pedir(ruta, metodo = 'GET', cuerpo, cookie = '') {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', cookie },
    body: cuerpo && JSON.stringify(cuerpo),
  });
  return {
    status: respuesta.status,
    cuerpo: await respuesta.json(),
    cache: respuesta.headers.get('x-cache'),
    cookie: respuesta.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
const entrar = (usuario) => pedir('/api/auth/login', 'POST', { usuario, clave: CLAVE });

let admin;
let profe;
let contador = 0;
// Un profesor nuevo con su propio cupo de IA: así un test no le gasta el cupo a otro.
async function sesionNueva() {
  const usuario = `prof${++contador}`;
  await pedir('/api/usuarios', 'POST', { usuario, nombre: usuario, clave: CLAVE, rol: 'profesor' }, admin);
  return (await entrar(usuario)).cookie;
}
before(async () => {
  servidor = app.listen(0);
  base = `http://localhost:${servidor.address().port}`;
  await levantarPulseAi();
  admin = (await pedir('/api/auth/registro', 'POST', { usuario: 'jefa', nombre: 'Jefa', clave: CLAVE })).cookie;
  profe = await sesionNueva();
});
after(async () => {
  usarGeneradorDeJSON(null);
  delete process.env.PULSE_AI_URL;
  delete process.env.PULSE_AI_TOKEN;
  servidor.close();
  pulseAi.closeAllConnections();
  pulseAi.close();
  await bd.cerrar();
});
beforeEach(() => {
  recibidas = [];
  comportamiento = () => ({ cuerpo: RESPUESTA_OK });
  vaciarCache();
  delete process.env.PULSE_AI_TOKEN;
});

describe('POST /api/ia/preguntar', () => {
  test('reenvía la pregunta a pulse-ai y devuelve la respuesta con sus fuentes', async () => {
    const { status, cuerpo } = await pedir('/api/ia/preguntar', 'POST', { pregunta: '  ¿Cuántas horas?  ' }, profe);
    assert.equal(status, 200);
    assert.deepEqual(cuerpo, RESPUESTA_OK);
    assert.deepEqual(recibidas, [{ ruta: '/preguntar', cuerpo: { pregunta: '¿Cuántas horas?', historial: [] }, token: undefined }]);
  });

  test('sin sesión es 401', async () => {
    assert.equal((await pedir('/api/ia/preguntar', 'POST', { pregunta: 'hola' })).status, 401);
  });

  test('envía el token compartido solo si está configurado', async () => {
    process.env.PULSE_AI_TOKEN = 'secreto-de-prueba';
    await pedir('/api/ia/preguntar', 'POST', { pregunta: 'con token' }, profe);
    assert.equal(recibidas[0].token, 'secreto-de-prueba');
  });

  test('valida la pregunta y el historial (422) sin llamar a pulse-ai ni gastar cupo', async () => {
    const malos = [
      {}, { pregunta: '   ' }, { pregunta: 'x'.repeat(1001) }, { pregunta: 5 },
      { pregunta: 'hola', historial: 'no' },
      { pregunta: 'hola', historial: [{ rol: 'robot', texto: 'x' }] },
      { pregunta: 'hola', historial: [{ rol: 'usuario', texto: '' }] },
      { pregunta: 'hola', historial: Array(21).fill({ rol: 'usuario', texto: 'x' }) },
    ];
    for (const cuerpo of malos) {
      assert.equal((await pedir('/api/ia/preguntar', 'POST', cuerpo, profe)).status, 422, JSON.stringify(cuerpo).slice(0, 60));
    }
    assert.equal(recibidas.length, 0);
  });

  test(`solo se envían los últimos ${REGLAS.MAX_MENSAJES_HISTORIAL} mensajes del historial`, async () => {
    const historial = Array.from({ length: 10 }, (_, i) => ({ rol: i % 2 ? 'pulse' : 'usuario', texto: `m${i}` }));
    await pedir('/api/ia/preguntar', 'POST', { pregunta: '¿y?', historial }, profe);
    assert.deepEqual(recibidas[0].cuerpo.historial.map((m) => m.texto), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });

  test('una pregunta respondida se guarda en caché; la repetida no vuelve a pulse-ai', async () => {
    const usuario = await sesionNueva();
    const primera = await pedir('/api/ia/preguntar', 'POST', { pregunta: '¿Cuántas horas puedo reservar?' }, usuario);
    const segunda = await pedir('/api/ia/preguntar', 'POST', { pregunta: '  ¿CUÁNTAS horas   puedo reservar? ' }, usuario);
    assert.equal(primera.cache, null);
    assert.equal(segunda.cache, 'HIT');
    assert.equal(recibidas.length, 1);
  });

  test('no se cachea un "no sé" ni una pregunta con historial', async () => {
    const usuario = await sesionNueva();
    comportamiento = () => ({ cuerpo: { ...RESPUESTA_OK, respondido: false, respuesta: 'No sé' } });
    await pedir('/api/ia/preguntar', 'POST', { pregunta: 'pregunta sin respuesta' }, usuario);
    await pedir('/api/ia/preguntar', 'POST', { pregunta: 'pregunta sin respuesta' }, usuario);
    comportamiento = () => ({ cuerpo: RESPUESTA_OK });
    const conHistorial = { pregunta: 'con memoria', historial: [{ rol: 'usuario', texto: 'hola' }] };
    await pedir('/api/ia/preguntar', 'POST', conHistorial, usuario);
    await pedir('/api/ia/preguntar', 'POST', conHistorial, usuario);
    assert.equal(recibidas.length, 4);
  });

  test('cada pregunta gasta un cupo de IA: la sexta seguida es 429', async () => {
    const usuario = await sesionNueva();
    for (let i = 0; i < REGLAS.LIMITE_IA_PETICIONES; i++) {
      assert.equal((await pedir('/api/ia/preguntar', 'POST', { pregunta: `pregunta ${i}` }, usuario)).status, 200);
    }
    const bloqueada = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'una más' }, usuario);
    assert.equal(bloqueada.status, 429);
    assert.equal(bloqueada.cuerpo.error.codigo, 'LIMITE_IA');
    assert.equal(recibidas.length, REGLAS.LIMITE_IA_PETICIONES);
  });
});

describe('POST /api/ia/preguntar: cuando pulse-ai falla (la app sigue viva y responde 503)', () => {
  test('pulse-ai apagado (conexión rechazada) -> 503 IA_NO_DISPONIBLE', async () => {
    const guardada = process.env.PULSE_AI_URL;
    process.env.PULSE_AI_URL = 'http://localhost:1'; // nadie escucha en el puerto 1
    try {
      const { status, cuerpo } = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'hola' }, await sesionNueva());
      assert.equal(status, 503);
      assert.equal(cuerpo.error.codigo, 'IA_NO_DISPONIBLE');
      assert.match(cuerpo.error.mensaje, /conocimiento no está disponible/);
    } finally {
      process.env.PULSE_AI_URL = guardada;
    }
  });

  test('pulse-ai tarda más que el timeout -> 503', async () => {
    const anterior = REGLAS.TIMEOUT_CONOCIMIENTO_SEGUNDOS;
    REGLAS.TIMEOUT_CONOCIMIENTO_SEGUNDOS = 0.2;
    comportamiento = () => ({ cuerpo: RESPUESTA_OK, demora: 800 });
    try {
      const { status, cuerpo } = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'lenta' }, await sesionNueva());
      assert.equal(status, 503);
      assert.equal(cuerpo.error.codigo, 'IA_NO_DISPONIBLE');
    } finally {
      REGLAS.TIMEOUT_CONOCIMIENTO_SEGUNDOS = anterior;
    }
  });

  test('pulse-ai responde 503 (Gemini caído) -> se muestra su mensaje', async () => {
    comportamiento = () => ({ status: 503, cuerpo: { error: { codigo: 'IA_NO_DISPONIBLE', mensaje: 'La IA no respondió correctamente.' } } });
    const { status, cuerpo } = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'sin gemini' }, await sesionNueva());
    assert.equal(status, 503);
    assert.equal(cuerpo.error.mensaje, 'La IA no respondió correctamente.');
  });

  test('token rechazado (401) -> 503 con un mensaje que no filtra detalles', async () => {
    comportamiento = () => ({ status: 401, cuerpo: { error: { codigo: 'NO_AUTORIZADO', mensaje: 'Falta el token del servicio.' } } });
    const { status, cuerpo } = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'token' }, await sesionNueva());
    assert.equal(status, 503);
    assert.match(cuerpo.error.mensaje, /no está bien configurado/);
  });

  test('una respuesta con forma inesperada -> 503, no se reenvía basura al navegador', async () => {
    comportamiento = () => ({ cuerpo: { cualquier: 'cosa' } });
    const { status } = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'rara' }, await sesionNueva());
    assert.equal(status, 503);
    comportamiento = () => ({ cuerpo: 'esto no es json' });
    assert.equal((await pedir('/api/ia/preguntar', 'POST', { pregunta: 'rara 2' }, await sesionNueva())).status, 503);
  });

  test('el resto de la app sigue funcionando mientras pulse-ai está caído', async () => {
    const guardada = process.env.PULSE_AI_URL;
    process.env.PULSE_AI_URL = 'http://localhost:1';
    try {
      assert.equal((await pedir('/api/espacios', 'GET', null, profe)).status, 200);
    } finally {
      process.env.PULSE_AI_URL = guardada;
    }
  });
});

// ---------- Ctrl+K: reservar o preguntar ----------

describe('POST /api/ia/asistente (intención)', () => {
  let llamadasIA; // prompts que recibió el Gemini falso

  // Gemini falso: reconoce la tarea por el rol del prompt y contesta lo que se le indique.
  function geminiFalso({ intencion }) {
    llamadasIA = [];
    usarGeneradorDeJSON(async (prompt) => {
      llamadasIA.push(prompt);
      if (prompt.includes('Clasificas lo que quiere una persona')) return { datos: { intencion }, modelo: 'falso' };
      if (prompt.includes('Extraes de una petición')) {
        return { datos: { asistentes: 10, inicio: '2099-01-05T14:00', fin: '2099-01-05T16:00', necesitaComputadores: false }, modelo: 'falso' };
      }
      if (prompt.includes('Redactas la explicación')) {
        const ids = [...prompt.matchAll(/^- ([a-z-]+): /gm)].map((m) => m[1]);
        return { datos: { opciones: ids.map((espacioId) => ({ espacioId, motivo: 'sirve' })), explicacion: 'Te recomiendo la primera.' }, modelo: 'falso' };
      }
      throw new Error('prompt inesperado');
    });
  }
  after(() => usarGeneradorDeJSON(null));

  test('intención "preguntar": responde con el RAG y no toca el flujo de reservas', async () => {
    geminiFalso({ intencion: 'preguntar' });
    const { status, cuerpo } = await pedir('/api/ia/asistente', 'POST', { texto: '¿Cuántas horas puedo reservar?' }, (await sesionNueva()));
    assert.equal(status, 200);
    assert.equal(cuerpo.intencion, 'preguntar');
    assert.equal(cuerpo.respuesta, RESPUESTA_OK.respuesta);
    assert.equal(llamadasIA.length, 1, 'solo se clasificó');
    assert.equal(recibidas.length, 1);
  });

  test('intención "reservar": las reglas filtran las salas y no se llama a pulse-ai', async () => {
    geminiFalso({ intencion: 'reservar' });
    const { status, cuerpo } = await pedir('/api/ia/asistente', 'POST', { texto: 'Una sala para 10 personas el lunes de 2 a 4' }, (await sesionNueva()));
    assert.equal(status, 200);
    assert.equal(cuerpo.intencion, 'reservar');
    assert.ok(cuerpo.opciones.length > 0 && cuerpo.opciones.every((o) => o.espacioId));
    assert.equal(cuerpo.solicitud.asistentes, 10);
    assert.equal(recibidas.length, 0);
  });

  test('si la IA devuelve una intención inválida se asume "preguntar" (nunca reserva por error)', async () => {
    geminiFalso({ intencion: 'borrar todo' });
    const { cuerpo } = await pedir('/api/ia/asistente', 'POST', { texto: 'cualquier cosa' }, (await sesionNueva()));
    assert.equal(cuerpo.intencion, 'preguntar');
  });

  test('las dos llamadas internas de una reserva gastan UN solo cupo', async () => {
    geminiFalso({ intencion: 'reservar' });
    const usuario = await sesionNueva();
    for (let i = 0; i < REGLAS.LIMITE_IA_PETICIONES; i++) {
      assert.equal((await pedir('/api/ia/asistente', 'POST', { texto: `sala para 10 personas ${i}` }, usuario)).status, 200);
    }
    assert.equal((await pedir('/api/ia/asistente', 'POST', { texto: 'una más' }, usuario)).status, 429);
  });

  test('el historial llega al RAG y la clasificación solo ve los últimos mensajes', async () => {
    geminiFalso({ intencion: 'preguntar' });
    const historial = Array.from({ length: 6 }, (_, i) => ({ rol: i % 2 ? 'pulse' : 'usuario', texto: `mensaje-${i}` }));
    await pedir('/api/ia/asistente', 'POST', { texto: '¿y los sábados?', historial }, (await sesionNueva()));
    assert.equal(recibidas[0].cuerpo.historial.length, 6);
    assert.ok(llamadasIA[0].includes('mensaje-5') && llamadasIA[0].includes('mensaje-4'));
    assert.ok(!llamadasIA[0].includes('mensaje-0'));
  });

  test('sin texto es 422', async () => {
    assert.equal((await pedir('/api/ia/asistente', 'POST', {}, (await sesionNueva()))).status, 422);
  });
});

describe('POST /api/ia/conocimiento/ingestar', () => {
  test('el admin recarga los documentos; el profesor recibe 403', async () => {
    comportamiento = () => ({ cuerpo: { documentos: 5, fragmentos: 31, retirados: 0 } });
    const exito = await pedir('/api/ia/conocimiento/ingestar', 'POST', null, admin);
    assert.equal(exito.status, 200);
    assert.deepEqual(exito.cuerpo, { documentos: 5, fragmentos: 31, retirados: 0 });
    assert.equal(recibidas[0].ruta, '/ingestar');

    const prohibido = await pedir('/api/ia/conocimiento/ingestar', 'POST', null, await sesionNueva());
    assert.equal(prohibido.status, 403);
    assert.equal(recibidas.length, 1);
  });

  test('al recargar los documentos se vacía la caché de respuestas', async () => {
    const usuario = await sesionNueva();
    await pedir('/api/ia/preguntar', 'POST', { pregunta: 'pregunta para cachear' }, usuario);
    comportamiento = () => ({ cuerpo: { documentos: 1, fragmentos: 1, retirados: 0 } });
    await pedir('/api/ia/conocimiento/ingestar', 'POST', null, admin);
    comportamiento = () => ({ cuerpo: RESPUESTA_OK });
    const otra = await pedir('/api/ia/preguntar', 'POST', { pregunta: 'pregunta para cachear' }, usuario);
    assert.equal(otra.cache, null);
  });
});
