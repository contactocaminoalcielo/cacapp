// Job diario: prepara los CONTACTOS que requieren solicitar imágenes.
// NO envía nada — solo deja solicitudes en POR_VALIDAR para que una persona
// valide y autorice el envío en la bandeja (SeguimientoImagenes).
//
// Regla de selección (David 2026-06-19), base = servicios.fecha_ingreso:
//   - Tomado el día anterior (o antes, si recuperar_vencidos: no se pierde nada).
//   - estado en estados_elegibles (EN_CUARTO_FRIO) y no cancelado.
//   - cliente con WhatsApp válido.
//   - no ha recibido imágenes (fecha_imagenes_recibidas IS NULL).
//   - no tiene ya una solicitud no-cancelada (anti-duplicado).
//   - tiene ≥1 recordatorio activo que requiere imagen.
//   - Planes ANGEL/DESAMPARADO excluidos, salvo que tengan un ADICIONAL que
//     requiera imagen → entra como solo_adicional.
//   - Planes "sin recordatorios" que igual entran (David 2026-07-15):
//       · planes_foto_cofre (EXCLUSIVO_*_SIN_REC): se adjunta el recordatorio
//         "Foto para el cofre" y entra a pedir esa foto.
//       · planes_solo_entrega (COMPETS_SIN_REC): entra solo a pedir datos de
//         entrega (el portal muestra 0 fotos + formulario de entrega).
import { pool, log } from '../db.js'
import { cargarConfigImagenes, construirEnlace } from '../reglas-imagenes.js'

const REQ_IMG_SR = `
  SELECT 1 FROM public.servicio_recordatorios sr
  JOIN public.recordatorios r ON r.id = sr.recordatorio_id
  WHERE sr.servicio_id = s.id
    AND COALESCE(sr.origen,'') <> 'REMOVIDO' AND sr.estado <> 'NA'
    AND r.requiere_imagen = true
    AND COALESCE(r.solo_nombre, false) = false
    AND COALESCE(r.max_fotos, 0) > 0`

export async function jobContactosImagenes() {
  const client = await pool.connect()
  try {
    const config    = await cargarConfigImagenes(client)
    const elegibles = Array.isArray(config.estados_elegibles) ? config.estados_elegibles : ['EN_CUARTO_FRIO']
    const excluidos = Array.isArray(config.planes_excluidos) ? config.planes_excluidos : ['ANGEL', 'DESAMPARADO']
    const recuperar = config.recuperar_vencidos === true || config.recuperar_vencidos === 'true'
    const linea     = config.linea_default || '+573159891247'
    // Planes SIN_REC que igual entran al primer contacto (David 2026-07-15).
    const planesCofre       = Array.isArray(config.planes_foto_cofre) ? config.planes_foto_cofre : []
    const planesSoloEntrega = Array.isArray(config.planes_solo_entrega) ? config.planes_solo_entrega : []
    // Id del recordatorio "Foto para el cofre" (migración 052). Si no existe todavía,
    // los planes de cofre no se pueden atender: se reporta y se omiten (no se rompe).
    const { rows: cofreRows } = await client.query(
      `SELECT id FROM public.recordatorios WHERE nombre = $1 LIMIT 1`,
      [config.recordatorio_cofre || 'Foto para el cofre']
    )
    const cofreRecId = cofreRows[0]?.id || null

    // "Día anterior": fecha_ingreso < hoy. Con recuperar_vencidos también las más viejas
    // (si no, solo exactamente ayer).
    const filtroFecha = recuperar
      ? `s.fecha_ingreso < CURRENT_DATE`
      : `s.fecha_ingreso = CURRENT_DATE - 1`

    const { rows: candidatos } = await client.query(
      `SELECT s.id AS servicio_id, s.codigo_fotos,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              c.whatsapp,
              p.codigo AS plan_codigo,
              (p.codigo = ANY($2::text[]))                       AS plan_excluido,
              EXISTS (${REQ_IMG_SR})                              AS req_img_any,
              EXISTS (${REQ_IMG_SR} AND sr.origen = 'ADICIONAL')  AS req_img_adicional
       FROM public.servicios s
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p    ON p.id = s.plan_id
       WHERE s.estado = ANY($1::text[])
         AND s.fecha_imagenes_recibidas IS NULL
         AND ${filtroFecha}
         AND c.whatsapp IS NOT NULL
         AND length(regexp_replace(c.whatsapp, '\\D', '', 'g')) >= 10
         AND NOT EXISTS (
           SELECT 1 FROM public.solicitudes_imagenes si
           WHERE si.servicio_id = s.id AND si.estado <> 'CANCELADO')
       ORDER BY s.fecha_ingreso ASC`,
      [elegibles, excluidos]
    )

    let creados = 0
    for (const c of candidatos) {
      const esCofre       = planesCofre.includes(c.plan_codigo)
      const esSoloEntrega = planesSoloEntrega.includes(c.plan_codigo)
      // ¿Califica y cómo entra?
      //  · plan_excluido (ANGEL/DESAMPARADO): solo por ADICIONAL con imagen.
      //  · req_img_any: ruta normal (≥1 recordatorio con foto).
      //  · esCofre (EXCLUSIVO_*_SIN_REC): se adjunta "Foto para el cofre".
      //  · esSoloEntrega (COMPETS_SIN_REC): entra solo por datos de entrega.
      let soloAdicional = false
      if (c.plan_excluido) {
        if (!c.req_img_adicional) continue
        soloAdicional = true
      } else if (c.req_img_any) {
        // ruta normal
      } else if (esCofre) {
        if (!cofreRecId) { log('[imagenes/job] plan de cofre sin recordatorio (migración 052 pendiente):', c.servicio_id); continue }
      } else if (esSoloEntrega) {
        // entra sin fotos: el portal pedirá solo los datos de entrega
      } else {
        continue   // sin recordatorios y no es un plan especial → nada que pedir
      }

      try {
        await client.query('BEGIN')
        // Cofre: adjuntar "Foto para el cofre" (idempotente) para que fluya por el
        // pipeline normal (portal → Producción → entrega). precio 0: ya va en el plan.
        if (esCofre && cofreRecId) {
          await client.query(
            `INSERT INTO public.servicio_recordatorios
               (servicio_id, recordatorio_id, cantidad, origen, estado, precio_cobrado)
             SELECT $1, $2, 1, 'PLAN', 'PENDIENTE', 0
             WHERE NOT EXISTS (
               SELECT 1 FROM public.servicio_recordatorios
               WHERE servicio_id = $1 AND recordatorio_id = $2 AND COALESCE(origen,'') <> 'REMOVIDO')`,
            [c.servicio_id, cofreRecId]
          )
        }
        // Asegurar código seguro/único y persistirlo en el servicio.
        const { rows: cod } = await client.query(
          `UPDATE public.servicios
           SET codigo_fotos = COALESCE(codigo_fotos, public.fn_gen_codigo_fotos())
           WHERE id = $1 RETURNING codigo_fotos`,
          [c.servicio_id]
        )
        const codigo = cod[0].codigo_fotos
        const enlace = construirEnlace(codigo)
        await client.query(
          `INSERT INTO public.solicitudes_imagenes
             (servicio_id, estado, fecha_solicitud, fecha_programada, codigo, enlace,
              whatsapp_destino, linea_wa, solo_adicional)
           VALUES ($1, 'POR_VALIDAR', CURRENT_DATE, CURRENT_DATE, $2, $3, $4, $5, $6)`,
          [c.servicio_id, codigo, enlace, c.whatsapp, linea, soloAdicional]
        )
        await client.query('COMMIT')
        creados++
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        // Violación del índice único parcial (carrera/doble ejecución) → ignorar
        if (e.code !== '23505') log('[imagenes/job] ERROR', c.servicio_id, e.message)
      }
    }

    // Avisar a coordinadores (best-effort) si hay contactos nuevos por validar.
    if (creados > 0) {
      try {
        await client.query(
          `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
           SELECT p.id, 'IMAGENES_POR_VALIDAR', 'Solicitudes de imágenes por validar', $1, '{}'::jsonb
           FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
           WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
          [`${creados} contacto(s) listos en Seguimiento de imágenes → revísalos y autoriza el envío.`]
        )
      } catch (e) { log('[imagenes/job] aviso no enviado:', e.message) }
    }

    const resultado = { candidatos: candidatos.length, creados }
    log('[imagenes/job]', JSON.stringify(resultado))
    return resultado
  } finally {
    client.release()
  }
}
