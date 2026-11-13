# Servicio pulse-ai (RAG con LangChain). Se construye con:  docker compose up -d --build
FROM python:3.12-slim

WORKDIR /srv

# Primero solo las dependencias: Docker reutiliza esta capa mientras requirements.txt no cambie.
COPY requirements-dev.txt requirements.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY pytest.ini .
COPY app ./app
COPY tests ./tests

# Sin permisos de administrador dentro del contenedor.
RUN useradd --create-home pulse
USER pulse
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
