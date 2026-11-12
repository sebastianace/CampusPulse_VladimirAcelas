from app.fragmentos import TAMANO_FRAGMENTO, cortar_documento

DOC = """# Reglamento de prueba

> Documento de ejemplo redactado para pruebas.

## Horario

Se abre a las 7.

## Aforo

No se puede superar el aforo.

### Excepciones

Ninguna.
"""


def test_cada_seccion_es_un_fragmento_con_su_metadata():
    fragmentos = cortar_documento(DOC, "reglamento.md")
    secciones = [f.metadata["seccion"] for f in fragmentos]
    assert "Horario" in secciones and "Aforo" in secciones
    assert "Aforo › Excepciones" in secciones  # un ### queda anidado en su ##
    assert all(f.metadata["documento"] == "Reglamento de prueba" for f in fragmentos)
    assert all(f.metadata["archivo"] == "reglamento.md" for f in fragmentos)


def test_el_texto_lleva_documento_y_seccion_antepuestos():
    horario = next(f for f in cortar_documento(DOC, "r.md") if f.metadata["seccion"] == "Horario")
    assert horario.page_content.startswith("Reglamento de prueba › Horario\n")
    assert "Se abre a las 7." in horario.page_content


def test_marca_los_documentos_de_ejemplo():
    assert all(f.metadata["ejemplo"] for f in cortar_documento(DOC, "r.md"))
    assert not any(f.metadata["ejemplo"] for f in cortar_documento("# Oficial\n\n## A\n\ntexto", "o.md"))


def test_una_seccion_larga_se_parte_pero_conserva_la_metadata():
    largo = "# Doc\n\n## Larga\n\n" + " ".join(f"Frase número {i} del documento." for i in range(120))
    fragmentos = cortar_documento(largo, "l.md")
    assert len(fragmentos) > 1
    assert all(f.metadata["seccion"] == "Larga" for f in fragmentos)
    # el texto antepuesto suma pocos caracteres al límite
    assert all(len(f.page_content) <= TAMANO_FRAGMENTO + 60 for f in fragmentos)
    assert [f.metadata["orden"] for f in fragmentos] == list(range(len(fragmentos)))


def test_secciones_vacias_no_generan_fragmentos():
    assert cortar_documento("# Doc\n\n## Vacía\n\n## Con texto\n\nHola", "d.md")[0].metadata["seccion"] == "Con texto"


def test_texto_antes_del_primer_titulo_va_a_introduccion():
    fragmentos = cortar_documento("Texto suelto sin título.", "suelto.md")
    assert fragmentos[0].metadata["seccion"] == "Introducción"
    assert fragmentos[0].metadata["documento"] == "suelto.md"


def test_el_aviso_de_documento_de_ejemplo_no_genera_fragmento_pero_si_la_marca():
    fragmentos = cortar_documento(DOC, "r.md")
    assert not any("Documento de ejemplo" in f.page_content for f in fragmentos)
    assert "Introducción" not in [f.metadata["seccion"] for f in fragmentos]
    assert all(f.metadata["ejemplo"] for f in fragmentos)
