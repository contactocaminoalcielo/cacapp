// Catálogo de materiales de WhatsApp (migración 101).
//
// El brochure, el tarifario y lo que haga falta mandar como archivo. Se cargan
// aquí y el AGENTE los manda por su clave: la descripción de cada uno es lo que
// él lee para decidir cuándo. Salió de una vet pidiendo el brochure el 14-ago,
// que hubo que mandarle a mano por la otra línea.
//
// Los bytes no están expuestos por PostgREST: van y vienen por orbit-backend.
import { orbitApi, orbitApiBlob } from '@/lib/orbitApi'

/** El mismo tope que un documento en la bandeja (whatsapp-media.js). */
export const MAX_BYTES = 16 * 1024 * 1024

/**
 * Lo que WhatsApp muestra como FOTO. Todo lo demás llega como documento —que se
 * abre igual—, pero conviene saberlo antes de subirlo: una foto de iPhone (HEIC)
 * o un WEBP se rechazarían como imagen.
 */
const COMO_IMAGEN = ['image/jpeg', 'image/png']

export function comoLlega(mime) {
  const m = String(mime || '').toLowerCase()
  if (COMO_IMAGEN.includes(m)) return { clase: 'imagen', aviso: null }
  if (m.startsWith('video/')) return { clase: 'video', aviso: null }
  if (m.startsWith('image/')) {
    return {
      clase: 'documento',
      aviso: 'WhatsApp no muestra este formato como foto (solo JPG y PNG): llegará como documento, que se abre igual.',
    }
  }
  return { clase: 'documento', aviso: null }
}

export const cargarMateriales = () => orbitApi('/whatsapp/materiales')

export const guardarMaterial = (datos) =>
  orbitApi('/whatsapp/materiales', { method: 'POST', body: datos })

export const borrarMaterial = (id) =>
  orbitApi(`/whatsapp/materiales/${id}`, { method: 'DELETE' })

export const enviarMaterial = (contacto, clave) =>
  orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/material`, {
    method: 'POST', body: { clave },
  })

/** El archivo, para verlo antes de mandárselo a una clínica. */
export const archivoMaterial = (id) => orbitApiBlob(`/whatsapp/materiales/${id}/archivo`)

/**
 * El archivo elegido, en base64 y sin la cabecera `data:`.
 *
 * No se toca ni se recomprime: un brochure recomprimido es un brochure feo, y
 * aquí no hay el problema de memoria de las fotos de la bandeja —esto lo sube
 * una persona desde un computador, una vez.
 */
export function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('No se pudo leer el archivo'))
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.readAsDataURL(file)
  })
}

export const pesoLegible = (b) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`

export const nuevoMaterial = () => ({
  id: null, clave: '', nombre: '', descripcion: '',
  nombre_archivo: '', pie: '', usa_agente: true, activo: true, orden: 0,
  base64: null, mime: null, bytes: 0,
})
