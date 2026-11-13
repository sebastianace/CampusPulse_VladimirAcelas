"""Fragmentación (chunking) de los documentos de knowledge/.

Dos pasos, como se vio en clase:
  1. MarkdownHeaderTextSplitter parte el documento por sus títulos (#, ##, ###). Cada trozo sabe de qué
     documento y de qué sección viene: esa es la metadata que Pulse cita.
  2. RecursiveCharacterTextSplitter parte en pedazos más pequeños las secciones largas, con un poco de
     solapamiento para no cortar una idea justo en el borde.
Antes de calcular el embedding se le antepone al texto "Documento > Sección": así el vector "sabe" de qué trata
el trozo aunque la frase suelta no lo diga (p. ej. "Cada responsable puede tener 3 reservas al día").
"""

from langchain_core.documents import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

TAMANO_FRAGMENTO = 700
SOLAPAMIENTO = 80
MARCA_EJEMPLO = "documento de ejemplo"

def _sin_aviso_de_ejemplo(texto: str) -> str:
    """Quita la línea '> Documento de ejemplo...' del contenido. Se detecta aparte (metadata `ejemplo`); dejarla
    produciría un fragmento 'Introducción' en cada documento que ensucia la búsqueda."""
    return "\n".join(
        linea for linea in texto.splitlines()
        if not (linea.lstrip().startswith(">") and MARCA_EJEMPLO in linea.lower())
    )


_TITULOS = [("#", "documento"), ("##", "seccion"), ("###", "subseccion")]


def cortar_documento(texto: str, archivo: str) -> list[Document]:
    """Parte un documento Markdown en fragmentos con metadata {archivo, documento, seccion, ejemplo, orden}."""
    por_titulos = MarkdownHeaderTextSplitter(headers_to_split_on=_TITULOS, strip_headers=True)
    pedazos = RecursiveCharacterTextSplitter(chunk_size=TAMANO_FRAGMENTO, chunk_overlap=SOLAPAMIENTO)
    es_ejemplo = MARCA_EJEMPLO in texto.lower()

    fragmentos: list[Document] = []
    for seccion in por_titulos.split_text(_sin_aviso_de_ejemplo(texto)):
        contenido = seccion.page_content.strip()
        if not contenido:
            continue
        documento = seccion.metadata.get("documento") or archivo
        nombre_seccion = " › ".join(
            t for t in (seccion.metadata.get("seccion"), seccion.metadata.get("subseccion")) if t
        ) or "Introducción"
        for trozo in pedazos.split_text(contenido):
            fragmentos.append(
                Document(
                    page_content=f"{documento} › {nombre_seccion}\n{trozo}",
                    metadata={
                        "archivo": archivo,
                        "documento": documento,
                        "seccion": nombre_seccion,
                        "ejemplo": es_ejemplo,
                        "orden": len(fragmentos),
                    },
                )
            )
    return fragmentos
