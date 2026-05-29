import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { fmt, petEmoji } from '@/lib/utils'
import { Search, RefreshCw, Download, Filter, X, Eye, FileText, CheckSquare, Square } from 'lucide-react'

// ── Datos fijos del negocio ────────────────────────────────────────────────────
const EMPRESA = {
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

const ESTADO_PAGO_COLOR = {
  PENDIENTE: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  PARCIAL:   { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE' },
  COMPLETO:  { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
}
function BadgePago({ estado }) {
  const c = ESTADO_PAGO_COLOR[estado] || { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ background: c.bg, color: c.text, borderColor: c.border }}>
      {estado}
    </span>
  )
}

// ── Helpers compartidos ───────────────────────────────────────────────────────
function buildReciboData(svc, pesoConfirmado) {
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
    telefono:       cliente?.telefono || cliente?.whatsapp || '',
    direccion:      svc.direccion_recogida || '',
    servicio:       svc.planes?.nombre || '',
    valor_total:    svc.valor_total  || 0,
    valor_pagado:   svc.valor_pagado || 0,
    metodo_pago:    svc.metodo_pago  || '',
    tecnico:        svc.tecnico ? `${svc.tecnico.nombre} ${svc.tecnico.apellido}` : '',
    estado_pago:    svc.estado_pago,
  }
}

// ── Preview HTML del recibo ───────────────────────────────────────────────────
function PreviewRecibo({ r }) {
  const G = '#1F5A32'
  const s = (v) => v || '—'

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 520, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', fontSize: 13 }}>

      {/* Cabecera */}
      <div style={{ background: G, padding: '18px 20px 14px', textAlign: 'center' }}>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>{EMPRESA.nombre}</div>
        <div style={{ color: '#B0D4BC', fontSize: 11, marginTop: 2 }}>{EMPRESA.subtitulo} · {EMPRESA.ciudad}</div>
        <div style={{ color: '#C4A87A', fontSize: 10, fontWeight: 700, marginTop: 4, letterSpacing: 1 }}>RECIBO DE SERVICIO</div>
      </div>

      {/* Número y fecha */}
      <div style={{ background: '#F4F7F4', display: 'flex', justifyContent: 'space-between', padding: '8px 20px', borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontWeight: 700, color: G, fontSize: 12 }}>No. {r.numero}</span>
        <span style={{ color: '#555', fontSize: 12 }}>Fecha: {r.fecha}</span>
      </div>

      <div style={{ padding: '0 20px 16px' }}>

        {/* Datos mascota */}
        <Section title="DATOS DE LA MASCOTA">
          <Row2 a={['Mascota', s(r.mascota_nombre)]} b={['Especie', s(r.especie)]} />
          <Row2 a={['Peso', r.peso ? `${r.peso} kg` : '—']} b={['Veterinaria / Aliado', s(r.veterinaria)]} />
        </Section>

        {/* Datos propietario */}
        <Section title="DATOS DEL PROPIETARIO">
          <RowFull label="Nombre" value={s(r.propietario)} />
          <Row2 a={['Correo', s(r.email)]} b={['Teléfono', s(r.telefono)]} />
          <RowFull label="Dirección de recogida" value={s(r.direccion)} />
        </Section>

        {/* Servicio y pago */}
        <Section title="SERVICIO Y PAGO">
          <RowFull label="Plan / Servicio" value={s(r.servicio)} />
          <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
            <ValBox label="Valor del servicio" value={fmt(r.valor_total)} />
            <ValBox label="Total recibido"     value={fmt(r.valor_pagado)} color="#1D8A55" />
            {r.saldo > 0 && <ValBox label="Saldo pendiente" value={fmt(r.saldo)} color="#C03030" />}
          </div>
          {r.metodo_pago && <RowFull label="Método de pago" value={r.metodo_pago} />}
          {r.tecnico && <RowFull label="Técnico" value={r.tecnico} />}
        </Section>

        {/* Datos de pago */}
        <Section title="DATOS DE PAGO / TRANSFERENCIA">
          {EMPRESA.pagos.map(p => (
            <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ color: '#555', fontSize: 12 }}>{p.label}</span>
              <span style={{ fontWeight: 700, color: G, fontSize: 12 }}>{p.numero}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, padding: '6px 10px', background: '#FFF9ED', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 11, color: '#92400E' }}>
            💡 {EMPRESA.factura}
          </div>
        </Section>

        {/* Datos empresa */}
        <div style={{ marginTop: 12, padding: '10px 12px', background: '#F4F7F4', borderRadius: 8, fontSize: 11, color: '#4A6650', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: G, marginBottom: 3 }}>{EMPRESA.nombre} · NIT {EMPRESA.nit}</div>
          <div>{EMPRESA.direccion}, {EMPRESA.ciudad}</div>
          <div>📞 {EMPRESA.telefono} · ✉ {EMPRESA.email}</div>
          <div>🌐 {EMPRESA.web}</div>
        </div>

      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ background: '#E8F3EB', padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#1F5A32', letterSpacing: 0.5, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}
function RowFull({ label, value }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#111', marginTop: 1 }}>{value}</div>
    </div>
  )
}
function Row2({ a, b }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
      <div style={{ flex: 1 }}><RowFull label={a[0]} value={a[1]} /></div>
      <div style={{ flex: 1 }}><RowFull label={b[0]} value={b[1]} /></div>
    </div>
  )
}
function ValBox({ label, value, color = '#1F5A32' }) {
  return (
    <div style={{ flex: 1, border: '1.5px solid #C4A87A', borderRadius: 8, padding: '6px 10px', textAlign: 'center', background: '#FFFDF8' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#8C6C3C', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ── Modal previsualización ─────────────────────────────────────────────────────
function ModalPreview({ svc, pesoConfirmado, onClose, onDescargar, generando }) {
  const r = buildReciboData(svc, pesoConfirmado)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col">

        {/* Barra superior */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#1F5A32]" />
            <span className="font-bold text-gray-900 text-[15px]">Previsualización del recibo</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="p-5 overflow-y-auto max-h-[70vh]">
          <PreviewRecibo r={r} />
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
            Cerrar
          </button>
          <button onClick={onDescargar} disabled={generando}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all hover:opacity-90 disabled:opacity-60"
            style={{ background: '#1F5A32' }}>
            {generando
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Download size={14} />}
            Descargar PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generar PDF ───────────────────────────────────────────────────────────────
async function generarPDF(svc, pesoConfirmado) {
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
  field('Correo electrónico', r.email, M, yP2)
  field('Teléfono', r.telefono, M + CW / 2, yP2)
  y = yP2 + 12
  y = Math.max(field('Dirección de recogida', r.direccion, M, y, CW), y + 10)
  y = hr(y)

  // Servicio
  y = sec('SERVICIO CONTRATADO', y)
  y = Math.max(field('Plan / Servicio', r.servicio, M, y, CW), y + 10)
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

  pdf.save(`Recibo_${r.mascota_nombre || 'servicio'}_${r.numero}.pdf`)
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Recibos() {
  const [servicios,  setServicios]  = useState([])
  const [personal,   setPersonal]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  const [busqueda,   setBusqueda]   = useState('')
  const [tecnicoFil, setTecnicoFil] = useState('')
  const [estadoPago, setEstadoPago] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  const [preview,    setPreview]    = useState(null) // { svc, pesoConfirmado }
  const [generando,  setGenerando]  = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const [{ data: svcs, error: e1 }, { data: per }] = await Promise.all([
        db.from('servicios').select(`
          id, valor_total, valor_pagado, estado_pago, metodo_pago,
          fecha_ingreso, direccion_recogida, ciudad_recogida,
          mascotas:mascota_id(
            nombre, peso_kg,
            especies(nombre),
            clientes:cliente_id(nombre, apellido, email, telefono, whatsapp, direccion, ciudad)
          ),
          planes:plan_id(nombre, codigo),
          aliados:aliado_origen_id(nombre),
          tecnico:tecnico_id(id, nombre, apellido)
        `).order('fecha_ingreso', { ascending: false }).limit(500),
        db.from('personal').select('id, nombre, apellido').eq('activo', true).order('nombre'),
      ])
      if (e1) throw e1
      setServicios(svcs || [])
      setPersonal(per || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function abrirPreview(svc) {
    const { data: cf } = await db.from('cuarto_frio')
      .select('peso_kg').eq('servicio_id', svc.id).maybeSingle()
    setPreview({ svc, pesoConfirmado: cf?.peso_kg || null })
  }

  async function descargarDesdeModal() {
    if (!preview) return
    setGenerando(true)
    try { await generarPDF(preview.svc, preview.pesoConfirmado) }
    catch (e) { alert('Error al generar PDF: ' + e.message) }
    finally { setGenerando(false) }
  }

  const filtrados = servicios.filter(s => {
    const q = busqueda.toLowerCase()
    const mascota = s.mascotas?.nombre?.toLowerCase() || ''
    const cliente = `${s.mascotas?.clientes?.nombre || ''} ${s.mascotas?.clientes?.apellido || ''}`.toLowerCase()
    if (q && !mascota.includes(q) && !cliente.includes(q)) return false
    if (tecnicoFil && s.tecnico?.id !== tecnicoFil) return false
    if (estadoPago && s.estado_pago !== estadoPago) return false
    if (fechaDesde && s.fecha_ingreso < fechaDesde) return false
    if (fechaHasta && s.fecha_ingreso > fechaHasta) return false
    return true
  })

  const totalCobrado   = filtrados.reduce((s, v) => s + (v.valor_pagado || 0), 0)
  const totalPendiente = filtrados.reduce((s, v) => s + Math.max(0, (v.valor_total || 0) - (v.valor_pagado || 0)), 0)

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="spinner" /><span className="text-sm text-ink3">Cargando recibos...</span>
    </div>
  )
  if (error) return (
    <div className="p-7">
      <div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div>
    </div>
  )

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Servicios"   value={filtrados.length} />
          <StatCard label="Cobrado"     value={fmt(totalCobrado)}   valueColor="#1D8A55" />
          <StatCard label="Pendiente"   value={fmt(totalPendiente)} valueColor="#C03030" />
          <StatCard label="Completados" value={filtrados.filter(s => s.estado_pago === 'COMPLETO').length} valueColor="#3B6FBF" />
        </div>

        {/* Filtros */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            <Filter size={11} /> Filtros
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <Input className="pl-8" placeholder="Mascota o cliente..."
                value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            <Select value={tecnicoFil} onChange={e => setTecnicoFil(e.target.value)}>
              <option value="">Todos los técnicos</option>
              {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
            </Select>
            <Select value={estadoPago} onChange={e => setEstadoPago(e.target.value)}>
              <option value="">Estado de pago</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="PARCIAL">Parcial</option>
              <option value="COMPLETO">Completo</option>
            </Select>
            <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} title="Desde" />
            <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} title="Hasta" />
          </div>
        </div>

        {/* Tabla */}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Mascota / Cliente</Th>
                <Th>Plan</Th>
                <Th>Técnico</Th>
                <Th>Fecha</Th>
                <Th>Valor total</Th>
                <Th>Pagado</Th>
                <Th>Saldo</Th>
                <Th>Estado pago</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(s => {
                const m     = s.mascotas
                const saldo = Math.max(0, (s.valor_total || 0) - (s.valor_pagado || 0))
                const tec   = s.tecnico
                return (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="text-lg leading-none">{petEmoji(m?.especies?.nombre)}</span>
                        <div>
                          <div className="font-semibold text-ink text-[13px]">{m?.nombre || '—'}</div>
                          <div className="text-[10px] text-ink3">{m?.clientes?.nombre} {m?.clientes?.apellido}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-[11px] text-ink2">{s.planes?.nombre || '—'}</Td>
                    <Td className="text-[11px] text-ink2">
                      {tec ? `${tec.nombre} ${tec.apellido}` : <span className="text-ink3 italic">Sin asignar</span>}
                    </Td>
                    <Td className="text-[11px] text-ink3 tabular-nums">
                      {s.fecha_ingreso ? new Date(s.fecha_ingreso + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'}
                    </Td>
                    <Td className="font-semibold text-ink tabular-nums">{fmt(s.valor_total || 0)}</Td>
                    <Td className="text-[12px] text-green-700 font-semibold tabular-nums">{fmt(s.valor_pagado || 0)}</Td>
                    <Td className={`text-[12px] font-semibold tabular-nums ${saldo > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {saldo > 0 ? fmt(saldo) : '—'}
                    </Td>
                    <Td><BadgePago estado={s.estado_pago} /></Td>
                    <Td>
                      <button
                        onClick={() => abrirPreview(s)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-90"
                        style={{ background: '#EDE9FE', color: '#5B21B6' }}
                        title="Ver y descargar recibo">
                        <Eye size={11} /> Ver recibo
                      </button>
                    </Td>
                  </Tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-ink3 text-sm">
                    Sin servicios con los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>

      </div>

      {/* Modal preview */}
      {preview && (
        <ModalPreview
          svc={preview.svc}
          pesoConfirmado={preview.pesoConfirmado}
          onClose={() => setPreview(null)}
          onDescargar={descargarDesdeModal}
          generando={generando}
        />
      )}
    </div>
  )
}
