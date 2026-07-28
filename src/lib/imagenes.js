// Cliente frontend del flujo de solicitud de imágenes.
// LECTURA: directo a Supabase (PostgREST, coordinador autenticado).
// ESCRITURA CRÍTICA (enviar/reintentar/cancelar/preparar): solo vía orbit-backend
// (transaccional, idempotente, persiste evidencia y respeta la plantilla).
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { FECHA_CORTE } from '@/lib/constants'
import { sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'

export const ESTADO_SOLICITUD = {
  POR_VALIDAR:   { label: 'Por validar',   color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
  ENVIADO:       { label: 'Enviado',       color: '#3B6FBF', bg: '#EEF3FB', border: '#C5D8F5' },
  RECIBIDO:      { label: 'Recibido',      color: '#1D8A55', bg: '#E8F3EB', border: '#A0D4B0' },
  ERROR:         { label: 'Error',         color: '#C03030', bg: '#FEE8E8', border: '#FCA5A5' },
  CANCELADO:     { label: 'Cancelado',     color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB' },
  // Agotados los 3 contactos sin que el cliente cargue → requiere llamada humana.
  // El enlace del portal sigue vivo: si carga tarde, la solicitud pasa a RECIBIDO.
  SIN_RESPUESTA: { label: 'Sin respuesta', color: '#B45309', bg: '#FEF3C7', border: '#FCD34D' },
}

// ¿El recordatorio requiere imagen? (mismo gate que el backend)
export function requiereImagen(rec) {
  return !!rec && rec.requiere_imagen === true && rec.solo_nombre !== true && (rec.max_fotos || 0) > 0
}

// ─── ¿A qué número se le escribe? ────────────────────────────────────────────
// Manda el número VIGENTE de la ficha del cliente. `solicitudes_imagenes
// .whatsapp_destino` es el registro de a dónde salió el contacto 1, NO la
// libreta de direcciones: cuando el coordinador corrige el WhatsApp (justamente
// porque el viejo estaba malo), el 2º y el 3º deben ir al nuevo. Mostrar el
// snapshot hacía creer que el cambio no se había guardado.
// Mismo criterio de validez que el backend (`waOrNull` en seguimiento-imagenes.js)
// y que la consulta que arma las solicitudes: al menos 10 dígitos.
export function waVigente(whatsappCliente, destinoRegistrado) {
  const sirve = v => {
    const s = String(v || '').trim()
    return s.replace(/\D/g, '').length >= 10 ? s : null
  }
  return sirve(whatsappCliente) || sirve(destinoRegistrado) || null
}

// ─── Etapa de contacto (compartida por Seguimiento, Producción, Ficha y Kanban) ──
// Vive aquí y no en cada página para que las cuatro digan lo MISMO: si esta regla
// se duplica, un módulo acaba contradiciendo al otro sobre el mismo cliente.

// Se toma el MAYOR contacto enviado, no el conteo: si el 2º se saltó (pausa, o el
// servicio salió de la ventana del portal), la solicitud va igual en el 3º —
// contar diría "2 de 3" y engañaría.
export function etapaContacto(contactos = []) {
  const enviados = contactos.filter(c => c.estado === 'ENVIADO').map(c => c.numero)
  if (!enviados.length) return { numero: 0, texto: 'sin contactar', color: '#9CA3AF' }
  const ultimo = Math.max(...enviados)
  return {
    numero: ultimo,
    texto: `va en el ${ultimo}º`,
    // El 3º es el último aviso antes de cerrar por falta de respuesta → ámbar.
    color: ultimo === 3 ? '#B45309' : '#4B5563',
  }
}

/**
 * Etapa de contacto por servicio: { servicio_id → etapaContacto() }.
 * `fotosOk` (servicios.fecha_imagenes_recibidas) manda sobre todo: si el cliente
 * ya cargó, no hay nada que perseguir y la etiqueta sobra — quien llama decide.
 *
 * ⚠️ Trocear SIEMPRE: `.in()` con cientos de IDs arma una URL que nginx corta con
 * 414, y supabase-js NO lanza — la etiqueta simplemente "desaparecería" sin error.
 */
export async function cargarEtapasContacto(servicioIds = []) {
  const ids = [...new Set(servicioIds.filter(Boolean))]
  const mapa = {}
  if (!ids.length) return mapa

  const LOTE = 80
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await db
      .from('solicitud_imagenes_contactos')
      .select('servicio_id, numero, estado')
      .in('servicio_id', ids.slice(i, i + LOTE))
    if (error) throw error
    for (const c of data || []) (mapa[c.servicio_id] ||= []).push(c)
  }
  return Object.fromEntries(
    Object.entries(mapa).map(([sid, cs]) => [sid, etapaContacto(cs)])
  )
}

// ─── Lectura: solicitudes + servicio + mascota + cliente + plan + recordatorios ──
export async function obtenerSolicitudes() {
  const { data, error } = await db
    .from('solicitudes_imagenes')
    .select(`
      id, estado, codigo, enlace, whatsapp_destino, linea_wa, solo_adicional,
      fecha_solicitud, fecha_programada, fecha_envio, fecha_recepcion,
      message_id, contact_id, intentos, ultimo_error,
      seguimiento_pausado, motivo_cierre, fecha_cierre,
      servicios!inner (
        id, fecha_ingreso, codigo_fotos,
        mascotas ( nombre, especies ( nombre ), clientes ( nombre, apellido, whatsapp ) ),
        planes ( nombre, codigo ),
        servicio_recordatorios ( origen, estado, recordatorios ( nombre, requiere_imagen, solo_nombre, max_fotos ) )
      )
    `)
    .neq('estado', 'CANCELADO')
    .gte('servicios.fecha_ingreso', FECHA_CORTE)
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

// ─── Seguimiento automático: 2º y 3er contacto (migración 044) ───────────────
// Las fechas de los contactos son días HÁBILES (con festivos): las calcula la DB.
// El navegador nunca las recalcula — solo pinta lo que el backend le da.
export async function obtenerSeguimiento() {
  const r = await orbitApi('/imagenes/seguimiento')
  return r?.seguimiento || {}
}

/** Adelanta el 2º/3er contacto sin esperar al cron (lo decide una persona). */
export function forzarContacto(solicitudId, numero) {
  return orbitApi('/imagenes/forzar-contacto', { method: 'POST', body: { solicitud_id: solicitudId, numero } })
}

/** Saca (o devuelve) un caso de la cadencia automática. */
export function pausarSeguimiento(solicitudId, pausado) {
  return orbitApi('/imagenes/pausar-seguimiento', { method: 'POST', body: { solicitud_id: solicitudId, pausado } })
}

// ─── Reemplazo de una foto por otra de mejor calidad (Producción y Kanban) ───
// El portal comprime a 1200px/JPEG82 (imageUtils.compressImage) para no reventar
// la RAM de un Android. Cuando esa foto no da para producir, el equipo sube una
// mejor. La original NO se pierde: queda en produccion_imagen_log y su archivo
// sigue en el bucket (ruta nueva por uuid, sin upsert ni delete).

export const MAX_MB_REEMPLAZO = 25

/**
 * Sube la foto de reemplazo al bucket y devuelve su URL pública.
 *
 * ⚠️ NO pasa por compressImage a propósito: el objetivo es MÁS calidad, y
 * comprimir aquí la devolvería a los mismos 1200px que causaron el problema.
 * Se sube el archivo tal cual, validando el tipo real por magic bytes.
 * Esto corre en el escritorio de Producción, no en el Android del cliente, así
 * que el riesgo de OOM del portal no aplica: nunca se decodifica la imagen.
 */
export async function subirImagenReemplazo(servicioId, srId, file) {
  const mime = await sniffMime(file)
  if (!MIMES_IMAGEN_OK.includes(mime))
    throw new Error('Ese archivo no es una foto válida. Usa JPG, PNG, WEBP o HEIC.')
  if (file.size > MAX_MB_REEMPLAZO * 1024 * 1024)
    throw new Error(`La imagen supera ${MAX_MB_REEMPLAZO} MB. Usa una un poco más liviana.`)

  const path = `${servicioId}/${srId}/mejora-${crypto.randomUUID()}.${extDeMime(mime)}`
  const { error } = await db.storage.from('fotos-clientes')
    .upload(path, file, { upsert: false, contentType: mime })
  if (error) {
    console.error('[reemplazo] upload falló:', error?.message || error, { path })
    throw new Error('No se pudo subir la imagen. Revisa la conexión e intenta de nuevo.')
  }
  const { data: { publicUrl } } = db.storage.from('fotos-clientes').getPublicUrl(path)
  return publicUrl
}

/**
 * Cambia la foto de `posicion` (1-based) por `urlNueva` y deja constancia.
 * Todo ocurre dentro de la función de DB: no hay reemplazo sin log.
 */
export async function reemplazarImagen({ srId, posicion, urlNueva, motivo }) {
  const { data, error } = await db.rpc('reemplazar_imagen_recordatorio', {
    p_sr_id:     srId,
    p_posicion:  posicion,
    p_url_nueva: urlNueva,
    p_motivo:    motivo || null,
  })
  if (error) throw new Error(error.message || 'No se pudo reemplazar la imagen')
  return data
}

/** Historial de reemplazos de un servicio (el más reciente primero). */
export async function historialImagenes(servicioId) {
  const { data, error } = await db.from('produccion_imagen_log')
    .select('*')
    .eq('servicio_id', servicioId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
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
