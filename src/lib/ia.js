// Claude Haiku — extracción de datos con IA
// API key de Anthropic: console.anthropic.com
const CLAUDE_KEY = 'CLAVE_REMOVIDA'
const MODELO     = 'claude-haiku-4-5-20251001'

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

async function llamarClaude(content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Error ${res.status}`)
  }

  const json = await res.json()
  const texto = json.content?.[0]?.text ?? ''
  const limpio = texto.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(limpio)
}

export async function extraerDesdeTexto(texto) {
  return llamarClaude([
    { type: 'text', text: PROMPT + '\n\nTexto a procesar:\n' + texto },
  ])
}

export async function extraerDesdeImagen(file) {
  const base64 = await comprimirImagen(file)
  return llamarClaude([
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
    { type: 'text', text: PROMPT },
  ])
}

function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1280
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else                { width  = Math.round(width  * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}
