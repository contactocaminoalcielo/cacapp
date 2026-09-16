// Visitas de la familia a la planta de Tenjo — lado servidor.
//
// La agenda existe desde la migración 059 y la maneja coordinación. Lo que se
// agrega aquí (migración 159) es la otra puerta: la familia pide la visita
// desde un enlace público, y su solicitud entra como `SOLICITADA` en la MISMA
// tabla, para que la casa la valide contra la jornada de la planta.
//
// Frase rectora, heredada del portal de plantas: **nada de lo que decide la
// operación viene del navegador**. El enlace muestra días; al guardar, el día
// se vuelve a calcular aquí y se rechaza el que no esté en la lista. Un
// navegador con la pestaña abierta desde ayer, o alguien curioseando el POST,
// no puede meter una visita un domingo.
//
// Y la visita NO queda confirmada: se pide. Quien confirma es la casa.
import { pool, log } from './db.js'
import { cargarConfig as cargarConfigTenjo } from './reglas.js'

const MOD = 'VISITAS_TENJO'

export const CONFIG_DEFAULTS_VISITAS = {
  // Margen para validar contra la jornada y avisarle a la familia. Con menos,
  // se le prometería un día que quizá nadie alcanza a mirar.
  dias_anticipacion_min: 3,
  dias_ofrecidos:        6,
  max_por_dia:           3,
  dias_ventana_portal:   90,
  franjas: [
    { clave: 'MANANA', label: 'En la mañana', detalle: '9:00 a. m. – 12:00 m.' },
    { clave: 'TARDE',  label: 'En la tarde',  detalle: '1:00 – 4:00 p. m.' },
  ],
}

export async function cargarConfigVisitas(client) {
  const cfg = { ...CONFIG_DEFAULTS_VISITAS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/** Enlace público (HashRouter), mismo código secreto del portal de fotos. */
export function construirEnlaceVisita(codigo) {
  const base = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')
  return `${base}/#/visita/${codigo}`
}

/** Franjas normalizadas (la config es jsonb y pudo quedar malformada). */
export function franjasDe(cfg) {
  const raw = typeof cfg.franjas === 'string' ? safeJson(cfg.franjas) : cfg.franjas
  const arr = Array.isArray(raw) ? raw : CONFIG_DEFAULTS_VISITAS.franjas
  return arr
    .filter(f => f && (f.clave === 'MANANA' || f.clave === 'TARDE'))
    .map(f => ({ clave: f.clave, label: String(f.label || ''), detalle: String(f.detalle || '') }))
}

/**
 * Días que el enlace le ofrece a la familia.
 *
 * ⚠️ Son los DÍAS DE OPERACIÓN de la planta (`TENJO.dias_operacion`, hoy mar/jue/
 * sáb), no los lotes existentes. Se intentó con los lotes y no sirve: se crean
 * con uno o dos días de anticipación — al 16-sep había UNA sola jornada futura
 * en la base. Ofrecer "los lotes" habría dejado el enlace prácticamente vacío.
 *
 * Un día se cae de la lista cuando ya tiene `max_por_dia` visitas vivas.
 */
export async function diasDisponiblesVisita(client, cfgVisitas = null, cfgTenjo = null) {
  const cfgV = cfgVisitas || await cargarConfigVisitas(client)
  const cfgT = cfgTenjo   || await cargarConfigTenjo(client)

  // "Hoy" lo dice la base, no el contenedor: una columna DATE comparada contra
  // un new Date() de otra zona corre las fechas un día (ver feedback de fechas).
  const { rows: hoyRows } = await client.query(`SELECT public.fn_hoy_bogota()::text AS hoy`)
  const hoy = hoyRows[0].hoy

  const diasOperacion = Array.isArray(cfgT.dias_operacion) ? cfgT.dias_operacion : [2, 4, 6]
  const anticipacion  = num(cfgV.dias_anticipacion_min, 3)
  const cuantos       = num(cfgV.dias_ofrecidos, 6)
  const cupo          = num(cfgV.max_por_dia, 3)

  // Candidatos: los próximos días de operación a partir de hoy + anticipación.
  const fechas = []
  const d = new Date(`${hoy}T12:00:00`)   // mediodía: inmune a DST y a UTC
  for (let i = 1; i <= 120 && fechas.length < cuantos; i++) {
    d.setDate(d.getDate() + 1)
    if (i < anticipacion) continue
    if (diasOperacion.includes(d.getDay())) fechas.push(iso(d))
  }
  if (!fechas.length) return []

  // Ocupación: solo cuentan las vivas. Una cancelada no bloquea el cupo.
  const { rows: ocup } = await client.query(
    `SELECT fecha_visita::text AS fecha, count(*)::int AS n
       FROM public.visitas_tenjo
      WHERE fecha_visita = ANY($1::date[])
        AND estado IN ('SOLICITADA', 'PROGRAMADA')
      GROUP BY 1`,
    [fechas]
  )
  const porFecha = {}
  ocup.forEach(o => { porFecha[o.fecha] = o.n })

  return fechas
    .filter(f => (porFecha[f] || 0) < cupo)
    .map(f => ({ fecha: f, dia: nombreDia(f) }))
}

/**
 * Lo que ve la familia al abrir el enlace.
 *
 * Nunca devuelve el error real de la DB (filtra el esquema y no le dice nada a
 * la familia): quien llama traduce con `errorInterno`.
 */
export async function datosPortalVisita({ codigo }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const client = await pool.connect()
  try {
    // El aviso de mitad de compostaje es la puerta de entrada: sin él no hay
    // enlace. Se busca por ahí y no por `servicios.codigo_fotos` para no abrirle
    // el portal de visitas a toda familia que tenga el código de fotos — solo
    // tiene sentido mientras la mascota está en el cubículo.
    const { rows } = await client.query(
      `SELECT a.id, a.servicio_id, a.fecha_mitad::text AS fecha_mitad, a.fecha_envio,
              m.nombre AS mascota, esp.nombre AS especie,
              c.nombre AS cliente_nombre,
              cu.codigo AS cubiculo,
              i.fecha_compostaje_inicio::text AS inicio,
              (i.fecha_compostaje_inicio + (i.meses_compostaje * INTERVAL '1 month'))::date::text AS fin,
              i.cubiculo_liberado_en,
              s.estado AS estado_servicio
         FROM public.avisos_mitad_compostaje a
         JOIN public.servicios s       ON s.id = a.servicio_id
         JOIN public.mascotas m        ON m.id_mascota = s.mascota_id
         LEFT JOIN public.especies esp ON esp.id = m.especie_id
         LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
         LEFT JOIN public.lotes_tenjo_items i ON i.id = a.lote_item_id
         LEFT JOIN public.cubiculos cu ON cu.id = i.cubiculo_id
        WHERE a.codigo = $1 AND s.estado <> 'CANCELADO'
        LIMIT 1`,
      [cod]
    )
    const a = rows[0]
    if (!a) return { status: 404, body: { ok: false, error: 'no_encontrado' } }

    const cfgV = await cargarConfigVisitas(client)

    // La solicitud vigente, si ya pidió. El índice único deja una sola viva.
    const { rows: vis } = await client.query(
      `SELECT id, fecha_visita::text AS fecha_visita, hora_visita::text AS hora_visita,
              franja, personas, estado, novedades
         FROM public.visitas_tenjo
        WHERE servicio_id = $1 AND estado IN ('SOLICITADA', 'PROGRAMADA')
        ORDER BY created_at DESC LIMIT 1`,
      [a.servicio_id]
    )
    const visita = vis[0] || null

    // El enlace se cierra cuando la mascota ya no está en el cubículo (no hay
    // nada que visitar), cuando el servicio se entregó, o al vencer la ventana.
    const cerrado = !!a.cubiculo_liberado_en
      || a.estado_servicio === 'ENTREGADO'
      || fueraDeVentana(a.fecha_envio, cfgV)

    const dias = (cerrado || visita) ? [] : await diasDisponiblesVisita(client, cfgV)

    return { status: 200, body: {
      ok: true,
      cerrado,
      servicio: {
        mascota:        a.mascota,
        especie:        a.especie,
        cubiculo:       a.cubiculo,
        nombre_cliente: (a.cliente_nombre || '').split(' ')[0] || '',
      },
      // Para pintar el avance del proceso: dónde empezó, dónde va, dónde acaba.
      proceso: { inicio: a.inicio, mitad: a.fecha_mitad, fin: a.fin },
      visita,
      dias,
      franjas: franjasDe(cfgV),
    } }
  } finally {
    client.release()
  }
}

/**
 * La familia pide la visita. Devuelve la fila creada, SIEMPRE en `SOLICITADA`:
 * este endpoint no programa nada, y el texto del portal lo dice.
 */
export async function guardarSolicitudVisita({ codigo, payload = {} }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `SELECT a.servicio_id, a.fecha_envio, i.cubiculo_liberado_en, s.estado AS estado_servicio
         FROM public.avisos_mitad_compostaje a
         JOIN public.servicios s ON s.id = a.servicio_id
         LEFT JOIN public.lotes_tenjo_items i ON i.id = a.lote_item_id
        WHERE a.codigo = $1 AND s.estado <> 'CANCELADO'
        FOR UPDATE OF a`,
      [cod]
    )
    const a = rows[0]
    if (!a) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'no_encontrado' } } }

    const cfgV = await cargarConfigVisitas(client)
    if (a.cubiculo_liberado_en || a.estado_servicio === 'ENTREGADO' || fueraDeVentana(a.fecha_envio, cfgV)) {
      await client.query('ROLLBACK')
      return { status: 410, body: { ok: false, error: 'cerrado' } }
    }

    // ── El día y la franja se validan contra lo que ESTE servidor ofrece ──
    const fecha  = String(payload.fecha || '').trim()
    const franja = String(payload.franja || '').trim().toUpperCase()
    const dias   = await diasDisponiblesVisita(client, cfgV)
    if (!dias.some(d => d.fecha === fecha)) {
      await client.query('ROLLBACK')
      // Casi siempre es un día que se llenó mientras la familia decidía: el
      // portal recarga y muestra los que quedan.
      return { status: 409, body: { ok: false, error: 'dia_no_disponible' } }
    }
    if (!franjasDe(cfgV).some(f => f.clave === franja)) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'franja_invalida' } }
    }

    const personas = Math.min(Math.max(parseInt(payload.personas) || 1, 1), 20)
    const notas    = String(payload.notas || '').trim().slice(0, 500) || null

    try {
      const { rows: ins } = await client.query(
        `INSERT INTO public.visitas_tenjo
           (servicio_id, fecha_visita, franja, personas, novedades,
            estado, origen, solicitado_en)
         VALUES ($1, $2, $3, $4, $5, 'SOLICITADA', 'PORTAL_CLIENTE', now())
         RETURNING id, fecha_visita::text AS fecha_visita, franja, personas, estado`,
        [a.servicio_id, fecha, franja, personas, notas]
      )
      await client.query('COMMIT')
      await avisarCoordinacion(a.servicio_id, fecha, franja)
      return { status: 200, body: { ok: true, visita: ins[0] } }
    } catch (e) {
      await client.query('ROLLBACK')
      // El índice parcial único: ya tiene una visita viva para esa mascota.
      if (e.code === '23505') return { status: 409, body: { ok: false, error: 'ya_tiene_visita' } }
      throw e
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Notifica a coordinación. Best-effort fuera de la transacción: una solicitud
 * guardada no se pierde porque la campana falle, y una campana no justifica
 * deshacer lo que la familia ya pidió.
 */
async function avisarCoordinacion(servicioId, fecha, franja) {
  try {
    await pool.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
       SELECT p.id, 'VISITA_SOLICITADA', 'Una familia quiere visitar la planta',
              'Pidió el ' || to_char($2::date, 'DD/MM') ||
              CASE WHEN $3 = 'MANANA' THEN ' en la mañana' ELSE ' en la tarde' END ||
              '. Hay que validarla contra la jornada de Tenjo.',
              jsonb_build_object('servicio_id', $1::uuid, 'fecha', $2::text, 'franja', $3::text)
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
      [servicioId, fecha, franja]
    )
  } catch (e) { log('[visitas] aviso a coordinación no enviado:', e.message) }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const nombreDia = f => DIAS[new Date(`${f}T12:00:00`).getDay()]

const iso = d => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function fueraDeVentana(fechaEnvio, cfg) {
  if (!fechaEnvio) return false
  const dias = num(cfg.dias_ventana_portal, 90)
  return (Date.now() - new Date(fechaEnvio).getTime()) > dias * 24 * 60 * 60 * 1000
}

function num(v, def) {
  const n = parseInt(typeof v === 'string' ? v.replace(/"/g, '') : v)
  return Number.isFinite(n) ? n : def
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
