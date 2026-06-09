import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || 'https://gfnvrmpcwchqdyozwygd.supabase.co'
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmbnZybXBjd2NocWR5b3p3eWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjE0NTIsImV4cCI6MjA5MzAzNzQ1Mn0.wlvaQqka2QOM3mGwUA42JMknTGWhOyLmphSmIBrHitI'

export const db = createClient(SUPABASE_URL, SUPABASE_ANON)

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
