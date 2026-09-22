import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarItems, validarPago, estadoCompra, limpiarDatosCliente,
} from '../orbit-backend/src/compras-recordatorios-reglas.js'

// Catálogo de mentira con la forma que devuelve la consulta del backend
// (id → { nombre, precio_base, activo }).
const CEDULA  = '11111111-1111-4111-8111-111111111111'
const MEMOPET = '22222222-2222-4222-8222-222222222222'
const VIEJO   = '33333333-3333-4333-8333-333333333333'
const CATALOGO = {
  [CEDULA]:  { nombre: 'Cédula de mascota', precio_base: 0,     activo: true },
  [MEMOPET]: { nombre: 'Memopet',           precio_base: 26000, activo: true },
  [VIEJO]:   { nombre: 'Ítem retirado',     precio_base: 10000, activo: false },
}

// ── normalizarItems ─────────────────────────────────────────────────────────

test('sin precio en la línea, manda el del catálogo y el total suma cantidad × precio', () => {
  const { items, total } = normalizarItems(
    [{ recordatorio_id: MEMOPET, cantidad: 2 }], CATALOGO)
  assert.equal(items[0].nombre, 'Memopet')
  assert.equal(items[0].precio_unitario, 26000)
  assert.equal(total, 52000)
})

test('el coordinador puede fijar el precio (descuento o precio de la cédula), pero el nombre sale del catálogo', () => {
  const { items, total } = normalizarItems(
    [{ recordatorio_id: CEDULA, cantidad: 1, precio_unitario: '45.000'.replace('.', ''), nombre: 'lo que diga el navegador' }],
    CATALOGO)
  assert.equal(items[0].nombre, 'Cédula de mascota')
  assert.equal(items[0].precio_unitario, 45000)
  assert.equal(total, 45000)
})

test('un precio en cero se acepta: es el estado del catálogo hasta que David lo fije, y la pantalla avisa', () => {
  const { total } = normalizarItems([{ recordatorio_id: CEDULA }], CATALOGO)
  assert.equal(total, 0)
})

test('rechaza lista vacía, ítem inexistente, ítem inactivo, cantidad no entera y precio negativo', () => {
  assert.throws(() => normalizarItems([], CATALOGO), /al menos un recordatorio/)
  assert.throws(() => normalizarItems([{ recordatorio_id: 'nope' }], CATALOGO), /no existe/)
  assert.throws(() => normalizarItems([{ recordatorio_id: VIEJO }], CATALOGO), /inactivo/)
  assert.throws(() => normalizarItems([{ recordatorio_id: MEMOPET, cantidad: 1.5 }], CATALOGO), /Cantidad inválida/)
  assert.throws(() => normalizarItems([{ recordatorio_id: MEMOPET, cantidad: 0 }], CATALOGO), /Cantidad inválida/)
  assert.throws(() => normalizarItems([{ recordatorio_id: MEMOPET, precio_unitario: -1 }], CATALOGO), /Precio inválido/)
})

test('los errores de validación llevan status 400 para que el backend no responda 500', () => {
  try { normalizarItems([], CATALOGO); assert.fail('debió lanzar') }
  catch (e) { assert.equal(e.status, 400) }
})

test('los datos del cliente conservan la forma { label: [textos] } y descartan lo vacío', () => {
  const { items } = normalizarItems([{
    recordatorio_id: CEDULA,
    datos_cliente: { 'Fecha de nacimiento': '2021-03-04', 'Color': ['', '  '], '': ['x'] },
  }], CATALOGO)
  assert.deepEqual(items[0].datos_cliente, { 'Fecha de nacimiento': ['2021-03-04'] })
})

test('limpiarDatosCliente devuelve null para nada útil', () => {
  assert.equal(limpiarDatosCliente(null), null)
  assert.equal(limpiarDatosCliente([]), null)
  assert.equal(limpiarDatosCliente({ a: [] }), null)
})

// ── validarPago ─────────────────────────────────────────────────────────────

test('un abono válido se redondea y normaliza el medio', () => {
  const p = validarPago({ monto: '20000', metodo: 'nequi', referencia: ' ABC ' }, 52000)
  assert.deepEqual(p, { monto: 20000, metodo: 'NEQUI', referencia: 'ABC', comprobante_path: null })
})

test('no se acepta un pago que supere lo pendiente, ni cero, ni un medio inventado', () => {
  assert.throws(() => validarPago({ monto: 60000, metodo: 'EFECTIVO' }, 52000), /supera lo pendiente/)
  assert.throws(() => validarPago({ monto: 0, metodo: 'EFECTIVO' }, 52000), /mayor a cero/)
  assert.throws(() => validarPago({ monto: 100, metodo: 'CRIPTO' }, 52000), /Medio de pago/)
})

test('pagar exactamente el saldo es válido', () => {
  assert.equal(validarPago({ monto: 52000, metodo: 'EFECTIVO' }, 52000).monto, 52000)
})

// ── estadoCompra ────────────────────────────────────────────────────────────

test('el estado de la compra sigue a sus líneas y la anulación manda sobre todo', () => {
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 0, listos: 0, enProceso: 0 }), 'PENDIENTE')
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 0, listos: 0, enProceso: 1 }), 'EN_PRODUCCION')
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 0, listos: 1, enProceso: 0 }), 'EN_PRODUCCION')
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 0, listos: 2, enProceso: 0 }), 'LISTA')
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 1, listos: 1, enProceso: 0 }), 'LISTA')
  assert.equal(estadoCompra({ anulada: false, n: 2, entregados: 2, listos: 0, enProceso: 0 }), 'ENTREGADA')
  assert.equal(estadoCompra({ anulada: true,  n: 2, entregados: 2, listos: 0, enProceso: 0 }), 'ANULADA')
})
