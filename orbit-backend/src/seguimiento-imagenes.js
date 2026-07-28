// Seguimiento automático de la solicitud de imágenes: 2º y 3er contacto.
// Migración 044. Decisiones David 2026-07-14:
//   - Contacto 1 = manual (bandeja, sin cambios). Contactos 2 y 3 = automáticos.
//   - Ancla ÚNICA = fecha de envío del contacto 1: C2 = +3 hábiles, C3 = +15 hábiles.
//     No es una cadena: recalcular la fecha de un contacto siempre da lo mismo.
//   - Agotados los 3 sin carga → solicitud SIN_RESPUESTA + alerta para llamar.
//     El enlace del portal SIGUE VIVO (el cliente puede cargar tarde y cierra la
//     solicitud en RECIBIDO).
//
// Garantías de "sin errores" (por diseño, no por cuidado del operador):
//   1. Índice único (solicitud_id, numero) → un contacto NO puede salir dos veces,
//      aunque el cron corra doble o alguien dispare el job a mano.
//   2. Reserva ANTES de la red (fila 'ENVIANDO' commiteada): si el proceso muere
//      mientras GHL responde, la fila queda 'ENVIANDO' y NADIE la reenvía sola —
//      queda visible para revisión humana. Solo se reintenta lo que quedó 'ERROR'
//      (GHL falló → el mensaje no salió).
//   3. Verificación post-envío contra Meta (5 s): GHL responde 201 con messageId
//      aunque Meta rechace la plantilla después (#132005). Sin esto, un rechazo se
//      registraría como enviado y el cliente nunca sabría nada.
//   4. Nunca dos contactos el mismo día a la misma persona.
//   5. `arranque_desde` (config): no persigue el backlog viejo → encender el
//      seguimiento no dispara cientos de mensajes de golpe.
import { pool, log } from './db.js'
import {
  cargarConfigImagenes, construirEnlace, plantillaContacto, resolverBodyParams,
  mensajeRecordatorio, LIMITE_META_CHARS,
} from './reglas-imagenes.js'
import { enviarPlantillaGenerica, consultarEstadoMensajeGHL } from './whatsapp.js'

const MOD = 'SOLICITUDES_IMAGENES'

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

// Un número sirve si tiene al menos 10 dígitos — mismo criterio con el que el
// job elige a quién contactar. Sirve para no dejar que un campo en blanco o a
// medio digitar en la ficha del cliente pise un destino que sí servía.
function waOrNull(value) {
  const s = String(value || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

/**
 * Envía el contacto `numero` (2 ó 3) de una solicitud. Idempotente y seguro para
 * ejecutar en paralelo con el envío manual del contacto 1 (mismo advisory lock).
 *
 * @param automatico  false cuando lo fuerza una persona desde la bandeja.
 * @returns { enviado:boolean, motivo?:string, error?:string }
 */
export async function enviarContacto({ solicitudId, numero, automatico = true, personalId = null, programadoPara = null }) {
  if (!uuidOrNull(solicitudId)) return { enviado: false, motivo: 'solicitud_invalida' }
  if (![2, 3].includes(Number(numero))) return { enviado: false, motivo: 'numero_invalido' }
  const n = Number(numero)
  const actorId = uuidOrNull(personalId)

  // ── Fase 1 (transaccional): validar y RESERVAR el cupo del contacto ────────
  const client = await pool.connect()
  let reserva = null
  try {
    await client.query('BEGIN')
    // Mismo lock que enviarSolicitud → serializa con el envío manual del contacto 1.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`solimg:${solicitudId}`])

    const { rows } = await client.query(
      `SELECT sol.id, sol.servicio_id, sol.estado, sol.seguimiento_pausado, sol.whatsapp_destino,
              s.estado AS servicio_estado, s.fecha_imagenes_recibidas, s.codigo_fotos,
              m.nombre AS mascota,
              c.nombre AS cliente_nombre, c.whatsapp,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario
       FROM public.solicitudes_imagenes sol
       JOIN public.servicios s     ON s.id = sol.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       WHERE sol.id = $1
       FOR UPDATE OF sol`,
      [solicitudId]
    )
    const sol = rows[0]
    if (!sol) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'no_encontrada' } }

    // Gates de negocio (hechos, no estados frágiles): ya cargó / ya no se persigue.
    if (sol.fecha_imagenes_recibidas) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'ya_recibido' } }
    if (['RECIBIDO', 'CANCELADO'].includes(sol.estado)) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'solicitud_cerrada' } }
    if (sol.seguimiento_pausado && automatico) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'pausado' } }

    // El número VIGENTE del cliente manda. `sol.whatsapp_destino` es el registro
    // de a dónde salió el contacto 1, no la libreta de direcciones: si se
    // corrigió el WhatsApp (justamente porque el viejo estaba malo), el 2º y el
    // 3º tienen que ir al nuevo. Al revés se quedaba pegado el primero y los
    // mensajes seguían saliendo al número equivocado. El snapshot solo sirve de
    // respaldo si el cliente se quedó sin número en la ficha.
    const destino = waOrNull(sol.whatsapp) || waOrNull(sol.whatsapp_destino)
    if (!destino) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'sin_whatsapp' } }

    const config = await cargarConfigImagenes(client)

    // El portal solo acepta cargas en estos estados: si el servicio ya salió de la
    // ventana, perseguir fotos es inútil (el cliente no podría subirlas).
    // ⚠️ Acoplado a `estados_portal` a propósito: si cambia allá, cambia aquí.
    const portalStates = Array.isArray(config.estados_portal)
      ? config.estados_portal : ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION']
    if (!portalStates.includes(sol.servicio_estado)) {
      await client.query('ROLLBACK')
      return { enviado: false, motivo: 'fuera_de_ventana' }
    }

    const plantilla = plantillaContacto(config, n)
    if (!plantilla) {
      await client.query('ROLLBACK')
      // No es un error: la automatización no está armada todavía. El job lo reporta.
      return { enviado: false, motivo: 'sin_plantilla' }
    }

    const codigo = sol.codigo_fotos
    if (!codigo) { await client.query('ROLLBACK'); return { enviado: false, motivo: 'sin_codigo' } }
    const enlace = construirEnlace(codigo)

    // Reserva del cupo. ON CONFLICT: solo se retoma lo que quedó en ERROR (GHL
    // falló → el mensaje NO salió). Un 'ENVIADO' o un 'ENVIANDO' colgado NO se
    // reenvía solo: preferimos un contacto perdido a un cliente en duelo con
    // mensajes duplicados.
    const { rows: res } = await client.query(
      `INSERT INTO public.solicitud_imagenes_contactos
         (solicitud_id, servicio_id, numero, estado, automatico, plantilla, idioma,
          whatsapp_destino, programado_para, autorizado_por)
       VALUES ($1, $2, $3, 'ENVIANDO', $4, $5, $6, $7, $8, $9)
       ON CONFLICT (solicitud_id, numero) DO UPDATE
         SET estado = 'ENVIANDO', plantilla = EXCLUDED.plantilla, idioma = EXCLUDED.idioma,
             whatsapp_destino = EXCLUDED.whatsapp_destino, ultimo_error = NULL,
             autorizado_por = COALESCE(EXCLUDED.autorizado_por, solicitud_imagenes_contactos.autorizado_por)
         WHERE solicitud_imagenes_contactos.estado = 'ERROR'
       RETURNING id`,
      [solicitudId, sol.servicio_id, n, automatico, plantilla.nombre, plantilla.idioma,
       destino, programadoPara, actorId]
    )
    if (!res[0]) {
      // El cupo ya estaba tomado (ENVIADO, o ENVIANDO en curso/colgado).
      await client.query('ROLLBACK')
      return { enviado: false, motivo: 'ya_contactado' }
    }

    const datosVars = {
      cliente_nombre: sol.cliente_nombre, propietario: sol.propietario,
      mascota: sol.mascota, enlace, codigo,
    }
    const headerParams = resolverBodyParams(plantilla.headerVars, datosVars)
    const bodyParams   = resolverBodyParams(plantilla.vars, datosVars)
    const mensaje = mensajeRecordatorio({
      nombre: sol.cliente_nombre || sol.propietario, mascota: sol.mascota, enlace, numero: n,
    })

    reserva = { id: res[0].id, destino, propietario: sol.propietario, mascota: sol.mascota,
                servicioId: sol.servicio_id, plantilla, headerParams, bodyParams, mensaje }

    await client.query('COMMIT')   // la reserva queda firme ANTES de tocar la red
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    throw e
  }
  client.release()

  // ── Fase 2 (red): enviar por Zolutium y verificar contra Meta ──────────────
  // Guardia #132005: plantilla + parámetros > 1024 chars → Meta rechaza async.
  const largo = reserva.mensaje.length + reserva.bodyParams.join('').length + reserva.headerParams.join('').length
  if (largo > LIMITE_META_CHARS) {
    await marcarContacto(reserva.id, {
      estado: 'ERROR',
      error: `Mensaje demasiado largo para Meta (${largo} > ${LIMITE_META_CHARS} chars). Acorta la plantilla.`,
    })
    return { enviado: false, motivo: 'excede_limite_meta' }
  }

  let envioOk = null, envioErr = null
  try {
    envioOk = await enviarPlantillaGenerica({
      telefono: reserva.destino,
      nombre:   reserva.propietario || '',
      plantillaNombre: reserva.plantilla.nombre,
      idioma:   reserva.plantilla.idioma,
      category: reserva.plantilla.categoria,
      mensaje:  reserva.mensaje,
      bodyParams:   reserva.bodyParams,
      headerParams: reserva.headerParams,
      // Sin fromNumber: GHL lo IGNORA para números WABA y rutea por el canal por
      // defecto de la cuenta (la línea se fija en la configuración de Zolutium).
    })
  } catch (e) {
    envioErr = (e.message || 'Error enviando por Zolutium').slice(0, 900)
  }

  // GHL acepta el mensaje (201 + messageId) aunque Meta lo rechace segundos
  // después. Sin esta verificación, un rechazo quedaría registrado como enviado.
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
      log('[seguimiento-imagenes] verificación post-envío falló (se asume enviado)', e.message)
    }
  }

  const exito = !!envioOk && !envioErr
  await marcarContacto(reserva.id, {
    estado: exito ? 'ENVIADO' : 'ERROR',
    mensaje: reserva.mensaje,
    messageId: envioOk?.messageId || null,
    contactId: envioOk?.contactId || null,
    estadoMeta,
    error: envioErr,
  })

  log('[seguimiento-imagenes]', reserva.servicioId, `contacto ${n}`, exito ? 'ENVIADO' : `ERROR: ${envioErr}`)
  return exito ? { enviado: true } : { enviado: false, motivo: 'error_envio', error: envioErr }
}

/** Cierra la fila de la bitácora con el resultado real del envío. */
async function marcarContacto(id, { estado, mensaje = null, messageId = null, contactId = null, estadoMeta = null, error = null }) {
  await pool.query(
    `UPDATE public.solicitud_imagenes_contactos
     SET estado = $2,
         mensaje = COALESCE($3, mensaje),
         message_id = $4, contact_id = $5, estado_meta = $6, ultimo_error = $7,
         enviado_en = CASE WHEN $2 = 'ENVIADO' THEN now() ELSE enviado_en END
     WHERE id = $1`,
    [id, estado, mensaje, messageId, contactId, estadoMeta, error]
  )
}

/**
 * Cierra una solicitud que deja de perseguirse.
 * @param motivo AGOTADO (3 contactos sin respuesta) | FUERA_DE_VENTANA | SIN_WHATSAPP
 * @param alertar true → alerta operativa + notificación para que alguien LLAME.
 */
export async function cerrarSolicitud({ solicitudId, motivo, alertar = false }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE public.solicitudes_imagenes sol
       SET estado = 'SIN_RESPUESTA', motivo_cierre = $2, fecha_cierre = public.fn_hoy_bogota()
       WHERE sol.id = $1 AND sol.estado = 'ENVIADO'
       RETURNING sol.servicio_id`,
      [solicitudId, motivo]
    )
    if (!rows[0]) { await client.query('ROLLBACK'); return { cerrada: false } }
    const servicioId = rows[0].servicio_id

    if (alertar) {
      const { rows: info } = await client.query(
        `SELECT m.nombre AS mascota,
                TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
                c.whatsapp
         FROM public.servicios s
         JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
         LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
         WHERE s.id = $1`,
        [servicioId]
      )
      const i = info[0] || {}
      await client.query(
        `INSERT INTO public.alertas_operativas
           (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
         VALUES ($1, NULL, $2, 'IMAGENES_SIN_RESPUESTA', 'ALTA', $3, $4, $5, $6::jsonb)`,
        [servicioId, MOD,
         `${i.propietario || 'El cliente'} no envió las imágenes de ${i.mascota || 'su mascota'} tras 3 contactos por WhatsApp`,
         'Llamar por teléfono. El enlace del portal sigue activo: si el cliente carga, la solicitud se cierra sola.',
         `SEGIMG_AGOTADO:${solicitudId}`,
         JSON.stringify({ solicitud_id: solicitudId, whatsapp: i.whatsapp || null, motivo })]
      )
      await client.query(
        `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
         SELECT p.id, 'IMAGENES_SIN_RESPUESTA', 'Cliente sin responder por imágenes', $1, $2::jsonb
         FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
         WHERE r.nombre IN ('COORDINADOR','ADMIN') AND p.activo`,
        [`${i.propietario || 'Un cliente'} (${i.mascota || 'mascota'}) no respondió a los 3 contactos por imágenes. Requiere llamada.`,
         JSON.stringify({ servicio_id: servicioId, solicitud_id: solicitudId })]
      )
    }

    await client.query('COMMIT')
    log('[seguimiento-imagenes] cerrada', solicitudId, motivo)
    return { cerrada: true }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Resumen para la bandeja: la bitácora de contactos + cuándo toca el siguiente.
 * Las fechas se calculan AQUÍ (fn_sumar_dias_habiles conoce los festivos); el
 * navegador solo pinta — nunca recalcula días hábiles por su cuenta.
 */
export async function resumenSeguimiento() {
  const client = await pool.connect()
  try {
    const config = await cargarConfigImagenes(client)
    const dias2 = parseInt(config.dias_contacto_2) || 3
    const dias3 = parseInt(config.dias_contacto_3) || 15

    // Fechas DATE → texto 'YYYY-MM-DD' (una columna DATE llega como Date de JS y
    // el navegador la interpretaría como UTC → un día menos en Colombia).
    // `enviado_en` sí es timestamptz: es un instante, va en ISO sin problema.
    const { rows: contactos } = await client.query(
      `SELECT sc.solicitud_id, sc.numero, sc.estado, sc.automatico, sc.enviado_en,
              sc.programado_para::text AS programado_para, sc.estado_meta, sc.ultimo_error
       FROM public.solicitud_imagenes_contactos sc
       JOIN public.solicitudes_imagenes sol ON sol.id = sc.solicitud_id
       WHERE sol.estado <> 'CANCELADO'
       ORDER BY sc.numero ASC`
    )

    const { rows: plan } = await client.query(
      `WITH c1 AS (
         SELECT solicitud_id, (MIN(enviado_en) AT TIME ZONE 'America/Bogota')::date AS dia
         FROM public.solicitud_imagenes_contactos
         WHERE numero = 1 AND estado = 'ENVIADO' AND enviado_en IS NOT NULL
         GROUP BY solicitud_id
       )
       SELECT sol.id AS solicitud_id,
              c1.dia::text AS ancla,
              public.fn_sumar_dias_habiles(c1.dia, $1::int)::text AS due2,
              public.fn_sumar_dias_habiles(c1.dia, $2::int)::text AS due3,
              public.fn_hoy_bogota()::text AS hoy
       FROM public.solicitudes_imagenes sol
       JOIN c1 ON c1.solicitud_id = sol.id
       WHERE sol.estado = 'ENVIADO'`,
      [dias2, dias3]
    )

    const porSolicitud = {}
    for (const c of contactos) {
      (porSolicitud[c.solicitud_id] ||= { contactos: [] }).contactos.push(c)
    }
    for (const p of plan) {
      const entry = (porSolicitud[p.solicitud_id] ||= { contactos: [] })
      const hecho = n => entry.contactos.some(c => c.numero === n && c.estado === 'ENVIADO')
      // El próximo es el primer contacto pendiente; su fecha ya es día hábil real.
      const proximo = !hecho(2) ? { numero: 2, fecha: p.due2 }
                    : !hecho(3) ? { numero: 3, fecha: p.due3 }
                    : null
      Object.assign(entry, { ancla: p.ancla, due2: p.due2, due3: p.due3, hoy: p.hoy, proximo })
    }
    return porSolicitud
  } finally { client.release() }
}

/** Pausar/reanudar la cadencia de un caso puntual (bandeja). */
export async function pausarSeguimiento({ solicitudId, pausado }) {
  if (!uuidOrNull(solicitudId)) return { status: 422, body: { ok: false, error: 'solicitud inválida' } }
  const { rows } = await pool.query(
    `UPDATE public.solicitudes_imagenes SET seguimiento_pausado = $2 WHERE id = $1
     RETURNING id, seguimiento_pausado`,
    [solicitudId, pausado === true]
  )
  if (!rows[0]) return { status: 404, body: { ok: false, error: 'Solicitud no encontrada' } }
  return { status: 200, body: { ok: true, seguimiento_pausado: rows[0].seguimiento_pausado } }
}

/** Forzar el siguiente contacto desde la bandeja (una persona lo decide). */
export async function forzarContacto({ solicitudId, numero, personalId }) {
  const r = await enviarContacto({ solicitudId, numero, automatico: false, personalId })
  if (r.enviado) return { status: 200, body: { ok: true, enviado: true } }
  const map = {
    sin_plantilla:      'La plantilla de este contacto no está configurada en Zolutium (config_operativa → plantilla_contacto_N).',
    ya_contactado:      'Este contacto ya se envió (o está en curso).',
    ya_recibido:        'El cliente ya envió sus imágenes.',
    fuera_de_ventana:   'El servicio ya no admite carga de imágenes.',
    pausado:            'El seguimiento de esta solicitud está pausado.',
    sin_whatsapp:       'El cliente no tiene WhatsApp registrado.',
    excede_limite_meta: 'El mensaje supera el límite de 1024 caracteres de Meta.',
  }
  return { status: r.motivo === 'error_envio' ? 200 : 409,
           body: { ok: false, error: r.error || map[r.motivo] || r.motivo } }
}
