// Conexión directa a PostgreSQL (la DB real del proyecto, sin pasar por PostgREST)
import pg from 'pg'

export const pool = new pg.Pool({
  host:     process.env.PGHOST || 'supabase-db',
  port:     parseInt(process.env.PGPORT) || 5432,
  user:     process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  password: process.env.PGPASSWORD,
  max: 5,
})

export function log(...args) {
  console.log(new Date().toISOString(), ...args)
}
