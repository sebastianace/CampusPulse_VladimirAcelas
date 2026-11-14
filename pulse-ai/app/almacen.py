"""Base vectorial del conocimiento: la tabla `conocimiento` en la PostgreSQL de Campus Pulse (pgvector).

Usa PGVectorStore de langchain-postgres. La tabla y el índice HNSW los crea el propio servicio al arrancar
(a diferencia de las tablas de Node, que viven en db/migrations/), por eso es seguro ejecutarlo más de una vez.
"""

import logging
from pathlib import Path

import psycopg
from langchain_postgres import PGEngine, PGVectorStore
from langchain_postgres.v2.indexes import HNSWIndex
from sqlalchemy.engine import URL

from .config import Config
from .fragmentos import cortar_documento
from .modelos import Fragmento, ServicioIAError

log = logging.getLogger("pulse-ai")

COLUMNA_CONTENIDO = "contenido"
COLUMNA_EMBEDDING = "embedding"
COLUMNA_METADATOS = "metadatos"
COLUMNA_ID = "id"


class Almacen:
    def __init__(self, cfg: Config, embeddings):
        self._cfg = cfg
        self._embeddings = embeddings
        self._tienda: PGVectorStore | None = None

    # ---------- conexión ----------

    def _dsn(self) -> str:
        c = self._cfg
        return f"host={c.pg_host} port={c.pg_puerto} dbname={c.pg_base} user={c.pg_usuario} password={c.pg_clave}"

    def _tabla_existe(self) -> bool:
        with psycopg.connect(self._dsn()) as con:
            return con.execute("SELECT to_regclass(%s)", (f'public."{self._cfg.tabla}"',)).fetchone()[0] is not None

    def _preparar(self) -> PGVectorStore:
        """Crea (si falta) la tabla y el índice HNSW y devuelve el almacén. Solo se hace una vez."""
        if self._tienda is not None:
            return self._tienda
        c = self._cfg
        try:
            # La clave se pasa en un objeto URL (no en un texto) para que un carácter raro no rompa la conexión.
            url = URL.create("postgresql+asyncpg", username=c.pg_usuario, password=c.pg_clave,
                             host=c.pg_host, port=c.pg_puerto, database=c.pg_base)
            engine = PGEngine.from_connection_string(url)
            # init_vectorstore_table falla si la tabla ya existe (p. ej. al reiniciar el contenedor), así que
            # solo se crea cuando falta. Nunca se usa overwrite_existing: borraría los fragmentos guardados.
            if not self._tabla_existe():
                engine.init_vectorstore_table(
                    c.tabla, vector_size=c.dimensiones,
                    content_column=COLUMNA_CONTENIDO, embedding_column=COLUMNA_EMBEDDING,
                    metadata_json_column=COLUMNA_METADATOS, id_column=COLUMNA_ID,
                )
            tienda = PGVectorStore.create_sync(
                engine, self._embeddings, c.tabla,
                content_column=COLUMNA_CONTENIDO, embedding_column=COLUMNA_EMBEDDING,
                metadata_json_column=COLUMNA_METADATOS, id_column=COLUMNA_ID,
                k=c.k_final,
            )
            indice = f"{c.tabla}_hnsw_idx"
            if not tienda.is_valid_index(indice):
                tienda.apply_vector_index(HNSWIndex(name=indice))
        except ServicioIAError:
            raise
        except Exception as error:
            log.error("No se pudo preparar la base vectorial: %s", error)
            raise ServicioIAError("No hay conexión con la base de conocimiento.") from error
        self._tienda = tienda
        return tienda

    # ---------- lectura ----------

    def contar(self) -> int:
        self._preparar()
        with psycopg.connect(self._dsn()) as con:
            return con.execute(f'SELECT count(*) FROM "{self._cfg.tabla}"').fetchone()[0]

    def buscar(self, consulta: str, k: int) -> list[Fragmento]:
        """Los k fragmentos más cercanos a la consulta (distancia coseno de pgvector, operador <=>)."""
        tienda = self._preparar()
        try:
            resultados = tienda.similarity_search_with_score(consulta, k=k)
        except Exception as error:
            log.warning("Búsqueda vectorial falló: %s", error)
            raise ServicioIAError("No se pudo buscar en la base de conocimiento.") from error
        fragmentos = []
        for doc, distancia in resultados:
            m = doc.metadata
            # Se quita la línea "Documento › Sección" que se antepuso para el embedding.
            texto = doc.page_content.split("\n", 1)[1] if "\n" in doc.page_content else doc.page_content
            fragmentos.append(Fragmento(
                texto=texto, documento=m.get("documento", ""), seccion=m.get("seccion", ""),
                archivo=m.get("archivo", ""), ejemplo=bool(m.get("ejemplo")),
                similitud=1.0 - float(distancia),
            ))
        return fragmentos

    # ---------- ingesta ----------

    def ingestar_texto(self, texto: str, archivo: str) -> int:
        """Reemplaza los fragmentos de un documento. Devuelve cuántos guardó."""
        tienda = self._preparar()
        fragmentos = cortar_documento(texto, archivo)
        try:
            # Primero se calculan los embeddings (puede fallar por la red) y solo después se borra lo
            # anterior; si Gemini falla, el documento viejo queda intacto.
            vectores = self._embeddings.embed_documents([f.page_content for f in fragmentos])
            with psycopg.connect(self._dsn()) as con:
                con.execute(f'DELETE FROM "{self._cfg.tabla}" WHERE "{COLUMNA_METADATOS}"->>\'archivo\' = %s', (archivo,))
            if fragmentos:
                tienda.add_embeddings(
                    texts=[f.page_content for f in fragmentos], embeddings=vectores,
                    metadatas=[f.metadata for f in fragmentos],
                )
        except Exception as error:
            log.error("Ingesta de %s falló: %s", archivo, error)
            raise ServicioIAError(f"No se pudo guardar {archivo} en la base de conocimiento.") from error
        return len(fragmentos)

    def ingestar_carpeta(self, carpeta: str | None = None) -> dict:
        """Carga todos los .md de la carpeta y borra de la base los documentos que ya no están."""
        ruta = Path(carpeta or self._cfg.carpeta_conocimiento)
        archivos = sorted(p for p in ruta.glob("*.md") if p.name.lower() != "readme.md")
        if not archivos:
            raise ServicioIAError(f"No hay documentos .md en {ruta}.")
        total = 0
        for archivo in archivos:
            total += self.ingestar_texto(archivo.read_text(encoding="utf-8"), archivo.name)
        nombres = [a.name for a in archivos]
        with psycopg.connect(self._dsn()) as con:
            borrados = con.execute(
                f'DELETE FROM "{self._cfg.tabla}" WHERE NOT ("{COLUMNA_METADATOS}"->>\'archivo\' = ANY(%s))', (nombres,)
            ).rowcount
        return {"documentos": len(archivos), "fragmentos": total, "retirados": borrados}
