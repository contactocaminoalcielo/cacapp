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

const MODELO = 'claude-haiku-4-5-20251001'

const PROMPT = `Eres el asistente de Camino al Cielo, funeraria de mascotas en Colombia.
Extrae los datos del texto o imagen y devuelve ÚNICAMENTE un JSON válido con esta estructura (null si no está disponible):

{
  "cliente_nombre": null,
  "cliente_apellido": null,
  "cliente_whatsapp": null,
  "cliente_telefono": null,
  "cliente_email": null,
  "cliente_direccion": null,
  "cliente_barrio": null,
  "cliente_ciudad": null,
  "mascota_nombre": null,
  "mascota_especie": null,
  "mascota_sexo": null,
  "mascota_peso_kg": null,
  "mascota_tamano": null,
  "mascota_raza": null,
  "mascota_notas": null,
  "recogida_direccion": null,
  "recogida_barrio": null,
  "recogida_ciudad": null,
  "recogida_hora": null,
  "recogida_notas": null
}

Reglas:
- mascota_especie: solo uno de: Perro, Gato, Conejo, Ave, Hámster, Pez, Reptil, Otro
- mascota_sexo: solo "Macho" o "Hembra"
- mascota_tamano: solo uno de: Mini, Pequeño, Mediano, Grande, Gigante
- mascota_peso_kg: número decimal (ej: 4.5), null si no aparece
- Si la dirección de recogida no se menciona, usa la del cliente
- Si la ciudad no se menciona, asume "Bogotá"
- Devuelve SOLO el JSON, sin explicaciones ni markdown`

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

    const CLAUDE_KEY = Deno.env.get('CLAUDE_KEY')
    if (!CLAUDE_KEY) {
      return new Response(JSON.stringify({ error: 'CLAUDE_KEY no configurada en el servidor' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { tipo, texto, imagenBase64 } = await req.json()

    let content: unknown
    if (tipo === 'imagen') {
      if (!imagenBase64) {
        return new Response(JSON.stringify({ error: 'Falta imagenBase64' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      content = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagenBase64 } },
        { type: 'text', text: PROMPT },
      ]
    } else {
      if (!texto?.trim()) {
        return new Response(JSON.stringify({ error: 'Falta el texto' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      content = [{ type: 'text', text: PROMPT + '\n\nTexto a procesar:\n' + texto }]
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODELO, max_tokens: 1024, messages: [{ role: 'user', content }] }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `Error Claude ${res.status}`)
    }

    const json = await res.json()
    const textoResp = json.content?.[0]?.text ?? ''
    const limpio = textoResp.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const datos = JSON.parse(limpio)

    return new Response(JSON.stringify(datos), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
