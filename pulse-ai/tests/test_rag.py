from app.config import Config
from app.modelos import SalidaRespuesta
from app.rag import MENSAJE_NO_SE, SUGERENCIA_GENERAL, Asistente

from .falsos import BuscadorFalso, LLMFalso, fragmento

CFG = Config(k_final=4, k_candidatos=8, reranking=True, puntaje_minimo=4, max_historial=6)
LISTA = [fragmento(n, similitud=1 - n / 20) for n in range(1, 10)]  # 9 fragmentos, el 1 es el más parecido


def asistente(llm, buscador=None, cfg=CFG):
    return Asistente(buscador or BuscadorFalso(LISTA), llm, cfg)


def test_sin_reranking_busca_k_final_y_no_llama_al_reranker():
    buscador, llm = BuscadorFalso(LISTA), LLMFalso()
    r = asistente(llm, buscador).preguntar("¿hora?", [], reranking=False)
    assert buscador.llamadas == [("¿hora?", 4)]
    assert llm.llamadas["puntuar"] == 0
    assert r["reranking"] is False and len(r["fragmentos"]) == 4


def test_con_reranking_trae_mas_candidatos_y_se_queda_con_los_mejor_puntuados():
    buscador = BuscadorFalso(LISTA)
    # el fragmento 7 es el mejor según el reranker, aunque la búsqueda vectorial lo puso séptimo
    llm = LLMFalso(puntajes={7: 10, 3: 9, 1: 8, 2: 7, 4: 1, 5: 1, 6: 1, 8: 1})
    r = asistente(llm, buscador).preguntar("¿hora?", [], reranking=True)
    assert buscador.llamadas == [("¿hora?", 8)]
    assert [f["documento"] for f in r["fragmentos"]] == ["Documento 7", "Documento 3", "Documento 1", "Documento 2"]
    assert r["reranking"] is True
    # lo que ve Gemini es el orden reordenado
    assert llm.ultimo_responder[2][0] == "Documento 7"


def test_si_el_reranking_falla_se_usa_el_orden_vectorial():
    llm = LLMFalso(falla_reranking=True)
    r = asistente(llm).preguntar("¿hora?", [], reranking=True)
    assert r["reranking"] is False
    assert [f["documento"] for f in r["fragmentos"]] == ["Documento 1", "Documento 2", "Documento 3", "Documento 4"]
    assert r["respondido"] is True


def test_si_ningun_fragmento_alcanza_el_puntaje_minimo_dice_no_se_sin_llamar_a_responder():
    llm = LLMFalso(puntajes={n: 2 for n in range(1, 9)})
    r = asistente(llm).preguntar("¿quién ganó el mundial?", [])
    assert r["respondido"] is False
    assert r["respuesta"].startswith(MENSAJE_NO_SE) and SUGERENCIA_GENERAL in r["respuesta"]
    assert llm.llamadas["responder"] == 0
    assert not any(f["usado"] for f in r["fragmentos"])


def test_respuesta_con_citas_marca_solo_los_fragmentos_usados():
    llm = LLMFalso(puntajes={n: 9 for n in range(1, 9)},
                   salida=SalidaRespuesta(respondido=True, respuesta="  Son 4 horas.  ", fragmentos_usados=[2, 2, 1]))
    r = asistente(llm).preguntar("¿cuánto dura?", [])
    assert r["respondido"] is True and r["respuesta"] == "Son 4 horas."
    assert [f["usado"] for f in r["fragmentos"]] == [True, True, False, False]


def test_citas_inventadas_se_ignoran_y_sin_ninguna_valida_es_no_se():
    llm = LLMFalso(puntajes={n: 9 for n in range(1, 9)},
                   salida=SalidaRespuesta(respondido=True, respuesta="Texto", fragmentos_usados=[0, 9, 99]))
    r = asistente(llm).preguntar("¿algo?", [])
    assert r["respondido"] is False  # nunca responde sin poder decir de dónde lo sacó


def test_respuesta_sin_fuentes_es_no_se_aunque_el_modelo_diga_que_respondio():
    llm = LLMFalso(puntajes={1: 9}, salida=SalidaRespuesta(respondido=True, respuesta="Texto", fragmentos_usados=[]))
    assert asistente(llm).preguntar("¿algo?", [])["respondido"] is False


def test_el_modelo_dice_no_se_y_sugiere_un_area():
    llm = LLMFalso(puntajes={1: 9},
                   salida=SalidaRespuesta(respondido=False, respuesta="", fragmentos_usados=[], area_sugerida="Soporte TI"))
    r = asistente(llm).preguntar("¿cómo cambio la clave del wifi?", [])
    assert r["respondido"] is False and r["areaSugerida"] == "Soporte TI"
    assert "Soporte TI" in r["respuesta"]


def test_sin_fragmentos_en_la_base_dice_no_se():
    llm = LLMFalso()
    r = asistente(llm, BuscadorFalso([])).preguntar("¿algo?", [])
    assert r["respondido"] is False and r["fragmentos"] == [] and llm.llamadas["responder"] == 0


def test_memoria_reformula_con_el_historial_y_busca_con_la_pregunta_reformulada():
    buscador = BuscadorFalso(LISTA)
    llm = LLMFalso(puntajes={1: 9}, reformulada="¿Se puede reservar los sábados?")
    historial = [{"rol": "usuario", "texto": "¿Se puede reservar los lunes?"}, {"rol": "pulse", "texto": "Sí."}]
    r = asistente(llm, buscador).preguntar("¿y los sábados?", historial)
    assert llm.llamadas["reformular"] == 1
    assert buscador.llamadas[0][0] == "¿Se puede reservar los sábados?"
    assert r["consulta"] == "¿Se puede reservar los sábados?"


def test_sin_historial_no_se_gasta_una_llamada_en_reformular():
    llm = LLMFalso(puntajes={1: 9})
    asistente(llm).preguntar("¿hora?", [])
    assert llm.llamadas["reformular"] == 0


def test_si_falla_reformular_se_une_con_la_ultima_pregunta_de_la_persona():
    buscador = BuscadorFalso(LISTA)
    llm = LLMFalso(puntajes={1: 9}, falla_reformular=True)
    historial = [{"rol": "usuario", "texto": "¿Se reserva los lunes?"}, {"rol": "pulse", "texto": "Sí."}]
    r = asistente(llm, buscador).preguntar("¿y los sábados?", historial)
    assert buscador.llamadas[0][0] == "¿Se reserva los lunes? ¿y los sábados?"
    assert r["respondido"] is True  # la conversación no se cae por fallar la reformulación


def test_si_falla_reformular_y_no_hay_preguntas_previas_se_usa_la_original():
    buscador = BuscadorFalso(LISTA)
    asistente(LLMFalso(puntajes={1: 9}, falla_reformular=True), buscador).preguntar("¿hora?", [{"rol": "pulse", "texto": "Hola"}])
    assert buscador.llamadas[0][0] == "¿hora?"


def test_solo_se_recuerdan_los_ultimos_mensajes():
    llm = LLMFalso(puntajes={1: 9})
    historial = [{"rol": "usuario", "texto": f"m{i}"} for i in range(10)]
    asistente(llm).preguntar("¿y?", historial)
    assert [m["texto"] for m in llm.ultimo_responder[1]] == [f"m{i}" for i in range(4, 10)]
