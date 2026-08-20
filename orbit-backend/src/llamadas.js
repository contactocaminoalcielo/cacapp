// Contestar llamadas de WhatsApp (WebRTC).
//
// 🩸 PRIMER HITO, A PROPÓSITO MODESTO: contesta y dice UNA FRASE. Nada de
// conversación todavía. Si esa voz se oye en el teléfono, significa que lo
// difícil —negociar ICE, DTLS, SRTP y Opus con Meta— está resuelto, y lo demás
// es construir encima. Si no se oye, mejor descubrirlo con un saludo que con el
// agente entero montado.
//
// ── Lo que se sabe del tráfico REAL (capturado el 2026-08-19, no de manual) ──
//
//   · Meta anuncia `a=ice-lite`: NO hace comprobaciones de conectividad. El
//     agente ICE completo tiene que ser el nuestro.
//   · Sus candidatos son `typ host` con IP pública (57.144.85.49). Como este
//     servidor también tiene IP pública, **no hace falta un servidor TURN**.
//   · `UDP/TLS/RTP/SAVPF`, códec 111 (Opus) con `a=fingerprint:sha-256`.
//
// ⚠️ DOS TRAMPAS DE ENTORNO, y las dos matan el audio en silencio:
//
//   1. Dentro de Docker, la librería anunciaría la IP privada del contenedor
//      (172.x). Meta no puede alcanzarla y la llamada se conecta pero no suena.
//      Por eso `iceAdditionalHostAddresses` con la IP pública.
//   2. Los puertos UDP tienen que estar abiertos en el cortafuegos Y mapeados
//      en docker-compose. Por eso `icePortRange` es un rango fijo y pequeño:
//      un rango dinámico no se puede mapear.
import { log } from './db.js'
import { sintetizar } from './voz.js'

const MOD = '[llamadas]'
const GRAPH = 'https://graph.facebook.com'

/** El rango abierto en el cortafuegos y mapeado en docker-compose. */
const PUERTOS = [
  parseInt(process.env.VOZ_PUERTO_MIN || '40000', 10),
  parseInt(process.env.VOZ_PUERTO_MAX || '40019', 10),
]

/** La IP por la que Meta puede alcanzarnos. Sin esto se anuncia la de Docker. */
const IP_PUBLICA = process.env.VOZ_IP_PUBLICA || null

const version = () => process.env.WHATSAPP_API_VERSION || 'v26.0'

/**
 * Una acción sobre la llamada: `pre_accept`, `accept`, `reject`, `terminate`.
 *
 * `pre_accept` antes de `accept` no es opcional en la práctica: Meta lo
 * recomienda porque prepara el canal, y sin él se pierde el principio del audio
 * — que en una llamada es justo el saludo.
 */
async function accionLlamada({ phoneNumberId, callId, accion, sdp = null }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const cuerpo = {
    messaging_product: 'whatsapp',
    call_id: callId,
    action: accion,
    ...(sdp ? { session: { sdp_type: 'answer', sdp } } : {}),
  }
  const r = await fetch(`${GRAPH}/${version()}/${phoneNumberId}/calls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.error) {
    const e = data?.error || {}
    return { error: e.error_user_msg || e.message || `Error ${r.status}` }
  }
  return { ok: true, data }
}

/**
 * Espera a que ICE termine de reunir candidatos.
 *
 * Hace falta porque Meta es `ice-lite` y no va a buscarnos: la respuesta SDP
 * tiene que llevar YA nuestros candidatos. Mandarla antes de tiempo produce una
 * llamada que se "conecta" y no suena nunca.
 */
function esperarCandidatos(pc, tope = 3000) {
  return new Promise(resolver => {
    if (pc.iceGatheringState === 'complete') return resolver()
    const fin = setTimeout(resolver, tope)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(fin); resolver() }
    }
  })
}

/**
 * Convierte audio a paquetes Opus de 20 ms, que es lo que come RTP.
 *
 * Se usa ffmpeg —ya está en la imagen por las notas de voz— para pasar a
 * Ogg/Opus, y luego se parten las páginas Ogg en sus paquetes. No se recodifica
 * nada más de lo necesario.
 */
async function aPaquetesOpus(audio) {
  const { execFile } = await import('node:child_process')
  const { writeFile, readFile, unlink } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  const sello = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ent = join(tmpdir(), `voz-${sello}.in`)
  const sal = join(tmpdir(), `voz-${sello}.ogg`)
  try {
    await writeFile(ent, audio)
    await new Promise((ok, mal) => execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', ent,
      // 48 kHz mono y tramas de 20 ms: lo que espera WebRTC.
      '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1',
      '-frame_duration', '20', '-f', 'ogg', sal,
    ], { timeout: 30_000 }, e => e ? mal(e) : ok()))
    return paquetesDeOgg(await readFile(sal))
  } finally {
    unlink(ent).catch(() => {})
    unlink(sal).catch(() => {})
  }
}

/**
 * Saca los paquetes Opus de un contenedor Ogg.
 *
 * Un Ogg es una cadena de páginas: cabecera "OggS", una tabla que dice cuánto
 * mide cada segmento, y los datos. Las dos primeras páginas son metadatos de
 * Opus (`OpusHead` y `OpusTags`) y NO son audio — colarlas produce un chasquido
 * al principio.
 */
function paquetesDeOgg(buf) {
  const paquetes = []
  let i = 0
  while (i + 27 <= buf.length) {
    if (buf.toString('latin1', i, i + 4) !== 'OggS') break
    const nSegmentos = buf[i + 26]
    const tabla = buf.subarray(i + 27, i + 27 + nSegmentos)
    let datos = i + 27 + nSegmentos
    let actual = []
    for (const largo of tabla) {
      actual.push(buf.subarray(datos, datos + largo))
      datos += largo
      // Un segmento de menos de 255 cierra el paquete.
      if (largo < 255) {
        const p = Buffer.concat(actual)
        actual = []
        const cabecera = p.toString('latin1', 0, 8)
        if (p.length && cabecera !== 'OpusHead' && cabecera !== 'OpusTags') paquetes.push(p)
      }
    }
    i = datos
  }
  return paquetes
}

/**
 * Qué número de carga útil usa Opus en ESTA llamada.
 *
 * Se lee de la oferta en vez de fijar 111: es lo habitual, pero es una
 * negociación y darlo por hecho es de las cosas que fallan el día que cambia,
 * sin dar ninguna pista de por qué no se oye nada.
 */
function tipoDeCargaOpus(sdpOffer) {
  const m = /a=rtpmap:(\d+)\s+opus\/48000/i.exec(String(sdpOffer || ''))
  return m ? parseInt(m[1], 10) : 111
}

/**
 * Manda el audio al ritmo real: una trama de 20 ms cada 20 ms.
 *
 * 🩸 Aquí estaba el fallo del primer intento: `writeRtp` NO recibe el audio
 * crudo, recibe un PAQUETE RTP. Pasarle el Opus pelado revienta con "Attempt to
 * access memory outside buffer bounds" — un error que no menciona RTP por
 * ninguna parte y manda a buscar en el sitio equivocado.
 *
 * Dos detalles que no son adorno:
 *  · El reloj va por PLAZOS ABSOLUTOS y no sumando esperas de 20 ms. Cada
 *    vuelta tarda algo más de 20 (serializar, cifrar), y ese exceso se acumula:
 *    en cinco segundos de audio la voz se arrastra y suena rara.
 *  · La marca de tiempo sube de 960 en 960, que son 20 ms a 48 kHz. Es lo que
 *    usa el receptor para ordenar y espaciar el audio; si va mal, se oye
 *    entrecortado aunque los paquetes lleguen todos.
 */
async function reproducir(track, paquetes, tipoCarga) {
  const { RtpPacket, RtpHeader } = await import('werift')
  const ssrc = Math.floor(Math.random() * 0xffffffff)
  let secuencia = Math.floor(Math.random() * 0xffff)
  let marca = Math.floor(Math.random() * 0xffffffff)
  const inicio = Date.now()

  for (let i = 0; i < paquetes.length; i++) {
    const cabecera = new RtpHeader({
      payloadType: tipoCarga,
      sequenceNumber: secuencia,
      timestamp: marca,
      ssrc,
      marker: i === 0,
    })
    track.writeRtp(new RtpPacket(cabecera, paquetes[i]))

    secuencia = (secuencia + 1) & 0xffff
    marca = (marca + 960) >>> 0

    const cuandoToca = inicio + (i + 1) * 20
    const esperar = cuandoToca - Date.now()
    if (esperar > 0) await new Promise(r => setTimeout(r, esperar))
  }
}

/**
 * Contesta una llamada entrante y dice una frase.
 *
 * Devuelve deprisa: Meta da entre 30 y 60 segundos desde el webhook para
 * aceptar, pero el webhook en sí tiene que responder 200 en menos de 5 — así
 * que quien llama a esto NO debe esperarlo.
 */
export async function contestarConFrase({ phoneNumberId, callId, sdpOffer, agente, texto }) {
  const t0 = Date.now()
  let pc = null
  try {
    const { RTCPeerConnection, MediaStreamTrack, useOPUS } = await import('werift')

    pc = new RTCPeerConnection({
      codecs: { audio: [useOPUS()] },
      icePortRange: PUERTOS,
      ...(IP_PUBLICA ? { iceAdditionalHostAddresses: [IP_PUBLICA] } : {}),
    })

    const track = new MediaStreamTrack({ kind: 'audio' })
    pc.addTransceiver(track, { direction: 'sendrecv' })

    await pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer })
    const respuesta = await pc.createAnswer()
    await pc.setLocalDescription(respuesta)
    await esperarCandidatos(pc)

    const sdp = pc.localDescription.sdp
    log(MOD, `${callId}: respuesta SDP lista (${Date.now() - t0} ms)`)

    // La voz se prepara EN PARALELO con la negociación: son las dos cosas
    // lentas y hacerlas en serie sumaría los dos tiempos.
    const vozPromesa = sintetizar({ agente, texto, formato: 'mp3_22050_32' })

    const pre = await accionLlamada({ phoneNumberId, callId, accion: 'pre_accept', sdp })
    if (pre.error) return log(MOD, `${callId}: pre_accept falló — ${pre.error}`)

    const acc = await accionLlamada({ phoneNumberId, callId, accion: 'accept', sdp })
    if (acc.error) return log(MOD, `${callId}: accept falló — ${acc.error}`)
    log(MOD, `${callId}: ACEPTADA (${Date.now() - t0} ms)`)

    const voz = await vozPromesa
    if (voz.error) {
      log(MOD, `${callId}: sin voz — ${voz.error}`)
      await accionLlamada({ phoneNumberId, callId, accion: 'terminate' })
      return
    }

    const paquetes = await aPaquetesOpus(voz.audio)
    const tipoCarga = tipoDeCargaOpus(sdpOffer)
    log(MOD, `${callId}: hablando — ${paquetes.length} tramas (${paquetes.length * 20} ms), carga ${tipoCarga}`)
    await reproducir(track, paquetes, tipoCarga)

    // Un respiro antes de colgar: cortar en la última sílaba se oye como si se
    // hubiera caído la llamada.
    await new Promise(r => setTimeout(r, 700))
    await accionLlamada({ phoneNumberId, callId, accion: 'terminate' })
    log(MOD, `${callId}: colgada (${Date.now() - t0} ms en total)`)
  } catch (e) {
    log(MOD, `${callId}: ERROR — ${e.message}`)
    await accionLlamada({ phoneNumberId, callId, accion: 'terminate' }).catch(() => {})
  } finally {
    try { pc?.close() } catch { /* ya estaba cerrada */ }
  }
}

/**
 * El oído de la llamada: escucha, decide cuándo terminaste de hablar y avisa.
 *
 * 🩸 ESTA ES LA PIEZA QUE HACE QUE UN AGENTE DE VOZ SE SIENTA HUMANO O
 * INSOPORTABLE. No es reconocer la voz —de eso se encarga Whisper— sino algo
 * más tonto y más difícil: distinguir una pausa para respirar de un "ya
 * terminé, contéstame".
 *
 *   · Si corta pronto, interrumpe a media frase y la clínica se enfada.
 *   · Si corta tarde, la conversación se arrastra y parece lento.
 *
 * Se hace sobre el audio ya descodificado, midiendo energía. Es lo mismo que
 * hace la página de pruebas en el navegador, pero aquí lo hacemos nosotros
 * porque en una llamada no hay navegador que nos avise.
 */
class Oido {
  constructor({ alTerminarDeHablar, silencioMs = 800, umbral = 0.012 }) {
    this.alTerminarDeHablar = alTerminarDeHablar
    this.silencioMs = silencioMs
    this.umbral = umbral
    this.trozos = []
    this.huboVoz = false
    this.calladoDesde = null
    this.sordo = false          // mientras el agente habla, no se escucha
  }

  /** Un trozo de PCM de 20 ms recién descodificado. */
  alimentar(pcm) {
    if (this.sordo) return

    // Energía media (RMS). Con PCM de 16 bits, dividir entre 32768 deja el
    // valor entre 0 y 1, que es la misma escala que usa la página de pruebas —
    // así el umbral afinado allí sirve aquí.
    let suma = 0
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const m = pcm.readInt16LE(i) / 32768
      suma += m * m
    }
    const nivel = Math.sqrt(suma / (pcm.length / 2))

    if (nivel > this.umbral) {
      this.huboVoz = true
      this.calladoDesde = null
      this.trozos.push(pcm)
      return
    }

    // El silencio también se guarda: recortarlo deja las palabras pegadas y
    // Whisper transcribe peor.
    if (this.huboVoz) {
      this.trozos.push(pcm)
      this.calladoDesde ??= Date.now()
      if (Date.now() - this.calladoDesde > this.silencioMs) this.cerrarTurno()
    }
  }

  cerrarTurno() {
    const pcm = Buffer.concat(this.trozos)
    this.trozos = []
    this.huboVoz = false
    this.calladoDesde = null
    // Menos de medio segundo de audio no es una frase: es una tos, un golpe o
    // el eco del propio agente. Contestar a eso es peor que ignorarlo.
    if (pcm.length < 48000 * 2 * 0.5) return
    this.sordo = true
    this.alTerminarDeHablar(pcm)
  }

  volverAEscuchar() {
    this.trozos = []
    this.huboVoz = false
    this.calladoDesde = null
    this.sordo = false
  }
}

/**
 * Contesta la llamada y CONVERSA.
 *
 * El circuito es el mismo que ya funciona en la página de pruebas —oír, pensar,
 * hablar— pero con el audio entrando y saliendo por la llamada.
 *
 * ⚠️ Mientras el agente habla se pone sordo a propósito. Sin eso se oye a sí
 * mismo por el eco de la línea, cree que le están hablando y se responde solo —
 * un bucle que llena la llamada de disparates. Dejar que la clínica lo
 * interrumpa de verdad (barge-in) exige distinguir su eco de una voz nueva, y
 * eso es un problema aparte que hay que resolver a conciencia.
 */
export async function conversar({ phoneNumberId, callId, sdpOffer, agente }) {
  const t0 = Date.now()
  let pc = null, viva = true
  const historial = []

  try {
    const { RTCPeerConnection, MediaStreamTrack, useOPUS } = await import('werift')
    const Opus = (await import('opusscript')).default
    const { turno, wavDePcm, rellenos } = await import('./voz-conversacion.js')

    pc = new RTCPeerConnection({
      codecs: { audio: [useOPUS()] },
      icePortRange: PUERTOS,
      ...(IP_PUBLICA ? { iceAdditionalHostAddresses: [IP_PUBLICA] } : {}),
    })

    const salida = new MediaStreamTrack({ kind: 'audio' })
    pc.addTransceiver(salida, { direction: 'sendrecv' })

    // ⚠️ La suscripción va ANTES de `setRemoteDescription`: el evento de la
    // pista entrante salta DURANTE esa llamada. Engancharlo después es llegar
    // tarde — la llamada se establece, el agente habla, y no oye nada nunca.
    // Costó una llamada entera descubrirlo, porque desde fuera se ve idéntico
    // a "la clínica no dijo nada".
    let pistaEntrante = null
    pc.ontrack = (ev) => { pistaEntrante = ev.track }

    await pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer })
    await pc.setLocalDescription(await pc.createAnswer())
    await esperarCandidatos(pc)
    const sdp = pc.localDescription.sdp
    const tipoCarga = tipoDeCargaOpus(sdpOffer)

    // Se prepara todo lo que se puede EN PARALELO con la negociación: el
    // saludo y las muletillas son fijos y tardan lo suyo en sintetizarse.
    const preparativos = Promise.all([
      sintetizar({ agente, texto: 'Camino al Cielo, buenas. ¿En qué te puedo ayudar?' }),
      rellenos(agente),
    ])

    const pre = await accionLlamada({ phoneNumberId, callId, accion: 'pre_accept', sdp })
    if (pre.error) return log(MOD, `${callId}: pre_accept falló — ${pre.error}`)
    const acc = await accionLlamada({ phoneNumberId, callId, accion: 'accept', sdp })
    if (acc.error) return log(MOD, `${callId}: accept falló — ${acc.error}`)
    log(MOD, `${callId}: conversación ACEPTADA (${Date.now() - t0} ms)`)

    const [saludo, muletillas] = await preparativos
    const decodificador = new Opus(48000, 1, Opus.Application.VOIP)
    let iMuletilla = 0

    const decir = async (audio) => {
      oido.sordo = true
      try {
        await reproducir(salida, await aPaquetesOpus(audio), tipoCarga)
      } finally {
        // Un respiro antes de volver a escuchar: la cola del propio audio en la
        // línea se tomaría por voz de la clínica.
        setTimeout(() => oido.volverAEscuchar(), 250)
      }
    }

    const oido = new Oido({
      alTerminarDeHablar: async (pcm) => {
        if (!viva) return
        const t = Date.now()
        // La muletilla suena YA, mientras se piensa. Es lo que convierte tres
        // segundos de silencio en una conversación normal.
        const m = muletillas[iMuletilla++ % (muletillas.length || 1)]
        if (m) reproducir(salida, await aPaquetesOpus(Buffer.from(m.audio, 'base64')), tipoCarga)
          .catch(() => {})

        const r = await turno({ agente, wav: wavDePcm(pcm, 48000), historial })
        if (!viva) return
        if (r.error) {
          log(MOD, `${callId}: turno falló — ${r.error}`)
          return oido.volverAEscuchar()
        }
        historial.push({ role: 'user', content: r.transcripcion })
        historial.push({ role: 'assistant', content: r.respuesta })
        log(MOD, `${callId}: "${r.transcripcion.slice(0, 40)}" → "${r.respuesta.slice(0, 40)}"`
          + ` (${Date.now() - t} ms)`)
        await decir(Buffer.from(r.audio, 'base64'))
      },
    })

    // El audio que entra: cada paquete RTP trae 20 ms de Opus.
    const escuchar = (pista) => pista.onReceiveRtp.subscribe((rtp) => {
      if (!viva || oido.sordo) return
      try { oido.alimentar(Buffer.from(decodificador.decode(rtp.payload))) }
      catch { /* un paquete perdido no debe tumbar la llamada */ }
    })
    if (pistaEntrante) escuchar(pistaEntrante)
    else pc.ontrack = (ev) => escuchar(ev.track)   // por si llega más tarde
    log(MOD, `${callId}: oyendo (pista ${pistaEntrante ? 'ya presente' : 'pendiente'})`)

    if (!saludo.error) await decir(saludo.audio)
    else oido.volverAEscuchar()

    // La llamada vive hasta que cuelguen o hasta el tope. Sin tope, un teléfono
    // olvidado descolgado deja esto corriendo (y gastando) para siempre.
    await new Promise(fin => {
      const tope = setTimeout(fin, 5 * 60_000)
      pc.connectionStateChange.subscribe(estado => {
        if (['closed', 'failed', 'disconnected'].includes(estado)) { clearTimeout(tope); fin() }
      })
    })
  } catch (e) {
    log(MOD, `${callId}: ERROR en la conversación — ${e.message}`)
  } finally {
    viva = false
    await accionLlamada({ phoneNumberId, callId, accion: 'terminate' }).catch(() => {})
    try { pc?.close() } catch { /* ya estaba cerrada */ }
    log(MOD, `${callId}: llamada cerrada (${Math.round((Date.now() - t0) / 1000)} s)`)
  }
}
