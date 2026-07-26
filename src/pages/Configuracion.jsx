import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/dialog'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { db, callEdgeFunction } from '@/lib/supabase'
import { fmt, parsearErrorDB, waLink } from '@/lib/utils'
import { orbitApi } from '@/lib/orbitApi'
import { Plus, Search, Send, CheckCircle, AlertCircle, RefreshCw, Users, Building2, KeyRound, ClipboardList, Layers, Star, DollarSign, Tag, Trash2, Pencil, X, Package, MessageCircle, Smartphone, Truck, CalendarDays, Stethoscope, Copy, Heart, Flame } from 'lucide-react'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { HorarioEditor, resumenHorario } from '@/components/ui/horario-editor'

const nullify = (obj, keys) => {
  const out = { ...obj }
  keys.forEach(k => { if (out[k] === '') out[k] = null })
  return out
}

const limpiarWA = (num) => {
  const clean = String(num || '').replace(/\D/g, '')
  if (clean.length === 10 && clean.startsWith('3')) return '57' + clean
  return clean
}

const LABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1'

const ROL_OPTIONS = [
  { id: 6, nombre: 'Administrador' },
  { id: 1, nombre: 'Coordinador' },
  { id: 4, nombre: 'Productor' },
  { id: 2, nombre: 'Técnico' },
  { id: 3, nombre: 'Mensajero' },
  { id: 5, nombre: 'Operario' },
]
const ROL_LABEL = { 1: 'Coordinador', 2: 'Técnico', 3: 'Mensajero', 4: 'Productor', 5: 'Operario', 6: 'Administrador' }
const ROL_COLOR = {
  1: 'bg-blue-50 text-blue-700 border-blue-200',
  2: 'bg-amber-50 text-amber-700 border-amber-200',
  3: 'bg-purple-50 text-purple-700 border-purple-200',
  4: 'bg-green-50 text-green-700 border-green-200',
  5: 'bg-gray-100 text-gray-600 border-gray-200',
  6: 'bg-red-50 text-red-700 border-red-200',
}

function useSearch(data, fields) {
  const [q, setQ] = useState('')
  const filtered = data.filter(item =>
    !q || fields.some(f => String(item[f] || '').toLowerCase().includes(q.toLowerCase()))
  )
  return { q, setQ, filtered }
}

function SearchBar({ q, setQ, placeholder = 'Buscar...' }) {
  return (
    <div className="relative flex-1 max-w-xs">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <Input className="pl-8" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
    </div>
  )
}

// ─── PERSONAL ────────────────────────────────────────────────────────────────
function TabPersonal() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState('')
  const { q, setQ, filtered }   = useSearch(data, ['nombre', 'apellido', 'cedula', 'email', 'whatsapp'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('personal').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true })
    setFormError('')
    setForm(item ? {
      nombre: item.nombre || '',
      apellido: item.apellido || '',
      cedula: item.cedula || '',
      email: item.email || '',
      whatsapp: item.whatsapp || '',
      rol_principal_id: item.rol_principal_id || 1,
      tipo_vehiculo: item.tipo_vehiculo || '',
      placa_vehiculo: item.placa_vehiculo || '',
      activo: item.activo !== false,
    } : {
      nombre: '', apellido: '', cedula: '', email: '', whatsapp: '',
      rol_principal_id: 1, tipo_vehiculo: '', placa_vehiculo: '', activo: true,
    })
  }

  async function guardar() {
    if (!form.nombre?.trim()) return setFormError('El nombre es requerido.')
    if (!form.apellido?.trim()) return setFormError('El apellido es requerido.')
    if (!form.rol_principal_id) return setFormError('Selecciona un rol.')
    setFormError('')
    setSaving(true)
    const body = nullify(
      { ...form, rol_principal_id: parseInt(form.rol_principal_id) },
      ['tipo_vehiculo', 'placa_vehiculo', 'email', 'whatsapp', 'cedula']
    )
    const { error } = selected?.id
      ? await db.from('personal').update(body).eq('id', selected.id)
      : await db.from('personal').insert(body)
    setSaving(false)
    if (error) { setFormError('Error al guardar: ' + error.message); return }

    // Si el email cambió y tiene cuenta de acceso, sincronizar en auth.users
    if (selected?.id && selected?.auth_user_id && form.email && form.email !== selected.email) {
      try {
        await callEdgeFunction('admin-auth', {
          action: 'updateUserEmail',
          userId: selected.auth_user_id,
          email: form.email,
        })
      } catch (e) {
        console.warn('Email actualizado en personal pero no en auth:', e.message)
      }
    }

    await cargar()
    setSelected(null)
  }

  async function eliminar(p) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${p.nombre} ${p.apellido}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('personal').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        if (await confirm(`Tiene servicios registrados y no se puede eliminar.\n¿Marcarlo como INACTIVO en su lugar?`, { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' })) {
          await db.from('personal').update({ activo: false }).eq('id', p.id)
          await cargar()
        }
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }

  const activos   = data.filter(p => p.activo !== false).length
  const inactivos = data.filter(p => p.activo === false).length

  return (
    <div>
      <div className="flex items-center gap-4 mb-5">
        <div className="text-[13px] text-gray-500">
          <span className="font-bold text-gray-900">{activos}</span> activos
          {inactivos > 0 && <span className="ml-2 text-gray-400">· {inactivos} inactivos</span>}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <SearchBar q={q} setQ={setQ} placeholder="Buscar por nombre, cédula o email..." />
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo empleado</Button>
      </div>

      {loading ? <div className="text-center py-10 text-gray-400">Cargando...</div> : (
        <TableWrap>
          <Table>
            <thead><tr>
              <Th>Empleado</Th><Th>Rol</Th><Th>Email / Acceso</Th>
              <Th>WhatsApp</Th><Th>Vehículo</Th><Th>Estado</Th><Th></Th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <Tr key={p.id}>
                  <Td>
                    <div className="font-semibold text-gray-900">{p.nombre} {p.apellido}</div>
                    {p.cedula && <div className="text-[11px] text-gray-400">CC {p.cedula}</div>}
                  </Td>
                  <Td>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ROL_COLOR[p.rol_principal_id] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {ROL_LABEL[p.rol_principal_id] || '—'}
                    </span>
                  </Td>
                  <Td>
                    {p.email
                      ? <span className="text-[12px] text-gray-600">{p.email}</span>
                      : <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Sin email</span>
                    }
                  </Td>
                  <Td className="text-gray-500 text-[12px]">{p.whatsapp || '—'}</Td>
                  <Td className="text-gray-500 text-[12px]">
                    {[p.tipo_vehiculo, p.placa_vehiculo].filter(Boolean).join(' · ') || '—'}
                  </Td>
                  <Td>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.activo !== false ? 'Activo' : 'Inactivo'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button>
                      <button
                        onClick={() => eliminar(p)}
                        title="Eliminar"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm">Sin resultados</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {selected && (
        <Modal
          open={!!selected}
          onClose={() => setSelected(null)}
          title={selected?.id ? `Editar — ${selected.nombre} ${selected.apellido}` : 'Nuevo empleado'}
          maxWidth="max-w-lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }
        >
          {formError && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">
              {formError}
            </div>
          )}
          <div className="space-y-5">
            {/* Datos personales */}
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Datos personales</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Nombre *</label>
                  <Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} maxLength={80} />
                </div>
                <div>
                  <label className={LABEL}>Apellido</label>
                  <Input value={form.apellido || ''} onChange={e => setForm(p => ({ ...p, apellido: e.target.value }))} maxLength={80} />
                </div>
                <div>
                  <label className={LABEL}>Cédula</label>
                  <Input value={form.cedula || ''} onChange={e => setForm(p => ({ ...p, cedula: e.target.value }))} maxLength={20} />
                </div>
                <div>
                  <label className={LABEL}>WhatsApp</label>
                  <Input value={form.whatsapp || ''} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} placeholder="3XX XXX XXXX" maxLength={20} />
                </div>
              </div>
            </div>

            {/* Acceso al sistema */}
            <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Acceso al sistema</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={LABEL}>Email (para iniciar sesión)</label>
                  <Input
                    type="email"
                    value={form.email || ''}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="correo@ejemplo.com"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Con este correo el empleado podrá ingresar al sistema.</p>
                </div>
                <div>
                  <label className={LABEL}>Rol en el sistema *</label>
                  <Select
                    value={form.rol_principal_id || ''}
                    onChange={e => setForm(p => ({ ...p, rol_principal_id: e.target.value }))}
                  >
                    <option value="">Seleccionar...</option>
                    {ROL_OPTIONS.map(r => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className={LABEL}>Estado</label>
                  <Select
                    value={form.activo ? 'true' : 'false'}
                    onChange={e => setForm(p => ({ ...p, activo: e.target.value === 'true' }))}
                  >
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </Select>
                </div>
              </div>
            </div>

            {/* Transporte */}
            <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Transporte <span className="font-normal normal-case">(opcional)</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Tipo de vehículo</label>
                  <Select value={form.tipo_vehiculo || ''} onChange={e => setForm(p => ({ ...p, tipo_vehiculo: e.target.value }))}>
                    <option value="">Ninguno</option>
                    <option value="MOTO">Moto</option>
                    <option value="CAMIONETA">Camioneta</option>
                    <option value="CARRO">Carro</option>
                  </Select>
                </div>
                <div>
                  <label className={LABEL}>Placa</label>
                  <Input
                    value={form.placa_vehiculo || ''}
                    onChange={e => setForm(p => ({ ...p, placa_vehiculo: e.target.value }))}
                    placeholder="AAA-000"
                    maxLength={10}
                  />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── VETERINARIAS / ALIADOS ───────────────────────────────────────────────────
function TabVeterinarias() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  const { q, setQ, filtered }   = useSearch(data, ['nombre', 'contacto_nombre', 'ciudad', 'identificacion_nit', 'whatsapp'])
  const [aprobando, setAprobando] = useState(null)   // id_aliado en curso
  const [aprobado, setAprobado]   = useState(null)   // { aliado, enlace } recién aprobado
  const [copiado, setCopiado]     = useState(false)

  useEffect(() => { cargar() }, [])

  // Aprueba una vet pendiente: el backend genera el token y devuelve el enlace.
  async function aprobarAliado(a) {
    if (!await confirm(`Se activará "${a.nombre}" y se generará su enlace de acceso para solicitar servicios.`, {
      title: '¿Aprobar veterinaria?', confirmLabel: 'Aprobar', variant: 'success',
    })) return
    setAprobando(a.id_aliado)
    try {
      const r = await orbitApi(`/aliados/${a.id_aliado}/aprobar`, { method: 'POST' })
      await cargar()
      setAprobado({ aliado: a, enlace: r.enlace })
    } catch (e) {
      await showAlert(e.message || 'No se pudo aprobar. Verifica tu sesión e intenta de nuevo.', { title: 'Error al aprobar' })
    } finally {
      setAprobando(null)
    }
  }

  // Genera (o recupera) el enlace de acceso de una veterinaria YA activa.
  // Reusa el mismo endpoint idempotente: si ya tiene token lo devuelve.
  async function generarEnlaceAliado(a) {
    const tiene = !!a.token_acceso
    if (!await confirm(
      tiene
        ? `Se mostrará el enlace de acceso de "${a.nombre}" para reenviárselo.`
        : `Se generará el enlace de acceso de "${a.nombre}" para que solicite servicios directamente.`,
      { title: tiene ? 'Ver enlace de acceso' : 'Generar enlace de acceso', confirmLabel: tiene ? 'Ver enlace' : 'Generar', variant: 'success' }
    )) return
    setAprobando(a.id_aliado)
    try {
      const r = await orbitApi(`/aliados/${a.id_aliado}/aprobar`, { method: 'POST' })
      await cargar()
      setAprobado({ aliado: a, enlace: r.enlace })
    } catch (e) {
      await showAlert(e.message || 'No se pudo generar el enlace. Verifica tu sesión e intenta de nuevo.', { title: 'Error' })
    } finally {
      setAprobando(null)
    }
  }

  function mensajeAccesoAliado(a, enlace) {
    return `Hola ${a.contacto_nombre || a.nombre} 🌿 Tu veterinaria ya está activa como aliada de *Camino al Cielo*.\n\n` +
      `Desde este enlace personal puedes solicitar recolecciones directamente:\n\n${enlace}\n\n` +
      `Guárdalo, es exclusivo de tu veterinaria 💚`
  }

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('aliados').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', identificacion_nit: item.identificacion_nit || '',
      contacto_nombre: item.contacto_nombre || '', whatsapp: item.whatsapp || '',
      telefono: item.telefono || '', email: item.email || '',
      ciudad: item.ciudad || 'Bogotá', localidad: item.localidad || '',
      barrio: item.barrio || '', direccion: item.direccion || '',
      horario: item.horario || {},
      vip: item.vip || false,
      modalidad_comision: item.modalidad_comision || 'FACTURACION_MENSUAL',
      saldo_comision: item.saldo_comision || 0,
      notas: item.notas || '', activo: item.activo !== false,
    } : {
      nombre: '', identificacion_nit: '', contacto_nombre: '',
      whatsapp: '', telefono: '', email: '',
      ciudad: 'Bogotá', localidad: '', barrio: '', direccion: '',
      horario: {},
      vip: false, modalidad_comision: 'FACTURACION_MENSUAL',
      saldo_comision: 0, notas: '', activo: true,
    })
  }

  async function guardar() {
    if (!form.nombre?.trim()) { await showAlert('El nombre es requerido.', { title: 'Campo requerido', variant: 'warning' }); return }
    setSaving(true)
    const body = nullify(form, ['modalidad_comision'])
    const { error } = selected?.id_aliado
      ? await db.from('aliados').update(body).eq('id_aliado', selected.id_aliado)
      : await db.from('aliados').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    await cargar()
    setSelected(null)
  }

  async function eliminar(a) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar a ${a.nombre}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('aliados').delete().eq('id_aliado', a.id_aliado)
    if (error) {
      if (error.code === '23503') {
        if (await confirm(`Tiene servicios registrados y no se puede eliminar.\n¿Marcarlo como INACTIVO en su lugar?`, { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' })) {
          await db.from('aliados').update({ activo: false }).eq('id_aliado', a.id_aliado)
          await cargar()
        }
      } else {
        await showAlert(parsearErrorDB(error), { title: 'Error al eliminar' })
      }
      return
    }
    await cargar()
  }

  const vips    = data.filter(a => a.vip).length
  const activos = data.filter(a => a.activo !== false).length
  // Onboarding al portal: cuántas vets activas ya tienen enlace de acceso (token)
  const activasReales = data.filter(a => a.activo !== false && a.estado !== 'pendiente_validacion')
  const conAcceso = activasReales.filter(a => a.token_acceso).length

  return (
    <div>
      <div className="flex items-center gap-4 mb-5">
        <div className="text-[13px] text-gray-500">
          <span className="font-bold text-gray-900">{activos}</span> activos
          {vips > 0 && <span className="ml-2 text-amber-600 font-semibold">· {vips} VIP</span>}
          <span className="ml-2 text-[#3D5A27] font-semibold">· {conAcceso}/{activasReales.length} con acceso al portal</span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <SearchBar q={q} setQ={setQ} placeholder="Buscar por nombre, NIT o ciudad..." />
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo aliado</Button>
      </div>

      {/* Cola de aprobación — veterinarias que se auto-registraron por el portal */}
      {data.some(a => a.estado === 'pendiente_validacion') && (
        <div className="mb-4 rounded-2xl border-2 p-4" style={{ borderColor: '#FCD9A6', background: '#FFFBF3' }}>
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope size={15} className="text-amber-600" />
            <span className="text-[13px] font-bold text-amber-800">Veterinarias pendientes de validación</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              {data.filter(a => a.estado === 'pendiente_validacion').length}
            </span>
          </div>
          <div className="space-y-2">
            {data.filter(a => a.estado === 'pendiente_validacion').map(a => (
              <div key={a.id_aliado} className="flex items-center gap-3 bg-white rounded-xl border border-amber-100 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">{a.nombre}</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {[a.identificacion_nit && `NIT ${a.identificacion_nit}`, a.contacto_nombre, a.ciudad, a.whatsapp].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => abrir(a)}>Revisar</Button>
                <Button size="sm" onClick={() => aprobarAliado(a)} disabled={aprobando === a.id_aliado}>
                  {aprobando === a.id_aliado ? 'Aprobando…' : <><CheckCircle size={13} /> Aprobar</>}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-10 text-gray-400">Cargando...</div> : (
        <TableWrap>
          <Table>
            <thead><tr>
              <Th>Nombre</Th><Th>Contacto</Th><Th>WhatsApp</Th>
              <Th>Ciudad</Th><Th>Horario</Th><Th>VIP</Th><Th>Comisión</Th><Th>Estado</Th><Th>Portal</Th><Th></Th>
            </tr></thead>
            <tbody>
              {filtered.map(a => (
                <Tr key={a.id_aliado}>
                  <Td>
                    <div className="font-semibold text-gray-900">{a.nombre}</div>
                    {a.identificacion_nit && <div className="text-[11px] text-gray-400">NIT: {a.identificacion_nit}</div>}
                  </Td>
                  <Td className="text-gray-600 text-[12px]">{a.contacto_nombre || '—'}</Td>
                  <Td className="text-gray-500 text-[12px]">{a.whatsapp || '—'}</Td>
                  <Td className="text-gray-500 text-[12px]">{a.ciudad || '—'}</Td>
                  <Td className="text-gray-500 text-[11px]">{resumenHorario(a.horario)}</Td>
                  <Td>
                    {a.vip
                      ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">VIP</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </Td>
                  <Td className="text-gray-500 text-[11px]">
                    {a.modalidad_comision === 'FACTURACION_MENSUAL' ? 'Mensual'
                      : a.modalidad_comision === 'DESCUENTO_INMEDIATO' ? 'Inmediato'
                      : a.modalidad_comision === 'CREDITO_ACUMULADO' ? 'Crédito'
                      : '—'}
                  </Td>
                  <Td>
                    {a.estado === 'pendiente_validacion' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Pendiente</span>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.activo !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {a.activo !== false ? 'Activo' : 'Inactivo'}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {a.estado === 'pendiente_validacion' ? (
                      <span className="text-gray-300">—</span>
                    ) : a.token_acceso ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EAF3E2', color: '#3D5A27' }}>
                        <KeyRound size={9} /> Con acceso
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Sin enlace</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      {a.estado !== 'pendiente_validacion' && a.activo !== false && (
                        <Button size="sm" variant="ghost" onClick={() => generarEnlaceAliado(a)} disabled={aprobando === a.id_aliado}
                          title={a.token_acceso ? 'Ver / reenviar enlace de acceso' : 'Generar enlace de acceso al portal'}>
                          <KeyRound size={13} /> {aprobando === a.id_aliado ? '…' : a.token_acceso ? 'Enlace' : 'Generar'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => abrir(a)}>Editar</Button>
                      <button
                        onClick={() => eliminar(a)}
                        title="Eliminar"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400 text-sm">Sin aliados registrados</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {selected && (
        <Modal
          open={!!selected}
          onClose={() => setSelected(null)}
          title={selected?.id_aliado ? 'Editar aliado' : 'Nuevo aliado / veterinaria'}
          maxWidth="max-w-lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }
        >
          <div className="space-y-5">
            {/* Datos del establecimiento */}
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Establecimiento</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={LABEL}>Nombre del establecimiento *</label>
                  <Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>NIT / Cédula</label>
                  <Input value={form.identificacion_nit || ''} onChange={e => setForm(p => ({ ...p, identificacion_nit: e.target.value }))} maxLength={30} />
                </div>
                <div>
                  <label className={LABEL}>Ciudad</label>
                  <Input value={form.ciudad || ''} onChange={e => setForm(p => ({ ...p, ciudad: e.target.value }))} maxLength={80} />
                </div>
                <div>
                  <label className={LABEL}>Localidad</label>
                  <LocalidadSelect value={form.localidad || ''} onChange={v => setForm(p => ({ ...p, localidad: v }))} />
                </div>
                <div>
                  <label className={LABEL}>Barrio / Sector</label>
                  <Input value={form.barrio || ''} onChange={e => setForm(p => ({ ...p, barrio: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={LABEL}>Dirección</label>
                  <Input value={form.direccion || ''} onChange={e => setForm(p => ({ ...p, direccion: e.target.value }))} placeholder="Calle / Carrera / Av..." />
                </div>
              </div>
            </div>

            {/* Contacto */}
            <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Contacto</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Nombre del contacto</label>
                  <Input value={form.contacto_nombre || ''} onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))} maxLength={80} />
                </div>
                <div>
                  <label className={LABEL}>WhatsApp</label>
                  <Input value={form.whatsapp || ''} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} placeholder="3XX XXX XXXX" maxLength={20} />
                </div>
                <div>
                  <label className={LABEL}>Teléfono fijo</label>
                  <Input value={form.telefono || ''} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} maxLength={20} />
                </div>
                <div>
                  <label className={LABEL}>Email</label>
                  <Input type="email" value={form.email || ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="contacto@vet.com" />
                </div>
                <div className="col-span-2">
                  <label className={LABEL}>Horario de atención</label>
                  <div className="mt-1.5">
                    <HorarioEditor value={form.horario || {}} onChange={v => setForm(p => ({ ...p, horario: v }))} />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className={LABEL}>Notas internas</label>
                  <Input value={form.notas || ''} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones, condiciones especiales..." />
                </div>
              </div>
            </div>

            {/* Comisiones */}
            <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Comisiones y configuración</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Modalidad de comisión</label>
                  <Select
                    value={form.modalidad_comision || 'FACTURACION_MENSUAL'}
                    onChange={e => setForm(p => ({ ...p, modalidad_comision: e.target.value }))}
                  >
                    <option value="FACTURACION_MENSUAL">Facturación mensual</option>
                    <option value="DESCUENTO_INMEDIATO">Descuento inmediato</option>
                    <option value="CREDITO_ACUMULADO">Crédito acumulado</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-2 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!form.vip}
                      onChange={e => setForm(p => ({ ...p, vip: e.target.checked }))}
                      className="w-4 h-4 accent-[#C4A87A]"
                    />
                    <span className="text-[13px] font-semibold text-gray-700">Aliado VIP</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.activo !== false}
                      onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))}
                      className="w-4 h-4 accent-[#1A5CD8]"
                    />
                    <span className="text-[13px] font-semibold text-gray-700">Activo</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Resultado de aprobación: enlace personal de la veterinaria */}
      {aprobado && (
        <Modal open={!!aprobado} onClose={() => { setAprobado(null); setCopiado(false) }}
          title="Enlace de acceso de la veterinaria" maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end w-full gap-2">
              <Button variant="secondary" onClick={() => { setAprobado(null); setCopiado(false) }}>Cerrar</Button>
              <a href={waLink(aprobado.aliado.whatsapp, mensajeAccesoAliado(aprobado.aliado, aprobado.enlace))}
                target="_blank" rel="noreferrer"
                className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90 ${aprobado.aliado.whatsapp ? '' : 'pointer-events-none opacity-40'}`}
                style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}>
                <MessageCircle size={13} /> Enviar por WhatsApp
              </a>
            </div>
          }>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-green-700">
              <CheckCircle size={16} /> {aprobado.aliado.nombre}
            </div>
            <p className="text-[12px] text-gray-500 leading-relaxed">
              Este es su <span className="font-semibold">enlace personal</span> para solicitar servicios.
              Es exclusivo de esta veterinaria — envíaselo por WhatsApp o cópialo.
            </p>
            <div className="rounded-xl p-3 bg-gray-50 border border-gray-200 break-all text-[12px] font-mono text-gray-700">
              {aprobado.enlace}
            </div>
            <button type="button"
              onClick={async () => { try { await navigator.clipboard.writeText(aprobado.enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch {} }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
              {copiado ? <><CheckCircle size={12} className="text-green-600" /> Enlace copiado</> : <><Copy size={12} /> Copiar enlace</>}
            </button>
            {!aprobado.aliado.whatsapp && (
              <p className="text-[11px] text-amber-600">Esta veterinaria no tiene WhatsApp registrado; copia el enlace y envíaselo manualmente.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── ACCESOS ─────────────────────────────────────────────────────────────────
function TabAccesos() {
  const [personal, setPersonal] = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null) // { persona, mode: 'crear'|'cambiar' }
  const [pw, setPw]             = useState('')
  const [pw2, setPw2]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [modalError, setModalError] = useState('')
  const [success, setSuccess]   = useState(null) // { texto, nombre, email, pw, whatsapp }
  const { q, setQ, filtered }   = useSearch(personal, ['nombre', 'apellido', 'email'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('personal').select('*').order('nombre')
    setPersonal(d || [])
    setLoading(false)
  }

  function abrirModal(persona, mode) {
    setModal({ persona, mode })
    setPw('')
    setPw2('')
    setModalError('')
    setSuccess(null)
  }

  async function guardarAcceso() {
    if (!pw.trim()) return setModalError('Ingresa una contraseña.')
    if (pw.length < 6) return setModalError('La contraseña debe tener al menos 6 caracteres.')
    if (pw !== pw2) return setModalError('Las contraseñas no coinciden.')
    setModalError('')
    setSaving(true)

    const { persona, mode } = modal
    try {
      if (mode === 'crear') {
        const result = await callEdgeFunction('admin-auth', {
          action: 'createUser', email: persona.email, password: pw,
        })
        await db.from('personal').update({ auth_user_id: result.user.id }).eq('id', persona.id)
        await cargar()
        setModal(null)
        setSuccess({
          texto: `✓ Cuenta creada para ${persona.nombre}.\n\nEmail: ${persona.email}\nContraseña: ${pw}`,
          nombre: persona.nombre, email: persona.email, pw, whatsapp: persona.whatsapp,
        })
      } else {
        await callEdgeFunction('admin-auth', {
          action: 'updateUser', userId: persona.auth_user_id, password: pw,
        })
        setModal(null)
        setSuccess({
          texto: `✓ Contraseña actualizada para ${persona.nombre}.\n\nEmail: ${persona.email}\nNueva contraseña: ${pw}`,
          nombre: persona.nombre, email: persona.email, pw, whatsapp: persona.whatsapp,
        })
      }
    } catch (e) {
      setModalError('Error inesperado: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const conEmail  = filtered.filter(p => p.email?.trim())
  const sinEmail  = filtered.filter(p => !p.email?.trim())
  const conCuenta = personal.filter(p => p.auth_user_id).length

  return (
    <div className="space-y-6">

      {/* Resultado exitoso con contraseña */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[13px] font-bold text-green-800 mb-1">Acceso configurado</div>
            <pre className="text-[12px] text-green-700 font-mono whitespace-pre-wrap">{success.texto}</pre>
            <div className="flex items-center gap-2 mt-3">
              <p className="text-[11px] text-green-600 flex-1">Guarda o comparte estas credenciales con el empleado.</p>
              {success.whatsapp && (
                <a
                  href={`https://wa.me/${limpiarWA(success.whatsapp)}?text=${encodeURIComponent(
                    `Hola ${success.nombre}, aquí están tus datos de acceso al sistema Camino al Cielo:\n\n📧 Usuario: ${success.email}\n🔑 Contraseña: ${success.pw}\n\nInicia sesión en: https://cacapp.vercel.app`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                  style={{ backgroundColor: '#25D366', color: '#fff' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1DAF54'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = '#25D366'}
                >
                  <Send size={12} />
                  Enviar por WhatsApp
                </a>
              )}
            </div>
          </div>
          <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total empleados', value: personal.length, color: 'text-gray-900' },
          { label: 'Con cuenta activa', value: conCuenta, color: 'text-green-700' },
          { label: 'Sin email registrado', value: personal.filter(p => !p.email).length, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-3 text-center shadow-sm">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-gray-400 font-medium mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <SearchBar q={q} setQ={setQ} placeholder="Buscar por nombre o email..." />
        <button className="text-gray-400 hover:text-[#1A5CD8] p-1.5 rounded-lg hover:bg-gray-100 transition-colors" onClick={cargar} title="Actualizar">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? <div className="text-center py-10 text-gray-400">Cargando...</div> : (
        <>
          <TableWrap>
            <Table>
              <thead><tr>
                <Th>Empleado</Th><Th>Rol</Th><Th>Email</Th><Th>Estado</Th><Th>Acción</Th>
              </tr></thead>
              <tbody>
                {conEmail.map(p => {
                  const tieneAuth = !!p.auth_user_id
                  return (
                    <Tr key={p.id}>
                      <Td><div className="font-semibold text-gray-900">{p.nombre} {p.apellido}</div></Td>
                      <Td>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ROL_COLOR[p.rol_principal_id] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {ROL_LABEL[p.rol_principal_id] || '—'}
                        </span>
                      </Td>
                      <Td className="text-[12px] text-gray-600">{p.email}</Td>
                      <Td>
                        {tieneAuth
                          ? <span className="flex items-center gap-1.5 text-[12px] text-green-600 font-medium"><CheckCircle size={13} /> Activa</span>
                          : <span className="flex items-center gap-1.5 text-[12px] text-gray-400"><AlertCircle size={13} /> Sin cuenta</span>
                        }
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          {!tieneAuth && (
                            <Button size="sm" onClick={() => abrirModal(p, 'crear')}>
                              <KeyRound size={12} /> Crear acceso
                            </Button>
                          )}
                          {tieneAuth && (
                            <Button size="sm" variant="secondary" onClick={() => abrirModal(p, 'cambiar')}>
                              <KeyRound size={12} /> Cambiar contraseña
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
                {conEmail.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">Sin resultados</td></tr>
                )}
              </tbody>
            </Table>
          </TableWrap>

          {sinEmail.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="text-[12px] font-bold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertCircle size={13} /> {sinEmail.length} empleado{sinEmail.length > 1 ? 's' : ''} sin email
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {sinEmail.map(p => (
                  <div key={p.id} className="text-[12px] bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-gray-700">
                    {p.nombre} {p.apellido}
                    <span className="text-gray-400 ml-1">· {ROL_LABEL[p.rol_principal_id]}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-700">Ve a <strong>Personal</strong> y agrégales un email para poder darles acceso.</p>
            </div>
          )}
        </>
      )}

      {/* Modal crear / cambiar contraseña */}
      {modal && (
        <Modal
          open={!!modal}
          onClose={() => setModal(null)}
          title={modal.mode === 'crear' ? `Crear acceso — ${modal.persona.nombre}` : `Cambiar contraseña — ${modal.persona.nombre}`}
          maxWidth="max-w-sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancelar</Button>
              <Button onClick={guardarAcceso} disabled={saving}>{saving ? 'Guardando...' : modal.mode === 'crear' ? 'Crear acceso' : 'Cambiar contraseña'}</Button>
            </>
          }
        >
          <div className="space-y-4">
            {modalError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">
                {modalError}
              </div>
            )}

            <div>
              <label className={LABEL}>Email</label>
              <div className="text-[13px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                {modal.persona.email}
              </div>
            </div>

            <div>
              <label className={LABEL}>Contraseña {modal.mode === 'crear' ? 'temporal' : 'nueva'}</label>
              <Input
                type="password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoFocus
              />
            </div>

            <div>
              <label className={LABEL}>Confirmar contraseña</label>
              <Input
                type="password"
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                placeholder="Repite la contraseña"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── PLANES ───────────────────────────────────────────────────────────────────
function TabPlanes() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')
  const { q, setQ, filtered }     = useSearch(data, ['nombre', 'codigo', 'tipo_proceso'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('planes').select('*').order('nombre')
    setData(d || []); setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true }); setFormError('')
    setForm(item ? {
      codigo: item.codigo || '', nombre: item.nombre || '',
      categoria: item.categoria || '', tipo_proceso: item.tipo_proceso || '',
      requiere_imagenes: item.requiere_imagenes !== false,
      dias_entrega_prometidos: item.dias_entrega_prometidos ?? 8,
      precio_base: item.precio_base ?? 0,
      descripcion: item.descripcion || '', activo: item.activo !== false,
    } : {
      codigo: '', nombre: '', categoria: '', tipo_proceso: '',
      requiere_imagenes: true, dias_entrega_prometidos: 8,
      precio_base: 0, descripcion: '', activo: true,
    })
  }

  async function guardar() {
    if (!form.codigo?.trim()) return setFormError('El código es requerido.')
    if (!form.nombre?.trim()) return setFormError('El nombre es requerido.')
    setFormError(''); setSaving(true)
    const body = nullify({
      ...form,
      codigo: form.codigo.trim().toUpperCase(),
      dias_entrega_prometidos: parseInt(form.dias_entrega_prometidos) || null,
      precio_base: parseFloat(form.precio_base) || 0,
    }, ['tipo_proceso', 'categoria'])
    const { error } = selected?.id
      ? await db.from('planes').update(body).eq('id', selected.id)
      : await db.from('planes').insert(body)
    setSaving(false)
    if (error) { setFormError('Error: ' + error.message); return }
    await cargar(); setSelected(null)
  }

  async function eliminar(p) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar el plan "${p.nombre}"?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('planes').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        if (await confirm('Este plan tiene servicios o ítems vinculados.\n¿Marcarlo como INACTIVO?', { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' }))
          await db.from('planes').update({ activo: false }).eq('id', p.id)
      } else await showAlert(parsearErrorDB(error), { title: 'Error' })
    }
    await cargar()
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <SearchBar q={q} setQ={setQ} placeholder="Buscar por nombre o código..." />
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo plan</Button>
      </div>
      {loading ? <div className="text-center py-10 text-gray-400">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Tipo proceso</Th><Th>Días</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <Tr key={p.id}>
                <Td><span className="font-mono text-[11px] bg-gray-100 px-2 py-0.5 rounded">{p.codigo}</span></Td>
                <Td className="font-semibold text-gray-900">{p.nombre}</Td>
                <Td className="text-gray-500 text-[12px]">{p.tipo_proceso?.replace(/_/g, ' ') || '—'}</Td>
                <Td className="text-gray-500 text-[12px]">{p.dias_entrega_prometidos ?? '—'}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.activo !== false ? 'Activo' : 'Inactivo'}</span></Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button>
                    <button onClick={() => eliminar(p)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">Sin planes</td></tr>}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? `Editar — ${selected.nombre}` : 'Nuevo plan'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}
        >
          {formError && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formError}</div>}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL}>Código *</label><Input value={form.codigo || ''} onChange={e => setForm(p => ({ ...p, codigo: e.target.value.toUpperCase() }))} placeholder="BASICO" maxLength={60} /></div>
              <div><label className={LABEL}>Nombre *</label><Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div>
                <label className={LABEL}>Tipo de proceso</label>
                <Select value={form.tipo_proceso || ''} onChange={e => setForm(p => ({ ...p, tipo_proceso: e.target.value }))}>
                  <option value="">Sin definir</option>
                  <option value="CREMACION_GRUPAL">Cremación grupal</option>
                  <option value="CREMACION_INDIVIDUAL">Cremación individual</option>
                  <option value="COMPOSTAJE_GRUPAL">Compostaje grupal</option>
                  <option value="COMPOSTAJE_INDIVIDUAL">Compostaje individual</option>
                </Select>
              </div>
              <div>
                <label className={LABEL}>Categoría</label>
                <Select value={form.categoria || ''} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))}>
                  <option value="">— Sin categoría —</option>
                  <option value="individual">Individual</option>
                  <option value="grupal">Grupal</option>
                  <option value="especial">Especial</option>
                </Select>
              </div>
              <div><label className={LABEL}>Días de entrega</label><Input type="number" min="1" value={form.dias_entrega_prometidos || ''} onChange={e => setForm(p => ({ ...p, dias_entrega_prometidos: e.target.value }))} /></div>
              <div><label className={LABEL}>Precio base ($)</label><Input type="number" min="0" value={form.precio_base || ''} onChange={e => setForm(p => ({ ...p, precio_base: e.target.value }))} /></div>
            </div>
            <div><label className={LABEL}>Descripción</label><Textarea value={form.descripcion || ''} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} /></div>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.requiere_imagenes} onChange={e => setForm(p => ({ ...p, requiere_imagenes: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Requiere imágenes</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.activo !== false} onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Activo</span></label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── RECORDATORIOS ────────────────────────────────────────────────────────────
function TabRecordatorios() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]           = useState([])
  const [maquinas, setMaquinas]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')
  const { q, setQ, filtered }     = useSearch(data, ['nombre', 'categoria'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: m }] = await Promise.all([
      db.from('recordatorios').select('*, maquinas_produccion(nombre)').order('nombre'),
      db.from('maquinas_produccion').select('id,nombre').order('nombre'),
    ])
    setData(d || []); setMaquinas(m || []); setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true }); setFormError('')
    setForm(item ? {
      nombre: item.nombre || '', descripcion: item.descripcion || '',
      categoria: item.categoria || '', requiere_imagen: item.requiere_imagen !== false,
      solo_nombre: !!item.solo_nombre, precio_base: item.precio_base ?? 0,
      max_fotos: item.max_fotos ?? 1,
      campos_texto: item.campos_texto || [],
      maquina_id: item.maquina_id || '', tiempo_produccion_dias: item.tiempo_produccion_dias ?? 1,
      recolecta_tecnico: !!item.recolecta_tecnico,
      activo: item.activo !== false,
    } : {
      nombre: '', descripcion: '', categoria: '', requiere_imagen: true,
      solo_nombre: false, precio_base: 0, max_fotos: 1,
      campos_texto: [],
      maquina_id: '', tiempo_produccion_dias: 1, recolecta_tecnico: false, activo: true,
    })
  }

  async function guardar() {
    if (!form.nombre?.trim()) return setFormError('El nombre es requerido.')
    setFormError(''); setSaving(true)
    const body = nullify({
      ...form,
      precio_base: parseFloat(form.precio_base) || 0,
      max_fotos: Math.max(0, parseInt(form.max_fotos) ?? 0),
      campos_texto: (form.campos_texto || []).filter(c => c.label?.trim()),
      tiempo_produccion_dias: parseInt(form.tiempo_produccion_dias) || 1,
      maquina_id: form.maquina_id ? parseInt(form.maquina_id) : null,
    }, ['categoria', 'maquina_id'])
    const { error } = selected?.id
      ? await db.from('recordatorios').update(body).eq('id', selected.id)
      : await db.from('recordatorios').insert(body)
    setSaving(false)
    if (error) { setFormError('Error: ' + error.message); return }
    await cargar(); setSelected(null)
  }

  async function eliminar(r) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar "${r.nombre}"?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('recordatorios').delete().eq('id', r.id)
    if (error) {
      if (error.code === '23503') {
        if (await confirm('Este ítem tiene planes o servicios vinculados.\n¿Marcarlo como INACTIVO?', { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Marcar inactivo', cancelLabel: 'Cancelar' }))
          await db.from('recordatorios').update({ activo: false }).eq('id', r.id)
      } else await showAlert(parsearErrorDB(error), { title: 'Error' })
    }
    await cargar()
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <SearchBar q={q} setQ={setQ} placeholder="Buscar por nombre o categoría..." />
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo ítem</Button>
      </div>
      {loading ? <div className="text-center py-10 text-gray-400">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Categoría</Th><Th>Máquina</Th><Th>Precio</Th><Th>Fotos</Th><Th>Req. img</Th><Th>Solo nombre</Th><Th>Técnico</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(r => (
              <Tr key={r.id}>
                <Td className="font-semibold text-gray-900">{r.nombre}</Td>
                <Td><span className="text-[11px] capitalize bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{r.categoria || '—'}</span></Td>
                <Td className="text-gray-500 text-[12px]">{r.maquinas_produccion?.nombre || '—'}</Td>
                <Td className="text-gray-600 text-[12px]">{r.precio_base ? `$${Number(r.precio_base).toLocaleString('es-CO')}` : '—'}</Td>
                <Td>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                    {r.max_fotos ?? 1} foto{(r.max_fotos ?? 1) > 1 ? 's' : ''}
                  </span>
                </Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.requiere_imagen ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{r.requiere_imagen ? 'Sí' : 'No'}</span></Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.solo_nombre ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.solo_nombre ? 'Sí' : 'No'}</span></Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.recolecta_tecnico ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{r.recolecta_tecnico ? 'Sí' : 'No'}</span></Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.activo !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.activo !== false ? 'Activo' : 'Inactivo'}</span></Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => abrir(r)}>Editar</Button>
                    <button onClick={() => eliminar(r)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-gray-400 text-sm">Sin ítems</td></tr>}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? `Editar — ${selected.nombre}` : 'Nuevo ítem de recordatorio'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}
        >
          {formError && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formError}</div>}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={LABEL}>Nombre *</label><Input value={form.nombre || ''} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} /></div>
              <div>
                <label className={LABEL}>Categoría</label>
                <Select value={form.categoria || ''} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))}>
                  <option value="">Sin categoría</option>
                  <option value="fisico">Físico</option>
                  <option value="digital">Digital</option>
                  <option value="ceremonia">Ceremonia</option>
                </Select>
              </div>
              <div>
                <label className={LABEL}>Máquina</label>
                <Select value={form.maquina_id || ''} onChange={e => setForm(p => ({ ...p, maquina_id: e.target.value }))}>
                  <option value="">Sin asignar</option>
                  {maquinas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </Select>
              </div>
              <div><label className={LABEL}>Precio base ($)</label><Input type="number" min="0" value={form.precio_base || ''} onChange={e => setForm(p => ({ ...p, precio_base: e.target.value }))} /></div>
              <div><label className={LABEL}>Días producción</label><Input type="number" min="0" value={form.tiempo_produccion_dias || ''} onChange={e => setForm(p => ({ ...p, tiempo_produccion_dias: e.target.value }))} /></div>
              <div>
                <label className={LABEL}>N° de fotos que pide al cliente</label>
                <Input
                  type="number" min="0" max="6"
                  value={form.max_fotos ?? 0}
                  onChange={e => setForm(p => ({ ...p, max_fotos: e.target.value }))}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  0 = sin fotos · Ej: postales = 2, cuadro = 1, álbum = 4
                </p>
              </div>
            </div>
            <div><label className={LABEL}>Descripción</label><Textarea value={form.descripcion || ''} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} /></div>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.requiere_imagen} onChange={e => setForm(p => ({ ...p, requiere_imagen: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Requiere imagen</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.solo_nombre} onChange={e => setForm(p => ({ ...p, solo_nombre: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Solo nombre</span></label>
              <label className="flex items-center gap-2 cursor-pointer" title="El técnico lo entrega/recoge en la recogida. Al confirmar la recogida pasa solo a EN_PROCESO."><input type="checkbox" checked={!!form.recolecta_tecnico} onChange={e => setForm(p => ({ ...p, recolecta_tecnico: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Lo recolecta el técnico</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.activo !== false} onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" /><span className="text-[13px] font-semibold text-gray-700">Activo</span></label>
            </div>

            {/* ── Campos de texto del cliente ── */}
            <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
              <label className={LABEL}>Campos de texto del cliente</label>
              <p className="text-[11px] text-gray-400 mb-3">
                Frases, dedicatorias, cualidades u otros textos que el cliente debe escribir en el portal.
              </p>
              <div className="space-y-2">
                {(form.campos_texto || []).map((campo, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <Input
                        value={campo.label || ''}
                        onChange={e => {
                          const next = [...(form.campos_texto || [])]
                          next[idx] = { ...next[idx], label: e.target.value }
                          setForm(p => ({ ...p, campos_texto: next }))
                        }}
                        placeholder="Nombre del campo (ej: Frase, Cualidad, Dedicatoria)"
                        className="text-[12px]"
                      />
                    </div>
                    <div className="w-20 flex-shrink-0">
                      <Input
                        type="number" min="1" max="10"
                        value={campo.cantidad ?? 1}
                        onChange={e => {
                          const next = [...(form.campos_texto || [])]
                          next[idx] = { ...next[idx], cantidad: parseInt(e.target.value) || 1 }
                          setForm(p => ({ ...p, campos_texto: next }))
                        }}
                        className="text-[12px] text-center"
                        title="Cantidad"
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">cant.</span>
                    <button
                      onClick={() => setForm(p => ({ ...p, campos_texto: p.campos_texto.filter((_, i) => i !== idx) }))}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setForm(p => ({ ...p, campos_texto: [...(p.campos_texto || []), { label: '', cantidad: 1 }] }))}
                  className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-dashed transition-colors hover:bg-gray-50"
                  style={{ borderColor: '#C5DEC9', color: '#1A5CD8' }}
                >
                  <Plus size={12} /> Agregar campo de texto
                </button>
              </div>
            </div>

          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── PLAN → ÍTEMS ─────────────────────────────────────────────────────────────
function TabPlanItems() {
  const { confirm, alert: showAlert } = useConfirm()
  const [planes, setPlanes]               = useState([])
  const [recordatorios, setRecordatorios] = useState([])
  // conteo de ítems por plan para mostrar en la lista izquierda
  const [countsByPlan, setCountsByPlan]   = useState({})
  const [planId, setPlanId]               = useState(null)
  const [items, setItems]                 = useState([])
  const [loading, setLoading]             = useState(true)
  const [loadingItems, setLoadingItems]   = useState(false)
  const [editingId, setEditingId]         = useState(null)
  const [editCantidad, setEditCantidad]   = useState(1)
  const [addRecId, setAddRecId]           = useState('')
  const [addCantidad, setAddCantidad]     = useState(1)
  const [addIncluido, setAddIncluido]     = useState(true)
  const [saving, setSaving]               = useState(false)
  const [busqueda, setBusqueda]           = useState('')
  const [qItems, setQItems]               = useState('')

  useEffect(() => {
    async function cargarTodo() {
      const [{ data: pl }, { data: rc }, { data: todos }] = await Promise.all([
        db.from('planes').select('id,nombre,codigo').order('nombre'),
        db.from('recordatorios').select('id,nombre,categoria').eq('activo', true).order('nombre'),
        db.from('plan_recordatorios').select('plan_id'),
      ])
      setPlanes(pl || [])
      setRecordatorios(rc || [])
      // contar ítems por plan
      const counts = {}
      ;(todos || []).forEach(r => { counts[r.plan_id] = (counts[r.plan_id] || 0) + 1 })
      setCountsByPlan(counts)
      setLoading(false)
    }
    cargarTodo()
  }, [])

  async function cargarItems(id) {
    setLoadingItems(true)
    setItems([])
    const { data: d, error } = await db.from('plan_recordatorios')
      .select('*, recordatorios(nombre, categoria, solo_nombre)')
      .eq('plan_id', id)
    if (error) console.error('plan_recordatorios error:', error)
    const sorted = (d || []).slice().sort((a, b) =>
      (a.recordatorios?.nombre || '').localeCompare(b.recordatorios?.nombre || '')
    )
    setItems(sorted)
    setLoadingItems(false)
  }

  function seleccionarPlan(id) {
    setPlanId(id)
    setEditingId(null)
    setAddRecId('')
    setAddCantidad(1)
    setAddIncluido(true)
    setQItems('')
    cargarItems(id)
  }

  async function agregar() {
    if (!addRecId || !planId) return
    if (yaEnPlanSet.has(addRecId)) {
      setAddRecId('')
      return
    }
    setSaving(true)
    const { error } = await db.from('plan_recordatorios').insert({
      plan_id: planId,
      recordatorio_id: addRecId,
      cantidad: parseInt(addCantidad) || 1,
      incluido_en_precio: addIncluido,
    })
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al agregar' }); return }
    setAddRecId(''); setAddCantidad(1); setAddIncluido(true); setBusqueda('')
    setCountsByPlan(prev => ({ ...prev, [planId]: (prev[planId] || 0) + 1 }))
    await cargarItems(planId)
  }

  async function guardarEdicion(id) {
    const { error } = await db.from('plan_recordatorios')
      .update({ cantidad: parseInt(editCantidad) || 1 })
      .eq('id', id)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
    setEditingId(null)
    await cargarItems(planId)
  }

  async function toggleIncluido(id, actual) {
    await db.from('plan_recordatorios').update({ incluido_en_precio: !actual }).eq('id', id)
    await cargarItems(planId)
  }

  async function eliminar(id, nombre) {
    if (!await confirm(`¿Quitar "${nombre}" del plan?`, { title: 'Quitar ítem', variant: 'danger', confirmLabel: 'Quitar' })) return
    const { error } = await db.from('plan_recordatorios').delete().eq('id', id)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
    setCountsByPlan(prev => ({ ...prev, [planId]: Math.max(0, (prev[planId] || 1) - 1) }))
    await cargarItems(planId)
  }

  const planActual  = planes.find(p => p.id === planId)
  const yaEnPlanSet = new Set(items.map(i => i.recordatorio_id))
  // Lista completa filtrada por búsqueda — incluye los ya agregados (marcados como deshabilitados)
  const dispFiltrados = recordatorios.filter(r =>
    !busqueda.trim() ||
    r.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (r.categoria || '').toLowerCase().includes(busqueda.toLowerCase())
  )
  // Filtro sobre los ítems ya en el plan (tabla superior)
  const itemsFiltrados = qItems.trim()
    ? items.filter(i =>
        (i.recordatorios?.nombre || '').toLowerCase().includes(qItems.toLowerCase()) ||
        (i.recordatorios?.categoria || '').toLowerCase().includes(qItems.toLowerCase())
      )
    : items

  if (loading) return <div className="text-center py-10 text-gray-400">Cargando...</div>

  return (
    <div className="flex gap-5 min-h-[520px]">

      {/* ── LISTA DE PLANES (izquierda) ── */}
      <div className="w-56 flex-shrink-0">
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Planes</div>
        <div className="space-y-1">
          {planes.map(p => {
            const n = countsByPlan[p.id] || 0
            const activo = planId === p.id
            return (
              <button key={p.id}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between gap-2 ${
                  activo
                    ? 'bg-[#1A5CD8] text-white shadow-sm'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                onClick={() => seleccionarPlan(p.id)}
              >
                <div className="min-w-0">
                  <div className={`text-[12px] font-semibold truncate ${activo ? 'text-white' : 'text-gray-800'}`}>{p.nombre}</div>
                  <div className={`text-[10px] truncate ${activo ? 'text-green-200' : 'text-gray-400'}`}>{p.codigo}</div>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                  activo ? 'bg-white/20 text-white' : n > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                }`}>
                  {n}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── PANEL DERECHO ── */}
      <div className="flex-1 min-w-0">
        {!planId ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 py-20">
            <Package size={32} className="mb-3 opacity-30" />
            <div className="text-[13px] font-medium">Selecciona un plan para ver y gestionar sus ítems</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Cabecera */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[16px] font-bold text-gray-900">{planActual?.nombre}</div>
                <div className="text-[11px] text-gray-400">{items.length} ítem{items.length !== 1 ? 's' : ''} configurados</div>
              </div>
            </div>

            {/* Tabla de ítems */}
            {loadingItems ? (
              <div className="text-center py-10 text-gray-400 text-[13px]">Cargando ítems...</div>
            ) : (
              <>
                {items.length > 0 && (
                  <div className="relative max-w-xs">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar ítem en este plan..."
                      value={qItems}
                      onChange={e => setQItems(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-[12px] border rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]"
                      style={{ borderColor: 'rgba(30,80,40,0.2)' }}
                    />
                  </div>
                )}
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Ítem / Recordatorio</Th>
                      <Th>Categoría</Th>
                      <Th>Cant.</Th>
                      <Th>En precio</Th>
                      <Th>Solo nombre</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsFiltrados.map(item => (
                      <Tr key={item.id}>
                        <Td className="font-semibold text-gray-900">{item.recordatorios?.nombre || '—'}</Td>
                        <Td>
                          <span className="text-[10px] capitalize bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {item.recordatorios?.categoria || '—'}
                          </span>
                        </Td>
                        <Td>
                          {editingId === item.id ? (
                            <div className="flex items-center gap-1.5">
                              <Input type="number" min="1" value={editCantidad}
                                onChange={e => setEditCantidad(e.target.value)}
                                className="w-16 h-7 text-[12px]" />
                              <Button size="sm" onClick={() => guardarEdicion(item.id)}>OK</Button>
                              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className="text-[13px] font-bold text-gray-700 hover:text-[#1A5CD8] hover:underline px-1"
                              onClick={() => { setEditingId(item.id); setEditCantidad(item.cantidad || 1) }}
                              title="Clic para editar"
                            >
                              {item.cantidad || 1}
                            </button>
                          )}
                        </Td>
                        <Td>
                          <button onClick={() => toggleIncluido(item.id, item.incluido_en_precio)}>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer ${
                              item.incluido_en_precio ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {item.incluido_en_precio ? '✓ Incluido' : 'Extra'}
                            </span>
                          </button>
                        </Td>
                        <Td>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            item.recordatorios?.solo_nombre ? 'bg-purple-100 text-purple-700 font-semibold' : 'text-gray-300'
                          }`}>
                            {item.recordatorios?.solo_nombre ? 'Solo nombre' : '—'}
                          </span>
                        </Td>
                        <Td>
                          <button
                            onClick={() => eliminar(item.id, item.recordatorios?.nombre)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-gray-400 text-[13px]">
                          Este plan aún no tiene ítems. Agrega el primero abajo.
                        </td>
                      </tr>
                    )}
                    {items.length > 0 && itemsFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-400 text-[13px]">
                          Sin resultados para "<span className="font-medium">{qItems}</span>"
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </TableWrap>
              </>
            )}

            {/* Formulario agregar ítem */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Plus size={11} /> Agregar ítem a este plan
              </div>

              <div className="space-y-3">
                {/* Búsqueda + opciones cantidad/incluido en la misma fila */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className={LABEL}>Buscar recordatorio</label>
                    <Input
                      placeholder="Nombre o categoría..."
                      value={busqueda}
                      onChange={e => { setBusqueda(e.target.value); setAddRecId('') }}
                      autoComplete="off"
                    />
                  </div>
                  <div className="w-20">
                    <label className={LABEL}>Cantidad</label>
                    <Input type="number" min="1" value={addCantidad}
                      onChange={e => setAddCantidad(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <input type="checkbox" id="addIncluido" checked={addIncluido}
                      onChange={e => setAddIncluido(e.target.checked)}
                      className="w-4 h-4 accent-[#1A5CD8]" />
                    <label htmlFor="addIncluido" className="text-[12px] font-semibold text-gray-700 cursor-pointer">
                      Incluido en precio
                    </label>
                  </div>
                </div>

                {/* Lista de resultados */}
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white max-h-52 overflow-y-auto">
                  {dispFiltrados.length === 0 ? (
                    <p className="text-[12px] text-gray-400 text-center py-5">
                      Sin resultados para "<span className="font-medium">{busqueda}</span>"
                    </p>
                  ) : (
                    dispFiltrados.map(r => {
                      const yaAgregado  = yaEnPlanSet.has(r.id)
                      const seleccionado = !yaAgregado && addRecId === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          disabled={yaAgregado}
                          onClick={() => !yaAgregado && setAddRecId(seleccionado ? '' : r.id)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition-colors"
                          style={{
                            borderColor: 'rgba(30,80,40,0.08)',
                            background: seleccionado ? '#EDF7ED' : yaAgregado ? '#F9FAFB' : 'transparent',
                            cursor: yaAgregado ? 'default' : 'pointer',
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <span className={`text-[12px] font-semibold truncate block ${seleccionado ? 'text-[#1A5CD8]' : yaAgregado ? 'text-gray-400' : 'text-gray-800'}`}>
                              {r.nombre}
                            </span>
                            {r.categoria && (
                              <span className="text-[10px] text-gray-400 capitalize">{r.categoria}</span>
                            )}
                          </div>
                          {yaAgregado ? (
                            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                              Ya en el plan
                            </span>
                          ) : seleccionado ? (
                            <span className="text-[10px] font-bold text-[#1A5CD8] bg-green-100 px-2 py-0.5 rounded-full flex-shrink-0">
                              Seleccionado ✓
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300 flex-shrink-0">Clic para seleccionar</span>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {recordatorios.length - yaEnPlanSet.size} disponible{recordatorios.length - yaEnPlanSet.size !== 1 ? 's' : ''}
                    {' · '}{yaEnPlanSet.size} ya en el plan
                    {busqueda && ` · filtrando "${busqueda}"`}
                  </span>
                  <Button onClick={agregar} disabled={saving || !addRecId || loadingItems}>
                    <Plus size={13} /> {saving ? 'Guardando...' : 'Agregar ítem'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── COMISIONES ───────────────────────────────────────────────────────────────
function TabComisiones() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]           = useState([])
  const [planes, setPlanes]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({})
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editPct, setEditPct]     = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: pl }] = await Promise.all([
      db.from('config_comisiones').select('*').order('rango_min'),
      db.from('planes').select('id,nombre,codigo').order('nombre'),
    ])
    setData(d || []); setPlanes(pl || []); setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true }); setFormError('')
    setForm(item ? {
      plan_id: item.plan_id || '', es_vip: !!item.es_vip,
      rango_min: item.rango_min ?? 0, rango_max: item.rango_max ?? '',
      porcentaje: item.porcentaje ?? '', notas: item.notas || '',
    } : {
      plan_id: '', es_vip: false, rango_min: 0, rango_max: '', porcentaje: '', notas: '',
    })
  }

  async function guardar() {
    if (!form.plan_id) return setFormError('Selecciona un plan.')
    if (!form.porcentaje) return setFormError('El porcentaje es requerido.')
    const rMin = parseInt(form.rango_min) || 0
    const rMax = form.rango_max !== '' ? parseInt(form.rango_max) : null
    // El rango es Nº DE SERVICIOS del aliado en el mes (0, 1, 2, 3…). Un valor
    // grande casi siempre es un porcentaje tecleado en el campo equivocado: así
    // se crearon reglas "de 20 a 27 servicios/mes" que nunca hacían match y
    // dejaban la comisión en $0 (corregido en migración 039).
    if (rMin >= 10 || (rMax !== null && rMax >= 10)) {
      return setFormError('El rango es el número de servicios del aliado en el mes (normalmente 0 a 3). Parece que pusiste el porcentaje en el campo del rango.')
    }
    if (rMax !== null && rMin > rMax) return setFormError('El rango mínimo no puede ser mayor que el máximo.')
    const solapada = data.find(r =>
      r.id !== selected?.id &&
      r.plan_id === form.plan_id &&
      !!r.es_vip === !!form.es_vip &&
      rMin <= (r.rango_max ?? Infinity) &&
      r.rango_min <= (rMax ?? Infinity)
    )
    if (solapada) {
      return setFormError(`Ya existe una regla ${solapada.es_vip ? 'VIP' : 'no-VIP'} para ese plan con rango ${solapada.rango_min}–${solapada.rango_max ?? '∞'} que se cruza con este. Edítala o elimínala primero.`)
    }
    setFormError(''); setSaving(true)
    const body = {
      plan_id:    form.plan_id,
      es_vip:     !!form.es_vip,
      rango_min:  rMin,
      rango_max:  rMax,
      porcentaje: parseFloat(form.porcentaje),
      notas:      form.notas || null,
    }
    const { error } = selected?.id
      ? await db.from('config_comisiones').update(body).eq('id', selected.id)
      : await db.from('config_comisiones').insert(body)
    setSaving(false)
    if (error) { setFormError('Error: ' + error.message); return }
    await cargar(); setSelected(null)
  }

  async function guardarPct(id) {
    const pct = parseFloat(editPct)
    if (isNaN(pct) || pct < 0 || pct > 100) return
    await db.from('config_comisiones').update({ porcentaje: pct }).eq('id', id)
    setEditingId(null)
    await cargar()
  }

  async function eliminar(c) {
    if (!await confirm('¿Eliminar esta regla de comisión?', { title: 'Eliminar regla', variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('config_comisiones').delete().eq('id', c.id)
    if (error) await showAlert(parsearErrorDB(error), { title: 'Error' })
    else await cargar()
  }

  // Agrupar por plan_id
  const grupos = planes
    .map(p => ({ plan: p, reglas: data.filter(r => r.plan_id === p.id) }))
    .filter(g => g.reglas.length > 0)
  const sinComision = planes.filter(p => !data.find(r => r.plan_id === p.id))

  function PisoCell({ regla }) {
    if (!regla) return <td className="px-3 py-2 text-center text-gray-300 text-[12px]">—</td>
    const editing = editingId === regla.id
    return (
      <td className="px-3 py-2 text-center">
        {editing ? (
          <div className="flex items-center justify-center gap-1">
            <input autoFocus type="number" min="0" max="100" step="0.5"
              value={editPct} onChange={e => setEditPct(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') guardarPct(regla.id); if (e.key === 'Escape') setEditingId(null) }}
              className="w-16 h-7 text-center text-[12px] border border-green-400 rounded-lg outline-none focus:ring-2 focus:ring-green-200 font-bold" />
            <button onClick={() => guardarPct(regla.id)} className="text-green-600 hover:text-green-800 text-[11px] font-bold">OK</button>
            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>
          </div>
        ) : (
          <button
            onClick={() => { setEditingId(regla.id); setEditPct(parseFloat(regla.porcentaje).toString()) }}
            className="text-[14px] font-bold text-gray-800 hover:text-[#1A5CD8] hover:underline tabular-nums"
          >
            {parseFloat(regla.porcentaje)}%
          </button>
        )}
      </td>
    )
  }

  if (loading) return <div className="text-center py-10 text-gray-400">Cargando...</div>

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-gray-500">
          Haz clic en cualquier porcentaje para editarlo directamente. El umbral es <strong>3 servicios previos</strong> del aliado en el mes.
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nueva regla</Button>
      </div>

      {/* Tabla agrupada por plan */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">Plan</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider w-28">
                No-VIP<br/><span className="text-[10px] font-normal normal-case">0–2 servicios</span>
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider w-28">
                No-VIP<br/><span className="text-[10px] font-normal normal-case">3+ servicios</span>
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold text-amber-600 uppercase tracking-wider w-28">
                ⭐ VIP<br/><span className="text-[10px] font-normal normal-case">0–2 servicios</span>
              </th>
              <th className="px-3 py-2.5 text-center text-[11px] font-bold text-amber-600 uppercase tracking-wider w-28">
                ⭐ VIP<br/><span className="text-[10px] font-normal normal-case">3+ servicios</span>
              </th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {grupos.map(({ plan, reglas }) => {
              const noVip1  = reglas.find(r => !r.es_vip && r.rango_max !== null)
              const noVip2  = reglas.find(r => !r.es_vip && r.rango_max === null && r.rango_min > 0)
              const noVipF  = reglas.find(r => !r.es_vip && r.rango_max === null && r.rango_min === 0)
              const vip1    = reglas.find(r =>  r.es_vip && r.rango_max !== null)
              const vip2    = reglas.find(r =>  r.es_vip && r.rango_max === null && r.rango_min > 0)
              const vipF    = reglas.find(r =>  r.es_vip && r.rango_max === null && r.rango_min === 0)
              // fijo: solo 1 regla sin tramos (eco-grupal)
              const esFijo  = !noVip1 && !noVip2 && !vip1 && !vip2
              return (
                <tr key={plan.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-800">{plan.nombre}</div>
                    <div className="text-[10px] text-gray-400">{plan.codigo}</div>
                  </td>
                  {esFijo ? (
                    <>
                      <td colSpan={2} className="px-3 py-2 text-center">
                        <div className="text-[11px] text-gray-500 mb-0.5">Fija</div>
                        <PisoCell regla={noVipF} />
                      </td>
                      <td colSpan={2} className="px-3 py-2 text-center">
                        <div className="text-[11px] text-amber-500 mb-0.5">Fija</div>
                        <PisoCell regla={vipF} />
                      </td>
                    </>
                  ) : (
                    <>
                      <PisoCell regla={noVip1} />
                      <PisoCell regla={noVip2} />
                      <PisoCell regla={vip1} />
                      <PisoCell regla={vip2} />
                    </>
                  )}
                  <td className="px-2 py-2">
                    <button onClick={() => abrir(reglas[0])} className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-600 rounded transition-colors">
                      <Pencil size={11} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Planes sin comisión */}
      {sinComision.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Sin comisión configurada</div>
          <div className="flex flex-wrap gap-2">
            {sinComision.map(p => (
              <span key={p.id} className="text-[12px] bg-white border border-gray-200 rounded-lg px-3 py-1 text-gray-500">
                {p.nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Modal nueva/editar regla avanzada */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? 'Editar regla' : 'Nueva regla de comisión'} maxWidth="max-w-md"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}
        >
          {formError && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formError}</div>}
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Plan *</label>
              <Select value={form.plan_id || ''} onChange={e => setForm(p => ({ ...p, plan_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {planes.map(pl => <option key={pl.id} value={pl.id}>{pl.nombre} ({pl.codigo})</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={LABEL}>Desde (serv./mes)</label><Input type="number" min="0" value={form.rango_min} onChange={e => setForm(p => ({ ...p, rango_min: e.target.value }))} /></div>
              <div><label className={LABEL}>Hasta (serv./mes, ∞=vacío)</label><Input type="number" min="0" value={form.rango_max} onChange={e => setForm(p => ({ ...p, rango_max: e.target.value }))} placeholder="∞" /></div>
              <div><label className={LABEL}>Porcentaje *</label><Input type="number" min="0" max="100" step="0.5" value={form.porcentaje} onChange={e => setForm(p => ({ ...p, porcentaje: e.target.value }))} placeholder="%" /></div>
            </div>
            <div><label className={LABEL}>Notas</label><Input value={form.notas || ''} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones opcionales" /></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.es_vip} onChange={e => setForm(p => ({ ...p, es_vip: e.target.checked }))} className="w-4 h-4 accent-[#C4A87A]" />
              <span className="text-[13px] font-semibold text-gray-700">⭐ Solo para aliados VIP</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── CATÁLOGOS ────────────────────────────────────────────────────────────────
function CatalogSection({ title, table, items, onReload, pkCol = 'id', hasActivo = true }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [adding, setAdding]       = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editNombre, setEditNombre] = useState('')
  const [saving, setSaving]       = useState(false)

  async function add() {
    if (!newNombre.trim()) return
    setSaving(true)
    const { error } = await db.from(table).insert({ nombre: newNombre.trim() })
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
    setNewNombre(''); setAdding(false); onReload()
  }

  async function save(item) {
    if (!editNombre.trim()) return
    setSaving(true)
    const { error } = await db.from(table).update({ nombre: editNombre.trim() }).eq(pkCol, item[pkCol])
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
    setEditingId(null); onReload()
  }

  async function toggleActivo(item) {
    await db.from(table).update({ activo: !item.activo }).eq(pkCol, item[pkCol])
    onReload()
  }

  async function del(item) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar "${item.nombre}"?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from(table).delete().eq(pkCol, item[pkCol])
    if (error) {
      if (error.code === '23503') await showAlert(`"${item.nombre}" está en uso y no se puede eliminar.`, { title: 'No se puede eliminar', variant: 'warning' })
      else await showAlert(parsearErrorDB(error), { title: 'Error' })
      return
    }
    onReload()
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <span className="font-semibold text-[14px] text-gray-900">{title} <span className="text-[11px] font-normal text-gray-400">({items.length})</span></span>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[11px] font-semibold text-[#1A5CD8] hover:underline">
          <Plus size={11} /> Agregar
        </button>
      </div>
      <div className="p-3">
        {adding && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
            <Input autoFocus value={newNombre} onChange={e => setNewNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="Nombre..." className="flex-1 h-8 text-[12px]" />
            <Button size="sm" onClick={add} disabled={saving}>Guardar</Button>
            <button onClick={() => { setAdding(false); setNewNombre('') }} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
          </div>
        )}
        <div className="space-y-0.5">
          {items.map(item => (
            <div key={item[pkCol]} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
              {editingId === item[pkCol] ? (
                <>
                  <Input autoFocus value={editNombre} onChange={e => setEditNombre(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && save(item)}
                    className="flex-1 h-7 text-[12px]" />
                  <Button size="sm" onClick={() => save(item)} disabled={saving}>OK</Button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[13px] text-gray-700">{item.nombre}</span>
                  {hasActivo && item.activo === false && (
                    <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">Inactivo</span>
                  )}
                  <div className="hidden group-hover:flex items-center gap-1">
                    {hasActivo && (
                      <button onClick={() => toggleActivo(item)} title={item.activo !== false ? 'Desactivar' : 'Activar'}
                        className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded transition-colors ${item.activo !== false ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                        ●
                      </button>
                    )}
                    <button onClick={() => { setEditingId(item[pkCol]); setEditNombre(item.nombre) }}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 rounded transition-colors">
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => del(item)}
                      className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-500 rounded transition-colors">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && !adding && (
            <div className="text-center py-4 text-gray-400 text-[12px]">Sin registros</div>
          )}
        </div>
      </div>
    </div>
  )
}

function TabCatalogos() {
  const [canales, setCanales]   = useState([])
  const [especies, setEspecies] = useState([])
  const [roles, setRoles]       = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: ca }, { data: es }, { data: ro }, { data: ma }] = await Promise.all([
      db.from('canal_origen').select('*').order('nombre'),
      db.from('especies').select('*').order('nombre'),
      db.from('roles_personal').select('*').order('nombre'),
      db.from('maquinas_produccion').select('*').order('nombre'),
    ])
    setCanales(ca || []); setEspecies(es || [])
    setRoles(ro || []); setMaquinas(ma || [])
    setLoading(false)
  }

  if (loading) return <div className="text-center py-8 text-gray-400">Cargando...</div>

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <CatalogSection title="Canales de origen" table="canal_origen" items={canales} onReload={cargar} hasActivo />
      <CatalogSection title="Especies" table="especies" items={especies} onReload={cargar} hasActivo={false} />
      <CatalogSection title="Máquinas de producción" table="maquinas_produccion" items={maquinas} onReload={cargar} hasActivo />
      <CatalogSection title="Roles de personal" table="roles_personal" items={roles} onReload={cargar} hasActivo={false} />
    </div>
  )
}

// ─── PRECIOS POR PESO ─────────────────────────────────────────────────────────
const RANGOS = ['PETIT','FELINO','1-10KG','11-20KG','21-35KG','36-60KG']
// Límites en gramos por rango — deben coincidir con la búsqueda por peso de
// Registro/Kanban (.lte peso_min_gr / .gte peso_max_gr). FELINO se busca por
// nombre, no por peso (peso_max_gr null).
// Regla de decimales (David 2026-06-12): el peso pertenece a su rango hasta
// ALCANZAR el mínimo del siguiente — 10.4 kg es 1-10KG, no 11-20KG.
const RANGO_GRAMOS = {
  'PETIT':   { peso_min_gr: 0,     peso_max_gr: 999 },
  'FELINO':  { peso_min_gr: 1000,  peso_max_gr: null },
  '1-10KG':  { peso_min_gr: 1000,  peso_max_gr: 10999 },
  '11-20KG': { peso_min_gr: 11000, peso_max_gr: 20999 },
  '21-35KG': { peso_min_gr: 21000, peso_max_gr: 35999 },
  '36-60KG': { peso_min_gr: 36000, peso_max_gr: 60999 },
}
const LABEL_CF = 'text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1'

function TabPreciosPlanes() {
  const [planes,   setPlanes]   = useState([])
  const [precios,  setPrecios]  = useState([]) // [{plan_id, rango_nombre, precio, id}]
  const [loading,  setLoading]  = useState(true)
  const [planSel,  setPlanSel]  = useState(null)
  const [editForm, setEditForm] = useState({}) // { rango: precio_string }
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: pls }, { data: prs }] = await Promise.all([
      db.from('planes').select('id,codigo,nombre').order('nombre'),
      db.from('planes_precios').select('id,plan_id,rango_nombre,precio').order('plan_id'),
    ])
    setPlanes(pls || [])
    setPrecios(prs || [])
    setLoading(false)
  }

  function seleccionarPlan(plan) {
    setPlanSel(plan)
    setMsg('')
    const map = {}
    const planPrices = precios.filter(p => p.plan_id === plan.id)
    planPrices.forEach(p => { map[p.rango_nombre] = String(p.precio) })
    setEditForm(map)
  }

  async function guardarPrecios() {
    if (!planSel) return
    setSaving(true); setMsg('')
    try {
      for (const rango of RANGOS) {
        const precio = parseFloat(editForm[rango])
        if (isNaN(precio)) continue
        const existing = precios.find(p => p.plan_id === planSel.id && p.rango_nombre === rango)
        if (existing) {
          await db.from('planes_precios').update({ precio }).eq('id', existing.id)
        } else {
          await db.from('planes_precios').insert({
            plan_id:    planSel.id,
            rango_nombre: rango,
            precio,
            ...RANGO_GRAMOS[rango],
          })
        }
      }
      await cargar()
      seleccionarPlan({ ...planSel })
      setMsg('✅ Precios guardados correctamente')
    } catch (e) { setMsg('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  async function eliminarPrecio(rango) {
    if (!planSel) return
    const existing = precios.find(p => p.plan_id === planSel.id && p.rango_nombre === rango)
    if (!existing) return
    await db.from('planes_precios').delete().eq('id', existing.id)
    setEditForm(prev => { const n = {...prev}; delete n[rango]; return n })
    await cargar()
  }

  if (loading) return <div className="text-center py-10 text-gray-400">Cargando...</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Lista de planes */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Seleccionar plan</div>
        <div className="space-y-1.5">
          {planes.map(plan => {
            const count = precios.filter(p => p.plan_id === plan.id).length
            return (
              <button key={plan.id}
                onClick={() => seleccionarPlan(plan)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all"
                style={{
                  borderColor: planSel?.id === plan.id ? '#1A5CD8' : '#E5E7EB',
                  background:  planSel?.id === plan.id ? '#F0FDF4' : '#fff',
                }}>
                <div>
                  <div className="text-[13px] font-semibold text-gray-900">{plan.nombre}</div>
                  <div className="text-[10px] font-mono text-gray-400">{plan.codigo}</div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: count > 0 ? '#D1FAE5' : '#FEF3C7', color: count > 0 ? '#065F46' : '#92400E' }}>
                  {count} rango{count !== 1 ? 's' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Editor de precios */}
      {planSel ? (
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-lg font-bold text-gray-900">{planSel.nombre}</div>
              <div className="text-[11px] font-mono text-gray-400">{planSel.codigo}</div>
            </div>
            <Button size="sm" onClick={guardarPrecios} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar precios'}
            </Button>
          </div>

          {msg && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-[12px] font-medium ${msg.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {msg}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-[12px] text-amber-700">
            💡 <strong>PETIT</strong>: &lt;1 kg · <strong>FELINO</strong>: solo gatos ≥1 kg · Los rangos KG son para otros animales.
            Deja vacío los rangos que no apliquen al plan.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {RANGOS.map(rango => (
              <div key={rango} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-bold text-gray-700">{rango}</label>
                  {editForm[rango] && (
                    <button onClick={() => eliminarPrecio(rango)} className="text-[10px] text-red-400 hover:text-red-600">
                      Eliminar
                    </button>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">$</span>
                  <Input
                    type="number"
                    min="0"
                    className="pl-7"
                    placeholder="Sin precio"
                    value={editForm[rango] || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, [rango]: e.target.value }))}
                  />
                </div>
                {editForm[rango] && !isNaN(parseFloat(editForm[rango])) && (
                  <div className="text-[11px] text-[#1A5CD8] font-semibold mt-1">
                    {fmt(parseFloat(editForm[rango]))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="lg:col-span-2 flex items-center justify-center text-gray-400 text-sm py-20">
          Selecciona un plan para editar sus precios por rango de peso
        </div>
      )}
    </div>
  )
}

// ─── TAB WHATSAPP ─────────────────────────────────────────────────────────────
function TabWhatsApp() {
  const { confirm, alert: showAlert } = useConfirm()
  const [lineas,    setLineas]    = useState([])
  const [defecto,   setDefecto]   = useState('')
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  // Form para nueva línea
  const [showForm,  setShowForm]  = useState(false)
  const [formNum,   setFormNum]   = useState('')
  const [formLabel, setFormLabel] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('config_sistema')
      .select('clave, valor')
      .in('clave', ['wa_linea_default', 'wa_lineas'])
    const map = Object.fromEntries((data || []).map(r => [r.clave, r.valor]))
    try { setLineas(JSON.parse(map.wa_lineas || '[]')) } catch { setLineas([]) }
    setDefecto(map.wa_linea_default || '')
    setLoading(false)
  }

  async function guardarDefecto(numero) {
    setSaving(true)
    await db.from('config_sistema')
      .upsert({ clave: 'wa_linea_default', valor: numero, updated_at: new Date().toISOString() })
    setDefecto(numero)
    setSaving(false)
  }

  async function agregarLinea() {
    const num = formNum.trim().replace(/\s/g, '')
    if (!num || !formLabel.trim()) return
    const normalizado = num.startsWith('+') ? num : `+57${num.replace(/^57/, '')}`
    if (lineas.find(l => l.numero === normalizado)) {
      await showAlert('Esa línea ya está registrada.', { title: 'Duplicado', variant: 'warning' }); return
    }
    const nuevas = [...lineas, { numero: normalizado, label: formLabel.trim() }]
    await db.from('config_sistema').upsert({
      clave: 'wa_lineas', valor: JSON.stringify(nuevas), updated_at: new Date().toISOString()
    })
    setLineas(nuevas); setShowForm(false); setFormNum(''); setFormLabel('')
  }

  async function eliminarLinea(numero) {
    if (!await confirm(`¿Eliminar la línea ${numero}?`, { title: 'Eliminar línea', variant: 'danger', confirmLabel: 'Eliminar' })) return
    const nuevas = lineas.filter(l => l.numero !== numero)
    await db.from('config_sistema').upsert({
      clave: 'wa_lineas', valor: JSON.stringify(nuevas), updated_at: new Date().toISOString()
    })
    if (defecto === numero && nuevas.length) await guardarDefecto(nuevas[0].numero)
    setLineas(nuevas)
  }

  if (loading) return <div className="text-center py-8 text-gray-400">Cargando...</div>

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
        <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <Smartphone size={15} className="text-green-600" />
          <div className="font-semibold text-gray-900">Líneas WhatsApp</div>
          <span className="text-[11px] text-gray-400 ml-auto">Línea por defecto para certificados y reportes</span>
        </div>

        <div className="p-5 space-y-3">
          {lineas.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-4">Sin líneas configuradas.</p>
          )}
          {lineas.map(l => {
            const esDefecto = defecto === l.numero
            return (
              <div key={l.numero}
                className="flex items-center gap-3 p-4 rounded-xl border transition-all"
                style={{
                  borderColor: esDefecto ? '#16A34A' : 'rgba(30,80,40,0.1)',
                  background:  esDefecto ? '#F0FDF4' : 'white',
                }}>
                <MessageCircle size={18} className={esDefecto ? 'text-green-600' : 'text-gray-400'} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold ${esDefecto ? 'text-green-800' : 'text-gray-800'}`}>
                    {l.label}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono">{l.numero}</p>
                </div>
                <div className="flex items-center gap-2">
                  {esDefecto ? (
                    <span className="text-[11px] font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full flex items-center gap-1">
                      <CheckCircle size={11} /> Por defecto
                    </span>
                  ) : (
                    <button
                      onClick={() => guardarDefecto(l.numero)}
                      disabled={saving}
                      className="text-[11px] font-medium text-gray-500 hover:text-green-700 px-2 py-1 rounded-lg hover:bg-green-50 transition-colors border border-gray-200 hover:border-green-300"
                    >
                      Usar por defecto
                    </button>
                  )}
                  <button
                    onClick={() => eliminarLinea(l.numero)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}

          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-[12px] font-medium text-gray-500 hover:text-[#1A5CD8] hover:border-[#1A5CD8] hover:bg-green-50 transition-all"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }}
            >
              <Plus size={14} /> Agregar línea
            </button>
          ) : (
            <div className="rounded-xl border p-4 space-y-3 bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Número (con o sin +57)</label>
                <input
                  type="tel"
                  value={formNum}
                  onChange={e => setFormNum(e.target.value)}
                  placeholder="Ej: 3159891247 o +573159891247"
                  className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Nombre de la línea</label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={e => setFormLabel(e.target.value)}
                  placeholder="Ej: Línea principal Camino al Cielo"
                  className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A5CD8]"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-2 text-[12px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors">
                  Cancelar
                </button>
                <button onClick={agregarLinea} disabled={!formNum || !formLabel}
                  className="flex-1 py-2 text-[12px] font-bold rounded-lg text-white transition-colors disabled:opacity-50"
                  style={{ background: '#1A5CD8' }}>
                  Guardar línea
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl p-4 border text-[12px] text-amber-800 bg-amber-50 border-amber-200 space-y-1">
        <p className="font-semibold">¿Cómo funciona la selección de línea?</p>
        <p>La línea marcada como <strong>"Por defecto"</strong> se preselecciona en el módulo Certificados al enviar reportes.</p>
        <p>Si el cliente ya tiene historial con otra línea en Zolutium, el mensaje saldrá desde esa línea por el enrutamiento automático del CRM.</p>
      </div>
    </div>
  )
}

// ─── TARIFAS TRANSPORTE ───────────────────────────────────────────────────────
function TabTransporte() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [formErr, setFormErr] = useState('')
  const { q, setQ, filtered } = useSearch(data, ['ciudad'])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('tarifas_transporte').select('*').order('ciudad')
    setData(d || []); setLoading(false)
  }

  function abrir(item) {
    setSelected(item || { _nuevo: true }); setFormErr('')
    setForm(item
      ? { ciudad: item.ciudad || '', tarifa_moto: item.tarifa_moto ?? 0, tarifa_camioneta: item.tarifa_camioneta ?? 0, activo: item.activo !== false }
      : { ciudad: '', tarifa_moto: 0, tarifa_camioneta: 0, activo: true })
  }

  async function guardar() {
    if (!form.ciudad?.trim()) return setFormErr('El nombre de la ciudad es requerido.')
    setFormErr(''); setSaving(true)
    const body = {
      ciudad: form.ciudad.trim(),
      tarifa_moto: parseInt(form.tarifa_moto) || 0,
      tarifa_camioneta: parseInt(form.tarifa_camioneta) || 0,
      activo: form.activo !== false,
    }
    const { error } = selected?.id
      ? await db.from('tarifas_transporte').update(body).eq('id', selected.id)
      : await db.from('tarifas_transporte').insert(body)
    setSaving(false)
    if (error) {
      setFormErr(error.code === '23505' ? 'Ya existe una tarifa para esa ciudad.' : parsearErrorDB(error))
      return
    }
    await cargar(); setSelected(null)
  }

  async function eliminar(t) {
    if (!await confirm(`Esta acción no se puede deshacer.`, { title: `¿Eliminar tarifa de ${t.ciudad}?`, variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('tarifas_transporte').delete().eq('id', t.id)
    if (error) await showAlert(parsearErrorDB(error), { title: 'Error' })
    await cargar()
  }

  const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v || 0)

  return (
    <div>
      <p className="text-[12px] text-gray-400 mb-4">Recargos de transporte que se suman automáticamente al registrar un servicio fuera de Bogotá.</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" placeholder="Buscar ciudad..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nueva ciudad</Button>
      </div>
      {loading ? <div className="text-center py-8 text-gray-400">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Ciudad / Municipio</Th><Th>Tarifa Moto</Th><Th>Tarifa Camioneta</Th><Th>Estado</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(t => (
              <Tr key={t.id}>
                <Td className="font-semibold text-gray-900">{t.ciudad}</Td>
                <Td className="text-gray-700">{COP(t.tarifa_moto)}</Td>
                <Td className="text-gray-700">{COP(t.tarifa_camioneta)}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.activo !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{t.activo !== false ? 'Activo' : 'Inactivo'}</span></Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => abrir(t)}>Editar</Button>
                    <button onClick={() => eliminar(t)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">Sin tarifas configuradas</td></tr>}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? `Editar — ${selected.ciudad}` : 'Nueva tarifa de transporte'} maxWidth="max-w-sm"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          {formErr && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formErr}</div>}
          <div className="space-y-3">
            <div>
              <label className={LABEL}>Ciudad / Municipio *</label>
              <Input value={form.ciudad || ''} onChange={e => setForm(p => ({ ...p, ciudad: e.target.value }))} placeholder="Ej: Soacha, Chía, Otro..." maxLength={80} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Tarifa Moto ($)</label>
                <Input type="number" min="0" step="1000" value={form.tarifa_moto ?? ''} onChange={e => setForm(p => ({ ...p, tarifa_moto: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <label className={LABEL}>Tarifa Camioneta ($)</label>
                <Input type="number" min="0" step="1000" value={form.tarifa_camioneta ?? ''} onChange={e => setForm(p => ({ ...p, tarifa_camioneta: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.activo !== false} onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} className="w-4 h-4 accent-[#1A5CD8]" />
              <span className="text-[12px] font-semibold text-gray-700">Activo (aparece en Registro)</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── FESTIVOS ────────────────────────────────────────────────────────────────
function TabFestivos() {
  const { confirm, alert: showAlert } = useConfirm()
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm]       = useState({ fecha: '', nombre: '' })
  const [saving, setSaving]   = useState(false)
  const [formErr, setFormErr] = useState('')
  const [anio, setAnio]       = useState(String(new Date().getFullYear()))

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('festivos').select('*').order('fecha', { ascending: true })
    setData(d || []); setLoading(false)
  }

  function abrir() { setSelected({ _nuevo: true }); setForm({ fecha: '', nombre: '' }); setFormErr('') }

  async function guardar() {
    if (!form.fecha) return setFormErr('La fecha es requerida.')
    if (!form.nombre?.trim()) return setFormErr('El nombre es requerido.')
    setFormErr(''); setSaving(true)
    const { error } = await db.from('festivos').insert({ fecha: form.fecha, nombre: form.nombre.trim() })
    setSaving(false)
    if (error) { setFormErr(error.code === '23505' ? 'Ya existe un festivo en esa fecha.' : parsearErrorDB(error)); return }
    await cargar(); setSelected(null)
  }

  async function eliminar(f) {
    if (!await confirm(`${f.nombre} — ${f.fecha}`, { title: '¿Eliminar este festivo?', variant: 'danger', confirmLabel: 'Eliminar' })) return
    const { error } = await db.from('festivos').delete().eq('fecha', f.fecha)
    if (error) await showAlert(parsearErrorDB(error), { title: 'Error' })
    await cargar()
  }

  const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const diaSemana = f => DOW[new Date(f + 'T12:00:00').getDay()]
  const fmtF = f => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })

  const anios = [...new Set(data.map(f => f.fecha.slice(0, 4)))].sort()
  const filtered = data.filter(f => f.fecha.slice(0, 4) === anio)

  return (
    <div>
      <p className="text-[12px] text-gray-400 mb-4">Días festivos de Colombia. Se usan para calcular el 3er día hábil de los reportes grupales (vencimientos).</p>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {anios.map(a => (
            <button key={a} onClick={() => setAnio(a)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all"
              style={{ background: anio === a ? '#3D5A27' : 'white', color: anio === a ? 'white' : '#374151', borderColor: anio === a ? '#3D5A27' : '#D1D5DB' }}>{a}</button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={abrir}><Plus size={14} /> Nuevo festivo</Button>
      </div>
      {loading ? <div className="text-center py-8 text-gray-400">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Fecha</Th><Th>Día</Th><Th>Nombre</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(f => (
              <Tr key={f.fecha}>
                <Td className="font-semibold text-gray-900">{fmtF(f.fecha)}</Td>
                <Td className="text-gray-600">{diaSemana(f.fecha)}</Td>
                <Td className="text-gray-700">{f.nombre}</Td>
                <Td><button onClick={() => eliminar(f)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button></Td>
              </Tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-gray-400 text-sm">Sin festivos en {anio}</td></tr>}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Nuevo festivo" maxWidth="max-w-sm"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          {formErr && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{formErr}</div>}
          <div className="space-y-3">
            <div>
              <label className={LABEL}>Fecha *</label>
              <Input type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL}>Nombre del festivo *</label>
              <Input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Día de la Independencia" maxLength={80} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── RECONOCIMIENTOS AL TÉCNICO ──────────────────────────────────────────────
// Montos FIJOS por recogida que se le reconocen al técnico (recargo dominical /
// festivo / nocturno). Fila única de configuración global (migración 010).
// El transporte NO se configura aquí: se reconoce el valor cobrado al cliente,
// congelado en cada servicio (servicios.valor_transporte).
function TabReconocimientos() {
  const { alert: showAlert } = useConfirm()
  const [row, setRow]       = useState(null)
  const [form, setForm]     = useState({ recargo_dominical: 0, recargo_festivo: 0, recargo_nocturno: 0, recargo_lejania: 0, pago_cancelado: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [ok, setOk]           = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('tarifas_reconocimiento_tecnico')
      .select('*').eq('activo', true).order('updated_at', { ascending: false }).limit(1)
    const r = data?.[0] || null
    setRow(r)
    setForm({
      recargo_dominical: r?.recargo_dominical ?? 0,
      recargo_festivo:   r?.recargo_festivo   ?? 0,
      recargo_nocturno:  r?.recargo_nocturno  ?? 0,
      recargo_lejania:   r?.recargo_lejania   ?? 0,
      pago_cancelado:    r?.pago_cancelado    ?? 0,
    })
    setLoading(false)
  }

  async function guardar() {
    setSaving(true); setOk(false)
    const body = {
      recargo_dominical: parseInt(form.recargo_dominical) || 0,
      recargo_festivo:   parseInt(form.recargo_festivo)   || 0,
      recargo_nocturno:  parseInt(form.recargo_nocturno)  || 0,
      recargo_lejania:   parseInt(form.recargo_lejania)   || 0,
      pago_cancelado:    parseInt(form.pago_cancelado)    || 0,
      activo: true,
    }
    const { error } = row?.id
      ? await db.from('tarifas_reconocimiento_tecnico').update(body).eq('id', row.id)
      : await db.from('tarifas_reconocimiento_tecnico').insert(body)
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    setOk(true)
    await cargar()
  }

  if (loading) return <div className="text-center py-8 text-gray-400">Cargando...</div>

  const CAMPOS = [
    ['recargo_dominical', 'Recargo dominical', 'Por cada recogida en domingo'],
    ['recargo_festivo',   'Recargo festivo',   'Por cada recogida en festivo (usa el calendario de Festivos)'],
    ['recargo_nocturno',  'Recargo nocturno',  'Por cada recogida desde las 6:00 p. m.'],
    ['recargo_lejania',   'Recargo de lejanía', 'Se marca manualmente por recogida en el cuadre (aplica a cualquier ciudad, incluso Bogotá)'],
    ['pago_cancelado',    'Pago por servicio cancelado', 'Por cada servicio cancelado cuando el técnico ya había salido (etapa de recogida o posterior)'],
  ]

  return (
    <div className="max-w-lg">
      <p className="text-[12px] text-gray-400 mb-4">
        Montos fijos que se le reconocen al técnico por recogida, en el cuadre de cuentas.
        El transporte se reconoce aparte (valor cobrado al cliente, congelado en cada servicio).
      </p>
      <div className="space-y-4 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        {CAMPOS.map(([key, label, hint]) => (
          <div key={key}>
            <label className={LABEL}>{label} ($)</label>
            <Input type="number" min="0" step="1000" value={form[key] ?? ''}
              onChange={e => { setForm(p => ({ ...p, [key]: e.target.value })); setOk(false) }}
              placeholder="0" />
            <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar recargos'}</Button>
          {ok && <span className="flex items-center gap-1 text-[12px] font-semibold text-green-700"><CheckCircle size={14} /> Guardado</span>}
        </div>
      </div>
    </div>
  )
}

// ─── PAGO AL TÉCNICO POR SERVICIO ────────────────────────────────────────────
// Valor reconocido al técnico por cada servicio, según plan × vehículo (moto /
// carro). El vehículo sale del perfil del técnico (personal.tipo_vehiculo).
function TabPagoTecnico() {
  const { alert: showAlert } = useConfirm()
  const [planes, setPlanes]   = useState([])
  const [tar, setTar]         = useState({})   // plan_id -> { monto_moto, monto_carro }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [ok, setOk]           = useState(false)

  const PRESEQ = ['BRONCE', 'PLATA', 'ORO_EXCLUSIVO', 'DIAMANTE', 'VITALICIO']

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: pls }, { data: tarifas }] = await Promise.all([
      db.from('planes').select('id, nombre, codigo').eq('activo', true).order('nombre'),
      db.from('tarifas_pago_tecnico_servicio').select('*'),
    ])
    setPlanes((pls || []).filter(p => !PRESEQ.includes(p.codigo)))
    const map = {}
    ;(tarifas || []).forEach(t => { map[t.plan_id] = { monto_moto: t.monto_moto ?? 0, monto_carro: t.monto_carro ?? 0 } })
    setTar(map)
    setLoading(false)
  }

  function setVal(planId, campo, val) {
    setTar(prev => ({ ...prev, [planId]: { monto_moto: 0, monto_carro: 0, ...(prev[planId] || {}), [campo]: val } }))
    setOk(false)
  }

  async function guardar() {
    setSaving(true); setOk(false)
    const rows = planes.map(p => ({
      plan_id:     p.id,
      monto_moto:  parseInt(tar[p.id]?.monto_moto)  || 0,
      monto_carro: parseInt(tar[p.id]?.monto_carro) || 0,
    }))
    const { error } = await db.from('tarifas_pago_tecnico_servicio').upsert(rows, { onConflict: 'plan_id' })
    setSaving(false)
    if (error) { await showAlert(parsearErrorDB(error), { title: 'Error al guardar' }); return }
    setOk(true); await cargar()
  }

  if (loading) return <div className="text-center py-8 text-gray-400">Cargando...</div>

  return (
    <div>
      <p className="text-[12px] text-gray-400 mb-4">
        Valor que se le reconoce al técnico por cada servicio, según el plan y el vehículo del técnico
        (moto o carro). El vehículo se toma del perfil del técnico (Personal). Entra en el cuadre como
        pago al técnico. <strong>Camioneta se trata como carro.</strong>
      </p>
      <TableWrap><Table>
        <thead><tr><Th>Plan</Th><Th>Pago Moto ($)</Th><Th>Pago Carro ($)</Th></tr></thead>
        <tbody>
          {planes.map(p => (
            <Tr key={p.id}>
              <Td className="font-semibold text-gray-900">{p.nombre}</Td>
              <Td><Input type="number" min="0" step="1000" className="max-w-[150px]" value={tar[p.id]?.monto_moto ?? ''} onChange={e => setVal(p.id, 'monto_moto', e.target.value)} placeholder="0" /></Td>
              <Td><Input type="number" min="0" step="1000" className="max-w-[150px]" value={tar[p.id]?.monto_carro ?? ''} onChange={e => setVal(p.id, 'monto_carro', e.target.value)} placeholder="0" /></Td>
            </Tr>
          ))}
          {planes.length === 0 && <tr><td colSpan={3} className="text-center py-10 text-gray-400 text-sm">Sin planes operativos</td></tr>}
        </tbody>
      </Table></TableWrap>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar tarifas'}</Button>
        {ok && <span className="flex items-center gap-1 text-[12px] font-semibold text-green-700"><CheckCircle size={14} /> Guardado</span>}
      </div>
    </div>
  )
}

// ─── AFILIACIONES PRE-EXEQUIALES ─────────────────────────────────────────────
// Precios por tipo+nivel y knobs del módulo (config_operativa, módulo AFILIACIONES).
// El precio se congela en cada contrato al firmar; cambiarlo aquí solo afecta
// afiliaciones y renovaciones futuras.
function TabAfiliaciones() {
  const NIVELES_AF = ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE']
  const [rows, setRows]     = useState(null)   // { clave → valor }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [ok, setOk]           = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('config_operativa')
      .select('clave, valor').eq('modulo', 'AFILIACIONES')
    const map = {}
    for (const r of data || []) map[r.clave] = r.valor
    setRows({
      precios: map.precios || { ANUAL: {}, VITALICIO: {} },
      dias_gracia: map.dias_gracia ?? 15,
      dias_aviso_renovacion: map.dias_aviso_renovacion ?? 30,
      multiplicador_semestre_1: map.multiplicador_semestre_1 ?? 5,
      multiplicador_semestre_2: map.multiplicador_semestre_2 ?? 3,
    })
    setLoading(false)
  }

  function setPrecio(tipo, nivel, v) {
    setRows(p => ({ ...p, precios: { ...p.precios, [tipo]: { ...p.precios[tipo], [nivel]: v } } }))
  }

  async function guardar() {
    setSaving(true); setOk(false); setError('')
    try {
      const precios = {}
      for (const tipo of ['ANUAL', 'VITALICIO']) {
        precios[tipo] = {}
        for (const n of NIVELES_AF) precios[tipo][n] = parseFloat(rows.precios?.[tipo]?.[n]) || 0
      }
      const updates = [
        ['precios', precios],
        ['dias_gracia', parseInt(rows.dias_gracia) || 15],
        ['dias_aviso_renovacion', parseInt(rows.dias_aviso_renovacion) || 30],
        ['multiplicador_semestre_1', parseFloat(rows.multiplicador_semestre_1) || 5],
        ['multiplicador_semestre_2', parseFloat(rows.multiplicador_semestre_2) || 3],
      ]
      for (const [clave, valor] of updates) {
        const { error: e } = await db.from('config_operativa')
          .upsert({ modulo: 'AFILIACIONES', clave, valor }, { onConflict: 'modulo,clave' })
        if (e) throw e
      }
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !rows) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /></div>

  const INPUT_LBL = 'text-[11px] font-bold text-gray-500 block mb-1'
  return (
    <div className="max-w-3xl">
      <h3 className="text-[14px] font-bold text-gray-800 mb-1">Precios de afiliación</h3>
      <p className="text-[12px] text-gray-500 mb-4">Valor fijo por nivel (no varía por peso). El contrato congela el precio al firmar; las renovaciones toman el precio vigente aquí.</p>
      {['ANUAL', 'VITALICIO'].map(tipo => (
        <div key={tipo} className="mb-5">
          <div className="text-[12px] font-bold text-gray-700 mb-2">{tipo === 'ANUAL' ? 'Anual (pago cada año)' : 'Vitalicio (un solo pago)'}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {NIVELES_AF.map(n => (
              <div key={n}>
                <label className={INPUT_LBL}>{n}</label>
                <Input type="number" min="0" value={rows.precios?.[tipo]?.[n] ?? ''}
                  onChange={e => setPrecio(tipo, n, e.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      <h3 className="text-[14px] font-bold text-gray-800 mb-1 mt-7">Reglas</h3>
      <p className="text-[12px] text-gray-500 mb-4">La cláusula aplica SOLO durante el primer contrato anual: fallece en el 1er semestre → multiplicador 1; en el 2do → multiplicador 2. Desde la primera renovación (y en vitalicio) el servicio queda cubierto.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={INPUT_LBL}>Días de gracia</label>
          <Input type="number" min="0" value={rows.dias_gracia}
            onChange={e => setRows(p => ({ ...p, dias_gracia: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Tras vencer, antes de pasar a CANCELADA</p></div>
        <div><label className={INPUT_LBL}>Días de aviso</label>
          <Input type="number" min="0" value={rows.dias_aviso_renovacion}
            onChange={e => setRows(p => ({ ...p, dias_aviso_renovacion: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Anticipación en "Por vencer"</p></div>
        <div><label className={INPUT_LBL}>Multiplicador 1er sem.</label>
          <Input type="number" min="0" value={rows.multiplicador_semestre_1}
            onChange={e => setRows(p => ({ ...p, multiplicador_semestre_1: e.target.value }))} /></div>
        <div><label className={INPUT_LBL}>Multiplicador 2do sem.</label>
          <Input type="number" min="0" value={rows.multiplicador_semestre_2}
            onChange={e => setRows(p => ({ ...p, multiplicador_semestre_2: e.target.value }))} /></div>
      </div>

      {error && <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{error}</div>}
      <div className="flex items-center gap-3 mt-5">
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
        {ok && <span className="flex items-center gap-1 text-[12px] font-semibold text-green-700"><CheckCircle size={14} /> Guardado</span>}
      </div>
    </div>
  )
}

// ─── TENJO (planta) ──────────────────────────────────────────────────────────
// Calendario de jornadas y umbrales del módulo (config_operativa, módulo TENJO).
// Lo leen el frontend (src/lib/tenjo.js) y el job de propuesta del backend
// (orbit-backend/src/reglas.js) — cambiar aquí cambia ambos, sin desplegar.
// El calendario es una SUGERENCIA: en Tenjo → Planificación se puede crear un
// lote para cualquier día y varios lotes el mismo día.
function TabTenjo() {
  const DIAS_SEMANA = [
    { n: 1, label: 'Lun' }, { n: 2, label: 'Mar' }, { n: 3, label: 'Mié' },
    { n: 4, label: 'Jue' }, { n: 5, label: 'Vie' }, { n: 6, label: 'Sáb' }, { n: 0, label: 'Dom' },
  ]
  const [rows, setRows]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [ok, setOk]           = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('config_operativa')
      .select('clave, valor').eq('modulo', 'TENJO')
    const map = {}
    for (const r of data || []) map[r.clave] = r.valor
    setRows({
      dias_operacion:        Array.isArray(map.dias_operacion)     ? map.dias_operacion     : [2, 4, 6],
      dias_planificacion:    Array.isArray(map.dias_planificacion) ? map.dias_planificacion : [1, 3, 5],
      min_procesos_jornada:  map.min_procesos_jornada  ?? 4,
      dias_custodia_alerta:  map.dias_custodia_alerta  ?? 5,
      dias_custodia_critica: map.dias_custodia_critica ?? 8,
      max_reprogramaciones:  map.max_reprogramaciones  ?? 2,
    })
    setLoading(false)
  }

  function toggleDia(clave, n) {
    setRows(p => {
      const set = new Set(p[clave])
      set.has(n) ? set.delete(n) : set.add(n)
      return { ...p, [clave]: [...set].sort((a, b) => a - b) }
    })
  }

  async function guardar() {
    setSaving(true); setOk(false); setError('')
    try {
      if (!rows.dias_operacion.length) throw new Error('Marca al menos un día de operación.')
      if (!rows.dias_planificacion.length) throw new Error('Marca al menos un día de planificación (si no, la propuesta automática nunca corre).')
      const updates = [
        ['dias_operacion',        rows.dias_operacion],
        ['dias_planificacion',    rows.dias_planificacion],
        ['min_procesos_jornada',  parseInt(rows.min_procesos_jornada)  || 0],
        ['dias_custodia_alerta',  parseInt(rows.dias_custodia_alerta)  || 0],
        ['dias_custodia_critica', parseInt(rows.dias_custodia_critica) || 0],
        ['max_reprogramaciones',  parseInt(rows.max_reprogramaciones)  || 0],
      ]
      for (const [clave, valor] of updates) {
        const { error: e } = await db.from('config_operativa')
          .upsert({ modulo: 'TENJO', clave, valor }, { onConflict: 'modulo,clave' })
        if (e) throw e
      }
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) {
      setError(parsearErrorDB(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !rows) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /></div>

  const INPUT_LBL = 'text-[11px] font-bold text-gray-500 block mb-1'
  const Dias = ({ clave }) => (
    <div className="flex flex-wrap gap-1.5">
      {DIAS_SEMANA.map(d => {
        const on = rows[clave].includes(d.n)
        return (
          <button key={d.n} type="button" onClick={() => toggleDia(clave, d.n)}
            className="px-3 py-1.5 rounded-xl text-[12px] font-bold border transition-colors"
            style={on
              ? { background: '#3D5A27', borderColor: '#3D5A27', color: '#fff' }
              : { background: '#fff', borderColor: '#E5E7EB', color: '#6B7280' }}>
            {d.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="max-w-3xl">
      <h3 className="text-[14px] font-bold text-gray-800 mb-1">Calendario de la planta</h3>
      <p className="text-[12px] text-gray-500 mb-4">
        Días en que Tenjo procesa y días en que el sistema arma la propuesta automática.
        Es la <strong>base sugerida</strong>: en Tenjo → Planificación puedes crear un lote para cualquier
        fecha y tener varios lotes el mismo día, sin tocar esto.
      </p>

      <div className="mb-5">
        <label className={INPUT_LBL}>Días de jornada (proceso en planta)</label>
        <Dias clave="dias_operacion" />
        <p className="text-[10px] text-gray-400 mt-1.5">Define la "próxima jornada" que se propone por defecto.</p>
      </div>

      <div className="mb-6">
        <label className={INPUT_LBL}>Días de planificación (propuesta automática)</label>
        <Dias clave="dias_planificacion" />
        <p className="text-[10px] text-gray-400 mt-1.5">El job diario solo arma la propuesta estos días, para la siguiente jornada.</p>
      </div>

      <h3 className="text-[14px] font-bold text-gray-800 mb-1 mt-7">Umbrales</h3>
      <p className="text-[12px] text-gray-500 mb-4">Alertas de custodia prolongada y reglas de la propuesta.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={INPUT_LBL}>Mín. procesos / jornada</label>
          <Input type="number" min="0" value={rows.min_procesos_jornada}
            onChange={e => setRows(p => ({ ...p, min_procesos_jornada: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Solo avisa si el lote va por debajo</p></div>
        <div><label className={INPUT_LBL}>Días custodia — alerta</label>
          <Input type="number" min="0" value={rows.dias_custodia_alerta}
            onChange={e => setRows(p => ({ ...p, dias_custodia_alerta: e.target.value }))} /></div>
        <div><label className={INPUT_LBL}>Días custodia — crítica</label>
          <Input type="number" min="0" value={rows.dias_custodia_critica}
            onChange={e => setRows(p => ({ ...p, dias_custodia_critica: e.target.value }))} /></div>
        <div><label className={INPUT_LBL}>Máx. reprogramaciones</label>
          <Input type="number" min="0" value={rows.max_reprogramaciones}
            onChange={e => setRows(p => ({ ...p, max_reprogramaciones: e.target.value }))} />
          <p className="text-[10px] text-gray-400 mt-1">Luego exige nueva autorización</p></div>
      </div>

      {error && <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{error}</div>}
      <div className="flex items-center gap-3 mt-5">
        <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
        {ok && <span className="flex items-center gap-1 text-[12px] font-semibold text-green-700"><CheckCircle size={14} /> Guardado</span>}
      </div>
    </div>
  )
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────────────────────────
export default function Configuracion() {
  return (
    <div>
      <Topbar />
      <div className="p-4 sm:p-7">
        <Tabs defaultValue="personal">
          <TabsList className="mb-6 flex-wrap gap-1">
            <TabsTrigger value="personal">
              <Users size={13} className="mr-1.5" /> Personal
            </TabsTrigger>
            <TabsTrigger value="veterinarias">
              <Building2 size={13} className="mr-1.5" /> Veterinarias
            </TabsTrigger>
            <TabsTrigger value="accesos">
              <KeyRound size={13} className="mr-1.5" /> Accesos
            </TabsTrigger>
            <TabsTrigger value="planes">
              <ClipboardList size={13} className="mr-1.5" /> Planes
            </TabsTrigger>
            <TabsTrigger value="recordatorios">
              <Layers size={13} className="mr-1.5" /> Recordatorios
            </TabsTrigger>
            <TabsTrigger value="plan-items">
              <Star size={13} className="mr-1.5" /> Plan → Ítems
            </TabsTrigger>
            <TabsTrigger value="comisiones">
              <DollarSign size={13} className="mr-1.5" /> Comisiones
            </TabsTrigger>
            <TabsTrigger value="catalogos">
              <Tag size={13} className="mr-1.5" /> Catálogos
            </TabsTrigger>
            <TabsTrigger value="precios">
              <DollarSign size={13} className="mr-1.5" /> Precios por peso
            </TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageCircle size={13} className="mr-1.5" /> WhatsApp
            </TabsTrigger>
            <TabsTrigger value="transporte">
              <Truck size={13} className="mr-1.5" /> Transporte
            </TabsTrigger>
            <TabsTrigger value="festivos">
              <CalendarDays size={13} className="mr-1.5" /> Festivos
            </TabsTrigger>
            <TabsTrigger value="reconocimientos">
              <DollarSign size={13} className="mr-1.5" /> Recargos técnico
            </TabsTrigger>
            <TabsTrigger value="pago-tecnico">
              <Tag size={13} className="mr-1.5" /> Pago técnico
            </TabsTrigger>
            <TabsTrigger value="afiliaciones">
              <Heart size={13} className="mr-1.5" /> Afiliaciones
            </TabsTrigger>
            <TabsTrigger value="tenjo">
              <Flame size={13} className="mr-1.5" /> Tenjo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="personal"><TabPersonal /></TabsContent>
          <TabsContent value="veterinarias"><TabVeterinarias /></TabsContent>
          <TabsContent value="accesos"><TabAccesos /></TabsContent>
          <TabsContent value="planes"><TabPlanes /></TabsContent>
          <TabsContent value="recordatorios"><TabRecordatorios /></TabsContent>
          <TabsContent value="plan-items"><TabPlanItems /></TabsContent>
          <TabsContent value="comisiones"><TabComisiones /></TabsContent>
          <TabsContent value="catalogos"><TabCatalogos /></TabsContent>
          <TabsContent value="precios"><TabPreciosPlanes /></TabsContent>
          <TabsContent value="whatsapp"><TabWhatsApp /></TabsContent>
          <TabsContent value="transporte"><TabTransporte /></TabsContent>
          <TabsContent value="festivos"><TabFestivos /></TabsContent>
          <TabsContent value="reconocimientos"><TabReconocimientos /></TabsContent>
          <TabsContent value="pago-tecnico"><TabPagoTecnico /></TabsContent>
          <TabsContent value="afiliaciones"><TabAfiliaciones /></TabsContent>
          <TabsContent value="tenjo"><TabTenjo /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
