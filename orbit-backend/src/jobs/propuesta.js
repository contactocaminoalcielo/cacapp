// Job: generar la propuesta de lote Tenjo para la próxima jornada.
// El cron lo dispara a diario; el job decide según config_operativa si hoy
// es día de planificación (lun/mié/vie por defecto). Transaccional.
import { pool, log } from '../db.js'
import { cargarConfig, proximaJornada, numeroLote, evaluarCandidato } from '../reglas.js'

export async function generarPropuesta({ force = false } = {}) {
  const client = await pool.connect()
  try {
    const config = await cargarConfig(client)
    const hoy = new Date()

    if (!force && !(config.dias_planificacion || []).includes(hoy.getDay())) {
      return { skipped: true, motivo: 'Hoy no es día de planificación' }
    }

    const fechaJornada = proximaJornada(config, hoy)
    if (!fechaJornada) return { skipped: true, motivo: 'Sin días de operación configurados' }

    await client.query('BEGIN')

    // Lote de la jornada (el índice único parcial evita duplicados)
    const ins = await client.query(
      `INSERT INTO public.lotes_tenjo (numero_lote, fecha_jornada, estado, generado_por)
       VALUES ($1, $2, 'PROPUESTO', 'SISTEMA')
       ON CONFLICT (fecha_jornada) WHERE estado <> 'CANCELADO' DO NOTHING
       RETURNING *`,
      [numeroLote(fechaJornada), fechaJornada]
    )
    let lote = ins.rows[0]
    if (!lote) {
      const { rows } = await client.query(
        `SELECT * FROM public.lotes_tenjo WHERE fecha_jornada = $1 AND estado <> 'CANCELADO'`,
        [fechaJornada]
      )
      lote = rows[0]
    }

    let agregadas = 0
    if (lote && ['PROPUESTO', 'EN_REVISION'].includes(lote.estado)) {
      const { rows: candidatas } = await client.query(
        `SELECT * FROM public.v_candidatos_tenjo
         WHERE item_activo_id IS NULL AND NOT traslado_activo`
      )
      for (const c of candidatas) {
        const ev = evaluarCandidato(c, config)
        const r = await client.query(
          `INSERT INTO public.lotes_tenjo_items
             (lote_id, servicio_id, clasificacion, estado, bloqueos, validaciones, contacto_estado, veces_reprogramada)
           VALUES ($1, $2, $3, 'PROPUESTO', $4, $5, $6, $7)
           ON CONFLICT (servicio_id)
             WHERE estado IN ('PROPUESTO','APROBADO','AUTORIZADA_SALIDA','EN_TRASLADO','RECIBIDA','EN_PROCESO')
             DO NOTHING`,
          [lote.id, c.servicio_id, ev.clasificacion,
           JSON.stringify(ev.bloqueos), JSON.stringify(ev.validaciones),
           ev.reqConfirma ? 'PENDIENTE' : 'NO_REQUERIDO', c.veces_reprogramada || 0]
        )
        agregadas += r.rowCount
      }
    }

    await client.query('COMMIT')

    // Notificar coordinadores (best-effort, fuera de la transacción)
    if (agregadas > 0) {
      try {
        await client.query(
          `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
           SELECT p.id, 'TENJO_PROPUESTA',
                  'Propuesta Tenjo lista para revisar',
                  $1, $2::jsonb
           FROM public.personal p
           JOIN public.roles_personal r ON r.id = p.rol_principal_id
           WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
          [`Se propusieron ${agregadas} mascotica(s) para la jornada del ${fechaJornada}. Revisa y aprueba en Tenjo → Planificación.`,
           JSON.stringify({ lote_id: lote?.id, fecha_jornada: fechaJornada, agregadas })]
        )
      } catch (e) {
        log('[propuesta] aviso: no se pudo notificar coordinadores:', e.message)
      }
    }

    const resultado = { lote: lote?.numero_lote, estado: lote?.estado, fecha_jornada: fechaJornada, agregadas }
    log('[propuesta]', JSON.stringify(resultado))
    return resultado
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
