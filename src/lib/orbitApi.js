// Cliente del backend propio (orbit-backend en Contabo).
// En producción pasa por el mismo dominio (nginx: /api → 127.0.0.1:8787),
// así no depende de DNS adicional ni tiene problemas de CORS.
// Las escrituras críticas de Tenjo (confirmar/cerrar lote) SOLO van por aquí.
import { db } from '@/lib/supabase'

const BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

/**
 * Igual que `orbitApi` pero devuelve el archivo, no JSON.
 *
 * Hace falta porque los adjuntos de WhatsApp se sirven con sesión y rol: un
 * `<img src="/api/...">` no puede mandar la cabecera Authorization, así que se
 * bajan aquí y se pintan desde un object URL. Quien lo use debe hacer
 * `URL.revokeObjectURL` al desmontar o la memoria se va llenando de fotos.
 */
export async function orbitApiBlob(path) {
  const { data: { session } } = await db.auth.getSession()
  if (!session?.access_token) throw new Error('Sesión expirada — vuelve a iniciar sesión')
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) {
    // El backend responde JSON en los errores (410 con el motivo de por qué no
    // se pudo bajar el archivo), aunque el camino feliz devuelva bytes.
    const json = await res.json().catch(() => ({}))
    const err = new Error(json.error || `Error ${res.status} del backend`)
    err.status = res.status
    throw err
  }
  return res.blob()
}

export async function orbitApi(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await db.auth.getSession()
  if (!session?.access_token) throw new Error('Sesión expirada — vuelve a iniciar sesión')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Error ${res.status} del backend`)
    err.status = res.status
    err.detalle = json
    throw err
  }
  return json
}
