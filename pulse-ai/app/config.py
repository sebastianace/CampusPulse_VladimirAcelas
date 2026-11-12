"""Configuración de pulse-ai. Todo sale de variables de entorno (en Docker las pone compose.yaml)."""

import os
from dataclasses import dataclass, field


def _entero(nombre: str, defecto: int) -> int:
    return int(os.getenv(nombre, str(defecto)))


@dataclass(frozen=True)
class Config:
    # --- base de datos (la misma PostgreSQL de Campus Pulse) ---
    pg_host: str = field(default_factory=lambda: os.getenv("POSTGRES_HOST", "localhost"))
    pg_puerto: int = field(default_factory=lambda: _entero("POSTGRES_PUERTO", 5433))
    pg_usuario: str = field(default_factory=lambda: os.getenv("POSTGRES_USER", "campus"))
    pg_clave: str = field(default_factory=lambda: os.getenv("POSTGRES_PASSWORD", ""))
    pg_base: str = field(default_factory=lambda: os.getenv("POSTGRES_DB", "campus_pulse"))

    # --- Gemini ---
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    gemini_modelo: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", ""))
    # Mismo modelo y mismas dimensiones que usa Node para las incidencias parecidas.
    modelo_embeddings: str = "models/gemini-embedding-001"
    dimensiones: int = 768

    # --- conocimiento ---
    carpeta_conocimiento: str = field(default_factory=lambda: os.getenv("CONOCIMIENTO_DIR", "/srv/knowledge"))
    tabla: str = field(default_factory=lambda: os.getenv("CONOCIMIENTO_TABLA", "conocimiento"))

    # --- recuperación ---
    # Fragmentos que se pasan a Gemini (el plan pide 4).
    k_final: int = field(default_factory=lambda: _entero("RAG_K_FINAL", 4))
    # Fragmentos que se traen de la base antes de reordenarlos (solo cuando hay reranking).
    k_candidatos: int = field(default_factory=lambda: _entero("RAG_K_CANDIDATOS", 8))
    # Reranking activado por defecto. Se puede apagar por petición para comparar (docs/evaluacion-rag.md).
    reranking: bool = field(default_factory=lambda: os.getenv("RAG_RERANKING", "1") != "0")
    # Puntaje (0 a 10) que debe tener el mejor fragmento tras el reranking; si ninguno lo alcanza,
    # Pulse dice que no lo sabe sin gastar la llamada que redacta la respuesta.
    puntaje_minimo: int = field(default_factory=lambda: _entero("RAG_PUNTAJE_MINIMO", 4))

    # --- seguridad ---
    # Si se define, las peticiones deben traer la cabecera X-Pulse-Token con este valor.
    token: str = field(default_factory=lambda: os.getenv("PULSE_AI_TOKEN", ""))

    # Cuántos mensajes anteriores se tienen en cuenta (memoria corta de la conversación).
    max_historial: int = 6
    max_caracteres_pregunta: int = 1000


def cargar_config() -> Config:
    return Config()
