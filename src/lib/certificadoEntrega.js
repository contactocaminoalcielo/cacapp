import { fmt, petEmoji } from '@/lib/utils'

const EMPRESA = {
  nombre:    'Camino al Cielo',
  subtitulo: 'Funeraria para mascotas',
  nit:       '901792845-5',
  direccion: 'Calle 57 # 80-86 Los Monjes, Engativá',
  ciudad:    'Bogotá D.C.',
  telefono:  '319 358 5508',
  email:     'contacto@caminoalcielo.com.co',
  web:       'www.caminoalcielo.com.co',
}

// Genera y descarga el certificado de entrega
export async function generarCertificadoEntrega({ svc, entrega, mensajero, items, firmaDataUrl = null }) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, M = 15, CW = W - M * 2
  const G = [31, 90, 50]

  const t = (text, x, y, opts = {}) => pdf.text(String(text ?? ''), x, y, opts)
  const sec = (label, y) => {
    pdf.setFillColor(232, 243, 235); pdf.rect(M, y, CW, 6, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...G)
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

  const mascota = svc?.mascotas || svc?.mascota
  const cliente = mascota?.clientes || mascota?.cliente
  const numero  = `CAC-${(svc?.fecha_ingreso || '').slice(0,4) || new Date().getFullYear()}${(svc?.fecha_ingreso || '').slice(5,7) || String(new Date().getMonth()+1).padStart(2,'0')}-${(svc?.id || '').slice(0,6).toUpperCase()}`
  const fechaEntrega = entrega?.fecha_realizada
    ? new Date(entrega.fecha_realizada + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })
    : new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })

  // ── Cabecera ──────────────────────────────────────────────────────────────
  pdf.setFillColor(...G); pdf.rect(0, 0, W, 36, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20); pdf.setTextColor(255, 255, 255)
  t(EMPRESA.nombre, W / 2, 12, { align: 'center' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(176, 212, 188)
  t(`${EMPRESA.subtitulo}  ·  ${EMPRESA.ciudad}`, W / 2, 18.5, { align: 'center' })
  t(`NIT ${EMPRESA.nit}  ·  ${EMPRESA.direccion}`, W / 2, 24, { align: 'center' })
  t(`${EMPRESA.telefono}  ·  ${EMPRESA.email}  ·  ${EMPRESA.web}`, W / 2, 29.5, { align: 'center' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(196, 168, 122)
  t('CERTIFICADO DE ENTREGA', W / 2, 34, { align: 'center' })

  // Número y fecha
  pdf.setFillColor(244, 247, 244); pdf.rect(0, 36, W, 11, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...G)
  t(`No. ${numero}`, M, 43.5)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80)
  t(`Fecha de entrega: ${fechaEntrega}`, W - M, 43.5, { align: 'right' })

  let y = 52

  // Mascota y cliente
  y = sec('DATOS DE LA MASCOTA Y PROPIETARIO', y)
  const yMC = y
  field('Mascota', mascota?.nombre || '—', M, y)
  field('Especie', mascota?.especies?.nombre || '—', M + CW / 2, y)
  y = yMC + 12
  const yC = y
  y = Math.max(
    field('Propietario', `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim() || '—', M, yC, CW / 2 - 3),
    yC + 10
  )
  field('Plan / Servicio', svc?.planes?.nombre || '—', M + CW / 2, yC)
  y = hr(y)

  // Ítems: separados en entregados físicamente vs enviados digitalmente.
  // Los digitales (categoria='digital') se envían electrónicamente y NO requieren
  // entrega física — dejarlo claro evita confusiones al firmar el recibido.
  if (items && items.length > 0) {
    const nonNA = items.filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO')
    const esDigital = i => (i.recordatorios?.categoria || i.categoria) === 'digital'
    const fisicos   = nonNA.filter(i => !esDigital(i))
    const digitales = nonNA.filter(i => esDigital(i))

    const grupoItems = (titulo, lista, startY) => {
      let yy = sec(titulo, startY)
      const colW = (CW - 4) / 2
      let col = 0, rowY = yy, maxY = yy
      lista.forEach(item => {
        const x = col === 0 ? M : M + colW + 4
        pdf.setFillColor(col === 0 ? 248 : 244, col === 0 ? 252 : 247, col === 0 ? 248 : 244)
        pdf.rect(x, rowY - 1.5, colW, 9, 'F')
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...G)
        const nombre = item.recordatorios?.nombre || item.nombre || 'Ítem'
        const nlines = pdf.splitTextToSize(nombre, colW - 4)
        pdf.text(nlines, x + 2, rowY + 4)
        const itemH = Math.max(9, nlines.length * 4.5 + 2)
        if (col === 0) { col = 1; maxY = Math.max(maxY, rowY + itemH) }
        else           { col = 0; rowY = maxY + 2; maxY = rowY }
      })
      return maxY + 4
    }

    if (fisicos.length || digitales.length) {
      if (fisicos.length)   y = grupoItems('ENTREGADOS FÍSICAMENTE', fisicos, y)
      if (digitales.length) y = grupoItems('ENVIADOS DIGITALMENTE (no requieren entrega física)', digitales, y)
      y = hr(y)
    }
  }

  // Datos de entrega
  y = sec('DATOS DE ENTREGA', y)
  y = Math.max(field('Dirección de entrega', entrega?.direccion_entrega || '—', M, y, CW), y + 10)

  let yr = y
  field('Barrio', entrega?.barrio || '—', M, yr)
  field('Localidad', entrega?.localidad || '—', M + CW / 2, yr)
  y = yr + 12

  yr = y
  field('Ciudad', entrega?.ciudad || '—', M, yr)
  field('Tipo de entrega', entrega?.tipo_entrega || 'DOMICILIO', M + CW / 2, yr)
  y = yr + 12

  yr = y
  field('Quién recibe', entrega?.contacto_nombre || '—', M, yr)
  const tels = [entrega?.contacto_telefono, entrega?.telefono_adicional].filter(Boolean).join('   ·   ') || '—'
  field('Teléfono(s)', tels, M + CW / 2, yr)
  y = yr + 12

  if (entrega?.horarios_atencion) {
    y = Math.max(field('Horarios a tener en cuenta', entrega.horarios_atencion, M, y, CW), y + 10)
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7); pdf.setTextColor(140, 140, 140)
    t('No corresponde a una hora exacta de entrega confirmada.', M, y)
    y += 5
  }
  if (entrega?.indicaciones) {
    y = Math.max(field('Instrucciones', entrega.indicaciones, M, y, CW), y + 10)
  }
  if (mensajero) {
    field('Mensajero / Técnico', `${mensajero.nombre} ${mensajero.apellido}`, M, y)
    y += 12
  }
  y = hr(y)

  // Estado de pago
  y = sec('ESTADO DE PAGO', y)
  const saldo = Math.max(0, (svc?.valor_total || 0) - (svc?.valor_pagado || 0))
  const bw3 = saldo > 0 ? (CW - 6) / 3 : (CW - 4) / 2
  const drawBox = (label, value, x, yy, col) => {
    pdf.setDrawColor(196, 168, 122); pdf.setLineWidth(0.4)
    pdf.setFillColor(255, 253, 248); pdf.rect(x, yy, bw3, 14, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 110, 60)
    t(label.toUpperCase(), x + bw3 / 2, yy + 4.5, { align: 'center' })
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...col)
    t(fmt(Number(value) || 0), x + bw3 / 2, yy + 11, { align: 'center' })
  }
  if (saldo > 0) {
    drawBox('Valor servicio',    svc?.valor_total  || 0, M,              y, G)
    drawBox('Total recibido',    svc?.valor_pagado || 0, M + bw3 + 3,   y, [29, 138, 85])
    drawBox('Saldo en entrega',  saldo,                  M + (bw3+3)*2, y, [192, 48, 48])
  } else {
    drawBox('Valor servicio',    svc?.valor_total  || 0, M,           y, G)
    drawBox('Total pagado',      svc?.valor_pagado || 0, M + bw3 + 4, y, [29, 138, 85])
  }
  y += 18

  if (entrega?.notas) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8); pdf.setTextColor(100, 100, 100)
    const nlines = pdf.splitTextToSize(`Notas: ${entrega.notas}`, CW)
    pdf.text(nlines, M, y); y += nlines.length * 4.5 + 4
  }
  y = hr(y)

  // Firmas
  y = sec('CONSTANCIA DE RECIBIDO', y)
  y += 6

  // Firma cliente (izquierda)
  if (firmaDataUrl) {
    try {
      pdf.addImage(firmaDataUrl, 'PNG', M, y, 80, 25)
    } catch (e) { /* si falla, solo línea */ }
  }
  pdf.setDrawColor(160, 160, 160); pdf.setLineWidth(0.3)
  pdf.line(M, y + 26, M + 82, y + 26)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(100, 100, 100)
  t('Firma y nombre del cliente', M, y + 30)
  const clienteNombre = `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim()
  if (clienteNombre) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(40, 40, 40)
    t(clienteNombre, M, y + 36)
  }

  // Firma mensajero (derecha)
  pdf.setDrawColor(160, 160, 160); pdf.setLineWidth(0.3)
  pdf.line(W - M - 82, y + 26, W - M, y + 26)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(100, 100, 100)
  t('Firma del mensajero / técnico', W - M - 82, y + 30)
  if (mensajero) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(40, 40, 40)
    t(`${mensajero.nombre} ${mensajero.apellido}`, W - M - 82, y + 36)
  }
  y += 44

  // Pie de página
  const footerY = 280
  pdf.setFillColor(...G); pdf.rect(0, footerY, W, 17, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(190, 220, 200)
  t(`${EMPRESA.nombre}  ·  NIT ${EMPRESA.nit}`, W / 2, footerY + 5.5, { align: 'center' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(160, 200, 170)
  t(`${EMPRESA.direccion}, ${EMPRESA.ciudad}`, W / 2, footerY + 10, { align: 'center' })
  t(`${EMPRESA.telefono}  ·  ${EMPRESA.email}  ·  ${EMPRESA.web}`, W / 2, footerY + 14.5, { align: 'center' })

  const mascotaNombre = mascota?.nombre || 'servicio'
  pdf.save(`Certificado_Entrega_${mascotaNombre}_${numero}.pdf`)
}
