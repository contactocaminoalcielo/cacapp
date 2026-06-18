import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) { return twMerge(clsx(inputs)) }
export const fmt = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0)

/**
 * Genera la URL de WhatsApp para cualquier número:
 * - Número con + o 00 → número internacional (se usa tal cual sin agregar 57)
 * - Número sin prefijo → se asume Colombia (+57)
 * Ejemplo: waLink('3001234567') → 'https://wa.me/573001234567'
 *          waLink('+1 555 123 4567') → 'https://wa.me/15551234567'
 */
export function waLink(numero, texto) {
  if (!numero) return ''
  const limpio = String(numero).trim()
  let digits
  if (limpio.startsWith('+')) {
    digits = limpio.slice(1).replace(/\D/g, '')
  } else if (limpio.startsWith('00')) {
    digits = limpio.slice(2).replace(/\D/g, '')
  } else {
    digits = '57' + limpio.replace(/\D/g, '')
  }
  const base = `https://wa.me/${digits}`
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base
}
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const petEmoji = e => ({ Perro: '🐕', Gato: '🐈', Conejo: '🐇', Ave: '🐦', Hámster: '🐹' })[e] || '🐾'
export const initials = (n, a) => ((n || '?')[0] + (a || '?')[0]).toUpperCase()
export const needsAcomp = p => p && ['CREMACION_INDIVIDUAL', 'COMPOSTAJE_INDIVIDUAL'].includes(p.tipo_proceso)

// ── Horario veterinaria ───────────────────────────────────────────────────────
// Mapea getDay() → clave del objeto horario de aliados
const DIA_KEY = ['dom','lun','mar','mié','jue','vie','sáb']

/**
 * Evalúa el horario de una veterinaria y devuelve el estado en tiempo real.
 * @param {object} horario  JSONB de aliados.horario  { lun:{apertura,cierre}, ... }
 * @returns {{ tieneHorario, abiertoHoy, textoEstado, nivel }}
 *   nivel: 'verde' | 'naranja' | 'rojo' | null
 */
export function calcularEstadoVet(horario) {
  if (!horario || typeof horario !== 'object' || Object.keys(horario).length === 0) {
    return { tieneHorario: false, abiertoHoy: false, textoEstado: 'Sin horario registrado', nivel: null }
  }
  const ahora  = new Date()
  const diaKey = DIA_KEY[ahora.getDay()]
  const hoy    = horario[diaKey]

  if (!hoy) {
    return { tieneHorario: true, abiertoHoy: false, textoEstado: 'Cerrada hoy', nivel: 'rojo' }
  }

  const { apertura, cierre } = hoy
  // Convertir a minutos desde medianoche
  const toMin = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m }
  const ahoraMin  = ahora.getHours() * 60 + ahora.getMinutes()
  const apertMin  = toMin(apertura)
  const cierreMin = toMin(cierre)

  // 24/7 (00:00–23:59)
  const es247 = apertura === '00:00' && cierre === '23:59'
  if (es247) {
    return { tieneHorario: true, abiertoHoy: true, textoEstado: 'Abierta 24/7', nivel: 'verde' }
  }

  if (ahoraMin < apertMin) {
    return { tieneHorario: true, abiertoHoy: false, textoEstado: `Todavía cerrada · abre a las ${apertura}`, nivel: 'rojo' }
  }
  if (ahoraMin > cierreMin) {
    return { tieneHorario: true, abiertoHoy: false, textoEstado: `Ya cerró · horario ${apertura}–${cierre}`, nivel: 'rojo' }
  }
  const minParaCerrar = cierreMin - ahoraMin
  if (minParaCerrar <= 60) {
    return { tieneHorario: true, abiertoHoy: true, textoEstado: `⚠ Cierra en ${minParaCerrar} min (${cierre})`, nivel: 'naranja' }
  }
  return { tieneHorario: true, abiertoHoy: true, textoEstado: `Abierta hasta las ${cierre}`, nivel: 'verde' }
}

// Traduce errores de Supabase/Postgres a mensajes entendibles para el usuario
export function parsearErrorDB(error) {
  const msg = error?.message || error?.details || String(error || '')
  const code = error?.code || ''

  if (msg.includes('value too long') || msg.includes('character varying')) {
    const match = msg.match(/character varying\((\d+)\)/)
    const limite = match ? match[1] : null
    return limite
      ? `El texto ingresado supera el límite de ${limite} caracteres permitidos. Acorta el texto e intenta de nuevo.`
      : 'Uno de los campos supera la longitud máxima permitida. Acorta el texto e intenta de nuevo.'
  }
  if (code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('already exists')) {
    return 'Ya existe un registro con esos datos (nombre, cédula o identificación duplicada). Verifica los datos e intenta de nuevo.'
  }
  if (code === '23503' || msg.includes('foreign key') || msg.includes('violates foreign key')) {
    return 'Este registro está siendo usado en otras partes del sistema y no se puede eliminar.'
  }
  if (code === '23502' || msg.includes('not-null') || msg.includes('null value in column')) {
    const col = msg.match(/column "([^"]+)"/)
    return col
      ? `El campo "${col[1]}" es obligatorio y no puede estar vacío.`
      : 'Hay campos obligatorios vacíos. Completa todos los datos requeridos.'
  }
  if (code === '22P02' || msg.includes('invalid input syntax')) {
    return 'Uno de los campos contiene un valor inválido. Revisa los datos ingresados.'
  }
  if (code === '23514' || msg.includes('violates check constraint')) {
    const constraint = (msg + (error?.details || '')).match(/constraint "([^"]+)"/)?.[1] || ''
    const valor      = (msg + (error?.details || '')).match(/value: ([^\n,]+)/i)?.[1]?.trim() || ''
    let detalle = constraint ? `restricción: ${constraint}` : ''
    if (valor) detalle += (detalle ? ', ' : '') + `valor: "${valor}"`
    return `Valor no permitido en el formulario${detalle ? ` (${detalle})` : ''}. Revisa los campos e intenta de nuevo.`
  }
  if (msg.includes('JWT') || msg.includes('auth') || code === 'PGRST301') {
    return 'Tu sesión ha expirado. Recarga la página para continuar.'
  }
  return `Error inesperado: ${msg || 'intenta de nuevo'}`
}

// Parsea fechas DATE (YYYY-MM-DD) como hora local para evitar el desfase UTC midnight
// new Date('2026-06-02') = medianoche UTC → June 1 en Colombia. Esta función lo corrige.
export const parseDate = d => d ? new Date(d.includes('T') ? d : d + 'T12:00:00') : null

// Formatea timestamp completo: "02 jun 2026 · 14:32"
export const fmtDateTime = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ' · ' +
         d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Caché de festivos (Colombia). Se carga 1 vez en background desde la tabla `festivos`;
// addDiasHabiles los salta igual que los fines de semana, para que el frontend respete
// los festivos configurados en Configuración (igual que las funciones SQL del backend).
let _festivos = new Set()
let _festLoaded = false
function _cargarFestivos() {
  if (_festLoaded) return
  _festLoaded = true
  import('./supabase')
    .then(({ db }) => db.from('festivos').select('fecha'))
    .then(({ data }) => { _festivos = new Set((data || []).map(f => f.fecha)) })
    .catch(() => {})
}

const _iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function addDiasHabiles(fecha, dias) {
  _cargarFestivos()
  const d = new Date(fecha + 'T12:00:00') // mediodía para evitar ambigüedad de zona horaria
  let count = 0
  while (count < dias) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !_festivos.has(_iso(d))) count++
  }
  return _iso(d)
}
