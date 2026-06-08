import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || 'https://gfnvrmpcwchqdyozwygd.supabase.co'
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbnZybXBjd2NocWR5b3p3eWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjE0NTIsImV4cCI6MjA5MzAzNzQ1Mn0.wlvaQqka2QOM3mGwUA42JMknTGWhOyLmphSmIBrHitI'
const SUPABASE_SVC  = import.meta.env.VITE_SUPABASE_SVC  || 'REDACTED_SERVICE_ROLE_KEY'

export const db = createClient(SUPABASE_URL, SUPABASE_ANON)

// Cliente admin — solo usar en módulos de administrador (Configuracion)
export const dbAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SVC,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function dbGet(table, select = '*', filters = {}, order = null) {
  let q = db.from(table).select(select)
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v) })
  if (order) q = q.order(order)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
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
