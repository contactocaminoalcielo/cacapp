// Editar la ficha de la veterinaria. Escribe en `aliados`, la tabla de siempre:
// horario, teléfonos y contactos quedan disponibles para TODO Orbit (Kanban,
// técnico, agente), no solo para el CRM.
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { HorarioEditor } from '@/components/ui/horario-editor'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { crm, SERVICIOS_CLINICA } from '@/lib/crmApi'
import { useCrm } from './CrmContext'
import { Campo, ACENTO } from './ui'

const CAMPOS = ['nombre', 'identificacion_nit', 'email', 'telefono', 'whatsapp', 'telefono_2', 'contacto_nombre',
  'contacto_cargo', 'contacto_email', 'contacto_2_nombre', 'contacto_2_telefono', 'ciudad', 'localidad', 'barrio',
  'direccion', 'referencia_ubicacion', 'instagram', 'sitio_web', 'numero_sedes', 'num_veterinarios', 'atiende_24h',
  'servicios_clinica', 'horario', 'lat', 'lng', 'comercial_id', 'notas_comerciales']

export default function EditarFicha({ abierto, onCerrar, aliado, onGuardado }) {
  const { equipo } = useCrm()
  const [f, setF] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!abierto || !aliado) return
    setError(null)
    const base = {}
    for (const k of CAMPOS) base[k] = aliado[k] ?? (k === 'servicios_clinica' ? [] : k === 'horario' ? {} : k === 'atiende_24h' ? false : '')
    setF(base)
  }, [abierto, aliado])

  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const txt = k => ({ value: f[k] ?? '', onChange: e => set(k, e.target.value) })

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      // Solo lo que cambió: así dos personas editando campos distintos no se pisan.
      const cambios = {}
      for (const k of CAMPOS) {
        if (JSON.stringify(f[k] ?? '') !== JSON.stringify(aliado[k] ?? (k === 'servicios_clinica' ? [] : k === 'horario' ? {} : k === 'atiende_24h' ? false : ''))) cambios[k] = f[k]
      }
      if (Object.keys(cambios).length) await crm.guardarFicha(aliado.id_aliado, cambios)
      onGuardado?.()
      onCerrar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  function ubicacionActual() {
    navigator.geolocation?.getCurrentPosition(
      p => { set('lat', p.coords.latitude.toFixed(6)); set('lng', p.coords.longitude.toFixed(6)) },
      () => setError('No se pudo leer la ubicación del dispositivo'))
  }

  return (
    <Modal open={abierto} onClose={onCerrar} title="Editar ficha de la veterinaria" maxWidth="max-w-3xl"
      footer={<>
        <span className="text-[12px] text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !String(f.nombre || '').trim()} style={{ background: ACENTO }}>
            {guardando ? 'Guardando…' : 'Guardar ficha'}
          </Button>
        </div>
      </>}>
      <div className="space-y-5">
        <Bloque titulo="Establecimiento">
          <Campo label="Nombre" className="sm:col-span-2"><Input {...txt('nombre')} /></Campo>
          <Campo label="NIT"><Input {...txt('identificacion_nit')} /></Campo>
          <Campo label="Sedes"><Input {...txt('numero_sedes')} /></Campo>
          <Campo label="N.º de veterinarios"><Input type="number" min="0" {...txt('num_veterinarios')} /></Campo>
          <Campo label="Correo"><Input type="email" {...txt('email')} /></Campo>
          <Campo label="Instagram / redes"><Input {...txt('instagram')} placeholder="@clinica" /></Campo>
          <Campo label="Sitio web"><Input {...txt('sitio_web')} /></Campo>
        </Bloque>

        <Bloque titulo="Teléfonos y contactos">
          <Campo label="Teléfono principal"><Input {...txt('telefono')} /></Campo>
          <Campo label="WhatsApp" ayuda="El número con el que escribe a la línea de vets"><Input {...txt('whatsapp')} /></Campo>
          <Campo label="Otro teléfono"><Input {...txt('telefono_2')} /></Campo>
          <Campo label="Persona de contacto"><Input {...txt('contacto_nombre')} /></Campo>
          <Campo label="Cargo"><Input {...txt('contacto_cargo')} placeholder="Dueña, administrador, médico…" /></Campo>
          <Campo label="Correo del contacto"><Input {...txt('contacto_email')} /></Campo>
          <Campo label="Segundo contacto"><Input {...txt('contacto_2_nombre')} /></Campo>
          <Campo label="Teléfono del segundo contacto"><Input {...txt('contacto_2_telefono')} /></Campo>
        </Bloque>

        <Bloque titulo="Ubicación">
          <Campo label="Ciudad"><Input {...txt('ciudad')} /></Campo>
          <Campo label="Localidad"><LocalidadSelect value={f.localidad || ''} onChange={v => set('localidad', v)} /></Campo>
          <Campo label="Barrio"><Input {...txt('barrio')} /></Campo>
          <Campo label="Dirección" className="sm:col-span-2"><Input {...txt('direccion')} /></Campo>
          <Campo label="Referencia para llegar"><Input {...txt('referencia_ubicacion')} placeholder="Frente al parque, local 2…" /></Campo>
          <Campo label="Latitud"><Input {...txt('lat')} /></Campo>
          <Campo label="Longitud"><Input {...txt('lng')} /></Campo>
          <div className="flex items-end"><Button variant="secondary" size="sm" onClick={ubicacionActual}>📍 Usar mi ubicación (en la visita)</Button></div>
        </Bloque>

        <div>
          <h4 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">Horario de atención</h4>
          <label className="inline-flex items-center gap-2 text-[12.5px] text-gray-700 mb-2">
            <input type="checkbox" checked={!!f.atiende_24h} onChange={e => set('atiende_24h', e.target.checked)} /> Tiene urgencias 24 horas
          </label>
          <HorarioEditor value={f.horario || {}} onChange={v => set('horario', v)} />
        </div>

        <div>
          <h4 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">Servicios que ofrece la clínica</h4>
          <div className="flex flex-wrap gap-1.5">
            {SERVICIOS_CLINICA.map(s => {
              const on = (f.servicios_clinica || []).includes(s)
              return (
                <button key={s} type="button"
                  onClick={() => set('servicios_clinica', on ? f.servicios_clinica.filter(x => x !== s) : [...(f.servicios_clinica || []), s])}
                  className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border ${on ? 'text-white border-transparent' : 'border-gray-200 text-gray-600'}`}
                  style={on ? { background: ACENTO } : undefined}>{s}</button>
              )
            })}
          </div>
        </div>

        <Bloque titulo="Gestión comercial">
          <Campo label="Responsable comercial">
            <Select value={f.comercial_id || ''} onChange={e => set('comercial_id', e.target.value || null)}>
              <option value="">Sin asignar</option>
              {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.rol.toLowerCase()}</option>)}
            </Select>
          </Campo>
          <Campo label="Notas comerciales" className="sm:col-span-2">
            <Textarea rows={3} {...txt('notas_comerciales')} placeholder="Quién decide, qué le molesta, cuándo conviene llamar…" />
          </Campo>
        </Bloque>
        <p className="text-[11.5px] text-gray-400">La comisión, la modalidad y la activación se siguen manejando en Gestión / Configuración (son de coordinación).</p>
      </div>
    </Modal>
  )
}

function Bloque({ titulo, children }) {
  return (
    <div>
      <h4 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2">{titulo}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  )
}
