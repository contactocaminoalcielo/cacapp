import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, MessageCircle, PhoneCall, CalendarPlus, LifeBuoy, Send, Paperclip, Pencil,
  MapPin, Clock, Instagram, Globe, Mail, Link2, Check, CheckCircle2, RotateCcw, XCircle, Ban,
  UserPlus, Trash2, Star,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  crm, TIPOS_GESTION, RESULTADOS, TICKET_CATEGORIAS, pesos, haceDias, fechaCorta, fechaHora, relativo, telHref,
} from '@/lib/crmApi'
import { EstadoBadge } from '@/components/ui/badge'
import { resumenHorario } from '@/components/ui/horario-editor'
import {
  Cargando, ErrorCaja, SegmentoChip, TendenciaChip, Probabilidad, ClaseChip, RiesgoChip, Seccion, Vacio,
  Chip, EstadoTicketChip, PrioridadChip, Pestanas, EtapaChip, ACENTO,
} from '@/components/crm/ui'
import { RegistrarGestion, SeguimientoModal, TicketModal, BloqueoModal, AvisoNoContactar } from '@/components/crm/Modales'
import Copiloto from '@/components/crm/Copiloto'
import Fotos, { FotoCrm } from '@/components/crm/Fotos'
import { EnviarPlantillaCrm, EnviarMaterialCrm } from '@/components/crm/EnviarWhatsapp'
import EditarFicha from '@/components/crm/EditarFicha'
import { useCrm } from '@/components/crm/CrmContext'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Campo } from '@/components/crm/ui'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const ROLES_CONTACTO = {
  DUENO:          { label: 'Dueño/a',        color: '#7C3AED', bg: '#F5F3FF' },
  ADMINISTRADOR:  { label: 'Administrador/a', color: '#2563EB', bg: '#EFF6FF' },
  AUXILIAR:       { label: 'Auxiliar',        color: '#059669', bg: '#ECFDF5' },
  ENCARGADO:      { label: 'Encargado/a',     color: '#D97706', bg: '#FFFBEB' },
  OTRO:           { label: 'Otro',            color: '#6B7280', bg: '#F3F4F6' },
}

function RolChip({ rol }) {
  const r = ROLES_CONTACTO[rol] || ROLES_CONTACTO.OTRO
  return (
    <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: r.color, background: r.bg }}>{r.label}</span>
  )
}

function ModalContacto({ abierto, contacto, aliadoId, onCerrar, onGuardado }) {
  const nuevo = !contacto?.id
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setF(contacto ? { ...contacto } : { nombre: '', rol: 'OTRO', telefono: '', whatsapp: '', email: '', notas: '', principal: false })
    setError(null)
  }, [abierto, contacto])

  async function guardar() {
    if (!f.nombre?.trim()) { setError('Falta el nombre'); return }
    setGuardando(true); setError(null)
    try {
      if (nuevo) await crm.crearContacto(aliadoId, f)
      else await crm.editarContacto(aliadoId, f.id, f)
      onGuardado()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title={nuevo ? 'Nuevo contacto' : 'Editar contacto'} maxWidth="max-w-md"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </>}>
      <div className="space-y-3">
        <Campo label="Nombre *">
          <Input value={f.nombre || ''} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))}
            placeholder="Ej: María Torres" autoFocus />
        </Campo>
        <Campo label="Rol">
          <Select value={f.rol || 'OTRO'} onChange={e => setF(x => ({ ...x, rol: e.target.value }))}>
            {Object.entries(ROLES_CONTACTO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="WhatsApp">
            <Input value={f.whatsapp || ''} onChange={e => setF(x => ({ ...x, whatsapp: e.target.value }))}
              placeholder="3001234567" inputMode="tel" />
          </Campo>
          <Campo label="Teléfono">
            <Input value={f.telefono || ''} onChange={e => setF(x => ({ ...x, telefono: e.target.value }))}
              placeholder="Opcional" inputMode="tel" />
          </Campo>
        </div>
        <Campo label="Correo">
          <Input value={f.email || ''} onChange={e => setF(x => ({ ...x, email: e.target.value }))}
            placeholder="correo@veterinaria.com" type="email" />
        </Campo>
        <Campo label="Notas">
          <Textarea rows={2} value={f.notas || ''} onChange={e => setF(x => ({ ...x, notas: e.target.value }))}
            placeholder="Horario, observaciones, mejor hora para llamar…" />
        </Campo>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={!!f.principal} onChange={e => setF(x => ({ ...x, principal: e.target.checked }))}
            className="w-4 h-4 rounded" />
          <span className="text-[12.5px] text-gray-700">Marcar como contacto principal</span>
          <Star size={12} className="text-amber-400" />
        </label>
      </div>
    </Modal>
  )
}

function ContactosSection({ aliadoId, contactos = [], onCambio, useConfirm: confirmar }) {
  const [modal, setModal] = useState(null)  // null | 'nuevo' | contacto-obj

  async function eliminar(c) {
    if (!window.confirm(`¿Eliminar a ${c.nombre}?`)) return
    try { await crm.borrarContacto(aliadoId, c.id); onCambio() } catch (e) { alert(e.message) }
  }

  return (
    <Seccion titulo="Personas de contacto"
      accion={<button onClick={() => setModal('nuevo')} className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: ACENTO }}>
        <UserPlus size={13} /> Agregar
      </button>}>
      {!contactos.length
        ? <div className="text-[12.5px] text-gray-400 italic">Sin contactos registrados. Agrega el dueño, administrador o encargado.</div>
        : <div className="space-y-2">
            {contactos.map(c => (
              <div key={c.id} className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-2.5 hover:bg-gray-50 group">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[14px] font-bold"
                  style={{ background: ROLES_CONTACTO[c.rol]?.bg || '#F3F4F6', color: ROLES_CONTACTO[c.rol]?.color || '#6B7280' }}>
                  {c.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-900">{c.nombre}</span>
                    {c.principal && <Star size={11} className="text-amber-400" fill="currentColor" />}
                    <RolChip rol={c.rol} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-gray-500 mt-0.5">
                    {c.whatsapp && <a href={`https://wa.me/${String(c.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                      className="text-teal-700 hover:underline">WA {c.whatsapp}</a>}
                    {c.telefono && <a href={`tel:${c.telefono}`} className="hover:underline">{c.telefono}</a>}
                    {c.email && <span>{c.email}</span>}
                  </div>
                  {c.notas && <p className="text-[11.5px] text-gray-400 mt-0.5 line-clamp-2">{c.notas}</p>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                  <button onClick={() => setModal(c)}
                    className="w-7 h-7 rounded-lg hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => eliminar(c)}
                    className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>}

      <ModalContacto
        abierto={modal !== null}
        contacto={modal === 'nuevo' ? null : modal}
        aliadoId={aliadoId}
        onCerrar={() => setModal(null)}
        onGuardado={() => { setModal(null); onCambio() }}
      />
    </Seccion>
  )
}

export default function FichaVeterinaria() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { refrescarAlertas } = useCrm()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)        // 'gestion' | 'seguimiento' | 'ticket' | 'plantilla' | 'material' | 'editar'
  const [segSel, setSegSel] = useState(null)
  const [pestana, setPestana] = useState('gestiones')
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(() => {
    setError(null)
    crm.ficha(id).then(setD).catch(e => setError(e.message))
  }, [id])
  useEffect(() => { setD(null); cargar() }, [cargar])

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!d) return <Cargando texto="Armando la ficha…" />

  const a = d.aliado
  const m = d.metricas
  const destino = { aliado_id: a.id_aliado }
  const wa = a.whatsapp || a.telefono
  const tel = a.telefono || a.whatsapp
  const pendientes = d.seguimientos.filter(s => s.estado === 'PENDIENTE')
  const portada = d.fotos.find(f => f.es_portada) || d.fotos[0]
  const serie = d.serie.map(s => ({ ...s, etiqueta: MESES[Number(s.mes.slice(5, 7)) - 1] }))
  const ticketsAbiertos = d.tickets.filter(t => !['RESUELTO', 'CERRADO'].includes(t.estado))

  async function cambiarSeg(s, accion) {
    if (accion === 'reprogramar') { setSegSel(s); setModal('seguimiento'); return }
    if (accion === 'gestionar') { setSegSel(s); setModal('gestion'); return }
    await crm.cambiarSeguimiento(s.id, { accion }).catch(() => {})
    refrescarAlertas(); cargar()
  }

  async function copiarEnlace() {
    try { await navigator.clipboard.writeText(d.enlace_portal); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* */ }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <button onClick={() => navegar(-1)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Volver
      </button>

      {/* ── Cabecera ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="md:w-56 h-40 md:h-auto bg-gradient-to-br from-teal-600 to-[#0B1D4F] flex-shrink-0 relative">
            {portada
              ? <FotoCrm id={portada.id} mini={false} className="w-full h-full" alt={a.nombre} />
              : <div className="w-full h-full flex items-center justify-center text-white/90 text-5xl font-bold">{a.nombre[0]}</div>}
          </div>
          <div className="flex-1 p-5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold text-gray-900 leading-tight">{a.nombre}</h1>
              <SegmentoChip segmento={m.segmento} />
              <ClaseChip clase={m.clase} />
              {a.vip && <Chip color="#B45309">VIP</Chip>}
              {m.riesgo && m.riesgo !== 'BAJO' && <RiesgoChip riesgo={m.riesgo} />}
              {a.estado !== 'activo' && <Chip color="#DC2626">{a.estado}</Chip>}
              {a.no_contactar && <Chip color="#DC2626">🚫 No contactar</Chip>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-500">
              {a.contacto_nombre && <span>👤 {a.contacto_nombre}{a.contacto_cargo ? ` · ${a.contacto_cargo}` : ''}</span>}
              {(a.direccion || a.localidad) && <span className="inline-flex items-center gap-1"><MapPin size={12} />{[a.direccion, a.barrio, a.localidad, a.ciudad].filter(Boolean).join(', ')}</span>}
              <span className="inline-flex items-center gap-1"><Clock size={12} />{resumenHorario(a.horario)}{a.atiende_24h ? ' · 24 h' : ''}</span>
              {a.tipo_establecimiento && <span>{a.tipo_establecimiento}</span>}
            </div>
            <div className="mt-1 text-[11.5px] text-gray-400">
              Aliada desde {fechaCorta(a.created_at)} · Comisión {a.modalidad_comision === 'FACTURACION_MENSUAL' ? 'facturación mensual' : 'descuento inmediato'}
              {a.comercial_nombre ? ` · Responsable: ${a.comercial_nombre}` : ' · Sin responsable comercial'}
              {d.prospecto && <> · Llegó como prospecto <EtapaChip clave={d.prospecto.etapa} /></>}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {telHref(tel) && <AccionLink href={telHref(tel)} icono={Phone} principal>Llamar</AccionLink>}
              <AccionBoton icono={PhoneCall} onClick={() => { setSegSel(null); setModal('gestion') }}>Registrar gestión</AccionBoton>
              {!a.no_contactar && <AccionBoton icono={CalendarPlus} onClick={() => { setSegSel(null); setModal('seguimiento') }}>Programar</AccionBoton>}
              {wa && <AccionLink to={`/crm/bandeja?contacto=${String(wa).replace(/\D/g, '')}`} icono={MessageCircle}>Chat WhatsApp</AccionLink>}
              {!a.no_contactar && <AccionBoton icono={Send} onClick={() => setModal('plantilla')}>Plantilla</AccionBoton>}
              {!a.no_contactar && <AccionBoton icono={Paperclip} onClick={() => setModal('material')}>Recurso</AccionBoton>}
              <AccionBoton icono={LifeBuoy} onClick={() => setModal('ticket')}>Ticket</AccionBoton>
              <AccionBoton icono={Pencil} onClick={() => setModal('editar')}>Editar ficha</AccionBoton>
              {!a.no_contactar && <AccionBoton icono={Ban} onClick={() => setModal('bloqueo')}>No contactar</AccionBoton>}
            </div>
          </div>
        </div>
      </div>

      <AvisoNoContactar ficha={a} onDesbloquear={() => setModal('bloqueo')} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Columna principal ── */}
        <div className="lg:col-span-2 space-y-4">
          <Seccion titulo="Situación de la cuenta">
            <ul className="space-y-1.5">
              {d.resumen.map((r, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-gray-700"><span style={{ color: ACENTO }}>•</span><span>{r}</span></li>
              ))}
            </ul>
          </Seccion>

          <Copiloto destino={destino} whatsapp={wa} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Metrica label="Este mes" valor={m.mes_actual} sub={`mes pasado: ${m.mes_anterior}`} />
            <Metrica label="Últimos 90 días" valor={m.s90} sub={<TendenciaChip tendencia={m.tendencia} variacion={m.variacion} />} />
            <Metrica label="Promedio mensual" valor={String(m.promedio_mensual ?? 0).replace('.', ',')} sub={m.intervalo_dias ? `uno cada ~${m.intervalo_dias} días` : 'sin ritmo reciente'} />
            <Metrica label="Total histórico" valor={m.total} sub={m.primero ? `desde ${fechaCorta(m.primero)}` : 'nunca ha enviado'} />
            <Metrica label="Último servicio" valor={m.ultimo ? haceDias(m.dias_sin) : '—'} sub={m.proximo_esperado ? `próximo esperado ~${fechaCorta(m.proximo_esperado)}` : ''} />
            <Metrica label="Prob. 30 días" valor={<Probabilidad valor={m.probabilidad} ancho={56} />} sub="de que mande al menos uno" />
            <Metrica label="Ventas 6 meses" valor={pesos(m.ingresos_180)} sub={`comisiones ${pesos(m.comisiones_180)}`} />
            <Metrica label="Comisión pendiente" valor={pesos(m.comision_pendiente)} sub="por pagarle (domicilio)" alerta={Number(m.comision_pendiente) > 0} />
          </div>

          <Seccion titulo="Servicios por mes (12 meses)">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v, n) => (n === 'servicios' ? [v, 'Servicios'] : [pesos(v), 'Valor'])} cursor={{ fill: '#F0FDFA' }} />
                  <Bar dataKey="servicios" fill={ACENTO} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {d.planes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[11.5px] text-gray-400 mr-1">Planes (6 meses):</span>
                {d.planes.map(p => <span key={p.plan} className="text-[11.5px] bg-gray-50 rounded-full px-2 py-0.5 text-gray-600">{p.plan} <b>{p.n}</b></span>)}
              </div>
            )}
          </Seccion>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <Pestanas valor={pestana} onCambio={setPestana} opciones={[
              { valor: 'gestiones', label: 'Bitácora', n: d.actividades.length },
              { valor: 'servicios', label: 'Servicios', n: d.servicios.length },
              { valor: 'tickets', label: 'Tickets', n: d.tickets.length },
              { valor: 'pqr', label: 'PQR de familias', n: d.pqrs.length },
            ]} />
            <div className="mt-3">
              {pestana === 'gestiones' && <Bitacora actividades={d.actividades} />}
              {pestana === 'servicios' && <ServiciosVet servicios={d.servicios} />}
              {pestana === 'tickets' && (
                !d.tickets.length ? <Vacio>Sin tickets. Bien por ella.</Vacio> : (
                  <div className="divide-y divide-gray-50">
                    {d.tickets.map(t => (
                      <Link key={t.id} to={`/crm/tickets/${t.id}`} className="flex items-center gap-3 py-2 no-underline hover:bg-gray-50 px-2 -mx-2 rounded-lg">
                        <span className="text-[11px] font-mono text-gray-400">#{t.numero}</span>
                        <span className="flex-1 min-w-0 text-[12.5px] text-gray-800 truncate">{t.asunto}</span>
                        <span className="text-[11px] text-gray-400">{TICKET_CATEGORIAS[t.categoria]}</span>
                        <PrioridadChip prioridad={t.prioridad} />
                        <EstadoTicketChip estado={t.estado} />
                      </Link>
                    ))}
                  </div>
                ))}
              {pestana === 'pqr' && (
                !d.pqrs.length ? <Vacio>Sus familias no han dejado PQR.</Vacio> : (
                  <div className="divide-y divide-gray-50">
                    {d.pqrs.map(q => (
                      <div key={q.id} className="py-2">
                        <div className="text-[12px] text-gray-500"><b className="text-gray-700">{q.tipo}</b> · {q.mascota} · {fechaCorta(q.created_at)}</div>
                        <div className="text-[12.5px] text-gray-800">{q.descripcion}</div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ── Columna lateral ── */}
        <div className="space-y-4">
          <Seccion titulo="Próximos seguimientos" accion={
            <button onClick={() => { setSegSel(null); setModal('seguimiento') }} className="text-[12px] font-semibold" style={{ color: ACENTO }}>+ Programar</button>}>
            {!pendientes.length ? <Vacio>Nada programado. {m.sin_contacto ? 'Hace rato nadie la contacta.' : ''}</Vacio> : (
              <div className="space-y-2">
                {pendientes.map(s => {
                  const vencido = new Date(s.programado_para) <= new Date()
                  return (
                    <div key={s.id} className={`rounded-xl border p-2.5 ${vencido ? 'border-red-200 bg-red-50/50' : 'border-gray-100'}`}>
                      <div className="text-[12.5px] font-semibold text-gray-800">{TIPOS_GESTION[s.tipo]?.emoji} {s.titulo}</div>
                      <div className={`text-[11.5px] ${vencido ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{fechaHora(s.programado_para)} · {relativo(s.programado_para)}</div>
                      {s.notas && <div className="text-[11.5px] text-gray-500 mt-0.5">{s.notas}</div>}
                      <div className="flex gap-3 mt-1.5 text-[11.5px] font-semibold">
                        <button onClick={() => cambiarSeg(s, 'gestionar')} className="inline-flex items-center gap-1" style={{ color: ACENTO }}><CheckCircle2 size={12} /> Hacer</button>
                        <button onClick={() => cambiarSeg(s, 'reprogramar')} className="inline-flex items-center gap-1 text-gray-500"><RotateCcw size={12} /> Mover</button>
                        <button onClick={() => cambiarSeg(s, 'cancelar')} className="inline-flex items-center gap-1 text-gray-400"><XCircle size={12} /> Cancelar</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Seccion>

          {ticketsAbiertos.length > 0 && (
            <Seccion titulo="Tickets abiertos">
              <div className="space-y-1.5">
                {ticketsAbiertos.map(t => (
                  <Link key={t.id} to={`/crm/tickets/${t.id}`} className="block rounded-lg border border-red-100 bg-red-50/40 px-2.5 py-1.5 no-underline">
                    <div className="text-[12.5px] font-semibold text-gray-800">#{t.numero} {t.asunto}</div>
                    <div className="text-[11px] text-gray-500">{TICKET_CATEGORIAS[t.categoria]} · vence {fechaHora(t.vence_en)}</div>
                  </Link>
                ))}
              </div>
            </Seccion>
          )}

          <ContactosSection aliadoId={a.id_aliado} contactos={d.contactos || []} onCambio={cargar} />

          <Seccion titulo="Datos de contacto" accion={<button onClick={() => setModal('editar')} className="text-[12px] font-semibold" style={{ color: ACENTO }}>Editar</button>}>
            <dl className="space-y-1.5 text-[12.5px]">
              <Dato label="Teléfono">{a.telefono ? <a href={telHref(a.telefono)} className="text-teal-700">{a.telefono}</a> : '—'}{a.telefono_2 ? ` · ${a.telefono_2}` : ''}</Dato>
              <Dato label="WhatsApp">{a.whatsapp || '—'}</Dato>
              <Dato label="Contacto">{a.contacto_nombre || '—'}{a.contacto_email ? ` · ${a.contacto_email}` : ''}</Dato>
              {a.contacto_2_nombre && <Dato label="Otro contacto">{a.contacto_2_nombre} {a.contacto_2_telefono || ''}</Dato>}
              <Dato label="Correo"><span className="inline-flex items-center gap-1">{a.email ? <><Mail size={11} />{a.email}</> : '—'}</span></Dato>
              {a.instagram && <Dato label="Instagram"><span className="inline-flex items-center gap-1"><Instagram size={11} />{a.instagram}</span></Dato>}
              {a.sitio_web && <Dato label="Web"><a href={a.sitio_web.startsWith('http') ? a.sitio_web : `https://${a.sitio_web}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700"><Globe size={11} />{a.sitio_web}</a></Dato>}
              {a.referencia_ubicacion && <Dato label="Cómo llegar">{a.referencia_ubicacion}</Dato>}
              {(a.num_veterinarios || a.numero_sedes) && <Dato label="Tamaño">{a.num_veterinarios ? `${a.num_veterinarios} veterinarios` : ''}{a.numero_sedes ? ` · ${a.numero_sedes} sede(s)` : ''}</Dato>}
              {a.servicios_clinica?.length > 0 && <Dato label="Servicios"><div className="flex flex-wrap gap-1">{a.servicios_clinica.map(s => <span key={s} className="text-[11px] bg-gray-50 rounded px-1.5 py-0.5">{s}</span>)}</div></Dato>}
              {(a.lat && a.lng) && <Dato label="Mapa"><a className="text-teal-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}>Ver en Google Maps</a></Dato>}
              {!a.lat && a.direccion && <Dato label="Mapa"><a className="text-teal-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/${encodeURIComponent([a.direccion, a.ciudad || 'Bogotá'].join(', '))}`}>Buscar en Google Maps</a></Dato>}
            </dl>
            {a.notas_comerciales && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-[12px] text-amber-900 whitespace-pre-wrap">{a.notas_comerciales}</div>
            )}
            {a.ficha_actualizada_en && <div className="text-[10.5px] text-gray-400 mt-2">Ficha actualizada {fechaCorta(a.ficha_actualizada_en)}{a.ficha_actualizada_por_nombre ? ` por ${a.ficha_actualizada_por_nombre}` : ''}</div>}
          </Seccion>

          <Seccion titulo="Fotos del establecimiento">
            <Fotos destino={destino} fotos={d.fotos} onCambio={cargar} />
          </Seccion>

          <Seccion titulo="WhatsApp">
            {!d.conversaciones.length ? <Vacio>Sin conversaciones en la línea.</Vacio> : d.conversaciones.map(c => (
              <Link key={`${c.contacto}-${c.phone_number_id}`} to={`/crm/bandeja?contacto=${c.contacto}`}
                className="block rounded-lg border border-gray-100 p-2.5 no-underline hover:bg-gray-50 mb-1.5">
                <div className="flex items-center justify-between text-[11.5px] text-gray-500">
                  <span>{c.contacto}</span>
                  <span>{c.ventana_abierta ? <Chip color="#059669">ventana abierta</Chip> : 'fuera de 24 h'}</span>
                </div>
                <div className="text-[12.5px] text-gray-700 truncate mt-0.5">{c.ultimo_texto || '—'}</div>
                {Number(c.sin_leer) > 0 && <div className="text-[11px] font-bold text-red-600 mt-0.5">{c.sin_leer} sin leer</div>}
              </Link>
            ))}
            {d.enlace_portal && (
              <button onClick={copiarEnlace} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: ACENTO }}>
                {copiado ? <Check size={13} /> : <Link2 size={13} />} {copiado ? 'Enlace copiado' : 'Copiar su enlace de registro de servicios'}
              </button>
            )}
          </Seccion>
        </div>
      </div>

      <RegistrarGestion abierto={modal === 'gestion'} onCerrar={() => setModal(null)} destino={destino} seguimiento={segSel} onGuardado={cargar} sinSiguiente={a.no_contactar} />
      <SeguimientoModal abierto={modal === 'seguimiento'} onCerrar={() => setModal(null)} destino={destino} existente={segSel} onGuardado={cargar} />
      <TicketModal abierto={modal === 'ticket'} onCerrar={() => setModal(null)} aliado={a} onCreado={cargar} />
      <EnviarPlantillaCrm abierto={modal === 'plantilla'} onCerrar={() => setModal(null)} destino={destino} whatsapp={a.whatsapp} onEnviada={cargar} />
      <EnviarMaterialCrm abierto={modal === 'material'} onCerrar={() => setModal(null)} destino={destino} onEnviado={cargar} />
      <EditarFicha abierto={modal === 'editar'} onCerrar={() => setModal(null)} aliado={a} onGuardado={cargar} />
      <BloqueoModal abierto={modal === 'bloqueo'} onCerrar={() => setModal(null)} destino={destino} nombre={a.nombre}
        bloqueada={a.no_contactar} onListo={() => { refrescarAlertas(); cargar() }} />
    </div>
  )
}

function AccionBoton({ icono: I, children, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12.5px] font-semibold text-gray-700 hover:border-teal-600 hover:text-teal-700 transition">
      <I size={14} /> {children}
    </button>
  )
}

function AccionLink({ href, to, icono: I, children, principal = false }) {
  const cls = `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold no-underline transition ${principal ? 'text-white' : 'border border-gray-200 bg-white text-gray-700 hover:border-teal-600 hover:text-teal-700'}`
  const style = principal ? { background: ACENTO } : undefined
  if (to) return <Link to={to} className={cls} style={style}><I size={14} /> {children}</Link>
  return <a href={href} className={cls} style={style}><I size={14} /> {children}</a>
}

function Metrica({ label, valor, sub, alerta = false }) {
  return (
    <div className={`rounded-xl border p-3 bg-white ${alerta ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-[18px] font-bold text-gray-900 mt-0.5 tabular-nums">{valor}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Dato({ label, children }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 flex-shrink-0 text-gray-400">{label}</dt>
      <dd className="flex-1 min-w-0 text-gray-800 break-words">{children}</dd>
    </div>
  )
}

export function Bitacora({ actividades }) {
  if (!actividades.length) return <Vacio>Todavía no hay gestiones. Registra la primera llamada.</Vacio>
  return (
    <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
      {actividades.map(x => (
        <li key={x.id} className="ml-4">
          <span className="absolute -left-[9px] w-4 h-4 rounded-full bg-white border-2 flex items-center justify-center text-[8px]"
            style={{ borderColor: x.tipo === 'SISTEMA' ? '#CBD5E1' : ACENTO }} />
          <div className="text-[11.5px] text-gray-400">
            {fechaHora(x.realizado_en)} · {x.origen === 'AGENTE' ? '🤖 Agente de ventas' : x.autor || 'Sistema'}
          </div>
          <div className="text-[12.5px] text-gray-800">
            <span className="font-semibold">{TIPOS_GESTION[x.tipo]?.emoji} {TIPOS_GESTION[x.tipo]?.label}</span>
            {x.resultado && <span className="text-gray-500"> · {RESULTADOS[x.resultado]}</span>}
            {x.duracion_min ? <span className="text-gray-400"> · {x.duracion_min} min</span> : null}
          </div>
          <div className={`text-[12.5px] whitespace-pre-wrap ${x.tipo === 'SISTEMA' ? 'text-gray-500' : 'text-gray-700'}`}>{x.resumen}</div>
          {x.compromiso && <div className="text-[12px] text-teal-800 bg-teal-50 rounded-md px-2 py-1 mt-1 inline-block">🤝 {x.compromiso}</div>}
        </li>
      ))}
    </ol>
  )
}

function ServiciosVet({ servicios }) {
  if (!servicios.length) return <Vacio>No ha enviado servicios.</Vacio>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400">
            <th className="py-1.5 pr-2">Fecha</th><th className="pr-2">Mascota</th><th className="pr-2">Familia</th>
            <th className="pr-2">Plan</th><th className="pr-2">Estado</th><th className="pr-2 text-right">Valor</th><th className="text-right">Comisión</th>
          </tr>
        </thead>
        <tbody>
          {servicios.map(s => {
            const pendiente = !s.comision_descontada ? Math.max(0, Number(s.comision_aliado || 0) - Number(s.comision_pagada || 0)) : 0
            return (
              <tr key={s.id} className="border-t border-gray-50">
                <td className="py-1.5 pr-2 whitespace-nowrap">{fechaCorta(s.fecha_ingreso)}</td>
                <td className="pr-2">{s.mascota}<span className="text-gray-400"> · {s.especie}</span></td>
                <td className="pr-2 text-gray-600">{s.cliente}</td>
                <td className="pr-2 text-gray-600">{s.plan}</td>
                <td className="pr-2"><EstadoBadge estado={s.estado} /></td>
                <td className="pr-2 text-right tabular-nums">{pesos(s.valor_total)}</td>
                <td className="text-right tabular-nums">
                  {Number(s.comision_aliado) > 0 ? (
                    <span title={s.comision_descontada ? 'Descontada en el recibo' : pendiente ? 'Pendiente de pagarle' : 'Pagada'}
                      className={pendiente ? 'text-amber-600 font-semibold' : 'text-gray-500'}>
                      {pesos(s.comision_aliado)}{s.comision_descontada ? ' ✓' : pendiente ? ' ⏳' : ' ✓'}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-400 mt-2">✓ descontada o pagada · ⏳ pendiente por pagarle. Se muestran los 60 más recientes.</p>
    </div>
  )
}
