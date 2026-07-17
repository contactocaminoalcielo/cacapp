// Tipos de imagen que aceptamos en cualquier subida (portal y personal interno).
export const MIMES_IMAGEN_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

// Detecta el tipo real por los magic bytes, no por la extensión ni por file.type
// (los dos los pone quien sube y se pueden mentir).
export async function sniffMime(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const hex = [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hex.startsWith('ffd8ff'))     return 'image/jpeg'
    if (hex.startsWith('89504e47'))   return 'image/png'
    if (hex.startsWith('52494646') && hex.substr(16, 8) === '57454250') return 'image/webp'
    const ascii = String.fromCharCode(...buf)
    if (ascii.substr(4, 4) === 'ftyp') {
      const brand = ascii.substr(8, 4)
      if (['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
    }
    return file.type || 'application/octet-stream'
  } catch { return file.type || 'application/octet-stream' }
}

// Extensión de archivo a partir del tipo real (para la ruta en el bucket).
export function extDeMime(mime) {
  return mime === 'image/jpeg' ? 'jpg'
       : mime === 'image/png'  ? 'png'
       : mime === 'image/webp' ? 'webp'
       : 'heic'
}

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
