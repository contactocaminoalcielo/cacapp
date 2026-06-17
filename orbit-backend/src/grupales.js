// Operaciones críticas de Reportes Grupales — transaccionales e idempotentes.
// Toda escritura que afecta estado/evidencia pasa por aquí (no por React),
// cerrando la ventana de inconsistencia del flujo anterior.
import { pool, log } from './db.js'
import { cargarConfigGrupales, validarItem, mensajeReporte, etiquetaProceso } from './reglas-grupales.js'
import { enviarWhatsAppGHL, enviarPlantillaGHL } from './whatsapp.js'

const ITEM_ACTIVOS = ['PENDIENTE', 'VALIDADO', 'ENVIADO', 'REENVIADO', 'VENCIDO']

// ─── Servicios de un lote, con todo lo necesario para validar ────────────────
async function serviciosDelLote(client, loteId) {
  const { rows } = await client.query(
    `SELECT s.id              AS servicio_id,
            s.estado,
            s.fecha_ingreso   AS fecha_base,
            m.nombre          AS mascota_nombre,
            m.peso_kg,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario_nombre,
            c.whatsapp        AS canal_destino,
            p.codigo          AS plan_codigo,
            p.tipo_proceso
     FROM public.servicios s
     JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
     LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
     LEFT JOIN public.planes p    ON p.id = s.plan_id
     WHERE s.lote_id = $1`,
    [loteId]
  )
  return rows
}

async function evento(client, { reporteId, itemId = null, servicioId = null, tipo, detalle = {}, actor = null }) {
  await client.query(
    `INSERT INTO public.reportes_grupales_eventos (reporte_id, item_id, servicio_id, tipo_evento, detalle, actor)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [reporteId, itemId, servicioId, tipo, JSON.stringify(detalle), actor]
  )
}

// ─── Recalcular rollups + estado del reporte ─────────────────────────────────
async function recomputarReporte(client, reporteId) {
  const { rows } = await client.query(
    `SELECT estado, datos_completos FROM public.reportes_grupales_items WHERE reporte_id = $1`,
    [reporteId]
  )
  const total    = rows.length
  const enviados = rows.filter(r => ['ENVIADO', 'REENVIADO'].includes(r.estado)).length
  const conError = rows.filter(r => r.estado === 'ERROR').length

  const { rows: rep } = await client.query(`SELECT estado FROM public.reportes_grupales WHERE id = $1`, [reporteId])
  let estado = rep[0]?.estado || 'PENDIENTE'
  const pendientesEnviables = rows.filter(r => ['PENDIENTE', 'VALIDADO', 'VENCIDO'].includes(r.estado)).length

  if (total > 0 && enviados === total)               estado = 'ENVIADO'
  else if (enviados > 0 && pendientesEnviables > 0)  estado = 'ENVIADO_PARCIAL'
  else if (estado === 'PENDIENTE' && enviados === 0 && conError > 0) estado = 'ERROR'

  await client.query(
    `UPDATE public.reportes_grupales
     SET total_items = $2, enviados = $3, con_error = $4, estado = $5
     WHERE id = $1`,
    [reporteId, total, enviados, conError, estado]
  )
  return { total, enviados, conError, estado }
}

/**
 * Construye (o re-sincroniza) el reporte de un lote COMPLETADO y sus ítems.
 * Idempotente: respeta ítems ya enviados, refresca validaciones de los pendientes,
 * marca EXCLUIDO los que dejaron de corresponder (cambio de plan / cancelado).
 * Devuelve { reporteId, creados, actualizados, excluidos }.
 */
export async function construirReporteDeLote(client, lote, { generadoPor = null, config = null } = {}) {
  config = config || await cargarConfigGrupales(client)
  const sla = parseInt(config.sla_dias_habiles) || 3

  // 1. Upsert del reporte (1:1 con el lote)
  const { rows: repRows } = await client.query(
    `INSERT INTO public.reportes_grupales (lote_id, tipo_proceso, estado, generado_por)
     VALUES ($1, $2, 'PENDIENTE', $3)
     ON CONFLICT (lote_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [lote.id, lote.tipo_proceso, generadoPor]
  )
  const reporteId = repRows[0].id

  const servicios = await serviciosDelLote(client, lote.id)
  let creados = 0, actualizados = 0, excluidos = 0

  for (const svc of servicios) {
    const { validacion, datos_completos, motivo_exclusion } = validarItem(svc, lote, config)

    // Vencimiento por destinatario (SLA desde fecha_ingreso, con festivos)
    const { rows: vRows } = await client.query(
      `SELECT public.fn_sumar_dias_habiles($1::date, $2::int) AS venc`,
      [svc.fecha_base, sla]
    )
    const fechaVenc = vRows[0]?.venc || null

    // ¿Ya existe el ítem?
    const { rows: exist } = await client.query(
      `SELECT id, estado FROM public.reportes_grupales_items
       WHERE reporte_id = $1 AND servicio_id = $2`,
      [reporteId, svc.servicio_id]
    )

    if (!exist[0]) {
      // Evitar que entre un servicio que ya está activo en OTRO reporte (criterio #8)
      const { rows: enOtro } = await client.query(
        `SELECT 1 FROM public.reportes_grupales_items
         WHERE servicio_id = $1 AND reporte_id <> $2 AND estado = ANY($3)`,
        [svc.servicio_id, reporteId, ITEM_ACTIVOS]
      )
      if (enOtro[0]) { excluidos++; continue }

      const estadoItem = motivo_exclusion ? 'EXCLUIDO' : (datos_completos ? 'VALIDADO' : 'PENDIENTE')
      const { rows: ins } = await client.query(
        `INSERT INTO public.reportes_grupales_items
           (reporte_id, servicio_id, mascota_nombre, propietario_nombre, canal_destino,
            plan_codigo, peso_kg, fecha_base, fecha_vencimiento, estado, validacion, datos_completos, motivo_exclusion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
         RETURNING id`,
        [reporteId, svc.servicio_id, svc.mascota_nombre, svc.propietario_nombre, svc.canal_destino,
         svc.plan_codigo, svc.peso_kg, svc.fecha_base, fechaVenc, estadoItem,
         JSON.stringify(validacion), datos_completos, motivo_exclusion]
      )
      creados++
      await evento(client, { reporteId, itemId: ins[0].id, servicioId: svc.servicio_id,
        tipo: 'CREADO', detalle: { datos_completos, motivo_exclusion }, actor: generadoPor })
    } else {
      // No tocar los ya enviados; refrescar validación de los demás
      if (['ENVIADO', 'REENVIADO'].includes(exist[0].estado)) { actualizados++; continue }
      let nuevoEstado = exist[0].estado
      if (motivo_exclusion) nuevoEstado = 'EXCLUIDO'
      else if (exist[0].estado === 'EXCLUIDO') nuevoEstado = datos_completos ? 'VALIDADO' : 'PENDIENTE'
      else if (exist[0].estado !== 'VENCIDO') nuevoEstado = datos_completos ? 'VALIDADO' : 'PENDIENTE'

      await client.query(
        `UPDATE public.reportes_grupales_items
         SET mascota_nombre=$2, propietario_nombre=$3, canal_destino=$4, plan_codigo=$5, peso_kg=$6,
             fecha_base=$7, fecha_vencimiento=$8, estado=$9, validacion=$10::jsonb,
             datos_completos=$11, motivo_exclusion=$12
         WHERE id=$1`,
        [exist[0].id, svc.mascota_nombre, svc.propietario_nombre, svc.canal_destino, svc.plan_codigo, svc.peso_kg,
         svc.fecha_base, fechaVenc, nuevoEstado, JSON.stringify(validacion), datos_completos, motivo_exclusion]
      )
      if (motivo_exclusion && exist[0].estado !== 'EXCLUIDO') {
        excluidos++
        await evento(client, { reporteId, itemId: exist[0].id, servicioId: svc.servicio_id,
          tipo: 'EXCLUIDO_CAMBIO_PLAN', detalle: { motivo_exclusion }, actor: generadoPor })
      }
      actualizados++
    }
  }

  // Ancla del reporte = el vencimiento más próximo de sus ítems activos
  await client.query(
    `UPDATE public.reportes_grupales r
     SET fecha_base = sub.min_base, fecha_vencimiento = sub.min_venc
     FROM (SELECT MIN(fecha_base) AS min_base, MIN(fecha_vencimiento) AS min_venc
           FROM public.reportes_grupales_items
           WHERE reporte_id = $1 AND estado <> 'EXCLUIDO') sub
     WHERE r.id = $1`,
    [reporteId]
  )
  await recomputarReporte(client, reporteId)
  return { reporteId, creados, actualizados, excluidos }
}

/** Endpoint: marcar reporte GENERADO con el PDF ya producido y subido. */
export async function marcarGenerado({ reporteId, personalId, body = {} }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM public.reportes_grupales WHERE id=$1 FOR UPDATE`, [reporteId])
    const rep = rows[0]
    if (!rep) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Reporte no encontrado' } } }

    await client.query(
      `UPDATE public.reportes_grupales
       SET storage_path = COALESCE($2, storage_path),
           estado = CASE WHEN estado = 'PENDIENTE' THEN 'GENERADO' ELSE estado END,
           pdf_generado_en = now(), generado_por = COALESCE(generado_por, $3)
       WHERE id = $1`,
      [reporteId, body.storage_path || null, personalId]
    )
    await evento(client, { reporteId, tipo: 'GENERADO', detalle: { storage_path: body.storage_path }, actor: personalId })
    await client.query('COMMIT')
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Endpoint: enviar el reporte a los destinatarios (o reenviar).
 * body: { pdf_url, items?: [itemId], fromNumber?, reenvio?: bool, motivo?, mensajes?: {itemId: texto} }
 * - No envía ítems con datos incompletos (criterio #10).
 * - Idempotente: salta los ya ENVIADO salvo reenvío explícito con motivo (criterio #7).
 * - Cada intento (éxito o error) queda persistido (criterios #5, #6).
 */
export async function enviarReporte({ reporteId, personalId, body = {} }) {
  const pool0 = pool
  const { rows: repRows } = await pool0.query(`SELECT * FROM public.reportes_grupales WHERE id=$1`, [reporteId])
  const rep = repRows[0]
  if (!rep) return { status: 404, body: { error: 'Reporte no encontrado' } }

  const pdfUrl = body.pdf_url || null
  if (!pdfUrl && !rep.storage_path) return { status: 422, body: { error: 'No hay PDF generado para enviar.' } }
  if (body.reenvio && !body.motivo?.trim())
    return { status: 422, body: { error: 'El reenvío requiere un motivo.' } }

  const { rows: lotes } = await pool0.query(`SELECT * FROM public.lotes_grupales WHERE id=$1`, [rep.lote_id])
  const lote = lotes[0]

  const config = await cargarConfigGrupales(pool0)
  const usarPlantilla = config.usar_plantilla === true || config.usar_plantilla === 'true'

  // ítems objetivo
  const filtro = body.items?.length ? `AND id = ANY($2)` : ``
  const params = body.items?.length ? [reporteId, body.items] : [reporteId]
  const { rows: items } = await pool0.query(
    `SELECT * FROM public.reportes_grupales_items WHERE reporte_id = $1 ${filtro}`, params
  )

  const resumen = { enviados: 0, omitidos: [], errores: [] }

  for (const item of items) {
    const yaEnviado = ['ENVIADO', 'REENVIADO'].includes(item.estado)
    if (yaEnviado && !body.reenvio) { resumen.omitidos.push({ mascota: item.mascota_nombre, motivo: 'Ya enviado' }); continue }
    if (item.estado === 'EXCLUIDO') { resumen.omitidos.push({ mascota: item.mascota_nombre, motivo: item.motivo_exclusion || 'Excluido' }); continue }
    if (!item.datos_completos)      { resumen.omitidos.push({ mascota: item.mascota_nombre, motivo: 'Datos incompletos' }); continue }

    const mensaje = body.mensajes?.[item.id] || mensajeReporte(item, lote)

    // Envío (red, fuera de transacción) → luego se persiste atómicamente
    let envioOk = null, envioErr = null
    try {
      if (usarPlantilla && config.plantilla_nombre) {
        // Fuera de la ventana de 24h: plantilla aprobada (HSM) con PDF de cabecera
        envioOk = await enviarPlantillaGHL({
          telefono: item.canal_destino, nombre: item.propietario_nombre,
          plantillaNombre: config.plantilla_nombre, idioma: config.plantilla_idioma || 'es',
          variables: [item.propietario_nombre, etiquetaProceso(lote.tipo_proceso), item.mascota_nombre],
          headerDocumentUrl: pdfUrl, fromNumber: body.fromNumber,
        })
      } else {
        envioOk = await enviarWhatsAppGHL({
          telefono: item.canal_destino, nombre: item.propietario_nombre,
          mensaje, pdfUrl, fromNumber: body.fromNumber,
        })
      }
    } catch (e) { envioErr = e.message }

    const client = await pool0.connect()
    try {
      await client.query('BEGIN')
      if (envioOk) {
        await client.query(
          `INSERT INTO public.reportes_grupales_envios
             (item_id, reporte_id, servicio_id, canal, destino, pdf_url, message_id, contact_id,
              estado, es_reenvio, motivo_reenvio, enviado_por)
           VALUES ($1,$2,$3,'WHATSAPP_ZOLUTIUM',$4,$5,$6,$7,'ENVIADO',$8,$9,$10)`,
          [item.id, reporteId, item.servicio_id, item.canal_destino, pdfUrl,
           envioOk.messageId, envioOk.contactId, !!body.reenvio, body.reenvio ? body.motivo.trim() : null, personalId]
        )
        await client.query(
          `UPDATE public.reportes_grupales_items SET estado=$2, enviado_en=now() WHERE id=$1`,
          [item.id, body.reenvio ? 'REENVIADO' : 'ENVIADO']
        )
        await evento(client, { reporteId, itemId: item.id, servicioId: item.servicio_id,
          tipo: body.reenvio ? 'REENVIO' : 'ENVIADO',
          detalle: { message_id: envioOk.messageId, contact_id: envioOk.contactId, motivo: body.motivo || null }, actor: personalId })
        resumen.enviados++
      } else {
        await client.query(
          `INSERT INTO public.reportes_grupales_envios
             (item_id, reporte_id, servicio_id, canal, destino, pdf_url, estado, error, es_reenvio, motivo_reenvio, enviado_por)
           VALUES ($1,$2,$3,'WHATSAPP_ZOLUTIUM',$4,$5,'ERROR',$6,$7,$8,$9)`,
          [item.id, reporteId, item.servicio_id, item.canal_destino, pdfUrl, envioErr,
           !!body.reenvio, body.reenvio ? body.motivo?.trim() : null, personalId]
        )
        await client.query(`UPDATE public.reportes_grupales_items SET estado='ERROR' WHERE id=$1`, [item.id])
        await evento(client, { reporteId, itemId: item.id, servicioId: item.servicio_id,
          tipo: 'ERROR', detalle: { error: envioErr }, actor: personalId })
        resumen.errores.push({ mascota: item.mascota_nombre, error: envioErr })
      }
      await recomputarReporte(client, reporteId)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      resumen.errores.push({ mascota: item.mascota_nombre, error: 'Error persistiendo envío: ' + e.message })
    } finally { client.release() }
  }

  log('[grupales/enviar]', rep.id, JSON.stringify(resumen))
  return { status: 200, body: resumen }
}

/**
 * Cambio de plan (criterio #11): permitir + sacar del lote grupal + alerta.
 * - Si el servicio está en un lote grupal, limpia servicios.lote_id.
 * - Si tenía un ítem activo en un reporte, lo marca EXCLUIDO con evento.
 * - Crea una alerta operativa (dedupe NULL para que el job no la auto-resuelva).
 * Idempotente y transaccional. Llamado desde Kanban al confirmar el cambio.
 */
export async function desvincularServicioDeGrupal({ servicioId, personalId, motivo = 'Cambio de plan' }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: svcRows } = await client.query(
      `SELECT s.id, s.lote_id, m.nombre AS mascota
       FROM public.servicios s
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       WHERE s.id = $1 FOR UPDATE OF s`, [servicioId]
    )
    const svc = svcRows[0]
    if (!svc) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Servicio no encontrado' } } }

    // ¿El lote actual es grupal? (solo entonces lo desvinculamos)
    let eraGrupal = false
    if (svc.lote_id) {
      const { rows: lg } = await client.query(
        `SELECT id, tipo_proceso, numero_lote FROM public.lotes_grupales WHERE id = $1`, [svc.lote_id]
      )
      eraGrupal = !!lg[0]
      if (eraGrupal) {
        await client.query(`UPDATE public.servicios SET lote_id = NULL WHERE id = $1`, [servicioId])
      }
    }

    // Excluir ítem(s) activo(s) en reportes
    const { rows: items } = await client.query(
      `SELECT id, reporte_id FROM public.reportes_grupales_items
       WHERE servicio_id = $1 AND estado = ANY($2)`,
      [servicioId, ITEM_ACTIVOS]
    )
    for (const it of items) {
      await client.query(
        `UPDATE public.reportes_grupales_items
         SET estado = 'EXCLUIDO', motivo_exclusion = $2 WHERE id = $1`,
        [it.id, motivo]
      )
      await evento(client, { reporteId: it.reporte_id, itemId: it.id, servicioId,
        tipo: 'EXCLUIDO_CAMBIO_PLAN', detalle: { motivo }, actor: personalId })
      await recomputarReporte(client, it.reporte_id)
    }

    // Alerta (clave_dedupe NULL → el job grupal no la auto-resuelve; la cierra un humano)
    if (eraGrupal || items.length) {
      await client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, 'REPORTES_GRUPALES', 'CAMBIO_PLAN', 'ALTA', $2, $3, NULL, $4::jsonb)`,
        [servicioId,
         `${svc.mascota} cambió de plan y se sacó del lote grupal — revisar reclasificación`,
         'Confirmar el nuevo proceso y, si aplica, reasignar a otro lote',
         JSON.stringify({ mascota: svc.mascota, motivo, items_excluidos: items.length })]
      )
    }

    await client.query('COMMIT')
    return { status: 200, body: { desvinculado: eraGrupal, items_excluidos: items.length } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}
