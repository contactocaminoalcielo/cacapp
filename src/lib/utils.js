import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) { return twMerge(clsx(inputs)) }
export const fmt = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0)
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const petEmoji = e => ({ Perro: '🐕', Gato: '🐈', Conejo: '🐇', Ave: '🐦', Hámster: '🐹' })[e] || '🐾'
export const initials = (n, a) => ((n || '?')[0] + (a || '?')[0]).toUpperCase()
export const needsAcomp = p => p && ['CREMACION_INDIVIDUAL', 'COMPOSTAJE_INDIVIDUAL'].includes(p.tipo_proceso)

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
    return 'Uno de los valores no está permitido por las reglas del sistema.'
  }
  if (msg.includes('JWT') || msg.includes('auth') || code === 'PGRST301') {
    return 'Tu sesión ha expirado. Recarga la página para continuar.'
  }
  return `Error inesperado: ${msg || 'intenta de nuevo'}`
}

export function addDiasHabiles(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00') // mediodía para evitar ambigüedad de zona horaria
  let count = 0
  while (count < dias) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
