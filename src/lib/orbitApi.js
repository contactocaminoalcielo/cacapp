// Cliente del backend propio (orbit-backend en Contabo).
// En producción pasa por el mismo dominio (nginx: /api → 127.0.0.1:8787),
// así no depende de DNS adicional ni tiene problemas de CORS.
// Las escrituras críticas de Tenjo (confirmar/cerrar lote) SOLO van por aquí.
import { db } from '@/lib/supabase'

const BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

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
