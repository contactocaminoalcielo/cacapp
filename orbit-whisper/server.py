"""Transcripción de notas de voz — corre en el VPS, no sale nada a terceros.

Claude no oye audio: acepta texto, imágenes y PDF, y nada más. Por eso las notas
de voz de WhatsApp necesitan este paso previo.

Se eligió Whisper en el propio servidor y no un servicio externo porque lo que
viaja aquí son notas de voz de veterinarias y de familias hablando de su mascota
muerta. Eso no sale del servidor.

⚠️ Una transcripción equivocada es PEOR que ninguna: si oye "cuarenta kilos"
donde dijeron "cuatro", el agente cotiza mal y nadie se entera. Por eso:
  · el idioma va forzado a español (detectarlo en clips cortos falla y es lento);
  · se filtra el silencio, que es de donde salen las frases inventadas;
  · lo transcrito se guarda tal cual y se muestra en la bandeja, para que un
    humano pueda desmentirlo;
  · y el agente tiene instrucción de repetir las cifras y pedir confirmación
    antes de usarlas.
"""
import io
import json
import os
import re
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

MODELO = os.environ.get('WHISPER_MODELO', 'small')
HILOS = int(os.environ.get('WHISPER_HILOS', '4'))
PUERTO = int(os.environ.get('PORT', '8788'))

# Búsqueda voraz (1) en vez de la de 5 caminos que trae por defecto. En este
# servidor eso es la diferencia entre esperar el doble de lo que dura el audio y
# esperar menos de lo que dura — y sobre habla clara la transcripción sale igual.
# Se deja como variable por si algún día se prefiere pagar tiempo por acierto.
HACES = int(os.environ.get('WHISPER_HACES', '1'))

# Tope de lo que se acepta. Una nota de voz de WhatsApp dura minutos como mucho.
MAX_BYTES = 25 * 1024 * 1024

# Vocabulario del negocio. Whisper usa esto como contexto y acierta bastante más
# en los nombres de plan y en los barrios, que es justo lo que importa aquí.
CONTEXTO = (
    'Llamada a una funeraria de mascotas en Bogotá. Se habla de recogida, '
    'cremación, compostaje, cenizas, veterinaria, clínica, mascota, perro, gato, '
    'kilos, planes Básico, Standard, Compets, Exclusivo, Premium y Eco-grupal, y '
    'de barrios y municipios como Chapinero, Suba, Usaquén, Kennedy, Chía, Cota, '
    'Cajicá, Zipaquirá, Mosquera, Funza, Madrid, Soacha y Tenjo.'
)

print(f'[whisper] cargando el modelo {MODELO} ({HILOS} hilos)...', flush=True)
modelo = WhisperModel(MODELO, device='cpu', compute_type='int8', cpu_threads=HILOS)
print('[whisper] listo', flush=True)

# CTranslate2 aguanta llamadas concurrentes, pero con 6 núcleos compartidos con
# Postgres no hay nada que ganar solapando: se atiende de a una y se acaba antes.
turno = threading.Lock()


def transcribir(datos: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix='.audio', delete=True) as f:
        f.write(datos)
        f.flush()
        with turno:
            segmentos, info = modelo.transcribe(
                f.name,
                language='es',
                task='transcribe',
                beam_size=HACES,
                vad_filter=True,
                initial_prompt=CONTEXTO,
                condition_on_previous_text=False,
            )
            partes = [s.text for s in segmentos]

    texto = ' '.join(p.strip() for p in partes).strip()
    texto = re.sub(r'\s+', ' ', texto)
    return {
        'ok': bool(texto),
        'texto': texto,
        'duracion': round(getattr(info, 'duration', 0) or 0, 1),
        'idioma': getattr(info, 'language', 'es'),
    }


class Handler(BaseHTTPRequestHandler):
    def _responder(self, codigo: int, cuerpo: dict):
        crudo = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(crudo)))
        self.end_headers()
        self.wfile.write(crudo)

    def do_GET(self):
        if self.path == '/health':
            return self._responder(200, {'ok': True, 'modelo': MODELO})
        self._responder(404, {'ok': False, 'error': 'no existe'})

    def do_POST(self):
        if self.path != '/transcribir':
            return self._responder(404, {'ok': False, 'error': 'no existe'})

        largo = int(self.headers.get('Content-Length') or 0)
        if largo <= 0:
            return self._responder(400, {'ok': False, 'error': 'cuerpo vacío'})
        if largo > MAX_BYTES:
            return self._responder(413, {'ok': False, 'error': f'supera {MAX_BYTES} bytes'})

        datos = self.rfile.read(largo)
        try:
            self._responder(200, transcribir(datos))
        except Exception as e:  # noqa: BLE001 — nunca debe tumbar el servicio
            print(f'[whisper] ERROR transcribiendo — {e}', flush=True)
            self._responder(500, {'ok': False, 'error': str(e)})

    def log_message(self, formato, *args):
        # El log por defecto imprime una línea por petición con la IP; aquí no
        # aporta nada y ensucia. Los errores sí se imprimen, arriba.
        pass


if __name__ == '__main__':
    print(f'[whisper] escuchando en :{PUERTO}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', PUERTO), Handler).serve_forever()
