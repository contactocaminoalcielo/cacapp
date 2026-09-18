// Recursos de marca para los PDFs: fuentes, logo, paleta y datos de la empresa.
//
// Todo va INCRUSTADO como data URI porque la pestaña que imprime no tiene red
// (ver pdf.js): así ningún documento depende de Google Fonts ni de un CDN, y
// se imprime igual hoy que en cinco años.
//
// Las fuentes son las mismas de la app (Nunito para texto, Playfair Display
// para títulos), en su versión variable latina (un solo archivo por familia,
// ~40 KB). El logo es el mismo PNG que usa el memorial.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(aqui, '..')

function dataUri(ruta, mime) {
  try { return `data:${mime};base64,${fs.readFileSync(ruta).toString('base64')}` }
  catch { return null }
}

const fuente = n => dataUri(path.join(RAIZ, 'pdf', 'fonts', n), 'font/woff2')
const NUNITO   = fuente('Nunito.woff2')
const PLAYFAIR = fuente('PlayfairDisplay.woff2')
const PLAYFAIR_I = fuente('PlayfairDisplay-italic.woff2')

export const LOGO = dataUri(path.join(RAIZ, 'memorial', 'public', 'img', 'logo.png'), 'image/png')

/** El @font-face de las dos familias, listo para pegar dentro de <style>. */
export const FUENTES_CSS = [
  NUNITO     && `@font-face{font-family:'Nunito';font-style:normal;font-weight:200 1000;src:url(${NUNITO}) format('woff2')}`,
  PLAYFAIR   && `@font-face{font-family:'Playfair Display';font-style:normal;font-weight:400 900;src:url(${PLAYFAIR}) format('woff2')}`,
  PLAYFAIR_I && `@font-face{font-family:'Playfair Display';font-style:italic;font-weight:400 900;src:url(${PLAYFAIR_I}) format('woff2')}`,
].filter(Boolean).join('\n')

/**
 * Paleta de los documentos de Camino al Cielo. Es la de la EMPRESA (el verde y
 * el dorado del logo), no la de Orbit: estos papeles los recibe la familia.
 */
export const PALETA = {
  verde:       '#1F5A32',
  verdeOscuro: '#163F24',
  verdeSuave:  '#E8F3EB',
  verdeLinea:  '#CFE3D5',
  dorado:      '#C4A87A',
  doradoSuave: '#FBF7EE',
  tinta:       '#1B1F1C',
  gris:        '#6B7280',
  grisClaro:   '#9CA3AF',
  rojo:        '#B42318',
}

export const EMPRESA = {
  nombre:    'Camino al Cielo',
  subtitulo: 'Servicios funerarios para mascotas',
  nit:       '901792845-5',
  direccion: 'Calle 57 # 80-86 Los Monjes, Engativá',
  ciudad:    'Bogotá D.C.',
  telefono:  '319 358 5508',
  email:     'contacto@caminoalcielo.com.co',
  web:       'www.caminoalcielo.com.co',
}

/** Escapa texto para meterlo en HTML. Todo dato de la base pasa por aquí. */
export const esc = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const fmtCOP = n => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0,
}).format(Number(n) || 0)

/** "18 de septiembre de 2026" a partir de un DATE ('2026-09-18') o un timestamp. */
export function fechaLarga(v) {
  if (!v) return null
  const s = String(v)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
}

/** "14:35" a partir de un timestamp o de un time ('14:35:00'). */
export function horaCorta(v) {
  if (!v) return null
  const s = String(v)
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
}
