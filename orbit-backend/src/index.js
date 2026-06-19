// orbit-backend — servicio backend propio de ORBIT en Contabo (Fase 2).
// Jobs programados (cron del VPS → /jobs/*) + API con permisos en backend.
import express from 'express'
import { pool, log } from './db.js'
import { requireJob, requireAuth, requireRol } from './auth.js'
import { generarPropuesta } from './jobs/propuesta.js'
import { motorAlertas } from './jobs/alertas.js'
import { confirmarLote, cerrarLote } from './lotes.js'
import { jobReportesGrupales } from './jobs/grupales.js'
import { marcarGenerado, enviarReporte, desvincularServicioDeGrupal, agregarServicioAReporteGrupal } from './grupales.js'
import { resumenPendientes, redactarMensaje, alertaVencimientos } from './grupales-ia.js'
import { jobContactosImagenes } from './jobs/imagenes.js'
import { enviarSolicitud, cancelarSolicitud, datosPortal, recibirImagenesPortal } from './imagenes.js'

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

app.post('/jobs/grupales', requireJob, async (_req, res) => {
  try {
    res.json(await jobReportesGrupales())
  } catch (e) {
    log('[grupales] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Job: preparar contactos de solicitud de imágenes (NO envía) ──
app.post('/jobs/contactos-imagenes', requireJob, async (_req, res) => {
  try {
    res.json(await jobContactosImagenes())
  } catch (e) {
    log('[imagenes/job] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── API Solicitud de imágenes — el coordinador valida y autoriza el envío ──
app.post('/imagenes/preparar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (_req, res) => {
  try {
    res.json(await jobContactosImagenes())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/enviar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id, body: { fromNumber: req.body.fromNumber } })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/enviar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/reintentar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id, body: { fromNumber: req.body.fromNumber, reintentar: true } })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/reintentar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/imagenes/cancelar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await cancelarSolicitud({ solicitudId: req.body.solicitud_id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[imagenes/cancelar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Portal público de imágenes (el código de acceso es el secreto; sin JWT) ──
app.get('/portal/imagenes/:codigo', async (req, res) => {
  try {
    const r = await datosPortal({ codigo: req.params.codigo })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[portal/imagenes GET] ERROR', e.message)
    res.status(500).json({ ok: false, error: 'Error interno' })
  }
})

app.post('/portal/imagenes/:codigo', async (req, res) => {
  try {
    const r = await recibirImagenesPortal({ codigo: req.params.codigo, payload: req.body || {} })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[portal/imagenes POST] ERROR', e.message)
    res.status(500).json({ ok: false, error: 'Error interno' })
  }
})

// ── API Reportes Grupales — escrituras críticas, transaccionales (solo backend) ──
app.post('/grupales/sincronizar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (_req, res) => {
  try {
    res.json(await jobReportesGrupales())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/agregar-a-lote', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await agregarServicioAReporteGrupal({
      servicioId: req.body.servicio_id,
      personalId: req.personal.id,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/agregar-a-lote] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/reportes/:id/generar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await marcarGenerado({ reporteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/generar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/reportes/:id/enviar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await enviarReporte({ reporteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/enviar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/desvincular', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await desvincularServicioDeGrupal({
      servicioId: req.body.servicio_id, personalId: req.personal.id,
      motivo: req.body.motivo, manual: req.body.manual === true,
    })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[grupales/desvincular] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── Asistente IA (solo sugiere; el humano confirma) ──
app.post('/grupales/ia/resumen', requireAuth, async (_req, res) => {
  try {
    res.json(await resumenPendientes())
  } catch (e) {
    log('[grupales/ia/resumen] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/ia/redactar', requireAuth, async (req, res) => {
  try {
    res.json(await redactarMensaje({ itemId: req.body.item_id }))
  } catch (e) {
    log('[grupales/ia/redactar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/grupales/ia/control', requireAuth, async (_req, res) => {
  try {
    res.json(await alertaVencimientos())
  } catch (e) {
    log('[grupales/ia/control] ERROR', e.message)
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

// Escrituras críticas — transaccionales, solo vía backend (Fase 3)
app.post('/tenjo/lotes/:id/confirmar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await confirmarLote({ loteId: req.params.id, personalId: req.personal.id })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[confirmar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/tenjo/lotes/:id/cerrar', requireAuth, requireRol('COORDINADOR', 'ADMIN'), async (req, res) => {
  try {
    const r = await cerrarLote({ loteId: req.params.id, personalId: req.personal.id, body: req.body })
    res.status(r.status).json(r.body)
  } catch (e) {
    log('[cerrar] ERROR', e.message)
    res.status(500).json({ error: e.message })
  }
})

const PORT = parseInt(process.env.PORT) || 8787
app.listen(PORT, () => log(`orbit-backend escuchando en :${PORT} (TZ=${process.env.TZ || 'UTC'})`))
