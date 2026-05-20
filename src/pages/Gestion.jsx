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
import { Plus, Search } from 'lucide-react'

function useSearch(data, fields) {
  const [q, setQ] = useState('')
  const filtered = data.filter(item =>
    !q || fields.some(f => String(item[f] || '').toLowerCase().includes(q.toLowerCase()))
  )
  return { q, setQ, filtered }
}

// --- CLIENTES TAB ---
function TabClientes() {
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
    setForm(item || { nombre:'',apellido:'',cedula_nit:'',whatsapp:'',telefono:'',email:'',direccion:'',ciudad:'Bogotá',tipo_cliente:'NORMAL',activo:true })
  }
  async function guardar() {
    setSaving(true)
    try {
      if (selected?.id_cliente) {
        await db.from('clientes').update(form).eq('id_cliente', selected.id_cliente)
      } else {
        await db.from('clientes').insert(form)
      }
      await cargar()
      setSelected(null)
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>Tipo</Th><Th>Activo</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(c => (
              <Tr key={c.id_cliente}>
                <Td><div className="font-semibold text-ink">{c.nombre} {c.apellido}</div></Td>
                <Td className="text-ink3">{c.cedula_nit}</Td>
                <Td className="text-ink3">{c.whatsapp}</Td>
                <Td className="text-ink3">{c.ciudad}</Td>
                <Td className="text-ink3">{c.tipo_cliente}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{c.activo ? 'Sí' : 'No'}</span></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => abrir(c)}>Editar</Button></Td>
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
function TabMascotas() {
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
    setForm(item ? { nombre:item.nombre,especie_id:item.especie_id,raza:item.raza||'',sexo:item.sexo||'Macho',peso_kg:item.peso_kg||'',tamano:item.tamano||'Mediano',notas:item.notas||'' } : { nombre:'',especie_id:'',raza:'',sexo:'Macho',peso_kg:'',tamano:'Mediano',notas:'' })
  }
  async function guardar() {
    setSaving(true)
    try {
      const body = { ...form, peso_kg: parseFloat(form.peso_kg) || 0 }
      if (selected?.id_mascota) {
        await db.from('mascotas').update(body).eq('id_mascota', selected.id_mascota)
      } else {
        await db.from('mascotas').insert(body)
      }
      await cargar(); setSelected(null)
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
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
          <thead><tr><Th>Nombre</Th><Th>Especie</Th><Th>Raza</Th><Th>Peso</Th><Th>Cliente</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(m => (
              <Tr key={m.id_mascota}>
                <Td className="font-semibold text-ink">{m.nombre}</Td>
                <Td className="text-ink3">{m.especies?.nombre}</Td>
                <Td className="text-ink3">{m.raza || '-'}</Td>
                <Td className="text-ink3">{m.peso_kg}kg</Td>
                <Td className="text-ink3">{m.clientes?.nombre} {m.clientes?.apellido}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => abrir(m)}>Editar</Button></Td>
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
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Peso (kg)</label><Input type="number" step="0.1" value={form.peso_kg||''} onChange={e => setForm(p => ({...p,peso_kg:e.target.value}))} /></div>
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
function TabAliados() {
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
    setForm(item || { nombre:'',identificacion_nit:'',contacto_nombre:'',whatsapp:'',telefono:'',ciudad:'Bogotá',barrio:'',vip:false,modalidad_comision:'FACTURACION_MENSUAL',saldo_comision:0,activo:true })
  }
  async function guardar() {
    setSaving(true)
    try {
      if (selected?.id_aliado) {
        await db.from('aliados').update(form).eq('id_aliado', selected.id_aliado)
      } else {
        await db.from('aliados').insert(form)
      }
      await cargar(); setSelected(null)
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Contacto</Th><Th>WhatsApp</Th><Th>Ciudad</Th><Th>VIP</Th><Th>Saldo</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(a => (
              <Tr key={a.id_aliado}>
                <Td className="font-semibold text-ink">{a.nombre}</Td>
                <Td className="text-ink3">{a.contacto_nombre}</Td>
                <Td className="text-ink3">{a.whatsapp}</Td>
                <Td className="text-ink3">{a.ciudad}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#F0F0F0] text-[#555]'}`}>{a.vip ? 'VIP' : 'No'}</span></Td>
                <Td className="font-semibold text-ink">{new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(a.saldo_comision||0)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => abrir(a)}>Editar</Button></Td>
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
function TabPersonal() {
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
    setForm(item || { nombre:'',apellido:'',cedula:'',whatsapp:'',tipo_vehiculo:'',placa_vehiculo:'',activo:true,rol_principal_id:'' })
  }
  async function guardar() {
    setSaving(true)
    try {
      if (selected?.id) {
        await db.from('personal').update(form).eq('id', selected.id)
      } else {
        await db.from('personal').insert(form)
      }
      await cargar(); setSelected(null)
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Cédula</Th><Th>WhatsApp</Th><Th>Rol</Th><Th>Vehículo</Th><Th>Activo</Th><Th></Th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <Tr key={p.id}>
                <Td className="font-semibold text-ink">{p.nombre} {p.apellido}</Td>
                <Td className="text-ink3">{p.cedula}</Td>
                <Td className="text-ink3">{p.whatsapp}</Td>
                <Td className="text-ink3">{p.roles_personal?.nombre || '-'}</Td>
                <Td className="text-ink3">{p.tipo_vehiculo} {p.placa_vehiculo}</Td>
                <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{p.activo ? 'Sí' : 'No'}</span></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => abrir(p)}>Editar</Button></Td>
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
function TabInventario() {
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
    setForm(item || { nombre:'',descripcion:'',unidad:'',stock_actual:0,stock_minimo:0,proveedor:'',precio_unitario:0,ubicacion:'',activo:true })
  }
  async function guardar() {
    setSaving(true)
    try {
      const body = { ...form, stock_actual: parseFloat(form.stock_actual)||0, stock_minimo: parseFloat(form.stock_minimo)||0, precio_unitario: parseFloat(form.precio_unitario)||0 }
      if (selected?.id) {
        await db.from('inventario').update(body).eq('id', selected.id)
      } else {
        await db.from('inventario').insert(body)
      }
      await cargar(); setSelected(null)
    } catch (e) { alert('Error: ' + e.message) } finally { setSaving(false) }
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input className="pl-8" placeholder="Buscar..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => abrir(null)}><Plus size={14} /> Nuevo</Button>
      </div>
      {loading ? <div className="text-center py-8 text-ink3">Cargando...</div> : (
        <TableWrap><Table>
          <thead><tr><Th>Nombre</Th><Th>Unidad</Th><Th>Stock actual</Th><Th>Stock mínimo</Th><Th>Proveedor</Th><Th>Precio</Th><Th></Th></tr></thead>
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
                  <Td><Button size="sm" variant="ghost" onClick={() => abrir(i)}>Editar</Button></Td>
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
          <TabsContent value="clientes"><TabClientes /></TabsContent>
          <TabsContent value="mascotas"><TabMascotas /></TabsContent>
          <TabsContent value="aliados"><TabAliados /></TabsContent>
          <TabsContent value="personal"><TabPersonal /></TabsContent>
          <TabsContent value="inventario"><TabInventario /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
