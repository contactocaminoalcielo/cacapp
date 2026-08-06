// Envío de WhatsApp vía GoHighLevel — el token vive en la Edge Function
// `send-whatsapp` (server-side). El token NUNCA viaja al navegador.
import { callEdgeFunction } from '@/lib/supabase'

// ─── Enviar mensaje WhatsApp con adjunto (URL pública al PDF) ────────────────
// La línea emisora ya NO se manda desde el cliente: la fija el servidor. Se acepta y se
// ignora `fromNumber` para no romper a los llamadores viejos.
export async function enviarWhatsApp({ telefono, nombre, mensaje, pdfUrl }) {
  const { messageId } = await callEdgeFunction('send-whatsapp', {
    telefono, nombre, mensaje, pdfUrl,
  })
  return messageId
}

// ─── Línea WhatsApp Business OFICIAL en Zolutium (no es secreto) ─────────────
// Única línea desde la que sale TODA la gestión (David 2026-07-24). Quitar la segunda
// línea de esta lista NO bastó: GHL ignora `fromNumber` y rutea por la línea del último
// entrante del contacto, así que el 6,9 % de los envíos salía por la de veterinarias o
// la de HoyFarma. Desde 2026-08-06 la línea se fuerza server-side con
// `whatsapp.fromNumberId` — ver orbit-backend/src/linea-wa.js.
// Esta lista queda solo para MOSTRAR la línea en pantalla, no para elegirla.
export const LINEAS_WHATSAPP = [
  { numero: '+573159891247', label: '315 989 1247' },
]

export function obtenerLineasWA() {
  return Promise.resolve(LINEAS_WHATSAPP)
}
