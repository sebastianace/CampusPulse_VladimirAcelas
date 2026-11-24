# Horarios de las clases (Software, Inglés y SER)

Reemplaza la hoja de Excel de Coordinación y la app EnglishFlow: los horarios fijos viven en la base, con las salas
reales del campus y sus reglas. Pedido del 21 nov 2026. Esto es la **Fase A**; el solucionador de grupos de inglés
(Fase B) queda para después.

## Qué hace hoy

1. **Carga los horarios desde un CSV** de Excel (`npm run importar-horarios`), con ensayo primero y un informe.
2. **Encuentra los problemas de planeación** en el archivo, que es lo que Mafe hoy descubre a mano.
3. **Bloquea las reservas** sobre una sala con clase (`409 SALA_CON_CLASE`) y la muestra ocupada en el tablero.
4. **Expone los bloques** en `GET /api/horarios`.

Aún no hay pantalla para editar ni ver la grilla: los horarios se cargan por terminal.

## Para quien prepara el archivo (Mafe)

Una fila por bloque, con estas columnas (los nombres pueden variar un poco, ver la plantilla
[`data/plantillas/horarios.csv`](../data/plantillas/horarios.csv)):

| Columna | Obligatoria | Qué lleva |
|---|---|---|
| `Tipo` | Sí | `Software`, `Inglés` o `SER` |
| `Sala` | Sí | La sala, como se diga: "Sala Azul", "Skylab", "Apolo". Tolera tildes, mayúsculas, la palabra "Sala" y singular o plural |
| `Hora inicio`, `Hora fin` | Sí | `HH:MM` (por ejemplo `07:00`, `18:15`) |
| `Días` | **No, pero hace falta** | `L-V`, `lunes a viernes`, `lun, mie, vie`, `L X V`, `todos`. La `M` sola se rechaza: no se sabe si es martes o miércoles; escribe `mar` o `mie` |
| `Grupo / Cohorte` | Sí | La cohorte de Software y SER (`J2 Abr-26`) o el grupo de inglés (`Grupo 4`) |
| `Estudiantes`, `Nivel / Programa`, `Docente`, `Módulo`, `Observación` | No | Lo que se tenga |

Las demás columnas se **ignoran** y el informe las nombra. En particular "Días restantes": es una foto del día en que se
tomó la captura y envejece (hoy dice 8 días, mañana debería decir 7): no se guarda, se calcula.

**Los días son lo más importante que falta.** Las capturas de EnglishFlow no traen los días de la semana, y sin ellos no se
puede saber cuándo una sala está ocupada (¿lunes a viernes?, ¿martes y jueves?). Regla: **un bloque sin días se guarda y se
revisa, pero NO bloquea reservas**. No se cierra una sala con un dato que no se sabe: si estuviera mal, la sala quedaría
inservible para todos. Cuando se confirmen, se actualiza el archivo y se vuelve a importar.

Guárdalo como **CSV UTF-8** (o cualquier CSV: el lector detecta `;` o `,` y la codificación) y entrégalo a quien hace la
carga, **sin subirlo a GitHub**: va en `data/privado/` (ignorada por git).

## Para quien hace la carga

```bash
# 1. Ensayo: lee el archivo, valida y analiza. No guarda nada.
npm run importar-horarios -- data/privado/horarios.csv

# 2. Si una sala tiene otro nombre en el archivo, dile cuál es (se puede repetir --alias)
npm run importar-horarios -- data/privado/horarios.csv --alias "Sala Nueva=blanca"

# 3. Cuando el informe esté bien, guarda
npm run importar-horarios -- data/privado/horarios.csv --alias "Sala Nueva=blanca" --aplicar
```

El informe tiene tres partes: **errores de formato** (impiden guardar, con la línea del archivo), **hallazgos de planeación**
(no impiden guardar) y un resumen de lo que se reemplaza.

### Qué encuentra el análisis

| Hallazgo | Ejemplo |
|---|---|
| Sala con dos clases a la vez | dos bloques que se cruzan en la misma sala |
| Docente en dos lugares a la vez | el mismo docente en dos salas a la misma hora |
| Cohorte con dos clases a la vez | Software y SER de la misma cohorte que se cruzan |
| Aforo excedido | 14 estudiantes en una sala de aforo 10 |
| Cohorte con fechas que no cuadran | Software dice `D1 Oct-25` y SER dice `D1 Oct-26` (se tolera `Sep`/`Sept`) |
| Cohorte en una clase y no en la otra | tiene Software pero no SER |
| Módulo que no cuadra con la sala | el módulo dice "Apolo 1" pero la sala es Artemis |
| Datos incompletos | Software sin docente o con 0 estudiantes |

Si a un bloque le faltan los días, un cruce se marca como **posible** ("puede que no: a alguno le faltan los días"): no se
afirma lo que no se sabe.

## Reglas (para sustentar)

| Regla | Por qué |
|---|---|
| **Ensayo por defecto; solo `--aplicar` escribe** | Es un reemplazo masivo y no tiene deshacer. |
| **Errores de formato impiden guardar (todo o nada); los hallazgos de planeación no** | Una sala mal escrita es un dato inservible. Pero un cruce o un aforo excedido son *información para Coordinación*: hay que poder cargarlos para verlos. |
| **Se reemplazan los tipos que trae el archivo** | Un archivo solo de Inglés no toca Software ni SER: cada clase se actualiza por separado. |
| **Solo bloquean los bloques con días confirmados** | No se bloquea con un dato que no se sabe. |
| **La sala no se adivina**, salvo singular/plural | "Skylab" y "Skylabs" son la misma sala; "Sala Nueva" no existe en el campus y hay que confirmarla con `--alias`. |
| **La `M` sola en los días se rechaza** | Error antes que adivinar mal: puede ser martes o miércoles. |
| **Excel en CSV, no `.xlsx`** | Un `.xlsx` es un zip de XML: leerlo sin librerías es frágil. El CSV ya se lee bien y guardar así es un paso en Excel. |
| **Reutiliza `actualizarDB`** | Hereda la transacción y el bloqueo de escritura. |

Reservar sobre una clase usa la regla 12 de `src/domain/reservas.js`; la recomendación de salas con IA tampoco la ofrece.
Una sala con clase en curso aparece como `ocupadoAhora: true`.

## Lo que mostró el archivo real de Coordinación

El análisis de las 38 filas del archivo de Mafe encontró **15 hallazgos**, entre ellos casi todo lo que ella tenía anotado a
mano y algo que no estaba en sus notas: **grupos de inglés con más estudiantes que el aforo de la sala** (14 en una sala de
aforo 10). Ningún horario se cruza: los problemas están en los datos, no en la planeación. El detalle (cohortes, salas,
líneas) está en el informe del ensayo y no se publica aquí.

- **"Sala Nueva" no existe en el CSV oficial de capacidad** (7 grupos de inglés están ahí). Hay que confirmar con Mafe cuál
  es. Por descarte parece ser la Sala Blanca (es la única sala oficial que no aparece en su grilla), pero **es una
  hipótesis, no un dato**.
- **Las capturas no traen los días**: sin ellos nada bloquea reservas todavía.

## Comprobado

- `npm test`: `tests/horarios.test.js` (41 pruebas: horas y días, búsqueda de salas, ocupación, bloqueo de reservas, cada
  hallazgo, todo o nada, reemplazo por tipo, recorrido contra PostgreSQL con un CSV en Windows-1252 y la API). Los datos son
  inventados.
- El comando se probó en ensayo con el archivo real contra una base desechable. También con días de ejemplo (`L-V`): no hay
  cruces de horario.
- **Todavía no comprobado:** guardar el archivo real (faltan los días y confirmar "Sala Nueva"), y que las reservas se
  bloqueen con los días reales.

## Pendiente (Fase B y otras)

- Confirmar con Mafe: los días de cada bloque, qué es "Sala Nueva", y qué año/mes es el correcto en las cohortes marcadas.
- Una pantalla para ver la grilla y editar sin terminal; leer `.xlsx` directo.
- Fase B: un solucionador que arme los grupos de inglés por nivel con las salas y docentes libres.
