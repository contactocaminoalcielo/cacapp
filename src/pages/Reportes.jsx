import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { fmt, waLink, parseDate, hoyLocalISO } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts'
import { Download, CalendarDays } from 'lucide-react'

const COLORS = ['#0B1D4F','#C4A87A','#3B6FBF','#9A5500','#1D8A55','#5B21B6']

const ROL_NOMBRES = { 1: 'COORDINADOR', 2: 'TECNICO', 3: 'MENSAJERO', 4: 'PRODUCTOR', 5: 'OPERARIO', 6: 'ADMIN' }

// --- Utilidades de rango de fechas ---
// hoyLocalISO (fecha local), NO toISOString (fecha UTC: corre +1 día después de las 7 p.m.)
function toISO(d) { return d ? hoyLocalISO(d) : null }

// Devuelve el rango YA en texto ISO. `libre` = {desde, hasta} del rango personalizado.
function getRango(key, libre) {
  const hoy = new Date()
  const y = hoy.getFullYear(), m = hoy.getMonth()
  const par = (from, to) => ({ desde: toISO(from), hasta: toISO(to) })
  switch (key) {
    case 'mes':     return par(new Date(y, m, 1),     new Date(y, m + 1, 0))
    case 'mes_ant': return par(new Date(y, m - 1, 1), new Date(y, m, 0))
    case 'trim':    return par(new Date(y, m - 2, 1), new Date(y, m + 1, 0))
    case 'anio':    return par(new Date(y, 0, 1),     new Date(y, 11, 31))
    case 'libre':   return { desde: libre?.desde || null, hasta: libre?.hasta || null }
    default:        return { desde: null, hasta: null }   // 'todo'
  }
}

const RANGOS = [
  { key: 'mes',     label: 'Este mes' },
  { key: 'mes_ant', label: 'Mes anterior' },
  { key: 'trim',    label: 'Últimos 3 meses' },
  { key: 'anio',    label: 'Este año' },
  { key: 'todo',    label: 'Todo' },
  { key: 'libre',   label: 'Personalizado' },
]

function FiltroFecha({ rango, setRango, libre, setLibre }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit overflow-x-auto flex-wrap"
        style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        {RANGOS.map(r => (
          <button key={r.key}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${rango === r.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
            onClick={() => setRango(r.key)}>
            {r.key === 'mes' && <CalendarDays size={11} />}{r.label}
          </button>
        ))}
      </div>
      {rango === 'libre' && (
        <div className="flex items-center gap-2 text-[12px] text-ink2">
          <input type="date" value={libre.desde || ''} max={libre.hasta || undefined}
            onChange={e => setLibre(l => ({ ...l, desde: e.target.value || null }))}
            className="border rounded-lg px-2 py-1.5 bg-surface text-ink"
            style={{ borderColor: 'rgba(30,80,40,0.15)' }} aria-label="Desde" />
          <span className="text-ink3">a</span>
          <input type="date" value={libre.hasta || ''} min={libre.desde || undefined}
            onChange={e => setLibre(l => ({ ...l, hasta: e.target.value || null }))}
            className="border rounded-lg px-2 py-1.5 bg-surface text-ink"
            style={{ borderColor: 'rgba(30,80,40,0.15)' }} aria-label="Hasta" />
        </div>
      )}
    </div>
  )
}

// Un RPC que falla devuelve data:null SIN lanzar. Sin esto la pestaña mostraría
// ceros como si fueran datos reales — el bug silencioso de siempre.
function useRpc(deps, ...llamadas) {
  const [estado, setEstado] = useState({ loading: true, error: null, data: [] })
  useEffect(() => {
    let vivo = true
    setEstado(e => ({ ...e, loading: true, error: null }))
    Promise.all(llamadas.map(([fn, args]) => db.rpc(fn, args)))
      .then(res => {
        if (!vivo) return
        const fallo = res.find(r => r.error)
        if (fallo) setEstado({ loading: false, error: fallo.error.message, data: [] })
        else setEstado({ loading: false, error: null, data: res.map(r => r.data || []) })
      })
      .catch(e => { if (vivo) setEstado({ loading: false, error: e.message, data: [] }) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return estado
}

function EstadoCarga({ loading, error }) {
  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>
  return (
    <div className="bg-danger-light border border-danger/30 rounded-xl px-4 py-3 text-[12px] text-danger">
      No se pudo cargar el indicador: {error}
    </div>
  )
}

const Panel = ({ titulo, extra, children }) => (
  <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
    <div className="flex items-baseline gap-2 mb-3">
      <div className="font-serif text-base text-ink flex-1">{titulo}</div>
      {extra && <div className="text-[11px] text-ink3">{extra}</div>}
    </div>
    {children}
  </div>
)

// --- Tab Contabilidad ---
function TabContabilidad({ desde, hasta }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = db.from('v_kanban').select('servicio_id,mascota,cliente,plan,estado,fecha_ingreso,valor_total,valor_pagado,saldo_pendiente,estado_pago,cliente_wa')
      .neq('estado', 'CANCELADO')
      .gte('fecha_ingreso', FECHA_CORTE)
    if (desde) q = q.gte('fecha_ingreso', desde)
    if (hasta) q = q.lte('fecha_ingreso', hasta)
    q.order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [desde, hasta])

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
              <Bar dataKey="Cobrado"   fill="#0B1D4F" radius={[4,4,0,0]} />
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
                  <Td className="text-ink3">{s.fecha_ingreso ? parseDate(s.fecha_ingreso).toLocaleDateString('es-CO') : '-'}</Td>
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
                      <a href={waLink(s.cliente_wa, `Hola, le recordamos que tiene un saldo pendiente de ${fmt(s.saldo_pendiente)} por el servicio de ${s.mascota}`)}
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
function TabServicios({ desde, hasta }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = db.from('v_kanban').select('servicio_id,mascota,cliente,plan,estado,canal_entrada,fecha_ingreso,valor_total,estado_pago')
      .gte('fecha_ingreso', FECHA_CORTE)
    if (desde) q = q.gte('fecha_ingreso', desde)
    if (hasta) q = q.lte('fecha_ingreso', hasta)
    q.order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [desde, hasta])

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
              <Bar dataKey="value" fill="#0B1D4F" radius={[4,4,0,0]} />
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
function TabTiempoPromesa({ desde, hasta }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = db.from('v_tiempo_promesa').select('*').order('fecha_ingreso', { ascending: false })
      .gte('fecha_ingreso', FECHA_CORTE)
    if (desde) q = q.gte('fecha_ingreso', desde)
    if (hasta) q = q.lte('fecha_ingreso', hasta)
    q.then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [desde, hasta])

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
              <Td className="text-ink3">{r.fecha_ingreso ? parseDate(r.fecha_ingreso).toLocaleDateString('es-CO') : '-'}</Td>
              <Td className="text-ink3">{r.fecha_limite_entrega ? parseDate(r.fecha_limite_entrega).toLocaleDateString('es-CO') : '-'}</Td>
              <Td className="text-ink3">{r.fecha_entrega_real ? parseDate(r.fecha_entrega_real).toLocaleDateString('es-CO') : '-'}</Td>
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
function TabComisiones({ desde, hasta }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = db.from('comisiones_aliados').select('*, aliados(nombre,vip)').order('fecha_generada', { ascending: false })
    if (desde) q = q.gte('fecha_generada', desde)
    if (hasta) q = q.lte('fecha_generada', hasta)
    q.then(({ data: d }) => { setData(d || []); setLoading(false) })
  }, [desde, hasta])

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
            <Bar dataKey="total" fill="#0B1D4F" radius={[4,4,0,0]} />
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

// --- Tab Ventas por usuario / rol ---
function TabVentasUsuario({ desde, hasta }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = db.from('servicios')
      .select('id, fecha_ingreso, valor_total, registrado_por, registrador:registrado_por(nombre, apellido, rol_principal_id)')
      .neq('estado', 'CANCELADO')
      .gte('fecha_ingreso', FECHA_CORTE)
    if (desde) q = q.gte('fecha_ingreso', desde)
    if (hasta) q = q.lte('fecha_ingreso', hasta)
    q.order('fecha_ingreso', { ascending: false }).then(({ data: d }) => {
      setData(d || [])
      setLoading(false)
    })
  }, [desde, hasta])

  if (loading) return <div className="text-center py-8 text-ink3">Cargando...</div>

  // Agrupar por usuario
  const porUsuario = {}
  data.forEach(s => {
    const r = s.registrador
    const key = s.registrado_por || '__none__'
    if (!porUsuario[key]) porUsuario[key] = {
      nombre: r ? `${r.nombre} ${r.apellido || ''}`.trim() : 'Sin registrar',
      rol:    r ? (ROL_NOMBRES[r.rol_principal_id] || '—') : '—',
      sin:    !r,
      count:  0, valor: 0,
    }
    porUsuario[key].count++
    porUsuario[key].valor += s.valor_total || 0
  })
  const usuarios = Object.values(porUsuario).sort((a, b) => b.count - a.count)
  const barData = usuarios.filter(u => !u.sin).map(u => ({ name: u.nombre, value: u.count }))

  // Agrupar por rol
  const porRol = {}
  data.forEach(s => {
    const rol = s.registrador ? (ROL_NOMBRES[s.registrador.rol_principal_id] || '—') : 'Sin registrar'
    if (!porRol[rol]) porRol[rol] = { count: 0, valor: 0 }
    porRol[rol].count++
    porRol[rol].valor += s.valor_total || 0
  })
  const roles = Object.entries(porRol).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.count - a.count)

  const registrados = data.filter(s => s.registrado_por).length
  const sinRegistrar = data.length - registrados

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total servicios" value={data.length} />
        <StatCard label="Con usuario"     value={registrados}  valueColor="#1D8A55" />
        <StatCard label="Sin registrar"   value={sinRegistrar} valueColor={sinRegistrar > 0 ? '#9A5500' : '#1D8A55'} />
        <StatCard label="Usuarios activos" value={barData.length} valueColor="#5B21B6" />
      </div>

      {sinRegistrar > 0 && (
        <div className="bg-[#FFF8EC] border border-[#FFD980] rounded-xl px-4 py-3 text-[12px] text-[#9A5500]">
          {sinRegistrar} servicio{sinRegistrar !== 1 ? 's' : ''} en este período no tiene{sinRegistrar !== 1 ? 'n' : ''} usuario registrado (creados antes de activar esta función). El conteo por usuario es confiable solo de aquí en adelante.
        </div>
      )}

      {barData.length > 0 && (
        <div className="bg-surface border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink mb-3">Servicios registrados por usuario</div>
          <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 38)}>
            <BarChart data={barData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="value" fill="#0B1D4F" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Detalle por usuario */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b font-serif text-base text-ink" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>Por usuario</div>
          <TableWrap><Table>
            <thead><tr><Th>Usuario</Th><Th>Rol</Th><Th>Servicios</Th><Th>Valor total</Th></tr></thead>
            <tbody>
              {usuarios.map((u, i) => (
                <Tr key={i}>
                  <Td className={`font-semibold ${u.sin ? 'text-ink3 italic' : 'text-ink'}`}>{u.nombre}</Td>
                  <Td className="text-ink3">{u.rol}</Td>
                  <Td className="font-bold text-ink">{u.count}</Td>
                  <Td className="text-ink2">{fmt(u.valor)}</Td>
                </Tr>
              ))}
              {usuarios.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-ink3 text-sm">Sin servicios en este período</td></tr>}
            </tbody>
          </Table></TableWrap>
        </div>

        {/* Resumen por rol */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b font-serif text-base text-ink" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>Por rol</div>
          <TableWrap><Table>
            <thead><tr><Th>Rol</Th><Th>Servicios</Th><Th>Valor total</Th></tr></thead>
            <tbody>
              {roles.map((r, i) => (
                <Tr key={i}>
                  <Td className={`font-semibold ${r.name === 'Sin registrar' ? 'text-ink3 italic' : 'text-ink'}`}>{r.name}</Td>
                  <Td className="font-bold text-ink">{r.count}</Td>
                  <Td className="text-ink2">{fmt(r.valor)}</Td>
                </Tr>
              ))}
              {roles.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-ink3 text-sm">Sin servicios en este período</td></tr>}
            </tbody>
          </Table></TableWrap>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicadores de la especificación de medición (migración 085).
// Todos se calculan en SQL: PostgREST corta en 1.000 filas y agregarlos en el
// navegador daría números MAL sin avisar.
// ─────────────────────────────────────────────────────────────────────────────

// --- Tab Imágenes del cliente: separa el retraso propio del retraso del cliente ---
function TabImagenes({ desde, hasta }) {
  const { loading, error, data } = useRpc([desde, hasta],
    ['rep_espera_imagenes', { p_desde: desde, p_hasta: hasta }],
    ['rep_espera_imagenes_pendientes', { p_limite: 300 }])
  if (loading || error) return <EstadoCarga loading={loading} error={error} />

  const [serie, pendientes] = data
  const solicitadas = serie.reduce((a, r) => a + Number(r.solicitadas), 0)
  const recibidas   = serie.reduce((a, r) => a + Number(r.recibidas), 0)
  const pctResp     = solicitadas > 0 ? Math.round((recibidas / solicitadas) * 100) : 0
  // La mediana del período no se puede promediar entre meses; se toma la del mes más reciente.
  const ultimo      = serie[serie.length - 1]

  const chart = serie.map(r => ({
    mes: new Intl.DateTimeFormat('es-CO', { month: 'short', year: '2-digit' }).format(new Date(r.mes + '-01')),
    Mediana: Number(r.dias_mediana ?? 0),
    'P90': Number(r.dias_p90 ?? 0),
    Solicitadas: Number(r.solicitadas),
    Recibidas: Number(r.recibidas),
  }))
  const viejos = pendientes.filter(p => p.dias_esperando > 15)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Solicitudes enviadas" value={solicitadas} />
        <StatCard label="Imágenes recibidas"   value={recibidas} valueColor="#1D8A55" />
        <StatCard label="% que respondió"      value={`${pctResp}%`} valueColor={pctResp >= 70 ? '#1D8A55' : pctResp >= 45 ? '#9A5500' : '#C03030'} />
        <StatCard label="Mediana del último mes" value={ultimo ? `${ultimo.dias_mediana ?? '—'} días` : '—'}
          sub={ultimo ? `P90: ${ultimo.dias_p90 ?? '—'} días` : null} />
      </div>

      <div className="bg-[#FFF8EC] border border-[#FFD980] rounded-xl px-4 py-3 text-[12px] text-[#9A5500]">
        Este es el indicador que separa <b>tu retraso del retraso del cliente</b>. La mediana dice cuánto tarda la familia típica; el P90 dice cuánto tardan los rezagados, que son los que atrasan la producción.
      </div>

      {chart.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel titulo="Días de espera por mes" extra="mediana vs P90">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={35} label={{ value: 'días', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip formatter={v => `${v} días`} />
                <Bar dataKey="Mediana" fill="#1D8A55" radius={[4,4,0,0]} />
                <Bar dataKey="P90"     fill="#C4A87A" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel titulo="Solicitadas vs recibidas">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={35} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="Solicitadas" stroke="#0B1D4F" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Recibidas"   stroke="#1D8A55" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}

      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex flex-wrap items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink flex-1">Clientes que todavía no han enviado imágenes</div>
          <span className="text-[11px] font-bold" style={{ color: viejos.length ? '#C03030' : '#1D8A55' }}>
            {pendientes.length} esperando · {viejos.length} llevan más de 15 días
          </span>
        </div>
        {pendientes.length === 0 ? (
          <div className="py-8 text-center text-ink3 text-sm">Nadie pendiente. Al día.</div>
        ) : (
          <TableWrap><Table>
            <thead><tr><Th>Mascota</Th><Th>Propietario</Th><Th>Solicitada</Th><Th>Esperando</Th><Th>Estado servicio</Th><Th>WA</Th></tr></thead>
            <tbody>
              {pendientes.map(p => (
                <Tr key={p.servicio_id}>
                  <Td className="font-semibold text-ink">{p.mascota || '-'}</Td>
                  <Td className="text-ink3">{p.propietario || '-'}</Td>
                  <Td className="text-ink3">{p.fecha_solicitud ? parseDate(p.fecha_solicitud).toLocaleDateString('es-CO') : '-'}</Td>
                  <Td>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.dias_esperando > 15 ? 'bg-danger-light text-danger' : p.dias_esperando > 7 ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-green-light text-primary-dark'}`}>
                      {p.dias_esperando} días
                    </span>
                  </Td>
                  <Td className="text-ink3 text-[11px]">{p.estado_servicio}</Td>
                  <Td>
                    {p.telefono && (
                      <a href={waLink(p.telefono, `Hola, seguimos esperando las imágenes de ${p.mascota} para preparar sus recordatorios.`)}
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

// --- Tab Comercial: servicios por veterinaria y por canal ---
function TabComercial({ desde, hasta }) {
  const [soloActivas, setSoloActivas] = useState(true)
  const { loading, error, data } = useRpc([desde, hasta],
    ['rep_veterinarias', { p_desde: desde, p_hasta: hasta }],
    ['rep_canales', { p_desde: desde, p_hasta: hasta }])
  if (loading || error) return <EstadoCarga loading={loading} error={error} />

  const [vets, canales] = data
  const conServicios = vets.filter(v => Number(v.servicios) > 0)
  const dormidas     = vets.filter(v => v.dias_sin_remitir > 60)
  const lista        = soloActivas ? conServicios : vets
  const totalServ    = canales.reduce((a, c) => a + Number(c.servicios), 0)

  const barData = conServicios.slice(0, 12).map(v => ({
    name: v.aliado.length > 26 ? v.aliado.slice(0, 26) + '…' : v.aliado,
    value: Number(v.servicios),
  }))
  const pieData = canales.map(c => ({ name: c.canal, value: Number(c.servicios) }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Servicios en el período" value={totalServ} />
        <StatCard label="Veterinarias que remitieron" value={conServicios.length} valueColor="#1D8A55" />
        <StatCard label="En el maestro" value={vets.length} sub="con al menos una remisión histórica" />
        <StatCard label="Sin remitir hace +60 días" value={dormidas.length} valueColor={dormidas.length ? '#C03030' : '#1D8A55'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel titulo="Top veterinarias" extra={`${barData.length} de ${conServicios.length}`}>
          <ResponsiveContainer width="100%" height={Math.max(220, barData.length * 30)}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={150} />
              <Tooltip />
              <Bar dataKey="value" fill="#0B1D4F" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Por canal de entrada">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                label={({ name, percent }) => `${name} ${Math.round(percent*100)}%`} fontSize={10}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-serif text-base text-ink flex-1">Detalle por veterinaria</div>
          <button onClick={() => setSoloActivas(s => !s)}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold border transition-colors"
            style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
            {soloActivas ? 'Ver también las que no remitieron' : 'Ver solo las que remitieron'}
          </button>
        </div>
        <TableWrap><Table>
          <thead><tr><Th>Veterinaria</Th><Th>VIP</Th><Th>Servicios</Th><Th>Valor</Th><Th>Última remisión</Th><Th>Sin remitir</Th></tr></thead>
          <tbody>
            {lista.map(v => (
              <Tr key={v.aliado_id}>
                <Td className="font-semibold text-ink">{v.aliado}</Td>
                <Td>{v.vip && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FFF3DC] text-[#9A5500]">VIP</span>}</Td>
                <Td className="font-bold text-ink">{v.servicios}</Td>
                <Td className="text-ink2">{fmt(v.valor_total)}</Td>
                <Td className="text-ink3">{v.ultima_remision ? parseDate(v.ultima_remision).toLocaleDateString('es-CO') : '-'}</Td>
                <Td>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${v.dias_sin_remitir > 60 ? 'bg-danger-light text-danger' : v.dias_sin_remitir > 30 ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-green-light text-primary-dark'}`}>
                    {v.dias_sin_remitir} días
                  </span>
                </Td>
              </Tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-ink3 text-sm">Sin remisiones en este período</td></tr>}
          </tbody>
        </Table></TableWrap>
      </div>
    </div>
  )
}

// --- Tab Cola de producción: dónde está represado el trabajo ---
const CATEGORIAS = [
  { key: 'fisico',    label: 'Físicos',    nota: 'El trabajo real de taller.' },
  { key: 'digital',   label: 'Digitales',  nota: 'Ojo: varios se quedan en PENDIENTE a propósito — no son atraso.' },
  { key: 'ceremonia', label: 'Ceremonia',  nota: null },
]

function TabColaProduccion({ desde, hasta }) {
  const [cat, setCat] = useState('fisico')
  const { loading, error, data } = useRpc([desde, hasta],
    ['rep_cola_produccion', {}],
    ['rep_flujo_produccion', { p_desde: desde, p_hasta: hasta }])
  if (loading || error) return <EstadoCarga loading={loading} error={error} />

  const [cola, flujo] = data
  const dela = cola.filter(c => c.categoria === cat)
  const items   = dela.reduce((a, c) => a + Number(c.items), 0)
  const atrasados = dela.reduce((a, c) => a + Number(c.items_mas_7dias), 0)
  const peor = dela.reduce((a, c) => Math.max(a, c.dias_max || 0), 0)

  const porEstado = ['PENDIENTE','EN_PROCESO','LISTO'].map(e => ({
    name: e.replace('_',' '),
    value: dela.filter(c => c.estado === e).reduce((a, c) => a + Number(c.items), 0),
  })).filter(e => e.value > 0)

  // Top cuellos de botella: la pareja etapa+recordatorio con más atrasados
  const cuellos = [...dela].sort((a, b) => Number(b.items_mas_7dias) - Number(a.items_mas_7dias)).slice(0, 10)

  // Flujo semanal: cuántos ítems salieron a cada estado
  const semanas = {}
  flujo.forEach(f => {
    const k = f.semana
    if (!semanas[k]) semanas[k] = { semana: k }
    semanas[k][f.estado_nuevo] = Number(f.movimientos)
  })
  const flujoData = Object.values(semanas).sort((a,b) => a.semana.localeCompare(b.semana)).slice(-10).map(s => ({
    ...s,
    label: parseDate(s.semana).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
  }))

  const nota = CATEGORIAS.find(c => c.key === cat)?.nota

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        {CATEGORIAS.map(c => {
          const n = cola.filter(x => x.categoria === c.key).reduce((a, x) => a + Number(x.items), 0)
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${cat === c.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}>
              {c.label} <span className="opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {nota && (
        <div className="bg-[#FFF8EC] border border-[#FFD980] rounded-xl px-4 py-3 text-[12px] text-[#9A5500]">{nota}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Ítems en cola" value={items} />
        <StatCard label="Con más de 7 días" value={atrasados} valueColor={atrasados > 0 ? '#C03030' : '#1D8A55'} />
        <StatCard label="% atrasados" value={items > 0 ? `${Math.round(atrasados/items*100)}%` : '—'}
          valueColor={items && atrasados/items > 0.3 ? '#C03030' : '#9A5500'} />
        <StatCard label="El más viejo" value={`${peor} días`} valueColor="#9A5500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel titulo="Dónde está represado" extra="ítems con más de 7 días">
          <ResponsiveContainer width="100%" height={Math.max(220, cuellos.length * 32)}>
            <BarChart data={cuellos.map(c => ({ name: `${c.recordatorio} · ${c.estado.replace('_',' ')}`, value: Number(c.items_mas_7dias) }))}
              layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={190} />
              <Tooltip />
              <Bar dataKey="value" fill="#C03030" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Reparto por etapa">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={porEstado} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={10}>
                {porEstado.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {flujoData.length > 0 && (
        <Panel titulo="Movimientos por semana" extra="cuántos ítems entraron a cada etapa">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={flujoData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="EN_PROCESO" stackId="a" fill="#3B6FBF" />
              <Bar dataKey="LISTO"      stackId="a" fill="#C4A87A" />
              <Bar dataKey="ENTREGADO"  stackId="a" fill="#1D8A55" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}

      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b font-serif text-base text-ink" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>Detalle de la cola</div>
        <TableWrap><Table>
          <thead><tr><Th>Recordatorio</Th><Th>Etapa</Th><Th>Ítems</Th><Th>Días promedio</Th><Th>+7 días</Th><Th>El más viejo</Th></tr></thead>
          <tbody>
            {dela.map((c, i) => (
              <Tr key={i}>
                <Td className="font-semibold text-ink">{c.recordatorio}</Td>
                <Td className="text-ink3 text-[11px]">{c.estado.replace('_',' ')}</Td>
                <Td className="font-bold text-ink">{c.items}</Td>
                <Td className="text-ink2">{c.dias_promedio}</Td>
                <Td className={Number(c.items_mas_7dias) > 0 ? 'text-danger font-semibold' : 'text-ink3'}>{c.items_mas_7dias}</Td>
                <Td className="text-ink3">{c.dias_max} días</Td>
              </Tr>
            ))}
            {dela.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-ink3 text-sm">Sin ítems en cola en esta categoría</td></tr>}
          </tbody>
        </Table></TableWrap>
      </div>
    </div>
  )
}

// --- Tab Tiempos por etapa: cuánto dura un servicio en cada estado ---
const ETAPA_ORDEN = ['INGRESADO','EN_RECOGIDA','EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA']

function TabTiempos({ desde, hasta }) {
  const { loading, error, data } = useRpc([desde, hasta],
    ['rep_tiempos_servicio', { p_desde: desde, p_hasta: hasta }])
  if (loading || error) return <EstadoCarga loading={loading} error={error} />

  const [filas] = data
  const porEtapa = ETAPA_ORDEN.map(e => filas.find(f => f.estado === e)).filter(Boolean)
  const totalMediana = porEtapa.reduce((a, f) => a + Number(f.horas_mediana || 0), 0)

  const chart = porEtapa.map(f => ({
    name: f.estado.replace(/_/g,' '),
    Mediana: Number(f.horas_mediana || 0),
    Promedio: Number(f.horas_promedio || 0),
  }))
  const dias = h => (Number(h) / 24).toFixed(1)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Etapas medidas" value={porEtapa.length} />
        <StatCard label="Ciclo típico (suma de medianas)" value={`${dias(totalMediana)} días`} valueColor="#0B1D4F" />
        <StatCard label="Etapa más lenta"
          value={porEtapa.length ? porEtapa.reduce((a,b) => Number(a.horas_mediana) > Number(b.horas_mediana) ? a : b).estado.replace(/_/g,' ') : '—'}
          valueColor="#C03030" />
        <StatCard label="Servicios en la muestra" value={Math.max(...porEtapa.map(f => Number(f.servicios)), 0)} />
      </div>

      <div className="bg-[#FFF8EC] border border-[#FFD980] rounded-xl px-4 py-3 text-[12px] text-[#9A5500]">
        Reconstruido del registro de cambios de estado, que existe desde el <b>22 de mayo de 2026</b>. La mediana es más fiable que el promedio: un solo servicio olvidado en una etapa dispara el promedio y no dice nada de la operación normal.
      </div>

      <Panel titulo="Horas en cada etapa" extra="mediana vs promedio">
        <ResponsiveContainer width="100%" height={Math.max(260, chart.length * 44)}>
          <BarChart data={chart} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,80,40,0.07)" />
            <XAxis type="number" tick={{ fontSize: 10 }} label={{ value: 'horas', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
            <Tooltip formatter={v => `${v} h (${dias(v)} días)`} />
            <Bar dataKey="Mediana"  fill="#0B1D4F" radius={[0,4,4,0]} />
            <Bar dataKey="Promedio" fill="#C4A87A" radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <TableWrap><Table>
        <thead><tr><Th>Etapa</Th><Th>Servicios</Th><Th>Mediana</Th><Th>Promedio</Th><Th>P90</Th><Th>Mediana en días</Th></tr></thead>
        <tbody>
          {porEtapa.map(f => (
            <Tr key={f.estado}>
              <Td className="font-semibold text-ink">{f.estado.replace(/_/g,' ')}</Td>
              <Td className="text-ink2">{f.servicios}</Td>
              <Td className="font-bold text-ink">{f.horas_mediana} h</Td>
              <Td className="text-ink3">{f.horas_promedio} h</Td>
              <Td className="text-ink3">{f.horas_p90} h</Td>
              <Td className="text-ink2">{dias(f.horas_mediana)}</Td>
            </Tr>
          ))}
          {porEtapa.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-ink3 text-sm">Sin datos en este período</td></tr>}
        </tbody>
      </Table></TableWrap>
    </div>
  )
}

export default function Reportes() {
  const [rango, setRango] = useState('mes')

  const [libre, setLibre] = useState({ desde: null, hasta: null })
  const { desde, hasta } = getRango(rango, libre)

  return (
    <div>
      <Topbar />
      <div className="p-7">
        <FiltroFecha rango={rango} setRango={setRango} libre={libre} setLibre={setLibre} />
        <Tabs defaultValue="imagenes">
          <TabsList className="mb-6">
            <TabsTrigger value="imagenes">Imágenes del cliente</TabsTrigger>
            <TabsTrigger value="cola">Cola de producción</TabsTrigger>
            <TabsTrigger value="tiempos">Tiempos por etapa</TabsTrigger>
            <TabsTrigger value="comercial">Comercial</TabsTrigger>
            <TabsTrigger value="contabilidad">Contabilidad</TabsTrigger>
            <TabsTrigger value="servicios">Servicios</TabsTrigger>
            <TabsTrigger value="ventas">Ventas por usuario</TabsTrigger>
            <TabsTrigger value="tiempo">Tiempo promesa</TabsTrigger>
            <TabsTrigger value="comisiones">Comisiones</TabsTrigger>
            <TabsTrigger value="produccion">Producción</TabsTrigger>
          </TabsList>
          <TabsContent value="imagenes"><TabImagenes desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="cola"><TabColaProduccion desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="tiempos"><TabTiempos desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="comercial"><TabComercial desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="contabilidad"><TabContabilidad desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="servicios"><TabServicios desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="ventas"><TabVentasUsuario desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="tiempo"><TabTiempoPromesa desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="comisiones"><TabComisiones desde={desde} hasta={hasta} /></TabsContent>
          <TabsContent value="produccion"><TabProduccion rango={rango} /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
