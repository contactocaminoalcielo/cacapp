// Un "pool" de pg respaldado por PGlite (una sola conexión, consultas en serie).
const q = async (text, params = []) => {
  const r = await globalThis.__pg.query(text, params)
  const rows = r.rows || []
  return { rows, rowCount: r.affectedRows ?? rows.length }
}
export const pool = {
  query: q,
  connect: async () => ({ query: q, release() {} }),
  end: async () => {},
}
export function log(...a) { if (process.env.VER_LOG) console.log('   ·', ...a) }
