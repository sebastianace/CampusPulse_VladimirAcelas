# Registro de depuración

Fallos reales que aparecieron al construir la v2, cómo se encontró la causa y qué quedó para que no se repitan. Cada caso
sigue el mismo método: **síntoma → hipótesis → experimento → causa raíz → corrección → prueba que lo evita**.

> La depuración se hizo con ayuda de un asistente de programación (Claude Code): el asistente propuso hipótesis, corrió los
> experimentos y escribió las correcciones; el autor las integró por pull request. Ver "Uso de IA en el desarrollo" en el
> README.

## Resumen

| # | Fallo | Dónde | Causa raíz | Prueba que lo evita |
|---|---|---|---|---|
| 1 | Pulse respondía sobre "domingos" a una pregunta sobre el mundial | RAG | El prompt de reformulación pedía reescribir siempre | Test de la decisión `depende_del_historial` + 8 de 8 en prueba real |
| 2 | `pulse-ai` no arrancaba al reiniciar el contenedor | RAG | La librería falla si la tabla ya existe; los tests siempre usaban tablas nuevas | Test que reinicia el servicio sobre la misma tabla |
| 3 | Fragmentos "Introducción" aparecían en todas las búsquedas | RAG | El aviso "documento de ejemplo" se indexaba como contenido | Test de fragmentación |
| 4 | La IA fallaba a ratos con 503 y 429 | Gemini | Alta demanda del servicio y cuota gratuita de 15 llamadas por minuto | Reintento con espera, presupuesto global (`docs/capacidad-ia.md`) |
| 5 | Tests del RAG fallaban con 429 sin motivo aparente | Tests | Varios tests usaban el mismo usuario y le agotaban el cupo | Un usuario nuevo por test |
| 6 | El Error Workflow de n8n no avisaba nada | n8n | El flujo de errores estaba inactivo | Test que exige todos los flujos activos |
| 7 | La ingesta de n8n no guardaba nada | n8n | El nombre de la tabla iba como objeto y no como texto | Prueba real de la ingesta |
| 8 | n8n no dejaba activar los flujos | n8n | Validaciones de n8n: modo de importación, orden de los subworkflows y memoria del chat | Script `n8n:preparar` que publica en orden |
| 9 | Test de reservas simultáneas fallaba 3 veces de cada 60 | Base de datos | Interbloqueo real de PostgreSQL (`40P01`) en un caso sin bloqueo | Tests separados: deterministas y de carrera |
| 10 | DBeaver no conectaba a la base | Herramientas | La clave guardada en DBeaver no era la del `.env` | — (configuración) |
| 11 | `npm run n8n:preparar` no existía | Git | El `develop` local estaba detrás del remoto | — (`git pull` después de fusionar) |
| 13 | El few-shot empeoraba el triaje (7/12 frente a 9/12) | Prompts | Una política ambigua ("no se puede usar") que los ejemplos amplificaban | Medición antes y después (`npm run medir-triaje`) |
| 12 | Vulnerabilidad alta en `body-parser` | Dependencias | Versión 2.3.0 afectada (GHSA-27r3-jxmh-p828) | `npm audit` en la revisión final |

## Casos en detalle

### 1. La reformulación mezclaba temas (el más importante)
- **Síntoma.** En una prueba en Chrome, tras dos preguntas sobre reservas, *"¿Quién ganó el mundial de fútbol de 2014?"*
  recibió una respuesta sobre los domingos, con una fuente del reglamento. Es justo lo que el sistema no debe hacer.
- **Hipótesis.** (a) un error del navegador al enviar el historial; (b) el modelo no es determinista y a veces mezcla.
- **Experimento.** Se repitió la misma petición directo contra `pulse-ai`, sin navegador, 6 veces. En 2 de 4 respuestas
  válidas, la pregunta reformulada fue *"¿Cuál es el tiempo máximo de reserva de una sala los domingos?"*. Descartada (a).
- **Causa raíz.** El prompt de reformulación decía "reescribe la pregunta para que se entienda sola". Un modelo pequeño
  interpreta eso como "reescríbela siempre usando la conversación", aunque la pregunta ya fuera independiente.
- **Corrección.** El modelo primero **decide** en un campo `depende_del_historial`; si es `false`, el código usa la pregunta
  original sin tocarla. Además, ejemplos few-shot con el caso del mundial. Si la reformulación falla, se une la pregunta
  anterior con la nueva, sin IA.
- **Verificación.** El mismo escenario dio 8 de 8 correctos; los seguimientos legítimos ("¿y los domingos?") siguieron
  funcionando (5 de 5). Tests: `pulse-ai/tests/test_llm.py` y `test_prompts.py`.
- **Lección.** Un "no sé" falso es molesto; una respuesta segura y equivocada es peor. Hay que probar con conversaciones que
  **cambian de tema**, no solo con seguimientos.

### 2. `pulse-ai` no arrancaba al reiniciar
- **Síntoma.** Tras reiniciar el contenedor, `/salud` respondía `sin_base` y toda pregunta daba 503.
- **Experimento.** Los logs mostraban `relation "conocimiento" already exists`.
- **Causa raíz.** `init_vectorstore_table` de `langchain-postgres` falla si la tabla ya existe. Los tests de integración
  creaban una tabla nueva cada vez, así que nunca vieron un segundo arranque.
- **Corrección.** Se consulta `to_regclass` y solo se crea la tabla si falta (nunca `overwrite_existing`, que borraría los datos).
- **Prueba.** Primero se escribió un test que reproduce el reinicio y falló; después de la corrección pasó
  (`test_un_servicio_que_se_reinicia_reutiliza_la_tabla_y_los_datos`).
- **Lección.** Probar el **segundo** arranque, no solo el primero.

### 3. Fragmentos "Introducción" en todas las búsquedas
- **Síntoma.** Entre las fuentes de casi cualquier pregunta aparecía "Preguntas frecuentes › Introducción".
- **Causa raíz.** La línea `> Documento de ejemplo…` de cada documento quedaba antes del primer título y se indexaba como un
  fragmento propio, casi igual en los cinco documentos.
- **Corrección.** El aviso se quita del contenido y se conserva como metadata (`ejemplo: true`). Bajaron de 37 a 33 fragmentos.

### 4. Errores 503 y 429 de Gemini
- **Síntoma.** Algunas preguntas fallaban sin cambiar nada.
- **Experimento.** Los logs de `pulse-ai` mostraban `503 UNAVAILABLE: This model is currently experiencing high demand` y, en
  pruebas seguidas, `429 RESOURCE_EXHAUSTED` con `quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier, quotaValue: 15`.
- **Causa raíz.** No es un error del código: Gemini gratis tiene picos de demanda y un límite de 15 llamadas por minuto
  **para todo el proyecto**.
- **Corrección.** Reintento con espera (más larga ante un 429), y después menos llamadas por acción, caché, presupuesto
  global y modo ahorro (`docs/capacidad-ia.md`). Las mediciones se hacen con pausas entre peticiones.

### 5. Tests que fallaban con 429
- **Síntoma.** 11 tests del RAG fallaron con 429 al agregar el límite global.
- **Causa raíz.** Dos causas de **diseño de los tests**, no del código: el mismo usuario se usaba en muchos tests (le agotaban
  el cupo de 5 por minuto), y el presupuesto global es estado compartido entre tests.
- **Corrección.** Un usuario nuevo por test (`sesionNueva()`) y reiniciar el presupuesto antes de cada test.

### 6. El Error Workflow no atrapaba nada
- **Síntoma.** Un aviso de n8n que debía fallar (una incidencia inexistente) falló, pero no llegó el correo de error al admin.
- **Experimento.** El log de n8n: *"Calling Error Workflow for pulseIncidenciaNueva. Workflow pulseErrores is not active and
  cannot be executed"*.
- **Causa raíz.** El flujo de errores se importó inactivo; n8n solo ejecuta como Error Workflow un flujo activo.
- **Corrección.** Todos los flujos, incluido ese y el subworkflow, quedan activos. Un test lo exige (`tests/n8n-flujos.test.js`).
- **Lección.** Una red de seguridad hay que probarla haciendo fallar algo a propósito.

### 7 y 8. n8n: tabla como objeto y reglas de activación
- **Tabla.** La ingesta respondía 200 pero no creaba la tabla. Log: `Invalid table name "[object Object]"`. El nodo PGVector
  espera el nombre como texto, no como selector. Corregido en los dos flujos que lo usan.
- **Activación.** `n8n import:workflow --activeState=fromJson` solo funciona en modo cola; un subworkflow debe estar publicado
  antes que el flujo que lo llama; el chat con memoria exige que la memoria también esté conectada al disparador del chat.
  `scripts/preparar-n8n.mjs` importa, publica los subworkflows primero y luego el resto.

### 9. Interbloqueo intermitente en las reservas simultáneas (Fase 2)
- **Síntoma.** Un test de concurrencia fallaba unas 3 veces de cada 60 ejecuciones.
- **Causa raíz.** En el caso que prueba qué pasa **sin** el bloqueo de la aplicación, PostgreSQL detectaba de verdad un
  interbloqueo (`40P01`) entre dos transacciones y abortaba una. No era un bug de la app, pero el test asumía un solo error.
- **Corrección.** Se separó en un test determinista (foto desactualizada, peticiones escalonadas) y uno de carrera pura que
  acepta cualquiera de los dos rechazos. Documentado en `docs/base-de-datos.md`.

### 10. DBeaver no conectaba
- **Síntoma.** "password authentication failed for user campus".
- **Experimento.** Se compararon las **longitudes** (no los valores) de la clave guardada en DBeaver y la del `.env`: 10 frente a 11.
- **Corrección.** Se volvió a guardar la conexión con la clave correcta. Las claves nunca se imprimieron.

### 11. `npm run n8n:preparar` no existía
- **Síntoma.** `Missing script: "n8n:preparar"` y `docker compose` sin los servicios nuevos.
- **Causa raíz.** Los cuatro PR ya estaban fusionados en GitHub, pero el `develop` local seguía en un commit anterior.
- **Corrección.** `git pull origin develop`. **Lección de Gitflow:** después de fusionar en GitHub, actualizar la rama local.

### 12. Vulnerabilidad en `body-parser`
- **Síntoma.** `npm audit` en la revisión final: severidad alta, denegación de servicio con cuerpos comprimidos malformados.
- **Corrección.** `npm audit fix` actualizó `body-parser` de 2.3.0 a 2.4.0 sin cambiar Express. 0 vulnerabilidades después;
  las dependencias de Python (`pip-audit`) no tenían ninguna conocida.

### 13. El few-shot empeoraba el triaje
- **Síntoma.** La medición pendiente desde la Fase 3A dio un resultado inesperado: con ejemplos, 7 de 12 casos exactos; sin
  ellos, 9.
- **Hipótesis.** (a) los ejemplos enseñan un criterio equivocado; (b) la instrucción es ambigua y los ejemplos lo empeoran.
- **Experimento.** Se miró campo por campo: el error estaba casi todo en "inhabilitar" (un televisor sin imagen, un portátil
  con la pantalla rota, sillas rotas). Los ejemplos tenían el criterio correcto (un portátil que se apaga: no se inhabilita).
  Descartada (a).
- **Causa raíz.** La política decía "inhabilitar si el espacio o equipo **no se puede usar** con seguridad": un equipo que no
  funciona "no se puede usar". El criterio del autor era otro: **riesgo para las personas**.
- **Corrección.** Prompt 1.3 con la política explícita. Segunda medición: 10 y 10, "inhabilitar" 12 de 12 en los dos modos.
  Como el few-shot ya no mejoraba y cuesta 420 tokens más por llamada, quedó desactivado por defecto.
- **Lección.** Medir antes de afirmar que una técnica funciona. Y una instrucción ambigua no la arreglan los ejemplos.

### 14. Reportar el video beam dejaba fuera de servicio todo el salón
- **Síntoma.** En las pruebas del 15 de noviembre reporté "el video beam de Apolo no sirve" y marqué "Dejar fuera de servicio
  el espacio o equipo afectado". Quería apagar solo el equipo, pero Apolo quedó inhabilitado y ya no se podía reservar.
- **Hipótesis.** (a) La prioridad crítica inhabilita todo; (b) la regla apaga todo lo que trae la incidencia.
- **Experimento.** En la base, la incidencia era manual y de prioridad media (descartada a): la casilla la marqué yo. En el
  código, `aplicarEstado` cambiaba el espacio **y** el recurso; y la IA siempre llena el espacio donde está el equipo.
- **Causa raíz.** La casilla decía "espacio **o** equipo" pero el código hacía "espacio **y** equipo". Venía de la v1.1.1 y
  ninguna regla de `reglas.js` lo pedía.
- **Corrección.** Se inhabilita lo más específico (el equipo si lo hay) y la sala solo si se elige "Toda la sala". La
  columna `inhabilito_espacio` recuerda qué se apagó para rehabilitar exactamente eso. Los tests nuevos de
  `tests/reglas.test.js` reproducen el fallo: con el código anterior fallan 3 y con la corrección pasan todos.
- **Lección.** Si el texto de la interfaz y el código dicen cosas distintas, uno de los dos está mal. Probar el sistema
  como lo usaría alguien del campus encuentra errores que los tests no buscaban.

### 15. Aprobar una solicitud de salón chocaba con la restricción EXCLUDE
- **Síntoma.** Al construir las solicitudes de salón, la prueba contra PostgreSQL de "aprobar" fallaba con
  `RESERVA_SOLAPADA`, aunque el dominio ya había cortado la reserva original (fin = ahora) antes de crear la nueva.
- **Hipótesis.** (a) El corte no se guardaba; (b) se guardaba, pero tarde.
- **Experimento.** En memoria las dos reservas no se cruzaban (los tests del dominio pasaban). En `almacen.js`,
  `guardarDiferencias` hacía todos los `INSERT` primero y los `UPDATE` después: la reserva nueva se insertaba mientras la
  original todavía duraba hasta las 11:00. Descartada (a).
- **Causa raíz.** El orden de escritura. La restricción `EXCLUDE` revisa cada fila en el momento del `INSERT`.
- **Corrección.** Tabla por tabla, primero los `UPDATE` y luego los `INSERT` (las claves foráneas siguen bien porque las
  tablas van de padres a hijos). Comprobado al revés: con el orden anterior, el test falla con `RESERVA_SOLAPADA`.
- **Lección.** Que el dominio esté bien no basta: el orden en que se escriben los cambios también es parte de la regla.

### 16. Pedir un salón reservado para mañana no dejaba mandar la solicitud
- **Síntoma.** Probándolo con un administrador del campus: un profesor reservó Cosmos para el día siguiente de 9 a 11;
  otro profesor intentó la misma reserva, le salió "Cosmos ya está reservado en esa franja" y no había forma de pedirle
  el salón a un admin.
- **Hipótesis.** (a) El botón "Solicitar este salón" fallaba; (b) la regla no contemplaba ese caso.
- **Experimento.** El botón solo se dibujaba para reservas **en curso** y el dominio respondía `RESERVA_NO_EN_CURSO` a
  cualquier otra. Descartada (a): era la regla, escrita solo para "el profesor de las 9:00 no llegó".
- **Causa raíz.** El caso de uso se definió más angosto que la necesidad real: en el campus se piden salones con
  anticipación, no solo cuando alguien no llega.
- **Corrección.** La solicitud sirve también para reservas futuras, con una franja (`inicio`, migración 011), y el aviso
  de "ya está reservado" trae el botón "Pedirle el salón a un admin". Al aprobar, la reserva original conserva lo que le
  sobre o se cancela entera. Cancelarla e insertar la nueva en la misma transacción volvía a chocar con `EXCLUDE` (caso
  15), porque los `DELETE` iban al final: ahora van primero. Comprobado al revés: con el orden anterior, el test de
  PostgreSQL falla.
- **Lección.** Probar con quien usa el sistema encuentra lo que los tests no buscan: los tests cubrían bien la regla
  equivocada.

### 17. n8n seguía con el flujo viejo aunque `npm run n8n:preparar` decía "importado"
- **Síntoma.** Al activar el flujo nuevo de avisos, n8n respondió `Workflow "pulseAvisoReserva" not found`, aunque el
  script había dicho "✔ 7 flujos importados".
- **Hipótesis.** (a) El JSON nuevo tenía un error; (b) n8n no estaba leyendo los archivos.
- **Experimento.** Importado a mano con `docker compose cp`, el mismo JSON entró bien: descartada (a). `ls /workflows`
  dentro del contenedor salió **vacío**, y el flujo de incidencias guardado en n8n todavía tenía el Switch por área que se
  había quitado días antes.
- **Causa raíz.** En macOS, Docker no tenía permiso sobre la carpeta del proyecto (en Descargas): el volumen
  `./n8n:/workflows` se montaba vacío, n8n importaba cero flujos sin error y el script contaba los archivos del disco,
  no los que importó n8n.
- **Corrección.** El script copia cada JSON con `docker compose cp` y compara cuántos importó n8n con cuántos hay. Se
  verificó exportando el flujo de incidencias desde n8n: ya no tiene el Switch.
- **Lección.** Un "✔" que cuenta lo que se quiso hacer, y no lo que pasó, esconde fallas. Verificar el resultado en el
  sistema de destino.

### 18. Aprobar una solicitud borraba una reserva de otra sala
- **Síntoma.** En una revisión completa del código, antes de la reunión con dirección: Ana reserva Cosmos de 9 a 11,
  Luis lo pide, Ana mueve su reserva a Apolo y el admin aprueba lo de Luis. La reserva de Ana en Apolo **desaparecía** y
  le llegaba un correo diciendo que se canceló.
- **Hipótesis.** (a) Editar la reserva no actualizaba la solicitud; (b) aprobar no revisaba en qué sala estaba la
  reserva original.
- **Experimento.** Un script con el dominio en memoria (sin base ni interfaz) lo reprodujo: antes de aprobar,
  `r1 apolo Ana`; después, solo `cosmos Luis`. La solicitud seguía bien apuntando a `r1` (descartada a): el problema
  era qué hacía la aprobación con ella.
- **Causa raíz.** `aplicarAprobacion` le quitaba la franja a la reserva original comparando solo las horas, no la sala.
- **Corrección.** Solo se le quita la franja si sigue en el salón pedido; el aviso al dueño, igual. Test nuevo que
  falla con el código anterior (comprobado quitando el arreglo).
- **Lección.** Una regla que guarda una referencia (la reserva pedida) debe volver a revisar que lo referido siga siendo
  lo que era: entre pedir y aprobar, el mundo cambia.

## Qué se aprendió en general
1. **Reproducir fuera de la interfaz** (curl, un script) separa los errores del navegador de los del servidor o del modelo.
2. **Leer el log antes de adivinar:** en los casos 2, 4, 6 y 7 la causa estaba escrita en el log.
3. **Comparar longitudes, no valores,** para depurar claves sin exponerlas.
4. **Un test que reproduce el fallo antes de corregirlo** evita que vuelva (casos 1, 2, 3 y 6).
5. **Con IA no determinista, una prueba no basta:** se repite el caso varias veces y se cuenta (2 de 4, 8 de 8).
