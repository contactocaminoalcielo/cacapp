import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Orígenes permitidos (prod + dev local)
const ALLOWED = ['https://orbit.orbitacac.com', 'https://localhost:5173']
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const GHL_BASE = 'https://services.leadconnectorhq.com'

// ── Normalizar número colombiano ──
function normalizarTelefono(tel: string): string | null {
  const solo = (tel || '').replace(/\D/g, '')
  if (!solo) return null
  if (solo.startsWith('57') && solo.length >= 12) return `+${solo}`
  if (solo.length === 10) return `+57${solo}`
  if (solo.length >= 7) return `+57${solo}`
  return null
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // ── Auth: cualquier usuario autenticado (personal) ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const GHL_TOKEN = Deno.env.get('GHL_TOKEN')
    const GHL_LOCATION = Deno.env.get('GHL_LOCATION_ID')
    if (!GHL_TOKEN || !GHL_LOCATION) {
      return new Response(JSON.stringify({ error: 'GHL no configurado en el servidor' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const GHL_HEADERS = {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    }

    // La línea emisora NO es elegible por el cliente: toda la comunicación automática con
    // clientes sale por la 315 989 1247. Se ignora cualquier `fromNumber` que llegue en el
    // cuerpo (el frontend viejo aún lo manda) — ver orbit-backend/src/linea-wa.js.
    const LINEA_WA_ID = '967346343135405'   // phone_number_id de Meta de la +573159891247

    const { telefono, nombre = '', mensaje, pdfUrl } = await req.json()
    const numero = normalizarTelefono(telefono)
    if (!numero) {
      return new Response(JSON.stringify({ error: `Teléfono inválido: ${telefono}` }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── 1. Buscar o crear contacto ──
    let contactId: string | undefined
    const buscar = await fetch(
      `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&query=${encodeURIComponent(numero)}&limit=1`,
      { headers: GHL_HEADERS }
    )
    const dataBuscar = await buscar.json()
    if (!buscar.ok) throw new Error(dataBuscar.message || `Error buscando contacto: ${buscar.status}`)

    if (dataBuscar.contacts?.length) {
      contactId = dataBuscar.contacts[0].id
    } else {
      const crear = await fetch(`${GHL_BASE}/contacts/`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({
          locationId: GHL_LOCATION,
          phone: numero,
          firstName: nombre.split(' ')[0] || nombre,
          lastName: nombre.split(' ').slice(1).join(' ') || '',
        }),
      })
      const creado = await crear.json()
      if (!crear.ok) throw new Error(creado.message || `Error creando contacto: ${crear.status}`)
      contactId = creado.contact?.id
    }

    // ── 2. Enviar mensaje ──
    const body: Record<string, unknown> = { type: 'WhatsApp', contactId, message: mensaje }
    if (pdfUrl) body.attachments = [pdfUrl]
    // ⚠️ `type` es obligatorio dentro del bloque: sin él GHL responde 422 sin explicar qué
    // falta. Y `fromNumberId` en la raíz se acepta pero se IGNORA (probado con tráfico real).
    body.whatsapp = { type: 'text', fromNumberId: LINEA_WA_ID, toNumber: numero }

    const envio = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: GHL_HEADERS,
      body: JSON.stringify(body),
    })
    const dataEnvio = await envio.json()
    if (!envio.ok) throw new Error(dataEnvio.message || `Error enviando mensaje: ${envio.status}`)

    return new Response(JSON.stringify({ messageId: dataEnvio.messageId, contactId }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
