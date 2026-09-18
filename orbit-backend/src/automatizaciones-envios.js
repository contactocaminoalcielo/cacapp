// Seguimiento REAL de las automatizaciones: contacto por contacto.
//
// Pedido de David el 2026-09-18: el tablero de /automatizaciones contaba, pero
// no dejaba ver a QUIÉN le llegó, a quién no, y a quién le falló — ni hacer
// nada al respecto. Esto es la segunda mitad: la lista de contactos de cada
// flujo, con el acuse de Meta cruzado, y el botón de relanzar.
//
// Tres decisiones que conviene tener claras antes de tocar esto:
//
// 1. "Le llegó" NO es "se envió". Cada flujo guarda el wamid del mensaje y
//    `whatsapp_mensajes` recibe los acuses del webhook (sent → delivered →
//    read, o failed). Aquí se cruzan: un ENVIADO con acuse `failed` es un
//    contacto que NO recibió nada aunque la tabla del flujo diga que sí.
//    Cuando el wamid no existe (envío por GHL, registro manual, wa.me) el acuse
//    queda en NULL y la pantalla lo dice: "sin acuse".
//
// 2. Relanzar reutiliza la función de envío de CADA flujo, nunca manda por su
//    cuenta: así respeta las mismas reglas (plantilla, número vigente, candados
//    anti-duplicado). Lo único que hace aparte es DESTRABAR la fila cuando el
//    candado se quedó cerrado por un fallo (una reclama sin soltar, un ENVIANDO
//    huérfano, un ENVIADO cuyo acuse dice `failed`).
//
// 3. Un ENVIADO con acuse bueno (delivered/read) NO se relanza desde aquí: eso
//    sería mandarle dos veces lo mismo a una familia en duelo. Si de verdad hace
//    falta, cada módulo tiene su propio reenvío con motivo.
//
// Todo el filtrado va en SQL con LIMIT: estas tablas pasan de mil filas.
import { pool, log } from './db.js'
import { forzarContacto } from './seguimiento-imagenes.js'
import { avisarVetRecogida } from './recogidas-aviso.js'
import { enviarAvisoPlanta } from './plantas.js'
import { enviarAvisoMitad } from './mitad-compostaje.js'
import { enviarAutomatico } from './digitales.js'
import { enviarReporte } from './grupales.js'
import { explicarErrorWa } from './errores-wa.js'

const TOPE_FILAS = 400

/** Nombre a mostrar del dueño, una sola vez para todos los flujos. */
const PROPIETARIO = `TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,''))`

/**
 * Cada flujo se traduce a la MISMA forma de fila:
 *   id, servicio_id, fecha, estado (ENVIADO|ERROR|PENDIENTE|ENVIANDO|CANCELADO),
 *   error, intentos, mascota, destinatario, destino, wamid, detalle, extra (jsonb)
 * `extra` lleva lo que el relanzamiento necesita (solicitud_id + numero, etc.).
 *
 * Son constantes del código: nada del usuario se interpola aquí.
 */
const FUENTES = {
  imagenes: `
    SELECT ct.id, ct.servicio_id,
           COALESCE(ct.enviado_en, ct.updated_at) AS fecha,
           ct.estado, ct.ultimo_error AS error, NULL::int AS intentos,
           m.nombre AS mascota, ${PROPIETARIO} AS destinatario,
           COALESCE(ct.whatsapp_destino, c.whatsapp) AS destino,
           ct.message_id AS wamid, ct.estado_meta AS acuse_propio,
           (ct.numero::text || 'º contacto' || CASE WHEN ct.automatico THEN '' ELSE ' · forzado' END) AS detalle,
           jsonb_build_object('solicitud_id', ct.solicitud_id, 'numero', ct.numero, 'updated_at', ct.updated_at) AS extra
      FROM public.solicitud_imagenes_contactos ct
      JOIN public.servicios s     ON s.id = ct.servicio_id
      JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
      LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
     WHERE ct.numero >= 2`,

  // No hay tabla propia: el estado se deduce de dos columnas de `recogidas`.
  // PENDIENTE = el técnico ya está en ruta hacia una clínica y no hay aviso ni error.
  aviso_vet: `
    SELECT r.id, r.servicio_id,
           COALESCE(r.aviso_vet_enviado_en, r.created_at) AS fecha,
           CASE WHEN r.aviso_vet_enviado_en IS NOT NULL THEN 'ENVIADO'
                WHEN r.aviso_vet_error IS NOT NULL THEN 'ERROR'
                ELSE 'PENDIENTE' END AS estado,
           r.aviso_vet_error AS error, NULL::int AS intentos,
           m.nombre AS mascota, a.nombre AS destinatario,
           COALESCE(r.aviso_vet_destino, a.whatsapp) AS destino,
           r.aviso_vet_mensaje_id AS wamid, NULL::text AS acuse_propio,
           ('Técnico: ' || COALESCE(t.nombre, '—')
             || CASE WHEN r.hora_programada IS NOT NULL THEN ' · ' || LEFT(r.hora_programada::text, 5) ELSE '' END) AS detalle,
           jsonb_build_object('enviado_en', r.aviso_vet_enviado_en) AS extra
      FROM public.recogidas r
      JOIN public.servicios s     ON s.id = r.servicio_id
      LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
      LEFT JOIN public.aliados a  ON a.id_aliado = s.aliado_origen_id
      LEFT JOIN public.personal t ON t.id = s.tecnico_id
     WHERE r.tipo_lugar = 'CLINICA_ALIADA'
       AND (r.aviso_vet_enviado_en IS NOT NULL OR r.aviso_vet_error IS NOT NULL
            OR (s.estado = 'EN_RECOGIDA' AND r.hora_programada IS NOT NULL))`,

  // Lo manda una persona por wa.me: no hay acuse ni error posibles, solo el registro.
  aviso_cliente: `
    SELECT r.id, r.servicio_id, r.aviso_cliente_enviado_en AS fecha,
           'ENVIADO'::text AS estado, NULL::text AS error, NULL::int AS intentos,
           m.nombre AS mascota, ${PROPIETARIO} AS destinatario,
           COALESCE(r.aviso_cliente_destino, c.whatsapp) AS destino,
           NULL::text AS wamid, NULL::text AS acuse_propio,
           ('Avisó: ' || COALESCE(p.nombre, '—')) AS detalle,
           '{}'::jsonb AS extra
      FROM public.recogidas r
      JOIN public.servicios s     ON s.id = r.servicio_id
      LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
      LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      LEFT JOIN public.personal p ON p.id = r.aviso_cliente_por
     WHERE r.aviso_cliente_enviado_en IS NOT NULL`,

  plantas: `
    SELECT pe.id, pe.servicio_id,
           COALESCE(pe.fecha_envio, pe.created_at) AS fecha,
           CASE pe.estado WHEN 'ELEGIDA' THEN 'ENVIADO' WHEN 'CANCELADA' THEN 'CANCELADO' ELSE pe.estado END AS estado,
           pe.error, pe.intentos,
           m.nombre AS mascota, ${PROPIETARIO} AS destinatario,
           COALESCE(pe.whatsapp_destino, c.whatsapp) AS destino,
           pe.mensaje_id AS wamid, NULL::text AS acuse_propio,
           (CASE WHEN pe.estado = 'ELEGIDA' THEN 'Eligió ' || COALESCE(pe.planta_nombre, 'planta')
                 ELSE 'Cumplido el ' || to_char(pe.fecha_cumplida, 'DD/MM') END) AS detalle,
           jsonb_build_object('estado_real', pe.estado) AS extra
      FROM public.planta_elecciones pe
      JOIN public.servicios s     ON s.id = pe.servicio_id
      JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
      LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id`,

  mitad_compostaje: `
    SELECT av.id, av.servicio_id,
           COALESCE(av.fecha_envio, av.created_at) AS fecha,
           av.estado, av.error, av.intentos::int AS intentos,
           m.nombre AS mascota, ${PROPIETARIO} AS destinatario,
           COALESCE(av.whatsapp_destino, c.whatsapp) AS destino,
           av.mensaje_id AS wamid, NULL::text AS acuse_propio,
           ('Mitad el ' || to_char(av.fecha_mitad, 'DD/MM')
             || CASE WHEN EXISTS (SELECT 1 FROM public.visitas_tenjo v
                                   WHERE v.servicio_id = av.servicio_id AND v.estado IN ('SOLICITADA','PROGRAMADA'))
                     THEN ' · pidió visita' ELSE '' END) AS detalle,
           '{}'::jsonb AS extra
      FROM public.avisos_mitad_compostaje av
      JOIN public.servicios s     ON s.id = av.servicio_id
      JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
      LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id`,

  // Una fila por INTENTO. `resuelto` = ese servicio ya tiene un envío bueno
  // (aunque este intento haya fallado), para no ofrecer relanzar lo ya entregado.
  digitales: `
    SELECT e.id, e.servicio_id, e.enviado_en AS fecha, e.estado, e.error, NULL::int AS intentos,
           m.nombre AS mascota, ${PROPIETARIO} AS destinatario,
           COALESCE(e.telefono, c.whatsapp) AS destino,
           e.message_id AS wamid, NULL::text AS acuse_propio,
           (CASE e.canal WHEN 'WHATSAPP_MANUAL' THEN 'Registro manual' WHEN 'ZOLUTIUM' THEN 'Por Zolutium' ELSE 'Por Meta' END
             || COALESCE(' · ' || e.plantilla, '')
             || COALESCE(' · ' || p.nombre, '')) AS detalle,
           jsonb_build_object('resuelto', EXISTS (
             SELECT 1 FROM public.digitales_envios e2
              WHERE e2.servicio_id = e.servicio_id AND e2.estado = 'ENVIADO' AND e2.id <> e.id)) AS extra
      FROM public.digitales_envios e
      JOIN public.servicios s     ON s.id = e.servicio_id
      JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
      LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      LEFT JOIN public.personal p ON p.id = e.enviado_por`,

  grupales: `
    SELECT e.id, e.servicio_id, e.created_at AS fecha, e.estado, e.error, NULL::int AS intentos,
           i.mascota_nombre AS mascota, i.propietario_nombre AS destinatario,
           COALESCE(e.destino, i.canal_destino) AS destino,
           e.message_id AS wamid, NULL::text AS acuse_propio,
           ('Lote ' || COALESCE(lg.numero_lote, '?')
             || CASE WHEN e.es_reenvio THEN ' · reenvío' ELSE '' END) AS detalle,
           jsonb_build_object('reporte_id', e.reporte_id, 'item_id', e.item_id,
             'resuelto', i.estado IN ('ENVIADO','REENVIADO') AND e.estado <> 'ENVIADO') AS extra
      FROM public.reportes_grupales_envios e
      JOIN public.reportes_grupales_items i ON i.id = e.item_id
      JOIN public.reportes_grupales rg      ON rg.id = e.reporte_id
      LEFT JOIN public.lotes_grupales lg    ON lg.id = rg.lote_id`,
}

/** Los filtros que la pantalla puede pedir, sobre las columnas normalizadas. */
const FILTROS = {
  todos:     'TRUE',
  llego:     "f.acuse IN ('delivered','read')",
  enviado:   "f.estado = 'ENVIADO'",
  // GHL dejaba `pending`/`queued` en el acuse propio: tampoco dicen que llegó.
  sin_acuse: "f.estado = 'ENVIADO' AND (f.acuse IS NULL OR f.acuse NOT IN ('delivered','read','failed'))",
  error:     "f.estado = 'ERROR' OR f.acuse = 'failed'",
  pendiente: "f.estado IN ('PENDIENTE','ENVIANDO')",
}

/**
 * Lista los contactos de un flujo con el acuse de Meta cruzado.
 *
 * @param clave   flujo del catálogo
 * @param estado  llave de FILTROS
 * @param q       texto libre: mascota, dueño/clínica o número
 * @param dias    ventana hacia atrás (0 = todo el histórico)
 */
export async function listarEnvios({ clave, estado = 'todos', q = null, dias = 30 }) {
  const fuente = FUENTES[clave]
  if (!fuente) return { status: 404, body: { ok: false, error: 'flujo_desconocido' } }
  const filtro = FILTROS[estado] || FILTROS.todos
  const ventana = Math.max(0, Math.min(parseInt(dias) || 0, 3650))
  const texto = String(q || '').trim().slice(0, 80) || null

  // El acuse del webhook manda; `acuse_propio` (imágenes consulta a los 5 s)
  // es el respaldo cuando el mensaje salió por un transporte sin bandeja.
  const base = `
    WITH x AS (${fuente}),
    f AS (
      SELECT x.*,
             COALESCE(wm.estado, x.acuse_propio) AS acuse,
             wm.estado_en AS acuse_en,
             wm.error     AS acuse_error
        FROM x
        LEFT JOIN public.whatsapp_mensajes wm
               ON x.wamid IS NOT NULL AND wm.wa_message_id = x.wamid
       WHERE ($1::int = 0 OR x.fecha >= now() - make_interval(days => $1::int))
         AND ($2::text IS NULL
              OR x.mascota ILIKE '%' || $2 || '%'
              OR x.destinatario ILIKE '%' || $2 || '%'
              OR x.destino ILIKE '%' || $2 || '%')
    )`

  const client = await pool.connect()
  try {
    // Conteos de la ventana completa (sin el filtro de estado ni el LIMIT):
    // son los números de las pestañas y tienen que cuadrar con lo que se ve.
    const { rows: [conteos] } = await client.query(`${base}
      SELECT count(*)::int AS todos,
             count(*) FILTER (WHERE ${FILTROS.llego})::int     AS llego,
             count(*) FILTER (WHERE ${FILTROS.enviado})::int   AS enviado,
             count(*) FILTER (WHERE ${FILTROS.sin_acuse})::int AS sin_acuse,
             count(*) FILTER (WHERE ${FILTROS.error})::int     AS error,
             count(*) FILTER (WHERE ${FILTROS.pendiente})::int AS pendiente
        FROM f`, [ventana, texto])

    const { rows } = await client.query(`${base}
      SELECT f.id, f.servicio_id, f.fecha, f.estado, f.error, f.intentos,
             f.mascota, f.destinatario, f.destino, f.wamid, f.detalle, f.extra,
             f.acuse, f.acuse_en, f.acuse_error
        FROM f
       WHERE ${filtro}
       ORDER BY f.fecha DESC NULLS LAST
       LIMIT ${TOPE_FILAS}`, [ventana, texto])

    // El error que importa es el último que pasó: si Meta dijo `failed` después
    // de que el flujo marcara ENVIADO, manda el motivo del acuse.
    const filas = rows.map(r => ({
      ...r, ...relanzable(clave, r),
      explicacion: explicarErrorWa(r.acuse === 'failed' && r.acuse_error ? r.acuse_error : (r.error || r.acuse_error)),
    }))
    return { status: 200, body: { ok: true, filas, conteos, tope: TOPE_FILAS, dias: ventana } }
  } finally {
    client.release()
  }
}

/**
 * ¿Se puede relanzar esta fila desde aquí, y si no, por qué?
 * La regla de fondo: nunca duplicar un mensaje que sí llegó.
 */
function relanzable(clave, r) {
  const no = motivo => ({ relanzable: false, no_relanzable: motivo })
  if (clave === 'aviso_cliente') return no('Lo manda una persona por wa.me')
  if (r.estado === 'CANCELADO')  return no('Cancelado')
  if (r.acuse === 'failed')      return { relanzable: true }
  if (r.estado === 'ENVIADO') {
    return no(r.acuse === 'delivered' || r.acuse === 'read' ? 'Ya le llegó'
            : r.wamid ? 'Enviado, esperando acuse' : 'Enviado sin acuse')
  }
  if (r.extra?.resuelto) return no('Ya tiene un envío bueno')
  if (r.estado === 'ENVIANDO') {
    const hace = Date.now() - new Date(r.extra?.updated_at || r.fecha).getTime()
    return hace > 60 * 60 * 1000 ? { relanzable: true } : no('En curso')
  }
  return { relanzable: true }   // ERROR o PENDIENTE
}

// ─────────────────────────────────────────────────────────────────────────────
// Relanzar
// ─────────────────────────────────────────────────────────────────────────────

const MOTIVOS = {
  apagado:        'El flujo está apagado: enciéndelo primero.',
  sin_plantilla:  'No hay plantilla aprobada configurada para este flujo.',
  sin_whatsapp:   'No hay un WhatsApp válido para este contacto.',
  ya_enviado:     'Ya se había enviado.',
  ya_eligio:      'La familia ya eligió su planta.',
  ya_contactado:  'Este contacto ya se envió o está en curso.',
  cancelada:      'La elección está cancelada.',
  cancelado:      'El aviso está cancelado.',
  sin_linea:      'La línea de veterinarias no está configurada.',
  sin_hora:       'La recogida no tiene hora programada.',
  no_es_clinica:  'La recogida no es en una clínica aliada.',
  sin_recogida:   'El servicio no tiene recogida.',
  error_envio:    'Meta rechazó el envío.',
  error_interno:  'Error interno al enviar.',
}

/**
 * Relanza UN contacto reutilizando la función de envío de su flujo.
 * `personal` = { id, rol } de quien pulsa el botón.
 */
export async function relanzarEnvio({ clave, id, personal }) {
  if (!FUENTES[clave]) return { status: 404, body: { ok: false, error: 'flujo_desconocido' } }
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { status: 400, body: { ok: false, error: 'id inválido' } }

  // La fila tal como la ve la lista, para aplicar la MISMA regla de relanzable.
  const { rows } = await pool.query(`
    WITH x AS (${FUENTES[clave]})
    SELECT x.*, COALESCE(wm.estado, x.acuse_propio) AS acuse
      FROM x LEFT JOIN public.whatsapp_mensajes wm
        ON x.wamid IS NOT NULL AND wm.wa_message_id = x.wamid
     WHERE x.id = $1`, [id])
  const fila = rows[0]
  if (!fila) return { status: 404, body: { ok: false, error: 'No se encontró el contacto' } }
  const regla = relanzable(clave, fila)
  if (!regla.relanzable) return { status: 409, body: { ok: false, error: regla.no_relanzable } }

  log('[automatizaciones] relanzar', clave, id, 'por', personal?.id, `(estado=${fila.estado}, acuse=${fila.acuse || '-'})`)
  const r = await RELANZAR[clave](fila, personal)
  if (r.ok) log('[automatizaciones] relanzado OK', clave, id)
  else      log('[automatizaciones] relanzar FALLÓ', clave, id, '—', r.error)
  // El texto crudo va en `explicacion.tecnico`; `error` es lo que se enseña.
  const explicacion = r.ok ? null : explicarErrorWa(r.error)
  return {
    status: r.ok ? 200 : (r.status || 409),
    body: r.ok ? r : { ...r, error: explicacion?.titulo || r.error, explicacion },
  }
}

/** Traduce el `{enviado, motivo, error}` de plantas/mitad/vet a `{ok, error}`. */
function desdeMotivo(r) {
  if (r?.enviado) return { ok: true }
  return { ok: false, error: r?.error || MOTIVOS[r?.motivo] || r?.motivo || 'No se pudo enviar' }
}

/**
 * Un ENVIADO cuyo acuse dice `failed` tiene el candado del flujo cerrado
 * ("ya se envió"). Se destraba devolviendo la fila a ERROR con el motivo de
 * Meta, y la función de envío la retoma como cualquier otro error.
 */
async function destrabar(sql, params) {
  await pool.query(sql, params)
}

const RELANZAR = {
  async imagenes(f, personal) {
    const { solicitud_id, numero } = f.extra || {}
    if (f.estado === 'ENVIANDO' || (f.estado === 'ENVIADO' && f.acuse === 'failed')) {
      await destrabar(`UPDATE public.solicitud_imagenes_contactos
                          SET estado = 'ERROR', ultimo_error = COALESCE(ultimo_error, $2)
                        WHERE id = $1 AND estado IN ('ENVIANDO','ENVIADO')`,
                      [f.id, f.estado === 'ENVIANDO' ? 'Envío interrumpido (quedó en ENVIANDO)' : 'Meta reportó fallo de entrega'])
    }
    const r = await forzarContacto({ solicitudId: solicitud_id, numero, personalId: personal.id })
    return r.body?.ok ? { ok: true } : { ok: false, status: r.status, error: r.body?.error }
  },

  async aviso_vet(f, personal) {
    if (f.estado === 'ENVIADO' && f.acuse === 'failed') {
      await destrabar(`UPDATE public.recogidas
                          SET aviso_vet_enviado_en = NULL, aviso_vet_error = 'Meta reportó fallo de entrega'
                        WHERE id = $1`, [f.id])
    }
    return desdeMotivo(await avisarVetRecogida({
      servicioId: f.servicio_id, actor: { id: personal.id, rol: personal.rol },
    }))
  },

  async plantas(f, personal) {
    if (f.estado === 'ENVIADO' && f.acuse === 'failed') {
      await destrabar(`UPDATE public.planta_elecciones SET estado = 'ERROR', error = 'Meta reportó fallo de entrega'
                        WHERE id = $1 AND estado = 'ENVIADO'`, [f.id])
    }
    return desdeMotivo(await enviarAvisoPlanta({ eleccionId: f.id, personalId: personal.id }))
  },

  async mitad_compostaje(f, personal) {
    if (f.estado === 'ENVIADO' && f.acuse === 'failed') {
      await destrabar(`UPDATE public.avisos_mitad_compostaje SET estado = 'ERROR', error = 'Meta reportó fallo de entrega'
                        WHERE id = $1 AND estado = 'ENVIADO'`, [f.id])
    }
    return desdeMotivo(await enviarAvisoMitad({ avisoId: f.id, personalId: personal.id }))
  },

  async digitales(f, personal) {
    if (f.estado === 'ENVIADO' && f.acuse === 'failed') {
      // Sin esto `enviarAutomatico` ve "ya hay un envío exitoso" y se niega.
      await destrabar(`UPDATE public.digitales_envios SET estado = 'ERROR', error = 'Meta reportó fallo de entrega'
                        WHERE id = $1 AND estado = 'ENVIADO'`, [f.id])
    }
    const r = await enviarAutomatico({ servicioId: f.servicio_id, personalId: personal.id })
    return r.status === 200 ? { ok: true } : { ok: false, status: r.status, error: r.body?.error || 'No se pudo enviar' }
  },

  async grupales(f, personal) {
    const { reporte_id, item_id } = f.extra || {}
    const r = await enviarReporte({
      reporteId: reporte_id, personalId: personal.id,
      body: { items: [item_id], reenvio: true, motivo: 'Relanzado desde Automatizaciones' },
    })
    if (r.status !== 200) return { ok: false, status: r.status, error: r.body?.error || 'No se pudo enviar' }
    const res = r.body?.resumen || r.body || {}
    if (res.enviados > 0) return { ok: true }
    const detalle = res.errores?.[0]?.error || res.errores?.[0]?.motivo
                 || res.omitidos?.[0]?.motivo || 'No se envió'
    return { ok: false, error: detalle }
  },
}
