// Archivos recibidos por WhatsApp (migración 094).
//
// Meta NO manda el archivo en el webhook: manda un `id`. Bajarlo son DOS
// llamadas y la URL intermedia vive minutos:
//
//   1. GET /{version}/{media_id}      → { url, mime_type, sha256, file_size }
//   2. GET {url}  con el MISMO Bearer → los bytes
//
// El paso 2 sorprende: es una URL de lookaside.fbsbx.com y AUN ASÍ exige el
// header Authorization. Sin él devuelve un 401 en HTML, no en JSON.
//
// Se baja en el momento de recibir el mensaje. No hay segunda oportunidad
// cómoda: Meta conserva el archivo unos días y la URL, minutos.
import { pool, log } from './db.js'

const MOD = '[wa-media]'
const GRAPH = 'https://graph.facebook.com'

/**
 * Tope de lo que se guarda. Los límites de WhatsApp son 5 MB para imagen y
 * 16 MB para audio y video; 20 cubre todo salvo documentos grandes, que es
 * justo lo que no queremos dentro de la base.
 */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Lo que el modelo puede mirar. Es la lista de Claude, no la de WhatsApp: los
 * stickers animados son webp pero se rechazan, así que quedan fuera aunque el
 * formato encaje.
 */
const MIRABLES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function elModeloPuedeVerlo(mime) {
  return MIRABLES.has(String(mime || '').split(';')[0].trim().toLowerCase())
}

/**
 * Baja el archivo de un mensaje y lo guarda. Nunca lanza: que no se pueda bajar
 * una foto no puede tumbar la recepción del mensaje ni al agente. Deja el motivo
 * en la fila para que se vea en la bandeja en vez de desaparecer.
 *
 * @returns {Promise<{ok:boolean, mime?:string, bytes?:number, error?:string}>}
 */
export async function guardarMedia({ mensajeId, waMediaId, mimeDeclarado }) {
  if (!mensajeId || !waMediaId) return { ok: false, error: 'faltan datos del adjunto' }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) {
    await registrar({ mensajeId, waMediaId, error: 'WHATSAPP_ACCESS_TOKEN no configurado' })
    return { ok: false, error: 'sin token' }
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v26.0'
  const auth = { Authorization: `Bearer ${token}` }

  try {
    // ── 1. El id se cambia por una URL firmada ──
    const meta = await fetch(`${GRAPH}/${version}/${waMediaId}`, { headers: auth })
    const info = await meta.json().catch(() => ({}))
    if (!meta.ok || !info?.url) {
      const detalle = info?.error?.message || `Error ${meta.status}`
      await registrar({ mensajeId, waMediaId, mime: mimeDeclarado, error: `no se pudo resolver: ${detalle}` })
      log(MOD, `Meta no dio URL para ${waMediaId} —`, detalle)
      return { ok: false, error: detalle }
    }

    const mime = (info.mime_type || mimeDeclarado || 'application/octet-stream').split(';')[0].trim()
    const tam = Number(info.file_size || 0)
    if (tam > MAX_BYTES) {
      // Se registra igual: en la bandeja tiene que verse que llegó algo y por
      // qué no está, en vez de un hueco sin explicación.
      await registrar({ mensajeId, waMediaId, mime, bytes: tam, error: `pesa ${(tam / 1048576).toFixed(1)} MB, por encima del tope de ${MAX_BYTES / 1048576} MB` })
      log(MOD, `${waMediaId} descartado por tamaño (${tam} bytes)`)
      return { ok: false, error: 'demasiado grande' }
    }

    // ── 2. La URL firmada TAMBIÉN pide el token ──
    const bin = await fetch(info.url, { headers: auth })
    if (!bin.ok) {
      await registrar({ mensajeId, waMediaId, mime, error: `descarga rechazada: ${bin.status}` })
      log(MOD, `descarga rechazada para ${waMediaId} — ${bin.status}`)
      return { ok: false, error: `descarga ${bin.status}` }
    }

    const buf = Buffer.from(await bin.arrayBuffer())
    if (!buf.length) {
      await registrar({ mensajeId, waMediaId, mime, error: 'llegó vacío' })
      return { ok: false, error: 'vacío' }
    }
    // El tamaño anunciado puede mentir; el que manda es el que llegó.
    if (buf.length > MAX_BYTES) {
      await registrar({ mensajeId, waMediaId, mime, bytes: buf.length, error: 'superó el tope al descargar' })
      return { ok: false, error: 'demasiado grande' }
    }

    await registrar({
      mensajeId, waMediaId, mime, bytes: buf.length,
      sha256: info.sha256 || null, archivo: buf,
    })
    log(MOD, `guardado ${mime} de ${buf.length} bytes para el mensaje ${mensajeId}`)
    return { ok: true, mime, bytes: buf.length }
  } catch (e) {
    await registrar({ mensajeId, waMediaId, mime: mimeDeclarado, error: e.message }).catch(() => {})
    log(MOD, `ERROR bajando ${waMediaId} —`, e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Una fila por mensaje, se haya podido bajar o no. El UPDATE del conflicto
 * permite reintentar un fallo sin dejar duplicados.
 */
async function registrar({ mensajeId, waMediaId, mime = null, bytes = null, sha256 = null, archivo = null, error = null }) {
  await pool.query(
    `INSERT INTO public.whatsapp_media (mensaje_id, wa_media_id, mime, bytes, sha256, archivo, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (mensaje_id) DO UPDATE
       SET wa_media_id = EXCLUDED.wa_media_id,
           mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
           archivo = EXCLUDED.archivo, error = EXCLUDED.error`,
    [mensajeId, waMediaId, mime, bytes, sha256, archivo, error]
  ).catch(e => log(MOD, 'no se pudo registrar el adjunto —', e.message))
}

/**
 * Los bytes, para servirlos a la bandeja. Devuelve también el contacto: quien
 * pide un archivo por id no debe poder pescar los de otra conversación sin que
 * quede claro de dónde salen.
 */
export async function leerMedia(mensajeId) {
  const id = parseInt(mensajeId, 10)
  if (!Number.isFinite(id)) return null

  const { rows } = await pool.query(
    `SELECT m.archivo, m.mime, m.bytes, m.error, w.contacto, w.tipo
       FROM public.whatsapp_media m
       JOIN public.whatsapp_mensajes w ON w.id = m.mensaje_id
      WHERE m.mensaje_id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * Las imágenes recientes de una conversación, para dárselas al modelo.
 *
 * Se limitan a propósito: cada imagen son ~1.500 tokens y el historial NO se
 * cachea, así que una foto vieja se re-cobra en cada turno de la conversación.
 * Con las últimas basta — la vet pregunta por lo que acaba de mandar.
 */
/**
 * De ESTOS mensajes concretos, cuántas imágenes puede ver el modelo y cuántas no.
 *
 * Se pregunta por id y no "¿hay alguna foto reciente?" por una razón que parece
 * un detalle y no lo es: si la vet manda dos fotos y una falla al bajarse, la
 * pregunta vaga responde que sí y el agente contesta sobre la que sí tiene
 * mientras ella pregunta por la otra. Con los ids exactos se puede hacer lo
 * correcto con las dos: responder la que se ve y disculparse por la que no.
 */
export async function revisarImagenes(mensajeIds) {
  const ids = (mensajeIds || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return { visibles: 0, fallidas: 0 }

  const { rows: [r] } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE md.archivo IS NOT NULL AND md.mime = ANY($2))::int AS visibles,
       count(*) FILTER (WHERE md.archivo IS NULL OR NOT (md.mime = ANY($2)))::int AS fallidas
       FROM public.whatsapp_mensajes w
       LEFT JOIN public.whatsapp_media md ON md.mensaje_id = w.id
      WHERE w.id = ANY($1) AND w.tipo = 'image'`,
    [ids, [...MIRABLES]]
  )
  return { visibles: r?.visibles || 0, fallidas: r?.fallidas || 0 }
}

export async function imagenesRecientes(contacto, tope = 2) {
  const { rows } = await pool.query(
    `SELECT m.mensaje_id, m.mime, m.archivo
       FROM public.whatsapp_media m
       JOIN public.whatsapp_mensajes w ON w.id = m.mensaje_id
      WHERE w.contacto = $1 AND w.direccion = 'IN'
        AND m.archivo IS NOT NULL
        AND m.mime = ANY($2)
      ORDER BY w.ocurrido_en DESC, w.id DESC
      LIMIT $3`,
    [contacto, [...MIRABLES], tope]
  )
  return rows.reverse()
}
