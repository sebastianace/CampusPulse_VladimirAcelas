// =====================================================================
// npm run n8n:preparar: deja n8n listo con los flujos de Campus Pulse.
// ---------------------------------------------------------------------
// 1. Crea las credenciales en n8n (Gemini, PostgreSQL, correo de Mailpit) a partir del .env. Las claves viajan por
//    stdin al contenedor: no se escriben en el repositorio ni se imprimen.
// 2. Importa los flujos de la carpeta n8n/ (JSON exportado) y publica (activa) los que lo piden.
// 3. Reinicia n8n para que los webhooks y los disparadores queden registrados.
// Se puede correr las veces que haga falta: importar de nuevo reemplaza lo anterior.
// Requiere:  docker compose up -d db n8n mailpit   y   N8N_SECRETO definido en .env
// =====================================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { GEMINI_API_KEY, POSTGRES_PASSWORD, N8N_SECRETO } = process.env;

function compose(argumentos, { entrada } = {}) {
  const r = spawnSync('docker', ['compose', ...argumentos], { input: entrada, encoding: 'utf8' });
  return { ok: r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function fallar(mensaje) {
  console.error(`✖ ${mensaje}`);
  process.exit(1);
}

if (!N8N_SECRETO) fallar('Falta N8N_SECRETO en .env (es el secreto compartido entre Campus Pulse y n8n; elige un texto largo y aleatorio).');
if (!POSTGRES_PASSWORD) fallar('Falta POSTGRES_PASSWORD en .env.');
if (!compose(['ps', '--status', 'running', '--services']).salida.split('\n').includes('n8n')) {
  fallar('n8n no está levantado. Corre:  docker compose up -d db n8n mailpit');
}

// ---------- 1. credenciales ----------
const credenciales = [
  {
    id: 'pulse-postgres', name: 'Pulse PostgreSQL', type: 'postgres',
    data: { host: 'db', port: 5432, database: 'campus_pulse', user: 'campus', password: POSTGRES_PASSWORD, ssl: 'disable', allowUnauthorizedCerts: false, maxConnections: 10 },
  },
  {
    // Mailpit recibe los correos en local: no hay usuario, ni TLS, ni salida a Internet.
    id: 'pulse-smtp', name: 'Pulse SMTP (Mailpit)', type: 'smtp',
    data: { host: 'mailpit', port: 1025, secure: false, disableStartTls: true, user: '', password: '', hostName: '' },
  },
];
if (GEMINI_API_KEY) {
  credenciales.push(
    { id: 'pulse-gemini', name: 'Pulse Gemini', type: 'googlePalmApi', data: { host: 'https://generativelanguage.googleapis.com', apiKey: GEMINI_API_KEY } },
    { id: 'pulse-gemini-header', name: 'Pulse Gemini (cabecera x-goog-api-key)', type: 'httpHeaderAuth', data: { name: 'x-goog-api-key', value: GEMINI_API_KEY } },
  );
} else {
  console.warn('⚠ No hay GEMINI_API_KEY: no se crean las credenciales de Gemini (fallarán el resumen diario, la ingesta y el agente).');
}

const importarCredenciales = compose(
  ['exec', '-T', 'n8n', 'sh', '-c', 'cat > /tmp/credenciales.json && n8n import:credentials --input=/tmp/credenciales.json; estado=$?; rm -f /tmp/credenciales.json; exit $estado'],
  { entrada: JSON.stringify(credenciales) },
);
if (!importarCredenciales.ok) fallar(`No se pudieron importar las credenciales:\n${importarCredenciales.salida.replace(/\n{2,}/g, '\n').slice(-600)}`);
console.log(`✔ ${credenciales.length} credenciales creadas en n8n`);

// ---------- 2. flujos ----------
// Al importar, n8n deja todos los flujos desactivados; después se publican los que el JSON marca como activos.
const importarFlujos = compose(['exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/workflows']);
if (!importarFlujos.ok) fallar(`No se pudieron importar los flujos:\n${importarFlujos.salida.slice(-800)}`);
const carpeta = fileURLToPath(new URL('../n8n/', import.meta.url));
const flujos = readdirSync(carpeta).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(carpeta + f, 'utf8')));
console.log(`✔ ${flujos.length} flujos importados desde n8n/`);
// n8n no deja publicar un flujo si los subworkflows que llama no están publicados: primero los subworkflows.
const esSubworkflow = (f) => f.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
for (const flujo of flujos.filter((f) => f.active).sort((a, b) => esSubworkflow(b) - esSubworkflow(a))) {
  const publicado = compose(['exec', '-T', 'n8n', 'n8n', 'publish:workflow', `--id=${flujo.id}`]);
  if (!publicado.ok) fallar(`No se pudo activar "${flujo.name}":\n${publicado.salida.slice(-500)}`);
  console.log(`  ✔ activo: ${flujo.name}`);
}

// ---------- 3. reinicio ----------
if (!compose(['restart', 'n8n']).ok) fallar('No se pudo reiniciar n8n.');
console.log('✔ n8n reiniciado. Editor: http://localhost:5678 · Correos: http://localhost:8025');
