const SECRET_KEYS = /(^|_)(password|secret|token|api_?key|authorization|credential|cookie)s?$/i
const ALLOWED_SCHEMA = 'orbit-agent/v1'

/**
 * Valida una definición exportada antes de instalarla. No conoce Orbit, Meta,
 * PostgreSQL ni ningún proveedor: solo el contrato portable.
 */
export function validateAgentDefinition(input) {
  const definition = input?.definicion || input
  const errors = []
  const warnings = []

  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { ok: false, errors: ['La definición debe ser un objeto JSON.'], warnings, definition: null }
  }
  if (definition.schema !== ALLOWED_SCHEMA || definition.formato !== 1) {
    errors.push(`Formato incompatible. Se esperaba ${ALLOWED_SCHEMA}.`)
  }
  const agent = definition.agente
  if (!agent || typeof agent !== 'object') errors.push('Falta la sección agente.')
  if (!String(agent?.clave || '').match(/^[A-Z][A-Z0-9_]{2,29}$/)) errors.push('La clave del agente no es válida.')
  if (!String(agent?.nombre || '').trim()) errors.push('Falta el nombre del agente.')
  if (!String(agent?.proveedor || '').trim() || !String(agent?.modelo || '').trim()) errors.push('Falta proveedor o modelo recomendado.')

  walk(definition, [], (key, value, path) => {
    if (SECRET_KEYS.test(key) && value != null && value !== '') {
      errors.push(`El paquete contiene un posible secreto en ${path.join('.')}.`)
    }
  })

  for (const excluded of definition.no_incluye || []) {
    warnings.push(String(excluded))
  }
  return { ok: errors.length === 0, errors, warnings, definition }
}

function walk(value, path, visit) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key]
    visit(key, child, next)
    walk(child, next, visit)
  }
}
