import pytest

import app.llm as llm_modulo
from app.llm import GeminiLLM
from app.modelos import PreguntaReformulada, ServicioIAError


class ChatFalso:
    """Falla las veces indicadas y luego responde."""

    def __init__(self, fallos):
        self.fallos = fallos
        self.invocaciones = 0

    def with_structured_output(self, esquema):
        return self

    def invoke(self, prompt):
        self.invocaciones += 1
        if self.invocaciones <= self.fallos:
            raise RuntimeError("503 UNAVAILABLE: high demand")
        return PreguntaReformulada(depende_del_historial=False, pregunta="ok")


class ChatQueDevuelve:
    def __init__(self, salida):
        self.salida = salida

    def with_structured_output(self, esquema):
        return self

    def invoke(self, prompt):
        return self.salida


def test_si_la_pregunta_no_depende_del_historial_se_usa_tal_cual_aunque_el_modelo_la_reescriba(monkeypatch):
    # Es el fallo real que se vio con gemini-3.5-flash-lite: mezcló "mundial" con "domingos".
    salida = PreguntaReformulada(depende_del_historial=False, pregunta="¿Cuánto dura una reserva los domingos?")
    llm = llm_con(ChatQueDevuelve(salida), monkeypatch)
    assert llm.reformular("¿Quién ganó el mundial?", [{"rol": "usuario", "texto": "hola"}]) == "¿Quién ganó el mundial?"


def test_si_depende_del_historial_se_usa_la_reescritura(monkeypatch):
    salida = PreguntaReformulada(depende_del_historial=True, pregunta="¿Se puede reservar los domingos?")
    llm = llm_con(ChatQueDevuelve(salida), monkeypatch)
    assert llm.reformular("¿y los domingos?", [{"rol": "usuario", "texto": "hola"}]) == "¿Se puede reservar los domingos?"


def test_con_429_espera_mas_que_con_otros_errores(monkeypatch):
    esperas = []
    monkeypatch.setattr(llm_modulo.time, "sleep", lambda s: esperas.append(s))

    class Cuota(ChatFalso):
        def invoke(self, prompt):
            self.invocaciones += 1
            if self.invocaciones == 1:
                raise RuntimeError("429 RESOURCE_EXHAUSTED: quota")
            return PreguntaReformulada(depende_del_historial=False, pregunta="ok")

    llm = GeminiLLM.__new__(GeminiLLM)
    llm._chat = Cuota(0)
    llm._invocar(PreguntaReformulada, "p")
    assert esperas == [llm_modulo.ESPERA_CUOTA]


def llm_con(chat, monkeypatch):
    monkeypatch.setattr(llm_modulo, "ESPERA_REINTENTO", 0)
    llm = GeminiLLM.__new__(GeminiLLM)  # sin pasar por el constructor: no hay claves en los tests
    llm._chat = chat
    return llm


def test_reintenta_una_vez_si_gemini_dice_alta_demanda(monkeypatch):
    chat = ChatFalso(fallos=1)
    assert llm_con(chat, monkeypatch)._invocar(PreguntaReformulada, "p").pregunta == "ok"
    assert chat.invocaciones == 2


def test_si_falla_las_dos_veces_lanza_servicio_ia_error(monkeypatch):
    chat = ChatFalso(fallos=5)
    with pytest.raises(ServicioIAError):
        llm_con(chat, monkeypatch)._invocar(PreguntaReformulada, "p")
    assert chat.invocaciones == 2  # no insiste más: el usuario no espera 30 segundos
