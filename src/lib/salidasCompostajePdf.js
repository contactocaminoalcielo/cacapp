// PDF del listado de salidas de compostaje (Tenjo → Salidas).
//
// Dos usos: la lista de trabajo de la planta ("estas hay que sacarlas hoy") y
// el acta de lo que ya se sacó. Se baja como archivo y el coordinador lo
// adjunta en WhatsApp; wa.me NO puede adjuntar archivos, solo texto
// (ver `textoSalidasWa` más abajo, que es lo que sí viaja por el enlace).
//
// jsPDF directo, NUNCA html2canvas: con Tailwind v4 los colores `oklch` salen
// en negro. Es la misma regla del resto de los PDF de Orbit.
import { etiquetaCubiculo } from '@/lib/cubiculos'

const EMPRESA = {
  nombre:   'Camino al Cielo',
  planta:   'Planta de compostaje — Tenjo',
  telefono: '319 358 5508',
  web:      'www.caminoalcielo.com.co',
}

const VERDE = [31, 90, 50]
const GRIS  = [110, 116, 112]

const fmt = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—'

const cubiculoTxt = it => it?.cubiculos
  ? etiquetaCubiculo(it.cubiculos)
  : (it?.cubiculo_codigo || '—')

const mascotaTxt = it => it?.servicios?.mascotas?.nombre || '—'
const clienteTxt = it => {
  const c = it?.servicios?.mascotas?.clientes
  return [c?.nombre, c?.apellido].filter(Boolean).join(' ') || '—'
}

/**
 * Genera y descarga el listado.
 * @param {'POR_SACAR'|'APLAZADAS'|'SALIERON'} tipo
 * @param {Array} items  filas de cargarSalidasCompostaje
 */
export async function generarPdfSalidas(tipo, items) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, H = 297, M = 14
  const porSacar  = tipo === 'POR_SACAR'
  const aplazadas = tipo === 'APLAZADAS'
  const titulo = porSacar ? 'MASCOTAS POR SACAR DEL CUBÍCULO'
    : aplazadas ? 'MASCOTAS CON LA SALIDA APLAZADA'
    : 'MASCOTAS QUE YA SALIERON DEL CUBÍCULO'
  const hoyTxt = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })

  // Columnas: x de inicio y ancho. La última se deja ancha porque la fecha de
  // entrega de los recordatorios es lo que se consulta de verdad.
  // En el recorte van las TRES fechas que pidió David: ingreso, cumplimiento
  // del compostaje y salida (la programada por el operario; «—» si sale con el
  // recorte de hoy sin fecha aparte).
  const COLS = porSacar
    ? [
        { k: 'mascota',  label: 'Mascota',   x: M,       w: 30 },
        { k: 'cliente',  label: 'Familia',   x: M + 30,  w: 42 },
        { k: 'cubiculo', label: 'Cubículo',  x: M + 72,  w: 26 },
        { k: 'ingreso',  label: 'Ingresó',   x: M + 98,  w: 26 },
        { k: 'cumple',   label: 'Se cumplió', x: M + 124, w: 28 },
        { k: 'sale',     label: 'Sale',      x: M + 152, w: 30 },
      ]
    : aplazadas
    ? [
        { k: 'mascota',  label: 'Mascota',   x: M,       w: 26 },
        { k: 'cubiculo', label: 'Cubículo',  x: M + 26,  w: 24 },
        { k: 'ingreso',  label: 'Ingresó',   x: M + 50,  w: 24 },
        { k: 'cumple',   label: 'Se cumple', x: M + 74,  w: 24 },
        { k: 'sale',     label: 'Saldrá',    x: M + 98,  w: 24 },
        { k: 'motivo',   label: 'Motivo',    x: M + 122, w: 60 },
      ]
    : [
        { k: 'mascota',  label: 'Mascota',   x: M,      w: 32 },
        { k: 'cliente',  label: 'Familia',   x: M + 32, w: 44 },
        { k: 'cubiculo', label: 'Cubículo',  x: M + 76, w: 28 },
        { k: 'salida',   label: 'Salió',     x: M + 104, w: 30 },
        { k: 'entrega',  label: 'Entrega recordatorios', x: M + 134, w: 48 },
      ]

  const valor = (it, k) => {
    switch (k) {
      case 'mascota':  return mascotaTxt(it)
      case 'cliente':  return clienteTxt(it)
      case 'cubiculo': return cubiculoTxt(it)
      case 'ingreso':  return fmt(it.fecha_compostaje_inicio)
      case 'cumple':   return fmt(it.fechaCumple)
      case 'salida':   return fmt(it.cubiculo_salida)
      case 'sale':     return it.salida_programada ? fmt(it.salida_programada) : (porSacar ? 'Hoy' : '—')
      case 'motivo':   return it.salida_programada_motivo || '—'
      case 'entrega':  return fmt(it.servicios?.fecha_limite_entrega)
      default:         return '—'
    }
  }

  const cabecera = () => {
    pdf.setFillColor(...VERDE); pdf.rect(0, 0, W, 22, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(255, 255, 255)
    pdf.text(EMPRESA.nombre, M, 10)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8)
    pdf.text(EMPRESA.planta, M, 15.5)
    pdf.setFontSize(8)
    pdf.text(hoyTxt, W - M, 10, { align: 'right' })
    pdf.text(`${items.length} mascota${items.length !== 1 ? 's' : ''}`, W - M, 15.5, { align: 'right' })

    pdf.setTextColor(...VERDE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
    pdf.text(titulo, M, 32)

    pdf.setDrawColor(...VERDE); pdf.setLineWidth(0.4)
    pdf.line(M, 36, W - M, 36)

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...GRIS)
    COLS.forEach(c => pdf.text(c.label, c.x, 41))
    pdf.setDrawColor(220, 224, 220); pdf.setLineWidth(0.2)
    pdf.line(M, 43.5, W - M, 43.5)
    return 49
  }

  const pie = () => {
    pdf.setDrawColor(220, 224, 220); pdf.setLineWidth(0.2)
    pdf.line(M, H - 16, W - M, H - 16)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...GRIS)
    pdf.text(`${EMPRESA.web}  ·  ${EMPRESA.telefono}`, M, H - 11)
    pdf.text(`Página ${pdf.getNumberOfPages()}`, W - M, H - 11, { align: 'right' })
  }

  let y = cabecera()

  if (items.length === 0) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(...GRIS)
    pdf.text(porSacar
      ? 'No hay ninguna mascota cumplida esperando salir del cubículo.'
      : aplazadas
      ? 'Ninguna mascota tiene la salida aplazada.'
      : 'Ninguna mascota salió del cubículo en el rango consultado.', M, y)
  }

  items.forEach((it, i) => {
    if (y > H - 24) { pie(); pdf.addPage(); y = cabecera() }
    if (i % 2 === 1) {
      pdf.setFillColor(246, 249, 246); pdf.rect(M - 2, y - 4, W - M * 2 + 4, 7.5, 'F')
    }
    COLS.forEach(c => {
      const esNombre = c.k === 'mascota'
      pdf.setFont('helvetica', esNombre ? 'bold' : 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor(...(esNombre ? [25, 32, 27] : GRIS))
      // Una sola línea por celda: la tabla es de altura fija. `splitTextToSize`
      // devuelve varias y quedarse con la primera cortaba el nombre en seco, sin
      // señal de que faltaba texto — un "FUNDACION INTEGRAL AND" parece el
      // nombre completo. Con la elipsis al menos se ve que está recortado.
      const completo = String(valor(it, c.k))
      const partes   = pdf.splitTextToSize(completo, c.w - 2)
      const txt      = partes.length > 1
        ? `${pdf.splitTextToSize(completo, c.w - 4)[0].trimEnd()}…`
        : (partes[0] || '—')
      pdf.text(txt, c.x, y)
    })
    y += 7.5
  })

  // Casilla de firma solo en la lista de trabajo: es la que el operario
  // diligencia en planta.
  if (porSacar && items.length > 0) {
    if (y > H - 45) { pie(); pdf.addPage(); y = cabecera() }
    y += 12
    pdf.setDrawColor(...GRIS); pdf.setLineWidth(0.3)
    pdf.line(M, y, M + 70, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS)
    pdf.text('Operario que realizó la salida', M, y + 4)
    pdf.line(W - M - 70, y, W - M, y)
    pdf.text('Fecha', W - M - 70, y + 4)
  }

  pie()

  const sello = new Date().toISOString().slice(0, 10)
  pdf.save(`${porSacar ? 'por-sacar' : aplazadas ? 'aplazadas' : 'salieron'}-compostaje-${sello}.pdf`)
}

/**
 * El texto que sí viaja por wa.me. WhatsApp no adjunta archivos desde un
 * enlace, así que el listado va escrito; el PDF se adjunta a mano si hace falta.
 */
export function textoSalidasWa(tipo, items) {
  const porSacar  = tipo === 'POR_SACAR'
  const aplazadas = tipo === 'APLAZADAS'
  const hoyTxt = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
  const cabeza = porSacar
    ? `🌿 *Por sacar del cubículo* — ${hoyTxt}`
    : aplazadas
    ? `📅 *Salida aplazada* — ${hoyTxt}`
    : `✅ *Ya salieron del cubículo* — ${hoyTxt}`

  if (!items.length) {
    return `${cabeza}\n\nNinguna por ahora.`
  }

  const lineas = items.map(it => porSacar
    ? `• ${mascotaTxt(it)} — ${cubiculoTxt(it)} · cumplió ${fmt(it.fechaCumple)}`
      + (it.salida_programada ? ` · sale ${fmt(it.salida_programada)}` : '')
    : aplazadas
    ? `• ${mascotaTxt(it)} — ${cubiculoTxt(it)} · saldrá ${fmt(it.salida_programada)}`
      + (it.salida_programada_motivo ? ` · ${it.salida_programada_motivo}` : '')
    : `• ${mascotaTxt(it)} — ${cubiculoTxt(it)} · salió ${fmt(it.cubiculo_salida)}`
      + (it.servicios?.fecha_limite_entrega ? ` · entrega ${fmt(it.servicios.fecha_limite_entrega)}` : ''))

  // 🔑 El listado viaja DENTRO de la URL de wa.me, ya codificada: un rango
  // amplio de "ya salieron" son cientos de líneas, y wa.me y el intent de
  // Android recortan una URL larga SIN AVISAR — el coordinador creería haber
  // mandado la lista entera. Se corta aquí, contando lo que falta, y el resto
  // queda en el PDF, que es el que aguanta cualquier tamaño.
  const TOPE = 40
  const visibles = lineas.slice(0, TOPE)
  const resto    = lineas.length - visibles.length
  if (resto > 0) {
    visibles.push(`…y ${resto} más — la lista completa va en el PDF.`)
  }

  return `${cabeza}\n${`(${items.length} mascota${items.length !== 1 ? 's' : ''})`}\n\n${visibles.join('\n')}`
}
