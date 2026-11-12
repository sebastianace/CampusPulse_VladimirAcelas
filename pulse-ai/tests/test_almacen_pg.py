"""Prueba de integración: el Almacen contra la PostgreSQL real de compose (necesita `docker compose up -d db`).

Usa embeddings falsos y deterministas (el mismo texto siempre da el mismo vector), así no gasta cuota de
Gemini. No prueba la calidad semántica, sino la mecánica: tabla, índice HNSW, ingesta idempotente y borrado.
"""

import os
import uuid

import psycopg
import pytest
from langchain_core.embeddings import DeterministicFakeEmbedding

from app.almacen import Almacen
from app.config import Config
from app.modelos import ServicioIAError

CFG_BASE = Config()
pytestmark = pytest.mark.skipif(not os.getenv("POSTGRES_PASSWORD"), reason="sin POSTGRES_PASSWORD no hay base para probar")


@pytest.fixture
def almacen(tmp_path):
    tabla = f"conocimiento_prueba_{uuid.uuid4().hex[:8]}"
    cfg = Config(tabla=tabla, carpeta_conocimiento=str(tmp_path))
    a = Almacen(cfg, DeterministicFakeEmbedding(size=cfg.dimensiones))
    a.carpeta = tmp_path
    yield a
    with psycopg.connect(a._dsn(), autocommit=True) as con:
        con.execute(f'DROP TABLE IF EXISTS "{tabla}"')


def escribir(almacen, nombre, texto):
    (almacen.carpeta / nombre).write_text(texto, encoding="utf-8")


DOC_A = "# Salas\n\n## Horario\n\nSe abre a las 7.\n\n## Aforo\n\nNo se supera el aforo.\n"
DOC_B = "# Equipos\n\n## Préstamo\n\nMáximo 2 equipos.\n"


def test_ingesta_la_carpeta_y_cuenta_los_fragmentos(almacen):
    escribir(almacen, "salas.md", DOC_A)
    escribir(almacen, "equipos.md", DOC_B)
    escribir(almacen, "README.md", "# No se carga\n\n## X\n\ntexto")
    resumen = almacen.ingestar_carpeta()
    assert resumen == {"documentos": 2, "fragmentos": 3, "retirados": 0}
    assert almacen.contar() == 3


def test_ingestar_dos_veces_no_duplica(almacen):
    escribir(almacen, "salas.md", DOC_A)
    almacen.ingestar_carpeta()
    almacen.ingestar_carpeta()
    assert almacen.contar() == 2


def test_buscar_devuelve_primero_el_fragmento_identico_con_su_metadata(almacen):
    escribir(almacen, "salas.md", DOC_A)
    escribir(almacen, "equipos.md", DOC_B)
    almacen.ingestar_carpeta()
    consulta = "Salas › Horario\nSe abre a las 7."  # exactamente el texto que se guardó
    mejor = almacen.buscar(consulta, 3)[0]
    assert (mejor.documento, mejor.seccion, mejor.archivo) == ("Salas", "Horario", "salas.md")
    assert mejor.texto == "Se abre a las 7."  # sin la línea "Documento › Sección"
    assert mejor.similitud == pytest.approx(1.0, abs=1e-4)
    assert len(almacen.buscar(consulta, 2)) == 2


def test_un_documento_modificado_reemplaza_sus_fragmentos(almacen):
    escribir(almacen, "salas.md", DOC_A)
    almacen.ingestar_carpeta()
    escribir(almacen, "salas.md", "# Salas\n\n## Horario\n\nAhora se abre a las 6.\n")
    almacen.ingestar_carpeta()
    assert almacen.contar() == 1
    assert "6" in almacen.buscar("Salas › Horario\nAhora se abre a las 6.", 1)[0].texto


def test_un_documento_borrado_de_la_carpeta_se_retira_de_la_base(almacen):
    escribir(almacen, "salas.md", DOC_A)
    escribir(almacen, "equipos.md", DOC_B)
    almacen.ingestar_carpeta()
    (almacen.carpeta / "equipos.md").unlink()
    assert almacen.ingestar_carpeta()["retirados"] == 1
    assert {f.archivo for f in almacen.buscar("cualquier cosa", 10)} == {"salas.md"}


def test_si_falla_el_embedding_el_documento_anterior_queda_intacto(almacen):
    escribir(almacen, "salas.md", DOC_A)
    almacen.ingestar_carpeta()

    class Roto:
        def embed_documents(self, textos):
            raise RuntimeError("sin red")

        def embed_query(self, texto):
            raise RuntimeError("sin red")

    almacen._embeddings = Roto()
    with pytest.raises(ServicioIAError):
        almacen.ingestar_texto("# Salas\n\n## Horario\n\nOtro texto.\n", "salas.md")
    assert almacen.contar() == 2  # nada se borró


def test_la_tabla_tiene_indice_hnsw_con_distancia_coseno(almacen):
    almacen.contar()
    with psycopg.connect(almacen._dsn()) as con:
        definicion = con.execute(
            "SELECT indexdef FROM pg_indexes WHERE tablename = %s AND indexname LIKE %s",
            (almacen._cfg.tabla, "%hnsw%"),
        ).fetchone()[0]
    assert "hnsw" in definicion and "vector_cosine_ops" in definicion


def test_carpeta_vacia_es_un_error_claro(almacen):
    with pytest.raises(ServicioIAError, match="No hay documentos"):
        almacen.ingestar_carpeta()


def test_un_servicio_que_se_reinicia_reutiliza_la_tabla_y_los_datos(almacen):
    """Al reiniciar el contenedor la tabla ya existe: no debe fallar ni perder los fragmentos."""
    escribir(almacen, "salas.md", DOC_A)
    almacen.ingestar_carpeta()
    reiniciado = Almacen(almacen._cfg, almacen._embeddings)  # instancia nueva, misma tabla
    assert reiniciado.contar() == 2
    assert reiniciado.buscar("Salas › Horario\nSe abre a las 7.", 1)[0].seccion == "Horario"
