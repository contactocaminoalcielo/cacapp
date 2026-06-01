// Integración con GoHighLevel (Zolutium) para envío de WhatsApp
const GHL_TOKEN      = import.meta.env.VITE_GHL_TOKEN
const GHL_LOCATION   = import.meta.env.VITE_GHL_LOCATION_ID
const GHL_BASE       = 'https://services.leadconnectorhq.com'
const GHL_HEADERS    = {
  'Authorization': `Bearer ${GHL_TOKEN}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
}

// ─── Buscar o crear contacto por teléfono ────────────────────────────────────
export async function obtenerContactoId(telefono, nombre = '') {
  const numero = normalizarTelefono(telefono)
  if (!numero) throw new Error(`Teléfono inválido: ${telefono}`)

  // Buscar contacto existente
  const res = await fetch(
    `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(numero)}&limit=1`,
    { headers: GHL_HEADERS }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || `Error buscando contacto: ${res.status}`)

  if (data.contacts?.length) return data.contacts[0].id

  // Crear contacto si no existe
  const crear = await fetch(`${GHL_BASE}/contacts/`, {
    method:  'POST',
    headers: GHL_HEADERS,
    body:    JSON.stringify({
      locationId: GHL_LOCATION,
      phone:      numero,
      firstName:  nombre.split(' ')[0] || nombre,
      lastName:   nombre.split(' ').slice(1).join(' ') || '',
    }),
  })
  const creado = await crear.json()
  if (!crear.ok) throw new Error(creado.message || `Error creando contacto: ${crear.status}`)
  return creado.contact?.id
}

// ─── Enviar mensaje WhatsApp con adjunto (URL pública al PDF) ────────────────
export async function enviarWhatsApp({ telefono, nombre, mensaje, pdfUrl, fromNumber }) {
  const contactId = await obtenerContactoId(telefono, nombre)

  const body = {
    type:        'WhatsApp',
    contactId,
    message:     mensaje,
    ...(pdfUrl      && { attachments: [pdfUrl] }),
    ...(fromNumber  && { fromNumber }),
  }

  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method:  'POST',
    headers: GHL_HEADERS,
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || `Error enviando mensaje: ${res.status}`)
  return data.messageId
}

// ─── Líneas WhatsApp Business conectadas en Zolutium ─────────────────────────
export const LINEAS_WHATSAPP = [
  { numero: '+573159891247', label: '315 989 1247' },
  { numero: '+573180967711', label: '318 096 7711' },
]

export function obtenerLineasWA() {
  return Promise.resolve(LINEAS_WHATSAPP)
}

// ─── Normalizar número colombiano ───────────────────────────────────────────
function normalizarTelefono(tel) {
  const solo = (tel || '').replace(/\D/g, '')
  if (!solo) return null
  // Ya tiene código de país
  if (solo.startsWith('57') && solo.length >= 12) return `+${solo}`
  // Número local de 10 dígitos
  if (solo.length === 10) return `+57${solo}`
  // Número de 7 u 8 dígitos (fijo)
  if (solo.length >= 7) return `+57${solo}`
  return null
}
