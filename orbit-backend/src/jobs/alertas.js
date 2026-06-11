// Job: motor diario de alertas operativas Tenjo.
// Crea alertas persistentes con dedupe (índice único parcial) y auto-resuelve
// las que ya no aplican. Corre a diario por cron; también puede dispararse manual.
import { pool, log } from '../db.js'
import { cargarConfig, evaluarCandidato } from '../reglas.js'

export async function motorAlertas() {
  const client = await pool.connect()
  try {
    const config = await cargarConfig(client)
    const deseadas = []

    // ── Alertas por candidata en custodia ──
    const { rows: candidatas } = await client.query(`SELECT * FROM public.v_candidatos_tenjo`)
    for (const c of candidatas) {
      const ev = evaluarCandidato(c, config)
      const base = { servicio_id: c.servicio_id, lote_id: null, metadata: { mascota: c.mascota } }

      if (!c.item_activo_id && !c.traslado_activo && c.dias_custodia >= (config.dias_custodia_alerta ?? 5)) {
        const critica = c.dias_custodia >= (config.dias_custodia_critica ?? 8)
        deseadas.push({
          ...base,
          tipo_alerta: 'SIN_PROGRAMAR',
          prioridad: critica ? 'CRITICA' : 'ALTA',
          mensaje: `${c.mascota} lleva ${c.dias_custodia} días en custodia sin programación Tenjo`,
          accion_recomendada: 'Revisar motivo y programar en el próximo lote',
          clave_dedupe: `TENJO:SIN_PROGRAMAR:${c.servicio_id}`,
        })
      }
      if (c.nevera_destino === 'GRUPALES') {
        deseadas.push({
          ...base,
          tipo_alerta: 'NEVERA_INCORRECTA',
          prioridad: 'MEDIA',
          mensaje: `${c.mascota} es individual pero está en nevera de grupales (${c.nevera_codigo})`,
          accion_recomendada: 'Reubicar desde el módulo Cuarto Frío',
          clave_dedupe: `TENJO:NEVERA_INCORRECTA:${c.servicio_id}`,
        })
      }
      if (ev.reqConfirma && c.item_activo_id) {
        deseadas.push({
          ...base,
          tipo_alerta: 'PRESENCIAL_SIN_CONFIRMAR',
          prioridad: 'ALTA',
          mensaje: `${c.mascota} (${c.plan}) requiere confirmación del cliente antes de la jornada`,
          accion_recomendada: 'Contactar al cliente desde Tenjo → Planificación',
          clave_dedupe: `TENJO:PRESENCIAL_SIN_CONFIRMAR:${c.servicio_id}`,
        })
      }
      if ((c.veces_reprogramada || 0) >= (config.max_reprogramaciones ?? 2)) {
        deseadas.push({
          ...base,
          tipo_alerta: 'REPROGRAMACIONES_EXCESIVAS',
          prioridad: 'ALTA',
          mensaje: `${c.mascota} ha sido reprogramada ${c.veces_reprogramada} veces`,
          accion_recomendada: 'Revisar causa de fondo con el cliente o la operación',
          clave_dedupe: `TENJO:REPROGRAMACIONES_EXCESIVAS:${c.servicio_id}`,
        })
      }
    }

    // ── Lotes pasados sin cerrar ──
    const { rows: lotesAbiertos } = await client.query(
      `SELECT id, numero_lote, fecha_jornada FROM public.lotes_tenjo
       WHERE estado IN ('CONFIRMADO','EN_EJECUCION') AND fecha_jornada < CURRENT_DATE`
    )
    for (const l of lotesAbiertos) {
      deseadas.push({
        servicio_id: null,
        lote_id: l.id,
        metadata: { numero_lote: l.numero_lote },
        tipo_alerta: 'LOTE_SIN_CERRAR',
        prioridad: 'CRITICA',
        mensaje: `El lote ${l.numero_lote} terminó su jornada y sigue sin cierre`,
        accion_recomendada: 'Cerrar el lote registrando ejecutados, no ejecutados y novedades',
        clave_dedupe: `TENJO:LOTE_SIN_CERRAR:${l.id}`,
      })
    }

    // ── Insertar (el índice único de dedupe descarta las ya abiertas) ──
    let creadas = 0
    for (const a of deseadas) {
      const r = await client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, $2, 'TENJO', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (clave_dedupe)
           WHERE estado IN ('ABIERTA','EN_GESTION') AND clave_dedupe IS NOT NULL
           DO NOTHING`,
        [a.servicio_id, a.lote_id, a.tipo_alerta, a.prioridad, a.mensaje,
         a.accion_recomendada, a.clave_dedupe, JSON.stringify(a.metadata)]
      )
      creadas += r.rowCount
    }

    // ── Auto-resolver las abiertas cuya condición desapareció ──
    const vigentes = deseadas.map(a => a.clave_dedupe)
    const { rowCount: resueltas } = await client.query(
      `UPDATE public.alertas_operativas
       SET estado = 'RESUELTA', fecha_resolucion = now()
       WHERE modulo_origen = 'TENJO'
         AND estado IN ('ABIERTA','EN_GESTION')
         AND clave_dedupe IS NOT NULL
         AND NOT (clave_dedupe = ANY($1::text[]))`,
      [vigentes]
    )

    const resultado = { evaluadas: candidatas.length, alertas_vigentes: deseadas.length, creadas, auto_resueltas: resueltas }
    log('[alertas]', JSON.stringify(resultado))
    return resultado
  } finally {
    client.release()
  }
}
