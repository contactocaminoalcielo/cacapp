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
      // ¿Califica? Planes excluidos solo entran por adicional con imagen.
      let soloAdicional = false
      if (c.plan_excluido) {
        if (!c.req_img_adicional) continue
        soloAdicional = true
      } else {
        if (!c.req_img_any) continue
      }

      try {
        await client.query('BEGIN')
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
