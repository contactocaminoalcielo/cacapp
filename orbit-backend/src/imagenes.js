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
import {
  ofertasParaServicio, ofertaCompleta, aplicarOfertaAceptada, registrarRechazoOferta,
  registrarVistasOfertas,
} from './ofertas.js'
import { enviarPlantillaGenerica, consultarEstadoMensajeGHL } from './whatsapp.js'

const MOD = 'SOLICITUDES_IMAGENES'

/**
 * Corre un efecto SECUNDARIO del envío del portal dentro de su propio SAVEPOINT.
 *
 * El núcleo del envío (fotos, textos, datos de entrega, avance de estado) es
 * todo-o-nada y así debe seguir. Pero lo accesorio —una oferta, una alerta— no
 * puede costarle al cliente su carga completa: en agosto de 2026 un INSERT de
 * oferta con `datos_cliente` NULL hizo ROLLBACK de envíos enteros y varios
 * clientes reintentaron hasta 8 veces, volviendo a subir todas sus fotos y a
 * llenar el formulario cada vez. Ver [[bug_null_explicito_no_cae_al_default]].
 *
 * Si `fn` revienta, se deshace SOLO su pedazo y la transacción sigue viva
 * (ROLLBACK TO SAVEPOINT deja la sesión utilizable; sin él, Postgres rechaza
 * todo comando posterior hasta el ROLLBACK final).
 *
 * El nombre del savepoint lo generamos nosotros — nunca sale del payload del
 * cliente, que no puede inyectar un identificador SQL.
 */
async function aislado(client, etiqueta, fn) {
  const sp = 'sp_' + Math.random().toString(36).slice(2, 10)
  await client.query(`SAVEPOINT ${sp}`)
  try {
    const valor = await fn()
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    return { ok: true, valor }
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    log('[imagenes/recibir] efecto aislado FALLÓ —', etiqueta, '—', e.message,
        '(el envío del cliente NO se pierde)')
    return { ok: false, error: e }
  }
}

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

    const mensaje = mensajeSolicitud({ nombre: sol.cliente_nombre || sol.propietario, mascota: sol.mascota, enlace })

    // Envío (red, dentro del advisory lock para serializar; volumen bajo y manual)
    let envioOk = null, envioErr = null
    try {
      envioOk = await enviarPlantillaGenerica({
        telefono: sol.whatsapp,
        nombre:   sol.propietario || sol.cliente_nombre || '',
        plantillaNombre: config.plantilla_nombre,
        idioma:   config.plantilla_idioma || 'es_MX',
        category: config.plantilla_categoria || 'UTILITY',
        mensaje,
        // Plantilla aprobada `solicitud_imagenes_cliente`: 2 variables → {{1}} mascota, {{2}} enlace.
        // El enlace lleva el código embebido (/#/fotos/CODIGO); el cliente entra sin teclear código.
        bodyParams: [sol.mascota || '', enlace],
        // No se pasa fromNumber: GHL/Zolutium lo IGNORA para números de WhatsApp
        // importados de Meta (WABA) y rutea por el canal por defecto de la cuenta.
        // La línea emisora se fija en la configuración de Zolutium. linea_wa queda
        // solo como registro de la línea esperada (= linea_default).
      })
    } catch (e) { envioErr = e.message }

    // GHL acepta el mensaje (201 + messageId) aunque Meta lo rechace segundos
    // después (#132005). Verificarlo importa doble aquí: este envío es el ANCLA
    // de la cadencia (2º y 3er contacto se calculan desde su fecha) — darlo por
    // bueno sin confirmar sería perseguir al cliente desde una fecha fantasma.
    let estadoMeta = null
    if (envioOk) {
      try {
        await new Promise(r => setTimeout(r, 5000))
        const est = await consultarEstadoMensajeGHL(envioOk.messageId)
        estadoMeta = est?.status || null
        if (est?.status === 'failed') {
          envioErr = `Meta rechazó el envío: ${est.error || 'sin detalle'}`.slice(0, 900)
        }
      } catch (e) {
        log('[imagenes/enviar] verificación post-envío falló (se asume enviado)', e.message)
      }
    }

    if (envioOk && !envioErr) {
      await client.query(
        `UPDATE public.solicitudes_imagenes
         SET estado = 'ENVIADO', codigo = $2, enlace = $3, whatsapp_destino = $4, linea_wa = $5,
             message_id = $6, contact_id = $7, fecha_envio = now(),
             intentos = intentos + 1, ultimo_error = NULL, autorizado_por = COALESCE($8, autorizado_por)
         WHERE id = $1`,
        [solicitudId, codigo, enlace, sol.whatsapp, linea, envioOk.messageId, envioOk.contactId, actorId]
      )
      // Contacto 1 en la bitácora: es el ancla de los contactos 2 y 3 (migr. 044).
      await registrarContacto1(client, {
        solicitudId, servicioId: sol.servicio_id, plantilla: config.plantilla_nombre,
        idioma: config.plantilla_idioma || 'es_MX', destino: sol.whatsapp, mensaje,
        messageId: envioOk.messageId, contactId: envioOk.contactId, estadoMeta,
        error: null, actorId,
      })
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
      await registrarContacto1(client, {
        solicitudId, servicioId: sol.servicio_id, plantilla: config.plantilla_nombre,
        idioma: config.plantilla_idioma || 'es_MX', destino: sol.whatsapp, mensaje,
        messageId: envioOk?.messageId || null, contactId: envioOk?.contactId || null,
        estadoMeta, error: envioErr, actorId,
      })
      await client.query('COMMIT')
      log('[imagenes/enviar]', solicitudId, 'ERROR', envioErr)
      return { status: 200, body: { ok: false, estado: 'ERROR', error: envioErr } }
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// Deja constancia del contacto 1 (el que autoriza una persona) en la bitácora de
// contactos. Su `enviado_en` es el ANCLA desde la que se calculan el 2º (+3 días
// hábiles) y el 3er contacto (+15). Si el envío falló, queda ERROR y sin ancla:
// la cadencia no arranca sobre un mensaje que nunca salió. Un reintento exitoso
// pisa la fila y fija el ancla real. Migración 044.
async function registrarContacto1(client, {
  solicitudId, servicioId, plantilla, idioma, destino, mensaje,
  messageId, contactId, estadoMeta, error, actorId,
}) {
  const ok = !error
  await client.query(
    `INSERT INTO public.solicitud_imagenes_contactos
       (solicitud_id, servicio_id, numero, estado, automatico, plantilla, idioma,
        whatsapp_destino, mensaje, message_id, contact_id, estado_meta, ultimo_error,
        programado_para, enviado_en, autorizado_por)
     VALUES ($1, $2, 1, $3, false, $4, $5, $6, $7, $8, $9, $10, $11,
             public.fn_hoy_bogota(), CASE WHEN $3 = 'ENVIADO' THEN now() END, $12)
     ON CONFLICT (solicitud_id, numero) DO UPDATE
       SET estado = EXCLUDED.estado, plantilla = EXCLUDED.plantilla, idioma = EXCLUDED.idioma,
           whatsapp_destino = EXCLUDED.whatsapp_destino, mensaje = EXCLUDED.mensaje,
           message_id = EXCLUDED.message_id, contact_id = EXCLUDED.contact_id,
           estado_meta = EXCLUDED.estado_meta, ultimo_error = EXCLUDED.ultimo_error,
           enviado_en = COALESCE(EXCLUDED.enviado_en, solicitud_imagenes_contactos.enviado_en),
           autorizado_por = COALESCE(EXCLUDED.autorizado_por, solicitud_imagenes_contactos.autorizado_por)`,
    [solicitudId, servicioId, ok ? 'ENVIADO' : 'ERROR', plantilla, idioma, destino,
     mensaje, messageId, contactId, estadoMeta, error, actorId]
  )
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
      `SELECT s.id, s.estado, s.fecha_imagenes_recibidas, s.plan_id,
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
    const portalStates = Array.isArray(config.estados_portal) ? config.estados_portal : ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION']
    // Distinguir dos situaciones que antes se confundían en un solo "ya_recibido":
    //  - yaRecibido: el cliente SÍ envió (fecha_imagenes_recibidas) → "ya recibimos todo".
    //  - fueraDeVentana: no envió, pero el servicio no está en la ventana del portal
    //    (aún antes del cuarto frío, o ya producido/entregado) → mensaje honesto, no
    //    el falso "gracias, ya recibimos".
    const yaRecibido    = !!s.fecha_imagenes_recibidas
    const fueraDeVentana = !yaRecibido && !portalStates.includes(s.estado)

    // solo_adicional según la solicitud activa (Ángel/Desamparado con adicional)
    const { rows: solRows } = await client.query(
      `SELECT solo_adicional FROM public.solicitudes_imagenes
       WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR','SIN_RESPUESTA')
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [s.id]
    )
    const soloAdicional = solRows[0]?.solo_adicional === true

    const items = (yaRecibido || fueraDeVentana) ? [] : await itemsPortal(client, s.id, soloAdicional)

    // ¿Hay algo FÍSICO que entregar? Sirve para no pedir datos de entrega cuando
    // no aplica (p.ej. eco-grupal / compostaje grupal: no se devuelven cenizas y
    // todos los recordatorios son digitales). Regla: entrega física si el proceso
    // es INDIVIDUAL (devuelve cenizas) o si existe algún recordatorio no-digital.
    const esGrupal = /GRUPAL/i.test(s.tipo_proceso || '')
    const { rows: fisRows } = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM public.servicio_recordatorios sr
         JOIN public.recordatorios r ON r.id = sr.recordatorio_id
         WHERE sr.servicio_id = $1
           AND COALESCE(sr.origen,'') <> 'REMOVIDO'
           AND sr.estado <> 'NA'
           AND COALESCE(r.categoria,'') <> 'digital'
       ) AS tiene`,
      [s.id]
    )
    const tieneEntregaFisica = !esGrupal || fisRows[0]?.tiene === true

    // Anuncios que le corresponden a este servicio (los de mayor prioridad,
    // con tope server-side). Por cada uno que acepte, el portal habilita la
    // carga de SU recordatorio.
    const ofertas = (yaRecibido || fueraDeVentana)
      ? []
      : await ofertasParaServicio(client, s.id, s.plan_id)

    // El anuncio llegó a los ojos del cliente: se cuenta la impresión. Es
    // best-effort y no bloquea la respuesta del portal.
    await registrarVistasOfertas(client, s.id, ofertas)

    return { status: 200, body: {
      ok: true,
      ya_recibido: yaRecibido,
      fuera_de_ventana: fueraDeVentana,
      tiene_entrega_fisica: tieneEntregaFisica,
      servicio: { id: s.id, mascota: s.mascota, especie: s.especie, plan: s.plan, tipo_proceso: s.tipo_proceso, estado: s.estado },
      items,
      ofertas,
      // Compat: las PWA en caché leen `oferta` (singular) y solo saben mostrar
      // una. Mientras siga viva alguna versión vieja, se les manda la primera
      // en vez de dejarlas sin anuncio.
      oferta: ofertas[0] || null,
      limites: { max_mb: parseInt(config.max_mb) || 8, mimes: config.mimes_permitidos || [] },
    } }
  } finally { client.release() }
}

// ─── Portal público: recepción transaccional de imágenes/textos (POST) ──────
// payload: { recordatorios:[{sr_id, urls:[], textos:{}}], comentarios, anticipados, adicional_interes:{recordatorio_id?, texto?}, entrega:{direccion,barrio,localidad,recibe,telefono,telefono_adicional,horarios} }
export async function recibirImagenesPortal({ codigo, payload = {} }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockClave(client, `fotos:${cod}`)

    const { rows: svcRows } = await client.query(
      `SELECT s.id, s.estado, s.fecha_imagenes_recibidas, s.plan_id, p.tipo_proceso
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
         WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR','SIN_RESPUESTA')`,
        [s.id]
      )
      await client.query('COMMIT')
      return { status: 200, body: { ok: true, ya_recibido: true } }
    }

    const config = await cargarConfigImagenes(client)
    const portalStates = Array.isArray(config.estados_portal) ? config.estados_portal : ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION']
    if (!portalStates.includes(s.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'fuera_de_ventana' } }
    }

    const { rows: solRows } = await client.query(
      `SELECT id, solo_adicional FROM public.solicitudes_imagenes
       WHERE servicio_id = $1 AND estado IN ('POR_VALIDAR','ENVIADO','ERROR','SIN_RESPUESTA')
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [s.id]
    )
    const soloAdicional = solRows[0]?.solo_adicional === true

    const items = await itemsPortal(client, s.id, soloAdicional)
    const entradas = new Map((payload.recordatorios || []).map(r => [String(r.sr_id), r]))
    // Recordatorios que el cliente declinó ("no deseo este recordatorio"). Solo
    // valen los que están entre SUS items curados (no se confía en el cliente).
    const declinados = new Set(
      (payload.declinados || []).map(String).filter(id => items.some(it => String(it.sr_id) === id))
    )

    // Ofertas: se re-resuelven contra la DB. Del payload solo se toma el
    // `acepta` (y el id, para casar cada respuesta con su anuncio y descartar
    // las que ya no aplican). El precio y el recordatorio salen de la tabla
    // `ofertas`, nunca del navegador.
    const ofertas = await ofertasParaServicio(client, s.id, s.plan_id)
    // `ofertas` (array) es la forma nueva; `oferta` (objeto) la manda una PWA
    // en caché que solo conoce un anuncio. Se aceptan ambas.
    const ofPayLista = Array.isArray(payload.ofertas)
      ? payload.ofertas
      : (payload.oferta && typeof payload.oferta === 'object' ? [payload.oferta] : [])
    const ofPayPorId = new Map(
      ofPayLista
        .filter(e => e && typeof e === 'object' && e.oferta_id != null)
        .map(e => [String(e.oferta_id), e])
    )
    // Solo cuentan las respuestas a un anuncio que HOY le corresponde al
    // servicio: así un id inventado (o vencido) no crea una venta.
    const respuestas = ofertas
      .map(of => ({ oferta: of, entry: ofPayPorId.get(String(of.id)) }))
      .filter(r => !!r.entry)
      .map(r => ({ ...r, acepta: r.entry.acepta === true }))
    const aceptadas = respuestas.filter(r => r.acepta)

    // Validar completitud server-side (carga parcial NO pasa a Producción).
    // Los declinados se omiten: no requieren imágenes ni textos.
    const faltantes = []
    for (const item of items) {
      if (declinados.has(String(item.sr_id))) continue
      const entry = entradas.get(String(item.sr_id))
      if (!itemCompleto(item, entry, s.id)) faltantes.push(item.recordatorio.nombre)
    }
    // Cada oferta aceptada exige su recordatorio igual que los del plan: no se
    // cobra un adicional que después Producción no puede fabricar.
    for (const r of aceptadas) {
      if (!ofertaCompleta(r.oferta, r.entry, s.id)) faltantes.push(r.oferta.recordatorio.nombre)
    }
    if (faltantes.length) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'incompleto', faltantes } }
    }

    // Datos de entrega OBLIGATORIOS si hay algo físico que entregar (misma regla
    // que datosPortal.tiene_entrega_fisica). En eco-grupal (todo digital, sin
    // cenizas) no se exige. Núcleo requerido: dirección, quién recibe y teléfono.
    const entrega = sanitizarEntrega(payload.entrega)
    const esGrupal = /GRUPAL/i.test(s.tipo_proceso || '')
    const { rows: fisRows } = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM public.servicio_recordatorios sr
         JOIN public.recordatorios r ON r.id = sr.recordatorio_id
         WHERE sr.servicio_id = $1
           AND COALESCE(sr.origen,'') <> 'REMOVIDO'
           AND sr.estado <> 'NA'
           AND COALESCE(r.categoria,'') <> 'digital'
       ) AS tiene`,
      [s.id]
    )
    // Aceptar una oferta física convierte en entregable un servicio que no lo
    // era (p.ej. eco-grupal, todo digital): entonces sí hay que pedir la entrega.
    // Basta con que UNA de las aceptadas sea física.
    const tieneEntregaFisica = !esGrupal || fisRows[0]?.tiene === true ||
                               aceptadas.some(r => r.oferta.es_fisico)
    if (tieneEntregaFisica && (!entrega || !entrega.direccion || !entrega.recibe || !entrega.telefono)) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'entrega_incompleta' } }
    }

    // Persistir cada recordatorio. Los declinados → 'NA' (no entran a producción);
    // el resto → 'EN_PROCESO' con sus imágenes/textos.
    for (const item of items) {
      if (declinados.has(String(item.sr_id))) {
        await client.query(
          `UPDATE public.servicio_recordatorios
           SET estado = 'NA'
           WHERE id = $1 AND servicio_id = $2
             AND COALESCE(origen,'') <> 'REMOVIDO' AND estado <> 'NA'`,
          [item.sr_id, s.id]
        )
        continue
      }
      const entry = entradas.get(String(item.sr_id))
      const urls  = (entry.urls || []).filter(u => typeof u === 'string' && u.includes(s.id))
      await client.query(
        `UPDATE public.servicio_recordatorios
         SET estado = 'EN_PROCESO',
             imagen_cliente_url = $3,
             imagenes_cliente_urls = $4::text[],
             datos_cliente = COALESCE($5::jsonb, datos_cliente)
         WHERE id = $1 AND servicio_id = $2
           AND COALESCE(origen,'') <> 'REMOVIDO' AND estado <> 'NA'`,
        [item.sr_id, s.id, urls[0] || null, urls,
         entry.textos && Object.keys(entry.textos).length ? JSON.stringify(entry.textos) : null]
      )
    }

    // Respuesta a cada oferta. Aceptar = venta: crea el adicional con sus fotos,
    // suma al total y recalcula estado_pago (ver ofertas.js). Rechazar solo deja
    // el registro para medir conversión. En ambos casos el UNIQUE
    // (servicio, oferta) impide cobrar dos veces si el cliente reenvía.
    // Van en serie, no en Promise.all: comparten la transacción y cada
    // aplicación suma sobre el `valor_total` que dejó la anterior.
    // Cada respuesta va AISLADA: una venta que no se puede cargar es un problema
    // de la casa, no del cliente — él ya llenó todo y sus fotos ya están subidas.
    const ofertaSrIds = []
    const ofertasFallidas = []
    for (const r of respuestas) {
      const res = await aislado(client, `oferta ${r.oferta.titulo} (${r.acepta ? 'ACEPTADA' : 'RECHAZADA'})`, async () => {
        if (r.acepta)
          return await aplicarOfertaAceptada(client, { servicioId: s.id, oferta: r.oferta, entry: r.entry })
        await registrarRechazoOferta(client, { servicioId: s.id, oferta: r.oferta })
        return null
      })
      if (res.ok) { if (r.acepta && res.valor) ofertaSrIds.push(res.valor) }
      else if (r.acepta) ofertasFallidas.push({ ...r, error: res.error })
    }

    // Una venta aceptada que no quedó cargada NO puede perderse en silencio: el
    // cliente ya dijo que sí y espera el producto. Alerta ALTA con las URLs de
    // sus fotos, que sí sobrevivieron en el storage, para que Producción las
    // encuentre al montar el adicional a mano.
    for (const f of ofertasFallidas) {
      await aislado(client, `alerta de oferta fallida ${f.oferta.id}`, () => client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, 'OFERTA_ACEPTADA', 'ALTA', $3, $4, $5, $6::jsonb)
         ON CONFLICT DO NOTHING`,
        [s.id, MOD,
         `El cliente ACEPTÓ la oferta "${f.oferta.titulo}" (${f.oferta.recordatorio.nombre}) ` +
         `por $${Number(f.oferta.precio_oferta || 0).toLocaleString('es-CO')}, pero un error técnico ` +
         `impidió cargar el adicional. Sus fotos SÍ se recibieron.`,
         'Agregar el adicional manualmente desde Kanban (con sus fotos, ver metadata) y confirmar el cobro en la entrega.',
         `oferta-fallida:${f.oferta.id}:${s.id}`,
         JSON.stringify({
           oferta_id: f.oferta.id,
           recordatorio_id: f.oferta.recordatorio.id,
           precio: f.oferta.precio_oferta,
           urls: (f.entry?.urls || []).filter(u => typeof u === 'string' && u.includes(s.id)),
           textos: f.entry?.textos || {},
           error: f.error?.message || null,
         })]
      ))
    }

    // Servicio: fecha_imagenes_recibidas + comentarios + anticipados (compostaje) + avance de estado
    // "anticipados" solo aplica a compostaje INDIVIDUAL; en eco-grupal no se pregunta ni se guarda.
    const esCompostaje = (s.tipo_proceso || '') === 'COMPOSTAJE_INDIVIDUAL'
    await client.query(
      `UPDATE public.servicios
       SET fecha_imagenes_recibidas = COALESCE(fecha_imagenes_recibidas, now()),
           comentarios_cliente = COALESCE($2, comentarios_cliente),
           recordatorios_anticipados = CASE WHEN $3 THEN $4 ELSE recordatorios_anticipados END,
           datos_entrega_cliente = COALESCE($5::jsonb, datos_entrega_cliente),
           datos_entrega_recibidos_en = CASE WHEN $5 IS NOT NULL THEN now() ELSE datos_entrega_recibidos_en END,
           estado = CASE WHEN estado = 'EN_CUARTO_FRIO' THEN 'EN_PROCESO' ELSE estado END
       WHERE id = $1`,
      [s.id,
       payload.comentarios?.trim() ? payload.comentarios.trim() : null,
       esCompostaje && typeof payload.anticipados === 'boolean',
       esCompostaje && typeof payload.anticipados === 'boolean' ? payload.anticipados : null,
       entrega ? JSON.stringify(entrega) : null]
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
      await aislado(client, 'alerta de interés en adicional', () => client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, 'SOLICITA_ADICIONAL', 'MEDIA', $3, $4, NULL, $5::jsonb)`,
        [s.id, MOD,
         'El cliente solicitó información para comprar un recordatorio adicional',
         'Contactar al cliente y, si confirma, agregar el adicional por el flujo de Kanban',
         JSON.stringify({ recordatorio_id: ai.recordatorio_id || null, texto: ai.texto || null })]
      ))
    }

    // Recordatorios declinados → alerta para coordinación (quedaron en 'NA').
    if (declinados.size) {
      const declList = items.filter(it => declinados.has(String(it.sr_id)))
      const nombres  = declList.map(it => it.recordatorio?.nombre || 'Recordatorio').join(', ')
      await aislado(client, 'alerta de recordatorios declinados', () => client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, 'RECORDATORIO_DECLINADO', 'MEDIA', $3, $4, NULL, $5::jsonb)`,
        [s.id, MOD,
         `El cliente indicó que NO desea ${declList.length} recordatorio(s): ${nombres}`,
         'Quedaron marcados como NO aplica (no entran a producción). Revisar con el cliente si corresponde.',
         JSON.stringify({ declinados: declList.map(it => ({ sr_id: it.sr_id, nombre: it.recordatorio?.nombre || null })) })]
      ))
    }

    await client.query('COMMIT')
    log('[imagenes/recibir]', cod, 'RECIBIDO', items.length, 'items',
        respuestas.length
          ? `ofertas=${respuestas.map(r => `${r.oferta.titulo}:${r.acepta ? 'ACEPTADA' : 'RECHAZADA'}`).join(', ')}`
          : '',
        ofertasFallidas.length ? `⚠ ${ofertasFallidas.length} oferta(s) NO cargada(s) — ver alerta ALTA` : '')
    return { status: 200, body: {
      ok: true, recibido: true, items: items.length,
      ofertas_aceptadas: ofertaSrIds.length,
      // Compat con la PWA vieja, que lee el booleano.
      oferta_aceptada: ofertaSrIds.length > 0,
    } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// Datos de entrega que deja el cliente en el portal. Se saneen server-side (no
// se confía en el navegador): solo campos conocidos, recortados. Devuelve null
// si el cliente no llenó nada.
function sanitizarEntrega(e) {
  if (!e || typeof e !== 'object') return null
  const txt = (v, max = 300) => {
    const s = (v == null ? '' : String(v)).trim()
    return s ? s.slice(0, max) : null
  }
  const out = {
    direccion:          txt(e.direccion),
    barrio:             txt(e.barrio, 120),
    localidad:          txt(e.localidad, 120),
    recibe:             txt(e.recibe, 120),
    telefono:           txt(e.telefono, 40),
    telefono_adicional: txt(e.telefono_adicional, 40),
    horarios:           txt(e.horarios, 300),
  }
  return Object.values(out).some(Boolean) ? out : null
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
