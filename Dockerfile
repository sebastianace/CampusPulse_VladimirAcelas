# Imagen de Campus Pulse. Se construye con:  docker compose up -d --build
FROM node:24-slim

WORKDIR /app

# Primero solo las dependencias: así Docker reutiliza esta capa mientras package.json no cambie.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Solo lo que el servidor necesita (ver .dockerignore): nada de .env ni de datos locales.
COPY src ./src
COPY public ./public
COPY db ./db
COPY data/raw ./data/raw
COPY data/seed ./data/seed

# Sin permisos de administrador dentro del contenedor.
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
