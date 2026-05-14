import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { db } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'

const ESTADO_CICLO = { PENDIENTE: 'EN_PROCESO', EN_PROCESO: 'LISTO', LISTO: 'ENTREGADO', ENTREGADO: 'PENDIENTE' }

export default function Produccion() {
  const [recordatorios, setRecordatorios] = useState([])
  const [personal, setPersonal] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtroPersona, setFiltroPersona] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('pendientes')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data: recs }, { data: per }] = await Promise.all([
        db.from('servicio_recordatorios')
          .select('*, recordatorios(nombre,categoria,tiempo_produccion_dias,maquina_id,maquinas_produccion(nombre)), servicios(mascotas(nombre,especies(nombre)),planes(nombre,codigo))')
          .neq('origen', 'REMOVIDO')
          .order('created_at', { ascending: false }),
        db.from('personal').select('*').eq('activo', true).order('nombre'),
      ])
      setRecordatorios(recs || [])
      setPersonal(per || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function ciclarEstado(rec) {
    const nuevoEstado = ESTADO_CICLO[rec.estado] || 'PENDIENTE'
    await db.from('servicio_recordatorios').update({ estado: nuevoEstado }).eq('id', rec.id)
    setRecordatorios(prev => prev.map(r => r.id === rec.id ? { ...r, estado: nuevoEstado } : r))
  }

  const recsFiltrados = recordatorios.filter(r => {
    if (filtroPersona && r.asignado_a !== filtroPersona) return false
    if (filtroEstado === 'pendientes') return r.estado === 'PENDIENTE'
    if (filtroEstado === 'en_proceso') return r.estado === 'EN_PROCESO'
    if (filtroEstado === 'listos') return r.estado === 'LISTO'
    return true
  })

  // Agrupar por servicio
  const porServicio = {}
  recsFiltrados.forEach(r => {
    const sId = r.servicio_id
    if (!porServicio[sId]) porServicio[sId] = { servicio: r.servicios, items: [] }
    porServicio[sId].items.push(r)
  })

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const pendientes = recordatorios.filter(r => r.estado === 'PENDIENTE').length
  const enProceso = recordatorios.filter(r => r.estado === 'EN_PROCESO').length
  const listos = recordatorios.filter(r => r.estado === 'LISTO').length

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
          <StatCard label="Pendientes" value={pendientes} valueColor="#C03030" />
          <StatCard label="En proceso" value={enProceso} valueColor="#9A5500" />
          <StatCard label="Listos" value={listos} valueColor="#1D8A55" />
          <StatCard label="Total items" value={recordatorios.length} />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Select value={filtroPersona} onChange={e => setFiltroPersona(e.target.value)} className="w-48">
            <option value="">Todos los operarios</option>
            {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
          </Select>
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {[
              { key: 'pendientes', label: 'Pendientes' },
              { key: 'en_proceso', label: 'En proceso' },
              { key: 'listos', label: 'Listos' },
              { key: 'todos', label: 'Todos' },
            ].map(f => (
              <button key={f.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtroEstado === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => setFiltroEstado(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-ink3 self-center ml-auto">{recsFiltrados.length} ítems</span>
        </div>

        {/* Cards por servicio */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(porServicio).map(([sId, { servicio, items }]) => {
            const mascota = servicio?.mascotas
            const plan = servicio?.planes
            const listosCnt = items.filter(i => ['LISTO','ENTREGADO'].includes(i.estado)).length
            const pct = items.length > 0 ? Math.round((listosCnt / items.length) * 100) : 0
            return (
              <div key={sId} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">{petEmoji(mascota?.especies?.nombre)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink text-[13px] truncate">{mascota?.nombre || 'Sin nombre'}</div>
                    <div className="text-[11px] text-ink3 truncate">{plan?.nombre}</div>
                  </div>
                  <div className="text-[11px] font-bold text-ink3">{listosCnt}/{items.length}</div>
                </div>
                <div className="k-progress-bar mb-3">
                  <div className="k-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map(item => (
                    <button key={item.id}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full cursor-pointer transition-all border prod-pill-${item.estado}`}
                      onClick={() => ciclarEstado(item)}
                      title={`Click para cambiar a ${ESTADO_CICLO[item.estado]}`}>
                      {item.recordatorios?.nombre || 'Ítem'}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {Object.keys(porServicio).length === 0 && (
            <div className="col-span-3 text-center py-16 text-ink3">
              <div className="text-4xl mb-3">⚙️</div>
              <div className="text-sm font-medium">Sin ítems para este filtro</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
