# Matriz de modelos: ¿qué modelo de Gemini conviene para Campus Pulse?

Comparación de un modelo **rápido** y uno **de razonamiento** con las mismas tareas reales del proyecto y los mismos prompts.
Medido el 13 de noviembre de 2026 con `npm run comparar-modelos` (detalle por llamada en
`evaluacion/resultados/modelos-2026-11-13-gemini-3.5-flash-lite+gemini-2.5-flash.json`).

## Cómo se midió

- **Tarea 1, triaje:** los 12 reportes de `evaluacion/triaje-casos.js` con el prompt 1.3 y los 4 ejemplos few-shot. Acierto =
  los 6 campos iguales a lo esperado.
- **Tarea 2, extracción de la solicitud de reserva:** 6 pedidos ("30 personas el próximo martes de 2 a 4 pm"…) con un "ahora"
  fijo (viernes 13 de noviembre, 9:00 a. m.). Acierto = personas, inicio y fin exactos.
- Temperatura 0.2, salida JSON con *schema*, una pausa de 6 s entre llamadas y un reintento ante un error del servicio.
- **Costo:** precios oficiales del plan de pago, consultados el 13 de noviembre de 2026 en
  <https://ai.google.dev/gemini-api/docs/pricing> (pueden cambiar). Los tokens de razonamiento se cobran como salida.

## Resultado

| | `gemini-3.5-flash-lite` (rápido) | `gemini-2.5-flash` (razona) |
|---|---|---|
| **Triaje exacto** | **10 / 12** | 7 / 12 |
| **Solicitud exacta** | **6 / 6** | 4 / 6 (1 error de cuota) |
| Tiempo por llamada (triaje) | **1.5 s** | 3.3 s |
| Tiempo por llamada (solicitud) | **1.5 s** | 2.4 s |
| Tokens por triaje: entrada / salida / razonamiento | 1533 / 93 / 0 | 1533 / 66 / **326** |
| Precio por 1 M de tokens (entrada / salida) | US$ 0.30 / 2.50 | US$ 0.30 / 2.50 |
| **Costo por triaje** | **US$ 0.00069** | US$ 0.00144 (2.1 veces) |
| **Costo por solicitud** | **US$ 0.00027** | US$ 0.00112 (4.1 veces) |
| Capa gratuita | Sí | Sí |

### Dónde falló cada uno
- **`gemini-3.5-flash-lite`:** 2 casos discutibles del triaje (prioridad de un proyector; categoría de unos cables pelados).
- **`gemini-2.5-flash`:** 5 prioridades distintas al criterio del autor; una fecha mal resuelta (**"el lunes" lo tomó como el
  martes 17**, cuando el lunes era el 16); y una llamada rechazada por la cuota gratuita de ese modelo.

## Conclusión

**Para Campus Pulse conviene el modelo rápido**, y la medición lo respalda en las tres dimensiones a la vez: acertó más, fue el
doble de rápido y costó entre 2 y 4 veces menos. Razonar más no ayudó en tareas cortas y bien especificadas (clasificar con
valores cerrados, extraer datos con un *schema*): el modelo de razonamiento gastó 326 tokens "pensando" por triaje y aun así
se equivocó más. El razonamiento tiene sentido en tareas largas o abiertas, que este proyecto no tiene.

**Lo que no se pudo medir** y por qué:
- **`gemini-3.5-flash`, `3.6-flash` y `3.8-flash`** respondieron `503 high demand` durante toda la medición. Es un dato en sí
  mismo: un modelo recién lanzado y popular puede no estar disponible en la capa gratuita cuando se necesita.
- **`gemini-3.1-pro-preview`** no tiene capa gratuita, así que no se probó para no generar costos. Con su precio
  (US$ 2 / 12 por millón), un triaje costaría **al menos US$ 0.0043**, unas 6 veces más que el modelo rápido, sin contar los
  tokens de razonamiento.

**Cuidado al leerlo:** son 18 llamadas por modelo, una sola ronda y con criterios esperados escritos por el autor. Sirve para
elegir entre estos dos modelos para estas tareas, no para declarar cuál es "mejor" en general.

## Cuánto costaría para todo el campus (estimación)

Con el modelo rápido y el prompt de producción (triaje sin ejemplos: 1111 tokens de entrada, **US$ 0.00057** por llamada):

| Supuesto | Valor |
|---|---|
| Personas que usan la IA en un día | 200 |
| Acciones con IA por persona y día | 3 (reportar, pedir sala, preguntar) |
| Llamadas por acción | ≈ 1.7 (pedir sala son 2, una pregunta 1, el triaje 1; menos con la caché) |
| Llamadas al día | ≈ 1 000 |
| Costo por llamada | entre US$ 0.0006 (medido) y US$ 0.0012 (si las preguntas del RAG llevan el doble de texto, no medido) |
| **Costo al mes (22 días hábiles)** | **entre US$ 13 y US$ 26** |

Es un orden de magnitud, no un presupuesto: los embeddings (US$ 0.15 por millón de tokens) se suman pero son menores, y el
uso real solo se sabe con el piloto (`docs/hoja-de-ruta.md`). Lo que sí deja claro es que **el costo de la IA no es el
obstáculo**: pasar al plan de pago para tener más de 15 llamadas por minuto cuesta, para todo el campus, del orden de unos pocos almuerzos al mes.

## Cómo repetirla

```bash
npm run comparar-modelos -- --modelos=gemini-3.5-flash-lite,gemini-2.5-flash
```

Gasta 18 llamadas por modelo. Para probar otro modelo basta agregarlo a la lista (`ai.models.list()` muestra los que tiene
tu clave).
