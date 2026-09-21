// Módulo de Ofertas — cliente frontend.
//
// LECTURA y CRUD del catálogo: directo a Supabase (PostgREST, personal
// autenticado). Es configuración, no dinero.
//
// La VENTA (cuando el cliente acepta la oferta en el portal de fotos) NO pasa
// por aquí: la ejecuta orbit-backend dentro de la transacción de recepción de
// imágenes, con el precio leído de la tabla `ofertas`. Ver ofertas.js del
// backend y migración 078.
import { db, dbIn, dbTodo } from '@/lib/supabase'
import { compressImage, sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'

export const BUCKET_OFERTAS = 'ofertas'
export const MAX_MB_OFERTA  = 5

/** Ofertas con su recordatorio, sus planes, sus vistas y el conteo de respuestas. */
export async function listarOfertas() {
  const [{ data: ofertas, error }, { data: vinculos }, { data: respuestas }, { data: vistas }] = await Promise.all([
    db.from('ofertas')
      .select('*, recordatorios(id, nombre, categoria, precio_base, requiere_imagen, solo_nombre, max_fotos, campos_texto, activo)')
      .order('orden').order('created_at'),
    db.from('oferta_planes').select('oferta_id, plan_id, planes(id, nombre, codigo)'),
    db.from('oferta_respuestas').select('oferta_id, respuesta'),
    // Migración 081. Si el backend aún no la tiene, `error` viene y `data` null:
    // el módulo sigue funcionando con las vistas en 0 en vez de romperse.
    db.from('oferta_vistas').select('oferta_id, vistas'),
  ])
  if (error) throw error

  const planesPorOferta = {}
  for (const v of vinculos || []) (planesPorOferta[v.oferta_id] ||= []).push(v)

  const statsPorOferta = {}
  const stat = id => (statsPorOferta[id] ||= { aceptadas: 0, rechazadas: 0, vistas: 0, aperturas: 0 })
  for (const r of respuestas || []) {
    const s = stat(r.oferta_id)
    if (r.respuesta === 'ACEPTADA') s.aceptadas++
    else s.rechazadas++
  }
  // Cada FILA es un servicio distinto al que le llegó el anuncio; `vistas` son
  // las aperturas de ese servicio (el cliente puede recargar el portal).
  for (const v of vistas || []) {
    const s = stat(v.oferta_id)
    s.vistas++
    s.aperturas += Number(v.vistas) || 1
  }

  return (ofertas || []).map(o => ({
    ...o,
    planes: (planesPorOferta[o.id] || []).map(v => v.planes).filter(Boolean),
    plan_ids: (planesPorOferta[o.id] || []).map(v => v.plan_id),
    stats: statsPorOferta[o.id] || { aceptadas: 0, rechazadas: 0, vistas: 0, aperturas: 0 },
  }))
}

/**
 * Crea o actualiza una oferta y sincroniza sus planes.
 * `planIds` reemplaza por completo la lista anterior.
 */
export async function guardarOferta({ id, campos, planIds }) {
  const body = {
    titulo:              String(campos.titulo || '').trim(),
    descripcion:         campos.descripcion?.trim() || null,
    imagen_url:          campos.imagen_url || null,
    recordatorio_id:     campos.recordatorio_id,
    precio_oferta:       Number(campos.precio_oferta) || 0,
    precio_lista:        campos.precio_lista === '' || campos.precio_lista == null ? null : Number(campos.precio_lista),
    orden:               parseInt(campos.orden) || 100,
    aplica_todos_planes: !!campos.aplica_todos_planes,
    vigencia_desde:      campos.vigencia_desde || null,
    vigencia_hasta:      campos.vigencia_hasta || null,
    activo:              campos.activo !== false,
  }

  let ofertaId = id
  if (id) {
    const { error } = await db.from('ofertas').update(body).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await db.from('ofertas').insert(body).select('id').single()
    if (error) throw error
    ofertaId = data.id
  }

  // Los planes se reemplazan enteros: es una lista corta y así no quedan
  // vínculos huérfanos si se desmarca uno.
  const { error: delErr } = await db.from('oferta_planes').delete().eq('oferta_id', ofertaId)
  if (delErr) throw delErr
  const ids = [...new Set((planIds || []).filter(Boolean))]
  if (!body.aplica_todos_planes && ids.length) {
    const { error: insErr } = await db.from('oferta_planes')
      .insert(ids.map(plan_id => ({ oferta_id: ofertaId, plan_id })))
    if (insErr) throw insErr
  }
  return ofertaId
}

/**
 * Borra la oferta. Si ya tiene respuestas de clientes la FK lo impide (23503):
 * quien llama debe ofrecer desactivarla en su lugar — el histórico de qué se le
 * ofreció a cada cliente no se tira a la basura.
 */
export async function eliminarOferta(id) {
  const { error } = await db.from('ofertas').delete().eq('id', id)
  if (error) throw error
}

export async function desactivarOferta(id) {
  const { error } = await db.from('ofertas').update({ activo: false }).eq('id', id)
  if (error) throw error
}

/** Sube la foto del anuncio al bucket público `ofertas` y devuelve su URL. */
export async function subirImagenOferta(file) {
  const mime = await sniffMime(file)
  if (!MIMES_IMAGEN_OK.includes(mime))
    throw new Error('Ese archivo no es una imagen válida. Usa JPG, PNG o WEBP.')
  // Se recomprime para que el portal cargue rápido en el celular del cliente.
  const blob = await compressImage(file, 1400, 0.85)
  if (blob.size > MAX_MB_OFERTA * 1024 * 1024)
    throw new Error(`La imagen supera ${MAX_MB_OFERTA} MB. Usa una más liviana.`)
  const ext  = extDeMime(blob.type === 'image/jpeg' ? 'image/jpeg' : mime)
  const path = `anuncios/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from(BUCKET_OFERTAS)
    .upload(path, blob, { upsert: false, contentType: blob.type || mime })
  if (error) {
    console.error('[ofertas] upload falló:', error?.message || error, { path })
    throw new Error('No se pudo subir la imagen. Revisa la conexión e intenta de nuevo.')
  }
  const { data: { publicUrl } } = db.storage.from(BUCKET_OFERTAS).getPublicUrl(path)
  return publicUrl
}

/** Detalle de quién aceptó y quién rechazó una oferta. */
export async function respuestasDeOferta(ofertaId) {
  const { data, error } = await db.from('oferta_respuestas')
    .select(`
      id, respuesta, precio_ofrecido, respondido_en, servicio_id,
      servicios ( id, fecha_ingreso, mascotas ( nombre, clientes ( nombre, apellido ) ) )
    `)
    .eq('oferta_id', ofertaId)
    .order('respondido_en', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Todo lo necesario para ANALIZAR las ofertas: una fila por (servicio, oferta)
 * que llegó al cliente, con su estado.
 *
 * 🔑 El universo son las VISTAS, no las respuestas. Quien vio el anuncio y no
 * contestó es el grupo que más dice —hoy son 223 servicios— y si la lista
 * saliera de `oferta_respuestas` sería invisible: parecería que todo el mundo
 * contestó y la conversión se leería sobre la mitad del público real.
 *
 * 🪤 `dbTodo` y no un select suelto: los alcanzados ya pasan de 1.000 y el
 * servidor corta ahí sin avisar. Con un select normal el análisis mostraría
 * 1.000 filas como si fueran todas, y los totales de abajo mentirían.
 *
 * Estados: ACEPTADA · RECHAZADA · SIN_RESPONDER
 */
export async function analisisOfertas() {
  const [vistas, respuestas] = await Promise.all([
    dbTodo(() => db.from('oferta_vistas')
      .select('oferta_id, servicio_id, vistas, primera_vista_en, ultima_vista_en')
      .order('primera_vista_en', { ascending: false }).order('id', { ascending: false })),
    dbTodo(() => db.from('oferta_respuestas')
      .select('oferta_id, servicio_id, respuesta, precio_ofrecido, respondido_en')
      .order('respondido_en', { ascending: false }).order('id', { ascending: false })),
  ])

  const clave = r => `${r.servicio_id}|${r.oferta_id}`
  const respPorClave = new Map((respuestas || []).map(r => [clave(r), r]))

  // El universo es la UNIÓN: normalmente toda respuesta tiene su vista (las
  // vistas se sembraron con las respuestas previas en la migración 081), pero
  // si alguna faltara no se puede perder una venta del análisis.
  const filas = new Map()
  for (const v of vistas || []) filas.set(clave(v), { ...v, respuesta: null })
  for (const r of respuestas || []) {
    const k = clave(r)
    if (!filas.has(k)) filas.set(k, { oferta_id: r.oferta_id, servicio_id: r.servicio_id, vistas: 0 })
  }

  const ids = [...new Set([...filas.values()].map(f => f.servicio_id))]
  const svcs = await dbIn('servicios',
    'id, fecha_ingreso, plan_id, valor_total, mascotas:mascota_id(nombre, clientes:cliente_id(nombre, apellido, whatsapp, telefono))',
    'id', ids)
  const svcPorId = Object.fromEntries(svcs.map(s => [s.id, s]))

  return [...filas.entries()].map(([k, f]) => {
    const r = respPorClave.get(k) || null
    const s = svcPorId[f.servicio_id] || null
    const c = s?.mascotas?.clientes || null
    return {
      clave: k,
      oferta_id:   f.oferta_id,
      servicio_id: f.servicio_id,
      estado:      r ? r.respuesta : 'SIN_RESPONDER',
      precio:      r?.precio_ofrecido ?? null,
      respondido_en:    r?.respondido_en ?? null,
      primera_vista_en: f.primera_vista_en ?? null,
      aperturas:   Number(f.vistas) || 0,
      fecha_ingreso: s?.fecha_ingreso ?? null,
      plan_id:     s?.plan_id ?? null,
      mascota:     s?.mascotas?.nombre || '—',
      cliente:     c ? `${c.nombre || ''} ${c.apellido || ''}`.trim() : '—',
      // Para el botón de WhatsApp: se escribe por wa.me porque lo que sigue a
      // un "no, gracias" lo dice una persona, no una automatización.
      telefono:    c?.whatsapp || c?.telefono || null,
    }
  })
}
