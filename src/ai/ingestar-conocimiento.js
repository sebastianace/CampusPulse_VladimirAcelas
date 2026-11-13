// npm run conocimiento: pide a pulse-ai que vuelva a cargar los documentos de knowledge/ en la base vectorial.
// Úsalo después de editar un .md. (También se puede con POST /api/ia/conocimiento/ingestar siendo admin.)

import { ingestarConocimiento } from './conocimiento.js';

try {
  const { documentos, fragmentos, retirados } = await ingestarConocimiento();
  console.log(`Listo: ${documentos} documentos, ${fragmentos} fragmentos guardados, ${retirados} fragmentos retirados.`);
} catch (error) {
  console.error(`No se pudo cargar el conocimiento: ${error.message}`);
  console.error('¿Está levantado pulse-ai?  docker compose up -d --build pulse-ai');
  process.exit(1);
}
