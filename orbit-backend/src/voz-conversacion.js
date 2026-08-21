// El bucle de conversación por voz: oír → entender → contestar hablando.
//
// Se prueba desde una página del navegador ANTES de meterlo en una llamada. En
// una llamada, cada intento cuesta encender el botón para 203 clínicas, esperar
// a que alguien marque y leer el registro. Aquí se itera en segundos, y lo que
// se mide es exactamente lo mismo.
//
// 🩸 LO QUE SE VIENE A MEDIR es dónde se va el tiempo. Ya sabemos por separado
// que Claude tarda ~1,65 s en la primera frase (sin razonamiento) y que
// ElevenLabs empieza a sonar en ~250 ms. Lo que falta es el trozo desconocido:
// **cuánto tarda Whisper**, y cuánto suma pegarlo todo. Por eso cada etapa se
// cronometra por separado y se devuelve: un total no dice dónde recortar.
//
// ⚠️ El cerebro va SIN RAZONAMIENTO a propósito. Está medido: con razonamiento
// adaptativo no sale ni una palabra hasta los 6 segundos. En el chat eso es
// justo lo que se quiere; en voz es inaceptable.
import { log } from './db.js'
import { construirSistema } from './agente-wa.js'
import { sintetizar, siguienteFrase } from './voz.js'

const MOD = '[voz-conv]'
const WHISPER = process.env.WHISPER_URL || 'http://orbit-whisper:8788'

/**
 * Pasa lo que graba el navegador a algo que Whisper entienda seguro.
 *
 * Chrome graba `audio/webm`. El servicio de Whisper NO tiene ffmpeg dentro
 * (comprobado), así que convertir aquí —donde sí está— quita una incógnita:
 * si algún día falla la transcripción, no será por el envase.
 */
async function aWav(audio) {
  const { execFile } = await import('node:child_process')
  const { writeFile, readFile, unlink } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const sello = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ent = join(tmpdir(), `oir-${sello}.in`)
  const sal = join(tmpdir(), `oir-${sello}.wav`)
  try {
    await writeFile(ent, audio)
    await new Promise((ok, mal) => execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', ent,
      // 16 kHz mono es lo que come Whisper. Más resolución no mejora nada y
      // pesa el triple, que en una llamada es latencia.
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', sal,
    ], { timeout: 30_000 }, e => e ? mal(e) : ok()))
    return await readFile(sal)
  } finally {
    unlink(ent).catch(() => {})
    unlink(sal).catch(() => {})
  }
}

/** Lo que dijo quien habla, con el WAV ya listo. */
async function transcribirWav(wav) {
  // `rapido=1`: el modelo pequeño. Medido en este servidor con 5,76 s de audio,
  // `base` tarda 2,2 s y `medium` 14,8 — y transcribieron EXACTAMENTE lo mismo.
  // Las notas de voz de WhatsApp siguen yendo por el grande, que es donde la
  // calidad importa y nadie está esperando.
  const r = await fetch(`${WHISPER}/transcribir?rapido=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: wav,
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok || !out.ok || !out.texto) {
    return { error: out.error || (r.ok ? 'no se entendió nada' : `Whisper devolvió ${r.status}`) }
  }
  return { texto: String(out.texto).trim(), duracion: out.duracion }
}

/** Lo mismo, pero convirtiendo antes (lo que graba un navegador). */
async function transcribir(audio) {
  return transcribirWav(await aWav(audio))
}

/**
 * ¿Lo que devolvió Whisper es algo que dijeron, o es Whisper rellenando?
 *
 * 🩸 WHISPER NO DEVUELVE VACÍO CON EL SILENCIO: devuelve una muletilla de
 * subtítulos —"Gracias.", "Subtítulos realizados por..."— y normalmente
 * repetida. En la llamada del 2026-08-20 eso hizo que el agente contestara
 * "de nada, con gusto" a veinte segundos de ruido de fondo, y que quien llamaba
 * oyera una respuesta a algo que no había dicho. Callarse es mucho mejor.
 *
 * `msAudio` es la clave para no pasarse de listo: "gracias" a secas SÍ es una
 * frase real cuando dura un segundo. Lo que no existe es alguien que tarde
 * cuatro segundos en decir solo "gracias" — eso es silencio con relleno.
 */
const RELLENOS_DE_WHISPER = new Set([
  'gracias',
  'muchas gracias',
  'gracias por ver el video',
  'gracias por ver este video',
  'subtitulos realizados por la comunidad de amara org',
  'subtitulado por la comunidad de amara org',
  'subtitulos por la comunidad de amara org',
  'amara org',
  'www youtube com',
  'continuara',
])

function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sin tildes
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function esRuido(texto, msAudio = null) {
  const limpio = normalizar(texto)
  if (!limpio) return true

  // La firma más fiable: la MISMA frase corta repetida. Nadie habla así.
  const frases = String(texto).split(/[.!?…]+/).map(normalizar).filter(Boolean)
  if (frases.length >= 3 && new Set(frases).size === 1 && frases[0].split(' ').length <= 4) return true

  if (!RELLENOS_DE_WHISPER.has(limpio)) return false
  // Está en la lista: solo cuenta como ruido si el audio era largo. Un
  // "gracias" de verdad ocupa un segundo, no cuatro.
  return msAudio === null || msAudio > 4000
}

/**
 * La respuesta del agente, en modo VOZ.
 *
 * Devuelve la primera frase en cuanto está, no al terminar: con ella ya se
 * puede empezar a sintetizar mientras el modelo sigue escribiendo. Ese solape
 * es lo que convierte "1,65 s + 250 ms" en algo cercano a 1,65 s.
 *
 * Sin herramientas en esta versión: se está midiendo el suelo de latencia. Cada
 * herramienta que el modelo quiera usar añade una vuelta entera, y eso hay que
 * medirlo aparte y a conciencia, no mezclado con esto.
 */
async function pensar({ agente, historial, dicho, alPrimeraFrase = null }) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const cliente = new Anthropic({ apiKey: process.env.CLAUDE_KEY })
  const system = await construirSistema(agente)

  const t0 = Date.now()
  let texto = '', pendiente = '', primeraFrase = null

  const stream = await cliente.messages.create({
    model: agente.modelo || 'claude-sonnet-5',
    max_tokens: 400,
    // Sin razonar: medido, con razonamiento no emite nada hasta el final.
    thinking: { type: 'disabled' },
    system: [
      ...system,
      {
        type: 'text',
        text: 'ESTÁS HABLANDO POR TELÉFONO, no escribiendo. Frases cortas y '
          + 'naturales, como se habla. Nada de listas, viñetas, asteriscos ni '
          + 'enlaces: nada de eso se puede pronunciar. Si tienes que dar un '
          + 'dato largo, dilo despacio y ofrece repetirlo. Y responde a lo que '
          + 'te preguntaron, sin rodeos: quien llama está esperando en silencio.',
      },
    ],
    messages: [...historial, { role: 'user', content: dicho }],
    stream: true,
  })

  for await (const ev of stream) {
    if (ev.type !== 'content_block_delta' || ev.delta?.type !== 'text_delta') continue
    texto += ev.delta.text
    pendiente += ev.delta.text
    if (primeraFrase === null) {
      const [frase] = siguienteFrase(pendiente)
      if (frase) {
        primeraFrase = { texto: frase, ms: Date.now() - t0 }
        alPrimeraFrase?.(primeraFrase)
      }
    }
  }

  return { texto: texto.trim(), primeraFrase, ms: Date.now() - t0 }
}

/**
 * Las frases de relleno, ya convertidas en audio y guardadas en memoria.
 *
 * 🩸 ESTO ES LO QUE HACE QUE NO SE SIENTA LENTO. Aunque recortemos cada etapa,
 * siempre habrá dos o tres segundos entre que la persona calla y el agente
 * tiene algo que decir. Un silencio de tres segundos al teléfono es una
 * conversación rota; un "claro, déjame revisar" a los 200 ms es una
 * conversación normal.
 *
 * Se sintetizan UNA vez y se reutilizan: son fijas, así que pagar 150 ms de
 * síntesis en cada turno sería tirar justo el tiempo que se quiere ahorrar.
 * Van varias y se rotan — oír siempre la misma muletilla delata a la máquina
 * más que el silencio.
 */
const FRASES_RELLENO = [
  'Claro, déjame revisar.',
  'Un momento, por favor.',
  'Con mucho gusto, ya te digo.',
]
const rellenoCache = new Map()

export async function rellenos(agente) {
  const clave = `${agente.voz_id}|${agente.voz_modelo}`
  if (rellenoCache.has(clave)) return rellenoCache.get(clave)

  const audios = []
  for (const texto of FRASES_RELLENO) {
    const v = await sintetizar({ agente, texto })
    if (!v.error) audios.push({ texto, audio: v.audio.toString('base64') })
  }
  if (audios.length) {
    rellenoCache.set(clave, audios)
    log(MOD, `relleno listo: ${audios.length} frase(s) pregeneradas`)
  }
  return audios
}

/**
 * Envuelve PCM crudo en una cabecera WAV.
 *
 * En una LLAMADA el audio ya llega descodificado, así que pasarlo por ffmpeg
 * sería gastar 50-100 ms en reempaquetar lo que ya está listo. La cabecera WAV
 * son 44 bytes y se escribe aquí.
 */
export function wavDePcm(pcm, hz = 48000) {
  const c = Buffer.alloc(44)
  c.write('RIFF', 0); c.writeUInt32LE(36 + pcm.length, 4); c.write('WAVE', 8)
  c.write('fmt ', 12); c.writeUInt32LE(16, 16); c.writeUInt16LE(1, 20)
  c.writeUInt16LE(1, 22)                      // mono
  c.writeUInt32LE(hz, 24)
  c.writeUInt32LE(hz * 2, 28)                 // bytes por segundo
  c.writeUInt16LE(2, 32); c.writeUInt16LE(16, 34)
  c.write('data', 36); c.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([c, pcm])
}

/**
 * Un turno completo: audio entra, audio sale, con el reloj de cada etapa.
 *
 * `historial` es la conversación hasta ahora, en el formato de la API. Vive en
 * el cliente a propósito: esto es un laboratorio, y no quiero que una prueba
 * ensucie la bandeja ni la bitácora del agente de verdad.
 */
export async function turno({ agente, audio, wav = null, historial = [], msAudio = null }) {
  const t0 = Date.now()
  const tiempos = {}

  const tOir = Date.now()
  // Con `wav` ya hecho (una llamada) se salta la conversión: el audio venía
  // descodificado y volver a pasarlo por ffmpeg sería tiempo tirado.
  const oido = wav ? await transcribirWav(wav) : await transcribir(audio)
  tiempos.transcribir = Date.now() - tOir
  // Cuánto audio se le dio y cuánto tardó: sin los dos números, un "oír 53 s"
  // no dice si el audio era larguísimo o si Whisper estaba atascado. Pasó, y no
  // se pudo decidir con el registro que había.
  tiempos.audio = msAudio ?? (oido.duracion ? Math.round(oido.duracion * 1000) : null)
  if (oido.error) return { error: oido.error, tiempos }

  if (esRuido(oido.texto, tiempos.audio)) {
    log(MOD, `ruido, no una frase: "${oido.texto}" (${tiempos.audio} ms de audio)`)
    return { ruido: true, transcripcion: oido.texto, tiempos }
  }

  const tPensar = Date.now()
  const pensado = await pensar({ agente, historial, dicho: oido.texto })
  tiempos.pensar = Date.now() - tPensar
  tiempos.primeraFrase = pensado.primeraFrase?.ms ?? null
  if (!pensado.texto) return { error: 'el agente no dijo nada', tiempos }

  const tHablar = Date.now()
  const voz = await sintetizar({ agente, texto: pensado.texto })
  tiempos.hablar = Date.now() - tHablar
  tiempos.primerSonido = voz.primerByte ?? null
  if (voz.error) return { error: voz.error, transcripcion: oido.texto, respuesta: pensado.texto, tiempos }

  tiempos.total = Date.now() - t0
  // Lo que de verdad sentiría quien llama si encadenáramos las etapas: el
  // agente puede empezar a hablar en cuanto tiene la PRIMERA FRASE, no cuando
  // termina de escribirlo todo.
  tiempos.silencioReal = tiempos.transcribir + (tiempos.primeraFrase ?? tiempos.pensar) + (tiempos.primerSonido ?? 0)

  log(MOD, `turno: ${tiempos.audio ?? '?'}ms de audio · oír ${tiempos.transcribir}ms · pensar ${tiempos.pensar}ms`
    + ` (1ª frase ${tiempos.primeraFrase}ms) · hablar ${tiempos.hablar}ms`
    + ` → silencio real ${tiempos.silencioReal}ms`)

  return {
    transcripcion: oido.texto,
    respuesta: pensado.texto,
    audio: voz.audio.toString('base64'),
    tiempos,
  }
}
