import test from 'node:test'
import assert from 'node:assert/strict'
import { desgloseReciboTecnico } from '../src/lib/reciboDesglose.js'

// Los números salen de producción (16-sep-2026):
//   KIRA  → servicio $399.000 con eutanasia de $230.000; el doctor la cobró y
//           el técnico recogió $169.000. El cuadre le marcaba $230.000 de
//           faltante y la cartera perseguía a una familia que ya había pagado.
const KIRA = { precioOriginal: 399000, saldoPendiente: 399000, valorEutanasia: 230000 }

test('sin eutanasia ni adicionales desmarcados el recibo no cambia', () => {
  const d = desgloseReciboTecnico({ precioOriginal: 509000, saldoPendiente: 509000 })
  assert.equal(d.precioServicio, 509000)
  assert.equal(d.valorRecibo,    509000)   // lo que se guarda en recibos_tecnico
  assert.equal(d.montoCliente,   509000)
  assert.equal(d.fueraEutanasia, 0)
})

test('la cobra el técnico: el servicio vale lo mismo y él la recoge', () => {
  const d = desgloseReciboTecnico({ ...KIRA, eutanasiaCobro: 'TECNICO' })
  assert.equal(d.precioServicio, 399000)
  assert.equal(d.valorRecibo,    399000)
  assert.equal(d.montoCliente,   399000)
})

test('la cobró el doctor: sale del servicio, del recibo y del prellenado', () => {
  const d = desgloseReciboTecnico({ ...KIRA, eutanasiaCobro: 'VETERINARIO' })
  assert.equal(d.fueraEutanasia, 230000)
  assert.equal(d.precioServicio, 169000)  // lo que de verdad vale el servicio
  assert.equal(d.valorRecibo,    169000)  // ⇒ el cuadre ya no le marca faltante
  assert.equal(d.montoCliente,   169000)  // ⇒ el técnico no lo cobra dos veces
})

test('si el total NO incluye la eutanasia, no hay nada que restar', () => {
  // KIRA CRISTANCHO: valor_total $169.000 y eutanasia $200.000 → el backfill
  // dejó valor_eutanasia en 0 a propósito. Restarla dejaría el servicio en
  // negativo y le regalaría plata a la familia.
  const d = desgloseReciboTecnico({
    precioOriginal: 169000, saldoPendiente: 169000,
    valorEutanasia: 0, eutanasiaCobro: 'VETERINARIO',
  })
  assert.equal(d.fueraEutanasia, 0)
  assert.equal(d.precioServicio, 169000)
  assert.equal(d.valorRecibo,    169000)
})

test('adicional desmarcado: baja el recibo pero NO el valor del servicio', () => {
  // Esta es la frontera de la migración 143: lo desmarcado sigue siendo plata de
  // Camino y se persigue en la cartera; lo único que no puede es cobrársele al
  // técnico como faltante.
  const d = desgloseReciboTecnico({
    precioOriginal: 509000, saldoPendiente: 509000, adicionalesExcluidos: 60000,
  })
  assert.equal(d.precioServicio, 509000)  // el servicio sigue valiendo lo mismo
  assert.equal(d.valorRecibo,    449000)  // pero a él le tocaba cobrar esto
  assert.equal(d.montoCliente,   449000)
})

test('los dos a la vez: eutanasia del doctor y adicional del propietario', () => {
  const d = desgloseReciboTecnico({
    ...KIRA, eutanasiaCobro: 'VETERINARIO', adicionalesExcluidos: 60000,
  })
  assert.equal(d.precioServicio, 169000)
  assert.equal(d.valorRecibo,    109000)
  assert.equal(d.montoCliente,   109000)
})

test('veterinaria con descuento inmediato: paga el neto, ya sin la eutanasia', () => {
  const d = desgloseReciboTecnico({
    precioOriginal: 399000, saldoPendiente: 399000,
    valorEutanasia: 230000, eutanasiaCobro: 'VETERINARIO',
    comisionMonto: 42250, descuentoInmediatoVet: true, comisionFueDescontada: true,
    adicionalesExcluidos: 20000,
  })
  assert.equal(d.precioServicio, 169000)
  assert.equal(d.valorVet,       126750)  // 169.000 − comisión
  assert.equal(d.valorVetCobrar, 106750)  // …menos el adicional que paga la familia
  // El valor del RECIBO no descuenta la comisión: la vet puede pagar el bruto y
  // eso sigue estando dentro de la banda aceptable del cuadre.
  assert.equal(d.valorRecibo,    149000)
})

test('facturación mensual: el técnico no recoge un peso', () => {
  const d = desgloseReciboTecnico({
    precioOriginal: 399000, saldoPendiente: 399000, aliadoFactMensual: true,
  })
  assert.equal(d.montoCliente, 0)
  assert.equal(d.valorRecibo,  399000)
})

test('con abonos previos el prellenado cobra el saldo, no el total', () => {
  const d = desgloseReciboTecnico({
    precioOriginal: 399000, saldoPendiente: 230000, valorEutanasia: 230000,
  })
  assert.equal(d.montoCliente, 230000)
  // …y si además la cobró el doctor, el saldo no puede quedar negativo.
  const e = desgloseReciboTecnico({
    precioOriginal: 399000, saldoPendiente: 100000,
    valorEutanasia: 230000, eutanasiaCobro: 'VETERINARIO',
  })
  assert.equal(e.montoCliente, 0)
})

test('valores sucios (texto, null, negativos) no rompen la cuenta', () => {
  const d = desgloseReciboTecnico({
    precioOriginal: '399000', saldoPendiente: null,
    valorEutanasia: '230000', eutanasiaCobro: 'VETERINARIO',
    adicionalesExcluidos: -5000,
  })
  assert.equal(d.precioServicio, 169000)
  assert.equal(d.valorRecibo,    169000)
  assert.equal(d.montoCliente,   0)
  assert.deepEqual(desgloseReciboTecnico(), {
    fueraEutanasia: 0, precioServicio: 0, valorRecibo: 0,
    valorVet: 0, valorVetCobrar: 0, montoCliente: 0,
  })
})
