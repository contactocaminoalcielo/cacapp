// Operaciones críticas del flujo de solicitud de imágenes — transaccionales e
// idempotentes. Toda escritura que afecta estado/evidencia pasa por aquí:
//   - enviarSolicitud / reintentar: el coordinador autoriza (requireAuth en index)
//   - cancelarSolicitud
//   - recibirImagenesPortal: el cliente (anónimo) entrega imágenes/textos; el
//     código de acceso es el secreto, validado server-side, y limita los cambios
//     a SU servicio (no se aumentan permisos anónimos globales).
//
// Frase rectora: "ORBIT prepara los contactos; una persona valida y autoriza el
// envío. El cliente solo aporta información e imágenes. Ningún contacto debe
// duplicarse, ninguna carga incompleta debe pasar a Producción y ninguna
// solicitud de adicional debe convertirse en compra sin validación humana."
import { pool, log } from './db.js'
import {
  cargarConfigImagenes, construirEnlace, mensajeSolicitud, requiereImagen, itemsPortal,
} from './reglas-imagenes.js'
import { enviarPlantillaGenerica } from './whatsapp.js'

const MOD = 'SOLICITUDES_IMAGENES'

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

// Serializa operaciones por solicitud/servicio dentro de la transacción (anti doble-clic / carrera del cron)
async function lockClave(client, clave) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [clave])
}

// ─── Enviar (o reintentar) la solicitud por WhatsApp Zolutium ───────────────
// Idempotente: si ya está ENVIADO no reenvía; si está RECIBIDO/CANCELADO rechaza.
// El envío real solo ocurre con plantilla aprobada (config usar_plantilla=true);
// mientras no exista, deja la solicitud intacta en POR_VALIDAR — NO simula éxito.
export async function enviarSolicitud({ solicitudId, personalId, body = {} }) {
  if (!uuidOrNull(solicitudId)) return { status: 422, body: { ok: false, error: 'solicitud inválida' } }
  const actorId = uuidOrNull(personalId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockClave(client, `solimg:${solicitudId}`)

    const { rows } = await client.query(
      `SELECT sol.*, s.codigo_fotos, s.estado AS servicio_estado,
              m.nombre AS mascota,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              c.nombre AS cliente_nombre, c.whatsapp
       FROM public.solicitudes_imagenes sol
       JOIN public.servicios s     ON s.id = sol.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       WHERE sol.id = $1
       FOR UPDATE OF sol`,
      [solicitudId]
    )
    const sol = rows[0]
    if (!sol) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Solicitud no encontrada' } } }

    if (sol.estado === 'RECIBIDO')  { await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'La solicitud ya fue recibida' } } }
    if (sol.estado === 'CANCELADO') { await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'La solicitud está cancelada' } } }
    if (sol.estado === 'ENVIADO' && !body.reintentar) {
      await client.query('ROLLBACK')
      return { status: 200, body: { ok: true, ya_enviado: true } }
    }

    if (!sol.whatsapp) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'El cliente no tiene WhatsApp registrado' } }
    }

    const config = await cargarConfigImagenes(client)
    const usarPlantilla = config.usar_plantilla === true || config.usar_plantilla === 'true'

    // Asegurar código de acceso (seguro/único) y registrar fecha de envío del código
    const { rows: cod } = await client.query(
      `UPDATE public.servicios
       SET codigo_fotos = COALESCE(codigo_fotos, public.fn_gen_codigo_fotos()),
           fecha_codigo_enviado = COALESCE(fecha_codigo_enviado, CURRENT_DATE)
       WHERE id = $1
       RETURNING codigo_fotos`,
      [sol.servicio_id]
    )
    const codigo = cod[0].codigo_fotos
    const enlace = construirEnlace(codigo)
    const linea  = body.fromNumber || config.linea_default

    // Sin plantilla aprobada → NO se envía. Se deja en POR_VALIDAR sin tocar estado.
    if (!usarPlantilla || !config.plantilla_nombre) {
      await client.query(
        `UPDATE public.solicitudes_imagenes
         SET codigo = $2, enlace = $3, whatsapp_destino = $4, linea_wa = $5
         WHERE id = $1`,
        [solicitudId, codigo, enlace, sol.whatsapp, linea]
      )
      await client.query('COMMIT')
      return { status: 409, body: { ok: false, sin_plantilla: true, codigo, enlace,
        error: 'La plantilla de WhatsApp aún no está aprobada en Meta/Zolutium. Cuando lo esté, activa config_operativa SOLICITUDES_IMAGENES.usar_plantilla=true. La solicitud queda lista para validar; aún no se envió.' } }
    }

    const mensaje = mensajeSolicitud({ nombre: sol.cliente_nombre || sol.propietario, mascota: sol.mascota, enlace, codigo })

    // Envío (red, dentro del advisory lock para serializar; volumen bajo y manual)
    let envioOk = null, envioErr = null
    try {
      envioOk = await enviarPlantillaGenerica({
        telefono: sol.whatsapp,
        nombre:   sol.propietario || sol.cliente_nombre || '',
        plantillaNombre: config.plantilla_nombre,
        idioma:   config.plantilla_idioma || 'es_MX',
        category: 'UTILITY',
        mensaje,
        bodyParams: [sol.cliente_nombre || sol.propietario || '', sol.mascota || '', enlace, codigo],
        fromNumber: linea,
      })
    } catch (e) { envioErr = e.message }

    if (envioOk) {
      await client.query(
        `UPDATE public.solicitudes_imagenes
         SET estado = 'ENVIADO', codigo = $2, enlace = $3, whatsapp_destino = $4, linea_wa = $5,
             message_id = $6, contact_id = $7, fecha_envio = now(),
             intentos = intentos + 1, ultimo_error = NULL, autorizado_por = COALESCE($8, autorizado_por)
         WHERE id = $1`,
        [solicitudId, codigo, enlace, sol.whatsapp, linea, envioOk.messageId, envioOk.contactId, actorId]
      )
      await client.query('COMMIT')
      log('[imagenes/enviar]', solicitudId, 'ENVIADO', envioOk.messageId)
      return { status: 200, body: { ok: true, estado: 'ENVIADO', message_id: envioOk.messageId } }
    } else {
      await client.query(
        `UPDATE public.solicitudes_imagenes
         SET estado = 'ERROR', codigo = $2, enlace = $3, whatsapp_destino = $4, linea_wa = $5,
             intentos = intentos + 1, ultimo_error = $6, autorizado_por = COALESCE($7, autorizado_por)
         WHERE id = $1`,
        [solicitudId, codigo, enlace, sol.whatsapp, linea, envioErr, actorId]
      )
      await client.query('COMMIT')
      log('[imagenes/enviar]', solicitudId, 'ERROR', envioErr)
      return { status: 200, body: { ok: false, estado: 'ERROR', error: envioErr } }
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ─── Cancelar una solicitud ─────────────────────────────────────────────────
export async function cancelarSolicitud({ solicitudId, personalId }) {
  if (!uuidOrNull(solicitudId)) return { status: 422, body: { ok: false, error: 'solicitud inválida' } }
  const actorId = uuidOrNull(personalId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT estado FROM public.solicitudes_imagenes WHERE id = $1 FOR UPDATE`, [solicitudId]
    )
    if (!rows[0]) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Solicitud no encontrada' } } }
    if (rows[0].estado === 'RECIBIDO') {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'No se puede cancelar una solicitud ya recibida' } }
    }
    await client.query(
      `UPDATE public.solicitudes_imagenes SET estado = 'CANCELADO', autorizado_por = COALESCE($2, autorizado_por) WHERE id = $1`,
      [solicitudId, actorId]
    )
    await client.query('COMMIT')
    return { status: 200, body: { ok: true, estado: 'CANCELADO' } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ─── Portal público: datos curados que debe mostrar (GET) ───────────────────
export async function datosPortal({ codigo }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT s.id, s.estado, s.fecha_imagenes_recibidas,
              m.nombre AS mascota, e.nombre AS especie,
              p.nombre AS plan, p.tipo_proceso
       FROM public.servicios s
       JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
       LEFT JOIN public.especies e  ON e.id = m.especie_id
       LEFT JOIN public.planes p    ON p.id = s.plan_id
       WHERE s.codigo_fotos = $1`,
      [cod]
    )
    const s = rows[0]
    if (!s) return { status: 404, body: { ok: false, error: 'no_encontrado' } }

    const config = await cargarConfigImagenes(client)
    const elegibles = Array.isArray(config.estados_elegibles) ? config.estados_elegibles : ['EN_CUARTO_FRIO']
    const yaRecibido = !!s.fecha_imagenes_recibidas || !elegibles.includes(s.estado)

    // solo_adicional según la solicitud activa (Ángel/Desamparado con adicional)
    const { rows: solRows } = await client.query(
      `SELECT solo_adicional FROM public.solicitudes_imagenes
       WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR')
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [s.id]
    )
    const soloAdicional = solRows[0]?.solo_adicional === true

    const items = yaRecibido ? [] : await itemsPortal(client, s.id, soloAdicional)

    return { status: 200, body: {
      ok: true,
      ya_recibido: yaRecibido,
      servicio: { id: s.id, mascota: s.mascota, especie: s.especie, plan: s.plan, tipo_proceso: s.tipo_proceso, estado: s.estado },
      items,
      limites: { max_mb: parseInt(config.max_mb) || 8, mimes: config.mimes_permitidos || [] },
    } }
  } finally { client.release() }
}

// ─── Portal público: recepción transaccional de imágenes/textos (POST) ──────
// payload: { recordatorios:[{sr_id, urls:[], textos:{}}], comentarios, anticipados, adicional_interes:{recordatorio_id?, texto?} }
export async function recibirImagenesPortal({ codigo, payload = {} }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockClave(client, `fotos:${cod}`)

    const { rows: svcRows } = await client.query(
      `SELECT s.id, s.estado, s.fecha_imagenes_recibidas, p.tipo_proceso
       FROM public.servicios s
       LEFT JOIN public.planes p ON p.id = s.plan_id
       WHERE s.codigo_fotos = $1
       FOR UPDATE OF s`,
      [cod]
    )
    const s = svcRows[0]
    if (!s) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Código inválido' } } }

    // Idempotencia: ya procesado → marcar solicitud RECIBIDO si existe y salir ok.
    if (s.fecha_imagenes_recibidas) {
      await client.query(
        `UPDATE public.solicitudes_imagenes SET estado = 'RECIBIDO', fecha_recepcion = COALESCE(fecha_recepcion, CURRENT_DATE)
         WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR')`,
        [s.id]
      )
      await client.query('COMMIT')
      return { status: 200, body: { ok: true, ya_recibido: true } }
    }

    const config = await cargarConfigImagenes(client)
    const elegibles = Array.isArray(config.estados_elegibles) ? config.estados_elegibles : ['EN_CUARTO_FRIO']
    if (!elegibles.includes(s.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'ya_procesado' } }
    }

    const { rows: solRows } = await client.query(
      `SELECT id, solo_adicional FROM public.solicitudes_imagenes
       WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR')
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [s.id]
    )
    const soloAdicional = solRows[0]?.solo_adicional === true

    const items = await itemsPortal(client, s.id, soloAdicional)
    const entradas = new Map((payload.recordatorios || []).map(r => [String(r.sr_id), r]))

    // Validar completitud server-side (carga parcial NO pasa a Producción)
    const faltantes = []
    for (const item of items) {
      const entry = entradas.get(String(item.sr_id))
      if (!itemCompleto(item, entry, s.id)) faltantes.push(item.recordatorio.nombre)
    }
    if (faltantes.length) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'incompleto', faltantes } }
    }

    // Persistir cada recordatorio → EN_PROCESO (solo los que recibieron requisitos)
    for (const item of items) {
      const entry = entradas.get(String(item.sr_id))
      const urls  = (entry.urls || []).filter(u => typeof u === 'string' && u.includes(s.id))
      await client.query(
        `UPDATE public.servicio_recordatorios
         SET estado = 'EN_PROCESO',
             imagen_cliente_url = $3,
             imagenes_cliente_urls = $4::jsonb,
             datos_cliente = COALESCE($5::jsonb, datos_cliente)
         WHERE id = $1 AND servicio_id = $2
           AND COALESCE(origen,'') <> 'REMOVIDO' AND estado <> 'NA'`,
        [item.sr_id, s.id, urls[0] || null, JSON.stringify(urls),
         entry.textos && Object.keys(entry.textos).length ? JSON.stringify(entry.textos) : null]
      )
    }

    // Servicio: fecha_imagenes_recibidas + comentarios + anticipados (compostaje) + avance de estado
    const esCompostaje = (s.tipo_proceso || '').startsWith('COMPOSTAJE')
    await client.query(
      `UPDATE public.servicios
       SET fecha_imagenes_recibidas = COALESCE(fecha_imagenes_recibidas, now()),
           comentarios_cliente = COALESCE($2, comentarios_cliente),
           recordatorios_anticipados = CASE WHEN $3 THEN $4 ELSE recordatorios_anticipados END,
           estado = CASE WHEN estado = 'EN_CUARTO_FRIO' THEN 'EN_PROCESO' ELSE estado END
       WHERE id = $1`,
      [s.id,
       payload.comentarios?.trim() ? payload.comentarios.trim() : null,
       esCompostaje && typeof payload.anticipados === 'boolean',
       esCompostaje && typeof payload.anticipados === 'boolean' ? payload.anticipados : null]
    )

    // Solicitud → RECIBIDO (crea una si el cliente entró por enlace manual sin solicitud previa)
    if (solRows[0]) {
      await client.query(
        `UPDATE public.solicitudes_imagenes SET estado = 'RECIBIDO', fecha_recepcion = CURRENT_DATE WHERE id = $1`,
        [solRows[0].id]
      )
    } else {
      await client.query(
        `INSERT INTO public.solicitudes_imagenes (servicio_id, estado, fecha_solicitud, fecha_recepcion, codigo, enlace)
         VALUES ($1, 'RECIBIDO', CURRENT_DATE, CURRENT_DATE, $2, $3)`,
        [s.id, cod, construirEnlace(cod)]
      )
    }

    // Interés en adicional → SOLO alerta para coordinación (sin crear servicio_recordatorios ni cobro)
    const ai = payload.adicional_interes
    if (ai && (ai.recordatorio_id || ai.texto)) {
      await client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, 'SOLICITA_ADICIONAL', 'MEDIA', $3, $4, NULL, $5::jsonb)`,
        [s.id, MOD,
         'El cliente solicitó información para comprar un recordatorio adicional',
         'Contactar al cliente y, si confirma, agregar el adicional por el flujo de Kanban',
         JSON.stringify({ recordatorio_id: ai.recordatorio_id || null, texto: ai.texto || null })]
      )
    }

    await client.query('COMMIT')
    log('[imagenes/recibir]', cod, 'RECIBIDO', items.length, 'items')
    return { status: 200, body: { ok: true, recibido: true, items: items.length } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ¿El recordatorio recibió todos sus requisitos? (imágenes completas + textos requeridos)
function itemCompleto(item, entry, servicioId) {
  const rec = item.recordatorio
  if (requiereImagen(rec)) {
    const urls = (entry?.urls || []).filter(u => typeof u === 'string' && u.includes(servicioId))
    if (urls.length < rec.max_fotos) return false
  }
  const campos = rec.campos_texto || []
  for (const c of campos) {
    const arr = entry?.textos?.[c.label] || []
    const need = c.cantidad || 1
    const filled = (Array.isArray(arr) ? arr : []).filter(v => v && String(v).trim()).length
    if (filled < need) return false
  }
  return true
}
