"""API de pulse-ai (FastAPI). Express la llama por HTTP; si este servicio cae, Campus Pulse sigue funcionando.

  GET  /salud        estado del servicio y de la base de conocimiento
  POST /ingestar     (con token) vuelve a cargar knowledge/ en la base vectorial
  POST /preguntar    {pregunta, historial?, reranking?} -> respuesta con fuentes, o "no sé"

Los errores salen como {"error": {"codigo", "mensaje"}}, el mismo formato que la API de Express.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .almacen import Almacen
from .config import Config, cargar_config
from .llm import GeminiLLM, crear_embeddings
from .modelos import PeticionPregunta, ServicioIAError
from .rag import Asistente

logging.basicConfig(level=logging.INFO, format="[pulse-ai] %(message)s")
log = logging.getLogger("pulse-ai")


class Servicios:
    """Agrupa lo que se crea una sola vez. Los tests lo reemplazan con falsos (app.state.servicios)."""

    def __init__(self, cfg: Config, almacen, asistente):
        self.cfg = cfg
        self.almacen = almacen
        self.asistente = asistente


def crear_servicios_reales(cfg: Config) -> Servicios:
    almacen = Almacen(cfg, crear_embeddings(cfg))
    return Servicios(cfg, almacen, Asistente(almacen, GeminiLLM(cfg), cfg))


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    # Si no hay servicios inyectados (tests), se crean los reales. Si faltan claves, el servicio arranca igual
    # y responde 503 al preguntar: así se ve el problema en /salud en vez de un contenedor que se reinicia.
    if getattr(app.state, "servicios", None) is None:
        cfg = cargar_config()
        try:
            app.state.servicios = crear_servicios_reales(cfg)
            if app.state.servicios.almacen.contar() == 0:
                log.info("La base de conocimiento está vacía: se cargan los documentos de %s", cfg.carpeta_conocimiento)
                log.info("Ingesta: %s", app.state.servicios.almacen.ingestar_carpeta())
        except ServicioIAError as error:
            log.warning("Arranque incompleto: %s", error.mensaje)
            app.state.servicios = None
            app.state.error_arranque = error.mensaje
    yield


app = FastAPI(title="pulse-ai", version="1.0.0", lifespan=ciclo_de_vida)


def _servicios(request: Request) -> Servicios:
    servicios = getattr(request.app.state, "servicios", None)
    if servicios is None:
        # Reintenta crearlos (por ejemplo, si la base tardó en arrancar).
        request.app.state.servicios = servicios = crear_servicios_reales(cargar_config())
    return servicios


def _exigir_token(request: Request):
    """Devuelve una respuesta 401 si el servicio tiene token configurado y la petición no lo trae."""
    token = cargar_config().token
    if token and request.headers.get("x-pulse-token") != token:
        return JSONResponse(status_code=401, content=_error("NO_AUTORIZADO", "Falta el token del servicio."))
    return None


def _error(codigo: str, mensaje: str) -> dict:
    return {"error": {"codigo": codigo, "mensaje": mensaje}}


@app.exception_handler(ServicioIAError)
async def _servicio_caido(request: Request, error: ServicioIAError):
    return JSONResponse(status_code=503, content=_error("IA_NO_DISPONIBLE", error.mensaje))


@app.exception_handler(RequestValidationError)
async def _datos_invalidos(request: Request, error: RequestValidationError):
    return JSONResponse(status_code=422, content=_error("DATOS_INVALIDOS", "La pregunta o el historial no tienen el formato esperado."))


@app.get("/salud")
def salud(request: Request):
    servicios = getattr(request.app.state, "servicios", None)
    if servicios is None:
        return {"estado": "incompleto", "detalle": getattr(request.app.state, "error_arranque", "sin inicializar")}
    try:
        return {"estado": "ok", "fragmentos": servicios.almacen.contar(), "modelo": servicios.cfg.gemini_modelo}
    except ServicioIAError as error:
        return {"estado": "sin_base", "detalle": error.mensaje}


@app.post("/ingestar")
def ingestar(request: Request):
    rechazo = _exigir_token(request)
    if rechazo:
        return rechazo
    return _servicios(request).almacen.ingestar_carpeta()


@app.post("/preguntar")
def preguntar(peticion: PeticionPregunta, request: Request):
    rechazo = _exigir_token(request)
    if rechazo:
        return rechazo
    historial = [m.model_dump() for m in peticion.historial]
    resultado = _servicios(request).asistente.preguntar(peticion.pregunta.strip(), historial, peticion.reranking)
    # Una línea por pregunta para poder explicar después qué pasó (sin datos personales: solo el texto de la consulta).
    log.info(
        "preguntar: mensajes_previos=%d consulta=%r respondido=%s reranking=%s puntajes=%s",
        len(historial), resultado["consulta"][:80], resultado["respondido"], resultado["reranking"],
        [f["puntaje"] for f in resultado["fragmentos"]],
    )
    return resultado
