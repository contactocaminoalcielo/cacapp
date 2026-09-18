// HTML → PDF con el Chromium headless que ya vive en el contenedor.
//
// Pedido de David el 2026-09-18: «mejorar la generación de PDFs de Orbit, con
// mejores estilos y fondo de marca». Hasta hoy cada PDF se dibuja a mano con
// jsPDF en el navegador (coordenadas, sin tipografía propia, sin fondo). Aquí
// el documento se escribe en HTML+CSS y Chromium lo imprime: márgenes,
// cabecera y pie repetidos, fuentes de marca y fondo a sangre.
//
// Reutiliza el chrome-headless-shell que Remotion descarga para los memoriales
// (`memorial/ensure-browser.mjs`): la imagen no crece y no hay otro binario
// que mantener. `puppeteer-core` solo pone el protocolo encima.
//
// Tres cuidados:
// 1. UNA sola instancia de navegador, perezosa, compartida; cada PDF es una
//    pestaña nueva que se cierra siempre. Si el navegador se muere, se relanza
//    en la siguiente petición.
// 2. Tope de renders simultáneos (semáforo) y tiempo máximo por render: un
//    lote de certificados no puede dejar el backend sin memoria.
// 3. La pestaña NO sale a la red: lo que necesite el documento (logo, fuentes)
//    va incrustado como data URI desde `pdf-recursos.js`. Así ningún HTML puede
//    pedir nada de la red interna del Docker.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { log } from './db.js'

const MOD = '[pdf]'
const MAX_SIMULTANEOS = Number(process.env.PDF_MAX_SIMULTANEOS || 2)
const TIMEOUT_MS      = Number(process.env.PDF_TIMEOUT_MS || 30000)

const aqui = path.dirname(fileURLToPath(import.meta.url))

/** Dónde está el Chromium. Primero la variable, luego el de Remotion. */
function rutaChromium() {
  if (process.env.PDF_CHROMIUM_PATH) return process.env.PDF_CHROMIUM_PATH
  const base = path.join(aqui, '..', 'node_modules', '.remotion', 'chrome-headless-shell')
  const candidatos = [
    path.join(base, 'linux64', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    path.join(base, 'win64',   'chrome-headless-shell-win64',   'chrome-headless-shell.exe'),
    path.join(base, 'mac-arm64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    path.join(base, 'mac-x64',   'chrome-headless-shell-mac-x64',   'chrome-headless-shell'),
  ]
  return candidatos.find(p => fs.existsSync(p)) || null
}

let navegador = null
let lanzando = null

async function obtenerNavegador() {
  if (navegador?.connected) return navegador
  if (lanzando) return lanzando
  lanzando = (async () => {
    const { default: puppeteer } = await import('puppeteer-core')
    const executablePath = rutaChromium()
    if (!executablePath) throw new Error('No hay Chromium para PDFs (PDF_CHROMIUM_PATH o el de Remotion)')
    const b = await puppeteer.launch({
      executablePath,
      headless: true,
      // Corre como root dentro de Docker: sin sandbox. /dev/shm es diminuto en
      // Docker y Chromium se cae sin el flag.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--font-render-hinting=none'],
    })
    b.on('disconnected', () => { log(MOD, 'navegador desconectado'); navegador = null })
    log(MOD, 'Chromium listo:', executablePath)
    return b
  })()
  try { navegador = await lanzando } finally { lanzando = null }
  return navegador
}

// Semáforo casero: `MAX_SIMULTANEOS` renders a la vez, el resto espera su turno.
let enCurso = 0
const cola = []
function turno() {
  if (enCurso < MAX_SIMULTANEOS) { enCurso++; return Promise.resolve() }
  return new Promise(res => cola.push(res))
}
function soltar() {
  const sig = cola.shift()
  if (sig) sig(); else enCurso--
}

/**
 * Imprime un HTML completo a PDF. Devuelve un Buffer.
 *
 * @param html      documento completo (<html>…), con todo incrustado
 * @param formato   'A4' | 'Letter'
 * @param apaisado  true para horizontal
 * @param margen    { top, right, bottom, left } en CSS (p. ej. '18mm'); 0 si el
 *                  diseño maneja sus propios márgenes con fondo a sangre
 */
export async function renderPdf({ html, formato = 'Letter', apaisado = false, margen = null }) {
  await turno()
  const t0 = Date.now()
  let page = null
  try {
    const b = await obtenerNavegador()
    page = await b.newPage()
    // Sin red: todo lo que no sea data:/about: se bloquea.
    await page.setRequestInterception(true)
    page.on('request', req => {
      const u = req.url()
      if (u.startsWith('data:') || u.startsWith('about:')) req.continue()
      else { log(MOD, 'bloqueada petición de red desde el PDF:', u.slice(0, 120)); req.abort() }
    })
    await page.setContent(html, { waitUntil: 'load', timeout: TIMEOUT_MS })
    await page.evaluateHandle('document.fonts.ready')
    const pdf = await page.pdf({
      format: formato, landscape: apaisado,
      printBackground: true, preferCSSPageSize: true,
      margin: margen || { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: TIMEOUT_MS,
    })
    log(MOD, `render ${formato}${apaisado ? ' apaisado' : ''} en ${Date.now() - t0} ms, ${(pdf.length / 1024).toFixed(0)} KB`)
    return Buffer.from(pdf)
  } finally {
    if (page) await page.close().catch(() => {})
    soltar()
  }
}

/** Para el /health o un smoke test: ¿hay Chromium y arranca? */
export async function estadoPdf() {
  const ruta = rutaChromium()
  if (!ruta) return { ok: false, motivo: 'sin_chromium' }
  try {
    const pdf = await renderPdf({ html: '<html><body><p>ok</p></body></html>' })
    return { ok: pdf.length > 100, bytes: pdf.length, chromium: ruta }
  } catch (e) {
    return { ok: false, motivo: e.message, chromium: ruta }
  }
}

/** Cierra el navegador (al apagar el proceso). */
export async function cerrarPdf() {
  if (navegador) { await navegador.close().catch(() => {}); navegador = null }
}
