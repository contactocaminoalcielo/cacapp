// Checklists por variante de proceso individual — validación de cierre.
// Reglas estructurales en código (no editables); campos específicos por
// variante en config_operativa.checklist_plantillas (editables).

/** Determina la variante a partir del plan y el tipo de acompañamiento */
export function varianteProceso(codigoPlan, tipoAcompanamiento) {
  if (codigoPlan === 'EXCLUSIVO_PRESENCIAL' || tipoAcompanamiento === 'PRESENCIAL')
    return 'EXCLUSIVO_PRESENCIAL'
  if (codigoPlan === 'EXCLUSIVO_VIDEOLLAMADA' || tipoAcompanamiento === 'VIDEOLLAMADA')
    return 'EXCLUSIVO_VIDEOLLAMADA'
  if (['COMPETS_EVIDENCIA', 'COMPETS_PRESENCIAL'].includes(codigoPlan) || tipoAcompanamiento === 'EVIDENCIA')
    return 'COMPETS_EVIDENCIA'
  return 'INDIVIDUAL_ESTANDAR'
}

/**
 * Valida un item PROCESADO antes del cierre del lote.
 * @param item     fila de lotes_tenjo_items (checklist jsonb, evidencia_urls, ...)
 * @param plan     { codigo, tipo_acompanamiento }
 * @param config   config TENJO (incluye checklist_plantillas)
 * @returns string[] — faltantes que bloquean el cierre (vacío = ok)
 */
export function validarItemParaCierre(item, plan, config) {
  const faltantes = []
  const variante = varianteProceso(plan?.codigo, plan?.tipo_acompanamiento)
  const checklist = item.checklist || {}

  // ── Reglas estructurales (siempre) ──
  if (!item.responsable_proceso_id) faltantes.push('Sin responsable de proceso asignado')
  if (!item.fecha_inicio_proceso)   faltantes.push('Sin fecha/hora de inicio de proceso')
  if (!item.fecha_fin_proceso)      faltantes.push('Sin fecha/hora de finalización')
  // La evidencia (foto) es RECOMENDADA pero NO bloquea el cierre (decisión 2026-06-24):
  // se puede cargar en el Checklist cuando se tenga; no impide cerrar procesos ya hechos.

  if (['EXCLUSIVO_PRESENCIAL', 'EXCLUSIVO_VIDEOLLAMADA'].includes(variante)
      && item.confirmacion_cliente !== true) {
    faltantes.push('Sin confirmación del cliente registrada')
  }

  // ── Campos de la plantilla de la variante ──
  const plantillas = config.checklist_plantillas || {}
  for (const campo of (plantillas[variante] || [])) {
    if (!campo.obligatorio) continue
    const v = checklist[campo.campo]
    const vacio = campo.tipo === 'bool' ? v !== true : !(typeof v === 'string' && v.trim())
    if (vacio) faltantes.push(`Checklist: falta "${campo.label}"`)
  }

  return faltantes
}
