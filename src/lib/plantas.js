// Cliente frontend de la elección de planta (migración 149).
// LECTURA del catálogo y del tablero: directo a Supabase (PostgREST, personal
// autenticado). El PORTAL del cliente y toda escritura que mueva dinero van por
// orbit-backend: allí el precio sale de la DB, nunca del navegador.
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { compressImage, sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

export const BUCKET_PLANTAS = 'plantas'
export const MAX_MB_PLANTA  = 5

export const ESTADO_ELECCION = {
  PENDIENTE: { label: 'Por avisar',  color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
  ENVIADO:   { label: 'Avisado',     color: '#3B6FBF', bg: '#EEF3FB', border: '#C5D8F5' },
  ELEGIDA:   { label: 'Ya eligió',   color: '#1D8A55', bg: '#E8F3EB', border: '#A0D4B0' },
  ERROR:     { label: 'Error',       color: '#C03030', bg: '#FEE8E8', border: '#FCA5A5' },
  CANCELADA: { label: 'Cancelada',   color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB' },
}

// ─── Portal público (sin sesión) ─────────────────────────────────────────────
export async function portalPlanta(codigo) {
  const res = await fetch(`${API_BASE}/portal/planta/${encodeURIComponent(codigo)}`)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

export async function portalElegirPlanta(codigo, payload) {
  const res = await fetch(`${API_BASE}/portal/planta/${encodeURIComponent(codigo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// ─── Catálogo (Configuración → Plantas) ──────────────────────────────────────
export async function cargarPlantas() {
  const { data, error } = await db.from('plantas')
    .select('*').order('orden', { ascending: true }).order('nombre', { ascending: true })
  if (error) throw error
  return data || []
}

export async function guardarPlanta(planta) {
  const fila = {
    nombre:      String(planta.nombre || '').trim(),
    descripcion: planta.descripcion?.trim() || null,
    imagen_url:  planta.imagen_url?.trim() || null,
    precio:      Number(planta.precio) || 0,
    // Vitrina, no cobro (migración 158): es el precio de lista que el portal
    // tacha al lado del real. Vacío o no mayor que el precio → NULL, así no
    // queda un "antes" que no descuenta nada.
    precio_antes: Number(planta.precio_antes) > (Number(planta.precio) || 0)
      ? Number(planta.precio_antes) : null,
    elegible:    !!planta.elegible,
    adicional:   !!planta.adicional,
    orden:       parseInt(planta.orden) || 100,
    activo:      planta.activo !== false,
  }
  if (!fila.nombre) throw new Error('La planta necesita un nombre.')
  if (!fila.elegible && !fila.adicional)
    throw new Error('Marca al menos un uso: opción a elegir o extra de pago. Si no, no se muestra en ningún sitio.')
  // Una planta que SOLO se puede elegir no cobra nada: es la que va incluida en
  // el plan. Ponerle precio y esperar que se cobre es la confusión fácil — y el
  // dinero se perdería en silencio, sin un solo error.
  if (fila.elegible && !fila.adicional && fila.precio > 0)
    throw new Error('Una planta que solo es "opción a elegir" va incluida en el plan y NO se cobra. Deja el precio en $0, o márcala también como extra de pago para que se cobre.')
  const q = planta.id
    ? db.from('plantas').update(fila).eq('id', planta.id)
    : db.from('plantas').insert(fila)
  const { error } = await q
  if (error) throw error
}

/**
 * Sube la foto de una planta al bucket público `plantas` y devuelve su URL.
 *
 * Público a propósito: el portal lo abre una familia sin sesión. Se recomprime
 * antes de subir — la foto se ve en el celular de alguien que quizá está en la
 * calle, y una imagen de cámara sin tocar tarda una eternidad.
 *
 * El `sniffMime` mira los BYTES, no la extensión: un .jpg que en realidad es
 * otra cosa lo rechaza el bucket después, con un error que no dice nada.
 */
export async function subirImagenPlanta(file) {
  const mime = await sniffMime(file)
  if (!MIMES_IMAGEN_OK.includes(mime))
    throw new Error('Ese archivo no es una imagen válida. Usa JPG, PNG o WEBP.')
  const blob = await compressImage(file, 1200, 0.85)
  if (blob.size > MAX_MB_PLANTA * 1024 * 1024)
    throw new Error(`La imagen supera ${MAX_MB_PLANTA} MB. Usa una más liviana.`)
  const ext  = extDeMime(blob.type === 'image/jpeg' ? 'image/jpeg' : mime)
  const path = `catalogo/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from(BUCKET_PLANTAS)
    .upload(path, blob, { upsert: false, contentType: blob.type || mime })
  if (error) {
    console.error('[plantas] upload falló:', error?.message || error, { path })
    throw new Error('No se pudo subir la imagen. Revisa la conexión e intenta de nuevo.')
  }
  const { data: { publicUrl } } = db.storage.from(BUCKET_PLANTAS).getPublicUrl(path)
  return publicUrl
}

export async function borrarPlanta(id) {
  const { error } = await db.from('plantas').delete().eq('id', id)
  if (error) throw error
}

// ─── Elección de un servicio (ficha del Kanban) ──────────────────────────────
/** Devuelve `{ eleccion, adicionales }` o null si el servicio no tiene aviso. */
export async function eleccionDeServicio(servicioId) {
  const { data, error } = await db.from('planta_elecciones')
    .select('id, estado, codigo, enlace, fecha_cumplida, fecha_envio, fecha_eleccion, planta_nombre, error')
    .eq('servicio_id', servicioId)
    .maybeSingle()
  if (error || !data) return null
  const { data: extras } = await db.from('planta_adicionales')
    .select('id, nombre, cantidad, precio_unitario, total')
    .eq('eleccion_id', data.id)
    .order('created_at', { ascending: true })
  return { eleccion: data, adicionales: extras || [] }
}

/** Manda (o reintenta) el aviso de WhatsApp sin esperar al cron. */
export function enviarAvisoPlanta(eleccionId) {
  return orbitApi(`/plantas/${eleccionId}/enviar`, { method: 'POST' })
}
