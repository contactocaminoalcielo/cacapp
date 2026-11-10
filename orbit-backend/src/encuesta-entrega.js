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
    await pool.query(
      `UPDATE public.nps_seguimiento
          SET satisfaccion = $2, nps = $3, respondido_en = now(),
              estado = 'REALIZADO', fecha_realizada = public.fn_hoy_bogota(), canal = 'WHATSAPP',
              seguimiento = CASE WHEN $2 = 'BUENA' THEN NULL ELSE 'PENDIENTE' END
        WHERE id = $1`,
      [n.id, satisfaccion, NPS_DE[satisfaccion]]
    )
    log(TAG, 'respuesta', n.id, satisfaccion)
  }

  if (satisfaccion === 'MALA' && !n.pqr_id) {
    await abrirQueja({ npsId: n.id, servicioId: n.servicio_id, mascota: n.mascota, comentario: null })
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
    return enviarCta({ contacto, linea, cuerpo: TEXTO_BUENA, boton: '⭐ Dejar reseña', url })
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
async function abrirQueja({ npsId, servicioId, mascota, comentario }) {
  const descripcion = comentario
    ? `Encuesta post-entrega: calificó MALO. La familia escribió: «${comentario}»`
    : 'Encuesta post-entrega: la familia calificó su experiencia como MALA. Todavía no ha escrito qué pasó (se le envió el formulario).'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Candado por fila: dos toques casi simultáneos no abren dos quejas.
    const { rows: [fila] } = await client.query(
      `SELECT pqr_id FROM public.nps_seguimiento WHERE id = $1 FOR UPDATE`, [npsId])
    if (!fila || fila.pqr_id) { await client.query('ROLLBACK'); return }
    const { rows: [p] } = await client.query(
      `INSERT INTO public.pqrs (servicio_id, tipo, canal, descripcion)
       VALUES ($1, 'QUEJA', 'WHATSAPP', $2) RETURNING id`,
      [servicioId, descripcion]
    )
    await client.query(`UPDATE public.nps_seguimiento SET pqr_id = $2 WHERE id = $1`, [npsId, p.id])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    log(TAG, 'no se pudo abrir la PQR', npsId, e.message)
    return
  } finally { client.release() }
  await avisarEquipo({
    servicioId, tipo: 'ENCUESTA_MALA',
    titulo: `☹️ Experiencia MALA — ${mascota || 'servicio'}`,
    mensaje: comentario
      ? comentario.slice(0, 280)
      : 'La familia calificó la entrega como Mala. Se abrió una PQR (queja) y se le pidió contar qué pasó.',
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

export async function guardarComentarioOpinion({ codigo, payload = {} }) {
  if (!CODIGO_VALIDO.test(String(codigo || ''))) return { status: 404, body: { ok: false, error: 'no_encontrado' } }
  const comentario = String(payload.comentario || '').trim().slice(0, 3000)
  if (comentario.length < 3) return { status: 400, body: { ok: false, error: 'comentario_vacio' } }

  // Una sola vez: el UPDATE condicional es el candado (dos envíos del mismo
  // formulario no duplican la alerta ni la PQR).
  const { rows: [n] } = await pool.query(
    `UPDATE public.nps_seguimiento
        SET comentario = $2, comentario_en = now(), seguimiento = 'PENDIENTE'
      WHERE codigo = $1 AND comentario_en IS NULL
        AND satisfaccion IN ('REGULAR', 'MALA')
      RETURNING id, servicio_id, satisfaccion, pqr_id`,
    [codigo, comentario]
  )
  if (!n) {
    const r = await datosPortalOpinion({ codigo })
    if (r.status !== 200) return r
    return { status: 409, body: { ok: false, error: r.body.ya_comento ? 'ya_comento' : 'sin_calificacion' } }
  }

  const { rows: [d] } = await pool.query(
    `SELECT m.nombre AS mascota FROM public.servicios s
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id WHERE s.id = $1`, [n.servicio_id])

  if (n.satisfaccion === 'MALA' && !n.pqr_id) {
    // Lo normal es que la PQR ya exista (se abre al tocar Malo); esto cubre
    // que esa apertura haya fallado. abrirQueja ya avisa al equipo.
    await abrirQueja({ npsId: n.id, servicioId: n.servicio_id, mascota: d?.mascota, comentario })
  } else {
    if (n.satisfaccion === 'MALA') {
      await pool.query(
        `UPDATE public.pqrs SET descripcion = $2 WHERE id = $1`,
        [n.pqr_id, `Encuesta post-entrega: calificó MALO. La familia escribió: «${comentario}»`]
      ).catch(e => log(TAG, 'no se pudo completar la PQR', n.pqr_id, e.message))
    }
    await avisarEquipo({
      servicioId: n.servicio_id,
      tipo: n.satisfaccion === 'MALA' ? 'ENCUESTA_MALA' : 'ENCUESTA_REGULAR',
      titulo: `${n.satisfaccion === 'MALA' ? '☹️ Mala' : '😐 Regular'} — ${d?.mascota || 'servicio'}: la familia escribió`,
      mensaje: comentario.slice(0, 280),
    })
  }
  log(TAG, 'comentario recibido', n.id, n.satisfaccion)
  return { status: 200, body: { ok: true } }
}

// ─── Seguimiento interno (/nps) ─────────────────────────────────────────────
export async function marcarAtendido({ npsId, nota = null, personalId }) {
  if (!uuidOrNull(npsId)) return { status: 400, body: { ok: false, error: 'id_invalido' } }
  const { rowCount } = await pool.query(
    `UPDATE public.nps_seguimiento
        SET seguimiento = 'ATENDIDO', seguimiento_nota = $2,
            atendido_por = $3, atendido_en = now()
      WHERE id = $1 AND seguimiento = 'PENDIENTE'`,
    [npsId, String(nota || '').trim().slice(0, 2000) || null, uuidOrNull(personalId)]
  )
  return rowCount
    ? { status: 200, body: { ok: true } }
    : { status: 409, body: { ok: false, error: 'No está pendiente de seguimiento' } }
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
