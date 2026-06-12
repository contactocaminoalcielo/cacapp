// Compresión segura de imágenes para Android Chrome PWA.
// ⚠️ NUNCA usar new Image() ni createImageBitmap sin resizeWidth para imágenes
// de cámara — decodifican a resolución completa (50-108MP = 400MB+ RAM) y
// Chrome Android mata el renderer. Todos los fallbacks devuelven el file
// original en vez de decodificar a full-res.
export async function compressImage(file, maxW = 1200, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file
  try {
    let bitmap = null
    try {
      bitmap = await createImageBitmap(file, { resizeWidth: maxW, resizeQuality: 'medium' })
    } catch (_) {
      // resizeWidth no soportado en este browser/device: subir el JPEG original
      // (ya comprimido por la cámara). Nunca decodificar a full-res — OOM seguro.
      return file
    }
    const scale  = Math.min(1, maxW / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width  = Math.max(1, Math.round(bitmap.width  * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    return blob || file
  } catch (_) {
    return file // jamás bloquear la subida por fallo de compresión
  }
}
