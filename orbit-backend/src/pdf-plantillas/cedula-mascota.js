// Cédula de mascota, en HTML con la marca de la empresa.
//
// Pedido de David (2026-09-22): el producto nuevo del módulo de compras de
// recordatorios necesita su documento. Es una TARJETA de identidad: se imprime
// en una hoja A4 con el anverso y el reverso a tamaño real (85.6 × 54 mm, el
// de una cédula), con marcas de corte, para plastificarla.
//
// De dónde salen los datos: TODO de la base, por el id de la compra y de la
// línea. El navegador solo manda una cosa que el backend no puede resolver
// solo: la URL FIRMADA de la foto (el bucket `evidencias` es privado y el
// backend no tiene llave de storage). Solo se acepta una URL de nuestro
// storage, igual que la firma del certificado de entrega.
//
// Reglas:
// - Los campos que la familia escribió (fecha de nacimiento, color y señas)
//   salen de `datos_cliente` de la línea; el resto de `mascotas` y `clientes`.
// - Lo que no se sabe se imprime como «—», nunca inventado.
// - El número de la cédula es estable: CM-<compra>-<6 hex de la mascota>.
import { pool, log } from '../db.js'
import { renderPdf } from '../pdf.js'
import { marco } from './marco.js'
import { PALETA as P, LOGO, EMPRESA, esc, fechaLarga } from '../pdf-recursos.js'

const STORAGE_BASE = process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La foto llega como URL firmada de nuestro storage; se baja aquí (la pestaña no tiene red). */
async function resolverFoto(url) {
  const s = String(url || '').trim()
  if (!s) return null
  if (s.startsWith('data:image/')) return s.length < 4_000_000 ? s : null
  if (!s.startsWith(STORAGE_BASE)) return null
  try {
    const r = await fetch(s, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'image/jpeg'
    if (!mime.startsWith('image/')) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length < 4_000_000 ? `data:${mime};base64,${buf.toString('base64')}` : null
  } catch (e) {
    log('[pdf/cedula] sin foto:', e.message)
    return null
  }
}

/** Compra + línea + mascota + cliente, en una consulta. */
async function cargarCedula(compraId, itemId) {
  const { rows: [r] } = await pool.query(
    `SELECT c.id AS compra_id, c.numero, c.created_at, c.anulada_en,
            i.id AS item_id, i.nombre AS item_nombre, i.datos_cliente,
            m.id_mascota, m.nombre AS mascota, m.raza, m.sexo, m.tamano, m.peso_kg,
            m.edad_anios, m.edad_declarada_en::text AS edad_declarada_en,
            m.fecha_nacimiento::text AS fecha_nacimiento,
            e.nombre AS especie,
            cl.nombre AS cli_nombre, cl.apellido AS cli_apellido, cl.whatsapp, cl.telefono,
            cl.ciudad, cl.direccion
       FROM public.compras_recordatorios c
       JOIN public.compra_recordatorio_items i ON i.compra_id = c.id AND i.id = $2
       JOIN public.mascotas m  ON m.id_mascota = c.mascota_id
       JOIN public.clientes cl ON cl.id_cliente = c.cliente_id
       LEFT JOIN public.especies e ON e.id = m.especie_id
      WHERE c.id = $1`,
    [compraId, itemId]
  )
  return r || null
}

// Primer texto de un campo de `datos_cliente` cuyo label contenga la palabra.
function dato(datos, palabra) {
  if (!datos || typeof datos !== 'object') return null
  const k = Object.keys(datos).find(x => x.toLowerCase().includes(palabra))
  const v = k ? datos[k] : null
  const s = Array.isArray(v) ? v[0] : v
  return s ? String(s).trim() : null
}

// Edad vigente: los años declarados más los transcurridos desde que se declararon.
function edadHoy(r) {
  if (r.edad_anios == null || !r.edad_declarada_en) return null
  const desde = new Date(r.edad_declarada_en + 'T12:00:00')
  const anios = Number(r.edad_anios) + Math.max(0, Math.floor((Date.now() - desde.getTime()) / (365.25 * 24 * 3600 * 1000)))
  return `${anios} año${anios === 1 ? '' : 's'}`
}

export function numeroCedula(r) {
  return `CM-${r.numero}-${String(r.id_mascota || '').slice(0, 6).toUpperCase()}`
}

const campo = (et, va) =>
  `<div class="c"><div class="et">${esc(et)}</div><div class="va">${esc(va || '—')}</div></div>`

export function htmlCedulaMascota({ r, foto }) {
  const numero    = numeroCedula(r)
  const expedida  = fechaLarga(r.created_at)
  const nacimiento = dato(r.datos_cliente, 'nacim') || (r.fecha_nacimiento ? fechaLarga(r.fecha_nacimiento) : null)
  const senas     = dato(r.datos_cliente, 'color') || dato(r.datos_cliente, 'señas') || dato(r.datos_cliente, 'senas')
  const dueno     = [r.cli_nombre, r.cli_apellido].filter(Boolean).join(' ')
  const contacto  = r.whatsapp || r.telefono || null
  const edad      = edadHoy(r)

  const anverso = `
<div class="tarjeta anverso">
  <div class="banda">
    ${LOGO ? `<img class="logo" src="${LOGO}" alt="">` : ''}
    <div class="banda-t"><b>CÉDULA DE MASCOTA</b><span>${esc(EMPRESA.nombre)}</span></div>
    <div class="num">No. ${esc(numero)}</div>
  </div>
  <div class="cuerpo-t">
    <div class="foto">${foto ? `<img src="${foto}" alt="">` : `<div class="sinfoto">Sin foto</div>`}</div>
    <div class="datos">
      <div class="nombre">${esc(r.mascota)}</div>
      <div class="g2">
        ${campo('Especie', r.especie)}
        ${campo('Raza', r.raza)}
        ${campo('Sexo', r.sexo)}
        ${campo('Nacimiento', nacimiento || edad)}
        ${campo('Tamaño', r.tamano)}
        ${campo('Peso', r.peso_kg ? `${Number(r.peso_kg)} kg` : null)}
      </div>
    </div>
  </div>
  <div class="pie-t"><span>Expedida el ${esc(expedida)}</span><span>${esc(EMPRESA.web)}</span></div>
</div>`

  const reverso = `
<div class="tarjeta reverso">
  <div class="banda banda-r"><div class="banda-t"><b>DATOS DE CONTACTO</b><span>Si me encuentras, por favor avisa a mi familia</span></div></div>
  <div class="cuerpo-r">
    <div class="g2">
      ${campo('Mi familia', dueno)}
      ${campo('Teléfono', contacto)}
      ${campo('Ciudad', r.ciudad)}
      ${campo('Señas particulares', senas)}
    </div>
    <div class="leyenda">
      Esta cédula identifica a <b>${esc(r.mascota)}</b> como miembro de su familia.
      Documento expedido por ${esc(EMPRESA.nombre)} · NIT ${esc(EMPRESA.nit)} · ${esc(EMPRESA.telefono)}.
    </div>
  </div>
  <div class="pie-t"><span>No. ${esc(numero)}</span><span>${esc(EMPRESA.email)}</span></div>
</div>`

  const cuerpo = `
<div class="sec">Anverso</div>
<div class="bloque hoja">${anverso}</div>
<div class="sec">Reverso</div>
<div class="bloque hoja">${reverso}</div>
<p class="nota">Imprimir al 100 % (sin ajustar a la página). Recortar por las líneas y plastificar. Tamaño real: 85,6 × 54 mm.</p>
<div class="bloque ficha">
  <div class="sec">Registro</div>
  <div class="grid2">
    <div class="campo"><div class="et">Compra</div><div class="va">CR-${esc(r.numero)} · ${esc(r.item_nombre)}</div></div>
    <div class="campo"><div class="et">Expedida</div><div class="va">${esc(expedida)}</div></div>
    <div class="campo"><div class="et">Titular</div><div class="va">${esc(dueno || '—')}</div></div>
    <div class="campo"><div class="et">Contacto</div><div class="va">${esc(contacto || '—')}</div></div>
  </div>
</div>`

  const extraCss = `
.hoja { display: flex; justify-content: center; padding: 3mm 0 5mm; }
/* Marcas de corte: el borde punteado es la línea de recorte. */
.tarjeta { width: 85.6mm; height: 54mm; border: 0.25mm dashed ${P.grisClaro}; border-radius: 3mm; overflow: hidden;
  display: flex; flex-direction: column; background: #fff; position: relative; }
.banda { background: ${P.verde}; color: #fff; border-bottom: 0.7mm solid ${P.dorado}; padding: 1.6mm 3mm;
  display: flex; align-items: center; gap: 2mm; }
.banda-r { background: ${P.verdeOscuro}; }
.logo { height: 6.5mm; filter: brightness(0) invert(1); opacity: .95; }
.banda-t { flex: 1; line-height: 1.15; }
.banda-t b { display: block; font-family: 'Playfair Display', Georgia, serif; font-size: 8.6px; letter-spacing: 1.2px; }
.banda-t span { font-size: 6.2px; color: #CFE3D5; }
.num { font-size: 6.4px; color: #E9DFC8; white-space: nowrap; font-weight: 700; }
.cuerpo-t { flex: 1; display: flex; gap: 2.6mm; padding: 2.2mm 3mm 1mm; }
.foto { align-self: flex-start; width: 24mm; height: 28mm; border-radius: 1.5mm; overflow: hidden; border: 0.3mm solid ${P.verdeLinea}; background: ${P.verdeSuave}; flex-shrink: 0; }
.foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sinfoto { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 6.5px; color: ${P.grisClaro}; }
.datos { flex: 1; min-width: 0; }
.nombre { font-family: 'Playfair Display', Georgia, serif; font-size: 13.5px; font-weight: 600; color: ${P.verde}; line-height: 1.1; margin-bottom: 1.4mm;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: 2mm; row-gap: 1.1mm; }
.c .et { font-size: 5.3px; font-weight: 800; color: ${P.grisClaro}; letter-spacing: .6px; text-transform: uppercase; }
.c .va { font-size: 7.4px; color: ${P.tinta}; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pie-t { display: flex; justify-content: space-between; padding: 1mm 3mm 1.4mm; font-size: 5.6px; color: ${P.gris}; border-top: 0.2mm solid ${P.verdeLinea}; }
.cuerpo-r { flex: 1; padding: 2.4mm 3mm 1mm; display: flex; flex-direction: column; gap: 1.8mm; }
.cuerpo-r .c .va { white-space: normal; }
.leyenda { margin-top: auto; font-size: 6.2px; line-height: 1.35; color: ${P.gris}; }
.leyenda b { color: ${P.verde}; }
.ficha { margin-top: 4mm; }
`

  return {
    numero,
    html: marco({ titulo: 'Cédula de mascota', numero, fecha: `Expedida: ${expedida}`, cuerpo, extraCss }),
  }
}

/**
 * Punto de entrada de la ruta. Devuelve { pdf, archivo } o lanza con `status`
 * si la compra o la línea no existen.
 */
export async function cedulaMascotaPdf({ compraId, itemId, foto }) {
  if (!UUID.test(String(compraId || '')) || !UUID.test(String(itemId || ''))) {
    const e = new Error('Falta la compra o la línea'); e.status = 400; throw e
  }
  const [r, fotoImg] = await Promise.all([cargarCedula(compraId, itemId), resolverFoto(foto)])
  if (!r) { const e = new Error('No existe esa línea en esa compra'); e.status = 404; throw e }
  const { html, numero } = htmlCedulaMascota({ r, foto: fotoImg })
  const pdf = await renderPdf({ html, formato: 'A4' })
  const archivo = `Cedula_${String(r.mascota || 'mascota').replace(/[^\w.-]+/g, '_')}_${numero}.pdf`
  return { pdf, archivo }
}
