// Cubículos de compostaje individual de la planta de Tenjo (migración 055).
//
// Catálogo cerrado de 218 cubículos: zona (color físico) → talla (P/M/G) → número.
// La OCUPACIÓN no es una columna de estado: se deriva de "qué items apuntan a
// este cubículo y aún no fueron liberados". Nunca introducir un
// `cubiculos.estado`: se desincronizaría de la realidad física (mismo patrón de
// bug de los gates por `servicios.estado`).
//
// Desde la migración 155 un cubículo admite VARIAS mascotas: `capacidad` dice
// cuántas caben (1 por defecto) y un trigger en DB rechaza la que se pase. Por
// eso `ocupacion[cubiculo_id]` es un ARRAY, no un item suelto.
import { db, dbTodo } from '@/lib/supabase'
import { hoyLocalISO, parsearErrorDB } from '@/lib/utils'

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
// Columnas que necesita cualquier vista de "quién está en el cubículo".
const SELECT_ITEM_OCUPANTE =
  'id, cubiculo_id, cubiculo_codigo, fecha_compostaje_inicio, meses_compostaje, '
  + 'fecha_fin_proceso, cubiculo_salida, servicio_id, '
  + 'servicios(id, estado, fecha_limite_entrega, recordatorios_anticipados, '
  + 'mascotas(nombre, peso_kg, especies(nombre), clientes(nombre, apellido, whatsapp)), '
  + 'planes(nombre, tipo_proceso, dias_entrega_prometidos))'

/**
 * Trae los 218 cubículos y quiénes ocupan cada uno.
 * OJO: la ocupación NO se filtra por FECHA_CORTE — un cubículo ocupado por un
 * servicio viejo (oculto en la UI) sigue estando físicamente ocupado.
 * @returns {Promise<{cubiculos: Array, ocupacion: Object}>} ocupacion: { cubiculo_id: [items] }
 */
export async function cargarCubiculos() {
  const [{ data: cubs, error: errCubs }, { data: items, error: errItems }] = await Promise.all([
    db.from('cubiculos')
      .select('id, zona, talla, numero, codigo, activo, notas, capacidad')
      .order('zona').order('talla').order('numero'),
    db.from('lotes_tenjo_items')
      .select(SELECT_ITEM_OCUPANTE)
      .not('cubiculo_id', 'is', null)
      .is('cubiculo_liberado_en', null)
      .order('fecha_compostaje_inicio', { ascending: true, nullsFirst: true })
      .order('id'),
  ])
  if (errCubs)  throw errCubs
  if (errItems) throw errItems

  const ocupacion = {}
  for (const it of (items || [])) (ocupacion[it.cubiculo_id] ||= []).push(it)
  return { cubiculos: cubs || [], ocupacion }
}

/** Cuántos cupos quedan libres en un cubículo (0 si está fuera de servicio). */
export function cuposLibres(cub, ocupantes) {
  if (!cub?.activo) return 0
  return Math.max(0, (cub.capacidad ?? 1) - (ocupantes?.length || 0))
}

/**
 * Items con un `cubiculo_codigo` viejo que no se pudo enlazar al catálogo
 * (ej. "N-2"). La migración 055 los dejó con cubiculo_id NULL a propósito para
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
/**
 * Libera el cubículo que ocupa un item (liberación manual por el operario).
 * Dos fechas, a propósito distintas:
 *   · `cubiculo_liberado_en` — sello de cuándo se pulsó el botón (auditoría).
 *   · `cubiculo_salida`      — el día en que la mascota salió de verdad. Es el
 *     hecho operativo, se puede corregir después y de él cuelgan los días
 *     hábiles de entrega de los recordatorios (migración 155).
 */
export async function liberarCubiculo(itemId, personalId, fechaSalida = null) {
  const { error } = await db.from('lotes_tenjo_items').update({
    cubiculo_liberado_en:  new Date().toISOString(),
    cubiculo_liberado_por: personalId || null,
    cubiculo_salida:       fechaSalida || hoyLocalISO(),
  }).eq('id', itemId)
  if (error) throw error
}

/**
 * Corrige el día en que la mascota salió del cubículo. El trigger de DB
 * recalcula solo `servicios.fecha_limite_entrega` de los compostajes que
 * esperan al final del proceso.
 */
export async function actualizarFechaSalida(itemId, fechaSalida) {
  if (!fechaSalida) throw new Error('Indica la fecha de salida.')
  const { error } = await db.from('lotes_tenjo_items')
    .update({ cubiculo_salida: fechaSalida }).eq('id', itemId)
  if (error) throw error
}

/**
 * Reasigna un item a otro cubículo (o lo enlaza por primera vez).
 * `cubiculo_salida` se borra a propósito: si vuelve a entrar, la salida vieja
 * dejaría corriendo un plazo de entrega que ya no corresponde.
 */
export async function asignarCubiculo(itemId, cubiculoId) {
  const { error } = await db.from('lotes_tenjo_items').update({
    cubiculo_id: cubiculoId,
    cubiculo_liberado_en:  null,
    cubiculo_liberado_por: null,
    cubiculo_salida:       null,
  }).eq('id', itemId)
  if (error) throw error
}

/**
 * Traduce el error de la compuerta de DB a algo que un operario entienda.
 * `cubiculo_sin_cupo` (trigger, migr. 155) frena al que se pasa del cupo;
 * `uq_cubiculo_ocupado` es el candado viejo, por si la 155 no está aplicada.
 */
export function mensajeErrorCubiculo(e) {
  const msg = e?.message || ''
  if (msg.includes('cubiculo_sin_cupo')) {
    return 'Ese cubículo ya está en su tope de mascotas. Actualiza el mapa y elige otro, o súbele el cupo desde la pestaña Cubículos.'
  }
  if (msg.includes('uq_cubiculo_ocupado')) {
    return 'Ese cubículo ya está ocupado por otra mascota. Actualiza el mapa y elige uno libre.'
  }
  if (msg.includes('cubiculo_fuera_de_servicio')) {
    return 'Ese cubículo está marcado como fuera de servicio. Reactívalo en la pestaña Cubículos o elige otro.'
  }
  if (msg.includes('cubiculo_inexistente')) {
    return 'Ese cubículo ya no está en el catálogo. Actualiza el mapa y elige otro.'
  }
  // Camino contrario al de `cubiculo_sin_cupo`: bajarle el cupo a uno que ya
  // está lleno (trigger de la migración 156).
  if (msg.includes('cubiculo_capacidad_menor_que_ocupacion')) {
    const n = msg.match(/tiene (\d+) mascota/)?.[1]
    return n
      ? `No se puede bajar el cupo: ese cubículo tiene ${n} mascota${n === '1' ? '' : 's'} adentro. Sácalas primero.`
      : 'No se puede bajar el cupo por debajo de las mascotas que ya están adentro. Sácalas primero.'
  }
  // Cualquier otro error pasa por el traductor general en vez de salir crudo.
  return parsearErrorDB(e) || 'No se pudo guardar el cubículo.'
}

// ─── Salidas del compostaje ──────────────────────────────────────────────────
// Fin del compostaje = ingreso al cubículo + N meses (2, 2.5 o 3, por cubículo).
// Admite medios meses: los enteros con setMonth y la fracción como días (½ ≈ 15).
// Misma regla que `calcularListoProceso` de lib/tenjo.js y que la migración 149:
// con "2 meses" fijos se sacaría antes de tiempo a los de 2.5 y 3.
export function finCompostaje(fechaStr, meses = 2) {
  if (!fechaStr) return null
  const n = Number(meses) || 2
  const d = new Date(fechaStr + 'T12:00:00')
  const enteros = Math.trunc(n)
  d.setMonth(d.getMonth() + enteros)
  const frac = n - enteros
  if (frac) d.setDate(d.getDate() + Math.round(frac * 30))
  return hoyLocalISO(d)
}

/**
 * Las dos listas de la pestaña Salidas:
 *   · `porSacar`  — siguen en el cubículo y el compostaje ya se cumplió.
 *   · `enCurso`   — siguen dentro pero aún les falta (contexto, no urgencia).
 *   · `sinFecha`  — siguen dentro y NO se sabe cuándo cumplen.
 *   · `salieron`  — ya salieron, desde `desde` (ISO) hacia acá.
 * Solo COMPOSTAJE_INDIVIDUAL: de un cubículo no sale otra cosa.
 *
 * 🔑 `sinFecha` es una lista aparte y no un rincón de `enCurso`. Sin fecha de
 * ingreso (`fecha_compostaje_inicio` es nullable, y `asignarCubiculo` no la
 * escribe al enlazar un código huérfano) `finCompostaje` devuelve null, y esa
 * mascota no cumpliría "ya pasó su fecha" NUNCA: se quedaría en el cubículo sin
 * aparecer jamás en la hoja de trabajo de la planta. Metida en `enCurso` el
 * único síntoma sería un contador que sube. Aquí se ve y se puede corregir.
 */
export async function cargarSalidasCompostaje({ desde } = {}) {
  const esCompostaje = it => it?.servicios?.planes?.tipo_proceso === 'COMPOSTAJE_INDIVIDUAL'
  const conCalculo = it => {
    const cumple = finCompostaje(it.fecha_compostaje_inicio, it.meses_compostaje)
    return { ...it, fechaCumple: cumple }
  }

  const [dentro, fuera] = await Promise.all([
    dbTodo(() => db.from('lotes_tenjo_items')
      .select(SELECT_ITEM_OCUPANTE + ', cubiculos(id, codigo, zona, talla, numero)')
      .not('cubiculo_id', 'is', null)
      .is('cubiculo_liberado_en', null)
      .order('fecha_compostaje_inicio', { ascending: true, nullsFirst: true })
      .order('id')),
    dbTodo(() => db.from('lotes_tenjo_items')
      .select(SELECT_ITEM_OCUPANTE + ', cubiculos(id, codigo, zona, talla, numero)')
      .not('cubiculo_salida', 'is', null)
      .gte('cubiculo_salida', desde || '2026-01-01')
      .order('cubiculo_salida', { ascending: false })
      .order('id')),
  ])

  const hoy = hoyLocalISO()
  const adentro = (dentro || []).filter(esCompostaje).map(conCalculo)
  return {
    porSacar: adentro.filter(it => it.fechaCumple && it.fechaCumple <= hoy),
    enCurso:  adentro.filter(it => it.fechaCumple && it.fechaCumple > hoy),
    sinFecha: adentro.filter(it => !it.fechaCumple),
    salieron: (fuera || []).filter(esCompostaje).map(conCalculo),
  }
}
