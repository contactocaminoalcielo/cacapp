// Job diario: avisa a la familia cuando se cumple el compostaje y le pide que
// elija la especie de planta (migración 149).
//
// Regla de selección (David 2026-09-09):
//   base = `lotes_tenjo_items.fecha_compostaje_inicio` (el día que la mascota
//   ENTRÓ al cubículo) + `meses_compostaje` (2, 2.5 ó 3 — lo fija el operario
//   por cubículo). Es la MISMA regla que ya usa la pestaña Control para decir
//   "compostaje listo": si aquí se pusieran 2 meses fijos, a los de 2.5 y 3 se
//   les avisaría antes de tiempo.
//
// Dos fases, a propósito separadas:
//   1. PREPARAR — crea la fila `planta_elecciones` en PENDIENTE. Es idempotente
//      por el UNIQUE(servicio_id) y no le escribe a nadie.
//   2. ENVIAR   — manda la plantilla a los PENDIENTE/ERROR. Sin plantilla
//      aprobada en Meta NO envía: los deja PENDIENTE y avisa a coordinación.
//      Nunca marca ENVIADO algo que no salió.
import { pool, log } from '../db.js'
import { cargarConfigPlantas, plantillaAviso, construirEnlacePlanta, enviarAvisoPlanta } from '../plantas.js'

export async function jobEleccionPlanta({ dryRun = false } = {}) {
  const client = await pool.connect()
  let config
  try {
    config = await cargarConfigPlantas(client)
  } finally {
    client.release()
  }

  const activo = config.activo === true || config.activo === 'true'
  if (!activo) {
    log('[plantas/job] apagado (activo=false)')
    return { activo: false }
  }

  const tope      = parseInt(config.max_envios_por_corrida) || 30
  const arranque  = normalizarFecha(config.arranque_desde)
  const plantilla = plantillaAviso(config)

  // ── 1. Preparar: compostajes cumplidos que todavía no tienen aviso ──────────
  // `meses_compostaje` es numeric(3,1) con valores 2 / 2.5 / 3. Multiplicar un
  // INTERVAL por 2.5 da 2 meses y 15 días — el mismo redondeo que hace la UI
  // (`sumarMeses` en src/lib/tenjo.js), así que la fecha que ve el operario en
  // Control y la que dispara este job son la misma.
  const { rows: candidatos } = await pool.query(
    `SELECT i.id            AS lote_item_id,
            i.servicio_id,
            (i.fecha_compostaje_inicio + (i.meses_compostaje * INTERVAL '1 month'))::date::text AS fecha_cumplida,
            c.whatsapp
       FROM public.lotes_tenjo_items i
       JOIN public.servicios s      ON s.id = i.servicio_id
       JOIN public.planes p         ON p.id = s.plan_id
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
      WHERE i.fecha_compostaje_inicio IS NOT NULL
        AND p.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL'
        AND s.estado <> 'CANCELADO'
        AND i.estado NOT IN ('RETIRADO_DEL_LOTE', 'NO_EJECUTADO')
        AND (i.fecha_compostaje_inicio + (i.meses_compostaje * INTERVAL '1 month'))::date
            <= public.fn_hoy_bogota()
        AND ($1::date IS NULL
             OR (i.fecha_compostaje_inicio + (i.meses_compostaje * INTERVAL '1 month'))::date >= $1::date)
        AND NOT EXISTS (SELECT 1 FROM public.planta_elecciones pe
                         WHERE pe.servicio_id = i.servicio_id)
      ORDER BY i.fecha_compostaje_inicio ASC`,
    [arranque]
  )

  const r = { candidatos: candidatos.length, creados: 0, enviados: 0,
              sin_plantilla: 0, sin_whatsapp: 0, errores: 0, dry_run: dryRun }

  if (!dryRun) {
    for (const c of candidatos) {
      const client2 = await pool.connect()
      try {
        await client2.query('BEGIN')
        // Reusar el secreto que el cliente ya tiene del portal de fotos. Si el
        // servicio nunca pasó por allí, se genera aquí con la misma función.
        const { rows: cod } = await client2.query(
          `UPDATE public.servicios
              SET codigo_fotos = COALESCE(codigo_fotos, public.fn_gen_codigo_fotos())
            WHERE id = $1 RETURNING codigo_fotos`,
          [c.servicio_id]
        )
        const codigo = cod[0]?.codigo_fotos
        if (!codigo) throw new Error('sin código de portal')
        await client2.query(
          `INSERT INTO public.planta_elecciones
             (servicio_id, lote_item_id, estado, codigo, enlace, whatsapp_destino, fecha_cumplida)
           VALUES ($1, $2, 'PENDIENTE', $3, $4, $5, $6)
           ON CONFLICT (servicio_id) DO NOTHING`,
          [c.servicio_id, c.lote_item_id, codigo, construirEnlacePlanta(codigo),
           c.whatsapp || null, c.fecha_cumplida]
        )
        await client2.query('COMMIT')
        r.creados++
      } catch (e) {
        await client2.query('ROLLBACK').catch(() => {})
        if (e.code !== '23505') { r.errores++; log('[plantas/job] ERROR creando', c.servicio_id, e.message) }
      } finally {
        client2.release()
      }
    }
  }

  // ── 2. Enviar los que están listos (incluye reintentos de ERROR) ────────────
  const { rows: porEnviar } = await pool.query(
    `SELECT pe.id
       FROM public.planta_elecciones pe
       JOIN public.servicios s ON s.id = pe.servicio_id
      WHERE pe.estado IN ('PENDIENTE', 'ERROR')
        AND s.estado <> 'CANCELADO'
        -- Un reintento eterno le pega al mismo número todos los días.
        AND pe.intentos < 3
      ORDER BY pe.fecha_cumplida ASC
      LIMIT $1`,
    [tope]
  )

  if (!plantilla) {
    r.sin_plantilla = porEnviar.length
    if (porEnviar.length) {
      log('[plantas/job] SIN PLANTILLA aprobada —', porEnviar.length,
          'aviso(s) quedan PENDIENTE. Sembrar config_operativa PLANTAS/plantilla.')
      // Solo se avisa cuando aparecen casos NUEVOS. Repetirlo cada día mientras
      // la plantilla no llega convierte la campana en ruido y deja de leerse.
      if (r.creados > 0) {
        await avisarCoordinacion(
          `${porEnviar.length} mascota(s) cumplieron su compostaje y esperan que la familia elija la planta, ` +
          `pero no hay plantilla de WhatsApp aprobada. Siémbrala en Configuración → Plantas.`
        )
      }
    }
  } else if (!dryRun) {
    for (const pe of porEnviar) {
      const res = await enviarAvisoPlanta({ eleccionId: pe.id, config })
      if (res.enviado) r.enviados++
      else if (res.motivo === 'sin_whatsapp') r.sin_whatsapp++
      else if (res.motivo === 'error_envio') r.errores++
    }
  }

  log('[plantas/job]', JSON.stringify(r))
  return r
}

function normalizarFecha(v) {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Aviso a coordinadores. Best-effort: medir/avisar nunca rompe el job. */
async function avisarCoordinacion(mensaje) {
  try {
    await pool.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
       SELECT p.id, 'PLANTAS_PENDIENTES', 'Elección de planta pendiente', $1, '{}'::jsonb
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
      [mensaje]
    )
  } catch (e) { log('[plantas/job] aviso no enviado:', e.message) }
}
