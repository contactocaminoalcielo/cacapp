// Crea en Meta la plantilla de las evidencias del inicio del compostaje
// (migración 178) y, cuando Meta la aprueba, la deja configurada en Orbit.
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-evidencia.mjs crear
//   (sin archivo: dibuja el ejemplo aquí mismo con el marco real y dos fotos de
//    una evidencia ya hecha; con una ruta, usa esa imagen)
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-evidencia.mjs estado
//
// Se crea en la WABA del agente que tiene la línea de familias (LINEA_WA_ID):
// es por donde sale el envío, y cada cuenta tiene sus propias plantillas.
import fs from 'node:fs'
import { pool } from '../src/db.js'
import { LINEA_WA_ID } from '../src/linea-wa.js'
import { crearPlantilla, subirCabecera, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { renderImagen, cerrarPdf } from '../src/pdf.js'
import { htmlMarcoEvidencia, FORMATOS } from '../src/pdf-plantillas/marco-evidencia.js'

// Ejemplo para la revisión de Meta: Godzilla, compostaje del 15-oct-2026.
const EJEMPLO = {
  mascota: 'Godzilla', fecha: '2026-10-15T22:37:37Z',
  fotos: [
    'https://db.orbitacac.com/storage/v1/object/public/evidencias/tenjo/dd1cfc4e-fbdd-4e25-ba27-3f243693d9dc/1792103842074.jpg',
    'https://db.orbitacac.com/storage/v1/object/public/evidencias/tenjo/dd1cfc4e-fbdd-4e25-ba27-3f243693d9dc/1792103844119.jpg',
  ],
}

async function imagenDeEjemplo() {
  const fotos = []
  for (const url of EJEMPLO.fotos) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`No se pudo bajar la foto de ejemplo (${r.status})`)
    fotos.push({ dataUri: 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64') })
  }
  const { ancho, alto } = FORMATOS.horizontal
  const html = htmlMarcoEvidencia({ fotos, mascota: EJEMPLO.mascota, fecha: EJEMPLO.fecha, formato: 'horizontal' })
  return renderImagen({ html, ancho, alto })
}

const NOMBRE = 'evidencia_inicio_compostaje'
const IDIOMA = 'es_MX'
// Texto elegido por David el 2026-10-16 (opción 1).
const CUERPO = 'Hola {{1}} 🌿 Con mucho cariño te compartimos que hoy iniciamos el proceso de compostaje de {{2}}. '
  + 'Lo acompañamos con todo el respeto y el amor que merece. Gracias por confiar en nosotros. — Camino al Cielo'

const [accion = 'estado', rutaImagen] = process.argv.slice(2)

async function agenteDeFamilias() {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM public.agente_wa WHERE $1 = ANY(phone_number_ids) ORDER BY id`, [LINEA_WA_ID]
  )
  if (rows.length !== 1) throw new Error(`Se esperaba un agente con la línea ${LINEA_WA_ID} y hay ${rows.length}`)
  return rows[0]
}

async function crear() {
  const imagen = rutaImagen ? fs.readFileSync(rutaImagen) : await imagenDeEjemplo()
  const agente = await agenteDeFamilias()
  console.log(`Agente: ${agente.nombre} (#${agente.id})`)

  // guardar:false — la foto de ejemplo NO debe quedar como cabecera fija: cada
  // envío lleva su propio marco, y una cabecera fija haría que un envío manual
  // desde la bandeja le mandara a otra familia la foto del ejemplo.
  const sub = await subirCabecera({
    base64: imagen.toString('base64'),
    mime: 'image/jpeg', nombre: 'ejemplo-evidencia.jpg', agenteId: agente.id, guardar: false,
  })
  if (!sub.body.ok) throw new Error('Subida de la imagen: ' + sub.body.error)

  const r = await crearPlantilla({
    nombre: NOMBRE, idioma: IDIOMA, categoria: 'UTILITY', formato: 'POSITIONAL', agenteId: agente.id,
    componentes: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [sub.body.handle] } },
      { type: 'BODY', text: CUERPO, example: { body_text: [['María', 'Godzilla']] } },
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
  if (!p) { console.log(`No existe todavía ${NOMBRE} en la cuenta ${r.body.waba}.`); return }
  console.log(`${NOMBRE}: ${p.status} · categoría ${p.category}`)
  if (p.status === 'APPROVED') {
    await pool.query(
      `INSERT INTO public.config_operativa (modulo, clave, valor)
       VALUES ('EVIDENCIA_INICIO', 'plantilla', $1::jsonb)
       ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [JSON.stringify({ nombre: NOMBRE, idioma: IDIOMA, categoria: 'UTILITY', vars: ['nombre', 'mascota'] })]
    )
    console.log('✅ Configurada en Orbit: el botón "Enviar por WhatsApp" ya funciona.')
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
  await cerrarPdf().catch(() => {})
  await pool.end().catch(() => {})
}
