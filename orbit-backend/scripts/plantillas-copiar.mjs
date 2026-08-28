// Copia plantillas de WhatsApp de una WABA a otra.
//
// Las plantillas son de la CUENTA, no del número: al mover una línea a otra
// WABA se quedan atrás y hay que volver a darlas de alta y esperar revisión.
// Este script hace ese trasplante sin rehacerlas a mano una por una.
//
// Fases:
//   listar   — inventario de la WABA origen + deja una selección editable.
//   copiar   — da de alta en la WABA destino las que estén en la selección.
//
// Uso:
//   META_TOKEN=... WABA_ORIGEN=1603630731045999 node scripts/plantillas-copiar.mjs listar
//   (edita seleccion-plantillas.txt: borra las líneas que NO quieras)
//   META_TOKEN=... WABA_ORIGEN=... WABA_DESTINO=... node scripts/plantillas-copiar.mjs copiar --dry
//   ... sin --dry para crearlas de verdad
//
// El token tiene que tener `whatsapp_business_management` sobre LAS DOS cuentas.
// El del backend NO sirve: se necesita el de administración.

import fs from 'node:fs'

const GRAPH = 'https://graph.facebook.com'
const VERSION = process.env.WHATSAPP_API_VERSION || 'v23.0'
const TOKEN = (process.env.META_TOKEN || '').trim()
const ORIGEN = (process.env.WABA_ORIGEN || '1603630731045999').trim()
const DESTINO = (process.env.WABA_DESTINO || '').trim()

const ACCION = process.argv[2] || 'listar'
const DRY = process.argv.includes('--dry')
const ARCHIVO_SEL = argumento('seleccion', 'seleccion-plantillas.txt')
const ARCHIVO_INV = argumento('inventario', 'inventario-plantillas.json')

// Meta devuelve al leer un montón de campos que rechaza al crear. Estos son los
// únicos que viajan de vuelta en el POST.
const CAMPOS = 'name,status,category,previous_category,language,components,parameter_format,id'

function argumento(nombre, defecto = null) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : defecto
}

async function meta(ruta, { metodo = 'GET', cuerpo = null } = {}) {
  const r = await fetch(`${GRAPH}/${VERSION}/${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.error) {
    const e = data?.error || {}
    return {
      ok: false,
      error: e.error_user_msg || e.message || `Error ${r.status}`,
      codigo: [e.code, e.error_subcode].filter(Boolean).join('/') || null,
    }
  }
  return { ok: true, data }
}

// ── Inventario ───────────────────────────────────────────────────────────────

async function traerTodas(waba) {
  let ruta = `${waba}/message_templates?limit=200&fields=${CAMPOS}`
  const todas = []
  while (ruta) {
    const r = await meta(ruta)
    if (!r.ok) throw new Error(`No se pudo leer ${waba}: ${r.error}`)
    todas.push(...(r.data.data || []))
    const siguiente = r.data.paging?.next
    ruta = siguiente ? siguiente.replace(`${GRAPH}/${VERSION}/`, '') : null
  }
  return todas
}

// Las cabeceras con medio son la parte frágil: el `header_handle` que devuelve
// Meta al leer NO sirve en otra cuenta, hay que volver a subir el archivo.
function cabeceraConMedio(p) {
  const h = (p.components || []).find(c => c.type === 'HEADER')
  return h && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(h.format) ? h.format : null
}

function tieneCarrusel(p) {
  return (p.components || []).some(c => c.type === 'CAROUSEL')
}

async function listar() {
  const todas = await traerTodas(ORIGEN)
  fs.writeFileSync(ARCHIVO_INV, JSON.stringify(todas, null, 2))

  const porEstado = {}
  for (const p of todas) porEstado[p.status] = (porEstado[p.status] || 0) + 1

  console.log(`\n${todas.length} plantillas en la WABA ${ORIGEN}`)
  console.log(Object.entries(porEstado).map(([k, v]) => `  ${k}: ${v}`).join('\n'))

  const reclasificadas = todas.filter(p => p.previous_category && p.previous_category !== p.category)
  if (reclasificadas.length) {
    console.log(`\n⚠️  ${reclasificadas.length} reclasificadas por Meta (se cobran distinto):`)
    for (const p of reclasificadas) console.log(`   ${p.name} — ${p.previous_category} → ${p.category}`)
  }

  const conMedio = todas.filter(cabeceraConMedio)
  if (conMedio.length) {
    console.log(`\n📎 ${conMedio.length} con cabecera de archivo — hay que volver a subir el medio:`)
    for (const p of conMedio) console.log(`   ${p.name} (${cabeceraConMedio(p)})`)
  }

  const lineas = [
    '# Plantillas a copiar. Borra las líneas que NO quieras llevarte.',
    '# Formato: nombre|idioma|categoria    (# al principio = ignorada)',
    '#',
    ...todas
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(p => {
        const notas = [
          p.status !== 'APPROVED' ? p.status : null,
          cabeceraConMedio(p) ? `cabecera ${cabeceraConMedio(p)}` : null,
          tieneCarrusel(p) ? 'carrusel' : null,
        ].filter(Boolean)
        const marca = p.status === 'APPROVED' ? '' : '# '
        return `${marca}${p.name}|${p.language}|${p.category}${notas.length ? `    # ${notas.join(', ')}` : ''}`
      }),
  ]
  fs.writeFileSync(ARCHIVO_SEL, lineas.join('\n') + '\n')

  console.log(`\nInventario completo → ${ARCHIVO_INV}`)
  console.log(`Selección editable  → ${ARCHIVO_SEL}`)
  console.log('   (las que no están APPROVED vienen comentadas; descoméntalas si las quieres igual)')
}

// ── Copia ────────────────────────────────────────────────────────────────────

let appIdMemoria = null
async function appId() {
  if (process.env.WHATSAPP_APP_ID) return process.env.WHATSAPP_APP_ID.trim()
  if (appIdMemoria) return appIdMemoria
  const r = await meta(`debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`)
  appIdMemoria = r.ok ? r.data?.data?.app_id || null : null
  return appIdMemoria
}

/**
 * Vuelve a subir el archivo de una cabecera y devuelve un `handle` nuevo.
 *
 * Son dos llamadas contra la APP (no contra el número) y la segunda va con
 * `Authorization: OAuth` — con `Bearer` falla en silencio.
 */
async function rehacerHandle(url) {
  const app = await appId()
  if (!app) return { ok: false, error: 'no se pudo saber el app_id (pon WHATSAPP_APP_ID)' }

  const descarga = await fetch(url)
  if (!descarga.ok) return { ok: false, error: `no se pudo descargar el archivo original (${descarga.status})` }
  const buf = Buffer.from(await descarga.arrayBuffer())
  const mime = descarga.headers.get('content-type') || 'application/octet-stream'

  const sesion = await meta(
    `${app}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(mime)}&file_name=cabecera`,
    { metodo: 'POST' }
  )
  if (!sesion.ok) return { ok: false, error: sesion.error }

  const r = await fetch(`${GRAPH}/${VERSION}/${sesion.data.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${TOKEN}`, file_offset: '0' },
    body: buf,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data?.h) {
    return { ok: false, error: data?.error?.message || `Error ${r.status} al subir` }
  }
  return { ok: true, handle: data.h }
}

/** Deja el componente como lo quiere el POST, no como lo devuelve el GET. */
async function limpiarComponente(c, avisos) {
  const t = c.type

  if (t === 'HEADER') {
    if (c.format === 'TEXT') {
      return { type: 'HEADER', format: 'TEXT', text: c.text, ...(c.example ? { example: c.example } : {}) }
    }
    const url = c.example?.header_handle?.[0]
    if (!url) {
      avisos.push(`cabecera ${c.format} sin archivo de ejemplo — hay que subirlo a mano`)
      return null
    }
    const nuevo = await rehacerHandle(url)
    if (!nuevo.ok) {
      avisos.push(`cabecera ${c.format}: ${nuevo.error}`)
      return null
    }
    return { type: 'HEADER', format: c.format, example: { header_handle: [nuevo.handle] } }
  }

  if (t === 'BODY') {
    return { type: 'BODY', text: c.text, ...(c.example ? { example: c.example } : {}) }
  }

  if (t === 'FOOTER') return { type: 'FOOTER', text: c.text }

  if (t === 'BUTTONS') {
    return { type: 'BUTTONS', buttons: (c.buttons || []).map(b => ({ ...b })) }
  }

  if (t === 'CAROUSEL') {
    const cards = []
    for (const card of c.cards || []) {
      const comps = []
      for (const sub of card.components || []) {
        const limpio = await limpiarComponente(sub, avisos)
        if (limpio) comps.push(limpio)
      }
      cards.push({ components: comps })
    }
    return { type: 'CAROUSEL', cards }
  }

  // Cualquier otro tipo (ofertas por tiempo limitado, etc.) viaja tal cual.
  return { ...c }
}

function leerSeleccion() {
  if (!fs.existsSync(ARCHIVO_SEL)) {
    throw new Error(`No existe ${ARCHIVO_SEL}. Corre primero: node scripts/plantillas-copiar.mjs listar`)
  }
  return fs.readFileSync(ARCHIVO_SEL, 'utf8')
    .split('\n')
    .map(l => l.split('#')[0].trim())
    .filter(Boolean)
    .map(l => {
      const [nombre, idioma, categoria] = l.split('|').map(s => (s || '').trim())
      return { nombre, idioma, categoria }
    })
    .filter(s => s.nombre && s.idioma)
}

async function copiar() {
  if (!DESTINO) throw new Error('Falta WABA_DESTINO')

  const seleccion = leerSeleccion()
  const origen = fs.existsSync(ARCHIVO_INV)
    ? JSON.parse(fs.readFileSync(ARCHIVO_INV, 'utf8'))
    : await traerTodas(ORIGEN)

  // Lo que YA existe en el destino no se vuelve a mandar: el nombre es único
  // por cuenta y un reintento solo devolvería un error confuso.
  const yaEsta = new Set((await traerTodas(DESTINO)).map(p => `${p.name}:${p.language}`))

  const porClave = new Map(origen.map(p => [`${p.name}:${p.language}`, p]))
  const resultado = { creadas: [], saltadas: [], fallidas: [] }

  for (const sel of seleccion) {
    const clave = `${sel.nombre}:${sel.idioma}`
    const p = porClave.get(clave)

    if (!p) { resultado.fallidas.push({ clave, error: 'no está en la WABA origen' }); continue }
    if (yaEsta.has(clave)) { resultado.saltadas.push({ clave, motivo: 'ya existe en el destino' }); continue }

    const avisos = []
    const componentes = []
    for (const c of p.components || []) {
      const limpio = await limpiarComponente(c, avisos)
      if (limpio) componentes.push(limpio)
    }

    if (avisos.length) {
      resultado.fallidas.push({ clave, error: avisos.join(' · ') })
      console.log(`✗ ${clave} — ${avisos.join(' · ')}`)
      continue
    }

    const cuerpo = {
      name: p.name,
      language: p.language,
      category: sel.categoria || p.category,
      components: componentes,
      ...(p.parameter_format ? { parameter_format: p.parameter_format } : {}),
    }

    if (DRY) {
      console.log(`· ${clave} → ${cuerpo.category}, ${componentes.length} componentes`)
      resultado.saltadas.push({ clave, motivo: 'dry' })
      continue
    }

    const r = await meta(`${DESTINO}/message_templates`, { metodo: 'POST', cuerpo })
    if (!r.ok) {
      resultado.fallidas.push({ clave, error: `${r.error}${r.codigo ? ` (${r.codigo})` : ''}` })
      console.log(`✗ ${clave} — ${r.error}`)
    } else {
      const recat = r.data.category && r.data.category !== cuerpo.category
        ? ` ⚠️ Meta la reclasificó a ${r.data.category}`
        : ''
      resultado.creadas.push({ clave, id: r.data.id, categoria: r.data.category })
      console.log(`✓ ${clave} → ${r.data.status || 'PENDING'}${recat}`)
    }

    // Sin pausa, una tanda larga se lleva un límite de frecuencia por delante.
    await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\ncreadas ${resultado.creadas.length} · saltadas ${resultado.saltadas.length} · fallidas ${resultado.fallidas.length}`)
  if (resultado.fallidas.length) {
    console.log('\nFallidas:')
    for (const f of resultado.fallidas) console.log(`   ${f.clave} — ${f.error}`)
  }
  if (!DRY && resultado.creadas.length) {
    console.log('\nTodas nacen en PENDING: Meta las revisa una a una. El nombre y el idioma')
    console.log('se conservan, así que el mapeo de variables de Orbit sigue sirviendo.')
  }
}

// ── Arranque ─────────────────────────────────────────────────────────────────

if (!TOKEN) {
  console.error('Falta META_TOKEN (token de administración con whatsapp_business_management sobre las dos cuentas)')
  process.exit(1)
}

try {
  if (ACCION === 'listar') await listar()
  else if (ACCION === 'copiar') await copiar()
  else {
    console.error(`Acción desconocida: ${ACCION}. Usa "listar" o "copiar".`)
    process.exit(1)
  }
} catch (e) {
  console.error(`\n${e.message}`)
  process.exit(1)
}
