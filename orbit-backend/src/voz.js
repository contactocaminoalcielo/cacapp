// La voz del agente: convertir su respuesta en audio (migración 107).
//
// Este módulo NO sabe nada de Camino al Cielo. Recibe el agente —su voz, su
// modelo— y un texto. La empresa hermana usará este mismo código con otra fila
// en `agente_wa` y otra voz, sin tocar una línea.
//
// 🩸 LO QUE MANDA AQUÍ ES LA LATENCIA, NO LA CALIDAD.
//
// En un chat da igual que el audio tarde dos segundos. En una llamada, un
// silencio de más de segundo y medio se siente como que se cortó: la persona
// dice "¿aló?" y se pisa con el agente. Por eso:
//
//   · Se usa el modelo `flash`, el de baja latencia, y no el de máxima
//     calidad. Suena un matiz peor y llega mucho antes.
//   · Se pide en STREAMING y se mide el PRIMER BYTE, no el total. Lo que
//     importa es cuándo empieza a sonar, no cuándo termina.
//   · Se sintetiza FRASE A FRASE. Esperar a que el modelo termine de escribir
//     para empezar a hablar suma los dos tiempos; encadenarlos los solapa.
import { log } from './db.js'

const MOD = '[voz]'
const API = 'https://api.elevenlabs.io/v1'

/**
 * Formato del audio.
 *
 * `mp3_22050_32` para pruebas y para mandar por WhatsApp. Cuando esto se
 * conecte a una llamada de verdad habrá que pedir `ulaw_8000`, que es lo que
 * come la telefonía — pero eso se decide en quien llama, no aquí.
 */
const FORMATO_POR_DEFECTO = 'mp3_22050_32'

/** Un texto que se pueda decir: sin markdown, sin marcas, sin emojis sueltos. */
export function decible(texto) {
  return String(texto || '')
    // Los asteriscos de negrita se leen en voz alta como "asterisco" en algunos
    // motores, y en el mejor caso alteran la entonación. Ya nos mordió en el
    // chat, donde la vet los veía escritos.
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    // Las marcas que la bandeja añade al historial ([botón: …], [imagen]) no
    // son cosas que nadie deba oír.
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .replace(/https?:\/\/\S+/g, 'el enlace que te acabo de mandar')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Corta un texto en frases para poder ir hablando mientras el modelo escribe.
 *
 * Devuelve [frase, resto]. Solo corta cuando hay una frase entera y con
 * sustancia: sintetizar "Sí." por su cuenta suena entrecortado y gasta una
 * llamada a la API para nada.
 */
export function siguienteFrase(buffer, minimo = 30) {
  // Se construye con `new RegExp` porque el mínimo es un parámetro: en una
  // expresión literal no se puede interpolar.
  // Doble barra a propósito: dentro de una plantilla, `\s` se convierte en `s`
  // y la expresión acabaría buscando la letra ese. Con `\\s` la RegExp recibe
  // el `\s` de verdad.
  const m = new RegExp(`^([\\s\\S]{${minimo},}?[.!?…])(\\s|$)`).exec(buffer)
  if (!m) return [null, buffer]
  return [m[1].trim(), buffer.slice(m[0].length)]
}

function credenciales() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return { error: 'Falta ELEVENLABS_API_KEY en el servidor' }
  return { key }
}

/**
 * Convierte un texto en audio y devuelve el flujo, no el archivo entero.
 *
 * `alPrimerByte` se llama en cuanto llega el primer trozo. Es LA medida que
 * importa: es el instante en que la persona al teléfono deja de oír silencio.
 */
export async function sintetizar({ agente, texto, formato = FORMATO_POR_DEFECTO, alPrimerByte = null }) {
  const { key, error } = credenciales()
  if (error) return { error }
  if (!agente?.voz_id) return { error: 'Este agente no tiene voz configurada (agente_wa.voz_id)' }

  const limpio = decible(texto)
  if (!limpio) return { error: 'No hay nada que decir' }

  const t0 = Date.now()
  const r = await fetch(
    `${API}/text-to-speech/${agente.voz_id}/stream?output_format=${formato}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: limpio,
        model_id: agente.voz_modelo || 'eleven_flash_v2_5',
        // `optimize_streaming_latency` sacrifica un poco de prosodia por
        // arrancar antes. En una llamada ese cambio es el correcto.
        optimize_streaming_latency: 3,
      }),
    }
  )

  if (!r.ok) {
    const detalle = await r.text().catch(() => '')
    log(MOD, `ElevenLabs rechazó la síntesis (${r.status}) —`, detalle.slice(0, 200))
    return { error: `No se pudo generar la voz (${r.status})` }
  }

  const trozos = []
  let primerByte = null
  for await (const t of r.body) {
    if (primerByte === null) {
      primerByte = Date.now() - t0
      alPrimerByte?.(primerByte)
    }
    trozos.push(Buffer.from(t))
  }

  const audio = Buffer.concat(trozos)
  return { audio, primerByte, total: Date.now() - t0, texto: limpio }
}
