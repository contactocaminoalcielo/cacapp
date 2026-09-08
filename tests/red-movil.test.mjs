import test from 'node:test'
import assert from 'node:assert/strict'
import { conLimite, fetchSupabase } from '../src/lib/esperas.js'
import { compressImage } from '../src/lib/imageUtils.js'
import { stashPut } from '../src/lib/pendingUploads.js'

test('la espera termina y limpia su temporizador', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const p = conLimite(new Promise(() => {}), 50, 'sin conexión')
  const resultado = assert.rejects(p, /sin conexión/)
  t.mock.timers.tick(50)
  await resultado
  assert.equal(await conLimite(Promise.resolve('ok'), 50, 'falló'), 'ok')
})

test('la solicitud de Storage se aborta realmente al vencer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    signal = init.signal
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  })
  const p = fetchSupabase('https://prueba.invalid/storage/v1/object/evidencias/foto.jpg')
  const resultado = assert.rejects(p, /conexión tardó/)
  t.mock.timers.tick(55000)
  await resultado
  assert.equal(signal.aborted, true)
})

test('conserva la cancelación del llamador y no impone plazo a IA', async t => {
  const controller = new AbortController()
  controller.abort('cancelado')
  const señales = []
  t.mock.method(globalThis, 'fetch', async (_, init) => { señales.push(init.signal); return 'ok' })
  await fetchSupabase('https://prueba.invalid/rest/v1/servicios', { signal: controller.signal })
  assert.equal(señales[0].reason, 'cancelado')
  await fetchSupabase('https://prueba.invalid/functions/v1/extraer-datos')
  assert.equal(señales[1], undefined)
})

test('compresión bloqueada devuelve el original y cierra un bitmap tardío', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolver
  let cerrados = 0
  const anterior = globalThis.createImageBitmap
  globalThis.createImageBitmap = () => new Promise(r => { resolver = r })
  t.after(() => { if (anterior) globalThis.createImageBitmap = anterior; else delete globalThis.createImageBitmap })
  const file = new Blob(['imagen'], { type: 'image/png' })
  const p = compressImage(file)
  t.mock.timers.tick(15000)
  assert.equal(await p, file)
  resolver({ close() { cerrados++ } })
  await Promise.resolve()
  assert.equal(cerrados, 1)
  assert.equal(file.type, 'image/png')
})

test('IndexedDB bloqueado no detiene la subida y cierra apertura tardía', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let cerrado = false
  const req = { result: { close() { cerrado = true } } }
  const anterior = globalThis.indexedDB
  globalThis.indexedDB = { open() { return req } }
  t.after(() => { if (anterior) globalThis.indexedDB = anterior; else delete globalThis.indexedDB })
  const p = stashPut('prueba', new Blob(['foto']))
  t.mock.timers.tick(5000)
  await p
  req.onsuccess()
  assert.equal(cerrado, true)
})
