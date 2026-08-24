// Motor OpenAI (ChatGPT).
//
// ⚠️⚠️ ESTE ADAPTADOR NO SE HA PROBADO NUNCA CONTRA LA API DE VERDAD. No hay
// `OPENAI_API_KEY` en el servidor, así que está escrito contra la forma
// documentada de su API y NADA MÁS. Lo digo aquí y lo dice la pantalla: el día
// que se ponga una llave, la primera conversación hay que mirarla entera.
//
// Lo que sí está resuelto es la traducción, que es donde estaba el trabajo. La
// forma canónica interna es la de Anthropic (ver `index.js`) y aquí se convierte
// en los dos sentidos:
//
//   · Bloques de contenido → OpenAI usa `image_url` con un data: URI en vez del
//     bloque `image` con `source.base64`.
//   · Herramientas → `{type:'function', function:{name, description, parameters}}`
//     en vez de `{name, description, input_schema}`.
//   · Petición de herramienta → `tool_calls` con los argumentos en un STRING
//     JSON, no en un objeto. Es la trampa más fácil de pasar por alto.
//   · Resultados → UN MENSAJE `role:'tool'` POR HERRAMIENTA, no un solo mensaje
//     con todos los resultados dentro como en Anthropic.
//
// 🩸 LO QUE NO TIENE EQUIVALENTE, Y HAY QUE SABERLO ANTES DE ELEGIRLO:
//
//   · No hay `cache_control`. OpenAI cachea solo, sin que se le pida y sin
//     garantía. Como el 64% de la factura del agente son escrituras de caché
//     controladas, cambiar de motor NO es solo cambiar de precio por token: es
//     perder la palanca con la que se bajó la cuenta un 37%.
//   · El razonamiento se configura distinto según la familia de modelo, así que
//     el esfuerzo NO se traduce: se ignora y se deja constancia.
const API = 'https://api.openai.com/v1/chat/completions'

export function estado() {
  return process.env.OPENAI_API_KEY
    ? { listo: true, variable: 'OPENAI_API_KEY', aviso: 'Nunca probado contra la API real' }
    : {
        listo: false,
        variable: 'OPENAI_API_KEY',
        motivo: 'Falta OPENAI_API_KEY en el servidor',
      }
}

/** Un bloque de contenido nuestro (= de Anthropic), en la forma de OpenAI. */
function bloque(b) {
  if (typeof b === 'string') return { type: 'text', text: b }
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'image') {
    const s = b.source || {}
    return { type: 'image_url', image_url: { url: `data:${s.media_type};base64,${s.data}` } }
  }
  return null
}

function traducirMensajes(system, messages) {
  const fuera = []

  // El `system` nuestro son BLOQUES (con marcas de caché); OpenAI quiere texto.
  const sys = (Array.isArray(system) ? system : [system])
    .map(b => (typeof b === 'string' ? b : b?.text || ''))
    .filter(Boolean).join('\n\n')
  if (sys) fuera.push({ role: 'system', content: sys })

  for (const m of messages) {
    const contenido = m.content

    // Un turno de usuario que en realidad son RESULTADOS de herramientas: en
    // Anthropic van todos en un mensaje; aquí, uno por herramienta.
    if (Array.isArray(contenido) && contenido.some(b => b?.type === 'tool_result')) {
      for (const b of contenido) {
        if (b?.type !== 'tool_result') continue
        fuera.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content ?? '') })
      }
      continue
    }

    // Un turno del asistente que pidió herramientas.
    if (m.role === 'assistant' && Array.isArray(contenido) && contenido.some(b => b?.type === 'tool_use')) {
      fuera.push({
        role: 'assistant',
        content: contenido.filter(b => b.type === 'text').map(b => b.text).join('\n') || null,
        tool_calls: contenido.filter(b => b.type === 'tool_use').map(b => ({
          id: b.id,
          type: 'function',
          // ⚠️ En string, no en objeto. Mandarlo como objeto lo rechaza.
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        })),
      })
      continue
    }

    fuera.push({
      role: m.role,
      content: typeof contenido === 'string'
        ? contenido
        : (contenido || []).map(bloque).filter(Boolean),
    })
  }
  return fuera
}

function traducirHerramientas(herramientas) {
  return (herramientas || []).map(h => ({
    type: 'function',
    function: { name: h.name, description: h.description, parameters: h.input_schema },
  }))
}

export async function pensar({ agente, system, messages, herramientas, maxTokens = 2048 }) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Falta OPENAI_API_KEY en el servidor')

  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: agente.modelo,
      max_completion_tokens: maxTokens,
      messages: traducirMensajes(system, messages),
      ...(herramientas?.length ? { tools: traducirHerramientas(herramientas) } : {}),
    }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d?.error) throw new Error(d?.error?.message || `OpenAI devolvió ${r.status}`)

  const m = d.choices?.[0]?.message || {}
  const u = d.usage || {}
  return {
    texto: (m.content || '').trim(),
    llamadas: (m.tool_calls || []).map(t => ({
      id: t.id,
      nombre: t.function?.name,
      // Llegan como texto: si el modelo devuelve un JSON roto, mejor un objeto
      // vacío —y que la herramienta diga qué falta— que reventar la respuesta.
      entrada: (() => { try { return JSON.parse(t.function?.arguments || '{}') } catch { return {} } })(),
    })),
    uso: {
      // OpenAI ya descuenta de `prompt_tokens` lo que sirvió de su caché
      // automática, así que se resta para no contarlo dos veces.
      entrada:        Math.max(0, (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || 0)),
      salida:         u.completion_tokens || 0,
      cacheEscritura: 0,
      cacheLectura:   u.prompt_tokens_details?.cached_tokens || 0,
    },
    fin: d.choices?.[0]?.finish_reason,
    // Se guarda en NUESTRA forma canónica, para que el historial siga siendo uno
    // solo y se pueda cambiar de motor a mitad de conversación sin traducir nada
    // hacia atrás.
    nativo: [
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.tool_calls || []).map(t => ({
        type: 'tool_use',
        id: t.id,
        name: t.function?.name,
        input: (() => { try { return JSON.parse(t.function?.arguments || '{}') } catch { return {} } })(),
      })),
    ],
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

export function pidioHerramientas(r) {
  return r.fin === 'tool_calls' || (r.llamadas || []).length > 0
}
