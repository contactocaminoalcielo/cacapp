// Compras de recordatorios SIN servicio dentro del tablero de Producción.
//
// Las líneas de una compra (migración 168) no son `servicio_recordatorios`:
// viven en `compra_recordatorio_items` y no tienen servicio. Meterlas al
// mismo array del tablero rompería `autoCorregirEstados` (agrupa por
// servicio_id y hace UPDATE a `servicios` con esa clave). Por eso son una
// sección aparte, con su propia carga, su propio realtime y su propio modal,
// que ESCRIBE POR EL BACKEND (toda escritura de una compra pasa por ahí).
//
// Se pinta solo cuando hay algo que producir: sin compras, el tablero se ve
// exactamente como antes.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/contexts/ConfirmContext'
import { db, dbTodo } from '@/lib/supabase'
import { agruparRefresco } from '@/lib/realtime'
import { petEmoji } from '@/lib/utils'
import { actualizarItem, ESTADOS_ITEM, ESTADO_ITEM_META } from '@/lib/comprasRecordatorios'
import { ShoppingBag, ExternalLink, Zap, Lock } from 'lucide-react'

const initials = p => p ? `${(p.nombre || '')[0] || ''}${(p.apellido || '')[0] || ''}`.toUpperCase() : '?'

/** Lo que el tablero necesita de cada línea, con su compra, mascota y cliente. */
export async function cargarItemsCompras() {
  return dbTodo(() => db.from('compra_recordatorio_items')
    .select(`id, compra_id, recordatorio_id, nombre, cantidad, estado, asignado_a, notas,
             imagenes_urls, fecha_inicio_prod, fecha_fin_prod, created_at,
             recordatorios ( id, nombre, requiere_imagen, solo_nombre, tiempo_produccion_dias ),
             compras_recordatorios!inner ( id, numero, created_at, anulada_en,
               mascotas ( nombre, especies ( nombre ) ),
               clientes ( nombre, apellido, whatsapp ) )`)
    .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
    .is('compras_recordatorios.anulada_en', null)
    .order('created_at', { ascending: true })
    .order('id'))
}

export default function ComprasEnProduccion({ filtroEstado = 'todos', filtroPersona = '', personal = [], onCambio }) {
  const { alert: showAlert } = useConfirm()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(null)

  async function cargar() {
    try { setItems(await cargarItemsCompras() || []) }
    catch (e) { console.error('Compras en producción:', e.message) }   // no tumba el tablero
  }

  useEffect(() => {
    cargar()
    const refrescar = agruparRefresco(cargar)
    const canal = db.channel('produccion-compras')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compra_recordatorio_items' }, refrescar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'compras_recordatorios' }, refrescar)
      .subscribe()
    return () => { refrescar.cancelar(); db.removeChannel(canal) }
  }, [])

  const compras = useMemo(() => {
    const filtrados = items.filter(r => {
      if (filtroPersona && r.asignado_a !== filtroPersona) return false
      if (filtroEstado === 'pendientes') return r.estado === 'PENDIENTE'
      if (filtroEstado === 'en_proceso') return r.estado === 'EN_PROCESO'
      if (filtroEstado === 'listos')     return r.estado === 'LISTO'
      return true
    })
    const por = {}
    for (const r of filtrados) {
      const c = r.compras_recordatorios
      if (!por[c.id]) por[c.id] = { compra: c, items: [] }
      por[c.id].items.push(r)
    }
    return Object.values(por)
  }, [items, filtroEstado, filtroPersona])

  if (!compras.length) return null

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
        <ShoppingBag size={12} /> Compras de recordatorios · sin servicio
        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{compras.length}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {compras.map(({ compra, items: its }) => {
          const listos = its.filter(i => i.estado === 'LISTO').length
          const todoListo = listos === its.length
          return (
            <div key={compra.id} className="bg-white rounded-xl border p-3 shadow-sm"
              style={{ borderColor: todoListo ? '#6EE7B7' : '#F3E8FF', borderLeft: '4px solid #7C3AED' }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-bold text-gray-900 text-[13px] truncate">
                    {petEmoji(compra.mascotas?.especies?.nombre)} {compra.mascotas?.nombre || 'Mascota'}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {compra.clientes?.nombre} {compra.clientes?.apellido} · CR-{compra.numero}
                  </div>
                </div>
                <button onClick={() => navigate(`/compras-recordatorios?ver=${compra.id}`)}
                  className="text-[10px] font-bold text-[#7C3AED] hover:underline flex items-center gap-1 flex-shrink-0" title="Abrir la compra">
                  Compra <ExternalLink size={10} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {its.map(it => {
                  const m = ESTADO_ITEM_META[it.estado] || ESTADO_ITEM_META.PENDIENTE
                  const rec = it.recordatorios
                  const necesitaFoto = rec?.requiere_imagen && !rec?.solo_nombre && !(it.imagenes_urls || []).length
                  const asig = personal.find(p => p.id === it.asignado_a)
                  return (
                    <button key={it.id} onClick={() => setModal(it)}
                      title={necesitaFoto ? 'Sin foto todavía: se adjunta en la compra' : 'Click para gestionar'}
                      style={{ background: m.bg, color: m.text, border: `1.5px solid ${m.border}`, borderRadius: 20,
                               padding: '5px 10px', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {necesitaFoto ? <Lock size={10} /> : rec?.solo_nombre ? <Zap size={10} style={{ color: '#059669' }} /> : null}
                      <span>{it.nombre}{it.cantidad > 1 ? ` ×${it.cantidad}` : ''}</span>
                      {asig && (
                        <span style={{ background: 'rgba(0,0,0,0.12)', borderRadius: '50%', width: 16, height: 16, fontSize: 8, fontWeight: 800,
                                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(asig)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-[10px] text-gray-400">
                {listos}/{its.length} listos{todoListo && ' · lista para entregar: se marca ENTREGADO desde la compra'}
              </div>
            </div>
          )
        })}
      </div>

      {modal && (
        <ModalItemCompra item={modal} personal={personal} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar(); onCambio?.() }} showAlert={showAlert} />
      )}
    </div>
  )
}

function ModalItemCompra({ item, personal, onClose, onSaved, showAlert }) {
  const [estado, setEstado]     = useState(item.estado)
  const [asignado, setAsignado] = useState(item.asignado_a || '')
  const [notas, setNotas]       = useState(item.notas || '')
  const [saving, setSaving]     = useState(false)
  const c = item.compras_recordatorios

  async function guardar() {
    setSaving(true)
    try {
      await actualizarItem(item.compra_id, item.id, { estado, asignado_a: asignado || null, notas })
      onSaved()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={`${item.nombre} · ${c?.mascotas?.nombre || ''} (CR-${c?.numero})`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Estado</label>
          <div className="flex gap-1.5 flex-wrap">
            {ESTADOS_ITEM.filter(e => e.valor !== 'ENTREGADO').map(e => (
              <button key={e.valor} onClick={() => setEstado(e.valor)}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold"
                style={e.valor === estado
                  ? { background: e.bg, color: e.text, border: `1.5px solid ${e.border}` }
                  : { background: '#fff', color: '#9CA3AF', border: '1.5px solid #E5E7EB' }}>
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">La entrega se marca desde la compra, no desde aquí.</p>
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Asignado a</label>
          <Select value={asignado} onChange={e => setAsignado(e.target.value)}>
            <option value="">Sin asignar</option>
            {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido || ''}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Notas de producción</label>
          <Textarea rows={3} value={notas} onChange={e => setNotas(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
