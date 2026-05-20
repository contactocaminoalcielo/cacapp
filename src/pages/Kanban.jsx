import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { EstadoBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { db } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { ESTADO_COLOR, ESTADO_LABEL } from '@/lib/constants'
import { MessageCircle, RefreshCw, AlertTriangle, Package } from 'lucide-react'

const COLUMNAS = [
  'INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO', 'EN_PROCESO',
  'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO'
]

const COL_HEADER = {
  INGRESADO:      { bar: '#3B82F6', dot: '#DBEAFE' },
  EN_RECOGIDA:    { bar: '#F59E0B', dot: '#FEF3C7' },
  EN_CUARTO_FRIO: { bar: '#06B6D4', dot: '#CFFAFE' },
  EN_PROCESO:     { bar: '#8B5CF6', dot: '#EDE9FE' },
  EN_PRODUCCION:  { bar: '#F97316', dot: '#FFEDD5' },
  LISTO:          { bar: '#10B981', dot: '#D1FAE5' },
  EN_ENTREGA:     { bar: '#6366F1', dot: '#E0E7FF' },
  ENTREGADO:      { bar: '#6B7280', dot: '#F3F4F6' },
}

const FILTROS = [
  { key: 'activos', label: 'Activos' },
  { key: 'todos',   label: 'Todos' },
  { key: 'INGRESADO',    label: 'Ingresados' },
  { key: 'EN_PRODUCCION',label: 'Producción' },
  { key: 'LISTO',        label: 'Listos' },
]

export default function Kanban() {
  const [servicios, setServicios]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filtro, setFiltro]             = useState('activos')
  const [busqueda, setBusqueda]         = useState('')
  const [selected, setSelected]         = useState(null)
  const [recordatorios, setRecordatorios] = useState([])
  const [saving, setSaving]             = useState(false)
  const [mensajeros, setMensajeros]     = useState([])
  const [mensajeroId, setMensajeroId]   = useState('')

  useEffect(() => {
    cargar()
    db.from('personal').select('id,nombre,apellido,rol_principal_id')
      .in('rol_principal_id', [3])  // rol 3 = MENSAJERO
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setMensajeros(data || []))
  }, [])

  async function cargar() {
    try {
      setLoading(true)
      const { data, error: err } = await db
        .from('v_kanban').select('*').order('fecha_ingreso', { ascending: false })
      if (err) throw err
      setServicios(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function abrirModal(s) {
    setSelected(s)
    const { data } = await db
      .from('servicio_recordatorios')
      .select('*, recordatorios(nombre)')
      .eq('servicio_id', s.servicio_id)
      .neq('estado', 'REMOVIDO')
    setRecordatorios(data || [])
  }

  async function cambiarEstado(nuevoEstado) {
    if (!selected || saving) return
    setSaving(true)
    try {
      await db.from('servicios').update({ estado: nuevoEstado }).eq('id', selected.servicio_id)
      setServicios(prev => prev.map(s =>
        s.servicio_id === selected.servicio_id ? { ...s, estado: nuevoEstado } : s
      ))
      setSelected(prev => ({ ...prev, estado: nuevoEstado }))
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmarEntrega() {
    if (!selected || saving) return
    setSaving(true)
    try {
      await db.from('servicios').update({ estado: 'EN_ENTREGA' }).eq('id', selected.servicio_id)
      if (mensajeroId) {
        await db.from('entregas')
          .update({ mensajero_id: mensajeroId })
          .eq('servicio_id', selected.servicio_id)
          .in('estado', ['PENDIENTE'])
      }
      setServicios(prev => prev.map(s =>
        s.servicio_id === selected.servicio_id ? { ...s, estado: 'EN_ENTREGA' } : s
      ))
      setSelected(prev => ({ ...prev, estado: 'EN_ENTREGA' }))
      setMensajeroId('')
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function ciclarRecordatorio(rec) {
    const ciclo = { PENDIENTE: 'EN_PROCESO', EN_PROCESO: 'LISTO', LISTO: 'ENTREGADO', ENTREGADO: 'PENDIENTE' }
    const next = ciclo[rec.estado] || 'PENDIENTE'
    await db.from('servicio_recordatorios').update({ estado: next }).eq('id', rec.id)
    setRecordatorios(prev => prev.map(r => r.id === rec.id ? { ...r, estado: next } : r))
  }

  const ACTIVOS = ['INGRESADO','EN_RECOGIDA','EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA']

  const filtrados = servicios.filter(s => {
    if (filtro === 'activos' && !ACTIVOS.includes(s.estado)) return false
    if (filtro !== 'todos' && filtro !== 'activos' && s.estado !== filtro) return false
    if (busqueda) {
      const q = busqueda.toLowerCase()
      return (s.mascota || '').toLowerCase().includes(q) || (s.cliente || '').toLowerCase().includes(q)
    }
    return true
  })

  const alertLevel = (s) => {
    if (s.dias_para_vencer == null) return null
    if (s.dias_para_vencer < 0) return 'vencido'
    if (s.dias_para_vencer === 0) return 'hoy'
    if (s.dias_para_vencer <= 3) return 'pronto'
    return null
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" />
      <span className="text-sm font-medium">Cargando tablero…</span>
    </div>
  )
  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">Error: {error}</div>
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar actions={
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          onClick={cargar}
          title="Actualizar"
        >
          <RefreshCw size={14} />
        </button>
      } />

      <div className="p-5 flex flex-col flex-1 min-h-0 gap-4">

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1">
            {FILTROS.map(f => (
              <button
                key={f.key}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all ${
                  filtro === f.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setFiltro(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Buscar mascota o cliente…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-52"
          />
          <span className="ml-auto text-[12px] text-gray-400 font-medium">
            {filtrados.length} servicios
          </span>
        </div>

        {/* Board */}
        <div className="overflow-x-auto flex-1 pb-2">
          <div className="flex gap-3 h-full" style={{ minWidth: `${COLUMNAS.length * 256}px` }}>
            {COLUMNAS.map(col => {
              const items  = filtrados.filter(s => s.estado === col)
              const colors = COL_HEADER[col]
              const ec     = ESTADO_COLOR[col] || {}
              return (
                <div key={col} className="w-[248px] flex-shrink-0 flex flex-col gap-2">
                  {/* Column header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                    style={{ backgroundColor: colors.dot }}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: colors.bar }}
                    />
                    <span
                      className="text-[12px] font-bold flex-1 truncate"
                      style={{ color: colors.bar }}
                    >
                      {ESTADO_LABEL[col]}
                    </span>
                    <span
                      className="text-[11px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full"
                      style={{ backgroundColor: colors.bar, color: '#fff' }}
                    >
                      {items.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2 flex-1">
                    {items.map(s => {
                      const al  = alertLevel(s)
                      const pct = s.total_items > 0 ? Math.round((s.items_listos / s.total_items) * 100) : 0
                      return (
                        <div
                          key={s.servicio_id}
                          className="bg-white border rounded-xl p-3.5 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-px transition-all"
                          style={{
                            borderColor: al === 'vencido' ? '#FECACA'
                              : al === 'hoy' ? '#FDE68A'
                              : '#F3F4F6'
                          }}
                          onClick={() => abrirModal(s)}
                        >
                          {/* Card header */}
                          <div className="flex items-start gap-2 mb-2.5">
                            <span className="text-xl leading-none flex-shrink-0">{petEmoji(s.especie)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold text-gray-900 truncate leading-tight">
                                {s.mascota}
                              </div>
                              <div className="text-[11px] text-gray-400 truncate mt-0.5">
                                {s.cliente}
                              </div>
                            </div>
                          </div>

                          {/* Plan */}
                          <div className="text-[11px] text-gray-500 font-medium mb-2 truncate">
                            {s.plan}
                          </div>

                          {/* Alert badge */}
                          {al && (
                            <div className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 ${
                              al === 'vencido' ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                            }`}>
                              <AlertTriangle size={9} />
                              {s.dias_para_vencer < 0
                                ? `Vencido ${Math.abs(s.dias_para_vencer)}d`
                                : s.dias_para_vencer === 0 ? 'Vence hoy'
                                : `${s.dias_para_vencer}d`}
                            </div>
                          )}

                          {/* Progress */}
                          {s.total_items > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="k-progress-bar">
                                <div className="k-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                                {s.items_listos}/{s.total_items}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Empty column */}
                    {items.length === 0 && (
                      <div
                        className="border-2 border-dashed rounded-xl p-5 text-center text-[12px] text-gray-300 font-medium"
                        style={{ borderColor: colors.dot }}
                      >
                        Sin servicios
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Modal detalle ────────────────────────────────── */}
      {selected && (
        <Modal
          open={!!selected}
          onClose={() => setSelected(null)}
          title={`${petEmoji(selected.especie)} ${selected.mascota}`}
          maxWidth="max-w-lg"
        >
          <div className="space-y-5">
            {/* Info grid */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Cliente',  value: selected.cliente },
                { label: 'Plan',     value: selected.plan },
                { label: 'Especie',  value: selected.especie },
                { label: 'Ingreso',  value: selected.fecha_ingreso ? new Date(selected.fecha_ingreso).toLocaleDateString('es-CO') : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
                  <div className="text-[13px] font-semibold text-gray-900">{value || '—'}</div>
                </div>
              ))}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Estado actual</div>
                <EstadoBadge estado={selected.estado} />
              </div>
            </div>

            {/* Asignar entrega (solo cuando estado es LISTO) */}
            {selected.estado === 'LISTO' && (
              <div className="rounded-xl border-2 p-3 space-y-2.5"
                style={{ borderColor: '#E0E7FF', background: '#F5F3FF' }}>
                <div className="flex items-center gap-2">
                  <Package size={13} style={{ color: '#6366F1' }} />
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6366F1' }}>
                    Asignar entrega al mensajero
                  </div>
                </div>
                <Select value={mensajeroId} onChange={e => setMensajeroId(e.target.value)} className="w-full">
                  <option value="">Sin asignar (queda pendiente)</option>
                  {mensajeros.map(m => (
                    <option key={m.id} value={m.id}>{m.nombre} {m.apellido}</option>
                  ))}
                </Select>
                <button
                  disabled={saving}
                  onClick={confirmarEntrega}
                  className="w-full py-2 rounded-lg text-[12px] font-bold transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#6366F1', color: '#fff' }}
                >
                  {saving ? 'Guardando…' : '🛵 Enviar a entrega'}
                </button>
              </div>
            )}

            {/* Cambiar estado */}
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Mover a…
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNAS
                  .filter(c => c !== selected.estado && !(selected.estado === 'LISTO' && c === 'EN_ENTREGA'))
                  .map(col => (
                    <button
                      key={col}
                      disabled={saving}
                      onClick={() => cambiarEstado(col)}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 disabled:opacity-40"
                      style={ESTADO_COLOR[col] ? {
                        background: ESTADO_COLOR[col].bg,
                        color:      ESTADO_COLOR[col].text,
                        borderColor:ESTADO_COLOR[col].border,
                      } : { background: '#F3F4F6', color: '#6B7280' }}
                    >
                      {ESTADO_LABEL[col]}
                    </button>
                  ))}
              </div>
            </div>

            {/* Recordatorios */}
            {recordatorios.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Ítems del servicio
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recordatorios.map(r => (
                    <button
                      key={r.id}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full cursor-pointer transition-all prod-pill-${r.estado}`}
                      onClick={() => ciclarRecordatorio(r)}
                    >
                      {r.recordatorios?.nombre || 'Ítem'} · {r.estado.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* WhatsApp */}
            {selected.cliente_wa && (
              <a
                href={`https://wa.me/57${selected.cliente_wa.replace(/\D/g,'')}?text=Hola%2C%20le%20escribimos%20de%20Camino%20al%20Cielo%20sobre%20el%20servicio%20de%20${encodeURIComponent(selected.mascota)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#25D366' }}
              >
                <MessageCircle size={14} />
                Escribir por WhatsApp
              </a>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
