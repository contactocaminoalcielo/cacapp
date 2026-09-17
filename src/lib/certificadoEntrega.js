import { fmt } from '@/lib/utils'
import { db } from '@/lib/supabase'

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

// Hora legible de un timestamptz
const hhmm = (ts) => {
  try { return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) }
  catch (_) { return '—' }
}

// La firma llega de dos formas: recién dibujada (dataURL, la trae el técnico en
// el momento) o ya guardada en storage (URL http, al reimprimir el certificado
// desde el tablero). jsPDF solo entiende dataURL, así que la http se descarga.
async function resolverFirma(firma) {
  if (!firma) return null
  if (!/^https?:/i.test(firma)) return firma
  try {
    const res = await fetch(firma)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((ok, fail) => {
      const fr = new FileReader()
      fr.onload = () => ok(fr.result)
      fr.onerror = fail
      fr.readAsDataURL(blob)
    })
  } catch (_) { return null }   // sin firma el certificado sale con la línea en blanco
}

// Plantas del compostaje: la especie que eligió la familia en el portal y los
// extras que compró ahí mismo (migración 149). Se consulta ACÁ y no en cada
// pantalla porque el certificado se genera desde tres sitios distintos —el
// tablero, la ficha del servicio y la app del mensajero— y los tres tienen que
// imprimir lo mismo.
// Nunca tumba el certificado: si la consulta falla, sale sin la sección.
async function cargarPlantas(servicioId) {
  if (!servicioId) return { eleccion: null, extras: [] }
  try {
    const [rEleccion, rExtras] = await Promise.all([
      db.from('planta_elecciones')
        .select('estado, planta_nombre, fecha_eleccion, plantas:planta_id ( nombre )')
        .eq('servicio_id', servicioId).maybeSingle(),
      db.from('planta_adicionales')
        .select('nombre, cantidad, precio_unitario, total')
        .eq('servicio_id', servicioId).order('created_at'),
    ])
    return { eleccion: rEleccion?.data || null, extras: rExtras?.data || [] }
  } catch (_) {
    return { eleccion: null, extras: [] }
  }
}

// Genera y descarga el certificado de entrega
export async function generarCertificadoEntrega({ svc, entrega, mensajero, items, firmaDataUrl = null }) {
  const firmaImg = await resolverFirma(firmaDataUrl || entrega?.foto_firma_url)
  const { eleccion: plantaEleccion, extras: plantasExtra } = await cargarPlantas(svc?.id)
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, H = 297, M = 15, CW = W - M * 2
  const G = [31, 90, 50]

  // El pie es una banda fija al final de CADA página; el contenido nunca puede
  // invadirla (antes `y` crecía libre y los últimos bloques quedaban debajo).
  const FOOTER_Y = H - 17
  const LIMITE_Y = FOOTER_Y - 6

  const mascota = svc?.mascotas || svc?.mascota
  const cliente = mascota?.clientes || mascota?.cliente
  const numero  = `CAC-${(svc?.fecha_ingreso || '').slice(0,4) || new Date().getFullYear()}${(svc?.fecha_ingreso || '').slice(5,7) || String(new Date().getMonth()+1).padStart(2,'0')}-${(svc?.id || '').slice(0,6).toUpperCase()}`
  const fechaEntrega = entrega?.fecha_realizada
    ? new Date(entrega.fecha_realizada + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })
    : new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })

  let y = 0

  const t = (text, x, yy, opts = {}) => pdf.text(String(text ?? ''), x, yy, opts)

  // Cabecera reducida para las páginas de continuación
  const cabeceraContinuacion = () => {
    pdf.setFillColor(...G); pdf.rect(0, 0, W, 13, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255)
    t(`${EMPRESA.nombre}  ·  CERTIFICADO DE ENTREGA`, M, 8.5)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(196, 168, 122)
    t(`No. ${numero}`, W - M, 8.5, { align: 'right' })
  }
  const nuevaPagina = () => { pdf.addPage(); cabeceraContinuacion(); y = 20 }
  // Reserva `alto` mm: si el bloque no cabe antes del pie, salta de página.
  // Se llama ANTES de dibujar para que ningún bloque quede partido.
  const espacio = (alto) => { if (y + alto > LIMITE_Y) nuevaPagina() }

  const sec = (label) => {
    espacio(14)
    pdf.setFillColor(232, 243, 235); pdf.rect(M, y, CW, 5.5, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...G)
    t(label, M + 2, y + 3.9)
    y += 6.3
  }
  // Dibuja un campo en (x, yy) y devuelve la Y donde termina. No mueve el
  // cursor: las filas de dos columnas necesitan pintar ambas a la misma altura.
  const field = (label, value, x, yy, w = CW / 2 - 3) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 140, 140)
    t(label.toUpperCase(), x, yy)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(25, 25, 25)
    const lines = pdf.splitTextToSize(value || '—', w)
    pdf.text(lines, x, yy + 4.2)
    return yy + 4.2 + lines.length * 4.2
  }
  // Fila de dos columnas: reserva el alto, pinta y deja el cursor debajo.
  const fila2 = (l1, v1, l2, v2) => {
    espacio(12)
    const y0 = y
    const b1 = field(l1, v1, M, y0)
    const b2 = field(l2, v2, M + CW / 2, y0)
    y = Math.max(b1, b2) + 1.5
  }
  // Campo de ancho completo
  const filaAncha = (label, value) => {
    espacio(12)
    y = field(label, value, M, y, CW) + 1.5
  }
  const hr = () => {
    espacio(4)
    pdf.setDrawColor(210, 225, 215); pdf.setLineWidth(0.25)
    pdf.line(M, y, W - M, y)
    y += 3
  }

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
  pdf.setFillColor(244, 247, 244); pdf.rect(0, 36, W, 10, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...G)
  t(`No. ${numero}`, M, 42.8)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80)
  t(`Fecha de entrega: ${fechaEntrega}`, W - M, 42.8, { align: 'right' })

  y = 50

  // ── Mascota y cliente ─────────────────────────────────────────────────────
  sec('DATOS DE LA MASCOTA Y PROPIETARIO')
  fila2('Mascota', mascota?.nombre || '—', 'Especie', mascota?.especies?.nombre || '—')
  fila2(
    'Propietario', `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim() || '—',
    'Plan / Servicio', svc?.planes?.nombre || '—',
  )
  hr()

  // ── Datos de entrega ──────────────────────────────────────────────────────
  // Va ANTES de los ítems (orden pedido por David 2026-07-31): quien lee el
  // certificado primero ubica dónde y a quién se entregó, y después qué.
  sec('DATOS DE ENTREGA')
  filaAncha('Dirección de entrega', entrega?.direccion_entrega || '—')
  fila2('Barrio', entrega?.barrio || '—', 'Localidad', entrega?.localidad || '—')
  fila2('Ciudad', entrega?.ciudad || '—', 'Tipo de entrega', entrega?.tipo_entrega || 'DOMICILIO')
  const tels = [entrega?.contacto_telefono, entrega?.telefono_adicional].filter(Boolean).join('   ·   ') || '—'
  fila2('Quién recibe', entrega?.contacto_nombre || '—', 'Teléfono(s)', tels)
  if (entrega?.hora_realizada || entrega?.aceptada_en) {
    fila2(
      'Salió a entregar', entrega?.aceptada_en ? hhmm(entrega.aceptada_en) : '—',
      'Hora de entrega',  entrega?.hora_realizada ? String(entrega.hora_realizada).slice(0, 5) : '—',
    )
  }

  if (entrega?.horarios_atencion) {
    filaAncha('Horarios a tener en cuenta', entrega.horarios_atencion)
    espacio(6)
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7); pdf.setTextColor(140, 140, 140)
    t('No corresponde a una hora exacta de entrega confirmada.', M, y)
    y += 4.5
  }
  if (entrega?.indicaciones) filaAncha('Instrucciones', entrega.indicaciones)
  if (mensajero) filaAncha('Mensajero / Técnico', `${mensajero.nombre} ${mensajero.apellido}`)
  hr()

  // ── Ítems ─────────────────────────────────────────────────────────────────
  // Separados en entregados físicamente vs enviados digitalmente: los digitales
  // (categoria='digital') se envían electrónicamente y NO requieren entrega
  // física — dejarlo claro evita confusiones al firmar el recibido.
  if (items && items.length > 0) {
    const nonNA = items.filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO')
    const esDigital = i => (i.recordatorios?.categoria || i.categoria) === 'digital'
    const fisicos   = nonNA.filter(i => !esDigital(i))
    const digitales = nonNA.filter(i => esDigital(i))

    const grupoItems = (titulo, lista) => {
      sec(titulo)
      const colW = (CW - 4) / 2
      let col = 0, rowY = y, maxY = y
      lista.forEach(item => {
        const nombre = item.recordatorios?.nombre || item.nombre || 'Ítem'
        const nlines = pdf.splitTextToSize(nombre, colW - 4)
        const itemH  = Math.max(9, nlines.length * 4.2 + 2)
        // Al empezar una fila nueva se comprueba que quepa; si no, página nueva
        if (col === 0 && rowY + itemH > LIMITE_Y) {
          y = rowY; nuevaPagina(); rowY = y; maxY = y
        }
        const x = col === 0 ? M : M + colW + 4
        pdf.setFillColor(col === 0 ? 248 : 244, col === 0 ? 252 : 247, col === 0 ? 248 : 244)
        pdf.rect(x, rowY - 1.5, colW, itemH, 'F')
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...G)
        pdf.text(nlines, x + 2, rowY + 3.8)
        if (col === 0) { col = 1; maxY = Math.max(maxY, rowY + itemH) }
        else           { col = 0; rowY = maxY + 2; maxY = rowY }
      })
      y = maxY + 3
    }

    if (fisicos.length || digitales.length) {
      if (fisicos.length)   grupoItems('ENTREGADOS FÍSICAMENTE', fisicos)
      if (digitales.length) grupoItems('ENVIADOS DIGITALMENTE (no requieren entrega física)', digitales)
      hr()
    }
  }

  // ── Plantas del compostaje ────────────────────────────────────────────────
  // Al cumplirse el compostaje la familia elige su especie en el portal y puede
  // comprar más (migración 149). Lo que se entrega también son plantas, así que
  // tienen que quedar escritas acá: sin esto el certificado decía que se
  // entregaron los recordatorios del plan y callaba las plantas.
  if (plantaEleccion || plantasExtra.length) {
    sec('PLANTAS DEL COMPOSTAJE')
    const especie = plantaEleccion?.planta_nombre || plantaEleccion?.plantas?.nombre || null
    const fechaEleccion = plantaEleccion?.fecha_eleccion
      ? new Date(plantaEleccion.fecha_eleccion).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—'
    fila2(
      'Especie elegida por la familia', especie || 'Sin elegir',
      'Fecha de elección',              especie ? fechaEleccion : '—',
    )
    if (plantasExtra.length) {
      espacio(8)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 140, 140)
      t('PLANTAS ADICIONALES', M, y)
      y += 4.8
      plantasExtra.forEach(p => {
        espacio(6)
        const cant = Number(p.cantidad) || 1
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(25, 25, 25)
        t(`${p.nombre}${cant > 1 ? `   ×${cant}` : ''}`, M + 2, y)
        pdf.setFont('helvetica', 'bold'); pdf.setTextColor(60, 60, 60)
        t(fmt(Number(p.total) || 0), W - M - 2, y, { align: 'right' })
        y += 5
      })
      y += 1
    }
    hr()
  }

  // ── Adicionales por cobrar en la entrega ──────────────────────────────────
  // Un certificado de ENTREGA no es un recibo: no informa cuánto vale el plan
  // ni cuánto se ha pagado. Lo único que se cobra al recibir son los
  // recordatorios ADICIONALES que el cliente pidió y aún no ha pagado — NUNCA
  // el plan: éste puede quedar "pendiente" porque lo paga la veterinaria
  // (facturación mensual / comisión) y eso no es responsabilidad del
  // propietario. Se muestra la suma del valor de esos adicionales (el mismo
  // `precio_cobrado` que ya se ve en otras vistas), topada al saldo real del
  // servicio: si el adicional ya se pagó, el saldo es 0 y la sección no aparece
  // (nunca cobra más de lo que realmente se debe).
  // Las plantas extra son dinero igual que un recordatorio adicional: el backend
  // las suma a `servicios.valor_total` al comprarlas (migración 149). Antes no
  // entraban en este bloque —solo se miraba `servicio_recordatorios`—, así que
  // una planta comprada engordaba el saldo y el mensajero no sabía cobrarla.
  const saldoServicio = Math.max(0, (svc?.valor_total || 0) - (svc?.valor_pagado || 0))
  const lineasCobro = [
    ...(items || [])
      .filter(i => i.origen === 'ADICIONAL' && i.estado !== 'NA')
      .map(i => ({
        nombre: i.recordatorios?.nombre || i.nombre || 'Adicional',
        valor:  Number(i.precio_cobrado ?? i.subtotal) || 0,
      })),
    ...plantasExtra.map(p => ({
      nombre: `Planta adicional: ${p.nombre}${(Number(p.cantidad) || 1) > 1 ? `  ×${p.cantidad}` : ''}`,
      valor:  Number(p.total) || 0,
    })),
  ].filter(l => l.valor > 0)
  const totalAdicionales = lineasCobro.reduce((s, l) => s + l.valor, 0)
  const saldo = Math.min(totalAdicionales, saldoServicio)

  if (saldo > 0) {
    // Se topa al saldo real del servicio: nunca se cobra más de lo que se debe.
    const hayTope  = saldo < totalAdicionales
    const conTotal = lineasCobro.length > 1
    const boxH = 11 + lineasCobro.length * 5 + (conTotal ? 5 : 0) + 10 + (hayTope ? 5 : 0)
    espacio(boxH + 4)
    const y0 = y
    pdf.setDrawColor(196, 168, 122); pdf.setLineWidth(0.4)
    pdf.setFillColor(255, 253, 248); pdf.rect(M, y0, CW, boxH, 'FD')

    y = y0 + 6
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(140, 110, 60)
    t('ADICIONALES POR COBRAR EN LA ENTREGA', M + 5, y)
    y += 5.5

    // Detalle: qué es cada peso que se está cobrando en la puerta.
    lineasCobro.forEach(l => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(60, 50, 35)
      t(pdf.splitTextToSize(l.nombre, CW - 50)[0], M + 5, y)
      t(fmt(l.valor), W - M - 5, y, { align: 'right' })
      y += 5
    })

    pdf.setDrawColor(224, 210, 186); pdf.setLineWidth(0.25)
    pdf.line(M + 5, y - 2.2, W - M - 5, y - 2.2)

    if (conTotal) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 100, 70)
      t('Suma de adicionales', M + 5, y + 1.8)
      t(fmt(totalAdicionales), W - M - 5, y + 1.8, { align: 'right' })
      y += 5
    }

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(140, 110, 60)
    t('TOTAL A COBRAR', M + 5, y + 3)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(192, 48, 48)
    t(fmt(saldo), W - M - 5, y + 3.6, { align: 'right' })
    y += 9

    if (hayTope) {
      pdf.setFont('helvetica', 'italic'); pdf.setFontSize(6.5); pdf.setTextColor(140, 120, 90)
      t('El servicio ya tiene abonos aplicados: se cobra solo el saldo pendiente.', M + 5, y + 1)
    }
    // El cursor sale del alto reservado, no de la suma de los pasos: así una
    // línea larga no puede empujar el texto fuera de la caja.
    y = y0 + boxH + 4
  }

  if (entrega?.notas) {
    espacio(10)
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8); pdf.setTextColor(100, 100, 100)
    const nlines = pdf.splitTextToSize(`Notas: ${entrega.notas}`, CW)
    pdf.text(nlines, M, y)
    y += nlines.length * 4.2 + 3
    hr()
  }

  // ── Firmas ────────────────────────────────────────────────────────────────
  // El bloque completo (título + firma + línea + nombre) mide ~40 mm: se
  // reserva entero para que nunca quede la línea en una página y el nombre
  // en la siguiente.
  espacio(40)
  sec('CONSTANCIA DE RECIBIDO')
  y += 1

  if (firmaImg) {
    try { pdf.addImage(firmaImg, 'PNG', M, y, 80, 18) }
    catch (e) { /* si falla la imagen, queda solo la línea */ }
  }
  pdf.setDrawColor(160, 160, 160); pdf.setLineWidth(0.3)
  pdf.line(M, y + 19, M + 82, y + 19)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(100, 100, 100)
  t('Firma y nombre del cliente', M, y + 23)
  const clienteNombre = `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim()
  if (clienteNombre) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(40, 40, 40)
    t(clienteNombre, M, y + 27.5)
  }

  pdf.setDrawColor(160, 160, 160); pdf.setLineWidth(0.3)
  pdf.line(W - M - 82, y + 19, W - M, y + 19)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(100, 100, 100)
  t('Firma del mensajero / técnico', W - M - 82, y + 23)
  if (mensajero) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(40, 40, 40)
    t(`${mensajero.nombre} ${mensajero.apellido}`, W - M - 82, y + 27.5)
  }

  // ── Pie de página (en TODAS las páginas) ──────────────────────────────────
  const totalPaginas = pdf.getNumberOfPages()
  for (let p = 1; p <= totalPaginas; p++) {
    pdf.setPage(p)
    pdf.setFillColor(...G); pdf.rect(0, FOOTER_Y, W, 17, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(190, 220, 200)
    t(`${EMPRESA.nombre}  ·  NIT ${EMPRESA.nit}`, W / 2, FOOTER_Y + 5.5, { align: 'center' })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(160, 200, 170)
    t(`${EMPRESA.direccion}, ${EMPRESA.ciudad}`, W / 2, FOOTER_Y + 10, { align: 'center' })
    t(`${EMPRESA.telefono}  ·  ${EMPRESA.email}  ·  ${EMPRESA.web}`, W / 2, FOOTER_Y + 14.5, { align: 'center' })
    if (totalPaginas > 1) {
      pdf.setFontSize(6.5); pdf.setTextColor(190, 220, 200)
      t(`Página ${p} de ${totalPaginas}`, W - M, FOOTER_Y + 14.5, { align: 'right' })
    }
  }

  const mascotaNombre = mascota?.nombre || 'servicio'
  pdf.save(`Certificado_Entrega_${mascotaNombre}_${numero}.pdf`)
}
