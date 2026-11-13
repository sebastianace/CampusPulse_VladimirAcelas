"""Falsos para probar el RAG sin Gemini ni base de datos."""

from app.modelos import Fragmento, SalidaRespuesta, ServicioIAError


def fragmento(n: int, similitud: float = 0.8, **extra) -> Fragmento:
    return Fragmento(
        texto=f"texto {n}", documento=f"Documento {n}", seccion=f"Sección {n}", archivo=f"doc{n}.md",
        similitud=similitud, **extra,
    )


class BuscadorFalso:
    """Devuelve siempre la misma lista (ya ordenada por similitud) y recuerda cómo lo llamaron."""

    def __init__(self, fragmentos):
        self.fragmentos = fragmentos
        self.llamadas = []

    def buscar(self, consulta, k):
        self.llamadas.append((consulta, k))
        return [Fragmento(**f.__dict__) for f in self.fragmentos[:k]]


class LLMFalso:
    modelo = "falso"

    def __init__(self, puntajes=None, salida=None, reformulada=None, falla_reranking=False, falla_reformular=False):
        self.puntajes = puntajes or {}
        self.salida = salida or SalidaRespuesta(respondido=True, respuesta="Respuesta", fragmentos_usados=[1])
        self.reformulada = reformulada
        self.falla_reranking = falla_reranking
        self.falla_reformular = falla_reformular
        self.llamadas = {"reformular": 0, "puntuar": 0, "responder": 0}
        self.ultimo_responder = None

    def reformular(self, pregunta, historial):
        self.llamadas["reformular"] += 1
        if self.falla_reformular:
            raise ServicioIAError("falla")
        return self.reformulada or pregunta

    def puntuar(self, pregunta, fragmentos):
        self.llamadas["puntuar"] += 1
        if self.falla_reranking:
            raise ServicioIAError("falla")
        return self.puntajes

    def responder(self, pregunta, historial, fragmentos):
        self.llamadas["responder"] += 1
        self.ultimo_responder = (pregunta, historial, [f.documento for f in fragmentos])
        return self.salida
