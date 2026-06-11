// Subida de evidencias Tenjo.
// TRANSICIONAL: usa el bucket 'evidencias' del Storage actual. Toda la app
// pasa por esta función, así que migrar a almacenamiento propio en Contabo
// será cambiar solo este archivo.
import { db } from '@/lib/supabase'

export async function subirEvidencia(file, itemId) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = `tenjo/${itemId}/${Date.now()}.${ext}`
  const { error } = await db.storage.from('evidencias').upload(path, file, {
    cacheControl: '3600', upsert: false,
  })
  if (error) throw new Error(error.message)
  const { data } = db.storage.from('evidencias').getPublicUrl(path)
  return data.publicUrl
}
