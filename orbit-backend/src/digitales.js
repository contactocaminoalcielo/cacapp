// Digitales — piezas digitales publicables por servicio (evolución de memorial.js).
// MEMORIAL: render propio (Remotion) → Instagram. VIDEO/SHORT: se hacen en Canva,
// se publican a mano en YouTube y aquí solo se registra el enlace.
// Envío al cliente: registrado en digitales_envios + marca ENTREGADO los
// servicio_recordatorios digitales correspondientes.
// Diseño: docs/Modulo_Digitales_Diseno.md · Migración: 035_digitales.sql
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { pool, log } from './db.js'
import { enviarPlantillaGenerica, consultarEstadoMensajeGHL } from './whatsapp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RENDER_ENTRY = path.join(__dirname, '..', 'memorial', 'render.mjs')
const APP_ROOT = path.join(__dirname, '..')
const DATA_DIR = process.env.MEMORIAL_DATA_DIR || '/data/memoriales'
const SIGN_SECRET = process.env.MEMORIAL_SIGN_SECRET || process.env.JWT_SECRET || 'dev-secret'
// Base pública del API (nginx /api → backend) — para URLs que Meta debe poder descargar.
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || 'https://orbit.orbitacac.com/api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function uuidOrNull(v) {
  if (!v) return null
  const s = String(v)
  return UUID_RE.test(s) ? s : null
}

const TIPOS = ['MEMORIAL', 'VIDEO', 'SHORT']

const CONFIG_DEFAULTS = {
  activo: true,
  planes_excluidos: ['ANGEL', 'DESAMPARADO'],
  formato: '1080x1350',
  frase: 'Siempre en nuestro corazón',
}

async function cargarConfig(client) {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'MEMORIAL'`
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

export async function cargarConfigDigitales(client = pool) {
  const cfg = {}
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'DIGITALES'`
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

// Encuadre de la foto {zoom, posX, posY} — validado a rangos seguros.
function normalizarAjuste(a) {
  if (!a || typeof a !== 'object') return null
  const num = (v, d, min, max) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
  }
  return {
    zoom: num(a.zoom, 1, 1, 3),
    posX: num(a.posX, 50, 0, 100),
    posY: num(a.posY, 50, 0, 100),
  }
}

// El cliente carga una foto por recordatorio: la del memorial es la del
// recordatorio mapeado en recordatorios_tipo.MEMORIAL. Si ese recordatorio no
// trae foto, se cae a la primera imagen que haya enviado.
async function recordatorioMemorial(client) {
  const cfg = await cargarConfigDigitales(client)
  const mapa = (cfg.recordatorios_tipo && typeof cfg.recordatorios_tipo === 'object') ? cfg.recordatorios_tipo : {}
  return uuidOrNull(mapa.MEMORIAL)
}

// Fragmento reutilizable: foto del servicio, priorizando la del memorial.
// `pRec` es el placeholder ($1, $2…) que lleva el recordatorio del memorial.
function fotoLateral(pRec) {
  return `LEFT JOIN LATERAL (
         SELECT COALESCE(sr.imagen_cliente_url, sr.imagenes_cliente_urls[1]) AS foto_url
         FROM public.servicio_recordatorios sr
         WHERE sr.servicio_id = s.id
           AND (sr.imagen_cliente_url IS NOT NULL
                OR COALESCE(array_length(sr.imagenes_cliente_urls, 1), 0) > 0)
         ORDER BY (sr.recordatorio_id = ${pRec}::uuid) DESC NULLS LAST, sr.created_at ASC
         LIMIT 1
       ) f ON true`
}

// El cliente puede decir "no deseo este recordatorio" en el portal de imágenes:
// esa fila queda en `servicio_recordatorios.estado = 'NA'` (ver imagenes.js). Un
// digital declinado NO se genera ni se envía, pero SÍ se muestra en el módulo
// como "el cliente no lo desea" — antes desaparecía sin explicación del pipeline
// y seguía apareciendo con botón "Generar" en Por generar.
// Un recordatorio cuenta como declinado solo si TODAS sus filas vivas están en
// 'NA' (un servicio puede llevar el mismo recordatorio dos veces).
function declinadosLateral(pRecIds, alias = 'na') {
  return `LEFT JOIN LATERAL (
         SELECT array_agg(x.rid::text) AS rec_ids
         FROM (
           SELECT sr.recordatorio_id AS rid
           FROM public.servicio_recordatorios sr
           WHERE sr.servicio_id = s.id
             AND sr.recordatorio_id = ANY(${pRecIds}::uuid[])
             AND COALESCE(sr.origen, '') <> 'REMOVIDO'
           GROUP BY sr.recordatorio_id
           HAVING COUNT(*) FILTER (WHERE sr.estado <> 'NA') = 0
         ) x
       ) ${alias} ON true`
}

// ¿El cliente declinó el memorial de este servicio? (mismo criterio que arriba)
async function memorialDeclinado(client, servicioId, recMemorial) {
  if (!uuidOrNull(recMemorial)) return false
  const { rows } = await client.query(
    `SELECT COUNT(*) > 0 AND COUNT(*) FILTER (WHERE sr.estado <> 'NA') = 0 AS declinado
     FROM public.servicio_recordatorios sr
     WHERE sr.servicio_id = $1
       AND sr.recordatorio_id = $2::uuid
       AND COALESCE(sr.origen, '') <> 'REMOVIDO'`,
    [servicioId, recMemorial]
  )
  return rows[0]?.declinado === true
}

async function fotoDelServicio(client, servicioId, recMemorial) {
  const { rows } = await client.query(
    `SELECT sr.imagen_cliente_url, sr.imagenes_cliente_urls
     FROM public.servicio_recordatorios sr
     WHERE sr.servicio_id = $1
       AND (sr.imagen_cliente_url IS NOT NULL
            OR COALESCE(array_length(sr.imagenes_cliente_urls, 1), 0) > 0)
     ORDER BY (sr.recordatorio_id = $2::uuid) DESC NULLS LAST, sr.created_at ASC`,
    [servicioId, uuidOrNull(recMemorial)]
  )
  for (const r of rows) {
    if (r.imagen_cliente_url) return r.imagen_cliente_url
    if (Array.isArray(r.imagenes_cliente_urls) && r.imagenes_cliente_urls[0]) return r.imagenes_cliente_urls[0]
  }
  return null
}

// ── Enlace firmado del archivo (para <video> y descarga sin header de auth) ──
function firmarToken(id, ttlSec = 6 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const h = crypto.createHmac('sha256', SIGN_SECRET).update(`${id}.${exp}`).digest('hex').slice(0, 32)
  return `${exp}.${h}`
}
function verificarToken(id, t) {
  if (!t) return false
  const [exp, h] = String(t).split('.')
  if (!exp || !h) return false
  if (parseInt(exp) * 1000 < Date.now()) return false
  const good = crypto.createHmac('sha256', SIGN_SECRET).update(`${id}.${exp}`).digest('hex').slice(0, 32)
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(good)) } catch { return false }
}
function urlArchivo(id) {
  return `/digitales/${id}/archivo?t=${firmarToken(id)}`
}
// URL absoluta con TTL largo — Meta descarga el video desde aquí al publicar el Reel.
export function urlArchivoAbsoluta(id, ttlSec = 24 * 3600) {
  return `${PUBLIC_API_BASE}/digitales/${id}/archivo?t=${firmarToken(id, ttlSec)}`
}

// ── Normalización de enlaces de YouTube (video/short hechos en Canva) ──
export function normalizarYoutube(url) {
  const s = String(url || '').trim()
  let m = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,20})/i)
  if (m) return `https://www.youtube.com/shorts/${m[1]}`
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{6,20})/i)
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  m = s.match(/youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|embed\/)([A-Za-z0-9_-]{6,20})/i)
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`
  return null
}

// "Copiar enlace" de Instagram agrega ?utm_source=...&igsh=... (~50 chars) que
// desbordan el límite de 1024 del cuerpo de la plantilla HSM de Meta (#132005:
// texto de la plantilla + parámetros). Canonizar deja la URL en ~43 chars.
export function limpiarUrlInstagram(url) {
  const s = String(url || '').trim()
  const m = s.match(/instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/i)
  if (m) return `https://www.instagram.com/${m[1].toLowerCase()}/${m[2]}/`
  if (/instagram\.com/i.test(s)) return s.split(/[?#]/)[0]
  return s
}

// ── Candidatos a memorial: imagen lista, plan no excluido, sin memorial activo ──
export async function listarCandidatos() {
  const client = await pool.connect()
  try {
    const cfg = await cargarConfig(client)
    const excl = Array.isArray(cfg.planes_excluidos) ? cfg.planes_excluidos : []
    const recMemorial = await recordatorioMemorial(client)
    const { rows } = await client.query(
      `SELECT s.id AS servicio_id,
              to_char(s.fecha_imagenes_recibidas, 'YYYY-MM-DD') AS fecha_imagenes,
              m.nombre AS mascota, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              COALESCE(NULLIF(TRIM(c.whatsapp), ''), NULLIF(TRIM(c.telefono), ''), NULLIF(TRIM(c.telefono2), '')) AS telefono,
              f.foto_url,
              COALESCE(d.declinado, false) AS memorial_declinado
       FROM public.servicios s
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p    ON p.id = s.plan_id
       LEFT JOIN public.piezas_digitales mem
         ON mem.servicio_id = s.id AND mem.tipo = 'MEMORIAL'
       ${fotoLateral('$2')}
       LEFT JOIN LATERAL (
         SELECT COUNT(*) > 0 AND COUNT(*) FILTER (WHERE sr.estado <> 'NA') = 0 AS declinado
         FROM public.servicio_recordatorios sr
         WHERE sr.servicio_id = s.id
           AND sr.recordatorio_id = $2::uuid
           AND COALESCE(sr.origen, '') <> 'REMOVIDO'
       ) d ON true
       WHERE s.fecha_imagenes_recibidas IS NOT NULL
         AND s.estado <> 'CANCELADO'
         AND (p.codigo IS NULL OR NOT (p.codigo = ANY($1::text[])))
         AND (mem.id IS NULL OR mem.estado IN ('ERROR', 'DESCARTADO'))
       ORDER BY COALESCE(d.declinado, false) ASC, s.fecha_imagenes_recibidas DESC
       LIMIT 300`,
      [excl, recMemorial]
    )
    return rows
  } finally { client.release() }
}

// ── Vista principal: servicios con sus piezas digitales, esperadas y envíos ──
export async function listarServicios() {
  const client = await pool.connect()
  try {
    const cfg = await cargarConfigDigitales(client)
    const mapa = (cfg.recordatorios_tipo && typeof cfg.recordatorios_tipo === 'object') ? cfg.recordatorios_tipo : {}
    const recIds = TIPOS.map(t => mapa[t]).filter(Boolean)
    const tipoPorRec = {}
    TIPOS.forEach(t => { if (mapa[t]) tipoPorRec[mapa[t]] = t })

    const { rows: servicios } = await client.query(
      `SELECT s.id AS servicio_id,
              to_char(s.fecha_imagenes_recibidas, 'YYYY-MM-DD') AS fecha_imagenes,
              m.nombre AS mascota,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              COALESCE(NULLIF(TRIM(c.whatsapp), ''), NULLIF(TRIM(c.telefono), ''), NULLIF(TRIM(c.telefono2), '')) AS telefono,
              p.codigo AS plan_codigo, p.nombre AS plan_nombre,
              f.foto_url,
              COALESCE(e.rec_ids, '{}') AS rec_ids,
              COALESCE(na.rec_ids, '{}') AS rec_ids_na
       FROM public.servicios s
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p   ON p.id = s.plan_id
       ${fotoLateral('$2')}
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT sr.recordatorio_id::text) AS rec_ids
         FROM public.servicio_recordatorios sr
         WHERE sr.servicio_id = s.id
           AND sr.recordatorio_id = ANY($1::uuid[])
           AND sr.estado <> 'NA'
           AND COALESCE(sr.origen, '') <> 'REMOVIDO'
       ) e ON true
       ${declinadosLateral('$1')}
       WHERE s.estado <> 'CANCELADO'
         AND s.fecha_imagenes_recibidas IS NOT NULL
         AND (e.rec_ids IS NOT NULL
              OR na.rec_ids IS NOT NULL
              OR EXISTS (SELECT 1 FROM public.piezas_digitales pd WHERE pd.servicio_id = s.id))
       ORDER BY s.fecha_imagenes_recibidas DESC
       LIMIT 200`,
      [recIds.length ? recIds : ['00000000-0000-0000-0000-000000000000'], uuidOrNull(mapa.MEMORIAL)]
    )

    const ids = servicios.map(s => s.servicio_id)
    let piezas = [], envios = []
    if (ids.length) {
      const [pz, ev] = await Promise.all([
        client.query(
          `SELECT id, servicio_id, tipo, estado, plataforma, mascota_nombre, fecha_texto,
                  formato, archivo_path, error, url_publica, publicado_auto, ajuste_foto,
                  generado_en, aprobado_en, publicado_en, updated_at
           FROM public.piezas_digitales
           WHERE servicio_id = ANY($1::uuid[])`,
          [ids]
        ),
        client.query(
          `SELECT de.id, de.servicio_id, de.canal, de.telefono, de.enlaces, de.mensaje, de.enviado_en,
                  de.estado, de.error, de.plantilla,
                  TRIM(COALESCE(per.nombre,'') || ' ' || COALESCE(per.apellido,'')) AS enviado_por_nombre
           FROM public.digitales_envios de
           LEFT JOIN public.personal per ON per.id = de.enviado_por
           WHERE de.servicio_id = ANY($1::uuid[])
           ORDER BY de.enviado_en DESC`,
          [ids]
        ),
      ])
      piezas = pz.rows
      envios = ev.rows
    }

    const porServicio = Object.fromEntries(servicios.map(s => [s.servicio_id, s]))
    servicios.forEach(s => {
      s.esperadas = TIPOS.filter(t => (s.rec_ids || []).includes(String(mapa[t] || '')))
      // Declinados por el cliente: se informan aparte de `esperadas` para que no
      // entren en el progreso ni en la elección de plantilla de envío.
      s.declinadas = TIPOS.filter(t =>
        (s.rec_ids_na || []).includes(String(mapa[t] || '')) && !s.esperadas.includes(t))
      delete s.rec_ids
      delete s.rec_ids_na
      s.piezas = []
      s.envios = []
    })
    piezas.forEach(p => {
      p.archivo_url = p.archivo_path ? urlArchivo(p.id) : null
      delete p.archivo_path
      porServicio[p.servicio_id]?.piezas.push(p)
    })
    envios.forEach(e => porServicio[e.servicio_id]?.envios.push(e))

    return {
      servicios,
      ig_configurado: !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN),
      plantillas: {
        mensaje_cliente: typeof cfg.mensaje_cliente === 'string' ? cfg.mensaje_cliente : '',
        caption_instagram: typeof cfg.caption_instagram === 'string' ? cfg.caption_instagram : '',
      },
      zolutium: infoZolutium(cfg),
    }
  } finally { client.release() }
}

// ── Generar memorial (render async en segundo plano) ──
const FORMATOS = ['1080x1350', '1080x1920']

export async function generarMemorial({ servicioId, personalId, formato: formatoReq, ajuste }) {
  const actor = uuidOrNull(personalId)
  const ajusteNorm = normalizarAjuste(ajuste)   // null si no se envió → conserva el guardado
  const client = await pool.connect()
  let piezaId = null, payload = null
  try {
    await client.query('BEGIN')
    const cfg = await cargarConfig(client)
    if (cfg.activo === false) { await client.query('ROLLBACK'); return { status: 422, body: { error: 'El módulo de memoriales está desactivado.' } } }
    const excl = Array.isArray(cfg.planes_excluidos) ? cfg.planes_excluidos : []

    const { rows: svcRows } = await client.query(
      `SELECT s.id, s.estado, s.fecha_imagenes_recibidas,
              to_char(s.fecha_ingreso, 'FMDD · FMMM · YYYY') AS fecha_texto,
              m.nombre AS mascota, p.codigo AS plan_codigo
       FROM public.servicios s
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       LEFT JOIN public.planes p ON p.id = s.plan_id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [servicioId]
    )
    const svc = svcRows[0]
    if (!svc) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Servicio no encontrado' } } }
    if (svc.estado === 'CANCELADO') { await client.query('ROLLBACK'); return { status: 422, body: { error: 'El servicio está cancelado.' } } }
    if (!svc.fecha_imagenes_recibidas) { await client.query('ROLLBACK'); return { status: 422, body: { error: 'Aún no se han recibido las imágenes del cliente.' } } }
    if (svc.plan_codigo && excl.includes(svc.plan_codigo)) { await client.query('ROLLBACK'); return { status: 422, body: { error: `El plan ${svc.plan_codigo} no lleva memorial.` } } }

    // El cliente pudo declinar el memorial en el portal de imágenes. La UI ya no
    // ofrece "Generar" en ese caso, pero una pestaña vieja (o la PWA en caché)
    // sí puede llamar aquí: la decisión se valida contra la DB.
    const recMemorial = await recordatorioMemorial(client)
    if (await memorialDeclinado(client, servicioId, recMemorial)) {
      await client.query('ROLLBACK')
      return { status: 422, body: { error: 'El cliente indicó que no desea el memorial.' } }
    }

    const foto = await fotoDelServicio(client, servicioId, recMemorial)
    if (!foto) { await client.query('ROLLBACK'); return { status: 422, body: { error: 'No hay una foto del cliente para este servicio.' } } }

    const frase = typeof cfg.frase === 'string' ? cfg.frase : CONFIG_DEFAULTS.frase
    const formato = FORMATOS.includes(formatoReq) ? formatoReq
      : (FORMATOS.includes(cfg.formato) ? cfg.formato : CONFIG_DEFAULTS.formato)
    const compositionId = formato === '1080x1920' ? 'MemorialVertical' : 'Memorial'

    const { rows: up } = await client.query(
      `INSERT INTO public.piezas_digitales
         (servicio_id, tipo, plataforma, estado, mascota_nombre, fecha_texto, formato, ajuste_foto, intentos, generado_por, generado_en, error)
       VALUES ($1, 'MEMORIAL', 'INSTAGRAM', 'GENERANDO', $2, $3, $4, $6::jsonb, 1, $5, NULL, NULL)
       ON CONFLICT (servicio_id, tipo) DO UPDATE SET
         estado = 'GENERANDO',
         mascota_nombre = EXCLUDED.mascota_nombre,
         fecha_texto = EXCLUDED.fecha_texto,
         formato = EXCLUDED.formato,
         ajuste_foto = COALESCE($6::jsonb, public.piezas_digitales.ajuste_foto),
         intentos = public.piezas_digitales.intentos + 1,
         generado_por = EXCLUDED.generado_por,
         error = NULL,
         updated_at = now()
       RETURNING id, ajuste_foto`,
      [servicioId, svc.mascota, svc.fecha_texto, formato, actor, ajusteNorm ? JSON.stringify(ajusteNorm) : null]
    )
    piezaId = up[0].id
    const ajusteEfectivo = up[0].ajuste_foto || {}
    payload = { name: svc.mascota, date: svc.fecha_texto, photo: foto, frase, compositionId, ...ajusteEfectivo }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }

  // Render fuera de la transacción y sin bloquear la respuesta.
  runRender(piezaId, payload).catch(err => log('[digitales] runRender ERROR', err.message))
  return { status: 200, body: { ok: true, id: piezaId, estado: 'GENERANDO' } }
}

async function runRender(piezaId, payload) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true })
  const outPath = path.join(DATA_DIR, `${piezaId}.mp4`)
  const child = spawn('node', [RENDER_ENTRY, JSON.stringify({ ...payload, outPath })], {
    cwd: APP_ROOT, env: process.env,
  })
  let out = '', err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })

  await new Promise((resolve) => {
    child.on('close', async (code) => {
      let ok = false, error = null
      try {
        const last = out.trim().split('\n').pop() || '{}'
        const j = JSON.parse(last)
        ok = j.ok === true; error = j.error || null
      } catch { error = (err || `exit ${code}`).slice(0, 500) }
      try {
        if (ok && fs.existsSync(outPath)) {
          await pool.query(
            `UPDATE public.piezas_digitales SET estado='GENERADO', archivo_path=$2, generado_en=now(), error=NULL, updated_at=now() WHERE id=$1`,
            [piezaId, `${piezaId}.mp4`]
          )
          log('[digitales] memorial generado', piezaId)
        } else {
          await pool.query(
            `UPDATE public.piezas_digitales SET estado='ERROR', error=$2, updated_at=now() WHERE id=$1`,
            [piezaId, (error || 'El render falló').slice(0, 500)]
          )
          log('[digitales] render ERROR', piezaId, error)
        }
      } catch (e) { log('[digitales] update post-render ERROR', e.message) }
      resolve()
    })
  })
}

export async function aprobarMemorial({ id, personalId }) {
  const actor = uuidOrNull(personalId)
  const { rows } = await pool.query(`SELECT estado FROM public.piezas_digitales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Pieza no encontrada' } }
  if (!['GENERADO', 'APROBADO', 'PUBLICADO'].includes(rows[0].estado))
    return { status: 422, body: { error: 'Solo se aprueba un memorial ya generado.' } }
  await pool.query(
    `UPDATE public.piezas_digitales SET estado='APROBADO', aprobado_por=$2, aprobado_en=now(), updated_at=now() WHERE id=$1`,
    [id, actor]
  )
  return { status: 200, body: { ok: true } }
}

// Registro manual del enlace de una pieza ya publicada (fallback del memorial
// cuando no hay publicación automática; también corrige un enlace equivocado).
export async function publicarManual({ id, personalId, url }) {
  const actor = uuidOrNull(personalId)
  const { rows } = await pool.query(`SELECT estado, plataforma FROM public.piezas_digitales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Pieza no encontrada' } }

  let final = (url || '').trim()
  if (rows[0].plataforma === 'YOUTUBE') {
    final = normalizarYoutube(final)
    if (!final) return { status: 422, body: { error: 'Pega un enlace de YouTube válido.' } }
  } else if (!/^https?:\/\//i.test(final)) {
    return { status: 422, body: { error: 'El enlace no es válido (https://…).' } }
  } else {
    final = limpiarUrlInstagram(final)
  }

  await pool.query(
    `UPDATE public.piezas_digitales
     SET estado='PUBLICADO', url_publica=$2, publicado_auto=false,
         publicado_por=$3, publicado_en=now(), updated_at=now()
     WHERE id=$1`,
    [id, final, actor]
  )
  return { status: 200, body: { ok: true } }
}

// VIDEO/SHORT hechos en Canva: registrar el enlace de YouTube crea (o actualiza)
// la pieza directamente en PUBLICADO — no pasan por el pipeline de render.
export async function registrarEnlace({ servicioId, tipo, url, personalId }) {
  const actor = uuidOrNull(personalId)
  if (!['VIDEO', 'SHORT'].includes(tipo))
    return { status: 422, body: { error: 'Tipo de pieza inválido (VIDEO o SHORT).' } }
  const final = normalizarYoutube(url)
  if (!final) return { status: 422, body: { error: 'Pega un enlace de YouTube válido (watch, youtu.be o shorts).' } }

  const { rows: svc } = await pool.query(
    `SELECT m.nombre AS mascota
     FROM public.servicios s JOIN public.mascotas m ON m.id_mascota = s.mascota_id
     WHERE s.id = $1`,
    [servicioId]
  )
  if (!svc[0]) return { status: 404, body: { error: 'Servicio no encontrado' } }

  const { rows } = await pool.query(
    `INSERT INTO public.piezas_digitales
       (servicio_id, tipo, plataforma, estado, mascota_nombre, formato, url_publica, publicado_auto, publicado_por, publicado_en)
     VALUES ($1, $2, 'YOUTUBE', 'PUBLICADO', $3, NULL, $4, false, $5, now())
     ON CONFLICT (servicio_id, tipo) DO UPDATE SET
       estado = 'PUBLICADO',
       url_publica = EXCLUDED.url_publica,
       publicado_auto = false,
       publicado_por = EXCLUDED.publicado_por,
       publicado_en = now(),
       error = NULL,
       updated_at = now()
     RETURNING id, tipo, estado, url_publica`,
    [servicioId, tipo, svc[0].mascota, final, actor]
  )
  return { status: 200, body: { ok: true, pieza: rows[0] } }
}

export async function descartarPieza({ id }) {
  const { rows } = await pool.query(`SELECT id FROM public.piezas_digitales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Pieza no encontrada' } }
  await pool.query(`UPDATE public.piezas_digitales SET estado='DESCARTADO', updated_at=now() WHERE id=$1`, [id])
  return { status: 200, body: { ok: true } }
}

// ── Envío automático por Zolutium (plantillas HSM aprobadas) ─────────────────
// Dos plantillas según lo que el PLAN del servicio lleva (mismo criterio que la UI):
//   plantilla_completos → los 3 digitales: {{1}} video, {{2}} short, {{3}} memorial
//   plantilla_memorial  → solo memorial:   {{1}} memorial
// Si el cliente declinó una pieza en el portal ("no deseo este recordatorio"), el
// plan sigue siendo el mismo: se usa la misma plantilla y en el parámetro de esa
// pieza va `TEXTO_DECLINADO` en vez del enlace (decisión David 2026-07-31, releva
// la del 2026-07-09 que mandaba estas combinaciones al envío manual). Meta acepta
// cualquier texto en un parámetro; lo que NO acepta es un parámetro vacío.
// Cualquier otra combinación (planes raros sin memorial, piezas sueltas) sigue
// yendo por envío manual.
// `texto` y `cubre` describen la plantilla YA APROBADA en Meta y deben editarse
// a la par de ella (la API de GHL no expone el cuerpo, así que no hay forma de
// derivarlos):
//   texto → espejo del cuerpo aprobado, con {{n}} donde van los bodyParams. Es lo
//           que se guarda como evidencia; sin él la evidencia miente (el cliente
//           recibe la plantilla, no el texto que arma Orbit).
//   cubre → ids de recordatorio que la plantilla entrega con enlace FIJO escrito
//           en su cuerpo (audio, herramientas de duelo, tarjeta de oración…).
//           Sin él esos digitales quedan PENDIENTE aunque el cliente ya los tenga.
// Lo que el cliente ve donde iría el enlace de una pieza que él mismo declinó.
// Configurable en config_operativa (DIGITALES.texto_declinado) por si hay que
// ajustar el tono sin desplegar. Un parámetro de plantilla NO puede ir vacío ni
// llevar saltos de línea o tabs — Meta rechaza el envío.
const TEXTO_DECLINADO_DEFAULT = '(no lo solicitaste)'

function textoDeclinado(cfg) {
  const v = typeof cfg.texto_declinado === 'string' ? cfg.texto_declinado.replace(/\s+/g, ' ').trim() : ''
  return v || TEXTO_DECLINADO_DEFAULT
}

function plantillaCfg(v) {
  if (!(v && typeof v === 'object' && typeof v.nombre === 'string' && v.nombre.trim())) return null
  return {
    nombre: v.nombre.trim(),
    idioma: v.idioma || 'es_MX',
    categoria: v.categoria || 'UTILITY',
    texto: typeof v.texto === 'string' && v.texto ? v.texto : null,
    cubre: Array.isArray(v.cubre) ? v.cubre.filter(uuidOrNull) : [],
  }
}

// Resuelve el espejo del cuerpo aprobado con los valores reales de {{1}}, {{2}}…
function resolverTextoPlantilla(texto, bodyParams) {
  return bodyParams.reduce(
    (t, val, i) => t.replaceAll(`{{${i + 1}}}`, val ?? ''),
    texto
  )
}

function infoZolutium(cfg) {
  const usar = cfg.usar_plantilla === true || cfg.usar_plantilla === 'true'
  const completos = plantillaCfg(cfg.plantilla_completos)
  const memorial = plantillaCfg(cfg.plantilla_memorial)
  return {
    activo: usar && !!(completos || memorial) && !!process.env.GHL_TOKEN,
    plantilla_completos: completos?.nombre || null,
    plantilla_memorial: memorial?.nombre || null,
  }
}

// Marca ENTREGADO en servicio_recordatorios los digitales cuyos enlaces se enviaron:
// los de las piezas producidas (tiposEnviados) + los de enlace fijo que la plantilla
// entrega en su propio cuerpo (recIdsFijos).
async function marcarDigitalesEntregados(client, servicioId, tiposEnviados, recIdsFijos = []) {
  const cfg = await cargarConfigDigitales(client)
  const mapa = (cfg.recordatorios_tipo && typeof cfg.recordatorios_tipo === 'object') ? cfg.recordatorios_tipo : {}
  const recIds = [...new Set([...tiposEnviados.map(t => mapa[t]), ...recIdsFijos].filter(Boolean))]
  if (!recIds.length) return
  await client.query(
    `UPDATE public.servicio_recordatorios
     SET estado = 'ENTREGADO'
     WHERE servicio_id = $1
       AND recordatorio_id = ANY($2::uuid[])
       AND estado <> 'NA'
       AND COALESCE(origen, '') <> 'REMOVIDO'`,
    [servicioId, recIds]
  )
}

export async function enviarZolutium({ servicioId, personalId, telefono }) {
  const actor = uuidOrNull(personalId)
  if (!uuidOrNull(servicioId)) return { status: 422, body: { error: 'Servicio inválido' } }

  // 1) Lecturas y validaciones (sin transacción: el envío es una llamada de red)
  const cfg = await cargarConfigDigitales(pool)
  const zol = infoZolutium(cfg)
  if (!zol.activo) return { status: 409, body: { error: 'El envío automático por Zolutium no está configurado (usar_plantilla / GHL_TOKEN).' } }
  const mapa = (cfg.recordatorios_tipo && typeof cfg.recordatorios_tipo === 'object') ? cfg.recordatorios_tipo : {}

  const { rows: svcRows } = await pool.query(
    `SELECT s.id, s.estado,
            m.nombre AS mascota,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            COALESCE(NULLIF(TRIM(c.whatsapp), ''), NULLIF(TRIM(c.telefono), ''), NULLIF(TRIM(c.telefono2), '')) AS telefono
     FROM public.servicios s
     JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
     LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
     WHERE s.id = $1`,
    [servicioId]
  )
  const svc = svcRows[0]
  if (!svc) return { status: 404, body: { error: 'Servicio no encontrado' } }
  if (svc.estado === 'CANCELADO') return { status: 422, body: { error: 'El servicio está cancelado.' } }

  const destino = (telefono || '').trim() || svc.telefono
  if (!destino) return { status: 422, body: { error: 'El cliente no tiene un teléfono de WhatsApp registrado.' } }

  // Un solo envío automático exitoso por servicio (el botón desaparece al enviar;
  // esto cierra la ventana del doble clic / doble pestaña).
  const { rows: previos } = await pool.query(
    `SELECT 1 FROM public.digitales_envios
     WHERE servicio_id = $1 AND canal = 'ZOLUTIUM' AND estado = 'ENVIADO' LIMIT 1`,
    [servicioId]
  )
  if (previos.length) return { status: 409, body: { error: 'Este servicio ya tiene un envío automático registrado.' } }

  // 2) Piezas del servicio: qué lleva (esperadas + creadas) y qué está publicado
  const recIds = TIPOS.map(t => mapa[t]).filter(Boolean)
  const [{ rows: espRows }, { rows: piezas }] = await Promise.all([
    // Una fila por recordatorio del plan, con la marca de declinado (todas sus
    // filas vivas en 'NA' — un servicio puede llevar el mismo recordatorio dos veces)
    pool.query(
      `SELECT sr.recordatorio_id::text AS rec_id,
              COUNT(*) FILTER (WHERE sr.estado <> 'NA') = 0 AS declinado
       FROM public.servicio_recordatorios sr
       WHERE sr.servicio_id = $1
         AND sr.recordatorio_id = ANY($2::uuid[])
         AND COALESCE(sr.origen, '') <> 'REMOVIDO'
       GROUP BY sr.recordatorio_id`,
      [servicioId, recIds.length ? recIds : ['00000000-0000-0000-0000-000000000000']]
    ),
    pool.query(
      `SELECT tipo, estado, url_publica FROM public.piezas_digitales
       WHERE servicio_id = $1 AND estado <> 'DESCARTADO'`,
      [servicioId]
    ),
  ])
  const esperadasRec = espRows.filter(r => !r.declinado).map(r => r.rec_id)
  const declinadasRec = espRows.filter(r => r.declinado).map(r => r.rec_id)
  // Piezas vivas: las que hay que tener publicadas y las que se registran como enviadas.
  const tipos = TIPOS.filter(t =>
    esperadasRec.includes(String(mapa[t] || '')) || piezas.some(p => p.tipo === t))
  // Declinadas por el cliente: no se producen ni se marcan entregadas, pero sí
  // cuentan para saber qué plantilla corresponde (el plan no cambió).
  const declinadas = TIPOS.filter(t =>
    declinadasRec.includes(String(mapa[t] || '')) && !tipos.includes(t))
  const tiposPlan = TIPOS.filter(t => tipos.includes(t) || declinadas.includes(t))
  const urls = Object.fromEntries(
    piezas.filter(p => p.estado === 'PUBLICADO' && p.url_publica)
      .map(p => [p.tipo, limpiarUrlInstagram(p.url_publica)]))

  const faltantes = tipos.filter(t => !urls[t])
  if (!tipos.length) return { status: 422, body: { error: 'Este servicio no lleva piezas digitales.' } }
  if (faltantes.length) return { status: 422, body: { error: `Faltan piezas por publicar: ${faltantes.join(', ')}.` } }

  // 3) Elegir plantilla según lo que lleva el plan; las declinadas van con texto
  // en vez de enlace (un parámetro vacío hace que Meta rechace el envío).
  const sinEnlace = textoDeclinado(cfg)
  const param = (t) => urls[t] || (declinadas.includes(t) ? sinEnlace : null)
  let plantilla = null, bodyParams = []
  if (tiposPlan.length === 3) {
    plantilla = plantillaCfg(cfg.plantilla_completos)
    bodyParams = [param('VIDEO'), param('SHORT'), param('MEMORIAL')]
  } else if (tiposPlan.length === 1 && tiposPlan[0] === 'MEMORIAL') {
    plantilla = plantillaCfg(cfg.plantilla_memorial)
    bodyParams = [param('MEMORIAL')]
  }
  if (!plantilla) {
    return { status: 422, body: { error: `La combinación de piezas (${tiposPlan.join(' + ')}) no coincide con ninguna plantilla aprobada — usa el envío manual.` } }
  }
  // Un parámetro vacío hace que Meta rechace el envío de forma asíncrona (queda
  // ENVIADO en GHL y `failed` en Meta): mejor no mandarlo.
  if (bodyParams.some(p => !p)) {
    return { status: 422, body: { error: 'Faltan enlaces para armar la plantilla — usa el envío manual.' } }
  }

  const enlaces = tipos.map(t => ({ tipo: t, url: urls[t] }))
  // La evidencia debe ser lo que el cliente REALMENTE recibe: el cuerpo de la
  // plantilla aprobada (que trae los enlaces fijos), no el resumen que arma Orbit.
  const mensaje = plantilla.texto
    ? resolverTextoPlantilla(plantilla.texto, bodyParams)
    : construirMensajeCliente(cfg, svc.mascota, enlaces,
        declinadas.map(t => ({ tipo: t, texto: sinEnlace })))

  // 4) Envío (red) → luego evidencia atómica, mismo patrón que reportes grupales
  let envioOk = null, envioErr = null
  try {
    envioOk = await enviarPlantillaGenerica({
      telefono: destino,
      nombre: svc.propietario || '',
      plantillaNombre: plantilla.nombre,
      idioma: plantilla.idioma,
      category: plantilla.categoria,
      mensaje,
      bodyParams,
      // Sin fromNumber: GHL/Zolutium lo ignora para números WABA y rutea por el canal por defecto.
    })
  } catch (e) {
    envioErr = (e.message || 'Error enviando por Zolutium').slice(0, 900)
    log('[digitales] enviarZolutium ERROR', servicioId, envioErr)
  }

  // GHL acepta el mensaje (201 + messageId) aunque Meta lo rechace segundos
  // después (p. ej. #132005 plantilla demasiado larga) — verificar el estado
  // real antes de dar por ENVIADO y marcar los digitales como entregados.
  if (envioOk) {
    try {
      await new Promise(r => setTimeout(r, 5000))
      const est = await consultarEstadoMensajeGHL(envioOk.messageId)
      if (est?.status === 'failed') {
        envioErr = `Meta rechazó el envío: ${est.error || 'sin detalle'}`.slice(0, 900)
        log('[digitales] enviarZolutium META RECHAZO', servicioId, envioErr)
      }
    } catch (e) {
      // Si la verificación falla no bloquea: se conserva el envío como exitoso.
      log('[digitales] verificación post-envío falló (se asume enviado)', e.message)
    }
  }
  const exito = !!envioOk && !envioErr

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: env } = await client.query(
      `INSERT INTO public.digitales_envios
         (servicio_id, canal, telefono, enlaces, mensaje, enviado_por, estado, error, plantilla, message_id, contact_id)
       VALUES ($1, 'ZOLUTIUM', $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, enviado_en, estado`,
      [servicioId, destino, JSON.stringify(enlaces), mensaje, actor,
       exito ? 'ENVIADO' : 'ERROR', envioErr, plantilla.nombre,
       envioOk?.messageId || null, envioOk?.contactId || null]
    )
    if (exito) await marcarDigitalesEntregados(client, servicioId, tipos, plantilla.cubre)
    await client.query('COMMIT')
    if (!exito) return { status: 502, body: { error: `El envío falló: ${envioErr}` } }
    return { status: 200, body: { ok: true, envio: env[0], enlaces, plantilla: plantilla.nombre } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// Texto legible que queda en la evidencia y en la conversación de GHL
// (lo que el cliente ve lo define la plantilla aprobada en Meta).
function construirMensajeCliente(cfg, mascota, enlaces, declinadas = []) {
  const labels = { MEMORIAL: 'Memorial', VIDEO: 'Video conmemorativo', SHORT: 'Short' }
  // Las declinadas también van en la evidencia: la plantilla las nombra con el
  // texto de relleno, así que omitirlas haría que la evidencia mienta.
  const links = [
    ...enlaces.map(e => `• ${labels[e.tipo] || e.tipo}: ${e.url}`),
    ...declinadas.map(d => `• ${labels[d.tipo] || d.tipo}: ${d.texto}`),
  ].join('\n')
  const base = typeof cfg.mensaje_cliente === 'string' && cfg.mensaje_cliente
    ? cfg.mensaje_cliente
    : 'Hola 💛 Te compartimos los recuerdos digitales de {mascota}:\n\n{enlaces}\n\nCamino al Cielo 🕊️'
  return base.replaceAll('{mascota}', mascota || '').replaceAll('{enlaces}', links)
}

// ── Envío al cliente: registro + marca ENTREGADO en servicio_recordatorios ──
export async function registrarEnvio({ servicioId, personalId, telefono, mensaje, canal }) {
  const actor = uuidOrNull(personalId)
  const canalFinal = canal === 'ZOLUTIUM' ? 'ZOLUTIUM' : 'WHATSAPP_MANUAL'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: piezas } = await client.query(
      `SELECT tipo, url_publica FROM public.piezas_digitales
       WHERE servicio_id = $1 AND estado = 'PUBLICADO' AND url_publica IS NOT NULL
       ORDER BY tipo`,
      [servicioId]
    )
    if (!piezas.length) {
      await client.query('ROLLBACK')
      return { status: 422, body: { error: 'Este servicio no tiene piezas publicadas con enlace.' } }
    }
    const enlaces = piezas.map(p => ({ tipo: p.tipo, url: p.url_publica }))

    const { rows: env } = await client.query(
      `INSERT INTO public.digitales_envios (servicio_id, canal, telefono, enlaces, mensaje, enviado_por)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, enviado_en`,
      [servicioId, canalFinal, (telefono || '').trim() || null, JSON.stringify(enlaces), mensaje || null, actor]
    )

    // Los digitales enviados quedan ENTREGADOS en producción/entrega/certificado.
    await marcarDigitalesEntregados(client, servicioId, enlaces.map(e => e.tipo))
    await client.query('COMMIT')
    return { status: 200, body: { ok: true, envio: env[0], enlaces } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ── Servir el archivo (enlace firmado; sin JWT para que funcione en <video>) ──
export async function servirArchivo(req, res) {
  const { id } = req.params
  if (!verificarToken(id, req.query.t)) return res.status(403).end('Forbidden')
  const { rows } = await pool.query(`SELECT archivo_path FROM public.piezas_digitales WHERE id = $1`, [id])
  const ap = rows[0]?.archivo_path
  if (!ap) return res.status(404).end('No encontrado')
  const full = path.join(DATA_DIR, ap)
  if (!fs.existsSync(full)) return res.status(404).end('Archivo no disponible')

  const size = fs.statSync(full).size
  if (req.query.dl) res.setHeader('Content-Disposition', `attachment; filename="memorial_${id}.mp4"`)
  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Accept-Ranges', 'bytes')

  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range)
    const start = parseInt(m[1])
    const end = m[2] ? parseInt(m[2]) : size - 1
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    fs.createReadStream(full, { start, end }).pipe(res)
  } else {
    res.setHeader('Content-Length', size)
    fs.createReadStream(full).pipe(res)
  }
}
