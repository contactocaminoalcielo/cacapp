// Pestaña "Lotes" dentro de Certificados: maneja los lotes grupales en proceso
// (ABIERTO / ENVIADO) sin salir del módulo. Permite "Cerrar y enviar" (a la entidad)
// y "Completado" (genera el reporte y lo deja en Pendientes). Es la mitad física del
// flujo grupal traída a Certificados para no andar entre dos módulos.
import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { petEmoji, today, parsearErrorDB } from '@/lib/utils'
import { registrarSalidaCuartoFrio } from '@/lib/cuartoFrio'
import { sincronizar } from '@/lib/reportesGrupales'
import { Send, CheckCircle2, RefreshCw, PackageOpen, ChevronDown, ChevronUp } from 'lucide-react'

const TIPO = {
  CREMACION_GRUPAL:  { label: 'Cremación Grupal',  emoji: '🔥', color: '#B45309', bg: '#FEF3C7' },
  COMPOSTAJE_GRUPAL: { label: 'Compostaje Grupal', emoji: '🌿', color: '#065F46', bg: '#D1FAE5' },
}
const ESTADO = {
  ABIERTO: { label: 'Abierto', color: '#1D4ED8', bg: '#DBEAFE' },
  ENVIADO: { label: 'Enviado a entidad', color: '#B45309', bg: '#FEF3C7' },
}

function fmtFecha(s) {
  if (!s) return '-'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function LoteCard({ lote, mascotas, esCoord, saving, onCerrar, onCompletar }) {
  const [open, setOpen] = useState(true)
  const cfg  = TIPO[lote.tipo_proceso] || TIPO.CREMACION_GRUPAL
  const eCfg = ESTADO[lote.estado] || {}

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
      <button className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 text-left" onClick={() => setOpen(o => !o)}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: cfg.bg }}>{cfg.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-gray-900">{lote.numero_lote}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: eCfg.bg, color: eCfg.color }}>{eCfg.label}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {mascotas.length} mascota{mascotas.length !== 1 ? 's' : ''}
            {lote.fecha_envio && ` · Enviado ${fmtFecha(lote.fecha_envio)}`}
          </p>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-3" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          {esCoord && (
            <div className="flex flex-wrap gap-2">
              {lote.estado === 'ABIERTO' && (
                <Button size="sm" variant="gold" disabled={saving} onClick={() => onCerrar(lote)}>
                  <Send size={13} /> Cerrar y enviar a entidad
                </Button>
              )}
              {lote.estado === 'ENVIADO' && (
                <Button size="sm" disabled={saving} onClick={() => onCompletar(lote)}
                  style={{ background: '#16A34A', color: 'white' }}>
                  <CheckCircle2 size={13} /> Marcar Completado (genera reporte)
                </Button>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            {mascotas.length ? mascotas.map(m => (
              <div key={m.servicio_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-white" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                <span className="text-lg">{petEmoji(m.especie)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-gray-900">{m.mascota}</span>
                  <span className="text-[11px] text-gray-500 ml-2">{m.cliente}</span>
                </div>
                <span className="text-[10px] text-gray-400">{m.estado}</span>
              </div>
            )) : <p className="text-[12px] text-gray-400 text-center py-2">Sin mascotas asignadas.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LotesTab({ onChanged, onGoPendientes }) {
  const { personalData } = useAuth()
  const { confirm, alert: showAlert } = useConfirm()
  const [lotes, setLotes]   = useState([])
  const [svcs, setSvcs]     = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cerrarId, setCerrarId] = useState(null)
  const [obs, setObs]       = useState('')
  const [duracion, setDuracion] = useState('')

  const esCoord = ['COORDINADOR', 'ADMIN'].includes(personalData?.rol)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const { data: ls } = await db.from('lotes_grupales')
        .select('*').in('estado', ['ABIERTO', 'ENVIADO']).order('created_at', { ascending: false })
      const lista = ls || []
      setLotes(lista)

      const ids = lista.map(l => l.id)
      let map = {}
      if (ids.length) {
        const { data: s } = await db.from('servicios')
          .select('id, lote_id, estado, mascotas(nombre, especie_id, especies(nombre), clientes(nombre, apellido))')
          .in('lote_id', ids)
          .gte('fecha_ingreso', FECHA_CORTE)
        ;(s || []).forEach(x => {
          const m = x.mascotas, c = m?.clientes
          if (!map[x.lote_id]) map[x.lote_id] = []
          map[x.lote_id].push({
            servicio_id: x.id, estado: x.estado,
            mascota: m?.nombre || '-', especie: m?.especies?.nombre || '-',
            cliente: `${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '-',
          })
        })
      }
      setSvcs(map)
    } catch (e) { console.error('Error cargando lotes:', e) } finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function doCerrar() {
    const loteId = cerrarId
    if (!loteId) return
    setSaving(true); setCerrarId(null)
    try {
      await db.from('lotes_grupales')
        .update({ estado: 'ENVIADO', fecha_envio: today(), observaciones: obs || null, ...(duracion ? { duracion_proceso: duracion } : {}) })
        .eq('id', loteId)
      const ids = (svcs[loteId] || []).map(s => s.servicio_id)
      await registrarSalidaCuartoFrio(ids, { personalId: personalData?.id, tipo: 'SALIDA_LOTE_GRUPAL', motivo: 'Lote grupal enviado a proceso' })
      setObs(''); setDuracion('')
      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al cerrar lote' })
    } finally { setSaving(false) }
  }

  async function doCompletar(lote) {
    if (!await confirm('Las mascotas del lote pasarán a EN PRODUCCIÓN y se generará el reporte para enviar los certificados.',
      { title: '¿Marcar lote como completado?', confirmLabel: 'Completado' })) return
    setSaving(true)
    try {
      await db.from('lotes_grupales').update({ estado: 'COMPLETADO', fecha_completado: today() }).eq('id', lote.id)
      await db.from('servicios').update({ estado: 'EN_PRODUCCION' })
        .eq('lote_id', lote.id).not('estado', 'in', '(EN_PRODUCCION,LISTO,EN_ENTREGA,ENTREGADO,CANCELADO)')
      try { await sincronizar() } catch (e) { console.warn('sincronizar:', e.message) }  // genera el reporte ya
      await cargar()
      if (onChanged) await onChanged()
      await showAlert(`Lote ${lote.numero_lote} completado. El reporte ya está en Pendientes para enviar.`, { title: 'Listo' })
      if (onGoPendientes) onGoPendientes()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al completar' })
    } finally { setSaving(false) }
  }

  const loteCerrar = cerrarId ? lotes.find(l => l.id === cerrarId) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-500">
          Lotes en proceso. <strong>Cerrar y enviar</strong> = mandar a la entidad · <strong>Completado</strong> = listo, genera el reporte.
        </p>
        <button onClick={cargar} disabled={loading} className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-600">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-400 text-[13px]">Cargando...</div>}

      {!loading && lotes.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
          <PackageOpen size={30} className="mx-auto mb-2 text-gray-300" />
          <p className="font-semibold text-gray-600">No hay lotes en proceso</p>
          <p className="text-[12px] text-gray-400 mt-1">Los lotes se arman solos a diario con las mascotas que vencen, o desde Control con "Agregar a lote".</p>
        </div>
      )}

      {!loading && lotes.map(l => (
        <LoteCard key={l.id} lote={l} mascotas={svcs[l.id] || []} esCoord={esCoord} saving={saving}
          onCerrar={(lote) => setCerrarId(lote.id)} onCompletar={doCompletar} />
      ))}

      {/* Modal: cerrar y enviar */}
      {loteCerrar && (
        <Modal open onClose={() => setCerrarId(null)} title={`Cerrar y enviar — ${loteCerrar.numero_lote}`}>
          <div className="space-y-4">
            <div className="rounded-xl p-4 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              Se registra el envío del lote a la entidad ({fmtFecha(today())}) y las mascotas salen del cuarto frío.
              Cuando vuelvan procesadas, marca el lote como <strong>Completado</strong>.
            </div>
            {loteCerrar.tipo_proceso === 'CREMACION_GRUPAL' && (
              <div>
                <label className="block text-[12px] font-medium text-gray-600 mb-1">Duración de la cremación <span className="text-gray-400">(para el reporte)</span></label>
                <input type="text" value={duracion} onChange={e => setDuracion(e.target.value)}
                  placeholder="Ej: 6 horas y 18 minutos"
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]" />
              </div>
            )}
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">Observaciones (opcional)</label>
              <Textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
                placeholder="Ej: Recibido por Juan en la entidad, guía N° 12345..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCerrarId(null)}>Cancelar</Button>
              <Button variant="gold" onClick={doCerrar} disabled={saving}>
                <Send size={13} /> {saving ? 'Guardando...' : 'Confirmar envío'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
