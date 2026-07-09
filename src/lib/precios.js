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

/**
 * Recalcula y APLICA el precio (y la comisión del aliado) de los servicios
 * activos de una mascota cuando su peso cambió de rango. Centraliza la lógica
 * que antes vivía duplicada en Gestión y Kanban, para que el precio siga al
 * peso en TODOS los puntos donde éste se edita (Gestión, báscula del técnico).
 *
 * Aplica directamente (sin confirmación) y devuelve la lista de cambios
 * realizados, para que el llamador decida si informa al usuario.
 *
 * @returns {Promise<Array<{servicioId, planNombre, valorAntes, valorDespues, comisionAntes, comisionDespues}>>}
 */
export async function aplicarRecalculoPorPeso(mascotaId, pesoNuevo, especieIdRaw) {
  const especieId = parseInt(especieIdRaw) || 0
  const [{ data: svcsActivos }, { data: planesData }] = await Promise.all([
    db.from('servicios')
      .select('id, valor_total, plan_id, aliado_origen_id, comision_aliado, comision_descontada')
      .eq('mascota_id', mascotaId)
      .neq('estado', 'ENTREGADO')
      .neq('estado', 'CANCELADO'),
    db.from('planes').select('id, codigo, nombre'),
  ])
  if (!svcsActivos?.length || !planesData?.length) return []

  const cambios = []
  for (const svc of svcsActivos) {
    if (!svc.plan_id) continue

    const nuevoPrecioBase = await calcularPrecioPara(planesData, svc.plan_id, pesoNuevo, especieId)
    if (!nuevoPrecioBase) continue

    // Recalcular comisión desde config_comisiones si el servicio tiene aliado activo
    let nuevaComision = null
    if (svc.aliado_origen_id && (svc.comision_aliado ?? 0) > 0) {
      const hoy = new Date()
      const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
      // El fetch del aliado va PRIMERO y separado: la consulta de config_comisiones
      // depende de aliado.vip. Meter las tres en un solo Promise.all referenciando
      // `aliado` dentro del mismo destructuring lanza ReferenceError por TDZ y el
      // recálculo muere en silencio (bug real: servicios con comisión de aliado
      // nunca se recalculaban al cambiar el peso).
      const { data: aliado } = await db.from('aliados').select('vip').eq('id_aliado', svc.aliado_origen_id).maybeSingle()
      const [{ data: svcsDelMes }, { data: filas }] = await Promise.all([
        db.from('servicios').select('id, planes(codigo)').eq('aliado_origen_id', svc.aliado_origen_id).gte('fecha_ingreso', inicioMes),
        db.from('config_comisiones').select('porcentaje, plan_id, rango_min, rango_max').eq('es_vip', aliado?.vip ?? false),
      ])
      const serviciosMes = (svcsDelMes || []).filter(s => s.planes?.codigo !== 'DESAMPARADO').length
      const match = (filas || [])
        .filter(c =>
          (c.plan_id === svc.plan_id || c.plan_id === null) &&
          c.rango_min <= serviciosMes &&
          (c.rango_max === null || c.rango_max >= serviciosMes)
        )
        .sort((a, b) => {
          if (a.plan_id && !b.plan_id) return -1
          if (!a.plan_id && b.plan_id) return 1
          return b.rango_min - a.rango_min
        })[0]
      const pct = parseFloat(match?.porcentaje) || 0
      if (pct > 0) nuevaComision = Math.round(nuevoPrecioBase * pct / 100)
    }

    // El nuevo valor total es el precio del nuevo rango (BRUTO).
    // Para comision_descontada=true (recogida en clínica aliada) valor_total se
    // guarda NETO (precio − comisión). DEBE restarse SIEMPRE una comisión: la
    // recalculada si se pudo recalcular, y si no, la que ya tenía el servicio.
    // Si aquí se resta 0 pero el servicio conserva comision_aliado>0, el cuadre
    // (bruto = valor_total + comision_aliado, migración 017) la vuelve a sumar y
    // sale un valor inflado que no coincide con ninguna tarifa.
    const comisionVigente = nuevaComision != null ? nuevaComision : (svc.comision_aliado ?? 0)
    const nuevoValorTotal = Math.round(
      nuevoPrecioBase - (svc.comision_descontada ? comisionVigente : 0)
    )

    const cambioPrecio   = Math.abs(nuevoValorTotal - (svc.valor_total ?? 0)) > 0.5
    const cambioComision = nuevaComision != null && Math.abs(nuevaComision - (svc.comision_aliado ?? 0)) > 0.5
    if (!cambioPrecio && !cambioComision) continue

    const updates = { valor_total: nuevoValorTotal }
    if (cambioComision) updates.comision_aliado = nuevaComision
    const { error } = await db.from('servicios').update(updates).eq('id', svc.id)
    if (error) continue

    const planNombre = planesData.find(p => String(p.id) === String(svc.plan_id))?.nombre || 'Plan'
    cambios.push({
      servicioId:      svc.id,
      planNombre,
      valorAntes:      svc.valor_total,
      valorDespues:    nuevoValorTotal,
      comisionAntes:   svc.comision_aliado,
      comisionDespues: cambioComision ? nuevaComision : null,
    })
  }
  return cambios
}
