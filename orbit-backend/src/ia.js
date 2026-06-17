// Cliente de Claude para el backend. Misma key/version que la Edge Function
// extraer-datos (CLAUDE_KEY en /opt/orbit-backend/.env). La IA solo SUGIERE:
// resume, prioriza, detecta inconsistencias y redacta. NUNCA envía, valida ni cierra.
const MODELO_DEFAULT = 'claude-haiku-4-5-20251001'

export async function llamarClaude({ system, prompt, maxTokens = 1024, model } = {}) {
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
  return json.content?.[0]?.text ?? ''
}
