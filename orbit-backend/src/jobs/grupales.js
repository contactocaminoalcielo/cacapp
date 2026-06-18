// Job diario de Reportes Grupales: "pensamiento automatizado".
// 1) Sincroniza reportes de cada lote COMPLETADO (crea/actualiza ítems, valida).
// 2) Marca VENCIDO lo que pasó el 3er día hábil sin enviarse.
// 3) Motor de alertas con dedupe + auto-resolución (mismo patrón que Tenjo).
// El humano solo revisa y confirma; aquí no se envía nada.
import { pool, log } from '../db.js'
import { cargarConfigGrupales } from '../reglas-grupales.js'
import { construirReporteDeLote } from '../grupales.js'

const MOD = 'REPORTES_GRUPALES'

export async function jobReportesGrupales() {
  const client = await pool.connect()
  try {
    const config = await cargarConfigGrupales(client)
    const aviso  = parseInt(config.dias_aviso_previo) || 1

    // ── 0. Auto-armar lote ABIERTO con las mascotas que vencen hoy ──
    const auto = await autoArmarLotes(client, config)

    // ── 1. Sincronizar reportes de lotes COMPLETADOS ──
    const { rows: lotes } = await client.query(
      `SELECT * FROM public.lotes_grupales WHERE estado = 'COMPLETADO'`
    )
    let sincronizados = 0
    for (const lote of lotes) {
      await client.query('BEGIN')
      try {
        await construirReporteDeLote(client, lote, { config })
        await client.query('COMMIT')
        sincronizados++
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        log('[grupales/sync] ERROR lote', lote.numero_lote, e.message)
      }
    }

    // ── 2. Marcar VENCIDO lo no enviado pasado su 3er día hábil ──
    const { rows: vencRows } = await client.query(
      `UPDATE public.reportes_grupales_items
       SET estado = 'VENCIDO'
       WHERE estado IN ('PENDIENTE','VALIDADO')
         AND fecha_vencimiento IS NOT NULL
         AND fecha_vencimiento < CURRENT_DATE
       RETURNING id`
    )

    // ── 3. Motor de alertas ──
    const { rows: umbral } = await client.query(
      `SELECT public.fn_sumar_dias_habiles(CURRENT_DATE, $1::int) AS hasta`, [aviso]
    )
    const fechaAviso = umbral[0]?.hasta

    const { rows: items } = await client.query(
      `SELECT i.id, i.servicio_id, i.estado, i.mascota_nombre, i.datos_completos,
              i.motivo_exclusion, i.fecha_vencimiento,
              r.id AS reporte_id, r.tipo_proceso, r.estado AS reporte_estado, r.lote_id AS lote_grupal_id,
              l.numero_lote
       FROM public.reportes_grupales_items i
       JOIN public.reportes_grupales r ON r.id = i.reporte_id
       JOIN public.lotes_grupales l    ON l.id = r.lote_id
       WHERE i.estado <> 'EXCLUIDO'`
    )

    const deseadas = []
    const push = (a) => deseadas.push(a)

    for (const it of items) {
      const meta = { mascota: it.mascota_nombre, numero_lote: it.numero_lote,
                     reporte_id: it.reporte_id, lote_grupal_id: it.lote_grupal_id }
      const tipoLabel = it.tipo_proceso === 'COMPOSTAJE_GRUPAL' ? 'Eco-grupal' : 'Cremación grupal'

      // Individual incluido por error / lote incorrecto
      if (it.motivo_exclusion) {
        push({ servicio_id: it.servicio_id, tipo_alerta: 'INDIVIDUAL_EN_GRUPAL', prioridad: 'ALTA',
          mensaje: `${it.mascota_nombre} no corresponde al reporte ${tipoLabel} (${it.numero_lote}): ${it.motivo_exclusion}`,
          accion_recomendada: 'Sacar del lote o corregir el plan', meta,
          clave: `GRUPAL:INDIVIDUAL_EN_GRUPAL:${it.id}` })
        continue
      }

      // Datos incompletos
      if (!it.datos_completos && ['PENDIENTE','VALIDADO','VENCIDO'].includes(it.estado)) {
        push({ servicio_id: it.servicio_id, tipo_alerta: 'DATOS_INCOMPLETOS', prioridad: 'ALTA',
          mensaje: `${it.mascota_nombre} (${it.numero_lote}) tiene datos obligatorios incompletos — no se puede enviar`,
          accion_recomendada: 'Completar mascota, propietario, teléfono y plan', meta,
          clave: `GRUPAL:DATOS_INCOMPLETOS:${it.id}` })
      }

      // Error de envío
      if (it.estado === 'ERROR') {
        push({ servicio_id: it.servicio_id, tipo_alerta: 'ERROR_ENVIO', prioridad: 'ALTA',
          mensaje: `Falló el envío del reporte de ${it.mascota_nombre} (${it.numero_lote})`,
          accion_recomendada: 'Revisar el teléfono/canal y reintentar', meta,
          clave: `GRUPAL:ERROR_ENVIO:${it.id}` })
      }

      // Vencido
      if (it.estado === 'VENCIDO') {
        push({ servicio_id: it.servicio_id, tipo_alerta: 'VENCIDO', prioridad: 'CRITICA',
          mensaje: `Reporte ${tipoLabel} de ${it.mascota_nombre} VENCIDO (pasó el 3er día hábil sin enviarse)`,
          accion_recomendada: 'Enviar de inmediato y registrar la causa del retraso', meta,
          clave: `GRUPAL:VENCIDO:${it.id}` })
      }
      // Próximo a vencer
      else if (['PENDIENTE','VALIDADO'].includes(it.estado) && it.fecha_vencimiento && fechaAviso
               && it.fecha_vencimiento <= fechaAviso) {
        push({ servicio_id: it.servicio_id, tipo_alerta: 'PROXIMO_VENCER', prioridad: 'MEDIA',
          mensaje: `Reporte ${tipoLabel} de ${it.mascota_nombre} está por cumplir el 3er día hábil (vence ${it.fecha_vencimiento})`,
          accion_recomendada: 'Generar y enviar antes del vencimiento', meta,
          clave: `GRUPAL:PROXIMO_VENCER:${it.id}` })
      }
      // Pendiente general (por tipo) cuando aún no está enviado
      else if (['PENDIENTE','VALIDADO'].includes(it.estado)) {
        const tipoAlerta = it.tipo_proceso === 'COMPOSTAJE_GRUPAL' ? 'PENDIENTE_ECO' : 'PENDIENTE_CREMACION'
        push({ servicio_id: it.servicio_id, tipo_alerta: tipoAlerta, prioridad: 'INFO',
          mensaje: `${it.mascota_nombre} pendiente de reporte ${tipoLabel} (${it.numero_lote})`,
          accion_recomendada: 'Revisar y enviar en Certificados', meta,
          clave: `GRUPAL:${tipoAlerta}:${it.id}` })
      }
    }

    // Insertar con dedupe
    let creadas = 0
    for (const a of deseadas) {
      const r = await client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (clave_dedupe)
           WHERE estado IN ('ABIERTA','EN_GESTION') AND clave_dedupe IS NOT NULL
           DO NOTHING`,
        [a.servicio_id, MOD, a.tipo_alerta, a.prioridad, a.mensaje, a.accion_recomendada,
         a.clave, JSON.stringify(a.meta)]
      )
      creadas += r.rowCount
    }

    // Auto-resolver las que ya no aplican
    const vigentes = deseadas.map(a => a.clave)
    const { rowCount: resueltas } = await client.query(
      `UPDATE public.alertas_operativas
       SET estado = 'RESUELTA', fecha_resolucion = now()
       WHERE modulo_origen = $1
         AND estado IN ('ABIERTA','EN_GESTION')
         AND clave_dedupe IS NOT NULL
         AND NOT (clave_dedupe = ANY($2::text[]))`,
      [MOD, vigentes]
    )

    const resultado = { sincronizados, vencidos: vencRows.length, alertas_vigentes: deseadas.length, creadas, auto_resueltas: resueltas, auto_armados: auto.armados }
    log('[grupales]', JSON.stringify(resultado))
    return resultado
  } finally {
    client.release()
  }
}

/**
 * Auto-armar lote ABIERTO con las mascotas grupales que vencen hoy (cron diario).
 * Agrupa por tipo en el lote ABIERTO existente (o crea uno). El humano luego lo
 * completa y envía. No marca completado ni envía nada.
 */
async function autoArmarLotes(client, config) {
  const habilitado = config.auto_armar_lotes === true || config.auto_armar_lotes === 'true'
  if (!habilitado) return { armados: 0, lotes: [] }
  const sla     = parseInt(config.sla_dias_habiles) || 3
  const ventana = parseInt(config.auto_armar_dias_antes) || 0

  const tipos = ['CREMACION_GRUPAL', 'COMPOSTAJE_GRUPAL']
  let armados = 0
  const lotes = []

  for (const tipo of tipos) {
    // Mascotas grupales sin lote cuyo vencimiento cae HOY (o dentro de la ventana).
    // No barre el backlog vencido (eso se maneja manual en Control).
    const { rows: urgentes } = await client.query(
      `SELECT s.id
       FROM public.servicios s
       JOIN public.planes p ON p.id = s.plan_id
       WHERE p.tipo_proceso = $1
         AND s.lote_id IS NULL
         AND s.estado IN ('INGRESADO','EN_RECOGIDA','EN_CUARTO_FRIO')
         AND public.fn_sumar_dias_habiles(s.fecha_ingreso, $2::int)
             BETWEEN CURRENT_DATE AND (CURRENT_DATE + $3::int)
       ORDER BY s.fecha_ingreso ASC`,
      [tipo, sla, ventana]
    )
    if (!urgentes.length) continue

    await client.query('BEGIN')
    try {
      // Lote ABIERTO existente del tipo, o crear uno nuevo
      const { rows: abiertos } = await client.query(
        `SELECT id, numero_lote FROM public.lotes_grupales
         WHERE tipo_proceso = $1 AND estado = 'ABIERTO'
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [tipo]
      )
      let lote = abiertos[0]
      let creado = false
      if (!lote) {
        await client.query(`LOCK TABLE public.lotes_grupales IN SHARE ROW EXCLUSIVE MODE`)
        const { rows: cnt } = await client.query(
          `SELECT COUNT(*)::int AS total FROM public.lotes_grupales
           WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())`
        )
        const numero = `L-${new Date().getFullYear()}-${String((cnt[0]?.total || 0) + 1).padStart(3, '0')}`
        const { rows: nuevo } = await client.query(
          `INSERT INTO public.lotes_grupales
             (numero_lote, tipo_proceso, fecha_proceso, estado, cantidad_mascotas, entidad_externa)
           VALUES ($1, $2, CURRENT_DATE, 'ABIERTO', 0, 'Entidad certificada Bogotá')
           RETURNING id, numero_lote`,
          [numero, tipo]
        )
        lote = nuevo[0]; creado = true
      }

      const ids = urgentes.map(u => u.id)
      const { rowCount } = await client.query(
        `UPDATE public.servicios SET lote_id = $1 WHERE id = ANY($2::uuid[]) AND lote_id IS NULL`,
        [lote.id, ids]
      )
      const { rows: tot } = await client.query(
        `SELECT COUNT(*)::int AS t FROM public.servicios WHERE lote_id = $1`, [lote.id]
      )
      await client.query(
        `UPDATE public.lotes_grupales SET cantidad_mascotas = $2 WHERE id = $1`, [lote.id, tot[0]?.t || 0]
      )
      await client.query('COMMIT')
      armados += rowCount
      lotes.push({ numero_lote: lote.numero_lote, tipo, agregados: rowCount, creado })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      log('[grupales/auto-armar] ERROR', tipo, e.message)
    }
  }

  // Avisar a coordinadores (best-effort; no crítico)
  if (armados > 0) {
    try {
      await client.query(
        `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
         SELECT p.id, 'GRUPAL_AUTO_LOTE', 'Lote grupal armado automáticamente', $1, $2::jsonb
         FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
         WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
        [`Se agruparon ${armados} mascota(s) que vencen hoy en lote(s) abierto(s). Revísalos, complétalos y envía.`,
         JSON.stringify({ lotes })]
      )
    } catch (e) { log('[grupales/auto-armar] aviso no enviado:', e.message) }
  }

  log('[grupales/auto-armar]', JSON.stringify({ armados, lotes }))
  return { armados, lotes }
}
