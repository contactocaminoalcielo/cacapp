// Los tres registros que más se hacen en el CRM: una gestión (lo que pasó),
// un seguimiento (lo que toca) y un ticket (lo que la vet reclama).
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  crm, TIPOS_GESTION, RESULTADOS, TICKET_CATEGORIAS, TICKET_TIPOS, PRIORIDADES,
  aInputFechaHora, desdeInputFechaHora, atajoFecha,
} from '@/lib/crmApi'
import { useCrm } from './CrmContext'
import { Campo, ACENTO } from './ui'
import { BotonEnlaceAfiliacion, SeccionPqrs, guardarPqrs } from './VisitaExtras'

const ATAJOS = [['1h', 'En 1 hora'], ['tarde', 'Esta tarde'], ['manana', 'Mañana 9 a. m.'], ['3d', 'En 3 días'], ['semana', 'En 1 semana'], ['mes', 'En 1 mes']]

function SelectorFecha({ valor, onCambio }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ATAJOS.map(([k, t]) => (
          <button key={k} type="button" onClick={() => onCambio(aInputFechaHora(atajoFecha(k)))}
            className="px-2.5 py-1 rounded-full text-[11.5px] font-semibold border border-gray-200 text-gray-600 hover:border-teal-600 hover:text-teal-700">
            {t}
          </button>
        ))}
      </div>
      <Input type="datetime-local" value={valor} onChange={e => onCambio(e.target.value)} />
    </div>
  )
}

/**
 * Registrar una gestión. El caso más común es la LLAMADA: qué resultado tuvo,
 * qué se habló, qué quedó pactado y cuándo se vuelve a llamar.
 */
// `sinSiguiente`: la cuenta pidió no ser contactada; se registra lo que pasó, pero no se programa nada.
export function RegistrarGestion({ abierto, onCerrar, destino, seguimiento = null, tipoInicial = 'LLAMADA', onGuardado, sinSiguiente = false }) {
  const { equipo, refrescarAlertas } = useCrm()
  // Al cerrar una visita programada el formulario arranca en VISITA, no en LLAMADA.
  const tipoDe = () => (['LLAMADA', 'WHATSAPP', 'VISITA', 'REUNION', 'EMAIL', 'NOTA'].includes(seguimiento?.tipo) ? seguimiento.tipo : tipoInicial)
  const [tipo, setTipo] = useState(tipoDe)
  const [pqrs, setPqrs] = useState(null)
  const gestionHecha = useRef(false)   // si solo falló la PQRS, reintentar no duplica la gestión
  const [resultado, setResultado] = useState('')
  const [resumen, setResumen] = useState('')
  const [compromiso, setCompromiso] = useState('')
  const [duracion, setDuracion] = useState('')
  const [conSiguiente, setConSiguiente] = useState(true)
  const [siguiente, setSiguiente] = useState({ tipo: 'LLAMADA', fecha: aInputFechaHora(atajoFecha('3d')), titulo: '', responsable_id: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setTipo(tipoDe()); setResultado(''); setResumen(''); setCompromiso(''); setDuracion(''); setError(null)
    setPqrs(null); gestionHecha.current = false
    setConSiguiente(!sinSiguiente)
    setSiguiente({ tipo: 'LLAMADA', fecha: aInputFechaHora(atajoFecha('3d')), titulo: '', responsable_id: '' })
  }, [abierto, tipoInicial, sinSiguiente, seguimiento?.id])

  // "No contestó" casi siempre es volver a intentar pronto.
  useEffect(() => {
    if (['NO_CONTESTO', 'OCUPADO', 'BUZON'].includes(resultado)) {
      setSiguiente(s => ({ ...s, fecha: aInputFechaHora(atajoFecha(resultado === 'OCUPADO' ? 'tarde' : 'manana')) }))
    }
  }, [resultado])

  const enPersona = tipo === 'VISITA' || tipo === 'REUNION'

  async function guardar() {
    if (enPersona && pqrs && !pqrs.asunto?.trim()) { setError('Escribe el asunto de la PQRS (o ciérrala)'); return }
    setGuardando(true); setError(null)
    try {
      if (!gestionHecha.current) await crm.registrarGestion({
        ...destino, tipo, resultado: resultado || null,
        resumen: resumen || (resultado ? RESULTADOS[resultado] : ''),
        compromiso, duracion_min: duracion || null,
        seguimiento_id: seguimiento?.id || null,
        siguiente: conSiguiente ? {
          tipo: siguiente.tipo, programado_para: desdeInputFechaHora(siguiente.fecha),
          titulo: siguiente.titulo || null, responsable_id: siguiente.responsable_id || null,
        } : null,
      })
      gestionHecha.current = true
      if (enPersona) await guardarPqrs(destino?.aliado_id, pqrs)
      refrescarAlertas()
      onGuardado?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title={seguimiento ? `Gestionar: ${seguimiento.titulo}` : 'Registrar gestión'}
      maxWidth="max-w-xl"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || (!resumen.trim() && !resultado)} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : 'Guardar gestión'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {['LLAMADA', 'WHATSAPP', 'VISITA', 'REUNION', 'EMAIL', 'NOTA'].map(t => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition
                ${tipo === t ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              style={tipo === t ? { background: ACENTO } : undefined}>
              {TIPOS_GESTION[t].emoji} {TIPOS_GESTION[t].label}
            </button>
          ))}
        </div>
        {tipo !== 'NOTA' && (
          <Campo label="Resultado">
            <Select value={resultado} onChange={e => setResultado(e.target.value)}>
              <option value="">— Elige —</option>
              {Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Campo>
        )}
        <Campo label="¿Qué se habló?">
          <Textarea rows={4} value={resumen} onChange={e => setResumen(e.target.value)}
            placeholder="Ej: Habló la Dra. Paula. Este mes les han llegado pocos casos; preguntó por la comisión de agosto…" />
        </Campo>
        {enPersona && (
          <div className="space-y-3">
            <BotonEnlaceAfiliacion aliadoId={destino?.aliado_id} prospectoId={destino?.prospecto_id} onError={setError} />
            <SeccionPqrs pqrs={pqrs} setPqrs={setPqrs}
              aviso={destino?.aliado_id ? null : 'Las PQRS se registran a veterinarias aliadas. Un prospecto primero se afilia.'} />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Campo label="Compromiso / acuerdo" className="sm:col-span-2">
            <Input value={compromiso} onChange={e => setCompromiso(e.target.value)} placeholder="Ej: le enviamos el tarifario hoy" />
          </Campo>
          {tipo === 'LLAMADA' && (
            <Campo label="Duración (min)">
              <Input type="number" min="0" value={duracion} onChange={e => setDuracion(e.target.value)} />
            </Campo>
          )}
        </div>

        {sinSiguiente ? <p className="text-[12px] text-red-600">🚫 Marcada como no contactar: no se programa seguimiento.</p> : (
        <div className="rounded-xl border border-gray-200 p-3 space-y-3">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
            <input type="checkbox" checked={conSiguiente} onChange={e => setConSiguiente(e.target.checked)} />
            Programar el siguiente seguimiento
          </label>
          {conSiguiente && (
            <div className="space-y-3">
              <SelectorFecha valor={siguiente.fecha} onCambio={v => setSiguiente(s => ({ ...s, fecha: v }))} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Campo label="Tipo">
                  <Select value={siguiente.tipo} onChange={e => setSiguiente(s => ({ ...s, tipo: e.target.value }))}>
                    {['LLAMADA', 'WHATSAPP', 'VISITA', 'REUNION', 'TAREA'].map(t => <option key={t} value={t}>{TIPOS_GESTION[t]?.label || 'Tarea'}</option>)}
                  </Select>
                </Campo>
                <Campo label="Qué hacer" className="sm:col-span-2">
                  <Input value={siguiente.titulo} onChange={e => setSiguiente(s => ({ ...s, titulo: e.target.value }))}
                    placeholder="Ej: confirmar si mandó los 2 servicios" />
                </Campo>
              </div>
              {equipo.length > 1 && (
                <Campo label="Responsable">
                  <Select value={siguiente.responsable_id} onChange={e => setSiguiente(s => ({ ...s, responsable_id: e.target.value }))}>
                    <option value="">Yo</option>
                    {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.rol.toLowerCase()}</option>)}
                  </Select>
                </Campo>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </Modal>
  )
}

/** Crear o reprogramar un seguimiento sin registrar gestión. */
export function SeguimientoModal({ abierto, onCerrar, destino, existente = null, onGuardado }) {
  const { equipo, refrescarAlertas } = useCrm()
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setError(null)
    setF(existente
      ? { tipo: existente.tipo, titulo: existente.titulo, notas: '', fecha: aInputFechaHora(existente.programado_para), responsable_id: existente.responsable_id || '' }
      : { tipo: 'LLAMADA', titulo: '', notas: '', fecha: aInputFechaHora(atajoFecha('manana')), responsable_id: '' })
  }, [abierto, existente])

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      if (existente) {
        await crm.cambiarSeguimiento(existente.id, { accion: 'reprogramar', programado_para: desdeInputFechaHora(f.fecha), nota: f.notas || null })
      } else {
        await crm.crearSeguimiento({ ...destino, tipo: f.tipo, titulo: f.titulo, notas: f.notas,
          programado_para: desdeInputFechaHora(f.fecha), responsable_id: f.responsable_id || null })
      }
      refrescarAlertas()
      onGuardado?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title={existente ? 'Reprogramar seguimiento' : 'Programar seguimiento'} maxWidth="max-w-lg"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || (!existente && !f.titulo?.trim())} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">
        {!existente && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Campo label="Tipo">
              <Select value={f.tipo || 'LLAMADA'} onChange={e => setF(x => ({ ...x, tipo: e.target.value }))}>
                {['LLAMADA', 'WHATSAPP', 'VISITA', 'REUNION', 'TAREA'].map(t => <option key={t} value={t}>{TIPOS_GESTION[t]?.label || 'Tarea'}</option>)}
              </Select>
            </Campo>
            <Campo label="Qué hacer" className="sm:col-span-2">
              <Input value={f.titulo || ''} onChange={e => setF(x => ({ ...x, titulo: e.target.value }))} placeholder="Ej: llamar a la Dra. para presentar planes" />
            </Campo>
          </div>
        )}
        <Campo label="Cuándo"><SelectorFecha valor={f.fecha || ''} onCambio={v => setF(x => ({ ...x, fecha: v }))} /></Campo>
        <Campo label={existente ? 'Motivo del cambio (opcional)' : 'Notas'}>
          <Textarea rows={2} value={f.notas || ''} onChange={e => setF(x => ({ ...x, notas: e.target.value }))} />
        </Campo>
        {!existente && equipo.length > 1 && (
          <Campo label="Responsable">
            <Select value={f.responsable_id || ''} onChange={e => setF(x => ({ ...x, responsable_id: e.target.value }))}>
              <option value="">Yo</option>
              {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.rol.toLowerCase()}</option>)}
            </Select>
          </Campo>
        )}
      </div>
    </Modal>
  )
}

/** Abrir un ticket (PQRS de la veterinaria). */
export function TicketModal({ abierto, onCerrar, aliado = null, onCreado }) {
  const { equipo } = useCrm()
  const [vets, setVets] = useState([])
  const [buscar, setBuscar] = useState('')
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    setError(null); setBuscar('')
    setF({ aliado_id: aliado?.id_aliado || '', tipo: 'RECLAMO', categoria: 'COMISION', prioridad: 'MEDIA', canal: 'LLAMADA', asunto: '', descripcion: '', responsable_id: '', servicio_id: '' })
    if (!aliado) crm.cartera().then(r => setVets(r.aliados || [])).catch(() => {})
  }, [abierto, aliado])

  const opciones = vets.filter(v => !buscar.trim() || v.nombre.toLowerCase().includes(buscar.trim().toLowerCase())).slice(0, 50)

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      const r = await crm.crearTicket({ ...f, responsable_id: f.responsable_id || null, servicio_id: f.servicio_id || null })
      onCreado?.(r.ticket)
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Nuevo ticket" maxWidth="max-w-xl"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !f.aliado_id || !f.asunto?.trim()} style={{ background: ACENTO }}>
            {guardando ? 'Creando…' : 'Crear ticket'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">
        {aliado ? (
          <div className="text-[13px] text-gray-600">Veterinaria: <b>{aliado.nombre}</b></div>
        ) : (
          <Campo label="Veterinaria">
            <Input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar veterinaria…" />
            <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-gray-100">
              {opciones.map(v => (
                <button key={v.id_aliado} type="button" onClick={() => { setF(x => ({ ...x, aliado_id: v.id_aliado })); setBuscar(v.nombre) }}
                  className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-gray-50 ${f.aliado_id === v.id_aliado ? 'bg-teal-50 font-semibold' : ''}`}>
                  {v.nombre} <span className="text-gray-400">{v.localidad || v.ciudad || ''}</span>
                </button>
              ))}
            </div>
          </Campo>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Campo label="Tipo">
            <Select value={f.tipo || ''} onChange={e => setF(x => ({ ...x, tipo: e.target.value }))}>
              {Object.entries(TICKET_TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Campo>
          <Campo label="Categoría">
            <Select value={f.categoria || ''} onChange={e => setF(x => ({ ...x, categoria: e.target.value }))}>
              {Object.entries(TICKET_CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Campo>
          <Campo label="Prioridad">
            <Select value={f.prioridad || ''} onChange={e => setF(x => ({ ...x, prioridad: e.target.value }))}>
              {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Campo>
          <Campo label="Canal">
            <Select value={f.canal || ''} onChange={e => setF(x => ({ ...x, canal: e.target.value }))}>
              {['LLAMADA', 'WHATSAPP', 'VISITA', 'EMAIL', 'PORTAL', 'OTRO'].map(c => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
            </Select>
          </Campo>
        </div>
        <Campo label="Asunto">
          <Input value={f.asunto || ''} onChange={e => setF(x => ({ ...x, asunto: e.target.value }))} placeholder="Ej: No le han pagado la comisión de septiembre" />
        </Campo>
        <Campo label="Lo que manifestó la veterinaria">
          <Textarea rows={4} value={f.descripcion || ''} onChange={e => setF(x => ({ ...x, descripcion: e.target.value }))} />
        </Campo>
        {equipo.length > 1 && (
          <Campo label="Responsable">
            <Select value={f.responsable_id || ''} onChange={e => setF(x => ({ ...x, responsable_id: e.target.value }))}>
              <option value="">Yo</option>
              {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.rol.toLowerCase()}</option>)}
            </Select>
          </Campo>
        )}
        <p className="text-[11.5px] text-gray-400">El plazo de respuesta se fija solo según la prioridad (configurable en Ajustes).</p>
      </div>
    </Modal>
  )
}

const MOTIVOS_BLOQUEO = [
  'No quiere saber nada de la empresa',
  'Pidió no recibir publicidad ni llamadas',
  'Trabaja con otra funeraria y pidió no insistir',
  'Tuvo una mala experiencia con nosotros',
  'La clínica cerró',
]

/**
 * Marcar o quitar "No contactar". Bloquea publicidad y gestión comercial
 * (campañas, plantillas, hitos, seguimientos, agente de ventas). La operación
 * sigue: si manda un servicio, se le atiende y le llegan recibos y avisos.
 */
export function BloqueoModal({ abierto, onCerrar, destino, nombre, bloqueada, onListo }) {
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (abierto) { setMotivo(''); setError(null) } }, [abierto])

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      const fn = destino.aliado_id ? crm.bloqueoAliado : crm.bloqueoProspecto
      await fn(destino.aliado_id || destino.prospecto_id, { bloquear: !bloqueada, motivo })
      onListo?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title={bloqueada ? `Volver a contactar: ${nombre}` : `No contactar: ${nombre}`} maxWidth="max-w-lg"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          {bloqueada
            ? <Button onClick={guardar} disabled={guardando} style={{ background: ACENTO }}>{guardando ? 'Guardando…' : 'Desbloquear'}</Button>
            : <Button variant="danger" onClick={guardar} disabled={guardando || !motivo.trim()}>{guardando ? 'Guardando…' : 'Marcar no contactar'}</Button>}
        </div>
      </>}>
      {bloqueada ? (
        <div className="space-y-3 text-[13px] text-gray-700">
          <p>Vuelve a recibir campañas, plantillas, hitos y seguimientos. Queda anotado en la bitácora.</p>
          <Campo label="¿Por qué se desbloquea? (opcional)">
            <Input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: nos volvió a escribir interesada" />
          </Campo>
        </div>
      ) : (
        <div className="space-y-3 text-[13px] text-gray-700">
          <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-[12.5px] text-red-800 space-y-1">
            <p><b>Deja de recibir:</b> campañas masivas, plantillas y recursos del CRM, mensajes de hitos, llamadas programadas y el agente de ventas.</p>
            <p>Se cancelan sus seguimientos pendientes{destino.prospecto_id ? ' y el prospecto pasa a Perdido' : ''}.</p>
          </div>
          <p className="text-[12px] text-gray-500"><b>La operación sigue igual:</b> si manda un servicio, le llegan el aviso de recogida, el recibo y el certificado. Si nos escribe, se le responde.</p>
          <Campo label="¿Por qué no quiere ser contactada?">
            <Textarea rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} />
          </Campo>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_BLOQUEO.map(m => (
              <button key={m} type="button" onClick={() => setMotivo(m)}
                className="px-2.5 py-1 rounded-full border border-gray-200 text-[11.5px] text-gray-600 hover:bg-gray-50">{m}</button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Franja roja en la ficha de quien pidió no ser contactada. */
export function AvisoNoContactar({ ficha, onDesbloquear }) {
  if (!ficha?.no_contactar) return null
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="text-[13px] text-red-800">
        <b>🚫 No contactar.</b> {ficha.no_contactar_motivo}
        <span className="text-red-600/70 text-[12px]"> · desde {new Date(ficha.no_contactar_desde).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
        <div className="text-[11.5px] text-red-700/80">No recibe publicidad ni gestión comercial. Si manda un servicio, la operación la atiende normal.</div>
      </div>
      {onDesbloquear && <Button size="sm" variant="secondary" onClick={onDesbloquear}>Desbloquear</Button>}
    </div>
  )
}
