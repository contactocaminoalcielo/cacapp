import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { petEmoji } from '@/lib/utils'
import { Snowflake, RefreshCw, Edit2, ClipboardList, Scale, Package } from 'lucide-react'

// ─── helpers módulo ────────────────────────────────────────────────────────
function fmtFechaHora(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleDateString('es-CO') + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

const FUNC_COLOR = {
  SIN_FUNCIONAR: { bg: '#FEE2E2', text: '#991B1B', label: 'Sin funcionar' },
  MANTENIMIENTO: { bg: '#FEF3C7', text: '#92400E', label: 'Mantenimiento'  },
  REFRIGERANDO:  { bg: '#DBEAFE', text: '#1E40AF', label: 'Refrigerando'   },
  CONGELANDO:    { bg: '#E0F2FE', text: '#0E7490', label: 'Congelando'     },
  CAVA:          { bg: '#D1FAE5', text: '#065F46', label: 'Cava'           },
}

// ─── ReporteCard ────────────────────────────────────────────────────────────
function ReporteCard({ reporte, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const neveras = reporte.estado_nevera_reporte || []
  const p       = reporte.personal
  const esHoy   = reporte.fecha === new Date().toISOString().split('T')[0]

  const checks = [
    { key: 'ozonizadores_ok',   emoji: '💨', label: 'Ozonizadores en funcionamiento' },
    { key: 'control_olores_ok', emoji: '🌿', label: 'Control de olores activo'       },
    { key: 'sin_olor_novedad',  emoji: '✅', label: 'Sin olor ni novedad'            },
  ]

  return (
    <div className="bg-surface border rounded-2xl overflow-hidden shadow-sm"
      style={{ borderColor: esHoy ? '#C5D8F5' : 'rgba(30,80,40,0.1)' }}>

      {/* Header */}
      <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface2 transition-colors"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          {esHoy && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#EEF3FB', color: '#3B6FBF' }}>Hoy</span>
          )}
          <span className="text-[12px] font-semibold text-ink">
            {new Date(reporte.fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <span className="text-[11px] text-ink3">
            {p ? `${p.nombre} ${p.apellido}` : 'Técnico'} · {fmtFechaHora(reporte.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mini checklist pills */}
          {checks.map(c => reporte[c.key] && (
            <span key={c.key} className="text-[10px]">{c.emoji}</span>
          ))}
          <span className="text-ink3 text-[11px]">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          {/* Neveras */}
          {neveras.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 mb-3">
              {neveras.map(n => {
                const f = FUNC_COLOR[n.funcionamiento] || {}
                return (
                  <div key={n.id} className="rounded-xl p-2.5 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Snowflake size={11} className="text-[#3B6FBF]" />
                      <span className="text-[12px] font-bold text-ink">{n.nevera_codigo}</span>
                    </div>
                    {n.capacidad_pct > 0 && (
                      <div className="mb-1.5">
                        <div className="flex justify-between text-[10px] text-ink3 mb-0.5">
                          <span>Capacidad</span><span className="font-semibold">{n.capacidad_pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${n.capacidad_pct}%`,
                            background: n.capacidad_pct >= 80 ? '#DC2626' : n.capacidad_pct >= 60 ? '#D97706' : '#3B6FBF',
                          }} />
                        </div>
                      </div>
                    )}
                    {n.funcionamiento && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: f.bg, color: f.text }}>
                        {f.label || n.funcionamiento.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-ink3 mt-3 mb-3">Sin datos de neveras en este reporte.</p>
          )}

          {/* Checklist */}
          <div className="flex flex-wrap gap-2 mb-3">
            {checks.map(c => (
              <span key={c.key} className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: reporte[c.key] ? '#D1FAE5' : '#F3F4F6',
                  color:      reporte[c.key] ? '#065F46' : '#9CA3AF',
                }}>
                {c.emoji} {c.label}
              </span>
            ))}
          </div>

          {/* Comentario */}
          {reporte.comentario && (
            <div className="text-xs text-ink2 bg-surface2 rounded-lg px-3 py-2">
              💬 {reporte.comentario}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function CuartoFrio() {
  const { personalData } = useAuth()
  const isAdmin = personalData?.rol === 'ADMIN'

  const [registros, setRegistros] = useState([])
  const [reportes,  setReportes]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [form,      setForm]      = useState({})
  const [saving,    setSaving]    = useState(false)
  const [detalle,   setDetalle]   = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data, error: err }, { data: rep }] = await Promise.all([
        db.from('cuarto_frio')
          .select(`*,
            servicios(
              mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido,whatsapp)),
              planes(nombre,codigo,tipo_proceso),
              recogidas(foto_recogida_url),
              tecnico:tecnico_id(nombre,apellido)
            )
          `)
          .order('fecha_ingreso', { ascending: false }),
        db.from('estado_cuarto_frio')
          .select('*, estado_nevera_reporte(*), personal:registrado_por(nombre,apellido)')
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (err) throw err
      setRegistros(data || [])
      setReportes(rep || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function abrirEdicion(r, e) {
    e?.stopPropagation()
    setSelected(r)
    setForm({
      nevera_codigo: r.nevera_codigo || '',
      peso_kg:       r.peso_kg || '',
      estado:        r.estado || 'PENDIENTE_INGRESO',
      notas:         r.notas || '',
    })
  }

  async function guardar() {
    setSaving(true)
    try {
      const update = isAdmin
        ? {
            nevera_codigo: form.nevera_codigo || null,
            peso_kg:       parseFloat(form.peso_kg) || null,
            estado:        form.estado,
            notas:         form.notas || null,
          }
        : { nevera_codigo: form.nevera_codigo || null }

      await db.from('cuarto_frio').update(update).eq('id', selected.id)
      await cargar()
      setSelected(null)
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  function nombreTecnico(r) {
    const t = r.servicios?.tecnico
    if (!t) return '-'
    return `${t.nombre} ${t.apellido}`
  }

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error)   return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const META_LOTE_KG = 2500

  const pendientes   = registros.filter(r => r.estado === 'PENDIENTE_INGRESO')
  const refrigerados = registros.filter(r => r.estado === 'REFRIGERADO')
  const enEspera     = registros.filter(r => r.estado === 'EN_ESPERA_PROCESO')
  const activos      = registros.filter(r => ['REFRIGERADO','EN_ESPERA_PROCESO'].includes(r.estado))

  // ── Cálculos de peso ──────────────────────────────────────────────────────
  // Peso confirmado = cuarto_frio.peso_kg (báscula técnico). Si no, peso mascota como estimado.
  const activosConPesoConfirmado = activos.filter(r => r.peso_kg != null && r.peso_kg > 0)
  const activosSinPeso           = activos.filter(r => !r.peso_kg || r.peso_kg === 0)
  const pesoConfirmado = activosConPesoConfirmado.reduce((s, r) => s + parseFloat(r.peso_kg), 0)
  // Estimado para los que no tienen peso confirmado (usa el peso registrado de la mascota)
  const pesoEstimado   = activosSinPeso.reduce((s, r) => {
    const pk = r.servicios?.mascotas?.peso_kg
    return s + (pk ? parseFloat(pk) : 0)
  }, 0)
  const pesoTotal   = pesoConfirmado + pesoEstimado
  const pctLote     = Math.min(100, (pesoTotal / META_LOTE_KG) * 100)
  const pctConfirm  = pesoTotal > 0 ? Math.round((pesoConfirmado / pesoTotal) * 100) : 0

  // Color barra según % del lote
  const barColor = pctLote >= 90 ? '#16A34A' : pctLote >= 60 ? '#D97706' : '#3B6FBF'
  const barLabel = pctLote >= 100 ? '🟢 Listo para lote' : pctLote >= 75 ? '🟡 Casi listo' : '🔵 Acumulando'

  const porNevera = {}
  activos.forEach(r => {
    const k = r.nevera_codigo || 'Sin asignar'
    if (!porNevera[k]) porNevera[k] = []
    porNevera[k].push(r)
  })

  const estadoColor = {
    PENDIENTE_INGRESO: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
    REFRIGERADO:       { bg: '#EEF3FB', text: '#3B6FBF', border: '#C5D8F5' },
    EN_ESPERA_PROCESO: { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
    TRASLADADO:        { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
    RETIRADO:          { bg: '#F0F0F0', text: '#555',    border: '#DDD'    },
  }

  const hoy = new Date().toISOString().split('T')[0]
  const reporteHoy = reportes.find(r => r.fecha === hoy)

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <StatCard label="Pendientes ingreso" value={pendientes.length} valueColor="#92400E" />
          <StatCard label="En refrigeración"   value={refrigerados.length} valueColor="#3B6FBF" />
          <StatCard label="En espera proceso"  value={enEspera.length} valueColor="#9A5500" />
          <StatCard label="Total activos"      value={pendientes.length + activos.length} />
        </div>

        {/* ── Panel capacidad / peso acumulado ── */}
        <div className="bg-surface border rounded-2xl shadow-sm mb-7 overflow-hidden"
          style={{ borderColor: 'rgba(30,80,40,0.12)' }}>

          {/* Header */}
          <div className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: 'rgba(30,80,40,0.08)', background: 'rgba(59,111,191,0.04)' }}>
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-[#3B6FBF]" />
              <span className="font-serif text-base text-ink">Capacidad del cuarto frío</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                style={{ background: barColor + '22', color: barColor }}>
                {barLabel}
              </span>
            </div>
            <span className="text-[11px] text-ink3">Meta lote grupal ≈ {META_LOTE_KG.toLocaleString('es-CO')} kg</span>
          </div>

          <div className="px-5 py-4">
            {/* Barra de progreso */}
            <div className="mb-4">
              <div className="flex items-end justify-between mb-1.5">
                <div>
                  <span className="text-2xl font-bold" style={{ color: barColor }}>
                    {pesoTotal.toFixed(1)}
                  </span>
                  <span className="text-sm text-ink3 ml-1.5">
                    / {META_LOTE_KG.toLocaleString('es-CO')} kg
                  </span>
                </div>
                <span className="text-sm font-bold" style={{ color: barColor }}>
                  {pctLote.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pctLote}%`, background: barColor }} />
              </div>
              {pctLote >= 100 && (
                <p className="text-[11px] font-semibold mt-1" style={{ color: '#16A34A' }}>
                  ✅ Se alcanzó la capacidad para enviar lote grupal
                </p>
              )}
            </div>

            {/* Desglose en 3 columnas */}
            <div className="grid grid-cols-3 gap-3">

              {/* Peso confirmado */}
              <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(59,111,191,0.2)', background: '#EEF3FB' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Scale size={11} className="text-[#3B6FBF]" />
                  <span className="text-[10px] font-bold text-[#3B6FBF] uppercase tracking-wide">Confirmado</span>
                </div>
                <div className="text-xl font-bold text-ink">{pesoConfirmado.toFixed(1)} <span className="text-sm font-normal text-ink3">kg</span></div>
                <div className="text-[10px] text-ink3 mt-0.5">
                  {activosConPesoConfirmado.length} {activosConPesoConfirmado.length === 1 ? 'mascota' : 'mascotas'} con báscula
                </div>
                <div className="text-[10px] font-semibold mt-1" style={{ color: '#3B6FBF' }}>
                  {pctConfirm}% del peso total
                </div>
              </div>

              {/* Peso estimado */}
              <div className="rounded-xl p-3 border" style={{ borderColor: 'rgba(217,119,6,0.2)', background: '#FFFBEB' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Scale size={11} className="text-[#D97706]" />
                  <span className="text-[10px] font-bold text-[#D97706] uppercase tracking-wide">Estimado</span>
                </div>
                <div className="text-xl font-bold text-ink">{pesoEstimado.toFixed(1)} <span className="text-sm font-normal text-ink3">kg</span></div>
                <div className="text-[10px] text-ink3 mt-0.5">
                  {activosSinPeso.length} {activosSinPeso.length === 1 ? 'mascota' : 'mascotas'} sin báscula
                </div>
                <div className="text-[10px] font-semibold mt-1 text-[#D97706]">Peso registro mascota</div>
              </div>

              {/* Faltan para lote */}
              <div className="rounded-xl p-3 border" style={{
                borderColor: pctLote >= 100 ? 'rgba(22,163,74,0.3)' : 'rgba(30,80,40,0.12)',
                background:  pctLote >= 100 ? '#F0FDF4' : '#F8F9FA',
              }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Package size={11} style={{ color: pctLote >= 100 ? '#16A34A' : '#6B7280' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: pctLote >= 100 ? '#16A34A' : '#6B7280' }}>
                    {pctLote >= 100 ? 'Lote listo' : 'Faltan'}
                  </span>
                </div>
                {pctLote >= 100 ? (
                  <>
                    <div className="text-xl font-bold" style={{ color: '#16A34A' }}>✅</div>
                    <div className="text-[10px] text-ink3 mt-0.5">
                      {(pesoTotal - META_LOTE_KG).toFixed(1)} kg excedente
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-bold text-ink">
                      {(META_LOTE_KG - pesoTotal).toFixed(1)} <span className="text-sm font-normal text-ink3">kg</span>
                    </div>
                    <div className="text-[10px] text-ink3 mt-0.5">para completar el lote</div>
                  </>
                )}
                <div className="text-[10px] font-semibold mt-1 text-ink3">
                  Total mascotas: {activos.length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── REPORTES DEL TÉCNICO ── */}
        <div className="mb-7">
          <div className="font-serif text-lg text-ink mb-3 flex items-center gap-2">
            <ClipboardList size={18} className="text-ink3" />
            Estado del cuarto frío
            {!reporteHoy && (
              <span className="text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full ml-1"
                style={{ background: '#FEF3C7', color: '#92400E' }}>
                ⚠️ Sin reporte hoy
              </span>
            )}
          </div>

          {reportes.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <p className="text-sm text-amber-700 font-medium">Sin reportes registrados aún</p>
              <p className="text-xs text-amber-600 mt-1">El técnico envía el reporte desde la app en la pestaña "C. Frío".</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reportes.map((r, i) => (
                <ReporteCard key={r.id} reporte={r} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </div>

        {/* Pendientes de ingreso */}
        {pendientes.length > 0 && (
          <div className="mb-7">
            <div className="font-serif text-lg text-ink mb-3 flex items-center gap-2">
              ⚠️ Pendientes de ingreso
              <span className="text-sm font-sans font-semibold px-2 py-0.5 rounded-full"
                style={{ background: '#FEF3C7', color: '#92400E' }}>
                {pendientes.length}
              </span>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs text-amber-700 mb-3 font-medium">
                Estos registros llegaron al cuarto frío pero el técnico aún no ha confirmado nevera, peso y foto de báscula.
              </p>
              <div className="space-y-2">
                {pendientes.map(r => {
                  const m = r.servicios?.mascotas
                  const c = m?.clientes
                  const p = r.servicios?.planes
                  const t = r.servicios?.tecnico
                  return (
                    <div key={r.id} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-amber-100 cursor-pointer hover:bg-amber-50"
                      onClick={() => setDetalle(r)}>
                      <span className="text-xl">{petEmoji(m?.especies?.nombre)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-ink truncate">{m?.nombre || '—'}</div>
                        <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                        {t && <div className="text-[10px] text-ink3">Técnico: {t.nombre} {t.apellido}</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                            style={{ background: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }}>
                            PENDIENTE INGRESO
                          </div>
                          {r.fecha_ingreso && (
                            <div className="text-[10px] text-ink3 mt-0.5">{fmtFechaHora(r.fecha_ingreso)}</div>
                          )}
                        </div>
                        <button className="p-1 rounded hover:bg-amber-100 text-amber-700"
                          onClick={e => abrirEdicion(r, e)}>
                          <Edit2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Grid neveras */}
        {Object.keys(porNevera).length > 0 && (
          <div className="mb-7">
            <div className="font-serif text-lg text-ink mb-4">Neveras activas</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(porNevera).map(([nevera, items]) => (
                <div key={nevera} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Snowflake size={16} className="text-[#3B6FBF]" />
                    <div className="font-bold text-ink">{nevera}</div>
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEF3FB] text-[#3B6FBF]">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(r => {
                      const m = r.servicios?.mascotas
                      const c = m?.clientes
                      const e = estadoColor[r.estado] || {}
                      return (
                        <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-surface2"
                          onClick={() => setDetalle(r)}>
                          <span className="text-lg">{petEmoji(m?.especies?.nombre)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-ink truncate">{m?.nombre || 'Sin nombre'}</div>
                            <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                              style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                              {r.estado?.replace(/_/g, ' ')}
                            </span>
                            <button className="p-0.5 rounded hover:bg-surface text-ink3"
                              onClick={ev => abrirEdicion(r, ev)}>
                              <Edit2 size={11} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabla completa */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b font-serif text-lg text-ink" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            Todos los registros
          </div>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Cliente</Th>
                  <Th>Plan</Th>
                  <Th>Nevera</Th>
                  <Th>Peso (kg)</Th>
                  <Th>Técnico</Th>
                  <Th>Estado</Th>
                  <Th>Ingreso</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {registros.map(r => {
                  const m = r.servicios?.mascotas
                  const c = m?.clientes
                  const p = r.servicios?.planes
                  const e = estadoColor[r.estado] || {}
                  return (
                    <Tr key={r.id} className="cursor-pointer" onClick={() => setDetalle(r)}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{petEmoji(m?.especies?.nombre)}</span>
                          <span className="font-semibold text-ink">{m?.nombre || '-'}</span>
                        </div>
                      </Td>
                      <Td className="text-ink2">{c?.nombre} {c?.apellido}</Td>
                      <Td className="text-ink3">{p?.nombre}</Td>
                      <Td className="font-mono text-[11px]">{r.nevera_codigo || '-'}</Td>
                      <Td>
                        {r.peso_kg
                          ? <span className="font-semibold text-[#3B6FBF]">{r.peso_kg} kg ✓</span>
                          : m?.peso_kg
                            ? <span className="text-[#D97706]">{m.peso_kg} kg ~</span>
                            : <span className="text-ink3">-</span>
                        }
                      </Td>
                      <Td className="text-ink3 text-[12px]">{nombreTecnico(r)}</Td>
                      <Td>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                          style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                          {r.estado?.replace(/_/g, ' ')}
                        </span>
                      </Td>
                      <Td className="text-ink3 text-[11px]">{fmtFechaHora(r.fecha_ingreso)}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" onClick={ev => abrirEdicion(r, ev)}>
                          {isAdmin ? 'Editar' : 'Nevera'}
                        </Button>
                      </Td>
                    </Tr>
                  )
                })}
                {registros.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-ink3 text-sm">Sin registros</td></tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </div>

      {/* Modal edición */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={isAdmin ? 'Editar registro cuarto frío' : 'Cambiar nevera'}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Nevera</label>
              <Input value={form.nevera_codigo}
                onChange={e => setForm(p => ({ ...p, nevera_codigo: e.target.value }))} />
            </div>
            {isAdmin && (
              <>
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">Peso báscula (kg)</label>
                  <Input type="text" inputMode="decimal" placeholder="Ej: 28.5"
                    value={form.peso_kg}
                    onChange={e => setForm(p => ({ ...p, peso_kg: e.target.value.replace(',', '.') }))} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">Estado</label>
                  <Select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))}>
                    <option value="PENDIENTE_INGRESO">Pendiente ingreso</option>
                    <option value="REFRIGERADO">Refrigerado</option>
                    <option value="EN_ESPERA_PROCESO">En espera proceso</option>
                    <option value="TRASLADADO">Trasladado</option>
                    <option value="RETIRADO">Retirado</option>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
                  <Textarea value={form.notas}
                    onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Modal detalle mascota */}
      {detalle && (
        <DetalleModal
          registro={detalle}
          onClose={() => setDetalle(null)}
          onEdit={isAdmin ? r => { setDetalle(null); abrirEdicion(r) } : null}
          estadoColor={estadoColor}
        />
      )}
    </div>
  )
}

// ─── DetalleModal ──────────────────────────────────────────────────────────
function DetalleModal({ registro: r, onClose, onEdit, estadoColor }) {
  const m            = r.servicios?.mascotas
  const c            = m?.clientes
  const p            = r.servicios?.planes
  const e            = estadoColor[r.estado] || {}
  const fotoRecogida = r.servicios?.recogidas?.[0]?.foto_recogida_url
  const fotoPesaje   = r.foto_pesaje_url
  const t            = r.servicios?.tecnico

  return (
    <Modal open={true} onClose={onClose}
      title="Detalle mascota — cuarto frío"
      maxWidth="max-w-xl"
      footer={
        <div className="flex gap-2">
          {onEdit && (
            <Button variant="secondary" onClick={() => onEdit(r)}>
              <Edit2 size={13} className="mr-1.5" />Editar
            </Button>
          )}
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      }>
      <div className="space-y-4">

        {/* Mascota */}
        <div className="flex items-start gap-3 p-3 bg-surface2 rounded-xl">
          <span className="text-3xl">{petEmoji(m?.especies?.nombre)}</span>
          <div>
            <div className="font-semibold text-ink text-base">{m?.nombre || '-'}</div>
            <div className="text-[12px] text-ink3">
              {m?.especies?.nombre} · {m?.peso_kg ? `${m.peso_kg} kg` : 'Peso no registrado'}
            </div>
            <div className="text-[12px] text-ink2 mt-0.5">{c?.nombre} {c?.apellido}</div>
            {c?.whatsapp && (
              <a href={`https://wa.me/57${c.whatsapp.replace(/\D/g,'')}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] text-[#2D7A45] font-medium">
                📱 {c.whatsapp}
              </a>
            )}
          </div>
        </div>

        {/* Detalles operacionales */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">PLAN</div>
            <div className="text-sm font-semibold text-ink">{p?.nombre || '-'}</div>
            <div className="text-[11px] text-ink3">{p?.codigo}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">ESTADO</div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
              style={{ background: e.bg, color: e.text, borderColor: e.border }}>
              {r.estado?.replace(/_/g, ' ')}
            </span>
          </div>
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">NEVERA</div>
            <div className="text-sm font-mono font-semibold text-ink">{r.nevera_codigo || 'Sin asignar'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">PESO BÁSCULA</div>
            <div className="text-sm font-semibold text-ink">{r.peso_kg ? `${r.peso_kg} kg` : 'No registrado'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">TÉCNICO</div>
            <div className="text-sm text-ink">{t ? `${t.nombre} ${t.apellido}` : '-'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">INGRESO C. FRÍO</div>
            <div className="text-[12px] text-ink">{fmtFechaHora(r.fecha_ingreso)}</div>
          </div>
        </div>

        {/* Notas */}
        {r.notas && (
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-1">NOTAS</div>
            <div className="text-sm text-ink2 bg-surface2 rounded-lg p-2">{r.notas}</div>
          </div>
        )}

        {/* Fotos */}
        {(fotoRecogida || fotoPesaje) && (
          <div>
            <div className="text-[10px] font-bold text-ink3 mb-2">FOTOS EVIDENCIA</div>
            <div className="grid grid-cols-2 gap-3">
              {fotoRecogida && (
                <div>
                  <div className="text-[10px] text-ink3 mb-1">Recogida</div>
                  <a href={fotoRecogida} target="_blank" rel="noreferrer">
                    <img src={fotoRecogida} alt="Foto recogida"
                      className="w-full h-36 object-cover rounded-xl border border-surface2 hover:opacity-90 transition-opacity" />
                  </a>
                </div>
              )}
              {fotoPesaje && (
                <div>
                  <div className="text-[10px] text-ink3 mb-1">Pesaje báscula</div>
                  <a href={fotoPesaje} target="_blank" rel="noreferrer">
                    <img src={fotoPesaje} alt="Foto pesaje"
                      className="w-full h-36 object-cover rounded-xl border border-surface2 hover:opacity-90 transition-opacity" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </Modal>
  )
}
