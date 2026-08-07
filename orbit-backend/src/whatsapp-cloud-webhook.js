// WhatsApp Cloud API — receptor de webhooks (línea de VETERINARIAS).
//
// Primer paso de la migración desde Zolutium/GHL hacia Cloud API directo.
// Alcance deliberadamente mínimo: RECIBE, VALIDA, FILTRA y GUARDA. No responde
// mensajes, no toca ningún módulo de Orbit, no hay lógica de agente.
//
// OJO — no confundir con `whatsapp.js`: ese es el EMISOR de Zolutium/GHL y sigue
// operando normal para todo lo demás (grupales, imágenes, digitales). Este
// archivo es la plataforma nueva y solo atiende los números listados en
// WHATSAPP_ALLOWED_PHONE_IDS.
//
// URL a registrar en Meta: https://orbit.orbitacac.com/api/webhook/whatsapp
//
// ⚠️ NO es api.orbitacac.com — ese subdominio nunca tuvo registro DNS (su
// `deploy/nginx-api.conf` es config muerta). El backend se publica por el
// `location /api/` del sitio `orbit`, que hace proxy_pass a 8787/ y le quita el
// prefijo. Verificado en producción el 2026-08-05.
//
// Variables en /opt/orbit-backend/.env:
//   WHATSAPP_VERIFY_TOKEN      — el que se teclea en el panel de Meta al suscribir
//   WHATSAPP_APP_SECRET        — App Secret de la app de Meta (firma las peticiones)
//   WHATSAPP_ALLOWED_PHONE_IDS — phone_number_id permitidos, separados por coma
import crypto from 'node:crypto'
import { pool, log } from './db.js'
import { responderSiAplica } from './agente-wa.js'

const MOD = '[wa-webhook]'

/** Tope de eventos que devuelve la bandeja de depuración. */
const MAX_BANDEJA = 200

// ─────────────────────────────────────────────────────────────────────────────
// GET — verificación del webhook (Meta la llama una vez, al suscribir)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Meta manda hub.mode / hub.verify_token / hub.challenge como query params.
 * Si el token coincide, hay que devolver el challenge EN TEXTO PLANO con 200
 * (si se devuelve JSON, Meta rechaza la suscripción).
 */
export function verificarWebhook(req, res) {
  const modo      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const esperado = process.env.WHATSAPP_VERIFY_TOKEN
  if (!esperado) {
    log(MOD, 'verificación RECHAZADA: falta WHATSAPP_VERIFY_TOKEN en el .env')
    return res.sendStatus(403)
  }

  if (modo !== 'subscribe' || !igualSeguro(token, esperado)) {
    log(MOD, `verificación RECHAZADA (modo=${modo || '-'}, token ${token ? 'no coincide' : 'ausente'})`)
    return res.sendStatus(403)
  }

  log(MOD, 'verificación OK — webhook suscrito en Meta')
  return res.status(200).type('text/plain').send(String(challenge ?? ''))
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — eventos entrantes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orden NO negociable:
 *   1. validar la firma sobre el cuerpo CRUDO (nunca sobre el JSON reserializado)
 *   2. responder 200 YA — Meta reintenta si tardamos más de 5s
 *   3. procesar en background
 *
 * `req.body` llega como Buffer porque la ruta se monta con express.raw() antes
 * del express.json() global de index.js. Si algún día alguien mueve ese orden,
 * el guard de abajo lo detecta en vez de fallar la firma en silencio.
 */
export function recibirWebhook(req, res) {
  const raw = req.body

  if (!Buffer.isBuffer(raw)) {
    log(MOD, 'ERROR de montaje: el body no es Buffer — express.raw debe ir ANTES de express.json en index.js')
    return res.sendStatus(500)
  }

  if (!firmaValida(raw, req.headers['x-hub-signature-256'])) {
    log(MOD, `firma INVÁLIDA — descartado (${raw.length} bytes, ip=${req.headers['x-real-ip'] || req.ip})`)
    return res.sendStatus(403)
  }

  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch (e) {
    // Firma buena pero JSON ilegible: no tiene sentido que Meta lo reintente.
    log(MOD, 'JSON ilegible pese a firma válida —', e.message)
    return res.sendStatus(200)
  }

  // 200 primero, procesar después. A partir de aquí no se toca `res`.
  res.sendStatus(200)

  setImmediate(() => {
    procesarPayload(payload).catch((e) => {
      log(MOD, 'ERROR procesando en background —', e.message, e.stack?.split('\n')[1]?.trim() || '')
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Firma
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 del cuerpo crudo con el App Secret, comparado en tiempo constante.
 * El header viene como "sha256=<hex>".
 */
function firmaValida(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) {
    log(MOD, 'RECHAZADO: falta WHATSAPP_APP_SECRET en el .env')
    return false
  }
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false

  const esperado = crypto.createHmac('sha256', secret).update(raw).digest()
  // Buffer.from con hex inválido no lanza: trunca. El chequeo de longitud cubre
  // ese caso y además evita que timingSafeEqual tire por buffers desiguales.
  const recibido = Buffer.from(header.slice('sha256='.length), 'hex')
  if (recibido.length !== esperado.length) return false

  return crypto.timingSafeEqual(recibido, esperado)
}

/** Comparación en tiempo constante para strings (verify token). */
function igualSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtro por número
// ─────────────────────────────────────────────────────────────────────────────

/**
 * phone_number_id autorizados. Si la variable está vacía se descarta TODO:
 * fallar cerrado es lo correcto acá — el riesgo de un `.env` mal puesto es
 * empezar a procesar números que siguen operando en Zolutium.
 */
function idsPermitidos() {
  return new Set(
    (process.env.WHATSAPP_ALLOWED_PHONE_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción y persistencia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un POST puede traer varios eventos (entry[] → changes[] → messages[]/statuses[]).
 * Devuelve una entrada por evento; el payload completo se adjunta luego a cada fila.
 */
function extraerEventos(payload) {
  const eventos = []

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Meta manda el nombre que la persona tiene puesto en su WhatsApp. Es lo
      // único que tenemos para un número que no está en aliados ni en clientes.
      const perfiles = new Map()
      for (const c of value?.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) perfiles.set(c.wa_id, c.profile.name)
      }

      for (const m of value?.messages ?? []) {
        eventos.push({
          phoneNumberId,
          waMessageId:   m?.id ?? null,
          fromNumber:    m?.from ?? null,
          eventType:     'message',
          status:        null,
          resumen:       m?.type || 'desconocido',
          tipo:          m?.type || 'text',
          texto:         textoDeMensaje(m),
          ocurridoEn:    fechaMeta(m?.timestamp),
          perfilNombre:  perfiles.get(m?.from) ?? null,
        })
      }

      for (const s of value?.statuses ?? []) {
        eventos.push({
          phoneNumberId,
          waMessageId:  s?.id ?? null,
          fromNumber:   s?.recipient_id ?? null,
          eventType:    'status',
          status:       s?.status ?? null,
          resumen:      s?.status || 'desconocido',
          ocurridoEn:   fechaMeta(s?.timestamp),
          // Meta explica aquí por qué rebotó (número inválido, fuera de ventana,
          // plantilla rechazada). Sin esto el mensaje solo queda en "failed" mudo.
          errorTexto:   textoDeError(s?.errors),
        })
      }
    }
  }

  return eventos
}

/** Los timestamps de Meta vienen en segundos unix (string). */
function fechaMeta(ts) {
  const n = parseInt(ts, 10)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
}

function textoDeError(errores) {
  const e = Array.isArray(errores) ? errores[0] : null
  if (!e) return null
  return [e.code, e.title, e.error_data?.details || e.message].filter(Boolean).join(' · ')
}

async function procesarPayload(payload) {
  const permitidos = idsPermitidos()
  if (!permitidos.size) {
    log(MOD, 'WHATSAPP_ALLOWED_PHONE_IDS vacío — se descarta todo (fail-closed)')
    return
  }

  const eventos = extraerEventos(payload)
  if (!eventos.length) {
    // Meta manda otras notificaciones (cambios de plantilla, calidad del número).
    // No son mensajes; se registran para saber que llegaron y no se guardan.
    log(MOD, 'evento sin messages/statuses — ignorado')
    return
  }

  const crudo = JSON.stringify(payload)

  for (const ev of eventos) {
    if (!permitidos.has(ev.phoneNumberId)) {
      // Silencioso para la operación, visible en el log: así se ve el
      // phone_number_id real la primera vez que se conecta un número nuevo
      // (es la forma cómoda de averiguar qué poner en la variable de entorno).
      log(MOD, `descartado — phone_number_id=${ev.phoneNumberId} no está en WHATSAPP_ALLOWED_PHONE_IDS`)
      continue
    }

    try {
      // ── Capa 1: log crudo (migración 086) ──
      // ON CONFLICT DO NOTHING sin target: cubre los dos índices únicos
      // parciales (mensajes por wamid, acuses por wamid+estado).
      const { rowCount } = await pool.query(
        `INSERT INTO public.whatsapp_webhook_events
           (phone_number_id, wa_message_id, from_number, event_type, status, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT DO NOTHING`,
        [ev.phoneNumberId, ev.waMessageId, ev.fromNumber, ev.eventType, ev.status, crudo]
      )

      log(
        MOD,
        rowCount ? 'guardado' : 'duplicado (ignorado)',
        `phone_number_id=${ev.phoneNumberId}`,
        `tipo=${ev.eventType}/${ev.resumen}`,
        `de=${ev.fromNumber || '-'}`,
        `wamid=${ev.waMessageId || '-'}`
      )

      // ── Capa 2: conversación (migración 087) ──
      // Va aparte y con su propio try: si la bandeja fallara, el log crudo ya
      // quedó guardado y no se pierde nada — se puede reconstruir después.
      if (!rowCount) continue  // duplicado: ya se normalizó la primera vez
      await normalizar(ev)
    } catch (e) {
      log(MOD, `ERROR guardando wamid=${ev.waMessageId || '-'} —`, e.message)
    }
  }
}

/**
 * Vuelca el evento crudo en la capa que pinta la bandeja.
 *  - message → un renglón nuevo en whatsapp_mensajes (dirección IN)
 *  - status  → actualiza el estado del renglón OUT que ya existe
 */
async function normalizar(ev) {
  try {
    if (ev.eventType === 'message') {
      await pool.query(
        `INSERT INTO public.whatsapp_mensajes
           (phone_number_id, contacto, direccion, wa_message_id, tipo, texto, ocurrido_en)
         VALUES ($1, $2, 'IN', $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [ev.phoneNumberId, ev.fromNumber, ev.waMessageId, ev.tipo, ev.texto, ev.ocurridoEn]
      )

      if (ev.perfilNombre) {
        // El trigger ya creó la fila del contacto; aquí solo se le pone el nombre.
        await pool.query(
          `UPDATE public.whatsapp_contactos SET nombre_perfil = $2
            WHERE contacto = $1 AND COALESCE(nombre_perfil, '') <> $2`,
          [ev.fromNumber, ev.perfilNombre]
        )
      }

      // ── Agente (migración 088) ──
      // Solo llega aquí un mensaje ENTRANTE y nuevo: los acuses de lo que
      // enviamos nosotros salen por la otra rama, y los duplicados ya se
      // descartaron antes. Sin esa doble condición el agente se respondería a
      // sí mismo en bucle.
      // Va sin await a propósito: Meta reintenta si tardamos más de 5s, y el
      // agente puede tomarse varios segundos. `responderSiAplica` nunca lanza.
      responderSiAplica({
        phoneNumberId: ev.phoneNumberId, contacto: ev.fromNumber, tipo: ev.tipo,
      })
      return
    }

    // Acuse de uno de NUESTROS mensajes. El estado solo puede avanzar:
    // sent → delivered → read. Meta no garantiza el orden de entrega de los
    // webhooks, así que sin este gate un "sent" que llega tarde pisaría un "read"
    // y la bandeja mostraría un mensaje ya leído como recién enviado.
    const { rowCount } = await pool.query(
      `UPDATE public.whatsapp_mensajes
          SET estado    = $2,
              estado_en = $3,
              error     = COALESCE($4, error)
        WHERE wa_message_id = $1
          AND ($2 = 'failed' OR public.rango_estado_wa(estado) < public.rango_estado_wa($2))`,
      [ev.waMessageId, ev.status, ev.ocurridoEn, ev.errorTexto]
    )

    if (!rowCount) {
      // Normal si el mensaje se envió antes de existir la bandeja, o si el
      // acuse llegó fuera de orden. No es un error: el crudo ya quedó.
      log(MOD, `acuse sin mensaje en la bandeja (wamid=${ev.waMessageId}, estado=${ev.status})`)
    }
  } catch (e) {
    log(MOD, `ERROR normalizando wamid=${ev.waMessageId || '-'} —`, e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bandeja de depuración (solo lectura)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Últimos eventos, para poder mirar qué está llegando sin abrir la base de datos.
 * NO es la bandeja de conversaciones del producto — es una ventana de diagnóstico
 * mientras se conecta el número. Solo lectura, con JWT y rol.
 */
export async function listarEventos({ limite = 50, numero = null } = {}) {
  const tope = Math.max(1, Math.min(parseInt(limite) || 50, MAX_BANDEJA))

  const { rows } = await pool.query(
    `SELECT id, phone_number_id, wa_message_id, from_number,
            event_type, status, received_at, processed, payload
       FROM public.whatsapp_webhook_events
      WHERE ($1::text IS NULL OR from_number = $1)
      ORDER BY received_at DESC, id DESC
      LIMIT $2`,
    [numero, tope]
  )

  return {
    ok: true,
    total: rows.length,
    eventos: rows.map((r) => ({
      id:            r.id,
      recibido_en:   r.received_at,
      de:            r.from_number,
      tipo:          r.event_type,
      estado:        r.status,
      wa_message_id: r.wa_message_id,
      procesado:     r.processed,
      texto:         textoDelEvento(r.payload, r.wa_message_id),
    })),
  }
}

/**
 * Texto legible de UN mensaje, para que la bandeja se entienda de un vistazo.
 * Cubre texto suelto, respuestas de botón y de lista, y adjuntos con pie de foto.
 * Los Flows (nfm_reply) todavía no se interpretan: se marcan y el JSON queda
 * íntegro en whatsapp_webhook_events para cuando se prendan.
 */
export function textoDeMensaje(m) {
  if (!m) return null
  if (m.text?.body) return m.text.body
  if (m.button?.text) return `[botón] ${m.button.text}`
  if (m.interactive?.button_reply?.title) return `[botón] ${m.interactive.button_reply.title}`
  if (m.interactive?.list_reply?.title) return `[lista] ${m.interactive.list_reply.title}`
  if (m.interactive?.nfm_reply) return '[respuesta de Flow]'
  // Adjuntos: el archivo todavía no se descarga (necesita el media endpoint de
  // Meta), pero el pie de foto sí llega y suele ser lo que importa.
  const adjunto = m.image || m.video || m.audio || m.document || m.sticker
  if (adjunto) {
    const etiqueta = m.image ? 'imagen' : m.video ? 'video' : m.audio ? 'audio'
                   : m.document ? 'documento' : 'sticker'
    return adjunto.caption ? `[${etiqueta}] ${adjunto.caption}` : `[${etiqueta}]`
  }
  if (m.location) return '[ubicación]'
  if (m.contacts) return '[contacto]'
  return `[${m.type || 'sin texto'}]`
}

/** Busca el mensaje `wamid` dentro del payload crudo y devuelve su texto. */
function textoDelEvento(payload, wamid) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        if (wamid && m?.id !== wamid) continue
        return textoDeMensaje(m)
      }
    }
  }
  return null
}
