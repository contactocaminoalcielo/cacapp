import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { fmt, petEmoji } from '@/lib/utils'
import { EMPRESA, buildReciboData, generarReciboPDF } from '@/lib/reciboPdf'
import { Search, RefreshCw, Download, Filter, X, Eye, FileText, CheckSquare, Square } from 'lucide-react'

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

// buildReciboData, EMPRESA y el generador del PDF viven en @/lib/reciboPdf
// (compartidos con la generación al vuelo del cuadre en Finanzas).

// ── Preview HTML del recibo ───────────────────────────────────────────────────
function PreviewRecibo({ r }) {
  const G = '#0B1D4F'
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
          <RowFull label="Teléfono" value={s(r.telefono)} />
          <RowFull label="Dirección de recogida" value={s(r.direccion)} />
        </Section>

        {/* Servicio y pago */}
        <Section title="SERVICIO Y PAGO">
          <RowFull label="Plan / Servicio" value={s(r.servicio)} />
          {r.descuento_adicional > 0 && (
            <div style={{ margin: '6px 0', padding: '5px 8px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#92400E' }}>
                Descuento{r.descuento_adicional_motivo ? `: ${r.descuento_adicional_motivo}` : ' adicional'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#C2410C' }}>- {fmt(r.descuento_adicional)}</span>
            </div>
          )}
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
      <div style={{ background: '#E8F3EB', padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#0B1D4F', letterSpacing: 0.5, marginBottom: 8 }}>
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
function ValBox({ label, value, color = '#0B1D4F' }) {
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
            <FileText size={16} className="text-[#0B1D4F]" />
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
            style={{ background: '#0B1D4F' }}>
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
        `).gte('fecha_ingreso', FECHA_CORTE).order('fecha_ingreso', { ascending: false }).limit(3000),
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
    try { await generarReciboPDF(preview.svc, preview.pesoConfirmado) }
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
        <TableWrap className="max-h-[68vh] overflow-y-auto">
          <Table>
            <thead className="sticky top-0 z-10">
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
