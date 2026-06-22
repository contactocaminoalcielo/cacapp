import { db } from '@/lib/supabase'

/**
 * Calcula el precio de un plan según peso y especie.
 * @param {Array}  planes       - [{id, codigo}] cargados de la tabla `planes`
 * @param {string} planId
 * @param {number|string} pesoKgRaw
 * @param {number|string} especieIdRaw
 * @returns {Promise<number|null>}
 */
export async function calcularPrecioPara(planes, planId, pesoKgRaw, especieIdRaw) {
  const pesoKg = parseFloat(pesoKgRaw) || 0
  if (!planId || pesoKg <= 0) return null

  const pesoG      = Math.round(pesoKg * 1000)
  const especieId  = parseInt(especieIdRaw) || 0
  const usaFelino  = especieId === 2 || especieId === 3  // Gato o Conejo

  let q = db.from('planes_precios').select('precio').eq('plan_id', planId)
  if (pesoG < 1000) {
    q = q.eq('rango_nombre', 'PETIT')
  } else if (usaFelino) {
    q = q.eq('rango_nombre', 'FELINO')
  } else {
    q = q.lte('peso_min_gr', pesoG).gte('peso_max_gr', pesoG).neq('rango_nombre', 'FELINO')
  }

  const { data } = await q.maybeSingle()
  if (data?.precio != null) return data.precio

  // Fallbacks por código de plan cuando no hay fila en planes_precios
  const planPorId  = id => planes.find(p => String(p.id) === String(id))
  const planByCode = {}
  planes.forEach(p => { planByCode[p.codigo] = p })
  const planActual = planPorId(planId)

  if (planActual?.codigo === 'ANGEL') {
    if (pesoG < 1000)  return 69000
    if (usaFelino)     return 79000
    if (pesoG < 11000) return 89000
    if (pesoG < 21000) return 119000
    if (pesoG < 36000) return 139000
    return 189000
  }

  if (planActual?.codigo === 'BASICO_SIN_REC' && planByCode.BASICO) {
    const base = await calcularPrecioPara(planes, planByCode.BASICO.id, pesoKg, especieId)
    return base ? Math.round(base * 0.8) : null
  }

  const baseSinRec = {
    EXCLUSIVO_PRESENCIAL_SIN_REC:   'EXCLUSIVO_PRESENCIAL',
    EXCLUSIVO_VIDEOLLAMADA_SIN_REC: 'EXCLUSIVO_VIDEOLLAMADA',
  }[planActual?.codigo]
  if (baseSinRec && planByCode[baseSinRec]) {
    const base = await calcularPrecioPara(planes, planByCode[baseSinRec].id, pesoKg, especieId)
    return base ? Math.round(base * 0.8) : null
  }

  if (planActual?.codigo === 'DESAMPARADO') {
    if (pesoG <= 10000) return 46000
    const kgExtra = Math.max(0, pesoKg - 10)
    return Math.round(44000 + kgExtra * 4000)
  }

  return null
}
