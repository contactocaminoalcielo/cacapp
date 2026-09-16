// Job diario: aviso de MITAD de compostaje (migración 159).
//
// Regla de selección (David 2026-09-16):
//   base = `lotes_tenjo_items.fecha_compostaje_inicio` + `meses_compostaje/2`.
//   La mitad de CADA mascota, no "un mes": meses_compostaje vale 2, 2.5 ó 3.
//
// Dos fases separadas, igual que el job de elección de planta:
//   1. PREPARAR — crea la fila en PENDIENTE. Idempotente por UNIQUE(servicio_id),
//      no le escribe a nadie.
//   2. ENVIAR   — manda la plantilla a los PENDIENTE/ERROR. Sin plantilla
//      aprobada NO envía: los deja PENDIENTE y avisa a coordinación.
//
// 🪤 `arranque_desde` NO es decoración. Al crear esto había 37 mascotas que ya
// habían pasado la mitad (6 con el compostaje entero cumplido). Sin esa fecha,
// la primera corrida les escribe a las 37 de golpe — y a 6 de ellas les llega
// un "va con normalidad" cuando ya les toca elegir la planta.
import { pool, log } from '../db.js'
import { cargarConfigMitad, plantillaMitad, enviarAvisoMitad } from '../mitad-compostaje.js'
import { construirEnlaceVisita } from '../visitas.js'

export async function jobMitadCompostaje({ dryRun = false } = {}) {
  const client = await pool.connect()
  let config
  try {
    config = await cargarConfigMitad(client)
  } finally {
    client.release()
  }

  const activo = config.activo === true || config.activo === 'true'
  if (!activo) {
    log('[mitad/job] apagado (activo=false)')
    return { activo: false }
  }

  const tope      = parseInt(config.max_envios_por_corrida) || 20
  const arranque  = normalizarFecha(config.arranque_desde)
  const plantilla = plantillaMitad(config)

  // ── 1. Preparar: mitades cumplidas que todavía no tienen aviso ─────────────
  const { rows: candidatos } = await pool.query(
    `SELECT i.id            AS lote_item_id,
            i.servicio_id,
            (i.fecha_compostaje_inicio + (i.meses_compostaje / 2 * INTERVAL '1 month'))::date::text AS fecha_mitad,
            c.whatsapp
       FROM public.lotes_tenjo_items i
       JOIN public.servicios s      ON s.id = i.servicio_id
       JOIN public.planes p         ON p.id = s.plan_id
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
      WHERE i.fecha_compostaje_inicio IS NOT NULL
        AND p.tipo_proceso = 'COMPOSTAJE_INDIVIDUAL'
        AND s.estado NOT IN ('CANCELADO', 'ENTREGADO')
        AND i.estado NOT IN ('RETIRADO_DEL_LOTE', 'NO_EJECUTADO')
        -- Sigue en el cubículo: si ya salió, no hay nada que visitar y el
        -- proceso dejó de "ir con normalidad" — ya terminó.
        AND i.cubiculo_liberado_en IS NULL
        AND (i.fecha_compostaje_inicio + (i.meses_compostaje / 2 * INTERVAL '1 month'))::date
            <= public.fn_hoy_bogota()
        -- Y no se ha cumplido el compostaje entero: pasada esa fecha manda el
        -- aviso de elección de planta, y decirle antes "va con normalidad"
        -- sería llegar tarde a hablar del proceso.
        AND (i.fecha_compostaje_inicio + (i.meses_compostaje * INTERVAL '1 month'))::date
            > public.fn_hoy_bogota()
        AND ($1::date IS NULL
             OR (i.fecha_compostaje_inicio + (i.meses_compostaje / 2 * INTERVAL '1 month'))::date >= $1::date)
        AND NOT EXISTS (SELECT 1 FROM public.avisos_mitad_compostaje a
                         WHERE a.servicio_id = i.servicio_id)
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
        // Reusa el secreto del portal de fotos; si el servicio nunca pasó por
        // allí, se genera aquí con la misma función.
        const { rows: cod } = await client2.query(
          `UPDATE public.servicios
              SET codigo_fotos = COALESCE(codigo_fotos, public.fn_gen_codigo_fotos())
            WHERE id = $1 RETURNING codigo_fotos`,
          [c.servicio_id]
        )
        const codigo = cod[0]?.codigo_fotos
        if (!codigo) throw new Error('sin código de portal')
        await client2.query(
          `INSERT INTO public.avisos_mitad_compostaje
             (servicio_id, lote_item_id, estado, codigo, enlace, whatsapp_destino, fecha_mitad)
           VALUES ($1, $2, 'PENDIENTE', $3, $4, $5, $6)
           ON CONFLICT (servicio_id) DO NOTHING`,
          [c.servicio_id, c.lote_item_id, codigo, construirEnlaceVisita(codigo),
           c.whatsapp || null, c.fecha_mitad]
        )
        await client2.query('COMMIT')
        r.creados++
      } catch (e) {
        await client2.query('ROLLBACK').catch(() => {})
        if (e.code !== '23505') { r.errores++; log('[mitad/job] ERROR creando', c.servicio_id, e.message) }
      } finally {
        client2.release()
      }
    }
  }

  // ── 2. Enviar (incluye reintentos de ERROR) ────────────────────────────────
  const { rows: porEnviar } = await pool.query(
    `SELECT a.id
       FROM public.avisos_mitad_compostaje a
       JOIN public.servicios s ON s.id = a.servicio_id
      WHERE a.estado IN ('PENDIENTE', 'ERROR')
        AND s.estado <> 'CANCELADO'
        -- Un reintento eterno le pega al mismo número todos los días.
        AND a.intentos < 3
      ORDER BY a.fecha_mitad ASC
      LIMIT $1`,
    [tope]
  )

  if (!plantilla) {
    r.sin_plantilla = porEnviar.length
    if (porEnviar.length) {
      log('[mitad/job] SIN PLANTILLA aprobada —', porEnviar.length,
          'aviso(s) quedan PENDIENTE. Sembrar config_operativa MITAD_COMPOSTAJE/plantilla.')
      // Solo cuando aparecen casos NUEVOS: repetirlo cada día mientras la
      // plantilla no llega convierte la campana en ruido y deja de leerse.
      if (r.creados > 0) {
        await avisarCoordinacion(
          `${porEnviar.length} mascota(s) llegaron a la mitad de su compostaje y esperan el aviso a la familia, ` +
          `pero no hay plantilla de WhatsApp aprobada.`
        )
      }
    }
  } else if (!dryRun) {
    for (const a of porEnviar) {
      const res = await enviarAvisoMitad({ avisoId: a.id, config })
      if (res.enviado) r.enviados++
      else if (res.motivo === 'sin_whatsapp') r.sin_whatsapp++
      else if (res.motivo === 'error_envio') r.errores++
    }
  }

  log('[mitad/job]', JSON.stringify(r))
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
       SELECT p.id, 'MITAD_COMPOSTAJE_PENDIENTE', 'Aviso de mitad de compostaje pendiente', $1, '{}'::jsonb
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
      [mensaje]
    )
  } catch (e) { log('[mitad/job] aviso no enviado:', e.message) }
}
