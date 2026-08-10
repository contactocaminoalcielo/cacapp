import { useState, useEffect, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { agruparRefresco } from '@/lib/realtime'
import { FECHA_CORTE } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { petEmoji, fmt, waLink, hoyLocalISO } from '@/lib/utils'
import { registrarIngresoCuartoFrio } from '@/lib/cuartoFrio'
import {
  Snowflake, RefreshCw, Edit2, ClipboardList, Scale, Package,
  History, ChevronDown, ChevronUp, Plus, Trash2, Thermometer,
  Search, X, AlertTriangle,
} from 'lucide-react'
import { esAliadoVip, VipStar, VipBadge, VIP_ORO } from '@/components/servicio/VipAliado'

function fmtFechaHora(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) +
         ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

const ESTADO_CF = {
  PENDIENTE_INGRESO: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', label: 'Pendiente ingreso' },
  REFRIGERADO:       { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE', label: 'Refrigerado'       },
  EN_ESPERA_PROCESO: { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980', label: 'En espera proceso'  },
  TRASLADADO:        { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD', label: 'Trasladado'         },
  RETIRADO:          { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB', label: 'Retirado'           },
}

const FUNC_COLOR = {
  SIN_FUNCIONAR: { bg: '#FEE2E2', text: '#991B1B', label: 'Sin funcionar' },
  MANTENIMIENTO: { bg: '#FEF3C7', text: '#92400E', label: 'Mantenimiento' },
  REFRIGERANDO:  { bg: '#DBEAFE', text: '#1E40AF', label: 'Refrigerando'  },
  CONGELANDO:    { bg: '#E0F2FE', text: '#0E7490', label: 'Congelando'    },
  CAVA:          { bg: '#D1FAE5', text: '#065F46', label: 'Cava'          },
}

// ─── ReporteCard ─────────────────────────────────────────────────────────────
function ReporteCard({ reporte, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const neveras = reporte.estado_nevera_reporte || []
  const p       = reporte.personal
  const esHoy   = reporte.fecha === hoyLocalISO()

  const checks = [
    { key: 'ozonizadores_ok',   emoji: '💨', label: 'Ozonizadores en funcionamiento' },
    { key: 'control_olores_ok', emoji: '🌿', label: 'Control de olores activo'       },
    { key: 'sin_olor_novedad',  emoji: '✅', label: 'Sin olor ni novedad'            },
  ]

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm ${esHoy ? 'border-blue-200' : 'border-gray-100'}`}>
      <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3 min-w-0">
          {esHoy && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">Hoy</span>
          )}
          <span className="text-[12px] font-semibold text-gray-900 truncate">
            {new Date(reporte.fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <span className="text-[11px] text-gray-400 hidden sm:block truncate">
            {p ? `${p.nombre} ${p.apellido}` : 'Técnico'} · {fmtFechaHora(reporte.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {checks.map(c => reporte[c.key] && (
            <span key={c.key} className="text-[11px]">{c.emoji}</span>
          ))}
          {open ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {neveras.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 mb-3">
              {neveras.map(n => {
                const f = FUNC_COLOR[n.funcionamiento] || {}
                return (
                  <div key={n.id} className="rounded-xl p-2.5 border border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Snowflake size={11} className="text-blue-500" />
                      <span className="text-[12px] font-bold text-gray-900">{n.nevera_codigo}</span>
                    </div>
                    {n.capacidad_pct > 0 && (
                      <div className="mb-1.5">
                        <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                          <span>Capacidad</span><span className="font-semibold">{n.capacidad_pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${n.capacidad_pct}%`,
                            background: n.capacidad_pct >= 80 ? '#DC2626' : n.capacidad_pct >= 60 ? '#D97706' : '#3B82F6',
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
            <p className="text-[11px] text-gray-400 mt-3 mb-3">Sin datos de neveras en este reporte.</p>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            {checks.map(c => (
              <span key={c.key} className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                style={{ background: reporte[c.key] ? '#D1FAE5' : '#F3F4F6', color: reporte[c.key] ? '#065F46' : '#9CA3AF' }}>
                {c.emoji} {c.label}
              </span>
            ))}
          </div>

          {reporte.comentario && (
            <div className="text-[12px] text-gray-600 bg-gray-50 rounded-xl px-3 py-2.5 leading-relaxed">
              💬 {reporte.comentario}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── LogMovimientos ───────────────────────────────────────────────────────────
function LogMovimientos({ movimientos }) {
  const [open, setOpen] = useState(false)
  if (!movimientos.length) return null
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 hover:text-gray-700 transition-colors">
        <History size={12} />
        Historial ({movimientos.length})
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <div className="space-y-1.5">
          {movimientos.map(m => {
            const quien = m.personal ? `${m.personal.nombre} ${m.personal.apellido}` : 'Sistema'
            const fecha = new Date(m.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) +
                          ' · ' + new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
            const tipoLabel = m.tipo === 'INGRESO' ? '📥 Ingreso a la nevera'
              : m.tipo === 'CAMBIO_NEVERA' ? '❄️ Cambio de nevera'
              : m.tipo === 'CAMBIO_ESTADO' ? '📋 Cambio de estado'
              : m.tipo === 'SALIDA_TENJO' ? '🚚 Salida a Tenjo'
              : m.tipo === 'SALIDA_LOTE_GRUPAL' ? '📦 Salida en lote grupal' : m.tipo
            return (
              <div key={m.id} className="text-[11px] bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-semibold text-gray-800">{tipoLabel}</span>
                  <span className="text-gray-400">{fecha}</span>
                </div>
                {m.nevera_anterior !== m.nevera_nueva && m.nevera_nueva && (
                  <span className="text-gray-600">Nevera: <span className="font-mono">{m.nevera_anterior || '—'}</span> → <span className="font-mono font-bold">{m.nevera_nueva}</span></span>
                )}
                {m.estado_anterior !== m.estado_nuevo && m.estado_nuevo && (
                  <span className="text-gray-600 block">{m.estado_anterior?.replace(/_/g,' ') || '—'} → <strong>{m.estado_nuevo?.replace(/_/g,' ')}</strong></span>
                )}
                <div className="text-gray-400 mt-0.5">Por: {quien}</div>
                {m.notas && <div className="text-gray-400 italic mt-0.5">"{m.notas}"</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── DetalleModal ─────────────────────────────────────────────────────────────
function DetalleModal({ registro: r, onClose, onEdit, movimientos }) {
  const m            = r.servicios?.mascotas
  const c            = m?.clientes
  const p            = r.servicios?.planes
  const e            = ESTADO_CF[r.estado] || {}
  const fotoRecogida = r.servicios?.recogidas?.[0]?.foto_recogida_url
  const fotoPesaje   = r.foto_pesaje_url
  const t            = r.servicios?.tecnico

  return (
    <Modal open={true} onClose={onClose}
      title="Detalle — cuarto frío"
      maxWidth="max-w-lg"
      footer={
        <div className="flex gap-2">
          {onEdit && (
            <Button variant="secondary" onClick={() => onEdit(r)}>
              <Edit2 size={13} className="mr-1.5" /> Editar
            </Button>
          )}
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      }>
      <div className="space-y-4">

        {/* Mascota */}
        <div className="flex items-start gap-3 p-3 rounded-xl"
          style={esAliadoVip(r.servicios)
            ? { background: VIP_ORO.bg, border: `1px solid ${VIP_ORO.borde}` }
            : { background: '#F9FAFB' }}>
          <span className="text-4xl">{petEmoji(m?.especies?.nombre)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-gray-900 text-[16px]">{m?.nombre || '—'}</span>
              {esAliadoVip(r.servicios) && <VipBadge />}
            </div>
            <div className="text-[12px] text-gray-500">
              {m?.especies?.nombre}{m?.peso_kg ? ` · ${m.peso_kg} kg` : ''}
            </div>
            <div className="text-[13px] text-gray-700 font-medium mt-0.5">{c?.nombre} {c?.apellido}</div>
            {c?.whatsapp && (
              <a href={waLink(c.whatsapp)} target="_blank" rel="noreferrer"
                className="text-[11px] text-blue-600 font-medium">📱 {c.whatsapp}</a>
            )}
          </div>
        </div>

        {/* Grid de datos */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Plan',         value: p?.nombre || '—',                                           sub: p?.codigo },
            { label: 'Estado',       badge: true,                                                        e              },
            { label: 'Nevera',       value: r.nevera_codigo || 'Sin asignar',                           mono: true     },
            { label: 'Peso báscula', value: r.peso_kg ? `${r.peso_kg} kg ✓` : (m?.peso_kg ? `${m.peso_kg} kg ~` : 'No registrado') },
            { label: 'Técnico',      value: t ? `${t.nombre} ${t.apellido}` : '—'                      },
            // fecha_ingreso = cuando se registró el servicio (la crea el trigger);
            // fecha_ingreso_real = cuando la mascota entró de verdad a la nevera.
            { label: 'Registro del servicio', value: fmtFechaHora(r.fecha_ingreso) },
            { label: 'Ingreso a la nevera',
              value: r.fecha_ingreso_real
                ? `${fmtFechaHora(r.fecha_ingreso_real)}${r.registrador ? ` · ${r.registrador.nombre}` : ''}`
                : '—' },
          ].map((item, idx) => (
            <div key={idx} className="bg-gray-50 rounded-xl p-2.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{item.label}</div>
              {item.badge ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ background: item.e?.bg, color: item.e?.text, borderColor: item.e?.border }}>
                  {item.e?.label || r.estado?.replace(/_/g, ' ')}
                </span>
              ) : (
                <>
                  <div className={`text-[13px] font-semibold text-gray-900 ${item.mono ? 'font-mono' : ''}`}>{item.value}</div>
                  {item.sub && <div className="text-[10px] text-gray-400">{item.sub}</div>}
                </>
              )}
            </div>
          ))}
        </div>

        {r.notas && (
          <div className="bg-amber-50 rounded-xl px-3 py-2.5">
            <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">Notas</div>
            <p className="text-[12px] text-amber-900">{r.notas}</p>
          </div>
        )}

        {/* Fotos */}
        {(fotoRecogida || fotoPesaje) && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Fotos evidencia</div>
            <div className="grid grid-cols-2 gap-3">
              {fotoRecogida && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1">Recogida</p>
                  <a href={fotoRecogida} target="_blank" rel="noreferrer">
                    <img src={fotoRecogida} alt="" className="w-full h-36 object-cover rounded-xl border border-gray-100 hover:opacity-90 transition-opacity" />
                  </a>
                </div>
              )}
              {fotoPesaje && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-1">Pesaje báscula</p>
                  <a href={fotoPesaje} target="_blank" rel="noreferrer">
                    <img src={fotoPesaje} alt="" className="w-full h-36 object-cover rounded-xl border border-gray-100 hover:opacity-90 transition-opacity" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        <LogMovimientos movimientos={movimientos || []} />
      </div>
    </Modal>
  )
}

// ─── Gestión de Neveras ───────────────────────────────────────────────────────
export function GestionNeveras() {
  const { personalData } = useAuth()
  const canEdit = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)

  const [neveras,  setNeveras]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [open,     setOpen]     = useState(false)
  const [selected, setSelected] = useState(null)
  const [form,     setForm]     = useState({})
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('neveras').select('*').order('codigo')
    setNeveras(data || [])
    setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      codigo: item.codigo || '', descripcion: item.descripcion || '',
      capacidad_kg: item.capacidad_kg || 100, ubicacion: item.ubicacion || '',
      notas: item.notas || '', activa: item.activa !== false,
    } : { codigo: '', descripcion: '', capacidad_kg: 100, ubicacion: '', notas: '', activa: true })
    setErr('')
  }

  async function guardar() {
    if (!form.codigo?.trim()) { setErr('El código es requerido.'); return }
    setSaving(true); setErr('')
    try {
      const body = { ...form, codigo: form.codigo.trim().toUpperCase(), capacidad_kg: parseFloat(form.capacidad_kg) || 100 }
      const { error } = selected?.id
        ? await db.from('neveras').update(body).eq('id', selected.id)
        : await db.from('neveras').insert(body)
      if (error) { setErr(error.message); return }
      await cargar(); setSelected(null)
    } finally { setSaving(false) }
  }

  async function eliminar(n) {
    if (!window.confirm(`¿Eliminar la nevera ${n.codigo}?`)) return
    const { error } = await db.from('neveras').delete().eq('id', n.id)
    if (error) { alert('Error: ' + error.message); return }
    await cargar()
  }

  async function toggleActiva(n) {
    await db.from('neveras').update({ activa: !n.activa }).eq('id', n.id)
    await cargar()
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm mb-6 overflow-hidden">
      <button className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2">
          <Thermometer size={16} className="text-blue-500" />
          <span className="text-[14px] font-bold text-gray-900">Gestión de neveras</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 ml-1">
            {neveras.filter(n => n.activa !== false).length} activas
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <button onClick={e => { e.stopPropagation(); abrir(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold"
              style={{ background: '#3D5A27', color: '#fff' }}>
              <Plus size={12} /> Nueva
            </button>
          )}
          {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
              <div className="spinner" /><span className="text-sm">Cargando…</span>
            </div>
          ) : neveras.length === 0 ? (
            <div className="py-10 text-center">
              <div className="text-3xl mb-2">🧊</div>
              <p className="text-[13px] font-semibold text-gray-500">No hay neveras registradas</p>
              {canEdit && (
                <button onClick={() => abrir(null)} className="mt-3 px-4 py-2 rounded-xl text-[12px] font-bold"
                  style={{ background: '#3D5A27', color: '#fff' }}>
                  + Agregar primera nevera
                </button>
              )}
            </div>
          ) : (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {neveras.map(n => (
                <div key={n.id} className={`rounded-2xl border p-3 ${n.activa !== false ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Snowflake size={13} className={n.activa !== false ? 'text-blue-500' : 'text-gray-400'} />
                      <span className="font-mono font-bold text-[14px] text-gray-900">{n.codigo}</span>
                    </div>
                    {canEdit && (
                      <div className="flex gap-0.5">
                        <button onClick={() => abrir(n)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white text-gray-400 hover:text-gray-700">
                          <Edit2 size={11} />
                        </button>
                        <button onClick={() => eliminar(n)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                  {n.descripcion && <p className="text-[10px] text-gray-500 mb-1.5 truncate">{n.descripcion}</p>}
                  {n.capacidad_kg && <p className="text-[10px] text-gray-400 mb-1.5">Capacidad: {n.capacidad_kg} kg</p>}
                  <button onClick={() => canEdit && toggleActiva(n)}
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                    style={n.activa !== false ? { background: '#D1FAE5', color: '#065F46' } : { background: '#F3F4F6', color: '#9CA3AF' }}>
                    {n.activa !== false ? '● Activa' : '○ Inactiva'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? `Editar nevera ${selected.codigo}` : 'Nueva nevera'}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </>}>
          <div className="space-y-3">
            {err && <div className="bg-red-50 text-red-700 text-[12px] px-3 py-2 rounded-xl">{err}</div>}
            <div>
              <label className="text-[11px] font-bold text-gray-500 block mb-1">Código *</label>
              <Input value={form.codigo || ''} onChange={e => setForm(p => ({ ...p, codigo: e.target.value.toUpperCase() }))} placeholder="Ej: N1, CF-A…" maxLength={20} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 block mb-1">Descripción</label>
              <Input value={form.descripcion || ''} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ej: Nevera vertical 450L…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Cap. máx. (kg)</label>
                <Input type="number" min={1} step={0.5} value={form.capacidad_kg || ''} onChange={e => setForm(p => ({ ...p, capacidad_kg: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Ubicación</label>
                <Input value={form.ubicacion || ''} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} placeholder="Zona A…" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-500 block mb-1">Notas</label>
              <textarea value={form.notas || ''} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
                rows={2} placeholder="Observaciones…"
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none border-gray-200" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.activa} onChange={e => setForm(p => ({ ...p, activa: e.target.checked }))} className="w-4 h-4 accent-[#3D5A27]" />
              <span className="text-[12px] font-semibold text-gray-700">Nevera activa / en uso</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CuartoFrio() {
  const { personalData } = useAuth()
  const canEdit = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)

  const [registros,   setRegistros]   = useState([])
  const [reportes,    setReportes]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [form,        setForm]        = useState({})
  const [saving,      setSaving]      = useState(false)
  const [detalle,     setDetalle]     = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const primeraCarga                  = useRef(true)
  const [busqueda,    setBusqueda]    = useState('')

  useEffect(() => {
    cargar()
    const refrescar = agruparRefresco(() => cargar())
    const canal = db
      .channel('cuartofrio-registros-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuarto_frio' }, refrescar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servicios' }, refrescar)
      .subscribe()
    return () => { refrescar.cancelar(); db.removeChannel(canal) }
  }, [])

  // El spinner de pantalla completa solo se pinta en la PRIMERA carga: las
  // recargas posteriores (realtime de otro usuario, o tras guardar) pasan en
  // segundo plano. Si volviera a `loading`, el `if (loading) return` desmontaria
  // la pagina entera y con ella cualquier modal abierto.
  async function cargar() {
    try {
      if (primeraCarga.current) setLoading(true)
      const [{ data, error: err }, { data: rep }] = await Promise.all([
        db.from('cuarto_frio')
          .select(`*, registrador:registrado_por(nombre,apellido), servicios!inner(
            mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido,whatsapp)),
            aliados:aliado_origen_id(vip),
            planes(nombre,codigo,tipo_proceso),
            recogidas(foto_recogida_url),
            tecnico:tecnico_id(nombre,apellido)
          )`)
          .gte('servicios.fecha_ingreso', FECHA_CORTE)
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
      // Un fallo en un refresco de fondo NO debe tumbar la pantalla (el
      // `if (error) return` borraria la pagina y el modal abierto): solo la
      // primera carga, que no tiene nada que mostrar, muestra el error.
      if (primeraCarga.current) setError(e.message)
      else console.error('Refresco en segundo plano falló:', e)
    } finally {
      primeraCarga.current = false
      setLoading(false)
    }
  }

  function abrirEdicion(r, e) {
    e?.stopPropagation()
    setSelected(r)
    setForm({ nevera_codigo: r.nevera_codigo || '', peso_kg: r.peso_kg || '', estado: r.estado || 'PENDIENTE_INGRESO', notas: r.notas || '' })
  }

  async function verDetalle(r) {
    setDetalle(r)
    const { data } = await db.from('cuarto_frio_movimientos')
      .select('*, personal:personal_id(nombre,apellido)')
      .eq('cuarto_frio_id', r.id)
      .order('created_at', { ascending: false })
    setMovimientos(data || [])
  }

  async function guardar() {
    setSaving(true)
    try {
      const update = canEdit
        ? { nevera_codigo: form.nevera_codigo || null, peso_kg: parseFloat(form.peso_kg) || null, estado: form.estado, notas: form.notas || null }
        : { nevera_codigo: form.nevera_codigo || null }

      await db.from('cuarto_frio').update(update).eq('id', selected.id)

      const cambios = []
      if (form.nevera_codigo !== (selected.nevera_codigo || '')) cambios.push('nevera')
      if (canEdit && form.estado !== selected.estado) cambios.push('estado')

      // Ponerle nevera a una mascota que no tenía = INGRESO físico (aquí lo hace
      // coordinación, no el técnico): sella la hora real y deja el movimiento.
      // Cambiar de una nevera a otra sigue siendo CAMBIO_NEVERA.
      const esIngreso = !selected.nevera_codigo && !!form.nevera_codigo
      if (esIngreso) {
        await registrarIngresoCuartoFrio(selected.id, {
          personalId:  personalData?.id || null,
          neveraNueva: form.nevera_codigo,
          notas:       form.notas || 'Ingreso registrado desde Cuarto Frío',
        })
      } else if (cambios.length > 0) {
        await db.from('cuarto_frio_movimientos').insert({
          cuarto_frio_id:   selected.id,
          personal_id:      personalData?.id || null,
          tipo:             cambios.includes('nevera') ? 'CAMBIO_NEVERA' : 'CAMBIO_ESTADO',
          nevera_anterior:  selected.nevera_codigo || null,
          nevera_nueva:     form.nevera_codigo || null,
          estado_anterior:  selected.estado || null,
          estado_nuevo:     form.estado || null,
          notas:            form.notas || null,
        })
      }
      await cargar(); setSelected(null)
    } catch (e) { alert('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  function nombreTecnico(r) {
    const t = r.servicios?.tecnico
    return t ? `${t.nombre} ${t.apellido}` : '—'
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" /><span className="text-sm font-medium">Cargando cuarto frío…</span>
    </div>
  )
  if (error) return (
    <div className="p-5">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">Error: {error}</div>
    </div>
  )

  const META_LOTE_KG  = 2500
  const pendientes    = registros.filter(r => r.estado === 'PENDIENTE_INGRESO')
  const refrigerados  = registros.filter(r => r.estado === 'REFRIGERADO')
  const enEspera      = registros.filter(r => r.estado === 'EN_ESPERA_PROCESO')
  const activos       = registros.filter(r => ['REFRIGERADO','EN_ESPERA_PROCESO'].includes(r.estado))

  const activosCnPeso = activos.filter(r => r.peso_kg != null && r.peso_kg > 0)
  const activosSinPeso = activos.filter(r => !r.peso_kg || r.peso_kg === 0)
  const pesoConfirmado = activosCnPeso.reduce((s, r) => s + parseFloat(r.peso_kg), 0)
  const pesoEstimado   = activosSinPeso.reduce((s, r) => s + parseFloat(r.servicios?.mascotas?.peso_kg || 0), 0)
  const pesoTotal      = pesoConfirmado + pesoEstimado
  const pctLote        = Math.min(100, (pesoTotal / META_LOTE_KG) * 100)
  const pctConfirm     = pesoTotal > 0 ? Math.round((pesoConfirmado / pesoTotal) * 100) : 0
  const barColor       = pctLote >= 90 ? '#16A34A' : pctLote >= 60 ? '#D97706' : '#3B82F6'
  const barLabel       = pctLote >= 100 ? '🟢 Listo para lote' : pctLote >= 75 ? '🟡 Casi listo' : '🔵 Acumulando'

  const porNevera = {}
  activos.forEach(r => {
    const k = r.nevera_codigo || 'Sin asignar'
    if (!porNevera[k]) porNevera[k] = []
    porNevera[k].push(r)
  })

  const hoy        = hoyLocalISO()
  const reporteHoy = reportes.find(r => r.fecha === hoy)

  const registrosFiltrados = registros.filter(r => {
    if (!busqueda.trim()) return true
    const q  = busqueda.toLowerCase()
    const m  = r.servicios?.mascotas
    const c  = m?.clientes
    return [m?.nombre, c?.nombre, c?.apellido, r.nevera_codigo, r.servicios?.planes?.nombre]
      .some(v => v?.toLowerCase().includes(q))
  })

  return (
    <div>
      <Topbar actions={
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={cargar}>
          <RefreshCw size={14} />
        </button>
      } />
      <div className="p-5 flex flex-col gap-6">

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Pendientes ingreso', value: pendientes.length,  color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
            { label: 'En refrigeración',   value: refrigerados.length, color: '#1E40AF', bg: '#EFF6FF', border: '#BFDBFE' },
            { label: 'En espera proceso',  value: enEspera.length,     color: '#9A5500', bg: '#FFF7ED', border: '#FED7AA' },
            { label: 'Total activos',      value: activos.length + pendientes.length, color: '#3D5A27', bg: '#F0FDF4', border: '#BBF7D0' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border p-4" style={{ background: s.bg, borderColor: s.border }}>
              <div className="text-[11px] font-semibold mb-1" style={{ color: s.color }}>{s.label}</div>
              <div className="text-[32px] font-bold leading-none" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Panel peso / lote ─────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between"
            style={{ background: '#F8FAFF' }}>
            <div className="flex items-center gap-2">
              <Scale size={15} className="text-blue-500" />
              <span className="text-[14px] font-bold text-gray-900">Capacidad del cuarto frío</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                style={{ background: barColor + '20', color: barColor }}>{barLabel}</span>
            </div>
            <span className="text-[11px] text-gray-400">Meta lote ≈ {META_LOTE_KG.toLocaleString('es-CO')} kg</span>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-end justify-between mb-1.5">
              <div>
                <span className="text-[28px] font-bold" style={{ color: barColor }}>{pesoTotal.toFixed(1)}</span>
                <span className="text-[14px] text-gray-400 ml-1.5">/ {META_LOTE_KG.toLocaleString('es-CO')} kg</span>
              </div>
              <span className="text-[14px] font-bold" style={{ color: barColor }}>{pctLote.toFixed(1)}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden mb-1">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pctLote}%`, background: barColor }} />
            </div>
            {pctLote >= 100 && (
              <p className="text-[11px] font-semibold text-green-700">✅ Capacidad para enviar lote grupal</p>
            )}

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl p-3 border border-blue-100 bg-blue-50">
                <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wide mb-1">Confirmado</div>
                <div className="text-[20px] font-bold text-gray-900">{pesoConfirmado.toFixed(1)} <span className="text-sm font-normal text-gray-400">kg</span></div>
                <div className="text-[10px] text-gray-400">{activosCnPeso.length} con báscula · {pctConfirm}% del total</div>
              </div>
              <div className="rounded-xl p-3 border border-amber-100 bg-amber-50">
                <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-1">Estimado</div>
                <div className="text-[20px] font-bold text-gray-900">{pesoEstimado.toFixed(1)} <span className="text-sm font-normal text-gray-400">kg</span></div>
                <div className="text-[10px] text-gray-400">{activosSinPeso.length} sin báscula</div>
              </div>
              <div className="rounded-xl p-3" style={{
                border: `1px solid ${pctLote >= 100 ? '#86EFAC' : '#E5E7EB'}`,
                background: pctLote >= 100 ? '#F0FDF4' : '#F9FAFB',
              }}>
                <div className="text-[10px] font-bold uppercase tracking-wide mb-1"
                  style={{ color: pctLote >= 100 ? '#15803D' : '#6B7280' }}>
                  {pctLote >= 100 ? 'Lote listo' : 'Faltan'}
                </div>
                {pctLote >= 100 ? (
                  <div className="text-[20px] font-bold text-green-700">✅</div>
                ) : (
                  <div className="text-[20px] font-bold text-gray-900">{(META_LOTE_KG - pesoTotal).toFixed(1)} <span className="text-sm font-normal text-gray-400">kg</span></div>
                )}
                <div className="text-[10px] text-gray-400">{activos.length} mascota{activos.length !== 1 ? 's' : ''} activas</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Gestión de neveras ─────────────────────────────────────────────── */}
        <GestionNeveras />

        {/* ── Reportes del técnico ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList size={16} className="text-gray-400" />
            <h2 className="text-[15px] font-bold text-gray-900">Estado del cuarto frío</h2>
            {!reporteHoy && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                ⚠️ Sin reporte hoy
              </span>
            )}
          </div>
          {reportes.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <p className="text-[13px] text-amber-700 font-medium">Sin reportes registrados aún</p>
              <p className="text-[11px] text-amber-600 mt-1">El técnico envía el reporte desde su app en la pestaña "C. Frío".</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reportes.map((r, i) => <ReporteCard key={r.id} reporte={r} defaultOpen={i === 0} />)}
            </div>
          )}
        </div>

        {/* ── Pendientes de ingreso ─────────────────────────────────────────── */}
        {pendientes.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={15} className="text-amber-500" />
              <h2 className="text-[15px] font-bold text-gray-900">Pendientes de ingreso</h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{pendientes.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendientes.map(r => {
                const m = r.servicios?.mascotas
                const c = m?.clientes
                const p = r.servicios?.planes
                const t = r.servicios?.tecnico
                return (
                  <div key={r.id}
                    className="border-2 rounded-2xl p-4 cursor-pointer hover:shadow-md transition-all"
                    style={esAliadoVip(r.servicios)
                      ? { borderColor: VIP_ORO.borde, background: VIP_ORO.bg }
                      : { borderColor: '#FDE68A', background: '#fff' }}
                    onClick={() => verDetalle(r)}>
                    <div className="flex items-start gap-3 mb-3">
                      <span className="text-3xl">{petEmoji(m?.especies?.nombre)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-bold text-gray-900 text-[14px] truncate">{m?.nombre || '—'}</span>
                          {esAliadoVip(r.servicios) && <VipStar />}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">{c?.nombre} {c?.apellido}</div>
                        <div className="text-[11px] text-gray-400 truncate">{p?.nombre}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Pendiente ingreso
                      </span>
                      {canEdit && (
                        <button className="p-1.5 rounded-lg hover:bg-amber-100 text-amber-600 transition-colors"
                          onClick={e => abrirEdicion(r, e)}>
                          <Edit2 size={13} />
                        </button>
                      )}
                    </div>
                    {t && <div className="text-[10px] text-gray-400 mt-1.5">Técnico: {t.nombre} {t.apellido}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Neveras activas ───────────────────────────────────────────────── */}
        {Object.keys(porNevera).length > 0 && (
          <div>
            <h2 className="text-[15px] font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Snowflake size={15} className="text-blue-500" /> Neveras activas
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(porNevera).map(([nevera, items]) => {
                const pesoNev = items.reduce((s, r) => s + parseFloat(r.peso_kg || r.servicios?.mascotas?.peso_kg || 0), 0)
                return (
                  <div key={nevera} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-blue-50/50">
                      <Snowflake size={14} className="text-blue-500" />
                      <span className="font-bold text-gray-900 font-mono">{nevera}</span>
                      <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{items.length}</span>
                      {pesoNev > 0 && <span className="text-[10px] text-gray-400">{pesoNev.toFixed(1)} kg</span>}
                    </div>
                    <div className="p-2 space-y-1.5">
                      {items.map(r => {
                        const m = r.servicios?.mascotas
                        const c = m?.clientes
                        const e = ESTADO_CF[r.estado] || {}
                        return (
                          <div key={r.id}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => verDetalle(r)}>
                            <span className="text-xl leading-none">{petEmoji(m?.especies?.nombre)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-[13px] font-semibold text-gray-900 truncate">{m?.nombre || '—'}</span>
                                {esAliadoVip(r.servicios) && <VipStar size={12} />}
                              </div>
                              <div className="text-[10px] text-gray-400 truncate">{c?.nombre} {c?.apellido}</div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {r.peso_kg && <span className="text-[10px] font-mono text-gray-500">{r.peso_kg}kg</span>}
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                                style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                                {e.label || r.estado}
                              </span>
                              {canEdit && (
                                <button className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
                                  onClick={ev => abrirEdicion(r, ev)}>
                                  <Edit2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Tabla todos los registros ─────────────────────────────────────── */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold text-gray-900 whitespace-nowrap">Todos los registros</h2>
            <div className="relative w-56">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar mascota, nevera, plan…"
                className="w-full pl-8 pr-7 py-2 rounded-xl border border-gray-200 text-[12px] outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all"
              />
              {busqueda && (
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setBusqueda('')}>
                  <X size={12} />
                </button>
              )}
            </div>
            <span className="text-[11px] text-gray-400 font-medium whitespace-nowrap">{registrosFiltrados.length} registros</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Mascota', 'Cliente', 'Plan', 'Nevera', 'Peso', 'Técnico', 'Estado', 'Ingreso a nevera', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {registrosFiltrados.map((r, i) => {
                  const m = r.servicios?.mascotas
                  const c = m?.clientes
                  const p = r.servicios?.planes
                  const e = ESTADO_CF[r.estado] || {}
                  return (
                    <tr key={r.id}
                      className="hover:bg-gray-50/70 cursor-pointer transition-colors"
                      style={{
                        borderBottom: i < registrosFiltrados.length - 1 ? '1px solid #F9FAFB' : 'none',
                        background: esAliadoVip(r.servicios) ? VIP_ORO.bg : undefined,
                      }}
                      onClick={() => verDetalle(r)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl leading-none">{petEmoji(m?.especies?.nombre)}</span>
                          <span className="font-semibold text-gray-900 text-[13px]">{m?.nombre || '—'}</span>
                          {esAliadoVip(r.servicios) && <VipStar size={12} />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-gray-600">{c?.nombre} {c?.apellido}</td>
                      <td className="px-4 py-3 text-[12px] text-gray-500">{p?.nombre}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[12px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg">
                          {r.nevera_codigo || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        {r.peso_kg
                          ? <span className="font-semibold text-blue-700">{r.peso_kg} kg ✓</span>
                          : m?.peso_kg
                            ? <span className="text-amber-600">{m.peso_kg} kg ~</span>
                            : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-gray-500">{nombreTecnico(r)}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                          style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                          {e.label || r.estado?.replace(/_/g,' ')}
                        </span>
                      </td>
                      {/* Hora real de ingreso a la nevera. Las mascotas ingresadas antes de
                          esta mejora no la tienen: se muestra "—" en vez de la fecha de
                          registro del servicio, que no es una hora de ingreso. */}
                      <td className="px-4 py-3 text-[11px] whitespace-nowrap">
                        {r.fecha_ingreso_real
                          ? <span className="text-gray-500 font-medium">{fmtFechaHora(r.fecha_ingreso_real)}</span>
                          : <span className="text-gray-300" title="Ingresó antes de que se registrara la hora">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                          onClick={ev => abrirEdicion(r, ev)}>
                          {canEdit ? 'Editar' : 'Nevera'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {registrosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-gray-400 text-[13px]">
                      {busqueda ? `Sin resultados para "${busqueda}"` : 'Sin registros en el cuarto frío'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Modal edición registro */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={canEdit ? 'Editar registro' : 'Cambiar nevera'}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </>}>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-gray-500 block mb-1">Nevera</label>
              <Input value={form.nevera_codigo} onChange={e => setForm(p => ({ ...p, nevera_codigo: e.target.value }))} placeholder="Ej: N1, N2…" />
            </div>
            {canEdit && (
              <>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1">Peso báscula (kg)</label>
                  <Input type="text" inputMode="decimal" placeholder="Ej: 28.5"
                    value={form.peso_kg} onChange={e => setForm(p => ({ ...p, peso_kg: e.target.value.replace(',', '.') }))} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1">Estado</label>
                  <Select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))}>
                    <option value="PENDIENTE_INGRESO">Pendiente ingreso</option>
                    <option value="REFRIGERADO">Refrigerado</option>
                    <option value="EN_ESPERA_PROCESO">En espera proceso</option>
                    <option value="TRASLADADO">Trasladado</option>
                    <option value="RETIRADO">Retirado</option>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1">Notas</label>
                  <Textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Modal detalle */}
      {detalle && (
        <DetalleModal
          registro={detalle}
          onClose={() => { setDetalle(null); setMovimientos([]) }}
          onEdit={canEdit ? r => { setDetalle(null); abrirEdicion(r) } : null}
          movimientos={movimientos}
        />
      )}
    </div>
  )
}
