"""El flujo RAG de Pulse: reformular → recuperar → reordenar → responder con citas (o decir que no sabe).

Cada paso es una decisión de diseño que se explica en docs/rag.md. La clase no sabe nada de Gemini ni de
PostgreSQL: recibe un `buscador` y un `llm`, así los tests usan falsos y no gastan cuota.
"""

import logging
from typing import Protocol

from .config import Config
from .modelos import Fragmento, ServicioIAError

log = logging.getLogger("pulse-ai")

MENSAJE_NO_SE = "No encontré esa información en los documentos del campus, así que prefiero no inventarla."
SUGERENCIA_GENERAL = "Puedes preguntarle al administrador o reportar una incidencia para que llegue al área responsable."


class Buscador(Protocol):
    def buscar(self, consulta: str, k: int) -> list[Fragmento]: ...


class Asistente:
    def __init__(self, buscador: Buscador, llm, cfg: Config):
        self._buscador = buscador
        self._llm = llm
        self._cfg = cfg

    # ---------- pasos ----------

    def _reformular(self, pregunta: str, historial: list[dict]) -> str:
        """Memoria corta: convierte 'y los sábados?' en una pregunta que se entienda sola."""
        if not historial:
            return pregunta
        try:
            return self._llm.reformular(pregunta, historial)
        except ServicioIAError:
            # Respaldo sin IA: se une la última pregunta de la persona con la nueva ("¿y los domingos?" a secas
            # no encuentra nada, pero "¿Cuántas horas...? ¿y los domingos?" sí se acerca al tema).
            previas = [m["texto"] for m in historial if m["rol"] == "usuario"]
            log.warning("No se pudo reformular la pregunta; se une con la pregunta anterior.")
            return f"{previas[-1]} {pregunta}" if previas else pregunta

    def _reordenar(self, consulta: str, candidatos: list[Fragmento]) -> tuple[list[Fragmento], bool]:
        """Reranking: Gemini califica cada candidato y se queda con los mejores `k_final`."""
        try:
            puntajes = self._llm.puntuar(consulta, candidatos)
        except ServicioIAError:
            log.warning("El reranking falló; se usa el orden de la búsqueda vectorial.")
            return candidatos[: self._cfg.k_final], False
        for i, f in enumerate(candidatos, start=1):
            f.puntaje = puntajes.get(i, 0.0)
        # sorted es estable: ante el mismo puntaje se conserva el orden de la búsqueda vectorial.
        ordenados = sorted(candidatos, key=lambda f: -(f.puntaje or 0.0))
        return ordenados[: self._cfg.k_final], True

    # ---------- flujo completo ----------

    def preguntar(self, pregunta: str, historial: list[dict], reranking: bool | None = None) -> dict:
        usar_reranking = self._cfg.reranking if reranking is None else reranking
        historial = historial[-self._cfg.max_historial:]
        consulta = self._reformular(pregunta, historial)

        k = self._cfg.k_candidatos if usar_reranking else self._cfg.k_final
        candidatos = self._buscador.buscar(consulta, k)
        reranking_aplicado = False
        if usar_reranking and candidatos:
            candidatos, reranking_aplicado = self._reordenar(consulta, candidatos)
        else:
            candidatos = candidatos[: self._cfg.k_final]

        base = {"consulta": consulta, "reranking": reranking_aplicado, "modelo": getattr(self._llm, "modelo", "")}

        if not candidatos:
            return {**base, **self._no_se(None), "fragmentos": []}

        # Compuerta del reranking: si ni el mejor fragmento sirve, no se gasta la llamada que redacta.
        if reranking_aplicado and max(f.puntaje or 0 for f in candidatos) < self._cfg.puntaje_minimo:
            return {**base, **self._no_se(None), "fragmentos": [f.como_dict() for f in candidatos]}

        salida = self._llm.responder(consulta, historial, candidatos)

        # Validación de las citas: solo cuentan números que existen. Una respuesta sin ninguna fuente válida
        # se trata como "no sé": Pulse nunca responde sin poder decir de dónde sacó el dato.
        usados = sorted({n for n in salida.fragmentos_usados if 1 <= n <= len(candidatos)})
        if not salida.respondido or not salida.respuesta.strip() or not usados:
            return {**base, **self._no_se(salida.area_sugerida), "fragmentos": [f.como_dict() for f in candidatos]}

        for n in usados:
            candidatos[n - 1].usado = True
        return {
            **base,
            "respondido": True,
            "respuesta": salida.respuesta.strip(),
            "areaSugerida": None,
            "fragmentos": [f.como_dict() for f in candidatos],
        }

    @staticmethod
    def _no_se(area: str | None) -> dict:
        sugerencia = f"Te sugiero consultarlo con {area}." if area else SUGERENCIA_GENERAL
        return {"respondido": False, "respuesta": f"{MENSAJE_NO_SE} {sugerencia}", "areaSugerida": area}
