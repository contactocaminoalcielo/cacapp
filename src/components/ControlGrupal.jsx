// Tabla de control de servicios elegibles para certificado grupal.
// Muestra TODOS los servicios de plan grupal (cualquier estado) con su lote y
// estado de reporte, y permite agregar manualmente uno a un lote (útil para
// servicios atrasados). El "Agregar a lote" usa el lote ABIERTO de su tipo o
// crea uno nuevo. Vive dentro del módulo Certificados.
import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { petEmoji, today, parsearErrorDB } from '@/lib/utils'
import { Flame, Leaf, RefreshCw, PackagePlus, CheckCircle2, AlertTriangle } from 'lucide-react'

const TIPO = {
  CREMACION_GRUPAL:  { label: 'Cremación',  emoji: '🔥', color: '#B45309', bg: '#FEF3C7' },
  COMPOSTAJE_GRUPAL: { label: 'Eco-grupal', emoji: '🌿', color: '#065F46', bg: '#D1FAE5' },
}

function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}
function diasDesde(fecha) {
  if (!fecha) return 0
  return Math.floor((Date.now() - new Date(fecha + 'T12:00:00').getTime()) / 86400000)
}

export default function ControlGrupal() {
  const { personalData } = useAuth()
  const { confirm, alert: showAlert } = useConfirm()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [filtro, setFiltro]   = useState('todos')  // todos | sin_lote | en_lote | enviados

  const esCoord = ['COORDINADOR', 'ADMIN'].includes(personalData?.rol)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Planes grupales → ids
      const { data: planesG } = await db.from('planes')
        .select('id').in('tipo_proceso', ['CREMACION_GRUPAL', 'COMPOSTAJE_GRUPAL'])
      const planIds = (planesG || []).map(p => p.id)
      if (!planIds.length) { setRows([]); setLoading(false); return }

      // 2. Servicios de esos planes (cualquier estado, incluso entregados)
      const { data: svcs } = await db
        .from('servicios')
        .select('id, lote_id, estado, fecha_ingreso, plan_id, planes(nombre, codigo, tipo_proceso), mascotas(nombre, especie_id, especies(nombre), clientes(nombre, apellido, whatsapp))')
        .in('plan_id', planIds)
        .order('fecha_ingreso', { ascending: true })

      const lista = svcs || []

      // 2. Lotes referenciados
      const loteIds = [...new Set(lista.map(s => s.lote_id).filter(Boolean))]
      let loteMap = {}
      if (loteIds.length) {
        const { data: lotes } = await db.from('lotes_grupales')
          .select('id, numero_lote, estado, tipo_proceso').in('id', loteIds)
        ;(lotes || []).forEach(l => { loteMap[l.id] = l })
      }

      // 3. Estado de reporte por servicio
      const svcIds = lista.map(s => s.id)
      let repMap = {}
      if (svcIds.length) {
        const { data: items } = await db.from('reportes_grupales_items')
          .select('servicio_id, estado').in('servicio_id', svcIds)
        ;(items || []).forEach(i => { repMap[i.servicio_id] = i.estado })
      }

      setRows(lista.map(s => {
        const m = s.mascotas, c = m?.clientes
        return {
          servicio_id: s.id,
          lote_id:     s.lote_id,
          estado:      s.estado,
          fecha_ingreso: s.fecha_ingreso,
          mascota:     m?.nombre || '-',
          especie:     m?.especies?.nombre || '-',
          cliente:     `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
          whatsapp:    c?.whatsapp || null,
          plan:        s.planes?.nombre || '-',
          tipo_proceso: s.planes?.tipo_proceso,
          lote:        s.lote_id ? loteMap[s.lote_id] : null,
          reporte_estado: repMap[s.id] || null,
        }
      }))
    } catch (e) {
      console.error('Error cargando control grupal:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Agregar a lote (abierto del tipo, o crear uno) ──────────────────────────
  async function agregarALote(svc) {
    if (!esCoord) return
    const cfg = TIPO[svc.tipo_proceso]
    if (!await confirm(`Se agregará ${svc.mascota} al lote abierto de ${cfg?.label || 'su tipo'} (se crea uno si no existe).`,
      { title: '¿Agregar a lote?', confirmLabel: 'Agregar' })) return
    setSavingId(svc.servicio_id)
    try {
      // 1. lote ABIERTO del tipo
      const { data: abiertos } = await db.from('lotes_grupales')
        .select('*').eq('estado', 'ABIERTO').eq('tipo_proceso', svc.tipo_proceso)
        .order('created_at', { ascending: false }).limit(1)
      let lote = abiertos?.[0]

      // 2. crear si no hay
      if (!lote) {
        const { count } = await db.from('lotes_grupales').select('id', { count: 'exact', head: true })
        const numero_lote = `L-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(3, '0')}`
        const { data: nuevo, error } = await db.from('lotes_grupales').insert({
          numero_lote, tipo_proceso: svc.tipo_proceso, fecha_proceso: today(),
          estado: 'ABIERTO', cantidad_mascotas: 0, coordinador_id: personalData?.id || null,
          entidad_externa: 'Entidad certificada Bogotá',
        }).select().single()
        if (error) throw error
        lote = nuevo
      }

      // 3. asignar servicio + actualizar conteo del lote
      const { error: upErr } = await db.from('servicios').update({ lote_id: lote.id }).eq('id', svc.servicio_id)
      if (upErr) throw upErr
      const { count: cant } = await db.from('servicios').select('id', { count: 'exact', head: true }).eq('lote_id', lote.id)
      await db.from('lotes_grupales').update({ cantidad_mascotas: cant || 0 }).eq('id', lote.id)

      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al agregar a lote' })
    } finally {
      setSavingId(null)
    }
  }

  // ── Filtros ──────────────────────────────────────────────────────────────────
  const filtrados = rows.filter(r => {
    if (filtro === 'sin_lote')  return !r.lote_id
    if (filtro === 'en_lote')   return !!r.lote_id && !['ENVIADO', 'REENVIADO'].includes(r.reporte_estado)
    if (filtro === 'enviados')  return ['ENVIADO', 'REENVIADO'].includes(r.reporte_estado)
    return true
  })
  const cont = {
    todos:    rows.length,
    sin_lote: rows.filter(r => !r.lote_id).length,
    en_lote:  rows.filter(r => !!r.lote_id && !['ENVIADO', 'REENVIADO'].includes(r.reporte_estado)).length,
    enviados: rows.filter(r => ['ENVIADO', 'REENVIADO'].includes(r.reporte_estado)).length,
  }
  const FILTROS = [
    { id: 'todos',    label: 'Todos' },
    { id: 'sin_lote', label: 'Sin lote' },
    { id: 'en_lote',  label: 'En lote' },
    { id: 'enviados', label: 'Enviados' },
  ]

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTROS.map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all"
            style={{
              background: filtro === f.id ? '#1A5CD8' : 'white',
              color: filtro === f.id ? 'white' : '#374151',
              borderColor: filtro === f.id ? '#1A5CD8' : '#D1D5DB',
            }}>
            {f.label} <span className="opacity-70">({cont[f.id]})</span>
          </button>
        ))}
        <button onClick={cargar} disabled={loading}
          className="ml-auto px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-[13px]">Cargando...</div>}

      {!loading && filtrados.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
          <p className="text-[13px] text-gray-500">Sin servicios en este filtro.</p>
        </div>
      )}

      {!loading && filtrados.length > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm overflow-x-auto" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              <tr>{['Mascota', 'Cliente', 'Tipo', 'Plan', 'Ingreso', 'Días', 'Estado', 'Lote', 'Reporte', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 font-semibold text-gray-500 text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtrados.map(r => {
                const cfg  = TIPO[r.tipo_proceso] || {}
                const dias = diasDesde(r.fecha_ingreso)
                const enviado = ['ENVIADO', 'REENVIADO'].includes(r.reporte_estado)
                const vencido = r.reporte_estado === 'VENCIDO'
                return (
                  <tr key={r.servicio_id} className="border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span>{petEmoji(r.especie)}</span>
                        <span className="font-semibold text-gray-900 whitespace-nowrap">{r.mascota}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.cliente}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: cfg.bg, color: cfg.color }}>
                        {cfg.emoji} {cfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.plan}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(r.fecha_ingreso)}</td>
                    <td className="px-3 py-2.5">
                      <span style={{ color: dias >= 7 ? '#DC2626' : '#6B7280', fontWeight: dias >= 7 ? 600 : 400 }}>{dias}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.estado}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.lote
                        ? <span className="text-gray-700">{r.lote.numero_lote} <span className="text-gray-400">· {r.lote.estado}</span></span>
                        : <span className="text-amber-600 font-medium">Sin lote</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {enviado
                        ? <span className="flex items-center gap-1 text-green-700 font-medium"><CheckCircle2 size={11} /> Enviado</span>
                        : vencido
                          ? <span className="flex items-center gap-1 text-red-700 font-medium"><AlertTriangle size={11} /> Vencido</span>
                          : <span className="text-gray-400">{r.reporte_estado || '—'}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {esCoord && !r.lote_id && (
                        <Button size="sm" variant="secondary" disabled={savingId === r.servicio_id}
                          onClick={() => agregarALote(r)}>
                          <PackagePlus size={12} /> {savingId === r.servicio_id ? '...' : 'Agregar a lote'}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
