import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON

export const db = createClient(SUPABASE_URL, SUPABASE_ANON)

export async function dbGet(table, select = '*', filters = {}, order = null) {
  let q = db.from(table).select(select)
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v) })
  if (order) q = q.order(order)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

// SELECT ... WHERE col IN (ids) troceado en lotes.
// Con ~90 uuids la URL pasa de 4 KB y el upstream la rechaza con 502 (no 414):
// supabase-js NO lanza, devuelve data:null, y quien ignore el error se queda con
// la columna vacía sin señal de nada. Lotes de 60 uuids ≈ 2.8 KB, con margen
// para el resto del querystring. `tweak` agrega filtros/order al lote.
export async function dbIn(table, select, col, ids, tweak = q => q) {
  const unicos = [...new Set((ids || []).filter(Boolean))]
  const out = []
  for (let i = 0; i < unicos.length; i += 60) {
    const { data, error } = await tweak(db.from(table).select(select).in(col, unicos.slice(i, i + 60)))
    if (error) throw new Error(error.message)
    out.push(...(data || []))
  }
  return out
}

export async function dbInsert(table, body) {
  const { data, error } = await db.from(table).insert(body).select()
  if (error) throw new Error(error.message)
  return data || []
}

export async function dbUpdate(table, id, idCol, body) {
  const { data, error } = await db.from(table).update(body).eq(idCol, id).select()
  if (error) throw new Error(error.message)
  return data || []
}

export async function callEdgeFunction(name, body) {
  const { data: { session } } = await db.auth.getSession()
  const token = session?.access_token || SUPABASE_ANON
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`)
  return json
}
