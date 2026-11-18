// Plantilla de la OFERTA POSTERIOR al servicio (migración 210).
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-oferta-posterior.mjs crear
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-oferta-posterior.mjs estado
//
// Se pide como MARKETING: es una oferta comercial, y pedirla como UTILITY solo
// lograría que Meta la recategorice (como pasó con las condolencias) o la
// rechace. `estado` guarda la categoría QUE META LE DIO.
//
// Los cuatro botones son de respuesta rápida (QUICK_REPLY): sí salen fuera de
// la ventana de 24 h. 🪤 Tope 25 caracteres y SIN emojis ni tildes raras
// (error 2388060, 10-nov): por eso «No deseo informacion» va sin emoji.
//
// `estado` NO enciende el flujo: eso se hace en /automatizaciones, a propósito,
// por una persona — y al encender, `arranque_desde` pasa a ser ese día.
//
// Se crea en la WABA del agente que tiene la línea de familias (LINEA_WA_ID).
import { pool } from '../src/db.js'
import { LINEA_WA_ID } from '../src/linea-wa.js'
import { crearPlantilla, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { CUERPO_PLANTILLA, BOTONES } from '../src/oferta-posterior.js'

const NOMBRE = 'oferta_posterior_servicio'
const IDIOMA = 'es_MX'

const [accion = 'estado'] = process.argv.slice(2)

async function agenteDeFamilias() {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM public.agente_wa WHERE $1 = ANY(phone_number_ids) ORDER BY id`, [LINEA_WA_ID]
  )
  if (rows.length !== 1) throw new Error(`Se esperaba un agente con la línea ${LINEA_WA_ID} y hay ${rows.length}`)
  return rows[0]
}

async function crear() {
  const agente = await agenteDeFamilias()
  console.log(`Agente: ${agente.nombre} (#${agente.id}) · línea ${LINEA_WA_ID}`)
  const r = await crearPlantilla({
    nombre: NOMBRE, idioma: IDIOMA, categoria: 'MARKETING', formato: 'POSITIONAL', agenteId: agente.id,
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
  await pool.query(
    `INSERT INTO public.config_operativa (modulo, clave, valor)
     VALUES ('OFERTA_POSTERIOR', 'plantilla', $1::jsonb)
     ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [JSON.stringify({ nombre: NOMBRE, idioma: IDIOMA, categoria: p.category || 'MARKETING' })]
  )
  const { rows: cfg } = await pool.query(
    `SELECT clave, valor FROM public.config_operativa
      WHERE modulo = 'OFERTA_POSTERIOR' AND clave IN ('activo', 'plantilla', 'arranque_desde')
      ORDER BY clave`)
  cfg.forEach(c => console.log(`  ${c.clave} = ${JSON.stringify(c.valor)}`))
  console.log('✅ Configurada. Para que empiece a salir, enciéndela en /automatizaciones.')
}

try {
  if (accion === 'crear') await crear()
  else await estado()
} catch (e) {
  console.error('ERROR:', e.message)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
