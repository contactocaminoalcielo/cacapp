// Envío del contrato de afiliación pre-exequial por correo (SMTP del hosting).
// El backend NO tiene llaves de storage: el frontend genera un enlace firmado
// corto y lo manda en el body; aquí se descarga el PDF y se adjunta al correo.
import nodemailer from 'nodemailer'
import { pool } from './db.js'

// Solo se aceptan enlaces del storage propio (guard anti-SSRF).
const STORAGE_BASE = process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/'

let transporter = null
function getTransporter() {
  if (transporter) return transporter
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
    throw new Error('SMTP sin configurar — faltan SMTP_HOST/SMTP_USER/SMTP_PASS en el .env del backend')
  const port = parseInt(process.env.SMTP_PORT) || 465
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return transporter
}

const esUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''))

export async function enviarContratoEmail({ contratoId, email, signedUrl }) {
  if (!esUuid(contratoId)) return { status: 422, body: { error: 'Id de contrato inválido.' } }
  const destino = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(destino))
    return { status: 422, body: { error: 'Correo de destino inválido.' } }
  if (!String(signedUrl || '').startsWith(STORAGE_BASE))
    return { status: 422, body: { error: 'El enlace del PDF no viene del storage de Orbit.' } }

  const { rows } = await pool.query(
    `SELECT ct.numero_contrato, ct.pdf_path, a.nivel, a.tipo,
            c.nombre AS cliente_nombre
       FROM public.afiliacion_contratos ct
       JOIN public.afiliaciones a ON a.id = ct.afiliacion_id
       JOIN public.clientes c     ON c.id_cliente = a.cliente_id
      WHERE ct.id = $1`,
    [contratoId]
  )
  const ct = rows[0]
  if (!ct) return { status: 404, body: { error: 'Contrato no encontrado.' } }
  if (!ct.pdf_path) return { status: 422, body: { error: 'El contrato no tiene PDF generado.' } }

  const r = await fetch(signedUrl)
  if (!r.ok) return { status: 422, body: { error: `No se pudo descargar el PDF del storage (${r.status}).` } }
  const pdf = Buffer.from(await r.arrayBuffer())
  if (pdf.length < 1000 || pdf.subarray(0, 4).toString() !== '%PDF')
    return { status: 422, body: { error: 'El archivo descargado no es un PDF válido.' } }
  if (pdf.length > 15 * 1024 * 1024)
    return { status: 422, body: { error: 'El PDF supera 15 MB — demasiado grande para adjuntar.' } }

  const asunto = `Tu contrato de afiliación ${ct.numero_contrato} — Camino al Cielo`
  const saludo = ct.cliente_nombre ? `Hola ${ct.cliente_nombre},` : 'Hola,'
  const texto =
    `${saludo}\n\n` +
    `Te compartimos adjunto el contrato Nº ${ct.numero_contrato} de tu afiliación pre-exequial ` +
    `${ct.nivel}${ct.tipo === 'VITALICIO' ? ' vitalicia' : ''} con Camino al Cielo.\n\n` +
    `Cualquier duda, escríbenos por WhatsApp al 319 358 5508.\n\n` +
    `Con cariño,\nEquipo Camino al Cielo 🌈`
  const html = texto
    .split('\n\n')
    .map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')

  await getTransporter().sendMail({
    from: `"Camino al Cielo" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: destino,
    subject: asunto,
    text: texto,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#243b2a;max-width:560px">${html}</div>`,
    attachments: [{ filename: `Contrato_${ct.numero_contrato}.pdf`, content: pdf, contentType: 'application/pdf' }],
  })

  await pool.query(
    `UPDATE public.afiliacion_contratos
        SET enviado_email_at = now(), enviado_email_a = $2
      WHERE id = $1`,
    [contratoId, destino]
  )
  return { status: 200, body: { ok: true, enviado_a: destino } }
}
