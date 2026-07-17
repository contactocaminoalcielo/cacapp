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

const fmtFechaISO = iso => iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : ''

// Arma los campos del recibo a partir del SERVICIO (reconstrucción: útil para
// reimprimir desde el módulo Recibos). No es el snapshot exacto del técnico.
export function buildReciboData(svc, pesoConfirmado) {
  const mascota = svc.mascotas
  const cliente = mascota?.clientes
  const saldo   = Math.max(0, (svc.valor_total || 0) - (svc.valor_pagado || 0))
  const numero  = `CAC-${svc.fecha_ingreso?.slice(0,4) || new Date().getFullYear()}${svc.fecha_ingreso?.slice(5,7) || String(new Date().getMonth()+1).padStart(2,'0')}-${svc.id.slice(0,6).toUpperCase()}`
  return {
    numero, saldo,
    tipo:           'CLIENTE',
    fecha:          fmtFechaISO(svc.fecha_ingreso) || new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' }),
    hora:           '',
    mascota_nombre: mascota?.nombre || '',
    especie:        mascota?.especies?.nombre || '',
    peso:           pesoConfirmado || mascota?.peso_kg || '',
    veterinaria:    svc.aliados?.nombre || '',
    propietario:    `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim(),
    email:          cliente?.email || '',
    telefono:       cliente?.telefono || cliente?.telefono2 || cliente?.whatsapp || '',
    direccion:      svc.direccion_recogida || '',
    servicio:       svc.planes?.nombre || '',
    valor_total:    svc.valor_total  || 0,
    valor_pagado:   svc.valor_pagado || 0,
    metodo_pago:    svc.metodo_pago  || '',
    medios:         null,
    pago_pendiente: false,
    tecnico:        svc.tecnico ? `${svc.tecnico.nombre} ${svc.tecnico.apellido}` : '',
    descuento_adicional:        svc.descuento_adicional || 0,
    descuento_adicional_motivo: svc.descuento_adicional_motivo || '',
  }
}

// Arma los campos desde el RECIBO REAL que guardó el técnico (recibos_tecnico):
// número, fecha/hora de emisión, valor cobrado y desglose de medios exactos, más
// el snapshot del formulario en datos_form (mascota, propietario, plan, etc.).
export function buildReciboDataDesdeRecibo(recibo) {
  const d = recibo.datos_form || {}
  const medios = (Array.isArray(recibo.medios_pago) ? recibo.medios_pago : [])
    .filter(m => Number(m.monto) > 0)
  const valorTotal  = Number(recibo.valor_total)   || Number(d.valor_servicio) || 0
  const valorPagado = Number(recibo.valor_cobrado) || Number(d.total_recibido) || 0
  return {
    numero:         recibo.numero_recibo || d.numero_recibo || '',
    tipo:           recibo.tipo || 'CLIENTE',
    fecha:          fmtFechaISO(recibo.fecha_emision) || d.fecha || '',
    hora:           recibo.hora_emision ? String(recibo.hora_emision).slice(0, 5) : (d.hora || ''),
    mascota_nombre: d.mascota_nombre || '',
    especie:        d.especie || '',
    peso:           d.peso || '',
    veterinaria:    d.veterinaria || '',
    propietario:    d.propietario || '',
    email:          d.email || '',
    telefono:       d.telefono || '',
    direccion:      d.casa || '',
    servicio:       d.servicio || '',
    valor_total:    valorTotal,
    valor_pagado:   valorPagado,
    metodo_pago:    '',
    medios,
    pago_pendiente: String(d.pago_pendiente) === 'true' || d.pago_pendiente === true,
    tecnico:        '',
    saldo:          Math.max(0, valorTotal - valorPagado),
    descuento_adicional:        0,
    descuento_adicional_motivo: '',
  }
}

// Campos del servicio que necesita buildReciboData (reconstrucción / respaldo).
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

// Dibuja el PDF a partir del objeto de datos `r` (venga del recibo real o del
// servicio). `abrir:true` devuelve un object URL en vez de descargar.
export async function renderReciboPDF(r, { abrir = false } = {}) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, M = 15, CW = W - M * 2
  const esVet = r.tipo === 'VETERINARIA'

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
  t(esVet ? 'RECIBO VETERINARIA / ALIADO' : 'RECIBO DE SERVICIO', W / 2, 34, { align: 'center' })

  // Número y fecha
  pdf.setFillColor(244, 247, 244); pdf.rect(0, 36, W, 11, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(31, 90, 50)
  t(`No. ${r.numero}${esVet ? '-VET' : ''}`, M, 43.5)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80)
  t(`Fecha: ${r.fecha}${r.hora ? `  Hora: ${r.hora}` : ''}`, W - M, 43.5, { align: 'right' })

  let y = 52

  // Banner de pago pendiente (recibo generado sin cobro)
  if (r.pago_pendiente) {
    pdf.setFillColor(254, 243, 199); pdf.setDrawColor(251, 191, 36)
    pdf.setLineWidth(0.6); pdf.rect(M, y, CW, 12, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(146, 64, 14)
    t('PAGO PENDIENTE', W / 2, y + 5, { align: 'center' })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(180, 100, 20)
    t('El cliente liquidará el valor del servicio posteriormente', W / 2, y + 9.5, { align: 'center' })
    y += 16
  }

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
  y = sec('SERVICIO Y PAGO', y)
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
  // Desglose real de medios de pago (efectivo/Nequi/…) si viene del recibo real;
  // si no, la cadena metodo_pago del servicio.
  if (r.medios && r.medios.length) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 110, 60)
    t('MEDIOS DE PAGO', M, y); y += 4.5
    r.medios.forEach(mp => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(60, 60, 60)
      t(String(mp.metodo || '').toUpperCase() + (mp.referencia ? ` · Ref. ${mp.referencia}` : ''), M, y)
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(31, 90, 50)
      t(fmt(Number(mp.monto) || 0), W - M, y, { align: 'right' })
      y += 5
    })
  } else if (r.metodo_pago) {
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

// Genera el recibo desde el SERVICIO (reconstrucción). Lo usa el módulo Recibos.
export async function generarReciboPDF(svc, pesoConfirmado, opts = {}) {
  return renderReciboPDF(buildReciboData(svc, pesoConfirmado), opts)
}

// Elige el recibo que "cuenta" del servicio (regla migración 027, priorizando el
// documento CLIENTE): el CLIENTE con dinero más reciente; si no hay, el CLIENTE
// más reciente; si tampoco, cualquiera con dinero; en último caso, el más reciente.
function elegirReciboReal(recs) {
  const ordenados = [...(recs || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const cli = ordenados.filter(r => r.tipo === 'CLIENTE')
  return cli.find(r => (r.valor_cobrado || 0) > 0) || cli[0]
    || ordenados.find(r => (r.valor_cobrado || 0) > 0) || ordenados[0] || null
}

// Abre en una pestaña nueva el recibo de un servicio: si el técnico guardó un
// recibo (recibos_tecnico), reproduce ESE (número, fecha, valor cobrado y medios
// reales); si no existe ninguno, reconstruye desde el servicio como respaldo.
// Devuelve false si no se pudo generar.
export async function abrirReciboPDFServicio(servicioId) {
  if (!servicioId) return false
  const w = window.open('', '_blank')
  try {
    const { data: recs } = await db.from('recibos_tecnico')
      .select('numero_recibo, tipo, fecha_emision, hora_emision, valor_total, valor_cobrado, medios_pago, datos_form, created_at')
      .eq('servicio_id', servicioId)
      .order('created_at', { ascending: false })

    let r = null
    const real = elegirReciboReal(recs)
    if (real) {
      r = buildReciboDataDesdeRecibo(real)
    } else {
      // Respaldo: no hay recibo guardado → reconstruir desde el servicio.
      const { data: svc } = await db.from('servicios')
        .select(SELECT_RECIBO_SVC).eq('id', servicioId).single()
      if (!svc) { if (w) w.close(); return false }
      const { data: cf } = await db.from('cuarto_frio')
        .select('peso_kg').eq('servicio_id', servicioId).maybeSingle()
      r = buildReciboData(svc, cf?.peso_kg || null)
    }

    const url = await renderReciboPDF(r, { abrir: true })
    if (!url) { if (w) w.close(); return false }
    if (w) w.location = url
    else window.open(url, '_blank', 'noopener')
    return true
  } catch {
    if (w) w.close()
    return false
  }
}
