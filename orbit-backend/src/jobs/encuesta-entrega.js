// Job diario (10:00 Bogotá): encuesta de satisfacción post-entrega (migración 206).
//
// Toma las filas POST_ENTREGA que el trigger `crear_nps_al_entregado` creó al
// pasar el servicio a ENTREGADO (`fecha_programada` = día de la entrega) y le
// manda la encuesta a la familia al DÍA SIGUIENTE o después:
//   · nunca el mismo día de la entrega (decisión de David, 2026-11-09);
//   · ni domingo ni festivo: esos días el job no escribe y la encuesta sale el
//     siguiente día que corra (el sábado sí se envía);
//   · solo entregas desde `arranque_desde` y de hace como mucho
//     `dias_max_atraso` días.
//
// 🪤 `arranque_desde` es OBLIGATORIO. Al crear esto había 1384 POST_ENTREGA en
// PENDIENTE desde junio, ninguno atendido: sin esa fecha la primera corrida le
// escribiría a todas esas familias, meses después de su entrega.
import { pool, log } from '../db.js'
import { cargarConfigEncuesta, plantillaEncuesta, enviarEncuesta } from '../encuesta-entrega.js'

const TAG = '[encuesta/job]'

export async function jobEncuestaEntrega({ dryRun = false } = {}) {
  const config = await cargarConfigEncuesta()
  const activo = config.activo === true || config.activo === 'true'
  if (!activo) { log(TAG, 'apagado (activo=false)'); return { activo: false } }

  const arranque = normalizarFecha(config.arranque_desde)
  if (!arranque) {
    log(TAG, 'SIN arranque_desde — no envía (anti-blast de las entregas viejas)')
    return { activo: true, enviados: 0, motivo: 'sin_arranque_desde' }
  }

  const { rows: [hoy] } = await pool.query(
    `SELECT extract(isodow FROM public.fn_hoy_bogota())::int = 7
            OR EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = public.fn_hoy_bogota()) AS descanso`)
  if (hoy.descanso) { log(TAG, 'domingo o festivo — hoy no se escribe'); return { activo: true, descanso: true } }

  const tope   = Math.min(parseInt(config.max_envios_por_corrida) || 40, 200)
  const atraso = Math.min(parseInt(config.dias_max_atraso) || 7, 30)

  const { rows: candidatos } = await pool.query(
    `SELECT n.id
       FROM public.nps_seguimiento n
       JOIN public.servicios s ON s.id = n.servicio_id
      WHERE n.tipo = 'POST_ENTREGA'
        AND n.estado = 'PENDIENTE'
        AND n.satisfaccion IS NULL
        AND COALESCE(n.envio_estado, 'PENDIENTE') IN ('PENDIENTE', 'ERROR')
        AND n.envio_intentos < 3              -- un reintento eterno le pega al mismo número cada día
        AND s.estado = 'ENTREGADO'            -- se reabrió o se canceló después: no se pregunta
        AND n.fecha_programada >= $1::date
        AND n.fecha_programada <  public.fn_hoy_bogota()
        AND n.fecha_programada >= public.fn_hoy_bogota() - $2::int
      ORDER BY n.fecha_programada ASC
      LIMIT $3`,
    [arranque, atraso, tope]
  )

  const r = { candidatos: candidatos.length, enviados: 0, sin_whatsapp: 0, errores: 0,
              sin_plantilla: 0, dry_run: dryRun }
  if (!plantillaEncuesta(config)) {
    r.sin_plantilla = candidatos.length
    log(TAG, 'SIN PLANTILLA aprobada —', candidatos.length, 'encuesta(s) esperan. Sembrar ENCUESTA_ENTREGA/plantilla.')
    return r
  }
  if (dryRun) { log(TAG, JSON.stringify(r)); return r }

  for (const c of candidatos) {
    const res = await enviarEncuesta({ npsId: c.id, config })
    if (res.enviado) r.enviados++
    else if (res.motivo === 'sin_whatsapp') r.sin_whatsapp++
    else if (res.motivo === 'error_envio') r.errores++
  }
  log(TAG, JSON.stringify(r))
  return r
}

function normalizarFecha(v) {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
