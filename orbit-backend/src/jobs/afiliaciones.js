// Job: vencimientos de afiliaciones pre-exequiales (migración 053).
// Solo ANUAL (vitalicio no vence). Idempotente, corre a diario:
//   · contrato vigente vencido                → VIGENTE  → VENCIDA
//   · vencido hace más de `dias_gracia` días  → VENCIDA  → CANCELADA
//     (reactivar = afiliación nueva desde contrato 0, cláusulas reactivadas)
// El aviso de renovación NO se envía desde aquí: la pestaña "Por vencer" de
// /presequiales lo gestiona el coordinador por wa.me (regla de canales WA).
import { pool, log } from '../db.js'

export async function jobAfiliaciones() {
  const client = await pool.connect()
  try {
    const { rows: cfg } = await client.query(
      `SELECT valor FROM public.config_operativa
       WHERE modulo = 'AFILIACIONES' AND clave = 'dias_gracia'`)
    const diasGracia = parseInt(cfg[0]?.valor) || 15

    // Contrato vigente = el de mayor número por afiliación.
    // Primero la cancelación (cubre VIGENTE y VENCIDA por si el cron estuvo caído).
    const { rows: canceladas } = await client.query(`
      UPDATE public.afiliaciones a SET estado = 'CANCELADA'
      FROM (
        SELECT DISTINCT ON (afiliacion_id) afiliacion_id, fecha_vencimiento
        FROM public.afiliacion_contratos
        WHERE fecha_vencimiento IS NOT NULL
        ORDER BY afiliacion_id, numero DESC
      ) c
      WHERE c.afiliacion_id = a.id
        AND a.tipo = 'ANUAL' AND a.estado IN ('VIGENTE','VENCIDA')
        AND c.fecha_vencimiento + $1::int < (now() AT TIME ZONE 'America/Bogota')::date
      RETURNING a.id`, [diasGracia])

    const { rows: vencidas } = await client.query(`
      UPDATE public.afiliaciones a SET estado = 'VENCIDA'
      FROM (
        SELECT DISTINCT ON (afiliacion_id) afiliacion_id, fecha_vencimiento
        FROM public.afiliacion_contratos
        WHERE fecha_vencimiento IS NOT NULL
        ORDER BY afiliacion_id, numero DESC
      ) c
      WHERE c.afiliacion_id = a.id
        AND a.tipo = 'ANUAL' AND a.estado = 'VIGENTE'
        AND c.fecha_vencimiento < (now() AT TIME ZONE 'America/Bogota')::date
      RETURNING a.id`)

    const out = { vencidas: vencidas.length, canceladas: canceladas.length, dias_gracia: diasGracia }
    log('[afiliaciones]', JSON.stringify(out))
    return out
  } finally {
    client.release()
  }
}
