import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'

// ── Datos fijos del negocio ────────────────────────────────────────────────────
export const EMPRESA = {
  nombre:    'Camino al Cielo',
  subtitulo: 'Funeraria para mascotas',
  nit:       '901792845-5',
  direccion: 'Calle 57 # 80-86 Los Monjes, Engativá',
  ciudad:    'Bogotá D.C.',
  telefono:  '319 358 5508',
  email:     'contacto@caminoalcielo.com.co',
  web:       'www.caminoalcielo.com.co',
  pagos: [
    { label: 'Nequi',               numero: '313 266 6356' },
    { label: 'Daviplata',           numero: '313 266 6356' },
    { label: 'Cta. Ahorros Bancolombia', numero: '200 958 666 04' },
  ],
  factura: 'Si desea factura electrónica comuníquese al 319 358 5508',
}

// Arma los campos del recibo a partir del servicio (mismo modelo que el módulo
// Recibos y el recibo que envía el técnico).
export function buildReciboData(svc, pesoConfirmado) {
  const mascota = svc.mascotas
  const cliente = mascota?.clientes
  const saldo   = Math.max(0, (svc.valor_total || 0) - (svc.valor_pagado || 0))
  const numero  = `CAC-${svc.fecha_ingreso?.slice(0,4) || new Date().getFullYear()}${svc.fecha_ingreso?.slice(5,7) || String(new Date().getMonth()+1).padStart(2,'0')}-${svc.id.slice(0,6).toUpperCase()}`
  const fecha   = svc.fecha_ingreso
    ? new Date(svc.fecha_ingreso + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' })
    : new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' })
  return {
    numero, fecha, saldo,
    mascota_nombre: mascota?.nombre || '',
    especie:        mascota?.especies?.nombre || '',
    peso:           pesoConfirmado || mascota?.peso_kg || '',
    veterinaria:    svc.aliados?.nombre || '',
    propietario:    `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim(),
    email:          cliente?.email || '',
    telefono:       cliente?.telefono || cliente?.telefono2 || cliente?.whatsapp || '',
    direccion:      svc.direccion_recogida || '',
    servicio:       svc.planes?.nombre || '',
    valor_total:              svc.valor_total  || 0,
    valor_pagado:             svc.valor_pagado || 0,
    metodo_pago:              svc.metodo_pago  || '',
    tecnico:                  svc.tecnico ? `${svc.tecnico.nombre} ${svc.tecnico.apellido}` : '',
    estado_pago:              svc.estado_pago,
    descuento_adicional:      svc.descuento_adicional || 0,
    descuento_adicional_motivo: svc.descuento_adicional_motivo || '',
  }
}

// Campos del servicio que necesita buildReciboData. Reutilizado por el módulo
// Recibos y por la generación al vuelo desde el cuadre.
export const SELECT_RECIBO_SVC = `
  id, valor_total, valor_pagado, estado_pago, metodo_pago,
  descuento_adicional, descuento_adicional_motivo,
  fecha_ingreso, direccion_recogida, ciudad_recogida,
  mascotas:mascota_id(
    nombre, peso_kg,
    especies(nombre),
    clientes:cliente_id(nombre, apellido, email, telefono, telefono2, whatsapp, direccion, ciudad)
  ),
  planes:plan_id(nombre, codigo),
  aliados:aliado_origen_id(nombre),
  tecnico:tecnico_id(id, nombre, apellido)
`

// Genera el PDF del recibo. `abrir:true` devuelve un object URL (para abrirlo en
// una pestaña) en vez de descargarlo con pdf.save().
export async function generarReciboPDF(svc, pesoConfirmado, { abrir = false } = {}) {
  const r = buildReciboData(svc, pesoConfirmado)
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, M = 15, CW = W - M * 2

  const t     = (text, x, y, opts = {}) => pdf.text(String(text ?? ''), x, y, opts)
  const sec   = (label, y) => {
    pdf.setFillColor(232, 243, 235); pdf.rect(M, y, CW, 6, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(31, 90, 50)
    t(label, M + 2, y + 4.2); return y + 8
  }
  const field = (label, value, x, y, w = CW / 2 - 3) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 140, 140)
    t(label.toUpperCase(), x, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(25, 25, 25)
    const lines = pdf.splitTextToSize(value || '—', w)
    pdf.text(lines, x, y + 4.5)
    return y + 4.5 + lines.length * 4.5
  }
  const hr = (y) => {
    pdf.setDrawColor(210, 225, 215); pdf.setLineWidth(0.25)
    pdf.line(M, y, W - M, y); return y + 4
  }

  // ── Cabecera ──────────────────────────────────────────────────────────────
  pdf.setFillColor(31, 90, 50); pdf.rect(0, 0, W, 36, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(255, 255, 255)
  t(EMPRESA.nombre, W / 2, 12, { align: 'center' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(176, 212, 188)
  t(`${EMPRESA.subtitulo}  ·  ${EMPRESA.ciudad}`, W / 2, 18.5, { align: 'center' })
  t(`NIT ${EMPRESA.nit}  ·  ${EMPRESA.direccion}`, W / 2, 24, { align: 'center' })
  t(`${EMPRESA.telefono}  ·  ${EMPRESA.email}  ·  ${EMPRESA.web}`, W / 2, 29.5, { align: 'center' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(196, 168, 122)
  t('RECIBO DE SERVICIO', W / 2, 34, { align: 'center' })

  // Número y fecha
  pdf.setFillColor(244, 247, 244); pdf.rect(0, 36, W, 11, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(31, 90, 50)
  t(`No. ${r.numero}`, M, 43.5)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80)
  t(`Fecha: ${r.fecha}`, W - M, 43.5, { align: 'right' })

  let y = 52

  // Mascota
  y = sec('DATOS DE LA MASCOTA', y)
  const yM = y
  field('Mascota', r.mascota_nombre, M, y)
  field('Especie', r.especie, M + CW / 2, y)
  y = yM + 12
  field('Peso', r.peso ? `${r.peso} kg` : '—', M, y)
  field('Veterinaria / Aliado', r.veterinaria, M + CW / 2, y)
  y += 13; y = hr(y)

  // Propietario
  y = sec('DATOS DEL PROPIETARIO', y)
  const yP = y
  y = Math.max(field('Nombre completo', r.propietario, M, yP, CW), yP + 10)
  const yP2 = y
  field('Teléfono', r.telefono, M, yP2)
  y = yP2 + 12
  y = Math.max(field('Dirección de recogida', r.direccion, M, y, CW), y + 10)
  y = hr(y)

  // Servicio
  y = sec('SERVICIO CONTRATADO', y)
  y = Math.max(field('Plan / Servicio', r.servicio, M, y, CW), y + 10)
  if (r.descuento_adicional > 0) {
    const label = `Descuento${r.descuento_adicional_motivo ? ': ' + r.descuento_adicional_motivo : ' adicional'}`
    pdf.setFillColor(255, 247, 237); pdf.setDrawColor(253, 215, 170); pdf.setLineWidth(0.3)
    pdf.rect(M, y, CW, 8, 'FD')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(146, 64, 14)
    t(label, M + 3, y + 5.2)
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(194, 65, 12)
    t(`- ${fmt(r.descuento_adicional)}`, W - M, y + 5.2, { align: 'right' })
    y += 10
  }
  const bw = (CW - 4) / 2
  const drawBox = (label, value, x, yy, col) => {
    pdf.setDrawColor(196, 168, 122); pdf.setLineWidth(0.4)
    pdf.setFillColor(255, 253, 248); pdf.rect(x, yy, bw, 14, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 110, 60)
    t(label.toUpperCase(), x + bw / 2, yy + 4.5, { align: 'center' })
    const [r1,g1,b1] = col || [31,90,50]
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(r1,g1,b1)
    t(fmt(Number(value) || 0), x + bw / 2, yy + 11, { align: 'center' })
  }
  const bw3 = r.saldo > 0 ? (CW - 6) / 3 : bw
  if (r.saldo > 0) {
    drawBox('Valor del servicio', r.valor_total,  M,            y, [31,90,50])
    drawBox('Total recibido',     r.valor_pagado, M + bw3 + 3,  y, [29,138,85])
    drawBox('Saldo pendiente',    r.saldo,        M + (bw3+3)*2, y, [192,48,48])
  } else {
    drawBox('Valor del servicio', r.valor_total,  M,          y, [31,90,50])
    drawBox('Total recibido',     r.valor_pagado, M + bw + 4, y, [29,138,85])
  }
  y += 18
  if (r.metodo_pago) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100,100,100)
    t(`Método de pago: ${r.metodo_pago}`, M, y); y += 5
  }
  if (r.tecnico) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100,100,100)
    t(`Técnico: ${r.tecnico}`, M, y); y += 5
  }
  y = hr(y)

  // Datos de pago
  y = sec('DATOS DE PAGO / TRANSFERENCIA', y)
  EMPRESA.pagos.forEach(p => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80,80,80)
    t(p.label, M, y)
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(31,90,50)
    t(p.numero, W - M, y, { align: 'right' })
    y += 5.5
  })
  y += 2
  pdf.setFillColor(255, 249, 237); pdf.setDrawColor(253, 230, 138)
  pdf.setLineWidth(0.3); pdf.rect(M, y, CW, 8, 'FD')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(146,64,14)
  t(EMPRESA.factura, W / 2, y + 5.2, { align: 'center' })
  y += 12; y = hr(y)

  // Pie de página
  const footerY = 280
  pdf.setFillColor(31, 90, 50); pdf.rect(0, footerY, W, 17, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(190,220,200)
  t(`${EMPRESA.nombre}  ·  NIT ${EMPRESA.nit}`, W / 2, footerY + 5.5, { align: 'center' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(160,200,170)
  t(`${EMPRESA.direccion}, ${EMPRESA.ciudad}`, W / 2, footerY + 10, { align: 'center' })
  t(`${EMPRESA.telefono}  ·  ${EMPRESA.email}  ·  ${EMPRESA.web}`, W / 2, footerY + 14.5, { align: 'center' })

  if (abrir) return URL.createObjectURL(pdf.output('blob'))
  pdf.save(`Recibo_${r.mascota_nombre || 'servicio'}_${r.numero}.pdf`)
  return null
}

// Genera el recibo AL VUELO desde la DB y lo abre en una pestaña nueva. Se usa
// como respaldo cuando el servicio no tiene un PDF guardado en storage (los
// recibos previos al 9-jul solo lo tienen si el técnico los envió por WhatsApp).
// Devuelve false si no se pudo (servicio inexistente o error).
export async function abrirReciboPDFServicio(servicioId) {
  if (!servicioId) return false
  const w = window.open('', '_blank')
  try {
    const { data: svc, error } = await db.from('servicios')
      .select(SELECT_RECIBO_SVC).eq('id', servicioId).single()
    if (error || !svc) { if (w) w.close(); return false }
    // El peso confirmado en báscula (si lo hay) prevalece sobre el de la mascota.
    const { data: cf } = await db.from('cuarto_frio')
      .select('peso_kg').eq('servicio_id', servicioId).maybeSingle()
    const url = await generarReciboPDF(svc, cf?.peso_kg || null, { abrir: true })
    if (!url) { if (w) w.close(); return false }
    if (w) w.location = url
    else window.open(url, '_blank', 'noopener')
    return true
  } catch {
    if (w) w.close()
    return false
  }
}
