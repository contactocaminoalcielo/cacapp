// Marco de las evidencias del inicio del compostaje (migración 178).
//
// Reemplaza el marco que coordinación armaba a mano (franja verde con
// «Siempre en nuestro recuerdo», huellitas, la foto y la fecha). Conserva su
// calidez —el verde, las huellas, la frase— pero sobre papel crema, con el
// dorado del logo y la tipografía de los documentos de la marca, porque lo
// recibe una familia que acaba de despedir a su mascota.
//
// Las DOS fotos del cubículo van en el MISMO marco: una plantilla de WhatsApp
// lleva una sola imagen de cabecera, y así la familia recibe un solo mensaje.
//
// Lo dibuja Chromium (`renderImagen` en pdf.js). Todo va incrustado: las fotos
// llegan como data URI y la pestaña no tiene red.
import { FUENTES_CSS, LOGO, esc } from '../pdf-recursos.js'

export const FORMATOS = {
  horizontal: { ancho: 1350, alto: 1080 },
  vertical:   { ancho: 1080, alto: 1350 },
}

const PAPEL   = '#FBF7F0'
const HONDO   = '#2F5D45'
const SALVIA  = '#7FA085'
const DORADO  = '#C4A87A'
const APAGADO = '#6B6257'

const HUELLA = color => `
<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
  <g fill="${color}">
    <ellipse cx="32" cy="42" rx="14" ry="12"/>
    <ellipse cx="14" cy="26" rx="6" ry="8" transform="rotate(-18 14 26)"/>
    <ellipse cx="26" cy="16" rx="6" ry="8.5" transform="rotate(-6 26 16)"/>
    <ellipse cx="38" cy="16" rx="6" ry="8.5" transform="rotate(6 38 16)"/>
    <ellipse cx="50" cy="26" rx="6" ry="8" transform="rotate(18 50 26)"/>
  </g>
</svg>`

// Rama de esquina: tallo curvo con hojas alternas.
const RAMA = tam => `
<svg viewBox="0 0 200 200" width="${tam}" height="${tam}" aria-hidden="true">
  <path d="M8 196 C 54 150, 104 100, 192 14" fill="none" stroke="${SALVIA}" stroke-width="3" stroke-linecap="round"/>
  <g fill="${SALVIA}" opacity="0.85">
    <ellipse cx="40" cy="146" rx="24" ry="9" transform="rotate(-70 40 146)"/>
    <ellipse cx="66" cy="152" rx="24" ry="9" transform="rotate(-10 66 152)"/>
    <ellipse cx="82" cy="106" rx="22" ry="8.5" transform="rotate(-72 82 106)"/>
    <ellipse cx="108" cy="112" rx="22" ry="8.5" transform="rotate(-12 108 112)"/>
    <ellipse cx="124" cy="68" rx="20" ry="8" transform="rotate(-74 124 68)"/>
    <ellipse cx="148" cy="74" rx="20" ry="8" transform="rotate(-14 148 74)"/>
    <ellipse cx="170" cy="36" rx="16" ry="7" transform="rotate(-40 170 36)"/>
  </g>
</svg>`

/** «16 de octubre de 2026», en hora de Bogotá. */
export function fechaLargaBogota(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
}

const num = (v, min, max, def) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

function imgFoto(f) {
  if (!f?.dataUri) return '<div class="foto vacia"></div>'
  const zoom = num(f.zoom, 1, 3, 1)
  const posX = num(f.posX, 0, 100, 50)
  const posY = num(f.posY, 0, 100, 50)
  return `<div class="foto"><img src="${f.dataUri}" alt=""
    style="object-position:${posX}% ${posY}%;transform:scale(${zoom});transform-origin:${posX}% ${posY}%"></div>`
}

/**
 * HTML completo del marco.
 * @param fotos    [{ dataUri, zoom 1–3, posX 0–100, posY 0–100 }] — 1 ó 2
 * @param formato  'horizontal' | 'vertical'
 */
export function htmlMarcoEvidencia({ fotos = [], mascota, fecha, frase, formato = 'horizontal' }) {
  const vertical = formato === 'vertical'
  const { ancho, alto } = FORMATOS[vertical ? 'vertical' : 'horizontal']
  const lista = fotos.slice(0, 2)
  const dos = lista.length === 2
  const nombre = String(mascota || '').trim()
  // Un nombre largo ("Princesa Valentina") no puede salirse del pie.
  const tamNombre = nombre.length > 20 ? 42 : nombre.length > 13 ? 50 : 58
  const tamFrase = vertical ? 46 : 54

  // Zonas: cabecera (frase) · fotos · pie (nombre + fecha) · logo.
  const zona = vertical
    ? { top: 160, left: 66, right: 66, bottom: 300 }
    : { top: 160, left: 78, right: 78, bottom: 196 }
  // Dos fotos: lado a lado en horizontal, una sobre otra en vertical.
  const direccion = vertical ? 'column' : 'row'

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
${FUENTES_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ancho}px;height:${alto}px;overflow:hidden}
body{position:relative;font-family:'Nunito',sans-serif;color:${HONDO};
  background:radial-gradient(120% 90% at 50% 0%, #FFFDF8 0%, ${PAPEL} 45%, #F1E8D6 100%)}
.linea1{position:absolute;inset:22px;border:2px solid ${DORADO};border-radius:30px}
.linea2{position:absolute;inset:32px;border:1px solid rgba(196,168,122,.5);border-radius:24px}
.rama{position:absolute;opacity:.9}
.rama.a{left:4px;top:4px;transform:rotate(180deg) scaleX(-1)}
.rama.b{right:4px;bottom:4px}
.cabecera{position:absolute;top:${vertical ? 54 : 48}px;left:0;right:0;height:92px;
  display:flex;align-items:center;justify-content:center;gap:22px}
.frase{font-family:'Playfair Display',serif;font-style:italic;font-weight:500;font-size:${tamFrase}px;
  color:${HONDO};white-space:nowrap}
.filete{width:64px;height:2px;background:linear-gradient(90deg,transparent,${DORADO})}
.filete.d{background:linear-gradient(270deg,transparent,${DORADO})}
.fotos{position:absolute;top:${zona.top}px;left:${zona.left}px;right:${zona.right}px;bottom:${zona.bottom}px;
  display:flex;flex-direction:${direccion};gap:${dos ? 26 : 0}px}
.foto{position:relative;flex:1;border-radius:26px;overflow:hidden;background:#E9E2D2;
  border:10px solid #fff;box-shadow:0 22px 46px -22px rgba(47,93,69,.55), 0 0 0 1px rgba(196,168,122,.45)}
.foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pie{position:absolute;left:0;right:0;
  ${vertical ? 'bottom:130px;height:150px' : 'bottom:44px;height:136px'};
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.nombre{font-family:'Playfair Display',serif;font-weight:600;font-size:${tamNombre}px;line-height:1.05;color:${HONDO}}
.sub{margin-top:10px;font-size:24px;color:${APAGADO};letter-spacing:.02em}
.sub b{color:${HONDO};font-weight:700}
.logo{position:absolute;border-radius:50%;background:#fff;
  box-shadow:0 10px 26px -12px rgba(47,93,69,.5);display:flex;align-items:center;justify-content:center;
  ${vertical ? 'width:104px;height:104px;left:50%;margin-left:-52px;bottom:40px' : 'width:124px;height:124px;left:62px;bottom:50px'}}
.logo img{width:84%;height:84%;object-fit:contain}
</style></head><body>
  <div class="linea1"></div><div class="linea2"></div>
  <div class="rama a">${RAMA(vertical ? 120 : 140)}</div><div class="rama b">${RAMA(vertical ? 150 : 160)}</div>

  <div class="cabecera">
    ${HUELLA(DORADO)}<span class="filete"></span>
    <span class="frase">${esc(frase || 'Siempre en nuestro recuerdo')}</span>
    <span class="filete d"></span>${HUELLA(DORADO)}
  </div>

  <div class="fotos">${lista.map(imgFoto).join('')}</div>

  <div class="pie">
    <div class="nombre">${esc(nombre)}</div>
    <div class="sub">Comienza su regreso a la tierra · <b>${esc(fechaLargaBogota(fecha))}</b></div>
  </div>

  ${LOGO ? `<div class="logo"><img src="${LOGO}" alt=""></div>` : ''}
</body></html>`
}
