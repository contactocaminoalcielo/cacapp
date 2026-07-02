// Memoriales — generación del video animado por servicio (Remotion self-host).
// Flujo: candidato (fecha_imagenes_recibidas + plan no excluido) → GENERAR (render
// async en segundo plano) → GENERADO → APROBAR → PUBLICADO (con enlace de Instagram).
// Diagnóstico/decisiones: docs/Memorial_Canva_Diagnostico.md
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { pool, log } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RENDER_ENTRY = path.join(__dirname, '..', 'memorial', 'render.mjs')
const APP_ROOT = path.join(__dirname, '..')
const DATA_DIR = process.env.MEMORIAL_DATA_DIR || '/data/memoriales'
const SIGN_SECRET = process.env.MEMORIAL_SIGN_SECRET || process.env.JWT_SECRET || 'dev-secret'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function uuidOrNull(v) {
  if (!v) return null
  const s = String(v)
  return UUID_RE.test(s) ? s : null
}

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

// Foto representativa del servicio = primera imagen que envió el cliente.
async function fotoDelServicio(client, servicioId) {
  const { rows } = await client.query(
    `SELECT sr.imagen_cliente_url, sr.imagenes_cliente_urls
     FROM public.servicio_recordatorios sr
     WHERE sr.servicio_id = $1
       AND (sr.imagen_cliente_url IS NOT NULL
            OR COALESCE(array_length(sr.imagenes_cliente_urls, 1), 0) > 0)
     ORDER BY sr.created_at ASC`,
    [servicioId]
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
  return `/memoriales/${id}/archivo?t=${firmarToken(id)}`
}

// ── Candidatos: servicios con imagen lista, plan no excluido, sin memorial activo ──
export async function listarCandidatos() {
  const client = await pool.connect()
  try {
    const cfg = await cargarConfig(client)
    const excl = Array.isArray(cfg.planes_excluidos) ? cfg.planes_excluidos : []
    const { rows } = await client.query(
      `SELECT s.id AS servicio_id, s.codigo AS servicio_codigo,
              to_char(s.fecha_imagenes_recibidas, 'YYYY-MM-DD') AS fecha_imagenes,
              m.nombre AS mascota, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       FROM public.servicios s
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p    ON p.id = s.plan_id
       LEFT JOIN public.memoriales mem ON mem.servicio_id = s.id
       WHERE s.fecha_imagenes_recibidas IS NOT NULL
         AND s.estado <> 'CANCELADO'
         AND (p.codigo IS NULL OR NOT (p.codigo = ANY($1::text[])))
         AND (mem.id IS NULL OR mem.estado IN ('ERROR', 'DESCARTADO'))
       ORDER BY s.fecha_imagenes_recibidas DESC
       LIMIT 300`,
      [excl]
    )
    return rows
  } finally { client.release() }
}

// ── Memoriales existentes (con enlace firmado si ya hay archivo) ──
export async function listarMemoriales() {
  const { rows } = await pool.query(
    `SELECT mem.id, mem.servicio_id, mem.estado, mem.mascota_nombre, mem.fecha_texto,
            mem.formato, mem.archivo_path, mem.error, mem.instagram_url, mem.intentos,
            mem.generado_en, mem.aprobado_en, mem.publicado_en, mem.updated_at,
            s.codigo AS servicio_codigo, p.codigo AS plan_codigo, p.nombre AS plan_nombre
     FROM public.memoriales mem
     JOIN public.servicios s ON s.id = mem.servicio_id
     LEFT JOIN public.planes p ON p.id = s.plan_id
     ORDER BY mem.updated_at DESC
     LIMIT 300`
  )
  return rows.map(r => ({ ...r, archivo_url: r.archivo_path ? urlArchivo(r.id) : null }))
}

// ── Generar (render async en segundo plano) ──
const FORMATOS = ['1080x1350', '1080x1920']

export async function generarMemorial({ servicioId, personalId, formato: formatoReq }) {
  const actor = uuidOrNull(personalId)
  const client = await pool.connect()
  let memorialId = null, payload = null
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

    const foto = await fotoDelServicio(client, servicioId)
    if (!foto) { await client.query('ROLLBACK'); return { status: 422, body: { error: 'No hay una foto del cliente para este servicio.' } } }

    const frase = typeof cfg.frase === 'string' ? cfg.frase : CONFIG_DEFAULTS.frase
    const formato = FORMATOS.includes(formatoReq) ? formatoReq
      : (FORMATOS.includes(cfg.formato) ? cfg.formato : CONFIG_DEFAULTS.formato)
    const compositionId = formato === '1080x1920' ? 'MemorialVertical' : 'Memorial'

    const { rows: up } = await client.query(
      `INSERT INTO public.memoriales
         (servicio_id, estado, mascota_nombre, fecha_texto, formato, intentos, generado_por, generado_en, error)
       VALUES ($1, 'GENERANDO', $2, $3, $4, 1, $5, NULL, NULL)
       ON CONFLICT (servicio_id) DO UPDATE SET
         estado = 'GENERANDO',
         mascota_nombre = EXCLUDED.mascota_nombre,
         fecha_texto = EXCLUDED.fecha_texto,
         formato = EXCLUDED.formato,
         intentos = public.memoriales.intentos + 1,
         generado_por = EXCLUDED.generado_por,
         error = NULL,
         updated_at = now()
       RETURNING id`,
      [servicioId, svc.mascota, svc.fecha_texto, formato, actor]
    )
    memorialId = up[0].id
    payload = { name: svc.mascota, date: svc.fecha_texto, photo: foto, frase, compositionId }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }

  // Render fuera de la transacción y sin bloquear la respuesta.
  runRender(memorialId, payload).catch(err => log('[memorial] runRender ERROR', err.message))
  return { status: 200, body: { ok: true, id: memorialId, estado: 'GENERANDO' } }
}

async function runRender(memorialId, payload) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true })
  const outPath = path.join(DATA_DIR, `${memorialId}.mp4`)
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
            `UPDATE public.memoriales SET estado='GENERADO', archivo_path=$2, generado_en=now(), error=NULL, updated_at=now() WHERE id=$1`,
            [memorialId, `${memorialId}.mp4`]
          )
          log('[memorial] generado', memorialId)
        } else {
          await pool.query(
            `UPDATE public.memoriales SET estado='ERROR', error=$2, updated_at=now() WHERE id=$1`,
            [memorialId, (error || 'El render falló').slice(0, 500)]
          )
          log('[memorial] ERROR', memorialId, error)
        }
      } catch (e) { log('[memorial] update post-render ERROR', e.message) }
      resolve()
    })
  })
}

export async function aprobarMemorial({ id, personalId }) {
  const actor = uuidOrNull(personalId)
  const { rows } = await pool.query(`SELECT estado FROM public.memoriales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Memorial no encontrado' } }
  if (!['GENERADO', 'APROBADO', 'PUBLICADO'].includes(rows[0].estado))
    return { status: 422, body: { error: 'Solo se aprueba un memorial ya generado.' } }
  await pool.query(
    `UPDATE public.memoriales SET estado='APROBADO', aprobado_por=$2, aprobado_en=now(), updated_at=now() WHERE id=$1`,
    [id, actor]
  )
  return { status: 200, body: { ok: true } }
}

export async function publicarMemorial({ id, personalId, instagramUrl }) {
  const actor = uuidOrNull(personalId)
  const url = (instagramUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return { status: 422, body: { error: 'El enlace de Instagram no es válido.' } }
  const { rows } = await pool.query(`SELECT estado FROM public.memoriales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Memorial no encontrado' } }
  await pool.query(
    `UPDATE public.memoriales
     SET estado='PUBLICADO', instagram_url=$2, publicado_por=$3, publicado_en=now(), updated_at=now()
     WHERE id=$1`,
    [id, url, actor]
  )
  return { status: 200, body: { ok: true } }
}

export async function descartarMemorial({ id }) {
  const { rows } = await pool.query(`SELECT id FROM public.memoriales WHERE id = $1`, [id])
  if (!rows[0]) return { status: 404, body: { error: 'Memorial no encontrado' } }
  await pool.query(`UPDATE public.memoriales SET estado='DESCARTADO', updated_at=now() WHERE id=$1`, [id])
  return { status: 200, body: { ok: true } }
}

// ── Servir el archivo (enlace firmado; sin JWT para que funcione en <video>) ──
export async function servirArchivo(req, res) {
  const { id } = req.params
  if (!verificarToken(id, req.query.t)) return res.status(403).end('Forbidden')
  const { rows } = await pool.query(`SELECT archivo_path FROM public.memoriales WHERE id = $1`, [id])
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
