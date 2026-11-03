// Job: limpieza de lo que quedó colgado en Tenjo y bloquea candidatas.
//
// Por qué (David, 2026-11-02): Katty Díaz y ORUS siguieron PROPUESTO un mes en
// el borrador TJ-20261001 y María celeste tenía un traslado PROGRAMADO sin lote.
// El índice único las daba por "ya en un lote/traslado activo", así que nadie
// las podía volver a programar y Candidatas no decía por qué.
//
// Corre antes de la propuesta diaria (/jobs/generar-propuesta), para que lo que
// libera entre en el lote del día. Solo toca lo que NUNCA salió de la nevera:
//   1. Borradores (PROPUESTO/EN_REVISION) con jornada vencida hace más de
//      GRACIA_DIAS → se cancelan, sus items pasan a RETIRADO_DEL_LOTE y sus
//      traslados PROGRAMADO se cancelan. Si el lote tiene algo que ya salió
//      (EN_CAMINO, EN_TRASLADO, RECIBIDA, EN_PROCESO, PROCESADO) NO se toca:
//      un EN_REVISION puede ser un lote reabierto que sí se ejecutó.
//   2. Items pre-salida (PROPUESTO/APROBADO/AUTORIZADA_SALIDA) que quedaron en
//      un lote ya CERRADO o CANCELADO → RETIRADO_DEL_LOTE.
//   3. Traslados PROGRAMADO vencidos que ningún item activo usa y cuya mascota
//      sigue en la nevera (fecha_salida vacía: EN_CAMINO la llena) → CANCELADO.
// Lo vencido en lotes CONFIRMADO/EN_EJECUCION no se toca (la planta mueve
// fechas): para eso está "Liberar" en Candidatas. Idempotente.
import { pool, log } from '../db.js'

const GRACIA_DIAS = 2
const HOY = `(now() AT TIME ZONE 'America/Bogota')::date`
const ACTIVOS = `('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')`
const PRE_SALIDA = `('PROPUESTO','APROBADO','AUTORIZADA_SALIDA')`

export async function limpiezaTenjo({ dryRun = false } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Borradores vencidos sin nada que haya salido de la nevera
    const { rows: lotes } = await client.query(
      `SELECT l.id, l.numero_lote, l.fecha_jornada
         FROM public.lotes_tenjo l
        WHERE l.estado IN ('PROPUESTO','EN_REVISION')
          AND l.fecha_jornada < ${HOY} - $1::int
          AND NOT EXISTS (
            SELECT 1 FROM public.lotes_tenjo_items li
             LEFT JOIN public.traslados_tenjo t ON t.id = li.traslado_id
            WHERE li.lote_id = l.id
              AND (li.estado IN ('EN_TRASLADO','RECIBIDA','EN_PROCESO','PROCESADO')
                   OR t.estado IN ('EN_CAMINO','COMPLETADO')))
        FOR UPDATE OF l`,
      [GRACIA_DIAS]
    )
    const loteIds = lotes.map(l => l.id)
    let itemsLotes = 0
    if (loteIds.length) {
      await client.query(
        `UPDATE public.traslados_tenjo t SET estado = 'CANCELADO'
           FROM public.lotes_tenjo_items li
          WHERE t.id = li.traslado_id AND li.lote_id = ANY($1)
            AND li.estado IN ${PRE_SALIDA} AND t.estado = 'PROGRAMADO'`,
        [loteIds]
      )
      const r = await client.query(
        `UPDATE public.lotes_tenjo_items SET estado = 'RETIRADO_DEL_LOTE', traslado_id = NULL
          WHERE lote_id = ANY($1) AND estado IN ${PRE_SALIDA}`,
        [loteIds]
      )
      itemsLotes = r.rowCount
      await client.query(
        `UPDATE public.lotes_tenjo SET estado = 'CANCELADO',
                observaciones_cierre = 'Cancelado por limpieza automática: borrador con la jornada vencida'
          WHERE id = ANY($1)`,
        [loteIds]
      )
    }

    // 2. Items pre-salida olvidados en lotes ya cerrados/cancelados
    const { rows: huerfanos } = await client.query(
      `UPDATE public.lotes_tenjo_items li SET estado = 'RETIRADO_DEL_LOTE'
         FROM public.lotes_tenjo l
        WHERE l.id = li.lote_id AND l.estado IN ('CERRADO','CANCELADO')
          AND li.estado IN ${PRE_SALIDA}
          AND (li.traslado_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.traslados_tenjo t
                 WHERE t.id = li.traslado_id AND t.estado IN ('EN_CAMINO','COMPLETADO')))
        RETURNING li.id, li.traslado_id, l.numero_lote`
    )
    const trasHuerfanos = huerfanos.map(h => h.traslado_id).filter(Boolean)
    if (trasHuerfanos.length) {
      await client.query(
        `UPDATE public.traslados_tenjo SET estado = 'CANCELADO'
          WHERE id = ANY($1) AND estado = 'PROGRAMADO'`,
        [trasHuerfanos]
      )
    }

    // 3. Traslados PROGRAMADO vencidos sin lote, con la mascota aún en la nevera
    const { rows: traslados } = await client.query(
      `UPDATE public.traslados_tenjo t SET estado = 'CANCELADO'
        WHERE t.estado = 'PROGRAMADO'
          AND t.fecha_traslado < ${HOY} - $1::int
          AND NOT EXISTS (SELECT 1 FROM public.lotes_tenjo_items li
                           WHERE li.traslado_id = t.id AND li.estado IN ${ACTIVOS})
          AND EXISTS (SELECT 1 FROM public.cuarto_frio cf
                       WHERE cf.servicio_id = t.servicio_id AND cf.fecha_salida IS NULL)
        RETURNING t.id, t.servicio_id, t.fecha_traslado`,
      [GRACIA_DIAS]
    )

    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    const resumen = {
      dryRun,
      lotesCancelados: lotes.map(l => l.numero_lote),
      itemsRetiradosDeLotesCancelados: itemsLotes,
      itemsHuerfanos: huerfanos.map(h => h.numero_lote),
      trasladosCancelados: traslados.length,
    }
    if (lotes.length || huerfanos.length || traslados.length) log('[limpieza-tenjo]', JSON.stringify(resumen))
    return resumen
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
