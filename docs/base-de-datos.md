# Base de datos (PostgreSQL + pgvector)

> **Estado:** todos los datos (espacios, recursos, reservas, préstamos, incidencias, cuentas y
> sesiones) viven en PostgreSQL. Los archivos `data/db.json` y `data/auth.json` de versiones
> anteriores ya no se usan.

## Cómo levantarla

`docker compose up -d --build` levanta la app **y** la base (la app en `http://localhost:3000`).
Para desarrollar con `npm run dev` se levanta solo la base, como se explica a continuación.

1. Agrega a tu `.env` (nunca lo subas al repositorio) una contraseña que elijas:

   ```
   POSTGRES_PASSWORD=la-que-tu-elijas
   POSTGRES_PUERTO=5433
   ```

2. Desde la raíz del proyecto:

   ```bash
   docker compose up -d db   # levanta PostgreSQL 16 con pgvector
   npm run migrar            # aplica db/migrations/*.sql
   npm run semilla           # carga espacios, recursos y el reporte de calidad
   ```

- El contenedor escucha en `127.0.0.1:5433` (solo desde tu computador). Se usa el 5433 y no el
  5432 para no chocar con un PostgreSQL instalado en el sistema.
- Si cambias `POSTGRES_PASSWORD` después de crear el volumen, la base conserva la contraseña
  anterior: borra el volumen con `docker compose down -v` (esto borra los datos de la base).
- `npm test` incluye pruebas que usan PostgreSQL real. Sin la base levantada, esas fallan con el
  mensaje "No hay conexión con PostgreSQL. Levántalo con: docker compose up -d db"; las demás
  siguen funcionando.

## Esquema

Ocho tablas, más `schema_migrations` (qué migraciones ya se aplicaron):

| Tabla | Qué guarda |
|---|---|
| `espacios` | Salas del campus (id, nombre, tipo, aforo, estado) |
| `recursos` | Equipos; `espacio_id` puede ser `NULL` si no tienen sala |
| `reservas` | Reservas de espacios, con la restricción de no solapamiento |
| `prestamos` | Préstamos de equipos |
| `incidencias` | Incidencias; `ia` (jsonb) guarda lo que sugirió la IA |
| `usuarios` | Cuentas, con rol `admin`, `profesor` o `soporte_tecnico` |
| `sesiones` | Sesiones activas (se guarda el hash del token, no el token) |
| `calidad_datos` | Reporte de calidad del CSV oficial (una sola fila) |

Las migraciones están en [`db/migrations/`](../db/migrations/): `001_extensiones.sql`,
`002_esquema.sql` y `003_orden.sql`. Cada archivo corre en una transacción; lo aplicado queda en `schema_migrations`.

## Decisiones

### No solapamiento de reservas, en la base de datos

```sql
EXCLUDE USING gist (espacio_id WITH =, tsrange(inicio, fin, '[)') WITH &&)
```

- **Qué hace:** la base rechaza dos reservas del mismo espacio cuyos rangos de tiempo se crucen.
- **Por qué en la base y no solo en JavaScript:** la regla 6 de `src/domain/reservas.js` revisa las
  reservas existentes y después guarda. Si llegan dos peticiones casi a la vez, ambas pasan la
  revisión antes de que cualquiera guarde, y se guardan las dos. La restricción de la base no tiene
  ese hueco: la segunda inserción falla (error `23P01`) aunque la regla de JavaScript no lo haya
  notado.
- **Por qué `'[)'`:** el rango incluye el inicio y excluye el fin, así que 10:00–12:00 y
  12:00–14:00 no chocan (franjas pegadas), igual que la regla actual.
- **Por qué `btree_gist`:** un índice gist normal no sabe usar `=` sobre texto; la extensión lo
  permite para combinar "mismo espacio" con "rangos que se cruzan".
- La restricción protege desde que las reservas viven en PostgreSQL; la regla 6 de JavaScript se
  mantiene para dar un mensaje claro antes de llegar a la base.

### Fechas

`TIMESTAMP` sin zona horaria: hora local de Bogotá, igual que el contrato de la API
(`YYYY-MM-DDTHH:mm`). `src/data/pg.js` hace que `pg` las devuelva como ese mismo texto, para que las
reglas de `src/domain/`, que comparan texto, no cambien.

### Valores cerrados

Los `CHECK` de estados, categorías, prioridades, áreas y roles repiten las listas de
`src/config/reglas.js`. Es una duplicación consciente (la base se protege sola) y un test intenta
insertar cada valor de `reglas.js`, así que si alguien agrega uno solo en un lado, el test falla.

### Driver y migraciones

`pg` (node-postgres) y SQL plano, sin ORM: así cada línea del esquema, incluida la restricción
`EXCLUDE`, se escribe y se explica directamente. Las migraciones son archivos numerados con un
ejecutor propio de unas 40 líneas (`src/data/migrar.js`).

### Semilla

`npm run semilla` carga desde los mismos orígenes que `db.json` (`data/raw/espacios.csv`,
`data/seed/`). Borra y recarga espacios, recursos, reservas, préstamos e incidencias, pero **no
toca usuarios ni sesiones**, como "Restaurar datos".

### Orden de las filas

`003_orden.sql` agrega a cinco tablas la columna `posicion`, un contador que no cambia con las
actualizaciones. Con `db.json` las listas conservaban el orden en que se guardaban; en PostgreSQL una
tabla no garantiza ningún orden y un `UPDATE` puede mover la fila. Se lee con `ORDER BY posicion`.

## Cómo la app usa la base: "foto + diferencias"

Las reglas de `src/domain/` no cambiaron: siguen recibiendo un objeto `db` y modificándolo.
[`src/data/almacen.js`](../src/data/almacen.js) conserva la interfaz de `store.js`
(`leerDB`, `actualizarDB`, `restaurarDB`), ahora asíncrona. `actualizarDB(cambio)` hace, en **una
transacción**:

1. `BEGIN` y un bloqueo de escritura (`pg_advisory_xact_lock`): una escritura a la vez.
2. **Foto:** lee las tablas y arma el objeto `db`.
3. Llama a `cambio(db)`: las reglas lo modifican. Si lanzan un error, `ROLLBACK` y no se guarda nada.
4. **Diferencias:** compara `db` con la foto y ejecuta solo los `INSERT`, `UPDATE` y `DELETE` necesarios.
5. `COMMIT`.

Cada tabla tiene un repositorio en [`src/data/repos/`](../src/data/repos/) que traduce entre sus filas
y los objetos del dominio (por ejemplo `espacio_id` ↔ `espacioId`). Los datos son pocos, así que leer
las tablas completas en cada escritura es barato.

### Peticiones simultáneas: dos defensas

Con `db.json`, Node atendía una escritura a la vez. Con PostgreSQL varias peticiones pueden llegar
juntas, así que hay dos defensas independientes (`tests/reservas-concurrentes.test.js`):

| Defensa | Qué evita | Se demuestra con |
|---|---|---|
| **Bloqueo de escritura** | Que dos escrituras lean el mismo estado viejo. Las reglas siempre ven lo último. Cubre también reglas que la base no puede expresar, como el límite de 3 reservas por persona y día | 10 peticiones simultáneas a la misma franja: una sola gana, las otras 9 reciben `409 RESERVA_SOLAPADA` |
| **Restricción `EXCLUDE`** | Que, aunque las reglas no lo noten, se guarden dos reservas cruzadas | Dos escrituras con la foto desactualizada: las reglas dejan pasar a ambas y la base rechaza la segunda (`23P01`, traducido a `RESERVA_SOLAPADA`) |

Se comprobó que cada defensa pesa por sí sola: sin restricción ni bloqueo se guardaron **2 reservas
en la misma franja**; solo con el bloqueo quedó 1.

**Detalle honesto:** si dos escrituras sin bloqueo insertan *exactamente* a la vez, PostgreSQL puede
rechazar a la perdedora con un *deadlock* (`40P01`, detectado tras ~1 s) en lugar del error de la
restricción (en una prueba de 60 rondas ocurrió 3 veces). Aun así solo se guarda una reserva. Por eso
la aplicación mantiene el bloqueo: con él, la respuesta es siempre un `409` limpio e inmediato.

### Cuentas y sesiones

Las cuentas (`usuarios`) y las sesiones (`sesiones`) también están en PostgreSQL
([`src/auth/usuarios.js`](../src/auth/usuarios.js)). Las contraseñas siguen guardándose con scrypt
y sal aleatoria, y las sesiones con el hash SHA-256 del token. Dos detalles que antes no hacían falta:

- **El primer admin:** si dos personas se registran a la vez en una base vacía, ambas verían "no hay
  cuentas" y las dos serían admin. El registro cuenta y crea dentro de una transacción con bloqueo
  (`pg_advisory_xact_lock`), así que solo una crea la cuenta y la otra recibe `403`. Un test lo
  demuestra: sin el bloqueo falla 5 de 5 veces.
- **Usuarios repetidos:** la clave primaria de `usuarios` impide dos cuentas con el mismo nombre
  aunque dos peticiones lo pidan a la vez; el error `23505` se traduce a `409 USUARIO_EXISTE`.

Los roles ahora los fija la base: un `CHECK` solo acepta `admin`, `profesor` y `soporte_tecnico`.
`npm run importar-cuentas` copia las cuentas del viejo `data/auth.json` (los roles que ya no existen
pasan a `profesor`; si no queda ningún admin, la primera cuenta importada lo es).

## Pendiente de la Fase 2

1. ✅ Servicio, migraciones, semilla y pruebas del esquema.
2. ✅ Espacios, recursos, reservas, préstamos e incidencias en PostgreSQL, con pruebas de peticiones
   simultáneas.
3. ✅ Cuentas y sesiones en PostgreSQL, con importador de las cuentas anteriores.
4. ✅ `store.js` y `data/db.json` retirados; el estado inicial se arma en `src/data/estado-inicial.js`.
5. ✅ La app dentro de `compose.yaml` (`Dockerfile`, usuario sin permisos de administrador, sin `.env`
   dentro de la imagen). Se comprobó que al reiniciar solo el contenedor de la app, la sesión y los
   datos siguen ahí porque viven en PostgreSQL.

**La Fase 2 está completa:** `docker compose up -d --build` levanta app y base, los tests pasan y dos
reservas simultáneas en la misma franja dejan solo una.
