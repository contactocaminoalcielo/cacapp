// Modal para programar una visita presencial desde el calendario.
// Tiene dos modos: (1) veterinaria/prospecto EXISTENTE; (2) NUEVO establecimiento
// que crea el prospecto al vuelo y le programa la visita.
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { crm, TIPOS_GESTION, TICKET_TIPOS, TICKET_CATEGORIAS, aInputFechaHora, desdeInputFechaHora, atajoFecha } from '@/lib/crmApi'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { useCrm } from './CrmContext'
import { Campo, ACENTO } from './ui'
import { Camera, Building2, Users, LifeBuoy, ChevronDown, ChevronUp } from 'lucide-react'

const TIPOS = ['VISITA', 'REUNION']
const ATAJOS = [['manana', 'Mañana 9 a. m.'], ['3d', 'En 3 días'], ['semana', 'En 1 semana'], ['mes', 'En 1 mes']]

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

// Redimensiona una imagen a max 800px y devuelve { base64, mime, miniatura }
function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const MAX = 800, MINI = 120
        const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
        const ratio = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio)
        const c = canvas(w, h)
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        const ratiom = Math.min(1, MINI / Math.max(img.width, img.height))
        const wm = Math.round(img.width * ratiom), hm = Math.round(img.height * ratiom)
        const cm = canvas(wm, hm)
        cm.getContext('2d').drawImage(img, 0, 0, wm, hm)
        resolve({ base64: c.toDataURL('image/jpeg', 0.82), mime: 'image/jpeg', miniatura: cm.toDataURL('image/jpeg', 0.6) })
      }
      img.onerror = reject
      img.src = ev.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Sección: selector de vet existente ──────────────────────────────────────
function SelectorVetExistente({ aliados, buscar, setBuscar, aliadoId, onSeleccionar }) {
  return (
    <Campo label="Veterinaria">
      <Input placeholder="Buscar por nombre…" value={buscar}
        onChange={e => { setBuscar(e.target.value); onSeleccionar('') }} />
      {!aliadoId && buscar.length > 1 && (
        <div className="mt-1 rounded-xl border border-gray-200 max-h-48 overflow-y-auto shadow-sm">
          {!aliados
            ? <div className="px-3 py-2 text-[12px] text-gray-400">Cargando…</div>
            : aliados.filter(a => a.nombre.toLowerCase().includes(buscar.toLowerCase())).slice(0, 30).length === 0
              ? <div className="px-3 py-2 text-[12px] text-gray-400">Sin resultados</div>
              : aliados.filter(a => a.nombre.toLowerCase().includes(buscar.toLowerCase())).slice(0, 30).map(a => (
                <button key={a.id_aliado} type="button"
                  onClick={() => { onSeleccionar(a.id_aliado); setBuscar(a.nombre) }}
                  className="w-full text-left px-3 py-2 text-[12.5px] text-gray-800 hover:bg-teal-50 border-b border-gray-50 last:border-0">
                  {a.nombre}
                  {a.estado !== 'activo' && <span className="ml-1.5 text-[11px] text-gray-400">· {a.estado}</span>}
                </button>
              ))}
        </div>
      )}
      {aliadoId && (
        <div className="mt-1 flex items-center justify-between text-[12px] text-teal-700 font-semibold">
          <span>✓ {buscar}</span>
          <button type="button" onClick={() => { onSeleccionar(''); setBuscar('') }}
            className="text-gray-400 hover:text-gray-600 text-[11px]">Cambiar</button>
        </div>
      )}
    </Campo>
  )
}

// ── Sección: datos del nuevo establecimiento ─────────────────────────────────
function FormNuevoProspecto({ f, setF, fotoPreview, onFoto }) {
  const fileRef = useRef()
  return (
    <div className="space-y-3">
      {/* Foto / logo */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => fileRef.current.click()}
          className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 hover:border-teal-500 flex flex-col items-center justify-center text-gray-400 hover:text-teal-600 transition overflow-hidden flex-shrink-0">
          {fotoPreview
            ? <img src={fotoPreview} alt="" className="w-full h-full object-cover" />
            : <><Camera size={20} /><span className="text-[10px] mt-0.5">Logo</span></>}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFoto} />
        <div className="flex-1 space-y-2">
          <Input value={f.nombre || ''} onChange={e => setF(x => ({ ...x, nombre: e.target.value }))}
            placeholder="Nombre del establecimiento *" className="text-[13px]" />
          <Input value={f.contacto_nombre || ''} onChange={e => setF(x => ({ ...x, contacto_nombre: e.target.value }))}
            placeholder="Nombre del contacto" className="text-[13px]" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Campo label="WhatsApp">
          <Input value={f.whatsapp || ''} onChange={e => setF(x => ({ ...x, whatsapp: e.target.value }))}
            placeholder="3001234567" inputMode="tel" />
        </Campo>
        <Campo label="Teléfono fijo">
          <Input value={f.telefono || ''} onChange={e => setF(x => ({ ...x, telefono: e.target.value }))}
            placeholder="Opcional" inputMode="tel" />
        </Campo>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Campo label="Ciudad">
          <Input value={f.ciudad || ''} onChange={e => setF(x => ({ ...x, ciudad: e.target.value }))}
            placeholder="Bogotá" />
        </Campo>
        <Campo label="Localidad">
          <LocalidadSelect value={f.localidad || ''} onChange={v => setF(x => ({ ...x, localidad: v }))} />
        </Campo>
      </div>

      <Campo label="Dirección">
        <Input value={f.direccion || ''} onChange={e => setF(x => ({ ...x, direccion: e.target.value }))}
          placeholder="Calle 63 # 9-30 Local 101" />
      </Campo>

      <Campo label="Notas del establecimiento">
        <Textarea rows={2} value={f.notasProspecto || ''} onChange={e => setF(x => ({ ...x, notasProspecto: e.target.value }))}
          placeholder="Especialidad, número de veterinarios, observaciones…" />
      </Campo>
    </div>
  )
}

// ── Modal principal ──────────────────────────────────────────────────────────
export default function NuevaVisitaModal({ abierto, onCerrar, fechaInicial = null, onGuardado }) {
  const { equipo, refrescarAlertas } = useCrm()
  const [modo, setModo] = useState('existente')   // 'existente' | 'nuevo'
  const [aliados, setAliados] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [f, setF] = useState({})
  const [foto, setFoto] = useState(null)           // { base64, mime, miniatura }
  const [fotoPreview, setFotoPreview] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [pqrs, setPqrs] = useState(null)  // null=oculto | {}=habilitado

  function fechaDesde(dia) {
    if (dia) {
      const d = new Date(dia + 'T09:00:00')
      if (!isNaN(d.getTime())) return aInputFechaHora(d)
    }
    return aInputFechaHora(atajoFecha('manana'))
  }

  useEffect(() => {
    if (!abierto) return
    setError(null); setBuscar(''); setFoto(null); setFotoPreview(null); setPqrs(null)
    setF({ tipo: 'VISITA', aliado_id: '', titulo: '', notas: '', fecha: fechaDesde(fechaInicial),
           responsable_id: '', nombre: '', contacto_nombre: '', whatsapp: '', telefono: '',
           ciudad: 'Bogotá', localidad: '', direccion: '', notasProspecto: '' })
    setModo('existente')
  }, [abierto, fechaInicial])

  useEffect(() => {
    if (!abierto || aliados) return
    crm.cartera().then(r => setAliados(r.aliados || [])).catch(() => setAliados([]))
  }, [abierto, aliados])

  async function manejarFoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const c = await comprimirImagen(file)
      setFoto(c); setFotoPreview(c.base64)
    } catch { setError('No se pudo procesar la imagen') }
    e.target.value = ''
  }

  async function guardar() {
    if (!f.titulo?.trim()) { setError('Escribe qué se va a hacer en la visita'); return }
    if (modo === 'existente' && !f.aliado_id) { setError('Selecciona una veterinaria'); return }
    if (modo === 'nuevo' && !f.nombre?.trim()) { setError('Escribe el nombre del establecimiento'); return }
    setGuardando(true); setError(null)
    try {
      let aliadoId = f.aliado_id || null, prospectoId = null

      if (modo === 'nuevo') {
        const r = await crm.crearProspecto({
          nombre: f.nombre, contacto_nombre: f.contacto_nombre || null,
          whatsapp: f.whatsapp || null, telefono: f.telefono || null,
          ciudad: f.ciudad || null, localidad: f.localidad || null,
          direccion: f.direccion || null, notas: f.notasProspecto || null,
          fuente: 'VISITA',
        })
        if (!r.ok) { setError(r.error || 'No se pudo crear el prospecto'); setGuardando(false); return }
        prospectoId = r.prospecto.id

        if (foto) {
          await crm.subirFoto({ prospecto_id: prospectoId, base64: foto.base64,
            mime: foto.mime, miniatura: foto.miniatura, descripcion: 'Logo / foto del establecimiento' })
            .catch(() => {})
        }
      }

      await crm.crearSeguimiento({
        aliado_id: aliadoId || undefined, prospecto_id: prospectoId || undefined,
        tipo: f.tipo, titulo: f.titulo, notas: f.notas || null,
        programado_para: desdeInputFechaHora(f.fecha),
        responsable_id: f.responsable_id || null,
      })

      if (pqrs && pqrs.asunto?.trim() && aliadoId) {
        await crm.crearTicket({
          aliado_id: aliadoId,
          tipo: pqrs.tipo || 'PETICION',
          categoria: pqrs.categoria || 'OTRO',
          prioridad: pqrs.prioridad || 'MEDIA',
          canal: 'VISITA',
          asunto: pqrs.asunto.trim(),
          descripcion: pqrs.descripcion || null,
        }).catch(() => {})
      }

      refrescarAlertas()
      onGuardado?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Programar visita presencial" maxWidth="max-w-lg"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : modo === 'nuevo' ? 'Crear y programar' : 'Programar'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">

        {/* Toggle de modo */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-[12.5px] font-semibold">
          {[['existente', <Users size={13} />, 'Vet existente'], ['nuevo', <Building2 size={13} />, 'Nuevo establecimiento']].map(([k, ic, lb]) => (
            <button key={k} type="button" onClick={() => { setModo(k); setError(null) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition ${
                modo === k ? 'text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
              style={modo === k ? { background: ACENTO } : undefined}>
              {ic}{lb}
            </button>
          ))}
        </div>

        {/* Tipo de seguimiento */}
        <div className="flex gap-2">
          {TIPOS.map(t => (
            <button key={t} type="button" onClick={() => setF(x => ({ ...x, tipo: t }))}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold border transition ${
                f.tipo === t ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              style={f.tipo === t ? { background: ACENTO } : undefined}>
              {TIPOS_GESTION[t]?.emoji} {TIPOS_GESTION[t]?.label}
            </button>
          ))}
        </div>

        {/* Contenido según modo */}
        {modo === 'existente'
          ? <SelectorVetExistente aliados={aliados} buscar={buscar} setBuscar={setBuscar}
              aliadoId={f.aliado_id} onSeleccionar={v => setF(x => ({ ...x, aliado_id: v }))} />
          : <FormNuevoProspecto f={f} setF={setF} fotoPreview={fotoPreview} onFoto={manejarFoto} />
        }

        {/* Qué hacer */}
        <Campo label="¿Qué se va a hacer?">
          <Input value={f.titulo || ''} onChange={e => setF(x => ({ ...x, titulo: e.target.value }))}
            placeholder="Ej: presentar plan grupal y tarifas 2027" />
        </Campo>

        {/* Cuándo */}
        <Campo label="Cuándo">
          <SelectorFecha valor={f.fecha || ''} onCambio={v => setF(x => ({ ...x, fecha: v }))} />
        </Campo>

        {/* Notas de la visita */}
        <Campo label="Notas de la visita (opcional)">
          <Textarea rows={2} value={f.notas || ''} onChange={e => setF(x => ({ ...x, notas: e.target.value }))}
            placeholder="Ej: preguntar por la nueva administradora, llevar brochure" />
        </Campo>

        {/* Responsable */}
        {equipo.length > 1 && (
          <Campo label="Responsable">
            <Select value={f.responsable_id || ''} onChange={e => setF(x => ({ ...x, responsable_id: e.target.value }))}>
              <option value="">Yo</option>
              {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.rol.toLowerCase()}</option>)}
            </Select>
          </Campo>
        )}

        {/* PQRS opcional — solo para vet existente seleccionada */}
        {modo === 'existente' && f.aliado_id && (
          <div className="rounded-xl border border-dashed border-gray-300 overflow-hidden">
            <button type="button"
              onClick={() => setPqrs(p => p ? null : { tipo: 'PETICION', categoria: 'OTRO', prioridad: 'MEDIA', asunto: '', descripcion: '' })}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50 transition">
              <LifeBuoy size={14} style={{ color: pqrs ? ACENTO : undefined }} />
              <span className="flex-1 text-left">
                {pqrs ? 'Registrar PQRS también' : 'También registrar una PQRS'}
              </span>
              {pqrs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {pqrs && (
              <div className="px-3.5 pb-3.5 space-y-3 border-t border-gray-100 pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <Campo label="Tipo">
                    <Select value={pqrs.tipo || 'PETICION'} onChange={e => setPqrs(p => ({ ...p, tipo: e.target.value }))}>
                      {Object.entries(TICKET_TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Campo>
                  <Campo label="Categoría">
                    <Select value={pqrs.categoria || 'OTRO'} onChange={e => setPqrs(p => ({ ...p, categoria: e.target.value }))}>
                      {Object.entries(TICKET_CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Campo>
                </div>
                <Campo label="Asunto *">
                  <Input value={pqrs.asunto || ''} onChange={e => setPqrs(p => ({ ...p, asunto: e.target.value }))}
                    placeholder="Ej: Cobro incorrecto en comisión de octubre" />
                </Campo>
                <Campo label="Descripción">
                  <Textarea rows={2} value={pqrs.descripcion || ''} onChange={e => setPqrs(p => ({ ...p, descripcion: e.target.value }))}
                    placeholder="Detalles del caso…" />
                </Campo>
                <p className="text-[11px] text-gray-400">El ticket quedará con canal <b>Visita</b> y prioridad <b>Media</b>.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
