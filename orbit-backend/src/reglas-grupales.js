// Reglas de negocio de Reportes Grupales (Eco-grupal / Cremación grupal).
// Canónicas server-side: el frontend solo muestra y deja revisar/confirmar.
// Decisiones David 2026-06-17: SLA 3 días hábiles desde fecha_ingreso,
// unidad por destinatario, canal Zolutium/GHL, cambio de plan = saca + alerta.

export const CONFIG_DEFAULTS_GRUPALES = {
  sla_dias_habiles:            3,
  dias_aviso_previo:           1,
  fecha_base:                  'fecha_ingreso',
  clasificacion_por:           'tipo_proceso',
  override_cremacion_codigos:  [],
  override_compostaje_codigos: [],
  canal_envio:                 'WHATSAPP_ZOLUTIUM',
  // Plantilla HSM (fuera de la ventana de 24h). Activar cuando Meta apruebe la plantilla.
  usar_plantilla:              false,
  plantilla_nombre:            '',
  plantilla_idioma:            'es',
  // Auto-armar lote ABIERTO (cron diario) con las mascotas que vencen hoy.
  auto_armar_lotes:            true,
  auto_armar_dias_antes:       0,   // 0 = solo las que vencen hoy; 1 = también las de mañana
}

/** Etiqueta legible del tipo de proceso (para la variable {{2}} de la plantilla) */
export function etiquetaProceso(tipoProceso) {
  return tipoProceso === 'COMPOSTAJE_GRUPAL' ? 'compostaje grupal (eco)' : 'cremación grupal'
}

export async function cargarConfigGrupales(client) {
  const cfg = { ...CONFIG_DEFAULTS_GRUPALES }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'REPORTES_GRUPALES'`
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

const TIPOS_GRUPALES = ['CREMACION_GRUPAL', 'COMPOSTAJE_GRUPAL']

/**
 * Clasificación efectiva eco vs cremación de un servicio.
 * Por defecto sigue planes.tipo_proceso; los overrides de config_operativa
 * permiten forzar planes presequiales (Bronce/Plata) sin tocar código.
 */
export function clasificarProceso(plan, config) {
  const cod = plan?.plan_codigo || plan?.codigo
  if ((config.override_compostaje_codigos || []).includes(cod)) return 'COMPOSTAJE_GRUPAL'
  if ((config.override_cremacion_codigos  || []).includes(cod)) return 'CREMACION_GRUPAL'
  return plan?.tipo_proceso || null
}

export function esGrupal(tipoProceso) {
  return TIPOS_GRUPALES.includes(tipoProceso)
}

/**
 * Valida un servicio del lote antes de poder enviarlo (CRITERIOS de aceptación
 * #2, #10, #11, "individual incluido por error"). Devuelve el detalle de cada
 * chequeo, si está completo, y un motivo de exclusión si no corresponde al lote.
 */
export function validarItem(svc, lote, config) {
  const claseEfectiva = clasificarProceso(svc, config)
  const tel = (svc.canal_destino || '').replace(/\D/g, '')

  const validacion = {
    servicio_valido:    svc.estado !== 'CANCELADO',
    nombre_mascota:     !!(svc.mascota_nombre && svc.mascota_nombre.trim()),
    nombre_propietario: !!(svc.propietario_nombre && svc.propietario_nombre.trim()),
    telefono:           tel.length >= 10,
    plan:               !!svc.plan_codigo,
    tipo_proceso:       esGrupal(claseEfectiva),
    fecha_base:         !!svc.fecha_base,
    no_cancelado:       svc.estado !== 'CANCELADO',
    corresponde_lote:   claseEfectiva === lote.tipo_proceso,  // no individual / no lote incorrecto
  }

  const datos_completos = Object.values(validacion).every(Boolean)

  let motivo_exclusion = null
  if (svc.estado === 'CANCELADO') {
    motivo_exclusion = 'Servicio cancelado'
  } else if (!esGrupal(claseEfectiva)) {
    motivo_exclusion = `Cambiado a proceso individual (${claseEfectiva || 'desconocido'})`
  } else if (claseEfectiva !== lote.tipo_proceso) {
    motivo_exclusion = `No corresponde al lote ${lote.tipo_proceso} (clasifica como ${claseEfectiva})`
  }

  return { validacion, datos_completos, motivo_exclusion, claseEfectiva }
}

/** Mensaje por defecto al propietario (la IA puede sobreescribirlo; humano confirma) */
export function mensajeReporte(item, lote) {
  const nombre  = (item.propietario_nombre || '').split(' ')[0] || ''
  const mascota = item.mascota_nombre || 'su mascota'
  const tipo = lote.tipo_proceso === 'COMPOSTAJE_GRUPAL' ? 'compostaje grupal' : 'cremación grupal'
  return `Hola ${nombre}, le compartimos el reporte de ${tipo} de *${mascota}*. ` +
    `Este documento certifica el proceso realizado con nuestros más altos estándares. — Camino al Cielo 🕊️`
}
