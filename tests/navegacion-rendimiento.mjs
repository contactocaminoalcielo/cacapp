// Navegador aislado sobre dist. TODA petición ajena al servidor local se
// intercepta: no hay login real, escrituras ni mensajes a producción.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const raiz = path.resolve('dist')
const servidor = createServer(async (req, res) => {
  const nombre = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]
  const archivo = path.resolve(raiz, `.${nombre}`)
  if (!archivo.startsWith(raiz + path.sep)) { res.writeHead(403).end(); return }
  try {
    const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
    res.setHeader('Content-Type', tipos[path.extname(archivo)] || 'application/octet-stream')
    res.end(await readFile(archivo))
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${servidor.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  const contexto = await browser.newContext({ serviceWorkers: 'block' })
  await contexto.routeWebSocket('**/*', ws => ws.close())
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('pageerror', e => errores.push(e.message))
  const peticiones = []
  let falloPerfil = true
  let rolPerfil = 6
  const usuario = { id: '10000000-0000-4000-8000-000000000001', email: 'prueba@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: usuario.id, email: usuario.email, role: 'authenticated', exp: 4102444800 })).toString('base64url')}.prueba`
  const convs = [
    { contacto: '1111111111', phone_number_id: '1313164878540238', nombre: 'CONVERSACION_PRUEBA_A', sin_leer: 2, ultimo_mensaje_en: '2026-09-07T19:00:00Z', ultima_direccion: 'IN', ultimo_texto: 'Prueba', etiquetas: [] },
    { contacto: '2222222222', phone_number_id: '1317926468072324', nombre: 'CONVERSACION_PRUEBA_B', sin_leer: 3, ultimo_mensaje_en: '2026-09-07T18:00:00Z', ultima_direccion: 'IN', ultimo_texto: 'Prueba', etiquetas: [] },
  ]
  await contexto.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.origin === base) return route.continue()
    peticiones.push({ path: url.pathname, q: url.searchParams.get('q'), method: req.method(), select: url.searchParams.get('select') })
    if (url.pathname.endsWith('/rest/v1/personal') && falloPerfil) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'red simulada no disponible' }) })
    }
    let data = []
    if (url.pathname.endsWith('/auth/v1/token')) data = { access_token: jwt, refresh_token: 'prueba', expires_in: 3600, token_type: 'bearer', user: usuario }
    else if (url.pathname.endsWith('/auth/v1/user')) data = usuario
    else if (url.pathname.endsWith('/rest/v1/personal')) data = [{ id: usuario.id, auth_user_id: usuario.id, nombre: 'Prueba', apellido: 'Auditoria', email: usuario.email, rol_principal_id: rolPerfil, activo: true }]
    else if (rolPerfil === 2 && url.pathname.endsWith('/rest/v1/entregas')) {
      const disponible = url.searchParams.get('estado') === 'eq.DISPONIBLE'
      data = (disponible ? ['LUNA_PRUEBA'] : ['SIMÓN_PRUEBA', 'TOBY_PRUEBA']).map((nombre, i) => ({
        id: `${disponible ? 'disponible' : 'propia'}-${i}`, estado: disponible ? 'DISPONIBLE' : 'ASIGNADA',
        servicios: { id: `servicio-${i}`, estado: 'LISTO_ENTREGA', valor_total: 0, valor_pagado: 0,
          mascotas: { nombre, clientes: { nombre: i ? 'Pedro' : 'María', apellido: 'Gómez', whatsapp: i ? '3002222222' : '3001111111' }, especies: { nombre: 'Canino' } } },
      }))
    }
    else if (url.pathname.endsWith('/rpc/orbit_contadores')) data = { kanban: 0, produccion: 0, imagenes: 0, nps: 0 }
    else if (url.pathname.endsWith('/api/whatsapp/conversaciones')) data = { ok: true, conversaciones: convs, sin_leer_total: 5, total: 2 }
    else if (url.pathname.startsWith('/api/')) data = { ok: true, agentes: [], etiquetas: [], servicios: [], lotes: [], candidatos: [], items: [], movimientos: [] }
    const singular = req.headers().accept?.includes('vnd.pgrst.object')
    if (singular && Array.isArray(data)) data = data[0] || null
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(data) })
  })

  await pagina.goto(base)
  await pagina.waitForTimeout(1000)
  assert.deepEqual(errores, [], 'Errores al iniciar el build')
  await pagina.locator('input[type=email]').fill(usuario.email)
  await pagina.locator('input[type=password]').fill('solo-prueba-local')
  await pagina.locator('button[type=submit]').click()
  await pagina.getByRole('heading', { name: 'No pudimos conectar' }).waitFor()
  assert.equal(await pagina.getByText('Usuario sin perfil', { exact: true }).count(), 0)
  falloPerfil = false
  await pagina.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await pagina.getByRole('heading', { name: 'No pudimos conectar' }).waitFor({ state: 'hidden' })
  await pagina.waitForFunction(() => !document.querySelector('input[type=password]'))
  await pagina.waitForTimeout(800)
  for (const ruta of ['/kanban', '/produccion', '/cuarto-frio', '/calendario', '/finanzas', '/tenjo']) {
    await pagina.evaluate(r => { location.hash = r }, ruta)
    await pagina.waitForTimeout(800)
    assert.equal(errores.length, 0, `${ruta}: ${errores.join('; ')}`)
  }
  await pagina.evaluate(() => { location.hash = '/whatsapp' })
  await pagina.getByText('CONVERSACION_PRUEBA_A', { exact: true }).first().waitFor()
  // Con la bandeja abierta solo el contexto debe sondear cada diez segundos.
  const listas = () => peticiones.filter(r => r.path.endsWith('/api/whatsapp/conversaciones') && !r.q).length
  const antes = listas()
  await pagina.waitForTimeout(11000)
  assert.ok(listas() - antes <= 2, 'Hay más de un sondeo de bandeja por intervalo')
  const buscador = pagina.getByPlaceholder('Buscar por nombre o número...')
  const busquedaTerminada = pagina.waitForResponse(r => new URL(r.url()).searchParams.get('q') === 'vet')
  await buscador.fill('v')
  await buscador.fill('ve')
  await buscador.fill('vet')
  await busquedaTerminada
  const busquedas = peticiones.filter(r => r.path.endsWith('/api/whatsapp/conversaciones') && r.q)
  assert.deepEqual(busquedas.map(r => r.q), ['vet'], 'La búsqueda debe agrupar pulsaciones')
  assert.equal(errores.length, 0, errores.join('; '))
  assert.equal(peticiones.filter(r => ['PATCH', 'DELETE', 'PUT'].includes(r.method)).length, 0)
  assert.equal(peticiones.filter(r => r.select?.includes('entrega_confirmada_monto')).length, 0)
  rolPerfil = 2
  await pagina.reload()
  await pagina.waitForTimeout(2000)
  assert.equal(await pagina.locator('input[type=password]').count(), 0, 'El técnico debe conservar su sesión')
  assert.equal(await pagina.getByRole('heading', { name: 'No pudimos conectar' }).count(), 0)
  assert.equal(errores.length, 0, 'Errores en la vista del técnico: ' + errores.join('; '))
  await pagina.getByRole('button', { name: /Entregas/ }).click()
  const buscarEntrega = pagina.getByRole('searchbox', { name: 'Buscar entregas' })
  await pagina.getByText('SIMÓN_PRUEBA', { exact: true }).waitFor()
  await buscarEntrega.fill('simon')
  await pagina.getByText('TOBY_PRUEBA', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await pagina.getByText('SIMÓN_PRUEBA', { exact: true }).count(), 1)
  await buscarEntrega.fill('maria gomez')
  await pagina.getByText('LUNA_PRUEBA', { exact: true }).waitFor()
  await buscarEntrega.fill('300222')
  await pagina.getByText('TOBY_PRUEBA', { exact: true }).waitFor()
  await pagina.getByText('SIMÓN_PRUEBA', { exact: true }).waitFor({ state: 'hidden' })
  await pagina.getByRole('button', { name: 'Limpiar búsqueda de entregas' }).click()
  await pagina.getByText('SIMÓN_PRUEBA', { exact: true }).waitFor()
  console.log(JSON.stringify({ ok: true, rutas: 8, errores: errores.length, sondeosEn11s: listas() - antes, busquedas: busquedas.map(r => r.q), produccion: 'sin conexiones reales' }))
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => servidor.close(resolve))
}
