// Genera el embedding de las incidencias que no lo tienen (por ejemplo, porque Gemini estaba caído
// cuando se crearon, o porque son anteriores a esta función).
// Uso:  npm run embeddings        (usa la clave de Gemini del .env)
import { cerrarPool, explicarErrorDeConexion } from '../data/pg.js';
import { rellenarEmbeddings } from './similares.js';

try {
  const { pendientes, rellenadas, error } = await rellenarEmbeddings({ pausaMs: 1000 });
  if (pendientes === 0) console.log('Todas las incidencias ya tienen embedding.');
  else console.log(`Incidencias sin embedding: ${pendientes}. Rellenadas: ${rellenadas}.`);
  if (error) {
    console.error(`Se detuvo: ${error}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(explicarErrorDeConexion(error));
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
