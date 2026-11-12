// =====================================================================
// TESTS DE INCIDENCIAS PARECIDAS (node:test)
// ---------------------------------------------------------------------
// Necesitan PostgreSQL levantado: docker compose up -d db
// Nunca llaman a Gemini: usan los vectores falsos de tests/embeddings-falsos.js. Con vectores de
// ángulo conocido se controla la similitud exacta: cos(10°) = 0.985, cos(20°) = 0.940, cos(40°) = 0.766.
// =====================================================================

import { test, describe, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseDeLaApp } from './ayuda-bd.js';
import { MODELO_FALSO, generadorDeHash, generadorPorTabla, generadorQueFalla, vectorConAngulo } from './embeddings-falsos.js';

const bd = await crearBaseDeLaApp();
const { app } = await import('../src/server.js');
const { actualizarDB, restaurarDB } = await import('../src/data/almacen.js');
const { crearIncidencia, resolverIncidencia } = await import('../src/domain/incidencias.js');
const { filtroDeLugar, incidenciasParecidas } = await import('../src/domain/similares.js');
const { agregarReporte, buscarCandidatas, contarReportes, guardarEmbedding, incidenciasSinEmbedding, listarReportes } = await import('../src/data/similares.js');
const { buscarSimilares, embeddingDe, esperarEmbeddingsPendientes, guardarEmbeddingEnSegundoPlano, rellenarEmbeddings, usarGeneradorDeEmbeddings } = await import('../src/ai/similares.js');
const { vaciarCache } = await import('../src/ai/cache.js');
const { REGLAS } = await import('../src/config/reglas.js');

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
beforeEach(() => vaciarCache());

const coseno = (grados) => Math.cos((grados * Math.PI) / 180);

// Crea una incidencia (por las reglas del dominio) y, si se indica un ángulo, le guarda su embedding.
async function incidencia({ descripcion, espacioId = null, recursoId = null, grados, modelo = MODELO_FALSO }) {
  const creada = await actualizarDB((db) => crearIncidencia(db, {
    descripcion, categoria: 'tecnologia', prioridad: 'media', area: 'Soporte TI', espacioId, recursoId, inhabilitar: false, origen: 'manual',
  }));
  if (grados !== undefined) await guardarEmbedding(creada.id, vectorConAngulo(grados), modelo);
  return creada;
}

// ---------------------------------------------------------------------
describe('Reglas de dominio (puras)', () => {
  test('el filtro de lugar: el equipo manda sobre el espacio, y sin ninguno no hay filtro', () => {
    assert.deepEqual(filtroDeLugar({ espacioId: 'apolo', recursoId: 'rec-01' }), { columna: 'recurso_id', valor: 'rec-01' });
    assert.deepEqual(filtroDeLugar({ espacioId: 'apolo', recursoId: null }), { columna: 'espacio_id', valor: 'apolo' });
    assert.equal(filtroDeLugar({ espacioId: null, recursoId: null }), null);
    assert.equal(filtroDeLugar(), null);
  });

  test('el umbral es inclusivo y el resultado va de la más parecida a la menos', () => {
    const resultado = incidenciasParecidas([
      { id: 'a', similitud: 0.93 }, { id: 'b', similitud: 0.99 }, { id: 'c', similitud: 0.929 }, { id: 'd', similitud: 0.95 },
    ]);
    assert.deepEqual(resultado.map((c) => c.id), ['b', 'd', 'a']);
  });

  test(`se muestran como máximo ${REGLAS.MAX_INCIDENCIAS_PARECIDAS}`, () => {
    const muchas = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, similitud: 0.99 - i * 0.001 }));
    assert.equal(incidenciasParecidas(muchas).length, REGLAS.MAX_INCIDENCIAS_PARECIDAS);
    assert.equal(incidenciasParecidas(muchas)[0].id, 'i0');
  });

  test('el umbral y el máximo se pueden cambiar, y sin candidatas no hay nada', () => {
    assert.deepEqual(incidenciasParecidas([{ id: 'a', similitud: 0.5 }], { umbral: 0.4, max: 1 }).map((c) => c.id), ['a']);
    assert.deepEqual(incidenciasParecidas([]), []);
  });
});

// ---------------------------------------------------------------------
describe('Búsqueda por significado en PostgreSQL (pgvector)', () => {
  beforeEach(() => restaurarDB());

  async function escenario() {
    return {
      cercana: await incidencia({ descripcion: 'cercana', espacioId: 'apolo', recursoId: 'rec-01', grados: 5 }),
      mismaSala: await incidencia({ descripcion: 'misma sala', espacioId: 'apolo', grados: 10 }),
      otraSala: await incidencia({ descripcion: 'otra sala', espacioId: 'cosmos', recursoId: 'rec-02', grados: 20 }),
      lejana: await incidencia({ descripcion: 'lejana', espacioId: 'apolo', grados: 40 }),
    };
  }
  const buscar = (lugar = {}, modelo = MODELO_FALSO) => buscarCandidatas(vectorConAngulo(0), modelo, lugar);

  test('ordena de la más cercana a la más lejana y calcula la similitud coseno (1 - distancia)', async () => {
    const e = await escenario();
    const candidatas = await buscar();
    assert.deepEqual(candidatas.map((c) => c.id), [e.cercana.id, e.mismaSala.id, e.otraSala.id, e.lejana.id]);
    for (const [c, grados] of candidatas.map((c, i) => [c, [5, 10, 20, 40][i]])) {
      assert.ok(Math.abs(c.similitud - coseno(grados)) < 1e-6, `${c.descripcion}: ${c.similitud}`);
    }
  });

  test('trae lo que la interfaz necesita para preguntar "¿es la misma?"', async () => {
    await escenario();
    const [primera] = await buscar();
    assert.deepEqual(Object.keys(primera).sort(), ['area', 'categoria', 'descripcion', 'espacioId', 'fecha', 'id', 'prioridad', 'recursoId', 'reportesAdicionales', 'similitud']);
    assert.equal(primera.espacioId, 'apolo');
    assert.equal(primera.reportesAdicionales, 0);
  });

  test('con las reglas, solo pasan las que llegan al umbral (0.93): 5°, 10° y 20° sí; 40° no', async () => {
    await escenario();
    const parecidas = incidenciasParecidas(await buscar());
    assert.deepEqual(parecidas.map((c) => c.descripcion), ['cercana', 'misma sala', 'otra sala']);
  });

  test('filtro por equipo: solo las incidencias de ese equipo', async () => {
    const e = await escenario();
    assert.deepEqual((await buscar({ recursoId: 'rec-01', espacioId: 'apolo' })).map((c) => c.id), [e.cercana.id]);
  });

  test('filtro por espacio: solo las de esa sala, no las de otra aunque se parezcan más', async () => {
    const e = await escenario();
    assert.deepEqual((await buscar({ espacioId: 'apolo' })).map((c) => c.id), [e.cercana.id, e.mismaSala.id, e.lejana.id]);
    assert.deepEqual((await buscar({ espacioId: 'cosmos' })).map((c) => c.id), [e.otraSala.id]);
    assert.deepEqual(await buscar({ espacioId: 'azul' }), []);
  });

  test('el caso de Apolo contra Cosmos: sin filtro la de otra sala se sugeriría; con filtro, no', async () => {
    const e = await escenario();
    // Mismo problema en otra sala: 20° = 0.940, por encima del umbral.
    assert.ok(incidenciasParecidas(await buscar()).some((c) => c.id === e.otraSala.id), 'sin filtro, pasa el umbral');
    assert.ok(!incidenciasParecidas(await buscar({ espacioId: 'apolo' })).some((c) => c.id === e.otraSala.id), 'con el filtro de lugar, no');
  });

  test('una incidencia sin espacio no se compara cuando el triaje sí identificó uno', async () => {
    await restaurarDB();
    await incidencia({ descripcion: 'sin lugar', grados: 5 });
    assert.equal((await buscar({ espacioId: 'apolo' })).length, 0);
    assert.equal((await buscar()).length, 1, 'sin filtro sí');
  });

  test('una incidencia resuelta deja de sugerirse (ya no admite reportes)', async () => {
    const e = await escenario();
    await actualizarDB((db) => resolverIncidencia(db, e.cercana.id, { estado: 'resuelta' }));
    assert.ok(!(await buscar()).some((c) => c.id === e.cercana.id));
  });

  test('no mezcla embeddings de modelos distintos', async () => {
    await incidencia({ descripcion: 'de otro modelo', espacioId: 'apolo', grados: 0, modelo: 'otro-modelo' });
    assert.equal((await buscar()).length, 0);
    assert.equal((await buscar({}, 'otro-modelo')).length, 1);
  });

  test('guardar de nuevo el embedding de una incidencia lo reemplaza, no lo duplica', async () => {
    const i = await incidencia({ descripcion: 'x', grados: 90 });
    await guardarEmbedding(i.id, vectorConAngulo(0), MODELO_FALSO);
    const { rows } = await bd.pool.query('SELECT count(*)::int AS n FROM incidencias_embeddings WHERE incidencia_id = $1', [i.id]);
    assert.equal(rows[0].n, 1);
    assert.ok(Math.abs((await buscar())[0].similitud - 1) < 1e-6);
  });
});

// ---------------------------------------------------------------------
describe('Servicio de incidencias parecidas', () => {
  let restaurar;
  beforeEach(async () => { await restaurarDB(); });
  afterEach(() => restaurar?.()); // si un test falla a mitad, no deja el generador falso puesto

  test('el embedding de un texto se pide una sola vez (caché), aunque se pregunte varias veces', async () => {
    const generador = generadorPorTabla({ 'El video beam NO prende': vectorConAngulo(0) });
    restaurar = usarGeneradorDeEmbeddings(generador);
    await embeddingDe('El video beam NO prende');
    await embeddingDe('  el video beam   no prende ');
    assert.equal(generador.llamadas, 1);
  });

  test('varias peticiones iguales a la vez comparten una sola llamada al servicio', async () => {
    const generador = generadorPorTabla({ 'doble clic': vectorConAngulo(0) });
    restaurar = usarGeneradorDeEmbeddings(generador);
    const resultados = await Promise.all(Array.from({ length: 6 }, () => embeddingDe('doble clic')));
    assert.equal(generador.llamadas, 1);
    assert.ok(resultados.every((r) => r.modelo === MODELO_FALSO));
  });

  test('si esa llamada falla, todas fallan, pero el siguiente intento vuelve a pedir (no queda pegado)', async () => {
    restaurar = usarGeneradorDeEmbeddings(generadorQueFalla());
    const resultados = await Promise.allSettled([embeddingDe('se cae'), embeddingDe('se cae')]);
    assert.deepEqual(resultados.map((r) => r.status), ['rejected', 'rejected']);
    restaurar();
    restaurar = usarGeneradorDeEmbeddings(generadorPorTabla({ 'se cae': vectorConAngulo(0) }));
    assert.equal((await embeddingDe('se cae')).modelo, MODELO_FALSO);
  });

  test('buscarSimilares devuelve las que pasan el umbral, el umbral y el modelo', async () => {
    await incidencia({ descripcion: 'parecida', espacioId: 'apolo', grados: 10 });
    await incidencia({ descripcion: 'distinta', espacioId: 'apolo', grados: 60 });
    restaurar = usarGeneradorDeEmbeddings(generadorPorTabla({ 'texto nuevo': vectorConAngulo(0) }));
    const resultado = await buscarSimilares({ descripcion: 'texto nuevo', espacioId: 'apolo' });
    restaurar();
    assert.deepEqual(resultado.candidatas.map((c) => c.descripcion), ['parecida']);
    assert.equal(resultado.umbral, REGLAS.UMBRAL_SIMILITUD_INCIDENCIA);
    assert.equal(resultado.modelo, MODELO_FALSO);
  });

  test('si el servicio de embeddings falla, buscarSimilares lanza 503 IA_NO_DISPONIBLE', async () => {
    restaurar = usarGeneradorDeEmbeddings(generadorQueFalla());
    await assert.rejects(buscarSimilares({ descripcion: 'algo' }), { codigo: 'IA_NO_DISPONIBLE', status: 503 });
    restaurar();
  });

  test('guardar el embedding en segundo plano: queda guardado, o si falla no rompe nada', async () => {
    const creada = await incidencia({ descripcion: 'la que se guarda' });
    restaurar = usarGeneradorDeEmbeddings(generadorPorTabla({ 'la que se guarda': vectorConAngulo(0) }));
    guardarEmbeddingEnSegundoPlano(creada);
    await esperarEmbeddingsPendientes();
    restaurar();
    assert.deepEqual(await incidenciasSinEmbedding(), []);

    const otra = await incidencia({ descripcion: 'la que falla' });
    const silencio = mock.method(console, 'warn', () => {});
    restaurar = usarGeneradorDeEmbeddings(generadorQueFalla());
    assert.doesNotThrow(() => guardarEmbeddingEnSegundoPlano(otra));
    await esperarEmbeddingsPendientes();
    restaurar();
    silencio.mock.restore();
    assert.deepEqual((await incidenciasSinEmbedding()).map((f) => f.id), [otra.id], 'queda pendiente para el relleno');
  });

  test('rellenarEmbeddings completa las que faltan, por lotes, y una segunda vez no hace nada', async () => {
    for (const d of ['uno', 'dos', 'tres']) await incidencia({ descripcion: d });
    await incidencia({ descripcion: 'ya tiene', grados: 0 });
    const generador = generadorPorTabla({ uno: vectorConAngulo(0), dos: vectorConAngulo(5), tres: vectorConAngulo(10) });
    assert.deepEqual(await rellenarEmbeddings({ generar: generador, tamanoLote: 2 }), { pendientes: 3, rellenadas: 3, error: null });
    assert.equal(generador.llamadas, 2, 'tres textos en lotes de dos = dos llamadas');
    assert.deepEqual(await rellenarEmbeddings({ generar: generador }), { pendientes: 0, rellenadas: 0, error: null });
  });

  test('si el servicio falla, rellenarEmbeddings se detiene y lo dice (no insiste)', async () => {
    for (const d of ['uno', 'dos', 'tres']) await incidencia({ descripcion: d });
    const generador = generadorQueFalla('servicio caído');
    const resultado = await rellenarEmbeddings({ generar: generador, tamanoLote: 1 });
    assert.deepEqual(resultado, { pendientes: 3, rellenadas: 0, error: 'servicio caído' });
    assert.equal(generador.llamadas, 1);
    assert.equal((await incidenciasSinEmbedding()).length, 3);
  });
});

// ---------------------------------------------------------------------
describe('Reportes que se suman a una incidencia', () => {
  before(async () => {
    await bd.pool.query("INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES ('ana', 'Ana', 'profesor', 'x') ON CONFLICT DO NOTHING");
  });
  beforeEach(() => restaurarDB());

  test('sumar un reporte lo guarda con quién, cuándo y qué escribió, y cuenta el total', async () => {
    const i = await incidencia({ descripcion: 'original' });
    const primero = await agregarReporte(i.id, '  A mí también me pasa  ', 'ana');
    assert.equal(primero.totalReportes, 1);
    assert.equal(primero.reporte.descripcion, 'A mí también me pasa');
    assert.equal(primero.reporte.reportadoPor, 'ana');
    assert.match(primero.reporte.fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.equal((await agregarReporte(i.id, 'Y a mí', 'ana')).totalReportes, 2);
    assert.deepEqual((await listarReportes(i.id)).map((r) => r.descripcion), ['A mí también me pasa', 'Y a mí']);
    assert.equal((await contarReportes()).get(i.id), 2);
  });

  test('los reportes adicionales aparecen en la búsqueda de parecidas', async () => {
    const i = await incidencia({ descripcion: 'original', grados: 0 });
    await agregarReporte(i.id, 'otro reporte', 'ana');
    const [candidata] = await buscarCandidatas(vectorConAngulo(0), MODELO_FALSO);
    assert.equal(candidata.reportesAdicionales, 1);
  });

  test('no se puede sumar a una incidencia que ya está resuelta (409) ni a una que no existe (404)', async () => {
    const i = await incidencia({ descripcion: 'original' });
    await actualizarDB((db) => resolverIncidencia(db, i.id, { estado: 'resuelta' }));
    await assert.rejects(agregarReporte(i.id, 'tarde', 'ana'), { codigo: 'INCIDENCIA_YA_RESUELTA', status: 409 });
    await assert.rejects(agregarReporte('inc-no-existe', 'algo', 'ana'), { status: 404 });
    await assert.rejects(listarReportes('inc-no-existe'), { status: 404 });
  });

  test('el texto vacío o muy largo se rechaza (422)', async () => {
    const i = await incidencia({ descripcion: 'original' });
    for (const texto of ['', '   ', undefined, 42, 'x'.repeat(1001)]) {
      await assert.rejects(agregarReporte(i.id, texto, 'ana'), { status: 422 }, String(texto).slice(0, 10));
    }
  });

  test('restaurar los datos borra los embeddings y los reportes junto con las incidencias', async () => {
    const i = await incidencia({ descripcion: 'original', grados: 0 });
    await agregarReporte(i.id, 'otro', 'ana');
    await restaurarDB();
    for (const tabla of ['incidencias', 'incidencias_embeddings', 'incidencias_reportes']) {
      assert.equal((await bd.pool.query(`SELECT count(*)::int AS n FROM ${tabla}`)).rows[0].n, 0, tabla);
    }
  });
});

// ---------------------------------------------------------------------
describe('Por la API', () => {
  let cookie;
  let restaurar;
  before(async () => {
    await bd.pool.query('TRUNCATE usuarios CASCADE'); // para registrar la primera cuenta (admin) por la API
    const registro = await fetch(`${base}/api/auth/registro`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: 'jefa', nombre: 'Jefa', clave: 'clave-de-prueba-1' }),
    });
    cookie = registro.headers.get('set-cookie').split(';')[0];
  });
  beforeEach(() => restaurarDB());
  afterEach(() => restaurar?.());

  async function pedir(ruta, metodo = 'GET', cuerpo, cookieDe = cookie) {
    const respuesta = await fetch(base + ruta, {
      method: metodo, headers: { 'content-type': 'application/json', cookie: cookieDe }, body: cuerpo && JSON.stringify(cuerpo),
    });
    return { status: respuesta.status, cuerpo: await respuesta.json() };
  }
  const datosDeIncidencia = (descripcion, extra = {}) => ({
    descripcion, categoria: 'tecnologia', prioridad: 'media', area: 'Soporte TI', inhabilitar: false, origen: 'manual', ...extra,
  });

  test('crear una incidencia guarda su embedding sin hacer esperar la respuesta', async () => {
    restaurar = usarGeneradorDeEmbeddings(generadorPorTabla({ 'El video beam no prende': vectorConAngulo(0) }));
    const { status, cuerpo } = await pedir('/api/incidencias', 'POST', datosDeIncidencia('El video beam no prende', { espacioId: 'apolo' }));
    assert.equal(status, 201);
    await esperarEmbeddingsPendientes();
    restaurar();
    const { rows } = await bd.pool.query('SELECT modelo FROM incidencias_embeddings WHERE incidencia_id = $1', [cuerpo.id]);
    assert.deepEqual(rows, [{ modelo: MODELO_FALSO }]);
  });

  test('si el servicio de embeddings falla, la incidencia se crea igual (201) y queda para rellenar', async () => {
    const silencio = mock.method(console, 'warn', () => {});
    restaurar = usarGeneradorDeEmbeddings(generadorQueFalla());
    const { status, cuerpo } = await pedir('/api/incidencias', 'POST', datosDeIncidencia('Se rompió algo'));
    await esperarEmbeddingsPendientes();
    restaurar();
    silencio.mock.restore();
    assert.equal(status, 201);
    assert.deepEqual((await incidenciasSinEmbedding()).map((f) => f.id), [cuerpo.id]);
  });

  test('POST /api/ia/similares devuelve las parecidas con su similitud, filtradas por lugar', async () => {
    await incidencia({ descripcion: 'Apolo', espacioId: 'apolo', recursoId: 'rec-01', grados: 5 });
    await incidencia({ descripcion: 'Cosmos', espacioId: 'cosmos', recursoId: 'rec-02', grados: 8 });
    restaurar = usarGeneradorDeEmbeddings(generadorPorTabla({ 'mi reporte': vectorConAngulo(0) }));

    const conLugar = await pedir('/api/ia/similares', 'POST', { descripcion: 'mi reporte', espacioId: 'apolo' });
    assert.equal(conLugar.status, 200);
    assert.deepEqual(conLugar.cuerpo.candidatas.map((c) => c.descripcion), ['Apolo']);
    assert.ok(Math.abs(conLugar.cuerpo.candidatas[0].similitud - coseno(5)) < 1e-6);
    assert.equal(conLugar.cuerpo.umbral, REGLAS.UMBRAL_SIMILITUD_INCIDENCIA);

    const sinLugar = await pedir('/api/ia/similares', 'POST', { descripcion: 'mi reporte' });
    assert.deepEqual(sinLugar.cuerpo.candidatas.map((c) => c.descripcion), ['Apolo', 'Cosmos']);
    restaurar();
  });

  test('sin descripción responde 422; con el servicio caído responde 503 IA_NO_DISPONIBLE', async () => {
    assert.equal((await pedir('/api/ia/similares', 'POST', { descripcion: '   ' })).status, 422);
    restaurar = usarGeneradorDeEmbeddings(generadorQueFalla());
    const caida = await pedir('/api/ia/similares', 'POST', { descripcion: 'algo que falla' });
    restaurar();
    assert.equal(caida.status, 503);
    assert.equal(caida.cuerpo.error.codigo, 'IA_NO_DISPONIBLE');
  });

  test('repetir el mismo texto no gasta cupo de IA; textos distintos sí hasta llegar al límite (429)', async () => {
    // Un profesor aparte, para empezar con el cupo completo
    await pedir('/api/usuarios', 'POST', { usuario: 'profe.cupo', nombre: 'Profe', clave: 'clave-de-prueba-1', rol: 'profesor' });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'profe.cupo', clave: 'clave-de-prueba-1' }),
    });
    const cookieProfe = login.headers.get('set-cookie').split(';')[0];
    const buscar = (texto) => pedir('/api/ia/similares', 'POST', { descripcion: texto }, cookieProfe);

    const iguales = await Promise.all(Array.from({ length: 8 }, () => buscar('el mismo texto')));
    assert.ok(iguales.every((r) => r.status === 200), 'ocho veces el mismo texto, todas 200');

    const distintos = [];
    for (const n of [1, 2, 3, 4, 5]) distintos.push((await buscar(`texto distinto número ${n}`)).status);
    assert.deepEqual(distintos, [200, 200, 200, 200, 429], `el primer texto costó 1 de ${REGLAS.LIMITE_IA_PETICIONES}`);
  });

  test('sumar un reporte por la API: 201, aparece en la lista y en el conteo; resuelta -> 409', async () => {
    const creada = (await pedir('/api/incidencias', 'POST', datosDeIncidencia('Original'))).cuerpo;
    await esperarEmbeddingsPendientes();

    const uno = await pedir(`/api/incidencias/${creada.id}/reportes`, 'POST', { descripcion: 'A mí también' });
    assert.equal(uno.status, 201);
    assert.equal(uno.cuerpo.totalReportes, 1);
    assert.equal(uno.cuerpo.reporte.reportadoPor, 'jefa', 'queda a nombre de quien tiene la sesión');
    assert.equal((await pedir(`/api/incidencias/${creada.id}/reportes`, 'POST', { descripcion: 'Y a mí' })).cuerpo.totalReportes, 2);

    const lista = await pedir(`/api/incidencias/${creada.id}/reportes`);
    assert.deepEqual(lista.cuerpo.map((r) => r.descripcion), ['A mí también', 'Y a mí']);
    const conConteo = (await pedir('/api/incidencias')).cuerpo.find((i) => i.id === creada.id);
    assert.equal(conConteo.reportesAdicionales, 2);

    assert.equal((await pedir(`/api/incidencias/${creada.id}/reportes`, 'POST', { descripcion: '' })).status, 422);
    assert.equal((await pedir('/api/incidencias/inc-no-existe/reportes', 'POST', { descripcion: 'x' })).status, 404);

    assert.equal((await pedir(`/api/incidencias/${creada.id}`, 'PATCH', { estado: 'resuelta' })).status, 200);
    const tarde = await pedir(`/api/incidencias/${creada.id}/reportes`, 'POST', { descripcion: 'tarde' });
    assert.equal(tarde.status, 409);
    assert.equal(tarde.cuerpo.error.codigo, 'INCIDENCIA_YA_RESUELTA');
  });

  test('sin sesión no se puede sumar un reporte ni buscar parecidas (401)', async () => {
    assert.equal((await pedir('/api/incidencias/x/reportes', 'POST', { descripcion: 'a' }, '')).status, 401);
    assert.equal((await pedir('/api/ia/similares', 'POST', { descripcion: 'a' }, '')).status, 401);
  });
});
