// Cliente de Claude para el backend. Misma key/version que la Edge Function
// extraer-datos (CLAUDE_KEY en /opt/orbit-backend/.env). La IA solo SUGIERE:
// resume, prioriza, detecta inconsistencias y redacta. NUNCA envía, valida ni cierra.
import { registrar as registrarCosto } from './costos.js'

const MODELO_DEFAULT = 'claude-haiku-4-5-20251001'

/**
 * 🩸 ESTO TAMBIÉN GASTA, y hasta el 24-ago no aparecía en el panel de costos.
 * El panel se construyó instrumentando el agente de WhatsApp y la voz, y se dejó
 * fuera este camino —cuadres y grupales— sin querer. Un panel de costos que no
 * cuenta todo es peor que no tenerlo: da una cifra creíble y equivocada.
 *
 * `canal` dice de dónde salió, para que en la pantalla se distinga de lo que
 * gasta el agente.
 */
export async function llamarClaude({ system, prompt, maxTokens = 1024, model, canal = 'SISTEMA' } = {}) {
  const CLAUDE_KEY = process.env.CLAUDE_KEY
  if (!CLAUDE_KEY) throw new Error('CLAUDE_KEY no configurada en el backend')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      model || process.env.CLAUDE_MODEL || MODELO_DEFAULT,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages:   [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Error Claude ${res.status}`)
  }
  const json = await res.json()

  const u = json.usage || {}
  registrarCosto({
    proveedor: 'ANTHROPIC',
    canal,
    clave: json.model || model || MODELO_DEFAULT,
    tokensEntrada:  u.input_tokens || 0,
    tokensSalida:   u.output_tokens || 0,
    cacheEscritura: u.cache_creation_input_tokens || 0,
    cacheLectura:   u.cache_read_input_tokens || 0,
  })

  return json.content?.[0]?.text ?? ''
}
