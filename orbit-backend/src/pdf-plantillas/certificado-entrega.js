// Certificado de entrega, en HTML con la marca de la empresa.
//
// Reemplaza al que se dibujaba a mano con jsPDF en el navegador
// (src/lib/certificadoEntrega.js, que queda de respaldo). Pedido de David el
// 2026-09-18: «se desordena muy feo; los recordatorios deben ser una lista
// más limpia y no ocupar tanto espacio».
//
// Recibe EXACTAMENTE lo que el frontend ya armaba para el viejo (svc, entrega,
// mensajero, items, firma) para que las tres pantallas que lo generan no
// cambien su consulta. Lo único que se consulta aquí son las plantas del
// compostaje, igual que hacía el viejo, y la firma guardada en storage.
//
// Reglas que se conservan tal cual del certificado anterior:
// - Datos de entrega ANTES de los ítems (David, 2026-07-31).
// - Los digitales se listan aparte: no requieren entrega física.
// - NO es un recibo: solo se muestra lo que se cobra en la puerta (adicionales
//   y plantas extra), topado al saldo real del servicio.
import { pool, log } from '../db.js'
import { renderPdf } from '../pdf.js'
import { marco } from './marco.js'
import { PALETA as P, esc, fmtCOP, fechaLarga, horaCorta } from '../pdf-recursos.js'

const STORAGE_BASE = process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/'

/** Plantas del compostaje: la especie elegida en el portal y los extras comprados. */
async function cargarPlantas(servicioId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(servicioId || ''))) return { eleccion: null, extras: [] }
  try {
    const [e, x] = await Promise.all([
      pool.query(`SELECT pe.estado, pe.planta_nombre, pe.fecha_eleccion, pl.nombre AS planta
                    FROM public.planta_elecciones pe LEFT JOIN public.plantas pl ON pl.id = pe.planta_id
                   WHERE pe.servicio_id = $1 LIMIT 1`, [servicioId]),
      pool.query(`SELECT nombre, cantidad, precio_unitario, total FROM public.planta_adicionales
                   WHERE servicio_id = $1 ORDER BY created_at`, [servicioId]),
    ])
    return { eleccion: e.rows[0] || null, extras: x.rows }
  } catch (err) {
    log('[pdf/entrega] sin plantas:', err.message)
    return { eleccion: null, extras: [] }
  }
}

/**
 * La firma llega como data URL (recién dibujada) o como URL http del storage
 * (al reimprimir). La pestaña no tiene red, así que la http se baja aquí; solo
 * se aceptan URLs de NUESTRO storage.
 */
async function resolverFirma(firma) {
  const s = String(firma || '').trim()
  if (!s) return null
  if (s.startsWith('data:image/')) return s.length < 4_000_000 ? s : null
  if (!s.startsWith(STORAGE_BASE)) return null
  try {
    const r = await fetch(s, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length < 3_000_000 ? `data:${mime};base64,${buf.toString('base64')}` : null
  } catch { return null }
}

const campo = (et, va, ancho = false) =>
  `<div class="campo${ancho ? ' ancho' : ''}"><div class="et">${esc(et)}</div><div class="va">${esc(va || '—')}</div></div>`

/** El número del certificado, igual que lo calculaba el viejo. */
function numeroCertificado(svc) {
  const f = String(svc?.fecha_ingreso || '')
  const hoy = new Date()
  const aa = f.slice(0, 4) || String(hoy.getFullYear())
  const mm = f.slice(5, 7) || String(hoy.getMonth() + 1).padStart(2, '0')
  return `CAC-${aa}${mm}-${String(svc?.id || '').slice(0, 6).toUpperCase()}`
}

export function htmlCertificadoEntrega({ svc, entrega, mensajero, items, firma, plantas }) {
  const mascota = svc?.mascotas || svc?.mascota || {}
  const cliente = mascota?.clientes || mascota?.cliente || {}
  const clienteNombre = `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim()
  const mensajeroNombre = mensajero ? `${mensajero.nombre || ''} ${mensajero.apellido || ''}`.trim() : ''
  const numero = numeroCertificado(svc)
  const fechaEntrega = fechaLarga(entrega?.fecha_realizada) || fechaLarga(new Date().toISOString())

  // ── Ítems: lista compacta, sin cajas ─────────────────────────────────────
  const vivos = (items || []).filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO')
  const esDigital = i => (i.recordatorios?.categoria || i.categoria) === 'digital'
  const nombreDe  = i => i.recordatorios?.nombre || i.nombre || 'Ítem'
  const fisicos   = vivos.filter(i => !esDigital(i))
  const digitales = vivos.filter(esDigital)
  const lista = (arr, clase = '') => `<ul class="items ${clase}">${arr.map(i =>
    `<li>${esc(nombreDe(i))}${i.origen === 'ADICIONAL' ? '<span class="tag">adicional</span>' : ''}</li>`).join('')}</ul>`

  // ── Adicionales por cobrar en la puerta (nunca el plan) ───────────────────
  const extras = plantas?.extras || []
  const saldoServicio = Math.max(0, (Number(svc?.valor_total) || 0) - (Number(svc?.valor_pagado) || 0))
  const lineasCobro = [
    ...vivos.filter(i => i.origen === 'ADICIONAL').map(i => ({
      nombre: nombreDe(i), valor: Number(i.precio_cobrado ?? i.subtotal) || 0,
    })),
    ...extras.map(p => ({
      nombre: `Planta adicional: ${p.nombre}${(Number(p.cantidad) || 1) > 1 ? ` ×${p.cantidad}` : ''}`,
      valor: Number(p.total) || 0,
    })),
  ].filter(l => l.valor > 0)
  const totalAdicionales = lineasCobro.reduce((s, l) => s + l.valor, 0)
  const saldo = Math.min(totalAdicionales, saldoServicio)

  const especie = plantas?.eleccion?.planta_nombre || plantas?.eleccion?.planta || null
  const telefonos = [entrega?.contacto_telefono, entrega?.telefono_adicional].filter(Boolean).join('  ·  ')

  const cuerpo = `
<div class="bloque">
  <div class="sec">Datos de la mascota y propietario</div>
  <div class="grid2">
    ${campo('Mascota', mascota?.nombre)}
    ${campo('Especie', mascota?.especies?.nombre)}
    ${campo('Propietario', clienteNombre)}
    ${campo('Plan / servicio', svc?.planes?.nombre)}
  </div>
</div>

<div class="bloque">
  <div class="sec">Datos de entrega</div>
  <div class="grid2">
    ${campo('Dirección de entrega', entrega?.direccion_entrega, true)}
    ${campo('Barrio', entrega?.barrio)}
    ${campo('Localidad', entrega?.localidad)}
    ${campo('Ciudad', entrega?.ciudad)}
    ${campo('Tipo de entrega', entrega?.tipo_entrega || 'DOMICILIO')}
    ${campo('Quién recibe', entrega?.contacto_nombre)}
    ${campo('Teléfono(s)', telefonos)}
    ${(entrega?.hora_realizada || entrega?.aceptada_en)
      ? campo('Salió a entregar', horaCorta(entrega?.aceptada_en)) + campo('Hora de entrega', horaCorta(entrega?.hora_realizada)) : ''}
    ${entrega?.horarios_atencion ? campo('Horarios a tener en cuenta', entrega.horarios_atencion, true)
      + `<div class="campo ancho nota" style="margin-top:-1.5mm">No corresponde a una hora exacta de entrega confirmada.</div>` : ''}
    ${entrega?.indicaciones ? campo('Instrucciones', entrega.indicaciones, true) : ''}
    ${mensajeroNombre ? campo('Mensajero / técnico', mensajeroNombre, true) : ''}
  </div>
</div>

${(fisicos.length || digitales.length) ? `
<div class="bloque">
  <div class="sec">Recordatorios entregados</div>
  ${fisicos.length ? `<div class="sub">Entregados físicamente <span>${fisicos.length}</span></div>${lista(fisicos)}` : ''}
  ${digitales.length ? `<div class="sub">Enviados digitalmente <span>${digitales.length}</span> <i>no requieren entrega física</i></div>${lista(digitales, 'dig')}` : ''}
</div>` : ''}

${(plantas?.eleccion || extras.length) ? `
<div class="bloque">
  <div class="sec">Plantas del compostaje</div>
  <div class="grid2">
    ${campo('Especie elegida por la familia', especie || 'Sin elegir')}
    ${campo('Fecha de elección', especie ? fechaLarga(plantas.eleccion?.fecha_eleccion) : '—')}
  </div>
  ${extras.length ? `<table class="tabla" style="margin-top:2.5mm"><tbody>${extras.map(p =>
    `<tr><td>${esc(p.nombre)}${(Number(p.cantidad) || 1) > 1 ? ` <span class="tag">×${esc(p.cantidad)}</span>` : ''}</td><td class="der">${fmtCOP(p.total)}</td></tr>`).join('')}</tbody></table>` : ''}
</div>` : ''}

${saldo > 0 ? `
<div class="bloque cobro">
  <div class="cobro-t">Adicionales por cobrar en la entrega</div>
  <table class="tabla"><tbody>
    ${lineasCobro.map(l => `<tr><td>${esc(l.nombre)}</td><td class="der">${fmtCOP(l.valor)}</td></tr>`).join('')}
    ${lineasCobro.length > 1 ? `<tr class="suma"><td>Suma de adicionales</td><td class="der">${fmtCOP(totalAdicionales)}</td></tr>` : ''}
    <tr class="total"><td>TOTAL A COBRAR</td><td class="der">${fmtCOP(saldo)}</td></tr>
  </tbody></table>
  ${saldo < totalAdicionales ? `<div class="nota" style="margin-top:1.5mm">El servicio ya tiene abonos aplicados: se cobra solo el saldo pendiente.</div>` : ''}
</div>` : ''}

${entrega?.notas ? `<div class="bloque nota">Notas: ${esc(entrega.notas)}</div>` : ''}

<div class="bloque firmas">
  <div class="sec">Constancia de recibido</div>
  <div class="firmas-g">
    <div class="firma">
      <div class="firma-img">${firma ? `<img src="${firma}" alt="">` : ''}</div>
      <div class="firma-l"></div>
      <div class="firma-et">Firma y nombre del cliente</div>
      ${clienteNombre ? `<div class="firma-n">${esc(clienteNombre)}</div>` : ''}
    </div>
    <div class="firma">
      <div class="firma-img"></div>
      <div class="firma-l"></div>
      <div class="firma-et">Firma del mensajero / técnico</div>
      ${mensajeroNombre ? `<div class="firma-n">${esc(mensajeroNombre)}</div>` : ''}
    </div>
  </div>
</div>`

  const extraCss = `
/* Recordatorios: tres columnas, una línea por ítem, viñeta dorada. */
.sub { font-size: 8px; font-weight: 800; color: ${P.verde}; letter-spacing: .6px; text-transform: uppercase; margin: 1.2mm 0 1mm; }
.sub span { display: inline-block; min-width: 4.5mm; padding: 0 1.3mm; margin-left: 1mm; border-radius: 2mm; background: ${P.verde}; color: #fff; text-align: center; font-size: 7.5px; }
.sub i { font-weight: 600; color: ${P.gris}; text-transform: none; letter-spacing: 0; margin-left: 1.5mm; }
.items { list-style: none; margin: 0 0 1.5mm; padding: 0; columns: 3; column-gap: 5mm; }
.items li { break-inside: avoid; padding: .55mm 0 .55mm 3.4mm; position: relative; font-size: 9.6px; line-height: 1.3; border-bottom: 0.2mm dotted ${P.verdeLinea}; }
.items li::before { content: ''; position: absolute; left: 0; top: 2.35mm; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: ${P.dorado}; }
.items.dig li::before { background: ${P.grisClaro}; }
.tag { display: inline-block; margin-left: 1.2mm; padding: 0 1.1mm; border-radius: 1mm; background: ${P.doradoSuave}; color: #8A6D3B; font-size: 7px; font-weight: 700; vertical-align: middle; }
.tabla { width: 100%; border-collapse: collapse; }
.tabla td { padding: 1.2mm 1.5mm; border-bottom: 0.2mm solid ${P.verdeLinea}; font-size: 9.6px; }
.tabla td.der { text-align: right; white-space: nowrap; font-weight: 700; }
.cobro { border: 0.35mm solid ${P.dorado}; background: ${P.doradoSuave}; border-radius: 1.5mm; padding: 3mm 4mm; }
.cobro-t { font-size: 8px; font-weight: 800; color: #8A6D3B; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 1.5mm; }
.cobro .tabla td { border-color: #E6D9BF; }
.cobro tr.suma td { color: ${P.gris}; font-size: 8.8px; }
.cobro tr.total td { border: 0; padding-top: 2mm; font-weight: 800; font-size: 9px; color: #8A6D3B; letter-spacing: .8px; }
.cobro tr.total td.der { font-size: 14px; color: ${P.rojo}; }
.firmas-g { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12mm; margin-top: 3mm; }
.firma-img { height: 18mm; display: flex; align-items: flex-end; }
.firma-img img { max-height: 18mm; max-width: 70mm; }
.firma-l { border-top: 0.3mm solid ${P.grisClaro}; margin-top: 1mm; }
.firma-et { font-size: 7.6px; color: ${P.gris}; margin-top: 1.2mm; }
.firma-n { font-size: 9px; font-weight: 700; margin-top: .6mm; }
`

  return {
    numero,
    html: marco({ titulo: 'Certificado de entrega', numero, fecha: `Fecha de entrega: ${fechaEntrega}`, cuerpo, extraCss }),
  }
}

/**
 * Punto de entrada de la ruta: arma los datos que faltan, imprime y devuelve
 * el PDF con el nombre de archivo sugerido.
 */
export async function certificadoEntregaPdf({ svc, entrega, mensajero, items, firma }) {
  const [plantas, firmaImg] = await Promise.all([
    cargarPlantas(svc?.id),
    resolverFirma(firma || entrega?.foto_firma_url),
  ])
  const { html, numero } = htmlCertificadoEntrega({ svc, entrega, mensajero, items, firma: firmaImg, plantas })
  const pdf = await renderPdf({ html, formato: 'A4' })
  const mascota = (svc?.mascotas || svc?.mascota)?.nombre || 'servicio'
  const archivo = `Certificado_Entrega_${String(mascota).replace(/[^\w.-]+/g, '_')}_${numero}.pdf`
  return { pdf, archivo }
}
