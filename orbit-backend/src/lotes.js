// Operaciones críticas sobre lotes Tenjo — transaccionales, con lock de filas
// y revalidación en el momento de la decisión. Estas escrituras NO pasan por
// PostgREST: el backend es la única vía (Fase 3).
import { pool, log } from './db.js'
import { cargarConfig, evaluarCandidato } from './reglas.js'
import { validarItemParaCierre } from './checklists.js'

const ITEMS_ACTIVOS = ['PROPUESTO', 'APROBADO', 'AUTORIZADA_SALIDA', 'EN_TRASLADO', 'RECIBIDA', 'EN_PROCESO']

async function itemsDelLote(client, loteId) {
  const { rows } = await client.query(
    `SELECT li.*, p.codigo AS plan_codigo, s.tipo_acompanamiento,
            m.nombre AS mascota
     FROM public.lotes_tenjo_items li
     JOIN public.servicios s ON s.id = li.servicio_id
     JOIN public.planes p    ON p.id = s.plan_id
     JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
     WHERE li.lote_id = $1
     FOR UPDATE OF li`,
    [loteId]
  )
  return rows
}

/** Confirmar lote: revalida aprobados, autoriza salida y crea traslados. */
export async function confirmarLote({ loteId, personalId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: lotes } = await client.query(
      `SELECT * FROM public.lotes_tenjo WHERE id = $1 FOR UPDATE`, [loteId]
    )
    const lote = lotes[0]
    if (!lote) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Lote no encontrado' } } }
    if (!['PROPUESTO', 'EN_REVISION'].includes(lote.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { error: `El lote ya está ${lote.estado}. Recarga la página.` } }
    }

    const config = await cargarConfig(client)
    const items = await itemsDelLote(client, loteId)
    const { rows: candidatas } = await client.query(`SELECT * FROM public.v_candidatos_tenjo`)
    const porServicio = Object.fromEntries(candidatas.map(c => [c.servicio_id, c]))

    const resumen = { autorizadas: 0, reprogramadas: 0, rechazadas: [] }

    for (const item of items) {
      if (item.estado === 'APROBADO') {
        const c = porServicio[item.servicio_id]
        const ev = c ? evaluarCandidato(c, config, item) : null
        const sigueApta = ev && !ev.bloqueos.length
          && (!ev.reqConfirma || item.confirmacion_cliente === true)
        if (!sigueApta) {
          const motivo = !c ? 'Ya no está disponible en custodia'
            : (ev.bloqueos[0] || 'Pendiente confirmación del cliente al confirmar lote')
          await client.query(
            `UPDATE public.lotes_tenjo_items
             SET estado = 'REPROGRAMADO', motivo_reprogramacion = $2, decidido_por = $3
             WHERE id = $1`, [item.id, motivo, personalId]
          )
          resumen.rechazadas.push({ mascota: item.mascota, motivo })
          continue
        }
        // NOTA: traslados_tenjo.lote_id es una FK legada a lotes_grupales (no a
        // lotes_tenjo); el vínculo con este lote queda en lotes_tenjo_items.traslado_id
        // y en `notas`. No se envía lote_id para no violar la FK.
        const { rows: tras } = await client.query(
          `INSERT INTO public.traslados_tenjo (servicio_id, estado, fecha_traslado, notas)
           VALUES ($1, 'PROGRAMADO', $2, $3)
           ON CONFLICT (servicio_id) WHERE estado IN ('PROGRAMADO','EN_CAMINO') DO NOTHING
           RETURNING id`,
          [item.servicio_id, lote.fecha_jornada, `Lote ${lote.numero_lote}`]
        )
        if (!tras[0]) {
          await client.query(
            `UPDATE public.lotes_tenjo_items
             SET estado = 'REPROGRAMADO', motivo_reprogramacion = 'Ya tenía un traslado activo', decidido_por = $2
             WHERE id = $1`, [item.id, personalId]
          )
          resumen.rechazadas.push({ mascota: item.mascota, motivo: 'Ya tenía un traslado activo' })
          continue
        }
        await client.query(
          `UPDATE public.lotes_tenjo_items
           SET estado = 'AUTORIZADA_SALIDA', traslado_id = $2, decidido_por = $3
           WHERE id = $1`, [item.id, tras[0].id, personalId]
        )
        resumen.autorizadas++
      } else if (item.estado === 'PROPUESTO') {
        await client.query(
          `UPDATE public.lotes_tenjo_items
           SET estado = 'REPROGRAMADO',
               motivo_reprogramacion = COALESCE(motivo_reprogramacion, 'Sin decisión al confirmar el lote'),
               decidido_por = $2
           WHERE id = $1`, [item.id, personalId]
        )
        resumen.reprogramadas++
      }
    }

    await client.query(
      `UPDATE public.lotes_tenjo SET estado = 'CONFIRMADO' WHERE id = $1`, [loteId]
    )
    await client.query('COMMIT')
    log('[confirmar]', lote.numero_lote, JSON.stringify(resumen))
    return { status: 200, body: resumen }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Cerrar lote: valida checklist/evidencias de los procesados y exige motivo
 * por cada no ejecutado. Si algo falta, NO cierra (422 con el detalle).
 * body: { no_ejecutados: { [itemId]: motivo }, observaciones, novedades }
 */
export async function cerrarLote({ loteId, personalId, body = {} }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: lotes } = await client.query(
      `SELECT * FROM public.lotes_tenjo WHERE id = $1 FOR UPDATE`, [loteId]
    )
    const lote = lotes[0]
    if (!lote) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Lote no encontrado' } } }
    if (!['CONFIRMADO', 'EN_EJECUCION'].includes(lote.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { error: `El lote está ${lote.estado}; solo se cierran lotes confirmados o en ejecución.` } }
    }

    const config = await cargarConfig(client)
    const items = await itemsDelLote(client, loteId)
    const activos = items.filter(i => ITEMS_ACTIVOS.includes(i.estado) && i.estado !== 'PROPUESTO')

    // ── Validaciones de bloqueo de cierre ──
    const bloqueos = []
    const procesados = activos.filter(i => i.estado === 'PROCESADO')
    for (const it of procesados) {
      const faltantes = validarItemParaCierre(
        it, { codigo: it.plan_codigo, tipo_acompanamiento: it.tipo_acompanamiento }, config
      )
      if (faltantes.length) bloqueos.push({ item_id: it.id, mascota: it.mascota, faltantes })
    }
    const pendientes = activos.filter(i => i.estado !== 'PROCESADO')
    const motivos = body.no_ejecutados || {}
    for (const it of pendientes) {
      if (!motivos[it.id]?.trim()) {
        bloqueos.push({ item_id: it.id, mascota: it.mascota, faltantes: [`No ejecutado (${it.estado}) sin motivo registrado`] })
      }
    }
    if (bloqueos.length) {
      await client.query('ROLLBACK')
      return { status: 422, body: { error: 'El lote no se puede cerrar: hay pendientes obligatorios.', bloqueos } }
    }

    // ── Cierre ──
    for (const it of pendientes) {
      await client.query(
        `UPDATE public.lotes_tenjo_items
         SET estado = 'NO_EJECUTADO', motivo_reprogramacion = $2, decidido_por = $3
         WHERE id = $1`, [it.id, motivos[it.id].trim(), personalId]
      )
    }

    const resumen = {
      programados:   activos.length,
      ejecutados:    procesados.length,
      no_ejecutados: pendientes.map(it => ({ mascota: it.mascota, motivo: motivos[it.id]?.trim() })),
      cerrado_en:    new Date().toISOString(),
    }
    await client.query(
      `UPDATE public.lotes_tenjo
       SET estado = 'CERRADO', fecha_cierre = now(), cerrado_por = $2,
           observaciones_cierre = $3,
           novedades = $4::jsonb
       WHERE id = $1`,
      [loteId, personalId, body.observaciones || null,
       JSON.stringify({ resumen, novedades_texto: body.novedades || null })]
    )
    await client.query('COMMIT')
    log('[cerrar]', lote.numero_lote, JSON.stringify(resumen))
    return { status: 200, body: { ...resumen, numero_lote: lote.numero_lote } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
