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

// ─── Líneas WhatsApp Business conectadas en Zolutium (no es secreto) ─────────
export const LINEAS_WHATSAPP = [
  { numero: '+573159891247', label: '315 989 1247' },
  { numero: '+573180967711', label: '318 096 7711' },
]

export function obtenerLineasWA() {
  return Promise.resolve(LINEAS_WHATSAPP)
}
