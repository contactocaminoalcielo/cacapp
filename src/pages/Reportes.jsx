import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Download } from 'lucide-react'

const COLORS = ['#1F5A32','#C4A87A','#3B6FBF','#9A5500','#1D8A55','#5B21B6']

// --- Tiempo promesa ---
function TabTiempoPromesa() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('v_tiempo_promesa').select('*').order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const cumplidos = data.filter(r => r.entrego_a_tiempo).length
  const pct = data.length > 0 ? Math.round((cumplidos / data.length) * 100) : 0

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total servicios" value={data.length} />
        <StatCard label="Cumplidos" value={cumplidos} valueColor="#1D8A55" />
        <StatCard label="Incumplidos" value={data.length - cumplidos} valueColor="#C03030" />
        <StatCard label="% Cumplimiento" value={`${pct}%`} valueColor={pct >= 90 ? '#1D8A55' : pct >= 70 ? '#9A5500' : '#C03030'} />
      </div>
      <TableWrap><Table>
        <thead><tr><Th>Servicio</Th><Th>Plan</Th><Th>Ingreso</Th><Th>Límite</Th><Th>Entrega real</Th><Th>A tiempo</Th><Th>Días diferencia</Th></tr></thead>
        <tbody>
          {data.map((r, i) => (
            <Tr key={i}>
              <Td className="font-semibold text-ink">{r.mascota || '-'}</Td>
              <Td className="text-ink3">{r.plan}</Td>
              <Td className="text-ink3">{r.fecha_ingreso ? new Date(r.fecha_ingreso).toLocaleDateString('es-CO') : '-'}</Td>
              <Td className="text-ink3">{r.fecha_limite_entrega ? new Date(r.fecha_limite_entrega).toLocaleDateString('es-CO') : '-'}</Td>
              <Td className="text-ink3">{r.fecha_entrega_real ? new Date(r.fecha_entrega_real).toLocaleDateString('es-CO') : '-'}</Td>
              <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.entrego_a_tiempo ? 'bg-green-light text-primary-dark' : 'bg-danger-light text-danger'}`}>{r.entrego_a_tiempo ? 'Sí' : 'No'}</span></Td>
              <Td className={`font-bold ${(r.dias_diferencia || 0) > 0 ? 'text-danger' : 'text-ink2'}`}>{r.dias_diferencia || 0}</Td>
            </Tr>
          ))}
        </tbody>
      </Table></TableWrap>
    </div>
  )
}

// --- Comisiones ---
function TabComisiones() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('comisiones_aliados').select('*, aliados(nombre,vip)').order('fecha_generada', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  // Agrupar por aliado
  const porAliado = {}
  data.forEach(c => {
    const nombre = c.aliados?.nombre || 'Desconocido'
    if (!porAliado[nombre]) porAliado[nombre] = { total: 0, count: 0, vip: c.aliados?.vip }
    porAliado[nombre].total += c.monto || 0
    porAliado[nombre].count++
  })

  const barData = Object.entries(porAliado).map(([name, d]) => ({ name, total: d.total })).sort((a, b) => b.total - a.total).slice(0, 8)

  return (
    <div>
      <div className="mb-6 bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="font-serif text-base text-ink mb-3">Comisiones por aliado</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 40 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
            <Tooltip formatter={v => fmt(v)} />
            <Bar dataKey="total" fill="#1F5A32" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TableWrap><Table>
        <thead><tr><Th>Aliado</Th><Th>VIP</Th><Th>Nº servicios</Th><Th>Total comisiones</Th></tr></thead>
        <tbody>
          {Object.entries(porAliado).map(([nombre, d]) => (
            <Tr key={nombre}>
              <Td className="font-semibold text-ink">{nombre}</Td>
              <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.vip ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#F0F0F0] text-[#555]'}`}>{d.vip ? 'VIP' : 'No'}</span></Td>
              <Td className="text-ink2">{d.count}</Td>
              <Td className="font-bold text-ink">{fmt(d.total)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table></TableWrap>
    </div>
  )
}

// --- Producción ---
function TabProduccion() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('servicio_recordatorios')
      .select('*, recordatorios(nombre,categoria,maquinas_produccion(nombre))')
      .neq('estado','REMOVIDO')
      .then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const porEstado = ['PENDIENTE','EN_PROCESO','LISTO','ENTREGADO'].map(e => ({ name: e.replace('_',' '), value: data.filter(r => r.estado === e).length }))
  const porMaquina = {}
  data.forEach(r => {
    const m = r.recordatorios?.maquinas_produccion?.nombre || 'Sin máquina'
    porMaquina[m] = (porMaquina[m] || 0) + 1
  })
  const maquinaData = Object.entries(porMaquina).map(([name, value]) => ({ name, value }))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="font-serif text-base text-ink mb-3">Por estado</div>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart><Pie data={porEstado} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={10}>
            {porEstado.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie><Tooltip /></PieChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="font-serif text-base text-ink mb-3">Por máquina</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={maquinaData} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
            <Tooltip />
            <Bar dataKey="value" fill="#C4A87A" radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// --- Servicios ---
function TabServicios() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('v_kanban').select('*').then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const totalIngresos = data.reduce((acc, s) => acc + (s.valor_total || 0), 0)
  const entregados = data.filter(s => s.estado === 'ENTREGADO').length

  const porPlan = {}
  data.forEach(s => { const k = s.plan || 'Otro'; porPlan[k] = (porPlan[k] || 0) + 1 })
  const planData = Object.entries(porPlan).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0,20)+'...' : name, value })).sort((a,b) => b.value - a.value).slice(0,8)

  const porCanal = {}
  data.forEach(s => { const k = s.canal_entrada || 'Directo'; porCanal[k] = (porCanal[k] || 0) + 1 })
  const canalData = Object.entries(porCanal).map(([name, value]) => ({ name, value }))

  function exportCSV() {
    const headers = ['ID','Mascota','Cliente','Plan','Estado','Canal','Ingreso','Valor']
    const rows = data.map(s => [s.servicio_id,s.mascota,s.cliente,s.plan,s.estado,s.canal_entrada,s.fecha_ingreso,s.valor_total])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'servicios.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total servicios" value={data.length} />
        <StatCard label="Entregados" value={entregados} valueColor="#5B21B6" />
        <StatCard label="Ingresos totales" value={fmt(totalIngresos)} />
        <StatCard label="Ticket promedio" value={fmt(data.length > 0 ? totalIngresos / data.length : 0)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink mb-3">Servicios por plan</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={planData} margin={{ bottom: 30 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#1F5A32" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink mb-3">Por canal de entrada</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart><Pie data={canalData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${Math.round(percent*100)}%`} fontSize={10}>
              {canalData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip /></PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="flex justify-end mb-4">
        <Button variant="secondary" onClick={exportCSV}><Download size={14} />Exportar CSV</Button>
      </div>
    </div>
  )
}

export default function Reportes() {
  return (
    <div>
      <Topbar />
      <div className="p-7">
        <Tabs defaultValue="servicios">
          <TabsList className="mb-6">
            <TabsTrigger value="servicios">Servicios</TabsTrigger>
            <TabsTrigger value="tiempo">Tiempo promesa</TabsTrigger>
            <TabsTrigger value="comisiones">Comisiones</TabsTrigger>
            <TabsTrigger value="produccion">Producción</TabsTrigger>
          </TabsList>
          <TabsContent value="servicios"><TabServicios /></TabsContent>
          <TabsContent value="tiempo"><TabTiempoPromesa /></TabsContent>
          <TabsContent value="comisiones"><TabComisiones /></TabsContent>
          <TabsContent value="produccion"><TabProduccion /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
