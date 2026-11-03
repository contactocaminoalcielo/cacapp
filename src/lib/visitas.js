// Visitas de la familia a la planta (migración 159).
//
// El PORTAL público va por orbit-backend: allí se decide qué días existen y se
// valida el que llega del navegador. Las lecturas y el cierre desde adentro van
// por PostgREST, como el resto del módulo Tenjo.
import { db } from '@/lib/supabase'
import { compressImage, sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

export const ESTADO_VISITA = {
  SOLICITADA: { label: 'Pedida por la familia', color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
  PROGRAMADA: { label: 'Confirmada',            color: '#3B6FBF', bg: '#EEF3FB', border: '#C5D8F5' },
  REALIZADA:  { label: 'Realizada',             color: '#1D8A55', bg: '#E8F3EB', border: '#A0D4B0' },
  CANCELADA:  { label: 'Cancelada',             color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB' },
}

export const FRANJA_LABEL = { MANANA: 'en la mañana', TARDE: 'en la tarde' }

// ─── Portal público (sin sesión) ─────────────────────────────────────────────
export async function portalVisita(codigo) {
  const res = await fetch(`${API_BASE}/portal/visita/${encodeURIComponent(codigo)}`)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

export async function portalPedirVisita(codigo, payload) {
  const res = await fetch(`${API_BASE}/portal/visita/${encodeURIComponent(codigo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// Restos cálcicos desde el mismo enlace (migración 205).
// La foto va a fotos-clientes/restos-calcicos/<código>/… (la política de
// storage solo deja subir ahí mientras la mascota siga en el cubículo) y el
// backend solo acepta una URL de esa carpeta.
export async function subirFotoRestos(codigo, file) {
  const mime = await sniffMime(file)
  if (!MIMES_IMAGEN_OK.includes(mime))
    throw new Error('Ese archivo no es una foto válida. Usa una imagen (JPG, PNG, WEBP o HEIC).')
  // Más grande que las del portal de fotos: es para personalizar un cenizario.
  const blob = await compressImage(file, 2000, 0.9)
  if (blob.size > 10 * 1024 * 1024) throw new Error('La foto supera 10 MB. Intenta con otra.')
  const ext = extDeMime(blob.type === 'image/jpeg' ? 'image/jpeg' : mime)
  const path = `restos-calcicos/${codigo}/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('fotos-clientes')
    .upload(path, blob, { upsert: false, contentType: blob.type || mime })
  if (error) {
    console.error('[VisitaCliente] upload falló:', error?.message || error, { path })
    throw new Error('No se pudo subir la foto. Revisa tu conexión e intenta de nuevo.')
  }
  return db.storage.from('fotos-clientes').getPublicUrl(path).data.publicUrl
}

export async function portalResponderRestos(codigo, payload) {
  const res = await fetch(`${API_BASE}/portal/visita/${encodeURIComponent(codigo)}/restos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// ─── Desde adentro ───────────────────────────────────────────────────────────

/**
 * Confirma una solicitud de la familia: SOLICITADA → PROGRAMADA, con la hora
 * exacta que pone la casa. La familia pidió una franja; la hora la decide quien
 * conoce la jornada.
 */
export async function confirmarSolicitudVisita(visitaId, { hora, novedades = null, personalId = null } = {}) {
  const cambios = {
    estado:         'PROGRAMADA',
    hora_visita:    hora || null,
    confirmada_en:  new Date().toISOString(),
    confirmada_por: personalId || null,
  }
  if (novedades != null) cambios.novedades = novedades
  const { error } = await db.from('visitas_tenjo').update(cambios).eq('id', visitaId)
  if (error) throw error
}
