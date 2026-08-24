import { validateAgentDefinition } from './validate.js'

/** Almacenamiento de ejemplo. En producción se reemplaza por el del sistema destino. */
export class InMemoryConversationStore {
  #items = new Map()
  async get(id) { return this.#items.get(id) || [] }
  async set(id, messages) { this.#items.set(id, messages) }
}

/**
 * Motor neutral. El proyecto destino inyecta:
 *   modelAdapter.complete({ provider, model, effort, system, messages, tools })
 *   tools[clave] = { description, inputSchema, execute(input, context) }
 *   conversationStore.get/set(id)
 *
 * Ninguno de esos adaptadores viaja dentro de la definición del agente.
 */
export class AgentRuntime {
  constructor({ definition, modelAdapter, tools = {}, conversationStore = new InMemoryConversationStore() }) {
    const checked = validateAgentDefinition(definition)
    if (!checked.ok) throw new Error(`Definición inválida: ${checked.errors.join(' ')}`)
    if (!modelAdapter?.complete) throw new Error('Falta un adaptador de modelo con complete().')
    this.definition = checked.definition
    this.model = modelAdapter
    this.tools = tools
    this.store = conversationStore
  }

  compatibility() {
    const requested = (this.definition.herramientas || []).filter(x => x.activa !== false)
    const available = requested.filter(x => this.tools[x.clave])
    const missing = requested.filter(x => !this.tools[x.clave]).map(x => x.clave)
    return { ok: missing.length === 0, available: available.map(x => x.clave), missing }
  }

  async run({ conversationId, input, context = {} }) {
    if (!conversationId) throw new Error('Falta conversationId.')
    if (!String(input || '').trim()) throw new Error('El mensaje está vacío.')

    const agent = this.definition.agente
    const limit = Math.max(2, Math.min(Number(agent.memoria_mensajes) || 20, 100))
    const history = (await this.store.get(conversationId)).slice(-limit)
    const messages = [...history, { role: 'user', content: String(input) }]
    const enabled = (this.definition.herramientas || [])
      .filter(x => x.activa !== false && this.tools[x.clave])
      .map(x => ({
        name: x.clave,
        description: x.descripcion || this.tools[x.clave].description || x.clave,
        inputSchema: this.tools[x.clave].inputSchema || { type: 'object', properties: {} },
      }))

    let text = ''
    for (let turn = 0; turn < 5; turn++) {
      const result = await this.model.complete({
        provider: agent.proveedor, model: agent.modelo, effort: agent.effort,
        system: buildSystem(this.definition), messages, tools: enabled,
      })
      if (result.text) text = [text, result.text].filter(Boolean).join('\n')
      const calls = Array.isArray(result.toolCalls) ? result.toolCalls : []
      if (!calls.length) break

      messages.push({ role: 'assistant', content: result.text || '', toolCalls: calls })
      for (const call of calls) {
        const tool = this.tools[call.name]
        if (!tool) throw new Error(`La capacidad ${call.name} no está instalada en este sistema.`)
        const output = await tool.execute(call.input || {}, context)
        messages.push({ role: 'tool', name: call.name, callId: call.id, content: output })
      }
    }

    const saved = [...messages, { role: 'assistant', content: text }].slice(-limit)
    await this.store.set(conversationId, saved)
    return { text, compatibility: this.compatibility() }
  }
}

function buildSystem(definition) {
  const a = definition.agente
  const knowledge = (definition.conocimiento || [])
    .filter(x => x.activo !== false && x.tipo !== 'IMAGEN' && x.texto)
    .map(x => `## ${x.titulo}\n${x.texto}`).join('\n\n')
  const rules = (definition.reglas || [])
    .filter(x => x.activo !== false && x.texto)
    .map((x, i) => `${i + 1}. ${x.texto}`).join('\n')
  return [
    `Nombre: ${a.nombre}`,
    a.objetivo ? `Objetivo: ${a.objetivo}` : '',
    a.idioma ? `Idioma: ${a.idioma}` : '',
    a.instrucciones || '',
    rules ? `# Reglas\n${rules}` : '',
    knowledge ? `# Conocimiento autorizado\n${knowledge}` : '',
  ].filter(Boolean).join('\n\n')
}
