import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { EstadoBadge } from '@/components/ui/badge'
import { db } from '@/lib/supabase'
import { petEmoji, today, parseDate } from '@/lib/utils'
import { ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, Calendar, Clock } from 'lucide-react'

function calcularFechaLimite(s) {
  return s.fecha_limite_entrega || null
}

function getUrgColor(s) {
  if (s.estado === 'ENTREGADO') return '#9CA3AF'
  if (s.dias_para_vencer == null) return '#3B82F6'
  if (s.dias_para_vencer < 0)    return '#DC2626'
  if (s.dias_para_vencer <= 3)   return '#D97706'
  if (s.dias_para_vencer <= 7)   return '#059669'
  return '#3B82F6'
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

export default function Calendario() {
  const [servicios,        setServicios]        = useState([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState(null)
  const [diaSeleccionado,  setDiaSeleccionado]  = useState(null)
  const [mes,              setMes]              = useState(new Date().getMonth())
  const [anio,             setAnio]             = useState(new Date().getFullYear())

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const { data, error: err } = await db.from('v_kanban').select('*')
      if (err) throw err
      setServicios(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function prevMes() { if (mes === 0) { setMes(11); setAnio(a => a - 1) } else setMes(m => m - 1) }
  function nextMes() { if (mes === 11) { setMes(0); setAnio(a => a + 1) } else setMes(m => m + 1) }

  const primerDia   = new Date(anio, mes, 1)
  const diasEnMes   = new Date(anio, mes + 1, 0).getDate()
  const inicioSem   = primerDia.getDay()
  const hoy         = today()

  const porFecha = {}
  servicios.forEach(s => {
    const f = calcularFechaLimite(s)
    if (!f) return
    if (!porFecha[f]) porFecha[f] = []
    porFecha[f].push(s)
  })

  const vencidos = servicios.filter(s =>
    s.estado !== 'ENTREGADO' && s.estado !== 'CANCELADO' &&
    s.dias_para_vencer != null && s.dias_para_vencer < 0
  )

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" /><span className="text-sm font-medium">Cargando calendario…</span>
    </div>
  )
  if (error) return (
    <div className="p-5">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">Error: {error}</div>
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar actions={
        <button onClick={cargar} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <RefreshCw size={14} />
        </button>
      } />

      <div className="p-5 flex flex-col gap-5">

        {/* Alerta vencidos */}
        {vencidos.length > 0 && (
          <div className="rounded-xl border-2 px-4 py-3 flex items-center gap-3"
            style={{ borderColor: '#FECACA', background: '#FEF2F2' }}>
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <span className="text-[13px] font-bold text-red-800">
              {vencidos.length} servicio{vencidos.length !== 1 ? 's' : ''} vencido{vencidos.length !== 1 ? 's' : ''} sin entregar
            </span>
            <div className="flex flex-wrap gap-1.5 ml-1">
              {vencidos.map(s => (
                <span key={s.servicio_id} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: '#FEE2E2', color: '#991B1B' }}>
                  {petEmoji(s.especie)} {s.mascota} · {Math.abs(s.dias_para_vencer)}d
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Calendario ─────────────────────────────────────────────────── */}
          <div className="xl:col-span-2 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">

            {/* Header mes */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMes}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-[17px] font-bold text-gray-900">{MESES[mes]} {anio}</h2>
              <button onClick={nextMes}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Cabecera días */}
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100">
              {DIAS.map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-wider py-2.5">{d}</div>
              ))}
            </div>

            {/* Grid días */}
            <div className="grid grid-cols-7 gap-px bg-gray-100">
              {Array.from({ length: inicioSem }).map((_, i) => (
                <div key={`e-${i}`} className="bg-white min-h-[80px]" />
              ))}
              {Array.from({ length: diasEnMes }).map((_, i) => {
                const dia      = i + 1
                const fechaStr = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
                const svs      = porFecha[fechaStr] || []
                const esHoy    = fechaStr === hoy
                const sel      = diaSeleccionado === fechaStr

                // Color dominante del día (urgencia más alta)
                let dominante = null
                if (svs.some(s => s.estado !== 'ENTREGADO' && s.dias_para_vencer < 0)) dominante = '#DC2626'
                else if (svs.some(s => s.estado !== 'ENTREGADO' && s.dias_para_vencer >= 0 && s.dias_para_vencer <= 3)) dominante = '#D97706'
                else if (svs.some(s => s.estado !== 'ENTREGADO' && s.dias_para_vencer > 3)) dominante = '#059669'
                else if (svs.length) dominante = '#9CA3AF'

                return (
                  <div key={dia}
                    onClick={() => setDiaSeleccionado(fechaStr === diaSeleccionado ? null : fechaStr)}
                    className={`bg-white min-h-[80px] p-2 cursor-pointer transition-all hover:brightness-95 select-none ${sel ? 'ring-2 ring-inset ring-[#3D5A27]' : ''}`}>
                    {/* Número del día */}
                    <div className={`w-7 h-7 flex items-center justify-center rounded-full text-[13px] font-bold mb-1.5 ${esHoy ? 'text-white' : sel ? 'text-[#3D5A27]' : 'text-gray-700'}`}
                      style={esHoy ? { background: '#3D5A27' } : {}}>
                      {dia}
                    </div>
                    {/* Indicadores de servicios */}
                    {svs.length > 0 && (
                      <div className="space-y-0.5">
                        {svs.slice(0, 3).map((s, idx) => (
                          <div key={idx}
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded leading-tight truncate text-white"
                            style={{ background: getUrgColor(s) }}>
                            {petEmoji(s.especie)} {s.mascota}
                          </div>
                        ))}
                        {svs.length > 3 && (
                          <div className="text-[9px] font-bold px-1.5 py-0.5 rounded leading-tight"
                            style={{ background: dominante + '22', color: dominante }}>
                            +{svs.length - 3} más
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap gap-4 px-5 py-3 bg-gray-50 border-t border-gray-100">
              {[
                { color: '#DC2626', label: 'Vencido' },
                { color: '#D97706', label: 'Urgente ≤3d' },
                { color: '#059669', label: 'Próximo' },
                { color: '#9CA3AF', label: 'Entregado' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                  <span className="text-[10px] text-gray-500 font-medium">{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Panel lateral ─────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            {!diaSeleccionado ? (
              // Vista default: próximos vencimientos
              (() => {
                const hoyDate = new Date()
                const limite  = new Date(hoyDate); limite.setDate(limite.getDate() + 14)

                const proximos14 = servicios
                  .filter(s => {
                    if (!s.fecha_limite_entrega) return false
                    if (s.estado === 'ENTREGADO' || s.estado === 'CANCELADO') return false
                    const d = parseDate(s.fecha_limite_entrega)
                    return d >= hoyDate && d <= limite
                  })
                  .sort((a, b) => parseDate(a.fecha_limite_entrega) - parseDate(b.fecha_limite_entrega))

                const hoyStr     = hoy
                const vencHoy    = proximos14.filter(s => s.dias_para_vencer === 0)
                const urgentes   = proximos14.filter(s => s.dias_para_vencer > 0 && s.dias_para_vencer <= 3)
                const normales   = proximos14.filter(s => s.dias_para_vencer > 3)

                const grupos = [
                  { label: 'Vencen hoy', items: vencHoy, color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
                  { label: `Urgente (${urgentes.length > 0 ? '≤3d' : '0'})`, items: urgentes, color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
                  { label: 'Próximos 14 días', items: normales, color: '#059669', bg: '#F0FDF4', border: '#BBF7D0' },
                ].filter(g => g.items.length > 0)

                return (
                  <>
                    <div className="px-4 py-3.5 border-b border-gray-100 flex items-center gap-2">
                      <Clock size={14} className="text-gray-400" />
                      <span className="text-[13px] font-bold text-gray-800">Vencimientos próximos</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {grupos.length === 0 ? (
                        <div className="py-12 text-center">
                          <div className="text-3xl mb-2">🗓</div>
                          <p className="text-[13px] font-semibold text-gray-500">Sin vencimientos en 14 días</p>
                        </div>
                      ) : grupos.map(g => (
                        <div key={g.label}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: g.bg, color: g.color, border: `1px solid ${g.border}` }}>
                              {g.label} · {g.items.length}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {g.items.map(s => (
                              <div key={s.servicio_id}
                                className="flex items-center gap-2.5 p-2.5 rounded-xl border bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                                style={{ borderColor: '#F3F4F6' }}
                                onClick={() => {
                                  const f = calcularFechaLimite(s)
                                  if (f) setDiaSeleccionado(f)
                                }}>
                                <span className="text-lg leading-none flex-shrink-0">{petEmoji(s.especie)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-bold text-gray-900 truncate">{s.mascota}</div>
                                  <div className="text-[10px] text-gray-400 truncate">{s.cliente} · {s.plan}</div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-[12px] font-bold" style={{ color: g.color }}>
                                    {s.dias_para_vencer === 0 ? 'Hoy' : `${s.dias_para_vencer}d`}
                                  </div>
                                  <div className="text-[9px] text-gray-400">
                                    {parseDate(s.fecha_limite_entrega)?.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                      <p className="text-[10px] text-gray-400 text-center">Haz clic en un día para ver sus servicios</p>
                    </div>
                  </>
                )
              })()
            ) : (
              // Vista día seleccionado
              <>
                <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-gray-400" />
                    <span className="text-[13px] font-bold text-gray-800">
                      {parseDate(diaSeleccionado)?.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </span>
                  </div>
                  <button onClick={() => setDiaSeleccionado(null)}
                    className="text-[11px] text-gray-400 hover:text-gray-600 font-medium">
                    ← Volver
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {(porFecha[diaSeleccionado] || []).length === 0 ? (
                    <div className="py-10 text-center">
                      <div className="text-3xl mb-2">📭</div>
                      <p className="text-[13px] text-gray-400">Sin servicios este día</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(porFecha[diaSeleccionado] || []).map(s => (
                        <div key={s.servicio_id}
                          className="p-3 rounded-xl border hover:bg-gray-50 transition-all"
                          style={{ borderColor: getUrgColor(s) + '40', background: getUrgColor(s) + '08' }}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-lg leading-none">{petEmoji(s.especie)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold text-gray-900 truncate">{s.mascota}</div>
                              <div className="text-[10px] text-gray-500 truncate">{s.cliente}</div>
                            </div>
                            <EstadoBadge estado={s.estado} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">{s.plan}</span>
                            {s.dias_para_vencer != null && (
                              <span className="text-[11px] font-bold" style={{ color: getUrgColor(s) }}>
                                {s.dias_para_vencer < 0 ? `Vencido ${Math.abs(s.dias_para_vencer)}d`
                                  : s.dias_para_vencer === 0 ? 'Vence hoy'
                                  : `${s.dias_para_vencer}d restantes`}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
