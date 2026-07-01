import { db } from './supabase'
import { today, waLink } from './utils'
import { LOGO_CAMINO } from './logoCamino'
import { FIRMA_CAMINO } from './firmaCamino'

// ─── Generar PDF con jsPDF y subir a Supabase Storage ────────────────────────
// Devuelve la URL pública del PDF subido
export async function generarYSubirPDF(html, nombreArchivo) {
  const { default: jsPDF } = await import('jspdf')

  // Renderizar el HTML en un iframe oculto para capturarlo con html2canvas
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:820px;height:auto;border:none;'
  document.body.appendChild(iframe)

  await new Promise(resolve => {
    iframe.onload = resolve
    iframe.srcdoc = html
  })

  // Pequeño delay para que los estilos se apliquen
  await new Promise(r => setTimeout(r, 400))

  const contentDoc = iframe.contentDocument || iframe.contentWindow.document
  const body = contentDoc.body

  // html2canvas sobre el iframe
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(body, {
    scale:           1.8,
    useCORS:         true,
    backgroundColor: '#ffffff',
    windowWidth:     820,
    logging:         false,
  })

  document.body.removeChild(iframe)

  // Convertir canvas a PDF
  const imgData = canvas.toDataURL('image/jpeg', 0.92)
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const ratio = canvas.width / canvas.height
  const imgH  = pageW / ratio

  // Paginar si el contenido es más largo que una página
  let yPos = 0
  while (yPos < imgH) {
    if (yPos > 0) pdf.addPage()
    pdf.addImage(imgData, 'JPEG', 0, -yPos, pageW, imgH)
    yPos += pageH
  }

  const pdfBlob = pdf.output('blob')

  // Subir a Supabase Storage (bucket: certificados)
  const path = `${today()}_${nombreArchivo}_${Date.now()}.pdf`
  const { data, error } = await db.storage
    .from('certificados')
    .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: false })

  if (error) throw new Error('Error subiendo PDF: ' + error.message)

  const { data: urlData } = db.storage.from('certificados').getPublicUrl(path)
  return urlData.publicUrl
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtFechaCorta(s) {
  if (!s) return '-'
  const d = new Date(s + 'T12:00:00')
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function fmtFechaLarga(s) {
  if (!s) return '-'
  const d = new Date(s + 'T12:00:00')
  const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                 'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
  return `${d.getDate()} DE ${meses[d.getMonth()]} DEL ${d.getFullYear()}`
}

function sumarPesos(servicios) {
  const total = servicios.reduce((acc, s) => acc + (parseFloat(s.peso_kg) || 0), 0)
  return total.toFixed(1)
}

// Fecha del proceso colectivo = la fecha de proceso MÁS RECIENTE del lote
// (= ingreso de la última mascota en entrar + 3 días hábiles, ya calculado por el
// backend como fecha_vencimiento de cada ítem). Así todas las mascotas cumplen los
// 3 días hábiles desde su ingreso. Cae a la fecha del lote solo si faltara el dato.
function fechaProcesoColectiva(servicios, lote) {
  const fechas = (servicios || []).map(s => s.fecha_proceso).filter(Boolean).sort()
  return fechas.length ? fechas[fechas.length - 1] : (lote.fecha_completado || lote.fecha_envio || today())
}

// ─── CSS compartido ───────────────────────────────────────────────────────────
const CSS_CREMACION = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px;
         color: #1a1a1a; max-width: 720px; margin: 30px auto; padding: 40px;
         background: #fff; line-height: 1.7; }
  .header { text-align:center; margin-bottom: 28px; }
  .logo-row { display:flex; align-items:center; justify-content:center; gap:30px; margin-bottom:14px; }
  .logo-text { text-align:center; }
  .logo-name  { font-size: 18px; font-weight: bold; color: #1a1a1a; }
  .logo-sub   { font-size: 11px; color: #555; }
  .title { font-size: 16px; font-weight: bold; text-decoration: underline;
           text-transform: uppercase; text-align:center; margin: 16px 0 24px; }
  p { margin-bottom: 14px; text-align: justify; }
  table { width:100%; border-collapse: collapse; margin: 18px 0; }
  th { font-style: italic; text-align:left; padding: 6px 10px; border: 1px solid #999;
       font-size: 12px; }
  td { padding: 5px 10px; border: 1px solid #999; font-size: 12px; }
  .total-row td { font-weight: bold; background: #f5f5f5; }
  .cierre { font-weight: bold; text-align: justify; margin-top: 20px; }
  .footer { margin-top: 36px; display:flex; align-items:center; gap:14px;
            border-top: 1px solid #ddd; padding-top: 14px; }
  .footer-text { font-size: 11px; color: #555; }
  .footer-text strong { font-size: 12px; color: #1a1a1a; }
  .paws { font-size: 20px; letter-spacing: 2px; }
  .logo-img { height: 66px; display:block; margin: 0 auto 8px; }
  .firma { margin-top: 46px; text-align:center; }
  .firma-img { height: 58px; display:block; margin: 0 auto -6px; }
  .firma-line { width: 240px; border-top: 1px solid #333; margin: 0 auto 6px; }
  .firma-name { font-weight: bold; font-size: 13px; }
  .firma-role { font-size: 11px; color: #555; }
  @media print { body { margin: 20px; } }
`

const CSS_COMPOSTAJE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px;
         color: #1a1a1a; max-width: 720px; margin: 30px auto; padding: 40px;
         background: #fff; line-height: 1.75; }
  .header { text-align:center; margin-bottom: 24px; }
  .logo-name  { font-size: 20px; font-weight: bold; color: #2D6A2D; }
  .logo-sub   { font-size: 11px; color: #555; margin-top: 3px; }
  .logo-contact { font-size: 11px; color: #555; margin-top: 2px; }
  .title { font-size: 17px; font-weight: bold; text-align:center;
           color: #2D6A2D; margin: 18px 0 22px; }
  p { margin-bottom: 14px; text-align: justify; }
  table { width:100%; border-collapse: collapse; margin: 16px 0; }
  th { font-style: italic; font-weight: bold; text-align:left;
       padding: 7px 10px; border: 1px solid #999; font-size: 12px; color: #2D6A2D; }
  td { padding: 6px 10px; border: 1px solid #999; font-size: 12px; }
  tr:nth-child(even) td { background: #f9fdf9; }
  .sig-area { margin-top: 48px; }
  .sig-line { width: 200px; border-top: 1px solid #333; margin-bottom: 4px; }
  .sig-name { font-weight: bold; font-size: 13px; }
  .sig-role { font-size: 12px; color: #555; }
  .footer { margin-top: 28px; display:flex; justify-content:flex-end; text-align:right;
            border-top: 1px solid #ddd; padding-top: 12px; }
  .footer-text { font-size: 11px; color: #555; }
  .footer-text strong { font-size: 12px; color: #1a1a1a; display:block; }
  .paws { font-size: 18px; letter-spacing: 2px; margin-bottom: 4px; }
  .logo-img { height: 66px; display:block; margin: 0 auto 8px; }
  .firma-img { height: 58px; display:block; margin-bottom: -6px; }
  @media print { body { margin: 20px; } }
`

// ─── Reporte Técnico de Cremación Grupal ──────────────────────────────────────
export function generarHTMLCremacionGrupal({ lote, servicios, coordinador }) {
  const fecha      = fechaProcesoColectiva(servicios, lote)
  const fechaCorta = fmtFechaCorta(fecha)
  const fechaLarga = fmtFechaLarga(fecha)
  const fechaEmision = fmtFechaLarga(today())  // el documento se elabora hoy
  // Empresa que ejecuta la cremación. `entidad_externa` guarda un placeholder
  // heredado ("Entidad certificada Bogotá"); se normaliza (sin tildes/mayúsculas)
  // para detectarlo en cualquier variante y usar el nombre real de la planta.
  const norm = s => (s || '').normalize('NFD')
    .split('').filter(c => { const n = c.charCodeAt(0); return n < 0x300 || n > 0x36f }).join('')
    .toLowerCase().trim()
  const empresa    = (lote.entidad_externa && norm(lote.entidad_externa) !== 'entidad certificada bogota')
    ? lote.entidad_externa
    : 'INDUSTRIA AMBIENTAL S.A.S/ECOLOGIA Y ENTORNO S.A.S ESP'
  const duracion   = lote.duracion_proceso || '6 horas y 18 minutos'
  const pesoTotal  = sumarPesos(servicios)

  const filas = servicios.map(s => `
    <tr>
      <td>${(s.mascota || '').toUpperCase()}</td>
      <td style="text-align:right">${s.peso_kg ? parseFloat(s.peso_kg).toFixed(1) : '-'}</td>
      <td>${s.cliente || '-'}</td>
      <td style="text-align:center">${fechaCorta}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Reporte Técnico de Cremación — ${lote.numero_lote}</title>
<style>${CSS_CREMACION}</style></head>
<body>
  <div class="header">
    <div class="logo-row">
      <div class="logo-text">
        <img class="logo-img" src="${LOGO_CAMINO}" alt="Camino al Cielo" />
        <div class="logo-sub">Servicios funerarios para mascotas</div>
        <div class="logo-sub">Cel: 319 358 5508 – 322 218 7087 &nbsp;·&nbsp; contacto@caminoalcielo.com.co</div>
      </div>
    </div>
  </div>

  <div class="title">Reporte Técnico de Cremación</div>

  <p>
    Por medio del presente se reporta con detalle el procedimiento técnico de recepción y
    cremaciones grupales de las mascotas que han adquirido los servicios funerarios de
    <strong>Camino al Cielo Funeraria para Mascotas</strong> durante la fecha de emisión
    de este reporte.
  </p>

  <table>
    <thead>
      <tr>
        <th>Mascota:</th>
        <th>Peso:</th>
        <th>Propietario:</th>
        <th>Fecha de la cremación colectiva:</th>
      </tr>
    </thead>
    <tbody>
      ${filas}
    </tbody>
  </table>

  <p>
    Una vez se realizó la recepción técnica de las mascotas, se trasladaron a nuestra planta
    donde se mantuvieron en conservación a -10°C mínimo durante 48 horas. Se detallan a
    continuación los datos de las mascotas como: nombre, peso, propietario y fecha de la
    cremación grupal:
  </p>

  <p>
    El día <strong>${fechaLarga}</strong> se realiza cremación colectiva de los restos biológicos
    de las mascotas mencionadas en el cuadro anterior, en totalidad de: <strong>${pesoTotal} Kg</strong>;
    con duración de <strong>${duracion}</strong>, con la empresa:
  </p>

  <p style="text-align:center; font-weight:bold;">"${empresa}".</p>

  <p>
    Para este proceso se registraron temperaturas no menores a <strong>850°C</strong> en la cámara
    de combustión primaria y <strong>1.200°C</strong> en la cámara de postcombustión.
  </p>

  <p>
    Se utilizaron los sistemas de enfriamiento y depuración de gases, con los cuales se presentaron
    emisiones atmosféricas dentro de los estándares permisibles, quedando un residuo consistente en
    cenizas calcinadas y dispuestas en un relleno industrial autorizado y legalizado.
  </p>

  <p>
    Todos los procesos anteriores se realizaron ajustados al cumplimiento de las resoluciones 058 de
    enero de 2002; 0886 de julio 27 de 2004 y 909 del 06 de junio de 2008 del MAVDT y a la licencia
    ambiental, según resolución N° 3077 de noviembre 7 de 2006, expedida por la CAR.
  </p>

  <p class="cierre">
    Para constancia del procedimiento, se elabora este reporte técnico a petición de las partes
    interesadas el día ${fechaEmision}.
  </p>

  <div class="firma">
    <img class="firma-img" src="${FIRMA_CAMINO}" alt="Firma" />
    <div class="firma-line"></div>
    <div class="firma-name">Carlos Lopez</div>
    <div class="firma-role">Coordinador</div>
  </div>

  <div class="footer">
    <span class="paws">🐾🐾🐾</span>
    <div class="footer-text">
      <strong>Camino al Cielo</strong>
      Servicios Funerarios para mascotas<br>
      Cel: 319 358 5508 – 322 218 7087<br>
      Email: contacto@caminoalcielo.com.co &nbsp;·&nbsp; www.caminoalcielo.com.co
    </div>
  </div>
</body></html>`
}

// ─── Certificado de Compostaje Grupal ─────────────────────────────────────────
export function generarHTMLCompostajeGrupal({ lote, servicios, coordinador }) {
  const fecha      = fechaProcesoColectiva(servicios, lote)
  const fechaLarga = fmtFechaLarga(fecha)
  const fechaEmision = fmtFechaLarga(today())  // el documento se elabora hoy

  const filas = servicios.map(s => `
    <tr>
      <td><strong>${(s.mascota || '').toUpperCase()}</strong></td>
      <td style="text-align:right">${s.peso_kg ? parseFloat(s.peso_kg).toFixed(1) : '-'}</td>
      <td><strong>${s.cliente || '-'}</strong></td>
      <td style="text-align:center">${fmtFechaCorta(fecha)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Certificado de Compostaje Grupal — ${lote.numero_lote}</title>
<style>${CSS_COMPOSTAJE}</style></head>
<body>
  <div class="header">
    <img class="logo-img" src="${LOGO_CAMINO}" alt="Camino al Cielo" />
    <div class="logo-sub">Servicios Funerarios para mascotas</div>
    <div class="logo-contact">Cel: 319 358 5508 – 322 218 7087 &nbsp;·&nbsp; Email: contacto@caminoalcielo.com.co</div>
  </div>

  <div class="title">Certificado de compostaje grupal</div>

  <p>
    Por medio de la presente certificación confirmamos que se realizó un proceso de
    <strong>compostaje grupal</strong>. Este procedimiento se llevó a cabo bajo condiciones
    controladas de biotransformación, permitiendo la descomposición natural de los restos
    biológicos en materia orgánica, contribuyendo así a un proceso ambientalmente sostenible.
    De las siguientes mascotas:
  </p>

  <p>
    Este procedimiento se realiza en conjunto con otras mascotas en condiciones controladas
    para garantizar una adecuada transformación.
  </p>

  <table>
    <thead>
      <tr>
        <th>Mascota:</th>
        <th>Peso:</th>
        <th>Propietario:</th>
        <th>Fecha de compostaje colectivo:</th>
      </tr>
    </thead>
    <tbody>
      ${filas}
    </tbody>
  </table>

  <p>
    El compostaje grupal se lleva a cabo mediante un sistema de biodegradación aeróbica, con una
    duración aproximada de <strong>6 – 8 meses</strong>, dependiendo de las condiciones ambientales
    y del tamaño/peso del peludito. Durante este período, se aplican técnicas de manejo de
    temperatura, humedad y oxigenación para asegurar una transformación eficiente y sin impacto
    ambiental negativo.
  </p>

  <p>
    Todos los procesos anteriores se realizaron cumpliendo con las normativas ambientales vigentes
    y los estándares de disposición ecológica.
  </p>

  <p>
    Para constancia del procedimiento, se elabora esta certificación el día
    <strong>${fechaEmision}.</strong>
  </p>

  <div class="sig-area">
    <img class="firma-img" src="${FIRMA_CAMINO}" alt="Firma" />
    <div class="sig-line"></div>
    <div class="sig-name">Carlos Lopez</div>
    <div class="sig-role">Coordinador</div>
  </div>

  <div class="footer">
    <div class="footer-text">
      <span class="paws">🐾🐾</span>
      <strong>Camino Al Cielo</strong>
      Servicios Funerarios para mascotas<br>
      Cel: 319 358 5508 – 322 218 7087<br>
      Email: contacto@caminoalcielo.com.co
    </div>
  </div>
</body></html>`
}

// ─── Certificado individual (cremación o compostaje) ──────────────────────────
export function generarHTMLIndividual({ traslado }) {
  const svc      = traslado.servicios
  const m        = svc?.mascotas
  const c        = m?.clientes
  const plan     = svc?.planes
  const esEco    = plan?.tipo_proceso === 'COMPOSTAJE_INDIVIDUAL'
  const tipoCert = esEco ? 'COMPOSTAJE INDIVIDUAL' : 'CREMACIÓN INDIVIDUAL'
  const mascota  = m?.nombre || '-'
  const especie  = m?.especies?.nombre || '-'
  const cliente  = `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-'
  const fecha    = traslado.fecha_completado || today()

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Certificado ${tipoCert} — ${mascota}</title>
<style>${CSS_CREMACION}</style></head>
<body>
  <div class="header">
    <div class="logo-text">
      <img class="logo-img" src="${LOGO_CAMINO}" alt="Camino al Cielo" />
      <div class="logo-sub">Servicios funerarios para mascotas</div>
      <div class="logo-sub">Cel: 319 358 5508 – 322 218 7087 &nbsp;·&nbsp; contacto@caminoalcielo.com.co</div>
    </div>
  </div>

  <div class="title">Certificado de ${tipoCert}</div>

  <p>
    La empresa <strong>Camino al Cielo — Servicios Funerarios para Mascotas</strong>
    certifica que la mascota de la familia <strong>${cliente}</strong> fue sometida al
    proceso de <strong>${tipoCert.toLowerCase()}</strong> en la planta de Tenjo,
    Cundinamarca, conforme al plan <strong>${plan?.nombre || '-'}</strong> contratado.
  </p>

  <table>
    <thead>
      <tr>
        <th>Mascota:</th>
        <th>Especie:</th>
        <th>Propietario:</th>
        <th>Fecha del proceso:</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${mascota.toUpperCase()}</strong></td>
        <td>${especie}</td>
        <td>${cliente}</td>
        <td style="text-align:center">${fmtFechaCorta(fecha)}</td>
      </tr>
    </tbody>
  </table>

  ${esEco ? `
  <p>
    El proceso de <strong>compostaje individual</strong> fue realizado en condiciones controladas
    en la planta de Tenjo, Cundinamarca. El material procesado estará disponible para el
    propietario según las condiciones acordadas en el contrato de servicio.
  </p>
  ` : `
  <p>
    El proceso de <strong>cremación individual</strong> garantiza que las cenizas obtenidas
    corresponden exclusivamente a la mascota indicada. Las cenizas serán entregadas al
    propietario en el paquete de recordatorios, según el plan contratado.
  </p>
  `}

  <p class="cierre">
    Para constancia del procedimiento, se elabora este certificado el día ${fmtFechaLarga(today())}.
  </p>

  <div class="firma">
    <img class="firma-img" src="${FIRMA_CAMINO}" alt="Firma" />
    <div class="firma-line"></div>
    <div class="firma-name">Carlos Lopez</div>
    <div class="firma-role">Coordinador</div>
  </div>

  <div class="footer">
    <span class="paws">🐾🐾🐾</span>
    <div class="footer-text">
      <strong>Camino al Cielo</strong>
      Servicios Funerarios para mascotas<br>
      Cel: 319 358 5508 – 322 218 7087<br>
      Email: contacto@caminoalcielo.com.co &nbsp;·&nbsp; www.caminoalcielo.com.co
    </div>
  </div>
</body></html>`
}

// ─── Abrir ventana de impresión ───────────────────────────────────────────────
export function imprimirCertificado(html) {
  const w = window.open('', '_blank', 'width=860,height=750')
  if (!w) return
  w.document.write(html)
  w.document.close()
  setTimeout(() => w.print(), 700)
}

// ─── Registrar en DB ──────────────────────────────────────────────────────────
export async function registrarCertificado({ servicioId, tipo, loteId = null, generadoPor = null }) {
  const { data, error } = await db.from('certificados_emitidos').insert({
    servicio_id:   servicioId,
    tipo,
    lote_id:       loteId,
    fecha_emision: today(),
    generado_por:  generadoPor,
  }).select('id').single()
  if (error) console.error('Error registrando certificado:', error)
  return data?.id || null
}

// ─── Marcar como enviado por WhatsApp ─────────────────────────────────────────
export async function marcarEnviadoWA(certId) {
  await db.from('certificados_emitidos')
    .update({ enviado_whatsapp: true, fecha_envio_wa: new Date().toISOString() })
    .eq('id', certId)
}

// ─── Abrir WhatsApp con mensaje prellenado ────────────────────────────────────
export function abrirWhatsApp(whatsapp, mascota, tipo) {
  const numero = (whatsapp || '').replace(/\D/g, '')
  if (!numero) return false
  const tipoLabel = tipo.toLowerCase().replace(/_/g, ' ')
  const msg =
    `Hola, le compartimos el certificado de ${tipoLabel} de ${mascota}. ` +
    `Por favor guárdelo como constancia del servicio prestado por Camino al Cielo. ` +
    `Si tiene alguna pregunta, estamos a su disposición.`
  window.open(waLink(numero, msg), '_blank')
  return true
}
