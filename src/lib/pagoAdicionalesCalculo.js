// src/lib/pagoAdicionalesCalculo.js — estado de pago de cada adicional, sin DB.
//
// REPORTES ORBIT 23-nov (Producción y Diseño / Preparación de entrega / Reporte de
// entrega del mensajero, urgencia ALTA): en un servicio referido por una veterinaria
// el saldo del servicio mezcla dos deudas distintas —
//   · lo que le falta pagar al PROPIETARIO (un Memopet que compró en el portal), y
//   · lo que la VETERINARIA le debe a Camino al Cielo (el plan que ella cobra y paga
//     después, y lo que el propietario ya le pagó a ella).
// La carta de entrega y la app del mensajero cobraban «los adicionales, topados al
// saldo», así que el saldo de la veterinaria hacía ver como pendiente un adicional
// que el propietario ya había pagado → cobro doble en la puerta.
//
// Aquí se separa, concepto por concepto. Nada se marca «pagado» a mano: igual que
// en la migración 174 (abono con concepto), el estado se DERIVA de la plata real,
// así no se queda viejo. Reglas, en orden:
//   1. Lo abonado a un ítem = Σ novedades PAGO_RECIBIDO atadas a él (migr. 174).
//      Eso ya es del propietario a Camino: no se vuelve a cobrar.
//   2. «Lo pagó en la veterinaria» (migr. 217, lo marca coordinación) o el ítem ya
//      existía cuando se emitió el recibo VETERINARIA (la clínica lo cobró dentro de
//      su recibo): el propietario no debe nada; esa plata la debe la veterinaria.
//   3. El resto del saldo del servicio se reparte entre los conceptos sin pagar, del
//      MÁS NUEVO al más viejo (los pagos sin concepto cubren lo primero que se vendió:
//      el adicional que se agregó al final es el que falta). Nunca se reparte más que
//      el saldo real, así que la suma de lo pendiente jamás pasa de lo que se debe.
//   4. Lo que sobra es saldo del plan: de la veterinaria si ella paga el plan (su
//      recibo, o descuento inmediato / facturación mensual / crédito acumulado), del
//      propietario si no.
//   5. Duda que la plata no resuelve: si la veterinaria paga el plan y hay pagos SIN
//      concepto fuera del recibo del técnico (abonos viejos de Finanzas, cobros en la
//      puerta antes de la migr. 174), uno de ellos pudo ser el adicional. No se adivina:
//      el concepto queda pendiente pero `dudoso` («confirmar») y el mensajero no lo
//      lleva marcado por defecto. Medido 23-nov: 5 de 33 servicios abiertos.
//   La regla 2 por recibo se puede negar: pago_en_veterinaria = false (migr. 217).
// Sin imports a propósito: lo prueban tests/pago-adicionales.test.mjs con node.

const num = v => Number(v) || 0

// Modalidades en las que la veterinaria le paga el plan a Camino (ver
// recibo_vet_descuento_inmediato_neto en memory/): CREDITO y FACTURACION pagan
// completo; DESCUENTO_INMEDIATO paga el neto cuando la comisión se descontó.
const MODALIDADES_VET_PAGA = ['FACTURACION_MENSUAL', 'CREDITO_ACUMULADO']

export const ESTADO_PAGO_ITEM = {
  PAGADO:             'PAGADO',
  PAGADO_VETERINARIA: 'PAGADO_VETERINARIA',
  PENDIENTE:          'PENDIENTE',
  PARCIAL:            'PARCIAL',
  SIN_COSTO:          'SIN_COSTO',
}

const nombreItem = it =>
  `${it?.recordatorios?.nombre || it?.nombre || 'Adicional'}${num(it?.cantidad) > 1 ? ` ×${it.cantidad}` : ''}`

/**
 * ¿La veterinaria le paga el plan a Camino? Manda el último recibo del técnico
 * (es cuando de verdad se sabe quién paga); sin recibo, la marca del servicio.
 */
export function veterinariaPagaPlan(svc, recibos = []) {
  if (!svc?.aliado_origen_id) return false
  const ultimo = [...recibos].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (ultimo?.tipo) return ultimo.tipo === 'VETERINARIA'
  return svc.comision_descontada === true || MODALIDADES_VET_PAGA.includes(svc.aliados?.modalidad_comision)
}

/**
 * @param {object} p
 * @param {object} p.svc         servicios: valor_total, valor_pagado, aliado_origen_id,
 *                               comision_descontada, aliados { nombre, modalidad_comision }
 * @param {Array}  p.adicionales servicio_recordatorios con origen ADICIONAL (sin REMOVIDO):
 *                               id, precio_cobrado, cantidad, created_at, estado,
 *                               pago_en_veterinaria, recordatorios { nombre, categoria }
 * @param {object} p.abonos      { [servicio_recordatorio_id]: Σ PAGO_RECIBIDO atado }
 * @param {Array}  p.recibos     recibos_tecnico del servicio: tipo, created_at
 * @param {object} p.plantas     { extras: planta_adicionales[], eleccion: planta_elecciones }
 */
export function calcularPagoServicio({ svc, adicionales = [], abonos = {}, recibos = [], plantas = {} } = {}) {
  const total  = num(svc?.valor_total)
  const pagado = num(svc?.valor_pagado)
  const saldo  = Math.max(0, total - pagado)
  const esVet  = !!svc?.aliado_origen_id
  const vetPagaPlan = veterinariaPagaPlan(svc, recibos)
  const reciboVet = recibos
    .filter(r => r.tipo === 'VETERINARIA' && r.created_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null

  const conceptos = []
  for (const it of adicionales) {
    if (!it || it.origen === 'REMOVIDO' || it.estado === 'NA') continue
    const precio  = num(it.precio_cobrado)
    const abonado = Math.min(precio, num(abonos[it.id]))
    // pago_en_veterinaria: true = lo pagó en la vet · false = coordinación dijo que NO
    // (anula la regla del recibo) · null/undefined = sin dato.
    const enReciboVet = esVet && !!reciboVet && !!it.created_at && it.pago_en_veterinaria !== false
      && String(it.created_at) <= String(reciboVet.created_at)
    conceptos.push({
      key: it.id, itemId: it.id, tipo: 'ADICIONAL', nombre: nombreItem(it),
      categoria: it.recordatorios?.categoria || null, estadoItem: it.estado || null,
      precio, abonado, fecha: it.created_at || '',
      enVeterinaria: it.pago_en_veterinaria === true || enReciboVet,
      motivoVeterinaria: it.pago_en_veterinaria === true ? 'MARCADO' : enReciboVet ? 'RECIBO_VET' : null,
      negadoVeterinaria: it.pago_en_veterinaria === false,
    })
  }
  for (const p of plantas?.extras || []) {
    conceptos.push({
      key: `planta:${p.id || p.nombre}`, itemId: null, tipo: 'PLANTA',
      nombre: `Planta adicional: ${p.nombre}${num(p.cantidad) > 1 ? ` ×${p.cantidad}` : ''}`,
      precio: num(p.total), abonado: 0, fecha: p.created_at || '', enVeterinaria: false,
    })
  }
  if (plantas?.eleccion?.restos_calcicos) {
    conceptos.push({
      key: 'restos', itemId: null, tipo: 'RESTOS', nombre: 'Restos cálcicos',
      precio: num(plantas.eleccion.restos_calcicos_valor), abonado: 0,
      fecha: plantas.eleccion.fecha_eleccion || plantas.eleccion.created_at || '', enVeterinaria: false,
    })
  }

  // 2. Lo que el propietario ya le pagó a la veterinaria: lo debe ella.
  const vetDebeItems = conceptos.filter(c => c.enVeterinaria && c.precio > 0)
    .reduce((s, c) => s + (c.precio - c.abonado), 0)
  const vetItems  = Math.min(saldo, vetDebeItems)
  let porRepartir = saldo - vetItems

  // 3. Del más nuevo al más viejo.
  const orden = conceptos
    .filter(c => !c.enVeterinaria && c.precio > 0)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(a.key).localeCompare(String(b.key)))
  const pendientes = {}
  for (const c of orden) {
    const falta = Math.max(0, c.precio - c.abonado)
    const toca  = Math.min(falta, porRepartir)
    porRepartir -= toca
    pendientes[c.key] = toca
  }

  for (const c of conceptos) {
    if (c.precio <= 0)       { c.estado = ESTADO_PAGO_ITEM.SIN_COSTO; c.pendiente = 0; continue }
    if (c.enVeterinaria)     { c.estado = ESTADO_PAGO_ITEM.PAGADO_VETERINARIA; c.pendiente = 0; continue }
    c.pendiente = pendientes[c.key] || 0
    c.estado = c.pendiente <= 0 ? ESTADO_PAGO_ITEM.PAGADO
      : c.pendiente < c.precio ? ESTADO_PAGO_ITEM.PARCIAL
      : ESTADO_PAGO_ITEM.PENDIENTE
  }

  // 5. Pagos sin concepto fuera del recibo del técnico, con la vet pagando el plan.
  const abonadoAtado = conceptos.reduce((s, c) => s + c.abonado, 0)
  const pagoRecibos  = recibos.reduce((s, r) => s + num(r.pago_aplicado), 0)
  const pagosSinConcepto = Math.max(0, pagado - pagoRecibos - abonadoAtado)
  const hayDuda = vetPagaPlan && pagosSinConcepto > 0
  for (const c of conceptos) c.dudoso = hayDuda && c.pendiente > 0

  // 4. Lo que sobra es el plan.
  const saldoPlan = porRepartir
  const pendienteConceptos = conceptos.reduce((s, c) => s + c.pendiente, 0)
  const porItem = {}
  for (const c of conceptos) if (c.itemId) porItem[c.itemId] = c

  return {
    saldo,
    esVet,
    aliadoNombre: svc?.aliados?.nombre || null,
    planLoPaga: vetPagaPlan ? 'VETERINARIA' : 'PROPIETARIO',
    saldoPlan,
    pendienteConceptos,
    pagosSinConcepto,
    // Lo que se le puede cobrar al propietario (en la puerta o por Cartera).
    pendientePropietario: pendienteConceptos + (vetPagaPlan ? 0 : saldoPlan),
    // Lo que la veterinaria le debe a Camino: NUNCA se le cobra al propietario.
    saldoVeterinaria: vetItems + (vetPagaPlan ? saldoPlan : 0),
    conceptos,
    porItem,
  }
}

/** Texto y colores del chip de pago de un concepto (o null si no aplica). */
export function etiquetaPagoConcepto(c, fmt = v => `$${Math.round(v).toLocaleString('es-CO')}`) {
  if (!c) return null
  switch (c.estado) {
    case ESTADO_PAGO_ITEM.PAGADO:
      return { texto: 'Pagado', bg: '#DCFCE7', color: '#166534', borde: '#86EFAC' }
    case ESTADO_PAGO_ITEM.PAGADO_VETERINARIA:
      return {
        texto: c.motivoVeterinaria === 'RECIBO_VET' ? 'Pagado · en el recibo de la veterinaria' : 'Pagado a la veterinaria',
        bg: '#CCFBF1', color: '#115E59', borde: '#5EEAD4',
      }
    case ESTADO_PAGO_ITEM.PARCIAL:
      return { texto: `Por cobrar ${fmt(c.pendiente)} de ${fmt(c.precio)}${c.dudoso ? ' · confirmar' : ''}`, bg: '#FEF3C7', color: '#92400E', borde: '#FCD34D' }
    case ESTADO_PAGO_ITEM.PENDIENTE:
      return { texto: `Por cobrar ${fmt(c.pendiente)}${c.dudoso ? ' · confirmar si ya lo pagó' : ''}`, bg: '#FEF3C7', color: '#92400E', borde: '#FCD34D' }
    case ESTADO_PAGO_ITEM.SIN_COSTO:
      return { texto: 'Sin costo', bg: '#F3F4F6', color: '#4B5563', borde: '#E5E7EB' }
    default: return null
  }
}
