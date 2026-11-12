import pytest
from fastapi.testclient import TestClient

from app.config import Config
from app.main import Servicios, app
from app.modelos import SalidaRespuesta, ServicioIAError
from app.rag import Asistente

from .falsos import BuscadorFalso, LLMFalso, fragmento

CFG = Config(reranking=False)


class AlmacenFalso:
    def __init__(self):
        self.ingestas = 0

    def contar(self):
        return 7

    def ingestar_carpeta(self):
        self.ingestas += 1
        return {"documentos": 5, "fragmentos": 7, "retirados": 0}


def cliente(llm=None, buscador=None):
    llm = llm or LLMFalso()
    asistente = Asistente(buscador or BuscadorFalso([fragmento(1)]), llm, CFG)
    app.state.servicios = Servicios(CFG, AlmacenFalso(), asistente)
    return TestClient(app)


@pytest.fixture(autouse=True)
def sin_token(monkeypatch):
    monkeypatch.delenv("PULSE_AI_TOKEN", raising=False)


def test_salud_informa_cuantos_fragmentos_hay():
    with cliente() as c:
        assert c.get("/salud").json()["fragmentos"] == 7


def test_preguntar_responde_con_fuentes():
    with cliente() as c:
        r = c.post("/preguntar", json={"pregunta": "¿hora?"})
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["respondido"] is True and cuerpo["fragmentos"][0]["usado"] is True


@pytest.mark.parametrize("cuerpo", [
    {}, {"pregunta": ""}, {"pregunta": "x" * 1001},
    {"pregunta": "hola", "historial": [{"rol": "robot", "texto": "x"}]},
    {"pregunta": "hola", "historial": [{"rol": "usuario", "texto": "x"}] * 21},
])
def test_datos_invalidos_responden_422_con_el_formato_de_error(cuerpo):
    with cliente() as c:
        r = c.post("/preguntar", json=cuerpo)
    assert r.status_code == 422 and r.json()["error"]["codigo"] == "DATOS_INVALIDOS"


def test_si_gemini_falla_responde_503():
    class Roto(LLMFalso):
        def responder(self, *a):
            raise ServicioIAError("sin cuota")

    with cliente(Roto()) as c:
        r = c.post("/preguntar", json={"pregunta": "¿hora?"})
    assert r.status_code == 503
    assert r.json() == {"error": {"codigo": "IA_NO_DISPONIBLE", "mensaje": "sin cuota"}}


def test_con_token_configurado_se_exige_en_preguntar_e_ingestar(monkeypatch):
    monkeypatch.setenv("PULSE_AI_TOKEN", "secreto")
    with cliente() as c:
        assert c.post("/preguntar", json={"pregunta": "hola"}).status_code == 401
        assert c.post("/ingestar").status_code == 401
        assert c.post("/preguntar", json={"pregunta": "hola"}, headers={"X-Pulse-Token": "otro"}).status_code == 401
        assert c.post("/preguntar", json={"pregunta": "hola"}, headers={"X-Pulse-Token": "secreto"}).status_code == 200
        assert c.post("/ingestar", headers={"X-Pulse-Token": "secreto"}).json()["fragmentos"] == 7


def test_el_reranking_se_puede_pedir_por_peticion():
    llm = LLMFalso(puntajes={1: 9})
    with cliente(llm) as c:
        c.post("/preguntar", json={"pregunta": "hola", "reranking": True})
    assert llm.llamadas["puntuar"] == 1
