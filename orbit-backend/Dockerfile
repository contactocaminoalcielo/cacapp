# Base Debian (no Alpine): Remotion usa un Chromium headless que necesita glibc.
FROM node:22-bookworm-slim
WORKDIR /app

# Librerías del sistema que requiere el Chromium headless de Remotion.
# `ffmpeg` es aparte: reenvasa las notas de voz de webm a ogg (mismo códec
# Opus, `-c:a copy`), que es lo único que WhatsApp acepta como nota de voz.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
      libatspi2.0-0 fonts-liberation fonts-noto-color-emoji ca-certificates \
      ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY memorial ./memorial
COPY scripts ./scripts

# Descarga el Chromium headless de Remotion en build (evita bajarlo en el 1er render).
RUN node memorial/ensure-browser.mjs || true

ENV NODE_ENV=production
ENV MEMORIAL_DATA_DIR=/data/memoriales
RUN mkdir -p /data/memoriales
EXPOSE 8787
CMD ["node", "src/index.js"]
