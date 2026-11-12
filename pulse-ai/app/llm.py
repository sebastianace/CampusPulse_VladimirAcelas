"""Llamadas a Gemini con LangChain (salida estructurada). Es el único archivo de pulse-ai que habla con Gemini."""

import logging
import time
import warnings

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings

from .config import Config
from .modelos import Puntajes, PreguntaReformulada, SalidaRespuesta, ServicioIAError
from .prompts import prompt_reformular, prompt_reranking, prompt_respuesta

log = logging.getLogger("pulse-ai")

# Algunos modelos (p. ej. los "flash-lite") ignoran la temperatura y langchain avisa en cada llamada: ruido.
warnings.filterwarnings("ignore", message=".*uses fixed sampling defaults.*")

INTENTOS = 2          # el primero + un reintento, igual que src/ai/cliente.js en Node
ESPERA_REINTENTO = 1.5  # segundos
ESPERA_CUOTA = 5.0      # segundos, cuando Gemini responde 429 (cuota por minuto agotada)


def crear_embeddings(cfg: Config) -> GoogleGenerativeAIEmbeddings:
    """Embeddings de Gemini. Con la misma dimensión (768) que usa Node para las incidencias parecidas.

    langchain-google-genai usa por defecto task_type RETRIEVAL_DOCUMENT al guardar fragmentos y
    RETRIEVAL_QUERY al buscar: modelos de embeddings entrenados para que una pregunta quede cerca de
    los fragmentos que la responden (distinto de SEMANTIC_SIMILARITY, que compara textos del mismo tipo).
    """
    if not cfg.gemini_api_key:
        raise ServicioIAError("Falta GEMINI_API_KEY: no se pueden calcular embeddings.")
    return GoogleGenerativeAIEmbeddings(
        model=cfg.modelo_embeddings,
        google_api_key=cfg.gemini_api_key,
        output_dimensionality=cfg.dimensiones,
    )


class GeminiLLM:
    def __init__(self, cfg: Config):
        if not cfg.gemini_api_key or not cfg.gemini_modelo:
            raise ServicioIAError("La IA no está configurada (falta GEMINI_API_KEY o GEMINI_MODEL).")
        self.modelo = cfg.gemini_modelo
        self._chat = ChatGoogleGenerativeAI(
            model=cfg.gemini_modelo,
            google_api_key=cfg.gemini_api_key,
            temperature=0.2,  # respuestas estables: es un asistente de datos, no de creatividad
            timeout=20,
            max_retries=1,
        )

    def _invocar(self, esquema, prompt: str):
        ultimo = None
        for intento in range(1, INTENTOS + 1):
            try:
                return self._chat.with_structured_output(esquema).invoke(prompt)
            except Exception as error:  # red, cuota, "alta demanda" (503), JSON inválido...
                ultimo = error
                log.warning("Gemini falló (%s, intento %d de %d): %s", esquema.__name__, intento, INTENTOS, error)
                if intento < INTENTOS:
                    # Con 429 (cuota por minuto del plan gratuito) esperar 1.5 s no sirve: Google pide ~4-5 s.
                    time.sleep(ESPERA_CUOTA if "RESOURCE_EXHAUSTED" in str(error) or "429" in str(error) else ESPERA_REINTENTO)
        raise ServicioIAError("La IA no respondió correctamente. Intenta de nuevo en un momento.") from ultimo

    def reformular(self, pregunta: str, historial: list[dict]) -> str:
        salida = self._invocar(PreguntaReformulada, prompt_reformular(pregunta, historial))
        # Si el modelo dice que la pregunta se entiende sola, se usa tal cual: así no puede "contaminarla"
        # con el tema de mensajes anteriores aunque haya reescrito algo.
        if not salida.depende_del_historial:
            return pregunta
        return (salida.pregunta or "").strip() or pregunta

    def puntuar(self, pregunta: str, fragmentos) -> dict[int, float]:
        salida = self._invocar(Puntajes, prompt_reranking(pregunta, fragmentos))
        return {p.numero: float(p.puntaje) for p in salida.puntajes}

    def responder(self, pregunta: str, historial: list[dict], fragmentos):
        salida = self._invocar(SalidaRespuesta, prompt_respuesta(pregunta, historial, fragmentos))
        if salida is None:
            raise ServicioIAError("La IA devolvió una respuesta vacía.")
        return salida
