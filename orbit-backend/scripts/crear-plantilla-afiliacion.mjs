// Crea en Meta la plantilla con el enlace de afiliación para veterinarias
// (CRM: "Compartir enlace de afiliación" al registrar una visita o en /crm/invitar).
//
// Hace falta porque fuera de la ventana de 24 h WhatsApp no deja mandar texto
// libre: a una clínica que nunca nos ha escrito solo le llega una plantilla.
//
// Corre DENTRO del contenedor del backend: usa sus credenciales y su base.
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-afiliacion.mjs crear
//   docker exec -w /app orbit-backend node scripts/crear-plantilla-afiliacion.mjs estado
//
// Se crea en la WABA del agente VETERINARIAS: es por donde sale el envío, y
// cada cuenta tiene sus propias plantillas.
import { pool } from '../src/db.js'
import { crearPlantilla, listarPlantillas } from '../src/whatsapp-plantillas.js'
import { enlaceAfiliacion } from '../src/aliados.js'

// Mismo nombre que PLANTILLA_AFILIACION en src/crm.js (no se importa: crm.js arrastra todo el router).
const PLANTILLA_AFILIACION = 'invitacion_afiliacion_vet'
const IDIOMA = 'es_MX'
// Sin variables: sirve igual para una aliada de la cartera que para un
// establecimiento recién visitado. El enlace va en un botón (el modelo y los
// clientes de WhatsApp recortan los enlaces largos del texto).
const CUERPO = 'Hola 👋 Somos Camino al Cielo, servicio funerario para mascotas. '
  + 'Te compartimos el enlace para registrar tu clínica o veterinaria como aliada: '
  + 'así puedes solicitar recogidas fácilmente y hacer seguimiento a cada servicio. '
  + 'El registro toma pocos minutos. Si tienes dudas, responde a este mensaje.'

const [accion = 'estado'] = process.argv.slice(2)

async function agenteVets() {
  const { rows } = await pool.query(`SELECT id, nombre FROM public.agente_wa WHERE clave = 'VETERINARIAS'`)
  if (rows.length !== 1) throw new Error(`Se esperaba un agente VETERINARIAS y hay ${rows.length}`)
  return rows[0]
}

async function main() {
  const agente = await agenteVets()
  if (accion === 'crear') {
    const r = await crearPlantilla({
      nombre: PLANTILLA_AFILIACION, idioma: IDIOMA, categoria: 'MARKETING', agenteId: agente.id,
      componentes: [
        { type: 'BODY', text: CUERPO },
        { type: 'FOOTER', text: 'Camino al Cielo' },
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Registrar mi clínica', url: enlaceAfiliacion() }] },
      ],
    })
    console.log(JSON.stringify(r.body, null, 2))
  } else {
    const r = await listarPlantillas({ agenteId: agente.id })
    const p = (r.body?.plantillas || r.plantillas || []).filter(x => x.name === PLANTILLA_AFILIACION || x.nombre === PLANTILLA_AFILIACION)
    console.log(p.length ? JSON.stringify(p.map(x => ({ nombre: x.name || x.nombre, estado: x.status || x.estado, categoria: x.category || x.categoria })), null, 2)
      : `No existe ${PLANTILLA_AFILIACION} en la WABA de ${agente.nombre}`)
  }
  await pool.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
