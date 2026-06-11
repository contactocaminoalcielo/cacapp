// orbit-backend — servicio backend propio de ORBIT en Contabo (Fase 2).
// Jobs programados (cron del VPS → /jobs/*) + API con permisos en backend.
import express from 'express'
import { pool, log } from './db.js'
import { requireJob, requireAuth, requireRol } from './auth.js'
import { generarPropuesta } from './jobs/propuesta.js'
import { motorAlertas } from './jobs/alertas.js'

const app = express()
app.use(express.json())

// CORS para el frontend (mismo criterio que las funciones existentes)
const ALLOWED = ['https://orbit.orbitacac.com', 'https://localhost:5173']
app.use((req, res, next) => {
  const origin = req.headers.origin || ''
  res.set('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0])
  res.set('Access-Control-Allow-Headers', 'authorization, content-type')
  res.set('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Salud ──
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, ts: new Date().toISOString(), tz: process.env.TZ || 'UTC' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Jobs (los dispara el cron del VPS a diario; cada job decide si aplica) ──
app.post('/jobs/generar-propuesta', requireJob, async (req, res) => {
  try {
    res.json(await generarPropuesta({ force: req.query.force === '1' }))
  } catch (e) {
    log('[propuesta] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/jobs/alertas', requireJob, async (_req, res) => {
  try {
    res.json(await motorAlertas())
  } catch (e) {
    log('[alertas] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Tenjo (primeros endpoints; la migración desde PostgREST será gradual) ──
app.get('/tenjo/candidatos', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.v_candidatos_tenjo ORDER BY fecha_ingreso ASC`
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/tenjo/generar-propuesta', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    res.json(await generarPropuesta({ force: true }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = parseInt(process.env.PORT) || 8787
app.listen(PORT, () => log(`orbit-backend escuchando en :${PORT} (TZ=${process.env.TZ || 'UTC'})`))
