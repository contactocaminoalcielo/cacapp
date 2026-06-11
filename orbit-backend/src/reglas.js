// Reglas de negocio Tenjo — versión canónica server-side.
// Puerto de src/lib/tenjo.js del frontend; al consolidar la migración a
// backend propio, el frontend dejará de evaluar y solo mostrará.
// Las fechas usan la hora local del contenedor (TZ=America/Bogota).

export const CONFIG_DEFAULTS = {
  dias_operacion:                   [2, 4, 6],
  dias_planificacion:               [1, 3, 5],
  hora_generacion_propuesta:        '06:00',
  dias_custodia_alerta:             5,
  dias_custodia_critica:            8,
  max_reprogramaciones:             2,
  min_procesos_jornada:             4,
  hora_limite_cierre_lote:          '20:00',
  hora_limite_confirmar_presencial: '17:00',
  horas_max_cargar_evidencia:       24,
  planes_evidencia_obligatoria:     ['COMPETS_EVIDENCIA', 'COMPETS_PRESENCIAL'],
  planes_confirmacion_cliente:      ['EXCLUSIVO_PRESENCIAL', 'EXCLUSIVO_VIDEOLLAMADA', 'COMPETS_PRESENCIAL'],
}

export async function cargarConfig(client) {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'TENJO'`
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

export function proximaJornada(config, desde = new Date()) {
  const dias = config.dias_operacion || CONFIG_DEFAULTS.dias_operacion
  const d = new Date(desde)
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1)
    if (dias.includes(d.getDay())) {
      // fecha local (TZ del contenedor), no UTC
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${dd}`
    }
  }
  return null
}

export const numeroLote = fechaJornada => `TJ-${fechaJornada.replaceAll('-', '')}`

export function requiereConfirmacionCliente(c, config) {
  return (config.planes_confirmacion_cliente || []).includes(c.codigo_plan)
    || c.tipo_acompanamiento === 'PRESENCIAL'
}

export function requiereEvidencia(c, config) {
  return (config.planes_evidencia_obligatoria || []).includes(c.codigo_plan)
    || c.tipo_acompanamiento === 'EVIDENCIA'
}

/** Evalúa una fila de v_candidatos_tenjo (mismas reglas que el frontend) */
export function evaluarCandidato(c, config, item = null) {
  const bloqueos = [], validaciones = []

  if (c.traslado_activo)
    bloqueos.push('Ya tiene un traslado activo a Tenjo')
  if (c.item_activo_id && (!item || c.item_activo_id !== item.id))
    bloqueos.push('Ya está en otro lote Tenjo activo')
  if (c.estado_cf === 'PENDIENTE_INGRESO')
    bloqueos.push('Sin ingreso confirmado al cuarto frío (pendiente nevera/pesaje)')
  if ((c.veces_reprogramada || 0) >= (config.max_reprogramaciones ?? 2))
    bloqueos.push(`Reprogramada ${c.veces_reprogramada} veces — requiere nueva autorización`)

  if (c.estado_pago === 'PENDIENTE')
    validaciones.push('Pago pendiente — validar novedad administrativa')
  if (!c.peso_kg)
    validaciones.push('Sin peso registrado')
  if (!c.cliente_whatsapp)
    validaciones.push('Cliente sin WhatsApp registrado')
  if (!c.nevera_codigo)
    validaciones.push('Sin nevera asignada en cuarto frío')
  else if (c.nevera_destino === 'GRUPALES')
    validaciones.push(`Ubicada en nevera de grupales (${c.nevera_codigo}) — revisar Cuarto Frío`)

  const reqConfirma = requiereConfirmacionCliente(c, config)
  const reqEvidencia = requiereEvidencia(c, config)
  const confirmada = item?.confirmacion_cliente === true

  let clasificacion = 'APTA'
  if (bloqueos.length)                 clasificacion = 'BLOQUEADA'
  else if (reqConfirma && !confirmada) clasificacion = 'PRESENCIAL_PENDIENTE'
  else if (validaciones.length)        clasificacion = 'REQUIERE_VALIDACION'
  else if (reqEvidencia)               clasificacion = 'EVIDENCIA_REQUERIDA'

  return { clasificacion, bloqueos, validaciones, reqConfirma, reqEvidencia }
}
