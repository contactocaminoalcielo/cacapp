import { db } from '@/lib/supabase'
import { hoyLocalISO, parseDate, fmt } from '@/lib/utils'

// Afiliaciones pre-exequiales — reglas cerradas con David 2026-07-16:
// ANUAL: un pago por año, renovable. Cláusula SOLO durante el primer contrato
// (numero 0): fallece meses 0-6 → cobra 5× la afiliación; meses 7-12 → 3×;
// desde la primera renovación el servicio queda cubierto (solo transporte).
// VITALICIO: un solo pago, cubierta de por vida, nunca lleva cláusula.

export const NIVELES = ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE']
export const TIPOS = ['ANUAL', 'VITALICIO']
export const ABREV_NIVEL = { BRONCE: 'BR', PLATA: 'PL', ORO: 'OR', DIAMANTE: 'DI' }

const MESES_ABREV = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

const CONFIG_DEFAULTS = {
  precios: { ANUAL: {}, VITALICIO: {} },
  plan_equivalente: { BRONCE: 'BASICO', PLATA: 'STANDARD', ORO: null, DIAMANTE: 'PREMIUM' },
  oro_opciones: ['EXCLUSIVO_PRESENCIAL','EXCLUSIVO_VIDEOLLAMADA','COMPETS_EVIDENCIA','COMPETS_PRESENCIAL'],
  dias_gracia: 15,
  dias_aviso_renovacion: 30,
  multiplicador_semestre_1: 5,
  multiplicador_semestre_2: 3,
}

export async function cargarConfigAfiliaciones() {
  const { data, error } = await db.from('config_operativa')
    .select('clave, valor').eq('modulo', 'AFILIACIONES')
  if (error) throw error
  const cfg = { ...CONFIG_DEFAULTS }
  for (const row of data || []) cfg[row.clave] = row.valor
  return cfg
}

// Número de contrato, formato del papel: ABR1124SR10-BR1
//   ABR   mes de la afiliación · 11 día · 24 año corto
//   SR    1ª letra del nombre + 1ª del apellido
//   10    suma de los últimos 3 dígitos de la cédula (…235 → 2+3+5)
//   BR    abreviación del nivel · sufijo: 0 = contrato nuevo, 1+ = renovación,
//         VIT = vitalicio (un solo contrato, nunca renueva)
export function generarNumeroContrato({ fechaInicio, cliente, nivel, tipo, numero = 0 }) {
  const f = typeof fechaInicio === 'string' ? parseDate(fechaInicio) : fechaInicio
  const mes = MESES_ABREV[f.getMonth()]
  const dd  = String(f.getDate()).padStart(2, '0')
  const yy  = String(f.getFullYear()).slice(-2)

  const inicial = s => (s || '').trim().charAt(0)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const iniciales = inicial(cliente?.nombre) + inicial(cliente?.apellido)

  const digitos = String(cliente?.cedula_nit || '').replace(/\D/g, '')
  const suma = digitos.slice(-3).split('').reduce((a, d) => a + parseInt(d, 10), 0)

  const sufijo = tipo === 'VITALICIO' ? 'VIT' : String(numero)
  return `${mes}${dd}${yy}${iniciales}${suma}-${ABREV_NIVEL[nivel] || '??'}${sufijo}`
}

// Cobro al activar (falleció): lo ÚNICO que paga el cliente por el servicio es
// la cláusula si aplica; el recargo de transporte lo suma Registro como siempre.
// Devuelve { cobro, multiplicador, motivo } — cobro 0 = servicio cubierto.
export function calcularCobroActivacion({ afiliacion, contratoVigente, config }) {
  if (afiliacion.tipo === 'VITALICIO')
    return { cobro: 0, multiplicador: 0, motivo: 'Plan vitalicio — servicio cubierto' }
  if (!contratoVigente)
    return { cobro: 0, multiplicador: 0, motivo: 'Sin contrato vigente — revisar afiliación' }
  if (contratoVigente.numero >= 1)
    return { cobro: 0, multiplicador: 0, motivo: 'Afiliación renovada — servicio cubierto, sin cláusula' }

  // Primer contrato: cláusula por semestre desde fecha_inicio.
  const inicio = parseDate(contratoVigente.fecha_inicio)
  const hoy = parseDate(hoyLocalISO())
  const meses = (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth())
    - (hoy.getDate() < inicio.getDate() ? 1 : 0)
  const m1 = parseFloat(config?.multiplicador_semestre_1) || 5
  const m2 = parseFloat(config?.multiplicador_semestre_2) || 3
  const valor = parseFloat(contratoVigente.valor) || 0
  const mult = meses < 6 ? m1 : m2
  return {
    cobro: Math.round(valor * mult),
    multiplicador: mult,
    motivo: `Cláusula del primer año (${meses < 6 ? '1er' : '2do'} semestre): ${mult}× ${fmt(valor)}`,
  }
}

export function sumarUnAnio(fechaISO) {
  const f = parseDate(fechaISO)
  f.setFullYear(f.getFullYear() + 1)
  return hoyLocalISO(f)
}

// Comprobante de pago de un contrato → bucket compartido `evidencias`.
// Una sola fuente: el resultado se agrega al jsonb `comprobantes` del contrato.
export async function subirComprobanteAfiliacion(afiliacionId, file) {
  const tipo = (file.type || '').toLowerCase()
  if (!(tipo.startsWith('image/') || tipo === 'application/pdf'))
    throw new Error('El comprobante debe ser una imagen o un PDF.')
  if (file.size > 8 * 1024 * 1024)
    throw new Error('El comprobante supera 8 MB. Usa un archivo más liviano.')
  const ext  = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] || 'jpg')
  const path = `afiliaciones/${afiliacionId}/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('evidencias')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error('No se pudo subir el comprobante: ' + error.message)
  return { bucket: 'evidencias', storage_path: path, mime_type: file.type || null, uploaded_at: new Date().toISOString() }
}

export async function abrirArchivoStorage(storagePath, bucket = 'evidencias') {
  const w = window.open('', '_blank')
  const { data } = await db.storage.from(bucket).createSignedUrl(storagePath, 600)
  if (!data?.signedUrl) { if (w) w.close(); return false }
  if (w) w.location = data.signedUrl
  else window.open(data.signedUrl, '_blank', 'noopener')
  return true
}

// Total del contrato = precio unitario × nº de mascotas cubiertas.
// `contrato.valor` es el precio POR MASCOTA (así lo guardan las 149 filas de
// prod sin excepción); el total se calcula, no se guarda, para no tener dos
// fuentes de la misma cifra que se desincronicen.
export function totalContrato(contrato, nMascotas) {
  return (parseFloat(contrato?.valor) || 0) * (nMascotas || 0)
}

// Contrato PDF provisional (jsPDF directo — NUNCA html2canvas con Tailwind v4).
// David va a pasar los formatos reales por nivel (nuevo y renovación) para
// replicarlos tal cual; mientras tanto este documento deja constancia formal.
export async function generarContratoPdf({ contrato, afiliacion, cliente, mascotas = [] }) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  let y = 22

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('CAMINO AL CIELO', W / 2, y, { align: 'center' }); y += 7
  doc.setFontSize(11)
  const titulo = afiliacion.tipo === 'VITALICIO'
    ? `CONTRATO DE AFILIACIÓN PRE-EXEQUIAL VITALICIA — PLAN ${afiliacion.nivel}`
    : `CONTRATO DE AFILIACIÓN PRE-EXEQUIAL ANUAL — PLAN ${afiliacion.nivel}${contrato.numero >= 1 ? ` (RENOVACIÓN Nº ${contrato.numero})` : ''}`
  doc.text(titulo, W / 2, y, { align: 'center' }); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(`CONTRATO #${contrato.numero_contrato}`, W / 2, y, { align: 'center' }); y += 12

  const linea = (label, valor) => {
    doc.setFont('helvetica', 'bold');   doc.text(label, 20, y)
    doc.setFont('helvetica', 'normal'); doc.text(String(valor ?? '—'), 75, y)
    y += 7
  }
  linea('Titular:', `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim())
  linea('Cédula / NIT:', cliente?.cedula_nit)
  linea('WhatsApp:', cliente?.whatsapp)
  linea('Fecha de inicio:', contrato.fecha_inicio)
  if (afiliacion.tipo === 'ANUAL') linea('Vence:', contrato.fecha_vencimiento)
  linea('Forma de pago:', afiliacion.tipo === 'VITALICIO' ? 'Pago único (vitalicio)' : 'Pago anual único')
  y += 5

  // Un contrato cubre una o varias mascotas, cada una con su propio valor.
  doc.setFont('helvetica', 'bold')
  doc.text(mascotas.length === 1 ? 'MASCOTA CUBIERTA' : `MASCOTAS CUBIERTAS (${mascotas.length})`, 20, y)
  y += 6
  doc.setFontSize(9)
  doc.text('Nombre', 22, y); doc.text('Especie', 75, y); doc.text('Raza', 115, y)
  doc.text('Valor', W - 22, y, { align: 'right' })
  y += 2; doc.line(20, y, W - 20, y); y += 5
  doc.setFont('helvetica', 'normal')
  for (const m of mascotas) {
    doc.text(String(m?.nombre || '—'), 22, y)
    doc.text(String(m?.especies?.nombre || '—'), 75, y)
    doc.text(String(m?.raza || '—').slice(0, 22), 115, y)
    doc.text(fmt(contrato.valor), W - 22, y, { align: 'right' })
    y += 6
  }
  doc.line(20, y - 2, W - 20, y - 2); y += 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(`TOTAL (${mascotas.length} × ${fmt(contrato.valor)})`, 22, y)
  doc.text(fmt(totalContrato(contrato, mascotas.length)), W - 22, y, { align: 'right' })
  y += 10
  doc.setFont('helvetica', 'normal')

  doc.setFontSize(9); doc.setTextColor(90)
  const clausulas = afiliacion.tipo === 'ANUAL' && contrato.numero === 0
    ? 'Cláusula del primer año: si la mascota fallece durante el primer semestre de este contrato, el servicio se cobra a 5 veces el valor de la afiliación; durante el segundo semestre, a 3 veces. Estas cláusulas se suspenden a partir de la primera renovación.'
    : afiliacion.tipo === 'ANUAL'
      ? 'Contrato de renovación: el servicio queda cubierto sin cláusulas semestrales. Aplican únicamente recargos de transporte fuera de Bogotá según tarifas vigentes.'
      : 'Afiliación vitalicia: la mascota queda cubierta de por vida desde la firma. Aplican únicamente recargos de transporte fuera de Bogotá según tarifas vigentes.'
  const parr = doc.splitTextToSize(clausulas, W - 40)
  doc.text(parr, 20, y); y += parr.length * 4.5 + 14
  doc.setTextColor(0)

  doc.line(20, y, 90, y);  doc.line(W - 90, y, W - 20, y); y += 5
  doc.setFontSize(9)
  doc.text('Firma del titular', 20, y)
  doc.text('Camino al Cielo', W - 90, y)

  return doc
}
