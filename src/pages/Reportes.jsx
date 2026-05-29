import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts'
import { Download, CalendarDays } from 'lucide-react'

const COLORS = ['#1F5A32','#C4A87A','#3B6FBF','#9A5500','#1D8A55','#5B21B6']

// --- Utilidades de rango de fechas ---
function getRango(key) {
  const hoy = new Date()
  const y = hoy.getFullYear(), m = hoy.getMonth()
  switch (key) {
    case 'mes':       return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) }
    case 'mes_ant':   return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) }
    case 'trim':      return { from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 0) }
    case 'anio':      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) }
    default:          return { from: null, to: null }
  }
}
function toISO(d) { return d ? d.toISOString().split('T')[0] : null }

const RANGOS = [
  { key: 'mes',     label: 'Este mes' },
  { key: 'mes_ant', label: 'Mes anterior' },
  { key: 'trim',    label: 'Últimos 3 meses' },
  { key: 'anio',    label: 'Este año' },
  { key: 'todo',    label: 'Todo' },
]

function FiltroFecha({ rango, setRango }) {
  return (
    <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border mb-6 w-fit overflow-x-auto flex-wrap"
      style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
      {RANGOS.map(r => (
        <button key={r.key}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${rango === r.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
          onClick={() => setRango(r.key)}>
          {r.key === 'mes' && <CalendarDays size={11} />}{r.label}
        </button>
      ))}
    </div>
  )
}

// --- Tab Contabilidad ---
function TabContabilidad({ rango }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { from, to } = getRango(rango)
    let q = db.from('v_kanban').select('servicio_id,mascota,cliente,plan,estado,fecha_ingreso,valor_total,valor_pagado,saldo_pendiente,estado_pago,cliente_wa')
      .neq('estado', 'CANCELADO')
    if (from) q = q.gte('fecha_ingreso', toISO(from))
    if (to)   q = q.lte('fecha_ingreso', toISO(to))
    q.order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [rango])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const totalFact = data.reduce((a, s) => a + (s.valor_total || 0), 0)
  const totalCob  = data.reduce((a, s) => a + (s.valor_pagado || 0), 0)
  const totalPend = data.reduce((a, s) => a + (s.saldo_pendiente || 0), 0)
  const pctCobro  = totalFact > 0 ? Math.round((totalCob / totalFact) * 100) : 0

  const porEstadoPago = ['COMPLETO','PARCIAL','PENDIENTE'].map(e => ({
    name: e,
    count: data.filter(s => s.estado_pago === e).length,
    valor: data.filter(s => s.estado_pago === e).reduce((a, s) => a + (s.valor_total || 0), 0),
  }))

  // Ingresos por mes (últimos 6 meses)
  const porMes = {}
  data.forEach(s => {
    if (!s.fecha_ingreso) return
    const mes = s.fecha_ingreso.slice(0, 7)
    if (!porMes[mes]) porMes[mes] = { facturado: 0, cobrado: 0 }
    porMes[mes].facturado += s.valor_total || 0
    porMes[mes].cobrado   += s.valor_pagado || 0
  })
  const mesData = Object.entries(porMes).sort().slice(-6).map(([mes, v]) => ({
    mes: new Intl.DateTimeFormat('es-CO', { month: 'short', year: '2-digit' }).format(new Date(mes + '-01')),
    Facturado: v.facturado,
    Cobrado: v.cobrado,
  }))

  const deudores = data.filter(s => s.estado_pago !== 'COMPLETO' && s.saldo_pendiente > 0)

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total facturado"   value={fmt(totalFact)}  />
        <StatCard label="Total cobrado"     value={fmt(totalCob)}   valueColor="#1D8A55" />
        <StatCard label="Saldo pendiente"   value={fmt(totalPend)}  valueColor="#C03030" />
        <StatCard label="% cobro"           value={`${pctCobro}%`}  valueColor={pctCobro >= 90 ? '#1D8A55' : pctCobro >= 70 ? '#9A5500' : '#C03030'} />
      </div>

      {/* Resumen por estado pago */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {porEstadoPago.map(ep => (
          <div key={ep.name} className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit mb-2 ${ep.name === 'COMPLETO' ? 'bg-green-light text-primary-dark' : ep.name === 'PARCIAL' ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-danger-light text-danger'}`}>
              {ep.name}
            </div>
            <div className="text-2xl font-bold text-ink">{ep.count}</div>
            <div className="text-[11px] text-ink3">servicios · {fmt(ep.valor)}</div>
          </div>
        ))}
      </div>

      {/* Gráfica ingresos vs cobros por mes */}
      {mesData.length > 0 && (
        <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink mb-3">Facturado vs Cobrado por mes</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mesData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} width={70} />
              <Tooltip formatter={v => fmt(v)} />
              <Bar dataKey="Facturado" fill="#C4A87A" radius={[4,4,0,0]} />
              <Bar dataKey="Cobrado"   fill="#1F5A32" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Lista de deudas pendientes */}
      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink flex-1">Cobros pendientes / parciales</div>
          <span className="text-[11px] font-bold text-danger">{deudores.length} registros · {fmt(totalPend)} por cobrar</span>
        </div>
        {deudores.length === 0 ? (
          <div className="py-8 text-center text-ink3 text-sm">Sin saldos pendientes en este período</div>
        ) : (
          <TableWrap><Table>
            <thead><tr>
              <Th>Mascota / Cliente</Th>
              <Th>Plan</Th>
              <Th>Ingreso</Th>
              <Th>Total</Th>
              <Th>Cobrado</Th>
              <Th>Pendiente</Th>
              <Th>Estado pago</Th>
              <Th>WA</Th>
            </tr></thead>
            <tbody>
              {deudores.map(s => (
                <Tr key={s.servicio_id}>
                  <Td>
                    <div className="font-semibold text-ink">{s.mascota || '-'}</div>
                    <div className="text-[10px] text-ink3">{s.cliente}</div>
                  </Td>
                  <Td className="text-ink3">{s.plan}</Td>
                  <Td className="text-ink3">{s.fecha_ingreso ? new Date(s.fecha_ingreso).toLocaleDateString('es-CO') : '-'}</Td>
                  <Td className="font-semibold text-ink">{fmt(s.valor_total)}</Td>
                  <Td className="text-[#1D8A55]">{fmt(s.valor_pagado)}</Td>
                  <Td className="font-bold text-danger">{fmt(s.saldo_pendiente)}</Td>
                  <Td>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.estado_pago === 'PARCIAL' ? 'bg-[#FFF3DC] text-[#9A5500] border border-[#FFD980]' : 'bg-danger-light text-danger border border-danger/30'}`}>
                      {s.estado_pago}
                    </span>
                  </Td>
                  <Td>
                    {s.cliente_wa && (
                      <a href={`https://wa.me/57${s.cliente_wa.replace(/\D/g,'')}?text=Hola, le recordamos que tiene un saldo pendiente de ${fmt(s.saldo_pendiente)} por el servicio de ${s.mascota}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold"
                        style={{ background: '#25D366', color: 'white' }}>WA</a>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table></TableWrap>
        )}
      </div>
    </div>
  )
}

// --- Tab Servicios ---
function TabServicios({ rango }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { from, to } = getRango(rango)
    let q = db.from('v_kanban').select('servicio_id,mascota,cliente,plan,estado,canal_entrada,fecha_ingreso,valor_total,estado_pago')
    if (from) q = q.gte('fecha_ingreso', toISO(from))
    if (to)   q = q.lte('fecha_ingreso', toISO(to))
    q.order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [rango])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const totalIngresos = data.reduce((acc, s) => acc + (s.valor_total || 0), 0)
  const entregados    = data.filter(s => s.estado === 'ENTREGADO').length

  const porPlan = {}
  data.forEach(s => { const k = s.plan || 'Otro'; porPlan[k] = (porPlan[k] || 0) + 1 })
  const planData = Object.entries(porPlan).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0,20)+'...' : name, value })).sort((a,b) => b.value - a.value).slice(0,8)

  const porCanal = {}
  data.forEach(s => { const k = s.canal_entrada || 'Directo'; porCanal[k] = (porCanal[k] || 0) + 1 })
  const canalData = Object.entries(porCanal).map(([name, value]) => ({ name, value }))

  function exportCSV() {
    const headers = ['ID','Mascota','Cliente','Plan','Estado','Canal','Ingreso','Valor','Estado Pago']
    const rows = data.map(s => [s.servicio_id,s.mascota,s.cliente,s.plan,s.estado,s.canal_entrada,s.fecha_ingreso,s.valor_total,s.estado_pago])
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
        <StatCard label="Total servicios"   value={data.length} />
        <StatCard label="Entregados"         value={entregados}          valueColor="#5B21B6" />
        <StatCard label="Ingresos totales"   value={fmt(totalIngresos)} />
        <StatCard label="Ticket promedio"    value={fmt(data.length > 0 ? totalIngresos / data.length : 0)} />
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

// --- Tab Tiempo Promesa ---
function TabTiempoPromesa({ rango }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { from, to } = getRango(rango)
    let q = db.from('v_tiempo_promesa').select('*').order('fecha_ingreso', { ascending: false })
    if (from) q = q.gte('fecha_ingreso', toISO(from))
    if (to)   q = q.lte('fecha_ingreso', toISO(to))
    q.then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [rango])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  const cumplidos = data.filter(r => r.entrego_a_tiempo).length
  const pct = data.length > 0 ? Math.round((cumplidos / data.length) * 100) : 0

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total servicios" value={data.length} />
        <StatCard label="Cumplidos"       value={cumplidos}            valueColor="#1D8A55" />
        <StatCard label="Incumplidos"     value={data.length - cumplidos} valueColor="#C03030" />
        <StatCard label="% Cumplimiento"  value={`${pct}%`}            valueColor={pct >= 90 ? '#1D8A55' : pct >= 70 ? '#9A5500' : '#C03030'} />
      </div>
      <TableWrap><Table>
        <thead><tr><Th>Servicio</Th><Th>Plan</Th><Th>Ingreso</Th><Th>Límite</Th><Th>Entrega real</Th><Th>A tiempo</Th><Th>Días dif.</Th></tr></thead>
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

// --- Tab Comisiones ---
function TabComisiones({ rango }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { from, to } = getRango(rango)
    let q = db.from('comisiones_aliados').select('*, aliados(nombre,vip)').order('fecha_generada', { ascending: false })
    if (from) q = q.gte('fecha_generada', toISO(from))
    if (to)   q = q.lte('fecha_generada', toISO(to))
    q.then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [rango])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

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
          {Object.keys(porAliado).length === 0 && <tr><td colSpan={4} className="text-center py-6 text-ink3 text-sm">Sin comisiones en este período</td></tr>}
        </tbody>
      </Table></TableWrap>
    </div>
  )
}

// --- Tab Producción ---
function TabProduccion({ rango }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.from('servicio_recordatorios')
      .select('*, recordatorios(nombre,categoria,maquinas_produccion(nombre))')
      .neq('estado','REMOVIDO')
      .then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [rango])

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

export default function Reportes() {
  const [rango, setRango] = useState('mes')

  return (
    <div>
      <Topbar />
      <div className="p-7">
        <FiltroFecha rango={rango} setRango={setRango} />
        <Tabs defaultValue="contabilidad">
          <TabsList className="mb-6">
            <TabsTrigger value="contabilidad">Contabilidad</TabsTrigger>
            <TabsTrigger value="servicios">Servicios</TabsTrigger>
            <TabsTrigger value="tiempo">Tiempo promesa</TabsTrigger>
            <TabsTrigger value="comisiones">Comisiones</TabsTrigger>
            <TabsTrigger value="produccion">Producción</TabsTrigger>
          </TabsList>
          <TabsContent value="contabilidad"><TabContabilidad rango={rango} /></TabsContent>
          <TabsContent value="servicios"><TabServicios rango={rango} /></TabsContent>
          <TabsContent value="tiempo"><TabTiempoPromesa rango={rango} /></TabsContent>
          <TabsContent value="comisiones"><TabComisiones rango={rango} /></TabsContent>
          <TabsContent value="produccion"><TabProduccion rango={rango} /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
