// CONDOLENCIAS — un mensaje de acompañamiento al mes del fallecimiento (migr. 209).
//
// REPORTE ORBIT 2026-11-17: «mantener un acompañamiento humano después del
// servicio y hacerle saber a la familia que Camino al Cielo continúa
// recordando y honrando la memoria de su mascotica».
//
// Reglas (David, 2026-11-17):
//   · fecha = fallecimiento + 30 días, y SOLO si el servicio ya está ENTREGADO.
//   · nunca antes de 3 días después de la entrega (no pisar la encuesta
//     post-entrega, que sale al día siguiente);
//   · si se entregó después del mes, `incluir_entrega_tardia` decide;
//   · se excluyen solas: plan DESAMPARADO (no hay familia) y sin WhatsApp.
//
// 🪤 "Recordatorios ENTREGADOS" se mide por `servicios.estado`, NO por
// `servicio_recordatorios`: en prod los ítems se quedan en PENDIENTE/LISTO
// aunque el servicio se haya entregado — exigirlos dejaría fuera a la mayoría.
//
// Dos fases, igual que mitad de compostaje:
//   1. PREPARAR — crea la fila (PENDIENTE o EXCLUIDO con su motivo). No le
//      escribe a nadie; corre aunque el flujo esté apagado, para que el equipo
//      vea en /condolencias lo programado antes de encenderlo.
//   2. ENVIAR   — el job manda la plantilla a las PENDIENTE/ERROR del día.
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'

const MOD = 'CONDOLENCIAS'
const TAG = '[condolencias]'

/** Cuerpo EXACTO de la plantilla en Meta (el texto de coordinación). {{1}} = mascota. */
export const CUERPO_PLANTILLA =
  '🐾🤍 Hoy queremos hacer una pequeña pausa para recordar con mucho cariño a {{1}}.\n\n' +
  'Sabemos que su ausencia sigue dejando una huella muy especial en tu corazón y en el de tu familia.\n\n' +
  'Desde Camino al Cielo queremos enviarte un abrazo lleno de cariño y recordarte que el amor, ' +
  'los momentos compartidos y los recuerdos que construyeron juntos siempre permanecerán. 🌿✨\n\n' +
  'Gracias por habernos permitido acompañarte en un momento tan importante y por confiar en ' +
  'nosotros para honrar su memoria. 🤍🐾'

export const CONFIG_DEFAULTS = {
  activo:                       false,
  plantilla:                    null,
  arranque_desde:               null,
  dias_desde_fallecimiento:     30,
  dias_tras_entrega:            3,
  incluir_entrega_tardia:       true,
  dias_max_desde_fallecimiento: 120,
  dias_max_atraso:              4,
  max_envios_por_corrida:       60,
}

export async function cargarConfigCondolencias() {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await pool.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD])
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/** Los números de la config, ya acotados. Un valor raro no puede disparar un envío masivo. */
export function reglas(cfg) {
  const n = (v, def, min, max) => Math.min(Math.max(parseInt(v) || def, min), max)
  return {
    activo:   cfg.activo === true || cfg.activo === 'true',
    arranque: normalizarFecha(cfg.arranque_desde),
    dias:     n(cfg.dias_desde_fallecimiento, 30, 1, 365),
    tras:     n(cfg.dias_tras_entrega, 3, 0, 30),
    tardia:   !(cfg.incluir_entrega_tardia === false || cfg.incluir_entrega_tardia === 'false'),
    max:      n(cfg.dias_max_desde_fallecimiento, 120, 30, 730),
    atraso:   n(cfg.dias_max_atraso, 4, 0, 30),
    tope:     n(cfg.max_envios_por_corrida, 60, 1, 200),
  }
}

/** null si no hay plantilla sembrada → nadie debe enviar. */
export function plantillaCondolencias(cfg) {
  const raw = cfg.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  return { nombre: p.nombre, idioma: p.idioma || 'es_MX', categoria: p.categoria || 'UTILITY' }
}

// ─── 1. Preparar ────────────────────────────────────────────────────────────
// Un solo INSERT … SELECT, idempotente por UNIQUE(servicio_id).
// $1 dias · $2 tras · $3 tardia · $4 arranque · $5 max
const CANDIDATOS = `
  SELECT s.id AS servicio_id,
         m.fecha_fallecimiento,
         s.fecha_entrega_real AS fecha_entrega,
         x.fecha_programada,
         CASE WHEN p.codigo = 'DESAMPARADO' THEN 'Plan Desamparado (no hay familia)'
              WHEN NOT $3::boolean AND s.fecha_entrega_real > m.fecha_fallecimiento + $1::int
                THEN 'Se entregó después del mes'
              WHEN length(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g')) < 10
                THEN 'Sin WhatsApp válido'
         END AS motivo,
         c.whatsapp
    FROM public.servicios s
    JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
    JOIN public.planes p        ON p.id = s.plan_id
    LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
   CROSS JOIN LATERAL (
     SELECT GREATEST(m.fecha_fallecimiento + $1::int, s.fecha_entrega_real + $2::int)::date AS fecha_programada
   ) x
   WHERE s.estado = 'ENTREGADO'
     AND m.fecha_fallecimiento IS NOT NULL
     AND s.fecha_entrega_real IS NOT NULL
     AND x.fecha_programada >= $4::date
     AND x.fecha_programada - m.fecha_fallecimiento <= $5::int
     AND NOT EXISTS (SELECT 1 FROM public.condolencias k WHERE k.servicio_id = s.id)`

/**
 * Crea las condolencias de los servicios entregados que aún no tienen. Sin
 * `arranque_desde` no prepara nada (anti-blast del histórico).
 * Con `dryRun` solo cuenta lo que crearía.
 */
export async function prepararCondolencias({ config = null, dryRun = false } = {}) {
  const r = reglas(config || await cargarConfigCondolencias())
  if (!r.arranque) return { creadas: 0, excluidas: 0, motivo: 'sin_arranque_desde' }
  const params = [r.dias, r.tras, r.tardia, r.arranque, r.max]

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
     INSERT INTO public.condolencias
       (servicio_id, fecha_fallecimiento, fecha_entrega, fecha_programada,
        estado, motivo_exclusion, excluido_en, whatsapp_destino)
     SELECT servicio_id, fecha_fallecimiento, fecha_entrega, fecha_programada,
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

// ─── 2. Enviar ──────────────────────────────────────────────────────────────
/**
 * Manda una condolencia PENDIENTE (o reintenta una en ERROR).
 * Nunca marca ENVIADO lo que no salió.
 */
export async function enviarCondolencia({ id, config = null, personalId = null }) {
  if (!uuidOrNull(id)) return { enviado: false, motivo: 'no_encontrado' }
  const cfg = config || await cargarConfigCondolencias()
  const plantilla = plantillaCondolencias(cfg)
  if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

  // Reclamarla: dos corridas a la vez (job + relanzar) no la mandan dos veces.
  const { rows: [k] } = await pool.query(
    `UPDATE public.condolencias SET estado = 'ENVIANDO', updated_at = now()
      WHERE id = $1 AND estado IN ('PENDIENTE', 'ERROR')
      RETURNING id, servicio_id`, [id])
  if (!k) return { enviado: false, motivo: 'ya_enviado' }

  const { rows: [d] } = await pool.query(
    `SELECT s.estado, m.nombre AS mascota, c.whatsapp,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       FROM public.servicios s
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE s.id = $1`, [k.servicio_id])

  if (!d || d.estado === 'CANCELADO') {
    await excluirAuto(id, 'Servicio cancelado')
    return { enviado: false, motivo: 'cancelado' }
  }
  if (d.estado !== 'ENTREGADO') {
    // Se reabrió después de entregarse: espera a que vuelva a ENTREGADO.
    await pool.query(`UPDATE public.condolencias SET estado = 'PENDIENTE', updated_at = now() WHERE id = $1`, [id])
    return { enviado: false, motivo: 'no_entregado' }
  }
  // El número VIGENTE de la ficha: si coordinación lo corrigió, manda el nuevo.
  const destino = validoWa(d.whatsapp)
  if (!destino) {
    await excluirAuto(id, 'Sin WhatsApp válido')
    return { enviado: false, motivo: 'sin_whatsapp' }
  }

  const mascota = nombreMascota(d.mascota)
  try {
    const r = await enviarPlantillaGenerica({
      telefono:        destino,
      nombre:          d.propietario || '',
      plantillaNombre: plantilla.nombre,
      idioma:          plantilla.idioma,
      category:        plantilla.categoria,
      mensaje:         CUERPO_PLANTILLA.replace('{{1}}', mascota),
      bodyParams:      [mascota],
      fromNumberId:    LINEA_WA_ID,
      // NULL desde el job (como mitad y encuesta): con un id puesto el agente
      // se calla 10 minutos, y la familia suele contestar a este mensaje.
      personalId:      uuidOrNull(personalId),
    })
    await pool.query(
      `UPDATE public.condolencias
          SET estado = 'ENVIADO', fecha_envio = now(), mensaje_id = $2,
              whatsapp_destino = $3, linea_wa = $4, enviado_por = $5,
              error = NULL, intentos = intentos + 1, updated_at = now()
        WHERE id = $1`,
      [id, r?.messageId || null, destino, LINEA_WA_NUMERO, uuidOrNull(personalId)])
    return { enviado: true, mensaje_id: r?.messageId || null }
  } catch (e) {
    await pool.query(
      `UPDATE public.condolencias
          SET estado = 'ERROR', error = $2, intentos = intentos + 1, updated_at = now()
        WHERE id = $1`, [id, String(e.message || '').slice(0, 500)])
    log(TAG, 'ERROR enviando', id, e.message)
    return { enviado: false, motivo: 'error_envio', error: e.message }
  }
}

async function excluirAuto(id, motivo) {
  await pool.query(
    `UPDATE public.condolencias
        SET estado = 'EXCLUIDO', motivo_exclusion = $2, excluido_en = now(), updated_at = now()
      WHERE id = $1`, [id, motivo])
}

// ─── Módulo /condolencias ───────────────────────────────────────────────────
/**
 * Lo de UN día: lo programado para ese día, lo que salió ese día y, si es hoy,
 * lo atrasado que todavía puede salir (fin de semana, festivo, reintentos).
 * Más los próximos 14 días y quiénes cumplieron el mes sin estar entregados.
 */
export async function listarCondolencias({ fecha = null } = {}) {
  const cfg = await cargarConfigCondolencias()
  const r = reglas(cfg)
  // Que lo programado esté al día al abrir la pantalla, aunque el job no haya corrido.
  await prepararCondolencias({ config: cfg }).catch(e => log(TAG, 'preparar al listar:', e.message))

  const { rows: [h] } = await pool.query(`SELECT public.fn_hoy_bogota()::text AS hoy`)
  const dia = normalizarFecha(fecha) || h.hoy

  const { rows: filas } = await pool.query(
    `SELECT k.id, k.servicio_id, k.estado, k.motivo_exclusion, k.error, k.intentos,
            k.fecha_fallecimiento::text, k.fecha_entrega::text, k.fecha_programada::text,
            k.fecha_envio, k.excluido_en, k.whatsapp_destino,
            m.nombre AS mascota, p.nombre AS plan,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            c.whatsapp,
            pe.nombre AS excluido_por_nombre,
            wm.estado AS acuse
       FROM public.condolencias k
       JOIN public.servicios s     ON s.id = k.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       JOIN public.planes p        ON p.id = s.plan_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       LEFT JOIN public.personal pe ON pe.id = k.excluido_por
       LEFT JOIN public.whatsapp_mensajes wm
              ON k.mensaje_id IS NOT NULL AND wm.wa_message_id = k.mensaje_id
      WHERE k.fecha_programada = $1::date
         OR (k.fecha_envio AT TIME ZONE 'America/Bogota')::date = $1::date
         OR ($1::date = public.fn_hoy_bogota()
             AND k.estado IN ('PENDIENTE', 'ENVIANDO', 'ERROR')
             AND k.fecha_programada < $1::date
             AND k.fecha_programada >= $1::date - $2::int)
      ORDER BY CASE k.estado WHEN 'ERROR' THEN 0 WHEN 'PENDIENTE' THEN 1 WHEN 'ENVIANDO' THEN 1
                             WHEN 'ENVIADO' THEN 2 ELSE 3 END,
               m.nombre`,
    [dia, r.atraso])

  const { rows: proximos } = await pool.query(
    `SELECT fecha_programada::text AS fecha,
            count(*) FILTER (WHERE estado IN ('PENDIENTE','ENVIANDO','ERROR'))::int AS programadas,
            count(*) FILTER (WHERE estado = 'ENVIADO')::int  AS enviadas,
            count(*) FILTER (WHERE estado = 'EXCLUIDO')::int AS excluidas
       FROM public.condolencias
      WHERE fecha_programada BETWEEN public.fn_hoy_bogota() AND public.fn_hoy_bogota() + 14
      GROUP BY 1 ORDER BY 1`)

  // Cumplieron el mes y siguen sin entregarse: saldrán al entregarse (si
  // `incluir_entrega_tardia`), y así nadie se pregunta por qué no aparecen.
  let esperando = []
  if (r.arranque) {
    const { rows } = await pool.query(
      `SELECT s.id AS servicio_id, m.nombre AS mascota, p.nombre AS plan, s.estado,
              m.fecha_fallecimiento::text,
              (public.fn_hoy_bogota() - m.fecha_fallecimiento)::int AS dias
         FROM public.servicios s
         JOIN public.mascotas m ON m.id_mascota = s.mascota_id
         JOIN public.planes p   ON p.id = s.plan_id
        WHERE s.estado NOT IN ('ENTREGADO', 'CANCELADO')
          AND p.codigo <> 'DESAMPARADO'
          AND m.fecha_fallecimiento + $1::int <= public.fn_hoy_bogota()
          AND m.fecha_fallecimiento + $1::int >= $2::date
          AND public.fn_hoy_bogota() - m.fecha_fallecimiento <= $3::int
        ORDER BY m.fecha_fallecimiento
        LIMIT 200`, [r.dias, r.arranque, r.max])
    esperando = rows
  }

  return {
    hoy: h.hoy, dia, filas, proximos, esperando,
    config: {
      activo: r.activo, plantilla: plantillaCondolencias(cfg)?.nombre || null,
      arranque_desde: r.arranque, dias: r.dias, tras: r.tras, tardia: r.tardia, atraso: r.atraso,
    },
    cuerpo: CUERPO_PLANTILLA,
  }
}

export async function excluirCondolencia({ id, motivo, personalId }) {
  const texto = String(motivo || '').trim().slice(0, 300)
  if (!uuidOrNull(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  if (!texto) return { status: 400, body: { ok: false, error: 'Escribe el motivo de la exclusión' } }
  const { rowCount } = await pool.query(
    `UPDATE public.condolencias
        SET estado = 'EXCLUIDO', motivo_exclusion = $2, excluido_por = $3,
            excluido_en = now(), updated_at = now()
      WHERE id = $1 AND estado IN ('PENDIENTE', 'ERROR')`,
    [id, texto, uuidOrNull(personalId)])
  if (!rowCount) return { status: 409, body: { ok: false, error: 'Solo se excluye una condolencia programada o con error' } }
  log(TAG, 'excluida a mano', id)
  return { status: 200, body: { ok: true } }
}

/** Vuelve a programar una excluida. Si su fecha ya pasó, sale en la próxima corrida. */
export async function reincluirCondolencia({ id }) {
  if (!uuidOrNull(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const { rowCount } = await pool.query(
    `UPDATE public.condolencias
        SET estado = 'PENDIENTE', motivo_exclusion = NULL, excluido_por = NULL,
            excluido_en = NULL, error = NULL, intentos = 0,
            fecha_programada = GREATEST(fecha_programada, public.fn_hoy_bogota()),
            updated_at = now()
      WHERE id = $1 AND estado = 'EXCLUIDO'`, [id])
  if (!rowCount) return { status: 409, body: { ok: false, error: 'Solo se reincluye una condolencia excluida' } }
  log(TAG, 'reincluida', id)
  return { status: 200, body: { ok: true } }
}

// ─── Utilidades ─────────────────────────────────────────────────────────────
/**
 * "GATURRIS" → "Gaturris", "RUNA ANTONIO" → "Runa Antonio". El 44 % de los
 * nombres está en mayúsculas y en un mensaje de cariño se leen como un grito.
 * Lo que ya viene con mayúsculas y minúsculas se respeta tal cual.
 */
export function nombreMascota(nombre) {
  const s = String(nombre || '').trim()
  if (!s) return 'tu mascotica'
  if (s !== s.toUpperCase() || !/\p{L}/u.test(s)) return s
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
}

export function normalizarFecha(v) {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
