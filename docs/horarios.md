# Horarios de las clases (Software, Inglés y SER)

Reemplaza la hoja de Excel de Coordinación y la app EnglishFlow: los horarios fijos viven en la base, con las salas
reales del campus y sus reglas. Pedido del 21 nov 2026. Esto es la **Fase A**; el solucionador de grupos de inglés
(Fase B) queda para después.

## Qué hace hoy

1. **Carga los horarios desde el Excel** (`.xlsx`) o un CSV: desde el navegador (botón **Subir Excel**, solo admin) o por
   terminal (`npm run importar-horarios`). Siempre con ensayo primero y un informe.
2. **Encuentra los problemas de planeación** en el archivo, que es lo que Mafe hoy descubre a mano.
3. **Bloquea las reservas** sobre una sala con clase (`409 SALA_CON_CLASE`) y la muestra ocupada en el tablero.
4. **Expone los bloques** en `GET /api/horarios`.
5. **Los muestra en pantalla** (panel "Horario de clases"): cualquier sesión los ve.
6. **Se editan desde la pantalla**: agregar, cambiar y quitar una clase, y subir el Excel. **Solo el admin** (Mafe); el
   servidor responde `403` a los demás aunque llamen a la API directo.

## La pantalla "Horario de clases"

Está en el tablero, debajo de "Reservas del día". Cualquier sesión puede verla.

- **Grilla:** una fila por sala (de mayor a menor aforo) y una columna por hora, de 6:00 a 22:00. Cada clase es un bloque
  del color de su tipo (azul Software, rosa Inglés, oliva SER). Las pestañas **Lun a Sáb** cambian el día (abre en hoy; el
  domingo, en lunes) y el selector **Clase** filtra por tipo.
- **Detalle:** clic en un bloque para ver sala, horario, días, docente, estudiantes, nivel, módulo y observación. Los
  bloques de una hora se rotulan corto (`G4`, `J2`); el nombre completo está en el detalle y al pasar el mouse.
- **Solo los bloques con días confirmados** se dibujan: son los mismos que bloquean reservas (`SALA_CON_CLASE`). La nota del
  panel dice cuántos bloques están sin días.
- **En "Reservas del día"** las clases de ese día salen rayadas en la fila de su sala (sin clic): así se ve por qué una
  franja no se puede reservar. La vista empieza a las 7:00 y las clases a las 6:00, así que esas se ven recortadas.
- **Hallazgos (solo admin):** debajo de la grilla, "Para revisar con Coordinación (N)", agrupados por tipo. Salen de
  `GET /api/horarios/hallazgos`, que los calcula al pedirlos con lo que hay guardado.

### Agregar, cambiar y quitar una clase (solo admin)

- **+ Nueva clase** abre un formulario (clase, sala, horas, días, grupo, estudiantes, docente, nivel, módulo, observación).
  Abre con lunes a viernes marcado, que es como son las del campus. **Editar** y **Quitar** salen en el detalle de una clase.
- Las reglas son las del importador (clase, sala que exista, `HH:MM`, fin después del inicio): el CSV y la pantalla no pueden
  guardar cosas distintas. Si algo no sirve, el formulario lista **todos** los problemas juntos, sin cerrarse.
- **Un cruce o un aforo excedido no impiden guardar**: son hallazgos, y se ven en la lista de abajo. Solo detienen el
  guardado los errores de formato (la misma regla del importador).
- **Si la clase queda encima de una reserva futura**, se guarda y sale un aviso con quién la reservó y cuándo. **La reserva
  no se cancela sola**: quién cede la sala lo decide Coordinación. Una clase sin días marcados no bloquea ni avisa.
- Un campo opcional que se deja vacío al editar se quita; lo que no se toca se queda como estaba.

### Subir el Excel (solo admin)

**Subir Excel** abre un diálogo en dos pasos, sin escribir nada hasta el final:
1. Al elegir el archivo (`.xlsx` o `.csv`) se hace un **ensayo** y se muestra el informe: cuántas clases entran, los
   errores (con su fila), a qué se reemplaza y los hallazgos. Si algo falta, se corrige ahí mismo:
   - **Una sala con otro nombre** ("Sala Nueva"): aparece un selector para elegir cuál es. Se repite el ensayo con esa
     elección (es el `--alias` de la terminal).
   - **Filas sin días**: se marcan los días que valen para ellas (botón "Lunes a viernes"). Es lo que hace falta con el Excel
     real, que no trae esa columna.
2. **Guardar N clases** (y "reemplazar las M actuales") aplica el archivo. Es todo o nada: con un error de formato el botón
   no se habilita. Se reemplazan solo los tipos que trae el archivo (Software, Inglés, SER).

Si una clase nueva queda encima de reservas futuras, el informe lo avisa antes de guardar y otra vez al guardar.

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

Se puede entregar tal cual el **Excel (`.xlsx`)**: el lector toma la hoja que se llama "Horarios" (o la primera que tenga
las columnas obligatorias) y entiende las horas como las guarda Excel. También sirve un **CSV** (el lector detecta `;` o `,`
y la codificación). Si lo carga la propia Mafe, lo sube desde el navegador; si no, se entrega a quien hace la carga, **sin
subirlo a GitHub**: va en `data/privado/` (ignorada por git).

### Cómo se lee el .xlsx (para sustentar)

Un `.xlsx` es un ZIP con XML adentro. `src/data/xlsx.js` lo abre sin librerías (el proyecto solo depende de `express`, `pg` y
el SDK de Gemini): recorre el directorio del ZIP, descomprime con `node:zlib`, lee los textos compartidos y las celdas. Lo
delicado son las **horas**: Excel guarda 07:00 como el número `0,2916…` (la fracción del día), y solo el formato de la celda
dice que es una hora; por eso también se lee `styles.xml`. Nunca ejecuta macros ni fórmulas (usa el último valor guardado) y
tiene límites contra archivos maliciosos (30 MB descomprimidos por entrada, 20 000 filas, 5 MB de subida).

## Para quien hace la carga por terminal

```bash
# 1. Ensayo: lee el archivo (.xlsx o .csv), valida y analiza. No guarda nada.
npm run importar-horarios -- data/privado/horarios.xlsx

# 2. Si una sala tiene otro nombre en el archivo (--alias) o las filas no traen días (--dias)
npm run importar-horarios -- data/privado/horarios.xlsx --alias "Sala Nueva=blanca" --dias L-V

# 3. Cuando el informe esté bien, guarda
npm run importar-horarios -- data/privado/horarios.xlsx --alias "Sala Nueva=blanca" --dias L-V --aplicar
```

El informe tiene tres partes: **errores de formato** (impiden guardar, con la línea del archivo), **hallazgos de planeación**
(no impiden guardar) y un resumen de lo que se reemplaza.

### Qué encuentra el análisis

| Hallazgo | Ejemplo |
|---|---|
| Sala con dos clases a la vez | dos bloques que se cruzan en la misma sala |
| Docente en dos lugares a la vez | el mismo docente en dos salas a la misma hora |
| Cohorte con dos clases a la vez | Software y SER de la misma cohorte que se cruzan (la cohorte es el código, `D1`) |
| Aforo excedido | 14 estudiantes en una sala de aforo 10 |
| Cohorte en una clase y no en la otra | tiene Software pero no SER |
| Módulo que no cuadra con la sala | el módulo dice "Apolo 1" pero la sala es Artemis |
| Datos incompletos | Software sin docente o con 0 estudiantes |

El mes y el año del grupo (`Oct-25`) son la fecha de ingreso de la cohorte (confirmado por Coordinación): no se comparan.

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

El análisis de las 38 filas del archivo de Mafe, ya con los días (lunes a viernes) y Sala Nueva = Sala Blanca confirmados por ella, encontró **12 hallazgos**, entre ellos casi todo lo que ella tenía anotado a
mano y algo que no estaba en sus notas: **grupos de inglés con más estudiantes que el aforo de la sala** (14 en una sala de
aforo 10). Ningún horario se cruza: los problemas están en los datos, no en la planeación. El detalle (cohortes, salas,
líneas) está en el informe del ensayo y no se publica aquí.

- **"Sala Nueva" es la Sala Blanca** (confirmado por Mafe): se importa con `--alias "Sala Nueva=blanca"`.
- **Los días son de lunes a viernes**: el archivo no traía la columna; se le agregó `L-V` a todos los bloques.
- **El mes y el año de la cohorte** (`D1 Oct-25`) son la fecha de ingreso: no importa que Software y SER difieran.

## Comprobado

- `npm test`: `tests/horarios.test.js` (41 pruebas: horas y días, búsqueda de salas, ocupación, bloqueo de reservas, cada
  hallazgo, todo o nada, reemplazo por tipo, recorrido contra PostgreSQL con un CSV en Windows-1252 y la API),
  `tests/xlsx.test.js` (11: textos compartidos y en línea, horas como fracción del día, filas vacías, hojas ocultas, ZIP
  dañado y zip bomb) y `tests/horarios-editar.test.js` (21: validar, agregar, cambiar y quitar, reservas que quedan encima,
  Excel y CSV, y la API: un profesor recibe `403` y sin sesión `401`). Los datos son inventados; el `.xlsx` de las pruebas se
  arma en memoria (`tests/ayuda-xlsx.js`).
- El comando se probó en ensayo con el archivo real contra una base desechable. También con días de ejemplo (`L-V`): no hay
  cruces de horario.
- La pantalla se probó en un navegador contra una base desechable con el archivo real: 38 bloques en 9 salas, cambio de día y
  de filtro, detalle, hallazgos solo para admin (un profesor recibe `403`), ancho de celular sin scroll de página y que el
  auto-refresco de 5 s no borra la selección.
- Subir el Excel real de Mafe desde el navegador (base desechable): el ensayo pide la sala y los días, no escribe nada,
  detecta una reserva futura que queda encima y, al guardar, deja las 38 clases de lunes a viernes; editar, agregar y quitar
  también se recorrieron.
- **Todavía no comprobado:** guardar el archivo real en la base de desarrollo (hay que reconstruir la app para crear la
  tabla), un Excel guardado por Microsoft Excel de verdad (el archivo real de Mafe usa textos "en línea"; los
  textos compartidos que usa Excel solo se probaron con archivos armados por las pruebas) y que las reservas se
  bloqueen con los días reales en el uso diario.

## Pendiente (Fase B y otras)

- Confirmar con Mafe los 12 hallazgos (aforo de inglés, SER que falta en R4, K4 y F4, módulos intercambiados, docentes y
  estudiantes que faltan).
- Cambiar varias clases a la vez (hoy se edita una por una) y una vista de la grilla para arrastrar y soltar.
- Fase B: un solucionador que arme los grupos de inglés por nivel con las salas y docentes libres.
