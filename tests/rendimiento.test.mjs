import test from 'node:test'
import assert from 'node:assert/strict'
import { leerPaginas, mapLimit, lecturaSerial } from '../src/lib/lecturas.js'
import { serviciosListosDesdeItems } from '../src/lib/kanbanEstado.js'

test('paginación incluye el registro 1001 y conserva orden', async () => {
  const filas = Array.from({ length: 1173 }, (_, id) => ({ id }))
  const llamadas = []
  const result = await leerPaginas(() => ({ range: async (a, b) => {
    llamadas.push([a, b]); return { data: filas.slice(a, b + 1) }
  } }))
  assert.deepEqual(result, filas)
  assert.deepEqual(llamadas, [[0, 999], [1000, 1999]])
})

test('fallar cerrado ante datos truncados o errores, incluyendo código RPC ausente', async () => {
  await assert.rejects(leerPaginas(() => ({ range: async () => ({ data: [{ id: 1 }] }) }), { pagina: 1, maxPaginas: 2 }), /límite de páginas/)
  await assert.rejects(leerPaginas(() => ({ range: async () => ({ error: { code: 'PGRST202', message: 'RPC ausente' } }) })), e => e.code === 'PGRST202')
  await assert.rejects(leerPaginas(() => {}, { pagina: 2000 }), /entre 1 y 1000/)
})

test('no pasar a LISTO si existe un pendiente después de la fila 1000', async () => {
  const items = Array.from({ length: 1001 }, (_, i) => ({ estado: i === 1000 ? 'PENDIENTE' : 'LISTO' }))
  const completos = await leerPaginas(() => ({ range: async (a, b) => ({ data: items.slice(a, b + 1) }) }))
  assert.deepEqual(serviciosListosDesdeItems([{ servicio_id: 'a', estado: 'EN_PRODUCCION', items_rec: completos }]), [])
})

test('autocorrección conserva exclusiones y no adelanta entregas/cancelaciones', () => {
  const casos = [
    { servicio_id: 'listo', estado: 'EN_PRODUCCION', items_rec: [{ estado: 'LISTO' }, { estado: 'ENTREGADO' }, { estado: 'NA' }, { estado: 'PENDIENTE', origen: 'REMOVIDO' }] },
    { servicio_id: 'pendiente', estado: 'EN_PRODUCCION', items_rec: [{ estado: 'LISTO' }, { estado: 'EN_PROCESO' }] },
    ...['EN_ENTREGA', 'ENTREGADO', 'CANCELADO', 'LISTO'].map(estado => ({ servicio_id: estado, estado, items_rec: [{ estado: 'LISTO' }] })),
    { servicio_id: 'vacio', estado: 'INGRESADO', items_rec: [] },
    { servicio_id: 'na', estado: 'EN_CUARTO_FRIO', items_rec: [{ estado: 'NA' }] },
  ]
  assert.deepEqual(serviciosListosDesdeItems(casos), ['listo'])
  const duplicado = structuredClone(casos[0])
  duplicado.items_rec.push({ estado: 'LISTO' })
  assert.deepEqual(serviciosListosDesdeItems([duplicado]), ['listo'])
})

test('lotes con concurrencia acotada y resultados en orden', async () => {
  let activos = 0; let maximo = 0
  const r = await mapLimit([1, 2, 3, 4, 5, 6], async n => {
    activos++; maximo = Math.max(maximo, activos)
    await new Promise(resolve => setTimeout(resolve, 5))
    activos--; return n * 2
  }, 2)
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12])
  assert.equal(maximo, 2)
})

test('una ráfaga durante una lectura se agrupa en una segunda vuelta sin solapar', async () => {
  let llamadas = 0; let activos = 0; let maximo = 0
  let terminar
  const primero = new Promise(resolve => { terminar = resolve })
  const fn = lecturaSerial(async argumento => {
    llamadas++; activos++; maximo = Math.max(maximo, activos)
    if (llamadas === 1) await primero
    activos--; return argumento
  })
  const a = fn('inicial')
  await Promise.resolve()
  const b = fn('evento1'); const c = fn('evento2')
  assert.equal(a, b); assert.equal(b, c)
  terminar()
  assert.deepEqual(await Promise.all([a, b, c]), ['evento2', 'evento2', 'evento2'])
  assert.equal(llamadas, 2); assert.equal(maximo, 1)
})

test('el refresco se recupera de un error de red', async () => {
  let n = 0
  const leer = lecturaSerial(async () => { if (++n === 1) throw new Error('red'); return 'recuperado' })
  await assert.rejects(leer(), /red/)
  assert.equal(await leer(), 'recuperado')
})
