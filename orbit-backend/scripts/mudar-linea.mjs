// Mudar una línea de WhatsApp a otra WABA, paso a paso.
//
// No es una sola llamada: Meta valida en cascada y cada paso revela el
// siguiente requisito. Por eso va en subcomandos separados — para poder parar,
// mirar y seguir, en vez de descubrir a mitad que falta algo con la línea abajo.
//
// El ÚNICO paso que no está aquí es dar de baja el número en la WABA vieja:
// eso Meta solo lo permite por WhatsApp Manager, nunca por API.
//
// Secuencia completa:
//   estado                                   ← antes de tocar nada
//   (bajar el número en WhatsApp Manager)
//   alta      --cc 57 --numero 3159891247 --nombre "Camino Al Cielo"
//   codigo    --id <nuevo_id> --metodo SMS
//   verificar --id <nuevo_id> --codigo 123456
//   registrar --id <nuevo_id> --pin 123456
//   suscribir
//   estado                                   ← para anotar el id definitivo
//
// Después de esto todavía faltan, y NO los hace este script:
//   · migrations/136_familias_cambio_de_waba.sql con el id nuevo
//   · WHATSAPP_ALLOWED_PHONE_IDS en el .env + rebuild del backend
//   · linea-wa.js, whatsappInbox.js, ChatWaContext.jsx, Whatsapp.jsx + push
//
// Uso:
//   set -a; . /opt/orbit-backend/.env; set +a
//   META_TOKEN=$WHATSAPP_ACCESS_TOKEN node scripts/mudar-linea.mjs estado

const GRAPH = 'https://graph.facebook.com'
const VERSION = process.env.WHATSAPP_API_VERSION || 'v23.0'
const TOKEN = (process.env.META_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '').trim()
const ORIGEN = (process.env.WABA_ORIGEN || '1603630731045999').trim()
const DESTINO = (process.env.WABA_DESTINO || '1048633974692786').trim()

const ACCION = process.argv[2] || 'estado'

function arg(nombre, defecto = null) {
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
    const codigo = [e.code, e.error_subcode].filter(Boolean).join('/')
    throw new Error(`${e.error_user_msg || e.message || `Error ${r.status}`}${codigo ? ` [${codigo}]` : ''}`)
  }
  return data
}

const CAMPOS = [
  'id', 'display_phone_number', 'verified_name', 'status',
  'name_status', 'code_verification_status', 'quality_rating',
].join(',')

async function numerosDe(waba) {
  const d = await meta(`${waba}/phone_numbers?fields=${CAMPOS}`)
  return d.data || []
}

function pinta(n) {
  return [
    `  ${n.display_phone_number}  id=${n.id}`,
    `     estado=${n.status}  calidad=${n.quality_rating || '-'}`,
    `     nombre="${n.verified_name}" (${n.name_status})  verificacion=${n.code_verification_status}`,
  ].join('\n')
}

// ── estado ───────────────────────────────────────────────────────────────────

async function estado() {
  for (const [etiqueta, waba] of [['ORIGEN', ORIGEN], ['DESTINO', DESTINO]]) {
    const ns = await numerosDe(waba)
    console.log(`\n${etiqueta} — WABA ${waba} (${ns.length} números)`)
    if (!ns.length) console.log('  (vacía)')
    for (const n of ns) console.log(pinta(n))
  }

  // Sin app suscrita no llega ni un webhook: la línea entra muda aunque el
  // número esté CONNECTED. Es el olvido clásico y no da ningún error visible.
  try {
    const s = await meta(`${DESTINO}/subscribed_apps`)
    const apps = (s.data || []).map(a => a.whatsapp_business_api_data?.name || a.whatsapp_business_api_data?.id)
    console.log(`\nApps suscritas al destino: ${apps.length ? apps.join(', ') : '⚠️ NINGUNA — corre "suscribir"'}`)
  } catch (e) {
    console.log(`\nApps suscritas al destino: no se pudo leer (${e.message})`)
  }
}

// ── alta ─────────────────────────────────────────────────────────────────────

/**
 * Da de alta el número en la WABA destino.
 *
 * ⚠️ Falla con "already registered" mientras el número siga en la WABA vieja:
 * primero hay que darlo de baja en WhatsApp Manager y esperar a que se propague
 * (Meta dice 3 minutos; en la práctica es más). Compruébalo con `estado`.
 *
 * El `verified_name` va a revisión aparte y NO impide operar si lo rechazan —
 * los cinco números de la cuenta vieja llevan años DECLINED y funcionan.
 */
async function alta() {
  const cc = arg('cc', '57')
  const numero = arg('numero')
  const nombre = arg('nombre')
  if (!numero || !nombre) throw new Error('Faltan --numero y --nombre')

  const d = await meta(`${DESTINO}/phone_numbers`, {
    metodo: 'POST',
    cuerpo: { cc, phone_number: numero, verified_name: nombre },
  })
  console.log(`✓ alta hecha — phone_number_id NUEVO: ${d.id}`)
  console.log('  Anótalo: es el que va en la migración 136 y en el .env.')
  console.log(`  Siguiente: codigo --id ${d.id} --metodo SMS`)
}

// ── codigo / verificar ───────────────────────────────────────────────────────

async function codigo() {
  const id = arg('id')
  const metodo = (arg('metodo', 'SMS') || 'SMS').toUpperCase()
  if (!id) throw new Error('Falta --id')
  if (!['SMS', 'VOICE'].includes(metodo)) throw new Error('--metodo debe ser SMS o VOICE')

  await meta(`${id}/request_code`, {
    metodo: 'POST',
    cuerpo: { code_method: metodo, language: 'es' },
  })
  console.log(`✓ código pedido por ${metodo} al número. Llega en segundos.`)
  console.log(`  Siguiente: verificar --id ${id} --codigo NNNNNN`)
}

async function verificar() {
  const id = arg('id')
  const cod = arg('codigo')
  if (!id || !cod) throw new Error('Faltan --id y --codigo')

  await meta(`${id}/verify_code`, { metodo: 'POST', cuerpo: { code: String(cod).replace(/\D/g, '') } })
  console.log('✓ número verificado.')
  console.log(`  Siguiente: registrar --id ${id} --pin NNNNNN`)
}

// ── registrar ────────────────────────────────────────────────────────────────

/**
 * Deja el número operando en Cloud API.
 *
 * El PIN es la verificación en dos pasos y lo eliges tú aquí — no es el viejo.
 * Guárdalo: hace falta para cualquier mudanza futura, y la pantalla de
 * WhatsApp Manager falla al cambiarlo sin dar error.
 */
async function registrar() {
  const id = arg('id')
  const pin = arg('pin')
  if (!id || !pin) throw new Error('Faltan --id y --pin')
  if (!/^\d{6}$/.test(pin)) throw new Error('El PIN son 6 dígitos')

  await meta(`${id}/register`, { metodo: 'POST', cuerpo: { messaging_product: 'whatsapp', pin } })
  console.log('✓ registrado. El número ya puede enviar y recibir.')
  console.log('  Siguiente: suscribir, y luego la migración 136 con el id nuevo.')
}

// ── suscribir ────────────────────────────────────────────────────────────────

async function suscribir() {
  await meta(`${DESTINO}/subscribed_apps`, { metodo: 'POST' })
  console.log(`✓ app suscrita a la WABA ${DESTINO}. Los webhooks ya entran a Orbit.`)
}

// ── Arranque ─────────────────────────────────────────────────────────────────

if (!TOKEN) {
  console.error('Falta META_TOKEN (o WHATSAPP_ACCESS_TOKEN en el entorno)')
  process.exit(1)
}

const acciones = { estado, alta, codigo, verificar, registrar, suscribir }

try {
  const fn = acciones[ACCION]
  if (!fn) {
    console.error(`Acción desconocida: ${ACCION}. Usa: ${Object.keys(acciones).join(', ')}`)
    process.exit(1)
  }
  await fn()
} catch (e) {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
}
