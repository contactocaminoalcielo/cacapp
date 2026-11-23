// Plantilla del AVISO DE TIEMPOS al ingresar al cuarto frío (migración 214).
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-aviso-tiempos.mjs crear
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-aviso-tiempos.mjs estado
//
// `estado`: si Meta ya la aprobó, la deja configurada en AVISO_TIEMPOS.plantilla
// con la categoría QUE META LE DIO. NO enciende el flujo: eso se hace en
// /automatizaciones, a propósito, por una persona — y al encender,
// `arranque_desde` pasa a ser ese día.
//
// Se crea en la WABA del agente que tiene la línea de familias (LINEA_WA_ID).
import { pool } from '../src/db.js'
import { LINEA_WA_ID } from '../src/linea-wa.js'
import { crearPlantilla, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { CUERPO_PLANTILLA } from '../src/aviso-tiempos-reglas.js'

const NOMBRE = 'tiempos_ingreso_cuarto_frio'
const IDIOMA = 'es_MX'

// Ejemplo para la revisión de Meta: el caso más común (básico con Memopet).
const EJEMPLO = [
  'Luna',
  '📄 El certificado estará listo en 3 días hábiles a partir de la recogida. 📸 Pronto te enviaremos ' +
  'por este medio un enlace para que nos compartas las fotos de los recordatorios; estarán listos de ' +
  '8 a 10 días hábiles (el Memopet, 15 días hábiles) después de recibir las fotos completas.',
]

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
    nombre: NOMBRE, idioma: IDIOMA, categoria: 'UTILITY', formato: 'POSITIONAL', agenteId: agente.id,
    componentes: [
      { type: 'BODY', text: CUERPO_PLANTILLA, example: { body_text: [EJEMPLO] } },
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
     VALUES ('AVISO_TIEMPOS', 'plantilla', $1::jsonb)
     ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [JSON.stringify({ nombre: NOMBRE, idioma: IDIOMA, categoria: p.category || 'UTILITY' })]
  )
  const { rows: cfg } = await pool.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'AVISO_TIEMPOS' ORDER BY clave`)
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
