import { useState, useEffect, useMemo } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { db } from '@/lib/supabase'
import { fmt, parsearErrorDB } from '@/lib/utils'
import {
  DollarSign, TrendingUp, AlertCircle, Check, X,
  RefreshCw, ChevronDown, ChevronUp, CreditCard,
  Banknote, Building2, Receipt, User2,
} from 'lucide-react'

// ── Helpers de badge ─────────────────────────────────────────────────────────

function BadgeEstadoPago({ estado }) {
  const MAP = {
    PENDIENTE: 'bg-[#FFF3DC] text-[#9A5500]',
    PARCIAL:   'bg-[#EFF6FF] text-[#1E40AF]',
    COMPLETO:  'bg-[#F0FDF4] text-[#166534]',
    CORTESIA:  'bg-[#F0F7EC] text-[#1A5CD8]',
  }
  const cls = MAP[estado] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {estado}
    </span>
  )
}

function BadgeCanal({ canal }) {
  const cls = canal === 'ALIADO'
    ? 'bg-[#EEF2FF] text-[#3730A3]'
    : 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {canal}
    </span>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function Finanzas() {
  const { confirm, alert: showAlert } = useConfirm()
  // ── State principal ─────────────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(true)
  const [servicios, setServicios] = useState([])   // array enriquecido
  const [tab,       setTab]       = useState('cartera') // 'cartera' | 'comisiones' | 'historial'

  // ── State filtro cartera ────────────────────────────────────────────────────
  const [filtroCartera, setFiltroCartera] = useState('TODOS') // TODOS | PENDIENTE | PARCIAL
  const [filtroAliado,  setFiltroAliado]  = useState(null)    // null | aliado_origen_id

  // ── State modal pago ────────────────────────────────────────────────────────
  const [pagoModal,    setPagoModal]    = useState(null)   // null | servicio
  const [valorAbono,   setValorAbono]   = useState('')
  const [metodoPago,   setMetodoPago]   = useState('EFECTIVO')
  const [pagoNotas,    setPagoNotas]    = useState('')
  const [pagoSaving,   setPagoSaving]   = useState(false)
  const [pagoError,    setPagoError]    = useState('')

  // ── State comisiones ────────────────────────────────────────────────────────
  const [liquidandoAliado,  setLiquidandoAliado]  = useState(null)  // null | aliado_id
  const [expandedAliados,   setExpandedAliados]   = useState(new Set())

  // ── Carga de datos ──────────────────────────────────────────────────────────
  async function cargar() {
    setLoading(true)
    try {
      // 1. Servicios activos (sin cancelados)
      const { data: svcs, error: errSvcs } = await db
        .from('servicios')
        .select('id, fecha_ingreso, valor_total, valor_pagado, estado_pago, metodo_pago, canal_entrada, estado, comision_aliado, comision_descontada, mascota_id, aliado_origen_id, plan_id, notas, tecnico_id')
        .not('estado', 'eq', 'CANCELADO')
        .order('fecha_ingreso', { ascending: false })

      if (errSvcs) throw errSvcs

      const rows = svcs || []

      // 2. Mascotas
      const mascotaIds = [...new Set(rows.map(s => s.mascota_id).filter(Boolean))]
      let mascotaMap = {}
      if (mascotaIds.length) {
        const { data: mascotas } = await db
          .from('mascotas')
          .select('id_mascota, nombre, cliente_id')
          .in('id_mascota', mascotaIds)
        if (mascotas) {
          mascotaMap = Object.fromEntries(mascotas.map(m => [m.id_mascota, m]))
        }
      }

      // 3. Clientes
      const clienteIds = [...new Set(
        Object.values(mascotaMap).map(m => m.cliente_id).filter(Boolean)
      )]
      let clienteMap = {}
      if (clienteIds.length) {
        const { data: clientes } = await db
          .from('clientes')
          .select('id_cliente, nombre, apellido, whatsapp')
          .in('id_cliente', clienteIds)
        if (clientes) {
          clienteMap = Object.fromEntries(clientes.map(c => [c.id_cliente, c]))
        }
      }

      // 4. Aliados
      const aliadoIds = [...new Set(rows.map(s => s.aliado_origen_id).filter(Boolean))]
      let aliadoMap = {}
      if (aliadoIds.length) {
        const { data: aliados } = await db
          .from('aliados')
          .select('id_aliado, nombre, modalidad_comision, saldo_comision')
          .in('id_aliado', aliadoIds)
        if (aliados) {
          aliadoMap = Object.fromEntries(aliados.map(a => [a.id_aliado, a]))
        }
      }

      // 5. Planes
      const planIds = [...new Set(rows.map(s => s.plan_id).filter(Boolean))]
      let planMap = {}
      if (planIds.length) {
        const { data: planes } = await db
          .from('planes')
          .select('id, nombre, codigo')
          .in('id', planIds)
        if (planes) {
          planMap = Object.fromEntries(planes.map(p => [p.id, p]))
        }
      }

      // 6. Personal (técnicos)
      const tecnicoIds = [...new Set(rows.map(s => s.tecnico_id).filter(Boolean))]
      let tecnicoMap = {}
      if (tecnicoIds.length) {
        const { data: personal } = await db
          .from('personal')
          .select('id, nombre, apellido')
          .in('id', tecnicoIds)
        if (personal) {
          tecnicoMap = Object.fromEntries(personal.map(p => [p.id, p]))
        }
      }

      // 7. Recibos del técnico (últimos por servicio)
      const svcIds = rows.map(s => s.id)
      let reciboMap = {}
      if (svcIds.length) {
        const { data: recibos } = await db
          .from('recibos_tecnico')
          .select('id, servicio_id, tipo, fecha_emision, hora_emision, valor_cobrado, medios_pago, numero_recibo')
          .in('servicio_id', svcIds)
          .eq('tipo', 'CLIENTE')
          .order('created_at', { ascending: false })
        ;(recibos || []).forEach(r => {
          if (!reciboMap[r.servicio_id]) reciboMap[r.servicio_id] = r
        })
      }

      // 8. Enriquecer + calcular saldo
      const enriched = rows.map(s => {
        const mascota = mascotaMap[s.mascota_id] || null
        const cliente = mascota ? (clienteMap[mascota.cliente_id] || null) : null
        const aliado  = s.aliado_origen_id ? (aliadoMap[s.aliado_origen_id] || null) : null
        const plan    = s.plan_id ? (planMap[s.plan_id] || null) : null
        const tecnico = s.tecnico_id ? (tecnicoMap[s.tecnico_id] || null) : null
        const recibo  = reciboMap[s.id] || null
        const saldo   = Math.max(0, (s.valor_total || 0) - (s.valor_pagado || 0))
        return { ...s, mascota, cliente, aliado, plan, tecnico, recibo, saldo }
      })

      setServicios(enriched)
    } catch (err) {
      console.error('[Finanzas] Error cargando datos:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // ── Computed ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalFacturado   = servicios.reduce((a, s) => a + (s.valor_total  || 0), 0)
    const totalRecaudado   = servicios.reduce((a, s) => a + (s.valor_pagado || 0), 0)
    const porCobrar        = servicios.reduce((a, s) => a + s.saldo, 0)
    const comisionesAliado = servicios
      .filter(s => s.canal_entrada === 'ALIADO' && !s.comision_descontada && (s.comision_aliado || 0) > 0)
      .reduce((a, s) => a + (s.comision_aliado || 0), 0)
    return { totalFacturado, totalRecaudado, porCobrar, comisionesAliado }
  }, [servicios])

  const carteraSvcs = useMemo(() => {
    return servicios.filter(s =>
      s.saldo > 0 &&
      s.estado_pago !== 'COMPLETO' &&
      s.estado_pago !== 'CORTESIA'
    )
  }, [servicios])

  // Saldos pendientes agrupados por aliado (solo canal ALIADO con saldo > 0)
  const saldosPorAliado = useMemo(() => {
    const mapa = {}
    carteraSvcs
      .filter(s => s.canal_entrada === 'ALIADO' && s.aliado_origen_id)
      .forEach(s => {
        const id = s.aliado_origen_id
        if (!mapa[id]) mapa[id] = { id, nombre: s.aliado?.nombre || 'Aliado', saldo: 0, count: 0 }
        mapa[id].saldo += s.saldo
        mapa[id].count += 1
      })
    return Object.values(mapa).sort((a, b) => b.saldo - a.saldo)
  }, [carteraSvcs])

  const carteraFiltrada = useMemo(() => {
    let base = filtroCartera === 'TODOS' ? carteraSvcs : carteraSvcs.filter(s => s.estado_pago === filtroCartera)
    if (filtroAliado) base = base.filter(s => s.aliado_origen_id === filtroAliado)
    return base
  }, [carteraSvcs, filtroCartera, filtroAliado])

  const comisionesPorAliado = useMemo(() => {
    const svcAliados = servicios.filter(
      s => s.canal_entrada === 'ALIADO' && (s.comision_aliado || 0) > 0 && s.aliado
    )
    const mapa = {}
    for (const s of svcAliados) {
      const aId = s.aliado_origen_id
      if (!mapa[aId]) {
        mapa[aId] = { aliado: s.aliado, servicios: [] }
      }
      mapa[aId].servicios.push(s)
    }
    return Object.values(mapa)
  }, [servicios])

  // ── Toggle comision_descontada individual (optimistic) ─────────────────────
  async function toggleComisionDescontada(svcId, nuevoValor) {
    // Optimistic update
    setServicios(prev =>
      prev.map(s => s.id === svcId ? { ...s, comision_descontada: nuevoValor } : s)
    )
    const { error } = await db
      .from('servicios')
      .update({ comision_descontada: nuevoValor })
      .eq('id', svcId)
    if (error) {
      console.error('[Finanzas] Error toggling comision_descontada:', error)
      // Revertir
      setServicios(prev =>
        prev.map(s => s.id === svcId ? { ...s, comision_descontada: !nuevoValor } : s)
      )
    }
  }

  // ── Liquidar comisiones de un aliado ────────────────────────────────────────
  async function liquidarAliado(aliadoId) {
    const grupo = comisionesPorAliado.find(g => g.aliado.id_aliado === aliadoId)
    if (!grupo) return
    const pendientes = grupo.servicios.filter(s => !s.comision_descontada)
    if (!pendientes.length) {
      await showAlert('No hay comisiones pendientes para este aliado.', { title: 'Aviso', variant: 'warning' })
      return
    }
    if (!await confirm(`¿Liquidar ${pendientes.length} comisión(es) pendiente(s) de ${grupo.aliado.nombre}?`, { title: 'Liquidar comisiones', variant: 'warning', confirmLabel: 'Liquidar' })) return

    setLiquidandoAliado(aliadoId)
    try {
      // 1. Marcar como descontadas en servicios
      const { error: e1 } = await db
        .from('servicios')
        .update({ comision_descontada: true })
        .in('id', pendientes.map(s => s.id))
      if (e1) throw e1

      // 2. Crear registro en comisiones_aliados
      const totalPendiente = pendientes.reduce((a, s) => a + (s.comision_aliado || 0), 0)
      const modalidad = grupo.aliado.modalidad_comision
      const estadoComision =
        modalidad === 'CREDITO_ACUMULADO'    ? 'ACUMULADA'  :
        modalidad === 'FACTURACION_MENSUAL'  ? 'FACTURADA'  : 'PAGADA'

      const { error: e2 } = await db
        .from('comisiones_aliados')
        .insert({
          aliado_id:        aliadoId,
          valor_comision:   totalPendiente,
          modalidad_pago:   modalidad,
          estado:           estadoComision,
          fecha_generacion: new Date().toISOString().split('T')[0],
          notas:            `Liquidación de ${pendientes.length} servicio${pendientes.length !== 1 ? 's' : ''}`,
        })
      if (e2) throw e2

      await cargar()
    } catch (err) {
      console.error('[Finanzas] Error liquidando aliado:', err)
      await showAlert(parsearErrorDB(err), { title: 'Error al liquidar' })
    } finally {
      setLiquidandoAliado(null)
    }
  }

  // ── Modal pago — abrir ──────────────────────────────────────────────────────
  function abrirPagoModal(svc) {
    setPagoModal(svc)
    setValorAbono(String(svc.saldo))
    setMetodoPago(svc.metodo_pago || 'EFECTIVO')
    setPagoNotas('')
    setPagoError('')
  }

  function cerrarPagoModal() {
    setPagoModal(null)
    setValorAbono('')
    setMetodoPago('EFECTIVO')
    setPagoNotas('')
    setPagoError('')
    setPagoSaving(false)
  }

  // ── Modal pago — guardar ────────────────────────────────────────────────────
  async function guardarPago() {
    const abono = parseFloat(valorAbono)
    if (!abono || abono <= 0) {
      setPagoError('El abono debe ser mayor a $0.')
      return
    }
    if (abono > pagoModal.saldo) {
      setPagoError(`El abono no puede superar el saldo de ${fmt(pagoModal.saldo)}.`)
      return
    }
    setPagoSaving(true)
    setPagoError('')
    try {
      const nuevo_pagado = (pagoModal.valor_pagado || 0) + abono
      const nuevo_estado = nuevo_pagado >= (pagoModal.valor_total || 0) ? 'COMPLETO' : 'PARCIAL'
      const { error } = await db
        .from('servicios')
        .update({
          valor_pagado: nuevo_pagado,
          estado_pago:  nuevo_estado,
          metodo_pago:  metodoPago,
          ...(pagoNotas.trim() ? { notas: pagoNotas.trim() } : {}),
        })
        .eq('id', pagoModal.id)
      if (error) throw error
      cerrarPagoModal()
      await cargar()
    } catch (err) {
      setPagoError('Error al registrar el pago: ' + (err.message || err))
    } finally {
      setPagoSaving(false)
    }
  }

  // ── Helpers de render ───────────────────────────────────────────────────────
  function nombreMascota(s) {
    return s.mascota?.nombre || '—'
  }
  function nombreCliente(s) {
    if (!s.cliente) return '—'
    return `${s.cliente.nombre || ''} ${s.cliente.apellido || ''}`.trim() || '—'
  }
  function nombrePlan(s) {
    return s.plan?.nombre || '—'
  }
  function fmtFecha(f) {
    if (!f) return '—'
    return new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  function toggleExpand(aliadoId) {
    setExpandedAliados(prev => {
      const next = new Set(prev)
      if (next.has(aliadoId)) next.delete(aliadoId)
      else next.add(aliadoId)
      return next
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full" style={{ background: '#F8F9FA' }}>
      <Topbar actions={
        <button
          onClick={cargar}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border border-[rgba(30,80,40,0.15)] text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors"
        >
          <RefreshCw size={13} /> Actualizar
        </button>
      } />

      <div className="p-5 space-y-5 flex-1">

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-gray-400">
            <div className="spinner" />
            <span className="text-sm font-medium">Cargando datos financieros…</span>
          </div>
        ) : (
          <>
            {/* ── KPIs ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<DollarSign size={18} className="text-[#1A5CD8]" />}
                label="Total facturado"
                value={fmt(kpis.totalFacturado)}
                sub={`${servicios.length} servicio${servicios.length !== 1 ? 's' : ''}`}
                color="#1A5CD8"
              />
              <KpiCard
                icon={<TrendingUp size={18} className="text-[#16a34a]" />}
                label="Recaudado"
                value={fmt(kpis.totalRecaudado)}
                sub={kpis.totalFacturado > 0
                  ? `${Math.round((kpis.totalRecaudado / kpis.totalFacturado) * 100)}% del total`
                  : '—'}
                color="#16a34a"
              />
              <KpiCard
                icon={<AlertCircle size={18} className="text-[#DC2626]" />}
                label="Por cobrar"
                value={fmt(kpis.porCobrar)}
                sub={`${carteraSvcs.length} saldo${carteraSvcs.length !== 1 ? 's' : ''} pendiente${carteraSvcs.length !== 1 ? 's' : ''}`}
                color="#DC2626"
              />
              <KpiCard
                icon={<Receipt size={18} className="text-[#d97706]" />}
                label="Comisiones aliados"
                value={fmt(kpis.comisionesAliado)}
                sub="Pendientes de descontar"
                color="#d97706"
              />
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>

              {/* Tab header */}
              <div className="flex border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                {[
                  { key: 'cartera',     label: 'Cartera' },
                  { key: 'comisiones',  label: 'Comisiones' },
                  { key: 'historial',   label: 'Historial' },
                  { key: 'tecnicos',    label: 'Cuadre técnicos' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-5 py-3 text-[13px] font-semibold transition-colors border-b-2 ${
                      tab === t.key
                        ? 'border-[#1A5CD8] text-[#1A5CD8]'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t.label}
                    {t.key === 'cartera' && carteraSvcs.length > 0 && (
                      <span className="ml-1.5 text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                        {carteraSvcs.length}
                      </span>
                    )}
                    {t.key === 'comisiones' && kpis.comisionesAliado > 0 && (
                      <span className="ml-1.5 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        {comisionesPorAliado.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Tab: Cartera ─────────────────────────────────────── */}
              {tab === 'cartera' && (
                <div className="p-5 space-y-4">

                  {/* ── Tarjetas de saldo por veterinaria ─────────────── */}
                  {saldosPorAliado.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                        Saldo pendiente por veterinaria
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {/* Tarjeta "Todas" */}
                        <button
                          onClick={() => setFiltroAliado(null)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-all ${
                            !filtroAliado
                              ? 'bg-[#1A5CD8] text-white border-[#1A5CD8]'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-[#1A5CD8] hover:text-[#1A5CD8]'
                          }`}
                        >
                          <Building2 size={13} />
                          Todas las vets
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${!filtroAliado ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            {carteraSvcs.filter(s => s.canal_entrada === 'ALIADO').length}
                          </span>
                        </button>

                        {saldosPorAliado.map(a => (
                          <button
                            key={a.id}
                            onClick={() => setFiltroAliado(filtroAliado === a.id ? null : a.id)}
                            className={`flex flex-col items-start px-3 py-2 rounded-xl border text-left transition-all min-w-[140px] ${
                              filtroAliado === a.id
                                ? 'bg-[#1A5CD8] text-white border-[#1A5CD8]'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-[#1A5CD8] hover:shadow-sm'
                            }`}
                          >
                            <span className={`text-[11px] font-bold truncate max-w-[160px] ${filtroAliado === a.id ? 'text-white' : 'text-gray-800'}`}>
                              🏥 {a.nombre}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[13px] font-extrabold tabular-nums ${filtroAliado === a.id ? 'text-white' : 'text-[#DC2626]'}`}>
                                {fmt(a.saldo)}
                              </span>
                              <span className={`text-[10px] ${filtroAliado === a.id ? 'text-white/70' : 'text-gray-400'}`}>
                                {a.count} serv.
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Filtro por estado + indicador de filtro activo */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {['TODOS', 'PENDIENTE', 'PARCIAL'].map(f => (
                      <button
                        key={f}
                        onClick={() => setFiltroCartera(f)}
                        className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-colors ${
                          filtroCartera === f
                            ? 'bg-[#1A5CD8] text-white border-[#1A5CD8]'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {f === 'TODOS' ? 'Todos' : f}
                        {f !== 'TODOS' && (
                          <span className="ml-1 opacity-70">
                            ({carteraSvcs.filter(s => s.estado_pago === f && (!filtroAliado || s.aliado_origen_id === filtroAliado)).length})
                          </span>
                        )}
                      </button>
                    ))}
                    {filtroAliado && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold"
                        style={{ background: '#EEF2FF', color: '#3730A3' }}>
                        🏥 {saldosPorAliado.find(a => a.id === filtroAliado)?.nombre}
                        <button onClick={() => setFiltroAliado(null)} className="ml-1 hover:opacity-70">
                          <X size={11} />
                        </button>
                      </span>
                    )}
                  </div>

                  {carteraFiltrada.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-4xl mb-3">🎉</div>
                      <p className="text-[14px] font-semibold text-gray-700">
                        {filtroAliado
                          ? `Sin saldos pendientes para ${saldosPorAliado.find(a => a.id === filtroAliado)?.nombre}`
                          : filtroCartera === 'TODOS'
                            ? 'No hay saldos pendientes por cobrar'
                            : `No hay servicios con estado ${filtroCartera}`}
                      </p>
                      <p className="text-[12px] text-gray-400 mt-1">
                        {filtroAliado || filtroCartera !== 'TODOS' ? 'Prueba cambiando los filtros.' : 'Todos los servicios están al día.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full min-w-[780px]">
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                            {['Fecha', 'Mascota / Cliente', 'Veterinaria', 'Plan', 'Valor total', 'Pagado', 'Saldo', 'Estado', ''].map(h => (
                              <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide pb-2 pr-4 first:pl-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {carteraFiltrada.map(s => (
                            <tr key={s.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                              <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtFecha(s.fecha_ingreso)}</td>
                              <td className="py-3 pr-4">
                                <div className="font-semibold text-gray-900 leading-tight">{nombreMascota(s)}</div>
                                <div className="text-[11px] text-gray-400 leading-tight">{nombreCliente(s)}</div>
                              </td>
                              <td className="py-3 pr-4">
                                {s.canal_entrada === 'ALIADO' && s.aliado?.nombre ? (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3]">
                                    🏥 {s.aliado.nombre}
                                  </span>
                                ) : (
                                  <BadgeCanal canal={s.canal_entrada} />
                                )}
                              </td>
                              <td className="py-3 pr-4 text-gray-600 text-[12px]">{nombrePlan(s)}</td>
                              <td className="py-3 pr-4 font-semibold text-gray-900 tabular-nums">{fmt(s.valor_total)}</td>
                              <td className="py-3 pr-4 text-[#16a34a] font-semibold tabular-nums">{fmt(s.valor_pagado)}</td>
                              <td className="py-3 pr-4 text-[#DC2626] font-bold tabular-nums">{fmt(s.saldo)}</td>
                              <td className="py-3 pr-4"><BadgeEstadoPago estado={s.estado_pago} /></td>
                              <td className="py-3">
                                <button
                                  onClick={() => abrirPagoModal(s)}
                                  className="px-3 py-1.5 bg-[#1A5CD8] hover:bg-[#1550C0] text-white text-[11px] font-semibold rounded-xl transition-colors whitespace-nowrap"
                                >
                                  Registrar pago
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Comisiones ──────────────────────────────────── */}
              {tab === 'comisiones' && (
                <div className="p-5 space-y-4">
                  {comisionesPorAliado.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-4xl mb-3">🤝</div>
                      <p className="text-[14px] font-semibold text-gray-700">No hay comisiones de aliados registradas</p>
                      <p className="text-[12px] text-gray-400 mt-1">Las comisiones aparecen cuando los servicios tienen canal ALIADO.</p>
                    </div>
                  ) : (
                    comisionesPorAliado.map(({ aliado, servicios: svcAliado }) => {
                      const totalGenerado  = svcAliado.reduce((a, s) => a + (s.comision_aliado || 0), 0)
                      const totalDescontado = svcAliado.filter(s => s.comision_descontada).reduce((a, s) => a + (s.comision_aliado || 0), 0)
                      const totalPendiente = totalGenerado - totalDescontado
                      const isExpanded = expandedAliados.has(aliado.id_aliado)
                      const pendientes = svcAliado.filter(s => !s.comision_descontada)
                      const estaLiquidando = liquidandoAliado === aliado.id_aliado

                      return (
                        <div key={aliado.id_aliado} className="border rounded-2xl overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          {/* Header del aliado */}
                          <div
                            className="p-4 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                            style={{ background: 'linear-gradient(135deg, #F0F7EC 0%, #fff 60%)' }}
                            onClick={() => toggleExpand(aliado.id_aliado)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[14px] font-bold text-gray-900">{aliado.nombre}</span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3]">
                                  {aliado.modalidad_comision?.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-4 mt-1.5 text-[12px]">
                                <span className="text-gray-500">
                                  Generado: <span className="font-semibold text-gray-800">{fmt(totalGenerado)}</span>
                                </span>
                                <span className="text-[#16a34a]">
                                  Descontado: <span className="font-semibold">{fmt(totalDescontado)}</span>
                                </span>
                                <span className={totalPendiente > 0 ? 'text-[#d97706] font-bold' : 'text-gray-400'}>
                                  Pendiente: <span className="font-semibold">{fmt(totalPendiente)}</span>
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {pendientes.length > 0 && (
                                <button
                                  onClick={e => { e.stopPropagation(); liquidarAliado(aliado.id_aliado) }}
                                  disabled={estaLiquidando}
                                  className="px-3 py-1.5 bg-[#1A5CD8] hover:bg-[#1550C0] text-white text-[11px] font-semibold rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                                >
                                  {estaLiquidando ? 'Liquidando…' : `Liquidar pendientes (${pendientes.length})`}
                                </button>
                              )}
                              <span className="text-gray-400">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </span>
                            </div>
                          </div>

                          {/* Tabla de servicios del aliado */}
                          {isExpanded && (
                            <div className="border-t overflow-x-auto" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                              <table className="w-full min-w-[500px]">
                                <thead style={{ background: '#FAFAFA' }}>
                                  <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.06)' }}>
                                    {['Fecha', 'Mascota', 'Valor servicio', 'Comisión', 'Estado pago', 'Descontada'].map(h => (
                                      <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide px-4 py-2">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {svcAliado.map(s => (
                                    <tr key={s.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtFecha(s.fecha_ingreso)}</td>
                                      <td className="px-4 py-3">
                                        <div className="font-semibold text-gray-900 leading-tight">{nombreMascota(s)}</div>
                                        <div className="text-[11px] text-gray-400">{nombreCliente(s)}</div>
                                      </td>
                                      <td className="px-4 py-3 font-semibold text-gray-900 tabular-nums">{fmt(s.valor_total)}</td>
                                      <td className="px-4 py-3 font-bold text-[#d97706] tabular-nums">{fmt(s.comision_aliado)}</td>
                                      <td className="px-4 py-3"><BadgeEstadoPago estado={s.estado_pago} /></td>
                                      <td className="px-4 py-3">
                                        <button
                                          onClick={() => toggleComisionDescontada(s.id, !s.comision_descontada)}
                                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                            s.comision_descontada
                                              ? 'bg-[#F0FDF4] text-[#166534] border-[#bbf7d0]'
                                              : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                                          }`}
                                        >
                                          {s.comision_descontada
                                            ? <><Check size={11} /> Descontada</>
                                            : <><X size={11} /> Pendiente</>
                                          }
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* ── Tab: Historial ───────────────────────────────────── */}
              {tab === 'historial' && (
                <div className="p-5">
                  {servicios.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="text-[14px] font-semibold text-gray-700">No hay servicios registrados</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full min-w-[1100px]">
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                            {['Fecha', 'Mascota', 'Cliente', 'Canal', 'Plan', 'Técnico', 'Total', 'Pagado', 'Saldo', 'Estado pago', 'Medios de pago', ''].map(h => (
                              <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide pb-2 pr-4 first:pl-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {servicios.map(s => {
                            const mediosPago = s.recibo?.medios_pago || (s.metodo_pago ? [{ metodo: s.metodo_pago, monto: s.valor_pagado }] : [])
                            return (
                              <tr key={s.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                                <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtFecha(s.fecha_ingreso)}</td>
                                <td className="py-3 pr-4 font-semibold text-gray-900">{nombreMascota(s)}</td>
                                <td className="py-3 pr-4 text-gray-600">{nombreCliente(s)}</td>
                                <td className="py-3 pr-4"><BadgeCanal canal={s.canal_entrada} /></td>
                                <td className="py-3 pr-4 text-gray-600 text-[12px]">{nombrePlan(s)}</td>
                                <td className="py-3 pr-4 text-[12px]">
                                  {s.tecnico ? (
                                    <span className="flex items-center gap-1 text-gray-700">
                                      <User2 size={11} className="text-gray-400" />
                                      {s.tecnico.nombre} {s.tecnico.apellido}
                                    </span>
                                  ) : <span className="text-gray-300 italic text-[11px]">Sin asignar</span>}
                                </td>
                                <td className="py-3 pr-4 font-semibold text-gray-900 tabular-nums">{fmt(s.valor_total)}</td>
                                <td className="py-3 pr-4 text-[#16a34a] font-semibold tabular-nums">{fmt(s.valor_pagado)}</td>
                                <td className={`py-3 pr-4 font-bold tabular-nums ${s.saldo > 0 ? 'text-[#DC2626]' : 'text-gray-400'}`}>
                                  {s.saldo > 0 ? fmt(s.saldo) : '—'}
                                </td>
                                <td className="py-3 pr-4"><BadgeEstadoPago estado={s.estado_pago} /></td>
                                <td className="py-3 pr-4">
                                  {mediosPago.length > 0 ? (
                                    <div className="flex flex-col gap-0.5">
                                      {mediosPago.map((m, i) => (
                                        <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                                          {m.metodo}{m.monto > 0 ? `: ${fmt(parseFloat(m.monto)||0)}` : ''}
                                        </span>
                                      ))}
                                    </div>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="py-3">
                                  {s.recibo && (
                                    <a href={`#/recibos`}
                                      className="text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                      style={{ background: '#EDE9FE', color: '#5B21B6' }}
                                      title="Ver recibo del técnico">
                                      <Receipt size={10} /> Recibo
                                    </a>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Cuadre técnicos ─────────────────────────────── */}
              {tab === 'tecnicos' && (
                <div className="p-5">
                  <p className="text-[12px] text-gray-500 mb-4">
                    Resumen de dinero recogido por cada técnico. Úsalo para citarlos al cuadre de cuentas.
                  </p>
                  {(() => {
                    const porTecnico = {}
                    servicios.forEach(s => {
                      if (!s.tecnico_id || !s.valor_pagado) return
                      const key = s.tecnico_id
                      if (!porTecnico[key]) porTecnico[key] = {
                        tecnico: s.tecnico,
                        servicios: 0,
                        efectivo: 0,
                        transferencia: 0,
                        nequi: 0,
                        daviplata: 0,
                        tarjeta: 0,
                        otro: 0,
                        total: 0,
                      }
                      porTecnico[key].servicios++
                      porTecnico[key].total += s.valor_pagado || 0
                      // Desglose por medios de pago del recibo
                      const medios = s.recibo?.medios_pago || []
                      medios.forEach(m => {
                        const monto = parseFloat(m.monto) || 0
                        const met   = (m.metodo || '').toLowerCase()
                        if (met === 'efectivo')       porTecnico[key].efectivo      += monto
                        else if (met === 'transferencia') porTecnico[key].transferencia += monto
                        else if (met === 'nequi')     porTecnico[key].nequi         += monto
                        else if (met === 'daviplata') porTecnico[key].daviplata     += monto
                        else if (met === 'tarjeta')   porTecnico[key].tarjeta       += monto
                        else                          porTecnico[key].otro          += monto
                      })
                      if (medios.length === 0 && s.valor_pagado > 0) {
                        // Sin recibo detallado: sumar al total sin desglose
                      }
                    })
                    const lista = Object.values(porTecnico).sort((a, b) => b.total - a.total)

                    if (lista.length === 0) return (
                      <div className="py-12 text-center">
                        <div className="text-3xl mb-2">👤</div>
                        <p className="text-[13px] text-gray-500">Sin técnicos con cobros registrados</p>
                      </div>
                    )

                    return (
                      <div className="space-y-4">
                        {lista.map(t => (
                          <div key={t.tecnico?.id} className="border rounded-2xl overflow-hidden"
                            style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                            <div className="px-5 py-3 flex items-center gap-3"
                              style={{ background: 'linear-gradient(135deg,#EEF3FB 0%,#fff 60%)' }}>
                              <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-[13px] flex-shrink-0"
                                style={{ background: '#1A5CD8' }}>
                                {(t.tecnico?.nombre?.[0] || '?').toUpperCase()}{(t.tecnico?.apellido?.[0] || '').toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <div className="font-bold text-gray-900 text-[14px]">
                                  {t.tecnico ? `${t.tecnico.nombre} ${t.tecnico.apellido}` : 'Sin nombre'}
                                </div>
                                <div className="text-[11px] text-gray-400">{t.servicios} servicio{t.servicios !== 1 ? 's' : ''}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[18px] font-extrabold tabular-nums" style={{ color: '#1A5CD8' }}>{fmt(t.total)}</div>
                                <div className="text-[10px] text-gray-400">Total cobrado</div>
                              </div>
                            </div>
                            {/* Desglose medios */}
                            {(t.efectivo + t.transferencia + t.nequi + t.daviplata + t.tarjeta + t.otro) > 0 && (
                              <div className="px-5 py-3 border-t flex flex-wrap gap-3"
                                style={{ borderColor: 'rgba(30,80,40,0.06)', background: '#FAFAFA' }}>
                                {[
                                  ['Efectivo',       t.efectivo,      '#16A34A'],
                                  ['Transferencia',  t.transferencia, '#1A5CD8'],
                                  ['Nequi',          t.nequi,         '#7C3AED'],
                                  ['Daviplata',      t.daviplata,     '#D97706'],
                                  ['Tarjeta',        t.tarjeta,       '#0E7490'],
                                  ['Otro',           t.otro,          '#6B7280'],
                                ].filter(([,v]) => v > 0).map(([label, valor, color]) => (
                                  <div key={label} className="flex flex-col items-center px-3 py-2 rounded-xl border"
                                    style={{ borderColor: `${color}30`, background: `${color}08` }}>
                                    <span className="text-[10px] font-bold uppercase" style={{ color }}>{label}</span>
                                    <span className="text-[14px] font-extrabold tabular-nums" style={{ color }}>{fmt(valor)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}

            </div>
          </>
        )}
      </div>

      {/* ── Modal Registrar Pago ────────────────────────────────────────── */}
      {pagoModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) cerrarPagoModal() }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ borderColor: 'rgba(30,80,40,0.12)', border: '1px solid' }}>
            {/* Header modal */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
              <div className="flex items-center gap-2">
                <CreditCard size={17} className="text-[#1A5CD8]" />
                <span className="text-[14px] font-bold text-gray-900">Registrar pago</span>
              </div>
              <button
                onClick={cerrarPagoModal}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                <X size={15} />
              </button>
            </div>

            {/* Resumen del servicio */}
            <div className="px-5 pt-4 pb-2 rounded-b-none">
              <div className="bg-gray-50 rounded-xl p-4 space-y-1 mb-4" style={{ border: '1px solid rgba(30,80,40,0.06)' }}>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Mascota</span>
                  <span className="text-[13px] font-semibold text-gray-900">{nombreMascota(pagoModal)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Cliente</span>
                  <span className="text-[13px] text-gray-700">{nombreCliente(pagoModal)}</span>
                </div>
                {pagoModal.canal_entrada === 'ALIADO' && pagoModal.aliado?.nombre && (
                  <div className="flex justify-between items-center">
                    <span className="text-[12px] text-gray-500">Veterinaria</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3]">
                      🏥 {pagoModal.aliado.nombre}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Valor total</span>
                  <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{fmt(pagoModal.valor_total)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-gray-500">Pagado</span>
                  <span className="text-[13px] font-semibold text-[#16a34a] tabular-nums">{fmt(pagoModal.valor_pagado)}</span>
                </div>
                <div className="flex justify-between items-center pt-1 mt-1 border-t" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                  <span className="text-[13px] font-bold text-gray-800">Saldo pendiente</span>
                  <span className="text-[22px] font-extrabold text-[#DC2626] tabular-nums leading-tight">{fmt(pagoModal.saldo)}</span>
                </div>
              </div>

              {/* Campos del formulario */}
              <div className="space-y-3 pb-5">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    Valor del abono
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
                    <input
                      type="number"
                      min={1}
                      max={pagoModal.saldo}
                      step={1000}
                      value={valorAbono}
                      onChange={e => { setValorAbono(e.target.value); setPagoError('') }}
                      className="w-full pl-6 pr-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] transition-all"
                      style={{ borderColor: 'rgba(30,80,40,0.2)' }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Máximo: {fmt(pagoModal.saldo)}</p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    Método de pago
                  </label>
                  <select
                    value={metodoPago}
                    onChange={e => setMetodoPago(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] transition-all bg-white"
                    style={{ borderColor: 'rgba(30,80,40,0.2)' }}
                  >
                    {['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    Notas <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={pagoNotas}
                    onChange={e => setPagoNotas(e.target.value)}
                    placeholder="Observaciones del pago…"
                    className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] transition-all resize-none"
                    style={{ borderColor: 'rgba(30,80,40,0.2)' }}
                  />
                </div>

                {pagoError && (
                  <div className="flex items-center gap-2 bg-red-50 text-red-700 text-[12px] font-medium px-3 py-2 rounded-xl border border-red-100">
                    <AlertCircle size={13} className="flex-shrink-0" />
                    {pagoError}
                  </div>
                )}
              </div>
            </div>

            {/* Footer modal */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
              <button
                onClick={cerrarPagoModal}
                disabled={pagoSaving}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
                style={{ borderColor: 'rgba(30,80,40,0.15)' }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarPago}
                disabled={pagoSaving || !valorAbono || parseFloat(valorAbono) <= 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#1A5CD8] hover:bg-[#1550C0] text-white rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-60"
              >
                {pagoSaving ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando…</>
                ) : (
                  <><Banknote size={14} /> Registrar abono</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componente KpiCard ───────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-2xl p-5 border shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
          {icon}
        </div>
      </div>
      <div className="text-[22px] font-extrabold text-gray-900 leading-tight tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1 font-medium">{sub}</div>}
    </div>
  )
}
