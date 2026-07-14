import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { EstadoBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, fmt, parseDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { AlertTriangle, TrendingUp, TrendingDown, PlusCircle, Activity, Snowflake, Package, Truck, Layers, Camera, Star, Calendar, DollarSign, BadgePercent, Clock } from 'lucide-react'

// ── constantes compartidas ────────────────────────────────────────────────────
const ESTADOS_TODOS    = ['INGRESADO','EN_RECOGIDA','EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA']
const ESTADOS_PROD         = ['EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA','ENTREGADO']
const ESTADOS_ACTIVOS_PROD = ['EN_CUARTO_FRIO','EN_PROCESO','EN_PRODUCCION','LISTO','EN_ENTREGA']

const ESTADO_META_TODOS = {
  INGRESADO:      { label: 'Ingresado',      color: '#3B82F6' },
  EN_RECOGIDA:    { label: 'En recogida',    color: '#F59E0B' },
  EN_CUARTO_FRIO: { label: 'Cuarto frío',    color: '#06B6D4' },
  EN_PROCESO:     { label: 'En proceso',     color: '#8B5CF6' },
  EN_PRODUCCION:  { label: 'En producción',  color: '#F97316' },
  LISTO:          { label: 'Listo',          color: '#10B981' },
  EN_ENTREGA:     { label: 'En entrega',     color: '#6366F1' },
}
const ESTADO_META_PROD = {
  EN_CUARTO_FRIO: { label: 'Pendiente',     color: '#06B6D4' },
  EN_PROCESO:     { label: 'En proceso',    color: '#8B5CF6' },
  EN_PRODUCCION:  { label: 'En producción', color: '#F97316' },
  LISTO:          { label: 'Listo',         color: '#10B981' },
  EN_ENTREGA:     { label: 'En entrega',    color: '#6366F1' },
  ENTREGADO:      { label: 'Entregados',    color: '#6B7280' },
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { personalData } = useAuth()
  const esProductor = personalData?.rol === 'PRODUCTOR'

  const [servicios, setServicios] = useState([])
  const [alertas,   setAlertas]   = useState([])
  const [npsPromedio, setNpsPromedio] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    cargar()
    const canal = db
      .channel('dashboard-servicios-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, () => { cargar() })
      .subscribe()
    return () => { db.removeChannel(canal) }
  }, [esProductor])

  async function cargar() {
    try {
      setLoading(true)
      const hoy = new Date()
      const primerMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`

      let kanbanQ = db.from('v_kanban').select('*').gte('fecha_ingreso', FECHA_CORTE).order('fecha_ingreso', { ascending: false })
      let alertasQ = db.from('v_alertas').select('*')
        .in('nivel_alerta', ['VENCIDO','HOY','URGENTE'])
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('dias_para_vencer', { ascending: true })
      const npsQ = db.from('nps_seguimiento')
        .select('nps')
        .not('nps', 'is', null)
        .gte('fecha_realizada', primerMes)

      if (esProductor) {
        kanbanQ  = kanbanQ.in('estado', ESTADOS_PROD)
        alertasQ = alertasQ.in('estado', ESTADOS_ACTIVOS_PROD)
      }

      const [{ data: kanban }, { data: alts }, { data: nps }] = await Promise.all([kanbanQ, alertasQ, npsQ])
      setServicios(kanban || [])
      setAlertas(alts || [])
      if (nps?.length > 0) {
        setNpsPromedio((nps.reduce((a, n) => a + n.nps, 0) / nps.length).toFixed(1))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" />
      <span className="text-sm font-medium">Cargando dashboard…</span>
    </div>
  )
  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm font-medium">
        Error al cargar: {error}
      </div>
    </div>
  )

  return esProductor
    ? <DashboardProductor servicios={servicios} alertas={alertas} navigate={navigate} />
    : <DashboardGeneral   servicios={servicios} alertas={alertas} npsPromedio={npsPromedio} navigate={navigate} />
}

// ─── Tendencia numérica ───────────────────────────────────────────────────────
function Tendencia({ pct }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? '+' : ''}{pct}%
    </span>
  )
}

// ─── Dashboard general (coordinador / admin) ──────────────────────────────────
function DashboardGeneral({ servicios, alertas, npsPromedio, navigate }) {
  const activos      = servicios.filter(s => ESTADOS_TODOS.includes(s.estado))
  const enProduccion = servicios.filter(s => ['EN_PROCESO','EN_PRODUCCION'].includes(s.estado))
  const listos       = servicios.filter(s => s.estado === 'LISTO')
  const entregados   = servicios.filter(s => s.estado === 'ENTREGADO')
  const enCuartoFrio = servicios.filter(s => s.estado === 'EN_CUARTO_FRIO')
  const recientes    = servicios.slice(0, 10)
  const totalActivos = activos.length || 1

  // Finanzas del mes actual vs mes anterior
  const hoy      = new Date()
  const mesActual  = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`
  const dMesAnt    = new Date(hoy.getFullYear(), hoy.getMonth()-1, 1)
  const mesAnterior= `${dMesAnt.getFullYear()}-${String(dMesAnt.getMonth()+1).padStart(2,'0')}`

  const svsEstesMes = servicios.filter(s => s.fecha_ingreso?.startsWith(mesActual))
  const svsMesAnt   = servicios.filter(s => s.fecha_ingreso?.startsWith(mesAnterior))

  const ingresosMes    = svsEstesMes.reduce((a, s) => a + (s.valor_total     || 0), 0)
  const ingresosMesAnt = svsMesAnt.reduce((a, s)   => a + (s.valor_total     || 0), 0)
  const cobradoMes     = svsEstesMes.reduce((a, s) => a + (s.valor_pagado    || 0), 0)
  const porCobrarMes   = svsEstesMes.reduce((a, s) => a + (s.saldo_pendiente || 0), 0)
  const svsMesAntCount = svsMesAnt.length

  const pctSvs  = svsMesAntCount > 0 ? Math.round((svsEstesMes.length - svsMesAntCount) / svsMesAntCount * 100) : null
  const pctIngr = ingresosMesAnt  > 0 ? Math.round((ingresosMes - ingresosMesAnt) / ingresosMesAnt * 100) : null
  const pctCobr = ingresosMes     > 0 ? Math.round(cobradoMes / ingresosMes * 100) : 0

  const mesLabel = new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(hoy)

  return (
    <div className="flex flex-col flex-1">
      <Topbar actions={
        <Button size="sm" onClick={() => navigate('/registro')}>
          <PlusCircle size={13} /> Nuevo servicio
        </Button>
      } />
      <div className="flex-1 p-6 space-y-6">

        {/* Banner finanzas del mes */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <Activity size={12} />Servicios {mesLabel}
            </div>
            <div className="text-3xl font-bold text-gray-900">{svsEstesMes.length}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <Tendencia pct={pctSvs} />
              <span>vs {new Intl.DateTimeFormat('es-CO',{month:'short'}).format(dMesAnt)}</span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <DollarSign size={12} />Ingresos {mesLabel}
            </div>
            <div className="text-2xl font-bold text-gray-900 leading-tight">{fmt(ingresosMes)}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <Tendencia pct={pctIngr} />
              <span>{fmt(ingresosMesAnt)} mes ant.</span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <BadgePercent size={12} />Cobrado {mesLabel}
            </div>
            <div className="text-3xl font-bold text-gray-900">{pctCobr}%</div>
            <div className="text-[11px] text-red-500 font-semibold">
              {porCobrarMes > 0 ? `${fmt(porCobrarMes)} por cobrar` : 'Sin saldos pendientes'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <Star size={12} />NPS {mesLabel}
            </div>
            <div className="text-3xl font-bold" style={{ color: npsPromedio >= 4 ? '#10B981' : npsPromedio >= 3 ? '#F59E0B' : '#EF4444' }}>
              {npsPromedio ? `${npsPromedio}/5` : '—'}
            </div>
            <div className="text-[11px] text-gray-400">Promedio del mes</div>
          </div>
        </div>

        {/* KPIs operacionales */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Activos"       value={activos.length}      sub="En curso"          icon={Activity} />
          <StatCard label="En producción" value={enProduccion.length} sub="Proceso activo"    valueColor="#F97316" icon={Package} />
          <StatCard label="Listos"        value={listos.length}       sub="Para entregar"     valueColor="#10B981" icon={TrendingUp} />
          <StatCard label="Alertas"       value={alertas.length}      sub="Requieren atención" valueColor={alertas.length > 0 ? '#DC2626' : '#9CA3AF'} icon={AlertTriangle} />
          <StatCard label="Entregados"    value={entregados.length}   sub="Completados"       valueColor="#6366F1" icon={Truck} />
          <StatCard label="Cuarto frío"   value={enCuartoFrio.length} sub="En refrigeración"  valueColor="#06B6D4" icon={Snowflake} />
        </div>

        {/* Middle row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <AlertasCard alertas={alertas} navigate={navigate} destino="/kanban" />

          {/* Estado del tablero */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <TrendingUp size={15} className="text-[#1A5CD8] flex-shrink-0" />
              <span className="text-[14px] font-semibold text-gray-900">Estado del tablero</span>
            </div>
            <div className="flex-1 p-5 space-y-3">
              {ESTADOS_TODOS.map(estado => {
                const count = servicios.filter(s => s.estado === estado).length
                const pct   = Math.round((count / totalActivos) * 100)
                const meta  = ESTADO_META_TODOS[estado]
                return (
                  <div key={estado} className="flex items-center gap-3">
                    <span className="text-[12px] font-medium text-gray-600 w-28 flex-shrink-0 truncate">{meta.label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                    </div>
                    <span className="text-[12px] font-bold text-gray-700 w-5 text-right tabular-nums">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Acceso rápido */}
          <AccesoRapidoCard items={[
            { label: 'Tablero',    path: '/kanban',      emoji: '📋' },
            { label: 'Cuarto frío',path: '/cuarto-frio', emoji: '❄️' },
            { label: 'Planta',     path: '/tenjo',       emoji: '🌿' },
            { label: 'Producción', path: '/produccion',  emoji: '⚙️' },
            { label: 'Imágenes',   path: '/imagenes',    emoji: '📷' },
            { label: 'Reportes',   path: '/reportes',    emoji: '📊' },
          ]} navigate={navigate} />
        </div>

        <TablaRecientes servicios={recientes} navigate={navigate} destino="/kanban" />
      </div>
    </div>
  )
}

// ─── Dashboard productor ──────────────────────────────────────────────────────
function DashboardProductor({ servicios, alertas, navigate }) {
  const pendientes   = servicios.filter(s => s.estado === 'EN_CUARTO_FRIO')
  const enProceso    = servicios.filter(s => s.estado === 'EN_PROCESO')
  const enProduccion = servicios.filter(s => s.estado === 'EN_PRODUCCION')
  const listos       = servicios.filter(s => s.estado === 'LISTO')
  const enEntrega    = servicios.filter(s => s.estado === 'EN_ENTREGA')
  const activosProd  = servicios.filter(s => ESTADOS_ACTIVOS_PROD.includes(s.estado))
  const recientes    = activosProd.slice(0, 10)
  const totalActivos = activosProd.length || 1

  return (
    <div className="flex flex-col flex-1">
      <Topbar />
      <div className="flex-1 p-6 space-y-6">

        {/* KPIs producción */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Pendientes"    value={pendientes.length}   sub="Sin gestión aún"     valueColor="#06B6D4" icon={Snowflake} />
          <StatCard label="En proceso"    value={enProceso.length}    sub="Esperando producción" valueColor="#8B5CF6" icon={Activity} />
          <StatCard label="En producción" value={enProduccion.length} sub="Fabricando ahora"    valueColor="#F97316" icon={Layers} />
          <StatCard label="Listos"        value={listos.length}       sub="Para despachar"      valueColor="#10B981" icon={TrendingUp} />
          <StatCard label="En entrega"    value={enEntrega.length}    sub="Con mensajero"       valueColor="#6366F1" icon={Truck} />
          <StatCard label="Alertas"       value={alertas.length}      sub="Con fecha límite"    valueColor={alertas.length > 0 ? '#DC2626' : '#9CA3AF'} icon={AlertTriangle} />
        </div>

        {/* Middle row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <AlertasCard alertas={alertas} navigate={navigate} destino="/kanban" />

          {/* Estado de producción */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <Layers size={15} className="text-[#F97316] flex-shrink-0" />
              <span className="text-[14px] font-semibold text-gray-900">Estado de producción</span>
            </div>
            <div className="flex-1 p-5 space-y-3">
              {Object.entries(ESTADO_META_PROD).map(([estado, meta]) => {
                const count = servicios.filter(s => s.estado === estado).length
                const pct   = Math.round((count / totalActivos) * 100)
                return (
                  <div key={estado} className="flex items-center gap-3">
                    <span className="text-[12px] font-medium text-gray-600 w-28 flex-shrink-0 truncate">{meta.label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                    </div>
                    <span className="text-[12px] font-bold text-gray-700 w-5 text-right tabular-nums">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Acceso rápido productor */}
          <AccesoRapidoCard items={[
            { label: 'Tablero',    path: '/kanban',     emoji: '📋' },
            { label: 'Producción', path: '/produccion', emoji: '⚙️' },
            { label: 'Imágenes',   path: '/imagenes',   emoji: '📷' },
            { label: 'Calendario', path: '/calendario', emoji: '📅' },
            { label: 'NPS',        path: '/nps',        emoji: '⭐' },
          ]} navigate={navigate} />
        </div>

        <TablaRecientes servicios={recientes} navigate={navigate} destino="/kanban" />
      </div>
    </div>
  )
}

// ─── Componentes compartidos ──────────────────────────────────────────────────
function AlertasCard({ alertas, navigate, destino }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
        <span className="text-[14px] font-semibold text-gray-900">Alertas urgentes</span>
        {alertas.length > 0 && (
          <span className="ml-auto bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-red-200">
            {alertas.length}
          </span>
        )}
      </div>
      <div className="flex-1 p-4">
        {alertas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2">
              <TrendingUp size={18} className="text-green-500" />
            </div>
            <span className="text-[13px] font-medium">Sin alertas críticas</span>
          </div>
        ) : (
          <div className="space-y-1">
            {alertas.slice(0, 7).map((a, i) => (
              <button key={i}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left"
                onClick={() => navigate(destino)}>
                <span className="text-lg leading-none">{petEmoji(a.especie)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">{a.mascota}</div>
                  <div className="text-[11px] text-gray-400 truncate">{a.cliente}</div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                  a.nivel_alerta === 'VENCIDO' ? 'bg-red-100 text-red-700 border-red-200'
                  : a.nivel_alerta === 'HOY'   ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-blue-100 text-blue-700 border-blue-200'
                }`}>
                  {a.dias_para_vencer < 0 ? `${Math.abs(a.dias_para_vencer)}d vencido`
                    : a.dias_para_vencer === 0 ? 'Hoy' : `${a.dias_para_vencer}d`}
                </span>
              </button>
            ))}
            {alertas.length > 7 && (
              <button className="w-full text-center text-[12px] text-gray-400 hover:text-[#1A5CD8] py-2 transition-colors"
                onClick={() => navigate(destino)}>
                Ver {alertas.length - 7} más →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AccesoRapidoCard({ items, navigate }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <span className="text-[14px] font-semibold text-gray-900">Acceso rápido</span>
      </div>
      <div className="flex-1 p-4 grid grid-cols-3 gap-2 content-start">
        {items.map(item => (
          <button key={item.path}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-gray-50 transition-all border border-gray-100 hover:border-gray-200 hover:shadow-sm"
            onClick={() => navigate(item.path)}>
            <span className="text-xl leading-none">{item.emoji}</span>
            <span className="text-[11px] font-semibold text-gray-600 text-center leading-tight">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TablaRecientes({ servicios, navigate, destino }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="text-[14px] font-semibold text-gray-900">Actividad reciente</span>
        <button className="text-[12px] text-gray-400 hover:text-[#1A5CD8] font-medium transition-colors"
          onClick={() => navigate(destino)}>
          Ver todo →
        </button>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Mascota</Th>
              <Th>Cliente</Th>
              <Th>Plan</Th>
              <Th>Estado</Th>
              <Th>Ingreso</Th>
              <Th>Límite entrega</Th>
            </tr>
          </thead>
          <tbody>
            {servicios.map(s => (
              <Tr key={s.servicio_id} onClick={() => navigate(destino)}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{petEmoji(s.especie)}</span>
                    <span className="font-semibold text-gray-900">{s.mascota}</span>
                  </div>
                </Td>
                <Td className="text-gray-600">{s.cliente}</Td>
                <Td className="text-gray-400 font-medium">{s.plan}</Td>
                <Td><EstadoBadge estado={s.estado} /></Td>
                <Td className="text-gray-500 tabular-nums">
                  {s.fecha_ingreso ? parseDate(s.fecha_ingreso).toLocaleDateString('es-CO') : '—'}
                </Td>
                <Td>
                  {s.fecha_limite_entrega ? (
                    <span className={`font-medium tabular-nums ${s.dias_para_vencer < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {parseDate(s.fecha_limite_entrega).toLocaleDateString('es-CO')}
                    </span>
                  ) : '—'}
                </Td>
              </Tr>
            ))}
            {servicios.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">Sin actividad reciente</td>
              </tr>
            )}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  )
}
