// Importador operativo (no expuesto por HTTP) para una sola línea de Zolutium.
//
// Fases:
//   capturar   — recorre ventanas reanudables y guarda SOLO from/to de la línea.
//   contactos  — completa los nombres de los contactos seleccionados.
//   adjuntos   — descarga, de forma reanudable, solo archivos seleccionados.
//   plantillas — guarda todas las plantillas WhatsApp de la ubicación.
//   estado     — muestra únicamente conteos y progreso.
//   publicar   — pasa la captura a la bandeja cuando ya existe phone_number_id de Meta.

import crypto from 'node:crypto'
import { pool } from '../src/db.js'

const BASE = 'https://services.leadconnectorhq.com'
const TOKEN = process.env.ZOLUTIUM_IMPORT_TOKEN || ''
const LOCATION = process.env.ZOLUTIUM_IMPORT_LOCATION_ID || ''

function argumento(nombre, defecto = null) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : defecto
}

function telefono(valor) {
  return String(valor || '').replace(/\D/g, '')
}

const ACCION = process.argv[2] || 'estado'
const LINEA = telefono(argumento('linea', process.env.ZOLUTIUM_IMPORT_PHONE || ''))
const DIAS = Math.max(1, Math.min(7, Number(argumento('dias', '1')) || 1))
const MAX_VENTANAS = Math.max(0, Number(argumento('max-ventanas', '0')) || 0)
const MAX_ITEMS = Math.max(0, Number(argumento('max-items', '0')) || 0)
const MAX_ARCHIVO = 64 * 1024 * 1024

function obligatorio() {
  if (!TOKEN || !LOCATION) throw new Error('Faltan ZOLUTIUM_IMPORT_TOKEN/ZOLUTIUM_IMPORT_LOCATION_ID')
  if (!/^\d{8,15}$/.test(LINEA)) throw new Error('Falta --linea con indicativo de país (solo dígitos)')
}

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms))

async function enParalelo(items, concurrencia, tarea) {
  let siguiente = 0
  const trabajadores = Array.from(
    { length: Math.min(concurrencia, items.length) },
    async () => {
      while (true) {
        const i = siguiente++
        if (i >= items.length) return
        await tarea(items[i], i)
      }
    },
  )
  await Promise.all(trabajadores)
}

async function ghl(path, params = {}, intento = 1) {
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) url.searchParams.set(k, v)
  try {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Version: 'v3',
        Accept: 'application/json',
        'User-Agent': 'Orbit-History-Migrator/1.0',
      },
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) {
      if (intento < 4 && [401, 408, 429, 500, 502, 503, 504].includes(r.status)) {
        await dormir(intento * 2_000)
        return ghl(path, params, intento + 1)
      }
      throw new Error(`GHL ${r.status} en ${url.pathname}`)
    }
    return r.json()
  } catch (e) {
    if (intento < 4 && (e.name === 'TimeoutError' || e.name === 'AbortError' || /fetch failed/i.test(e.message))) {
      await dormir(intento * 2_000)
      return ghl(path, params, intento + 1)
    }
    throw e
  }
}

async function lote() {
  const { rows: [r] } = await pool.query(
    `INSERT INTO public.whatsapp_importaciones (location_id, linea_origen)
     VALUES ($1,$2)
     ON CONFLICT (proveedor, location_id, linea_origen) DO UPDATE
       SET actualizado_en = now()
     RETURNING *`, [LOCATION, LINEA]
  )
  return r
}

function fecha(valor, defecto) {
  const d = valor ? new Date(valor) : defecto
  if (!d || Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${valor}`)
  return d
}

async function borde(orden) {
  const data = await ghl('/conversations/messages/export', {
    locationId: LOCATION, channel: 'WhatsApp', limit: 10,
    sortBy: 'createdAt', sortOrder: orden,
  })
  const m = (data.messages || [])[0]
  return m?.dateAdded ? new Date(m.dateAdded) : null
}

async function crearVentanas(importacion) {
  // Reanudar debe conservar EXACTAMENTE los límites originales. Si cada
  // ejecución usara un `hasta=now()` nuevo, crearía ventanas solapadas y el
  // progreso dejaría de significar algo.
  const yaTieneRango = importacion.desde && importacion.hasta
  const desde = yaTieneRango
    ? new Date(importacion.desde)
    : fecha(argumento('desde'), await borde('asc'))
  const hasta = yaTieneRango
    ? new Date(importacion.hasta)
    : fecha(argumento('hasta'), new Date())
  if (!desde || hasta <= desde) throw new Error('El rango de captura está vacío')
  const paso = DIAS * 86_400_000
  for (let t = desde.getTime(); t < hasta.getTime(); t += paso) {
    const a = new Date(t)
    const b = new Date(Math.min(t + paso, hasta.getTime()))
    await pool.query(
      `INSERT INTO public.whatsapp_import_ventanas (importacion_id, desde, hasta)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [importacion.id, a, b]
    )
  }
  await pool.query(
    `UPDATE public.whatsapp_importaciones
        SET desde=$2, hasta=$3, estado='CAPTURANDO', error=NULL, actualizado_en=now()
      WHERE id=$1`, [importacion.id, desde, hasta]
  )
}

function direccion(m) {
  return String(m.direction || '').toLowerCase() === 'inbound' ? 'IN'
    : String(m.direction || '').toLowerCase() === 'outbound' ? 'OUT' : null
}

function lineaDe(m) {
  return direccion(m) === 'IN' ? telefono(m.to) : direccion(m) === 'OUT' ? telefono(m.from) : ''
}

function contactoDe(m) {
  return direccion(m) === 'IN' ? telefono(m.from) : direccion(m) === 'OUT' ? telefono(m.to) : ''
}

function tipoDe(m) {
  const content = String(m.contentType || '').toLowerCase()
  if (content.startsWith('image/')) return 'image'
  if (content.startsWith('audio/')) return 'audio'
  if (content.startsWith('video/')) return 'video'
  if ((m.attachments || []).length) return 'document'
  return 'text'
}

function textoDe(m, tipo) {
  const body = String(m.body || '').trim()
  if (body) return body
  return tipo === 'image' ? '[imagen]' : tipo === 'audio' ? '[audio]'
    : tipo === 'video' ? '[video]' : tipo === 'document' ? '[documento]' : ''
}

async function guardarPagina(importacionId, mensajes) {
  const elegidos = mensajes.filter(m => lineaDe(m) === LINEA && direccion(m) && contactoDe(m))
  if (!elegidos.length) return { elegidos: 0, providers: [] }
  const filasSinDepurar = elegidos.map(m => {
    const tipo = tipoDe(m)
    return {
      external_id: String(m.id || m.altId || crypto.randomUUID()),
      alt_id: m.altId ? String(m.altId) : null,
      conversation_id: m.conversationId ? String(m.conversationId) : null,
      contact_id: m.contactId ? String(m.contactId) : null,
      provider_id: m.conversationProviderId ? String(m.conversationProviderId) : null,
      contacto: contactoDe(m), direccion: direccion(m), tipo,
      texto: textoDe(m, tipo), estado: m.status ? String(m.status) : null,
      ocurrido_en: m.dateAdded || new Date().toISOString(),
      attachment_urls: Array.isArray(m.attachments) ? m.attachments : [],
      payload: { origen: 'ZOLUTIUM', mensaje: m },
    }
  })
  // HighLevel puede repetir un mismo mensaje dentro de la misma página.
  // PostgreSQL no permite actualizar dos veces la misma clave en un INSERT,
  // así que conservamos la última representación de cada mensaje.
  const filas = [...new Map(filasSinDepurar.map(f => [f.external_id, f])).values()]
  await pool.query(
    `INSERT INTO public.whatsapp_import_mensajes
       (importacion_id, external_id, alt_id, conversation_id, contact_id, provider_id,
        contacto, direccion, tipo, texto, estado, ocurrido_en, attachment_urls, payload)
     SELECT $1, x.external_id, x.alt_id, x.conversation_id, x.contact_id, x.provider_id,
            x.contacto, x.direccion, x.tipo, x.texto, x.estado, x.ocurrido_en::timestamptz,
            x.attachment_urls, x.payload
       FROM jsonb_to_recordset($2::jsonb) AS x(
         external_id text, alt_id text, conversation_id text, contact_id text, provider_id text,
         contacto text, direccion text, tipo text, texto text, estado text, ocurrido_en text,
         attachment_urls jsonb, payload jsonb)
     ON CONFLICT (importacion_id, external_id) DO UPDATE SET
       alt_id=EXCLUDED.alt_id, estado=EXCLUDED.estado, texto=EXCLUDED.texto,
       attachment_urls=EXCLUDED.attachment_urls, payload=EXCLUDED.payload`,
    [importacionId, JSON.stringify(filas)]
  )
  return {
    elegidos: filas.length,
    providers: [...new Set(filas.map(x => x.provider_id).filter(Boolean))],
  }
}

async function procesarVentana(importacionId, ventana) {
  await pool.query(
    `UPDATE public.whatsapp_import_ventanas SET estado='PROCESANDO', intentos=intentos+1,
       error=NULL, actualizado_en=now() WHERE importacion_id=$1 AND desde=$2 AND hasta=$3`,
    [importacionId, ventana.desde, ventana.hasta]
  )
  let cursor = null, paginas = 0, vistos = 0, seleccionados = 0
  const providers = new Set()
  try {
    do {
      const data = await ghl('/conversations/messages/export', {
        locationId: LOCATION, channel: 'WhatsApp', limit: 1000,
        sortBy: 'createdAt', sortOrder: 'asc',
        startDate: new Date(ventana.desde).toISOString(),
        endDate: new Date(ventana.hasta).toISOString(), cursor,
      })
      const mensajes = data.messages || []
      vistos += mensajes.length
      const r = await guardarPagina(importacionId, mensajes)
      seleccionados += r.elegidos
      r.providers.forEach(x => providers.add(x))
      paginas++
      cursor = data.nextCursor || null
    } while (cursor)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE public.whatsapp_import_ventanas SET estado='COMPLETA', paginas=$4,
           mensajes_vistos=$5, seleccionados=$6, actualizado_en=now()
         WHERE importacion_id=$1 AND desde=$2 AND hasta=$3`,
        [importacionId, ventana.desde, ventana.hasta, paginas, vistos, seleccionados]
      )
      await client.query(
        `UPDATE public.whatsapp_importaciones SET
           provider_ids=(SELECT ARRAY(SELECT DISTINCT unnest(provider_ids || $2::text[]))),
           actualizado_en=now() WHERE id=$1`, [importacionId, [...providers]]
      )
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
    return { paginas, vistos, seleccionados }
  } catch (e) {
    await pool.query(
      `UPDATE public.whatsapp_import_ventanas SET estado='ERROR', error=$4, actualizado_en=now()
       WHERE importacion_id=$1 AND desde=$2 AND hasta=$3`,
      [importacionId, ventana.desde, ventana.hasta, e.message]
    )
    throw e
  }
}

async function recalcular(importacionId) {
  const { rows: [s] } = await pool.query(
    `SELECT count(*)::bigint mensajes,
            count(DISTINCT conversation_id)::bigint conversaciones,
            count(DISTINCT contacto)::bigint contactos,
            COALESCE(sum(jsonb_array_length(attachment_urls)),0)::bigint adjuntos
       FROM public.whatsapp_import_mensajes WHERE importacion_id=$1`, [importacionId]
  )
  const { rows: [v] } = await pool.query(
    `SELECT COALESCE(sum(mensajes_vistos),0)::bigint vistos,
            count(*) FILTER (WHERE estado <> 'COMPLETA')::integer pendientes
       FROM public.whatsapp_import_ventanas WHERE importacion_id=$1`, [importacionId]
  )
  await pool.query(
    `UPDATE public.whatsapp_importaciones SET mensajes_vistos=$2, mensajes_seleccionados=$3,
       conversaciones=$4, contactos=$5, adjuntos=$6,
       estado=CASE WHEN $7=0 THEN 'CAPTURADA' ELSE 'CAPTURANDO' END,
       actualizado_en=now() WHERE id=$1`,
    [importacionId, v.vistos, s.mensajes, s.conversaciones, s.contactos, s.adjuntos, v.pendientes]
  )
}

async function capturar() {
  obligatorio()
  const l = await lote()
  await crearVentanas(l)
  const { rows } = await pool.query(
    `SELECT * FROM public.whatsapp_import_ventanas
      WHERE importacion_id=$1 AND estado <> 'COMPLETA'
      ORDER BY desde LIMIT $2`, [l.id, MAX_VENTANAS || 1000000]
  )
  for (const [i, v] of rows.entries()) {
    const r = await procesarVentana(l.id, v)
    console.log(`[${i + 1}/${rows.length}] ${new Date(v.desde).toISOString().slice(0,10)}:`, r)
  }
  await recalcular(l.id)
  await estado(l.id)
}

async function plantillas() {
  obligatorio()
  const l = await lote()
  let skip = 0, total = 0
  do {
    const data = await ghl(`/locations/${encodeURIComponent(LOCATION)}/templates`, {
      type: 'whatsapp', originId: LOCATION, deleted: 'false', limit: 100, skip,
    })
    const items = data.templates || []
    for (const p of items) {
      await pool.query(
        `INSERT INTO public.whatsapp_import_plantillas(importacion_id,external_id,nombre,payload)
         VALUES ($1,$2,$3,$4) ON CONFLICT(importacion_id,external_id) DO UPDATE
           SET nombre=EXCLUDED.nombre,payload=EXCLUDED.payload,actualizado_en=now()`,
        [l.id, String(p.id), p.name || null, p]
      )
    }
    total += items.length; skip += items.length
    if (!items.length || skip >= Number(data.totalCount || total)) break
  } while (true)
  await pool.query(
    `UPDATE public.whatsapp_importaciones SET plantillas=$2,actualizado_en=now() WHERE id=$1`,
    [l.id, total]
  )
  console.log({ plantillas: total })
}

async function contactos() {
  obligatorio()
  const l = await lote()
  const { rows } = await pool.query(
    `SELECT DISTINCT m.contact_id
       FROM public.whatsapp_import_mensajes m
       LEFT JOIN public.whatsapp_import_contactos c
         ON c.importacion_id=m.importacion_id AND c.external_id=m.contact_id
      WHERE m.importacion_id=$1 AND m.contact_id IS NOT NULL AND c.external_id IS NULL
      ORDER BY m.contact_id LIMIT $2`, [l.id, MAX_ITEMS || 1000000]
  )
  let guardados = 0, errores = 0
  for (const [i, fila] of rows.entries()) {
    try {
      const data = await ghl(`/contacts/${encodeURIComponent(fila.contact_id)}`)
      const c = data.contact || data
      const nombre = String(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || '').trim() || null
      await pool.query(
        `INSERT INTO public.whatsapp_import_contactos
           (importacion_id,external_id,telefono,nombre,email,payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(importacion_id,external_id) DO UPDATE SET
           telefono=EXCLUDED.telefono,nombre=EXCLUDED.nombre,email=EXCLUDED.email,
           payload=EXCLUDED.payload,actualizado_en=now()`,
        [l.id, fila.contact_id, telefono(c.phone) || null, nombre, c.email || null, c]
      )
      guardados++
    } catch (e) {
      // Un contacto pudo ser eliminado de HighLevel aunque sus mensajes sigan
      // existiendo. Conservamos la referencia y el teléfono ya filtrado del
      // historial para no perder el hilo ni reintentarlo eternamente.
      await pool.query(
        `INSERT INTO public.whatsapp_import_contactos
           (importacion_id,external_id,telefono,payload)
         SELECT $1,$2,min(m.contacto),jsonb_build_object('error',$3::text)
           FROM public.whatsapp_import_mensajes m
          WHERE m.importacion_id=$1 AND m.contact_id=$2
         HAVING count(*) > 0
         ON CONFLICT(importacion_id,external_id) DO UPDATE SET
           telefono=EXCLUDED.telefono,payload=EXCLUDED.payload,actualizado_en=now()`,
        [l.id, fila.contact_id, e.message]
      )
      errores++
      console.error(`[${i + 1}/${rows.length}] contacto no disponible: ${e.message}`)
    }
  }
  console.log({ contactos_guardados: guardados, errores })
}

async function descargarArchivo(url) {
  const intento = async headers => fetch(url, {
    headers: { ...headers, 'User-Agent': 'Orbit-History-Migrator/1.0' },
    redirect: 'follow', signal: AbortSignal.timeout(120_000),
  })
  let r = await intento({})
  // Nunca mandar el token a un CDN ajeno. Solo se reintenta autenticado cuando
  // el propio host es de LeadConnector.
  if ((r.status === 401 || r.status === 403) && /(^|\.)leadconnectorhq\.com$/i.test(new URL(url).hostname)) {
    r = await intento({ Authorization: `Bearer ${TOKEN}` })
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const anunciado = Number(r.headers.get('content-length') || 0)
  if (anunciado > MAX_ARCHIVO) throw new Error(`archivo supera ${MAX_ARCHIVO} bytes`)
  const buffer = Buffer.from(await r.arrayBuffer())
  if (buffer.length > MAX_ARCHIVO) throw new Error(`archivo supera ${MAX_ARCHIVO} bytes`)
  return {
    buffer, mime: r.headers.get('content-type')?.split(';')[0] || null,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

async function adjuntos() {
  obligatorio()
  const l = await lote()
  const { rows } = await pool.query(
    `SELECT m.external_id,(a.ord-1)::integer indice,a.url
       FROM public.whatsapp_import_mensajes m
       CROSS JOIN LATERAL jsonb_array_elements_text(m.attachment_urls)
         WITH ORDINALITY AS a(url,ord)
       LEFT JOIN public.whatsapp_import_adjuntos x
         ON x.importacion_id=m.importacion_id AND x.external_id=m.external_id
        AND x.indice=(a.ord-1)
      WHERE m.importacion_id=$1 AND (x.external_id IS NULL OR x.archivo IS NULL)
      ORDER BY m.ocurrido_en,m.external_id,a.ord LIMIT $2`, [l.id, MAX_ITEMS || 1000000]
  )
  let guardados = 0, errores = 0
  await enParalelo(rows, 16, async (a, i) => {
    try {
      const f = await descargarArchivo(a.url)
      await pool.query(
        `INSERT INTO public.whatsapp_import_adjuntos
           (importacion_id,external_id,indice,url_origen,mime,bytes,sha256,archivo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(importacion_id,external_id,indice) DO UPDATE SET
           mime=EXCLUDED.mime,bytes=EXCLUDED.bytes,sha256=EXCLUDED.sha256,
           archivo=EXCLUDED.archivo,error=NULL,actualizado_en=now()`,
        [l.id, a.external_id, a.indice, a.url, f.mime, f.buffer.length, f.sha256, f.buffer]
      )
      guardados++
    } catch (e) {
      await pool.query(
        `INSERT INTO public.whatsapp_import_adjuntos
           (importacion_id,external_id,indice,url_origen,error)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT(importacion_id,external_id,indice) DO UPDATE SET
           error=EXCLUDED.error,actualizado_en=now()`,
        [l.id, a.external_id, a.indice, a.url, e.message]
      )
      errores++
      console.error(`[${i + 1}/${rows.length}] adjunto no disponible: ${e.message}`)
    }
  })
  console.log({ adjuntos_guardados: guardados, errores })
}

async function estado(id = null) {
  obligatorio()
  const l = id ? { id } : await lote()
  const { rows: [r] } = await pool.query(
    `SELECT i.estado,i.linea_origen,i.desde,i.hasta,i.mensajes_vistos,
            i.mensajes_seleccionados,i.conversaciones,i.contactos,i.adjuntos,i.plantillas,
            count(v.*)::integer ventanas,
            count(v.*) FILTER (WHERE v.estado='COMPLETA')::integer ventanas_completas,
            count(v.*) FILTER (WHERE v.estado='ERROR')::integer ventanas_error
       FROM public.whatsapp_importaciones i
       LEFT JOIN public.whatsapp_import_ventanas v ON v.importacion_id=i.id
      WHERE i.id=$1 GROUP BY i.id`, [l.id]
  )
  console.log(r)
}

async function publicar() {
  obligatorio()
  const destino = String(argumento('phone-number-id', '') || '').trim()
  if (!/^\d+$/.test(destino)) throw new Error('Falta --phone-number-id de Meta')
  const l = await lote()
  if (l.estado !== 'CAPTURADA' && l.estado !== 'COMPLETA') throw new Error('La captura aún no está completa')
  const { rows: [archivos] } = await pool.query(
    `SELECT COALESCE(sum(jsonb_array_length(m.attachment_urls)),0)::bigint esperados,
            count(a.*) FILTER (WHERE a.archivo IS NOT NULL)::bigint guardados,
            count(a.*) FILTER (WHERE a.error IS NOT NULL)::bigint errores
       FROM public.whatsapp_import_mensajes m
       LEFT JOIN public.whatsapp_import_adjuntos a
         ON a.importacion_id=m.importacion_id AND a.external_id=m.external_id
      WHERE m.importacion_id=$1`, [l.id]
  )
  if (Number(archivos.esperados) !== Number(archivos.guardados) + Number(archivos.errores)) {
    throw new Error(`Adjuntos sin procesar: ${archivos.guardados}/${archivos.esperados} guardados, ${archivos.errores} no disponibles`)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`UPDATE public.whatsapp_importaciones SET estado='PUBLICANDO',
      phone_number_id_destino=$2,actualizado_en=now() WHERE id=$1`, [l.id, destino])
    await client.query(
      `INSERT INTO public.whatsapp_mensajes
         (phone_number_id,contacto,direccion,wa_message_id,tipo,texto,payload,estado,estado_en,ocurrido_en)
       SELECT $2,m.contacto,m.direccion,COALESCE(NULLIF(m.alt_id,''),'ghl:'||m.external_id),
              m.tipo,m.texto,m.payload||jsonb_build_object('importacion_id',$1::uuid::text),
              CASE WHEN m.direccion='OUT' THEN m.estado END,
              CASE WHEN m.direccion='OUT' THEN m.ocurrido_en END,m.ocurrido_en
         FROM public.whatsapp_import_mensajes m WHERE m.importacion_id=$1
       ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`, [l.id, destino]
      )
    await client.query(
      `INSERT INTO public.whatsapp_media
         (mensaje_id,wa_media_id,mime,bytes,sha256,archivo,error)
       SELECT w.id,'ghl:'||a.external_id||':'||a.indice,a.mime,a.bytes,a.sha256,a.archivo,a.error
         FROM public.whatsapp_import_adjuntos a
         JOIN public.whatsapp_import_mensajes m
           ON m.importacion_id=a.importacion_id AND m.external_id=a.external_id
         JOIN public.whatsapp_mensajes w
           ON w.wa_message_id=COALESCE(NULLIF(m.alt_id,''),'ghl:'||m.external_id)
        WHERE a.importacion_id=$1 AND a.indice=0
       ON CONFLICT (mensaje_id) DO NOTHING`, [l.id]
    )
    await client.query(
      `UPDATE public.whatsapp_contactos c SET nombre_perfil=COALESCE(NULLIF(x.nombre,''),c.nombre_perfil)
         FROM (SELECT DISTINCT ON (m.contacto) m.contacto,ic.nombre
                 FROM public.whatsapp_import_mensajes m
                 JOIN public.whatsapp_import_contactos ic
                   ON ic.importacion_id=m.importacion_id AND ic.external_id=m.contact_id
                WHERE m.importacion_id=$1 ORDER BY m.contacto,m.ocurrido_en DESC) x
        WHERE c.phone_number_id=$2 AND c.contacto=x.contacto`, [l.id, destino]
    )
    await client.query(
      `UPDATE public.whatsapp_contactos c SET ultimo_leido_en=GREATEST(c.ultimo_leido_en,s.ultimo)
         FROM (SELECT contacto,max(ocurrido_en) ultimo FROM public.whatsapp_import_mensajes
                WHERE importacion_id=$1 GROUP BY contacto) s
        WHERE c.phone_number_id=$2 AND c.contacto=s.contacto`, [l.id, destino]
    )
    await client.query(`UPDATE public.whatsapp_importaciones SET estado='COMPLETA',
      actualizado_en=now() WHERE id=$1`, [l.id])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  await estado(l.id)
}

try {
  if (ACCION === 'capturar') await capturar()
  else if (ACCION === 'contactos') await contactos()
  else if (ACCION === 'adjuntos') await adjuntos()
  else if (ACCION === 'plantillas') await plantillas()
  else if (ACCION === 'publicar') await publicar()
  else if (ACCION === 'estado') await estado()
  else throw new Error(`Acción desconocida: ${ACCION}`)
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
