// src/lib/servicios.js — helpers de edición de servicios (quitar ítems / ajustes de cobro)
import { db, dbIn } from '@/lib/supabase'
import { fmt } from '@/lib/utils'

// ── Trazabilidad del VALOR del servicio (migración 089) ────────────────────
// El valor se mueve desde varios lados y antes cada uno dejaba —cuando dejaba—
// una frase distinta en texto libre; el interruptor de comisión de Gestión no
// dejaba nada y el valor cambiaba en silencio. Estos dos helpers son el par:
// `trazaValor` para ESCRIBIR el antes/después en la novedad, y
// `trazaValorServicio` para LEER la cadena y mostrarla en la parte de pago.

export const MOTIVO_VALOR_LABEL = {
  PESO:         'Recálculo por peso',
  PLAN:         'Cambio de plan',
  ADICIONAL:    'Adicional agregado',
  ITEM_QUITADO: 'Ítem retirado',
  COMISION:     'Comisión de la veterinaria',
  CORRECCION:   'Corrección manual',
}

/**
 * Campos de traza para incrustar en un insert de `novedades_servicio`.
 * Devuelve `{}` cuando el valor no se movió: una novedad que no cambia plata no
 * ensucia la cadena (y el CHECK de la 089 exige antes/después en pareja).
 */
export function trazaValor(antes, despues, motivo) {
  const a = Number(antes)
  const d = Number(despues)
  if (!Number.isFinite(a) || !Number.isFinite(d) || Math.abs(d - a) < 0.5) return {}
  return { valor_antes: a, valor_despues: d, motivo_valor: motivo }
}

/**
 * Cadena de cambios de valor de un servicio, de más viejo a más nuevo.
 * Best-effort: ante error devuelve [] (nunca tumba la vista de pago).
 */
export async function trazaValorServicio(servicioId) {
  if (!servicioId) return []
  try {
    const { data, error } = await db.from('novedades_servicio')
      .select('id, descripcion, motivo_valor, valor_antes, valor_despues, created_at, personal:registrado_por(nombre, apellido)')
      .eq('servicio_id', servicioId)
      .not('valor_antes', 'is', null)
      // Desempate por id OBLIGATORIO: dos novedades pueden compartir created_at
      // al milisegundo (dos ofertas aceptadas en el mismo envío del portal), y
      // sin él el orden que devuelve PostgREST no es estable. La cadena se
      // renderizaría al revés y aparecerían dos saltos "sin registrar" que no
      // existen. Es el mismo orden con el que se armó el backfill.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (error) throw error
    return data || []
  } catch { return [] }
}

// Detecta qué servicios fueron RECATEGORIZADOS (cambio de plan o recálculo de
// precio por peso), leyendo novedades_servicio. Para mostrar una etiqueta de
// alerta en la mascota. Devuelve { [servicioId]: { plan, peso, detallePlan,
// detallePeso } }. Best-effort: ante error devuelve {} (no rompe la vista).
//   · plan → hay novedad CAMBIO_PLAN. Detalle = la nota "Plan cambiado: X → Y".
//   · peso → hay novedad RECATEGORIZACION_PESO (migración 075; solo la escriben
//     los recálculos NUEVOS — los históricos por peso no dejaron rastro).
export async function recategorizacionesPorServicio(servicioIds) {
  const ids = [...new Set((servicioIds || []).filter(Boolean))]
  if (!ids.length) return {}
  try {
    const [markers, planNotas] = await Promise.all([
      dbIn('novedades_servicio', 'servicio_id, tipo_novedad, descripcion, created_at', 'servicio_id', ids,
        q => q.in('tipo_novedad', ['CAMBIO_PLAN', 'RECATEGORIZACION_PESO']).order('created_at', { ascending: false })),
      dbIn('novedades_servicio', 'servicio_id, descripcion, created_at', 'servicio_id', ids,
        q => q.eq('tipo_novedad', 'NOTA').ilike('descripcion', 'Plan cambiado:%').order('created_at', { ascending: false })),
    ])
    const out = {}
    const rec = id => out[id] || (out[id] = { plan: false, peso: false, detallePlan: null, detallePeso: null, soloComision: false })
    for (const r of markers) {
      const e = rec(r.servicio_id)
      if (r.tipo_novedad === 'CAMBIO_PLAN') e.plan = true
      else if (r.tipo_novedad === 'RECATEGORIZACION_PESO') {
        // Las que solo movieron la COMISIÓN no recategorizaron nada: su texto
        // trae "comisión X → Y" y ninguna línea de valor. Se marcan aparte para
        // no decirle "recategorizado por peso" a un gato, cuya tarifa FELINO es
        // plana desde 1 kg (caso ORION, ago-2026). El criterio es por texto a
        // propósito: así también acierta con las novedades ya guardadas.
        const d = r.descripcion || ''
        const soloCom = /comisi/i.test(d) && !/valor/i.test(d)
        if (!e.peso) {
          // `markers` viene ordenado desc, así que el primero es el más reciente:
          // es el que se muestra en el tooltip.
          e.peso = true; e.detallePeso = d; e.soloComision = soloCom
        } else if (!soloCom) {
          // Si ALGUNA movió el precio, manda la etiqueta de peso: es la señal
          // fuerte y no puede quedar tapada por una recalculación de comisión
          // posterior.
          e.soloComision = false
        }
      }
    }
    for (const n of planNotas) {
      const e = rec(n.servicio_id)
      e.plan = true
      if (!e.detallePlan) e.detallePlan = n.descripcion   // la más reciente (viene ordenada desc)
    }
    return out
  } catch (_) {
    return {}
  }
}

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
    ...trazaValor(valorTotal, nuevoTotal, 'ITEM_QUITADO'),
  }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
  if (novErr) throw novErr

  return {
    nuevoTotal,
    nuevoEstadoPago,
    saldo: nuevoTotal - pagado,
    novedad: novInserted?.[0] || null,
  }
}
