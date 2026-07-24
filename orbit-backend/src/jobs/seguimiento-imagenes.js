// Job diario: cadencia automática del 2º y 3er contacto de solicitud de imágenes.
// Corre después del job que prepara los contactos del día (migración 044).
//
// Qué hace, en orden:
//   1. Toma las solicitudes ENVIADAS (contacto 1 ya salió) cuyo cliente NO ha
//      cargado imágenes y que aún están dentro de la ventana del portal.
//   2. A cada una le calcula, sobre la MISMA ancla (fecha de envío del contacto 1):
//        contacto 2 = +3 días hábiles   ·   contacto 3 = +15 días hábiles
//      (días hábiles reales: fn_sumar_dias_habiles respeta la tabla `festivos`).
//   3. Envía el que esté vencido y no se haya enviado. Nunca dos el mismo día.
//   4. Cierra: 3er contacto + `dias_cierre` hábiles sin respuesta → SIN_RESPUESTA
//      + alerta para llamar. Servicio fuera de la ventana del portal → se cierra
//      sin escribirle a nadie (el cliente ya no podría subir nada).
//
// Es idempotente: correrlo dos veces el mismo día no duplica ni un mensaje (el
// índice único (solicitud_id, numero) lo impide en la DB, no en el código).
import { pool, log } from '../db.js'
import { cargarConfigImagenes } from '../reglas-imagenes.js'
import { enviarContacto, cerrarSolicitud } from '../seguimiento-imagenes.js'

export async function jobSeguimientoImagenes({ dryRun = false } = {}) {
  const client = await pool.connect()
  let config
  try {
    config = await cargarConfigImagenes(client)
  } finally {
    client.release()
  }

  const activo = config.seguimiento_activo === true || config.seguimiento_activo === 'true'
  if (!activo) {
    log('[seguimiento-imagenes/job] apagado (seguimiento_activo=false)')
    return { activo: false }
  }

  // Solo se contacta en día hábil. El cron ya excluye sáb/dom, pero NO conoce los
  // festivos de Colombia: sin este guardia, un festivo dispararía mensajes a
  // clientes en duelo. `festivos` es la misma tabla que gobierna todos los SLA.
  const { rows: [dia] } = await pool.query(
    `SELECT public.fn_es_dia_habil(public.fn_hoy_bogota()) AS habil`
  )
  if (!dia?.habil && !dryRun) {
    log('[seguimiento-imagenes/job] hoy no es día hábil — no se contacta a nadie')
    return { activo: true, dia_habil: false }
  }

  const dias2   = parseInt(config.dias_contacto_2) || 3
  const dias3   = parseInt(config.dias_contacto_3) || 15
  const cierre  = parseInt(config.dias_cierre) || 3
  const tope    = parseInt(config.max_envios_por_corrida) || 40
  const arranque = normalizarFecha(config.arranque_desde)
  const portalStates = Array.isArray(config.estados_portal)
    ? config.estados_portal : ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION']

  // ── 1. Candidatos: una fila por solicitud viva, con sus fechas ya calculadas ──
  const { rows: candidatos } = await pool.query(
    `WITH c1 AS (
       SELECT solicitud_id, MIN(enviado_en) AS enviado_en
       FROM public.solicitud_imagenes_contactos
       WHERE numero = 1 AND estado = 'ENVIADO' AND enviado_en IS NOT NULL
       GROUP BY solicitud_id
     ), ancla AS (
       SELECT c1.solicitud_id, (c1.enviado_en AT TIME ZONE 'America/Bogota')::date AS dia
       FROM c1
     )
     -- Las fechas viajan como TEXTO 'YYYY-MM-DD': una columna DATE llega a Node
     -- como Date de JS y se corre un día al cruzar zonas horarias (el contenedor
     -- va en UTC, la operación en Bogotá). Como texto ISO, comparar con >= es
     -- cronológicamente correcto y no depende de la TZ del proceso.
     SELECT sol.id            AS solicitud_id,
            sol.servicio_id,
            s.estado          AS servicio_estado,
            a.dia::text       AS ancla,
            public.fn_sumar_dias_habiles(a.dia, $1::int)::text AS due2,
            public.fn_sumar_dias_habiles(a.dia, $2::int)::text AS due3,
            e2.estado         AS estado_c2,
            e3.estado         AS estado_c3,
            CASE WHEN e3.estado = 'ENVIADO' AND e3.enviado_en IS NOT NULL
                 THEN public.fn_sumar_dias_habiles((e3.enviado_en AT TIME ZONE 'America/Bogota')::date, $3::int)::text
            END               AS due_cierre,
            EXISTS (
              SELECT 1 FROM public.solicitud_imagenes_contactos x
              WHERE x.solicitud_id = sol.id
                AND (x.enviado_en AT TIME ZONE 'America/Bogota')::date = public.fn_hoy_bogota()
            )                 AS contactado_hoy,
            public.fn_hoy_bogota()::text AS hoy
     FROM public.solicitudes_imagenes sol
     JOIN ancla a            ON a.solicitud_id = sol.id
     JOIN public.servicios s ON s.id = sol.servicio_id
     LEFT JOIN public.solicitud_imagenes_contactos e2 ON e2.solicitud_id = sol.id AND e2.numero = 2
     LEFT JOIN public.solicitud_imagenes_contactos e3 ON e3.solicitud_id = sol.id AND e3.numero = 3
     WHERE sol.estado = 'ENVIADO'
       AND sol.seguimiento_pausado = false
       AND s.fecha_imagenes_recibidas IS NULL
       AND ($4::date IS NULL OR a.dia >= $4::date)
     ORDER BY a.dia ASC`,
    [dias2, dias3, cierre, arranque]
  )

  const r = { candidatos: candidatos.length, enviados_c2: 0, enviados_c3: 0,
              cerrados_agotado: 0, cerrados_fuera_ventana: 0, por_validar_caducadas: 0,
              sin_plantilla: 0, errores: 0, omitidos: 0, dry_run: dryRun }

  // ── 0. Higiene: contactos preparados que nunca se autorizaron y ya caducaron ──
  // Si el servicio salió de la ventana del portal, ese contacto ya no tiene objeto
  // (el cliente no podría cargar nada). Nunca se le escribió a nadie, así que se
  // CANCELA — no es "sin respuesta". Evita que la bandeja acumule casos muertos.
  const { rows: caducadas } = await pool.query(
    dryRun
      ? `SELECT sol.id
         FROM public.solicitudes_imagenes sol
         JOIN public.servicios s ON s.id = sol.servicio_id
         WHERE sol.estado = 'POR_VALIDAR'
           AND s.fecha_imagenes_recibidas IS NULL
           AND NOT (s.estado = ANY($1::text[]))`
      : `UPDATE public.solicitudes_imagenes sol
         SET estado = 'CANCELADO', motivo_cierre = 'FUERA_DE_VENTANA',
             fecha_cierre = public.fn_hoy_bogota()
         FROM public.servicios s
         WHERE s.id = sol.servicio_id
           AND sol.estado = 'POR_VALIDAR'
           AND s.fecha_imagenes_recibidas IS NULL
           AND NOT (s.estado = ANY($1::text[]))
         RETURNING sol.id`,
    [portalStates]
  )
  r.por_validar_caducadas = caducadas.length

  for (const c of candidatos) {
    const hoy = c.hoy

    // Servicio fuera de la ventana del portal: el cliente ya no puede subir nada
    // → no se le escribe. Se cierra la solicitud (sin alerta: ya está producido).
    if (!portalStates.includes(c.servicio_estado)) {
      if (!dryRun) await cerrarSolicitud({ solicitudId: c.solicitud_id, motivo: 'FUERA_DE_VENTANA' })
      r.cerrados_fuera_ventana++
      continue
    }

    // 3er contacto ya enviado y vencido el plazo de gracia → cerrar + alertar.
    if (c.estado_c3 === 'ENVIADO' && c.due_cierre && hoy >= c.due_cierre) {
      if (!dryRun) await cerrarSolicitud({ solicitudId: c.solicitud_id, motivo: 'AGOTADO', alertar: true })
      r.cerrados_agotado++
      continue
    }

    // Nunca dos mensajes el mismo día a la misma persona.
    if (c.contactado_hoy) { r.omitidos++; continue }

    // ¿Cuál toca? El 3º manda sobre el 2º. El 2º SOLO aplica dentro de su ventana
    // [due2, due3): en cuanto llega la fecha del 3º (o el 3º ya salió), el 2º queda
    // obsoleto y NO se manda. Sin este `hoy < due3`, un backlog con ambos vencidos
    // mandaba el 3º un día y el 2º al siguiente → el cliente recibía 2 y 3 casi
    // seguidos (a veces el 3 primero). El guardia "no dos el mismo día" no cubre
    // días consecutivos, por eso el corte va aquí, en la elección del contacto.
    let numero = null
    if (hoy >= c.due3 && c.estado_c3 !== 'ENVIADO') numero = 3
    else if (hoy >= c.due2 && hoy < c.due3 && c.estado_c2 !== 'ENVIADO' && c.estado_c3 !== 'ENVIADO') numero = 2
    if (!numero) continue

    // 'ENVIANDO' colgado (proceso muerto a mitad de envío) → no se toca sola.
    const estadoActual = numero === 3 ? c.estado_c3 : c.estado_c2
    if (estadoActual === 'ENVIANDO') { r.omitidos++; continue }

    if (r.enviados_c2 + r.enviados_c3 >= tope) { r.omitidos++; continue }
    if (dryRun) { numero === 3 ? r.enviados_c3++ : r.enviados_c2++; continue }

    try {
      const res = await enviarContacto({
        solicitudId: c.solicitud_id, numero, automatico: true,
        programadoPara: numero === 3 ? c.due3 : c.due2,
      })
      if (res.enviado)                        numero === 3 ? r.enviados_c3++ : r.enviados_c2++
      else if (res.motivo === 'sin_plantilla') r.sin_plantilla++
      else if (res.motivo === 'error_envio')   r.errores++
      else                                     r.omitidos++
    } catch (e) {
      r.errores++
      log('[seguimiento-imagenes/job] ERROR', c.solicitud_id, e.message)
    }
  }

  if (r.sin_plantilla > 0) {
    log('[seguimiento-imagenes/job] ⚠️', r.sin_plantilla,
        'contacto(s) vencidos SIN ENVIAR: falta sembrar plantilla_contacto_2/3 en config_operativa')
  }
  log('[seguimiento-imagenes/job]', JSON.stringify(r))
  return r
}

// config_operativa guarda jsonb: una fecha llega como '"2026-07-14"' o '2026-07-14'.
function normalizarFecha(v) {
  if (!v) return null
  const s = String(v).replace(/"/g, '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
