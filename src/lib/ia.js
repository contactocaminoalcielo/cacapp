// Extracción de datos con IA — la llamada a Claude vive en la Edge Function
// `extraer-datos` (server-side). La key NUNCA viaja al navegador.
import { callEdgeFunction } from '@/lib/supabase'

export async function extraerDesdeTexto(texto) {
  return callEdgeFunction('extraer-datos', { tipo: 'texto', texto })
}

export async function extraerDesdeImagen(file) {
  const imagenBase64 = await comprimirImagen(file)
  return callEdgeFunction('extraer-datos', { tipo: 'imagen', imagenBase64 })
}

// Comprime la imagen a máximo 1280px y calidad 0.82 antes de enviarla a la función
function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1280
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else                { width  = Math.round(width  * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}
