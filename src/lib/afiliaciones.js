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
  descuento_renovacion_anticipada: 25,
  descuento_multiples_mascotas: 25,
  descuento_renovacion_multiple_tardia: 10,
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

// ─── Descuentos (reglas cerradas con David 2026-07-29) ──────────────────────
// Tres reglas, con el porcentaje editable en Configuración › Afiliaciones:
//   · RENOVACION_ANTICIPADA      25 % — renueva en o antes del vencimiento.
//   · MULTIPLES_MASCOTAS         25 % — el contrato cubre más de una mascota.
//   · RENOVACION_MULTIPLE_TARDIA 10 % — varias mascotas, pero renovando tarde.
// NUNCA se acumulan: si aplica más de uno se toma el MAYOR (decisión de David;
// sumarlos haría que subir un porcentaje en config moviera solo el acumulado).
// Estas funciones solo SUGIEREN: quien decide aplicarlo es el coordinador.
export const MOTIVOS_DESCUENTO = {
  RENOVACION_ANTICIPADA:      'Renovación antes del vencimiento',
  MULTIPLES_MASCOTAS:         'Más de una mascota en el mismo plan',
  RENOVACION_MULTIPLE_TARDIA: 'Renovación de varias mascotas después del vencimiento',
  MANUAL:                     'Descuento manual',
}

const pctConfig = (config, clave) => {
  const p = parseFloat(config?.[clave])
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0
}

// `escenario`: 'NUEVA' (afiliación nueva) | 'RENOVACION' (renovar o reactivar).
// `fechaVencimiento` es la del contrato que se está renovando; se compara contra
// HOY, no contra la fecha de inicio del contrato nuevo: lo que da el descuento es
// que el cliente pague antes de que se le venza, no dónde arranque la vigencia.
// Renovar el mismo día del vencimiento cuenta como anticipada (no está vencida).
export function descuentosAplicables({ escenario, nMascotas = 0, fechaVencimiento = null, config, hoyISO = null }) {
  const varias = nMascotas > 1
  const out = []
  const push = (motivo, clave) => {
    const pct = pctConfig(config, clave)
    if (pct > 0) out.push({ motivo, pct, etiqueta: MOTIVOS_DESCUENTO[motivo] })
  }

  if (escenario === 'RENOVACION') {
    const hoy = parseDate(hoyISO || hoyLocalISO())
    const anticipada = !!fechaVencimiento && parseDate(fechaVencimiento) >= hoy
    if (anticipada) {
      push('RENOVACION_ANTICIPADA', 'descuento_renovacion_anticipada')
      if (varias) push('MULTIPLES_MASCOTAS', 'descuento_multiples_mascotas')
    } else if (varias) {
      // Después del vencimiento el multi-mascota vale 10 %, no 25 %.
      push('RENOVACION_MULTIPLE_TARDIA', 'descuento_renovacion_multiple_tardia')
    }
  } else if (varias) {
    push('MULTIPLES_MASCOTAS', 'descuento_multiples_mascotas')
  }
  return out
}

// El que más le conviene al cliente, o null si no aplica ninguno.
export function mejorDescuento(args) {
  const lista = descuentosAplicables(args)
  return lista.length ? lista.reduce((a, b) => (b.pct > a.pct ? b : a)) : null
}

// Precio unitario a cobrar = precio de lista menos el descuento, al peso.
export function aplicarDescuento(valorLista, pct) {
  const v = parseFloat(valorLista) || 0
  const p = Math.min(100, Math.max(0, parseFloat(pct) || 0))
  return Math.round(v * (1 - p / 100))
}

// Precio de lista de un contrato ya guardado. Los contratos anteriores a la
// migración 077 no tienen la columna llena (el backfill la iguala a `valor`,
// pero el fallback deja el código a salvo si llega una fila sin ella).
export function valorListaContrato(contrato) {
  const lista = parseFloat(contrato?.valor_lista)
  return Number.isFinite(lista) && lista > 0 ? lista : (parseFloat(contrato?.valor) || 0)
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

  // Primer contrato: el contrato de papel lo define por DÍAS, no por meses —
  // "$X desde su formalización hasta el día 180, y $Y desde el día 181 hasta la
  // finalización del contrato" (Parágrafo 2). Contar meses corría la frontera
  // hasta 3 días según el mes.
  const inicio = parseDate(contratoVigente.fecha_inicio)
  const hoy = parseDate(hoyLocalISO())
  const dias = Math.round((hoy - inicio) / 86400000)
  const m1 = parseFloat(config?.multiplicador_semestre_1) || 5
  const m2 = parseFloat(config?.multiplicador_semestre_2) || 3
  // Sobre el PRECIO DE LISTA, no sobre lo que pagó: el descuento abarata la
  // afiliación, no la activación (decisión de David 2026-07-29, migración 077).
  const valor = valorListaContrato(contratoVigente)
  const conDescuento = (parseFloat(contratoVigente.descuento_pct) || 0) > 0
  const primerTramo = dias <= 180
  const mult = primerTramo ? m1 : m2
  return {
    cobro: Math.round(valor * mult),
    multiplicador: mult,
    motivo: `Cláusula del primer año (día ${dias}, ${primerTramo ? 'hasta el 180' : 'desde el 181'}): ${mult}× ${fmt(valor)}` +
      (conDescuento ? ' (precio de lista: el descuento del contrato no aplica a la activación)' : ''),
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

// Enlace firmado del PDF del contrato. TTL largo (30 días) para compartirlo por
// WhatsApp; para el envío por email basta uno corto (el backend lo descarga ya).
export async function urlFirmadaContrato(pdfPath, ttlSec = 30 * 24 * 3600) {
  const { data, error } = await db.storage.from('evidencias').createSignedUrl(pdfPath, ttlSec)
  if (error || !data?.signedUrl) throw new Error('No se pudo generar el enlace del PDF: ' + (error?.message || 'sin URL'))
  return data.signedUrl
}

export function mensajeContratoWa({ contrato, afiliacion, url }) {
  const nombre = afiliacion?.clientes?.nombre
  return `Hola${nombre ? ` ${nombre}` : ''} 👋 Te escribimos de Camino al Cielo 🌈\n\n` +
    `Te compartimos el contrato Nº ${contrato.numero_contrato} de tu afiliación pre-exequial ` +
    `${afiliacion?.nivel || ''}${afiliacion?.tipo === 'VITALICIO' ? ' vitalicia' : ''}. Puedes descargarlo aquí:\n${url}\n\n` +
    `El enlace estará disponible por 30 días. Cualquier duda, con gusto te ayudamos 🐾`
}

export async function abrirArchivoStorage(storagePath, bucket = 'evidencias') {
  const w = window.open('', '_blank')
  const { data } = await db.storage.from(bucket).createSignedUrl(storagePath, 600)
  if (!data?.signedUrl) { if (w) w.close(); return false }
  if (w) w.location = data.signedUrl
  else window.open(data.signedUrl, '_blank', 'noopener')
  return true
}

// ─── Piezas de texto del contrato de papel ──────────────────────────────────
// El contrato escribe los valores en letras y en números: "tiene un valor de
// treinta y cinco mil pesos ($ 35.000)".
const LETRAS_U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve']
const LETRAS_D = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const LETRAS_C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function letrasMenorMil(n) {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100), r = n % 100
  let s = c ? LETRAS_C[c] : ''
  if (r) {
    if (s) s += ' '
    if (r < 30) s += LETRAS_U[r]
    else {
      const d = Math.floor(r / 10), u = r % 10
      s += LETRAS_D[d] + (u ? ' y ' + LETRAS_U[u] : '')
    }
  }
  return s
}

export function numeroALetras(n) {
  const x = Math.round(Math.abs(Number(n) || 0))
  if (x === 0) return 'cero'
  const millones = Math.floor(x / 1000000)
  const miles = Math.floor((x % 1000000) / 1000)
  const unidades = x % 1000
  const partes = []
  if (millones) partes.push(millones === 1 ? 'un millón' : letrasMenorMil(millones) + ' millones')
  if (miles) partes.push(miles === 1 ? 'mil' : letrasMenorMil(miles).replace(/uno$/, 'ún') + ' mil')
  if (unidades) partes.push(letrasMenorMil(unidades))
  return partes.join(' ')
}

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// "03 de julio de 2026", como lo escribe el contrato
export function fechaLarga(fechaISO) {
  if (!fechaISO) return '—'
  const f = parseDate(fechaISO)
  return `${String(f.getDate()).padStart(2, '0')} de ${MESES_LARGOS[f.getMonth()]} de ${f.getFullYear()}`
}

// Cédula con puntos de miles, como la escribe el contrato (39.703.706)
export function formatCedula(v) {
  const d = String(v || '').replace(/\D/g, '')
  return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : (v || '—')
}

// Edad vigente a una fecha: la declarada + los años que han pasado desde que se
// declaró (migración 056). El cliente da años, no fecha de nacimiento.
export function edadALaFecha(mascota, fechaISO) {
  if (mascota?.edad_anios == null || !mascota?.edad_declarada_en) return null
  const desde = parseDate(mascota.edad_declarada_en)
  const hasta = parseDate(fechaISO || hoyLocalISO())
  // Por calendario, NO dividiendo días entre 365.25: con un bisiesto de por
  // medio, 2 años exactos son 730 días y 730/365.25 = 1.99 → truncaba a 1 y la
  // mascota rejuvenecía un año.
  let anios = hasta.getFullYear() - desde.getFullYear()
  const m = hasta.getMonth() - desde.getMonth()
  if (m < 0 || (m === 0 && hasta.getDate() < desde.getDate())) anios--
  return mascota.edad_anios + Math.max(0, anios)
}

// Total del contrato = precio unitario × nº de mascotas cubiertas.
// `contrato.valor` es el precio POR MASCOTA (así lo guardan las 149 filas de
// prod sin excepción); el total se calcula, no se guarda, para no tener dos
// fuentes de la misma cifra que se desincronicen.
export function totalContrato(contrato, nMascotas) {
  return (parseFloat(contrato?.valor) || 0) * (nMascotas || 0)
}

// ─── Contrato de papel, calcado ──────────────────────────────────────────────
// Réplica del formato real que usa Camino al Cielo (Versión 2.818), a partir de
// los 12 contratos firmados que pasó David: encabezado con el nº y "12 MESES",
// título del plan, el párrafo del TOMADOR, la tabla de mascotas
// (RAZA | EDAD AÑOS | PESO | NOMBRE | ESPECIE) y los seis puntos numerados.
// jsPDF directo — NUNCA html2canvas con Tailwind v4 (oklch lo rompe).
//
// Diferencias entre variantes, tal como están en los originales:
//   · ANUAL nuevo       → Parágrafo 2 con los valores de activación (5×/3×),
//                          Parágrafo 3 (renovable), Segunda = vigencia 365 días.
//   · ANUAL renovación  → idéntico pero la activación va en $0 ("no tendrá
//                          activación si hay continuidad en la renovación").
//   · VITALICIO         → Parágrafo 2 sin carencia, SIN Parágrafo 3, y la
//                          Segunda dice "hasta requerir la utilización".
//
// Los originales traen erratas de copiar/pegar que NO se replican: el vitalicio
// de Hugo dice "12 MESES" y titula "DIAMANTE VITALISIO" siendo un BRONCE, y el
// template de BRONCE lista los planes como "Bronce, Plata, Oro y Plata".
const EMPRESA = {
  razon:    'MARTEN´S INVERSIONES S.A.S',
  nit:      'NIT 901.792.844-5',
  whatsapp: 'WhatsApp: 3193585508',
  telefono: 'Teléfono: 3222187087-3107802868',
  version:  'Versión: 2.818',
}

export async function generarContratoPdf({ contrato, afiliacion, cliente, mascotas = [], config = null }) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const L = 20, R = W - 20, ANCHO = R - L
  let y = 0

  const salto = alto => { if (y + alto > H - 18) { doc.addPage(); y = 20 } }
  // Cuerpo justificado, como el original
  const parrafo = (txt, { size = 8.4, gap = 2.2 } = {}) => {
    doc.setFontSize(size); doc.setFont('helvetica', 'normal')
    const lineas = doc.splitTextToSize(txt, ANCHO)
    const alto = lineas.length * 3.6
    salto(alto)
    doc.text(lineas, L, y, { align: 'justify', maxWidth: ANCHO })
    y += alto + gap
  }

  const vitalicio  = afiliacion.tipo === 'VITALICIO'
  const renovacion = !vitalicio && contrato.numero >= 1
  const nivel      = afiliacion.nivel
  const nivelTxt   = vitalicio ? nivel + ' VITALICIO' : nivel
  // El papel declara el valor de LISTA (es la base del 5×/3× del Parágrafo 2) y,
  // si hubo descuento, lo dice aparte con el valor efectivamente pagado. Sin esa
  // línea el contrato se contradecía: "vale $93.000 y su activación $620.000".
  const valor      = valorListaContrato(contrato)
  const pctDcto    = Math.min(100, Math.max(0, parseFloat(contrato.descuento_pct) || 0))
  const valorPagado = parseFloat(contrato.valor) || 0
  const m1 = parseFloat(config?.multiplicador_semestre_1) || 5
  const m2 = parseFloat(config?.multiplicador_semestre_2) || 3
  const recargo = parseFloat(config?.recargo_municipios) || 30000
  const miles = n => new Intl.NumberFormat('es-CO').format(Math.round(n))
  const pesos = n => numeroALetras(n) + ' pesos ($ ' + miles(n) + ')'

  // ── Encabezado ──
  y = 16
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('CONTRATO #' + (contrato.numero_contrato || '—'), W / 2, y, { align: 'center' })
  if (!vitalicio) {
    y += 5; doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text('12 MESES', R, y, { align: 'right' })
  }
  y += 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
  const titulo = 'CONTRATO DE SERVICIO PLAN PRE EXEQUIAL ' + nivelTxt + ' “POR SIEMPRE EN MI CORAZÓN”'
  const tLineas = doc.splitTextToSize(titulo, ANCHO - 10)
  doc.text(tLineas, W / 2, y, { align: 'center' }); y += tLineas.length * 5 + 1
  doc.setFontSize(9)
  doc.text('CAMINO AL CIELO – FUNERARIA PARA MASCOTAS', W / 2, y, { align: 'center' }); y += 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text(EMPRESA.version, R, y, { align: 'right' }); y += 6

  // ── Condiciones del contrato / TOMADOR ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4)
  doc.text('CONDICIONES DEL CONTRATO:', L, y); y += 4
  const nombreTomador = (String(cliente?.nombre || '') + ' ' + String(cliente?.apellido || '')).trim().toUpperCase()
  const unaSola = mascotas.length === 1
  parrafo(
    'El presente contrato se celebra entre ' + EMPRESA.razon + ' con su marca Camino al Cielo y ' + nombreTomador +
    ' identificado con cedula de ciudadanía número ' + formatCedula(cliente?.cedula_nit) + ' ahora en adelante EL ' +
    'TOMADOR. Previo a recepción de este contrato ha manifestado que desea recibir el servicio de Plan Pre Exequial ' +
    nivelTxt + ' que ofrece ' + EMPRESA.razon + ' con su marca Camino al cielo, para ' +
    (unaSola ? 'la mascota' : 'las mascotas') + ':',
    { gap: 3.5 })

  // ── Tabla de mascotas ──
  const COLS = [
    { t: 'RAZA:',      x: L,       w: 42 },
    { t: 'EDAD AÑOS:', x: L + 44,  w: 22 },
    { t: 'PESO:',      x: L + 68,  w: 18 },
    { t: 'NOMBRE:',    x: L + 88,  w: 48 },
    { t: 'ESPECIE:',   x: L + 138, w: 30 },
  ]
  salto(8 + mascotas.length * 5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  for (const c of COLS) doc.text(c.t, c.x, y)
  y += 4.5
  doc.setFont('helvetica', 'normal')
  for (const m of mascotas) {
    salto(6)
    const edad = edadALaFecha(m, contrato.fecha_inicio)
    const celdas = [
      String(m?.raza || '—').toUpperCase(),
      edad == null ? '—' : edad + ' AÑOS',
      m?.peso_kg ? m.peso_kg + ' KG' : '—',
      String(m?.nombre || '—').toUpperCase(),
      String(m?.especies?.nombre || '—').toUpperCase(),
    ]
    let extra = 0
    celdas.forEach((v, i) => {
      const ls = doc.splitTextToSize(v, COLS[i].w)
      doc.text(ls, COLS[i].x, y)
      extra = Math.max(extra, (ls.length - 1) * 3.4)
    })
    y += 5 + extra
  }
  y += 2.5

  // ── Condiciones generales ──
  parrafo(
    'CONDICIONES GENERALES: Primera. Los servicios que ofrece ' + EMPRESA.razon + ' con su marca Camino al Cielo son ' +
    'aplicados únicamente luego cancelar el servicio solicitado y su respectiva activación. Los servicios vigentes son: ' +
    'Plan Pre-Exequial Bronce, Plan Pre-Exequial Plata, plan pre-exequial Oro y Plan Pre-exequial Diamante. En todo caso ' +
    'para efectos de consulta de cada uno de los servicios, estos se encuentran descritos en www.caminoalcielo.com.co. ' +
    'Los planes y su contenido están sujetos a modificación sin previo aviso por parte de ' + EMPRESA.razon +
    ' con su marca Camino al Cielo.')

  parrafo(
    'Parágrafo 1: El TOMADOR reconoce expresamente que la contraprestación que recibe a cambio del pago es y será ' +
    'siempre en especie, mediante la prestación del servicio funerario a su mascota. Por esa razón renuncia expresamente ' +
    'a cualquier reclamación en dinero, por servicios no prestados o prestados sólo parcialmente. Tampoco podrá ' +
    'renunciar el Tomador a la prestación del servicio, con la intención de que le sea pagada alguna suma de dinero en ' +
    'contraprestación o como compensación.')

  // Frase del descuento, con el motivo tal como lo guardó el contrato.
  const parrafoDescuento = () => {
    if (!(pctDcto > 0)) return
    const motivo = MOTIVOS_DESCUENTO[contrato.descuento_motivo]
    parrafo(
      'Parágrafo ' + (vitalicio ? '3' : '4') + ': Sobre el valor de la afiliación aquí señalado, EL TOMADOR recibió ' +
      'un descuento del ' + pctDcto + '%' + (motivo ? ' por ' + motivo.toLowerCase() : '') +
      ', por lo cual el valor efectivamente pagado por mascota es de ' + pesos(valorPagado) +
      '. El descuento aplica únicamente al valor de la afiliación' +
      (vitalicio ? '.' : ' y no modifica los valores de activación señalados en el Parágrafo 2.'))
  }

  if (vitalicio) {
    parrafo(
      'Parágrafo 2: La afiliación al Plan Pre Exequial ' + nivelTxt + ' tiene un valor de ' + pesos(valor) +
      ' por mascota, no tiene tiempos de carencia, por lo cual se puede solicitar y utilizar a partir de la ' +
      'formalización del contrato.')
    parrafoDescuento()
    parrafo(
      'Segunda. – VIGENCIA DEL CONTRATO – El presente contrato tiene vigencia desde el: ' +
      fechaLarga(contrato.fecha_inicio) + ' hasta requerir la utilización del mismo.')
  } else {
    // En la renovación la activación va en $0: "no tendrá activación si hay
    // continuidad en la renovación" (Parágrafo 3 del original).
    const act1 = renovacion ? 0 : valor * m1
    const act2 = renovacion ? 0 : valor * m2
    parrafo(
      'Parágrafo 2: La afiliación al Plan Pre Exequial ' + nivel + ' tiene un valor de ' + pesos(valor) +
      ' por mascota y su activación por cada mascota tiene un valor de ' + pesos(act1) +
      ' desde su formalización hasta el día 180, y un valor de ' + pesos(act2) +
      ' desde el día 181 hasta la finalización del contrato.')
    parrafo(
      'Parágrafo 3: El presente contrato es renovable siempre y cuando el TOMADOR cancele de nuevo la afiliación ' +
      nivel + ' antes de transcurridos 365 días desde la formalización del mismo, y este no tendrá activación si hay ' +
      'continuidad en la renovación.')
    parrafoDescuento()
    parrafo(
      'Segunda. – VIGENCIA DEL CONTRATO – El presente contrato tiene una vigencia de 365 días luego de su ' +
      'formalización, para efectos de este contrato en particular su vigencia es desde el ' +
      fechaLarga(contrato.fecha_inicio) + ', hasta el ' + fechaLarga(contrato.fecha_vencimiento) + '.')
  }

  parrafo(
    'Tercera. – VERACIDAD DE LA INFORMACIÓN – EL TOMADOR al celebrar el contrato por la sola aceptación de sus ' +
    'condiciones, se entiende prestado el juramento de que la mascota para la que se compra el plan Pre Exequial está ' +
    'viva al momento de pagar. En caso de información falsa, siendo estos motivos de exclusión, quedará anulado el ' +
    'contrato; el prestador del servicio queda exonerado de prestarlo y El TOMADOR perderá las sumas de dinero que ' +
    'hubiese pagado, lo cual se acepta expresamente.')

  parrafo(
    'Cuarta. – RECOGIDA DE LA MASCOTA – La recogida de la mascota por el valor del servicio anual se realiza única y ' +
    'exclusivamente en BOGOTA, D. C. entre las 7:00 am y 6:00 pm de Domingo a Domingo, sin embargo, en municipios ' +
    'aledaños a la ciudad: (Funza, Mosquera, entre otros): se garantiza el servicio con un recargo adicional a: ' +
    miles(recargo) + ' pesos. La recogida de la mascota está sujeta al volumen de rutas programadas al momento de ' +
    'solicitar el servicio.')

  parrafo('Quinta. – OBLIGACIONES DE LAS PARTES:', { gap: 1.5 })
  const sangria = txt => {
    doc.setFontSize(8.4); doc.setFont('helvetica', 'normal')
    const ls = doc.splitTextToSize(txt, ANCHO - 10)
    const alto = ls.length * 3.6
    salto(alto)
    doc.text(ls, L + 10, y, { align: 'justify', maxWidth: ANCHO - 10 })
    y += alto + 2.2
  }
  sangria(
    'A. OBLIGACIONES DEL TOMADOR: 1. EL TOMADOR se obliga, a suministrar sus datos y los de su mascota de una forma ' +
    'veraz y oportuna; el hecho de incurrir en falsedad exonerará en todo a ' + EMPRESA.razon + ' con su marca Camino ' +
    'al Cielo, del cumplimiento del presente contrato y de cualquier otra obligación que pudiera resultar desde el ' +
    'momento en que se incurra en dicha falsedad y sin necesidad de dar aviso al TOMADOR. 2. Igualmente EL TOMADOR se ' +
    'obliga a cancelar el valor del servicio antes de recibirlo. 3. A mantener actualizada su información personal ' +
    'para efectos de ser contactado por ' + EMPRESA.razon + ' con su marca Camino al Cielo.')
  sangria(
    'B. OBLIGACIONES DE ' + EMPRESA.razon + ' con su marca Camino al Cielo: está obligado a prestar el servicio de ' +
    'funeraria para mascotas en cualquier servicio vigente solicitado y pagado por EL TOMADOR y el manejo confidencial ' +
    'de los datos suministrados. Igualmente se obliga realizar su labor dando un trato digno hacia EL TOMADOR y su ' +
    'mascota fallecida.')

  parrafo(
    'Sexta. – Aceptación de las condiciones del contrato por parte del TOMADOR: El tomador reconoce y acepta haber ' +
    'conocido con anterioridad a la adquisición del servicio los términos y condiciones bajo los cuales se ejecutan ' +
    'los servicios vigentes de funeraria para mascotas que ofrece ' + EMPRESA.razon + ' con su marca Camino al Cielo.',
    { gap: 6 })

  // ── Firmas: TOMADOR a la izquierda, Camino al Cielo a la derecha ──
  const XD = W / 2 + 6
  salto(30)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4)
  doc.text('EL TOMADOR:', L, y); doc.text('Camino al Cielo', XD, y)
  y += 4.5
  doc.setFont('helvetica', 'normal')
  const izq = [
    nombreTomador,
    'C.C: ' + formatCedula(cliente?.cedula_nit),
    'CEL: ' + ([cliente?.whatsapp, cliente?.telefono].filter(Boolean).join('/') || '—'),
    'EMAIL: ' + (cliente?.email || '—'),
  ]
  const der = [EMPRESA.razon, '', EMPRESA.nit, EMPRESA.whatsapp, EMPRESA.telefono]
  // Cada celda va como string, NO como arreglo: jsPDF le corre la línea base a
  // los arreglos y el nombre del tomador dejaba de alinear con la razón social.
  for (let i = 0; i < Math.max(izq.length, der.length); i++) {
    if (izq[i]) doc.text(String(izq[i]), L, y)
    if (der[i]) doc.text(String(der[i]), XD, y)
    y += 4
  }

  return doc
}
