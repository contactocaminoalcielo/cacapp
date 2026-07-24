// Envío de WhatsApp vía GoHighLevel — el token vive en la Edge Function
// `send-whatsapp` (server-side). El token NUNCA viaja al navegador.
import { callEdgeFunction } from '@/lib/supabase'

// ─── Enviar mensaje WhatsApp con adjunto (URL pública al PDF) ────────────────
export async function enviarWhatsApp({ telefono, nombre, mensaje, pdfUrl, fromNumber }) {
  const { messageId } = await callEdgeFunction('send-whatsapp', {
    telefono, nombre, mensaje, pdfUrl, fromNumber,
  })
  return messageId
}

// ─── Línea WhatsApp Business OFICIAL en Zolutium (no es secreto) ─────────────
// Única línea desde la que sale TODA la gestión (David 2026-07-24). Antes había
// una segunda línea (+573180967711 / 318 096 7711) y algunos mensajes salían por
// ahí; se retiró para forzar una sola emisora en todos los flujos que respetan
// fromNumber (Certificados, recibo del técnico, reportes grupales).
// ⚠️ Para las PLANTILLAS WABA (contactos/imágenes/digitales) GHL IGNORA fromNumber
// y rutea por el "canal por defecto" del panel de Zolutium: esa unicidad se
// garantiza dejando la 315 como canal por defecto en Zolutium, no desde aquí.
export const LINEAS_WHATSAPP = [
  { numero: '+573159891247', label: '315 989 1247' },
]

export function obtenerLineasWA() {
  return Promise.resolve(LINEAS_WHATSAPP)
}
