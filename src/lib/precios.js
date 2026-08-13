import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { calcularEstadoPago, trazaValor } from '@/lib/servicios'

/**
 * Planes que NUNCA generan comisión de aliado.
 *
 * DESAMPARADO es un caso social: la mascota no tiene quién pague, la clínica
 * no vende nada y por lo tanto no comisiona. Ya se excluía del CONTEO mensual
 * (no sube al aliado de tramo de volumen), pero eso no impedía cobrarle
 * comisión: si el aliado es VIP la tasa fija de CREMACION_GRUPAL (32 %) o una
 * regla genérica de config_comisiones con plan_id NULL entraban igual y el
 * total del servicio salía con un descuento del 32 % que no existe.
 */
export const PLANES_SIN_COMISION = ['DESAMPARADO']

/** ¿Este plan (por código) comisiona al aliado? */
export function planComisiona(codigoPlan) {
  return !PLANES_SIN_COMISION.includes(codigoPlan)
}

/**
 * Qué especies pagan el rango FELINO (tarifa fija de mamífero pequeño desde
 * 1 kg) en vez de la tarifa por peso de perro. Vive en `especies.tarifa_peso`
 * (migración 079) y se edita desde Configuración → Catálogos.
 *
 * Antes era un hardcode `especieId === 2 || especieId === 3`: agregar una
 * especie al catálogo no cambiaba el precio y cobraba tarifa de perro (caso del
 * cobayo, que se registraba como "Hámster" y sobre 1 kg pagaba de más).
 *
 * Se lee una sola vez por sesión: `calcularPrecioPara` se llama en bucle por
 * servicio y el catálogo tiene 9 filas que no cambian en el día a día.
 */
let promesaEspecies = null
function cargarTarifasEspecie() {
  if (!promesaEspecies) {
    promesaEspecies = db.from('especies').select('id, tarifa_peso')
      .then(({ data, error }) => {
        // Sin la columna todavía (o sin red): se reintenta en la próxima llamada
        // y mientras tanto el llamador cae al criterio viejo.
        if (error || !data) { promesaEspecies = null; return null }
        return new Map(data.map(e => [String(e.id), e.tarifa_peso === 'FELINO' ? 'FELINO' : 'ESTANDAR']))
      })
      .catch(() => { promesaEspecies = null; return null })
  }
  return promesaEspecies
}

/** Olvida el catálogo cacheado (tras editarlo en Configuración). */
export function invalidarTarifasEspecie() { promesaEspecies = null }

/**
 * Cuántos servicios llevaba el aliado en el mes ANTES de éste. Es el número que
 * ubica el tramo de volumen en `config_comisiones`.
 *
 * ⚠️ La posición de un servicio dentro del mes NO cambia con el tiempo, así que
 * esta cuenta tiene que dar lo mismo hoy que dentro de un mes. Antes no lo hacía
 * y por eso la comisión se movía sola DESPUÉS de emitido el recibo:
 *
 *  · **el servicio se contaba a sí mismo.** Al registrar, su fila todavía no
 *    existe (no se cuenta); al recalcular, ya existe (sí se cuenta) → todo corre
 *    un puesto y al 2º servicio del mes le entra la escala del 3º. Caso ORION
 *    (PetPals, 6-ago-2026): 25 % → 30 % dos días después del recibo.
 *  · **se medía el mes en que corría el recálculo, no el del servicio.** Uno de
 *    fin de mes recalculado unos días después se tarifaba contra un mes que
 *    apenas arrancaba. Caso EIMY (Animal City, ingreso 31-jul, recalculada el
 *    2-ago): julio tenía 13 servicios, agosto 0 → le bajó del 32 % al 27 %.
 *
 * Regla confirmada por David (2026-08-13): **la escala cuenta los servicios YA
 * hechos en el mes; la nueva entra en el TERCER servicio.** Con los tramos
 * no-VIP de Básico (`0–1`=25 %, `2+`=30 %): 1º→0→25 %, 2º→1→25 %, 3º→2→30 %.
 *
 * @param {string} aliadoId
 * @param {{id?:string, fecha_ingreso?:string, created_at?:string}|null} servicio
 *        Servicio YA existente que se está recalculando. `null` (o sin fecha)
 *        = servicio nuevo que aún no está en la DB → cuenta el mes corriente
 *        completo, que es exactamente lo que ve `Registro.jsx` al registrar.
 * @returns {Promise<number>}
 */
export async function volumenMesAliado(aliadoId, servicio = null) {
  if (!aliadoId) return 0

  // La ventana se arma con aritmética de strings sobre la columna DATE. Meter
  // `fecha_ingreso` en un `new Date()` la corre un día según la zona horaria
  // (ver la nota de fechas del proyecto) y eso movería de mes a los servicios
  // del día 1 y del último día.
  const ymd = String(servicio?.fecha_ingreso || '').slice(0, 10)
  const m   = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd)
  let inicioMes, inicioMesSiguiente = null
  if (m) {
    const anio = Number(m[1]), mes = Number(m[2])
    inicioMes          = `${m[1]}-${m[2]}-01`
    inicioMesSiguiente = mes === 12
      ? `${anio + 1}-01-01`
      : `${anio}-${String(mes + 1).padStart(2, '0')}-01`
  } else {
    const hoy = new Date()
    inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
  }

  let q = db.from('servicios')
    .select('id, planes(codigo)')
    .eq('aliado_origen_id', aliadoId)
    .gte('fecha_ingreso', inicioMes)
  // Sin tope superior se colarían los meses siguientes al recalcular en el futuro.
  if (inicioMesSiguiente) q = q.lt('fecha_ingreso', inicioMesSiguiente)
  // No se cuenta a sí mismo. `created_at` deja fuera además a los que entraron
  // después: reproduce el conjunto que existía cuando éste se registró.
  if (servicio?.id)         q = q.neq('id', servicio.id)
  if (servicio?.created_at) q = q.lt('created_at', servicio.created_at)

  const { data } = await q
  // DESAMPARADO es social: no comisiona y tampoco sube de tramo al aliado.
  return (data || []).filter(s => s.planes?.codigo !== 'DESAMPARADO').length
}

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
  const tarifas    = await cargarTarifasEspecie()
  const usaFelino  = tarifas
    ? tarifas.get(String(especieId)) === 'FELINO'
    : (especieId === 2 || especieId === 3)  // sin catálogo: Gato o Conejo, como antes

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
 * realizados, para que el llamador decida si informa al usuario. Con
 * `{ dryRun: true }` NO escribe nada y devuelve los mismos cambios: sirve para
 * previsualizar en un confirm y aplicar después con EXACTAMENTE la misma
 * cuenta. Que la vista previa y la escritura salgan de aquí es a propósito —
 * el botón del Kanban tenía su propia cuenta a mano y se desvió (ver abajo).
 *
 * También corre al corregir la ESPECIE: la especie decide si el servicio paga
 * tarifa felino o tarifa por peso, así que reclasificar una mascota mueve el
 * precio igual que cambiarle el peso (`motivo` solo cambia el texto de la
 * novedad que queda en la ficha).
 *
 * @returns {Promise<Array<{servicioId, planNombre, valorAntes, valorDespues, comisionAntes, comisionDespues}>>}
 */
export async function aplicarRecalculoPorPeso(mascotaId, pesoNuevo, especieIdRaw, motivo = 'peso', { dryRun = false } = {}) {
  const especieId = parseInt(especieIdRaw) || 0
  const [{ data: svcsActivos }, { data: planesData }] = await Promise.all([
    db.from('servicios')
      // fecha_ingreso y created_at ubican al servicio en su mes para el tramo de
      // comisión (volumenMesAliado). Sin ellas se contaría a sí mismo.
      .select('id, valor_total, valor_pagado, valor_plan, plan_id, aliado_origen_id, comision_aliado, comision_descontada, fecha_ingreso, created_at')
      .eq('mascota_id', mascotaId)
      .neq('estado', 'ENTREGADO')
      .neq('estado', 'CANCELADO'),
    db.from('planes').select('id, codigo, nombre'),
  ])
  if (!svcsActivos?.length || !planesData?.length) return []

  // Servicios nacidos de una afiliación pre-exequial: el cliente paga la
  // cláusula del contrato (o $0 si está cubierto), NO el precio del plan por
  // peso — el recálculo no aplica.
  const { data: activaciones } = await db.from('afiliacion_mascotas')
    .select('servicio_activado_id')
    .in('servicio_activado_id', svcsActivos.map(s => s.id))
  const deAfiliacion = new Set((activaciones || []).map(a => a.servicio_activado_id))

  const cambios = []
  for (const svc of svcsActivos) {
    if (!svc.plan_id) continue
    if (deAfiliacion.has(svc.id)) continue

    const nuevoPrecioBase = await calcularPrecioPara(planesData, svc.plan_id, pesoNuevo, especieId)
    if (!nuevoPrecioBase) continue

    // Recalcular comisión desde config_comisiones si el servicio tiene aliado activo
    let nuevaComision = null
    const codigoPlanSvc = planesData.find(p => String(p.id) === String(svc.plan_id))?.codigo
    if (!planComisiona(codigoPlanSvc)) {
      // Desamparado: sin comisión. Si venía con una registrada, se limpia aquí
      // (si no, el cuadre la volvería a sumar sobre el valor recalculado).
      if ((svc.comision_aliado ?? 0) > 0) nuevaComision = 0
    } else if (svc.aliado_origen_id && (svc.comision_aliado ?? 0) > 0) {
      // El fetch del aliado va PRIMERO y separado: la consulta de config_comisiones
      // depende de aliado.vip. Meter las tres en un solo Promise.all referenciando
      // `aliado` dentro del mismo destructuring lanza ReferenceError por TDZ y el
      // recálculo muere en silencio (bug real: servicios con comisión de aliado
      // nunca se recalculaban al cambiar el peso).
      const { data: aliado } = await db.from('aliados').select('vip').eq('id_aliado', svc.aliado_origen_id).maybeSingle()
      // `svc` va completo: este servicio YA existe, así que no debe contarse a sí
      // mismo ni medirse contra el mes en que corre el recálculo (ver la nota de
      // volumenMesAliado — casos ORION y EIMY).
      const [serviciosMes, { data: filas }] = await Promise.all([
        volumenMesAliado(svc.aliado_origen_id, svc),
        db.from('config_comisiones').select('porcentaje, plan_id, rango_min, rango_max').eq('es_vip', aliado?.vip ?? false),
      ])
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

    // `valor_plan` guarda el precio base del NUEVO rango (bruto) y se actualiza a
    // la par: antes solo se movía valor_total y el "Valor del plan" del cuadre
    // quedaba con la tarifa vieja → el desglose no cuadraba (bug reportado).
    //
    // valor_total se ajusta por DELTA de la porción del plan (no se recomputa
    // desde cero): así se PRESERVAN adicionales, transporte, recargos, descuentos
    // y eutanasia ya incluidos. Para comision_descontada=true valor_total va NETO,
    // así que se aplica también el delta de la comisión.
    const comisionVigente = nuevaComision != null ? nuevaComision : (svc.comision_aliado ?? 0)
    const baseVieja       = Number(svc.valor_plan ?? 0)
    const deltaBase       = nuevoPrecioBase - baseVieja
    const deltaComision   = svc.comision_descontada ? (comisionVigente - (svc.comision_aliado ?? 0)) : 0
    const nuevoValorTotal = Math.round((svc.valor_total ?? 0) + deltaBase - deltaComision)

    const cambioPrecio   = Math.abs(deltaBase) > 0.5
    const cambioComision = nuevaComision != null && Math.abs(nuevaComision - (svc.comision_aliado ?? 0)) > 0.5
    if (!cambioPrecio && !cambioComision) continue

    const planNombre = planesData.find(p => String(p.id) === String(svc.plan_id))?.nombre || 'Plan'

    // Vista previa: se calcula todo igual pero no se escribe ni se deja novedad.
    if (dryRun) {
      cambios.push({
        servicioId:      svc.id,
        planNombre,
        valorAntes:      svc.valor_total,
        valorDespues:    nuevoValorTotal,
        comisionAntes:   svc.comision_aliado,
        comisionDespues: cambioComision ? nuevaComision : null,
      })
      continue
    }

    const updates = { valor_total: nuevoValorTotal, valor_plan: nuevoPrecioBase }
    if (cambioComision) updates.comision_aliado = nuevaComision
    // Al mover el total, lo ya pagado deja de cuadrar: si el servicio se queda en
    // COMPLETO, su saldo NO aparece en la cartera de Finanzas (filtra por
    // estado_pago). Mismo fallo que tenía el cambio de plan (caso LOLA 2026-07-27).
    if (cambioPrecio) updates.estado_pago = calcularEstadoPago(nuevoValorTotal, svc.valor_pagado)
    const { error } = await db.from('servicios').update(updates).eq('id', svc.id)
    if (error) continue

    // Deja rastro del recálculo (antes cambiaba el precio en silencio) para que
    // la mascota muestre la etiqueta "recategorizado por peso". Best-effort:
    // si falla, el precio ya quedó aplicado. (migración 075: tipo permitido.)
    try {
      const partes = []
      if (cambioPrecio) partes.push(`valor ${fmt(svc.valor_total || 0)} → ${fmt(nuevoValorTotal)}`)
      if (cambioComision) partes.push(`comisión ${fmt(svc.comision_aliado || 0)} → ${fmt(nuevaComision)}`)
      // El texto tiene que decir lo que DE VERDAD se movió. Cuando solo cambia la
      // comisión no se recategorizó nada: decir "recategorizado por nuevo peso"
      // mandó a investigar a un gato de 6,16 kg cuya tarifa (FELINO) es plana
      // desde 1 kg y por lo tanto nunca cambió (ORION, ago-2026).
      const causa = !cambioPrecio
        ? `💼 Comisión del aliado recalculada (el precio no cambió)`
        : motivo === 'especie'
          ? `🐾 Precio recategorizado por cambio de especie`
          : `⚖️ Precio recategorizado por nuevo peso`
      await db.from('novedades_servicio').insert({
        servicio_id:  svc.id,
        tipo_novedad: 'RECATEGORIZACION_PESO',
        descripcion:  `${causa} (${planNombre}, ${pesoNuevo} kg): ${partes.join(' · ')}.`,
        // Traza del valor como NÚMERO (migración 089), para poder mostrar la
        // cadena "antes valía X → ahora Y" en la parte de pago sin leer texto.
        // El motivo sigue al cambio real: marcar como PESO algo que solo movió la
        // comisión desdibuja el historial de la caja de pago.
        ...trazaValor(svc.valor_total, nuevoValorTotal, cambioPrecio ? 'PESO' : 'COMISION'),
      })
    } catch (_) { /* best-effort */ }

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

// Columnas mínimas que necesita `comisionInconsistente`. Para que quien la use
// no tenga que adivinar qué traer en el select.
export const COLS_CONSISTENCIA_COMISION =
  'valor_total, valor_plan, valor_adicionales, valor_transporte, recargo_nocturno, descuento_adicional, comision_aliado, comision_descontada'

/**
 * ¿`valor_total` y `comision_descontada` se están contradiciendo?
 *
 * `comision_descontada = true` significa "valor_total ya viene NETO", y el neto
 * es siempre el bruto MENOS la comisión (que es > 0). Así que un valor_total que
 * alcanza el bruto (plan + adicionales + transporte + recargos − descuento) es
 * imposible: los dos campos están diciendo cosas distintas.
 *
 * Importa porque el recibo del técnico usa la bandera como fuente de verdad y
 * reconstruye el bruto como `valor_total + comisión` (TecnicoApp). Con el par
 * roto eso SUMA la comisión en vez de descontarla y le cobra de más al cliente
 * (caso BRUNO 07-08-2026).
 *
 * Los servicios viejos sin `valor_plan` no se pueden juzgar → devuelve false.
 */
export function comisionInconsistente(svc) {
  if (!svc || svc.comision_descontada !== true) return false
  const comision = Number(svc.comision_aliado) || 0
  if (!(comision > 0)) return false
  const plan = Number(svc.valor_plan)
  if (!(plan > 0)) return false
  // Hay servicios que guardaron la comisión DENTRO de `descuento_adicional`
  // (quedó anotada como un descuento más). Ahí el valor sí está neto, y restar
  // ese descuento otra vez lo haría parecer inflado — falsos positivos reales en
  // prod (HANNA y KEILA). Si el descuento es exactamente la comisión, no cuenta.
  const descuento = Number(svc.descuento_adicional) || 0
  const extras = (Number(svc.valor_adicionales) || 0) + (Number(svc.valor_transporte) || 0)
               + (Number(svc.recargo_nocturno)  || 0)
               - (Math.abs(descuento - comision) < 0.5 ? 0 : descuento)
  return (Number(svc.valor_total) || 0) >= plan + extras - 0.5
}
