// OFERTA POSTERIOR AL SERVICIO — la automatización comercial (migr. 210).
//
// REPORTE ORBIT 2026-11-17: unos dos meses después del fallecimiento, y nunca
// pegada al duelo inicial, Orbit le ofrece a la familia —con calidez y sin
// insistir— recordatorios adicionales, planes pre-exequiales para sus otras
// mascoticas y cédulas para mascotas. Es INDEPENDIENTE de las condolencias
// (migr. 209) y sale después de ellas.
//
// Reglas (David, 2026-11-17):
//   · fecha = GREATEST(fallecimiento + 60, condolencia + 30, entrega + 15);
//   · SOLO servicios ENTREGADOS (por `servicios.estado`, como la 209);
//   · NO se le ofrece a: quien pidió no recibir información; quien calificó MAL
//     la encuesta («los que calificaron totalmente mal no ofrecerles»); quien
//     tiene una QUEJA o RECLAMO en ese servicio; plan DESAMPARADO; sin WhatsApp;
//     y la condolencia que coordinación excluyó A MANO (si no era momento de un
//     mensaje de cariño, menos de una oferta);
//   · una familia con dos mascoticas recibe UNA oferta (`dias_entre_ofertas`).
//
// Tres fases:
//   1. PREPARAR — crea la fila (PENDIENTE o EXCLUIDO). No le escribe a nadie;
//      corre aunque el flujo esté apagado, para que el equipo vea lo programado.
//   2. REVISAR  — las reglas que cambian con el tiempo (una queja de ayer, un
//      «no deseo información») se vuelven a mirar antes de cada corrida Y justo
//      antes de cada envío: preparar hace 20 días no autoriza a enviar hoy.
//   3. ENVIAR   — el job manda la plantilla: la vieja con cuatro botones de
//      respuesta, o la de ENLACES (27-nov) con «Recuerdos y cedulas» y «Planes
//      preexequiales», que abren el portal directo, + «No deseo informacion».
//
// 🪤 El agente de familias NO debe contestar los botones: el webhook llama a
// `manejarRespuestaOferta` ANTES de despertarlo (igual que la encuesta).
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { enviarSobre } from './whatsapp-cloud.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'
import { nombreMascota, normalizarFecha } from './condolencias.js'
import { BOTONES, BOTONES_ENLACE, respuestaDeBoton, esBotonDeLaOferta, pct, ofertaVigente } from './oferta-posterior-reglas.js'
import {
  asegurarVenta, registrarEvento, esUuid,
} from './ventas-posteriores.js'

const MOD = 'OFERTA_POSTERIOR'
const TAG = '[oferta-posterior]'

/** Cuerpo EXACTO de la plantilla en Meta (el texto del reporte). {{1}} = mascota. */
export const CUERPO_PLANTILLA =
  '🐾🤍 Queremos seguir acompañándote y agradecerte nuevamente por habernos permitido ser parte '
  + 'del homenaje y la despedida de {{1}}.\n\n'
  + 'Con mucho respeto queremos compartirte algunas opciones que hemos creado para ayudarte a '
  + 'conservar sus recuerdos y también para acompañar a las demás mascoticas de tu familia. 🌿✨\n\n'
  + 'Si deseas conocerlas, puedes seleccionar alguna de las siguientes opciones:'

export { BOTONES, BOTONES_ENLACE }

export const CONFIG_DEFAULTS = {
  activo:                       false,
  plantilla:                    null,
  arranque_desde:               null,
  dias_desde_fallecimiento:     60,
  dias_tras_condolencia:        30,
  dias_tras_entrega:            15,
  dias_max_desde_fallecimiento: 180,
  dias_max_atraso:              4,
  max_envios_por_corrida:       40,
  dias_entre_ofertas:           180,
  dias_vigencia:                30,
  descuento_recordatorios:      30,
  descuento_cedulas:            50,
  descuento_preexequiales:      50,
  excluir_calificacion_mala:    true,
  excluir_con_queja:            true,
  niveles_ofrecidos:            ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE'],
  tipos_ofrecidos:              ['ANUAL', 'VITALICIO'],
  planes_info:                  {},
  datos_pago:                   '',
}

export async function cargarConfigOferta(client = pool) {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD])
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

const esFalso = v => v === false || v === 'false'

/** Los números de la config, ya acotados. Un valor raro no puede disparar un envío masivo. */
export function reglas(cfg) {
  const n = (v, def, min, max) => {
    const x = parseInt(v)
    return Math.min(Math.max(Number.isFinite(x) ? x : def, min), max)
  }
  return {
    activo:      cfg.activo === true || cfg.activo === 'true',
    arranque:    normalizarFecha(cfg.arranque_desde),
    dias:        n(cfg.dias_desde_fallecimiento, 60, 7, 365),
    trasCond:    n(cfg.dias_tras_condolencia, 30, 0, 180),
    trasEntrega: n(cfg.dias_tras_entrega, 15, 0, 90),
    max:         n(cfg.dias_max_desde_fallecimiento, 180, 30, 730),
    atraso:      n(cfg.dias_max_atraso, 4, 0, 30),
    tope:        n(cfg.max_envios_por_corrida, 40, 1, 200),
    entre:       n(cfg.dias_entre_ofertas, 180, 0, 3650),
    vigencia:    n(cfg.dias_vigencia, 30, 1, 365),
    excluirMala:  !esFalso(cfg.excluir_calificacion_mala),
    excluirQueja: !esFalso(cfg.excluir_con_queja),
    descuentos: {
      RECORDATORIOS: pct(cfg.descuento_recordatorios, 0),
      CEDULAS:       pct(cfg.descuento_cedulas, 0),
      PREEXEQUIALES: pct(cfg.descuento_preexequiales, 0),
    },
  }
}

/** null si no hay plantilla sembrada → nadie debe enviar. */
export function plantillaOferta(cfg) {
  const raw = cfg.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', categoria: p.categoria || 'MARKETING', enlaces: !!p.enlaces }
}

export function construirEnlaceOferta(codigo, seccion = '') {
  const base = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')
  return `${base}/#/oferta/${codigo}${seccion ? `/${seccion}` : ''}`
}

// ─── Botones de ENLACE de la plantilla (David, 27-nov) ──────────────────────
// «Desde el primer mensaje ya debería redireccionar al link»: la plantilla
// `oferta_posterior_enlaces` lleva dos botones de enlace (Meta no deja más de
// dos) y «No deseo informacion». El enlace del botón no puede llevar el «#» del
// portal, así que apunta a /api/portal/oferta-ir/<seccion>/<código> y aquí se
// redirige. De paso se anota que la familia lo abrió desde el WhatsApp.
export const SECCIONES_ENLACE = {
  recuerdos: { seccion: 'recuerdos', respuesta: 'RECORDATORIOS' },
  planes:    { seccion: 'planes',    respuesta: 'PREEXEQUIALES' },
}
const CODIGO_OFERTA = /^[0-9a-f]{32}$/
// Los que abren el enlace para armar la vista previa no son la familia.
const ES_ROBOT = /facebookexternalhit|whatsapp|meta-externalagent|bot\b|crawler|preview/i

/** La plantilla con enlaces lleva `enlaces: true` en `OFERTA_POSTERIOR.plantilla`. */
export const plantillaConEnlaces = p => !!p?.enlaces

export async function destinoDeEnlace({ seccion, codigo, userAgent = '' }) {
  const s = SECCIONES_ENLACE[String(seccion || '').toLowerCase()]
  const cod = String(codigo || '').toLowerCase()
  if (!CODIGO_OFERTA.test(cod)) return construirEnlaceOferta('').replace(/\/#\/oferta\/$/, '/')
  if (s && !ES_ROBOT.test(String(userAgent))) {
    // Nunca se pisa una respuesta anterior (y menos un «No deseo»). Si la base
    // falla, la familia igual llega al portal.
    await pool.query(
      `UPDATE public.ofertas_posteriores
          SET respuesta = COALESCE(respuesta, $2), respondido_en = COALESCE(respondido_en, now()), updated_at = now()
        WHERE codigo = $1 AND estado = 'ENVIADO'`, [cod, s.respuesta])
      .catch(e => log(TAG, 'no se pudo anotar el enlace abierto', cod, e.message))
  }
  return construirEnlaceOferta(cod, s?.seccion || '')
}

const TEL10 = col =>`right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`

// ─── 1. Preparar ────────────────────────────────────────────────────────────
// Un solo INSERT … SELECT, idempotente por UNIQUE(servicio_id).
// $1 dias · $2 trasEntrega · $3 trasCond · $4 arranque · $5 max
//
// La condolencia cuenta desde su envío real si ya salió, o desde su fecha
// programada si aún no. Sin fila (o excluida) no retrasa nada: GREATEST ignora
// los NULL. Al ENVIAR se vuelve a mirar, por si salió más tarde de lo previsto.
const CANDIDATOS = `
  SELECT s.id AS servicio_id, m.cliente_id,
         m.fecha_fallecimiento,
         s.fecha_entrega_real AS fecha_entrega,
         x.fecha_programada,
         CASE WHEN p.codigo = 'DESAMPARADO' THEN 'Plan Desamparado (no hay familia)'
              WHEN length(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g')) < 10
                THEN 'Sin WhatsApp válido'
         END AS motivo,
         c.whatsapp
    FROM public.servicios s
    JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
    JOIN public.planes p        ON p.id = s.plan_id
    LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
    LEFT JOIN public.condolencias k ON k.servicio_id = s.id
   CROSS JOIN LATERAL (
     SELECT GREATEST(
              m.fecha_fallecimiento + $1::int,
              s.fecha_entrega_real + $2::int,
              CASE WHEN k.estado = 'ENVIADO'
                     THEN (k.fecha_envio AT TIME ZONE 'America/Bogota')::date + $3::int
                   WHEN k.estado IN ('PENDIENTE', 'ENVIANDO', 'ERROR')
                     THEN k.fecha_programada + $3::int
              END
            )::date AS fecha_programada
   ) x
   WHERE s.estado = 'ENTREGADO'
     AND m.fecha_fallecimiento IS NOT NULL
     AND s.fecha_entrega_real IS NOT NULL
     AND x.fecha_programada >= $4::date
     AND x.fecha_programada - m.fecha_fallecimiento <= $5::int
     AND NOT EXISTS (SELECT 1 FROM public.ofertas_posteriores o WHERE o.servicio_id = s.id)`

/**
 * Crea las ofertas de los servicios entregados que aún no tienen. Sin
 * `arranque_desde` no prepara nada (anti-blast del histórico).
 * Con `dryRun` solo cuenta lo que crearía.
 */
export async function prepararOfertas({ config = null, dryRun = false } = {}) {
  const r = reglas(config || await cargarConfigOferta())
  if (!r.arranque) return { creadas: 0, excluidas: 0, motivo: 'sin_arranque_desde' }
  const params = [r.dias, r.trasEntrega, r.trasCond, r.arranque, r.max]

  if (dryRun) {
    const { rows: [c] } = await pool.query(
      `WITH cand AS (${CANDIDATOS})
       SELECT count(*) FILTER (WHERE motivo IS NULL)::int AS creadas,
              count(*) FILTER (WHERE motivo IS NOT NULL)::int AS excluidas
         FROM cand`, params)
    return c
  }

  const { rows } = await pool.query(
    `WITH cand AS (${CANDIDATOS})
     INSERT INTO public.ofertas_posteriores
       (servicio_id, cliente_id, fecha_fallecimiento, fecha_entrega, fecha_programada,
        estado, motivo_exclusion, excluido_en, whatsapp_destino)
     SELECT servicio_id, cliente_id, fecha_fallecimiento, fecha_entrega, fecha_programada,
            CASE WHEN motivo IS NULL THEN 'PENDIENTE' ELSE 'EXCLUIDO' END,
            motivo,
            CASE WHEN motivo IS NULL THEN NULL ELSE now() END,
            whatsapp
       FROM cand
     ON CONFLICT (servicio_id) DO NOTHING
     RETURNING estado`, params)
  const creadas = rows.filter(x => x.estado === 'PENDIENTE').length
  return { creadas, excluidas: rows.length - creadas }
}

// ─── 2. Revisar: las exclusiones que cambian con el tiempo ──────────────────
// Expresión sobre `o` (oferta), `s` (servicio) y `c` (cliente).
// $1 excluirMala · $2 excluirQueja · $3 dias_entre_ofertas
// El orden importa: «la familia lo pidió» va primero y NO lo salta `forzada`.
const MOTIVO_DINAMICO = `
  CASE
    WHEN s.estado = 'CANCELADO' THEN 'Servicio cancelado'
    WHEN EXISTS (
           SELECT 1 FROM public.oferta_exclusiones x
            WHERE x.retirado_en IS NULL
              AND (x.cliente_id = o.cliente_id
                   OR (x.tel10 IS NOT NULL AND x.tel10 = ${TEL10('c.whatsapp')})))
      THEN 'La familia pidió no recibir ofertas'
    WHEN length(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g')) < 10
      THEN 'Sin WhatsApp válido'
    WHEN NOT o.forzada AND $1::boolean AND EXISTS (
           SELECT 1 FROM public.nps_seguimiento n
            WHERE n.servicio_id = o.servicio_id AND (n.satisfaccion = 'MALA' OR n.nps <= 1))
      THEN 'Calificó mal la encuesta post-entrega'
    WHEN NOT o.forzada AND $2::boolean AND EXISTS (
           SELECT 1 FROM public.pqrs q
            WHERE q.servicio_id = o.servicio_id AND q.tipo IN ('QUEJA', 'RECLAMO'))
      THEN 'Tiene una queja o reclamo registrado en este servicio'
    WHEN NOT o.forzada AND EXISTS (
           SELECT 1 FROM public.condolencias k
            WHERE k.servicio_id = o.servicio_id AND k.estado = 'EXCLUIDO' AND k.excluido_por IS NOT NULL)
      THEN 'Su condolencia fue excluida a mano por coordinación'
    WHEN $3::int > 0 AND EXISTS (
           SELECT 1 FROM public.ofertas_posteriores o2
            WHERE o2.id <> o.id AND o2.estado = 'ENVIADO'
              AND o2.fecha_envio > now() - make_interval(days => $3::int)
              -- Una que Meta NO entregó no cuenta: la familia no recibió nada.
              AND NOT EXISTS (SELECT 1 FROM public.whatsapp_mensajes wm
                               WHERE wm.wa_message_id = o2.mensaje_id AND wm.estado = 'failed')
              AND (o2.cliente_id = o.cliente_id
                   OR (${TEL10('o2.whatsapp_destino')} = ${TEL10('c.whatsapp')}
                       AND length(${TEL10('c.whatsapp')}) = 10)))
      THEN 'Ya recibió la oferta por otra mascotica'
  END`

const DESDE_OFERTA = `
  FROM public.ofertas_posteriores o
  JOIN public.servicios s     ON s.id = o.servicio_id
  JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
  LEFT JOIN public.clientes c ON c.id_cliente = COALESCE(o.cliente_id, m.cliente_id)`

/** Excluye (con su motivo) las PENDIENTE/ERROR que ya no deben recibir la oferta. */
export async function revisarExclusiones({ config = null } = {}) {
  const r = reglas(config || await cargarConfigOferta())
  const { rowCount } = await pool.query(
    `UPDATE public.ofertas_posteriores t
        SET estado = 'EXCLUIDO', motivo_exclusion = q.motivo, excluido_por = NULL,
            excluido_en = now(), updated_at = now()
       FROM (SELECT o.id, ${MOTIVO_DINAMICO} AS motivo ${DESDE_OFERTA}
              WHERE o.estado IN ('PENDIENTE', 'ERROR')) q
      WHERE q.id = t.id AND q.motivo IS NOT NULL AND t.estado IN ('PENDIENTE', 'ERROR')`,
    [r.excluirMala, r.excluirQueja, r.entre])
  return rowCount
}

// ─── 3. Enviar ──────────────────────────────────────────────────────────────
/**
 * Manda una oferta PENDIENTE (o reintenta una en ERROR).
 * Nunca marca ENVIADO lo que no salió, y vuelve a mirar TODAS las reglas justo
 * antes de escribirle a la familia.
 */
export async function enviarOferta({ id, config = null, personalId = null }) {
  if (!esUuid(id)) return { enviado: false, motivo: 'no_encontrado' }
  const cfg = config || await cargarConfigOferta()
  const r = reglas(cfg)
  const plantilla = plantillaOferta(cfg)
  if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

  // Reclamarla: dos corridas a la vez (job + relanzar) no la mandan dos veces.
  const { rows: [k] } = await pool.query(
    `UPDATE public.ofertas_posteriores SET estado = 'ENVIANDO', updated_at = now()
      WHERE id = $1 AND estado IN ('PENDIENTE', 'ERROR')
      RETURNING id`, [id])
  if (!k) return { enviado: false, motivo: 'ya_enviado' }

  let env = null, registro = null
  try {
    const { rows: [d] } = await pool.query(
      `SELECT s.estado, m.nombre AS mascota, c.whatsapp, o.codigo,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              ${MOTIVO_DINAMICO} AS motivo,
              -- Fechas como TEXTO: node-pg convierte un date a Date en la zona del
              -- servidor y al devolverlo como parametro puede correrse un dia.
              (SELECT ((kk.fecha_envio AT TIME ZONE 'America/Bogota')::date + $4::int)::text
                 FROM public.condolencias kk
                WHERE kk.servicio_id = o.servicio_id AND kk.estado = 'ENVIADO') AS tras_condolencia,
              EXISTS (SELECT 1 FROM public.condolencias kk
                WHERE kk.servicio_id = o.servicio_id AND kk.estado IN ('PENDIENTE', 'ENVIANDO', 'ERROR')
                  AND kk.fecha_programada >= public.fn_hoy_bogota() - 7) AS condolencia_en_cola,
              public.fn_hoy_bogota()::text AS hoy
         ${DESDE_OFERTA}
        WHERE o.id = $5`,
      [r.excluirMala, r.excluirQueja, r.entre, r.trasCond, id])

    if (!d) { await excluirAuto(id, 'Servicio no encontrado'); return { enviado: false, motivo: 'no_encontrado' } }
    if (d.motivo) {
      await excluirAuto(id, d.motivo)
      return { enviado: false, motivo: 'excluida', error: d.motivo }
    }
    if (d.estado !== 'ENTREGADO') {
      // Se reabrió después de entregarse: espera a que vuelva a ENTREGADO.
      await devolverAPendiente(id)
      return { enviado: false, motivo: 'no_entregado' }
    }
    // La condolencia salió más tarde de lo previsto (o aún no sale): la oferta
    // NO puede adelantársele ni pisarla. Se corre de fecha y espera.
    if (d.tras_condolencia && d.tras_condolencia > d.hoy) {
      await pool.query(
        `UPDATE public.ofertas_posteriores
            SET estado = 'PENDIENTE', fecha_programada = $2::date, updated_at = now() WHERE id = $1`,
        [id, d.tras_condolencia])
      return { enviado: false, motivo: 'espera_condolencia' }
    }
    if (d.condolencia_en_cola) {
      // Su condolencia sigue en cola: la oferta se corre a mañana y vuelve a
      // mirar. Sin mover la fecha se quedaría atrás del atraso permitido y
      // «no saldría» nunca por culpa de un mensaje que solo iba unos días tarde.
      await pool.query(
        `UPDATE public.ofertas_posteriores
            SET estado = 'PENDIENTE', fecha_programada = public.fn_hoy_bogota() + 1, updated_at = now()
          WHERE id = $1 AND estado = 'ENVIANDO'`, [id])
      return { enviado: false, motivo: 'espera_condolencia' }
    }

    // El número VIGENTE de la ficha: si coordinación lo corrigió, manda el nuevo.
    const destino = validoWa(d.whatsapp)
    if (!destino) { await excluirAuto(id, 'Sin WhatsApp válido'); return { enviado: false, motivo: 'sin_whatsapp' } }

    const mascota = nombreMascota(d.mascota)
    const quien = esUuid(personalId) ? personalId : null
    const conEnlaces = plantillaConEnlaces(plantilla)
    if (conEnlaces && !CODIGO_OFERTA.test(String(d.codigo || ''))) throw new Error('La oferta no tiene código de portal')
    env = await enviarPlantillaGenerica({
      telefono:        destino,
      nombre:          d.propietario || '',
      plantillaNombre: plantilla.nombre,
      idioma:          plantilla.idioma,
      category:        plantilla.categoria,
      mensaje:         `${CUERPO_PLANTILLA.replace('{{1}}', mascota)}\n${(conEnlaces ? BOTONES_ENLACE : BOTONES).map(b => `[botón: ${b}]`).join(' ')}`,
      bodyParams:      [mascota],
      // Plantilla con enlaces: el {{1}} de los dos botones es el código del portal.
      buttonParams:    conEnlaces ? [d.codigo] : [],
      fromNumberId:    LINEA_WA_ID,
      // NULL desde el job (como condolencias y encuesta): con un id puesto el
      // agente se calla 10 minutos en esa conversación.
      personalId:      quien,
    })
    registro = [id, env?.messageId || null, destino, LINEA_WA_NUMERO, quien]
  } catch (e) {
    await pool.query(
      `UPDATE public.ofertas_posteriores
          SET estado = 'ERROR', error = $2, intentos = intentos + 1, updated_at = now()
        WHERE id = $1 AND estado = 'ENVIANDO'`, [id, String(e.message || '').slice(0, 500)])
    log(TAG, 'ERROR enviando', id, e.message)
    return { enviado: false, motivo: 'error_envio', error: e.message }
  }

  // 🔒 El mensaje YA salió. Anotarlo va FUERA del try de arriba: si esta
  // escritura fallara ahí dentro (un corte de la base), el catch dejaría la
  // fila en ERROR y el job le mandaría la oferta OTRA VEZ a la familia. Se
  // reintenta una vez; si aun así falla, la fila se queda en ENVIANDO —que el
  // job no retoma— y se deja un aviso bien visible en el log.
  const anotar = () => pool.query(
    `UPDATE public.ofertas_posteriores
        SET estado = 'ENVIADO', fecha_envio = now(), mensaje_id = $2,
            whatsapp_destino = $3, linea_wa = $4, enviado_por = $5,
            error = NULL, intentos = intentos + 1, updated_at = now()
      WHERE id = $1`, registro)
  try { await anotar() } catch (e1) {
    try { await anotar() } catch (e2) {
      log(TAG, '🚨 ENVIADA pero NO se pudo anotar — queda en ENVIANDO, NO relanzar sin revisar:', id, env?.messageId, e2.message)
    }
  }
  return { enviado: true, mensaje_id: env?.messageId || null }
}

async function excluirAuto(id, motivo) {
  await pool.query(
    `UPDATE public.ofertas_posteriores
        SET estado = 'EXCLUIDO', motivo_exclusion = $2, excluido_por = NULL,
            excluido_en = now(), updated_at = now()
      WHERE id = $1`, [id, motivo])
}

async function devolverAPendiente(id) {
  await pool.query(
    `UPDATE public.ofertas_posteriores SET estado = 'PENDIENTE', updated_at = now()
      WHERE id = $1 AND estado = 'ENVIANDO'`, [id])
}

// ─── No ofrecer más ─────────────────────────────────────────────────────────
/**
 * Marca a la familia para NO recibir ofertas. Idempotente: si ya hay una marca
 * viva para ese cliente o ese número, no crea otra. Devuelve true si la creó.
 */
export async function registrarExclusion(client, { clienteId = null, telefono = null, motivo, origen, personalId = null }) {
  const d = String(telefono || '').replace(/\D/g, '')
  const tel10 = d.length >= 10 ? d.slice(-10) : null
  if (!clienteId && !tel10) return false
  const { rows: [ya] } = await client.query(
    `SELECT 1 FROM public.oferta_exclusiones
      WHERE retirado_en IS NULL
        AND (($1::uuid IS NOT NULL AND cliente_id = $1) OR ($2::text IS NOT NULL AND tel10 = $2))
      LIMIT 1`, [clienteId, tel10])
  if (ya) return false
  await client.query(
    `INSERT INTO public.oferta_exclusiones (cliente_id, tel10, motivo, origen, creado_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [clienteId, tel10, String(motivo || '').trim().slice(0, 300) || 'Sin motivo', origen, personalId])
  return true
}

// ─── Respuesta a los botones (la llama el webhook ANTES del agente) ─────────
const TEXTO_BAJA =
  'Entendido 🤍 No te enviaremos más información de este tipo.\n\n'
  + 'Gracias por habernos permitido acompañarte. Aquí estaremos siempre que nos necesites. 🐾'

const RESPUESTA = {
  RECORDATORIOS: {
    seccion: 'recordatorios', boton: 'Ver recordatorios',
    texto: (m, p) => `🐾 Con mucho gusto. Aquí puedes ver, con sus fotos y valores, los recordatorios para conservar la memoria de ${m}`
      + (p ? `, con un ${p}% de descuento especial para ti.` : '.'),
  },
  PREEXEQUIALES: {
    seccion: 'planes', boton: 'Ver planes',
    texto: (_m, p) => '📋 Con mucho gusto. Aquí encuentras nuestros planes preexequiales para las demás mascoticas de tu familia'
      + (p ? `, con un ${p}% de descuento especial para ti.` : '.'),
  },
  CEDULAS: {
    seccion: 'cedulas', boton: 'Ver cédulas',
    texto: (_m, p) => '🪪 Con mucho gusto. Aquí puedes ver las cédulas para las mascoticas de tu familia'
      + (p ? `, con un ${p}% de descuento especial para ti.` : '.'),
  },
}

/**
 * ¿Este mensaje entrante es un botón de la oferta? Si lo es, lo registra,
 * contesta y devuelve true → el webhook NO despierta al agente.
 *
 * Se empareja por número (los botones de plantilla son fijos y Meta devuelve su
 * texto): la última oferta ENVIADA a ese número en 90 días.
 */
export async function manejarRespuestaOferta({ phoneNumberId, contacto, tipo, boton }) {
  if (!['button', 'interactive'].includes(tipo)) return false
  // Solo los cuatro textos EXACTOS de la plantilla, y solo por la línea por la
  // que sale la oferta: un «No deseo…» o una «cédula» de otra plantilla, o de un
  // menú del agente, NO es de aquí — y tragárselo dejaría a la familia sin
  // respuesta, o peor, dada de baja por un botón que no era este.
  if (!esBotonDeLaOferta(boton)) return false
  if (phoneNumberId && phoneNumberId !== LINEA_WA_ID) return false
  const respuesta = respuestaDeBoton(boton)
  if (!respuesta) return false
  const ultimos10 = String(contacto || '').replace(/\D/g, '').slice(-10)
  if (ultimos10.length < 10) return false

  const { rows: [o] } = await pool.query(
    `SELECT o.id, o.servicio_id, o.cliente_id, o.codigo, o.fecha_envio, o.created_at,
            m.nombre AS mascota, c.whatsapp,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       ${DESDE_OFERTA}
      WHERE o.estado = 'ENVIADO' AND o.fecha_envio > now() - interval '90 days'
        AND ${TEL10('o.whatsapp_destino')} = $1
      ORDER BY o.fecha_envio DESC
      LIMIT 1`, [ultimos10])
  if (!o) return false   // un botón parecido de otra plantilla: que lo atienda el agente

  const cfg = await cargarConfigOferta()
  const r = reglas(cfg)
  const linea = phoneNumberId || LINEA_WA_ID
  const mascota = nombreMascota(o.mascota)

  if (respuesta === 'NO_DESEA') {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await registrarExclusion(client, {
        clienteId: o.cliente_id, telefono: contacto, origen: 'FAMILIA',
        motivo: 'Tocó «No deseo información» en la oferta posterior',
      })
      await client.query(
        `UPDATE public.ofertas_posteriores
            SET respuesta = 'NO_DESEA', respondido_en = now(), updated_at = now() WHERE id = $1`, [o.id])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally { client.release() }
    log(TAG, 'la familia no desea información', o.id)
    await responderTexto({ contacto, linea, texto: TEXTO_BAJA })
      .catch(e => log(TAG, 'no se pudo contestar la baja', o.id, e.message))
    return true
  }

  // Interés: queda como oportunidad (una por categoría), sin aviso al equipo.
  let creada = false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const a = await asegurarVenta(client, { ofertaId: o.id, categoria: respuesta, origen: 'BOTON_WHATSAPP' })
    creada = a.creada
    // Tocó el botón otra vez tras un cierre sin venta: es una acción real de
    // la familia, así que la oportunidad se reabre. No
    // va por `moverPorFamilia`: esa regla no reabre por solo mirar el portal.
    if (!creada && a.venta.estado === 'CERRADA_SIN_VENTA') {
      await client.query(
        `UPDATE public.ventas_posteriores
            SET estado = 'INTERESADO', motivo_cierre = NULL, updated_at = now() WHERE id = $1`, [a.venta.id])
      await registrarEvento(client, {
        ventaId: a.venta.id, tipo: 'ESTADO',
        detalle: { de: 'CERRADA_SIN_VENTA', a: 'INTERESADO', nota: 'La familia volvió a tocar el botón en WhatsApp' },
      })
      creada = true
    }
    await client.query(
      `UPDATE public.ofertas_posteriores
          SET respuesta = $2, respondido_en = now(), updated_at = now() WHERE id = $1`, [o.id, respuesta])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
  log(TAG, 'interés', o.id, respuesta, creada ? '(nueva)' : '(repetido)')

  // 🔕 Tocar un botón NO avisa al equipo (David, 27-nov): es interés, no una
  // compra. El aviso «NUEVA OPORTUNIDAD» le llegaba a Diseño como si fuera una
  // venta, sin producto ni datos. Diseño se entera cuando hay una COMPRA real
  // (portal o «Registrar la compra» en /ventas-posteriores).

  const vigente = ofertaVigente({ fechaEnvio: o.fecha_envio, creadaEn: o.created_at, diasVigencia: r.vigencia })
  const guia = RESPUESTA[respuesta]
  try {
    if (!vigente) {
      await responderTexto({
        contacto, linea,
        texto: '🤍 Gracias por tu interés. Esta oferta ya cerró, pero con mucho gusto te ayudamos: '
          + 'una persona de nuestro equipo te escribirá por aquí.',
      })
    } else {
      await responderCta({
        contacto, linea, boton: guia.boton,
        cuerpo: guia.texto(mascota, r.descuentos[respuesta]),
        url: construirEnlaceOferta(o.codigo, guia.seccion),
      })
    }
  } catch (e) { log(TAG, 'no se pudo contestar el botón', o.id, e.message) }
  return true
}

async function responderTexto({ contacto, linea, texto }) {
  const r = await enviarSobre({ contacto, linea, tipo: 'text', texto, payload: { type: 'text', text: { body: texto } } })
  if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
  return r
}

async function responderCta({ contacto, linea, cuerpo, boton, url }) {
  const r = await enviarSobre({
    contacto, linea, tipo: 'interactive',
    texto: `${cuerpo}\n[botón: ${boton}]`,
    payload: {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: cuerpo },
        action: { name: 'cta_url', parameters: { display_text: boton.slice(0, 20), url } },
      },
    },
  })
  if (!r?.body?.ok) throw new Error(r?.body?.error || 'envío rechazado')
  return r
}

// ─── Pestaña «Envíos» de /ventas-posteriores ────────────────────────────────
/**
 * Lo de UN día: lo programado para ese día, lo que salió ese día y, si es hoy,
 * lo atrasado que todavía puede salir. Más los próximos 14 días.
 */
export async function listarOfertas({ fecha = null } = {}) {
  const cfg = await cargarConfigOferta()
  const r = reglas(cfg)
  // Que lo programado esté al día al abrir la pantalla, aunque el job no haya corrido.
  await prepararOfertas({ config: cfg }).catch(e => log(TAG, 'preparar al listar:', e.message))
  await revisarExclusiones({ config: cfg }).catch(e => log(TAG, 'revisar al listar:', e.message))

  const { rows: [h] } = await pool.query(`SELECT public.fn_hoy_bogota()::text AS hoy`)
  const dia = normalizarFecha(fecha) || h.hoy

  const { rows: filas } = await pool.query(
    `SELECT o.id, o.servicio_id, o.estado, o.motivo_exclusion, o.error, o.intentos, o.forzada,
            o.fecha_fallecimiento::text, o.fecha_entrega::text, o.fecha_programada::text,
            o.fecha_envio, o.excluido_en, o.whatsapp_destino, o.respuesta, o.respondido_en,
            o.abierta_en, o.codigo,
            m.nombre AS mascota, p.nombre AS plan,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            c.whatsapp, c.id_cliente AS cliente_id,
            pe.nombre AS excluido_por_nombre,
            wm.estado AS acuse
       ${DESDE_OFERTA}
       JOIN public.planes p          ON p.id = s.plan_id
       LEFT JOIN public.personal pe  ON pe.id = o.excluido_por
       LEFT JOIN public.whatsapp_mensajes wm
              ON o.mensaje_id IS NOT NULL AND wm.wa_message_id = o.mensaje_id
      WHERE o.fecha_programada = $1::date
         OR (o.fecha_envio AT TIME ZONE 'America/Bogota')::date = $1::date
         OR ($1::date = public.fn_hoy_bogota()
             AND o.estado IN ('PENDIENTE', 'ENVIANDO', 'ERROR')
             AND o.fecha_programada < $1::date
             AND o.fecha_programada >= $1::date - $2::int)
      ORDER BY CASE o.estado WHEN 'ERROR' THEN 0 WHEN 'PENDIENTE' THEN 1 WHEN 'ENVIANDO' THEN 1
                             WHEN 'ENVIADO' THEN 2 ELSE 3 END,
               m.nombre`,
    [dia, r.atraso])

  const { rows: proximos } = await pool.query(
    `SELECT fecha_programada::text AS fecha,
            count(*) FILTER (WHERE estado IN ('PENDIENTE','ENVIANDO','ERROR'))::int AS programadas,
            count(*) FILTER (WHERE estado = 'ENVIADO')::int  AS enviadas,
            count(*) FILTER (WHERE estado = 'EXCLUIDO')::int AS excluidas
       FROM public.ofertas_posteriores
      WHERE fecha_programada BETWEEN public.fn_hoy_bogota() AND public.fn_hoy_bogota() + 14
      GROUP BY 1 ORDER BY 1`)

  // El embudo: de lo enviado, cuántas respondieron y qué.
  const { rows: [embudo] } = await pool.query(
    `SELECT count(*) FILTER (WHERE estado = 'ENVIADO')::int AS enviadas,
            count(*) FILTER (WHERE estado = 'ENVIADO' AND respuesta IS NOT NULL AND respuesta <> 'NO_DESEA')::int AS interesadas,
            count(*) FILTER (WHERE respuesta = 'NO_DESEA')::int AS no_desean,
            count(*) FILTER (WHERE abierta_en IS NOT NULL)::int AS abrieron
       FROM public.ofertas_posteriores`)

  return {
    hoy: h.hoy, dia, filas: filas.map(f => ({ ...f, enlace: construirEnlaceOferta(f.codigo) })),
    proximos, embudo,
    config: {
      activo: r.activo, plantilla: plantillaOferta(cfg)?.nombre || null,
      arranque_desde: r.arranque, dias: r.dias, tras_condolencia: r.trasCond,
      tras_entrega: r.trasEntrega, atraso: r.atraso, vigencia: r.vigencia, descuentos: r.descuentos,
    },
    cuerpo: CUERPO_PLANTILLA, botones: BOTONES,
  }
}

/**
 * Excluir una oferta programada. Con `noVolver`, además marca a la familia para
 * no recibir ofertas nunca («Excluir de ofertas posteriores» del reporte).
 */
export async function excluirOferta({ id, motivo, noVolver = false, personalId }) {
  const texto = String(motivo || '').trim().slice(0, 300)
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  if (!texto) return { status: 400, body: { ok: false, error: 'Escribe el motivo de la exclusión' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [o] } = await client.query(
      `UPDATE public.ofertas_posteriores
          SET estado = 'EXCLUIDO', motivo_exclusion = $2, excluido_por = $3,
              excluido_en = now(), forzada = false, updated_at = now()
        WHERE id = $1 AND estado IN ('PENDIENTE', 'ERROR')
        RETURNING cliente_id, whatsapp_destino`, [id, texto, personalId])
    if (!o) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'Solo se excluye una oferta programada o con error' } }
    }
    if (noVolver) {
      await registrarExclusion(client, {
        clienteId: o.cliente_id, telefono: o.whatsapp_destino, motivo: texto, origen: 'EQUIPO', personalId,
      })
    }
    await client.query('COMMIT')
    log(TAG, 'excluida a mano', id, noVolver ? '(familia marcada)' : '')
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Vuelve a programar una excluida, y la deja `forzada`: las reglas de
 * calificación y queja ya no la sacan solas (coordinación decidió). Lo único
 * que NO se salta es que la familia haya pedido no recibir ofertas.
 */
export async function reincluirOferta({ id }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const { rows: [x] } = await pool.query(
    `SELECT 1 ${DESDE_OFERTA}
      WHERE o.id = $1
        AND EXISTS (SELECT 1 FROM public.oferta_exclusiones e
                     WHERE e.retirado_en IS NULL
                       AND (e.cliente_id = o.cliente_id
                            OR (e.tel10 IS NOT NULL AND e.tel10 = ${TEL10('c.whatsapp')})))`, [id])
  if (x) {
    return { status: 409, body: { ok: false, error: 'Esta familia está marcada para no recibir ofertas. Retira primero esa marca en «No contactar».' } }
  }
  const { rowCount } = await pool.query(
    `UPDATE public.ofertas_posteriores
        SET estado = 'PENDIENTE', motivo_exclusion = NULL, excluido_por = NULL,
            excluido_en = NULL, error = NULL, intentos = 0, forzada = true,
            fecha_programada = GREATEST(fecha_programada, public.fn_hoy_bogota()),
            updated_at = now()
      WHERE id = $1 AND estado = 'EXCLUIDO'`, [id])
  if (!rowCount) return { status: 409, body: { ok: false, error: 'Solo se reincluye una oferta excluida' } }
  log(TAG, 'reincluida', id)
  return { status: 200, body: { ok: true } }
}

// ─── Pestaña «No contactar» ─────────────────────────────────────────────────
export async function listarExclusiones() {
  const { rows } = await pool.query(
    `SELECT e.id, e.cliente_id, e.tel10, e.motivo, e.origen, e.created_at,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            c.whatsapp, pe.nombre AS creado_por_nombre
       FROM public.oferta_exclusiones e
       LEFT JOIN public.clientes c  ON c.id_cliente = e.cliente_id
       LEFT JOIN public.personal pe ON pe.id = e.creado_por
      WHERE e.retirado_en IS NULL
      ORDER BY e.created_at DESC
      LIMIT 500`)
  return rows
}

/** Marca a una familia por su número (y por su ficha, si el número es de un solo cliente). */
export async function crearExclusion({ telefono, motivo, personalId }) {
  const d = String(telefono || '').replace(/\D/g, '')
  if (d.length < 10) return { status: 400, body: { ok: false, error: 'Escribe un número de WhatsApp válido (10 dígitos).' } }
  const texto = String(motivo || '').trim().slice(0, 300)
  if (!texto) return { status: 400, body: { ok: false, error: 'Escribe el motivo.' } }
  const { rows: clientes } = await pool.query(
    `SELECT id_cliente FROM public.clientes WHERE ${TEL10('whatsapp')} = $1 LIMIT 2`, [d.slice(-10)])
  const creada = await registrarExclusion(pool, {
    clienteId: clientes.length === 1 ? clientes[0].id_cliente : null,
    telefono: d, motivo: texto, origen: 'EQUIPO', personalId,
  })
  if (!creada) return { status: 409, body: { ok: false, error: 'Esa familia ya estaba marcada para no recibir ofertas.' } }
  await revisarExclusiones().catch(e => log(TAG, 'revisar tras excluir:', e.message))
  return { status: 200, body: { ok: true } }
}

export async function retirarExclusion({ id, personalId }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const { rowCount } = await pool.query(
    `UPDATE public.oferta_exclusiones SET retirado_en = now(), retirado_por = $2
      WHERE id = $1 AND retirado_en IS NULL`, [id, personalId])
  if (!rowCount) return { status: 409, body: { ok: false, error: 'Esa marca ya no estaba activa.' } }
  return { status: 200, body: { ok: true } }
}

// ─── Utilidades ─────────────────────────────────────────────────────────────
function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
