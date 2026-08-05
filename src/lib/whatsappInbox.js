// Bandeja de WhatsApp — cliente de la API del backend propio.
//
// Todo pasa por orbit-backend: las tablas `whatsapp_*` NO están expuestas por
// PostgREST (sin GRANT a authenticated) porque contienen teléfonos y texto libre
// de conversaciones. El permiso se valida en el backend con JWT + rol.
// Ver migraciones 086/087 y orbit-backend/src/whatsapp-cloud.js.
import { orbitApi } from '@/lib/orbitApi'

export function listarConversaciones(q) {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
  return orbitApi(`/whatsapp/conversaciones${qs}`)
}

export function abrirHilo(contacto) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}`)
}

export function marcarLeido(contacto) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/leido`, { method: 'POST' })
}

export function enviarMensaje(contacto, texto) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/enviar`, {
    method: 'POST',
    body: { texto },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentación
// ─────────────────────────────────────────────────────────────────────────────

/** 573001234567 → 300 123 4567 (se cae al original si no calza el formato). */
export function formatearNumero(contacto) {
  const d = String(contacto || '').replace(/\D/g, '')
  const local = d.length > 10 ? d.slice(-10) : d
  if (local.length !== 10) return contacto || ''
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

/** "hace 5 min", "hace 2 h", "ayer", "12 mar" — para la lista de conversaciones. */
export function haceCuanto(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

/** Hora del mensaje dentro del hilo. */
export function horaMensaje(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

/** Separador de día dentro del hilo: "Hoy", "Ayer", "lunes, 12 de marzo". */
export function etiquetaDia(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const hoy = new Date()
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1)
  const mismo = (a, b) => a.toDateString() === b.toDateString()
  if (mismo(d, hoy)) return 'Hoy'
  if (mismo(d, ayer)) return 'Ayer'
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Cuánto queda de la ventana de 24h de Meta.
 * Pasadas 24h desde el último mensaje del cliente ya no se puede mandar texto
 * libre — solo una plantilla aprobada.
 */
export function restanteVentana(ventanaHasta) {
  if (!ventanaHasta) return null
  const ms = new Date(ventanaHasta).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h} h ${m} m` : `${m} m`
}

/** Los 3 checks de WhatsApp, para los mensajes que enviamos nosotros. */
export const ESTADO_ENVIO = {
  sent:      { icono: '✓',  label: 'Enviado',   clase: 'text-gray-400' },
  delivered: { icono: '✓✓', label: 'Entregado', clase: 'text-gray-400' },
  read:      { icono: '✓✓', label: 'Leído',     clase: 'text-[#1A5CD8]' },
  failed:    { icono: '!',  label: 'Falló',     clase: 'text-red-500' },
}
