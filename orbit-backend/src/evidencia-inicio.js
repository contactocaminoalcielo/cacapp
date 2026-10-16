// Evidencias del inicio del compostaje, enmarcadas y enviadas a la familia
// (migración 178). Reporte de la planta de Tenjo, 2026-10-16.
//
// El operario ya sube dos fotos del cubículo al iniciar el proceso (migración
// 051). Hasta hoy coordinación las decoraba a mano con un marco y las mandaba
// por WhatsApp. Aquí:
//   1. PREPARAR — por cada compostaje con acompañamiento EVIDENCIA que inició
//      su proceso, una fila POR_REVISAR con sus fotos. No le escribe a nadie.
//   2. REVISAR  — coordinación ajusta encuadre, frase y formato (como en el
//      memorial) y ve el marco final, dibujado aquí mismo.
//   3. ENVIAR   — plantilla con la imagen enmarcada como cabecera. Las dos
//      fotos van en UN marco: una plantilla lleva una sola imagen.
//
// Regla de David: nada sale sin revisión. Una foto equivocada le llega a una
// familia en duelo; por eso no hay envío automático, solo un clic humano.
import { pool, log } from './db.js'
import { enviarPlantillaConImagen } from './whatsapp.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'
import { renderImagen } from './pdf.js'
import { htmlMarcoEvidencia, FORMATOS } from './pdf-plantillas/marco-evidencia.js'

const MOD = 'EVIDENCIA_INICIO'
const STORAGE_BASE = process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/'

export const CONFIG_DEFAULTS_EVIDENCIA = {
  activo:            true,
  // NULL a propósito: sin plantilla aprobada solo se puede bajar el marco y
  // mandarlo a mano. Nunca se simula un envío.
  plantilla:         null,
  arranque_desde:    null,
  acompanamientos:   ['EVIDENCIA'],
  fotos_por_proceso: { COMPOSTAJE_INDIVIDUAL: ['cubiculo_1', 'cubiculo_2'] },
  planes_excluidos:  ['COMPETS_PRESENCIAL'],
  frase:             'Siempre en nuestro recuerdo',
  leyenda:           'Inicio de su proceso de compostaje',
}

const ETIQUETAS = {
  cubiculo_1: 'Cubículo — foto 1',
  cubiculo_2: 'Cubículo — foto 2',
  altar:      'Altar',
  horno:      'Ingreso al horno',
}

const TOKENS_PLANTILLA = ['nombre', 'propietario', 'mascota']

export async function cargarConfigEvidencia(client = pool) {
  const cfg = { ...CONFIG_DEFAULTS_EVIDENCIA }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

function plantillaEvidencia(cfg) {
  const raw = cfg.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  const vars = Array.isArray(p.vars) ? p.vars.filter(v => TOKENS_PLANTILLA.includes(v)) : ['nombre', 'mascota']
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', vars: vars.length ? vars : ['nombre', 'mascota'] }
}

const lista = v => Array.isArray(v) ? v : (typeof v === 'string' ? (safeJson(v) || []) : [])
const objeto = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : (typeof v === 'string' ? (safeJson(v) || {}) : {})

// ─── 1. Preparar ────────────────────────────────────────────────────────────

/**
 * Crea las filas POR_REVISAR que falten. Idempotente (UNIQUE servicio_id).
 * Con `servicioId` mira solo ese servicio (lo llama la Jornada al iniciar).
 */
export async function prepararEvidencias({ servicioId = null } = {}) {
  const cfg = await cargarConfigEvidencia()
  if (!(cfg.activo === true || cfg.activo === 'true')) return { activo: false, creadas: 0 }

  const fotosPorProceso = objeto(cfg.fotos_por_proceso)
  const procesos = Object.keys(fotosPorProceso)
  if (!procesos.length) return { activo: true, creadas: 0 }
  const arranque = normalizarFecha(cfg.arranque_desde)

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (i.servicio_id)
            i.id AS lote_item_id, i.servicio_id, i.evidencia_inicio, i.fecha_inicio_proceso,
            p.tipo_proceso, c.whatsapp
       FROM public.lotes_tenjo_items i
       JOIN public.servicios s     ON s.id = i.servicio_id
       JOIN public.planes p        ON p.id = s.plan_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE i.fecha_inicio_proceso IS NOT NULL
        AND i.evidencia_inicio <> '{}'::jsonb
        AND p.tipo_proceso = ANY($1::text[])
        AND s.tipo_acompanamiento = ANY($2::text[])
        AND NOT (COALESCE(p.codigo, '') = ANY($3::text[]))
        AND s.estado <> 'CANCELADO'
        AND ($4::date IS NULL OR (i.fecha_inicio_proceso AT TIME ZONE 'America/Bogota')::date >= $4::date)
        AND ($5::uuid IS NULL OR i.servicio_id = $5::uuid)
        AND NOT EXISTS (SELECT 1 FROM public.evidencias_familia e WHERE e.servicio_id = i.servicio_id)
      ORDER BY i.servicio_id, i.fecha_inicio_proceso DESC`,
    [procesos, lista(cfg.acompanamientos), lista(cfg.planes_excluidos), arranque, uuidOrNull(servicioId)]
  )

  let creadas = 0
  for (const r of rows) {
    const evid = objeto(r.evidencia_inicio)
    const fotos = (fotosPorProceso[r.tipo_proceso] || [])
      .filter(clave => esUrlNuestra(evid[clave]))
      .map(clave => ({ clave, label: ETIQUETAS[clave] || clave, url: evid[clave], incluir: true, zoom: 1, posX: 50, posY: 50 }))
    if (!fotos.length) continue
    const { rowCount } = await pool.query(
      `INSERT INTO public.evidencias_familia
         (servicio_id, lote_item_id, tipo_proceso, fecha_inicio, fotos, frase, leyenda, whatsapp_destino)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (servicio_id) DO NOTHING`,
      [r.servicio_id, r.lote_item_id, r.tipo_proceso, r.fecha_inicio_proceso,
       JSON.stringify(fotos), String(cfg.frase || CONFIG_DEFAULTS_EVIDENCIA.frase),
       String(cfg.leyenda ?? CONFIG_DEFAULTS_EVIDENCIA.leyenda), r.whatsapp || null]
    )
    creadas += rowCount
  }

  if (creadas > 0) {
    await avisarCoordinacion(
      creadas === 1
        ? 'Hay una evidencia de inicio de compostaje por revisar y enviar a la familia (Tenjo → Evidencias).'
        : `Hay ${creadas} evidencias de inicio de compostaje por revisar y enviar (Tenjo → Evidencias).`
    )
  }
  return { activo: true, creadas }
}

// ─── 2. Listar y ajustar ────────────────────────────────────────────────────

export async function listarEvidencias({ estado = 'POR_REVISAR', limite = 100 } = {}) {
  // Antes de listar se prepara lo que falte: así la pestaña nunca depende de
  // que alguien haya corrido un cron.
  try { await prepararEvidencias() } catch (e) { log('[evidencia/preparar] ERROR', e.message) }
  const estados = estado === 'TODAS' ? ['POR_REVISAR', 'ENVIADO', 'ERROR', 'DESCARTADA']
    : estado === 'PENDIENTES' ? ['POR_REVISAR', 'ERROR'] : [estado]
  const { rows } = await pool.query(
    `SELECT e.id, e.servicio_id, e.estado, e.fecha_inicio, e.fecha_marco::text AS fecha_marco,
            e.fotos, e.frase, e.leyenda, e.formato,
            e.error, e.fecha_envio, e.medio_envio, e.created_at,
            m.nombre AS mascota,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            COALESCE(c.whatsapp, e.whatsapp_destino) AS whatsapp,
            p.nombre AS plan, cu.codigo AS cubiculo,
            TRIM(COALESCE(pr.nombre,'') || ' ' || COALESCE(pr.apellido,'')) AS revisado_por
       FROM public.evidencias_familia e
       JOIN public.servicios s       ON s.id = e.servicio_id
       JOIN public.mascotas m        ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p     ON p.id = s.plan_id
       LEFT JOIN public.lotes_tenjo_items i ON i.id = e.lote_item_id
       LEFT JOIN public.cubiculos cu ON cu.id = i.cubiculo_id
       LEFT JOIN public.personal pr  ON pr.id = e.revisado_por
      WHERE e.estado = ANY($1::text[])
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [estados, Math.min(parseInt(limite) || 100, 300)]
  )
  const cfg = await cargarConfigEvidencia()
  return { ok: true, plantilla: plantillaEvidencia(cfg)?.nombre || null, evidencias: rows }
}

/**
 * Mezcla los ajustes que manda la pantalla con las fotos de la DB. De la
 * pantalla solo se toman `incluir`, `zoom`, `posX`, `posY`: la URL sale
 * siempre de la fila, así nadie puede meter en el marco una foto ajena.
 */
function aplicarAjustes(fila, ajustes = {}) {
  const porClave = new Map((Array.isArray(ajustes.fotos) ? ajustes.fotos : []).map(f => [String(f?.clave), f]))
  const fotos = lista(fila.fotos).map(f => {
    const a = porClave.get(String(f.clave))
    if (!a) return f
    return {
      ...f,
      incluir: a.incluir !== false,
      zoom: clamp(a.zoom, 1, 3, f.zoom ?? 1),
      posX: clamp(a.posX, 0, 100, f.posX ?? 50),
      posY: clamp(a.posY, 0, 100, f.posY ?? 50),
      rot: [0, 90, 180, 270].includes(Number(a.rot)) ? Number(a.rot) : (f.rot || 0),
    }
  })
  const frase = typeof ajustes.frase === 'string' ? ajustes.frase.trim().slice(0, 60) : fila.frase
  // La leyenda SÍ puede quedar vacía: entonces el pie lleva solo la fecha.
  const leyenda = typeof ajustes.leyenda === 'string' ? ajustes.leyenda.trim().slice(0, 70) : fila.leyenda
  const formato = ['horizontal', 'vertical'].includes(ajustes.formato) ? ajustes.formato : fila.formato
  // Fecha del marco (migración 179). '' o null = volver a la del proceso.
  const fechaMarco = 'fecha' in ajustes
    ? (fechaValida(ajustes.fecha) ? ajustes.fecha : null)
    : (fila.fecha_marco || null)
  return { fotos, frase: frase || fila.frase, leyenda: leyenda ?? null, formato: formato || 'horizontal', fechaMarco }
}

export async function guardarAjustes({ id, ajustes = {} }) {
  const fila = await filaEvidencia(id)
  if (!fila) return { status: 404, body: { ok: false, error: 'no_encontrada' } }
  if (!['POR_REVISAR', 'ERROR'].includes(fila.estado))
    return { status: 409, body: { ok: false, error: 'Ya no se puede editar: está ' + fila.estado } }
  const nuevo = aplicarAjustes(fila, ajustes)
  if (!nuevo.fotos.some(f => f.incluir !== false))
    return { status: 422, body: { ok: false, error: 'Deja al menos una foto en el marco.' } }
  await pool.query(
    `UPDATE public.evidencias_familia
        SET fotos = $2::jsonb, frase = $3, formato = $4, leyenda = $5, fecha_marco = $6::date
      WHERE id = $1`,
    [id, JSON.stringify(nuevo.fotos), nuevo.frase, nuevo.formato, nuevo.leyenda, nuevo.fechaMarco]
  )
  return { status: 200, body: { ok: true, ...nuevo } }
}

// ─── 3. El marco ────────────────────────────────────────────────────────────

/**
 * Dibuja el marco. Con `ajustes` dibuja la vista previa SIN guardar (lo que
 * se ve mientras coordinación mueve los controles); sin ellos, lo guardado.
 */
export async function imagenEvidencia({ id, ajustes = null }) {
  const fila = await filaEvidencia(id)
  if (!fila) return { status: 404, body: { ok: false, error: 'no_encontrada' } }
  const { fotos, frase, leyenda, formato, fechaMarco } = ajustes ? aplicarAjustes(fila, ajustes) : {
    fotos: lista(fila.fotos), frase: fila.frase, leyenda: fila.leyenda, formato: fila.formato,
    fechaMarco: fila.fecha_marco || null,
  }
  const usadas = fotos.filter(f => f.incluir !== false).slice(0, 2)
  if (!usadas.length) return { status: 422, body: { ok: false, error: 'Deja al menos una foto en el marco.' } }

  const conDatos = []
  for (const f of usadas) {
    const dataUri = await fotoComoDataUri(f.url)
    if (!dataUri) return { status: 502, body: { ok: false, error: `No se pudo leer la foto "${f.label}" del almacenamiento.` } }
    conDatos.push({ ...f, dataUri })
  }
  const { ancho, alto } = FORMATOS[formato] || FORMATOS.horizontal
  const html = htmlMarcoEvidencia({
    fotos: conDatos, mascota: fila.mascota, fecha: fechaMarco || fila.fecha_inicio, frase, leyenda, formato,
  })
  const buffer = await renderImagen({ html, ancho, alto })
  return { status: 200, buffer, nombre: `Evidencia ${fila.mascota || ''}.jpg`.trim() }
}

// Las fotos del cubículo pesan ~300 KB y la vista previa se pide cada vez que
// se mueve un control: se guardan unas pocas en memoria.
const cacheFotos = new Map()
async function fotoComoDataUri(url) {
  if (!esUrlNuestra(url)) return null
  if (cacheFotos.has(url)) return cacheFotos.get(url)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8_000_000) return null
    const uri = `data:${mime};base64,${buf.toString('base64')}`
    cacheFotos.set(url, uri)
    if (cacheFotos.size > 24) cacheFotos.delete(cacheFotos.keys().next().value)
    return uri
  } catch { return null }
}

// ─── 4. Enviar ──────────────────────────────────────────────────────────────

export async function enviarEvidencia({ id, ajustes = null, personalId = null }) {
  const fila = await filaEvidencia(id)
  if (!fila) return { status: 404, body: { ok: false, error: 'no_encontrada' } }
  if (fila.estado === 'ENVIADO') return { status: 409, body: { ok: false, error: 'Ya se envió.' } }
  if (fila.estado === 'DESCARTADA') return { status: 409, body: { ok: false, error: 'Está descartada.' } }

  const cfg = await cargarConfigEvidencia()
  const plantilla = plantillaEvidencia(cfg)
  if (!plantilla) {
    return { status: 409, body: { ok: false, error: 'Falta la plantilla aprobada en Meta. Mientras tanto, descarga la imagen y márcala como enviada a mano.' } }
  }

  // Lo que coordinación dejó en pantalla es lo que sale: se guarda primero.
  if (ajustes) {
    const g = await guardarAjustes({ id, ajustes })
    if (g.status !== 200) return g
  }

  const destino = validoWa(fila.whatsapp) || validoWa(fila.whatsapp_destino)
  if (!destino) {
    await marcarError(id, 'El cliente no tiene un WhatsApp válido')
    return { status: 422, body: { ok: false, error: 'El cliente no tiene un WhatsApp válido.' } }
  }

  const img = await imagenEvidencia({ id })
  if (img.status !== 200) return img

  const valores = {
    nombre:      (fila.cliente_nombre || '').split(' ')[0] || fila.propietario || 'Familia',
    propietario: fila.propietario || 'Familia',
    mascota:     fila.mascota || 'tu mascota',
  }
  try {
    const r = await enviarPlantillaConImagen({
      telefono: destino,
      plantillaNombre: plantilla.nombre,
      idioma: plantilla.idioma,
      bodyParams: plantilla.vars.map(v => String(valores[v] ?? '')),
      imagen: { buffer: img.buffer, mime: 'image/jpeg', nombre: img.nombre },
      fromNumberId: LINEA_WA_ID,
      personalId: uuidOrNull(personalId),
    })
    await pool.query(
      `UPDATE public.evidencias_familia
          SET estado = 'ENVIADO', medio_envio = 'PLANTILLA', fecha_envio = now(),
              mensaje_id = $2, whatsapp_destino = $3, linea_wa = $4,
              revisado_por = $5, error = NULL, intentos = intentos + 1
        WHERE id = $1`,
      [id, r?.messageId || null, destino, LINEA_WA_NUMERO, uuidOrNull(personalId)]
    )
    return { status: 200, body: { ok: true, enviado: true } }
  } catch (err) {
    await marcarError(id, err.message)
    log('[evidencia/enviar] ERROR', id, err.message)
    return { status: 502, body: { ok: false, error: err.message } }
  }
}

/** Coordinación la mandó por su cuenta (bajó la imagen). Queda la traza. */
export async function marcarEnviadaManual({ id, personalId = null }) {
  const { rowCount } = await pool.query(
    `UPDATE public.evidencias_familia
        SET estado = 'ENVIADO', medio_envio = 'MANUAL', fecha_envio = now(),
            revisado_por = $2, error = NULL
      WHERE id = $1 AND estado IN ('POR_REVISAR','ERROR')`,
    [id, uuidOrNull(personalId)]
  )
  return rowCount ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: 'No se pudo marcar (¿ya estaba enviada o descartada?).' } }
}

export async function descartarEvidencia({ id, personalId = null }) {
  const { rowCount } = await pool.query(
    `UPDATE public.evidencias_familia SET estado = 'DESCARTADA', revisado_por = $2
      WHERE id = $1 AND estado IN ('POR_REVISAR','ERROR')`,
    [id, uuidOrNull(personalId)]
  )
  return rowCount ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: 'No se pudo descartar.' } }
}

// ─── Auxiliares ─────────────────────────────────────────────────────────────

async function filaEvidencia(id) {
  if (!uuidOrNull(id)) return null
  const { rows } = await pool.query(
    `SELECT e.*, e.fecha_marco::text AS fecha_marco, m.nombre AS mascota, c.nombre AS cliente_nombre, c.whatsapp,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       FROM public.evidencias_familia e
       JOIN public.servicios s     ON s.id = e.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE e.id = $1`,
    [id]
  )
  return rows[0] || null
}

async function marcarError(id, mensaje) {
  await pool.query(
    `UPDATE public.evidencias_familia SET estado = 'ERROR', error = $2, intentos = intentos + 1 WHERE id = $1`,
    [id, String(mensaje || '').slice(0, 500)]
  )
}

async function avisarCoordinacion(mensaje) {
  try {
    await pool.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
       SELECT p.id, 'EVIDENCIAS_POR_REVISAR', 'Evidencias por enviar', $1, '{}'::jsonb
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
      [mensaje]
    )
  } catch (e) { log('[evidencia] aviso no enviado:', e.message) }
}

const esUrlNuestra = u => typeof u === 'string' && u.startsWith(STORAGE_BASE)
const clamp = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def }
function validoWa(v) { const s = String(v || '').trim(); return s.replace(/\D/g, '').length >= 10 ? s : null }
function uuidOrNull(v) {
  const s = String(v || '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}
/** 'YYYY-MM-DD' de un día real y razonable (no se imprime un 2099 por un dedazo). */
function fechaValida(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 2024 && d.getUTCFullYear() <= 2100
}

function normalizarFecha(v) {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
