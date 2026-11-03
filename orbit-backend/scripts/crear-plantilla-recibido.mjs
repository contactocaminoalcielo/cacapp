// Crea en Meta la plantilla del aviso de plazo que sale cuando la familia
// termina el portal de fotos (REPORTE ORBIT 2026-11-03) y, cuando Meta la
// aprueba, la deja configurada en Orbit (SOLICITUDES_IMAGENES.plantilla_recibido).
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-recibido.mjs crear
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-recibido.mjs estado
//
// Se crea en la WABA del agente que tiene la línea de familias (LINEA_WA_ID):
// es por donde sale el envío, y cada cuenta tiene sus propias plantillas.
import { pool } from '../src/db.js'
import { LINEA_WA_ID } from '../src/linea-wa.js'
import { crearPlantilla, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { CUERPO_RECIBIDO } from '../src/reglas-imagenes.js'

const NOMBRE = 'recordatorios_recibidos_plazo'
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
  console.log(`Agente: ${agente.nombre} (#${agente.id})`)
  const r = await crearPlantilla({
    nombre: NOMBRE, idioma: IDIOMA, categoria: 'UTILITY', formato: 'POSITIONAL', agenteId: agente.id,
    componentes: [{ type: 'BODY', text: CUERPO_RECIBIDO, example: { body_text: [['Luna', '8 a 10']] } }],
  })
  console.log(JSON.stringify(r.body, null, 2))
  if (r.body.ok) await estado()
}

async function estado() {
  const agente = await agenteDeFamilias()
  const r = await listarPlantillas({ agenteId: agente.id })
  if (!r.body.ok) throw new Error(r.body.error)
  const p = r.body.plantillas.find(x => x.name === NOMBRE && x.language === IDIOMA)
  if (!p) { console.log(`No existe todavía ${NOMBRE} en la cuenta ${r.body.waba}.`); return }
  console.log(`${NOMBRE}: ${p.status} · categoría ${p.category}`)
  if (p.status === 'APPROVED') {
    await pool.query(
      `INSERT INTO public.config_operativa (modulo, clave, valor)
       VALUES ('SOLICITUDES_IMAGENES', 'plantilla_recibido', $1::jsonb)
       ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [JSON.stringify({ nombre: NOMBRE, idioma: IDIOMA, categoria: p.category || 'UTILITY' })]
    )
    console.log('✅ Configurada en Orbit: el aviso de plazo ya sale al terminar el portal.')
  } else {
    console.log('Aún no está aprobada: Orbit no se toca. Vuelve a correr con "estado" más tarde.')
  }
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
