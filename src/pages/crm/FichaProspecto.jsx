import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Phone, PhoneCall, CalendarPlus, MessageCircle, Send, Paperclip, Trophy, XCircle, Pencil, CheckCircle2, RotateCcw } from 'lucide-react'
import { crm, ETAPAS, FUENTES, TIPOS_GESTION, fechaCorta, fechaHora, relativo, telHref } from '@/lib/crmApi'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { Cargando, ErrorCaja, Seccion, Vacio, Chip, Campo, EtapaChip, ACENTO } from '@/components/crm/ui'
import { RegistrarGestion, SeguimientoModal } from '@/components/crm/Modales'
import Copiloto from '@/components/crm/Copiloto'
import Fotos from '@/components/crm/Fotos'
import { EnviarPlantillaCrm, EnviarMaterialCrm } from '@/components/crm/EnviarWhatsapp'
import { useCrm } from '@/components/crm/CrmContext'
import { Bitacora } from './FichaVeterinaria'
import { Ganar } from './Prospectos'

export default function FichaProspecto() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { refrescarAlertas, equipo } = useCrm()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)
  const [segSel, setSegSel] = useState(null)
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(() => { setError(null); crm.prospecto(id).then(setD).catch(e => setError(e.message)) }, [id])
  useEffect(() => { setD(null); cargar() }, [cargar])

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!d) return <Cargando />
  const p = d.prospecto
  const destino = { prospecto_id: p.id }
  const wa = p.whatsapp || p.telefono
  const pendientes = d.seguimientos.filter(s => s.estado === 'PENDIENTE')
  const cerrado = ['GANADO', 'PERDIDO'].includes(p.etapa)
  const extras = Object.entries(p.datos || {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')

  async function mover(etapa) {
    if (etapa === p.etapa) return
    if (etapa === 'GANADO') { setModal('ganar'); return }
    if (etapa === 'PERDIDO') { setMotivo(''); setModal('perder'); return }
    await crm.moverProspecto(p.id, { etapa }).catch(e => setError(e.message))
    cargar()
  }

  async function seg(s, accion) {
    if (accion === 'gestionar') { setSegSel(s); setModal('gestion'); return }
    if (accion === 'reprogramar') { setSegSel(s); setModal('seguimiento'); return }
    await crm.cambiarSeguimiento(s.id, { accion }).catch(() => {})
    refrescarAlertas(); cargar()
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button onClick={() => navegar(-1)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> Volver</button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono text-gray-400">P-{p.numero}</span>
          <h1 className="text-[22px] font-bold text-gray-900">{p.nombre}</h1>
          <EtapaChip clave={p.etapa} />
          <Chip color="#64748B">{FUENTES[p.fuente]}{p.fuente_detalle ? ` · ${p.fuente_detalle}` : ''}</Chip>
          <Chip color={ACENTO}>{p.probabilidad_efectiva}% prob.</Chip>
        </div>
        <div className="text-[12.5px] text-gray-500 mt-1">
          {[p.contacto_nombre && `👤 ${p.contacto_nombre}${p.contacto_cargo ? ` · ${p.contacto_cargo}` : ''}`, [p.direccion, p.barrio, p.localidad, p.ciudad].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
        </div>
        <div className="text-[11.5px] text-gray-400 mt-0.5">
          Creado {fechaCorta(p.created_at)} · en esta etapa desde {fechaCorta(p.etapa_desde)} · {p.responsable ? `Responsable: ${p.responsable}` : 'Sin responsable'}
          {p.potencial_mensual ? ` · Potencial ${p.potencial_mensual} serv/mes` : ''}
        </div>

        {p.aliado_id && (
          <Link to={`/crm/veterinarias/${p.aliado_id}`} className="inline-block mt-2 text-[12.5px] font-semibold" style={{ color: ACENTO }}>→ Ya es veterinaria aliada: abrir su ficha</Link>
        )}

        {!cerrado && (
          <div className="mt-4 flex flex-wrap gap-1">
            {ETAPAS.map(e => (
              <button key={e.clave} onClick={() => mover(e.clave)}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition"
                style={p.etapa === e.clave ? { background: e.color, color: '#fff', borderColor: e.color } : { color: e.color, borderColor: `${e.color}40` }}>
                {e.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {telHref(p.telefono || p.whatsapp) && <a href={telHref(p.telefono || p.whatsapp)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-white text-[12.5px] font-semibold no-underline" style={{ background: ACENTO }}><Phone size={14} /> Llamar</a>}
          <Accion icono={PhoneCall} onClick={() => { setSegSel(null); setModal('gestion') }}>Registrar gestión</Accion>
          <Accion icono={CalendarPlus} onClick={() => { setSegSel(null); setModal('seguimiento') }}>Programar</Accion>
          {wa && <Link to={`/crm/bandeja?contacto=${String(wa).replace(/\D/g, '')}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12.5px] font-semibold text-gray-700 no-underline hover:border-teal-600"><MessageCircle size={14} /> Chat WhatsApp</Link>}
          <Accion icono={Send} onClick={() => setModal('plantilla')}>Plantilla</Accion>
          <Accion icono={Paperclip} onClick={() => setModal('material')}>Recurso</Accion>
          <Accion icono={Pencil} onClick={() => setModal('editar')}>Editar</Accion>
          {!cerrado && <Accion icono={Trophy} onClick={() => setModal('ganar')}>Convertir en aliada</Accion>}
          {!cerrado && <Accion icono={XCircle} onClick={() => { setMotivo(''); setModal('perder') }}>Perdido</Accion>}
        </div>
        {p.etapa === 'PERDIDO' && <div className="mt-3 text-[12.5px] text-red-600">Perdido: {p.motivo_perdida} · <button className="underline" onClick={() => mover('CONTACTADO')}>Reabrir</button></div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Copiloto destino={destino} whatsapp={wa} />
          <Seccion titulo="Bitácora"><Bitacora actividades={d.actividades} /></Seccion>
        </div>
        <div className="space-y-4">
          <Seccion titulo="Próximos seguimientos" accion={<button onClick={() => { setSegSel(null); setModal('seguimiento') }} className="text-[12px] font-semibold" style={{ color: ACENTO }}>+ Programar</button>}>
            {!pendientes.length ? <Vacio>Nada programado.</Vacio> : pendientes.map(s => {
              const vencido = new Date(s.programado_para) <= new Date()
              return (
                <div key={s.id} className={`rounded-xl border p-2.5 mb-2 ${vencido ? 'border-red-200 bg-red-50/50' : 'border-gray-100'}`}>
                  <div className="text-[12.5px] font-semibold text-gray-800">{TIPOS_GESTION[s.tipo]?.emoji} {s.titulo}</div>
                  <div className={`text-[11.5px] ${vencido ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{fechaHora(s.programado_para)} · {relativo(s.programado_para)}</div>
                  {s.origen === 'AGENTE' && <div className="text-[11px] text-purple-600">🤖 Lo agendó el agente de ventas</div>}
                  <div className="flex gap-3 mt-1.5 text-[11.5px] font-semibold">
                    <button onClick={() => seg(s, 'gestionar')} className="inline-flex items-center gap-1" style={{ color: ACENTO }}><CheckCircle2 size={12} /> Hacer</button>
                    <button onClick={() => seg(s, 'reprogramar')} className="inline-flex items-center gap-1 text-gray-500"><RotateCcw size={12} /> Mover</button>
                    <button onClick={() => seg(s, 'cancelar')} className="inline-flex items-center gap-1 text-gray-400"><XCircle size={12} /> Cancelar</button>
                  </div>
                </div>
              )
            })}
          </Seccion>
          <Seccion titulo="Contacto">
            <dl className="text-[12.5px] space-y-1">
              <div className="flex gap-2"><dt className="w-20 text-gray-400">Teléfono</dt><dd>{p.telefono || '—'}</dd></div>
              <div className="flex gap-2"><dt className="w-20 text-gray-400">WhatsApp</dt><dd>{p.whatsapp || '—'}</dd></div>
              <div className="flex gap-2"><dt className="w-20 text-gray-400">Correo</dt><dd className="break-all">{p.email || '—'}</dd></div>
              {p.instagram && <div className="flex gap-2"><dt className="w-20 text-gray-400">Redes</dt><dd>{p.instagram}</dd></div>}
              {p.sitio_web && <div className="flex gap-2"><dt className="w-20 text-gray-400">Web</dt><dd>{p.sitio_web}</dd></div>}
            </dl>
            {p.notas && <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 p-2 text-[12px] whitespace-pre-wrap">{p.notas}</div>}
            {extras.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Datos de la base importada</div>
                {extras.map(([k, v]) => <div key={k} className="text-[11.5px]"><span className="text-gray-400">{k}:</span> {String(v)}</div>)}
              </div>
            )}
          </Seccion>
          {d.conversaciones?.length > 0 && (
            <Seccion titulo="WhatsApp">
              {d.conversaciones.map(c => (
                <Link key={`${c.contacto}-${c.phone_number_id}`} to={`/crm/bandeja?contacto=${c.contacto}`} className="block rounded-lg border border-gray-100 p-2 mb-1.5 no-underline hover:bg-gray-50">
                  <div className="text-[12px] text-gray-700 truncate">{c.ultimo_texto || '—'}</div>
                  <div className="text-[11px] text-gray-400">{fechaHora(c.ultimo_mensaje_en)}{Number(c.sin_leer) > 0 ? ` · ${c.sin_leer} sin leer` : ''}</div>
                </Link>
              ))}
            </Seccion>
          )}
          <Seccion titulo="Fotos"><Fotos destino={destino} fotos={d.fotos} onCambio={cargar} /></Seccion>
        </div>
      </div>

      <RegistrarGestion abierto={modal === 'gestion'} onCerrar={() => setModal(null)} destino={destino} seguimiento={segSel} onGuardado={cargar} />
      <SeguimientoModal abierto={modal === 'seguimiento'} onCerrar={() => setModal(null)} destino={destino} existente={segSel} onGuardado={cargar} />
      <EnviarPlantillaCrm abierto={modal === 'plantilla'} onCerrar={() => setModal(null)} destino={destino} whatsapp={wa} onEnviada={cargar} />
      <EnviarMaterialCrm abierto={modal === 'material'} onCerrar={() => setModal(null)} destino={destino} onEnviado={cargar} />
      <Ganar prospecto={modal === 'ganar' ? p : null} onCerrar={() => setModal(null)} onListo={r => { if (r?.aliado_id) navegar(`/crm/veterinarias/${r.aliado_id}`); else cargar() }} />
      <EditarProspecto abierto={modal === 'editar'} prospecto={p} equipo={equipo} onCerrar={() => setModal(null)} onGuardado={cargar} />
      <Modal open={modal === 'perder'} onClose={() => setModal(null)} title="Marcar perdido" maxWidth="max-w-md"
        footer={<><span /><Button variant="danger" disabled={!motivo.trim()} onClick={async () => {
          await crm.moverProspecto(p.id, { etapa: 'PERDIDO', motivo_perdida: motivo }).catch(e => setError(e.message)); setModal(null); cargar()
        }}>Marcar perdido</Button></>}>
        <Campo label="¿Por qué se perdió?"><Textarea rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} /></Campo>
      </Modal>
    </div>
  )
}

function Accion({ icono: I, onClick, children }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12.5px] font-semibold text-gray-700 hover:border-teal-600 hover:text-teal-700">
      <I size={14} /> {children}
    </button>
  )
}

function EditarProspecto({ abierto, prospecto, equipo, onCerrar, onGuardado }) {
  const [f, setF] = useState({})
  const [error, setError] = useState(null)
  const campos = ['nombre', 'contacto_nombre', 'contacto_cargo', 'telefono', 'whatsapp', 'email', 'ciudad', 'localidad', 'barrio',
    'direccion', 'instagram', 'sitio_web', 'potencial_mensual', 'probabilidad', 'responsable_id', 'notas', 'fuente_detalle']
  useEffect(() => { if (abierto) { setError(null); setF(Object.fromEntries(campos.map(k => [k, prospecto[k] ?? '']))) } }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  const txt = k => ({ value: f[k] ?? '', onChange: e => setF(x => ({ ...x, [k]: e.target.value })) })
  async function guardar() {
    try { await crm.guardarProspecto(prospecto.id, f); onGuardado?.(); onCerrar() } catch (e) { setError(e.message) }
  }
  return (
    <Modal open={abierto} onClose={onCerrar} title="Editar prospecto" maxWidth="max-w-2xl"
      footer={<><span className="text-[12px] text-red-600">{error}</span><Button onClick={guardar} style={{ background: ACENTO }}>Guardar</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Nombre" className="sm:col-span-2"><Input {...txt('nombre')} /></Campo>
        <Campo label="Contacto"><Input {...txt('contacto_nombre')} /></Campo>
        <Campo label="Cargo"><Input {...txt('contacto_cargo')} /></Campo>
        <Campo label="Teléfono"><Input {...txt('telefono')} /></Campo>
        <Campo label="WhatsApp"><Input {...txt('whatsapp')} /></Campo>
        <Campo label="Correo"><Input {...txt('email')} /></Campo>
        <Campo label="Ciudad"><Input {...txt('ciudad')} /></Campo>
        <Campo label="Localidad"><LocalidadSelect value={f.localidad || ''} onChange={v => setF(x => ({ ...x, localidad: v }))} /></Campo>
        <Campo label="Barrio"><Input {...txt('barrio')} /></Campo>
        <Campo label="Dirección" className="sm:col-span-2"><Input {...txt('direccion')} /></Campo>
        <Campo label="Instagram"><Input {...txt('instagram')} /></Campo>
        <Campo label="Web"><Input {...txt('sitio_web')} /></Campo>
        <Campo label="Potencial (serv/mes)"><Input type="number" {...txt('potencial_mensual')} /></Campo>
        <Campo label="Probabilidad % (vacío = por etapa)"><Input type="number" min="0" max="100" {...txt('probabilidad')} /></Campo>
        <Campo label="Responsable">
          <Select {...txt('responsable_id')}><option value="">Sin asignar</option>{equipo.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select>
        </Campo>
        <Campo label="Detalle de la fuente"><Input {...txt('fuente_detalle')} /></Campo>
        <Campo label="Notas" className="sm:col-span-2"><Textarea rows={3} {...txt('notas')} /></Campo>
      </div>
    </Modal>
  )
}
