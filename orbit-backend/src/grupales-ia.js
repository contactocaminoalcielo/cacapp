// Asistente IA de Reportes Grupales: resume pendientes, prioriza, detecta
// inconsistencias y redacta mensajes. Solo lectura + texto sugerido; el humano
// revisa y confirma. No escribe estado ni envía.
import { pool } from './db.js'
import { llamarClaude } from './ia.js'
import { cargarConfigGrupales } from './reglas-grupales.js'

const SYSTEM = `Eres ORBIT, el asistente operativo de Camino al Cielo (funeraria de mascotas, Bogotá).
Eres claro, breve y cálido. Trabajas para el coordinador: lo ayudas a no incumplir el envío de
reportes grupales (cremación grupal y eco-grupal) dentro del 3er día hábil. Nunca inventas datos.
Nunca afirmas haber enviado nada: solo sugieres. Respondes en español de Colombia.`

// ─── Contexto operativo actual (compacto) ────────────────────────────────────
async function snapshot(client) {
  const { rows: reportes } = await client.query(
    `SELECT r.tipo_proceso, r.estado, l.numero_lote,
            count(*) FILTER (WHERE i.estado <> 'EXCLUIDO')                              AS items,
            count(*) FILTER (WHERE i.estado IN ('ENVIADO','REENVIADO'))                 AS enviados,
            count(*) FILTER (WHERE i.estado = 'VENCIDO')                                AS vencidos,
            count(*) FILTER (WHERE NOT i.datos_completos AND i.estado <> 'EXCLUIDO')    AS incompletos,
            count(*) FILTER (WHERE i.estado = 'ERROR')                                  AS con_error,
            min(i.fecha_vencimiento) FILTER (WHERE i.estado IN ('PENDIENTE','VALIDADO')) AS prox_venc
     FROM public.reportes_grupales r
     JOIN public.lotes_grupales l ON l.id = r.lote_id
     LEFT JOIN public.reportes_grupales_items i ON i.reporte_id = r.id
     WHERE r.estado <> 'ENVIADO'
     GROUP BY r.id, r.tipo_proceso, r.estado, l.numero_lote
     ORDER BY min(i.fecha_vencimiento) NULLS LAST`
  )
  const { rows: alertas } = await client.query(
    `SELECT tipo_alerta, prioridad, count(*)::int AS n
     FROM public.alertas_operativas
     WHERE modulo_origen = 'REPORTES_GRUPALES' AND estado IN ('ABIERTA','EN_GESTION')
     GROUP BY tipo_alerta, prioridad ORDER BY n DESC`
  )
  return { reportes, alertas, hoy: new Date().toISOString().slice(0, 10) }
}

/** Resumen + priorización + inconsistencias (texto para el panel del coordinador). */
export async function resumenPendientes() {
  const client = await pool.connect()
  try {
    const ctx = await snapshot(client)
    if (!ctx.reportes.length) return { resumen: 'No hay reportes grupales pendientes. Todo al día. ✅', datos: ctx }

    const prompt =
`Hoy es ${ctx.hoy}. Estado actual de reportes grupales (JSON):
${JSON.stringify(ctx.reportes)}

Alertas abiertas (JSON):
${JSON.stringify(ctx.alertas)}

Tarea:
1. Resume en 2-3 frases qué hay pendiente y qué es urgente (vencidos y próximos a vencer primero).
2. Da una lista priorizada de acciones concretas (máx 5), cada una empezando por el número de lote.
3. Señala inconsistencias si las ves (datos incompletos, errores de envío, posibles cambios de plan).
No incluyas nada que no esté en los datos. Sé breve.`

    const resumen = await llamarClaude({ system: SYSTEM, prompt, maxTokens: 700 })
    return { resumen, datos: ctx }
  } finally {
    client.release()
  }
}

/** Redacta el mensaje de WhatsApp para un destinatario (el humano lo edita/confirma). */
export async function redactarMensaje({ itemId }) {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT i.mascota_nombre, i.propietario_nombre, r.tipo_proceso, l.numero_lote
       FROM public.reportes_grupales_items i
       JOIN public.reportes_grupales r ON r.id = i.reporte_id
       JOIN public.lotes_grupales l    ON l.id = r.lote_id
       WHERE i.id = $1`, [itemId]
    )
    const it = rows[0]
    if (!it) return { mensaje: '' }
    const tipo = it.tipo_proceso === 'COMPOSTAJE_GRUPAL' ? 'compostaje grupal (eco)' : 'cremación grupal'

    const prompt =
`Redacta un mensaje de WhatsApp breve (máx 3 frases), cálido y respetuoso, para enviar a
${it.propietario_nombre} el reporte de ${tipo} de su mascota ${it.mascota_nombre}.
Es un momento sensible (la mascota falleció). No prometas devolución de cenizas/material.
Cierra con "— Camino al Cielo 🕊️". Devuelve SOLO el texto del mensaje.`

    const mensaje = await llamarClaude({ system: SYSTEM, prompt, maxTokens: 300 })
    return { mensaje: mensaje.trim() }
  } finally {
    client.release()
  }
}

/**
 * Alerta de vencimientos para la tabla de Control: clasifica los servicios grupales
 * NO enviados por días hábiles restantes (con festivos) y redacta una alerta.
 * Devuelve { alerta, buckets } — buckets también sirve para el semáforo del front.
 */
export async function alertaVencimientos() {
  const client = await pool.connect()
  try {
    const cfg = await cargarConfigGrupales(client)
    const sla = parseInt(cfg.sla_dias_habiles) || 3

    const { rows } = await client.query(
      `SELECT m.nombre AS mascota, p.tipo_proceso,
              public.fn_sumar_dias_habiles(s.fecha_ingreso, $1::int)               AS vence,
              (public.fn_sumar_dias_habiles(s.fecha_ingreso, $1::int) - CURRENT_DATE)::int AS dias
       FROM public.servicios s
       JOIN public.planes p   ON p.id = s.plan_id
       JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       WHERE p.tipo_proceso IN ('CREMACION_GRUPAL','COMPOSTAJE_GRUPAL')
         AND s.estado NOT IN ('CANCELADO','ENTREGADO')
         AND NOT EXISTS (
           SELECT 1 FROM public.reportes_grupales_items i
           WHERE i.servicio_id = s.id AND i.estado IN ('ENVIADO','REENVIADO'))
       ORDER BY dias ASC`,
      [sla]
    )

    const b = { vencidos: [], hoy: [], manana: [], pronto: [] }
    for (const r of rows) {
      const d = Number(r.dias)
      const it = { mascota: r.mascota, tipo: r.tipo_proceso, vence: r.vence, dias: d }
      if (d < 0)        b.vencidos.push(it)
      else if (d === 0) b.hoy.push(it)
      else if (d === 1) b.manana.push(it)
      else if (d <= sla + 2) b.pronto.push(it)
    }
    const total = b.vencidos.length + b.hoy.length + b.manana.length + b.pronto.length
    if (!total) return { alerta: 'No hay reportes próximos a vencer ni vencidos. ✅', buckets: b }

    const hoy = new Date().toISOString().slice(0, 10)
    const prompt =
`Hoy es ${hoy}. Reportes grupales NO enviados, por urgencia (JSON):
VENCIDOS (${b.vencidos.length}): ${JSON.stringify(b.vencidos.slice(0, 15))}
VENCEN HOY (${b.hoy.length}): ${JSON.stringify(b.hoy)}
VENCEN MAÑANA (${b.manana.length}): ${JSON.stringify(b.manana)}
PRÓXIMOS (${b.pronto.length}): ${JSON.stringify(b.pronto.slice(0, 15))}

Redacta una alerta breve y clara (2-4 frases) para el coordinador. Prioriza vencidos y los
que vencen hoy/mañana, menciona los nombres de las mascotas. No inventes datos.`

    const alerta = await llamarClaude({ system: SYSTEM, prompt, maxTokens: 500 })
    return { alerta, buckets: b }
  } finally {
    client.release()
  }
}
