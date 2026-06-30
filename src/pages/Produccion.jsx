import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/supabase'
import { petEmoji, parsearErrorDB } from '@/lib/utils'
import { RefreshCw, User, Cpu, Lock, Zap, CheckCircle2, Clock, Package, AlertCircle, Truck } from 'lucide-react'
import ModalPreparaEntrega from '@/components/delivery/ModalPreparaEntrega'

const ESTADO_LABEL  = { PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo', NA: 'N/A' }
const ESTADO_COLOR  = {
  PENDIENTE:  { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  EN_PROCESO: { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE' },
  LISTO:      { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  NA:         { bg: '#F3F4F6', text: '#9CA3AF', border: '#E5E7EB' },
}
const ESTADOS_PROD = ['PENDIENTE', 'EN_PROCESO', 'LISTO']

function initials(p) {
  if (!p) return '?'
  return `${(p.nombre || '')[0] || ''}${(p.apellido || '')[0] || ''}`.toUpperCase()
}

// ── PILL DE ÍTEM ──────────────────────────────────────────────────────────────
function ItemPill({ item, personal, maquinas, fotos_ok, onClick }) {
  const col   = ESTADO_COLOR[item.estado] || ESTADO_COLOR.PENDIENTE
  const rec   = item.recordatorios
  const soloN = rec?.solo_nombre
  const reqImg = rec?.requiere_imagen && !soloN
  const bloqueado = reqImg && !fotos_ok && item.estado === 'PENDIENTE'
  const asig  = personal.find(p => p.id === item.asignado_a)
  const maq   = maquinas.find(m => m.id === item.maquina_id) || maquinas.find(m => m.id === rec?.maquina_id)

  return (
    <button
      onClick={() => onClick(item)}
      title={bloqueado ? 'Esperando fotos del cliente' : `Click para gestionar`}
      style={{
        background: bloqueado ? '#F9FAFB' : col.bg,
        color: bloqueado ? '#9CA3AF' : col.text,
        border: `1.5px solid ${bloqueado ? '#E5E7EB' : col.border}`,
        borderRadius: '20px',
        padding: '5px 10px',
        fontSize: '11px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        transition: 'all 0.15s',
        opacity: bloqueado ? 0.7 : 1,
        position: 'relative',
      }}
    >
      {bloqueado
        ? <Lock size={10} />
        : soloN
          ? <Zap size={10} style={{ color: '#059669' }} />
          : null}
      <span>{rec?.nombre || 'Ítem'}</span>
      {asig && (
        <span style={{
          background: 'rgba(0,0,0,0.12)', borderRadius: '50%',
          width: '16px', height: '16px', fontSize: '8px', fontWeight: '800',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{initials(asig)}</span>
      )}
      {maq && (
        <Cpu size={9} style={{ opacity: 0.7 }} />
      )}
    </button>
  )
}

// ── MODAL GESTIÓN ÍTEM ────────────────────────────────────────────────────────
function ModalItem({ item, personal, maquinas, fotos_ok, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const rec = item.recordatorios
  const soloN = rec?.solo_nombre
  const reqImg = rec?.requiere_imagen && !soloN
  const bloqueado = reqImg && !fotos_ok

  const [estado,   setEstado]   = useState(item.estado)
  const [asignado, setAsignado] = useState(item.asignado_a || '')
  const [maquina,  setMaquina]  = useState(item.maquina_id || rec?.maquina_id || '')
  const [notas,    setNotas]    = useState(item.notas || '')
  const [saving,   setSaving]   = useState(false)

  async function guardar() {
    setSaving(true)
    const patch = {
      estado,
      asignado_a: asignado || null,
      maquina_id: maquina  || null,
      notas:      notas    || null,
      fecha_inicio_prod: estado !== 'PENDIENTE' && !item.fecha_inicio_prod
        ? new Date().toISOString().slice(0, 10) : item.fecha_inicio_prod,
      fecha_fin_prod: estado === 'LISTO'
        ? (item.fecha_fin_prod || new Date().toISOString().slice(0, 10)) : null,
    }
    const { error } = await db.from('servicio_recordatorios').update(patch).eq('id', item.id)
    if (error) { setSaving(false); await showAlert(parsearErrorDB(error), { title: 'Error' }); return }

    // ── Recalcular estado del servicio dinámicamente ─────────────────────────
    const svcId = item.servicio_id
    try {
      const [{ data: todosItems }, { data: svc }] = await Promise.all([
        db.from('servicio_recordatorios')
          .select('id, estado')
          .eq('servicio_id', svcId)
          .neq('origen', 'REMOVIDO')
          .neq('estado', 'NA'),
        db.from('servicios').select('estado').eq('id', svcId).maybeSingle(),
      ])
      const todos = todosItems || []
      const estadoActual = svc?.estado
      if (!todos.length || ['EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estadoActual)) return
      const esTerminado = e => e === 'LISTO' || e === 'ENTREGADO'
      const todosTerminados = todos.every(i => esTerminado(i.estado))
      const algunoEnProceso = todos.some(i => i.estado === 'EN_PROCESO')
      if (todosTerminados && estadoActual !== 'LISTO') {
        await db.from('servicios').update({ estado: 'LISTO' }).eq('id', svcId)
      } else if (!todosTerminados && estadoActual === 'LISTO') {
        await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', svcId)
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estadoActual)) {
        await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', svcId)
      }
    } catch (_) { /* silencioso — no bloquear el flujo de ítems */ }

    setSaving(false)
    onSaved({ ...item, ...patch })
    onClose()
  }

  const col = ESTADO_COLOR[estado] || ESTADO_COLOR.PENDIENTE

  return (
    <Modal open onClose={onClose} title={rec?.nombre || 'Ítem'}>
      <div className="space-y-4">

        {/* Indicadores */}
        <div className="flex flex-wrap gap-2">
          {soloN && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#D1FAE5', color: '#065F46' }}>
              <Zap size={11} /> Sin fotos — puede producirse ya
            </span>
          )}
          {reqImg && !fotos_ok && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#FEF3C7', color: '#92400E' }}>
              <Lock size={11} /> Requiere fotos del cliente
            </span>
          )}
          {reqImg && fotos_ok && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#D1FAE5', color: '#065F46' }}>
              <CheckCircle2 size={11} /> Fotos recibidas ✓
            </span>
          )}
        </div>

        {/* Estado */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-2 uppercase tracking-wide">Estado</label>
          <div className="flex gap-1.5 flex-wrap">
            {ESTADOS_PROD.map(e => {
              const c = ESTADO_COLOR[e]
              const sel = estado === e
              return (
                <button key={e} onClick={() => setEstado(e)}
                  style={{
                    background: sel ? c.bg : 'transparent',
                    color: sel ? c.text : '#6B7280',
                    border: `1.5px solid ${sel ? c.border : '#E5E7EB'}`,
                    borderRadius: '20px', padding: '5px 12px',
                    fontSize: '11px', fontWeight: sel ? '700' : '500', cursor: 'pointer',
                  }}>
                  {ESTADO_LABEL[e]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Asignar persona */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
            <User size={11} className="inline mr-1" />Asignar a
          </label>
          <Select value={asignado} onChange={e => setAsignado(e.target.value)}>
            <option value="">Sin asignar</option>
            {personal.map(p => (
              <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>
            ))}
          </Select>
        </div>

        {/* Máquina */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
            <Cpu size={11} className="inline mr-1" />Máquina
          </label>
          <Select value={maquina} onChange={e => setMaquina(e.target.value)}>
            <option value="">Sin asignar</option>
            {maquinas.map(m => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </Select>
          {rec?.maquina_id && !maquina && (
            <p className="text-[11px] text-ink3 mt-1">
              Máquina sugerida: {maquinas.find(m => m.id === rec.maquina_id)?.nombre}
            </p>
          )}
        </div>

        {/* Notas */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">Notas</label>
          <Textarea value={notas} onChange={e => setNotas(e.target.value)}
            placeholder="Observaciones de producción…" rows={2} />
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={guardar} disabled={saving} className="flex-1">
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── VISTA POR SERVICIO ────────────────────────────────────────────────────────
function VistaPorServicio({ recordatorios, personal, maquinas, filtroEstado, filtroPersona, onClickItem, onPrepararEntrega }) {
  const filtrados = recordatorios.filter(r => {
    if (r.estado === 'NA') return false
    if (filtroPersona && r.asignado_a !== filtroPersona) return false
    // Servicios en LISTO siempre visibles en cualquier filtro (botón de entrega)
    if (r.servicios?.estado === 'LISTO') return true
    if (filtroEstado === 'pendientes') return r.estado === 'PENDIENTE'
    if (filtroEstado === 'en_proceso') return r.estado === 'EN_PROCESO'
    if (filtroEstado === 'listos')     return r.estado === 'LISTO'
    return true
  })

  const porServicio = {}
  filtrados.forEach(r => {
    if (!porServicio[r.servicio_id]) porServicio[r.servicio_id] = {
      servicio: r.servicios, items: [], fotos_ok: !!r.servicios?.fecha_imagenes_recibidas,
    }
    porServicio[r.servicio_id].items.push(r)
  })

  if (Object.keys(porServicio).length === 0) return (
    <div className="col-span-3 text-center py-16 text-ink3">
      <div className="text-4xl mb-3">⚙️</div>
      <div className="text-sm font-medium">Sin ítems para este filtro</div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Object.entries(porServicio).map(([sId, { servicio, items, fotos_ok }]) => {
        const mascota = servicio?.mascotas
        const plan    = servicio?.planes
        const listosCnt = items.filter(i => ['LISTO', 'ENTREGADO'].includes(i.estado)).length
        const pct = items.length > 0 ? Math.round((listosCnt / items.length) * 100) : 0
        const bloqueados = items.filter(i =>
          i.recordatorios?.requiere_imagen && !i.recordatorios?.solo_nombre && !fotos_ok && i.estado === 'PENDIENTE'
        ).length
        const listosProd = items.filter(i =>
          i.recordatorios?.solo_nombre && i.estado === 'PENDIENTE'
        ).length

        const svcEstado = servicio?.estado
        const todoListo = svcEstado === 'LISTO'

        return (
          <div key={sId} className="bg-surface border rounded-2xl p-4 shadow-sm"
            style={{ borderColor: todoListo ? '#6EE7B7' : 'rgba(30,80,40,0.1)', borderWidth: todoListo ? 2 : 1 }}>
            {/* Header */}
            <div className="flex items-start gap-2 mb-2.5">
              <span className="text-xl mt-0.5">{petEmoji(mascota?.especies?.nombre)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink text-[13px] truncate">{mascota?.nombre || 'Sin nombre'}</div>
                <div className="text-[11px] text-ink3 truncate">{plan?.nombre}</div>
              </div>
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                {todoListo && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: '#D1FAE5', color: '#065F46' }}>
                    ✓ LISTO
                  </span>
                )}
                <div className="text-[11px] font-bold text-ink3">{listosCnt}/{items.length}</div>
              </div>
            </div>

            {/* Indicadores fotos */}
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {fotos_ok
                ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: '#D1FAE5', color: '#065F46' }}>
                    <CheckCircle2 size={9} /> Fotos OK
                  </span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: '#FEF9C3', color: '#713F12' }}>
                    <Clock size={9} /> Sin fotos
                  </span>
              }
              {!fotos_ok && listosProd > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#ECFDF5', color: '#065F46' }}>
                  <Zap size={9} /> {listosProd} listas ya
                </span>
              )}
              {bloqueados > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <Lock size={9} /> {bloqueados} bloqueadas
                </span>
              )}
            </div>

            {/* Barra progreso */}
            <div className="k-progress-bar mb-3">
              <div className="k-progress-fill" style={{ width: `${pct}%` }} />
            </div>

            {/* Pills */}
            <div className="flex flex-wrap gap-1.5">
              {items.map(item => (
                <ItemPill key={item.id} item={item} personal={personal}
                  maquinas={maquinas} fotos_ok={fotos_ok} onClick={onClickItem} />
              ))}
            </div>

            {/* Botón preparar entrega cuando está LISTO */}
            {todoListo && onPrepararEntrega && (
              <button
                onClick={() => onPrepararEntrega(sId)}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
                style={{ background: '#4F46E5' }}>
                <Truck size={13} /> Preparar entrega
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── VISTA POR MÁQUINA ─────────────────────────────────────────────────────────
function VistaPorMaquina({ recordatorios, personal, maquinas, onClickItem }) {
  const enProceso = recordatorios.filter(r => r.estado === 'EN_PROCESO' && r.estado !== 'NA')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {maquinas.map(maq => {
        const items = enProceso.filter(r =>
          r.maquina_id === maq.id ||
          (!r.maquina_id && r.recordatorios?.maquina_id === maq.id)
        )
        return (
          <div key={maq.id} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: items.length > 0 ? '#DBEAFE' : '#F3F4F6' }}>
                <Cpu size={16} style={{ color: items.length > 0 ? '#1E40AF' : '#9CA3AF' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">{maq.nombre}</div>
                <div className="text-[11px] text-ink3">{items.length} ítems en proceso</div>
              </div>
              {items.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              )}
            </div>
            {items.length === 0
              ? <div className="text-center py-6 text-ink3 text-[12px]">Máquina disponible</div>
              : (
                <div className="space-y-2">
                  {items.map(item => {
                    const mascota = item.servicios?.mascotas
                    const asig = personal.find(p => p.id === item.asignado_a)
                    return (
                      <button key={item.id} onClick={() => onClickItem(item)}
                        className="w-full text-left p-2.5 rounded-xl transition-colors hover:bg-surface2"
                        style={{ border: '1px solid rgba(30,80,40,0.08)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{petEmoji(mascota?.especies?.nombre)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-bold text-ink truncate">{item.recordatorios?.nombre}</div>
                            <div className="text-[11px] text-ink3 truncate">{mascota?.nombre}</div>
                          </div>
                          {asig && (
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                              style={{ background: '#1A5CD8' }}>
                              {initials(asig)}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            }
          </div>
        )
      })}

      {/* Sin máquina */}
      {(() => {
        const sinMaq = enProceso.filter(r => !r.maquina_id && !r.recordatorios?.maquina_id)
        if (!sinMaq.length) return null
        return (
          <div className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#FEF3C7' }}>
                <AlertCircle size={16} style={{ color: '#92400E' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">Sin máquina asignada</div>
                <div className="text-[11px] text-ink3">{sinMaq.length} ítems</div>
              </div>
            </div>
            <div className="space-y-2">
              {sinMaq.map(item => {
                const mascota = item.servicios?.mascotas
                return (
                  <button key={item.id} onClick={() => onClickItem(item)}
                    className="w-full text-left p-2.5 rounded-xl transition-colors hover:bg-surface2"
                    style={{ border: '1px solid rgba(30,80,40,0.08)' }}>
                    <div className="text-[12px] font-bold text-ink">{item.recordatorios?.nombre}</div>
                    <div className="text-[11px] text-ink3">{mascota?.nombre}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── VISTA POR PERSONA ─────────────────────────────────────────────────────────
function VistaPorPersona({ recordatorios, personal, maquinas, onClickItem }) {
  const asignados = recordatorios.filter(r => r.asignado_a && r.estado !== 'NA' && r.estado !== 'ENTREGADO')

  const porPersona = {}
  personal.forEach(p => { porPersona[p.id] = { persona: p, items: [] } })
  asignados.forEach(r => {
    if (porPersona[r.asignado_a]) porPersona[r.asignado_a].items.push(r)
  })

  const conItems = Object.values(porPersona).filter(p => p.items.length > 0)

  if (!conItems.length) return (
    <div className="text-center py-16 text-ink3">
      <User size={36} className="mx-auto mb-3 opacity-30" />
      <div className="text-sm font-medium">Ningún ítem asignado aún</div>
      <div className="text-xs mt-1">Haz click en un ítem para asignarlo a una persona</div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {conItems.map(({ persona, items }) => {
        const enProc = items.filter(i => i.estado === 'EN_PROCESO').length
        const listos = items.filter(i => i.estado === 'LISTO').length
        const pend   = items.filter(i => i.estado === 'PENDIENTE').length
        return (
          <div key={persona.id} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white"
                style={{ background: '#1A5CD8' }}>
                {initials(persona)}
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">{persona.nombre} {persona.apellido}</div>
                <div className="flex gap-2 mt-0.5">
                  {pend > 0 && <span className="text-[10px] font-bold" style={{ color: '#92400E' }}>{pend} pend.</span>}
                  {enProc > 0 && <span className="text-[10px] font-bold" style={{ color: '#1E40AF' }}>{enProc} en proc.</span>}
                  {listos > 0 && <span className="text-[10px] font-bold" style={{ color: '#065F46' }}>{listos} listos</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map(item => (
                <ItemPill key={item.id} item={item} personal={personal}
                  maquinas={maquinas} fotos_ok={!!item.servicios?.fecha_imagenes_recibidas} onClick={onClickItem} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── MÓDULO PRINCIPAL ──────────────────────────────────────────────────────────
export default function Produccion() {
  const { alert: showAlert } = useConfirm()
  const [recordatorios, setRecordatorios] = useState([])
  const [personal,      setPersonal]      = useState([])
  const [maquinas,      setMaquinas]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [vista,         setVista]         = useState('servicio')
  const [filtroEstado,  setFiltroEstado]  = useState('pendientes')
  const [filtroPersona, setFiltroPersona] = useState('')
  const [modalItem,     setModalItem]     = useState(null)
  const [modalEntrega,  setModalEntrega]  = useState(null) // servicioId string

  useEffect(() => {
    cargar()
    const canal = db
      .channel('produccion-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicio_recordatorios' }, () => { cargar() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servicios' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data: recs }, { data: per }, { data: maq }] = await Promise.all([
        db.from('servicio_recordatorios')
          .select(`
            *,
            recordatorios ( id, nombre, categoria, requiere_imagen, solo_nombre,
                            recolecta_tecnico, tiempo_produccion_dias, maquina_id,
                            maquinas_produccion ( id, nombre ) ),
            servicios ( id, fecha_imagenes_recibidas, estado,
                        mascotas ( nombre, especie_id, especies ( nombre ) ),
                        planes ( nombre, codigo ) )
          `)
          .neq('origen', 'REMOVIDO')
          .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
          .order('created_at', { ascending: false }),
        db.from('personal').select('id, nombre, apellido, activo').eq('activo', true).order('nombre'),
        db.from('maquinas_produccion').select('*').eq('activo', true).order('nombre'),
      ])
      setRecordatorios(recs || [])
      setPersonal(per || [])
      setMaquinas(maq || [])
      // Sincronizar servicios cuyo estado no refleja el estado real de sus ítems
      await autoCorregirEstados(recs || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function autoCorregirEstados(recs) {
    const porServicio = {}
    recs.forEach(r => {
      if (!porServicio[r.servicio_id]) porServicio[r.servicio_id] = { svc: r.servicios, items: [] }
      porServicio[r.servicio_id].items.push(r)
    })
    const fijarListo = []
    const fijarEnProduccion = []
    for (const [svcId, { svc, items }] of Object.entries(porServicio)) {
      if (!items.length) continue
      const estado = svc?.estado
      if (['LISTO', 'EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estado)) continue
      const todosListos = items.every(i => i.estado === 'LISTO')
      // Los ítems que recolecta el técnico entran a EN_PROCESO ya en la recogida;
      // NO deben adelantar el servicio a EN_PRODUCCION (eso lo dispara producción
      // real). Solo cuentan los ítems no-técnico para el avance automático.
      const algunoEnProceso = items.some(i => i.estado === 'EN_PROCESO' && !i.recordatorios?.recolecta_tecnico)
      if (todosListos) {
        fijarListo.push(svcId)
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estado)) {
        fijarEnProduccion.push(svcId)
      }
    }
    if (!fijarListo.length && !fijarEnProduccion.length) return
    const ops = []
    if (fijarListo.length)        ops.push(db.from('servicios').update({ estado: 'LISTO'          }).in('id', fijarListo))
    if (fijarEnProduccion.length) ops.push(db.from('servicios').update({ estado: 'EN_PRODUCCION' }).in('id', fijarEnProduccion))
    await Promise.all(ops)
    // Recargar para que las tarjetas reflejen el nuevo estado del servicio
    const { data: recsNuevos } = await db.from('servicio_recordatorios')
      .select(`
        *,
        recordatorios ( id, nombre, categoria, requiere_imagen, solo_nombre,
                        recolecta_tecnico, tiempo_produccion_dias, maquina_id,
                        maquinas_produccion ( id, nombre ) ),
        servicios ( id, fecha_imagenes_recibidas, estado,
                    mascotas ( nombre, especie_id, especies ( nombre ) ),
                    planes ( nombre, codigo ) )
      `)
      .neq('origen', 'REMOVIDO')
      .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
      .order('created_at', { ascending: false })
    setRecordatorios(recsNuevos || [])
  }

  function handleSaved(updatedItem) {
    setRecordatorios(prev => prev.map(r => r.id === updatedItem.id ? { ...r, ...updatedItem } : r))
  }

  const stats = {
    pendientes: recordatorios.filter(r => r.estado === 'PENDIENTE').length,
    enProceso:  recordatorios.filter(r => r.estado === 'EN_PROCESO').length,
    listos:     recordatorios.filter(r => r.estado === 'LISTO').length,
    sinFotos:   recordatorios.filter(r =>
      r.recordatorios?.requiere_imagen && !r.recordatorios?.solo_nombre &&
      !r.servicios?.fecha_imagenes_recibidas && r.estado === 'PENDIENTE'
    ).length,
  }

  const VISTAS = [
    { key: 'servicio', label: 'Por servicio' },
    { key: 'maquina',  label: 'Por máquina'  },
    { key: 'persona',  label: 'Por persona'  },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="spinner" /><span className="text-sm text-ink3">Cargando producción…</span>
    </div>
  )
  if (error) return (
    <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>
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
          <StatCard label="Pendientes"    value={stats.pendientes} valueColor="#C03030" />
          <StatCard label="En proceso"   value={stats.enProceso}  valueColor="#1E40AF" />
          <StatCard label="Listos"        value={stats.listos}     valueColor="#065F46" />
          <StatCard label="Bloqueados (sin fotos)" value={stats.sinFotos} valueColor="#92400E"
            sub={stats.sinFotos > 0 ? 'Esperan imágenes del cliente' : 'Todo al día'} />
        </div>

        {/* Tabs de vista */}
        <div className="flex flex-wrap gap-3 mb-5 items-center">
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {VISTAS.map(v => (
              <button key={v.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${vista === v.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => setVista(v.key)}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Filtros solo en vista servicio */}
          {vista === 'servicio' && (
            <>
              <Select value={filtroPersona} onChange={e => setFiltroPersona(e.target.value)} className="w-44">
                <option value="">Todos los operarios</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select>
              <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                {[
                  { key: 'pendientes', label: 'Pendientes' },
                  { key: 'en_proceso', label: 'En proceso' },
                  { key: 'listos',     label: 'Listos'     },
                  { key: 'todos',      label: 'Todos'      },
                ].map(f => (
                  <button key={f.key}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtroEstado === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                    onClick={() => setFiltroEstado(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3 text-[11px] text-ink3">
            <span className="inline-flex items-center gap-1"><Zap size={10} style={{ color: '#059669' }} /> Sin fotos OK</span>
            <span className="inline-flex items-center gap-1"><Lock size={10} style={{ color: '#92400E' }} /> Bloqueado</span>
            <span className="inline-flex items-center gap-1"><Cpu size={10} /> Máquina</span>
          </div>
        </div>

        {/* Contenido según vista */}
        {vista === 'servicio' && (
          <VistaPorServicio
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            filtroEstado={filtroEstado} filtroPersona={filtroPersona}
            onClickItem={setModalItem}
            onPrepararEntrega={id => setModalEntrega(id)}
          />
        )}
        {vista === 'maquina' && (
          <VistaPorMaquina
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            onClickItem={setModalItem}
          />
        )}
        {vista === 'persona' && (
          <VistaPorPersona
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            onClickItem={setModalItem}
          />
        )}

      </div>

      {/* Modal gestión ítem */}
      {modalItem && (
        <ModalItem
          item={modalItem}
          personal={personal}
          maquinas={maquinas}
          fotos_ok={!!modalItem.servicios?.fecha_imagenes_recibidas}
          onClose={() => setModalItem(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal preparar entrega */}
      {modalEntrega && (
        <ModalPreparaEntrega
          servicioId={modalEntrega}
          onClose={() => setModalEntrega(null)}
          onGuardado={() => { setModalEntrega(null); cargar() }}
        />
      )}
    </div>
  )
}
