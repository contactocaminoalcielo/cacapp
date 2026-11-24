// src/lib/pagoAdicionales.js — carga desde la DB lo que necesita el cálculo del estado
// de pago de cada adicional (pagoAdicionalesCalculo.js) y escribe la única marca
// manual: «el propietario ya lo pagó en la veterinaria» (migr. 217).
//
// Un solo cargador para los cuatro sitios que muestran o cobran adicionales —el
// tablero de Producción, Preparar entrega, la carta de entrega y la app del
// mensajero— para que los cuatro digan lo mismo. Se lee siempre de la DB: un snapshot
// viejo de `valor_pagado` ya escondió plata (ver estado_pago_marca_vieja en memory/).
import { db, dbIn } from '@/lib/supabase'
import { calcularPagoServicio } from '@/lib/pagoAdicionalesCalculo'

export { calcularPagoServicio, etiquetaPagoConcepto, ESTADO_PAGO_ITEM } from '@/lib/pagoAdicionalesCalculo'

const COLS_SVC  = 'id, valor_total, valor_pagado, aliado_origen_id, comision_descontada, aliados:aliado_origen_id ( nombre, modalidad_comision )'
const COLS_ITEM = 'id, servicio_id, origen, estado, cantidad, precio_cobrado, created_at, pago_en_veterinaria, recordatorios ( nombre, categoria )'

// 🪤 Si el frontend llega antes que la migración 217, la columna no existe: se lee
// sin ella (nadie la marcó todavía) en vez de dejar sin estado de pago la pantalla.
async function itemsAdicionales(ids) {
  const tweak = q => q.eq('origen', 'ADICIONAL')
  try {
    return await dbIn('servicio_recordatorios', COLS_ITEM, 'servicio_id', ids, tweak)
  } catch (e) {
    if (!/pago_en_veterinaria/.test(e.message)) throw e
    return dbIn('servicio_recordatorios', COLS_ITEM.replace('pago_en_veterinaria, ', ''), 'servicio_id', ids, tweak)
  }
}

/**
 * Estado de pago de varios servicios a la vez.
 * @returns {Promise<Record<string, ReturnType<typeof calcularPagoServicio>>>} por servicio_id
 */
export async function cargarPagoServicios(servicioIds) {
  const ids = [...new Set((servicioIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const [svcs, items, abonosRows, recibos, extras, elecciones] = await Promise.all([
    dbIn('servicios', COLS_SVC, 'id', ids),
    itemsAdicionales(ids),
    dbIn('novedades_servicio', 'servicio_id, servicio_recordatorio_id, valor_ajuste', 'servicio_id', ids,
      q => q.eq('tipo_novedad', 'PAGO_RECIBIDO').not('servicio_recordatorio_id', 'is', null)),
    dbIn('recibos_tecnico', 'servicio_id, tipo, created_at, estado, pago_aplicado', 'servicio_id', ids),
    dbIn('planta_adicionales', 'id, servicio_id, nombre, cantidad, total, created_at', 'servicio_id', ids),
    dbIn('planta_elecciones', 'servicio_id, restos_calcicos, restos_calcicos_valor, fecha_eleccion, created_at', 'servicio_id', ids),
  ])
  const agrupar = filas => filas.reduce((m, f) => ((m[f.servicio_id] ||= []).push(f), m), {})
  const itemsPor = agrupar(items), recibosPor = agrupar(recibos.filter(r => r.estado !== 'ANULADO'))
  const extrasPor = agrupar(extras)
  const eleccionPor = Object.fromEntries(elecciones.map(e => [e.servicio_id, e]))
  const abonos = {}
  for (const a of abonosRows)
    abonos[a.servicio_recordatorio_id] = (abonos[a.servicio_recordatorio_id] || 0) + (Number(a.valor_ajuste) || 0)

  const out = {}
  for (const svc of svcs) {
    out[svc.id] = calcularPagoServicio({
      svc,
      adicionales: itemsPor[svc.id] || [],
      abonos,
      recibos: recibosPor[svc.id] || [],
      plantas: { extras: extrasPor[svc.id] || [], eleccion: eleccionPor[svc.id] || null },
    })
  }
  return out
}

/** Estado de pago de un servicio (o null si no existe). */
export async function cargarPagoServicio(servicioId) {
  if (!servicioId) return null
  return (await cargarPagoServicios([servicioId]))[servicioId] || null
}

/**
 * Marca (o desmarca) que el propietario pagó un adicional en la veterinaria.
 * No mueve plata: ese valor sigue en el saldo del servicio, ahora como deuda de la
 * veterinaria. Deja una novedad para que se sepa quién lo dijo y cuándo.
 */
// `pagado` false = coordinación dice que NO lo pagó en la vet (también anula la regla
// «ya estaba en el recibo de la veterinaria»). Se guarda quién y cuándo en ambos casos.
export async function marcarPagoEnVeterinaria({ servicioId, item, pagado, personalId = null, aliadoNombre = null }) {
  const { error } = await db.from('servicio_recordatorios').update({
    pago_en_veterinaria:     !!pagado,
    pago_en_veterinaria_en:  new Date().toISOString(),
    pago_en_veterinaria_por: personalId,
  }).eq('id', item.id).eq('origen', 'ADICIONAL')
  if (error) {
    if (/pago_en_veterinaria/.test(error.message))
      throw new Error('Falta aplicar la migración 217 en la base de datos.')
    throw error
  }
  const nombre = item.nombre || item.recordatorios?.nombre || 'Adicional'
  const vet = aliadoNombre ? ` (${aliadoNombre})` : ''
  await db.from('novedades_servicio').insert({
    servicio_id:    servicioId,
    tipo_novedad:   'NOTA',
    descripcion:    pagado
      ? `${nombre}: el propietario ya lo pagó en la veterinaria${vet}. No se le cobra en la entrega; queda en el saldo de la veterinaria con Camino al Cielo.`
      : `${nombre}: coordinación indicó que el propietario NO lo pagó en la veterinaria. Cuenta como pendiente del propietario si el servicio tiene saldo.`,
    registrado_por: personalId,
  }).then(() => {}, () => {})   // la marca ya quedó; la novedad es la traza
}
