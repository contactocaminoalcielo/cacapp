// El marco de marca de todos los PDFs: cabecera con logo, pie con los datos de
// la empresa, marca de agua y estilos base. Cada plantilla pone solo el cuerpo.
//
// Cómo se repiten la cabecera y el pie en cada página: el documento es una
// <table> con <thead> y <tfoot>. Chromium repite el thead arriba y el tfoot
// abajo de CADA página impresa, y el contenido del tbody fluye entre los dos
// sin pisarlos.
//
// 🪤 El tfoot tiene una trampa: en la ÚLTIMA página no baja al borde, se queda
// pegado al final del contenido. Por eso el pie visible va en position:fixed
// (Chromium lo pinta en todas las páginas, siempre abajo) y el tfoot solo lleva
// un separador vacío de la misma altura, que reserva el espacio para que el
// texto nunca se monte encima. La marca de agua también va en fixed.
import { FUENTES_CSS, LOGO, PALETA as P, EMPRESA, esc } from '../pdf-recursos.js'

/**
 * @param titulo   'CERTIFICADO DE ENTREGA'
 * @param numero   'CAC-202609-AB12CD'
 * @param fecha    texto ya formateado para la cabecera
 * @param cuerpo   HTML del contenido
 * @param extraCss CSS propio de la plantilla
 */
export function marco({ titulo, numero, fecha, cuerpo, extraCss = '' }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo)} ${esc(numero || '')}</title>
<style>
${FUENTES_CSS}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Nunito', 'Liberation Sans', Arial, sans-serif;
  font-size: 10.5px; line-height: 1.4; color: ${P.tinta};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc { width: 100%; border-collapse: collapse; }
.doc > thead > tr > td, .doc > tfoot > tr > td, .doc > tbody > tr > td { padding: 0; }

/* Marca de agua: el logo muy tenue en el centro de cada página. */
.marca { position: fixed; inset: 0; z-index: -1; display: flex; align-items: center; justify-content: center; }
.marca img { width: 118mm; opacity: 0.045; }

/* Cabecera: logo a la izquierda, datos de la empresa a la derecha, y debajo la
   banda verde con el título del documento. */
.cab { padding: 10mm 16mm 0; }
.cab-fila { display: flex; align-items: center; justify-content: space-between; gap: 8mm; }
.cab-logo { height: 21mm; }
.cab-emp { text-align: right; color: ${P.gris}; font-size: 8.6px; line-height: 1.45; }
.cab-emp b { display: block; font-family: 'Playfair Display', Georgia, serif; font-weight: 600; font-size: 13px; color: ${P.verde}; letter-spacing: .2px; }
.cab-banda { margin-top: 4.5mm; background: ${P.verde}; color: #fff; border-bottom: 1.2mm solid ${P.dorado};
  padding: 2.6mm 5mm; display: flex; align-items: baseline; justify-content: space-between; }
.cab-banda h1 { margin: 0; font-family: 'Playfair Display', Georgia, serif; font-weight: 600; font-size: 14.5px; letter-spacing: 1.4px; }
.cab-banda .num { font-size: 9px; color: #E9DFC8; }
.cab-banda .num b { color: #fff; font-weight: 700; margin-right: 3mm; }
.cab-esp { height: 5mm; }

/* Pie: banda verde con los datos de contacto, fija al borde de cada página.
   .pie-reserva (en el tfoot) mide lo mismo y mantiene el texto lejos. */
.pie { position: fixed; left: 0; right: 0; bottom: 0; padding: 0 16mm 7mm; }
.pie-banda { background: ${P.verde}; color: #CFE3D5; border-top: 0.6mm solid ${P.dorado}; padding: 2.2mm 5mm;
  display: flex; align-items: center; justify-content: space-between; font-size: 7.8px; line-height: 1.5; }
.pie-banda b { color: #fff; }
.pie-reserva { height: 22mm; }

/* Cuerpo y piezas comunes */
.cuerpo { padding: 0 16mm; }
.sec { margin: 0 0 2.6mm; padding: 1.4mm 2.6mm; background: ${P.verdeSuave}; color: ${P.verde};
  font-size: 8px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; border-left: 0.9mm solid ${P.dorado}; }
.bloque { break-inside: avoid; margin-bottom: 4.2mm; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; row-gap: 2.2mm; }
.campo .et { font-size: 7px; font-weight: 700; color: ${P.grisClaro}; letter-spacing: .8px; text-transform: uppercase; }
.campo .va { font-size: 10.5px; color: ${P.tinta}; margin-top: .3mm; }
.campo.ancho { grid-column: 1 / -1; }
.hr { border: 0; border-top: 0.25mm solid ${P.verdeLinea}; margin: 1mm 0 4mm; }
.nota { font-size: 8.4px; color: ${P.gris}; font-style: italic; }
${extraCss}
</style></head>
<body>
<div class="marca">${LOGO ? `<img src="${LOGO}" alt="">` : ''}</div>
<div class="pie">
  <div class="pie-banda">
    <div><b>${esc(EMPRESA.nombre)}</b> · NIT ${esc(EMPRESA.nit)}<br>${esc(EMPRESA.direccion)}, ${esc(EMPRESA.ciudad)}</div>
    <div style="text-align:right">${esc(EMPRESA.telefono)} · ${esc(EMPRESA.email)}<br>${esc(EMPRESA.web)}</div>
  </div>
</div>
<table class="doc">
  <thead><tr><td>
    <div class="cab">
      <div class="cab-fila">
        ${LOGO ? `<img class="cab-logo" src="${LOGO}" alt="Camino al Cielo">` : `<div></div>`}
        <div class="cab-emp">
          <b>${esc(EMPRESA.nombre)}</b>
          ${esc(EMPRESA.subtitulo)}<br>
          NIT ${esc(EMPRESA.nit)} · ${esc(EMPRESA.direccion)}, ${esc(EMPRESA.ciudad)}<br>
          ${esc(EMPRESA.telefono)} · ${esc(EMPRESA.email)} · ${esc(EMPRESA.web)}
        </div>
      </div>
      <div class="cab-banda">
        <h1>${esc(titulo)}</h1>
        <div class="num">${numero ? `<b>No. ${esc(numero)}</b>` : ''}${fecha ? esc(fecha) : ''}</div>
      </div>
      <div class="cab-esp"></div>
    </div>
  </td></tr></thead>
  <tfoot><tr><td><div class="pie-reserva"></div></td></tr></tfoot>
  <tbody><tr><td>
    <div class="cuerpo">
${cuerpo}
    </div>
  </td></tr></tbody>
</table>
</body></html>`
}
