import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularPagoServicio, veterinariaPagaPlan, etiquetaPagoConcepto } from '../src/lib/pagoAdicionalesCalculo.js'

// Casos con la forma de producción (23-nov-2026).
const VET = { aliado_origen_id: 'vet-1', comision_descontada: true, aliados: { nombre: 'Clínica X', modalidad_comision: 'DESCUENTO_INMEDIATO' } }
const memopet = (extra = {}) => ({ id: 'm1', origen: 'ADICIONAL', estado: 'LISTO', precio_cobrado: 26000, created_at: '2026-11-10T10:00:00Z', recordatorios: { nombre: 'Memopet' }, ...extra })
const porta   = (extra = {}) => ({ id: 'p1', origen: 'ADICIONAL', estado: 'LISTO', precio_cobrado: 35000, created_at: '2026-11-05T10:00:00Z', recordatorios: { nombre: 'Portarretrato' }, ...extra })
const reciboVet = { tipo: 'VETERINARIA', created_at: '2026-11-01T15:00:00Z' }

test('la vet ya pagó el plan: el Memopet del portal es lo único que debe el propietario', () => {
  // 115.100 de total, la vet pagó 89.100 (plan neto); falta el Memopet.
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 115100, valor_pagado: 89100 }, adicionales: [memopet()], recibos: [reciboVet] })
  assert.equal(r.porItem.m1.estado, 'PENDIENTE')
  assert.equal(r.pendientePropietario, 26000)
  assert.equal(r.saldoVeterinaria, 0)
})

test('la vet NO ha pagado el plan: su saldo no se le cobra al propietario', () => {
  // 262.750 = plan neto 201.750 + Memopet + Portarretrato, nada pagado.
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 262750, valor_pagado: 0 }, adicionales: [memopet(), porta()], recibos: [reciboVet] })
  assert.equal(r.pendientePropietario, 61000)        // solo los dos adicionales
  assert.equal(r.saldoVeterinaria, 201750)           // el plan es de la vet
  assert.equal(r.saldoPlan, 201750)
})

test('el propietario le pagó el adicional a la veterinaria: queda pagado y lo debe la vet', () => {
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 115100, valor_pagado: 89100 }, adicionales: [memopet({ pago_en_veterinaria: true })], recibos: [reciboVet] })
  assert.equal(r.porItem.m1.estado, 'PAGADO_VETERINARIA')
  assert.equal(r.pendientePropietario, 0)            // nada que cobrar en la puerta
  assert.equal(r.saldoVeterinaria, 26000)
  assert.equal(etiquetaPagoConcepto(r.porItem.m1).texto, 'Pagado a la veterinaria')
})

test('un adicional que ya existía al emitir el recibo VET lo cobró la clínica', () => {
  const temprano = memopet({ created_at: '2026-10-30T09:00:00Z' })
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 215100, valor_pagado: 0 }, adicionales: [temprano], recibos: [reciboVet] })
  assert.equal(r.porItem.m1.estado, 'PAGADO_VETERINARIA')
  assert.equal(r.porItem.m1.motivoVeterinaria, 'RECIBO_VET')
  assert.equal(r.pendientePropietario, 0)
  assert.equal(r.saldoVeterinaria, 215100)
})

test('abono atado al ítem (migr. 174): pagado aunque la vet deba el plan', () => {
  // Kanban «el cliente ya pagó»: valor_pagado subió 26.000 y la novedad quedó atada.
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 227750, valor_pagado: 26000 }, adicionales: [memopet()], abonos: { m1: 26000 }, recibos: [reciboVet] })
  assert.equal(r.porItem.m1.estado, 'PAGADO')
  assert.equal(r.pendientePropietario, 0)
  assert.equal(r.saldoVeterinaria, 201750)
})

test('los pagos sin concepto cubren lo primero que se vendió: falta el último adicional', () => {
  // Particular: plan pagado + Portarretrato (5-nov) pagado como «saldo general»; el Memopet (10-nov) no.
  const r = calcularPagoServicio({ svc: { valor_total: 230000, valor_pagado: 204000 }, adicionales: [memopet(), porta()] })
  assert.equal(r.porItem.m1.estado, 'PENDIENTE')
  assert.equal(r.porItem.p1.estado, 'PAGADO')
  assert.equal(r.pendientePropietario, 26000)
})

test('nunca se cobra más que el saldo real', () => {
  const r = calcularPagoServicio({ svc: { valor_total: 230000, valor_pagado: 220000 }, adicionales: [memopet(), porta()] })
  assert.equal(r.porItem.m1.estado, 'PARCIAL')
  assert.equal(r.porItem.m1.pendiente, 10000)
  assert.equal(r.porItem.p1.estado, 'PAGADO')
  assert.equal(r.pendientePropietario, 10000)
})

test('particular con saldo del plan: el plan también es del propietario', () => {
  const r = calcularPagoServicio({ svc: { valor_total: 195000, valor_pagado: 100000 }, adicionales: [memopet()] })
  assert.equal(r.planLoPaga, 'PROPIETARIO')
  assert.equal(r.pendientePropietario, 95000)
  assert.equal(r.saldoVeterinaria, 0)
})

test('servicio pagado completo: todo pagado, nada pendiente', () => {
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 242750, valor_pagado: 289000 }, adicionales: [memopet()], recibos: [reciboVet] })
  assert.equal(r.porItem.m1.estado, 'PAGADO')
  assert.equal(r.pendientePropietario, 0)
  assert.equal(r.saldoVeterinaria, 0)
})

test('plantas extra y restos cálcicos también son conceptos', () => {
  const r = calcularPagoServicio({
    svc: { valor_total: 300000, valor_pagado: 240000 },
    plantas: { extras: [{ id: 'x', nombre: 'Helecho', cantidad: 2, total: 40000, created_at: '2026-11-20T00:00:00Z' }], eleccion: { restos_calcicos: true, restos_calcicos_valor: 20000, fecha_eleccion: '2026-11-19T00:00:00Z' } },
  })
  const planta = r.conceptos.find(c => c.tipo === 'PLANTA')
  const restos = r.conceptos.find(c => c.tipo === 'RESTOS')
  assert.equal(planta.pendiente, 40000)
  assert.equal(restos.pendiente, 20000)
  assert.equal(r.pendientePropietario, 60000)
})

test('VIP o cortesía en cero: sin costo', () => {
  const r = calcularPagoServicio({ svc: { valor_total: 100000, valor_pagado: 100000 }, adicionales: [memopet({ precio_cobrado: 0 })] })
  assert.equal(r.porItem.m1.estado, 'SIN_COSTO')
})

test('quién paga el plan: manda el último recibo', () => {
  assert.equal(veterinariaPagaPlan({ aliado_origen_id: 'v', comision_descontada: false }, [{ tipo: 'VETERINARIA', created_at: '1' }]), true)
  assert.equal(veterinariaPagaPlan({ aliado_origen_id: 'v', comision_descontada: true }, [{ tipo: 'CLIENTE', created_at: '1' }]), false)
  assert.equal(veterinariaPagaPlan({ aliado_origen_id: 'v', comision_descontada: false, aliados: { modalidad_comision: 'FACTURACION_MENSUAL' } }), true)
  assert.equal(veterinariaPagaPlan({ aliado_origen_id: 'v', comision_descontada: false, aliados: { modalidad_comision: 'DESCUENTO_INMEDIATO' } }), false)
  assert.equal(veterinariaPagaPlan({ aliado_origen_id: null, comision_descontada: true }), false)
})

test('los ítems REMOVIDO o NA no cuentan', () => {
  const r = calcularPagoServicio({ svc: { valor_total: 26000, valor_pagado: 0 }, adicionales: [memopet({ origen: 'REMOVIDO' }), porta({ estado: 'NA' })] })
  assert.equal(r.conceptos.length, 0)
  assert.equal(r.pendientePropietario, 26000)        // queda como saldo del plan
})

test('pago sin concepto fuera del recibo con la vet pagando el plan: pendiente pero «confirmar»', () => {
  // Kion-like: recibo VET aplicó 407.200, pero valor_pagado es 447.200 → 40.000 sin concepto.
  const r = calcularPagoServicio({
    svc: { ...VET, valor_total: 473200, valor_pagado: 447200 },
    adicionales: [memopet()],
    recibos: [{ ...reciboVet, pago_aplicado: 407200 }],
  })
  assert.equal(r.pagosSinConcepto, 40000)
  assert.equal(r.porItem.m1.estado, 'PENDIENTE')
  assert.equal(r.porItem.m1.dudoso, true)
  assert.match(etiquetaPagoConcepto(r.porItem.m1).texto, /confirmar/)
})

test('pagos que vienen del recibo del técnico no generan duda', () => {
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 115100, valor_pagado: 89100 }, adicionales: [memopet()], recibos: [{ ...reciboVet, pago_aplicado: 89100 }] })
  assert.equal(r.porItem.m1.dudoso, false)
})

test('coordinación niega la regla del recibo: vuelve a ser del propietario', () => {
  const temprano = memopet({ created_at: '2026-10-30T09:00:00Z', pago_en_veterinaria: false })
  const r = calcularPagoServicio({ svc: { ...VET, valor_total: 215100, valor_pagado: 189100 }, adicionales: [temprano], recibos: [{ ...reciboVet, pago_aplicado: 189100 }] })
  assert.equal(r.porItem.m1.estado, 'PENDIENTE')
  assert.equal(r.porItem.m1.negadoVeterinaria, true)
  assert.equal(r.pendientePropietario, 26000)
})
