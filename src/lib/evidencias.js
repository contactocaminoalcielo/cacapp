// Subida de evidencias Tenjo.
// TRANSICIONAL: usa el bucket 'evidencias' del Storage actual. Toda la app
// pasa por esta función, así que migrar a almacenamiento propio en Contabo
// será cambiar solo este archivo.
import { db } from '@/lib/supabase'
import { compressImage } from '@/lib/imageUtils'

export async function subirEvidencia(file, itemId) {
  const compressed = await compressImage(file)
  const path = `tenjo/${itemId}/${Date.now()}.jpg`
  const { error } = await db.storage.from('evidencias').upload(path, compressed, {
    cacheControl: '3600', upsert: false, contentType: 'image/jpeg',
  })
  if (error) throw new Error(error.message)
  const { data } = db.storage.from('evidencias').getPublicUrl(path)
  return data.publicUrl
}
