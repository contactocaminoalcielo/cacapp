// Publicación automática del memorial en Instagram — Meta Graph API (Reels).
// La API solo publica video como REELS: el memorial vertical (1080x1920) es el
// formato natural; el 4:5 también se acepta pero Meta puede recortarlo.
// Flujo: APROBADO → crear contenedor → PUBLICANDO → poll hasta FINISHED →
// media_publish → leer permalink → PUBLICADO (url_publica automática).
// Requiere en el entorno del backend: IG_USER_ID + IG_ACCESS_TOKEN (token de
// larga duración, ~60 días — renovar manualmente; ver docs/Modulo_Digitales_Diseno.md).
import { pool, log } from './db.js'
import { urlArchivoAbsoluta, cargarConfigDigitales, uuidOrNull } from './digitales.js'

const GRAPH = process.env.IG_GRAPH_BASE || 'https://graph.facebook.com/v21.0'

export function igConfigurado() {
  return !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN)
}

async function graph(path, { method = 'GET', params = {} } = {}) {
  const qs = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN })
  const res = method === 'GET'
    ? await fetch(`${GRAPH}/${path}?${qs}`)
    : await fetch(`${GRAPH}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: qs.toString(),
      })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    throw new Error(json.error?.error_user_msg || json.error?.message || `HTTP ${res.status}`)
  }
  return json
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function publicarInstagram({ id, personalId }) {
  if (!igConfigurado()) {
    return { status: 422, body: { error: 'Instagram no está configurado en el backend (faltan IG_USER_ID / IG_ACCESS_TOKEN).' } }
  }
  const { rows } = await pool.query(
    `SELECT id, estado, tipo, mascota_nombre, archivo_path, formato
     FROM public.piezas_digitales WHERE id = $1`,
    [id]
  )
  const pieza = rows[0]
  if (!pieza) return { status: 404, body: { error: 'Pieza no encontrada' } }
  if (!pieza.archivo_path) return { status: 422, body: { error: 'Esta pieza no tiene archivo para publicar.' } }
  if (!['APROBADO', 'PUBLICANDO'].includes(pieza.estado)) {
    return { status: 422, body: { error: 'Aprueba el memorial antes de publicarlo en Instagram.' } }
  }

  const cfg = await cargarConfigDigitales()
  const plantilla = typeof cfg.caption_instagram === 'string'
    ? cfg.caption_instagram
    : 'En memoria de {mascota} 🕊️'
  const caption = plantilla.replaceAll('{mascota}', pieza.mascota_nombre || '')

  let container
  try {
    container = await graph(`${process.env.IG_USER_ID}/media`, {
      method: 'POST',
      params: {
        media_type: 'REELS',
        video_url: urlArchivoAbsoluta(pieza.id),
        caption,
        share_to_feed: 'true',
      },
    })
  } catch (e) {
    log('[digitales/ig] contenedor ERROR', pieza.id, e.message)
    return { status: 502, body: { error: `Instagram rechazó la publicación: ${e.message}` } }
  }

  await pool.query(
    `UPDATE public.piezas_digitales
     SET estado='PUBLICANDO', publicacion_media_id=$2, error=NULL, updated_at=now()
     WHERE id=$1`,
    [pieza.id, container.id]
  )
  // Poll en segundo plano — la respuesta no espera a Meta (tarda 30s–3min).
  pollYPublicar(pieza.id, container.id, uuidOrNull(personalId))
    .catch(e => log('[digitales/ig] poll ERROR', pieza.id, e.message))

  return { status: 200, body: { ok: true, estado: 'PUBLICANDO' } }
}

async function pollYPublicar(piezaId, containerId, actor) {
  const fallar = async (msg) => {
    await pool.query(
      `UPDATE public.piezas_digitales
       SET estado='APROBADO', error=$2, updated_at=now() WHERE id=$1`,
      [piezaId, `Instagram: ${msg}`.slice(0, 500)]
    )
    log('[digitales/ig] publicación falló', piezaId, msg)
  }

  try {
    let listo = false
    for (let i = 0; i < 40; i++) {           // ~7 min máximo
      await sleep(i < 6 ? 5000 : 12000)
      const st = await graph(containerId, { params: { fields: 'status_code,status' } })
      if (st.status_code === 'FINISHED') { listo = true; break }
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') {
        return fallar(st.status || st.status_code)
      }
    }
    if (!listo) return fallar('Meta no terminó de procesar el video (timeout). Reintenta.')

    const pub = await graph(`${process.env.IG_USER_ID}/media_publish`, {
      method: 'POST',
      params: { creation_id: containerId },
    })
    let permalink = null
    try {
      permalink = (await graph(pub.id, { params: { fields: 'permalink' } })).permalink
    } catch { /* sin permalink no bloquea: queda publicado y el enlace se corrige a mano */ }

    await pool.query(
      `UPDATE public.piezas_digitales
       SET estado='PUBLICADO', url_publica=COALESCE($2, url_publica),
           publicacion_media_id=$3, publicado_auto=true,
           publicado_por=COALESCE($4, publicado_por), publicado_en=now(),
           error=NULL, updated_at=now()
       WHERE id=$1`,
      [piezaId, permalink, pub.id, actor]
    )
    log('[digitales/ig] publicado', piezaId, permalink || '(sin permalink)')
  } catch (e) {
    await fallar(e.message)
  }
}
