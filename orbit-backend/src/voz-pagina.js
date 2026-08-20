// La página de laboratorio para probar la conversación por voz.
//
// Es una herramienta de banco de pruebas, NO parte de Orbit: no está en el
// menú, no tiene nada que ver con la bandeja, y se borra el día que el canal de
// voz funcione en las llamadas. Vive aquí, en el backend, para no meter ruido
// en el frontend por algo temporal.
//
// Se protege con el token de trabajos (`JOB_TOKEN`), el mismo que usan los
// crones: hace falta un secreto para abrirla. No es una pantalla de Orbit y no
// tiene sesión de usuario, así que sin eso quedaría abierta a cualquiera que
// adivine la ruta — y detrás hay un micrófono y una llave de pago.

export function paginaDePrueba(token) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voz — banco de pruebas</title>
<style>
  :root { color-scheme: light }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 680px; margin: 0 auto;
         padding: 24px; color: #1a1a1a; background: #fafafa }
  h1 { font-size: 19px; margin: 0 0 4px }
  p.sub { color: #666; font-size: 13px; margin: 0 0 20px }
  button { font: inherit; font-weight: 600; padding: 12px 22px; border-radius: 10px;
           border: 0; background: #1A5CD8; color: #fff; cursor: pointer }
  button:disabled { opacity: .5; cursor: default }
  button.parar { background: #b91c1c }
  #estado { margin: 16px 0; padding: 12px 14px; border-radius: 10px; background: #fff;
            border: 1px solid #e5e5e5; font-size: 14px }
  .turno { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px;
           padding: 14px; margin-bottom: 10px }
  .yo { color: #444 } .yo b { color: #000 }
  .el { color: #0b5c2e; margin-top: 6px } .el b { color: #063d1e }
  .ms { margin-top: 10px; font-size: 12px; color: #666; font-variant-numeric: tabular-nums }
  .ms span { display: inline-block; margin-right: 12px }
  .clave { color: #b91c1c; font-weight: 700 }
  .nivel { height: 6px; background: #e5e5e5; border-radius: 3px; overflow: hidden; margin-top: 10px }
  .nivel i { display: block; height: 100%; background: #1A5CD8; width: 0 }
</style></head><body>
<h1>Banco de pruebas de voz</h1>
<p class="sub">Habla y calla. Detecta el silencio, transcribe, piensa y te contesta hablando.
Lo que importa es el <b>silencio real</b>: lo que esperarías tú al teléfono.</p>

<button id="btn">Empezar a hablar</button>
<div class="nivel"><i id="nivel"></i></div>
<div id="estado">Listo.</div>
<div id="hilo"></div>

<script>
const TOKEN = ${JSON.stringify(token)};
const SILENCIO_MS = 800;      // cuánto callas para que se considere que terminaste
const UMBRAL = 0.012;         // por debajo de esto se considera silencio
let grabadora, trozos = [], ctx, analizador, temporizador, hablando = false, historial = [];
let relleno = [], iRelleno = 0, sonandoRelleno = null;

// Las muletillas se bajan UNA vez al abrir. Sonarlas al instante es lo que
// convierte una espera de tres segundos en una conversacion normal.
fetch('relleno?t=' + encodeURIComponent(TOKEN)).then(r => r.json())
  .then(d => { relleno = d.frases || []; })
  .catch(() => {});

function sonarRelleno() {
  if (!relleno.length) return;
  const f = relleno[iRelleno++ % relleno.length];
  sonandoRelleno = new Audio('data:audio/mpeg;base64,' + f.audio);
  sonandoRelleno.play().catch(() => {});
}

const $ = id => document.getElementById(id);
const estado = t => $('estado').textContent = t;

$('btn').onclick = () => hablando ? parar(true) : arrancar();

async function arrancar() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  ctx = new AudioContext();
  const fuente = ctx.createMediaStreamSource(stream);
  analizador = ctx.createAnalyser();
  analizador.fftSize = 512;
  fuente.connect(analizador);

  grabadora = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  trozos = [];
  grabadora.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
  grabadora.onstop = enviar;
  grabadora.start();
  hablando = true;
  $('btn').textContent = 'Parar';
  $('btn').className = 'parar';
  estado('Escuchando… habla y luego calla.');
  vigilarSilencio();
}

// El corte lo decide el navegador midiendo el volumen. En la llamada real esto
// lo hará el servidor, pero la regla es la misma y aquí se puede afinar en
// segundos en vez de encendiendo el botón de Meta cada vez.
function vigilarSilencio() {
  const datos = new Uint8Array(analizador.fftSize);
  let desdeCuando = null, huboVoz = false;
  const mirar = () => {
    if (!hablando) return;
    analizador.getByteTimeDomainData(datos);
    let suma = 0;
    for (const v of datos) { const x = (v - 128) / 128; suma += x * x; }
    const nivel = Math.sqrt(suma / datos.length);
    $('nivel').style.width = Math.min(100, nivel * 800) + '%';

    if (nivel > UMBRAL) { huboVoz = true; desdeCuando = null; }
    else if (huboVoz) {
      desdeCuando ??= performance.now();
      if (performance.now() - desdeCuando > SILENCIO_MS) return parar(false);
    }
    requestAnimationFrame(mirar);
  };
  mirar();
}

function parar(manual) {
  if (!hablando) return;
  hablando = false;
  $('btn').textContent = 'Empezar a hablar';
  $('btn').className = '';
  $('nivel').style.width = '0';
  estado(manual ? 'Detenido.' : 'Te callaste. Procesando…');
  // El relleno arranca AQUI, antes de mandar nada: es todo el truco.
  if (!manual) sonarRelleno();
  try { grabadora.stop(); grabadora.stream.getTracks().forEach(t => t.stop()); } catch {}
  try { ctx.close(); } catch {}
}

async function enviar() {
  if (!trozos.length) return estado('No se grabó nada.');
  const blob = new Blob(trozos, { type: 'audio/webm' });
  const b64 = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => { const t = String(fr.result); r(t.slice(t.indexOf(',') + 1)); };
    fr.readAsDataURL(blob);
  });

  // Ruta RELATIVA: la pagina se sirve tras el prefijo /api/ (nginx lo quita
  // antes de llegar al backend). Una ruta absoluta /voz/turno se iria a la raiz
  // del dominio, que es el frontend, y daria un 404 desconcertante.
  const t0 = performance.now();
  const r = await fetch('turno?t=' + encodeURIComponent(TOKEN), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: b64, historial }),
  });
  const d = await r.json();
  const ida = Math.round(performance.now() - t0);

  if (d.error) return estado('Error: ' + d.error);

  historial.push({ role: 'user', content: d.transcripcion });
  historial.push({ role: 'assistant', content: d.respuesta });

  const m = d.tiempos;
  $('hilo').insertAdjacentHTML('afterbegin',
    '<div class="turno">' +
      '<div class="yo"><b>Tú:</b> ' + escapar(d.transcripcion) + '</div>' +
      '<div class="el"><b>Agente:</b> ' + escapar(d.respuesta) + '</div>' +
      '<div class="ms">' +
        '<span>oír <b>' + m.transcribir + '</b> ms</span>' +
        '<span>pensar <b>' + m.pensar + '</b> ms (1ª frase ' + m.primeraFrase + ')</span>' +
        '<span>hablar <b>' + m.hablar + '</b> ms</span>' +
        '<span class="clave">silencio real ' + m.silencioReal + ' ms</span>' +
        '<span>ida y vuelta ' + ida + ' ms</span>' +
      '</div>' +
    '</div>');

  estado('Contestando…');
  // Si la muletilla sigue sonando, se corta: la respuesta manda.
  try { sonandoRelleno?.pause(); } catch {}
  const audio = new Audio('data:audio/mpeg;base64,' + d.audio);
  audio.onended = () => { estado('Listo. Pulsa para hablar otra vez.'); };
  audio.play();
}

const escapar = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
</script></body></html>`
}
