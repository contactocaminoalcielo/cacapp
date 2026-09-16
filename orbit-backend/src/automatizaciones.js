// Tablero de lo que Orbit manda SOLO — resumen server-side.
//
// Pedido de David el 2026-09-16: «un espacio de seguimiento de todos los
// contactos automatizados, para tener control de lo que está pasando».
//
// El problema real que resuelve: cada flujo automático vive en su propia
// pantalla (imágenes en Seguimiento, plantas en Tenjo, el aviso a la vet en
// ninguna), y el interruptor de cada uno vive en `config_operativa`, donde solo
// se ve por psql. Nadie podía responder de un vistazo "¿qué está saliendo hoy
// sin que nadie lo toque?" — ni notar que un flujo lleva tres días mudo.
//
// ⚠️ TODO SE CUENTA EN SQL, nunca trayendo filas. `solicitud_imagenes_contactos`
// ya tiene 1508 registros y PostgREST corta en 1000 sin avisar: contar en el
// navegador daría un número tranquilizador y falso.
//
// Cada flujo se consulta por separado y con su propio try/catch: si una tabla
// no existe todavía (una migración que falta), esa tarjeta sale "no disponible"
// y el resto del tablero sigue en pie.
import { pool, log } from './db.js'

/**
 * Catálogo de lo automático. Es la fuente de verdad del tablero: agregar un
 * flujo nuevo es agregar una fila aquí.
 *
 * `interruptor` apunta a la llave de `config_operativa` que lo enciende. Sin
 * interruptor (null) el flujo no se puede apagar desde la pantalla — o porque
 * lo dispara una persona, o porque no tiene switch.
 */
export const FLUJOS = [
  {
    clave: 'imagenes',
    nombre: 'Solicitud de imágenes (2º y 3er contacto)',
    descripcion: 'Le insiste a la familia que no ha subido las fotos. El 1er contacto lo manda una persona desde la bandeja; estos dos salen solos.',
    quien: 'A la familia',
    cron: '10:30, lunes a viernes',
    interruptor: { modulo: 'SOLICITUDES_IMAGENES', clave: 'seguimiento_activo' },
    plantillaCfg: { modulo: 'SOLICITUDES_IMAGENES', clave: 'plantilla_contacto_2' },
    sql: {
      tabla: 'public.solicitud_imagenes_contactos',
      fecha: 'enviado_en',
      // El 1º es manual: mezclarlo inflaría el conteo de lo automático.
      filtro: "numero >= 2",
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
    },
  },
  {
    clave: 'aviso_vet',
    nombre: 'Aviso de recogida a la veterinaria',
    descripcion: 'Cuando el técnico inicia ruta y pone su hora, la clínica recibe sola el aviso por la línea de veterinarias.',
    quien: 'A la clínica',
    cron: 'Al iniciar ruta el técnico',
    interruptor: { modulo: 'AVISO_VET_RECOGIDA', clave: 'activo' },
    plantillaCfg: { modulo: 'AVISO_VET_RECOGIDA', clave: 'plantilla' },
    sql: {
      tabla: 'public.recogidas',
      fecha: 'aviso_vet_enviado_en',
      ok: 'aviso_vet_enviado_en IS NOT NULL',
      // 🪤 Un fallo suelta la reclama y devuelve `aviso_vet_enviado_en` a NULL:
      // contar errores sobre esa columna los esconde justo a ellos.
      error: 'aviso_vet_error IS NOT NULL',
    },
  },
  {
    clave: 'aviso_cliente',
    nombre: 'Aviso de la hora a la familia (wa.me)',
    descripcion: 'El mismo aviso, para lo que no cubre la línea de clínicas. NO es automático: lo manda el coordinador desde su celular y aquí queda el registro.',
    quien: 'A la familia',
    cron: 'Lo manda una persona',
    interruptor: null,
    sql: {
      tabla: 'public.recogidas',
      fecha: 'aviso_cliente_enviado_en',
      ok: 'aviso_cliente_enviado_en IS NOT NULL',
    },
  },
  {
    clave: 'plantas',
    nombre: 'Elección de planta (fin del compostaje)',
    descripcion: 'Al cumplirse el compostaje, la familia recibe el enlace para escoger la especie de planta y comprar extras.',
    quien: 'A la familia',
    cron: '07:15, todos los días',
    interruptor: { modulo: 'PLANTAS', clave: 'activo' },
    plantillaCfg: { modulo: 'PLANTAS', clave: 'plantilla' },
    sql: {
      tabla: 'public.planta_elecciones',
      fecha: 'fecha_envio',
      ok: "estado IN ('ENVIADO', 'ELEGIDA')",
      error: "estado = 'ERROR'",
      pendiente: "estado = 'PENDIENTE'",
    },
  },
  {
    clave: 'mitad_compostaje',
    nombre: 'Mitad del compostaje + visita a la planta',
    descripcion: 'A la mitad del proceso de cada mascota: «va con normalidad» y la invitación a visitar el cubículo.',
    quien: 'A la familia',
    cron: '07:25, todos los días',
    interruptor: { modulo: 'MITAD_COMPOSTAJE', clave: 'activo' },
    plantillaCfg: { modulo: 'MITAD_COMPOSTAJE', clave: 'plantilla' },
    sql: {
      tabla: 'public.avisos_mitad_compostaje',
      fecha: 'fecha_envio',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      pendiente: "estado = 'PENDIENTE'",
    },
  },
  {
    clave: 'digitales',
    nombre: 'Entrega de digitales y memorial',
    descripcion: 'Manda los enlaces de las piezas digitales cuando están listas. ⚠️ El interruptor solo gobierna el envío AUTOMÁTICO: los números incluyen también lo que manda una persona desde Digitales.',
    quien: 'A la familia',
    cron: 'Cada 10 min, de 7 a 20 h',
    interruptor: { modulo: 'DIGITALES', clave: 'envio_automatico_activo' },
    sql: {
      tabla: 'public.digitales_envios',
      fecha: 'enviado_en',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
    },
  },
  {
    clave: 'grupales',
    nombre: 'Certificados de reportes grupales',
    descripcion: 'Envía el certificado del proceso grupal a cada familia del lote. No tiene interruptor: se dispara al cerrar el reporte del lote.',
    quien: 'A la familia',
    cron: '06:45, todos los días',
    interruptor: null,
    plantillaCfg: { modulo: 'REPORTES_GRUPALES', clave: 'plantilla_nombre' },
    sql: {
      tabla: 'public.reportes_grupales_envios',
      fecha: 'created_at',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
    },
  },
]

/** Los interruptores que la pantalla puede tocar. Lista blanca a propósito. */
export const INTERRUPTORES = Object.fromEntries(
  FLUJOS.filter(f => f.interruptor).map(f => [f.clave, f.interruptor])
)

export async function resumenAutomatizaciones() {
  const client = await pool.connect()
  try {
    const { rows: cfg } = await client.query(
      `SELECT modulo, clave, valor FROM public.config_operativa`
    )
    const config = {}
    cfg.forEach(r => { config[`${r.modulo}.${r.clave}`] = r.valor })

    const flujos = []
    for (const f of FLUJOS) {
      const base = {
        clave: f.clave, nombre: f.nombre, descripcion: f.descripcion,
        quien: f.quien, cron: f.cron,
        interruptor: f.interruptor ? `${f.interruptor.modulo}.${f.interruptor.clave}` : null,
        activo: f.interruptor ? esVerdad(config[`${f.interruptor.modulo}.${f.interruptor.clave}`]) : null,
        plantilla: f.plantillaCfg ? nombrePlantilla(config[`${f.plantillaCfg.modulo}.${f.plantillaCfg.clave}`]) : null,
      }
      try {
        flujos.push({ ...base, ...await contar(client, f.sql), disponible: true })
      } catch (e) {
        // Tabla o columna que todavía no existe (migración sin aplicar). Se
        // dice en la tarjeta en vez de tumbar el tablero entero.
        log('[automatizaciones] sin datos para', f.clave, '—', e.message)
        flujos.push({ ...base, disponible: false, motivo: e.message })
      }
    }
    return { ok: true, flujos, generado_en: new Date().toISOString() }
  } finally {
    client.release()
  }
}

/**
 * Los conteos de un flujo, en UNA consulta y agregando en el motor.
 *
 * Las piezas de SQL vienen del catálogo de arriba (constantes del código, no de
 * la petición): no hay nada del usuario que se interpole aquí.
 */
async function contar(client, s) {
  const filtro = s.filtro ? `(${s.filtro})` : 'TRUE'
  const ok     = s.ok || 'TRUE'
  const error  = s.error || 'FALSE'
  const pend   = s.pendiente || 'FALSE'
  const { rows } = await client.query(`
    SELECT
      count(*) FILTER (WHERE ${ok} AND (${s.fecha} AT TIME ZONE 'America/Bogota')::date = public.fn_hoy_bogota())::int AS hoy,
      count(*) FILTER (WHERE ${ok} AND ${s.fecha} >= now() - interval '7 days')::int  AS semana,
      count(*) FILTER (WHERE ${ok} AND ${s.fecha} >= now() - interval '30 days')::int AS mes,
      count(*) FILTER (WHERE ${ok})::int      AS total,
      count(*) FILTER (WHERE ${error})::int   AS errores,
      count(*) FILTER (WHERE ${pend})::int    AS pendientes,
      max(${s.fecha}) FILTER (WHERE ${ok})    AS ultimo_envio
    FROM ${s.tabla}
    WHERE ${filtro}
  `)
  return rows[0]
}

/** El jsonb de config llega como true, "true" o null. */
function esVerdad(v) {
  if (v === true) return true
  const s = String(v ?? '').replace(/"/g, '').trim().toLowerCase()
  return s === 'true'
}

/** El nombre de la plantilla, venga como objeto {nombre} o como cadena suelta. */
function nombrePlantilla(v) {
  if (!v) return null
  const p = typeof v === 'string' ? safeJson(v) ?? v : v
  if (typeof p === 'string') return p.replace(/"/g, '') || null
  return p?.nombre || null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

/**
 * Enciende o apaga un flujo. Solo las llaves de la lista blanca: esto escribe
 * en `config_operativa`, que es de donde comen todos los jobs.
 */
export async function cambiarInterruptor({ clave, activo }) {
  const destino = INTERRUPTORES[clave]
  if (!destino) return { status: 404, body: { ok: false, error: 'flujo_desconocido' } }
  const { rowCount } = await pool.query(
    `UPDATE public.config_operativa SET valor = $3::jsonb
      WHERE modulo = $1 AND clave = $2`,
    [destino.modulo, destino.clave, activo ? 'true' : 'false']
  )
  if (!rowCount) return { status: 404, body: { ok: false, error: 'config_no_encontrada' } }
  log('[automatizaciones]', clave, activo ? 'ENCENDIDO' : 'APAGADO')
  return { status: 200, body: { ok: true, clave, activo: !!activo } }
}
