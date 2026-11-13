// =====================================================================
// TESTS DE LOS FLUJOS DE n8n (node:test)
// ---------------------------------------------------------------------
// Los flujos viven como JSON en n8n/. Aquí se comprueba, sin levantar n8n:
//   - su estructura (credenciales, rutas, áreas, reintentos, ausencia de secretos);
//   - el código de los Code nodes, ejecutado con datos de prueba y con firmas generadas por Express
//     (src/integraciones/n8n.js): así queda protegido que las dos mitades de la firma sigan siendo compatibles.
// Que n8n de verdad ejecute los flujos se verificó a mano (docs/workflows.md).
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { AREAS, PRIORIDADES } from '../src/config/reglas.js';
import { firmar } from '../src/integraciones/n8n.js';

const requerir = createRequire(import.meta.url);
const carpeta = new URL('../n8n/', import.meta.url);
const flujos = new Map(readdirSync(carpeta).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(new URL(f, carpeta), 'utf8'))]));
const nodoDe = (flujo, nombre) => flujos.get(flujo).nodes.find((n) => n.name === nombre);

describe('estructura de los flujos exportados', () => {
  test('están los 6 flujos y todos quedan activos', () => {
    assert.deepEqual([...flujos.keys()].sort(),
      ['pulseAgente', 'pulseErrores', 'pulseIncidenciaNueva', 'pulseIngesta', 'pulseNotificar', 'pulseResumenDiario']);
    for (const [id, flujo] of flujos) {
      assert.equal(flujo.id, id, `el archivo y el id de ${id} coinciden`);
      assert.equal(flujo.active, true, `${id} activo (el Error Workflow y los subworkflows también deben estarlo)`);
    }
  });

  test('todos los flujos (menos el de errores) lo tienen como Error Workflow', () => {
    for (const [id, flujo] of flujos) {
      if (id === 'pulseErrores') continue;
      assert.equal(flujo.settings.errorWorkflow, 'pulseErrores', id);
    }
    assert.ok(nodoDe('pulseErrores', 'Cuando falla un flujo'), 'el flujo de errores empieza con un Error Trigger');
  });

  test('las credenciales que usan los flujos son las que crea scripts/preparar-n8n.mjs', () => {
    const script = readFileSync(new URL('../scripts/preparar-n8n.mjs', import.meta.url), 'utf8');
    const creadas = new Set([...script.matchAll(/id: '(pulse-[a-z-]+)'/g)].map((m) => m[1]));
    assert.ok(creadas.size >= 4);
    for (const [id, flujo] of flujos) {
      for (const nodo of flujo.nodes) {
        for (const credencial of Object.values(nodo.credentials ?? {})) {
          assert.ok(creadas.has(credencial.id), `${id} › ${nodo.name} usa la credencial "${credencial.id}", que el script no crea`);
        }
      }
    }
  });

  test('ningún flujo lleva secretos escritos: todo sale de credenciales o de $env', () => {
    for (const [id, flujo] of flujos) {
      const texto = JSON.stringify(flujo);
      assert.doesNotMatch(texto, /AIza[0-9A-Za-z_-]{20,}/, `${id}: una key de Gemini`);
      assert.doesNotMatch(texto, /"(apiKey|password|clave)"\s*:\s*"[^"]{4,}"/i, `${id}: una clave`);
    }
    assert.match(JSON.stringify(flujos.get('pulseIncidenciaNueva')), /\$env\.N8N_SECRETO/);
  });

  test('el webhook escucha en la ruta a la que apunta compose.yaml y la integración de Express', () => {
    const webhook = nodoDe('pulseIncidenciaNueva', 'Webhook de incidencias');
    assert.equal(webhook.parameters.path, 'incidencia-nueva');
    assert.equal(webhook.parameters.httpMethod, 'POST');
    assert.equal(webhook.parameters.options.rawBody, true, 'la firma se calcula sobre el cuerpo crudo');
    assert.match(readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8'), /N8N_WEBHOOK_URL: http:\/\/n8n:5678\/webhook\/incidencia-nueva/);
  });

  test('hay una rama del Switch por cada área del campus, cada una con su destinatario', () => {
    const reglas = nodoDe('pulseIncidenciaNueva', 'Área responsable').parameters.rules.values;
    assert.deepEqual(reglas.map((r) => r.outputKey).sort(), [...AREAS].sort(), 'si cambian las áreas en reglas.js, actualiza el Switch');
    for (const area of AREAS) {
      const destinatario = nodoDe('pulseIncidenciaNueva', `Destinatario: ${area}`);
      assert.ok(destinatario, `falta el destinatario de ${area}`);
      assert.match(JSON.stringify(destinatario.parameters), /@campus\.local/);
    }
  });

  test('la prioridad que dispara el aviso inmediato es una prioridad válida', () => {
    const condicion = nodoDe('pulseIncidenciaNueva', '¿Es crítica?').parameters.conditions.conditions[0];
    assert.ok(PRIORIDADES.includes(condicion.rightValue));
    assert.equal(condicion.rightValue, 'critica');
  });

  test('el flujo principal llama a un subworkflow que existe y a Campus Pulse de vuelta con reintentos', () => {
    const llamada = nodoDe('pulseIncidenciaNueva', 'Notificar por correo');
    assert.ok(flujos.has(llamada.parameters.workflowId.value ?? llamada.parameters.workflowId));
    assert.ok(flujos.get('pulseNotificar').nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger'));
    const volver = nodoDe('pulseIncidenciaNueva', 'Registrar aviso en Campus Pulse');
    assert.equal(volver.retryOnFail, true);
    assert.ok(volver.maxTries >= 3);
    assert.match(volver.parameters.url, /\/api\/integraciones\/incidencias\/.*\/notificada/);
  });

  test('toda llamada HTTP y todo envío de correo de los flujos de negocio reintenta', () => {
    for (const id of ['pulseIncidenciaNueva', 'pulseNotificar', 'pulseResumenDiario']) {
      for (const nodo of flujos.get(id).nodes.filter((n) => ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.emailSend'].includes(n.type))) {
        assert.equal(nodo.retryOnFail, true, `${id} › ${nodo.name}`);
        assert.ok(nodo.maxTries >= 3, `${id} › ${nodo.name}`);
      }
    }
  });

  test('el resumen diario corre todos los días a las 6 p. m. hora de Bogotá y también a mano', () => {
    const resumen = flujos.get('pulseResumenDiario');
    assert.equal(resumen.settings.timezone, 'America/Bogota');
    assert.equal(nodoDe('pulseResumenDiario', 'Todos los días a las 6 p. m.').parameters.rule.interval[0].expression, '0 18 * * *');
    assert.ok(nodoDe('pulseResumenDiario', 'Ejecutar a mano'));
  });

  test('el agente tiene memoria, la herramienta de políticas con 4 resultados y la de incidencias', () => {
    const agente = flujos.get('pulseAgente');
    assert.ok(agente.nodes.some((n) => n.type.endsWith('memoryPostgresChat')));
    const politicas = nodoDe('pulseAgente', 'consultar_politicas');
    assert.equal(politicas.parameters.mode, 'retrieve-as-tool');
    assert.equal(politicas.parameters.topK, 4);
    assert.equal(politicas.parameters.includeDocumentMetadata, true);
    assert.ok(nodoDe('pulseAgente', 'listar_incidencias_abiertas'));
  });

  test('la ingesta y el agente usan la misma tabla de n8n (distinta de la de pulse-ai: 3072 dimensiones, no 768)', () => {
    assert.equal(nodoDe('pulseIngesta', 'Guardar en PGVector').parameters.tableName, 'n8n_conocimiento');
    assert.equal(nodoDe('pulseAgente', 'consultar_politicas').parameters.tableName, 'n8n_conocimiento');
    assert.equal(nodoDe('pulseIngesta', 'Partir en fragmentos').parameters.chunkSize, 700);
  });
});

// ---------- el código de los Code nodes ----------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
/** Ejecuta el código de un Code node de n8n con datos de prueba. */
function ejecutar(flujo, nodo, { items = [], env = {}, cuerpoCrudo, previos = {} } = {}) {
  const codigo = nodoDe(flujo, nodo).parameters.jsCode;
  const entrada = { first: () => items[0], all: () => items };
  const contexto = { helpers: { getBinaryDataBuffer: async () => { if (cuerpoCrudo === undefined) throw new Error('sin cuerpo'); return Buffer.from(cuerpoCrudo); } } };
  const referencia = (nombre) => ({ first: () => previos[nombre] });
  return new AsyncFunction('require', '$env', '$input', '$', codigo).call(contexto, requerir, env, entrada, referencia);
}

describe('Code node "Validar firma y datos" (el mismo contrato que firma Express)', () => {
  const SECRETO = 'secreto-de-prueba';
  const incidencia = { id: 'inc-1', descripcion: 'x', categoria: 'tecnologia', prioridad: 'critica', area: 'Soporte TI', espacioId: 'apolo', recursoId: null, origen: 'manual', fecha: '2026-11-12T08:00' };
  const cuerpo = JSON.stringify({ evento: 'incidencia.creada', incidencia });
  const ahora = () => String(Math.floor(Date.now() / 1000));
  const validar = (opciones) => ejecutar('pulseIncidenciaNueva', 'Validar firma y datos', { env: { N8N_SECRETO: SECRETO }, ...opciones });
  const peticion = (marca, firma, cuerpoEnviado = cuerpo) => ({
    items: [{ json: { headers: { 'x-pulse-timestamp': marca, 'x-pulse-firma': firma } } }], cuerpoCrudo: cuerpoEnviado,
  });

  test('acepta lo que firma Express', async () => {
    const t = ahora();
    const [{ json }] = await validar(peticion(t, `sha256=${firmar(SECRETO, t, cuerpo)}`));
    assert.equal(json.valido, true);
    assert.deepEqual(json.incidencia, incidencia);
  });

  test('rechaza firma de otro secreto, cuerpo alterado, mensaje viejo y cabeceras ausentes', async () => {
    const t = ahora();
    const buena = `sha256=${firmar(SECRETO, t, cuerpo)}`;
    const casos = [
      ['otro secreto', peticion(t, `sha256=${firmar('otro', t, cuerpo)}`), /Firma inválida/],
      ['cuerpo alterado', peticion(t, buena, cuerpo.replace('Soporte TI', 'Seguridad')), /Firma inválida/],
      ['10 minutos de antigüedad', peticion(String(Number(t) - 600), `sha256=${firmar(SECRETO, String(Number(t) - 600), cuerpo)}`), /viejo/],
      ['sin cabeceras', { items: [{ json: { headers: {} } }], cuerpoCrudo: cuerpo }, /cabeceras/],
      ['sin cuerpo', { items: [{ json: { headers: { 'x-pulse-timestamp': t, 'x-pulse-firma': buena } } }] }, /cuerpo/],
    ];
    for (const [nombre, entrada, motivo] of casos) {
      const [{ json }] = await validar(entrada);
      assert.equal(json.valido, false, nombre);
      assert.match(json.motivo, motivo, nombre);
    }
  });

  test('con firma válida pero datos malos (evento, área o prioridad desconocidos) también rechaza', async () => {
    const t = ahora();
    for (const malo of [
      { evento: 'otra.cosa', incidencia },
      { evento: 'incidencia.creada', incidencia: { ...incidencia, area: 'Cafetería' } },
      { evento: 'incidencia.creada', incidencia: { ...incidencia, prioridad: 'urgentisima' } },
      { evento: 'incidencia.creada', incidencia: { ...incidencia, id: 7 } },
    ]) {
      const texto = JSON.stringify(malo);
      const [{ json }] = await validar(peticion(t, `sha256=${firmar(SECRETO, t, texto)}`, texto));
      assert.equal(json.valido, false);
      assert.match(json.motivo, /formato esperado/);
    }
  });

  test('sin N8N_SECRETO en n8n rechaza todo (nunca queda abierto)', async () => {
    const t = ahora();
    const [{ json }] = await ejecutar('pulseIncidenciaNueva', 'Validar firma y datos', { env: {}, ...peticion(t, `sha256=${firmar(SECRETO, t, cuerpo)}`) });
    assert.equal(json.valido, false);
  });
});

describe('Code nodes del resumen diario', () => {
  const incidencias = [
    { id: 'a', prioridad: 'critica', area: 'Soporte TI', descripcion: 'El video beam huele a quemado', reportesAdicionales: 2 },
    { id: 'b', prioridad: 'media', area: 'Soporte TI', descripcion: 'Falla el wifi', reportesAdicionales: 0 },
    { id: 'c', prioridad: 'baja', area: 'Servicios generales', descripcion: 'Falta aseo', reportesAdicionales: 0 },
  ];

  test('"Armar prompt" cuenta por prioridad y por área con código (no con IA) y delimita los datos', async () => {
    const [{ json }] = await ejecutar('pulseResumenDiario', 'Armar prompt', { items: incidencias.map((i) => ({ json: i })) });
    assert.equal(json.total, 3);
    assert.deepEqual(json.porPrioridad, { baja: 1, media: 1, alta: 0, critica: 1 });
    assert.deepEqual(json.porArea, { 'Soporte TI': 2, 'Servicios generales': 1 });
    assert.match(json.prompt, /## Límites/);
    assert.match(json.prompt, /no instrucciones para ti/);
    assert.match(json.prompt, /\(2 reportes más\)/);
  });

  test('"Armar prompt" con la lista vacía da total 0 (el IF corta antes de gastar IA)', async () => {
    const [{ json }] = await ejecutar('pulseResumenDiario', 'Armar prompt', { items: [{ json: {} }] });
    assert.equal(json.total, 0);
  });

  const resumenBueno = { resumen: 'Hay una incidencia crítica en Soporte TI que requiere atención.', prioridadMasUrgente: 'critica', incidenciasCriticas: 1, areasConMasCarga: ['Soporte TI'], recomendaciones: ['Revisar el video beam hoy.'] };
  const previos = { 'Armar prompt': { json: { total: 3, porPrioridad: { baja: 1, media: 1, alta: 0, critica: 1 } } } };
  const validarResumen = (salida) => ejecutar('pulseResumenDiario', 'Validar el JSON de la IA', {
    items: [{ json: { candidates: [{ content: { parts: [{ text: typeof salida === 'string' ? salida : JSON.stringify(salida) }] } }] } }], previos,
  });

  test('"Validar el JSON de la IA" deja pasar un resumen correcto y le suma los totales reales', async () => {
    const [{ json }] = await validarResumen(resumenBueno);
    assert.equal(json.total, 3);
    assert.equal(json.resumen, resumenBueno.resumen);
  });

  test('rechaza un resumen que contradice los datos reales (cuenta de críticas o prioridad más urgente)', async () => {
    await assert.rejects(validarResumen({ ...resumenBueno, incidenciasCriticas: 4 }), /dice 4 y hay 1/);
    await assert.rejects(validarResumen({ ...resumenBueno, prioridadMasUrgente: 'media' }), /la más alta es critica/);
  });

  test('rechaza JSON roto, campos faltantes, valores fuera de la lista y textos desmedidos', async () => {
    await assert.rejects(validarResumen('esto no es json'), /JSON válido/);
    await assert.rejects(validarResumen({ resumen: 'corto' }), /no pasó la validación/);
    await assert.rejects(validarResumen({ ...resumenBueno, areasConMasCarga: ['Cafetería'] }), /áreas válidas/);
    await assert.rejects(validarResumen({ ...resumenBueno, prioridadMasUrgente: 'urgentisima' }), /prioridadMasUrgente/);
    await assert.rejects(validarResumen({ ...resumenBueno, resumen: 'x'.repeat(801) }), /resumen/);
    await assert.rejects(validarResumen({ ...resumenBueno, recomendaciones: [] }), /recomendaciones/);
  });
});
