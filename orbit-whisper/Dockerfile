# Transcripción de notas de voz en el propio servidor.
#
# `faster-whisper` trae PyAV, que ya incluye las librerías de ffmpeg — por eso
# NO hace falta instalar ffmpeg aparte para leer el OGG/Opus de WhatsApp.
FROM python:3.11-slim

# El modelo se baja una vez y se queda en el volumen: sin esto, cada rebuild
# volvería a bajar medio giga y el arranque tardaría minutos.
ENV HF_HOME=/models \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4

WORKDIR /app

# `requests` va explícito: faster-whisper 1.1.0 lo importa en utils.py pero no
# lo declara como dependencia, así que la imagen arranca y revienta al importar.
RUN pip install --no-cache-dir "faster-whisper==1.1.0" "requests>=2.31"

COPY server.py .

EXPOSE 8788
CMD ["python", "server.py"]
