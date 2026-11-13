from app.config import Config


def test_el_reranking_viene_apagado_por_defecto(monkeypatch):
    monkeypatch.delenv("RAG_RERANKING", raising=False)
    assert Config().reranking is False


def test_se_enciende_con_rag_reranking_1_y_solo_con_1(monkeypatch):
    monkeypatch.setenv("RAG_RERANKING", "1")
    assert Config().reranking is True
    for valor in ("0", "", "true", "si"):
        monkeypatch.setenv("RAG_RERANKING", valor)
        assert Config().reranking is False, valor
