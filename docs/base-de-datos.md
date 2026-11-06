# Base de datos (PostgreSQL + pgvector)

> **Estado:** migración en curso (Fase 2 del plan). Ya están el servicio, las migraciones, la
> semilla y las pruebas del esquema. **La aplicación todavía lee y escribe `data/db.json`**; irá
> pasando a PostgreSQL en los siguientes pull requests.

## Cómo levantarla

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

Las migraciones están en [`db/migrations/`](../db/migrations/): `001_extensiones.sql` y
`002_esquema.sql`. Cada archivo corre en una transacción; lo aplicado queda en `schema_migrations`.

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
- Esta migración solo **crea** la restricción. Mientras la app use `db.json`, la regla sigue
  viviendo en JavaScript; la restricción empieza a proteger cuando las reservas pasen a PostgreSQL.

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

## Pendiente de la Fase 2

1. ✅ Servicio, migraciones, semilla y pruebas del esquema (este documento).
2. Espacios, recursos y reservas en PostgreSQL, con una prueba de dos reservas simultáneas.
3. Préstamos e incidencias, con transacciones.
4. Usuarios, sesiones, calidad de datos y restaurar; retirar `data/db.json` y sumar la app a
   `compose.yaml`.
