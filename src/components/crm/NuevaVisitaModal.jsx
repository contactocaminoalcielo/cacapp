// Modal para programar una visita presencial desde el calendario.
// A diferencia de SeguimientoModal, incluye un selector de veterinaria/prospecto,
// porque en el calendario no hay un destino preseleccionado.
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { crm, TIPOS_GESTION, aInputFechaHora, desdeInputFechaHora, atajoFecha } from '@/lib/crmApi'
import { useCrm } from './CrmContext'
import { Campo, ACENTO } from './ui'

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

export default function NuevaVisitaModal({ abierto, onCerrar, fechaInicial = null, onGuardado }) {
  const { equipo, refrescarAlertas } = useCrm()
  const [aliados, setAliados] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  function fechaDesde(dia) {
    if (dia) {
      const d = new Date(dia + 'T09:00:00')
      if (!isNaN(d.getTime())) return aInputFechaHora(d)
    }
    return aInputFechaHora(atajoFecha('manana'))
  }

  useEffect(() => {
    if (!abierto) return
    setError(null)
    setBuscar('')
    setF({ tipo: 'VISITA', aliado_id: '', titulo: '', notas: '', fecha: fechaDesde(fechaInicial), responsable_id: '' })
  }, [abierto, fechaInicial])

  useEffect(() => {
    if (!abierto || aliados) return
    crm.cartera().then(r => setAliados(r.aliados || [])).catch(() => setAliados([]))
  }, [abierto, aliados])

  const aliadosFiltrados = (aliados || [])
    .filter(a => !buscar || a.nombre.toLowerCase().includes(buscar.toLowerCase()))
    .slice(0, 30)

  async function guardar() {
    if (!f.aliado_id) { setError('Selecciona una veterinaria'); return }
    if (!f.titulo?.trim()) { setError('Escribe qué se va a hacer en la visita'); return }
    setGuardando(true); setError(null)
    try {
      await crm.crearSeguimiento({
        aliado_id: f.aliado_id,
        tipo: f.tipo,
        titulo: f.titulo,
        notas: f.notas || null,
        programado_para: desdeInputFechaHora(f.fecha),
        responsable_id: f.responsable_id || null,
      })
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
            {guardando ? 'Guardando…' : 'Programar'}
          </Button>
        </div>
      </>}>
      <div className="space-y-4">

        {/* Tipo */}
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

        {/* Buscador de veterinaria */}
        <Campo label="Veterinaria">
          <Input
            placeholder="Buscar por nombre…"
            value={buscar}
            onChange={e => { setBuscar(e.target.value); setF(x => ({ ...x, aliado_id: '' })) }}
          />
          {!f.aliado_id && buscar.length > 1 && (
            <div className="mt-1 rounded-xl border border-gray-200 max-h-48 overflow-y-auto shadow-sm">
              {!aliados ? (
                <div className="px-3 py-2 text-[12px] text-gray-400">Cargando…</div>
              ) : aliadosFiltrados.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-gray-400">Sin resultados</div>
              ) : aliadosFiltrados.map(a => (
                <button key={a.id_aliado} type="button"
                  onClick={() => { setF(x => ({ ...x, aliado_id: a.id_aliado })); setBuscar(a.nombre) }}
                  className="w-full text-left px-3 py-2 text-[12.5px] text-gray-800 hover:bg-teal-50 border-b border-gray-50 last:border-0">
                  {a.nombre}
                  {a.estado !== 'activo' && <span className="ml-1.5 text-[11px] text-gray-400">· {a.estado}</span>}
                </button>
              ))}
            </div>
          )}
          {f.aliado_id && (
            <div className="mt-1 flex items-center justify-between text-[12px] text-teal-700 font-semibold">
              <span>✓ {buscar}</span>
              <button type="button" onClick={() => { setF(x => ({ ...x, aliado_id: '' })); setBuscar('') }}
                className="text-gray-400 hover:text-gray-600 text-[11px]">Cambiar</button>
            </div>
          )}
        </Campo>

        {/* Qué hacer */}
        <Campo label="¿Qué se va a hacer?">
          <Input value={f.titulo || ''} onChange={e => setF(x => ({ ...x, titulo: e.target.value }))}
            placeholder="Ej: presentar plan grupal y tarifas 2027" />
        </Campo>

        {/* Cuándo */}
        <Campo label="Cuándo">
          <SelectorFecha valor={f.fecha || ''} onCambio={v => setF(x => ({ ...x, fecha: v }))} />
        </Campo>

        {/* Notas */}
        <Campo label="Notas (opcional)">
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
      </div>
    </Modal>
  )
}
