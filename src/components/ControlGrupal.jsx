// Tabla de control de servicios elegibles para certificado grupal.
// Muestra TODOS los servicios de plan grupal (cualquier estado, incluso entregados)
// con su lote, estado de reporte y SEMÁFORO de días para vencer. Permite agregar
// manualmente uno a un lote (útil para atrasados), buscar, filtrar por tipo/estado/fechas,
// y pedirle a la IA una alerta de vencimientos. Vive dentro del módulo Certificados.
import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { petEmoji, today, parsearErrorDB, addDiasHabiles } from '@/lib/utils'
import { agregarServicioALote, alertaControlIA } from '@/lib/reportesGrupales'
import { RefreshCw, PackagePlus, CheckCircle2, AlertTriangle, Search, Sparkles, Clock } from 'lucide-react'

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
function diasHasta(iso) {
  if (!iso) return null
  return Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(today() + 'T12:00:00').getTime()) / 86400000)
}

// Semáforo de días para vencer (3er día hábil desde el ingreso)
function Semaforo({ dias, enviado }) {
  if (enviado) return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: '#D1FAE5', color: '#065F46' }}>
      <CheckCircle2 size={9} /> Enviado
    </span>
  )
  if (dias === null) return <span className="text-gray-300">—</span>
  let bg, color, label
  if (dias < 0)       { bg = '#FEE2E2'; color = '#B91C1C'; label = `Vencido (${Math.abs(dias)}d)` }
  else if (dias === 0){ bg = '#FEE2E2'; color = '#B91C1C'; label = 'Vence hoy' }
  else if (dias === 1){ bg = '#FFEDD5'; color = '#C2410C'; label = 'Mañana' }
  else if (dias <= 3) { bg = '#FEF9C3'; color = '#A16207'; label = `${dias} días` }
  else                { bg = '#DCFCE7'; color = '#15803D'; label = `${dias} días` }
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: bg, color }}>
      <Clock size={9} /> {label}
    </span>
  )
}

export default function ControlGrupal({ onChanged, onGoPendientes }) {
  const { personalData } = useAuth()
  const { confirm, alert: showAlert } = useConfirm()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [filtro, setFiltro]   = useState('todos')  // todos | sin_lote | en_lote | enviados
  const [tipoF, setTipoF]     = useState('todos')  // todos | CREMACION_GRUPAL | COMPOSTAJE_GRUPAL
  const [q, setQ]             = useState('')
  const [desde, setDesde]     = useState('')
  const [hasta, setHasta]     = useState('')
  const [iaTexto, setIaTexto] = useState('')
  const [iaLoading, setIaLoading] = useState(false)

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

      // 3. Lotes referenciados
      const loteIds = [...new Set(lista.map(s => s.lote_id).filter(Boolean))]
      let loteMap = {}
      if (loteIds.length) {
        const { data: lotes } = await db.from('lotes_grupales')
          .select('id, numero_lote, estado, tipo_proceso').in('id', loteIds)
        ;(lotes || []).forEach(l => { loteMap[l.id] = l })
      }

      // 4. Reporte (estado + vencimiento) por servicio
      const svcIds = lista.map(s => s.id)
      let repMap = {}
      if (svcIds.length) {
        const { data: items } = await db.from('reportes_grupales_items')
          .select('servicio_id, estado, fecha_vencimiento').in('servicio_id', svcIds)
        ;(items || []).forEach(i => { repMap[i.servicio_id] = i })
      }

      setRows(lista.map(s => {
        const m = s.mascotas, c = m?.clientes
        const rep = repMap[s.id]
        return {
          servicio_id: s.id,
          lote_id:     s.lote_id,
          estado:      s.estado,
          fecha_ingreso: (s.fecha_ingreso || '').slice(0, 10),
          mascota:     m?.nombre || '-',
          especie:     m?.especies?.nombre || '-',
          cliente:     `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
          whatsapp:    c?.whatsapp || null,
          plan:        s.planes?.nombre || '-',
          tipo_proceso: s.planes?.tipo_proceso,
          lote:        s.lote_id ? loteMap[s.lote_id] : null,
          reporte_estado: rep?.estado || null,
          // Vencimiento: el del reporte (con festivos, backend) o estimado +3 días hábiles
          vence:       rep?.fecha_vencimiento || (s.fecha_ingreso ? addDiasHabiles((s.fecha_ingreso || '').slice(0, 10), 3) : null),
        }
      }))
    } catch (e) {
      console.error('Error cargando control grupal:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Agregar a lote reportable y dejar reporte en Pendientes ─────────────────
  async function agregarALote(svc) {
    if (!esCoord) return
    const cfgReporte = TIPO[svc.tipo_proceso]
    if (!await confirm(`Se agregara ${svc.mascota} a un lote reportable de ${cfgReporte?.label || 'su tipo'} y se creara el reporte pendiente si aplica.`,
      { title: 'Agregar a lote de reporte', confirmLabel: 'Agregar' })) return
    setSavingId(svc.servicio_id)
    try {
      const r = await agregarServicioALote(svc.servicio_id)
      await cargar()
      if (onChanged) await onChanged()
      if (onGoPendientes) onGoPendientes()
      const texto = r.ya_en_reporte
        ? `${svc.mascota} ya estaba en el reporte del lote ${r.numero_lote}.`
        : `${svc.mascota} quedo en el lote ${r.numero_lote}. El reporte ya esta en Pendientes.`
      await showAlert(texto, { title: 'Reporte pendiente listo' })
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al agregar a lote' })
    } finally {
      setSavingId(null)
    }
  }

  async function handleIA() {
    setIaLoading(true)
    try { const r = await alertaControlIA(); setIaTexto(r.alerta || '') }
    catch (e) { await showAlert(e.message, { title: 'Error del asistente IA' }) }
    finally { setIaLoading(false) }
  }

  // ── Alerta determinista (semáforo global) ───────────────────────────────────
  const activos = rows
    .filter(r => !['ENVIADO', 'REENVIADO'].includes(r.reporte_estado) && r.estado !== 'ENTREGADO')
    .map(r => ({ ...r, dias: diasHasta(r.vence) }))
  const nVencidos = activos.filter(r => r.dias !== null && r.dias < 0).length
  const nHoy      = activos.filter(r => r.dias === 0).length
  const nManana   = activos.filter(r => r.dias === 1).length

  // ── Filtros ──────────────────────────────────────────────────────────────────
  const ql = q.trim().toLowerCase()
  const filtrados = rows.filter(r => {
    if (tipoF !== 'todos' && r.tipo_proceso !== tipoF) return false
    if (desde && r.fecha_ingreso && r.fecha_ingreso < desde) return false
    if (hasta && r.fecha_ingreso && r.fecha_ingreso > hasta) return false
    if (ql && !`${r.mascota} ${r.cliente} ${r.plan} ${r.lote?.numero_lote || ''} ${r.estado}`.toLowerCase().includes(ql)) return false
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
  const TIPOS_F = [
    { id: 'todos',             label: 'Todos los tipos' },
    { id: 'CREMACION_GRUPAL',  label: '🔥 Cremación' },
    { id: 'COMPOSTAJE_GRUPAL', label: '🌿 Eco-grupal' },
  ]

  return (
    <div className="space-y-4">
      {/* Asistente IA de vencimientos + alerta determinista */}
      <div className="rounded-xl border p-4" style={{ background: '#F5F3FF', borderColor: '#C4B5FD' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles size={16} className="text-violet-600" />
            <span className="text-[12px] font-semibold text-violet-800">Asistente ORBIT — vencimientos</span>
            {nVencidos > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{nVencidos} vencido{nVencidos !== 1 ? 's' : ''}</span>}
            {nHoy > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#B91C1C' }}>{nHoy} vence{nHoy !== 1 ? 'n' : ''} hoy</span>}
            {nManana > 0 && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FFEDD5', color: '#C2410C' }}>{nManana} mañana</span>}
          </div>
          <Button size="sm" variant="secondary" onClick={handleIA} disabled={iaLoading}>
            <Sparkles size={12} className={iaLoading ? 'animate-pulse' : ''} /> {iaLoading ? 'Analizando…' : 'Generar alerta'}
          </Button>
        </div>
        {iaTexto && <p className="text-[12px] text-gray-700 mt-3 whitespace-pre-wrap leading-relaxed">{iaTexto}</p>}
      </div>

      {/* Búsqueda + tipo + fechas */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Buscar mascota, cliente, plan, lote..."
            className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]" />
        </div>
        {TIPOS_F.map(t => (
          <button key={t.id} onClick={() => setTipoF(t.id)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all"
            style={{
              background: tipoF === t.id ? '#263218' : 'white',
              color: tipoF === t.id ? 'white' : '#374151',
              borderColor: tipoF === t.id ? '#263218' : '#D1D5DB',
            }}>
            {t.label}
          </button>
        ))}
        <button onClick={cargar} disabled={loading}
          className="ml-auto px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Rango de fechas de ingreso */}
      <div className="flex items-center gap-2 flex-wrap text-[12px] text-gray-500">
        <span>Ingreso desde</span>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
          className="px-2 py-1 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]" />
        <span>hasta</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
          className="px-2 py-1 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]" />
        {(desde || hasta) && (
          <button onClick={() => { setDesde(''); setHasta('') }} className="text-[11px] text-gray-400 hover:text-gray-600 underline">limpiar fechas</button>
        )}
      </div>

      {/* Filtros de estado */}
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
        <span className="ml-auto text-[11px] text-gray-400">{filtrados.length} de {rows.length}</span>
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
              <tr>{['Mascota', 'Cliente', 'Tipo', 'Plan', 'Ingreso', 'Días sist.', 'Vence', 'Estado', 'Lote', 'Reporte', ''].map(h => (
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
                    <td className="px-3 py-2.5"><Semaforo dias={diasHasta(r.vence)} enviado={enviado} /></td>
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
