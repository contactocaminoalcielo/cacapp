import { useState, useEffect, useMemo, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { db } from '@/lib/supabase'
import { fmt, today, fmtDateTime, parseDate, petEmoji } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  PlusCircle, Search, Stethoscope, HeartPulse, Tag, Calendar, Clock,
  MapPin, User, Link2, X, Phone,
} from 'lucide-react'

// ── Estados del servicio de eutanasia (tabla propia, NO los de `servicios`) ──
const EUT_ESTADOS = {
  SOLICITADA:             { label: 'Solicitada',          variant: 'gray'   },
  PENDIENTE_CONFIRMACION: { label: 'Pend. confirmación',  variant: 'amber'  },
  PROGRAMADA:             { label: 'Programada',          variant: 'blue'   },
  VETERINARIO_ASIGNADO:   { label: 'Veterinario asignado',variant: 'blue'   },
  EN_CAMINO:              { label: 'En camino',           variant: 'purple' },
  REALIZADA:              { label: 'Realizada',           variant: 'green'  },
  NO_EFECTIVA:            { label: 'No efectiva',         variant: 'red'    },
  CANCELADA:              { label: 'Cancelada',           variant: 'red'    },
  CERRADA:                { label: 'Cerrada',             variant: 'gray'   },
}

// Transiciones permitidas desde cada estado (flujo guiado, no rígido)
const FLUJO = {
  SOLICITADA:             ['PENDIENTE_CONFIRMACION', 'PROGRAMADA', 'CANCELADA'],
  PENDIENTE_CONFIRMACION: ['PROGRAMADA', 'CANCELADA'],
  PROGRAMADA:             ['VETERINARIO_ASIGNADO', 'EN_CAMINO', 'CANCELADA'],
  VETERINARIO_ASIGNADO:   ['EN_CAMINO', 'REALIZADA', 'NO_EFECTIVA', 'CANCELADA'],
  EN_CAMINO:              ['REALIZADA', 'NO_EFECTIVA', 'CANCELADA'],
  REALIZADA:              ['CERRADA'],
  NO_EFECTIVA:            ['PROGRAMADA', 'CERRADA'],
  CANCELADA:              [],
  CERRADA:                [],
}

const PAGO_VARIANT = { PENDIENTE: 'red', PARCIAL: 'amber', COMPLETO: 'green' }

function EutEstadoBadge({ estado }) {
  const cfg = EUT_ESTADOS[estado] ?? { label: estado, variant: 'gray' }
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}

// Precio por peso usando la tabla eutanasia_tarifas (peso_max_kg null = "o más")
function precioPorPeso(tarifas, pesoKg) {
  const p = parseFloat(pesoKg)
  if (Number.isNaN(p)) return null
  const ordenadas = [...tarifas]
    .filter(t => t.activo !== false)
    .sort((a, b) => {
      const am = a.peso_max_kg == null ? Infinity : Number(a.peso_max_kg)
      const bm = b.peso_max_kg == null ? Infinity : Number(b.peso_max_kg)
      return am - bm
    })
  const match = ordenadas.find(t => t.peso_max_kg == null || p <= Number(t.peso_max_kg))
  return match ? Number(match.precio) : null
}

const SUB = 'text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2'

export default function Eutanasias() {
  const { personalData } = useAuth()
  const { confirm, alert } = useConfirm()

  const [tab, setTab] = useState('agenda') // agenda | veterinarios | tarifas
  const [lista, setLista]           = useState([])
  const [veterinarios, setVeterinarios] = useState([])
  const [tarifas, setTarifas]       = useState([])
  const [personal, setPersonal]     = useState([])
  const [especies, setEspecies]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('TODOS')

  const [showCrear, setShowCrear]   = useState(false)
  const [detalle, setDetalle]       = useState(null) // fila de v_eutanasias_agenda

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: ag, error: e1 }, { data: vets }, { data: tar }, { data: per }, { data: esp }] =
        await Promise.all([
          db.from('v_eutanasias_agenda').select('*').order('fecha_solicitada', { ascending: false, nullsFirst: false }),
          db.from('veterinarios').select('*').order('nombre'),
          db.from('eutanasia_tarifas').select('*').order('peso_min_kg'),
          db.from('personal').select('id,nombre,apellido').eq('activo', true).order('nombre'),
          db.from('especies').select('id,nombre').order('id'),
        ])
      if (e1) throw e1
      setLista(ag || [])
      setVeterinarios(vets || [])
      setTarifas(tar || [])
      setPersonal(per || [])
      setEspecies(esp || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const listaFiltrada = useMemo(() => {
    if (filtroEstado === 'TODOS') return lista
    return lista.filter(e => e.estado === filtroEstado)
  }, [lista, filtroEstado])

  const resumen = useMemo(() => {
    const abiertas = lista.filter(e => !['CERRADA', 'CANCELADA'].includes(e.estado))
    const sinVet   = lista.filter(e =>
      ['PROGRAMADA'].includes(e.estado) && !e.veterinario_id)
    const realizadasSinFunerario = lista.filter(e =>
      e.estado === 'REALIZADA' && e.requiere_recoleccion && !e.servicio_id)
    return { abiertas: abiertas.length, sinVet: sinVet.length, alerta: realizadasSinFunerario.length }
  }, [lista])

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar actions={
        tab === 'agenda' && (
          <Button size="sm" onClick={() => setShowCrear(true)}>
            <PlusCircle size={15} /> Nueva eutanasia
          </Button>
        )
      } />

      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Tabs */}
        <div className="inline-flex items-center gap-0.5 bg-gray-100 rounded-lg p-1 mb-5">
          {[
            ['agenda', 'Eutanasias', HeartPulse],
            ['veterinarios', 'Veterinarios', Stethoscope],
            ['tarifas', 'Tarifas', Tag],
          ].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-all ${
                tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">{error}</div>
        )}

        {tab === 'agenda' && (
          <>
            {/* Resumen */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Resumen label="Abiertas" valor={resumen.abiertas} color="#1A5CD8" />
              <Resumen label="Programadas sin veterinario" valor={resumen.sinVet} color="#D97706" />
              <Resumen label="Realizadas sin funerario vinculado" valor={resumen.alerta} color="#C03030" />
            </div>

            {/* Filtro */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button onClick={() => setFiltroEstado('TODOS')}
                className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border ${filtroEstado === 'TODOS' ? 'bg-[#0B1D4F] text-white border-[#0B1D4F]' : 'bg-white text-gray-500 border-gray-200'}`}>
                Todas
              </button>
              {Object.keys(EUT_ESTADOS).map(k => (
                <button key={k} onClick={() => setFiltroEstado(k)}
                  className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border ${filtroEstado === k ? 'bg-[#0B1D4F] text-white border-[#0B1D4F]' : 'bg-white text-gray-500 border-gray-200'}`}>
                  {EUT_ESTADOS[k].label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40 gap-3 text-gray-400">
                <div className="spinner" /><span className="text-sm font-medium">Cargando...</span>
              </div>
            ) : listaFiltrada.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <HeartPulse size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-[13px] font-medium">No hay eutanasias {filtroEstado !== 'TODOS' ? 'en este estado' : 'registradas'}.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {listaFiltrada.map(e => (
                  <button key={e.id} onClick={() => setDetalle(e)}
                    className="w-full text-left bg-white rounded-xl border border-gray-100 hover:border-[#1A5CD8]/30 hover:shadow-sm transition-all p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[14px] font-bold text-gray-900 truncate">
                          {petEmoji(especies.find(s => s.id === e.especie_id)?.nombre)} {e.mascota_nombre || 'Mascota'}
                        </span>
                        <EutEstadoBadge estado={e.estado} />
                        {e.servicio_id && (
                          <Badge variant="purple"><Link2 size={10} className="mr-0.5" /> Plan vinculado</Badge>
                        )}
                      </div>
                      <div className="text-[12px] text-gray-500 truncate">
                        {e.cliente_nombre} {e.cliente_apellido} · {e.ciudad || 'Sin ciudad'}
                        {e.veterinario_nombre ? ` · Vet: ${e.veterinario_nombre}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-bold text-gray-900">{e.valor != null ? fmt(e.valor) : '—'}</div>
                      <div className="mt-0.5"><Badge variant={PAGO_VARIANT[e.estado_pago] ?? 'gray'}>{e.estado_pago}</Badge></div>
                    </div>
                    <div className="text-right shrink-0 w-28 hidden sm:block">
                      <div className="text-[12px] font-semibold text-gray-700">
                        {e.fecha_solicitada ? parseDate(e.fecha_solicitada)?.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : 'Sin fecha'}
                      </div>
                      <div className="text-[11px] text-gray-400">{e.hora_solicitada ? e.hora_solicitada.slice(0, 5) : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'veterinarios' && (
          <VeterinariosTab veterinarios={veterinarios} onChange={cargar} />
        )}

        {tab === 'tarifas' && (
          <TarifasTab tarifas={tarifas} onChange={cargar} />
        )}
      </div>

      {showCrear && (
        <CrearEutanasia
          onClose={() => setShowCrear(false)}
          onSaved={() => { setShowCrear(false); cargar() }}
          tarifas={tarifas}
          veterinarios={veterinarios}
          personal={personal}
          especies={especies}
          createdBy={personalData?.id}
        />
      )}

      {detalle && (
        <DetalleEutanasia
          fila={detalle}
          veterinarios={veterinarios}
          personal={personal}
          onClose={() => setDetalle(null)}
          onChanged={() => { cargar() }}
          confirm={confirm}
          alert={alert}
        />
      )}
    </div>
  )
}

function Resumen({ label, valor, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="text-[22px] font-bold" style={{ color }}>{valor}</div>
      <div className="text-[11px] text-gray-500 font-medium leading-tight">{label}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CREAR EUTANASIA
// ════════════════════════════════════════════════════════════════════════════
function CrearEutanasia({ onClose, onSaved, tarifas, veterinarios, personal, especies, createdBy }) {
  // Cliente
  const [busqClient, setBusqClient]   = useState('')
  const [resultados, setResultados]   = useState([])
  const [cliente, setCliente]         = useState(null) // {id_cliente, ...} o null
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [formCli, setFormCli] = useState({ nombre: '', apellido: '', whatsapp: '', telefono: '', direccion: '', ciudad: 'Bogotá' })

  // Mascota
  const [mascotas, setMascotas]       = useState([])
  const [mascota, setMascota]         = useState(null)
  const [mascotaNueva, setMascotaNueva] = useState(false)
  const [formMas, setFormMas] = useState({ nombre: '', especie_id: '1', sexo: 'Macho', tamano: 'Mediano', peso_kg: '' })

  // Datos eutanasia
  const [fecha, setFecha]       = useState(today())
  const [hora, setHora]         = useState('')
  const [direccion, setDireccion] = useState('')
  const [ciudad, setCiudad]     = useState('Bogotá')
  const [vetId, setVetId]       = useState('')
  const [responsableId, setResponsableId] = useState(createdBy || '')
  const [cobroConjunto, setCobroConjunto] = useState(false)
  const [observaciones, setObservaciones] = useState('')
  const [valorManual, setValorManual] = useState('')

  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const pesoActivo = mascotaNueva ? formMas.peso_kg : (mascota?.peso_kg ?? '')
  const precioAuto = useMemo(() => precioPorPeso(tarifas, pesoActivo), [tarifas, pesoActivo])
  const valorFinal = valorManual !== '' ? parseFloat(valorManual) : precioAuto

  // Buscar clientes
  useEffect(() => {
    if (clienteNuevo || busqClient.trim().length < 2) { setResultados([]); return }
    let cancel = false
    const t = setTimeout(async () => {
      const q = busqClient.trim()
      const { data } = await db.from('clientes')
        .select('id_cliente,nombre,apellido,whatsapp,telefono,direccion,ciudad')
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,whatsapp.ilike.%${q}%`)
        .limit(8)
      if (!cancel) setResultados(data || [])
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [busqClient, clienteNuevo])

  async function seleccionarCliente(c) {
    setCliente(c)
    setResultados([])
    setBusqClient(`${c.nombre} ${c.apellido || ''}`.trim())
    setDireccion(c.direccion || '')
    setCiudad(c.ciudad || 'Bogotá')
    const { data } = await db.from('mascotas')
      .select('id_mascota,nombre,especie_id,peso_kg,sexo,tamano')
      .eq('cliente_id', c.id_cliente).order('nombre')
    setMascotas(data || [])
    setMascota(null)
    setMascotaNueva((data || []).length === 0)
  }

  const puedeGuardar =
    (cliente || (clienteNuevo && formCli.nombre.trim() && formCli.whatsapp.trim())) &&
    (mascota || (mascotaNueva && formMas.nombre.trim() && formMas.peso_kg))

  async function guardar() {
    setErr(null)
    if (!puedeGuardar) { setErr('Completa cliente y mascota.'); return }
    setSaving(true)
    try {
      // 1. Cliente
      let clienteId = cliente?.id_cliente
      if (!clienteId) {
        const { data, error } = await db.from('clientes').insert({
          nombre: formCli.nombre.trim(), apellido: formCli.apellido.trim() || null,
          whatsapp: formCli.whatsapp.trim(), telefono: formCli.telefono.trim() || null,
          direccion: formCli.direccion.trim() || null, ciudad: formCli.ciudad.trim() || 'Bogotá',
          tipo_cliente: 'NORMAL',
        }).select('id_cliente').single()
        if (error) throw error
        clienteId = data.id_cliente
      }

      // 2. Mascota (siempre en `mascotas`)
      let mascotaId = mascota?.id_mascota
      let pesoKg = parseFloat(pesoActivo) || null
      if (!mascotaId) {
        const { data, error } = await db.from('mascotas').insert({
          nombre: formMas.nombre.trim(), especie_id: parseInt(formMas.especie_id) || null,
          sexo: formMas.sexo, tamano: formMas.tamano, peso_kg: parseFloat(formMas.peso_kg) || 0,
          cliente_id: clienteId, fallecida: true, fecha_fallecimiento: today(),
        }).select('id_mascota').single()
        if (error) throw error
        mascotaId = data.id_mascota
      }

      // 3. Eutanasia
      const { error: e3 } = await db.from('eutanasias').insert({
        cliente_id: clienteId, mascota_id: mascotaId, peso_kg: pesoKg,
        direccion: direccion.trim() || null, ciudad: ciudad.trim() || null,
        fecha_solicitada: fecha || null, hora_solicitada: hora || null,
        veterinario_id: vetId || null,
        estado: vetId ? 'VETERINARIO_ASIGNADO' : 'SOLICITADA',
        valor: valorFinal != null && !Number.isNaN(valorFinal) ? valorFinal : null,
        cobro_conjunto: cobroConjunto,
        responsable_id: responsableId || null,
        observaciones: observaciones.trim() || null,
        created_by: createdBy || null,
      })
      if (e3) throw e3
      onSaved()
    } catch (e) {
      setErr(e.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nueva eutanasia compasiva" maxWidth="max-w-2xl"
      footer={
        <>
          <span className="text-[12px] text-gray-500">
            {valorFinal != null && !Number.isNaN(valorFinal)
              ? <>Valor: <strong className="text-gray-900">{fmt(valorFinal)}</strong>{valorManual === '' && precioAuto != null ? ' (auto por peso)' : ''}</>
              : 'Indica el peso para calcular el valor'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={!puedeGuardar || saving}>{saving ? 'Guardando…' : 'Registrar'}</Button>
          </div>
        </>
      }>
      {err && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">{err}</div>}

      {/* CLIENTE */}
      <div className="mb-5">
        <div className={SUB}>Cliente</div>
        {!clienteNuevo ? (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="pl-8" placeholder="Buscar por nombre o WhatsApp…"
              value={busqClient}
              onChange={e => { setBusqClient(e.target.value); setCliente(null); setMascotas([]); setMascota(null) }} />
            {resultados.length > 0 && !cliente && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {resultados.map(c => (
                  <button key={c.id_cliente} onClick={() => seleccionarCliente(c)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-[13px] border-b border-gray-50 last:border-0">
                    <span className="font-semibold text-gray-900">{c.nombre} {c.apellido}</span>
                    <span className="text-gray-400 ml-2">{c.whatsapp}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setClienteNuevo(true); setCliente(null) }}
              className="text-[12px] text-[#1A5CD8] font-semibold mt-2">+ Cliente nuevo</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Nombre *" value={formCli.nombre} onChange={e => setFormCli(p => ({ ...p, nombre: e.target.value }))} />
            <Input placeholder="Apellido" value={formCli.apellido} onChange={e => setFormCli(p => ({ ...p, apellido: e.target.value }))} />
            <Input placeholder="WhatsApp *" value={formCli.whatsapp} onChange={e => setFormCli(p => ({ ...p, whatsapp: e.target.value }))} />
            <Input placeholder="Teléfono" value={formCli.telefono} onChange={e => setFormCli(p => ({ ...p, telefono: e.target.value }))} />
            <Input className="col-span-2" placeholder="Dirección" value={formCli.direccion}
              onChange={e => { setFormCli(p => ({ ...p, direccion: e.target.value })); setDireccion(e.target.value) }} />
            <Input placeholder="Ciudad" value={formCli.ciudad}
              onChange={e => { setFormCli(p => ({ ...p, ciudad: e.target.value })); setCiudad(e.target.value) }} />
            <button onClick={() => setClienteNuevo(false)} className="text-[12px] text-gray-500 font-semibold text-left">← Buscar existente</button>
          </div>
        )}
      </div>

      {/* MASCOTA */}
      {(cliente || clienteNuevo) && (
        <div className="mb-5">
          <div className={SUB}>Mascota</div>
          {!mascotaNueva && mascotas.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {mascotas.map(m => (
                <button key={m.id_mascota} onClick={() => setMascota(m)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[13px] flex items-center justify-between ${mascota?.id_mascota === m.id_mascota ? 'border-[#1A5CD8] bg-[#EEF3FF]' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className="font-semibold text-gray-900">{petEmoji(especies.find(s => s.id === m.especie_id)?.nombre)} {m.nombre}</span>
                  <span className="text-gray-400">{m.peso_kg ? `${m.peso_kg} kg` : 'sin peso'}</span>
                </button>
              ))}
            </div>
          )}
          {!mascotaNueva ? (
            <button onClick={() => { setMascotaNueva(true); setMascota(null) }}
              className="text-[12px] text-[#1A5CD8] font-semibold">+ Mascota nueva</button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Input className="col-span-2" placeholder="Nombre *" value={formMas.nombre} onChange={e => setFormMas(p => ({ ...p, nombre: e.target.value }))} />
              <Select value={formMas.especie_id} onChange={e => setFormMas(p => ({ ...p, especie_id: e.target.value }))}>
                {especies.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
              <Input type="number" step="0.1" placeholder="Peso (kg) *" value={formMas.peso_kg} onChange={e => setFormMas(p => ({ ...p, peso_kg: e.target.value }))} />
              <Select value={formMas.sexo} onChange={e => setFormMas(p => ({ ...p, sexo: e.target.value }))}>
                <option value="Macho">Macho</option><option value="Hembra">Hembra</option>
              </Select>
              <Select value={formMas.tamano} onChange={e => setFormMas(p => ({ ...p, tamano: e.target.value }))}>
                <option value="Mini">Mini</option><option value="Pequeño">Pequeño</option>
                <option value="Mediano">Mediano</option><option value="Grande">Grande</option><option value="Gigante">Gigante</option>
              </Select>
              {mascotas.length > 0 && (
                <button onClick={() => setMascotaNueva(false)} className="col-span-2 text-[12px] text-gray-500 font-semibold text-left">← Elegir existente</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* DATOS EUTANASIA */}
      {(mascota || (mascotaNueva && formMas.peso_kg)) && (
        <div>
          <div className={SUB}>Datos del servicio</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="text-[11px] text-gray-500 font-semibold">Fecha
              <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </label>
            <label className="text-[11px] text-gray-500 font-semibold">Hora
              <Input type="time" value={hora} onChange={e => setHora(e.target.value)} />
            </label>
            <Input className="col-span-2" placeholder="Dirección del procedimiento" value={direccion} onChange={e => setDireccion(e.target.value)} />
            <Input placeholder="Ciudad" value={ciudad} onChange={e => setCiudad(e.target.value)} />
            <Select value={vetId} onChange={e => setVetId(e.target.value)}>
              <option value="">Veterinario (opcional)…</option>
              {veterinarios.filter(v => v.activo !== false).map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Select>
            <Select value={responsableId} onChange={e => setResponsableId(e.target.value)}>
              <option value="">Responsable interno…</option>
              {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido || ''}</option>)}
            </Select>
            <Input type="number" placeholder={precioAuto != null ? `Auto: ${precioAuto}` : 'Valor'} value={valorManual}
              onChange={e => setValorManual(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-gray-600 font-medium mb-2">
            <input type="checkbox" checked={cobroConjunto} onChange={e => setCobroConjunto(e.target.checked)} />
            Se cobra junto con el plan funerario (desglose en el cobro)
          </label>
          <textarea rows={2} placeholder="Observaciones" value={observaciones} onChange={e => setObservaciones(e.target.value)}
            className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10" />
        </div>
      )}
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DETALLE / GESTIÓN
// ════════════════════════════════════════════════════════════════════════════
function DetalleEutanasia({ fila, veterinarios, personal, onClose, onChanged, confirm, alert }) {
  const [e, setE]           = useState(null)        // registro completo de `eutanasias`
  const [serviciosVinc, setServiciosVinc] = useState([])
  const [saving, setSaving] = useState(false)
  const [vetId, setVetId]   = useState('')
  const [pago, setPago]     = useState({ estado_pago: '', valor_pagado: '', metodo_pago: '' })
  const [cancelMotivo, setCancelMotivo] = useState('')
  const [noEfectiva, setNoEfectiva]     = useState({ motivo: '', accion: '' })
  const [showCancel, setShowCancel]     = useState(false)
  const [showNoEf, setShowNoEf]         = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await db.from('eutanasias').select('*').eq('id', fila.id).single()
      if (data) {
        setE(data)
        setVetId(data.veterinario_id || '')
        setPago({ estado_pago: data.estado_pago, valor_pagado: data.valor_pagado ?? '', metodo_pago: data.metodo_pago || '' })
      }
      // servicios candidatos para vincular: de la misma mascota, sin eutanasia ligada
      const { data: svc } = await db.from('servicios')
        .select('id,estado,plan_id,fecha_ingreso')
        .eq('mascota_id', fila.mascota_id || '00000000-0000-0000-0000-000000000000')
        .order('fecha_ingreso', { ascending: false })
      setServiciosVinc(svc || [])
    })()
  }, [fila.id, fila.mascota_id])

  async function patch(campos, okMsg) {
    setSaving(true)
    try {
      const { error } = await db.from('eutanasias').update(campos).eq('id', fila.id)
      if (error) throw error
      setE(prev => ({ ...prev, ...campos }))
      onChanged()
      if (okMsg) await alert(okMsg, { title: 'Listo', variant: 'success' })
    } catch (err) {
      await alert(err.message || 'No se pudo actualizar', { title: 'Error', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function cambiarEstado(next) {
    if (next === 'CANCELADA') { setShowCancel(true); return }
    if (next === 'NO_EFECTIVA') { setShowNoEf(true); return }

    const extra = {}
    if (next === 'REALIZADA') {
      extra.realizada_at = new Date().toISOString()
      const requiere = await confirm(
        '¿Esta eutanasia continúa con servicio funerario (recolección)? Se marcará para vincular un plan.',
        { title: 'Eutanasia realizada', variant: 'warning', confirmLabel: 'Sí, requiere funerario', cancelLabel: 'No, solo eutanasia' })
      extra.requiere_recoleccion = requiere
    }
    if (next === 'CERRADA') extra.cerrada_at = new Date().toISOString()
    await patch({ estado: next, ...extra })
  }

  async function confirmarCancelar() {
    if (!cancelMotivo.trim()) return
    await patch({ estado: 'CANCELADA', motivo_cancelacion: cancelMotivo.trim() })
    setShowCancel(false)
  }
  async function confirmarNoEfectiva() {
    if (!noEfectiva.motivo.trim()) return
    await patch({ estado: 'NO_EFECTIVA', motivo_no_efectiva: noEfectiva.motivo.trim(), accion_siguiente: noEfectiva.accion.trim() || null })
    setShowNoEf(false)
  }

  async function vincularServicio(servicioId) {
    if (!servicioId) {
      // desvincular
      await db.from('servicios').update({ eutanasia_id: null }).eq('eutanasia_id', fila.id)
      await patch({ servicio_id: null }, 'Servicio desvinculado.')
      return
    }
    setSaving(true)
    try {
      const { error: e1 } = await db.from('eutanasias').update({ servicio_id: servicioId }).eq('id', fila.id)
      if (e1) throw e1
      const { error: e2 } = await db.from('servicios').update({ eutanasia_id: fila.id }).eq('id', servicioId)
      if (e2) throw e2
      setE(prev => ({ ...prev, servicio_id: servicioId }))
      onChanged()
      await alert('Servicio funerario vinculado.', { title: 'Listo', variant: 'success' })
    } catch (err) {
      await alert(err.message, { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  if (!e) return (
    <Modal open onClose={onClose} title="Cargando…"><div className="h-24 flex items-center justify-center text-gray-400 text-sm">Cargando…</div></Modal>
  )

  const siguientes = FLUJO[e.estado] || []

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl"
      title={<span className="flex items-center gap-2">{fila.mascota_nombre || 'Eutanasia'} <EutEstadoBadge estado={e.estado} /></span>}>

      {/* Datos */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] mb-5">
        <Dato icon={User}  label="Cliente" valor={`${fila.cliente_nombre || ''} ${fila.cliente_apellido || ''}`} />
        <Dato icon={Tag}   label="Valor" valor={e.valor != null ? fmt(e.valor) : '—'} />
        <Dato icon={Calendar} label="Fecha" valor={e.fecha_solicitada ? parseDate(e.fecha_solicitada)?.toLocaleDateString('es-CO') : 'Sin fecha'} />
        <Dato icon={Clock} label="Hora" valor={e.hora_solicitada ? e.hora_solicitada.slice(0, 5) : '—'} />
        <Dato icon={MapPin} label="Dirección" valor={[e.direccion, e.ciudad].filter(Boolean).join(', ') || '—'} />
        <Dato icon={Tag}   label="Peso" valor={e.peso_kg ? `${e.peso_kg} kg` : '—'} />
      </div>

      {/* Estado / flujo */}
      <Seccion titulo="Estado del servicio">
        {siguientes.length === 0 ? (
          <p className="text-[12px] text-gray-400">Estado final. No hay transiciones disponibles.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {siguientes.map(s => (
              <Button key={s} size="sm" variant={['CANCELADA', 'NO_EFECTIVA'].includes(s) ? 'danger' : 'secondary'}
                disabled={saving} onClick={() => cambiarEstado(s)}>
                {EUT_ESTADOS[s].label}
              </Button>
            ))}
          </div>
        )}
        {e.motivo_cancelacion && <p className="text-[12px] text-red-600 mt-2">Cancelada: {e.motivo_cancelacion}</p>}
        {e.motivo_no_efectiva && <p className="text-[12px] text-red-600 mt-2">No efectiva: {e.motivo_no_efectiva}{e.accion_siguiente ? ` · Acción: ${e.accion_siguiente}` : ''}</p>}
      </Seccion>

      {/* Veterinario */}
      <Seccion titulo="Veterinario asignado">
        <div className="flex gap-2">
          <Select value={vetId} onChange={ev => setVetId(ev.target.value)} className="flex-1">
            <option value="">Sin asignar…</option>
            {veterinarios.filter(v => v.activo !== false).map(v => <option key={v.id} value={v.id}>{v.nombre}{v.telefono ? ` · ${v.telefono}` : ''}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={saving || vetId === (e.veterinario_id || '')}
            onClick={() => patch({
              veterinario_id: vetId || null,
              estado: vetId && e.estado === 'PROGRAMADA' ? 'VETERINARIO_ASIGNADO' : e.estado,
            }, 'Veterinario actualizado.')}>Guardar</Button>
        </div>
      </Seccion>

      {/* Pago */}
      <Seccion titulo="Pago">
        <div className="grid grid-cols-3 gap-2">
          <Select value={pago.estado_pago} onChange={ev => setPago(p => ({ ...p, estado_pago: ev.target.value }))}>
            <option value="PENDIENTE">Pendiente</option><option value="PARCIAL">Parcial</option><option value="COMPLETO">Completo</option>
          </Select>
          <Input type="number" placeholder="Pagado" value={pago.valor_pagado} onChange={ev => setPago(p => ({ ...p, valor_pagado: ev.target.value }))} />
          <Input placeholder="Método" value={pago.metodo_pago} onChange={ev => setPago(p => ({ ...p, metodo_pago: ev.target.value }))} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] text-gray-400">{e.cobro_conjunto ? 'Se cobra junto con el plan' : 'Cobro independiente'}</span>
          <Button size="sm" variant="secondary" disabled={saving}
            onClick={() => patch({
              estado_pago: pago.estado_pago,
              valor_pagado: parseFloat(pago.valor_pagado) || 0,
              metodo_pago: pago.metodo_pago.trim() || null,
            }, 'Pago actualizado.')}>Guardar pago</Button>
        </div>
      </Seccion>

      {/* Vínculo con servicio funerario */}
      <Seccion titulo="Plan funerario vinculado">
        {e.servicio_id ? (
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-gray-700 flex items-center gap-1.5"><Link2 size={13} /> Vinculado al servicio {e.servicio_id.slice(0, 8)}…</span>
            <Button size="sm" variant="danger" disabled={saving} onClick={() => vincularServicio(null)}>Desvincular</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Select className="flex-1" defaultValue="" onChange={ev => ev.target.value && vincularServicio(ev.target.value)}>
              <option value="">Vincular servicio de esta mascota…</option>
              {serviciosVinc.map(s => <option key={s.id} value={s.id}>{s.estado} · {s.fecha_ingreso} · {s.id.slice(0, 8)}</option>)}
            </Select>
          </div>
        )}
        {e.requiere_recoleccion && !e.servicio_id && (
          <p className="text-[12px] text-amber-600 mt-2">⚠ Marcada como "requiere funerario" pero sin plan vinculado.</p>
        )}
      </Seccion>

      {/* Sub-modal cancelar */}
      {showCancel && (
        <Modal open onClose={() => setShowCancel(false)} title="Cancelar eutanasia" maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setShowCancel(false)}>Volver</Button>
            <Button variant="danger" disabled={!cancelMotivo.trim() || saving} onClick={confirmarCancelar}>Cancelar servicio</Button>
          </>}>
          <p className="text-[13px] text-gray-600 mb-2">Indica el motivo de cancelación (obligatorio):</p>
          <textarea rows={3} value={cancelMotivo} onChange={ev => setCancelMotivo(ev.target.value)}
            className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8]" />
        </Modal>
      )}

      {/* Sub-modal no efectiva */}
      {showNoEf && (
        <Modal open onClose={() => setShowNoEf(false)} title="Marcar como no efectiva" maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setShowNoEf(false)}>Volver</Button>
            <Button variant="danger" disabled={!noEfectiva.motivo.trim() || saving} onClick={confirmarNoEfectiva}>Confirmar</Button>
          </>}>
          <p className="text-[13px] text-gray-600 mb-2">Motivo (obligatorio):</p>
          <textarea rows={2} value={noEfectiva.motivo} onChange={ev => setNoEfectiva(p => ({ ...p, motivo: ev.target.value }))}
            className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8] mb-2" />
          <p className="text-[13px] text-gray-600 mb-2">Acción siguiente:</p>
          <textarea rows={2} value={noEfectiva.accion} onChange={ev => setNoEfectiva(p => ({ ...p, accion: ev.target.value }))}
            className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8]" />
        </Modal>
      )}
    </Modal>
  )
}

function Dato({ icon: Icon, label, valor }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] text-gray-400 font-semibold uppercase">{label}</div>
        <div className="text-[13px] text-gray-800 font-medium truncate">{valor || '—'}</div>
      </div>
    </div>
  )
}

function Seccion({ titulo, children }) {
  return (
    <div className="mb-4 pb-4 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
      <div className={SUB}>{titulo}</div>
      {children}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// VETERINARIOS
// ════════════════════════════════════════════════════════════════════════════
function VeterinariosTab({ veterinarios, onChange }) {
  const [edit, setEdit] = useState(null) // null | {} (nuevo) | registro

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => setEdit({ nombre: '', telefono: '', whatsapp: '', email: '', zonas: '', activo: true })}>
          <PlusCircle size={15} /> Nuevo veterinario
        </Button>
      </div>
      {veterinarios.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-[13px]">No hay veterinarios registrados.</div>
      ) : (
        <div className="space-y-2">
          {veterinarios.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
              <Stethoscope size={16} className="text-gray-400" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-gray-900">{v.nombre} {!v.activo && <Badge variant="gray">inactivo</Badge>}</div>
                <div className="text-[12px] text-gray-500 flex items-center gap-2">
                  {v.telefono && <span className="flex items-center gap-1"><Phone size={11} />{v.telefono}</span>}
                  {Array.isArray(v.zonas) && v.zonas.length > 0 && <span>· {v.zonas.join(', ')}</span>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ ...v, zonas: Array.isArray(v.zonas) ? v.zonas.join(', ') : '' })}>Editar</Button>
            </div>
          ))}
        </div>
      )}
      {edit && <VeterinarioModal registro={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange() }} />}
    </div>
  )
}

function VeterinarioModal({ registro, onClose, onSaved }) {
  const [f, setF] = useState(registro)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const esNuevo = !registro.id

  async function guardar() {
    if (!f.nombre.trim()) { setErr('El nombre es obligatorio'); return }
    setSaving(true); setErr(null)
    try {
      const payload = {
        nombre: f.nombre.trim(), telefono: f.telefono?.trim() || null,
        whatsapp: f.whatsapp?.trim() || null, email: f.email?.trim() || null,
        zonas: f.zonas ? f.zonas.split(',').map(z => z.trim()).filter(Boolean) : null,
        activo: f.activo !== false,
      }
      const { error } = esNuevo
        ? await db.from('veterinarios').insert(payload)
        : await db.from('veterinarios').update(payload).eq('id', registro.id)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={esNuevo ? 'Nuevo veterinario' : 'Editar veterinario'} maxWidth="max-w-md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">{err}</div>}
      <div className="space-y-2">
        <Input placeholder="Nombre *" value={f.nombre} onChange={e => setF(p => ({ ...p, nombre: e.target.value }))} />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Teléfono" value={f.telefono || ''} onChange={e => setF(p => ({ ...p, telefono: e.target.value }))} />
          <Input placeholder="WhatsApp" value={f.whatsapp || ''} onChange={e => setF(p => ({ ...p, whatsapp: e.target.value }))} />
        </div>
        <Input placeholder="Email" value={f.email || ''} onChange={e => setF(p => ({ ...p, email: e.target.value }))} />
        <Input placeholder="Zonas de cobertura (separadas por coma)" value={f.zonas || ''} onChange={e => setF(p => ({ ...p, zonas: e.target.value }))} />
        <label className="flex items-center gap-2 text-[12px] text-gray-600 font-medium">
          <input type="checkbox" checked={f.activo !== false} onChange={e => setF(p => ({ ...p, activo: e.target.checked }))} /> Activo
        </label>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TARIFAS
// ════════════════════════════════════════════════════════════════════════════
function TarifasTab({ tarifas, onChange }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)

  async function guardar(id) {
    const nuevo = edits[id]
    if (nuevo == null) return
    setSaving(true)
    try {
      await db.from('eutanasia_tarifas').update({ precio: parseFloat(nuevo) || 0 }).eq('id', id)
      setEdits(p => { const c = { ...p }; delete c[id]; return c })
      onChange()
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-lg">
      <p className="text-[12px] text-gray-500 mb-3">Precio de la eutanasia según el peso de la mascota. El valor se calcula automáticamente al registrar.</p>
      <div className="space-y-2">
        {tarifas.map(t => {
          const rango = t.peso_max_kg == null ? `${t.peso_min_kg} kg o más` : `${t.peso_min_kg} – ${t.peso_max_kg} kg`
          const val = edits[t.id] ?? t.precio
          const cambiado = edits[t.id] != null && parseFloat(edits[t.id]) !== Number(t.precio)
          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
              <span className="text-[13px] font-semibold text-gray-800 flex-1">{rango}</span>
              <Input type="number" className="w-32" value={val} onChange={e => setEdits(p => ({ ...p, [t.id]: e.target.value }))} />
              <Button size="sm" variant="secondary" disabled={!cambiado || saving} onClick={() => guardar(t.id)}>Guardar</Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
