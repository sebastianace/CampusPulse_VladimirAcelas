// Script mínimo para comprobar que la key y el modelo de Gemini funcionan.
// Uso: npm run probar-ia   (lee GEMINI_API_KEY y GEMINI_MODEL desde .env)
import { GoogleGenAI } from '@google/genai';

const { GEMINI_API_KEY, GEMINI_MODEL } = process.env;

if (!GEMINI_API_KEY || !GEMINI_MODEL) {
  console.error('Faltan GEMINI_API_KEY o GEMINI_MODEL en el archivo .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

try {
  const respuesta = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: 'Responde solo con la palabra: funciona',
  });
  console.log(`Modelo ${GEMINI_MODEL} respondió: ${respuesta.text}`);
} catch (error) {
  console.error(`Gemini falló: ${error.message}`);
  process.exit(1);
}
