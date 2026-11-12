"""Tipos compartidos del servicio."""

from dataclasses import asdict, dataclass
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .prompts import AREAS

AreaLiteral = Literal["Infraestructura", "Soporte TI", "Servicios generales", "Seguridad", "Bienestar"]
assert list(AreaLiteral.__args__) == AREAS  # type: ignore[attr-defined]


class ServicioIAError(Exception):
    """Gemini o la base de datos no respondieron. La API la traduce a 503."""

    def __init__(self, mensaje: str):
        super().__init__(mensaje)
        self.mensaje = mensaje


@dataclass
class Fragmento:
    texto: str
    documento: str
    seccion: str
    archivo: str
    ejemplo: bool = False
    similitud: float = 0.0          # 1 - distancia coseno (0 a 1; más alto = más parecido)
    puntaje: Optional[float] = None  # 0 a 10, solo si hubo reranking
    usado: bool = False             # True si la respuesta se apoyó en este fragmento

    def como_dict(self) -> dict:
        d = asdict(self)
        d["similitud"] = round(self.similitud, 4)
        return d


# ---- esquemas que Gemini debe cumplir (salida estructurada) ----

class PreguntaReformulada(BaseModel):
    # El modelo primero DECIDE si la pregunta necesita la conversación y solo entonces la reescribe.
    # Sin esta decisión explícita, un modelo pequeño tiende a mezclar temas distintos (ver docs/rag.md).
    depende_del_historial: bool
    pregunta: str


class PuntajeFragmento(BaseModel):
    numero: int
    puntaje: int = Field(ge=0, le=10)


class Puntajes(BaseModel):
    puntajes: list[PuntajeFragmento]


class SalidaRespuesta(BaseModel):
    respondido: bool
    respuesta: str
    fragmentos_usados: list[int]
    area_sugerida: Optional[AreaLiteral] = None


# ---- cuerpos de la API ----

class Mensaje(BaseModel):
    rol: Literal["usuario", "pulse"]
    texto: str = Field(min_length=1, max_length=1000)


class PeticionPregunta(BaseModel):
    pregunta: str = Field(min_length=1, max_length=1000)
    historial: list[Mensaje] = Field(default_factory=list, max_length=20)
    # None = usar el valor por defecto del servicio; True/False permite comparar con y sin reranking.
    reranking: Optional[bool] = None
