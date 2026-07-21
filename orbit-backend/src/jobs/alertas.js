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

    // ── Cenizas / compostaje listos → notificar UNA sola vez ──
    // Se avisa por `notificaciones` (la campana del Topbar; alertas_operativas no
    // tiene UI) a COORDINADOR/ADMIN/OPERARIO cuando el plazo se cumple y el
    // servicio sigue EN_PROCESO (aún sin avanzar a Producción). Reglas de plazo
    // espejo de lib/tenjo.js: cremación = fin + 5 días; compostaje = inicio +
    // meses_compostaje meses (½ mes ≈ 15 días, que es como Postgres expande
    // `2.5 * interval '1 month'`). Dedup: no repite si ya hay una notificación
    // de ese tipo para ese servicio → se informa una vez, no a diario.
    const CORTE = '2026-06-09' // FECHA_CORTE (lib/constants.js): no avisar de datos ocultos
    const listos = []

    const { rows: cenizas } = await client.query(
      `SELECT li.servicio_id, m.nombre AS mascota,
              (li.fecha_fin_proceso::date + 5) AS fecha_listo
       FROM public.lotes_tenjo_items li
       JOIN public.servicios s ON s.id = li.servicio_id
       JOIN public.planes pl ON pl.id = s.plan_id
       LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       WHERE li.estado = 'PROCESADO'
         AND pl.tipo_proceso = 'CREMACION_INDIVIDUAL'
         AND li.fecha_fin_proceso IS NOT NULL
         AND s.estado = 'EN_PROCESO'
         AND s.fecha_ingreso >= $1
         AND (li.fecha_fin_proceso::date + 5) <= (now() AT TIME ZONE 'America/Bogota')::date`,
      [CORTE]
    )
    for (const r of cenizas) {
      listos.push({
        tipo: 'CENIZAS_LISTAS', servicio_id: r.servicio_id,
        titulo: 'Cenizas listas',
        mensaje: `${r.mascota || 'Una mascota'}: las cenizas ya están listas (5 días desde la cremación, ${r.fecha_listo}). Se pueden preparar y avanzar a Producción.`,
        datos: { servicio_id: r.servicio_id, mascota: r.mascota, fecha_listo: r.fecha_listo, proceso: 'CREMACION_INDIVIDUAL' },
      })
    }

    const { rows: compost } = await client.query(
      `SELECT li.servicio_id, m.nombre AS mascota, li.meses_compostaje,
              (li.fecha_compostaje_inicio + li.meses_compostaje * interval '1 month')::date AS fecha_listo
       FROM public.lotes_tenjo_items li
       JOIN public.servicios s ON s.id = li.servicio_id
       JOIN public.planes pl ON pl.id = s.plan_id
       LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       WHERE li.estado = 'PROCESADO'
         AND pl.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL'
         AND li.fecha_compostaje_inicio IS NOT NULL
         AND s.estado = 'EN_PROCESO'
         AND s.fecha_ingreso >= $1
         AND (li.fecha_compostaje_inicio + li.meses_compostaje * interval '1 month')::date <= (now() AT TIME ZONE 'America/Bogota')::date`,
      [CORTE]
    )
    for (const r of compost) {
      const meses = Number(r.meses_compostaje) || 2
      listos.push({
        tipo: 'COMPOSTAJE_LISTO', servicio_id: r.servicio_id,
        titulo: 'Compostaje listo',
        mensaje: `${r.mascota || 'Una mascota'}: el compostaje cumplió su tiempo (${meses} ${meses === 1 ? 'mes' : 'meses'}, ${r.fecha_listo}). Revisar el cubículo y avanzar a Producción.`,
        datos: { servicio_id: r.servicio_id, mascota: r.mascota, fecha_listo: r.fecha_listo, meses, proceso: 'COMPOSTAJE_INDIVIDUAL' },
      })
    }

    let notificados = 0
    for (const a of listos) {
      const r = await client.query(
        `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, servicio_id, datos)
         SELECT p.id, $1, $2, $3, $4, $5::jsonb
         FROM public.personal p
         JOIN public.roles_personal r ON r.id = p.rol_principal_id
         WHERE r.nombre IN ('COORDINADOR','ADMIN','OPERARIO') AND p.activo
           AND NOT EXISTS (
             SELECT 1 FROM public.notificaciones n
             WHERE n.para_personal_id = p.id AND n.tipo = $1 AND n.servicio_id = $4
           )`,
        [a.tipo, a.titulo, a.mensaje, a.servicio_id, JSON.stringify(a.datos)]
      )
      notificados += r.rowCount
    }

    const resultado = { evaluadas: candidatas.length, alertas_vigentes: deseadas.length, creadas, auto_resueltas: resueltas, listos: listos.length, notificados }
    log('[alertas]', JSON.stringify(resultado))
    return resultado
  } finally {
    client.release()
  }
}
