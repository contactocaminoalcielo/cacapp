import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) { return twMerge(clsx(inputs)) }
export const fmt = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0)
export const today = () => new Date().toISOString().split('T')[0]
export const petEmoji = e => ({ Perro: '🐕', Gato: '🐈', Conejo: '🐇', Ave: '🐦', Hámster: '🐹' })[e] || '🐾'
export const initials = (n, a) => ((n || '?')[0] + (a || '?')[0]).toUpperCase()
export const needsAcomp = p => p && ['CREMACION_INDIVIDUAL', 'COMPOSTAJE_INDIVIDUAL'].includes(p.tipo_proceso)

export function addDiasHabiles(fecha, dias) {
  const d = new Date(fecha)
  let count = 0
  while (count < dias) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return d.toISOString().split('T')[0]
}
