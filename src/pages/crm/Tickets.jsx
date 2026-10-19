import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, Search, X, Phone, MessageCircle, CalendarPlus } from 'lucide-react'
import {
  crm, TICKET_ESTADOS, TICKET_CATEGORIAS, TICKET_TIPOS, PRIORIDADES, fechaHora, relativo, telHref, waHref, fechaCorta,
} from '@/lib/crmApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { Cabecera, Cargando, ErrorCaja, PrioridadChip, EstadoTicketChip, Chip, Campo, ACENTO } from '@/components/crm/ui'
import { TicketModal, SeguimientoModal } from '@/components/crm/Modales'
import { useCrm } from '@/components/crm/CrmContext'

export default function Tickets() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { refrescarAlertas } = useCrm()
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [categoria, setCategoria] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [verCerrados, setVerCerrados] = useState(false)
  const [cerrar, setCerrar] = useState(null)          // { ticket, estado }
  const arrastrando = useRef(null)

  const cargar = useCallback(() => { setError(null); crm.tickets().then(r => setLista(r.tickets || [])).catch(e => setError(e.message)) }, [])
  useEffect(cargar, [cargar])

  const filtrados = useMemo(() => (lista || []).filter(t => {
    if (categoria && t.categoria !== categoria) return false
    const s = q.trim().toLowerCase()
    if (s && ![t.asunto, t.aliado_nombre, String(t.numero)].some(x => (x || '').toLowerCase().includes(s))) return false
    return true
  }), [lista, q, categoria])

  const estados = TICKET_ESTADOS.filter(e => verCerrados || e.clave !== 'CERRADO')

  async function soltar(estado) {
    const t = arrastrando.current
    arrastrando.current = null
    if (!t || t.estado === estado) return
    if (['RESUELTO', 'CERRADO'].includes(estado) && !t.solucion) { setCerrar({ ticket: t, estado }); return }
    setLista(l => l.map(x => (x.id === t.id ? { ...x, estado } : x)))
    await crm.cambiarTicket(t.id, { estado }).catch(e => { setError(e.message); cargar() })
    refrescarAlertas()
  }

  if (error && !lista) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!lista) return <Cargando />

  const abiertos = lista.filter(t => !['RESUELTO', 'CERRADO'].includes(t.estado))
  const vencidos = abiertos.filter(t => t.vence_en && new Date(t.vence_en) < new Date()).length

  return (
    <div className="max-w-[1600px] mx-auto">
      <Cabecera titulo="Tickets y PQRS de veterinarias" sub={`${abiertos.length} abiertos · ${vencidos} fuera de plazo. Todo lo que nos manifiestan los aliados, con seguimiento hasta cerrarlo.`}>
        <Button onClick={() => setNuevo(true)} style={{ background: ACENTO }}><Plus size={14} /> Nuevo ticket</Button>
      </Cabecera>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por asunto, veterinaria o número…" />
        </div>
        <Select value={categoria} onChange={e => setCategoria(e.target.value)} className="w-auto">
          <option value="">Todas las categorías</option>
          {Object.entries(TICKET_CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-600 px-2">
          <input type="checkbox" checked={verCerrados} onChange={e => setVerCerrados(e.target.checked)} /> Ver cerrados
        </label>
      </div>

      {!lista.length && <p className="text-[12.5px] text-gray-500 mb-3">No hay tickets todavía. Cuando una veterinaria reclame algo, ábrelo con «Nuevo ticket» o desde su ficha.</p>}
      {(
        <div className="flex gap-3 overflow-x-auto pb-4">
          {estados.map(e => {
            const de = filtrados.filter(t => t.estado === e.clave)
            return (
              <div key={e.clave} onDragOver={ev => ev.preventDefault()} onDrop={ev => { ev.preventDefault(); soltar(e.clave) }}
                className="w-[290px] flex-shrink-0 bg-white/60 rounded-2xl border border-gray-100">
                <div className="px-3 py-2.5 flex items-center justify-between border-b-2" style={{ borderColor: e.color }}>
                  <span className="text-[12.5px] font-bold" style={{ color: e.color }}>{e.label}</span>
                  <span className="text-[11px] font-bold text-gray-400">{de.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[120px] max-h-[70vh] overflow-y-auto">
                  {de.map(t => {
                    const vencido = !['RESUELTO', 'CERRADO'].includes(t.estado) && t.vence_en && new Date(t.vence_en) < new Date()
                    return (
                      <div key={t.id} draggable onDragStart={() => { arrastrando.current = t }} onClick={() => navegar(`/crm/tickets/${t.id}`)}
                        className={`bg-white rounded-xl border p-2.5 shadow-sm hover:shadow-md cursor-pointer ${vencido ? 'border-red-200' : 'border-gray-100'} ${id === t.id ? 'ring-2 ring-teal-500' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10.5px] font-mono text-gray-400">#{t.numero}</span>
                          <PrioridadChip prioridad={t.prioridad} />
                        </div>
                        <div className="text-[12.5px] font-semibold text-gray-900 mt-1 line-clamp-2">{t.asunto}</div>
                        <div className="text-[11.5px] text-gray-500 truncate">{t.aliado_nombre}</div>
                        <div className="flex items-center justify-between mt-1.5 text-[10.5px]">
                          <span className="text-gray-400">{TICKET_CATEGORIAS[t.categoria]}{t.comentarios ? ` · 💬 ${t.comentarios}` : ''}</span>
                          {!['RESUELTO', 'CERRADO'].includes(t.estado) && t.vence_en && (
                            <span className={vencido ? 'text-red-600 font-bold' : 'text-gray-400'}>{vencido ? `venció ${relativo(t.vence_en)}` : `vence ${relativo(t.vence_en)}`}</span>
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
      )}

      {id && <DetalleTicket id={id} onCerrar={() => navegar('/crm/tickets')} onCambio={() => { cargar(); refrescarAlertas() }} />}
      <TicketModal abierto={nuevo} onCerrar={() => setNuevo(false)} onCreado={t => { cargar(); refrescarAlertas(); if (t?.id) navegar(`/crm/tickets/${t.id}`) }} />
      <Resolver datos={cerrar} onCerrar={() => setCerrar(null)} onListo={() => { cargar(); refrescarAlertas() }} />
    </div>
  )
}

function Resolver({ datos, onCerrar, onListo }) {
  const [solucion, setSolucion] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => { setSolucion(''); setError(null) }, [datos])
  async function guardar() {
    try { await crm.cambiarTicket(datos.ticket.id, { estado: datos.estado, solucion }); onListo?.(); onCerrar() }
    catch (e) { setError(e.message) }
  }
  return (
    <Modal open={!!datos} onClose={onCerrar} title={`${datos?.estado === 'CERRADO' ? 'Cerrar' : 'Resolver'} ticket #${datos?.ticket?.numero || ''}`} maxWidth="max-w-md"
      footer={<><span className="text-[12px] text-red-600">{error}</span><Button onClick={guardar} disabled={!solucion.trim()} style={{ background: ACENTO }}>Guardar</Button></>}>
      <Campo label="¿Cómo se resolvió?" ayuda="Queda en el historial del ticket y en la bitácora de la veterinaria.">
        <Textarea rows={4} value={solucion} onChange={e => setSolucion(e.target.value)} placeholder="Ej: se le transfirió la comisión el 20-oct, comprobante enviado por WhatsApp." />
      </Campo>
    </Modal>
  )
}

function DetalleTicket({ id, onCerrar, onCambio }) {
  const { equipo } = useCrm()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [comentario, setComentario] = useState('')
  const [solucion, setSolucion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [seguimiento, setSeguimiento] = useState(false)

  const cargar = useCallback(() => { crm.ticket(id).then(r => { setD(r); setSolucion(r.ticket.solucion || '') }).catch(e => setError(e.message)) }, [id])
  useEffect(() => { setD(null); cargar() }, [cargar])

  async function cambiar(datos) {
    setGuardando(true); setError(null)
    try { const r = await crm.cambiarTicket(id, datos); setD(r); setComentario(''); onCambio?.() }
    catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  const t = d?.ticket
  const nombreDe = pid => equipo.find(p => p.id === pid)?.nombre || (pid ? '—' : 'nadie')

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/30" onClick={onCerrar} />
      <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="text-[13px] font-bold text-gray-800">{t ? `Ticket #${t.numero}` : 'Ticket'}</div>
          <button onClick={onCerrar} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X size={16} /></button>
        </div>
        {!d ? (error ? <div className="p-5"><ErrorCaja error={error} /></div> : <Cargando />) : (
          <div className="p-5 space-y-4">
            <div>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                <EstadoTicketChip estado={t.estado} /><PrioridadChip prioridad={t.prioridad} />
                <Chip color="#475569">{TICKET_TIPOS[t.tipo]}</Chip><Chip color="#475569">{TICKET_CATEGORIAS[t.categoria]}</Chip>
              </div>
              <h2 className="text-[17px] font-bold text-gray-900">{t.asunto}</h2>
              <Link to={`/crm/veterinarias/${t.aliado_id}`} className="text-[13px] font-semibold" style={{ color: ACENTO }}>{t.aliado_nombre}</Link>
              <div className="text-[11.5px] text-gray-400 mt-0.5">
                Abierto {fechaHora(t.created_at)} por {t.creado_por_nombre || '—'}{t.canal ? ` · por ${t.canal.toLowerCase()}` : ''}
                {t.vence_en && !['RESUELTO', 'CERRADO'].includes(t.estado) && <> · <span className={new Date(t.vence_en) < new Date() ? 'text-red-600 font-semibold' : ''}>responder {relativo(t.vence_en)}</span></>}
              </div>
              {t.servicio_mascota && <div className="text-[12px] text-gray-500 mt-1">Servicio relacionado: {t.servicio_mascota} ({fechaCorta(t.servicio_fecha)})</div>}
              <div className="flex gap-2 mt-2">
                {telHref(t.aliado_telefono || t.aliado_whatsapp) && <a href={telHref(t.aliado_telefono || t.aliado_whatsapp)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-white text-[12px] font-semibold no-underline" style={{ background: ACENTO }}><Phone size={13} /> Llamar</a>}
                {t.aliado_whatsapp && <a href={waHref(t.aliado_whatsapp)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-gray-200 text-[12px] font-semibold text-green-700 no-underline"><MessageCircle size={13} /> WhatsApp</a>}
                <button onClick={() => setSeguimiento(true)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-700"><CalendarPlus size={13} /> Recordarme</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Campo label="Estado">
                <Select value={t.estado} disabled={guardando} onChange={e => {
                  const v = e.target.value
                  if (['RESUELTO', 'CERRADO'].includes(v) && !solucion.trim()) { setError('Escribe la solución abajo antes de resolverlo'); return }
                  cambiar({ estado: v, solucion })
                }}>
                  {TICKET_ESTADOS.map(e => <option key={e.clave} value={e.clave}>{e.label}</option>)}
                </Select>
              </Campo>
              <Campo label="Prioridad">
                <Select value={t.prioridad} disabled={guardando} onChange={e => cambiar({ prioridad: e.target.value })}>
                  {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </Select>
              </Campo>
              <Campo label="Responsable">
                <Select value={t.responsable_id || ''} disabled={guardando} onChange={e => cambiar({ responsable_id: e.target.value || null })}>
                  <option value="">Sin asignar</option>
                  {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Select>
              </Campo>
            </div>

            {t.descripcion && <div className="rounded-xl bg-gray-50 p-3 text-[13px] text-gray-700 whitespace-pre-wrap">{t.descripcion}</div>}

            <div>
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-400 mb-2">Historial</h3>
              <ol className="space-y-2.5">
                {d.eventos.map(e => (
                  <li key={e.id} className="text-[12.5px]">
                    <div className="text-[11px] text-gray-400">{fechaHora(e.created_at)} · {e.autor || 'Sistema'}</div>
                    {e.tipo === 'COMENTARIO' && <div className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-gray-800 whitespace-pre-wrap">{e.texto}</div>}
                    {e.tipo === 'CREADO' && <div className="text-gray-600">Ticket abierto</div>}
                    {e.tipo === 'ESTADO' && <div className="text-gray-600">Estado: {e.de} → <b>{e.a}</b>{e.texto ? <div className="text-gray-800 whitespace-pre-wrap mt-0.5">{e.texto}</div> : null}</div>}
                    {e.tipo === 'PRIORIDAD' && <div className="text-gray-600">Prioridad: {e.de} → <b>{e.a}</b></div>}
                    {e.tipo === 'ASIGNACION' && <div className="text-gray-600">Asignado a <b>{nombreDe(e.a)}</b></div>}
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <Textarea rows={3} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Agregar una nota al ticket (qué se averiguó, qué se le dijo a la vet)…" />
              <Button size="sm" disabled={!comentario.trim() || guardando} onClick={() => cambiar({ comentario })} style={{ background: ACENTO }}>Agregar nota</Button>
            </div>

            <div className="rounded-xl border border-gray-100 p-3 space-y-2">
              <Campo label="Solución"><Textarea rows={3} value={solucion} onChange={e => setSolucion(e.target.value)} placeholder="Cómo se resolvió" /></Campo>
              <div className="flex gap-2">
                <Button size="sm" disabled={!solucion.trim() || guardando} onClick={() => cambiar({ estado: 'RESUELTO', solucion })} style={{ background: '#059669' }}>Marcar resuelto</Button>
                {t.estado === 'RESUELTO' && <Button size="sm" variant="secondary" onClick={() => cambiar({ estado: 'CERRADO', solucion })}>Cerrar</Button>}
                {['RESUELTO', 'CERRADO'].includes(t.estado) && <Button size="sm" variant="secondary" onClick={() => cambiar({ estado: 'EN_PROCESO' })}>Reabrir</Button>}
              </div>
            </div>
            {error && <div className="text-[12px] text-red-600">{error}</div>}
          </div>
        )}
      </div>
      {t && <SeguimientoModal abierto={seguimiento} onCerrar={() => setSeguimiento(false)} destino={{ ticket_id: t.id, aliado_id: t.aliado_id }} onGuardado={cargar} />}
    </div>
  )
}
