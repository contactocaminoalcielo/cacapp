// Encuesta de satisfacción POST-ENTREGA (migración 206, REPORTE ORBIT 2026-11-09).
//
// El día siguiente a la entrega, Orbit le pregunta a la familia por WhatsApp
// cómo fue su experiencia, con una plantilla de tres botones de respuesta
// rápida: 😊 Bueno · 😐 Regular · ☹️ Malo. Al tocar uno:
//   · BUENA   → gracias + botón de reseña en Google (si hay enlace configurado).
//   · REGULAR → botón al formulario /#/opinion/CODIGO: «¿qué podríamos mejorar?»
//   · MALA    → PQR tipo QUEJA en el acto + botón al formulario: «cuéntanos qué
//               ocurrió». Regular y Mala quedan con seguimiento PENDIENTE en /nps.
//   Ni Regular ni Mala ven nunca el enlace de Google (decisión de David,
//   2026-11-09, tomada sabiendo que la política de Google lo prohíbe).
//
// El COMENTARIO (migr. 207, 13-nov) llega por el formulario o escrito en el
// chat (`capturarComentarioChat`, antes del agente). Cualquiera de los dos:
// queda como PQR (Malo → QUEJA, Regular → SUGERENCIA; coordinación cambia el
// tipo y pone el TEMA al atender en /nps), avisa al equipo y se le agradece a
// la familia por WhatsApp (TEXTO_GRACIAS).
//
// 🔑 No hay tabla propia: se llena la fila POST_ENTREGA de `nps_seguimiento`
// que crea el trigger `crear_nps_al_entregado` (037). /nps la sigue leyendo.
//
// 🪤 El agente de familias NO debe contestar el botón: el webhook llama a
// `manejarRespuestaEncuesta` ANTES de despertarlo y, si la respuesta era de la
// encuesta, no lo despierta. Sin eso, «😊 Bueno» le llega al modelo como un
// mensaje suelto y improvisa una conversación encima del agradecimiento.
import crypto from 'node:crypto'
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { enviarSobre } from './whatsapp-cloud.js'
import { LINEA_WA_ID } from './linea-wa.js'

const MOD = 'ENCUESTA_ENTREGA'
const TAG = '[encuesta]'

export const CONFIG_DEFAULTS_ENCUESTA = {
  activo:                 false,
  plantilla:              null,
  arranque_desde:         null,
  google_resena_url:      null,
  max_envios_por_corrida: 40,
  dias_max_atraso:        7,
}

// nps (1-5) en espejo, para que el promedio de /nps y del Dashboard siga vivo.
export const NPS_DE = { BUENA: 5, REGULAR: 3, MALA: 1 }

// ─── Textos ─────────────────────────────────────────────────────────────────
// Cuerpo de la plantilla `encuesta_post_entrega`: {{1}} = mascota. Es el texto
// del reporte; "tu mascotica" pasa a ser su nombre. Los botones van aparte.
export const CUERPO_PLANTILLA =
  '🐾🤍 Queremos saber cómo fue tu experiencia con la entrega de los homenajes y recordatorios de {{1}}.\n\n'
  + 'Tu opinión es muy importante para nosotros y nos permite seguir mejorando la manera en la que '
  + 'acompañamos a cada familia. 🌿✨\n\n'
  + '¿Cómo calificarías tu experiencia?'

// Texto exacto de los tres botones (tope de Meta: 25 caracteres por botón).
// SIN emojis: Meta rechaza la plantilla si un botón los trae (error 2388060,
// «Los botones no pueden contener variables, nuevas líneas, emojis…», 10-nov).
export const BOTONES = ['Bueno', 'Regular', 'Malo']

const TEXTO_BUENA =
  '🤍 Nos alegra mucho saber que tu experiencia fue positiva.\n\n'
  + 'Si deseas compartir tu experiencia públicamente, puedes hacerlo dejando una reseña en nuestra '
  + 'página de Google. Tu opinión puede ayudar a otras familias a conocernos.'
const TEXTO_BUENA_SIN_ENLACE =
  '🤍 Nos alegra mucho saber que tu experiencia fue positiva. Gracias por contárnoslo.'
const TEXTO_REGULAR =
  'Gracias por contarnos. 🤍 ¿Nos puedes contar qué podríamos mejorar? '
  + 'Toca el botón y escríbenos en un momento: lo lee directamente nuestro equipo.'
const TEXTO_MALA =
  'Lamentamos saber que tu experiencia no fue la esperada. 🤍\n\n'
  + 'Queremos conocer lo sucedido para poder revisar tu caso. Cuéntanos, por favor, qué ocurrió.'

// Lo que ve la familia en el formulario (el portal lo pide por GET).
export const PREGUNTA_FORMULARIO = {
  REGULAR: '¿Nos puedes contar qué podríamos mejorar?',
  MALA: 'Lamentamos saber que tu experiencia no fue la esperada. 🤍 Queremos conocer lo sucedido para poder revisar tu caso. Cuéntanos, por favor, qué ocurrió.',
}

/** Qué calificación es un botón. Tolera emojis, mayúsculas y tildes. */
export function satisfaccionDeBoton(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/\bbueno\b/.test(t)) return 'BUENA'
  if (/\bregular\b/.test(t)) return 'REGULAR'
  if (/\bmalo\b/.test(t)) return 'MALA'
  return null
}

// ─── Config ─────────────────────────────────────────────────────────────────
export async function cargarConfigEncuesta(client = pool) {
  const cfg = { ...CONFIG_DEFAULTS_ENCUESTA }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

export function plantillaEncuesta(config) {
  const raw = config.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', categoria: p.categoria || 'UTILITY' }
}

function urlResena(config) {
  const u = String(config.google_resena_url ?? '').trim().replace(/^"|"$/g, '')
  return /^https:\/\//i.test(u) ? u : null
}

export function construirEnlaceOpinion(codigo) {
  const base = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')
  return `${base}/#/opinion/${codigo}`
}

// ─── Envío de la encuesta ───────────────────────────────────────────────────
/**
 * Manda la encuesta de UNA fila POST_ENTREGA. La reclama primero
 * (PENDIENTE/ERROR → ENVIANDO) para que dos corridas no le escriban dos veces.
 * Nunca marca ENVIADO lo que no salió.
 */
export async function enviarEncuesta({ npsId, config = null, personalId = null }) {
  if (!uuidOrNull(npsId)) return { enviado: false, motivo: 'no_encontrado' }
  const cfg = config || await cargarConfigEncuesta()
  const plantilla = plantillaEncuesta(cfg)
  if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

  const { rows: [n] } = await pool.query(
    `UPDATE public.nps_seguimiento
        SET envio_estado = 'ENVIANDO',
            codigo = COALESCE(codigo, $2)
      WHERE id = $1 AND tipo = 'POST_ENTREGA'
        AND satisfaccion IS NULL
        AND COALESCE(envio_estado, 'PENDIENTE') IN ('PENDIENTE', 'ERROR')
      RETURNING id, servicio_id`,
    [npsId, nuevoCodigo()]
  )
  if (!n) return { enviado: false, motivo: 'ya_enviado' }

  const { rows: [d] } = await pool.query(
    `SELECT m.nombre AS mascota, c.whatsapp,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       FROM public.servicios s
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE s.id = $1`, [n.servicio_id])

  const destino = validoWa(d?.whatsapp)
  if (!destino) {
    await marcarError(npsId, 'El cliente no tiene un WhatsApp válido')
    return { enviado: false, motivo: 'sin_whatsapp' }
  }

  try {
    const r = await enviarPlantillaGenerica({
      telefono:        destino,
      nombre:          d.propietario || '',
      plantillaNombre: plantilla.nombre,
      idioma:          plantilla.idioma,
      category:        plantilla.categoria,
      mensaje:         CUERPO_PLANTILLA.replace('{{1}}', d.mascota || 'tu mascota'),
      bodyParams:      [d.mascota || 'tu mascota'],
      fromNumberId:    LINEA_WA_ID,
      // NULL a propósito (como mitad de compostaje): con un id puesto el agente
      // se calla 10 minutos en esa conversación, y esta plantilla es justo de
      // las que hacen que la familia responda.
      personalId:      uuidOrNull(personalId),
    })
    await pool.query(
      `UPDATE public.nps_seguimiento
          SET envio_estado = 'ENVIADO', envio_en = now(), mensaje_id = $2,
              whatsapp_destino = $3, envio_error = NULL,
              envio_intentos = envio_intentos + 1, canal = 'WHATSAPP'
        WHERE id = $1`,
      [npsId, r?.messageId || null, destino]
    )
    return { enviado: true, mensaje_id: r?.messageId || null }
  } catch (e) {
    await marcarError(npsId, e.message)
    log(TAG, 'ERROR enviando', npsId, e.message)
    return { enviado: false, motivo: 'error_envio', error: e.message }
  }
}

async function marcarError(npsId, mensaje) {
  await pool.query(
    `UPDATE public.nps_seguimiento
        SET envio_estado = 'ERROR', envio_error = $2, envio_intentos = envio_intentos + 1
      WHERE id = $1`,
    [npsId, String(mensaje || '').slice(0, 500)]
  )
}

// ─── Respuesta al botón (la llama el webhook ANTES del agente) ──────────────
/**
 * ¿Este mensaje entrante es la respuesta a una encuesta? Si lo es, la registra,
 * contesta y devuelve true → el webhook NO despierta al agente.
 *
 * Se empareja por número y no por payload: los botones de la plantilla son
 * fijos y Meta devuelve su propio texto. Se toma la última encuesta enviada a
 * ese número en 30 días.
 */
export async function manejarRespuestaEncuesta({ phoneNumberId, contacto, tipo, boton }) {
  if (!['button', 'interactive'].includes(tipo)) return false
  const satisfaccion = satisfaccionDeBoton(boton)
  if (!satisfaccion) return false
  const ultimos10 = String(contacto || '').replace(/\D/g, '').slice(-10)
  if (ultimos10.length < 10) return false

  const { rows: [n] } = await pool.query(
    `SELECT n.id, n.servicio_id, n.codigo, n.satisfaccion, n.comentario_en, n.pqr_id,
            m.nombre AS mascota
       FROM public.nps_seguimiento n
       JOIN public.servicios s ON s.id = n.servicio_id
       JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
      WHERE n.tipo = 'POST_ENTREGA' AND n.envio_estado = 'ENVIADO'
        AND n.envio_en > now() - interval '30 days'
        AND right(regexp_replace(COALESCE(n.whatsapp_destino, ''), '\\D', '', 'g'), 10) = $1
      ORDER BY n.envio_en DESC
      LIMIT 1`,
    [ultimos10]
  )
  if (!n) return false   // un «Bueno» de otra plantilla: que lo atienda el agente
  // Ya dejó su comentario: la encuesta está cerrada, pero el botón sigue siendo
  // de ella — no se le pasa al agente ni se vuelve a abrir el caso.
  if (n.comentario_en) {
    log(TAG, 'botón tocado otra vez tras comentar — ignorado', n.id, satisfaccion)
    return true
  }

  if (n.satisfaccion !== satisfaccion) {
    // Cambiar de opinión antes de comentar vale: manda la última que tocó.
    // 🪤 Los dos $2 van con ::text: sin el cast Postgres deduce varchar en uno
    // y text en el otro y rechaza la consulta («inconsistent types deduced for
    // parameter $2») — el botón no se registraba y caía al agente (11-nov).
    await pool.query(
      `UPDATE public.nps_seguimiento
          SET satisfaccion = $2::text, nps = $3, respondido_en = now(),
              estado = 'REALIZADO', fecha_realizada = public.fn_hoy_bogota(), canal = 'WHATSAPP',
              seguimiento = CASE WHEN $2::text = 'BUENA' THEN NULL ELSE 'PENDIENTE' END
        WHERE id = $1`,
      [n.id, satisfaccion, NPS_DE[satisfaccion]]
    )
    log(TAG, 'respuesta', n.id, satisfaccion)
  }

  if (satisfaccion === 'MALA' && !n.pqr_id) {
    await abrirQueja({ npsId: n.id, servicioId: n.servicio_id, mascota: n.mascota })
  }

  const cfg = await cargarConfigEncuesta()
  await responderSegunCalificacion({
    phoneNumberId, contacto, satisfaccion, codigo: n.codigo, config: cfg,
  }).catch(e => log(TAG, 'no se pudo contestar el botón', n.id, e.message))
  return true
}

async function responderSegunCalificacion({ phoneNumberId, contacto, satisfaccion, codigo, config }) {
  const linea = phoneNumberId || LINEA_WA_ID
  if (satisfaccion === 'BUENA') {
    const url = urlResena(config)
    if (!url) {
      const r = await enviarSobre({ contacto, linea, tipo: 'text', texto: TEXTO_BUENA_SIN_ENLACE,
        payload: { type: 'text', text: { body: TEXTO_BUENA_SIN_ENLACE } } })
      if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
      return r
    }
    // 🪤 El enlace de Google va ESCRITO en el texto, no en un botón cta_url:
    // WhatsApp abre los botones en su navegador interno, donde Google no ve
    // la sesión del cliente y le pide iniciar sesión para reseñar (12-nov).
    // Un enlace en el texto abre el navegador del teléfono o Google Maps.
    // La API no tiene parámetro para forzar el navegador externo en un botón.
    const texto = `${TEXTO_BUENA}\n\n⭐ Deja tu reseña aquí:\n${url}`
    const r = await enviarSobre({ contacto, linea, tipo: 'text', texto,
      payload: { type: 'text', text: { body: texto, preview_url: true } } })
    if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
    return r
  }
  const cuerpo = satisfaccion === 'MALA' ? TEXTO_MALA : TEXTO_REGULAR
  const boton = satisfaccion === 'MALA' ? 'Contarnos qué pasó' : 'Contarnos'
  return enviarCta({ contacto, linea, cuerpo, boton, url: construirEnlaceOpinion(codigo) })
}

async function enviarCta({ contacto, linea, cuerpo, boton, url }) {
  const r = await enviarSobre({
    contacto, linea, tipo: 'interactive',
    texto: `${cuerpo}\n[botón: ${boton}]`,
    payload: {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: cuerpo },
        action: { name: 'cta_url', parameters: { display_text: boton.slice(0, 20), url } },
      },
    },
  })
  if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
  return r
}

// ─── PQR y avisos internos ──────────────────────────────────────────────────
// Todo comentario de la encuesta queda como PQR (migr. 207, decisión de David
// 13-nov): Malo → QUEJA, Regular → SUGERENCIA. Coordinación puede cambiar el
// tipo y ponerle TEMA al atenderlo en /nps.
export const TIPO_PQR_DE = { REGULAR: 'SUGERENCIA', MALA: 'QUEJA' }
export const TIPOS_PQR = ['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION']
export const TEMAS_PQR = ['RECORDATORIOS', 'TIEMPOS', 'ATENCION', 'MENSAJERO', 'COBRO', 'OTRO']

const ETIQUETA = { BUENA: 'BUENO', REGULAR: 'REGULAR', MALA: 'MALO' }

function descripcionPqr(satisfaccion, comentario, canal) {
  if (!comentario) {
    return `Encuesta post-entrega: la familia calificó su experiencia como ${ETIQUETA[satisfaccion] || satisfaccion}. `
      + 'Todavía no ha escrito qué pasó (se le envió el formulario).'
  }
  const donde = canal === 'CHAT' ? 'por WhatsApp' : 'en el formulario'
  return `Encuesta post-entrega: calificó ${ETIQUETA[satisfaccion] || satisfaccion}. La familia escribió ${donde}: «${comentario}»`
}

/**
 * Abre la PQR de una encuesta (una sola por fila: candado FOR UPDATE).
 * Devuelve el id, o null si ya tenía una o si falló.
 */
async function abrirPqr({ npsId, servicioId, tipo, descripcion }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [fila] } = await client.query(
      `SELECT pqr_id FROM public.nps_seguimiento WHERE id = $1 FOR UPDATE`, [npsId])
    if (!fila || fila.pqr_id) { await client.query('ROLLBACK'); return null }
    const { rows: [p] } = await client.query(
      `INSERT INTO public.pqrs (servicio_id, tipo, canal, descripcion)
       VALUES ($1, $2, 'WHATSAPP', $3) RETURNING id`,
      [servicioId, tipo, descripcion]
    )
    await client.query(`UPDATE public.nps_seguimiento SET pqr_id = $2 WHERE id = $1`, [npsId, p.id])
    await client.query('COMMIT')
    return p.id
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    log(TAG, 'no se pudo abrir la PQR', npsId, e.message)
    return null
  } finally { client.release() }
}

/** Al tocar Malo, sin esperar el comentario: el caso no se pierde si nunca escribe. */
async function abrirQueja({ npsId, servicioId, mascota }) {
  const id = await abrirPqr({ npsId, servicioId, tipo: 'QUEJA', descripcion: descripcionPqr('MALA', null) })
  if (!id) return
  await avisarEquipo({
    servicioId, tipo: 'ENCUESTA_MALA',
    titulo: `☹️ Experiencia MALA — ${mascota || 'servicio'}`,
    mensaje: 'La familia calificó la entrega como Mala. Se abrió una PQR (queja) y se le pidió contar qué pasó.',
  })
}

/** Coordinación + Producción/Diseño. Best-effort: avisar nunca rompe el flujo. */
async function avisarEquipo({ servicioId, tipo, titulo, mensaje }) {
  try {
    await pool.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, servicio_id, datos)
       SELECT p.id, $1, $2, $3, $4, '{}'::jsonb
         FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
        WHERE r.nombre IN ('COORDINADOR', 'ADMIN', 'PRODUCTOR') AND p.activo`,
      [tipo, titulo, mensaje, servicioId]
    )
  } catch (e) { log(TAG, 'aviso al equipo no enviado:', e.message) }
}

// ─── Portal público /#/opinion/CODIGO ───────────────────────────────────────
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{10,40}$/

export async function datosPortalOpinion({ codigo }) {
  if (!CODIGO_VALIDO.test(String(codigo || ''))) return { status: 404, body: { ok: false, error: 'no_encontrado' } }
  const { rows: [n] } = await pool.query(
    `SELECT n.satisfaccion, n.comentario_en, m.nombre AS mascota
       FROM public.nps_seguimiento n
       JOIN public.servicios s ON s.id = n.servicio_id
       JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
      WHERE n.codigo = $1`, [codigo])
  if (!n) return { status: 404, body: { ok: false, error: 'no_encontrado' } }
  return { status: 200, body: {
    ok: true,
    mascota: n.mascota,
    satisfaccion: n.satisfaccion,
    ya_comento: !!n.comentario_en,
    pregunta: PREGUNTA_FORMULARIO[n.satisfaccion] || null,
  } }
}

// ─── El comentario de la familia (formulario o chat) ────────────────────────
// Lo que se le contesta por WhatsApp apenas deja su comentario (textos
// aprobados por David el 13-nov).
export const TEXTO_GRACIAS = {
  REGULAR: '🤍 Gracias por tomarte el tiempo de contarnos. Ya recibimos tu comentario y nuestro equipo lo está revisando; '
    + 'nos ayuda mucho a seguir mejorando la forma en que acompañamos a cada familia.',
  MALA: '🤍 Gracias por contarnos lo que pasó. Ya registramos tu caso y nuestro equipo lo revisará con prioridad. '
    + 'Una persona se comunicará contigo lo más pronto posible para darte respuesta.',
}

// Cuánto tiempo después de tocar Regular/Malo un texto en el chat cuenta como
// su comentario, y cuánto después del primero se le suman los siguientes (la
// gente escribe en varios mensajes seguidos). Constantes: no vienen del usuario.
const VENTANA_COMENTARIO_CHAT = '48 hours'
const VENTANA_CONTINUACION    = '15 minutes'

export async function guardarComentarioOpinion({ codigo, payload = {} }) {
  if (!CODIGO_VALIDO.test(String(codigo || ''))) return { status: 404, body: { ok: false, error: 'no_encontrado' } }
  const comentario = String(payload.comentario || '').trim().slice(0, 3000)
  if (comentario.length < 3) return { status: 400, body: { ok: false, error: 'comentario_vacio' } }

  // Una sola vez: el UPDATE condicional es el candado (dos envíos del mismo
  // formulario no duplican la alerta ni la PQR).
  const { rows: [n] } = await pool.query(
    `UPDATE public.nps_seguimiento
        SET comentario = $2, comentario_en = now(), comentario_canal = 'FORMULARIO', seguimiento = 'PENDIENTE'
      WHERE codigo = $1 AND comentario_en IS NULL
        AND satisfaccion IN ('REGULAR', 'MALA')
      RETURNING id, servicio_id, satisfaccion, pqr_id, whatsapp_destino`,
    [codigo, comentario]
  )
  if (!n) {
    const r = await datosPortalOpinion({ codigo })
    if (r.status !== 200) return r
    return { status: 409, body: { ok: false, error: r.body.ya_comento ? 'ya_comento' : 'sin_calificacion' } }
  }
  await registrarComentario({ n, comentario, canal: 'FORMULARIO', contacto: null, linea: null })
  return { status: 200, body: { ok: true } }
}

/**
 * ¿Este texto del chat es el comentario de una encuesta? La familia calificó
 * Regular o Malo y, en vez de abrir el formulario, escribió en WhatsApp. Si lo
 * es, se guarda como su comentario, se le agradece y devuelve true → el
 * webhook NO despierta al agente (decisión de David, 13-nov).
 *
 * Solo la línea de familias (de ahí sale la encuesta), solo texto y notas de
 * voz (ya transcritas), y solo en las 48 h siguientes a la calificación. Lo que
 * escriba en los 15 min siguientes al primer mensaje se le suma al comentario.
 */
export async function capturarComentarioChat({ phoneNumberId, contacto, tipo, mensajeId }) {
  if (String(phoneNumberId || '') !== String(LINEA_WA_ID)) return false
  if (!['text', 'audio'].includes(tipo)) return false
  const ultimos10 = String(contacto || '').replace(/\D/g, '').slice(-10)
  if (ultimos10.length < 10) return false

  const { rows: [n] } = await pool.query(
    `SELECT n.id, n.servicio_id, n.satisfaccion, n.pqr_id, n.whatsapp_destino,
            n.comentario_en IS NOT NULL AS continuacion
       FROM public.nps_seguimiento n
      WHERE n.tipo = 'POST_ENTREGA' AND n.envio_estado = 'ENVIADO'
        AND n.envio_en > now() - interval '30 days'
        AND n.satisfaccion IN ('REGULAR', 'MALA')
        AND right(regexp_replace(COALESCE(n.whatsapp_destino, ''), '\\D', '', 'g'), 10) = $1
        AND ((n.comentario_en IS NULL AND n.respondido_en > now() - interval '${VENTANA_COMENTARIO_CHAT}')
          OR (n.comentario_canal = 'CHAT' AND n.comentario_en > now() - interval '${VENTANA_CONTINUACION}'))
      ORDER BY n.respondido_en DESC
      LIMIT 1`,
    [ultimos10]
  )
  if (!n) return false

  // El texto se lee de la bandeja: para una nota de voz es la transcripción
  // que el webhook ya dejó ahí («[nota de voz] …»).
  const { rows: [msg] } = await pool.query(
    `SELECT texto FROM public.whatsapp_mensajes WHERE id = $1`, [mensajeId])
  const texto = String(msg?.texto || '').trim().slice(0, 3000)
    || (tipo === 'audio' ? '[nota de voz sin transcribir]' : '')
  if (!texto) return false

  if (n.continuacion) {
    const { rows: [u] } = await pool.query(
      `UPDATE public.nps_seguimiento
          SET comentario = left(COALESCE(comentario, '') || chr(10) || $2, 4000)
        WHERE id = $1 RETURNING comentario`,
      [n.id, texto]
    )
    if (n.pqr_id && u) {
      await pool.query(`UPDATE public.pqrs SET descripcion = $2 WHERE id = $1`,
        [n.pqr_id, descripcionPqr(n.satisfaccion, u.comentario, 'CHAT')])
        .catch(e => log(TAG, 'no se pudo completar la PQR', n.pqr_id, e.message))
    }
    log(TAG, 'comentario por chat (continuación)', n.id)
    return true
  }

  // Candado: solo el primero que llegue lo toma (dos mensajes casi juntos).
  const { rows: [tomado] } = await pool.query(
    `UPDATE public.nps_seguimiento
        SET comentario = $2, comentario_en = now(), comentario_canal = 'CHAT', seguimiento = 'PENDIENTE'
      WHERE id = $1 AND comentario_en IS NULL
      RETURNING id, servicio_id, satisfaccion, pqr_id, whatsapp_destino`,
    [n.id, texto]
  )
  if (!tomado) return true   // otro mensaje lo tomó en el mismo instante: ya se atendió
  await registrarComentario({ n: tomado, comentario: texto, canal: 'CHAT', contacto, linea: phoneNumberId })
  return true
}

/** PQR clasificada + aviso al equipo + agradecimiento. Nada de esto lanza. */
async function registrarComentario({ n, comentario, canal, contacto, linea }) {
  const { rows: [d] } = await pool.query(
    `SELECT m.nombre AS mascota FROM public.servicios s
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id WHERE s.id = $1`, [n.servicio_id])
  const descripcion = descripcionPqr(n.satisfaccion, comentario, canal)
  if (n.pqr_id) {
    await pool.query(`UPDATE public.pqrs SET descripcion = $2 WHERE id = $1`, [n.pqr_id, descripcion])
      .catch(e => log(TAG, 'no se pudo completar la PQR', n.pqr_id, e.message))
  } else {
    await abrirPqr({ npsId: n.id, servicioId: n.servicio_id, tipo: TIPO_PQR_DE[n.satisfaccion] || 'SUGERENCIA', descripcion })
  }
  await avisarEquipo({
    servicioId: n.servicio_id,
    tipo: n.satisfaccion === 'MALA' ? 'ENCUESTA_MALA' : 'ENCUESTA_REGULAR',
    titulo: `${n.satisfaccion === 'MALA' ? '☹️ Mala' : '😐 Regular'} — ${d?.mascota || 'servicio'}: la familia escribió`,
    mensaje: comentario.slice(0, 280),
  })
  await enviarGracias({ n, contacto, linea })
    .catch(e => log(TAG, 'no se pudo agradecer el comentario', n.id, e.message))
  log(TAG, 'comentario recibido', n.id, n.satisfaccion, canal)
}

/**
 * El agradecimiento por WhatsApp. Va como texto libre: la ventana de 24 h está
 * abierta porque la familia acaba de tocar un botón. Si escribió por el
 * formulario días después y la ventana ya cerró, Meta lo rechaza y solo queda
 * el registro (el formulario ya le dio las gracias en pantalla).
 */
async function enviarGracias({ n, contacto, linea }) {
  const texto = TEXTO_GRACIAS[n.satisfaccion]
  if (!texto) return
  const lin = linea || LINEA_WA_ID
  let destino = contacto
  if (!destino) {
    // El número del cliente puede estar sin indicativo; la conversación de la
    // bandeja tiene el número tal como lo manda Meta.
    const ultimos10 = String(n.whatsapp_destino || '').replace(/\D/g, '').slice(-10)
    if (ultimos10.length < 10) return
    const { rows: [c] } = await pool.query(
      `SELECT contacto FROM public.whatsapp_contactos
        WHERE phone_number_id = $1 AND right(contacto, 10) = $2 LIMIT 1`, [lin, ultimos10])
    destino = c?.contacto
  }
  if (!destino) return
  const r = await enviarSobre({ contacto: destino, linea: lin, tipo: 'text', texto,
    payload: { type: 'text', text: { body: texto } } })
  if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
}

// ─── Seguimiento interno (/nps) ─────────────────────────────────────────────
/**
 * Cierra un Regular/Malo. Con `tipo` y/o `tema` clasifica su PQR (y la crea si
 * no la tenía: un Regular que nunca escribió y coordinación llamó).
 */
export async function marcarAtendido({ npsId, nota = null, personalId, tipo = null, tema = null }) {
  if (!uuidOrNull(npsId)) return { status: 400, body: { ok: false, error: 'id_invalido' } }
  if (tipo && !TIPOS_PQR.includes(tipo)) return { status: 400, body: { ok: false, error: 'tipo_invalido' } }
  if (tema && !TEMAS_PQR.includes(tema)) return { status: 400, body: { ok: false, error: 'tema_invalido' } }
  const notaLimpia = String(nota || '').trim().slice(0, 2000) || null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [n] } = await client.query(
      `UPDATE public.nps_seguimiento
          SET seguimiento = 'ATENDIDO', seguimiento_nota = $2,
              atendido_por = $3, atendido_en = now()
        WHERE id = $1 AND seguimiento = 'PENDIENTE'
        RETURNING id, servicio_id, satisfaccion, pqr_id, comentario, comentario_canal`,
      [npsId, notaLimpia, uuidOrNull(personalId)]
    )
    if (!n) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'No está pendiente de seguimiento' } }
    }
    if (n.pqr_id && (tipo || tema)) {
      await client.query(
        `UPDATE public.pqrs SET tipo = COALESCE($2::text, tipo), tema = COALESCE($3::text, tema) WHERE id = $1`,
        [n.pqr_id, tipo, tema])
    } else if (!n.pqr_id && tipo) {
      const descripcion = n.comentario
        ? descripcionPqr(n.satisfaccion, n.comentario, n.comentario_canal)
        : `${descripcionPqr(n.satisfaccion, null)}${notaLimpia ? ` Seguimiento: ${notaLimpia}` : ''}`
      const { rows: [p] } = await client.query(
        `INSERT INTO public.pqrs (servicio_id, tipo, tema, canal, descripcion, registrado_por)
         VALUES ($1, $2, $3, 'WHATSAPP', $4, $5) RETURNING id`,
        [n.servicio_id, tipo, tema, descripcion, uuidOrNull(personalId)])
      await client.query(`UPDATE public.nps_seguimiento SET pqr_id = $2 WHERE id = $1`, [n.id, p.id])
    }
    await client.query('COMMIT')
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ─── Utilidades ─────────────────────────────────────────────────────────────
function nuevoCodigo() { return crypto.randomBytes(12).toString('base64url') }

function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
