// Cubículos de compostaje individual de la planta de Tenjo (migración 054).
//
// Catálogo cerrado de 218 cubículos: zona (color físico) → talla (P/M/G) → número.
// La OCUPACIÓN no es una columna de estado: se deriva de "existe un item que
// apunta a este cubículo y aún no fue liberado". Nunca introducir un
// `cubiculos.estado`: se desincronizaría de la realidad física (mismo patrón de
// bug de los gates por `servicios.estado`).
import { db } from '@/lib/supabase'

// ─── Zonas ───────────────────────────────────────────────────────────────────
// El orden y la columna reproducen el plano real de la planta (boceto 2026-07-16):
// columna izquierda Morado → Gris → Naranja → Verde; derecha Amarillo → Azul → Rojo.
export const ZONAS = {
  MORADO:   { label: 'Morado',   color: '#7C3AED', bg: '#F5F3FF', borde: '#DDD6FE', columna: 'izq' },
  GRIS:     { label: 'Gris',     color: '#4B5563', bg: '#F9FAFB', borde: '#E5E7EB', columna: 'izq' },
  NARANJA:  { label: 'Naranja',  color: '#EA580C', bg: '#FFF7ED', borde: '#FED7AA', columna: 'izq' },
  VERDE:    { label: 'Verde',    color: '#16A34A', bg: '#F0FDF4', borde: '#BBF7D0', columna: 'izq' },
  AMARILLO: { label: 'Amarillo', color: '#CA8A04', bg: '#FEFCE8', borde: '#FEF08A', columna: 'der' },
  AZUL:     { label: 'Azul',     color: '#2563EB', bg: '#EFF6FF', borde: '#BFDBFE', columna: 'der' },
  ROJO:     { label: 'Rojo',     color: '#DC2626', bg: '#FEF2F2', borde: '#FECACA', columna: 'der' },
}
export const ZONAS_IZQ = ['MORADO', 'GRIS', 'NARANJA', 'VERDE']
export const ZONAS_DER = ['AMARILLO', 'AZUL', 'ROJO']
export const ZONA_KEYS = [...ZONAS_IZQ, ...ZONAS_DER]

export const TALLAS = {
  P: { label: 'Pequeño', corto: 'P' },
  M: { label: 'Mediano', corto: 'M' },
  G: { label: 'Grande',  corto: 'G' },
}
export const TALLA_KEYS = ['P', 'M', 'G']

export const zonaCfg  = z => ZONAS[z] || { label: z, color: '#6B7280', bg: '#F9FAFB', borde: '#E5E7EB' }
export const tallaLbl = t => TALLAS[t]?.label || t

// Etiqueta legible: "Azul P14" (el código canónico en DB es AZUL-P-14).
export function etiquetaCubiculo(cub) {
  if (!cub) return '—'
  return `${zonaCfg(cub.zona).label} ${cub.talla}${cub.numero}`
}

// ─── Sugerencia de talla por peso ────────────────────────────────────────────
// Solo SUGIERE (decisión de David 2026-07-16): resalta la talla probable pero
// nunca bloquea. Los cortes siguen los rangos de precio ya existentes
// (planes_precios: 1-10KG / 11-20KG / 21KG+).
export function sugerirTalla(pesoKg) {
  const peso = parseFloat(pesoKg)
  if (!peso || peso <= 0) return null
  if (peso < 11) return 'P'
  if (peso < 21) return 'M'
  return 'G'
}

// ─── Carga del catálogo + ocupación ──────────────────────────────────────────
/**
 * Trae los 218 cubículos y quién ocupa cada uno.
 * OJO: la ocupación NO se filtra por FECHA_CORTE — un cubículo ocupado por un
 * servicio viejo (oculto en la UI) sigue estando físicamente ocupado.
 * @returns {Promise<{cubiculos: Array, ocupacion: Object}>} ocupacion: { cubiculo_id: item }
 */
export async function cargarCubiculos() {
  const [{ data: cubs, error: errCubs }, { data: items, error: errItems }] = await Promise.all([
    db.from('cubiculos')
      .select('id, zona, talla, numero, codigo, activo, notas')
      .order('zona').order('talla').order('numero'),
    db.from('lotes_tenjo_items')
      .select('id, cubiculo_id, cubiculo_codigo, fecha_compostaje_inicio, meses_compostaje, '
        + 'fecha_fin_proceso, servicio_id, '
        + 'servicios(mascotas(nombre, peso_kg, especies(nombre)), planes(nombre, tipo_proceso))')
      .not('cubiculo_id', 'is', null)
      .is('cubiculo_liberado_en', null),
  ])
  if (errCubs)  throw errCubs
  if (errItems) throw errItems

  const ocupacion = {}
  for (const it of (items || [])) ocupacion[it.cubiculo_id] = it
  return { cubiculos: cubs || [], ocupacion }
}

/**
 * Items con un `cubiculo_codigo` viejo que no se pudo enlazar al catálogo
 * (ej. "N-2"). La migración 054 los dejó con cubiculo_id NULL a propósito para
 * que un humano decida. La pestaña Cubículos los muestra para corregirlos.
 */
export async function cargarCodigosHuerfanos() {
  const { data, error } = await db.from('lotes_tenjo_items')
    .select('id, cubiculo_codigo, servicio_id, servicios(mascotas(nombre, peso_kg))')
    .is('cubiculo_id', null)
    .not('cubiculo_codigo', 'is', null)
  if (error) throw error
  return data || []
}

// ─── Acciones ────────────────────────────────────────────────────────────────
/** Libera el cubículo que ocupa un item (liberación manual por el operario). */
export async function liberarCubiculo(itemId, personalId) {
  const { error } = await db.from('lotes_tenjo_items').update({
    cubiculo_liberado_en:  new Date().toISOString(),
    cubiculo_liberado_por: personalId || null,
  }).eq('id', itemId)
  if (error) throw error
}

/** Reasigna un item a otro cubículo (o lo enlaza por primera vez). */
export async function asignarCubiculo(itemId, cubiculoId) {
  const { error } = await db.from('lotes_tenjo_items').update({
    cubiculo_id: cubiculoId,
    cubiculo_liberado_en:  null,
    cubiculo_liberado_por: null,
  }).eq('id', itemId)
  if (error) throw error
}

/**
 * Traduce el error del índice único a algo que un operario entienda.
 * `uq_cubiculo_ocupado` impide dos mascotas en el mismo cubículo a nivel de DB.
 */
export function mensajeErrorCubiculo(e) {
  const msg = e?.message || ''
  if (msg.includes('uq_cubiculo_ocupado')) {
    return 'Ese cubículo ya está ocupado por otra mascota. Actualiza el mapa y elige uno libre.'
  }
  return msg || 'No se pudo guardar el cubículo.'
}
