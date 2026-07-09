import { db } from '@/lib/supabase'

// Comprobantes de pago de un servicio desde sus DOS fuentes (divergen): la
// tabla `recibo_comprobantes` y el jsonb `recibos_tecnico.medios_pago[]
// .comprobanteUrl` — la inserción en la tabla es best-effort y a veces solo
// quedó el jsonb. Las publicUrl viejas apuntan al Supabase Cloud muerto, por
// eso SIEMPRE se deriva el storage_path y se firma contra el storage
// self-hosted. Misma lógica probada del ComprobanteModal de Finanzas
// (buscar por servicio_id: un servicio puede tener varios recibos y el
// comprobante suele quedar bajo un recibo_id distinto).
export async function cargarComprobantesServicio(servicioId) {
  if (!servicioId) return []
  const out = []
  const rutasVistas = new Set()   // storage_path ya incluidos (deduplicar)

  const { data: comps, error } = await db.from('recibo_comprobantes')
    .select('id, recibo_id, bucket, storage_path, mime_type, estado')
    .eq('servicio_id', servicioId)
  if (error) throw error
  for (const c of comps || []) {
    const { data: signed } = await db.storage
      .from(c.bucket || 'evidencias').createSignedUrl(c.storage_path, 300)
    if (signed?.signedUrl) {
      out.push({ ...c, url: signed.signedUrl })
      if (c.storage_path) rutasVistas.add(c.storage_path)
    }
  }

  const { data: recs } = await db.from('recibos_tecnico')
    .select('id, medios_pago').eq('servicio_id', servicioId)
  for (const r of recs || []) {
    for (const mp of (Array.isArray(r.medios_pago) ? r.medios_pago : [])) {
      const publicUrl = mp?.comprobanteUrl
      if (!publicUrl) continue
      const ruta = publicUrl.split('/evidencias/')[1]
        ? decodeURIComponent(publicUrl.split('/evidencias/')[1])   // storage_path implícito
        : null
      if (ruta && rutasVistas.has(ruta)) continue
      if (ruta) rutasVistas.add(ruta)
      // Firmar la ruta (sirve con bucket público o privado); si no se pudo
      // derivar, usar la publicUrl tal cual como último recurso.
      let url = publicUrl
      if (ruta) {
        const { data: signed } = await db.storage.from('evidencias').createSignedUrl(ruta, 300)
        if (signed?.signedUrl) url = signed.signedUrl
      }
      out.push({
        id: publicUrl, recibo_id: r.id, url,
        storage_path: ruta || publicUrl,
        mime_type: mp.mime_type || null,
        estado: null, metodo: mp.metodo || null,
      })
    }
  }
  return out
}
