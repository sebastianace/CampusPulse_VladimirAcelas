# Hoja de ruta: de proyecto a herramienta del campus

Campus Pulse v2.0.0 funciona de punta a punta, pero hoy es un **proyecto**: corre en un computador, usa la capa gratuita
de Gemini, sus documentos de reglamento son de ejemplo y nadie lo ha usado en un día real del campus. Este documento dice
qué haría falta para que la dirección de Campuslands lo use en serio, en qué orden y con qué riesgos.

## 1. Primero, un piloto medido (4 semanas)

Antes de construir más, **probar con gente real y medir**. Lo que no se mide no se puede defender frente a la dirección.

- **Alcance:** un piso o una torre, 5 a 10 profesores, el personal de soporte de ese piso y un coordinador.
- **Línea base:** una semana antes del piloto, anotar cómo se hace hoy (cuánto tarda conseguir sala, cuántos cruces hay,
  cuánto tarda en resolverse un daño). Sin línea base no hay forma de demostrar mejora.

| Métrica | Por qué le importa a la dirección | ¿Ya se puede medir? |
|---|---|---|
| Tiempo para conseguir una sala | Es el dolor diario de los profesores | Parcial (falta registrar el inicio del intento) |
| Reservas cruzadas o salas con sobrecupo | Debería ser cero: lo impiden las reglas y la base | Sí |
| Tiempo desde el reporte hasta la solución, por área | Mide si el soporte responde | Sí (`fecha` y `fecha_resolucion` de cada incidencia) |
| Reportes duplicados evitados | Menos ruido para soporte | Sí (`incidencias_reportes`) |
| Incidencias críticas avisadas al instante | Seguridad de las personas | Sí (`incidencias_notificaciones`) |
| Salas reservadas que nadie usó | Salas "fantasma" que otros necesitaban | No: hace falta el check-in (punto 3 de abajo) |
| Preguntas a Pulse sin respuesta | Dicen qué falta en el reglamento | No: hace falta registrar las preguntas (sin datos personales) |
| Uso de la IA frente al formulario manual | ¿La IA aporta o estorba? | No: hace falta un registro de eventos |

## 2. Lo que pediría antes de usarlo en todo el campus

Ordenado por impacto para el campus frente al esfuerzo. Esfuerzo: **S** días, **M** una a dos semanas, **L** más.

| # | Qué | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | **Inicio de sesión con las cuentas de Campuslands** (Google Workspace) | Nadie quiere otra contraseña, y las altas y bajas de personal se manejan solas | M |
| 2 | **Códigos QR en cada sala** que abren el reporte de incidencias con la sala ya elegida, o su agenda del día | Reportar en 10 segundos desde el celular es lo que hace que la gente reporte | S |
| 3 | **Check-in de reservas:** si nadie confirma en 15 minutos, la sala se libera | Recupera salas que se reservan "por si acaso" y no se usan | M |
| 4 | **Reglamento oficial** en la base de conocimiento, con un dueño (Coordinación) y una fecha de revisión | Hoy los documentos son de ejemplo; una respuesta de Pulse debe ser la política real | S (técnico) |
| 5 | **Avisos donde la gente ya lee** (Google Chat, Telegram o WhatsApp Business) además del correo | Un correo de "incidencia crítica" que nadie abre no sirve | M |
| 6 | **Panel de ocupación para la dirección:** uso de cada sala por día y hora | Decide con datos si falta un salón grande o si una sala está subutilizada | M |
| 7 | **Tiempos de respuesta por área** (por ejemplo, crítica en 1 hora) y escalamiento automático en n8n si no se cumple | Convierte los avisos en compromiso | M |
| 8 | **Rol de camper** (consultar, reportar y preguntar, sin reservar) | Los campers son quienes más ven los daños | S |
| 9 | **Sincronizar reservas con Google Calendar** | El profesor ve su reserva donde ya organiza su día | M |

## 3. Lo técnico para producción

- **Despliegue con HTTPS** en un servicio con PostgreSQL que soporte pgvector, con copias de seguridad automáticas.
- **Integración continua:** GitHub Actions que corra `npm test` y los tests de Python en cada pull request.
- **Plan de pago de Gemini** y un **contador de cuota compartido** (hoy vive en la memoria de un solo proceso).
- **Cola de reintentos** para el webhook hacia n8n: hoy, si n8n está caído, la alerta inmediata se pierde.
- **Monitoreo:** saber si la app, `pulse-ai` o n8n están caídos antes de que lo diga un profesor.
- **Proteger el chat del agente de n8n** (hoy es público en `localhost`).
- **Datos personales:** cumplir la Ley 1581 de 2012 (Habeas Data): política de tratamiento, autorización y no enviar datos
  personales a la IA. El webhook ya sale sin datos personales; falta revisar el texto libre de los reportes.

## 4. Costos estimados de la IA

Medido con el modelo que usa el proyecto (`gemini-3.5-flash-lite`) y precios oficiales del 13 de noviembre de 2026
(detalle en `docs/matriz-modelos.md`):

- **Una llamada cuesta unos US$ 0.0006** (un triaje: 1111 tokens de entrada y unos 93 de salida).
- **Escenario:** 200 personas, 3 acciones con IA al día, unas 1 000 llamadas diarias → **entre US$ 13 y US$ 26 al mes** para
  todo el campus (el rango alto supone preguntas al RAG con el doble de texto, que no se midió).
- **Conclusión para la dirección:** el costo de la IA no es el obstáculo. Lo que limita hoy es la **cuota por minuto** de la
  capa gratuita (15 llamadas para todos), que se resuelve con el plan de pago. El costo real se confirma con el piloto.
- Un modelo "de razonamiento" no compensa aquí: en la medición acertó menos, tardó el doble y costó de 2 a 4 veces más.

## 5. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| **La gente sigue reservando por WhatsApp** y el sistema no se usa | Piloto con profesores que lo impulsen, QR en las salas y que la reserva "oficial" sea solo la de Campus Pulse |
| **Depender de un proveedor de IA** (precio, cuota, cambios de modelo) | Todo funciona sin IA (formularios manuales); cambiar de proveedor solo toca `src/ai/cliente.js` y `pulse-ai/app/llm.py` |
| **Una sola persona sabe cómo funciona** | Documentación por pieza, más de 350 pruebas y un dueño técnico en el área de TI |
| **La IA responde algo desactualizado** del reglamento | Respuestas con fuentes, "no lo sé" cuando no está, un test que avisa si un documento contradice `reglas.js` y un dueño del reglamento |
| **Datos personales en reportes de texto libre** | Política de tratamiento, avisar en el formulario que no se escriban datos personales y revisar qué se envía a la IA |
