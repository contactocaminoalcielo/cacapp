// src/lib/servicios.js — helpers de edición de servicios (quitar ítems / ajustes de cobro)
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'

// Recalcula estado_pago de forma consistente con el resto del sistema
// (misma fórmula que usa Gestión › Historial).
export function calcularEstadoPago(total, pagado) {
  const t = total || 0
  const p = pagado || 0
  if (t > 0 && p >= t) return 'COMPLETO'
  if (p > 0) return 'PARCIAL'
  return 'PENDIENTE'
}

// Monto a descontar sugerido para un ítem (editable por el coordinador).
export function precioSugeridoItem(item) {
  if (!item) return 0
  if (item.precio_cobrado != null) return item.precio_cobrado
  return item.recordatorios?.precio_base || 0
}

/**
 * Quita un ítem de un servicio (o aplica un ajuste manual a la baja) y reduce
 * el valor a cobrar. Deja traza en novedades_servicio.
 *
 * - Si `item` viene, se marca su fila servicio_recordatorios como REMOVIDO
 *   (valor ya soportado y filtrado en todo el sistema).
 * - Si no viene `item` (ajuste manual de un adicional registrado al inicio que
 *   no es fila), solo se baja el valor con su traza.
 *
 * `valor_total` es el dinero autoritativo del cuadre; bajarlo reduce
 * automáticamente "a cobrar/a recoger" al regenerar el cuadre. `valor_plan` y
 * `valor_adicionales` son desglose informativo y se ajustan para que cuadre.
 * `comision_aliado` NO se recalcula (fuera de alcance).
 *
 * @returns { nuevoTotal, nuevoEstadoPago, saldo, novedad }
 */
export async function quitarItemServicio({ servicio, item = null, monto, motivo = '', personalId = null }) {
  const descuento = Math.max(0, parseFloat(monto) || 0)

  // Leer los valores autoritativos en DB (no confiar en el estado local del
  // caller para no pisar valor_plan/valor_adicionales con datos incompletos).
  const { data: cur, error: curErr } = await db.from('servicios')
    .select('valor_total, valor_pagado, valor_plan, valor_adicionales')
    .eq('id', servicio.id).maybeSingle()
  if (curErr) throw curErr

  const valorTotal = cur?.valor_total || 0
  const pagado     = cur?.valor_pagado || 0
  const nuevoTotal = Math.max(0, valorTotal - descuento)
  const nuevoEstadoPago = calcularEstadoPago(nuevoTotal, pagado)

  // 1. Marcar el ítem como REMOVIDO (si es una fila real)
  if (item?.id) {
    const { error } = await db.from('servicio_recordatorios')
      .update({ origen: 'REMOVIDO' })
      .eq('id', item.id)
    if (error) throw error
  }

  // 2. Actualizar el servicio (valor + desglose + estado de pago)
  const upd = { valor_total: nuevoTotal, estado_pago: nuevoEstadoPago }
  if (descuento > 0) {
    // Ítem del plan → baja valor_plan; adicional o ajuste manual → baja valor_adicionales
    if (item && item.origen !== 'ADICIONAL') {
      if (cur?.valor_plan != null) upd.valor_plan = Math.max(0, cur.valor_plan - descuento)
    } else if (cur?.valor_adicionales != null) {
      upd.valor_adicionales = Math.max(0, cur.valor_adicionales - descuento)
    }
  }
  const { error: svErr } = await db.from('servicios').update(upd).eq('id', servicio.id)
  if (svErr) throw svErr

  // 3. Traza en el historial del servicio
  const nombre = item?.recordatorios?.nombre || 'Adicional no listado'
  const descripcion = (item
    ? `Ítem retirado: ${nombre}.`
    : `Ajuste por adicional no tomado.`)
    + (descuento > 0 ? ` Se descuenta ${fmt(descuento)} del valor a cobrar.` : ' Sin cambio de valor.')
    + (motivo.trim() ? ` Motivo: ${motivo.trim()}.` : '')

  const { data: novInserted, error: novErr } = await db.from('novedades_servicio').insert({
    servicio_id:    servicio.id,
    tipo_novedad:   'NOTA',
    descripcion,
    valor_ajuste:   descuento > 0 ? -descuento : null,
    registrado_por: personalId,
  }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
  if (novErr) throw novErr

  return {
    nuevoTotal,
    nuevoEstadoPago,
    saldo: nuevoTotal - pagado,
    novedad: novInserted?.[0] || null,
  }
}
