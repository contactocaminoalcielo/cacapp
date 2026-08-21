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
 * La boca de la llamada: UNA sola pista de audio, continua, de principio a fin.
 *
 * 🩸 AQUÍ ESTABA LA MULETILLA QUE NO SE OÍA. Cada vez que el agente decía algo
 * se llamaba a `reproducir`, y `reproducir` inventa un SSRC, una numeración y
 * una marca de tiempo NUEVOS Y AL AZAR. Para quien recibe, eso no es "el mismo
 * que sigue hablando": es una fuente de audio distinta que aparece de la nada,
 * con un reloj que no cuadra con nada. El receptor tira esos primeros paquetes
 * mientras vuelve a sincronizar — y la muletilla, que dura segundo y medio,
 * cabe entera en ese hueco. Las respuestas largas sobrevivían porque perder su
 * primer segundo no se nota tanto.
 *
 * Una llamada = una boca. El SSRC no cambia nunca, la numeración no salta, y el
 * reloj AVANZA TAMBIÉN DURANTE LOS SILENCIOS: si el agente calla nueve segundos
 * pensando, la marca de tiempo tiene que haber avanzado esos nueve segundos, o
 * lo siguiente que diga llega fechado en el pasado.
 */
export class Boca {
  constructor(pista, tipoCarga) {
    this.pista = pista
    this.tipoCarga = tipoCarga
    this.ssrc = Math.floor(Math.random() * 0xffffffff)
    this.secuencia = Math.floor(Math.random() * 0xffff)
    this.marca = Math.floor(Math.random() * 0xffffffff)
    this.finAnterior = null      // cuándo dejó de sonar lo último
    this.cola = Promise.resolve()
    // Sube cada vez que lo callan. Lo que estaba sonando y lo que esperaba en
    // la cola llevan la generación con la que se encolaron: si no coincide, ya
    // no vale. Es la forma barata de cancelar sin dejar audio zombi.
    this.generacion = 0
    this.hablando = false
  }

  /** Encola algo que decir. Suena después de lo que ya estaba sonando. */
  decir(audio) {
    const gen = this.generacion
    this.cola = this.cola
      .catch(() => {})
      .then(() => (gen === this.generacion ? this.emitir(audio, gen) : undefined))
    return this.cola
  }

  /** Cállate ya: lo que suena se corta y lo que espera se descarta. */
  callar() {
    this.generacion++
    this.hablando = false
  }

  /** Se resuelve cuando no queda nada por decir. */
  silencio() {
    return this.cola.catch(() => {})
  }

  async emitir(audio, gen) {
    const paquetes = await aPaquetesOpus(audio)
    if (gen !== this.generacion) return
    const { RtpPacket, RtpHeader } = await import('werift')

    const inicio = Date.now()
    // El silencio también ocupa tiempo en el reloj de RTP. Sin esto, tras una
    // pausa larga el audio nuevo llega con una marca de hace nueve segundos y
    // el receptor lo trata como un paquete que llegó tardísimo: lo descarta.
    if (this.finAnterior !== null) {
      const hueco = Math.max(0, inicio - this.finAnterior)
      this.marca = (this.marca + Math.round(hueco / 20) * 960) >>> 0
    }

    this.hablando = true
    try {
      for (let i = 0; i < paquetes.length; i++) {
        if (gen !== this.generacion) break
        this.pista.writeRtp(new RtpPacket(new RtpHeader({
          payloadType: this.tipoCarga,
          sequenceNumber: this.secuencia,
          timestamp: this.marca,
          ssrc: this.ssrc,
          // Arranque de locución tras un silencio: es lo que le dice al
          // receptor que puede reajustar su cola sin dar el audio por perdido.
          marker: i === 0,
        }), paquetes[i]))

        this.secuencia = (this.secuencia + 1) & 0xffff
        this.marca = (this.marca + 960) >>> 0

        // Plazos absolutos, no esperas de 20 ms sumadas: cada vuelta tarda algo
        // más y ese exceso se acumula hasta arrastrar la voz.
        const espera = inicio + (i + 1) * 20 - Date.now()
        if (espera > 0) await new Promise(r => setTimeout(r, espera))
      }
    } finally {
      this.hablando = false
      this.finAnterior = Date.now()
    }
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
export class Oido {
  constructor({
    alTerminarDeHablar,
    alInterrumpir = null,
    silencioMs = 800,
    umbral = 0.012,
    topeTurnoMs = 15_000,
    interrupcionMs = 400,
  }) {
    this.alTerminarDeHablar = alTerminarDeHablar
    this.alInterrumpir = alInterrumpir
    this.silencioMs = silencioMs
    this.umbral = umbral
    this.topeTurnoMs = topeTurnoMs
    this.interrupcionMs = interrupcionMs
    this.trozos = []
    this.msAudio = 0            // cuánto audio lleva acumulado este turno
    this.niveles = []           // para poder afinar el umbral con datos, no a ojo
    this.huboVoz = false
    this.calladoDesde = null
    this.ultimoTrozo = null     // cuándo llegó el último paquete RTP
    this.sordo = false          // mientras el agente habla, no se captura
    // Lo que se oye MIENTRAS el agente habla. Casi todo es su propio eco, y
    // saber a qué nivel suena ese eco es lo que permite distinguirlo de alguien
    // interrumpiendo de verdad. Ver `vigilar()`.
    this.ecoReciente = []
    this.vozDesde = null
    this.interrupciones = 0
    // 🩸 Qué turno se está atendiendo. Sin esto, un turno abandonado —porque le
    // interrumpieron— sigue vivo por dentro: sus frases se siguen encolando y
    // su final vuelve a poner el oído a cero, borrando lo que la persona acaba
    // de decir. El número sube cada vez que empieza o se abandona un turno, y
    // todo lo que llega tarde se compara contra él.
    this.turnos = 0
    // 🩸 El reloj es PROPIO a propósito. Ver `revisar()`.
    this.reloj = setInterval(() => this.revisar(), 100)
  }

  /** Un trozo de PCM de 20 ms recién descodificado. */
  alimentar(pcm) {
    // Energía media (RMS). Con PCM de 16 bits, dividir entre 32768 deja el
    // valor entre 0 y 1, que es la misma escala que usa la página de pruebas —
    // así el umbral afinado allí sirve aquí.
    let suma = 0
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const m = pcm.readInt16LE(i) / 32768
      suma += m * m
    }
    const nivel = Math.sqrt(suma / (pcm.length / 2))

    // Mientras el agente habla NO se captura, pero sí se escucha: es la única
    // forma de que se le pueda interrumpir.
    if (this.sordo) return this.vigilar(nivel)

    this.ultimoTrozo = Date.now()
    this.niveles.push(nivel)

    if (nivel > this.umbral) {
      this.huboVoz = true
      this.calladoDesde = null
      this.guardar(pcm)
      // 🩸 UN TURNO NO PUEDE CRECER SIN FIN. Si el ruido de fondo de la línea
      // se queda por encima del umbral —una calle, un consultorio, la propia
      // portadora— el nivel no baja nunca, el corte por silencio no llega
      // nunca y el agente escucha eternamente mientras la clínica habla y
      // espera. Desde fuera se ve EXACTAMENTE igual que "saluda y no responde".
      if (this.msAudio >= this.topeTurnoMs) this.cerrarTurno('tope')
      return
    }

    // El silencio también se guarda: recortarlo deja las palabras pegadas y
    // Whisper transcribe peor.
    if (this.huboVoz) {
      this.guardar(pcm)
      this.calladoDesde ??= Date.now()
      if (Date.now() - this.calladoDesde > this.silencioMs) this.cerrarTurno('silencio')
    }
  }

  guardar(pcm) {
    this.trozos.push(pcm)
    this.msAudio += (pcm.length / 2) / 48                  // muestras a 48 kHz → ms
  }

  /**
   * Cierra el turno aunque DEJEN DE LLEGAR paquetes.
   *
   * 🩸 El corte por silencio vivía dentro de `alimentar`, así que dependía de
   * que siguiera entrando audio. Si quien llama cuelga, o la línea deja de
   * mandar durante una pausa (Opus manda DTX: en silencio no manda nada), lo
   * que ya se había hablado se quedaba en el buffer para siempre y el agente
   * no contestaba jamás.
   */
  /**
   * ¿Alguien está hablando POR ENCIMA del agente?
   *
   * 🩸 EL PROBLEMA NO ES OÍR, ES DISTINGUIR. Mientras el agente habla, lo que
   * entra por la línea es sobre todo SU PROPIO ECO, y un umbral fijo lo toma
   * por una persona: el agente se interrumpe a sí mismo en bucle y la llamada
   * se vuelve un disparate. Por eso el listón no es fijo — se mide el eco de
   * los últimos segundos y hay que superarlo CLARAMENTE, y además sostenerlo:
   * un golpe de 20 ms no interrumpe a nadie, una frase sí.
   */
  vigilar(nivel) {
    this.ecoReciente.push(nivel)
    if (this.ecoReciente.length > 150) this.ecoReciente.shift()   // ~3 s
    if (!this.alInterrumpir) return

    // Hasta tener con qué comparar, no se interrumpe: arrancar a ciegas es
    // justo cuando el eco todavía no se ha medido.
    if (this.ecoReciente.length < 25) return
    const orden = [...this.ecoReciente].sort((a, b) => a - b)
    const pisoEco = orden[Math.floor(orden.length / 2)]
    const listón = Math.max(this.umbral * 4, pisoEco * 3)

    if (nivel <= listón) { this.vozDesde = null; return }
    this.vozDesde ??= Date.now()
    if (Date.now() - this.vozDesde < this.interrupcionMs) return

    this.vozDesde = null
    this.interrupciones++
    try {
      this.alInterrumpir({ nivel: nivel.toFixed(4), pisoEco: pisoEco.toFixed(4), listón: listón.toFixed(4) })
    } catch (e) {
      log(MOD, `no se pudo atender la interrupción — ${e.message}`)
    }
  }

  revisar() {
    if (this.sordo || !this.huboVoz) return
    const desde = this.calladoDesde ?? this.ultimoTrozo
    if (desde && Date.now() - desde > this.silencioMs) this.cerrarTurno('reloj')
  }

  cerrarTurno(motivo = 'silencio') {
    const pcm = Buffer.concat(this.trozos)
    const ms = Math.round(this.msAudio)
    const niveles = this.niveles
    this.trozos = []
    this.msAudio = 0
    this.niveles = []
    this.huboVoz = false
    this.calladoDesde = null
    // Menos de medio segundo de audio no es una frase: es una tos, un golpe o
    // el eco del propio agente. Contestar a eso es peor que ignorarlo.
    if (pcm.length < 48000 * 2 * 0.5) return
    this.sordo = true
    this.turnos++
    // 🩸 `.catch` OBLIGATORIO. Este callback es asíncrono y se lanza sin
    // esperarlo. Si revienta —y revienta: la API de Claude devolvió un 400 por
    // saldo agotado el 21-ago— la promesa queda sin recoger, y desde Node 15
    // eso NO es un aviso: MATA EL PROCESO. Se llevó por delante el backend
    // entero (agente de WhatsApp de 203 clínicas, jobs, portal) por un error de
    // una llamada de voz. Ver también la red de seguridad en `index.js`.
    Promise.resolve(
      this.alTerminarDeHablar(pcm, { motivo, ms, turno: this.turnos, niveles: resumenNiveles(niveles) })
    ).catch(e => log(MOD, `el turno reventó — ${e.message}`))
  }

  volverAEscuchar() {
    // Lo que estuviera en marcha queda invalidado: ver `turnos`.
    this.turnos++
    this.trozos = []
    this.msAudio = 0
    this.niveles = []
    this.huboVoz = false
    this.calladoDesde = null
    this.ultimoTrozo = null
    this.vozDesde = null
    this.sordo = false
  }

  parar() {
    clearInterval(this.reloj)
    this.sordo = true
  }
}

/**
 * Cómo sonaba el turno, en tres números.
 *
 * Sirve para una pregunta concreta que hoy no se puede responder: si el agente
 * no contestó, ¿fue porque no oyó nada (todo por debajo del umbral) o porque el
 * ruido tapaba la voz (todo por encima)? Sin esto, las dos cosas se ven igual
 * en el registro y el umbral se afina adivinando.
 */
function resumenNiveles(niveles) {
  if (!niveles.length) return null
  const orden = [...niveles].sort((a, b) => a - b)
  const tres = n => n.toFixed(4)
  return {
    min:      tres(orden[0]),
    mediana:  tres(orden[Math.floor(orden.length / 2)]),
    max:      tres(orden[orden.length - 1]),
  }
}

/**
 * Las llamadas que están sonando AHORA, para poder cortarlas desde fuera.
 *
 * 🩸 Hace falta porque el webhook y la llamada viven en sitios distintos: quien
 * llama cuelga, Meta manda `terminate` al webhook, y la sesión de audio no se
 * entera. Medido el 2026-08-20: colgaron a los 26 s y la sesión siguió viva
 * hasta el tope de 5 minutos — gastando Whisper y ElevenLabs, y contestándole
 * en voz alta a una llamada que ya no existía (41 s después de colgar).
 */
const enCurso = new Map()

/**
 * Cuelga una llamada que está en curso. Devuelve si había alguna.
 *
 * `porElOtroLado` evita mandarle a Meta un `terminate` de una llamada que ya
 * terminó ella sola: no rompe nada, pero ensucia el registro con un error que
 * parece un fallo nuestro y no lo es.
 */
export function colgar(callId, { motivo = 'colgaron', porElOtroLado = true } = {}) {
  const sesion = enCurso.get(callId)
  if (!sesion) return false
  sesion.cerrar({ motivo, porElOtroLado })
  return true
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
  let cerrar = null, oidoVivo = null
  let motivoCierre = 'sin empezar', yaColgada = false
  const historial = []

  try {
    const { RTCPeerConnection, MediaStreamTrack, useOPUS } = await import('werift')
    const Opus = (await import('opusscript')).default
    const { turno, wavDePcm, rellenos, disculpa, prepararSistema } = await import('./voz-conversacion.js')

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
      // El contexto del agente también: son dos consultas y 24 KB de texto que
      // no tienen por qué estar entre que la persona calla y el agente contesta.
      prepararSistema(agente).catch(() => null),
      // Por si el cerebro falla a mitad de llamada. Se pregenera ahora porque
      // justo cuando hace falta es cuando algo no está funcionando.
      disculpa(agente).catch(() => null),
    ])

    const pre = await accionLlamada({ phoneNumberId, callId, accion: 'pre_accept', sdp })
    if (pre.error) return log(MOD, `${callId}: pre_accept falló — ${pre.error}`)
    const acc = await accionLlamada({ phoneNumberId, callId, accion: 'accept', sdp })
    if (acc.error) return log(MOD, `${callId}: accept falló — ${acc.error}`)
    log(MOD, `${callId}: conversación ACEPTADA (${Date.now() - t0} ms)`)

    const [saludo, muletillas, sistema, perdon] = await preparativos
    const decodificador = new Opus(48000, 1, Opus.Application.VOIP)
    let iMuletilla = 0

    // Una llamada, una boca: pista continua, sin saltos de SSRC ni de reloj.
    const boca = new Boca(salida, tipoCarga)

    const decir = async (audio) => {
      oido.sordo = true
      try {
        await boca.decir(audio)
      } finally {
        // Un respiro antes de volver a capturar: la cola del propio audio en la
        // línea se tomaría por voz de la clínica.
        setTimeout(() => oido.volverAEscuchar(), 250)
      }
    }

    const oido = new Oido({
      // ── Interrumpir al agente (barge-in) ──
      // Antes el agente era un contestador: soltaba el párrafo entero pasara lo
      // que pasara, y hablarle encima no servía de nada. Ahora se calla en
      // cuanto oye una voz clara por encima de su propio eco: lo que estaba
      // diciendo se corta en seco y se pone a escuchar.
      alInterrumpir: (medida) => {
        if (!viva || !boca.hablando) return
        log(MOD, `${callId}: me interrumpen — nivel ${medida.nivel} sobre un eco de `
          + `${medida.pisoEco} (listón ${medida.listón})`)
        boca.callar()
        oido.volverAEscuchar()
      },

      alTerminarDeHablar: async (pcm, corte) => {
        if (!viva) return
        const t = Date.now()
        const n = corte?.niveles
        log(MOD, `${callId}: turno cerrado por ${corte?.motivo} — ${corte?.ms} ms de audio`
          + (n ? ` · nivel min ${n.min} / mediana ${n.mediana} / max ${n.max}` : ''))

        // La muletilla suena YA, mientras se piensa. Es lo que convierte tres
        // segundos de silencio en una conversación normal.
        const m = muletillas[iMuletilla++ % (muletillas.length || 1)]
        if (m) boca.decir(Buffer.from(m.audio, 'base64')).catch(() => {})

        // 🩸 SE HABLA MIENTRAS SE PIENSA. Antes se esperaba a que el modelo
        // terminara de escribir TODO, luego se sintetizaba TODO, y solo
        // entonces empezaba a sonar: los tres tiempos, uno detrás de otro.
        // Medido en la llamada real del 21-ago: 3,3 s de oír + 6,3 s de pensar
        // + 1,4 s de hablar = once segundos de silencio. Ahora cada frase sale
        // en cuanto está escrita, así que solo se espera a la PRIMERA.
        const vigente = () => viva && corte.turno === oido.turnos
        const r = await turno({
          agente,
          wav: wavDePcm(pcm, 48000),
          historial,
          sistema,
          referencia: callId,
          msAudio: corte?.ms,
          // Solo si este sigue siendo el turno vigente: si le interrumpieron,
          // las frases que el modelo todavía estaba escribiendo no deben sonar.
          alFrase: (audio) => {
            if (viva && corte.turno === oido.turnos) boca.decir(audio).catch(() => {})
          },
        })
        if (!vigente()) return log(MOD, `${callId}: turno abandonado (le interrumpieron)`)
        // Whisper no devuelve vacío con el silencio: devuelve una muletilla de
        // subtítulos. Contestarla es peor que callarse — ver `esRuido`.
        if (r.ruido) {
          log(MOD, `${callId}: ruido, no una frase ("${r.transcripcion}") — sigo escuchando`)
          return oido.volverAEscuchar()
        }
        if (r.error) {
          log(MOD, `${callId}: turno falló — ${r.error}`)
          // Quedarse mudo es lo peor que puede pasar aquí: quien llama no sabe
          // si sigue ahí, si se cortó o si tiene que repetir. Que lo diga.
          if (perdon) return decir(perdon)
          return oido.volverAEscuchar()
        }
        historial.push({ role: 'user', content: r.transcripcion })
        historial.push({ role: 'assistant', content: r.respuesta })
        log(MOD, `${callId}: "${r.transcripcion.slice(0, 40)}" → "${r.respuesta.slice(0, 40)}"`
          + ` (${r.tiempos?.frases} frase(s), ${Date.now() - t} ms hasta la última)`)

        // Ya está todo encolado; solo queda esperar a que termine de sonar para
        // volver a capturar. Si le interrumpieron, `callar()` ya vació la cola.
        try { await boca.silencio() } finally {
          setTimeout(() => { if (vigente() && oido.sordo) oido.volverAEscuchar() }, 250)
        }
      },
    })

    // El reloj del oído hay que pararlo al colgar: un `setInterval` suelto
    // mantiene vivo el proceso y sigue latiendo por una llamada que ya no está.
    oidoVivo = oido

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
    //
    // ⚠️ El estado de la conexión NO basta para saber que colgaron: medido, con
    // Meta se queda en `connected` después de que cuelgan y solo se enteraba por
    // el tope de 5 minutos. Quien avisa de verdad es el webhook (`terminate`),
    // y para eso la sesión se apunta en `enCurso`.
    await new Promise(fin => {
      const tope = setTimeout(() => { motivoCierre = 'tope de 5 min'; fin() }, 5 * 60_000)
      cerrar = ({ motivo, porElOtroLado }) => {
        motivoCierre = motivo
        yaColgada = yaColgada || porElOtroLado
        clearTimeout(tope)
        fin()
      }
      enCurso.set(callId, { cerrar })
      pc.connectionStateChange.subscribe(estado => {
        if (['closed', 'failed', 'disconnected'].includes(estado)) {
          cerrar({ motivo: `conexión ${estado}`, porElOtroLado: true })
        }
      })
    })
  } catch (e) {
    motivoCierre = `ERROR — ${e.message}`
    log(MOD, `${callId}: ERROR en la conversación — ${e.message}`)
  } finally {
    viva = false
    enCurso.delete(callId)
    oidoVivo?.parar()
    // Si colgó quien llamaba, mandarle `terminate` a Meta devuelve un error de
    // llamada inexistente que parece un fallo nuestro. Solo se cuelga cuando
    // quien cuelga somos nosotros.
    if (!yaColgada) await accionLlamada({ phoneNumberId, callId, accion: 'terminate' }).catch(() => {})
    try { pc?.close() } catch { /* ya estaba cerrada */ }
    log(MOD, `${callId}: llamada cerrada por ${motivoCierre} (${Math.round((Date.now() - t0) / 1000)} s)`)
  }
}
