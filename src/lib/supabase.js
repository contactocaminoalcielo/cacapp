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

// 🩸 El servidor CORTA toda respuesta en 1000 filas y no lo dice.
//
// `PGRST_DB_MAX_ROWS=1000` en el contenedor `supabase-rest`. No hay error, no
// hay aviso: llegan 1000 filas como si fueran todas. Y un `.limit(5000)` NO lo
// esquiva — el tope del servidor gana siempre, así que pedir de más solo
// disimula el problema.
//
// Así se perdió THONAS EMILIO (25-ago): con 1.216 mascotas ordenadas por
// nombre, las 216 últimas —de la T en adelante— no llegaban al navegador.
// Existía en la DB, salía en Historial (que consulta `servicios`) y no había
// forma de abrirla en Mascotas para corregirle el nombre.
export const DB_MAX_ROWS = 1000

// Cuántas páginas como mucho. Es un cinturón: si un día una consulta sin
// filtrar apunta a una tabla de millones, mejor cortar que colgar el navegador.
const TOPE_PAGINAS = 50

/**
 * Trae TODAS las filas de una consulta, en páginas de `DB_MAX_ROWS`.
 *
 * ⚠️ `construir` es una FUNCIÓN que arma la consulta, no la consulta: los
 * query builders de supabase-js se consumen al ejecutarse y no se pueden
 * reutilizar para la página siguiente.
 *
 * ⚠️ **El orden tiene que ser ÚNICO.** Paginar con un `.order('nombre')` que
 * empata (hay siete mascotas llamadas TOMAS) puede repetir una fila en el
 * corte de página y saltarse otra. Añade siempre la PK como desempate:
 * `.order('nombre').order('id_mascota')`.
 *
 * @example
 *   const todas = await dbTodo(() =>
 *     db.from('mascotas').select('*').order('nombre').order('id_mascota'))
 */
export async function dbTodo(construir, { pagina = DB_MAX_ROWS } = {}) {
  const out = []
  for (let p = 0; p < TOPE_PAGINAS; p++) {
    const desde = p * pagina
    const { data, error } = await construir().range(desde, desde + pagina - 1)
    if (error) throw new Error(error.message)
    const lote = data || []
    out.push(...lote)
    // Una página incompleta es el final. Si viene exacta, puede haber más.
    if (lote.length < pagina) return out
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
