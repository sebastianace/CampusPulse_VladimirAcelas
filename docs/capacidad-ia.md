# Capacidad de la IA: cuántas personas puede atender y cómo se cuida la cuota

Campus Pulse usa la **capa gratuita de Gemini**, que permite unas **15 llamadas por minuto por modelo para todo el
proyecto** (no por persona; se vio al agotarla: `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`). Todos los profesores
comparten esas 15. Este documento explica qué se hizo para que alcancen y qué falla cuando no.

## El problema, medido

Tiempos y llamadas medidos con Gemini real (`gemini-3.5-flash-lite`), **antes** de las mejoras:

| Acción en Ctrl+K | Llamadas a Gemini | Tiempo |
|---|---|---|
| Pedir una sala | 3 (intención, entender el pedido, explicar) | ≈ 3.4 s |
| Pregunta nueva | 3 (intención, reordenar, responder) | ≈ 4.1 s |
| Pregunta con conversación previa | 4 | más de 4 s |
| La misma pregunta otra vez | 3 (no había caché en Ctrl+K) | ≈ 4 s |

Con 15 llamadas por minuto para todo el campus, eso eran **unas 5 reservas por minuto en total**. Con 30 profesores
pidiendo sala a la vez, la mayoría recibía un error después de esperar.

## Qué se cambió

| Mejora | Qué hace | Ahorro |
|---|---|---|
| **Intención por reglas** (`src/ai/intencion.js`) | Si el mensaje es claro ("30 personas el martes de 2 a 4", "¿cuántas horas…?") lo decide el código; solo los ambiguos ("hola") van a Gemini | 1 llamada y ≈ 0.9 s |
| **Reranking apagado por defecto** | La evaluación mostró que no mejora la exactitud (`docs/evaluacion-rag.md`) | 1 llamada y ≈ 1.4 s por pregunta |
| **Caché de preguntas en Ctrl+K** | Una pregunta ya respondida (60 min, o hasta recargar los documentos) no vuelve a Gemini | 100 % en repetidas |
| **Presupuesto global** (`src/ai/limite.js`) | Cuenta las llamadas de *todas* las personas en el último minuto (tope 12, bajo las 15). Si no alcanza, responde **429 `IA_OCUPADA` al instante** con "intenta en N segundos o usa el formulario" | Falla rápido en vez de esperar y fallar |
| **Modo ahorro** | Si quedan pocas llamadas, la recomendación de salas no gasta la llamada que redacta la explicación: las reglas escriben el motivo ("Caben 20 personas (34 puestos), con computadores") | 1 llamada |
| **Sin cobrar lo que no se atendió** | Si una petición recibe `IA_OCUPADA`, no le cuenta como consulta a la persona | — |

## El resultado

Medido con Gemini real, **después**:

| Acción en Ctrl+K | Llamadas | Tiempo |
|---|---|---|
| Pedir una sala | 2 (1 en modo ahorro) | **2.5 s** |
| Pregunta nueva | 1 | **1.5 s** |
| La misma pregunta otra vez | 0 | **0.0 s** |
| Mensaje ambiguo | 2 | 3.4 s |
| Seguimiento con memoria | 2 | 2.7 s |

**Capacidad por minuto, para todo el campus:**

| | Antes | Ahora |
|---|---|---|
| Reservas con IA | ≈ 5 | **8** (4 completas y 4 en modo ahorro) |
| Preguntas nuevas | ≈ 5 | **12** |
| Preguntas repetidas | contaban igual | **sin límite** (caché) |

La prueba `30 profesores piden sala a la vez` (`tests/conocimiento.test.js`, con Gemini simulado) lo comprueba: se atienden 8,
las otras 22 reciben `IA_OCUPADA` en menos de 3 segundos con `Retry-After`, y todas las atendidas traen salas.

## Lo que sigue siendo cierto (límites honestos)

- **8 reservas con IA por minuto es poco si todo el campus reserva a la misma hora** (por ejemplo, a las 7 a. m.). Esto
  mejora el uso, no elimina el límite de la capa gratis.
- **El formulario manual no usa IA y no tiene este límite.** Es la salida cuando la IA está ocupada; la interfaz lo ofrece
  en cada aviso. Las reglas (aforo, horario, cruces) se aplican igual.
- **El presupuesto es una estimación en memoria de un solo proceso.** Si se corrieran varias copias de la app, cada una
  tendría el suyo; reiniciar el servidor lo borra. Gemini es quien tiene la cuenta real. El tope de 12 deja margen, no garantía.
- **No se midieron los límites diarios** de la capa gratuita, que también existen.
- **Las reglas de intención se validaron con 24 frases** (escritas por el autor): decidieron 22 sin equivocarse en ninguna,
  y 2 ambiguas fueron a la IA. Son pocas frases; formas de hablar que no preví irán a la IA (más lento, no incorrecto),
  porque las reglas ante la duda no deciden.
- **Los tiempos dependen de Gemini:** en horas de alta demanda el servicio devuelve 503 ("high demand"); la app reintenta
  una vez y, si falla, avisa y ofrece el formulario.

## Si se necesitara más capacidad
1. **Pasar a un plan de pago de Gemini** (los límites por minuto suben mucho; hay que verificar las cifras vigentes del
   proveedor). Basta cambiar `LIMITE_IA_GLOBAL_LLAMADAS_MINUTO` en `src/config/reglas.js`.
2. **Un modelo con más llamadas por minuto** en la capa gratis, cambiando `GEMINI_MODEL`.
3. **Una cola** que haga esperar unos segundos en vez de rechazar (hoy se rechaza al instante, que es más simple y honesto).
4. **Un contador compartido** (por ejemplo, en PostgreSQL) si se escala a varias copias de la app.

## Dónde está cada cosa
| Archivo | Qué hace |
|---|---|
| `src/config/reglas.js` | `LIMITE_IA_GLOBAL_LLAMADAS_MINUTO`, `UMBRAL_MODO_AHORRO`, `CACHE_RAG_MINUTOS` |
| `src/ai/limite.js` | Cupo por persona y presupuesto global |
| `src/ai/intencion.js` | `intencionPorReglas` (sin IA) y `clasificarIntencion` (con IA) |
| `src/ai/asistente.js` | `recomendarEspacios(texto, {explicarConIA})`: el modo ahorro |
| `src/routes/ia.js` | Orden: validar → caché → cupo de la persona → presupuesto → IA |
