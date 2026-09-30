import { db, dbTodo } from '@/lib/supabase'

/**
 * Regla VIP de las veterinarias (David, 30-sep-2026).
 *
 * Es VIP la que refirió al menos `VIP_MIN_POR_MES` servicios en CADA uno de los
 * dos meses calendario anteriores. Premia la constancia: un pico de un solo mes
 * no alcanza. Se miden meses CERRADOS — contar el mes en curso haría que, a
 * principio de mes, todas las VIP "dejaran de cumplir".
 *
 * Orbit solo SUGIERE. El VIP sube la comisión (tasas fijas 32/27/10 en vez de
 * la escala por volumen), así que ponerlo o quitarlo lo decide coordinación con
 * un clic, nunca un proceso por su cuenta.
 *
 * Se cuenta igual que `rep_veterinarias`: por `fecha_ingreso`, sin CANCELADO ni
 * DESAMPARADO. Y por fila de `aliados`: una vet duplicada en dos fichas se mide
 * partida en dos.
 */
export const VIP_MIN_POR_MES = 3

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// `mes0` puede salirse de 0..11: `new Date` lo lleva al año que toca.
function primerDia(anio, mes0) {
  const d = new Date(anio, mes0, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Los dos meses cerrados anteriores a `hoy`, el más viejo primero: [{ desde, hasta, etiqueta }]. */
export function mesesRevisionVip(hoy = new Date()) {
  const anio = hoy.getFullYear(), mes = hoy.getMonth()
  return [-2, -1].map(k => ({
    desde:    primerDia(anio, mes + k),
    hasta:    primerDia(anio, mes + k + 1),
    etiqueta: MESES[new Date(anio, mes + k, 1).getMonth()],
  }))
}

export const cumpleVip = (par = [0, 0]) => par.every(n => n >= VIP_MIN_POR_MES)

/**
 * Servicios de cada aliado en los dos meses revisados.
 * @returns {Promise<{ meses: Array, conteo: Map<string, [number, number]> }>}
 */
export async function contarServiciosVip(hoy = new Date()) {
  const meses = mesesRevisionVip(hoy)
  const filas = await dbTodo(() => db.from('servicios')
    .select('id, aliado_origen_id, fecha_ingreso, planes(codigo)')
    .not('aliado_origen_id', 'is', null)
    .neq('estado', 'CANCELADO')
    .gte('fecha_ingreso', meses[0].desde)
    .lt('fecha_ingreso', meses[1].hasta)
    .order('id'))

  const conteo = new Map()
  for (const s of filas) {
    if (s.planes?.codigo === 'DESAMPARADO') continue
    // Comparación de strings sobre la columna DATE: un `new Date()` la correría
    // de día según la zona horaria y movería de mes los servicios del día 1.
    const i = String(s.fecha_ingreso).slice(0, 10) < meses[1].desde ? 0 : 1
    const par = conteo.get(s.aliado_origen_id) || [0, 0]
    par[i]++
    conteo.set(s.aliado_origen_id, par)
  }
  return { meses, conteo }
}
