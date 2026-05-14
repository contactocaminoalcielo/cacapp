import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'

function TabPlanes() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    db.from('planes').select('*').order('nombre').then(({ data: d }) => { setData(d||[]); setLoading(false) })
  }, [])
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>
  return (
    <TableWrap><Table>
      <thead><tr><Th>Código</Th><Th>Nombre</Th><Th>Tipo proceso</Th><Th>Días entrega</Th><Th>Activo</Th></tr></thead>
      <tbody>
        {data.map(p => (
          <Tr key={p.id}>
            <Td><span className="font-mono text-[11px] bg-surface2 px-2 py-0.5 rounded">{p.codigo}</span></Td>
            <Td className="font-semibold text-ink">{p.nombre}</Td>
            <Td className="text-ink3">{p.tipo_proceso?.replace(/_/g,' ')}</Td>
            <Td className="text-ink3">{p.dias_habiles_entrega || '-'}</Td>
            <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.activo ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{p.activo ? 'Sí' : 'No'}</span></Td>
          </Tr>
        ))}
      </tbody>
    </Table></TableWrap>
  )
}

function TabRecordatorios() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    db.from('recordatorios').select('*, maquinas_produccion(nombre)').order('nombre').then(({ data: d }) => { setData(d||[]); setLoading(false) })
  }, [])
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>
  return (
    <TableWrap><Table>
      <thead><tr><Th>Nombre</Th><Th>Categoría</Th><Th>Máquina</Th><Th>Req. imagen</Th><Th>Solo nombre</Th><Th>Días prod.</Th></tr></thead>
      <tbody>
        {data.map(r => (
          <Tr key={r.id}>
            <Td className="font-semibold text-ink">{r.nombre}</Td>
            <Td className="text-ink3">{r.categoria}</Td>
            <Td className="text-ink3">{r.maquinas_produccion?.nombre || '-'}</Td>
            <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.requiere_imagen ? 'bg-[#EEF3FB] text-[#3B6FBF]' : 'bg-[#F0F0F0] text-[#555]'}`}>{r.requiere_imagen ? 'Sí' : 'No'}</span></Td>
            <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.solo_nombre ? 'bg-green-light text-primary-dark' : 'bg-[#F0F0F0] text-[#555]'}`}>{r.solo_nombre ? 'Sí' : 'No'}</span></Td>
            <Td className="text-ink3">{r.tiempo_produccion_dias || '-'}</Td>
          </Tr>
        ))}
      </tbody>
    </Table></TableWrap>
  )
}

function TabPlanItems() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    db.from('plan_recordatorios').select('*, planes(nombre,codigo), recordatorios(nombre,categoria)').order('orden').then(({ data: d }) => { setData(d||[]); setLoading(false) })
  }, [])
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  // Agrupar por plan
  const porPlan = {}
  data.forEach(r => {
    const k = r.planes?.nombre || 'Sin plan'
    if (!porPlan[k]) porPlan[k] = []
    porPlan[k].push(r)
  })

  return (
    <div className="space-y-6">
      {Object.entries(porPlan).map(([plan, items]) => (
        <div key={plan} className="bg-surface border rounded-2xl overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-4 py-3 bg-surface2 font-serif text-base text-ink border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {plan} <span className="text-[11px] font-sans text-ink3 ml-2">({items.length} ítems)</span>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {items.map((item, i) => (
              <div key={i} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full bg-green-light text-primary-dark border border-green-mid">
                {item.recordatorios?.nombre}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TabVipItems() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    db.from('vip_recordatorios').select('*, recordatorios(nombre,categoria), planes(nombre)').then(({ data: d }) => { setData(d||[]); setLoading(false) })
  }, [])
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>
  return (
    <TableWrap><Table>
      <thead><tr><Th>Plan</Th><Th>Ítem</Th><Th>Categoría</Th></tr></thead>
      <tbody>
        {data.map((r, i) => (
          <Tr key={i}>
            <Td className="text-ink2">{r.planes?.nombre || '-'}</Td>
            <Td className="font-semibold text-ink">{r.recordatorios?.nombre}</Td>
            <Td className="text-ink3">{r.recordatorios?.categoria}</Td>
          </Tr>
        ))}
        {data.length === 0 && <tr><td colSpan={3} className="text-center py-8 text-ink3 text-sm">Sin configuración</td></tr>}
      </tbody>
    </Table></TableWrap>
  )
}

function TabComisiones() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    db.from('config_comisiones').select('*, planes(nombre,codigo)').order('created_at').then(({ data: d }) => { setData(d||[]); setLoading(false) })
  }, [])
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>
  return (
    <TableWrap><Table>
      <thead><tr><Th>Plan</Th><Th>VIP</Th><Th>Rango min</Th><Th>Rango max</Th><Th>Porcentaje</Th><Th>Monto fijo</Th></tr></thead>
      <tbody>
        {data.map((r, i) => (
          <Tr key={i}>
            <Td className="font-semibold text-ink">{r.planes?.nombre || 'Todos'}</Td>
            <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.solo_vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#F0F0F0] text-[#555]'}`}>{r.solo_vip ? 'VIP' : 'Todos'}</span></Td>
            <Td className="text-ink3">{r.rango_min !== null ? fmt(r.rango_min) : '-'}</Td>
            <Td className="text-ink3">{r.rango_max !== null ? fmt(r.rango_max) : '-'}</Td>
            <Td className="font-semibold text-ink">{r.porcentaje ? `${r.porcentaje}%` : '-'}</Td>
            <Td className="text-ink2">{r.monto_fijo ? fmt(r.monto_fijo) : '-'}</Td>
          </Tr>
        ))}
        {data.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-ink3 text-sm">Sin configuración</td></tr>}
      </tbody>
    </Table></TableWrap>
  )
}

function TabCatalogos() {
  const [canales, setCanales] = useState([])
  const [especies, setEspecies] = useState([])
  const [roles, setRoles] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      db.from('canal_origen').select('*').order('nombre'),
      db.from('especies').select('*').order('nombre'),
      db.from('roles_personal').select('*').order('nombre'),
      db.from('maquinas_produccion').select('*').order('nombre'),
    ]).then(([{ data: ca }, { data: es }, { data: ro }, { data: ma }]) => {
      setCanales(ca||[])
      setEspecies(es||[])
      setRoles(ro||[])
      setMaquinas(ma||[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const sections = [
    { title: 'Canales de origen', data: canales, field: 'nombre' },
    { title: 'Especies', data: especies, field: 'nombre' },
    { title: 'Roles de personal', data: roles, field: 'nombre' },
    { title: 'Máquinas de producción', data: maquinas, field: 'nombre' },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {sections.map(s => (
        <div key={s.title} className="bg-surface border rounded-2xl overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-4 py-3 bg-surface2 font-serif text-base text-ink border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {s.title} <span className="text-[11px] font-sans text-ink3">({s.data.length})</span>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {s.data.map((item, i) => (
              <div key={i} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full bg-surface2 text-ink2 border"
                style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                {item[s.field]}
              </div>
            ))}
            {s.data.length === 0 && <span className="text-[12px] text-ink3">Sin registros</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Configuracion() {
  return (
    <div>
      <Topbar />
      <div className="p-7">
        <Tabs defaultValue="planes">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="planes">Planes</TabsTrigger>
            <TabsTrigger value="recordatorios">Recordatorios</TabsTrigger>
            <TabsTrigger value="plan-items">Plan → Ítems</TabsTrigger>
            <TabsTrigger value="vip-items">VIP → Ítems</TabsTrigger>
            <TabsTrigger value="comisiones">Comisiones</TabsTrigger>
            <TabsTrigger value="catalogos">Catálogos</TabsTrigger>
          </TabsList>
          <TabsContent value="planes"><TabPlanes /></TabsContent>
          <TabsContent value="recordatorios"><TabRecordatorios /></TabsContent>
          <TabsContent value="plan-items"><TabPlanItems /></TabsContent>
          <TabsContent value="vip-items"><TabVipItems /></TabsContent>
          <TabsContent value="comisiones"><TabComisiones /></TabsContent>
          <TabsContent value="catalogos"><TabCatalogos /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
