// Envío de documentos por el transporte operativo de Orbit. El backend decide
// entre GHL (transición) y Meta directo; ninguna credencial viaja al navegador.
import { orbitApi } from '@/lib/orbitApi'

// ─── Enviar mensaje WhatsApp con adjunto (URL pública al PDF) ────────────────
// La línea emisora ya NO se manda desde el cliente: la fija el servidor. Se acepta y se
// ignora `fromNumber` para no romper a los llamadores viejos.
//
// `publico` dice A QUIÉN se le escribe — 'CLIENTE' (la familia) o 'VETERINARIA'
// (la clínica) — y con eso el servidor escoge la línea: la de familias o la de
// veterinarias. Se manda el público y NO la línea a propósito: qué número le
// corresponde a cada destinatario es una decisión del servidor, no algo que el
// navegador pueda elegir. Sin `publico` se asume CLIENTE, que es por donde
// salían todos los documentos hasta el 17-sep-2026.
export async function enviarWhatsApp({
  telefono, nombre, mensaje, pdfUrl, pdfFilename,
  tipoDocumento = 'DOCUMENTO', referencia = '', mascota = '', publico = 'CLIENTE',
}) {
  const { messageId } = await orbitApi('/whatsapp/operativo/documento', {
    method: 'POST',
    body: {
      telefono, nombre, mensaje, pdfUrl, pdfFilename,
      tipoDocumento, referencia, mascota, publico,
    },
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
