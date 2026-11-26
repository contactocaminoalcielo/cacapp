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
    clave: 'cadena_imagenes',
    nombre: 'Imágenes: si no le llega al cliente',
    descripcion: 'Si la solicitud de imágenes no le llega por un problema del número, Orbit prueba el otro celular del cliente y luego le pide apoyo a la veterinaria que lo remitió. Cada paso queda como novedad del servicio.',
    quien: 'A la familia y a la clínica',
    cron: 'Cada 10 min, 7:00 a 20:00',
    interruptor: { modulo: 'SOLICITUDES_IMAGENES', clave: 'cadena_contacto_activa' },
    // La plantilla que falta es la de la clínica; la del cliente es la del 1er contacto.
    plantillaCfg: { modulo: 'SOLICITUDES_IMAGENES', clave: 'plantilla_apoyo_vet' },
    sql: {
      tabla: 'public.solicitud_imagenes_cadena',
      fecha: 'created_at',
      filtro: "canal IN ('CLIENTE_ALTERNO', 'VETERINARIA')",
      ok: "estado IN ('ENVIADO', 'LLEGO')",
      error: "estado = 'ERROR'",
      pendiente: "estado = 'SIN_PLANTILLA'",
    },
  },
  {
    clave: 'cierre_sin_fotos',
    nombre: 'Sin fotos: digitales sin memorial y cierre',
    descripcion: 'Ecogrupal y Básico: 15 días después del 3er aviso sin fotos, la familia recibe los digitales con «(no recibimos la foto)» en el lugar del memorial, el Memorial sale de Diseño y el servicio pasa a ENTREGADO. En el Básico el Memopet queda pendiente. Un servicio con un adicional que necesita foto no se cierra solo: queda en «por revisar» con alerta.',
    quien: 'A la familia',
    cron: '11:30, lunes a viernes (sin festivos)',
    interruptor: { modulo: 'CIERRE_SIN_FOTOS', clave: 'activo' },
    // Al encender, `arranque_desde` = hoy: no se va contra los atrasados.
    arranqueAlEncender: true,
    plantillaCfg: { modulo: 'DIGITALES', clave: 'plantilla_memorial' },
    sql: {
      tabla: 'public.cierre_sin_fotos',
      fecha: 'enviado_en',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      pendiente: "estado IN ('OMITIDO', 'ENVIANDO')",
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
    clave: 'evidencia_inicio',
    nombre: 'Evidencias del inicio del compostaje',
    descripcion: 'Al iniciar el compostaje se preparan las fotos del cubículo enmarcadas. Coordinación las revisa y las envía con un clic desde Tenjo → Evidencias: no salen solas.',
    quien: 'A la familia',
    cron: 'Al iniciar el proceso, con revisión',
    interruptor: { modulo: 'EVIDENCIA_INICIO', clave: 'activo' },
    plantillaCfg: { modulo: 'EVIDENCIA_INICIO', clave: 'plantilla' },
    sql: {
      tabla: 'public.evidencias_familia',
      fecha: 'fecha_envio',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      pendiente: "estado = 'POR_REVISAR'",
    },
  },
  {
    clave: 'aviso_tiempos',
    nombre: 'Tiempos al ingresar al cuarto frío',
    descripcion: 'Apenas la mascota entra al cuarto frío, la familia recibe los tiempos de su proceso: el certificado (3 días hábiles, solo en eco-grupal, básico, standard, desamparado y Ángel), que le llegará el enlace de las fotos, y cuánto tardan los recordatorios desde que las envía. En compostaje individual, los 2 a 3 meses del proceso.',
    quien: 'A la familia',
    cron: 'Cada 10 min, 7:00 a 20:00',
    interruptor: { modulo: 'AVISO_TIEMPOS', clave: 'activo' },
    // Al encender, `arranque_desde` = hoy: nada de los ingresos de antes.
    arranqueAlEncender: true,
    plantillaCfg: { modulo: 'AVISO_TIEMPOS', clave: 'plantilla' },
    sql: {
      tabla: 'public.avisos_tiempos_ingreso',
      fecha: 'fecha_envio',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      pendiente: "estado = 'ENVIANDO'",
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
    clave: 'encuesta_entrega',
    nombre: 'Encuesta de satisfacción post-entrega',
    descripcion: 'Al día siguiente de la entrega: «¿cómo calificarías tu experiencia?» con 😊 Bueno · 😐 Regular · ☹️ Malo. Bueno recibe el enlace de reseña en Google; Regular y Malo, un formulario y quedan por atender en NPS (Malo abre una PQR).',
    quien: 'A la familia',
    cron: '10:00, lunes a viernes (sin festivos)',
    interruptor: { modulo: 'ENCUESTA_ENTREGA', clave: 'activo' },
    plantillaCfg: { modulo: 'ENCUESTA_ENTREGA', clave: 'plantilla' },
    sql: {
      tabla: 'public.nps_seguimiento',
      fecha: 'envio_en',
      // Solo lo que tocó la automatización: las 1384 viejas tienen envio_estado NULL.
      filtro: "tipo = 'POST_ENTREGA' AND envio_estado IS NOT NULL",
      ok: "envio_estado = 'ENVIADO'",
      error: "envio_estado = 'ERROR'",
      pendiente: "envio_estado IN ('PENDIENTE', 'ENVIANDO')",
    },
  },
  {
    clave: 'condolencias',
    nombre: 'Condolencias al mes del fallecimiento',
    descripcion: 'Un mensaje de cariño recordando a la mascotica al cumplirse un mes del fallecimiento, solo si el servicio ya se entregó (y nunca antes de 3 días tras la entrega). Lo programado del día se ve en /condolencias.',
    quien: 'A la familia',
    cron: '11:00, lunes a viernes (sin festivos)',
    interruptor: { modulo: 'CONDOLENCIAS', clave: 'activo' },
    // Al encender, `arranque_desde` = hoy: nada de lo programado mientras estuvo apagado.
    arranqueAlEncender: true,
    plantillaCfg: { modulo: 'CONDOLENCIAS', clave: 'plantilla' },
    sql: {
      tabla: 'public.condolencias',
      fecha: 'fecha_envio',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      // Solo lo que ya tocaba: lo programado para la otra semana no está «por enviar».
      pendiente: "estado IN ('PENDIENTE', 'ENVIANDO') AND fecha_programada <= public.fn_hoy_bogota()",
    },
  },
  {
    clave: 'oferta_posterior',
    nombre: 'Oferta posterior al servicio',
    descripcion: 'Unos dos meses después del fallecimiento (y un mes después de las condolencias) le ofrece a la familia recordatorios adicionales, planes pre-exequiales y cédulas, con cuatro botones. No sale a quien pidió no recibir información, calificó mal la encuesta o tiene una queja. Lo programado y las oportunidades se ven en /ventas-posteriores.',
    quien: 'A la familia',
    cron: '14:00, lunes a viernes (sin festivos)',
    interruptor: { modulo: 'OFERTA_POSTERIOR', clave: 'activo' },
    // Al encender, `arranque_desde` = hoy: nada de lo programado mientras estuvo apagado.
    arranqueAlEncender: true,
    plantillaCfg: { modulo: 'OFERTA_POSTERIOR', clave: 'plantilla' },
    sql: {
      tabla: 'public.ofertas_posteriores',
      fecha: 'fecha_envio',
      ok: "estado = 'ENVIADO'",
      error: "estado = 'ERROR'",
      pendiente: "estado IN ('PENDIENTE', 'ENVIANDO') AND fecha_programada <= public.fn_hoy_bogota()",
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
  // «Solo de aquí en adelante» (condolencias): al encender, lo programado para
  // los días en que estuvo apagado NO sale de golpe — el arranque es hoy.
  const flujo = FLUJOS.find(f => f.clave === clave)
  if (activo && flujo?.arranqueAlEncender) {
    await pool.query(
      `UPDATE public.config_operativa SET valor = to_jsonb(public.fn_hoy_bogota()::text)
        WHERE modulo = $1 AND clave = 'arranque_desde'`, [destino.modulo])
  }
  log('[automatizaciones]', clave, activo ? 'ENCENDIDO' : 'APAGADO')
  return { status: 200, body: { ok: true, clave, activo: !!activo } }
}
