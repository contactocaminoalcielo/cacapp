// Motor Anthropic (Claude) — el que está en producción.
//
// Es la IDENTIDAD: la forma canónica interna es la suya (ver `index.js`), así
// que aquí no se traduce nada. Este archivo es el código que ya vivía dentro de
// `ejecutar`, movido tal cual. Si algún día el agente responde distinto tras
// esta refactorización, el fallo está en el traslado, no en la lógica.
import Anthropic from '@anthropic-ai/sdk'

let cliente = null
function api() {
  if (!cliente) {
    const apiKey = process.env.CLAUDE_KEY
    if (!apiKey) throw new Error('CLAUDE_KEY no configurada en el backend')
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}

export function estado() {
  return process.env.CLAUDE_KEY
    ? { listo: true, variable: 'CLAUDE_KEY' }
    : { listo: false, variable: 'CLAUDE_KEY', motivo: 'Falta CLAUDE_KEY en el servidor' }
}

/**
 * El razonamiento, solo en los modelos que lo admiten.
 *
 * 🩸 **Haiku 4.5 rechaza `thinking` y `effort` con un 400**, y la pantalla
 * ofrece Haiku como la opción barata — que es justo la que uno prueba primero.
 * Mandarlos siempre dejaba al agente MUDO: recibía el mensaje, fallaba al
 * llamar a Claude, y la veterinaria no veía respuesta ninguna.
 *
 * Se decide por familia de modelo, no por una lista de "modelos malos": así un
 * modelo nuevo de la familia 5 funciona sin tocar esto.
 *
 * Y al revés: en los que sí razonan, los tokens de pensar se facturan como
 * SALIDA —cinco veces la entrada— sin aparecer en el mensaje. Por eso el
 * esfuerzo es una palanca de costo real, no solo de calidad.
 */
function razonamiento(modelo, effort) {
  const familia5   = /^claude-(opus|sonnet|fable|mythos)-5\b/.test(modelo)
  const cuatroSeis = /^claude-(opus|sonnet)-4-(6|7|8)\b/.test(modelo)
  if (!familia5 && !cuatroSeis) return {}
  return { thinking: { type: 'adaptive' }, output_config: { effort } }
}

export async function pensar({ agente, system, messages, herramientas, maxTokens = 2048 }) {
  const r = await api().messages.create({
    model:      agente.modelo,
    max_tokens: maxTokens,
    system,
    messages,
    tools: herramientas,
    ...razonamiento(agente.modelo, agente.effort),
  })

  const u = r.usage || {}
  return {
    // El texto se lee de TODOS los bloques, no solo del primero: el modelo habla
    // mientras usa herramientas y su respuesta puede venir partida.
    texto: (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
    llamadas: (r.content || [])
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, nombre: b.name, entrada: b.input })),
    uso: {
      entrada:        u.input_tokens || 0,
      salida:         u.output_tokens || 0,
      cacheEscritura: u.cache_creation_input_tokens || 0,
      cacheLectura:   u.cache_read_input_tokens || 0,
    },
    fin: r.stop_reason,
    // Los bloques viajan de vuelta TAL CUAL: quitarlos o reconstruirlos rompe el
    // emparejamiento tool_use/tool_result y la API lo rechaza.
    nativo: r.content,
  }
}

export function mensajeAsistente(r) {
  return { role: 'assistant', content: r.nativo }
}

export function mensajeResultados(items) {
  return {
    role: 'user',
    content: items.map(i => ({
      type: 'tool_result',
      tool_use_id: i.id,
      content: i.contenido,
      is_error: !!i.error,
    })),
  }
}

/** ¿Terminó pidiendo herramientas? */
export function pidioHerramientas(r) {
  return r.fin === 'tool_use'
}
