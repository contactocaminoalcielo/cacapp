import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Search, Trash2 } from 'lucide-react'

// Convierte solo los campos indicados a null cuando están vacíos (para enums/FK opcionales)
const nullify = (obj, keys) => {
  const out = { ...obj }
  keys.forEach(k => { if (out[k] === '') out[k] = null })
  return out
}

function useSearch(data, fields) {
  const [q, setQ] = useState('')
  const filtered = data.filter(item =>
    !q || fields.some(f => String(item[f] || '').toLowerCase().includes(q.toLowerCase()))
  )
  return { q, setQ, filtered }
}

// --- CLIENTES TAB ---
function TabClientes({ isAdmin }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','apellido','cedula_nit','whatsapp','email'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('clientes').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', apellido: item.apellido || '',
      cedula_nit: item.cedula_nit || '', whatsapp: item.whatsapp || '',
      telefono: item.telefono || '', email: item.email || '',
      direccion: item.direccion || '', ciudad: item.ciudad || 'Bogotá',
      tipo_cliente: item.tipo_cliente || 'NORMAL', activo: item.activo !== false,
    } : { nombre:'',apellido:'',cedula_nit:'',whatsapp:'',telefono:'',email:'',direccion:'',ciudad:'Bogotá',tipo_cliente:'NORMAL',activo:true })
  }
  async function guardar() {
    if (!form.nombre?.trim()) return alert('El nombre es requerido.')
    setSaving(true)
    const body = nullify(form, ['tipo_cliente'])
    const { error } = selected?.id_cliente
      ? await db.from('clientes').update(body).eq('id_cliente', selected.id_cliente)
      : await db.from('clientes').insert(body)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    await cargar()
    setSelected(null)
  }
  async function eliminar(c) {
    if (!window.confirm(`¿Eliminar a ${c.nombre} ${c.apellido || ''}?\nEsta acción no se puede deshacer.`)) return
    const { error } = await db.from('clientes').delete().eq('id_cliente', c.id_cliente)
    if (error) {
      if (error.code === '23503') {
        if (window.confirm(`${c.nombre} tiene servicios o mascotas registradas y no se puede eliminar.\n\n¿Deseas marcarlo como INACTIVO en su lugar?`)) {
          await db.from('clientes').update({ activo: false }).eq('id_cliente', c.id_cliente)
          await cargar()
        }
      } else {
        alert('Error al eliminar: ' + error.message)
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>Tipo</Th><Th>Activo</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(c => (
              <Tr key={c.id_cliente}>
                <Td><div className="font-semibold text-ink">{c.nombre} {c.apellido}</div></Td>
                <Td className="text-ink3">{c.cedula_nit}</Td>
                <Td className="text-ink3">{c.whatsapp}</Td>
                <Td className="text-ink3">{c.ciudad}</Td>
                <Td className="text-ink3">{c.tipo_cliente}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{c.activo ? 'Sí' : 'No'}</span></Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(c)}>Editar</Button>
                      <button onClick={() => eliminar(c)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id_cliente ? 'Editar cliente' : 'Nuevo cliente'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[['nombre','Nombre'],['apellido','Apellido'],['cedula_nit','Cédula/NIT'],['whatsapp','WhatsApp'],['telefono','Teléfono'],['email','Email'],['ciudad','Ciudad'],['direccion','Dirección']].map(([k,l]) => (
                <div key={k} className={k === 'direccion' ? 'col-span-2' : ''}>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label>
                  <Input value={form[k] || ''} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Tipo cliente</label>
                <Select value={form.tipo_cliente || 'NORMAL'} onChange={e => setForm(p => ({ ...p, tipo_cliente: e.target.value }))}>
                  <option value="NORMAL">Normal</option>
                  <option value="VIP">VIP</option>
                  <option value="RECURRENTE">Recurrente</option>
                </Select>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- MASCOTAS TAB ---
function TabMascotas({ isAdmin }) {
  const [data, setData] = useState([])
  const [especies, setEspecies] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','raza'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: esp }] = await Promise.all([
      db.from('mascotas').select('*, especies(nombre), clientes(nombre,apellido)').order('nombre'),
      db.from('especies').select('*').order('nombre'),
    ])
    setData(d || [])
    setEspecies(esp || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', especie_id: item.especie_id || '',
      raza: item.raza || '', sexo: item.sexo || 'Macho',
      peso_kg: item.peso_kg || '', tamano: item.tamano || 'Mediano', notas: item.notas || '',
    } : { nombre:'',especie_id:'',raza:'',sexo:'Macho',peso_kg:'',tamano:'Mediano',notas:'' })
  }
  async function guardar() {
    if (!form.nombre?.trim()) return alert('El nombre es requerido.')
    setSaving(true)
    const body = nullify({ ...form, peso_kg: parseFloat(form.peso_kg) || 0 }, ['especie_id'])
    const { error } = selected?.id_mascota
      ? await db.from('mascotas').update(body).eq('id_mascota', selected.id_mascota)
      : await db.from('mascotas').insert(body)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(m) {
    if (!window.confirm(`¿Eliminar a ${m.nombre}?\nEsta acción no se puede deshacer.`)) return
    const { error } = await db.from('mascotas').delete().eq('id_mascota', m.id_mascota)
    if (error) {
      if (error.code === '23503') {
        alert(`${m.nombre} tiene servicios registrados y no se puede eliminar.\nSi necesitas desactivarla, edita el registro del cliente.`)
      } else {
        alert('Error al eliminar: ' + error.message)
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Especie</Th><Th>Raza</Th><Th>Peso</Th><Th>Cliente</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(m => (
              <Tr key={m.id_mascota}>
                <Td className="font-semibold text-ink">{m.nombre}</Td>
                <Td className="text-ink3">{m.especies?.nombre}</Td>
                <Td className="text-ink3">{m.raza || '-'}</Td>
                <Td className="text-ink3">{m.peso_kg}kg</Td>
                <Td className="text-ink3">{m.clientes?.nombre} {m.clientes?.apellido}</Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(m)}>Editar</Button>
                      <button onClick={() => eliminar(m)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Editar mascota" maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre</label><Input value={form.nombre||''} onChange={e => setForm(p => ({...p,nombre:e.target.value}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Especie</label>
              <Select value={form.especie_id||''} onChange={e => setForm(p => ({...p,especie_id:e.target.value}))}>
                <option value="">Seleccionar...</option>
                {especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Raza</label><Input value={form.raza||''} onChange={e => setForm(p => ({...p,raza:e.target.value}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Peso (kg)</label><Input type="text" inputMode="decimal" placeholder="Ej: 28.5" value={form.peso_kg||''} onChange={e => setForm(p => ({...p,peso_kg:e.target.value.replace(',','.')}))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Sexo</label>
              <Select value={form.sexo||'Macho'} onChange={e => setForm(p => ({...p,sexo:e.target.value}))}>
                <option value="Macho">Macho</option><option value="Hembra">Hembra</option>
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Tamaño</label>
              <Select value={form.tamano||'Mediano'} onChange={e => setForm(p => ({...p,tamano:e.target.value}))}>
                <option value="Mini">Mini</option><option value="Pequeño">Pequeño</option><option value="Mediano">Mediano</option><option value="Grande">Grande</option><option value="Gigante">Gigante</option>
              </Select></div>
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label><Textarea value={form.notas||''} onChange={e => setForm(p => ({...p,notas:e.target.value}))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- ALIADOS TAB ---
function TabAliados({ isAdmin }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','contacto_nombre','ciudad'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('aliados').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', identificacion_nit: item.identificacion_nit || '',
      contacto_nombre: item.contacto_nombre || '', whatsapp: item.whatsapp || '',
      telefono: item.telefono || '', ciudad: item.ciudad || 'Bogotá',
      barrio: item.barrio || '', vip: item.vip || false,
      modalidad_comision: item.modalidad_comision || 'FACTURACION_MENSUAL',
      saldo_comision: item.saldo_comision || 0, activo: item.activo !== false,
    } : { nombre:'',identificacion_nit:'',contacto_nombre:'',whatsapp:'',telefono:'',ciudad:'Bogotá',barrio:'',vip:false,modalidad_comision:'FACTURACION_MENSUAL',saldo_comision:0,activo:true })
  }
  async function guardar() {
    if (!form.nombre?.trim()) return alert('El nombre es requerido.')
    setSaving(true)
    const body = nullify(form, ['modalidad_comision'])
    const { error } = selected?.id_aliado
      ? await db.from('aliados').update(body).eq('id_aliado', selected.id_aliado)
      : await db.from('aliados').insert(body)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(a) {
    if (!window.confirm(`¿Eliminar a ${a.nombre}?\nEsta acción no se puede deshacer.`)) return
    const { error } = await db.from('aliados').delete().eq('id_aliado', a.id_aliado)
    if (error) {
      if (error.code === '23503') {
        if (window.confirm(`${a.nombre} tiene servicios registrados y no se puede eliminar.\n\n¿Deseas marcarlo como INACTIVO en su lugar?`)) {
          await db.from('aliados').update({ activo: false }).eq('id_aliado', a.id_aliado)
          await cargar()
        }
      } else {
        alert('Error al eliminar: ' + error.message)
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Contacto</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>VIP</Th><Th>Saldo</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(a => (
              <Tr key={a.id_aliado}>
                <Td className="font-semibold text-ink">{a.nombre}</Td>
                <Td className="text-ink3">{a.contacto_nombre}</Td>
                <Td className="text-ink3">{a.whatsapp}</Td>
                <Td className="text-ink3">{a.ciudad}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#F0F0F0] text-[#555]'}`}>{a.vip ? 'VIP' : 'No'}</span></Td>
                <Td className="font-semibold text-ink">{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(a.saldo_comision||0)}</Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(a)}>Editar</Button>
                      <button onClick={() => eliminar(a)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id_aliado ? 'Editar aliado' : 'Nuevo aliado'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            {[['nombre','Nombre'],['identificacion_nit','NIT/Cédula'],['contacto_nombre','Contacto'],['whatsapp','WhatsApp'],['telefono','Teléfono'],['ciudad','Ciudad'],['barrio','Barrio']].map(([k,l]) => (
              <div key={k}><label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label><Input value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))} /></div>
            ))}
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Modalidad comisión</label>
              <Select value={form.modalidad_comision||'FACTURACION_MENSUAL'} onChange={e => setForm(p=>({...p,modalidad_comision:e.target.value}))}>
                <option value="FACTURACION_MENSUAL">Facturación mensual</option>
                <option value="DESCUENTO_INMEDIATO">Descuento inmediato</option>
                <option value="CREDITO_ACUMULADO">Crédito acumulado</option>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" id="aliado-vip" checked={!!form.vip} onChange={e => setForm(p=>({...p,vip:e.target.checked}))} className="w-4 h-4 accent-[#3D5A27]" />
              <label htmlFor="aliado-vip" className="text-[12px] font-semibold text-ink2 cursor-pointer">Aliado VIP</label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- PERSONAL TAB ---
function TabPersonal({ isAdmin }) {
  const [data, setData] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','apellido','cedula'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const [{ data: d }, { data: r }] = await Promise.all([
      db.from('personal').select('*, roles_personal(nombre)').order('nombre'),
      db.from('roles_personal').select('*').order('nombre'),
    ])
    setData(d || [])
    setRoles(r || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', apellido: item.apellido || '',
      cedula: item.cedula || '', whatsapp: item.whatsapp || '',
      tipo_vehiculo: item.tipo_vehiculo || '', placa_vehiculo: item.placa_vehiculo || '',
      activo: item.activo !== false, rol_principal_id: item.rol_principal_id || '',
    } : { nombre:'',apellido:'',cedula:'',whatsapp:'',tipo_vehiculo:'',placa_vehiculo:'',activo:true,rol_principal_id:'' })
  }
  async function guardar() {
    if (!form.nombre?.trim()) return alert('El nombre es requerido.')
    setSaving(true)
    const body = nullify(
      { ...form, rol_principal_id: form.rol_principal_id ? parseInt(form.rol_principal_id) : null },
      ['tipo_vehiculo', 'placa_vehiculo']
    )
    const { error } = selected?.id
      ? await db.from('personal').update(body).eq('id', selected.id)
      : await db.from('personal').insert(body)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(p) {
    if (!window.confirm(`¿Eliminar a ${p.nombre} ${p.apellido || ''}?\nEsta acción no se puede deshacer.`)) return
    const { error } = await db.from('personal').delete().eq('id', p.id)
    if (error) {
      if (error.code === '23503') {
        if (window.confirm(`${p.nombre} tiene servicios registrados y no se puede eliminar.\n\n¿Deseas marcarlo como INACTIVO en su lugar?`)) {
          await db.from('personal').update({ activo: false }).eq('id', p.id)
          await cargar()
        }
      } else {
        alert('Error al eliminar: ' + error.message)
      }
      return
    }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Rol</Th><Th>Vehículo</Th><Th>Activo</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(p => (
              <Tr key={p.id}>
                <Td className="font-semibold text-ink">{p.nombre} {p.apellido}</Td>
                <Td className="text-ink3">{p.cedula}</Td>
                <Td className="text-ink3">{p.whatsapp}</Td>
                <Td className="text-ink3">{p.roles_personal?.nombre || '-'}</Td>
                <Td className="text-ink3">{p.tipo_vehiculo} {p.placa_vehiculo}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{p.activo ? 'Sí' : 'No'}</span></Td>
                {isAdmin && (
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button>
                      <button onClick={() => eliminar(p)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id ? 'Editar personal' : 'Nuevo personal'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            {[['nombre','Nombre'],['apellido','Apellido'],['cedula','Cédula'],['whatsapp','WhatsApp'],['tipo_vehiculo','Tipo vehículo'],['placa_vehiculo','Placa']].map(([k,l]) => (
              <div key={k}><label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label><Input value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))} /></div>
            ))}
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Rol</label>
              <Select value={form.rol_principal_id||''} onChange={e => setForm(p=>({...p,rol_principal_id:e.target.value}))}>
                <option value="">Seleccionar...</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </Select></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- INVENTARIO TAB ---
function TabInventario({ isAdmin }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { q, setQ, filtered } = useSearch(data, ['nombre','descripcion','proveedor','ubicacion'])

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setLoading(true)
    const { data: d } = await db.from('inventario').select('*').order('nombre')
    setData(d || [])
    setLoading(false)
  }
  function abrir(item) {
    setSelected(item || { nuevo: true })
    setForm(item ? {
      nombre: item.nombre || '', descripcion: item.descripcion || '',
      unidad: item.unidad || '', stock_actual: item.stock_actual || 0,
      stock_minimo: item.stock_minimo || 0, proveedor: item.proveedor || '',
      precio_unitario: item.precio_unitario || 0, ubicacion: item.ubicacion || '',
      activo: item.activo !== false,
    } : { nombre:'',descripcion:'',unidad:'',stock_actual:0,stock_minimo:0,proveedor:'',precio_unitario:0,ubicacion:'',activo:true })
  }
  async function guardar() {
    if (!form.nombre?.trim()) return alert('El nombre es requerido.')
    setSaving(true)
    const body = { ...form, stock_actual: parseFloat(form.stock_actual)||0, stock_minimo: parseFloat(form.stock_minimo)||0, precio_unitario: parseFloat(form.precio_unitario)||0 }
    const { error } = selected?.id
      ? await db.from('inventario').update(body).eq('id', selected.id)
      : await db.from('inventario').insert(body)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    await cargar(); setSelected(null)
  }
  async function eliminar(i) {
    if (!window.confirm(`¿Eliminar "${i.nombre}"?\nEsta acción no se puede deshacer.`)) return
    const { error } = await db.from('inventario').delete().eq('id', i.id)
    if (error) { alert('Error al eliminar: ' + error.message); return }
    await cargar()
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>}
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Unidad</Th><Th>Stock actual</Th><Th>Stock mínimo</Th><Th>Proveedor</Th><Th>Precio</Th>{isAdmin && <Th></Th>}</tr></thead>
          <tbody>
            {filtered.map(i => {
              const bajo = i.stock_actual < i.stock_minimo
              return (
                <Tr key={i.id} className={bajo ? 'bg-danger-light/50' : ''}>
                  <Td><div className="font-semibold text-ink">{i.nombre}</div><div className="text-[10px] text-ink3">{i.descripcion}</div></Td>
                  <Td className="text-ink3">{i.unidad}</Td>
                  <Td><span className={`font-bold ${bajo ? 'text-danger' : 'text-ink'}`}>{i.stock_actual}</span></Td>
                  <Td className="text-ink3">{i.stock_minimo}</Td>
                  <Td className="text-ink3">{i.proveedor}</Td>
                  <Td className="text-ink2">{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(i.precio_unitario||0)}</Td>
                  {isAdmin && (
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => abrir(i)}>Editar</Button>
                        <button onClick={() => eliminar(i)} title="Eliminar" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </Td>
                  )}
                </Tr>
              )
            })}
          </tbody>
        </Table></TableWrap>
      )}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.id ? 'Editar ítem' : 'Nuevo ítem'} maxWidth="max-w-lg"
          footer={<><Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Nombre</label><Input value={form.nombre||''} onChange={e => setForm(p=>({...p,nombre:e.target.value}))} /></div>
            {[['unidad','Unidad'],['stock_actual','Stock actual'],['stock_minimo','Stock mínimo'],['proveedor','Proveedor'],['precio_unitario','Precio unitario'],['ubicacion','Ubicación']].map(([k,l]) => (
              <div key={k}><label className="text-[11px] font-bold text-ink3 block mb-1">{l}</label><Input type={['stock_actual','stock_minimo','precio_unitario'].includes(k)?'number':'text'} value={form[k]||''} onChange={e => setForm(p=>({...p,[k]:e.target.value}))} /></div>
            ))}
            <div className="col-span-2"><label className="text-[11px] font-bold text-ink3 block mb-1">Descripción</label><Textarea value={form.descripcion||''} onChange={e => setForm(p=>({...p,descripcion:e.target.value}))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function Gestion() {
  const { personalData } = useAuth()
  const isAdmin = personalData?.rol === 'ADMIN'

  return (
    <div>
      <Topbar />
      <div className="p-7">
        <Tabs defaultValue="clientes">
          <TabsList className="mb-6">
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
            <TabsTrigger value="mascotas">Mascotas</TabsTrigger>
            <TabsTrigger value="aliados">Aliados</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="inventario">Inventario</TabsTrigger>
          </TabsList>
          <TabsContent value="clientes"><TabClientes isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="mascotas"><TabMascotas isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="aliados"><TabAliados isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="personal"><TabPersonal isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="inventario"><TabInventario isAdmin={isAdmin} /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
