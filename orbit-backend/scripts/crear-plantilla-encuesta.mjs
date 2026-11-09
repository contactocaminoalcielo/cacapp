// Plantilla de la encuesta post-entrega (migración 206) y su puesta en marcha.
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-encuesta.mjs crear
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-encuesta.mjs estado
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-encuesta.mjs resena https://g.page/r/XXXX/review
//
// `estado`: si Meta ya la aprobó, la deja configurada en ENCUESTA_ENTREGA.plantilla
// y fija `arranque_desde` = hoy si no tenía (las entregas de antes NO se encuestan).
// NO enciende el flujo: eso se hace en /automatizaciones, a propósito, por una persona.
//
// Se crea en la WABA del agente que tiene la línea de familias (LINEA_WA_ID):
// es por donde sale el envío, y cada cuenta tiene sus propias plantillas.
import { pool } from '../src/db.js'
import { LINEA_WA_ID } from '../src/linea-wa.js'
import { crearPlantilla, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { CUERPO_PLANTILLA, BOTONES } from '../src/encuesta-entrega.js'

const NOMBRE = 'encuesta_post_entrega'
const IDIOMA = 'es_MX'

const [accion = 'estado', arg] = process.argv.slice(2)

async function agenteDeFamilias() {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM public.agente_wa WHERE $1 = ANY(phone_number_ids) ORDER BY id`, [LINEA_WA_ID]
  )
  if (rows.length !== 1) throw new Error(`Se esperaba un agente con la línea ${LINEA_WA_ID} y hay ${rows.length}`)
  return rows[0]
}

async function guardar(clave, valor) {
  await pool.query(
    `INSERT INTO public.config_operativa (modulo, clave, valor)
     VALUES ('ENCUESTA_ENTREGA', $1, $2::jsonb)
     ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [clave, JSON.stringify(valor)]
  )
}

async function crear() {
  const agente = await agenteDeFamilias()
  console.log(`Agente: ${agente.nombre} (#${agente.id}) · línea ${LINEA_WA_ID}`)
  const r = await crearPlantilla({
    nombre: NOMBRE, idioma: IDIOMA, categoria: 'UTILITY', formato: 'POSITIONAL', agenteId: agente.id,
    componentes: [
      { type: 'BODY', text: CUERPO_PLANTILLA, example: { body_text: [['Luna']] } },
      { type: 'BUTTONS', buttons: BOTONES.map(text => ({ type: 'QUICK_REPLY', text })) },
    ],
  })
  console.log(JSON.stringify(r.body, null, 2))
  if (r.body.ok) await estado()
}

async function estado() {
  const agente = await agenteDeFamilias()
  const r = await listarPlantillas({ agenteId: agente.id })
  if (!r.body.ok) throw new Error(r.body.error)
  const p = r.body.plantillas.find(x => x.name === NOMBRE && x.language === IDIOMA)
  if (!p) { console.log(`No existe todavía ${NOMBRE} en la cuenta ${r.body.waba}. Corre con "crear".`); return }
  console.log(`${NOMBRE}: ${p.status} · categoría ${p.category}`)
  if (p.status !== 'APPROVED') {
    console.log('Aún no está aprobada: Orbit no se toca. Vuelve a correr con "estado" más tarde.')
    return
  }
  await guardar('plantilla', { nombre: NOMBRE, idioma: IDIOMA, categoria: p.category || 'UTILITY' })
  const { rows: [a] } = await pool.query(
    `SELECT valor FROM public.config_operativa WHERE modulo = 'ENCUESTA_ENTREGA' AND clave = 'arranque_desde'`)
  if (!a?.valor) {
    const { rows: [h] } = await pool.query(`SELECT public.fn_hoy_bogota()::text AS hoy`)
    await guardar('arranque_desde', h.hoy)
    console.log(`arranque_desde = ${h.hoy}: solo se encuestan entregas desde hoy.`)
  }
  const { rows: cfg } = await pool.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'ENCUESTA_ENTREGA' ORDER BY clave`)
  cfg.forEach(c => console.log(`  ${c.clave} = ${JSON.stringify(c.valor)}`))
  console.log('✅ Configurada. Para que empiece a salir, enciéndela en /automatizaciones.')
}

async function resena(url) {
  if (!/^https:\/\/\S+$/i.test(String(url || ''))) throw new Error('Pasa el enlace completo: https://g.page/r/…/review')
  await guardar('google_resena_url', url)
  console.log(`✅ Enlace de reseña guardado: ${url}`)
}

try {
  if (accion === 'crear') await crear()
  else if (accion === 'resena') await resena(arg)
  else await estado()
} catch (e) {
  console.error('ERROR:', e.message)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
