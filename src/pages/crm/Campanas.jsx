// Módulo de campañas CRM: envíos masivos de plantillas WA a la cartera de
// aliadas y prospectos, con seguimiento de embudo por destinatario.
import { useEffect, useState } from 'react'
import {
  Plus, Send, Eye, Trash2, ChevronDown, ChevronUp, CheckCircle2,
  XCircle, Clock, AlertTriangle, Megaphone, Edit2,
} from 'lucide-react'
import { crm, fechaCorta, fechaHora } from '@/lib/crmApi'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Cabecera, Cargando, ErrorCaja, Campo, ACENTO } from '@/components/crm/ui'

// ── Catálogos ────────────────────────────────────────────────────────────────
const AUDIENCIAS = {
  TODAS:       { label: 'Todas las aliadas', ayuda: 'Todas con WhatsApp, sin importar actividad' },
  ACTIVAS:     { label: 'Activas y nuevas',  ayuda: 'Activas en los últimos 60 días' },
  ENFRIANDOSE: { label: 'Enfriándose',       ayuda: 'Sin actividad entre 30 y 60 días' },
  EN_RIESGO:   { label: 'En riesgo',         ayuda: 'Sin actividad entre 60 y 90 días' },
  DORMIDAS:    { label: 'Dormidas',           ayuda: 'Sin actividad hace más de 90 días' },
  PROSPECTOS:  { label: 'Prospectos abiertos', ayuda: 'Prospectos que no son GANADOS ni PERDIDOS' },
}

const ESTADOS_CAMPANA = {
  BORRADOR:   { label: 'Borrador',    color: '#6B7280', bg: '#F3F4F6' },
  LISTA:      { label: 'Lista',       color: '#2563EB', bg: '#EFF6FF' },
  ENVIANDO:   { label: 'Enviando…',   color: '#D97706', bg: '#FFFBEB' },
  COMPLETADA: { label: 'Completada',  color: '#059669', bg: '#ECFDF5' },
  CANCELADA:  { label: 'Cancelada',   color: '#DC2626', bg: '#FEF2F2' },
}

const pct = (n, t) => t > 0 ? Math.round((n / t) * 100) : 0

// ── Chip de estado ────────────────────────────────────────────────────────────
function EstadoChip({ estado }) {
  const e = ESTADOS_CAMPANA[estado] || ESTADOS_CAMPANA.BORRADOR
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: e.color, background: e.bg }}>{e.label}</span>
  )
}

// ── Barra de embudo ───────────────────────────────────────────────────────────
function Embudo({ campana }) {
  const { total = 0, enviados = 0, fallidos = 0 } = campana
  if (!total) return <span className="text-[12px] text-gray-400">Sin destinatarios aún</span>
  const pEnv = pct(enviados, total)
  const pFal = pct(fallidos, total)
  return (
    <div className="space-y-1">
      <div className="flex rounded-full overflow-hidden h-2 bg-gray-100 gap-px">
        <div style={{ width: `${pEnv}%`, background: '#059669' }} />
        <div style={{ width: `${pFal}%`, background: '#EF4444' }} />
      </div>
      <div className="flex gap-3 text-[11px] text-gray-500">
        <span><span className="font-semibold text-gray-700">{total}</span> dest.</span>
        <span className="text-green-700"><CheckCircle2 size={11} className="inline mr-0.5" />{enviados} enviados ({pEnv}%)</span>
        {fallidos > 0 && <span className="text-red-600"><XCircle size={11} className="inline mr-0.5" />{fallidos} fallidos</span>}
      </div>
    </div>
  )
}

// ── Tarjeta de campaña ────────────────────────────────────────────────────────
function TarjetaCampana({ campana, onEnviar, onEditar, onBorrar }) {
  const [expandido, setExpandido] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(false)

  async function cargarDetalle() {
    if (detalle) { setExpandido(x => !x); return }
    setCargando(true)
    try {
      const r = await crm.campana(campana.id)
      setDetalle(r); setExpandido(true)
    } catch { } finally { setCargando(false) }
  }

  const puedeEnviar = ['BORRADOR', 'LISTA'].includes(campana.estado)
  const puedeBorrar = !['ENVIANDO'].includes(campana.estado)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#F0FDF4' }}>
            <Megaphone size={18} style={{ color: ACENTO }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900 text-[14px] truncate">{campana.nombre}</span>
              <EstadoChip estado={campana.estado} />
            </div>
            {campana.descripcion && (
              <p className="text-[12.5px] text-gray-500 mb-2 line-clamp-2">{campana.descripcion}</p>
            )}
            <div className="flex flex-wrap gap-3 text-[12px] text-gray-500 mb-3">
              {campana.plantilla_nombre && (
                <span className="font-mono bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 text-[11px]">{campana.plantilla_nombre}</span>
              )}
              <span>{AUDIENCIAS[campana.tipo_audiencia]?.label || campana.tipo_audiencia}</span>
              {campana.agente_nombre && <span>· {campana.agente_nombre}</span>}
              {campana.programada_para && <span className="flex items-center gap-1"><Clock size={11} />{fechaHora(campana.programada_para)}</span>}
            </div>
            <Embudo campana={campana} />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5 flex items-center gap-2">
        {puedeEnviar && (
          <Button onClick={() => onEnviar(campana)} className="text-[12px] h-8 px-3"
            style={{ background: ACENTO }}>
            <Send size={13} /> Enviar ahora
          </Button>
        )}
        <Button variant="secondary" onClick={() => onEditar(campana)} className="text-[12px] h-8 px-3">
          <Edit2 size={13} /> Editar
        </Button>
        <button onClick={cargarDetalle}
          className="flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100">
          {cargando ? 'Cargando…' : expandido ? <><ChevronUp size={14} />Ocultar</> : <><ChevronDown size={14} />Ver envíos</>}
        </button>
        <div className="flex-1" />
        {puedeBorrar && (
          <button onClick={() => onBorrar(campana)}
            className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {expandido && detalle && (
        <div className="border-t border-gray-100">
          <TablaEnvios envios={detalle.envios || []} />
        </div>
      )}
    </div>
  )
}

// ── Tabla de envíos individuales ──────────────────────────────────────────────
const ESTADO_ENVIO = {
  PENDIENTE: { label: 'Pendiente', color: '#D97706', icon: <Clock size={12} /> },
  ENVIADO:   { label: 'Enviado',   color: '#059669', icon: <CheckCircle2 size={12} /> },
  FALLIDO:   { label: 'Falló',     color: '#DC2626', icon: <XCircle size={12} /> },
}

function TablaEnvios({ envios }) {
  if (!envios.length) return <div className="px-5 py-4 text-[13px] text-gray-400">Sin envíos registrados aún.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-4 py-2.5 text-gray-500 font-semibold">Destinatario</th>
            <th className="text-left px-4 py-2.5 text-gray-500 font-semibold">Número</th>
            <th className="text-left px-4 py-2.5 text-gray-500 font-semibold">Estado</th>
            <th className="text-left px-4 py-2.5 text-gray-500 font-semibold">Enviado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {envios.map(e => {
            const est = ESTADO_ENVIO[e.estado] || ESTADO_ENVIO.PENDIENTE
            return (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">{e.nombre_destino || e.nombre_aliado || '—'}</td>
                <td className="px-4 py-2 font-mono text-gray-500">{e.numero_wa}</td>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-1" style={{ color: est.color }}>
                    {est.icon}{est.label}
                  </span>
                  {e.error && <span className="text-[11px] text-red-500 block truncate max-w-[220px]">{e.error}</span>}
                </td>
                <td className="px-4 py-2 text-gray-400">{e.enviado_en ? fechaHora(e.enviado_en) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Modal de crear / editar campaña ──────────────────────────────────────────
function ModalCampana({ campana, agentes, onCerrar, onGuardado }) {
  const abierto = campana !== undefined
  const esNueva = campana === null
  const [f, setF] = useState({})
  const [variables, setVariables] = useState([])
  const [previa, setPrevia] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto) return
    if (esNueva) {
      setF({ nombre: '', descripcion: '', tipo_audiencia: 'ACTIVAS', plantilla_nombre: '', idioma: 'es_MX', agente_id: '', programada_para: '' })
      setVariables([])
    } else if (campana) {
      setF({ ...campana, agente_id: campana.agente_id ? String(campana.agente_id) : '', programada_para: campana.programada_para ? campana.programada_para.slice(0, 16) : '' })
      const vars = campana.variables_plantilla || {}
      setVariables(Object.entries(vars).map(([clave, valor]) => ({ clave, valor })))
    }
    setPrevia(null); setError(null)
  }, [campana])

  async function cargarPrevia() {
    if (!campana?.id) return
    try {
      const r = await crm.previaCampana(campana.id)
      setPrevia(r)
    } catch (e) { setError(e.message) }
  }

  async function guardar() {
    if (!f.nombre?.trim()) { setError('Falta el nombre'); return }
    setGuardando(true); setError(null)
    try {
      const varsObj = Object.fromEntries(variables.filter(v => v.clave?.trim()).map(v => [v.clave.trim(), v.valor]))
      const datos = {
        ...f,
        variables_plantilla: Object.keys(varsObj).length ? varsObj : null,
        agente_id: f.agente_id ? Number(f.agente_id) : null,
        programada_para: f.programada_para ? new Date(f.programada_para).toISOString() : null,
      }
      if (esNueva) await crm.crearCampana(datos)
      else await crm.guardarCampana(campana.id, datos)
      onGuardado()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  if (!abierto) return null
  return (
    <Modal open={abierto} onClose={onCerrar} title={esNueva ? 'Nueva campaña' : 'Editar campaña'} maxWidth="max-w-lg"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">
        <Campo label="Nombre de la campaña *">
          <Input value={f.nombre || ''} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))}
            placeholder="Ej: Bienvenida vets nuevas — oct 2026" />
        </Campo>

        <Campo label="Descripción">
          <Textarea rows={2} value={f.descripcion || ''} onChange={e => setF(x => ({ ...x, descripcion: e.target.value }))}
            placeholder="Para qué es esta campaña…" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Audiencia">
            <Select value={f.tipo_audiencia || 'ACTIVAS'} onChange={e => setF(x => ({ ...x, tipo_audiencia: e.target.value }))}>
              {Object.entries(AUDIENCIAS).map(([k, v]) => (
                <option key={k} value={k} title={v.ayuda}>{v.label}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Línea (agente)">
            <Select value={f.agente_id || ''} onChange={e => setF(x => ({ ...x, agente_id: e.target.value }))}>
              <option value="">Agente por defecto</option>
              {(agentes || []).map(a => <option key={a.id} value={String(a.id)}>{a.nombre}</option>)}
            </Select>
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nombre de la plantilla *">
            <Input value={f.plantilla_nombre || ''} onChange={e => setF(x => ({ ...x, plantilla_nombre: e.target.value }))}
              placeholder="ej: saludo_veterinarias" className="font-mono text-[12px]" />
          </Campo>
          <Campo label="Idioma">
            <Select value={f.idioma || 'es_MX'} onChange={e => setF(x => ({ ...x, idioma: e.target.value }))}>
              <option value="es_MX">Español (MX)</option>
              <option value="es_CO">Español (CO)</option>
              <option value="es">Español</option>
            </Select>
          </Campo>
        </div>

        {/* Variables de la plantilla */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12px] font-semibold text-gray-700">Variables de la plantilla</label>
            <button type="button" onClick={() => setVariables(v => [...v, { clave: '', valor: '' }])}
              className="text-[11.5px] text-teal-700 hover:text-teal-900 font-semibold">+ Agregar</button>
          </div>
          <p className="text-[11.5px] text-gray-400 mb-2">
            Usa <code className="bg-gray-100 px-1 rounded">{'{{nombre}}'}</code> en los valores para insertar el nombre del destinatario.
          </p>
          {variables.map((v, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <Input value={v.clave} onChange={e => setVariables(arr => arr.map((x, j) => j === i ? { ...x, clave: e.target.value } : x))}
                placeholder="BODY:1 o nombre_var" className="font-mono text-[12px] w-36 flex-shrink-0" />
              <Input value={v.valor} onChange={e => setVariables(arr => arr.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))}
                placeholder="Valor (ej: Estimada {{nombre}})" className="text-[12px] flex-1" />
              <button type="button" onClick={() => setVariables(arr => arr.filter((_, j) => j !== i))}
                className="text-red-400 hover:text-red-600 px-1"><XCircle size={15} /></button>
            </div>
          ))}
          {variables.length === 0 && <p className="text-[12px] text-gray-400">Sin variables — la plantilla no lleva parámetros.</p>}
        </div>

        <Campo label="Programar para (opcional)">
          <Input type="datetime-local" value={f.programada_para || ''}
            onChange={e => setF(x => ({ ...x, programada_para: e.target.value }))} />
        </Campo>

        {/* Vista previa de destinatarios (solo al editar) */}
        {!esNueva && (
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12.5px] font-semibold text-gray-700">Destinatarios estimados</span>
              <button type="button" onClick={cargarPrevia}
                className="text-[11.5px] text-teal-700 hover:text-teal-900 font-semibold">Calcular</button>
            </div>
            {previa
              ? <div className="text-[12px] text-gray-600">
                  <strong>{previa.total}</strong> destinatario{previa.total !== 1 ? 's' : ''}
                  {previa.destinatarios?.slice(0, 5).map((d, i) => (
                    <span key={i} className="ml-1.5 text-gray-400">· {d.nombre_destino}</span>
                  ))}
                  {previa.total > 5 && <span className="text-gray-400"> …y {previa.total - 5} más</span>}
                </div>
              : <p className="text-[12px] text-gray-400">Haz clic en "Calcular" para ver cuántos recibirán esta campaña.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Campanas() {
  const { confirm } = useConfirm()
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [agentes, setAgentes] = useState([])
  const [modal, setModal] = useState(undefined)  // undefined=cerrado, null=nueva, obj=editar
  const [enviando, setEnviando] = useState(null)

  const cargar = () => {
    setError(null)
    Promise.all([crm.campanas(), crm.agentes()]).then(([c, a]) => {
      setLista(c.campanas || [])
      setAgentes(a.agentes || [])
    }).catch(e => setError(e.message))
  }
  useEffect(cargar, [])

  async function handleEnviar(campana) {
    const ok = await confirm(
      `¿Enviar la campaña "${campana.nombre}" ahora?\n\nEsto mandará la plantilla "${campana.plantilla_nombre || '(sin plantilla)'}" a los destinatarios de "${AUDIENCIAS[campana.tipo_audiencia]?.label}". No se puede deshacer.`,
      { title: 'Confirmar envío', ok: 'Sí, enviar', cancel: 'Cancelar' }
    )
    if (!ok) return
    setEnviando(campana.id)
    try {
      const r = await crm.enviarCampana(campana.id)
      setEnviando(null)
      cargar()
      if (r.ok) alert(`Campaña enviada: ${r.enviados} exitosos, ${r.fallidos} fallidos de ${r.total} destinatarios.`)
    } catch (e) { setEnviando(null); alert(e.message) }
  }

  async function handleBorrar(campana) {
    const ok = await confirm(`¿Eliminar la campaña "${campana.nombre}"?`, { title: 'Borrar campaña', ok: 'Eliminar', cancel: 'Cancelar' })
    if (!ok) return
    try { await crm.borrarCampana(campana.id); cargar() } catch (e) { alert(e.message) }
  }

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!lista) return <Cargando />

  const stats = {
    total: lista.length,
    completadas: lista.filter(c => c.estado === 'COMPLETADA').length,
    enviados: lista.reduce((a, c) => a + (c.enviados || 0), 0),
    fallidos: lista.reduce((a, c) => a + (c.fallidos || 0), 0),
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Cabecera titulo="Campañas" sub="Envíos masivos de plantillas WhatsApp a tu cartera y prospectos">
        <Button onClick={() => setModal(null)} style={{ background: ACENTO }}>
          <Plus size={14} /> Nueva campaña
        </Button>
      </Cabecera>

      {lista.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            ['Campañas', stats.total, '#6B7280'],
            ['Completadas', stats.completadas, '#059669'],
            ['Enviados', stats.enviados, '#2563EB'],
            ['Fallidos', stats.fallidos, '#DC2626'],
          ].map(([lb, v, c]) => (
            <div key={lb} className="bg-white rounded-xl border border-gray-200 p-3.5 text-center">
              <div className="text-[22px] font-bold" style={{ color: c }}>{v.toLocaleString()}</div>
              <div className="text-[11.5px] text-gray-500 mt-0.5">{lb}</div>
            </div>
          ))}
        </div>
      )}

      {lista.length === 0
        ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Megaphone size={40} className="mb-3 opacity-30" />
            <p className="text-[14px] font-medium">Sin campañas todavía</p>
            <p className="text-[12.5px] mt-1">Crea tu primera campaña para mandar plantillas en masa</p>
            <Button onClick={() => setModal(null)} className="mt-4" style={{ background: ACENTO }}>
              <Plus size={14} /> Nueva campaña
            </Button>
          </div>
        )
        : (
          <div className="space-y-3">
            {lista.map(c => (
              <TarjetaCampana key={c.id}
                campana={enviando === c.id ? { ...c, estado: 'ENVIANDO' } : c}
                onEnviar={handleEnviar}
                onEditar={() => setModal(c)}
                onBorrar={handleBorrar}
              />
            ))}
          </div>
        )}

      <ModalCampana
        campana={modal}
        agentes={agentes}
        onCerrar={() => setModal(undefined)}
        onGuardado={() => { setModal(undefined); cargar() }}
      />
    </div>
  )
}
