# Guía del reto en vivo

El jurado pedirá cambiar una regla de negocio en menos de 3 minutos. En Campus Pulse **todas
las reglas viven en un solo archivo**: [`src/config/reglas.js`](../src/config/reglas.js).
Cambiar una regla es editar un valor, no escribir lógica nueva.

## Antes de empezar (una sola vez)

1. Tener el servidor corriendo con recarga automática:

   ```bash
   npm run dev
   ```

2. Abrir `http://localhost:3000` en el navegador y `src/config/reglas.js` en el editor.

Con `npm run dev`, al guardar `reglas.js` el servidor se reinicia solo en 1 o 2 segundos.

## Los 3 pasos de cualquier cambio

1. **Editar** el valor en `src/config/reglas.js` y guardar (`Ctrl+S`).
2. **Mostrarlo en pantalla** con el caso de prueba de la tabla.
3. **Correr los tests** para demostrar que nada se rompió:

   ```bash
   npm test
   ```

   Los tests leen los valores de `reglas.js`, así que verifican la regla **nueva** sin reescribirlos.

## Pedidos probables del jurado

| Pedido del jurado | Qué cambiar en `reglas.js` | Cómo comprobarlo en pantalla |
|---|---|---|
| "Permitan 10 % más del aforo" | `MARGEN_AFORO: 1.1` | Reservar Skilab (aforo 20) para 22 personas: ahora se acepta. Con 23 se rechaza. |
| "Las incidencias altas también inhabilitan" | `PRIORIDADES_QUE_INHABILITAN: ['alta', 'critica']` | Reportar una incidencia de prioridad **Alta** sobre una sala: se pone roja. |
| "No se reserva los sábados" | `DIAS_HABILES: [1, 2, 3, 4, 5]` (quitar el `6`) | Reservar un sábado: "No se puede reservar los sábados". |
| "Máximo 2 horas por reserva" | `MAX_HORAS_RESERVA: 2` | Reservar de 9:00 a 12:00: "Una reserva puede durar como máximo 2 horas". |
| "Máximo 1 préstamo por persona" | `MAX_PRESTAMOS_POR_PERSONA: 1` | Prestar 2 equipos a la misma persona: el segundo se rechaza. |
| "Un equipo dañado puede volver directo a disponible" | En `TRANSICIONES_RECURSO`: `danado: ['en_reparacion', 'disponible']` | La regla cambia de inmediato; los tests lo confirman. |
| "El campus cierra a las 6 pm" | `HORA_CIERRE: 18` | Reservar de 17:00 a 19:00: "Las reservas deben estar entre las 7:00 y las 18:00". |
| "El campus abre a las 8 am" | `HORA_APERTURA: 8` | Reservar de 7:00 a 8:00: se rechaza por horario. |
| "Máximo 2 reservas por persona al día" | `MAX_RESERVAS_POR_PERSONA_DIA: 2` | La tercera reserva del mismo responsable en el mismo día se rechaza. |
| "Reservar con 1 hora de anticipación" | `ANTICIPACION_MINIMA_MINUTOS: 60` | Reservar para dentro de 30 minutos: "al menos 60 minutos de anticipación". |
| "Cosmos ahora también tiene computadores" | Sumar `'cosmos'` a `ESPACIOS_CON_COMPUTADORES` | Pedir con IA "taller de programación para 20 personas": Cosmos aparece entre las opciones. |
| "Un equipo con incidencia queda dañado, no en reparación" | `ESTADO_RECURSO_INHABILITADO: 'danado'` | Reportar una incidencia crítica sobre un equipo: queda "Dañado". |

## Si algo sale mal

- **Error de sintaxis al guardar** (falta una coma o un corchete): la terminal de `npm run dev`
  muestra la línea exacta. Corregir y guardar de nuevo.
- **La pantalla no cambia**: recargar el navegador (`F5`).
- **Datos de pruebas anteriores estorban**: pestaña **Datos → Restaurar datos iniciales**.
- **Volver al valor original**: deshacer con `Ctrl+Z` en el editor y guardar.

## Dónde se aplica cada regla (por si el jurado pregunta)

| Regla | Archivo | Función |
|---|---|---|
| Aforo, horario, días hábiles, duración, anticipación, solapamiento, límite diario | `src/domain/reservas.js` | `crearReserva`, `buscarEspaciosDisponibles` |
| Límite de préstamos y transiciones de estado | `src/domain/prestamos.js` | `crearPrestamo`, `devolverPrestamo` |
| Inhabilitar y rehabilitar por incidencias | `src/domain/incidencias.js` | `crearIncidencia`, `resolverIncidencia` |

Cada validación lee su valor desde `REGLAS`; ningún número de negocio está escrito a mano en el
código.
