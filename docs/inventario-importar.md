# Cargar el inventario real desde Excel

Hoy los equipos de Campus Pulse son de **demostración** (12, `"ficticio": true`). Cuando Coordinación entregue el
inventario real, se carga con un comando, sin escribir equipos uno por uno. Pedido del 21 nov 2026.

## Para quien prepara el archivo (Mafe)

1. Abre la plantilla [`data/plantillas/inventario.csv`](../data/plantillas/inventario.csv) en Excel, o usa la hoja que ya
   tengas con estas columnas (los nombres pueden variar, ver la tabla). **Borra las 3 filas de ejemplo** (`EJ-001`…).
2. Una fila por equipo. **Cada equipo necesita un código único**: la placa de inventario, o un número que ustedes asignen
   (por ejemplo `PC-001`). Es lo que permite volver a cargar el archivo sin duplicar nada.
3. Guarda con **Archivo → Guardar como → CSV UTF-8 (delimitado por comas)**. Con otra opción de CSV también sirve: el
   lector detecta solo el separador (`;` o `,`) y la codificación.
4. Entrega el archivo **solo** a quien hace la carga: no lo subas a GitHub ni lo pegues en un chat.

| Columna | Obligatoria | Qué lleva | También se entiende como |
|---|---|---|---|
| `id` | **Sí** | Código único del equipo (2 a 40 letras, números, punto o guion) | código, placa, cod, número de inventario |
| `nombre` | **Sí** | Cómo se le dice al equipo ("Video beam Epson") | equipo, descripción, ítem, elemento, activo |
| `tipo` | No | Clase de equipo. Se guarda en minúscula y con guion bajo (`Video Beam` → `video_beam`). Vacío: `otro` | clase, categoría |
| `sala` | No | Sala donde está, por nombre o id (sin importar tildes, mayúsculas ni la palabra "Sala"). Vacío, `-`, `ninguna` o `portátil`: sin sala fija | espacio, salón, ubicación, lugar, aula |
| `estado` | No | `disponible`, `dañado` o `en reparación` (también: bueno, malo, en mantenimiento…). Vacío: disponible | condición |

Las demás columnas (serial, marca, observaciones…) **se ignoran** y el informe las nombra. Si alguna hace falta en el
sistema (por ejemplo, el serial para garantías), se agrega después con una migración.

## Para quien hace la carga

Siempre en dos pasos. Con la base levantada (`docker compose up -d db`) y el archivo en `data/privado/` (esa carpeta
**no se sube a git**):

```bash
# 1. Ensayo: lee el archivo y dice qué pasaría. No guarda nada.
npm run importar-inventario -- data/privado/inventario.csv

# 2. Si el informe está bien, guarda. Con --quitar-ficticios también se van los 12 equipos de demostración.
npm run importar-inventario -- data/privado/inventario.csv --aplicar --quitar-ficticios
```

El informe dice cuántos equipos son **nuevos**, cuáles **cambian** (y qué cambió), cuántos quedan **sin cambios**, y
los **errores con su línea del archivo**, por ejemplo:

```
Línea 30: la sala "Skylab" no existe. ¿Quisiste decir "Skylabs"?
```

## Reglas (para sustentar)

| Regla | Por qué |
|---|---|
| **Ensayo por defecto**; solo `--aplicar` escribe | Es un cambio masivo y no tiene deshacer: primero se ve. |
| **Todo o nada** | Si una fila falla, no entra ninguna. Un inventario cargado a medias es peor que uno sin cargar. Se informan todos los errores juntos para corregir el archivo de una vez. |
| **El `id` es la clave** (sin distinguir mayúsculas) | Volver a cargar el archivo actualiza en lugar de duplicar: se puede corregir el Excel y repetir. |
| **El estado de un equipo que ya existe no se pisa** | El estado lo manda Soporte TI y las incidencias abiertas (`src/domain/inventario.js`). Una hoja de Excel desactualizada no debe "arreglar" un equipo que está en reparación. Un equipo nuevo sí entra con el estado del archivo. |
| **Nunca se borra un equipo real por no estar en el archivo** | Solo se avisa cuántos faltan: puede ser un error del archivo, no una baja. |
| **Los de demostración solo se quitan con `--quitar-ficticios`, y no los que tengan incidencias** | Quitarlos dejaría huérfano ese historial. Se conservan y el informe los nombra. |
| **La sala mal escrita es un error, no se adivina** | Se sugiere la más parecida, pero un equipo en la sala equivocada es un error silencioso. |
| **Se usa `actualizarDB`**, como el resto de reglas | Hereda la transacción y el bloqueo de escritura: no se cruza con una reserva o incidencia que entre al mismo tiempo. |

El lector de CSV (`src/data/csv.js`) resuelve lo que hace difícil a Excel en español: el separador `;`, el archivo en
Windows-1252 (sin cuidado, "Micrófono" llega como "Micr?fono"), el BOM, las comillas dobles y los saltos de línea dentro
de una celda. Los alias de columnas y las reglas de cada fila están en `src/domain/inventario-importar.js`.

## Cuidado con estas tres cosas

1. **`npm run restaurar` borra el inventario real.** Vuelve a cargar los equipos de demostración (y borra reservas e
   incidencias). Después de cargar el inventario real, no se usa en el campus: es para pruebas y demos.
2. **La IA lee todo el inventario en cada reporte.** El catálogo de equipos entra en el prompt del triaje y en el `enum`
   del esquema. Medido con equipos parecidos a los reales: hoy (12 equipos) son ~950 tokens; con 100 equipos, ~2 900;
   con 300, ~7 100; con 600, ~13 500. Eso afecta la cuota gratuita de Gemini (ver [capacidad-ia.md](capacidad-ia.md)) y
   quizá la precisión. **Al cargar el inventario real hay que volver a medir** (`npm run medir-triaje` y el límite de IA).
   Si pesa mucho, la salida es mandar solo los equipos de la sala del reporte (ya se conoce con el QR de la sala).
3. **Los ejemplos del triaje (`ejemplos-triaje.js`) y los casos de `evaluacion/` usan los ids de demostración**
   (`rec-04`…). Siguen funcionando porque la evaluación parte de la semilla, no de la base real.

## Comprobado

- `npm test`: `tests/csv.test.js` (separadores, codificaciones, comillas, líneas) y `tests/importar-inventario.test.js`
  (reglas, todo o nada, idempotencia, equipos de demostración, recorrido completo contra PostgreSQL con un CSV en
  Windows-1252, y que la plantilla se importa sin errores).
- El comando se probó en ensayo contra la base de desarrollo con un CSV que imita un Excel real (31 filas, 25 computadores
  en una sala, columnas extra, filas vacías al final, tildes mal escritas y dos salas con error): informó las dos líneas
  con su sugerencia y no escribió nada.
- **Todavía no comprobado:** el archivo real de Mafe. Sus columnas, sus códigos y los nombres de sala pueden pedir ajustes
  (el informe del ensayo dirá cuáles).
