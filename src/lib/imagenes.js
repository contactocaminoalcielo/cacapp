// Cliente frontend del flujo de solicitud de imágenes.
// LECTURA: directo a Supabase (PostgREST, coordinador autenticado).
// ESCRITURA CRÍTICA (enviar/reintentar/cancelar/preparar): solo vía orbit-backend
// (transaccional, idempotente, persiste evidencia y respeta la plantilla).
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'

export const ESTADO_SOLICITUD = {
  POR_VALIDAR: { label: 'Por validar', color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
  ENVIADO:     { label: 'Enviado',     color: '#3B6FBF', bg: '#EEF3FB', border: '#C5D8F5' },
  RECIBIDO:    { label: 'Recibido',    color: '#1D8A55', bg: '#E8F3EB', border: '#A0D4B0' },
  ERROR:       { label: 'Error',       color: '#C03030', bg: '#FEE8E8', border: '#FCA5A5' },
  CANCELADO:   { label: 'Cancelado',   color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB' },
}

// ¿El recordatorio requiere imagen? (mismo gate que el backend)
export function requiereImagen(rec) {
  return !!rec && rec.requiere_imagen === true && rec.solo_nombre !== true && (rec.max_fotos || 0) > 0
}

// ─── Lectura: solicitudes + servicio + mascota + cliente + plan + recordatorios ──
export async function obtenerSolicitudes() {
  const { data, error } = await db
    .from('solicitudes_imagenes')
    .select(`
      id, estado, codigo, enlace, whatsapp_destino, linea_wa, solo_adicional,
      fecha_solicitud, fecha_programada, fecha_envio, fecha_recepcion,
      message_id, contact_id, intentos, ultimo_error,
      servicios (
        id, fecha_ingreso, codigo_fotos,
        mascotas ( nombre, especies ( nombre ), clientes ( nombre, apellido, whatsapp ) ),
        planes ( nombre, codigo ),
        servicio_recordatorios ( origen, estado, recordatorios ( nombre, requiere_imagen, solo_nombre, max_fotos ) )
      )
    `)
    .neq('estado', 'CANCELADO')
    .order('fecha_solicitud', { ascending: false })
  if (error) throw error

  return (data || []).map(s => {
    const svc  = s.servicios || {}
    const srs  = (svc.servicio_recordatorios || [])
      .filter(sr => (sr.origen || '') !== 'REMOVIDO' && sr.estado !== 'NA')
      .filter(sr => requiereImagen(sr.recordatorios))
      .filter(sr => !s.solo_adicional || sr.origen === 'ADICIONAL')
      .map(sr => ({ nombre: sr.recordatorios?.nombre || 'Recordatorio', cantidad: sr.recordatorios?.max_fotos || 0 }))
    return { ...s, recordatorios_img: srs }
  })
}

// ─── Escrituras críticas (backend) ───────────────────────────────────────────
export function prepararContactos() {
  return orbitApi('/imagenes/preparar', { method: 'POST' })
}

// La línea emisora se fija en la configuración de Zolutium (GHL ignora fromNumber
// para números de WhatsApp importados de Meta), por eso no se envía aquí.
export function enviarSolicitud(solicitudId) {
  return orbitApi('/imagenes/enviar', { method: 'POST', body: { solicitud_id: solicitudId } })
}

export function reintentarSolicitud(solicitudId) {
  return orbitApi('/imagenes/reintentar', { method: 'POST', body: { solicitud_id: solicitudId } })
}

export function cancelarSolicitud(solicitudId) {
  return orbitApi('/imagenes/cancelar', { method: 'POST', body: { solicitud_id: solicitudId } })
}

// ─── Portal público (sin JWT; el código de acceso es el secreto) ─────────────
const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

export async function portalDatos(codigo) {
  const res = await fetch(`${API_BASE}/portal/imagenes/${encodeURIComponent(codigo)}`)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

export async function portalRecibir(codigo, payload) {
  const res = await fetch(`${API_BASE}/portal/imagenes/${encodeURIComponent(codigo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}
