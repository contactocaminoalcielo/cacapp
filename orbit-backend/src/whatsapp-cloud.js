// WhatsApp Cloud API — bandeja de conversaciones y envío (línea de VETERINARIAS).
//
// Complementa a `whatsapp-cloud-webhook.js` (que recibe). Aquí vive lo que
// consume la pantalla de Orbit: listar conversaciones, abrir un hilo, marcar
// leído y responder.
//
// ⚠️ No confundir con `whatsapp.js` — ese es el emisor de Zolutium/GHL y sigue
// operando para grupales, imágenes y digitales. Este habla con Meta directo.
//
// Variables en /opt/orbit-backend/.env:
//   WHATSAPP_ACCESS_TOKEN      — token permanente de la app de Meta
//   WHATSAPP_API_VERSION       — v26.0
//   WHATSAPP_ALLOWED_PHONE_IDS — de dónde se envía (se usa el primero como default)
import { pool, log } from './db.js'

const MOD = '[wa-bandeja]'
const GRAPH = 'https://graph.facebook.com'

/** Tope duro de WhatsApp para un mensaje de texto. */
const MAX_CARACTERES = 4096

/** Mensajes que se cargan al abrir un hilo. */
const MAX_HILO = 300

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista de conversaciones ordenada por actividad, con nombre resuelto contra
 * aliados/clientes, no leídos y estado de la ventana de 24h.
 * @param q  filtro de texto libre (nombre o número)
 */
export async function listarConversaciones({ q = null } = {}) {
  const filtro = (q || '').trim().toLowerCase() || null

  // Las etiquetas viajan con cada conversación: la bandeja las pinta y arma con
  // ellas sus listas (Novedades, Servicios, …) sin una segunda consulta. Van en
  // un LATERAL agregado para no multiplicar filas cuando hay varias.
  const { rows } = await pool.query(
    `SELECT v.contacto, v.nombre, v.nombre_perfil, v.tipo_contacto, v.aliado_id, v.cliente_id,
            v.ultimo_mensaje_en, v.ultimo_entrante_en, v.ultimo_texto, v.ultima_direccion,
            v.sin_leer, v.ventana_abierta, v.ventana_hasta,
            COALESCE(e.etiquetas, '[]'::json) AS etiquetas
       FROM public.v_whatsapp_conversaciones v
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'clave', t.clave, 'nombre', t.nombre, 'grupo', t.grupo,
                  'color', t.color, 'origen', ce.origen, 'motivo', ce.motivo
                ) ORDER BY t.orden) AS etiquetas
           FROM public.whatsapp_conversacion_etiquetas ce
           JOIN public.whatsapp_etiquetas t ON t.id = ce.etiqueta_id AND t.activo
          WHERE ce.contacto = v.contacto
       ) e ON true
      WHERE $1::text IS NULL
         OR lower(COALESCE(v.nombre, '')) LIKE '%' || $1 || '%'
         OR v.contacto LIKE '%' || $1 || '%'
      ORDER BY v.ultimo_mensaje_en DESC NULLS LAST`,
    [filtro]
  )

  return {
    ok: true,
    total: rows.length,
    sin_leer_total: rows.reduce((a, r) => a + Number(r.sin_leer || 0), 0),
    conversaciones: rows.map((r) => ({ ...r, sin_leer: Number(r.sin_leer || 0) })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas
// ─────────────────────────────────────────────────────────────────────────────

/** El catálogo. Es una tabla a propósito: las categorías se ajustan con el uso. */
export async function listarEtiquetas() {
  const { rows } = await pool.query(
    `SELECT clave, nombre, grupo, color, descripcion, orden
       FROM public.whatsapp_etiquetas WHERE activo ORDER BY orden, id`
  )
  return { ok: true, etiquetas: rows }
}

/**
 * Pone una etiqueta en una conversación. Idempotente: repetirla no duplica ni
 * falla — el agente puede insistir con la misma sin ensuciar nada.
 */
export async function etiquetar({ contacto, clave, origen = 'MANUAL', motivo = null, personalId = null }) {
  const num = soloDigitos(contacto)
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const { rows: [etq] } = await pool.query(
    `SELECT id FROM public.whatsapp_etiquetas WHERE clave = $1 AND activo`, [clave]
  )
  if (!etq) return { status: 404, body: { ok: false, error: `No existe la etiqueta ${clave}` } }

  await pool.query(
    `INSERT INTO public.whatsapp_conversacion_etiquetas
       (contacto, etiqueta_id, origen, motivo, creado_por)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (contacto, etiqueta_id) DO UPDATE
       SET motivo = COALESCE(EXCLUDED.motivo, public.whatsapp_conversacion_etiquetas.motivo)`,
    [num, etq.id, origen, motivo, personalId]
  )
  return { status: 200, body: { ok: true } }
}

/** Quitarla es cómo se cierra una novedad: la conversación sale de la lista. */
export async function desetiquetar({ contacto, clave }) {
  const num = soloDigitos(contacto)
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const { rowCount } = await pool.query(
    `DELETE FROM public.whatsapp_conversacion_etiquetas ce
      USING public.whatsapp_etiquetas t
      WHERE t.id = ce.etiqueta_id AND ce.contacto = $1 AND t.clave = $2`,
    [num, clave]
  )
  return { status: 200, body: { ok: true, quitadas: rowCount } }
}

/** Hilo completo de un contacto, del más viejo al más nuevo (orden de lectura). */
export async function hilo({ contacto, limite = MAX_HILO }) {
  const num = soloDigitos(contacto)
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const tope = Math.max(1, Math.min(parseInt(limite) || MAX_HILO, MAX_HILO))

  const [cab, msgs] = await Promise.all([
    pool.query(
      `SELECT contacto, nombre, nombre_perfil, tipo_contacto, aliado_id, cliente_id,
              ventana_abierta, ventana_hasta, ultimo_entrante_en
         FROM public.v_whatsapp_conversaciones WHERE contacto = $1`,
      [num]
    ),
    // Se piden los ÚLTIMOS `tope` (DESC + LIMIT) y se invierten en JS: con DESC
    // el LIMIT corta los más viejos, que es lo que se quiere. Con ASC cortaría
    // los más nuevos y el hilo se quedaría sin lo recién llegado.
    pool.query(
      // Los BYTES del adjunto no viajan aquí: solo si hay y de qué tipo. El hilo
      // se recarga con el polling de la bandeja, y mandar las fotos en cada
      // vuelta serían megabytes por refresco. La pantalla las pide una a una.
      `SELECT m.id, m.direccion, m.tipo, m.texto, m.estado, m.estado_en, m.error,
              m.ocurrido_en, m.wa_message_id,
              TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS enviado_por_nombre,
              (md.archivo IS NOT NULL) AS tiene_archivo,
              md.mime  AS archivo_mime,
              md.bytes AS archivo_bytes,
              md.error AS archivo_error
         FROM public.whatsapp_mensajes m
         LEFT JOIN public.personal p ON p.id = m.enviado_por
         LEFT JOIN public.whatsapp_media md ON md.mensaje_id = m.id
        WHERE m.contacto = $1
        ORDER BY m.ocurrido_en DESC, m.id DESC
        LIMIT $2`,
      [num, tope]
    ),
  ])

  if (!cab.rows[0]) return { status: 404, body: { ok: false, error: 'Conversación no encontrada' } }

  return {
    status: 200,
    body: { ok: true, contacto: cab.rows[0], mensajes: msgs.rows.reverse() },
  }
}

/**
 * Le dice a WhatsApp que leímos el mensaje y que estamos escribiendo.
 *
 * ⚠️ NO confundir con `marcarLeido()`, que está justo debajo. Son dos cosas
 * distintas que suenan igual:
 *   · esto  → el doble check AZUL y el "escribiendo…" que ve la veterinaria
 *   · aquel → `ultimo_leido_en`, el badge de no leídos de NUESTRA bandeja
 * Mezclarlas fue el bug del 11-ago: el agente apagaba el badge de coordinación
 * al responder. Aquí no se toca la base de datos a propósito — una conversación
 * que atendió el agente sigue contando como no leída para el coordinador.
 *
 * El indicador dura hasta 25 s o hasta que se envía el mensaje, lo que pase
 * antes; por eso se refresca justo antes de llamar al modelo.
 *
 * Nunca lanza y nunca bloquea: si Meta rechaza esto, la respuesta tiene que
 * salir igual. Es cosmético — importante para la percepción, pero cosmético.
 */
export async function acusarLectura({ phoneNumberId, contacto, waMessageId, escribiendo = true }) {
  const num = soloDigitos(contacto)
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!num || !waMessageId || !token) return false

  const desde = phoneNumberId || primerPhoneIdPermitido()
  if (!desde) return false

  const version = process.env.WHATSAPP_API_VERSION || 'v26.0'
  try {
    const r = await fetch(`${GRAPH}/${version}/${desde}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
        ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}),
      }),
    })
    if (!r.ok) {
      const data = await r.json().catch(() => ({}))
      log(MOD, `acuse de lectura rechazado para ${num} —`, data?.error?.message || `Error ${r.status}`)
      return false
    }
    return true
  } catch (e) {
    log(MOD, 'no se pudo acusar lectura a', num, '—', e.message)
    return false
  }
}

/** Marca la conversación como leída hasta ahora. */
export async function marcarLeido({ contacto }) {
  const num = soloDigitos(contacto)
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  await pool.query(
    `UPDATE public.whatsapp_contactos SET ultimo_leido_en = now() WHERE contacto = $1`,
    [num]
  )
  return { status: 200, body: { ok: true } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Responde texto libre a una conversación abierta.
 *
 * ⚠️ Ventana de 24h: Meta solo permite texto libre dentro de las 24h siguientes
 * al último mensaje del cliente. Fuera de eso hay que usar una plantilla
 * aprobada (todavía no implementado). Se valida ANTES de llamar a Meta para dar
 * un mensaje entendible en vez del error 131047 crudo.
 */
export async function enviarTexto({ contacto, texto, personalId }) {
  const num = soloDigitos(contacto)
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const cuerpo = (texto || '').trim()
  if (!cuerpo) return { status: 400, body: { ok: false, error: 'El mensaje está vacío' } }
  if (cuerpo.length > MAX_CARACTERES) {
    return { status: 400, body: { ok: false, error: `El mensaje supera los ${MAX_CARACTERES} caracteres` } }
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) {
    log(MOD, 'ERROR: falta WHATSAPP_ACCESS_TOKEN en el .env')
    return { status: 500, body: { ok: false, error: 'WhatsApp no está configurado en el servidor' } }
  }

  const { rows } = await pool.query(
    `SELECT phone_number_id, ventana_abierta, ventana_hasta
       FROM public.v_whatsapp_conversaciones WHERE contacto = $1`,
    [num]
  )
  const conv = rows[0]
  if (!conv) return { status: 404, body: { ok: false, error: 'Conversación no encontrada' } }

  if (!conv.ventana_abierta) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'La ventana de 24 horas se cerró. Para retomar esta conversación hay que enviar una plantilla aprobada.',
        ventana_cerrada: true,
        ventana_hasta: conv.ventana_hasta,
      },
    }
  }

  const desde = conv.phone_number_id || primerPhoneIdPermitido()
  if (!desde) {
    return { status: 500, body: { ok: false, error: 'No hay número configurado para enviar (WHATSAPP_ALLOWED_PHONE_IDS)' } }
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v26.0'
  let data = {}
  let r

  try {
    r = await fetch(`${GRAPH}/${version}/${desde}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: num,
        type: 'text',
        text: { preview_url: true, body: cuerpo },
      }),
    })
    data = await r.json().catch(() => ({}))
  } catch (e) {
    // Ni siquiera se pudo hablar con Meta (red, DNS). No hay nada enviado.
    log(MOD, 'ERROR de red enviando a', num, '—', e.message)
    return { status: 502, body: { ok: false, error: `No se pudo contactar a WhatsApp: ${e.message}` } }
  }

  if (!r.ok) {
    const detalle = data?.error?.error_user_msg || data?.error?.message || `Error ${r.status}`
    log(MOD, `Meta RECHAZÓ el envío a ${num} —`, JSON.stringify(data?.error || {}))

    // Se deja rastro en el hilo: el coordinador ve que intentó y por qué falló,
    // en vez de que el mensaje desaparezca sin dejar huella.
    await pool.query(
      `INSERT INTO public.whatsapp_mensajes
         (phone_number_id, contacto, direccion, tipo, texto, estado, estado_en, error, enviado_por)
       VALUES ($1, $2, 'OUT', 'text', $3, 'failed', now(), $4, $5)`,
      [desde, num, cuerpo, detalle, personalId || null]
    ).catch((e) => log(MOD, 'no se pudo registrar el fallo —', e.message))

    return { status: 502, body: { ok: false, error: detalle } }
  }

  const wamid = data?.messages?.[0]?.id || null

  const { rows: guardado } = await pool.query(
    `INSERT INTO public.whatsapp_mensajes
       (phone_number_id, contacto, direccion, wa_message_id, tipo, texto, estado, estado_en, enviado_por)
     VALUES ($1, $2, 'OUT', $3, 'text', $4, 'sent', now(), $5)
     ON CONFLICT DO NOTHING
     RETURNING id, direccion, tipo, texto, estado, estado_en, ocurrido_en, wa_message_id`,
    [desde, num, wamid, cuerpo, personalId || null]
  )

  // Responder implica haber leído: evita que la conversación quede marcada
  // como no leída justo después de contestarla.
  //
  // ⚠️ Solo cuando responde una PERSONA (`personalId`). El agente también envía
  // por aquí, y si sus respuestas marcaran leído, cada conversación que atienda
  // quedaría en cero no leídos: el badge de coordinación se apagaría y las que
  // el agente dice que va a escalar no las vería nadie. La vet oye "coordinación
  // te escribe en seguida" y no le escribe nadie.
  if (personalId) {
    await pool.query(
      `UPDATE public.whatsapp_contactos SET ultimo_leido_en = now() WHERE contacto = $1`,
      [num]
    )
  }

  log(MOD, `enviado a ${num} por ${desde} (wamid=${wamid || '-'}, ${cuerpo.length} chars)`)
  return { status: 200, body: { ok: true, mensaje: guardado[0] || null, wa_message_id: wamid } }
}

// ─────────────────────────────────────────────────────────────────────────────

/** Meta manda y espera el número sin '+' ni separadores: 573001234567. */
function soloDigitos(v) {
  const s = String(v ?? '').replace(/\D/g, '')
  return s.length >= 10 ? s : null
}

function primerPhoneIdPermitido() {
  return (process.env.WHATSAPP_ALLOWED_PHONE_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)[0] || null
}
