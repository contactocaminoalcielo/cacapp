// Cliente del catálogo público de recordatorios (orbit-backend, migr. 200).
// Endpoints públicos sin JWT, mismo origen que los otros portales
// (orbit.orbitacac.com/api → nginx → backend).
import { db } from '@/lib/supabase'
import { compressImage, sniffMime, extDeMime, MIMES_IMAGEN_OK } from '@/lib/imageUtils'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'
const MAX_MB = 8

async function llamar(path, body) {
  const res = await fetch(`${API_BASE}${path}`, body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

export const catalogoVer      = ()      => llamar('/portal/catalogo')
export const catalogoBorrador = ()      => llamar('/portal/catalogo/borrador', {})
export const catalogoComprar  = payload => llamar('/portal/catalogo/compra', payload)

/**
 * Sube un archivo a la carpeta del borrador y devuelve su URL pública. Solo se
 * puede subir ahí mientras el borrador esté vivo (política de la migr. 200).
 * Las fotos se re-encodan (sanitiza y aliviana); un PDF solo vale para el
 * comprobante y va tal cual.
 */
export async function subirArchivoCompra(borrador, file, { permitirPdf = false } = {}) {
  const mime = await sniffMime(file)
  const esPdf = mime === 'application/pdf' || file.type === 'application/pdf'
  if (!MIMES_IMAGEN_OK.includes(mime) && !(permitirPdf && esPdf)) {
    throw new Error(permitirPdf
      ? 'Ese archivo no es una foto ni un PDF. Usa una imagen (JPG, PNG) o un PDF.'
      : 'Ese archivo no es una foto válida. Usa una imagen (JPG, PNG, WEBP o HEIC).')
  }
  const blob = esPdf ? file : await compressImage(file)
  if (blob.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo supera ${MAX_MB} MB. Intenta con otro.`)
  const ext  = esPdf ? 'pdf' : extDeMime(blob.type === 'image/jpeg' ? 'image/jpeg' : mime)
  const path = `compra-web/${borrador}/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('fotos-clientes')
    .upload(path, blob, { upsert: false, contentType: esPdf ? 'application/pdf' : (blob.type || mime) })
  if (error) {
    console.error('[catalogo] upload falló:', error?.message || error, { path })
    throw new Error('No se pudo subir el archivo. Revisa tu conexión e intenta de nuevo.')
  }
  return db.storage.from('fotos-clientes').getPublicUrl(path).data.publicUrl
}
