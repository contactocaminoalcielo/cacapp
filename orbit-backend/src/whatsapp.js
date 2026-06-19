// Envío de WhatsApp vía GoHighLevel / Zolutium — versión backend.
// Puerto de supabase/functions/send-whatsapp/index.ts para que el envío de
// reportes grupales y el registro de evidencia ocurran en UNA sola operación
// transaccional del backend (cierra la ventana de inconsistencia del flujo viejo).
//
// Requiere en /opt/orbit-backend/.env:
//   GHL_TOKEN=...           (el mismo de la Edge Function)
//   GHL_LOCATION_ID=...
const GHL_BASE = 'https://services.leadconnectorhq.com'

function normalizarTelefono(tel) {
  const solo = (tel || '').replace(/\D/g, '')
  if (!solo) return null
  if (solo.startsWith('57') && solo.length >= 12) return `+${solo}`
  if (solo.length === 10) return `+57${solo}`
  if (solo.length >= 7)   return `+57${solo}`
  return null
}

/**
 * Envía un WhatsApp con adjunto (URL al PDF) y devuelve la evidencia.
 * @returns {{ messageId, contactId }}
 * @throws  Error con mensaje legible si GHL falla (lo captura el endpoint y lo persiste).
 */
export async function enviarWhatsAppGHL({ telefono, nombre = '', mensaje, pdfUrl, fromNumber }) {
  const GHL_TOKEN    = process.env.GHL_TOKEN
  const GHL_LOCATION = process.env.GHL_LOCATION_ID
  if (!GHL_TOKEN || !GHL_LOCATION) throw new Error('GHL no configurado en el backend (GHL_TOKEN/GHL_LOCATION_ID)')

  const numero = normalizarTelefono(telefono)
  if (!numero) throw new Error(`Teléfono inválido: ${telefono}`)

  const headers = {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Version':       '2021-07-28',
    'Content-Type':  'application/json',
  }

  // 1. Buscar o crear contacto
  let contactId
  const buscar = await fetch(
    `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(numero)}&limit=1`,
    { headers }
  )
  const dataBuscar = await buscar.json()
  if (!buscar.ok) throw new Error(dataBuscar.message || `Error buscando contacto: ${buscar.status}`)

  if (dataBuscar.contacts?.length) {
    contactId = dataBuscar.contacts[0].id
  } else {
    const crear = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: GHL_LOCATION,
        phone:      numero,
        firstName:  nombre.split(' ')[0] || nombre,
        lastName:   nombre.split(' ').slice(1).join(' ') || '',
      }),
    })
    const creado = await crear.json()
    if (!crear.ok) throw new Error(creado.message || `Error creando contacto: ${crear.status}`)
    contactId = creado.contact?.id
  }

  // 2. Enviar mensaje
  const body = { type: 'WhatsApp', contactId, message: mensaje }
  if (pdfUrl)     body.attachments = [pdfUrl]
  if (fromNumber) body.fromNumber  = fromNumber

  const envio = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const dataEnvio = await envio.json()
  if (!envio.ok) throw new Error(dataEnvio.message || `Error enviando mensaje: ${envio.status}`)

  return { messageId: dataEnvio.messageId, contactId }
}

/**
 * Envía una PLANTILLA aprobada (HSM) — para iniciar conversación fuera de la
 * ventana de 24h (caso normal del reporte grupal). Busca/crea el contacto igual
 * que el envío de texto, luego manda la plantilla con variables + PDF de cabecera.
 *
 * ⚠️ CONTRATO A CONFIRMAR con Zolutium/GHL (dos campos): el endpoint exacto de
 * envío de plantilla y los nombres de campo (templateId/templateName, params,
 * header document). El payload de abajo sigue la forma estándar de GHL/MM-Lite;
 * si Zolutium expone otra, solo se ajusta `construirPayloadPlantilla`.
 *
 * @param variables  array posicional [{{1}}, {{2}}, {{3}}] del cuerpo de la plantilla
 */
export async function enviarPlantillaGHL({
  telefono, propietario = '', petName = '', plantillaNombre, idioma = 'es_MX', category = 'UTILITY', pdfUrl, pdfFilename,
}) {
  const GHL_TOKEN    = process.env.GHL_TOKEN
  const GHL_LOCATION = process.env.GHL_LOCATION_ID
  if (!GHL_TOKEN || !GHL_LOCATION) throw new Error('GHL no configurado en el backend (GHL_TOKEN/GHL_LOCATION_ID)')
  if (!plantillaNombre) throw new Error('Falta el nombre de la plantilla aprobada')

  const numero = normalizarTelefono(telefono)
  if (!numero) throw new Error(`Teléfono inválido: ${telefono}`)

  const headers = {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Version':       '2021-07-28',
    'Content-Type':  'application/json',
  }

  // Buscar/crear contacto (idéntico al envío de texto)
  let contactId
  const buscar = await fetch(
    `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(numero)}&limit=1`,
    { headers }
  )
  const dataBuscar = await buscar.json()
  if (!buscar.ok) throw new Error(dataBuscar.message || `Error buscando contacto: ${buscar.status}`)
  if (dataBuscar.contacts?.length) {
    contactId = dataBuscar.contacts[0].id
  } else {
    const crear = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: GHL_LOCATION, phone: numero,
        firstName: propietario.split(' ')[0] || propietario,
        lastName:  propietario.split(' ').slice(1).join(' ') || '',
      }),
    })
    const creado = await crear.json()
    if (!crear.ok) throw new Error(creado.message || `Error creando contacto: ${crear.status}`)
    contactId = creado.contact?.id
  }

  const body = construirPayloadPlantilla({ contactId, plantillaNombre, idioma, category, propietario, petName, pdfUrl, pdfFilename })
  const envio = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const dataEnvio = await envio.json()
  if (!envio.ok) {
    // Persistir la respuesta completa de GHL/Twilio para diagnóstico fino
    throw new Error(`GHL ${envio.status}: ${dataEnvio.message || ''} :: ${JSON.stringify(dataEnvio)}`)
  }
  return { messageId: dataEnvio.messageId, contactId }
}

/**
 * Envía una PLANTILLA aprobada genérica (HSM) con variables de cuerpo posicionales.
 * Para el flujo de solicitud de imágenes: body = [nombre, mascota, enlace, codigo].
 * Mismo contrato real de Zolutium/GHL que enviarPlantillaGHL, pero sin header de
 * documento y con los placeholders.body que reciba quien llama.
 *
 * @param bodyParams  array posicional resuelto [{{1}},{{2}},...]
 * @param mensaje     texto ya resuelto (lo que verá el cliente)
 * @returns {{ messageId, contactId }}
 */
export async function enviarPlantillaGenerica({
  telefono, nombre = '', plantillaNombre, idioma = 'es_MX', category = 'UTILITY',
  mensaje, bodyParams = [], fromNumber,
}) {
  const GHL_TOKEN    = process.env.GHL_TOKEN
  const GHL_LOCATION = process.env.GHL_LOCATION_ID
  if (!GHL_TOKEN || !GHL_LOCATION) throw new Error('GHL no configurado en el backend (GHL_TOKEN/GHL_LOCATION_ID)')
  if (!plantillaNombre) throw new Error('Falta el nombre de la plantilla aprobada')

  const numero = normalizarTelefono(telefono)
  if (!numero) throw new Error(`Teléfono inválido: ${telefono}`)

  const headers = {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Version':       '2021-07-28',
    'Content-Type':  'application/json',
  }

  // Buscar/crear contacto (idéntico patrón a las otras funciones)
  let contactId
  const buscar = await fetch(
    `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(numero)}&limit=1`,
    { headers }
  )
  const dataBuscar = await buscar.json()
  if (!buscar.ok) throw new Error(dataBuscar.message || `Error buscando contacto: ${buscar.status}`)
  if (dataBuscar.contacts?.length) {
    contactId = dataBuscar.contacts[0].id
  } else {
    const crear = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST', headers,
      body: JSON.stringify({
        locationId: GHL_LOCATION, phone: numero,
        firstName: nombre.split(' ')[0] || nombre,
        lastName:  nombre.split(' ').slice(1).join(' ') || '',
      }),
    })
    const creado = await crear.json()
    if (!crear.ok) throw new Error(creado.message || `Error creando contacto: ${crear.status}`)
    contactId = creado.contact?.id
  }

  const body = {
    MessageType: 19,
    type:        'WhatsApp',
    contactId,
    message:     mensaje || '',
    whatsapp: {
      type: 'template',
      template: { name: plantillaNombre, lang: idioma, category },
      placeholders: { header: [], body: bodyParams, buttons: [] },
    },
  }
  if (fromNumber) body.fromNumber = fromNumber

  const envio = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const dataEnvio = await envio.json()
  if (!envio.ok) throw new Error(`GHL ${envio.status}: ${dataEnvio.message || ''} :: ${JSON.stringify(dataEnvio)}`)
  return { messageId: dataEnvio.messageId, contactId }
}

// Payload EXACTO que usa el UI de Zolutium contra /conversations/messages
// (capturado por DevTools): message + whatsapp.placeholders con valores resueltos
// y el PDF en el header tipo document.
function construirPayloadPlantilla({ contactId, plantillaNombre, idioma, category, propietario, petName, pdfUrl, pdfFilename }) {
  return {
    MessageType: 19,
    type:        'WhatsApp',
    contactId,
    message: `Hola ${propietario}, le compartimos el certificado de ${petName}. Este documento certifica el proceso realizado con nuestros más altos estándares. — Camino al Cielo 🕊️ \n\nCamino al cielo funeraria para mascotas.`,
    whatsapp: {
      type: 'template',
      template: { name: plantillaNombre, lang: idioma, category },
      placeholders: {
        header: pdfUrl
          ? [{ type: 'document', document: { link: pdfUrl, filename: pdfFilename || 'certificado.pdf' } }]
          : [],
        body:    [propietario, petName],  // valores resueltos → ContentVariables {{1}},{{2}}
        buttons: [],
      },
    },
  }
}
