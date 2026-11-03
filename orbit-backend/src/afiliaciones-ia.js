// Lee con IA un contrato pre-exequial de la base antigua (PDF) y devuelve sus
// datos para que el coordinador los REVISE antes de crear nada. No escribe en
// la DB: la pantalla (Pre-Exequiales › Subir contratos PDF) muestra lo leído,
// el humano corrige y confirma, y recién ahí se crea el contrato.
import { llamarClaude } from './ia.js'

// Sonnet y no Haiku: son escaneos, a veces torcidos o escritos a mano, y un
// error en la cédula o en la fecha de afiliación cambia el número de contrato
// y la antigüedad. Leer bien vale más que ahorrar centavos por contrato.
const MODELO = 'claude-sonnet-5'
const MAX_BYTES = 20 * 1024 * 1024

const SYSTEM = `Eres el asistente de Camino al Cielo, funeraria de mascotas en Colombia.
Lees contratos de afiliación pre-exequial para mascotas (planes BRONCE, PLATA, ORO, DIAMANTE;
ANUAL renovable o VITALICIO) y transcribes sus datos con exactitud. Nunca inventas: si un dato
no está en el documento o no se lee, lo dejas en null y lo anotas en "dudas".`

const PROMPT = `Extrae los datos de este contrato y devuelve ÚNICAMENTE un JSON válido, sin markdown, con esta forma:

{
  "numero_contrato": null,
  "fecha_afiliacion": null,
  "tipo": null,
  "nivel": null,
  "valor_por_mascota": null,
  "valor_total": null,
  "metodo_pago": null,
  "fecha_pago": null,
  "vigente_hasta": null,
  "cliente": {
    "nombre": null, "apellido": null, "cedula_nit": null, "whatsapp": null,
    "telefono": null, "email": null, "direccion": null, "ciudad": null
  },
  "mascotas": [
    { "nombre": null, "especie": null, "raza": null, "sexo": null, "tamano": null, "peso_kg": null, "edad_anios": null }
  ],
  "observaciones": null,
  "dudas": []
}

Reglas:
- numero_contrato: tal cual aparece impreso o escrito (ej. "ABR1124SR10-BR0"), en mayúsculas.
- fecha_afiliacion: fecha en que se firmó/formalizó el contrato, formato AAAA-MM-DD. vigente_hasta: solo si el documento dice explícitamente hasta cuándo va, AAAA-MM-DD.
- tipo: "ANUAL" o "VITALICIO". nivel: "BRONCE", "PLATA", "ORO" o "DIAMANTE".
- valor_por_mascota y valor_total: números enteros en pesos, sin puntos ni signos. Si solo aparece el total y hay varias mascotas, divide.
- metodo_pago: "EFECTIVO", "TRANSFERENCIA", "TARJETA" u "OTRO".
- cliente.nombre = nombres, cliente.apellido = apellidos. cedula_nit: solo dígitos.
- whatsapp y telefono: solo dígitos, sin +57 (10 dígitos en Colombia). Si hay un solo celular, va en whatsapp.
- ciudad: si no aparece, "Bogotá".
- Una entrada en "mascotas" por cada mascota cubierta.
- especie: "Perro", "Gato", "Conejo", "Ave", "Hámster", "Pez", "Reptil" u "Otro".
- sexo: "Macho" o "Hembra". tamano: "Mini", "Pequeño", "Mediano", "Grande" o "Gigante".
- peso_kg: número decimal. edad_anios: número entero de años a la fecha del contrato.
- dudas: lista corta de los campos ilegibles, dudosos o contradictorios (ej. "cédula borrosa").`

function parsearJson(texto) {
  const limpio = String(texto || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(limpio) } catch { /* sigue */ }
  const ini = limpio.indexOf('{'), fin = limpio.lastIndexOf('}')
  if (ini >= 0 && fin > ini) return JSON.parse(limpio.slice(ini, fin + 1))
  throw new Error('La IA no devolvió datos legibles')
}

export async function leerContratoPdf({ pdfBase64 }) {
  const data = String(pdfBase64 || '').replace(/^data:[^,]+,/, '')
  if (!data) return { status: 400, body: { error: 'Falta el PDF' } }
  const bytes = Buffer.byteLength(data, 'base64')
  if (bytes > MAX_BYTES) return { status: 413, body: { error: 'El PDF supera 20 MB. Divídelo o comprímelo.' } }
  if (!Buffer.from(data.slice(0, 8), 'base64').toString('latin1').startsWith('%PDF'))
    return { status: 400, body: { error: 'El archivo no es un PDF' } }

  const texto = await llamarClaude({
    system: SYSTEM,
    model: MODELO,
    maxTokens: 2000,
    canal: 'AFILIACIONES',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
      { type: 'text', text: PROMPT },
    ],
  })
  const datos = parsearJson(texto)
  if (!Array.isArray(datos.mascotas)) datos.mascotas = []
  datos.mascotas = datos.mascotas.filter(m => m && String(m.nombre || '').trim())
  if (!Array.isArray(datos.dudas)) datos.dudas = []
  datos.cliente = datos.cliente || {}
  return { status: 200, body: datos }
}
