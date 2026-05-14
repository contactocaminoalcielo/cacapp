import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { EstadoBadge } from '@/components/ui/badge'
import { db } from '@/lib/supabase'
import { petEmoji, addDiasHabiles } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DIAS_HABILES_PLAN = {
  DESAMPARADO: 3, ANGEL: 3, ECO_GRUPAL: 3,
  BASICO: 8, BASICO_SIN_REC: 3, STANDARD: 8, PREMIUM: 8,
  EXCLUSIVO_PRESENCIAL: 8, EXCLUSIVO_VIDEOLLAMADA: 8,
  COMPETS_EVIDENCIA: null, COMPETS_PRESENCIAL: null
}

function calcularFechaLimite(s) {
  if (s.fecha_limite_entrega) return s.fecha_limite_entrega
  if (!s.fecha_ingreso) return null
  const dias = DIAS_HABILES_PLAN[s.codigo_plan]
  if (dias === null || dias === undefined) return null
  const base = s.fecha_imagenes_recibidas || s.fecha_ingreso
  return addDiasHabiles(base, dias)
}

export default function Calendario() {
  const [servicios, setServicios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [diaSeleccionado, setDiaSeleccionado] = useState(null)
  const [mes, setMes] = useState(new Date().getMonth())
  const [anio, setAnio] = useState(new Date().getFullYear())

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

  const primerDia = new Date(anio, mes, 1)
  const ultimoDia = new Date(anio, mes + 1, 0)
  const diasEnMes = ultimoDia.getDate()
  const inicioSemana = primerDia.getDay()

  const serviciosPorFecha = {}
  servicios.forEach(s => {
    const fecha = calcularFechaLimite(s)
    if (!fecha) return
    if (!serviciosPorFecha[fecha]) serviciosPorFecha[fecha] = []
    serviciosPorFecha[fecha].push(s)
  })

  const hoy = new Date().toISOString().split('T')[0]

  function getColorDia(s) {
    if (s.estado === 'ENTREGADO') return '#DDD'
    if (!s.dias_para_vencer && s.dias_para_vencer !== 0) return '#3B6FBF'
    if (s.dias_para_vencer < 0) return '#C03030'
    if (s.dias_para_vencer <= 3) return '#9A5500'
    if (s.dias_para_vencer <= 7) return '#1D8A55'
    return '#3B6FBF'
  }

  const mesesES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const diasES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  return (
    <div>
      <Topbar />
      <div className="p-7">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Calendario */}
          <div className="xl:col-span-2 bg-surface border rounded-2xl p-5 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <button className="p-2 rounded-lg hover:bg-surface2 text-ink2" onClick={() => { if (mes === 0) { setMes(11); setAnio(a => a - 1) } else setMes(m => m - 1) }}>
                <ChevronLeft size={18} />
              </button>
              <div className="font-serif text-xl text-ink">{mesesES[mes]} {anio}</div>
              <button className="p-2 rounded-lg hover:bg-surface2 text-ink2" onClick={() => { if (mes === 11) { setMes(0); setAnio(a => a + 1) } else setMes(m => m + 1) }}>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Días de la semana */}
            <div className="grid grid-cols-7 mb-2">
              {diasES.map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-ink3 uppercase tracking-wider py-1">{d}</div>
              ))}
            </div>

            {/* Grid días */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: inicioSemana }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: diasEnMes }).map((_, i) => {
                const dia = i + 1
                const fechaStr = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
                const svsHoy = serviciosPorFecha[fechaStr] || []
                const esHoy = fechaStr === hoy
                const seleccionado = diaSeleccionado === fechaStr
                return (
                  <div key={dia}
                    className={`min-h-[60px] p-1.5 rounded-lg cursor-pointer transition-all border ${seleccionado ? 'border-primary-dark bg-green-light' : esHoy ? 'border-primary bg-green-light/50' : 'border-transparent hover:bg-surface2'}`}
                    onClick={() => setDiaSeleccionado(fechaStr === diaSeleccionado ? null : fechaStr)}>
                    <div className={`text-[11px] font-bold mb-1 ${esHoy ? 'text-primary-dark' : 'text-ink2'}`}>{dia}</div>
                    <div className="flex flex-wrap gap-0.5">
                      {svsHoy.slice(0, 3).map((s, idx) => (
                        <div key={idx} className="w-2 h-2 rounded-full" style={{ background: getColorDia(s) }} title={s.mascota} />
                      ))}
                      {svsHoy.length > 3 && (
                        <div className="text-[8px] font-bold text-ink3">+{svsHoy.length - 3}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              {[
                { color: '#C03030', label: 'Vencido' },
                { color: '#9A5500', label: 'Urgente ≤3d' },
                { color: '#1D8A55', label: 'Próximo ≤7d' },
                { color: '#3B6FBF', label: 'Normal' },
                { color: '#DDD', label: 'Entregado' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ background: l.color }} />
                  <span className="text-[10px] text-ink3">{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Panel detalle */}
          <div className="bg-surface border rounded-2xl p-5 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {!diaSeleccionado ? (
              <div className="text-center py-12 text-ink3">
                <div className="text-4xl mb-3">📅</div>
                <div className="text-sm font-medium">Selecciona un día para ver los servicios</div>
              </div>
            ) : (
              <>
                <div className="font-serif text-lg text-ink mb-4">
                  {new Date(diaSeleccionado + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {(serviciosPorFecha[diaSeleccionado] || []).length === 0 ? (
                  <div className="text-sm text-ink3 text-center py-6">Sin servicios este día</div>
                ) : (
                  <div className="space-y-3">
                    {(serviciosPorFecha[diaSeleccionado] || []).map(s => (
                      <div key={s.servicio_id} className="p-3 rounded-xl border hover:bg-surface2 transition-all"
                        style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span>{petEmoji(s.especie)}</span>
                          <div className="font-semibold text-ink text-[12px]">{s.mascota}</div>
                          <div className="ml-auto"><EstadoBadge estado={s.estado} /></div>
                        </div>
                        <div className="text-[11px] text-ink3">{s.cliente}</div>
                        <div className="text-[11px] text-ink2 mt-0.5">{s.plan}</div>
                        {s.dias_para_vencer !== null && s.dias_para_vencer !== undefined && (
                          <div className={`text-[10px] font-bold mt-1 ${s.dias_para_vencer < 0 ? 'text-danger' : s.dias_para_vencer <= 3 ? 'text-[#9A5500]' : 'text-ink3'}`}>
                            {s.dias_para_vencer < 0 ? `Vencido ${Math.abs(s.dias_para_vencer)}d` :
                             s.dias_para_vencer === 0 ? 'Vence hoy' : `${s.dias_para_vencer}d restantes`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
