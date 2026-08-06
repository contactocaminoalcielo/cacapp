// Cliente de la configuración del agente de WhatsApp.
//
// Las tablas `agente_wa*` NO están expuestas por PostgREST a propósito: todo
// pasa por orbit-backend con JWT + rol (COORDINADOR/ADMIN). Mismo criterio que
// la bandeja — ver lib/whatsappInbox.js.
import { orbitApi } from '@/lib/orbitApi'

export const TIPOS_KB = {
  TEXTO:     { label: 'Texto',      ayuda: 'Instrucciones, preguntas frecuentes, políticas.' },
  TABLA:     { label: 'Tabla',      ayuda: 'Tarifas, coberturas, tiempos. Se pega o se sube un CSV.' },
  DOCUMENTO: { label: 'Documento',  ayuda: 'El texto de un documento. Pégalo o sube un .txt / .md.' },
  IMAGEN:    { label: 'Imagen',     ayuda: 'Fotos, diagramas, capturas. Máximo 5 MB.' },
}

/**
 * Modelos disponibles, con su tarifa en USD por millón de tokens.
 * El modelo es la palanca que más mueve la factura: entre el más caro y el más
 * barato hay 5x. Los precios se muestran en la pantalla para que la decisión se
 * tome con el número delante y no a ciegas.
 * ⚠️ Tarifas de referencia — confirmar contra la facturación real de Anthropic.
 */
export const MODELOS = [
  {
    valor: 'claude-haiku-4-5', label: 'Haiku 4.5', entrada: 1, salida: 5,
    ayuda: 'El más barato y rápido. Suele bastar para responder desde una base de conocimiento.',
  },
  {
    valor: 'claude-sonnet-5', label: 'Sonnet 5', entrada: 3, salida: 15,
    ayuda: 'Equilibrado. Mejor criterio en conversaciones que se salen del guion.',
  },
  {
    valor: 'claude-opus-5', label: 'Opus 5', entrada: 5, salida: 25,
    ayuda: 'El más capaz y el más caro. Solo si los otros se quedan cortos.',
  },
]

/**
 * Costo aproximado de una conversación, en USD.
 * Supuestos declarados a propósito: son de servilleta hasta que la bitácora dé
 * los tokens reales. `contexto` viaja en cada turno (con descuento de caché).
 */
export function costoConversacion({ modelo, contexto = 0, turnos = 6 }) {
  const m = MODELOS.find(x => x.valor === modelo) || MODELOS[2]
  const SALIDA_POR_TURNO  = 250   // tokens de una respuesta típica
  const HISTORIAL_POR_TURNO = 800 // lo que crece la conversación

  // El primer turno paga el contexto completo con premio de escritura de caché;
  // los siguientes lo leen a una décima parte.
  const primerTurno = contexto * 1.25 * (m.entrada / 1e6)
  const resto       = (turnos - 1) * contexto * 0.1 * (m.entrada / 1e6)
  const nuevo       = turnos * HISTORIAL_POR_TURNO * (m.entrada / 1e6)
  const salida      = turnos * SALIDA_POR_TURNO * (m.salida / 1e6)
  return primerTurno + resto + nuevo + salida
}

export const EFFORT_OPCIONES = [
  { valor: 'low',    label: 'Bajo',     ayuda: 'Respuestas rápidas y baratas. Para preguntas simples.' },
  { valor: 'medium', label: 'Medio',    ayuda: 'Equilibrio entre calidad y coste. Recomendado.' },
  { valor: 'high',   label: 'Alto',     ayuda: 'Razona más antes de responder. Más lento y caro.' },
  { valor: 'xhigh',  label: 'Muy alto', ayuda: 'Para casos difíciles. Notablemente más caro.' },
  { valor: 'max',    label: 'Máximo',   ayuda: 'Sin límite práctico. Solo si la calidad lo justifica.' },
]

export const cargarAgente = (clave = 'VETERINARIAS') => orbitApi(`/agente/${clave}`)

export const guardarAgente = (clave, datos) =>
  orbitApi(`/agente/${clave}`, { method: 'POST', body: datos })

export const agregarPieza = (agenteId, datos) =>
  orbitApi(`/agente/conocimiento/${agenteId}`, { method: 'POST', body: datos })

export const actualizarPieza = (id, datos) =>
  orbitApi(`/agente/conocimiento/pieza/${id}`, { method: 'PATCH', body: datos })

export const borrarPieza = (id) =>
  orbitApi(`/agente/conocimiento/pieza/${id}`, { method: 'DELETE' })

export const archivoPieza = (id) =>
  orbitApi(`/agente/conocimiento/pieza/${id}/archivo`)

export const cargarEjecuciones = (agenteId, limite = 50) =>
  orbitApi(`/agente/${agenteId}/ejecuciones?limite=${limite}`)

/** Lee un File del navegador como base64 sin el prefijo `data:`. */
export function leerBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload  = () => resolve(String(fr.result).replace(/^data:[^;]+;base64,/, ''))
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(file)
  })
}

/** Lee un File de texto plano (txt, md, csv). */
export function leerTexto(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload  = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsText(file)
  })
}

/**
 * CSV → tabla Markdown. El modelo lee mucho mejor una tabla con cabeceras que
 * una ristra de comas, y así lo que se guarda es legible al revisarlo.
 * Soporta comillas dobles y comas dentro de comillas, que es donde se rompen
 * los partidores ingenuos por `split(',')`.
 */
export function csvAMarkdown(csv) {
  const filas = []
  let campo = '', fila = [], enComillas = false

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (enComillas) {
      if (c === '"' && csv[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') enComillas = false
      else campo += c
    } else if (c === '"') enComillas = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some(v => v.trim())) filas.push(fila)
      fila = []
    } else campo += c
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some(v => v.trim())) filas.push(fila) }
  if (!filas.length) return ''

  const ancho  = Math.max(...filas.map(f => f.length))
  const norm   = f => Array.from({ length: ancho }, (_, i) => (f[i] ?? '').trim().replace(/\|/g, '\\|'))
  const [cab, ...resto] = filas

  return [
    `| ${norm(cab).join(' | ')} |`,
    `| ${norm(cab).map(() => '---').join(' | ')} |`,
    ...resto.map(f => `| ${norm(f).join(' | ')} |`),
  ].join('\n')
}

/** Peso aproximado del contexto en tokens. Sirve para dar una señal de coste. */
export function tokensAprox({ caracteres_texto = 0, imagenes = 0 }) {
  // ~4 caracteres por token en español; una imagen ronda los 1.500 tokens.
  return Math.round(caracteres_texto / 4) + imagenes * 1500
}
