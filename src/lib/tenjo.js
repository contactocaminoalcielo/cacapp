// Motor de reglas del módulo Tenjo — planificación y operación individual.
// Principio: las reglas de elegibilidad y bloqueo son deterministas y viven
// aquí (y a futuro en orbit-backend); la IA solo resume y redacta.
// Tenjo LEE la custodia vía v_candidatos_tenjo; nunca administra neveras.
import { db } from '@/lib/supabase'
import { registrarSalidaCuartoFrio } from '@/lib/cuartoFrio'
import { today, hoyLocalISO } from '@/lib/utils'
import { etiquetaCubiculo } from '@/lib/cubiculos'

// ─── Configuración (defaults de respaldo; la fuente es config_operativa) ─────
export const CONFIG_DEFAULTS = {
  dias_operacion:                   [2, 4, 6],        // mar, jue, sáb
  dias_planificacion:               [1, 3, 5],        // lun, mié, vie
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
  checklist_plantillas: {
    INDIVIDUAL_ESTANDAR: [
      { campo: 'observaciones', label: 'Observaciones del proceso', tipo: 'texto', obligatorio: false },
    ],
    EXCLUSIVO_PRESENCIAL: [
      { campo: 'fecha_hora_acordada', label: 'Fecha y hora acordada con el cliente', tipo: 'texto', obligatorio: true },
      { campo: 'asistencia_cliente', label: 'El cliente asistió al proceso', tipo: 'bool', obligatorio: true },
      { campo: 'observacion_cierre', label: 'Observación de cierre del acompañamiento', tipo: 'texto', obligatorio: true },
    ],
    EXCLUSIVO_VIDEOLLAMADA: [
      { campo: 'medio_conexion', label: 'Medio de conexión (Meet, WhatsApp, etc.)', tipo: 'texto', obligatorio: true },
      { campo: 'hora_acordada', label: 'Hora acordada con el cliente', tipo: 'texto', obligatorio: true },
      { campo: 'registro_ejecucion', label: 'Videollamada realizada con el cliente', tipo: 'bool', obligatorio: true },
      { campo: 'observacion_cierre', label: 'Observación de cierre', tipo: 'texto', obligatorio: false },
    ],
    COMPETS_EVIDENCIA: [
      { campo: 'evidencia_validada', label: 'Evidencia revisada y validada por coordinación', tipo: 'bool', obligatorio: true },
      { campo: 'observacion_final', label: 'Observación final', tipo: 'texto', obligatorio: false },
    ],
  },
}

// ─── Variantes de proceso individual y validación de cierre ──────────────────
// Espejo de orbit-backend/src/checklists.js — el backend es la compuerta real;
// esto da feedback inmediato en la UI.
export function varianteProceso(codigoPlan, tipoAcompanamiento) {
  if (codigoPlan === 'EXCLUSIVO_PRESENCIAL' || tipoAcompanamiento === 'PRESENCIAL')
    return 'EXCLUSIVO_PRESENCIAL'
  if (codigoPlan === 'EXCLUSIVO_VIDEOLLAMADA' || tipoAcompanamiento === 'VIDEOLLAMADA')
    return 'EXCLUSIVO_VIDEOLLAMADA'
  if (['COMPETS_EVIDENCIA', 'COMPETS_PRESENCIAL'].includes(codigoPlan) || tipoAcompanamiento === 'EVIDENCIA')
    return 'COMPETS_EVIDENCIA'
  return 'INDIVIDUAL_ESTANDAR'
}

export const VARIANTE_LABEL = {
  INDIVIDUAL_ESTANDAR:    'Individual estándar',
  EXCLUSIVO_PRESENCIAL:   'Exclusivo presencial',
  EXCLUSIVO_VIDEOLLAMADA: 'Exclusivo videollamada',
  COMPETS_EVIDENCIA:      'Compets evidencia',
}

/** Faltantes que bloquearían el cierre de un item PROCESADO (vacío = ok) */
export function validarItemCierre(item, codigoPlan, tipoAcompanamiento, config) {
  const faltantes = []
  const variante = varianteProceso(codigoPlan, tipoAcompanamiento)
  const checklist = item.checklist || {}

  if (!item.responsable_proceso_id) faltantes.push('Sin responsable de proceso asignado')
  if (!item.fecha_inicio_proceso)   faltantes.push('Sin fecha/hora de inicio de proceso')
  if (!item.fecha_fin_proceso)      faltantes.push('Sin fecha/hora de finalización')
  // La evidencia (foto) es recomendada pero NO bloquea el cierre (espejo del backend, 2026-06-24)
  if (['EXCLUSIVO_PRESENCIAL', 'EXCLUSIVO_VIDEOLLAMADA'].includes(variante) && item.confirmacion_cliente !== true)
    faltantes.push('Sin confirmación del cliente registrada')

  const plantillas = config.checklist_plantillas || CONFIG_DEFAULTS.checklist_plantillas
  for (const campo of (plantillas[variante] || [])) {
    if (!campo.obligatorio) continue
    const v = checklist[campo.campo]
    const vacio = campo.tipo === 'bool' ? v !== true : !(typeof v === 'string' && v.trim())
    if (vacio) faltantes.push(`Falta "${campo.label}"`)
  }
  return faltantes
}

export async function cargarConfigTenjo() {
  const { data, error } = await db.from('config_operativa')
    .select('clave, valor')
    .eq('modulo', 'TENJO')
  if (error) return { ...CONFIG_DEFAULTS, _sinTabla: true }
  const cfg = { ...CONFIG_DEFAULTS }
  ;(data || []).forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

// ─── Calendario ───────────────────────────────────────────────────────────────
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const nombreDia = d => DIAS[new Date(d + 'T12:00:00').getDay()]

/** Próxima jornada Tenjo estrictamente posterior a `desde` (Date) */
export function proximaJornada(config, desde = new Date()) {
  const dias = config.dias_operacion || CONFIG_DEFAULTS.dias_operacion
  const d = new Date(desde)
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1)
    if (dias.includes(d.getDay())) return hoyLocalISO(d)
  }
  return null
}

/** Próximas N jornadas Tenjo (fechas de operación) a partir de `desde`. */
export function proximasJornadas(config, n = 8, desde = new Date()) {
  const dias = config.dias_operacion || CONFIG_DEFAULTS.dias_operacion
  const out = []
  const d = new Date(desde)
  for (let i = 1; i <= 90 && out.length < n; i++) {
    d.setDate(d.getDate() + 1)
    if (dias.includes(d.getDay())) out.push(hoyLocalISO(d))
  }
  return out
}

export function esDiaPlanificacion(config, fecha = new Date()) {
  return (config.dias_planificacion || CONFIG_DEFAULTS.dias_planificacion).includes(fecha.getDay())
}

export function esDiaOperacion(config, fecha = new Date()) {
  return (config.dias_operacion || CONFIG_DEFAULTS.dias_operacion).includes(fecha.getDay())
}

// ─── Evaluación de candidatas (reglas duras, deterministas) ──────────────────
export function requiereConfirmacionCliente(c, config) {
  return (config.planes_confirmacion_cliente || []).includes(c.codigo_plan)
    || c.tipo_acompanamiento === 'PRESENCIAL'
}

export function requiereEvidencia(c, config) {
  return (config.planes_evidencia_obligatoria || []).includes(c.codigo_plan)
    || c.tipo_acompanamiento === 'EVIDENCIA'
}

/**
 * Evalúa una fila de v_candidatos_tenjo.
 * @returns { clasificacion, bloqueos[], validaciones[], alertas[], accion }
 * Se ejecuta al generar la propuesta Y al confirmar el lote (revalidación).
 */
export function evaluarCandidato(c, config, item = null) {
  const bloqueos = [], validaciones = [], alertas = []

  // ── Bloqueos duros (impiden aprobar) ──
  if (c.traslado_activo)
    bloqueos.push('Ya tiene un traslado activo a Tenjo')
  if (c.item_activo_id && (!item || c.item_activo_id !== item.id))
    bloqueos.push('Ya está en otro lote Tenjo activo')
  if (c.estado_cf === 'PENDIENTE_INGRESO')
    bloqueos.push('Sin ingreso confirmado al cuarto frío (pendiente nevera/pesaje)')
  if ((c.veces_reprogramada || 0) >= (config.max_reprogramaciones ?? 2))
    bloqueos.push(`Reprogramada ${c.veces_reprogramada} veces — requiere nueva autorización`)

  // ── Validaciones (el coordinador decide) ──
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

  // ── Requisitos por variante ──
  const reqConfirma = requiereConfirmacionCliente(c, config)
  const reqEvidencia = requiereEvidencia(c, config)
  const confirmada = item?.confirmacion_cliente === true

  // ── Alertas informativas ──
  const diasAlerta = config.dias_custodia_alerta ?? 5
  const diasCrit   = config.dias_custodia_critica ?? 8
  if (c.dias_custodia >= diasCrit)
    alertas.push({ tipo: 'CUSTODIA_CRITICA', prioridad: 'CRITICA', msg: `${c.dias_custodia} días en custodia` })
  else if (c.dias_custodia >= diasAlerta)
    alertas.push({ tipo: 'CUSTODIA_PROLONGADA', prioridad: 'ALTA', msg: `${c.dias_custodia} días en custodia` })

  // ── Clasificación final ──
  let clasificacion = 'APTA'
  if (bloqueos.length)                       clasificacion = 'BLOQUEADA'
  else if (reqConfirma && !confirmada)       clasificacion = 'PRESENCIAL_PENDIENTE'
  else if (validaciones.length)              clasificacion = 'REQUIERE_VALIDACION'
  else if (reqEvidencia)                     clasificacion = 'EVIDENCIA_REQUERIDA'

  const accion = clasificacion === 'BLOQUEADA'             ? 'Revisar bloqueo antes de programar'
    : clasificacion === 'PRESENCIAL_PENDIENTE'             ? 'Contactar al cliente para confirmar'
    : clasificacion === 'REQUIERE_VALIDACION'              ? 'Validar y aprobar o reprogramar'
    : clasificacion === 'EVIDENCIA_REQUERIDA'              ? 'Programar — exigirá evidencia al cierre'
    : 'Aprobar para el próximo lote'

  return { clasificacion, bloqueos, validaciones, alertas, accion, reqConfirma, reqEvidencia }
}

// ─── Propuesta de lote ────────────────────────────────────────────────────────
export const numeroLote = fechaJornada => `TJ-${fechaJornada.replaceAll('-', '')}`

/**
 * Crea (si no existe) el lote PROPUESTO para la próxima jornada y propone
 * como items todas las candidatas sin lote. Idempotente: si el lote ya
 * existe, agrega solo las candidatas nuevas.
 */
export async function generarPropuestaLote({ config, candidatas, personalId, generadoPor = 'MANUAL' }) {
  const fechaJornada = proximaJornada(config)
  if (!fechaJornada) throw new Error('No hay días de operación configurados')

  // 1. Lote de la jornada (existente o nuevo)
  let { data: lote, error: errLote } = await db.from('lotes_tenjo')
    .select('*').eq('fecha_jornada', fechaJornada).neq('estado', 'CANCELADO').maybeSingle()
  if (errLote) throw new Error(errLote.message)

  if (!lote) {
    const { data: nuevo, error: errIns } = await db.from('lotes_tenjo').insert({
      numero_lote:   numeroLote(fechaJornada),
      fecha_jornada: fechaJornada,
      estado:        'PROPUESTO',
      generado_por:  generadoPor,
      creado_por:    personalId || null,
    }).select().single()
    if (errIns) {
      if (errIns.code === '23505') { // otro usuario lo creó en paralelo — usarlo
        const { data: existente } = await db.from('lotes_tenjo')
          .select('*').eq('fecha_jornada', fechaJornada).neq('estado', 'CANCELADO').maybeSingle()
        lote = existente
      } else throw new Error(errIns.message)
    } else lote = nuevo
  }
  if (!lote) throw new Error('No se pudo crear ni recuperar el lote')
  if (['CONFIRMADO', 'EN_EJECUCION', 'CERRADO'].includes(lote.estado)) {
    return { lote, agregadas: 0 } // lote ya confirmado: no se agregan propuestas
  }

  // 2. Proponer candidatas que aún no están en ningún lote activo
  const sinLote = (candidatas || []).filter(c => !c.item_activo_id && !c.traslado_activo)
  let agregadas = 0
  for (const c of sinLote) {
    const ev = evaluarCandidato(c, config)
    const { error } = await db.from('lotes_tenjo_items').insert({
      lote_id:         lote.id,
      servicio_id:     c.servicio_id,
      clasificacion:   ev.clasificacion,
      estado:          'PROPUESTO',
      bloqueos:        ev.bloqueos,
      validaciones:    ev.validaciones,
      contacto_estado: ev.reqConfirma ? 'PENDIENTE' : 'NO_REQUERIDO',
      veces_reprogramada: c.veces_reprogramada || 0,
    })
    // 23505 = ya está en un lote activo (índice único) — carrera benigna, ignorar
    if (error && error.code !== '23505') throw new Error(error.message)
    if (!error) agregadas++
  }
  return { lote, agregadas }
}

/**
 * Agrega UNA candidata al lote PROPUESTO de la próxima jornada, creándolo si
 * aún no existe. Idempotente: si la mascota ya está en un lote/traslado activo
 * el índice único la descarta sin duplicar. Pensado para agregar desde la
 * pestaña Candidatas sin pasar por Planificación.
 * @returns { lote, agregada: boolean }
 */
export async function agregarCandidataALote({ candidata: c, config, personalId }) {
  const fechaJornada = proximaJornada(config)
  if (!fechaJornada) throw new Error('No hay días de operación configurados')

  // 1. Lote de la jornada (existente o nuevo PROPUESTO)
  let { data: lote, error: errLote } = await db.from('lotes_tenjo')
    .select('*').eq('fecha_jornada', fechaJornada).neq('estado', 'CANCELADO').maybeSingle()
  if (errLote) throw new Error(errLote.message)

  if (!lote) {
    const { data: nuevo, error: errIns } = await db.from('lotes_tenjo').insert({
      numero_lote:   numeroLote(fechaJornada),
      fecha_jornada: fechaJornada,
      estado:        'PROPUESTO',
      generado_por:  'MANUAL',
      creado_por:    personalId || null,
    }).select().single()
    if (errIns) {
      if (errIns.code === '23505') { // creado en paralelo — recuperarlo
        const { data: existente } = await db.from('lotes_tenjo')
          .select('*').eq('fecha_jornada', fechaJornada).neq('estado', 'CANCELADO').maybeSingle()
        lote = existente
      } else throw new Error(errIns.message)
    } else lote = nuevo
  }
  if (!lote) throw new Error('No se pudo crear ni recuperar el lote')
  if (['CONFIRMADO', 'EN_EJECUCION', 'CERRADO'].includes(lote.estado))
    throw new Error(`El lote del ${fechaJornada} ya está ${LOTE_ESTADO_CFG[lote.estado]?.label || lote.estado}; no admite nuevas mascotas.`)

  // 2. Insertar el item (el índice único parcial evita duplicados)
  const ev = evaluarCandidato(c, config)
  const { error } = await db.from('lotes_tenjo_items').insert({
    lote_id:         lote.id,
    servicio_id:     c.servicio_id,
    clasificacion:   ev.clasificacion,
    estado:          'PROPUESTO',
    bloqueos:        ev.bloqueos,
    validaciones:    ev.validaciones,
    contacto_estado: ev.reqConfirma ? 'PENDIENTE' : 'NO_REQUERIDO',
    veces_reprogramada: c.veces_reprogramada || 0,
    notas:           'Agregada desde Candidatas',
  })
  if (error && error.code !== '23505') throw new Error(error.message)
  return { lote, agregada: !error }
}

/**
 * Reautoriza una mascota bloqueada por exceso de reprogramaciones: convierte
 * sus items REPROGRAMADO en RETIRADO_DEL_LOTE para que dejen de contar como
 * "strikes" en v_candidatos_tenjo (que solo cuenta los REPROGRAMADO). Es la
 * "nueva autorización" que pide la regla: vuelve al pool con el contador en 0.
 * @returns número de reprogramaciones limpiadas
 */
export async function reautorizarCandidata({ servicioId }) {
  const { data, error } = await db.from('lotes_tenjo_items')
    .update({ estado: 'RETIRADO_DEL_LOTE' })
    .eq('servicio_id', servicioId)
    .eq('estado', 'REPROGRAMADO')
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length || 0
}

/**
 * Confirma el lote: revalida cada item APROBADO contra las candidatas
 * frescas, lo pasa a AUTORIZADA_SALIDA y crea su traslado PROGRAMADO.
 * Los items que quedaron sin decisión pasan a REPROGRAMADO.
 * Lock optimista: solo confirma si el lote sigue en PROPUESTO/EN_REVISION.
 */
export async function confirmarLote({ lote, items, candidatas, config, personalId }) {
  const porServicio = Object.fromEntries((candidatas || []).map(c => [c.servicio_id, c]))
  const resultado = { autorizadas: 0, reprogramadas: 0, rechazadas: [] }

  // Lock optimista sobre el lote
  const { data: lockRows, error: errLock } = await db.from('lotes_tenjo')
    .update({ estado: 'CONFIRMADO' })
    .eq('id', lote.id)
    .in('estado', ['PROPUESTO', 'EN_REVISION'])
    .select('id')
  if (errLock) throw new Error(errLock.message)
  if (!lockRows?.length) throw new Error('El lote cambió de estado (¿otro usuario lo confirmó?). Recarga la página.')

  for (const item of items) {
    if (item.estado === 'APROBADO') {
      // Revalidación al confirmar — la propuesta puede tener horas
      const c = porServicio[item.servicio_id]
      const ev = c ? evaluarCandidato(c, config, item) : null
      const sigueApta = ev && !ev.bloqueos.length && (!ev.reqConfirma || item.confirmacion_cliente === true)
      if (!sigueApta) {
        await db.from('lotes_tenjo_items').update({
          estado: 'REPROGRAMADO',
          motivo_reprogramacion: ev ? (ev.bloqueos[0] || 'Pendiente confirmación del cliente al confirmar lote') : 'Ya no está en custodia disponible',
          decidido_por: personalId || null,
        }).eq('id', item.id)
        resultado.rechazadas.push({ item, motivo: ev?.bloqueos[0] || 'Requiere confirmación del cliente' })
        continue
      }
      // Crear traslado programado de la jornada (protegido por índice único).
      // NOTA: traslados_tenjo.lote_id es una FK legada a lotes_grupales (no a
      // lotes_tenjo); el vínculo con este lote queda en lotes_tenjo_items.traslado_id
      // y en `notas`. No se envía lote_id para no violar la FK.
      const { data: tras, error: errT } = await db.from('traslados_tenjo').insert({
        servicio_id:    item.servicio_id,
        estado:         'PROGRAMADO',
        fecha_traslado: lote.fecha_jornada,
        notas:          `Lote ${lote.numero_lote}`,
      }).select('id').single()
      if (errT && errT.code !== '23505') throw new Error(errT.message)
      await db.from('lotes_tenjo_items').update({
        estado:       'AUTORIZADA_SALIDA',
        traslado_id:  tras?.id || null,
        decidido_por: personalId || null,
      }).eq('id', item.id)
      resultado.autorizadas++
    } else if (item.estado === 'PROPUESTO') {
      // Sin decisión del coordinador → queda para el siguiente ciclo
      await db.from('lotes_tenjo_items').update({
        estado: 'REPROGRAMADO',
        motivo_reprogramacion: item.motivo_reprogramacion || 'Sin decisión al confirmar el lote',
        decidido_por: personalId || null,
      }).eq('id', item.id)
      resultado.reprogramadas++
    }
  }
  return resultado
}

// ─── Alertas persistentes (MVP frontend; el job del backend tomará el relevo) ─
export async function sincronizarAlertasTenjo(candidatas, config) {
  const deseadas = []
  for (const c of (candidatas || [])) {
    const ev = evaluarCandidato(c, config)
    const base = { servicio_id: c.servicio_id, modulo_origen: 'TENJO', metadata: { mascota: c.mascota } }
    if (!c.item_activo_id && !c.traslado_activo && c.dias_custodia >= (config.dias_custodia_alerta ?? 5))
      deseadas.push({
        ...base,
        tipo_alerta: 'SIN_PROGRAMAR',
        prioridad: c.dias_custodia >= (config.dias_custodia_critica ?? 8) ? 'CRITICA' : 'ALTA',
        mensaje: `${c.mascota} lleva ${c.dias_custodia} días en custodia sin programación Tenjo`,
        accion_recomendada: 'Revisar motivo y programar en el próximo lote',
        clave_dedupe: `TENJO:SIN_PROGRAMAR:${c.servicio_id}`,
      })
    if (c.nevera_destino === 'GRUPALES')
      deseadas.push({
        ...base,
        tipo_alerta: 'NEVERA_INCORRECTA',
        prioridad: 'MEDIA',
        mensaje: `${c.mascota} es individual pero está en nevera de grupales (${c.nevera_codigo})`,
        accion_recomendada: 'Reubicar desde el módulo Cuarto Frío',
        clave_dedupe: `TENJO:NEVERA_INCORRECTA:${c.servicio_id}`,
      })
    if (ev.reqConfirma && c.item_activo_id)
      deseadas.push({
        ...base,
        tipo_alerta: 'PRESENCIAL_SIN_CONFIRMAR',
        prioridad: 'ALTA',
        mensaje: `${c.mascota} (${c.plan}) requiere confirmación del cliente antes de la jornada`,
        accion_recomendada: 'Contactar al cliente desde Planificación',
        clave_dedupe: `TENJO:PRESENCIAL_SIN_CONFIRMAR:${c.servicio_id}`,
      })
  }

  // Insertar una a una: el índice único de dedupe descarta las repetidas
  for (const a of deseadas) {
    const { error } = await db.from('alertas_operativas').insert(a)
    if (error && error.code !== '23505') console.error('[alertas]', error.message)
  }

  // Auto-resolver las abiertas cuya condición ya no existe
  const clavesVigentes = new Set(deseadas.map(a => a.clave_dedupe))
  const { data: abiertas } = await db.from('alertas_operativas')
    .select('id, clave_dedupe')
    .eq('modulo_origen', 'TENJO')
    .in('estado', ['ABIERTA', 'EN_GESTION'])
    .not('clave_dedupe', 'is', null)
  const resolver = (abiertas || []).filter(a => !clavesVigentes.has(a.clave_dedupe)).map(a => a.id)
  if (resolver.length) {
    await db.from('alertas_operativas')
      .update({ estado: 'RESUELTA', fecha_resolucion: new Date().toISOString() })
      .in('id', resolver)
  }
}

// ─── Mensajes sugeridos (estáticos; la IA los reemplazará en Fase 5) ─────────
export function mensajeSugerido(proposito, { mascota = 'tu mascotica' } = {}) {
  if (proposito === 'CONFIRMAR_PRESENCIAL')
    return `Hola, te saludamos con mucho respeto de Camino al Cielo. Queremos confirmar contigo la programación del proceso individual de ${mascota} para nuestra próxima jornada en Tenjo. ¿Nos confirmas por favor si podemos avanzar con la programación?`
  if (proposito === 'REPROGRAMACION')
    return `Hola, queremos informarte que el proceso individual de ${mascota} quedará reprogramado para la siguiente jornada de Tenjo. Seguiremos cuidando todo el proceso con el mayor respeto y te mantendremos informado.`
  return `Hola, te saludamos de Camino al Cielo respecto al proceso de ${mascota}.`
}

export const TIPO_PROCESO_LABEL = {
  CREMACION_INDIVIDUAL:  'Cremación individual',
  COMPOSTAJE_INDIVIDUAL: 'Compostaje individual',
}

/** Mensaje wa.me para el cliente confirmando que su proceso quedó programado. */
export function mensajeConfirmacionCliente({ mascota = 'tu mascotica', fechaLarga, presencial, hora } = {}) {
  let msg = `Hola, te saludamos con mucho respeto de Camino al Cielo 🕊️. `
    + `Queremos confirmarte que el proceso de ${mascota} quedó programado`
    + (fechaLarga ? ` para el ${fechaLarga}` : '') + `. `
  if (presencial)
    msg += hora
      ? `Te esperamos a las ${hora} para acompañarnos en este momento. `
      : `Te esperamos para acompañarnos en este momento; te confirmaremos la hora. `
  msg += `Acompañaremos todo el proceso con el mayor cuidado y te mantendremos informad@. `
    + `Cualquier inquietud, con gusto te ayudamos.`
  return msg
}

/** Mensaje para el grupo operativo con las mascoticas a procesar en la jornada. */
export function mensajeGrupoProceso({ fechaLarga, mascotas = [] } = {}) {
  const lineas = mascotas.map(m => {
    const datos = []
    if (m.cliente) datos.push(`Cliente: ${m.cliente}`)
    if (m.peso)    datos.push(`${m.peso} kg`)
    if (m.presencial) datos.push(`🕐 Presencial`)
    const proceso = [m.plan, m.tipoProceso].filter(Boolean).join(' · ')
    return `${m.emoji || '🐾'} *${m.nombre}*${m.especie ? ` (${m.especie})` : ''}`
      + (proceso ? `\n   ${proceso}` : '')
      + (datos.length ? `\n   ${datos.join(' · ')}` : '')
      + (m.contacto ? `\n   📞 Contacto: ${m.contacto}` : '')
      + `\n   📝 Obs: ${m.observaciones || ''}`
  })
  return `🐾 *Procesos individuales — ${fechaLarga || 'próxima jornada'}*\n`
    + `${mascotas.length} mascotica${mascotas.length !== 1 ? 's' : ''} a proceso:\n\n`
    + lineas.join('\n\n')
}

// ─── Control de procesos (cenizas / compostaje) ──────────────────────────────
// Regla unica de plazos, reutilizable por la UI (pestana Control) y, a futuro,
// por el backend. Confirmado con David 2026-06-24:
//   - Cremacion:  cenizas listas = fecha de cremacion + 5 dias CALENDARIO.
//   - Compostaje: compostaje listo = fecha de ingreso al cubiculo + 2 MESES.
export const DIAS_CENIZAS  = 5   // dias calendario tras la cremacion
export const MESES_COMPOST = 2   // meses calendario tras ingresar al cubiculo

const soloFecha = v => v ? hoyLocalISO(new Date(String(v).includes('T') ? v : v + 'T12:00:00')) : null
const sumarDias = (fechaStr, n) => {
  const d = new Date(fechaStr + 'T12:00:00'); d.setDate(d.getDate() + n)
  return hoyLocalISO(d)
}
const sumarMeses = (fechaStr, n) => {
  const d = new Date(fechaStr + 'T12:00:00'); d.setMonth(d.getMonth() + n)
  return hoyLocalISO(d)
}

/**
 * Calcula el timeline de un lotes_tenjo_items segun el tipo de proceso del plan.
 * @param {object} item  fila de lotes_tenjo_items (con servicios.planes.tipo_proceso)
 * @returns {{ tipo, esCompostaje, fechaInicio, fechaProceso, cubiculo, fechaListo, diasRestantes, estado }}
 *   estado: 'EN_PROCESO' | 'EN_ESPERA' | 'LISTO'
 */
export function calcularListoProceso(item) {
  const tipo = item?.servicios?.planes?.tipo_proceso || null
  const esCompostaje = tipo === 'COMPOSTAJE_INDIVIDUAL'
  const fechaInicio  = soloFecha(item?.fecha_inicio_proceso)
  const fechaProceso = soloFecha(item?.fecha_fin_proceso) // fin = cremacion / fin de proceso
  // Catálogo (migración 054) primero; el texto libre viejo solo como respaldo
  // para los items anteriores que no se pudieron enlazar.
  const cubiculo     = item?.cubiculos
    ? etiquetaCubiculo(item.cubiculos)
    : (item?.cubiculo_codigo || null)

  // Aun no finaliza el proceso → en proceso, sin plazo todavia
  if (!fechaProceso) {
    return { tipo, esCompostaje, fechaInicio, fechaProceso: null, cubiculo,
             fechaListo: null, diasRestantes: null, estado: 'EN_PROCESO' }
  }

  const baseComp = soloFecha(item?.fecha_compostaje_inicio) || fechaProceso
  const mesesComp = item?.meses_compostaje || MESES_COMPOST // 2 por defecto; el operario puede fijar 3
  const fechaListo = esCompostaje
    ? sumarMeses(baseComp, mesesComp)
    : sumarDias(fechaProceso, DIAS_CENIZAS)

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const diasRestantes = Math.ceil((new Date(fechaListo + 'T12:00:00') - hoy) / 86400000)
  const estado = diasRestantes <= 0 ? 'LISTO' : 'EN_ESPERA'

  return { tipo, esCompostaje,
           fechaInicio: esCompostaje ? baseComp : fechaInicio,
           fechaProceso, cubiculo, fechaListo, diasRestantes, estado }
}

// Estados de servicio "anteriores a Tenjo" (permiten avanzar sin downgrade)
const ANTES_PROCESO    = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO']
const ANTES_PRODUCCION = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO', 'EN_PROCESO']
// Items "vivos" antes de procesarse (se retiran al poner en orden una terminada)
const ITEMS_PRE_PROCESO = ['PROPUESTO', 'APROBADO', 'AUTORIZADA_SALIDA', 'EN_TRASLADO', 'RECIBIDA']

/**
 * Deja un servicio individual de Tenjo en estado coherente. Conecta el flujo de
 * la Jornada (lotes) con la custodia (cuarto frío) y el estado del servicio.
 * Todos los pasos son idempotentes y nunca hacen downgrade del servicio.
 *
 * @param {string} servicioId
 * @param {object} opts
 * @param {string}  opts.tipoProceso          'CREMACION_INDIVIDUAL' | 'COMPOSTAJE_INDIVIDUAL'
 * @param {string}  opts.fechaProceso         fecha/hora de fin de proceso (cremación/ingreso). Default: ahora.
 * @param {string?} opts.fechaCompostajeInicio fecha de ingreso al cubículo (compostaje)
 * @param {string?} opts.personalId
 * @param {string?} opts.responsableId        responsable del proceso (para que el cierre no lo marque faltante)
 * @param {string}  opts.motivo               texto para el log de salida
 * @param {boolean} opts.retirarItems         retirar items pre-proceso del pool (limpieza de terminadas)
 * @param {boolean} opts.marcarItemProcesado  fijar el item activo a PROCESADO (marcar como ya hecha)
 */
export async function reconciliarServicioTenjo(servicioId, {
  tipoProceso,
  fechaProceso = new Date().toISOString(),
  fechaCompostajeInicio = null,
  personalId = null,
  responsableId = null,
  motivo = 'Puesto en orden — proceso finalizado en Tenjo',
  retirarItems = false,
  marcarItemProcesado = false,
} = {}) {
  if (!servicioId) return

  // 1. (opcional) marcar el item activo como PROCESADO antes de retirar/avanzar.
  //    Se completan responsable y fechas para que el cierre del lote no lo bloquee.
  if (marcarItemProcesado) {
    const resp = responsableId || personalId
    const cambios = {
      estado:               'PROCESADO',
      fecha_inicio_proceso: fechaProceso,
      fecha_fin_proceso:    fechaProceso,
      notas:                'Puesto en orden manualmente',
    }
    if (resp) cambios.responsable_proceso_id = resp
    await db.from('lotes_tenjo_items')
      .update(cambios)
      .eq('servicio_id', servicioId)
      .in('estado', ['RECIBIDA', 'EN_PROCESO', 'AUTORIZADA_SALIDA', 'EN_TRASLADO'])
  }

  // 2. salida física del cuarto frío (idempotente)
  await registrarSalidaCuartoFrio(servicioId, { personalId, tipo: 'SALIDA_TENJO', motivo })

  // 3. completar traslado activo (si lo hay)
  await db.from('traslados_tenjo')
    .update({ estado: 'COMPLETADO', fecha_completado: today() })
    .eq('servicio_id', servicioId)
    .in('estado', ['PROGRAMADO', 'EN_CAMINO'])

  // 4. avanzar el servicio según el tiempo, sin downgrade
  const calc = calcularListoProceso({
    servicios: { planes: { tipo_proceso: tipoProceso } },
    fecha_fin_proceso: fechaProceso,
    fecha_compostaje_inicio: fechaCompostajeInicio,
  })
  if (calc.estado === 'LISTO') {
    await db.from('servicios').update({ estado: 'EN_PRODUCCION' })
      .eq('id', servicioId).in('estado', ANTES_PRODUCCION)
  } else {
    await db.from('servicios').update({ estado: 'EN_PROCESO' })
      .eq('id', servicioId).in('estado', ANTES_PROCESO)
  }

  // 5. (opcional) retirar items pre-proceso huérfanos del pool
  if (retirarItems) {
    await db.from('lotes_tenjo_items').update({ estado: 'RETIRADO_DEL_LOTE' })
      .eq('servicio_id', servicioId).in('estado', ITEMS_PRE_PROCESO)
  }
}

/**
 * Recepción en planta de un item de lote (flujo Jornada). Sella hora real de
 * llegada + quién recibió y, si la mascota efectivamente llegó, cierra la
 * custodia del cuarto frío (idempotente), completa el traslado activo y deja el
 * item en RECIBIDA (compuerta para "Iniciar proceso").
 *
 * @param {object} item  fila de lotes_tenjo_items (necesita id y servicio_id)
 * @param {object} opts
 * @param {'RECIBIDA'|'NOVEDAD'|'NO_LLEGO'} opts.estado  resultado de la recepción
 * @param {string?} opts.novedad     detalle de novedad / motivo de no llegada
 * @param {string?} opts.recibidoPor operario que recibe (default: personalId)
 * @param {string?} opts.personalId  para el log de salida del cuarto frío
 */
export async function recibirItemLoteTenjo(item, {
  estado = 'RECIBIDA',
  novedad = null,
  recibidoPor = null,
  personalId = null,
} = {}) {
  if (!item?.id) throw new Error('Item de lote inválido para recepción')
  const noLlego  = estado === 'NO_LLEGO'
  const quien    = recibidoPor || personalId || null
  const ahora    = new Date().toISOString()

  // 1. Sellar la recepción en el item. Si llegó, además pasa a RECIBIDA.
  const cambios = {
    recepcion_estado:  estado,
    recepcion_novedad: novedad?.trim() || null,
    fecha_recepcion:   ahora,
    recibido_por:      quien,
    decidido_por:      personalId || null,
  }
  if (!noLlego) cambios.estado = 'RECIBIDA'
  const { error } = await db.from('lotes_tenjo_items').update(cambios).eq('id', item.id)
  if (error) throw new Error(error.message)

  if (noLlego) return // no llegó: no toca custodia ni traslado; queda pendiente

  // 2. La mascota está físicamente en Tenjo → sale de la nevera (idempotente).
  await registrarSalidaCuartoFrio(item.servicio_id, {
    personalId, tipo: 'SALIDA_TENJO', motivo: 'Recibida en planta Tenjo',
  })

  // 3. Completar el traslado activo (transporte terminado) con datos de recepción.
  await db.from('traslados_tenjo')
    .update({ estado: 'COMPLETADO', fecha_completado: today(),
              fecha_recepcion: ahora, recibido_por: quien })
    .eq('servicio_id', item.servicio_id)
    .in('estado', ['PROGRAMADO', 'EN_CAMINO'])
}

// ─── Etiquetas y colores para la UI ──────────────────────────────────────────
export const RECEPCION_CFG = {
  RECIBIDA: { label: 'Recibida',           bg: '#E0F2FE', text: '#0E7490' },
  NOVEDAD:  { label: 'Recibida c/novedad', bg: '#FEF3C7', text: '#92400E' },
  NO_LLEGO: { label: 'No llegó',           bg: '#FEE2E2', text: '#991B1B' },
}

export const CLASIF_CFG = {
  APTA:                 { label: 'Apta',                 bg: '#D1FAE5', text: '#065F46' },
  REQUIERE_VALIDACION:  { label: 'Requiere validación',  bg: '#FEF3C7', text: '#92400E' },
  BLOQUEADA:            { label: 'Bloqueada',            bg: '#FEE2E2', text: '#991B1B' },
  PRESENCIAL_PENDIENTE: { label: 'Presencial por confirmar', bg: '#EDE9FE', text: '#5B21B6' },
  EVIDENCIA_REQUERIDA:  { label: 'Evidencia obligatoria', bg: '#DBEAFE', text: '#1E40AF' },
}

export const ITEM_ESTADO_CFG = {
  PROPUESTO:         { label: 'Propuesto',          bg: '#F3F4F6', text: '#374151' },
  APROBADO:          { label: 'Aprobado',           bg: '#D1FAE5', text: '#065F46' },
  AUTORIZADA_SALIDA: { label: 'Autorizada salida',  bg: '#DBEAFE', text: '#1E40AF' },
  EN_TRASLADO:       { label: 'En traslado',        bg: '#FFF3DC', text: '#9A5500' },
  RECIBIDA:          { label: 'Recibida en Tenjo',  bg: '#E0F2FE', text: '#0E7490' },
  EN_PROCESO:        { label: 'En proceso',         bg: '#FEF3C7', text: '#92400E' },
  PROCESADO:         { label: 'Procesado',          bg: '#D1FAE5', text: '#065F46' },
  NO_EJECUTADO:      { label: 'No ejecutado',       bg: '#FEE2E2', text: '#991B1B' },
  REPROGRAMADO:      { label: 'Reprogramado',       bg: '#FDE68A', text: '#92400E' },
  RETIRADO_DEL_LOTE: { label: 'Retirado del lote',  bg: '#F3F4F6', text: '#6B7280' },
}

export const LOTE_ESTADO_CFG = {
  PROPUESTO:    { label: 'Propuesto',    bg: '#F3F4F6', text: '#374151' },
  EN_REVISION:  { label: 'En revisión',  bg: '#FEF3C7', text: '#92400E' },
  CONFIRMADO:   { label: 'Confirmado',   bg: '#D1FAE5', text: '#065F46' },
  EN_EJECUCION: { label: 'En ejecución', bg: '#DBEAFE', text: '#1E40AF' },
  CERRADO:      { label: 'Cerrado',      bg: '#E5E7EB', text: '#374151' },
  CANCELADO:    { label: 'Cancelado',    bg: '#FEE2E2', text: '#991B1B' },
}
