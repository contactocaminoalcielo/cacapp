import { esAliadoVip, VipBadge } from '@/components/servicio/VipAliado'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import Topbar from '@/components/layout/Topbar'
import { db, dbIn } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { orbitApi } from '@/lib/orbitApi'
import { fmt, parsearErrorDB, parseDate, today, petEmoji } from '@/lib/utils'
import {
  DollarSign, TrendingUp, AlertCircle, Check, X,
  RefreshCw, ChevronDown, ChevronUp, CreditCard,
  Banknote, Building2, Receipt, User2, Tag,
  Calendar, Lock, Download, Eye, FileText, Phone,
  CheckCircle2, AlertTriangle, MapPin, Clock, ClipboardList, MessageSquare, Paperclip,
  HelpCircle, Sparkles, Pencil, ArrowLeftRight, Trash2, Columns3, ArrowUpDown,
  Search, Filter,
} from 'lucide-react'
import { abrirPdfReciboServicio, subirComprobantePago } from '@/lib/comprobantes'
import { abrirReciboPDFServicio } from '@/lib/reciboPdf'
import { recategorizacionesPorServicio, esRecatSoloComision } from '@/lib/servicios'
import RecatBadges from '@/components/RecatBadges'
import RecibosServicio from '@/components/servicio/RecibosServicio'

// Estado de revisión por mascota. NULL = sin revisar. Solo dos estados:
//  · VERIFICADO          → saldado, no se debe nada; ese dinero cuenta en Finanzas.
//  · PENDIENTE_GESTIONAR → pago pendiente del cliente, comisión de veterinaria o
//                          facturación mensual → pasa a Conciliaciones.
const ESTADO_REV = {
  VERIFICADO:          { label: 'Verificado OK',       short: 'OK',        color: '#166534', bg: '#F0FDF4', border: '#86EFAC' },
  PENDIENTE_GESTIONAR: { label: 'Pendiente gestionar', short: 'Pendiente', color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
}
const VIA_CONCIL = {
  LLAMAR_COBRAR:      { label: 'Llamar a cobrar',      icon: Phone },
  FACTURACION_MENSUAL:{ label: 'Facturación mensual',  icon: Building2 },
}

// Columnas de la tabla del cuadre, en orden. `fija: true` = no se puede ocultar
// (Mascota es el ancla de cada fila; Acción es el control de revisión). El resto
// se puede esconder para reducir el desplazamiento horizontal. El `key` debe
// coincidir con el guardado en localStorage y con el orden de los <td>.
const COLS_CUADRE = [
  { key: 'fecha',       label: 'Fecha de registro' },
  { key: 'mascota',     label: 'Mascota', fija: true },
  { key: 'ciudad',      label: 'Ciudad' },
  { key: 'veterinaria', label: 'Veterinaria' },
  { key: 'plan',        label: 'Plan' },
  { key: 'total',       label: 'Total a cobrar',  title: 'Neto que paga el cliente: transporte a municipios incluido y comisión descontada' },
  { key: 'comision',    label: 'Comisión (info)', title: 'Solo informativo: ya está descontada del total a cobrar, no se suma' },
  { key: 'recogido',    label: 'Recogido' },
  { key: 'diferencia',  label: 'Diferencia' },
  { key: 'efectivo',    label: 'Efectivo' },
  { key: 'digital',     label: 'Digital → empresa' },
  { key: 'transporte',  label: 'Transporte téc.' },
  { key: 'pago',        label: 'Pago téc.' },
  { key: 'recargo',     label: 'Recargo' },
  { key: 'lejania',     label: 'Lejanía' },
  { key: 'accion',      label: 'Acción', fija: true },
]
const CUADRE_COLS_LS = 'orbit_cuadre_cols_ocultas'

// Chips de filtro rápido por estado del ítem (OR entre los activos).
const CHIPS_ESTADO_CUADRE = [
  { k: 'alerta',       label: 'Con diferencia' },
  { k: 'cancelado',    label: 'Cancelados' },
  { k: 'sin_recibo',   label: 'Sin recibo' },
  { k: 'fact_mensual', label: 'Fact. mensual' },
  { k: 'lejania',      label: 'Lejanía' },
]
// Filtro por medio de pago (selección única).
const CHIPS_MEDIO_CUADRE = [
  { k: 'efectivo', label: 'Solo efectivo' },
  { k: 'digital',  label: 'Solo digital' },
  { k: 'mixto',    label: 'Mixto' },
]

// NETO que le queda a la EMPRESA por un servicio del cuadre = bruto − comisión
// de la veterinaria. Se deriva SIEMPRE del bruto (valor_a_cobrar), NO del
// snapshot `valor_a_recoger`. Motivo (bug 2026-07-23): cuando un servicio de
// veterinaria con comisión se registra como recogida a DOMICILIO, se guarda con
// `comision_descontada = false`, y ahí `valor_a_recoger` quedó igual al BRUTO.
// Si el técnico recoge el neto (el cliente pagó con la comisión ya descontada),
// el cuadre marcaba un falso faltante EXACTAMENTE por el valor de la comisión.
// La comisión NUNCA es faltante del técnico: es plata de la veterinaria y se
// gestiona en la pestaña Comisiones. La banda aceptable es [neto … bruto].
function netoCuadreItem(it) {
  const bruto = it.valor_a_cobrar  != null ? Number(it.valor_a_cobrar)
              : it.valor_a_recoger != null ? Number(it.valor_a_recoger) : null
  if (bruto == null) return null
  return bruto - (Number(it.comision) || 0)
}

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
  const { personalData } = useAuth()
  // ── State principal ─────────────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(true)
  const [resumenServicios, setResumenServicios] = useState([]) // filas livianas para KPIs
  const [resumenLoading, setResumenLoading] = useState(false)
  const [servicios, setServicios] = useState([])   // cartera enriquecida (carga inicial)
  const [comisionesServicios, setComisionesServicios] = useState(null) // null = sin cargar
  const [comisionesLoading, setComisionesLoading] = useState(false)
  const [historialServicios, setHistorialServicios] = useState(null) // null = sin cargar
  const [historialServiciosLoading, setHistorialServiciosLoading] = useState(false)
  const [historialHasMore, setHistorialHasMore] = useState(false)
  const [tab,       setTab]       = useState('cartera') // 'cartera' | 'comisiones' | 'historial'

  // ── State filtro cartera ────────────────────────────────────────────────────
  const [filtroCartera, setFiltroCartera] = useState('TODOS') // TODOS | PENDIENTE | PARCIAL
  const [filtroAliado,  setFiltroAliado]  = useState(null)    // null | aliado_origen_id

  // ── State modal pago ────────────────────────────────────────────────────────
  const [pagoModal,    setPagoModal]    = useState(null)   // null | servicio
  const [pagoComprobante, setPagoComprobante] = useState(null)   // File adjunto al registrar pago
  const [comprobantesSet, setComprobantesSet] = useState(() => new Set()) // servicio_ids con comprobante
  const [valorAbono,   setValorAbono]   = useState('')
  const [metodoPago,   setMetodoPago]   = useState('EFECTIVO')
  const [pagoNotas,    setPagoNotas]    = useState('')
  const [pagoSaving,   setPagoSaving]   = useState(false)
  const [pagoError,    setPagoError]    = useState('')

  // ── State comisiones ────────────────────────────────────────────────────────
  const [liquidandoAliado,  setLiquidandoAliado]  = useState(null)  // null | aliado_id
  const [expandedAliados,   setExpandedAliados]   = useState(new Set())

  // ── State cuadre con técnicos ───────────────────────────────────────────────
  const [tecnicos,        setTecnicos]        = useState([])
  const [cuadreTec,       setCuadreTec]       = useState('')
  const [cuadreDesde,     setCuadreDesde]     = useState('')
  const [cuadreHasta,     setCuadreHasta]     = useState('')
  const [cuadreAjustes,   setCuadreAjustes]   = useState('')
  const [cuadreAjusteMot, setCuadreAjusteMot] = useState('')
  const [cuadreData,      setCuadreData]      = useState(null)   // cabecera cuadres_tecnico
  const [cuadreItems,     setCuadreItems]     = useState([])
  const [ajustesTecnico,  setAjustesTecnico]  = useState({})     // sugerencias del técnico (capa sombra) por servicio_id
  const [recatServicios,  setRecatServicios]  = useState({})     // recategorizaciones (plan/peso) por servicio_id
  const [cuadreLoading,   setCuadreLoading]   = useState(false)
  const [cuadreError,     setCuadreError]     = useState('')
  const [cerrando,        setCerrando]        = useState(false)
  const [cuadrePdfGen,    setCuadrePdfGen]    = useState(false)
  const [detalleItem,     setDetalleItem]     = useState(null)   // cuadre_item → tarjeta de mascota
  const [comprobanteItem, setComprobanteItem] = useState(null)   // cuadre_item → ver comprobante
  const [obsItem,         setObsItem]         = useState(null)   // cuadre_item → editar observaciones
  const [valorRecogidoItem, setValorRecogidoItem] = useState(null) // cuadre_item → editar valor recogido
  const [mediosItem, setMediosItem] = useState(null)               // cuadre_item → reclasificar medios (efectivo↔digital)
  const [recargoManualItem, setRecargoManualItem] = useState(null) // cuadre_item → editar recargo
  const [pagoTecnicoItem, setPagoTecnicoItem] = useState(null)     // cuadre_item → editar pago al técnico (incl. cancelados)
  const [historialCuadres, setHistorialCuadres] = useState(null) // null = sin cargar (cuadres anteriores)
  const [descartando,     setDescartando]     = useState(null)   // id del borrador que se está descartando
  const [histLoading,     setHistLoading]     = useState(false)
  const [saldosAFavor,    setSaldosAFavor]    = useState([])     // cuadres CERRADOS previos con saldo a favor del técnico
  const [entregaModal,    setEntregaModal]    = useState(false)  // modal "confirmar dinero recibido"
  const [motivoCierreOpen, setMotivoCierreOpen] = useState(false) // modal "cerrar sin firma del técnico"
  const [entregaPorNombre, setEntregaPorNombre] = useState(null) // nombre de quien recibió el dinero
  const [guiaOpen,        setGuiaOpen]        = useState(false)  // modal "¿cómo funciona?"
  const [iaAnalisis,      setIaAnalisis]      = useState(null)   // texto del asistente IA del cuadre
  const [iaLoading,       setIaLoading]       = useState(false)

  // ── State Conciliaciones (mascotas con plata faltante) ──────────────────────
  const [conciliaciones, setConciliaciones] = useState(null)  // null = aún no cargado
  const [concilLoading,  setConcilLoading]  = useState(false)

  // ── State "No cobrados" (pago pendiente / facturación mensual) ──────────────
  const [noCobrados,    setNoCobrados]    = useState(null)   // null = aún no cargado
  const [noCobLoading,  setNoCobLoading]  = useState(false)

  // Selects separados para que la entrada al modulo no arrastre datos pesados.
  const SERVICIO_SELECT = 'id, fecha_ingreso, valor_total, valor_pagado, estado_pago, metodo_pago, canal_entrada, estado, comision_aliado, comision_descontada, descuento_adicional, descuento_adicional_motivo, mascota_id, aliado_origen_id, plan_id, notas, tecnico_id'
  const RESUMEN_SELECT  = 'id, valor_total, valor_pagado, estado_pago, canal_entrada, comision_aliado, comision_descontada, descuento_adicional, aliado_origen_id'
  const HISTORIAL_PAGE_SIZE = 100

  async function enriquecerServicios(rows, { incluirComprobantes = false, incluirRecibos = false } = {}) {
    const base = rows || []
    const idsSvc = base.map(s => s.id).filter(Boolean)
    const mascotaIds = [...new Set(base.map(s => s.mascota_id).filter(Boolean))]
    const aliadoIds = [...new Set(base.map(s => s.aliado_origen_id).filter(Boolean))]
    const planIds = [...new Set(base.map(s => s.plan_id).filter(Boolean))]
    const tecnicoIds = [...new Set(base.map(s => s.tecnico_id).filter(Boolean))]
    const [mascotas, aliados, planes, personal, recibos, comps, recsComprobante] = await Promise.all([
      dbIn('mascotas', 'id_mascota, nombre, cliente_id, especies(nombre)', 'id_mascota', mascotaIds),
      dbIn('aliados', 'id_aliado, nombre, modalidad_comision, saldo_comision', 'id_aliado', aliadoIds),
      dbIn('planes', 'id, nombre, codigo', 'id', planIds),
      dbIn('personal', 'id, nombre, apellido', 'id', tecnicoIds),
      incluirRecibos
        ? dbIn('recibos_tecnico',
            'id, servicio_id, tipo, fecha_emision, hora_emision, valor_cobrado, medios_pago, numero_recibo',
            'servicio_id', idsSvc,
            q => q.eq('tipo', 'CLIENTE').order('created_at', { ascending: false }))
        : [],
      incluirComprobantes ? dbIn('recibo_comprobantes', 'servicio_id', 'servicio_id', idsSvc) : [],
      incluirComprobantes ? dbIn('recibos_tecnico', 'servicio_id, medios_pago', 'servicio_id', idsSvc) : [],
    ])

    const mascotaMap = Object.fromEntries(mascotas.map(m => [m.id_mascota, m]))
    const clienteIds = [...new Set(Object.values(mascotaMap).map(m => m.cliente_id).filter(Boolean))]
    const clientes = await dbIn('clientes', 'id_cliente, nombre, apellido, whatsapp', 'id_cliente', clienteIds)
    const clienteMap = Object.fromEntries(clientes.map(c => [c.id_cliente, c]))

    const aliadoMap = Object.fromEntries(aliados.map(a => [a.id_aliado, a]))
    const planMap = Object.fromEntries(planes.map(p => [p.id, p]))
    const tecnicoMap = Object.fromEntries(personal.map(p => [p.id, p]))
    const reciboMap = {}
    ;(recibos || []).forEach(r => { if (!reciboMap[r.servicio_id]) reciboMap[r.servicio_id] = r })

    const comprobantes = new Set()
    ;(comps || []).forEach(c => comprobantes.add(c.servicio_id))
    ;(recsComprobante || []).forEach(r => {
      const tiene = (Array.isArray(r.medios_pago) ? r.medios_pago : []).some(mp => mp?.comprobanteUrl)
      if (tiene) comprobantes.add(r.servicio_id)
    })

    const enriched = base.map(s => {
      const mascota = mascotaMap[s.mascota_id] || null
      const cliente = mascota ? (clienteMap[mascota.cliente_id] || null) : null
      const aliado  = s.aliado_origen_id ? (aliadoMap[s.aliado_origen_id] || null) : null
      const plan    = s.plan_id ? (planMap[s.plan_id] || null) : null
      const tecnico = s.tecnico_id ? (tecnicoMap[s.tecnico_id] || null) : null
      const recibo  = reciboMap[s.id] || null
      const saldo   = Math.max(0, (s.valor_total || 0) - (s.valor_pagado || 0))
      return { ...s, mascota, cliente, aliado, plan, tecnico, recibo, saldo }
    })

    return { enriched, comprobantes }
  }

  async function cargarResumenFinanzas() {
    setResumenLoading(true)
    try {
      const { data, error } = await db.from('servicios')
        .select(RESUMEN_SELECT)
        .not('estado', 'eq', 'CANCELADO')
        .gte('fecha_ingreso', FECHA_CORTE)
      if (error) throw error
      setResumenServicios(data || [])
    } catch (err) {
      console.error('[Finanzas] Error cargando resumen financiero:', err)
    } finally {
      setResumenLoading(false)
    }
  }

  // Red de seguridad de la cartera: `estado_pago` es una marca guardada, y puede
  // quedar vieja cuando el valor del servicio sube DESPUÉS de haberlo cobrado
  // (cambio de plan, recategorización por peso). El servicio se queda en COMPLETO
  // con saldo > 0 y, como la cartera filtraba por esa marca, la plata pendiente se
  // volvía invisible aquí aunque el KPI "Por cobrar" sí la contara (caso LOLA,
  // 2026-07-27). PostgREST no compara dos columnas entre sí, así que se traen los
  // COMPLETO con un select mínimo, se filtran en cliente y solo se rehidratan los
  // que de verdad tienen saldo.
  async function cargarCompletosConSaldo() {
    try {
      const { data, error } = await db.from('servicios')
        .select('id, valor_total, valor_pagado')
        .not('estado', 'eq', 'CANCELADO')
        .gte('fecha_ingreso', FECHA_CORTE)
        .eq('estado_pago', 'COMPLETO')
        .order('fecha_ingreso', { ascending: false })   // si algún día topa el máximo de filas, que corte por lo más viejo
      if (error) throw error
      const ids = (data || [])
        .filter(s => (s.valor_total || 0) - (s.valor_pagado || 0) > 0)
        .map(s => s.id)
      if (!ids.length) return []
      return await dbIn('servicios', SERVICIO_SELECT, 'id', ids)
    } catch (err) {
      console.error('[Finanzas] No se pudieron revisar los servicios COMPLETO con saldo:', err)
      return []   // best-effort: la cartera normal se muestra igual
    }
  }

  // Carga inicial: la cartera aparece primero; KPIs, comisiones e historial se
  // actualizan despues para no bloquear la entrada al modulo.
  async function cargar() {
    setLoading(true)
    setResumenLoading(true)
    try {
      const [{ data, error }, descuadrados] = await Promise.all([
        db.from('servicios')
          .select(SERVICIO_SELECT)
          .not('estado', 'eq', 'CANCELADO')
          .gte('fecha_ingreso', FECHA_CORTE)
          .or('estado_pago.is.null,and(estado_pago.neq.COMPLETO,estado_pago.neq.CORTESIA)')
          .order('fecha_ingreso', { ascending: false }),
        cargarCompletosConSaldo(),
      ])
      if (error) throw error

      const filas = [...(data || []), ...descuadrados]
        .sort((a, b) => String(b.fecha_ingreso || '').localeCompare(String(a.fecha_ingreso || '')))
      const { enriched, comprobantes } = await enriquecerServicios(filas, { incluirComprobantes: true })
      setServicios(enriched.filter(s => s.saldo > 0 && s.estado_pago !== 'CORTESIA'))
      setComprobantesSet(comprobantes)
      setLoading(false)
      void cargarResumenFinanzas()
    } catch (err) {
      console.error('[Finanzas] Error cargando datos:', err)
      setLoading(false)
      setResumenLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  async function cargarComisiones(force = false) {
    if (!force && (comisionesServicios !== null || comisionesLoading)) return
    setComisionesLoading(true)
    try {
      const { data, error } = await db.from('servicios')
        .select(SERVICIO_SELECT)
        .not('estado', 'eq', 'CANCELADO')
        .gte('fecha_ingreso', FECHA_CORTE)
        .eq('canal_entrada', 'ALIADO')
        .gt('comision_aliado', 0)
        .order('fecha_ingreso', { ascending: false })
      if (error) throw error
      const { enriched } = await enriquecerServicios(data || [])
      setComisionesServicios(enriched)
    } catch (err) {
      console.error('[Finanzas] Error cargando comisiones:', err)
      setComisionesServicios([])
    } finally {
      setComisionesLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'comisiones') cargarComisiones()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargarHistorialServicios(reset = true) {
    if (historialServiciosLoading) return
    setHistorialServiciosLoading(true)
    try {
      const base = reset ? [] : (historialServicios || [])
      const from = base.length
      const to = from + HISTORIAL_PAGE_SIZE - 1
      const { data, error } = await db.from('servicios')
        .select(SERVICIO_SELECT)
        .not('estado', 'eq', 'CANCELADO')
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('fecha_ingreso', { ascending: false })
        .range(from, to)
      if (error) throw error
      const { enriched } = await enriquecerServicios(data || [], { incluirRecibos: true })
      setHistorialServicios(reset ? enriched : [...base, ...enriched])
      setHistorialHasMore((data || []).length === HISTORIAL_PAGE_SIZE)
    } catch (err) {
      console.error('[Finanzas] Error cargando historial de servicios:', err)
      if (reset) setHistorialServicios([])
      setHistorialHasMore(false)
    } finally {
      setHistorialServiciosLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'historial' && historialServicios === null) cargarHistorialServicios(true)
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function actualizarFinanzas() {
    if (tab === 'comisiones') return cargarComisiones(true)
    if (tab === 'historial') return cargarHistorialServicios(true)
    if (tab === 'nocobrados') return cargarNoCobrados()
    if (tab === 'conciliaciones') return cargarConciliaciones()
    if (tab === 'tecnicos') return cargarHistorial()
    return cargar()
  }

  // Lista de técnicos/mensajeros para el selector del cuadre.
  useEffect(() => {
    db.from('personal')
      .select('id, nombre, apellido, rol_principal_id')
      .eq('activo', true)
      .in('rol_principal_id', [2, 3])
      .order('nombre')
      .then(({ data }) => setTecnicos(data || []))
  }, [])

  // ── Cuadre con técnicos: generar / cerrar / PDF ─────────────────────────────
  const cuadreCerrado = cuadreData?.estado === 'CERRADO'
  const puedeEditarCuadre = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)
    || [1, 6].includes(Number(personalData?.rol_principal_id))

  // ── Columnas ocultas del cuadre (preferencia por navegador) ─────────────────
  const [colsOcultas, setColsOcultas] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(CUADRE_COLS_LS) || '[]')) }
    catch { return new Set() }
  })
  const [colMenuAbierto, setColMenuAbierto] = useState(false)
  const verCol = k => !colsOcultas.has(k)
  function toggleCol(k) {
    setColsOcultas(prev => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      try { localStorage.setItem(CUADRE_COLS_LS, JSON.stringify([...next])) } catch (_) {}
      return next
    })
  }
  function mostrarTodasCols() {
    setColsOcultas(new Set())
    try { localStorage.setItem(CUADRE_COLS_LS, '[]') } catch (_) {}
  }
  const colsVisibles = COLS_CUADRE.filter(c => verCol(c.key))

  // ── Orden de la tabla del cuadre (clic en la cabecera) ──────────────────────
  // `key` = columna activa (null = orden natural en el que llegan los ítems).
  // Primer clic ordena de MAYOR a MENOR (desc); un 2º clic invierte a asc.
  const [orden, setOrden] = useState({ key: null, dir: 'desc' })
  function toggleOrden(key) {
    setOrden(prev => prev.key === key
      ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' })
  }
  // Valor comparable por columna. Numéricas → número; texto → string en minúscula.
  function valorOrden(it, key) {
    switch (key) {
      case 'fecha':       return it.fecha_registro_servicio || it.fecha || ''
      case 'mascota':     return (it.mascota_nombre || '').toLowerCase()
      case 'ciudad':      return (it.ciudad || '').toLowerCase()
      case 'veterinaria': return (it.veterinaria || '').toLowerCase()
      case 'plan':        return (it.plan_nombre || '').toLowerCase()
      case 'total':       return valorARecoger(it) ?? 0
      case 'comision':    return Number(it.comision) || 0
      case 'recogido':    return Number(it.total_cobrado) || 0
      case 'diferencia':  return esFactMensual(it) ? pendienteAliado(it) : (diferenciaItem(it) ?? 0)
      case 'efectivo':    return Number(it.efectivo) || 0
      case 'digital':     return Number(it.digital) || 0
      case 'transporte':  return Number(it.transporte_reconocido) || 0
      case 'pago':        return Number(it.pago_servicio) || 0
      case 'recargo':     return Number(it.recargo_aplicado) || 0
      case 'lejania':     return it.es_lejania ? 1 : 0
      default:            return 0
    }
  }
  // ── Filtros de la tabla del cuadre ──────────────────────────────────────────
  // `estados` es un Set de chips activos (OR entre ellos). Los demás campos son
  // de selección única y se combinan con AND entre grupos.
  const [filtroCuadre, setFiltroCuadre] = useState({ q: '', vet: '', ciudad: '', plan: '', medio: '', estados: new Set() })
  const filtroCuadreActivo = !!(filtroCuadre.q || filtroCuadre.vet || filtroCuadre.ciudad || filtroCuadre.plan || filtroCuadre.medio || filtroCuadre.estados.size)
  function limpiarFiltroCuadre() {
    setFiltroCuadre({ q: '', vet: '', ciudad: '', plan: '', medio: '', estados: new Set() })
  }
  function toggleEstadoFiltro(k) {
    setFiltroCuadre(prev => {
      const estados = new Set(prev.estados)
      estados.has(k) ? estados.delete(k) : estados.add(k)
      return { ...prev, estados }
    })
  }
  // Opciones únicas para los desplegables (a partir de los ítems del cuadre).
  const opcionesCuadre = useMemo(() => {
    const vets = new Set(), ciudades = new Set(), planes = new Set()
    for (const it of cuadreItems) {
      if (it.veterinaria)  vets.add(it.veterinaria)
      if (it.ciudad)       ciudades.add(it.ciudad)
      if (it.plan_nombre)  planes.add(it.plan_nombre)
    }
    const ord = s => [...s].sort((a, b) => a.localeCompare(b, 'es'))
    return { vets: ord(vets), ciudades: ord(ciudades), planes: ord(planes) }
  }, [cuadreItems])
  function itemPasaFiltro(it) {
    const f = filtroCuadre
    if (f.q) {
      const q = f.q.toLowerCase()
      const hay = [it.mascota_nombre, it.ciudad, it.veterinaria, it.plan_nombre]
        .some(v => (v || '').toLowerCase().includes(q))
      if (!hay) return false
    }
    if (f.vet    && it.veterinaria !== f.vet)    return false
    if (f.ciudad && it.ciudad      !== f.ciudad) return false
    if (f.plan   && it.plan_nombre !== f.plan)   return false
    if (f.medio) {
      const ef = Number(it.efectivo) > 0, di = Number(it.digital) > 0
      if (f.medio === 'efectivo' && !(ef && !di)) return false
      if (f.medio === 'digital'  && !(di && !ef)) return false
      if (f.medio === 'mixto'    && !(ef && di))  return false
    }
    if (f.estados.size > 0) {
      const match =
        (f.estados.has('alerta')       && (faltaPlata(it) || cobroDeMasSinRevisar(it))) ||
        (f.estados.has('cancelado')    && it.es_cancelado) ||
        (f.estados.has('sin_recibo')   && it.sin_recibo) ||
        (f.estados.has('fact_mensual') && esFactMensual(it)) ||
        (f.estados.has('lejania')      && it.es_lejania)
      if (!match) return false
    }
    return true
  }
  const cuadreItemsFiltrados = filtroCuadreActivo ? cuadreItems.filter(itemPasaFiltro) : cuadreItems

  const cuadreItemsOrden = orden.key
    ? [...cuadreItemsFiltrados].sort((a, b) => {
        const va = valorOrden(a, orden.key), vb = valorOrden(b, orden.key)
        const c = (typeof va === 'number' && typeof vb === 'number')
          ? va - vb
          : String(va).localeCompare(String(vb), 'es')
        return orden.dir === 'desc' ? -c : c
      })
    : cuadreItemsFiltrados

  function nombreTecnicoSel(id = cuadreTec) {
    const t = tecnicos.find(t => t.id === id)
    if (t) return `${t.nombre} ${t.apellido || ''}`.trim()
    // Técnico inactivo (no está en el selector): usar el join del cuadre abierto
    // desde el historial, para que cabecera y PDF no salgan sin nombre.
    const p = cuadreData?.tecnico_id === id ? cuadreData?.personal : null
    return p ? `${p.nombre} ${p.apellido || ''}`.trim() : '—'
  }

  // ── Confirmación del técnico sobre el cuadre (migración 032) ────────────────
  // El snapshot del monto detecta si el cuadre cambió (regenerado o editado)
  // después de que el técnico confirmó → la confirmación queda desactualizada.
  function confirmacionTecnico(c) {
    if (!c?.tecnico_confirmado_en) return 'SIN_CONFIRMACION'
    return Number(c.tecnico_confirmado_monto) === Number(c.dinero_a_entregar)
      ? 'CONFIRMADO' : 'CONFIRMACION_DESACTUALIZADA'
  }
  function ChipConfirmacionTec({ cuadre }) {
    const conf = confirmacionTecnico(cuadre)
    if (conf === 'CONFIRMADO')
      return (
        <span title={`Confirmado el ${new Date(cuadre.tecnico_confirmado_en).toLocaleString('es-CO')}${cuadre.tecnico_observacion ? ` · Observación: ${cuadre.tecnico_observacion}` : ''}`}
          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1 whitespace-nowrap">
          <Check size={10} /> Técnico confirmó
        </span>
      )
    if (conf === 'CONFIRMACION_DESACTUALIZADA')
      return (
        <span title="El técnico confirmó cuando los montos eran otros (el cuadre se regeneró o editó después). Pídele que lo revise de nuevo en su app."
          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
          ⚠ Confirmó otra versión
        </span>
      )
    return (
      <span title="El técnico aún no confirma este cuadre desde su app (Mis pagos › Cuadres)"
        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">
        Sin confirmar
      </span>
    )
  }

  // ── Historial de cuadres (borradores + cerrados) ────────────────────────────
  async function cargarHistorial() {
    setHistLoading(true)
    try {
      const { data } = await db
        .from('cuadres_tecnico')
        .select('*, personal:tecnico_id ( nombre, apellido )')
        .order('created_at', { ascending: false })
        .limit(60)
      setHistorialCuadres(data || [])
    } catch (err) {
      console.error('[Finanzas] Error cargando historial de cuadres:', err)
      setHistorialCuadres([])
    } finally {
      setHistLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'tecnicos' && historialCuadres === null && !histLoading) cargarHistorial()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Descarta un BORRADOR que no se usó (probar rangos deja varios solapados del
  // mismo técnico). Un CERRADO nunca: es la constancia del dinero entregado.
  // No toca recibos ni servicios — el borrador es un cálculo, no un hecho: esos
  // servicios vuelven a entrar al generar el cuadre de nuevo.
  async function descartarBorrador(c) {
    const quien  = c.personal ? `${c.personal.nombre} ${c.personal.apellido || ''}`.trim() : 'el técnico'
    const rango  = `${fmtFecha(c.fecha_desde)} → ${fmtFecha(c.fecha_hasta)}`
    const avisos = []
    if (c.tecnico_confirmado_en) avisos.push('· El técnico ya firmó este borrador: su confirmación se pierde.')
    if (Number(c.total_servicios) > 0) avisos.push(`· Sus ${c.total_servicios} servicios vuelven a quedar libres para el próximo cuadre (no se borra ningún recibo ni servicio).`)
    const ok = await confirm(
      `Se descarta el borrador de ${quien} (${rango}).\n\n${avisos.join('\n')}`,
      { title: '¿Descartar este borrador?', variant: 'warning', confirmLabel: 'Descartar' })
    if (!ok) return
    setDescartando(c.id)
    try {
      const { error } = await db.rpc('eliminar_cuadre_borrador', {
        p_cuadre_id: c.id,
        p_actor_id:  personalData?.id || null,
      })
      if (error) throw error
      setHistorialCuadres(prev => prev ? prev.filter(x => x.id !== c.id) : prev)
      // Si el descartado era el que está abierto en pantalla, limpiar la vista
      if (cuadreData?.id === c.id) limpiarCuadre()
      setSaldosAFavor(prev => prev.filter(s => s.id !== c.id))
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'No se pudo descartar el borrador' })
    } finally {
      setDescartando(null)
    }
  }

  // ── Refresco en vivo del cuadre abierto ────────────────────────────────────
  // Refleja SIN recargar la confirmación del técnico (que llega desde su app) y
  // la confirmación de entrega del dinero. Polling ligero de UNA fila (el
  // proyecto no amplía el Realtime de Supabase). Solo parchea los campos de
  // confirmación/estado — NO los totales, para no pisar ediciones locales en curso.
  useEffect(() => {
    const id = cuadreData?.id
    if (!id) return
    // Nada que vigilar si ya está CERRADO y con la entrega confirmada.
    if (cuadreData.estado === 'CERRADO' && cuadreData.entrega_confirmada_en) return
    const campos = ['estado', 'tecnico_confirmado_en', 'tecnico_confirmado_monto', 'tecnico_observacion',
      'entrega_confirmada_en', 'entrega_confirmada_por', 'entrega_confirmada_monto', 'entrega_notas']
    let vivo = true
    let lastSig = campos.map(k => String(cuadreData?.[k] ?? '')).join('|')
    const tick = async () => {
      const { data } = await db.from('cuadres_tecnico')
        .select(campos.join(', ')).eq('id', id).maybeSingle()
      if (!vivo || !data) return
      const sig = campos.map(k => String(data[k] ?? '')).join('|')
      if (sig === lastSig) return
      lastSig = sig
      const patch = Object.fromEntries(campos.map(k => [k, data[k]]))
      setCuadreData(prev => (prev && prev.id === id) ? { ...prev, ...patch } : prev)
      setHistorialCuadres(prev => prev ? prev.map(c => c.id === id ? { ...c, ...patch } : c) : prev)
    }
    const iv = setInterval(tick, 12000)
    return () => { vivo = false; clearInterval(iv) }
  }, [cuadreData?.id, cuadreData?.estado, cuadreData?.entrega_confirmada_en]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abre un cuadre del historial en la vista normal: carga cabecera + items en
  // los mismos estados que generarCuadre, así el PDF, el read-only de CERRADO y
  // el "Actualizar cuadre" de BORRADOR funcionan sin código aparte.
  // Sugerencias del técnico (bitácora, migración 033) para los servicios del
  // cuadre. Capa "sombra": solo se muestran para comparar, NUNCA mueven el
  // dinero_a_entregar ni los valores del cuadre.
  async function cargarAjustesTecnico(items, tecnicoId) {
    setAjustesTecnico({})
    const ids = [...new Set((items || []).map(it => it.servicio_id).filter(Boolean))]
    if (!ids.length || !tecnicoId) return
    try {
      const map = {}
      for (let i = 0; i < ids.length; i += 80) {
        const { data } = await db.from('bitacora_ajustes_tecnico')
          .select('servicio_id, cobrado_sugerido, medios_sugeridos, reconocido_sugerido, nota')
          .eq('tecnico_id', tecnicoId).in('servicio_id', ids.slice(i, i + 80))
        for (const a of (data || [])) map[a.servicio_id] = a
      }
      setAjustesTecnico(map)
    } catch { /* la comparación es opcional; si falla, el cuadre sigue igual */ }
  }

  // Recategorizaciones (cambio de plan / recálculo por peso) para etiquetar las
  // mascotas del cuadre y estar alerta del cambio.
  async function cargarRecategorizaciones(items) {
    setRecatServicios({})
    const ids = [...new Set((items || []).map(it => it.servicio_id).filter(Boolean))]
    if (!ids.length) return
    setRecatServicios(await recategorizacionesPorServicio(ids))
  }

  // La fecha contable del item corresponde al recibo. Para mostrar el servicio
  // usamos su fecha de registro sin alterar periodos, recargos ni snapshots.
  async function conFechaRegistroServicio(items) {
    const lista = items || []
    const ids = [...new Set(lista.map(it => it.servicio_id).filter(Boolean))]
    if (!ids.length) return lista
    const fechas = {}
    for (let i = 0; i < ids.length; i += 80) {
      const { data, error } = await db.from('servicios')
        .select('id, fecha_ingreso').in('id', ids.slice(i, i + 80))
      if (error) throw error
      for (const servicio of (data || [])) fechas[servicio.id] = servicio.fecha_ingreso
    }
    return lista.map(it => ({
      ...it,
      fecha_registro_servicio: fechas[it.servicio_id] || null,
    })).sort((a, b) => {
      const fechaA = a.fecha_registro_servicio || a.fecha || ''
      const fechaB = b.fecha_registro_servicio || b.fecha || ''
      return fechaA.localeCompare(fechaB) || String(a.hora || '').localeCompare(String(b.hora || ''))
    })
  }

  async function abrirCuadre(hdr) {
    setCuadreLoading(true); setCuadreError('')
    try {
      const { data: items, error } = await db
        .from('cuadre_items').select('*').eq('cuadre_id', hdr.id).order('fecha').order('hora')
      if (error) throw error
      const itemsConFechaRegistro = await conFechaRegistroServicio(items)
      setCuadreTec(hdr.tecnico_id)
      setCuadreDesde(hdr.fecha_desde)
      setCuadreHasta(hdr.fecha_hasta)
      setCuadreAjustes(Number(hdr.ajustes_manuales) ? String(hdr.ajustes_manuales) : '')
      setCuadreAjusteMot(hdr.ajustes_motivo || '')
      setCuadreData(hdr); setCuadreItems(itemsConFechaRegistro)
      setIaAnalisis(null)
      cargarAjustesTecnico(itemsConFechaRegistro, hdr.tecnico_id)
      cargarRecategorizaciones(itemsConFechaRegistro)
      cargarSaldosAFavor(hdr)
      cargarEntregaNombre(hdr)
    } catch (err) {
      setCuadreError(parsearErrorDB(err))
    } finally {
      setCuadreLoading(false)
    }
  }

  // ── Aviso de saldo a favor (solo informativo, decisión David 2026-07-06) ────
  // Cuadres CERRADOS anteriores del técnico que quedaron con la empresa
  // debiéndole. No se arrastra automático: gerencia decide si compensarlo con
  // el Ajuste manual (+).
  async function cargarSaldosAFavor(hdr) {
    try {
      const { data } = await db
        .from('cuadres_tecnico')
        .select('id, fecha_desde, fecha_hasta, saldo_a_favor_tecnico')
        .eq('tecnico_id', hdr.tecnico_id)
        .eq('estado', 'CERRADO')
        .gt('saldo_a_favor_tecnico', 0)
        .neq('id', hdr.id)
        .order('fecha_hasta', { ascending: false })
      setSaldosAFavor(data || [])
    } catch {
      setSaldosAFavor([])
    }
  }

  // ── Confirmación de entrega del dinero (cuadres CERRADOS) ───────────────────
  async function cargarEntregaNombre(hdr) {
    if (!hdr.entrega_confirmada_por) { setEntregaPorNombre(null); return }
    const { data } = await db.from('personal').select('nombre, apellido')
      .eq('id', hdr.entrega_confirmada_por).single()
    setEntregaPorNombre(data ? `${data.nombre} ${data.apellido || ''}`.trim() : null)
  }

  async function confirmarEntrega(monto, notas) {
    try {
      const { error } = await db.rpc('confirmar_entrega_cuadre', {
        p_cuadre_id: cuadreData.id,
        p_actor_id:  personalData?.id || null,
        p_monto:     monto,
        p_notas:     notas || null,
      })
      if (error) throw error
      const patch = {
        entrega_confirmada_en:  new Date().toISOString(),
        entrega_confirmada_por: personalData?.id || null,
        entrega_monto:          monto,
        entrega_notas:          notas || null,
      }
      setCuadreData(prev => prev ? { ...prev, ...patch } : prev)
      setEntregaPorNombre(personalData ? `${personalData.nombre || ''} ${personalData.apellido || ''}`.trim() : null)
      setHistorialCuadres(prev => prev ? prev.map(c => c.id === cuadreData.id ? { ...c, ...patch } : c) : prev)
      setEntregaModal(false)
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al confirmar la entrega' })
    }
  }

  // ── Rango sugerido al elegir técnico ────────────────────────────────────────
  // desde = día siguiente al último cuadre CERRADO del técnico, hasta = hoy.
  // Fechas DATE con componentes locales (nunca toISOString: corre un día en UTC-5).
  const fmtISOLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const tecSelRef = useRef('')   // último técnico elegido (evita que una respuesta vieja pise las fechas)

  async function seleccionarTecnico(id) {
    setCuadreTec(id)
    tecSelRef.current = id
    if (!id || cuadreData) return
    const hoy = fmtISOLocal(new Date())
    setCuadreHasta(hoy)
    const { data } = await db
      .from('cuadres_tecnico')
      .select('fecha_hasta').eq('tecnico_id', id).eq('estado', 'CERRADO')
      .order('fecha_hasta', { ascending: false }).limit(1)
    if (tecSelRef.current !== id) return   // el usuario ya cambió de técnico
    const ult = data?.[0]?.fecha_hasta
    if (ult) {
      const d = parseDate(ult)
      d.setDate(d.getDate() + 1)
      const desde = fmtISOLocal(d)
      setCuadreDesde(desde <= hoy ? desde : hoy)
    }
  }

  async function generarCuadre() {
    if (!cuadreTec || !cuadreDesde || !cuadreHasta) {
      setCuadreError('Selecciona el técnico y el rango de fechas.')
      return
    }
    if (cuadreHasta < cuadreDesde) {
      setCuadreError('La fecha "hasta" no puede ser anterior a "desde".')
      return
    }
    setCuadreLoading(true); setCuadreError('')
    try {
      const { data, error } = await db.rpc('generar_cuadre_tecnico', {
        p_tecnico_id:       cuadreTec,
        p_desde:            cuadreDesde,
        p_hasta:            cuadreHasta,
        p_actor_id:         personalData?.id || null,
        p_ajustes_manuales: parseFloat(cuadreAjustes) || 0,
        p_ajustes_motivo:   cuadreAjusteMot.trim() || null,
      })
      if (error) throw error
      const cid = data.cuadre_id
      const [{ data: hdr }, { data: items }] = await Promise.all([
        db.from('cuadres_tecnico').select('*').eq('id', cid).single(),
        db.from('cuadre_items').select('*').eq('cuadre_id', cid).order('fecha').order('hora'),
      ])
      const itemsConFechaRegistro = await conFechaRegistroServicio(items)
      setCuadreData(hdr); setCuadreItems(itemsConFechaRegistro)
      setEntregaPorNombre(null); setIaAnalisis(null)
      cargarAjustesTecnico(itemsConFechaRegistro, hdr.tecnico_id)
      cargarRecategorizaciones(itemsConFechaRegistro)
      cargarSaldosAFavor(hdr)
    } catch (err) {
      setCuadreError(parsearErrorDB(err))
    } finally {
      setCuadreLoading(false)
    }
  }

  async function cerrarCuadre(motivoForzado) {
    if (!cuadreData) return
    // Confirmación bilateral (decisión David 2026-07-08, endurece la de 2026-07-06):
    // el cierre queda BLOQUEADO hasta que el técnico firme el borrador desde su
    // app (Mis pagos › Cuadres). Excepción: coordinador/admin puede forzar el
    // cierre con un motivo OBLIGATORIO que queda registrado en firma.cierre_forzado.
    // El gate real vive en la DB (cerrar_cuadre v2, migración 038) — esta UI solo
    // recoge el motivo. OJO: onClick pasa el evento como argumento → validar tipo.
    const motivo = typeof motivoForzado === 'string' && motivoForzado.trim() ? motivoForzado.trim() : null
    const confTec = confirmacionTecnico(cuadreData)
    if (confTec !== 'CONFIRMADO' && !motivo) { setMotivoCierreOpen(true); return }
    // El cuadre SIEMPRE se puede cerrar (queda a saldo con el técnico). Un pago
    // pendiente NO bloquea. Solo se avisa cuando falta un comprobante de pago,
    // cuando el técnico recogió de menos o cuando cobró de más sobre el valor
    // a recoger sin revisar; el coordinador puede cerrar de todas formas.
    const idsDigitalCuadre = [...new Set(cuadreItems
      .filter(it => !it.es_cancelado && Number(it.digital) > 0 && it.servicio_id)
      .map(it => it.servicio_id))]
    let comprobantesCuadre = comprobantesSet
    if (idsDigitalCuadre.some(id => !comprobantesCuadre.has(id))) {
      // Solo alimenta el aviso de abajo: si falla, se cierra igual con lo que haya.
      try {
        const { comprobantes } = await enriquecerServicios(idsDigitalCuadre.map(id => ({ id })), { incluirComprobantes: true })
        comprobantesCuadre = new Set([...comprobantesCuadre, ...comprobantes])
        setComprobantesSet(comprobantesCuadre)
      } catch (err) {
        console.error('[Finanzas] No se pudieron verificar los comprobantes del cuadre:', err)
      }
    }
    const faltanComprobante = cuadreItems.filter(it =>
      !it.es_cancelado && Number(it.digital) > 0 && !comprobantesCuadre.has(it.servicio_id))
    const debenTecnico = cuadreItems.filter(tecnicoDebe)
    const cobrosDeMas = cuadreItems.filter(cobroDeMasSinRevisar)
    if (faltanComprobante.length || debenTecnico.length || cobrosDeMas.length) {
      const partes = []
      if (faltanComprobante.length)
        partes.push(`• ${faltanComprobante.length} pago(s) digital(es) SIN comprobante subido: ${faltanComprobante.map(it => it.mascota_nombre || '—').join(', ')}`)
      if (debenTecnico.length) {
        const monto = debenTecnico.reduce((a, it) => a + (diferenciaItem(it) || 0), 0)
        partes.push(`• El técnico debe ${fmt(monto)} en efectivo (recogió de menos y la fila sigue SIN REVISAR): ${debenTecnico.map(it => it.mascota_nombre || '—').join(', ')}`)
      }
      if (cobrosDeMas.length) {
        const monto = cobrosDeMas.reduce((a, it) => a + excesoValorARecoger(it), 0)
        partes.push(`• Hay ${fmt(monto)} cobrados de más sobre el valor a recoger (fila SIN REVISAR): ${cobrosDeMas.map(it => it.mascota_nombre || '—').join(', ')}`)
      }
      if (!await confirm(`Antes de cerrar, revisa:\n\n${partes.join('\n\n')}\n\nPuedes cerrar de todas formas, pero estos casos quedarán congelados así.`, { title: 'Hay pendientes por revisar', variant: 'warning', confirmLabel: 'Cerrar de todas formas' })) return
    }
    // Doble verificación (feature 4): 1) advertencia de congelado, 2) confirmación del monto.
    if (!await confirm('Una vez cerrado, el cuadre queda congelado y no se podrá editar. El técnico confirma el dinero a entregar.', { title: '¿Cerrar cuadre?', variant: 'warning', confirmLabel: 'Continuar' })) return
    if (!await confirm(`Confirma que el dinero a entregar a gerencia es ${fmt(cuadreData.dinero_a_entregar)} y que el cuadre quedará inmutable. Esta acción no se puede deshacer.`, { title: 'Confirmación final', variant: 'warning', confirmLabel: 'Sí, cerrar definitivamente' })) return
    setCerrando(true)
    try {
      const firma = {
        tecnico:        nombreTecnicoSel(cuadreData.tecnico_id),
        confirmado_en:  new Date().toISOString(),
        cerrado_por:    personalData ? `${personalData.nombre || ''} ${personalData.apellido || ''}`.trim() : null,
        // Trazabilidad de la confirmación bilateral al momento del cierre.
        confirmacion_tecnico: confirmacionTecnico(cuadreData),
        tecnico_confirmado_en: cuadreData.tecnico_confirmado_en || null,
      }
      const { error } = await db.rpc('cerrar_cuadre', {
        p_cuadre_id:     cuadreData.id,
        p_actor_id:      personalData?.id || null,
        p_firma:         firma,
        p_forzar_motivo: motivo,
      })
      if (error) {
        if (/SIN_CONFIRMACION_TECNICO/.test(String(error.message || ''))) {
          setMotivoCierreOpen(true)
          return
        }
        throw error
      }
      const { data: hdr } = await db.from('cuadres_tecnico').select('*').eq('id', cuadreData.id).single()
      setCuadreData(hdr)
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al cerrar el cuadre' })
    } finally {
      setCerrando(false)
    }
  }

  function limpiarCuadre() {
    setCuadreData(null); setCuadreItems([]); setCuadreError(''); setRecatServicios({})
    setCuadreAjustes(''); setCuadreAjusteMot('')
    setSaldosAFavor([]); setEntregaPorNombre(null)
    setIaAnalisis(null)
    cargarHistorial()   // refleja el cuadre recién generado/cerrado en la lista
  }

  // Marca/desmarca lejanía manual en una fila del cuadre (solo BORRADOR).
  async function toggleLejania(item, aplica) {
    // Optimista en la fila
    setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, es_lejania: aplica } : it))
    try {
      const { data, error } = await db.rpc('set_cuadre_item_lejania', {
        p_item_id:  item.id,
        p_aplica:   aplica,
        p_actor_id: personalData?.id || null,
      })
      if (error) throw error
      // Refrescar fila (recargo recalculado) + cabecera (totales). La lejania vuelve al calculo automatico.
      const itemPatch = {
        es_lejania: aplica,
        recargo_aplicado: data.recargo_aplicado,
        recargo_manual_original: data.recargo_manual_original ?? null,
        recargo_manual_editado_en: data.recargo_manual_editado_en ?? null,
        recargo_manual_editado_por: null,
        recargo_manual_motivo: data.recargo_manual_motivo ?? null,
      }
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it))
      setCuadreData(prev => prev ? {
        ...prev,
        total_recargos:        data.total_recargos,
        total_reconocido:      data.total_reconocido,
        dinero_a_entregar:     data.dinero_a_entregar,
        saldo_a_favor_tecnico: data.saldo_a_favor_tecnico,
      } : prev)
    } catch (err) {
      // Revertir
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, es_lejania: !aplica } : it))
      await showAlert(parsearErrorDB(err), { title: 'Error al marcar lejanía' })
    }
  }

  // ── Diferencia y alerta por mascota (features 5, 7) ─────────────────────────
  // Valor a RECOGER = NETO que le queda a la empresa = bruto − comisión. Se
  // deriva del bruto (no del snapshot valor_a_recoger, que quedó = bruto en los
  // servicios registrados a domicilio con comisión NO descontada). Ver
  // netoCuadreItem — un único origen de verdad para tabla, modal y PDF.
  function valorARecoger(it) {
    return netoCuadreItem(it)
  }
  // Veterinaria de facturación mensual: el técnico no recoge efectivo; el aliado
  // nos debe el neto (bruto − comisión), que se cobra en la factura mensual.
  function esFactMensual(it) {
    return it.modalidad_comision === 'FACTURACION_MENSUAL'
  }
  // Lo que el aliado de facturación mensual nos debe = bruto − comisión (neto).
  function pendienteAliado(it) {
    if (it.valor_a_cobrar == null) return 0
    return (Number(it.valor_a_cobrar) || 0) - (Number(it.comision) || 0)
  }
  // Diferencia con BANDA aceptable [neto … bruto]: el técnico puede recoger el neto
  // (la comisión la maneja la veterinaria) o el bruto (recogió todo, incl. comisión)
  // y en ambos casos está cuadrado. Solo es diferencia si recogió DE MENOS (< neto)
  // o DE MÁS (> bruto). NULL si no aplica.
  function diferenciaItem(it) {
    if (it.es_cancelado || esFactMensual(it)) return null
    const neto = valorARecoger(it)
    if (neto == null) return null
    const bruto = it.valor_a_cobrar != null ? Number(it.valor_a_cobrar) : neto
    const recogido = Number(it.total_cobrado) || 0
    if (recogido < neto)  return neto - recogido    // falta (+)
    if (recogido > bruto) return bruto - recogido   // de más (−)
    return 0
  }
  // Cobro por encima del valor a recoger visible para gerencia. Aunque la
  // comision explique parte del valor, debe quedar como pendiente de gestion.
  function excesoValorARecoger(it) {
    if (it.es_cancelado || esFactMensual(it)) return 0
    const neto = valorARecoger(it)
    if (neto == null) return 0
    const recogido = Number(it.total_cobrado) || 0
    return recogido > neto ? recogido - neto : 0
  }
  function cobroDeMasSinRevisar(it) {
    return excesoValorARecoger(it) > 0
      && !it.estado_conciliacion
      && !it.conciliacion_resuelta
  }
  // ¿Falta plata sin cerrar? (alerta visual ámbar). Cualquier faltante que no esté
  // ya marcado como Verificado OK. Fact. mensual se gestiona aparte (no es del técnico).
  function faltaPlata(it) {
    if (esFactMensual(it)) return false
    const d = diferenciaItem(it)
    return d != null && d > 0
      && it.estado_conciliacion !== 'VERIFICADO'
      && !it.conciliacion_resuelta
  }
  // El técnico de VERDAD debe efectivo: recogió de menos y la fila está SIN
  // REVISAR. "Verificado OK" (saldado) y "Pendiente gestionar" (el cliente/vet
  // debe) son decisiones conscientes del coordinador → no avisan al cerrar.
  function tecnicoDebe(it) {
    if (esFactMensual(it)) return false
    const d = diferenciaItem(it)
    return d != null && d > 0
      && !it.estado_conciliacion
      && !it.conciliacion_resuelta
  }
  // ¿Debe estar en Conciliaciones? Pendiente gestionar, facturación mensual, o
  // sin recibo (el técnico recogió pero no cobró → hay que cobrarlo).
  function enConciliacion(it) {
    return !it.conciliacion_resuelta
      && (it.estado_conciliacion === 'PENDIENTE_GESTIONAR' || esFactMensual(it) || it.sin_recibo)
  }
  // Monto pendiente por cobrar de un item (técnico: diferencia; aliado: neto).
  function montoPendiente(it) {
    if (esFactMensual(it)) return pendienteAliado(it)
    const d = diferenciaItem(it)
    return d > 0 ? d : 0
  }
  // Estado sugerido (el coordinador puede cambiarlo). Facturacion mensual,
  // faltante o cobro de más sobre el valor a recoger -> pendiente gestionar.
  // Solo queda OK cuando el recogido coincide con lo esperado.
  function estadoSugerido(it) {
    if (esFactMensual(it)) return 'PENDIENTE_GESTIONAR'
    const d = diferenciaItem(it)
    if (d == null) return null
    return d > 0 || excesoValorARecoger(it) > 0 ? 'PENDIENTE_GESTIONAR' : 'VERIFICADO'
  }
  // Explicación en lenguaje claro de POR QUÉ una fila requiere atención (guía
  // para gerencia). Solo reglas sobre datos que ya existen — null si la fila
  // está cuadrada y no hay nada que explicar (sin ruido).
  function explicacionItem(it) {
    if (it.es_cancelado) {
      const recon = (Number(it.pago_servicio) || 0) + (Number(it.recargo_aplicado) || 0)
      return `Servicio cancelado: se le reconoce ${fmt(recon)} al técnico por el viaje; no hay cobro al cliente. Puedes ajustar ese pago con el lápiz de "Pago téc." (y el recargo o la lejanía si el viaje lo justifica).`
    }
    if (it.conciliacion_resuelta)
      return 'Pendiente ya resuelto: el cobro se gestionó.'
    if (it.sin_recibo)
      return `El técnico recogió pero no generó recibo (no cobró). Falta cobrar ${fmt(montoPendiente(it))} ${esFactMensual(it) ? 'a la veterinaria (facturación mensual)' : 'al cliente'} — se sigue en Conciliaciones.`
    if (esFactMensual(it))
      return `Veterinaria de facturación mensual: el técnico no recoge esta plata; el aliado nos debe ${fmt(pendienteAliado(it))} con la factura del mes.`
    const d = diferenciaItem(it)
    if (d == null) return null
    const neto = valorARecoger(it)
    const recogido = Number(it.total_cobrado) || 0
    const exceso = excesoValorARecoger(it)
    if (d > 0)
      return `Recogió ${fmt(recogido)} de ${fmt(neto)} — faltan ${fmt(d)}. Si el cliente o la veterinaria quedó debiendo, márcala "Pendiente gestionar"; si ya se saldó por otro lado, "Verificado OK".`
    if (exceso > 0)
      return `Recogió ${fmt(recogido)}, ${fmt(exceso)} por encima del valor a recoger (${fmt(neto)}). Márcala "Pendiente gestionar" para revisar si fue comisión cobrada, devolución o ajuste.`
    if (d < 0)
      return `Recogió ${fmt(recogido)}, ${fmt(-d)} por encima del valor con comisión incluida — revisa el comprobante o el valor del servicio.`
    return null
  }

  // Guarda estado de revisión + observaciones (solo BORRADOR). Optimista.
  async function guardarRevision(item, { estado, observaciones }) {
    const nuevoEstado = estado !== undefined ? estado : item.estado_conciliacion
    const nuevasObs   = observaciones !== undefined ? observaciones : item.observaciones
    setCuadreItems(prev => prev.map(it => it.id === item.id
      ? { ...it, estado_conciliacion: nuevoEstado, observaciones: nuevasObs } : it))
    try {
      const { error } = await db.rpc('set_cuadre_item_revision', {
        p_item_id: item.id,
        p_estado: nuevoEstado || null,
        p_observaciones: nuevasObs || null,
      })
      if (error) throw error
      // Refrescar la lista de Conciliaciones si está cargada (entra/sale según estado).
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, estado_conciliacion: nuevoEstado, observaciones: nuevasObs } : it)
              .filter(enConciliacion)
        : prev)
    } catch (err) {
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...item } : it))
      await showAlert(parsearErrorDB(err), { title: 'Error al guardar la revisión' })
    }
  }


  // Correccion manual del valor recogido por fila (solo ADMIN, solo BORRADOR).
  async function guardarValorRecogido(item, { total, motivo }) {
    const totalNum = Number(total)
    const digital = Number(item.digital) || 0
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      await showAlert('El valor recogido debe ser mayor o igual a cero.', { title: 'Valor inválido' })
      return false
    }
    if (totalNum < digital) {
      await showAlert(`El valor recogido no puede ser menor al valor digital registrado (${fmt(digital)}).`, { title: 'Valor inválido' })
      return false
    }
    try {
      const { data, error } = await db.rpc('set_cuadre_item_valor_recogido', {
        p_item_id:        item.id,
        p_total_cobrado:  totalNum,
        p_actor_id:       personalData?.id || null,
        p_motivo:         motivo || null,
      })
      if (error) throw error
      const itemPatch = {
        total_cobrado: data.total_cobrado,
        efectivo: data.efectivo,
        digital: data.digital,
        valor_recogido_original: data.valor_recogido_original,
        valor_recogido_editado_en: data.valor_recogido_editado_en,
        valor_recogido_editado_por: personalData?.id || null,
        valor_recogido_motivo: data.valor_recogido_motivo,
      }
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it))
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it).filter(enConciliacion)
        : prev)
      setCuadreData(prev => prev ? {
        ...prev,
        total_cobrado: data.total_cobrado_cuadre,
        efectivo_recibido: data.efectivo_recibido,
        digital_empresa: data.digital_empresa,
        total_transporte: data.total_transporte,
        total_recargos: data.total_recargos,
        total_pago_servicio: data.total_pago_servicio,
        total_cancelados: data.total_cancelados,
        total_reconocido: data.total_reconocido,
        dinero_a_entregar: data.dinero_a_entregar,
        saldo_a_favor_tecnico: data.saldo_a_favor_tecnico,
      } : prev)
      return true
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al ajustar valor recogido' })
      return false
    }
  }


  // Reclasificar el reparto de medios de una fila (efectivo↔digital) sin mover
  // el total. Caso: cobró y registró EFECTIVO pero le pagaron por Nequi a la
  // empresa. ADMIN o COORDINADOR, solo BORRADOR, motivo obligatorio (migración 062).
  async function guardarMediosItem(item, { medios, motivo }) {
    const suma = medios.reduce((a, m) => a + (Number(m.monto) || 0), 0)
    const total = Number(item.total_cobrado)
      || (Number(item.efectivo) || 0) + (Number(item.digital) || 0)
    if (Math.round(suma) !== Math.round(total)) {
      await showAlert(`Los medios suman ${fmt(suma)} pero la fila tiene recogido ${fmt(total)}. Para cambiar el total usa "Modificar valor recogido".`, { title: 'No cuadra el total' })
      return false
    }
    try {
      const { data, error } = await db.rpc('set_cuadre_item_medios', {
        p_item_id:  item.id,
        p_medios:   medios.map(m => ({ metodo: m.metodo, monto: Number(m.monto) || 0 })),
        p_actor_id: personalData?.id || null,
        p_motivo:   motivo || null,
      })
      if (error) throw error
      const itemPatch = {
        medios_pago: data.medios_pago,
        medios_pago_original: data.medios_pago_original,
        efectivo: data.efectivo,
        digital: data.digital,
        total_cobrado: data.total_cobrado,
        medios_editado_en: data.medios_editado_en,
        medios_editado_por: personalData?.id || null,
        medios_motivo: data.medios_motivo,
      }
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it))
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it).filter(enConciliacion)
        : prev)
      setCuadreData(prev => prev ? {
        ...prev,
        total_cobrado: data.total_cobrado_cuadre,
        efectivo_recibido: data.efectivo_recibido,
        digital_empresa: data.digital_empresa,
        total_transporte: data.total_transporte,
        total_recargos: data.total_recargos,
        total_pago_servicio: data.total_pago_servicio,
        total_cancelados: data.total_cancelados,
        total_reconocido: data.total_reconocido,
        dinero_a_entregar: data.dinero_a_entregar,
        saldo_a_favor_tecnico: data.saldo_a_favor_tecnico,
      } : prev)
      return true
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al reclasificar medios' })
      return false
    }
  }


  // Correccion manual del recargo por fila (solo ADMIN, solo BORRADOR).
  async function guardarRecargoManual(item, { recargo, motivo }) {
    const recargoNum = Number(recargo)
    if (!Number.isFinite(recargoNum) || recargoNum < 0) {
      await showAlert('El recargo debe ser mayor o igual a cero.', { title: 'Valor inválido' })
      return false
    }
    try {
      const { data, error } = await db.rpc('set_cuadre_item_recargo_manual', {
        p_item_id:          item.id,
        p_recargo_aplicado: recargoNum,
        p_actor_id:         personalData?.id || null,
        p_motivo:           motivo || null,
      })
      if (error) throw error
      const itemPatch = {
        recargo_aplicado: data.recargo_aplicado,
        recargo_manual_original: data.recargo_manual_original,
        recargo_manual_editado_en: data.recargo_manual_editado_en,
        recargo_manual_editado_por: personalData?.id || null,
        recargo_manual_motivo: data.recargo_manual_motivo,
      }
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it))
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it).filter(enConciliacion)
        : prev)
      setCuadreData(prev => prev ? {
        ...prev,
        total_recargos: data.total_recargos,
        total_reconocido: data.total_reconocido,
        dinero_a_entregar: data.dinero_a_entregar,
        saldo_a_favor_tecnico: data.saldo_a_favor_tecnico,
      } : prev)
      return true
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al ajustar recargo' })
      return false
    }
  }

  // Correccion manual del pago reconocido al tecnico por fila (BORRADOR).
  // Sirve sobre todo en los CANCELADOS: el viaje perdido trae una tarifa fija
  // igual para todos y aqui se ajusta al viaje real (migracion 067).
  async function guardarPagoTecnico(item, { pago, motivo }) {
    const pagoNum = Number(pago)
    if (!Number.isFinite(pagoNum) || pagoNum < 0) {
      await showAlert('El pago al técnico debe ser mayor o igual a cero.', { title: 'Valor inválido' })
      return false
    }
    try {
      const { data, error } = await db.rpc('set_cuadre_item_pago_servicio', {
        p_item_id:  item.id,
        p_pago:     pagoNum,
        p_actor_id: personalData?.id || null,
        p_motivo:   motivo || null,
      })
      if (error) throw error
      const itemPatch = {
        pago_servicio: data.pago_servicio,
        pago_servicio_original: data.pago_servicio_original,
        pago_servicio_editado_en: data.pago_servicio_editado_en,
        pago_servicio_editado_por: personalData?.id || null,
        pago_servicio_motivo: data.pago_servicio_motivo,
      }
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it))
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, ...itemPatch } : it).filter(enConciliacion)
        : prev)
      setCuadreData(prev => prev ? {
        ...prev,
        total_pago_servicio: data.total_pago_servicio,
        total_cancelados: data.total_cancelados,
        total_reconocido: data.total_reconocido,
        dinero_a_entregar: data.dinero_a_entregar,
        saldo_a_favor_tecnico: data.saldo_a_favor_tecnico,
      } : prev)
      return true
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al ajustar el pago al técnico' })
      return false
    }
  }
  // Gestión de conciliación: vía / resuelta / notas. Funciona aunque esté CERRADO.
  // Actualiza tanto el cuadre abierto como la lista de Conciliaciones.
  async function guardarConciliacion(item, { via, resuelta, notas }) {
    try {
      const { error } = await db.rpc('set_cuadre_item_conciliacion', {
        p_item_id: item.id,
        p_via: via !== undefined ? (via || null) : (item.conciliacion_via || null),
        p_resuelta: resuelta !== undefined ? resuelta : null,
        p_notas: notas !== undefined ? (notas || null) : null,
      })
      if (error) throw error
      const patch = {}
      if (via !== undefined)      patch.conciliacion_via = via || null
      if (resuelta !== undefined) patch.conciliacion_resuelta = resuelta
      if (notas !== undefined)    patch.observaciones = notas || null
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, ...patch } : it))
      setConciliaciones(prev => prev
        ? prev.map(it => it.id === item.id ? { ...it, ...patch } : it)
              .filter(it => !it.conciliacion_resuelta)
        : prev)
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al gestionar la conciliación' })
    }
  }

  // ── Conciliaciones: items con plata faltante pendientes (de cualquier cuadre) ─
  async function cargarConciliaciones() {
    setConcilLoading(true)
    try {
      const { data } = await db
        .from('cuadre_items')
        .select(`*, cuadres_tecnico:cuadre_id ( id, estado, fecha_desde, fecha_hasta,
          personal:tecnico_id ( nombre, apellido ) )`)
        .eq('conciliacion_resuelta', false)
        .or('estado_conciliacion.eq.PENDIENTE_GESTIONAR,modalidad_comision.eq.FACTURACION_MENSUAL,sin_recibo.eq.true')
        .order('fecha', { ascending: false })
      setConciliaciones(data || [])
    } catch (err) {
      console.error('[Finanzas] Error cargando conciliaciones:', err)
      setConciliaciones([])
    } finally {
      setConcilLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'conciliaciones' && conciliaciones === null && !concilLoading) cargarConciliaciones()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── "No cobrados": recibos del técnico sin cobro (pendiente / fact. mensual) ─
  async function cargarNoCobrados() {
    setNoCobLoading(true)
    try {
      const { data: recibos } = await db
        .from('recibos_tecnico')
        .select(`id, servicio_id, tecnico_id, numero_recibo, tipo, fecha_emision, valor_total, valor_cobrado, datos_form,
          servicios:servicio_id ( id, estado, estado_pago, valor_total, valor_pagado, metodo_pago, mascota_id, aliado_origen_id,
            aliados:aliado_origen_id ( nombre, modalidad_comision ),
            planes:plan_id ( nombre ) ),
          personal:tecnico_id ( nombre, apellido )`)
        .order('created_at', { ascending: false })
        .limit(800)

      // Conteo único por servicio (regla migración 027): un servicio puede tener
      // varios recibos (regenerado, o doble documento CLIENTE+VET del mismo
      // cobro) — cuenta el más reciente CON dinero; si ninguno cobró, el más
      // reciente. Sin esto, los recibos viejos en $0 salen como filas fantasma.
      const porServicio = {}
      for (const r of (recibos || [])) {
        const prev = porServicio[r.servicio_id]
        if (!prev) { porServicio[r.servicio_id] = r; continue }
        if ((prev.valor_cobrado || 0) === 0 && (r.valor_cobrado || 0) > 0) porServicio[r.servicio_id] = r
      }
      const unicos = Object.values(porServicio)
        .sort((a, b) => (b.fecha_emision || '').localeCompare(a.fecha_emision || ''))

      const clasificados = unicos.map(r => {
        const svc = r.servicios || {}
        const modalidad = svc.aliados?.modalidad_comision || null
        const pagoPend  = String(r.datos_form?.pago_pendiente) === 'true'
        let motivo = null
        if (pagoPend) motivo = 'PAGO_PENDIENTE'
        else if (modalidad === 'FACTURACION_MENSUAL') motivo = 'FACTURACION_MENSUAL'
        else if ((r.valor_cobrado || 0) === 0) motivo = 'SIN_COBRO'
        return { ...r, motivo }
      }).filter(r => {
        if (!r.motivo || r.servicios?.estado === 'CANCELADO') return false
        // Facturación mensual: se muestran TODOS (aunque tengan valor o ya estén
        // saldados) — son de gestión mensual con la veterinaria.
        if (r.motivo === 'FACTURACION_MENSUAL') return true
        // Pago pendiente / sin cobro: solo mientras no se complete el pago.
        return r.servicios?.estado_pago !== 'COMPLETO'
      })

      // Mascotas
      const mascIds = [...new Set(clasificados.map(r => r.servicios?.mascota_id).filter(Boolean))]
      const ms = await dbIn('mascotas', 'id_mascota, nombre, cliente_id', 'id_mascota', mascIds)
      const mascMap = Object.fromEntries(ms.map(m => [m.id_mascota, m]))
      const cliIds = [...new Set(ms.map(m => m.cliente_id).filter(Boolean))]
      const cs = await dbIn('clientes', 'id_cliente, nombre, apellido', 'id_cliente', cliIds)
      const cliMap = Object.fromEntries(cs.map(c => [c.id_cliente, c]))
      Object.values(mascMap).forEach(m => { m.cliente = cliMap[m.cliente_id] || null })

      // Última novedad NOTA por servicio
      const svcIds = [...new Set(clasificados.map(r => r.servicio_id).filter(Boolean))]
      const novs = await dbIn('novedades_servicio', 'servicio_id, descripcion, created_at, tipo_novedad',
        'servicio_id', svcIds, q => q.order('created_at', { ascending: false }))
      const novMap = {}
      ;(novs || []).forEach(n => { if (!novMap[n.servicio_id]) novMap[n.servicio_id] = n })

      const enriched = clasificados.map(r => {
        const masc = mascMap[r.servicios?.mascota_id] || null
        return { ...r, mascota: masc, cliente: masc?.cliente || null, novedad: novMap[r.servicio_id] || null }
      })
      setNoCobrados(enriched)
    } catch (err) {
      console.error('[Finanzas] Error cargando no cobrados:', err)
      setNoCobrados([])
    } finally {
      setNoCobLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'nocobrados' && noCobrados === null && !noCobLoading) cargarNoCobrados()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Asistente IA del cuadre: pide al backend la guía del cuadre abierto.
  // La IA solo explica y sugiere; los estados los confirma la persona.
  async function analizarConIA() {
    if (!cuadreData) return
    setIaLoading(true)
    try {
      const r = await orbitApi('/cuadres/ia/analizar', { method: 'POST', body: { cuadre_id: cuadreData.id } })
      setIaAnalisis(r.analisis || '')
    } catch (e) {
      await showAlert(e.message, { title: 'Error del asistente IA' })
    } finally {
      setIaLoading(false)
    }
  }

  async function descargarCuadrePDF() {
    if (!cuadreData) return
    setCuadrePdfGen(true)
    try {
      await generarCuadrePDF(cuadreData, cuadreItems, nombreTecnicoSel(cuadreData.tecnico_id))
    } catch (err) {
      const msg = String(err?.message || err)
      if (/dynamically imported module|Failed to fetch|Importing a module/i.test(msg)) {
        await showAlert('La app se actualizó. Recarga la página (Ctrl+Shift+R) e intenta de nuevo.', { title: 'Actualiza la página' })
      } else {
        await showAlert('Error al generar el PDF: ' + msg, { title: 'Error' })
      }
    } finally {
      setCuadrePdfGen(false)
    }
  }

  // ── Computed ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalFacturado   = resumenServicios.reduce((a, s) => a + (s.valor_total  || 0), 0)
    const totalRecaudado   = resumenServicios.reduce((a, s) => a + (s.valor_pagado || 0), 0)
    const porCobrar        = resumenServicios.reduce((a, s) => a + Math.max(0, (s.valor_total || 0) - (s.valor_pagado || 0)), 0)
    const pendientesComision = resumenServicios.filter(s => s.canal_entrada === 'ALIADO' && !s.comision_descontada && (s.comision_aliado || 0) > 0)
    const comisionesAliado = pendientesComision.reduce((a, s) => a + (s.comision_aliado || 0), 0)
    const aliadosConComision = new Set(pendientesComision.map(s => s.aliado_origen_id).filter(Boolean)).size
    const descuentosAdicionales = resumenServicios.reduce((a, s) => a + (s.descuento_adicional || 0), 0)
    return { totalFacturado, totalRecaudado, porCobrar, comisionesAliado, aliadosConComision, descuentosAdicionales }
  }, [resumenServicios])

  const resumenPendiente = resumenLoading && resumenServicios.length === 0

  // Cartera = todo lo que tiene saldo, sin importar la marca `estado_pago`
  // (los COMPLETO con saldo son un descuadre y hay que verlos, no esconderlos).
  const carteraSvcs = useMemo(() => {
    return servicios.filter(s => s.saldo > 0 && s.estado_pago !== 'CORTESIA')
  }, [servicios])

  // Un servicio marcado como pagado que todavía debe plata: la marca quedó vieja
  // (típicamente porque el valor subió después de cobrar).
  const esDescuadre = (s) => s.saldo > 0 && s.estado_pago === 'COMPLETO'

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
    let base = filtroCartera === 'TODOS' ? carteraSvcs
      : filtroCartera === 'DESCUADRE' ? carteraSvcs.filter(esDescuadre)
      : carteraSvcs.filter(s => s.estado_pago === filtroCartera)
    if (filtroAliado) base = base.filter(s => s.aliado_origen_id === filtroAliado)
    return base
  }, [carteraSvcs, filtroCartera, filtroAliado])

  const comisionesPorAliado = useMemo(() => {
    const svcAliados = (comisionesServicios || []).filter(
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
  }, [comisionesServicios])

  // ── Toggle comision_descontada individual (optimistic) ─────────────────────
  async function toggleComisionDescontada(svcId, nuevoValor) {
    const patchLocal = valor => {
      setServicios(prev => prev.map(s => s.id === svcId ? { ...s, comision_descontada: valor } : s))
      setComisionesServicios(prev => prev ? prev.map(s => s.id === svcId ? { ...s, comision_descontada: valor } : s) : prev)
      setResumenServicios(prev => prev.map(s => s.id === svcId ? { ...s, comision_descontada: valor } : s))
    }
    patchLocal(nuevoValor)
    const { error } = await db
      .from('servicios')
      .update({ comision_descontada: nuevoValor })
      .eq('id', svcId)
    if (error) {
      console.error('[Finanzas] Error toggling comision_descontada:', error)
      patchLocal(!nuevoValor)
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
          fecha_generacion: today(),
          notas:            `Liquidación de ${pendientes.length} servicio${pendientes.length !== 1 ? 's' : ''}`,
        })
      if (e2) throw e2

      await Promise.all([cargar(), cargarComisiones(true)])
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
    setPagoComprobante(null)
  }

  function cerrarPagoModal() {
    setPagoModal(null)
    setValorAbono('')
    setMetodoPago('EFECTIVO')
    setPagoNotas('')
    setPagoError('')
    setPagoSaving(false)
    setPagoComprobante(null)
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
      // 1. Subir el comprobante PRIMERO (si lo adjuntaron). Si falla, no tocamos el
      //    pago: el usuario corrige y reintenta sin haber movido dinero.
      let comprobante = null
      if (pagoComprobante) comprobante = await subirComprobantePago(pagoModal.id, pagoComprobante)

      // 2. Registrar el pago.
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

      // 3. Registrar el comprobante (no crítico: el pago ya quedó). Si falla, se
      //    avisa pero NO se revierte el pago.
      let avisoComprobante = null
      if (comprobante) {
        const { error: ce } = await db.from('recibo_comprobantes').insert({
          servicio_id:  pagoModal.id,
          bucket:       comprobante.bucket,
          storage_path: comprobante.storage_path,
          mime_type:    comprobante.mime_type,
          estado:       'APROBADO',
          uploaded_by:  personalData?.id || null,
        })
        if (ce) avisoComprobante = ce.message
      }

      cerrarPagoModal()
      await cargar()
      if (comisionesServicios !== null) cargarComisiones(true)
      if (historialServicios !== null) cargarHistorialServicios(true)
      if (noCobrados !== null) cargarNoCobrados()
      if (avisoComprobante)
        await showAlert('El pago se registró, pero el comprobante no se pudo guardar: ' + avisoComprobante + '\n\nVuelve a adjuntarlo desde el pago.', { title: 'Comprobante no guardado', variant: 'warning' })
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
  function tipoMascota(s) {
    return s.mascota?.especies?.nombre || '—'
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
          onClick={actualizarFinanzas}
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
                value={resumenPendiente ? '...' : fmt(kpis.totalFacturado)}
                sub={resumenPendiente ? 'Actualizando resumen' : `${resumenServicios.length} servicio${resumenServicios.length !== 1 ? 's' : ''}`}
                color="#1A5CD8"
              />
              <KpiCard
                icon={<TrendingUp size={18} className="text-[#16a34a]" />}
                label="Recaudado"
                value={resumenPendiente ? '...' : fmt(kpis.totalRecaudado)}
                sub={resumenPendiente
                  ? 'Actualizando resumen'
                  : kpis.totalFacturado > 0
                    ? `${Math.round((kpis.totalRecaudado / kpis.totalFacturado) * 100)}% del total`
                    : '—'}
                color="#16a34a"
              />
              <KpiCard
                icon={<AlertCircle size={18} className="text-[#DC2626]" />}
                label="Por cobrar"
                value={resumenPendiente ? '...' : fmt(kpis.porCobrar)}
                sub={`${carteraSvcs.length} saldo${carteraSvcs.length !== 1 ? 's' : ''} pendiente${carteraSvcs.length !== 1 ? 's' : ''}`}
                color="#DC2626"
              />
              <KpiCard
                icon={<Receipt size={18} className="text-[#d97706]" />}
                label="Comisiones aliados"
                value={resumenPendiente ? '...' : fmt(kpis.comisionesAliado)}
                sub={resumenPendiente ? 'Actualizando resumen' : 'Pendientes de descontar'}
                color="#d97706"
              />
              {!resumenPendiente && kpis.descuentosAdicionales > 0 && (
                <KpiCard
                  icon={<Tag size={18} className="text-[#ea580c]" />}
                  label="Descuentos adicionales"
                  value={fmt(kpis.descuentosAdicionales)}
                  sub="Aplicados en el período"
                  color="#ea580c"
                />
              )}
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>

              {/* Tab header */}
              <div className="flex border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
                {[
                  { key: 'cartera',     label: 'Cartera' },
                  { key: 'comisiones',  label: 'Comisiones' },
                  { key: 'nocobrados',  label: 'No cobrados' },
                  { key: 'historial',   label: 'Historial' },
                  { key: 'tecnicos',    label: 'Cuadre técnicos' },
                  { key: 'conciliaciones', label: 'Conciliaciones' },
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
                    {t.key === 'comisiones' && !resumenPendiente && kpis.comisionesAliado > 0 && (
                      <span className="ml-1.5 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        {comisionesServicios ? comisionesPorAliado.length : kpis.aliadosConComision}
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
                    {['TODOS', 'PENDIENTE', 'PARCIAL', 'DESCUADRE'].map(f => {
                      const n = carteraSvcs.filter(s =>
                        (f === 'DESCUADRE' ? esDescuadre(s) : s.estado_pago === f) &&
                        (!filtroAliado || s.aliado_origen_id === filtroAliado)).length
                      // El chip de descuadre solo aparece si hay algo que mirar.
                      if (f === 'DESCUADRE' && n === 0) return null
                      return (
                        <button
                          key={f}
                          onClick={() => setFiltroCartera(f)}
                          className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-colors ${
                            filtroCartera === f
                              ? 'bg-[#1A5CD8] text-white border-[#1A5CD8]'
                              : f === 'DESCUADRE'
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                          title={f === 'DESCUADRE' ? 'Marcados como pagados pero con saldo — la marca quedó vieja' : undefined}
                        >
                          {f === 'TODOS' ? 'Todos' : f === 'DESCUADRE' ? '⚠ Marcado pagado' : f}
                          {f !== 'TODOS' && <span className="ml-1 opacity-70">({n})</span>}
                        </button>
                      )
                    })}
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
                    <div className="overflow-auto max-h-[68vh] -mx-5 px-5">
                      <table className="w-full min-w-[780px]">
                        <thead className="sticky top-0 z-10 bg-white">
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
                              <td className="py-3 pr-4 tabular-nums">
                                <span className="font-semibold text-gray-900">{fmt(s.valor_total)}</span>
                                {s.descuento_adicional > 0 && (
                                  <div className="text-[10px] text-orange-600 font-medium leading-tight mt-0.5" title={s.descuento_adicional_motivo || ''}>
                                    - {fmt(s.descuento_adicional)} desc.
                                  </div>
                                )}
                              </td>
                              <td className="py-3 pr-4 text-[#16a34a] font-semibold tabular-nums">{fmt(s.valor_pagado)}</td>
                              <td className="py-3 pr-4 text-[#DC2626] font-bold tabular-nums">{fmt(s.saldo)}</td>
                              <td className="py-3 pr-4">
                                <BadgeEstadoPago estado={s.estado_pago} />
                                {esDescuadre(s) && (
                                  <div className="text-[10px] font-semibold text-amber-700 leading-tight mt-0.5"
                                    title="Está marcado como pagado pero quedó saldo: el valor del servicio cambió después de cobrar. Al registrar el pago la marca se corrige sola.">
                                    ⚠ marcado pagado, con saldo
                                  </div>
                                )}
                              </td>
                              <td className="py-3">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => abrirPagoModal(s)}
                                    className="px-3 py-1.5 bg-[#1A5CD8] hover:bg-[#1550C0] text-white text-[11px] font-semibold rounded-xl transition-colors whitespace-nowrap"
                                  >
                                    Registrar pago
                                  </button>
                                  {/* El clip se muestra tambien SIN comprobante: si el pago se
                                      registro sin adjuntarlo, esta es la ruta para subirlo. */}
                                  {(comprobantesSet.has(s.id) || puedeEditarCuadre) && (
                                    <button
                                      onClick={() => setComprobanteItem({ servicio_id: s.id, mascota_nombre: nombreMascota(s) })}
                                      title={comprobantesSet.has(s.id) ? 'Ver comprobante de pago' : 'Sin comprobante — adjuntar uno'}
                                      className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors hover:bg-[#EFF6FF] hover:text-[#1A5CD8] ${comprobantesSet.has(s.id) ? 'text-[#1A5CD8]' : 'text-gray-300'}`}
                                      style={{ borderColor: 'rgba(30,80,40,0.15)' }}
                                    >
                                      <Paperclip size={13} />
                                    </button>
                                  )}
                                </div>
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
                  {comisionesLoading || comisionesServicios === null ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                      <div className="spinner" /><span className="text-sm font-medium">Cargando comisiones…</span>
                    </div>
                  ) : comisionesPorAliado.length === 0 ? (
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
                                    {['Fecha', 'Mascota', 'Tipo', 'Valor servicio', 'Comisión', 'Estado pago', 'Descontada'].map(h => (
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
                                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                                        <span className="mr-1">{petEmoji(tipoMascota(s))}</span>{tipoMascota(s)}
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

              {/* ── Tab: No cobrados ─────────────────────────────────── */}
              {tab === 'nocobrados' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <p className="text-[12px] text-gray-500 max-w-2xl">
                      Servicios donde el técnico <strong>no recibió el pago</strong>: quedó <strong>pendiente</strong> o
                      se <strong>factura mensual</strong> a la veterinaria. Aquí se gestionan aparte del cuadre. Se
                      muestra la última novedad de cada servicio.
                    </p>
                    <button onClick={cargarNoCobrados}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border border-[rgba(30,80,40,0.15)] text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors">
                      <RefreshCw size={13} /> Actualizar
                    </button>
                  </div>

                  {noCobLoading || noCobrados === null ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                      <div className="spinner" /><span className="text-sm font-medium">Cargando…</span>
                    </div>
                  ) : noCobrados.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-4xl mb-3">✅</div>
                      <p className="text-[14px] font-semibold text-gray-700">No hay servicios sin cobrar pendientes</p>
                      <p className="text-[12px] text-gray-400 mt-1">Todo lo emitido por los técnicos fue cobrado o ya se completó.</p>
                    </div>
                  ) : (
                    <div className="overflow-auto max-h-[68vh] -mx-5 px-5">
                      <table className="w-full min-w-[920px]">
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                            {['Fecha', 'Mascota / Cliente', 'Plan', 'Técnico', 'Valor', 'Motivo', 'Novedad', ''].map(h => (
                              <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide pb-2 pr-4 first:pl-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {noCobrados.map(r => {
                            const svc = r.servicios || {}
                            const cli = r.cliente
                            const MOT = {
                              PAGO_PENDIENTE:      ['Pago pendiente',     'bg-[#FFF3DC] text-[#9A5500]'],
                              FACTURACION_MENSUAL: ['Facturación mensual', 'bg-[#EEF2FF] text-[#3730A3]'],
                              SIN_COBRO:           ['Sin cobro',          'bg-gray-100 text-gray-600'],
                            }[r.motivo] || ['—', 'bg-gray-100 text-gray-600']
                            return (
                              <tr key={r.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors align-top" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                                <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtFecha(r.fecha_emision)}</td>
                                <td className="py-3 pr-4">
                                  <div className="font-semibold text-gray-900 leading-tight">{r.mascota?.nombre || '—'}</div>
                                  <div className="text-[11px] text-gray-400">{cli ? `${cli.nombre || ''} ${cli.apellido || ''}`.trim() : '—'}</div>
                                </td>
                                <td className="py-3 pr-4 text-gray-600 text-[12px]">{svc.planes?.nombre || '—'}</td>
                                <td className="py-3 pr-4 text-[12px] text-gray-700">{r.personal ? `${r.personal.nombre} ${r.personal.apellido || ''}`.trim() : '—'}</td>
                                <td className="py-3 pr-4 font-semibold text-gray-900 tabular-nums whitespace-nowrap">{fmt(r.valor_total || svc.valor_total)}</td>
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${MOT[1]}`}>{MOT[0]}</span>
                                    <BadgeEstadoPago estado={svc.estado_pago} />
                                  </div>
                                  {svc.aliados?.nombre && <div className="text-[10px] text-gray-400 mt-0.5">🏥 {svc.aliados.nombre}</div>}
                                </td>
                                <td className="py-3 pr-4 text-[11px] text-gray-500 max-w-[260px]">
                                  {r.novedad?.descripcion
                                    ? <span title={r.novedad.descripcion}>{r.novedad.descripcion}</span>
                                    : <span className="text-gray-300 italic">Sin novedad</span>}
                                </td>
                                <td className="py-3">
                                  {r.motivo !== 'FACTURACION_MENSUAL' && (
                                    <button
                                      onClick={() => abrirPagoModal({
                                        id: r.servicio_id,
                                        valor_total:  svc.valor_total || r.valor_total || 0,
                                        valor_pagado: svc.valor_pagado || 0,
                                        saldo: Math.max(0, (svc.valor_total || 0) - (svc.valor_pagado || 0)),
                                        metodo_pago: svc.metodo_pago || 'EFECTIVO',
                                        canal_entrada: svc.aliado_origen_id ? 'ALIADO' : 'DIRECTO',
                                        mascota: r.mascota, cliente: r.cliente,
                                        aliado: svc.aliados || null,
                                      })}
                                      className="px-3 py-1.5 bg-[#1A5CD8] hover:bg-[#1550C0] text-white text-[11px] font-semibold rounded-xl transition-colors whitespace-nowrap">
                                      Registrar pago
                                    </button>
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

              {/* ── Tab: Historial ───────────────────────────────────── */}
              {tab === 'historial' && (
                <div className="p-5">
                  {historialServiciosLoading && historialServicios === null ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
                      <div className="spinner" /><span className="text-sm font-medium">Cargando historial…</span>
                    </div>
                  ) : (historialServicios || []).length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="text-[14px] font-semibold text-gray-700">No hay servicios registrados</p>
                    </div>
                  ) : (
                    <div className="overflow-auto max-h-[68vh] -mx-5 px-5">
                      <table className="w-full min-w-[1100px]">
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                            {['Fecha', 'Mascota', 'Cliente', 'Canal', 'Plan', 'Técnico', 'Total', 'Pagado', 'Saldo', 'Estado pago', 'Medios de pago', ''].map(h => (
                              <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide pb-2 pr-4 first:pl-0">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(historialServicios || []).map(s => {
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
                      {historialHasMore && (
                        <div className="py-3 text-center">
                          <button onClick={() => cargarHistorialServicios(false)} disabled={historialServiciosLoading}
                            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors disabled:opacity-60"
                            style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                            {historialServiciosLoading ? 'Cargando…' : 'Cargar más'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* ── Tab: Cuadre técnicos ─────────────────────────────── */}
              {tab === 'tecnicos' && (
                <div className="p-5 space-y-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <p className="text-[12px] text-gray-500 max-w-2xl">
                      Cuadre de cuentas por técnico y rango de fechas. Solo el <strong>efectivo</strong> cuenta como
                      recibido por el técnico (lo digital entra directo a la empresa). El dinero a entregar a gerencia
                      es: efectivo − reconocimientos (transporte + recargos) − ajustes.
                    </p>
                    <button onClick={() => setGuiaOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors whitespace-nowrap"
                      style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                      <HelpCircle size={13} /> ¿Cómo funciona?
                    </button>
                  </div>

                  {/* Formulario */}
                  <div className="bg-white border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Técnico</label>
                        <select value={cuadreTec} onChange={e => seleccionarTecnico(e.target.value)} disabled={cuadreCerrado}
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none bg-white focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] disabled:bg-gray-50"
                          style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                          <option value="">Selecciona…</option>
                          {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.apellido || ''}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Desde</label>
                        <input type="date" value={cuadreDesde} onChange={e => setCuadreDesde(e.target.value)} disabled={cuadreCerrado}
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] disabled:bg-gray-50"
                          style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Hasta</label>
                        <input type="date" value={cuadreHasta} onChange={e => setCuadreHasta(e.target.value)} disabled={cuadreCerrado}
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] disabled:bg-gray-50"
                          style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Ajuste manual ($)</label>
                        <input type="number" step={1000} value={cuadreAjustes} onChange={e => setCuadreAjustes(e.target.value)} disabled={cuadreCerrado}
                          placeholder="0 (+ a favor téc.)"
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] disabled:bg-gray-50"
                          style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-3 items-end">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Motivo del ajuste <span className="font-normal text-gray-400">(opcional)</span></label>
                        <input type="text" value={cuadreAjusteMot} onChange={e => setCuadreAjusteMot(e.target.value)} disabled={cuadreCerrado}
                          placeholder="Ej: préstamo, descuento acordado…"
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] disabled:bg-gray-50"
                          style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
                      </div>
                      {!cuadreCerrado && (
                        <button onClick={generarCuadre} disabled={cuadreLoading}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#1A5CD8] hover:bg-[#1550C0] text-white rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-60 whitespace-nowrap">
                          {cuadreLoading
                            ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Calculando…</>
                            : <><Calendar size={14} /> {cuadreData ? 'Actualizar cuadre' : 'Generar cuadre'}</>}
                        </button>
                      )}
                    </div>
                    {cuadreError && (
                      <div className="flex items-center gap-2 bg-red-50 text-red-700 text-[12px] font-medium px-3 py-2 rounded-xl border border-red-100 mt-3">
                        <AlertCircle size={13} className="flex-shrink-0" /> {cuadreError}
                      </div>
                    )}
                  </div>

                  {/* ── Historial: cuadres anteriores (borradores + cerrados) ── */}
                  {!cuadreData && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Cuadres anteriores</p>
                        <button onClick={cargarHistorial} disabled={histLoading}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-60">
                          <RefreshCw size={11} className={histLoading ? 'animate-spin' : ''} /> Actualizar
                        </button>
                      </div>
                      {historialCuadres === null || histLoading ? (
                        <div className="py-10 text-center text-gray-400 text-[13px]">Cargando cuadres…</div>
                      ) : historialCuadres.length === 0 ? (
                        <div className="py-10 text-center border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <div className="text-3xl mb-2">🧾</div>
                          <p className="text-[13px] text-gray-500">Todavía no hay cuadres. Genera el primero arriba.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <table className="w-full min-w-[1000px]">
                            <thead style={{ background: '#FAFAFA' }}>
                              <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                                {['Técnico', 'Rango', 'Estado', 'Confirmación téc.', 'Servicios', 'A entregar', 'Entrega del dinero', ''].map(h => (
                                  <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {historialCuadres.map(c => {
                                const cerrado = c.estado === 'CERRADO'
                                return (
                                  <tr key={c.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                                    <td className="px-3 py-2.5 font-semibold text-gray-900">
                                      {c.personal ? `${c.personal.nombre} ${c.personal.apellido || ''}`.trim() : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtFecha(c.fecha_desde)} → {fmtFecha(c.fecha_hasta)}</td>
                                    <td className="px-3 py-2.5">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cerrado ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {cerrado ? 'CERRADO' : 'BORRADOR'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5"><ChipConfirmacionTec cuadre={c} /></td>
                                    <td className="px-3 py-2.5 text-gray-600">{c.total_servicios}</td>
                                    <td className="px-3 py-2.5 tabular-nums font-semibold text-gray-900">{fmt(c.dinero_a_entregar)}</td>
                                    <td className="px-3 py-2.5">
                                      {!cerrado ? <span className="text-gray-300">—</span>
                                        : c.entrega_confirmada_en
                                          ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><Check size={10} /> Recibido {fmt(c.entrega_monto)}</span>
                                          : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="El técnico aún no ha entregado el efectivo (o falta confirmarlo aquí)">Pendiente de entrega</span>}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <button onClick={() => abrirCuadre(c)} disabled={cuadreLoading}
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors disabled:opacity-60 whitespace-nowrap"
                                          style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                                          <Eye size={12} /> Abrir
                                        </button>
                                        {/* Descartar solo borradores: un cerrado es la constancia del dinero */}
                                        {!cerrado && puedeEditarCuadre && (
                                          <button onClick={() => descartarBorrador(c)} disabled={descartando === c.id}
                                            className="flex items-center justify-center h-[30px] w-[30px] rounded-lg border text-gray-400 hover:text-[#DC2626] hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-60"
                                            style={{ borderColor: 'rgba(30,80,40,0.15)' }}
                                            title="Descartar este borrador (no borra recibos ni servicios)">
                                            {descartando === c.id
                                              ? <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                                              : <Trash2 size={12} />}
                                          </button>
                                        )}
                                      </div>
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

                  {/* Resultado */}
                  {cuadreData && (
                    <div className="space-y-4">
                      {/* Cabecera */}
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-[13px]" style={{ background: '#1A5CD8' }}>
                            {nombreTecnicoSel(cuadreData.tecnico_id).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 text-[14px]">
                              {nombreTecnicoSel(cuadreData.tecnico_id)}
                              {cuadreItems[0]?.vehiculo && (
                                <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#E0F2FE] text-[#0E7490] align-middle">
                                  {cuadreItems[0].vehiculo}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-400">{fmtFecha(cuadreData.fecha_desde)} → {fmtFecha(cuadreData.fecha_hasta)} · {cuadreData.total_servicios} servicio{cuadreData.total_servicios !== 1 ? 's' : ''}</div>
                          </div>
                        </div>
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${cuadreCerrado ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-700'}`}>
                          {cuadreCerrado ? <span className="flex items-center gap-1"><Lock size={11} /> CERRADO</span> : 'BORRADOR'}
                        </span>
                        <ChipConfirmacionTec cuadre={cuadreData} />
                        <div className="flex items-center gap-2 ml-auto">
                          <button onClick={analizarConIA} disabled={iaLoading}
                            title="El asistente revisa el cuadre, lee las notas del técnico y te dice qué requiere atención. Solo sugiere: tú confirmas."
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-60"
                            style={{ borderColor: '#C4B5FD' }}>
                            <Sparkles size={13} className={iaLoading ? 'animate-pulse' : ''} /> {iaLoading ? 'Analizando…' : 'Analizar con IA'}
                          </button>
                          <button onClick={descargarCuadrePDF} disabled={cuadrePdfGen}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-[#1A5CD8] hover:bg-[#F0F7EC] transition-colors disabled:opacity-60"
                            style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                            {cuadrePdfGen ? <div className="w-3.5 h-3.5 border-2 border-[#1A5CD8]/30 border-t-[#1A5CD8] rounded-full animate-spin" /> : <Download size={13} />} PDF
                          </button>
                          {!cuadreCerrado && (
                            <button onClick={cerrarCuadre} disabled={cerrando}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-60">
                              {cerrando ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Lock size={13} />} Cerrar
                            </button>
                          )}
                          <button onClick={limpiarCuadre}
                            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-gray-600 hover:bg-gray-50 transition-colors"
                            style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                            Nuevo
                          </button>
                        </div>
                      </div>

                      {/* Panel del asistente IA (guía del cuadre; solo sugiere) */}
                      {iaAnalisis !== null && (
                        <div className="rounded-xl border p-4" style={{ background: '#F5F3FF', borderColor: '#C4B5FD' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Sparkles size={15} className="text-violet-600 flex-shrink-0" />
                              <span className="text-[12px] font-semibold text-violet-800">Asistente ORBIT — guía del cuadre</span>
                            </div>
                            <button onClick={() => setIaAnalisis(null)}
                              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-violet-100 text-violet-400 flex-shrink-0">
                              <X size={13} />
                            </button>
                          </div>
                          <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed mt-2">{iaAnalisis}</p>
                          <p className="text-[10px] text-violet-500 mt-2">La IA solo sugiere: confirma cada estado tú mismo en la columna Acción.</p>
                        </div>
                      )}

                      {/* Observación del técnico al confirmar (visible para el coordinador) */}
                      {cuadreData.tecnico_observacion && (
                        <div className="flex items-start gap-2 bg-[#EEF2FF] border text-[#3730A3] text-[12px] px-3 py-2.5 rounded-xl" style={{ borderColor: '#C7D2FE' }}>
                          <MessageSquare size={14} className="flex-shrink-0 mt-0.5" />
                          <div>
                            <strong>Observación de {nombreTecnicoSel(cuadreData.tecnico_id)} al confirmar:</strong>
                            <span className="block mt-0.5">“{cuadreData.tecnico_observacion}”</span>
                          </div>
                        </div>
                      )}

                      {/* Aviso: saldo a favor del técnico en cuadres cerrados anteriores */}
                      {!cuadreCerrado && saldosAFavor.length > 0 && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2.5 rounded-xl">
                          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                          <div>
                            <strong>Este técnico quedó con saldo a favor en cuadres anteriores: {fmt(saldosAFavor.reduce((a, c) => a + (Number(c.saldo_a_favor_tecnico) || 0), 0))}.</strong>
                            <span className="block text-[11px] mt-0.5">
                              {saldosAFavor.map(c => `${fmtFecha(c.fecha_desde)} → ${fmtFecha(c.fecha_hasta)}: ${fmt(c.saldo_a_favor_tecnico)}`).join(' · ')}.
                              {' '}Si quieres compensarlo en este cuadre, ponlo en <strong>Ajuste manual (+)</strong> con su motivo y vuelve a generar.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Aviso: el técnico anotó sugerencias en su bitácora (capa sombra) */}
                      {Object.keys(ajustesTecnico).length > 0 && (
                        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                          <p className="text-[13px] font-bold text-amber-800">
                            ✎ El técnico anota {Object.keys(ajustesTecnico).length} sugerencia{Object.keys(ajustesTecnico).length !== 1 ? 's' : ''} en su bitácora
                          </p>
                          <p className="text-[11px] text-amber-700/90 mt-0.5 leading-snug">
                            Aparecen junto a cada mascota, solo para comparar. No cambian el cuadre ni el dinero a entregar. Si le das la razón, ajusta el valor real con el lápiz de la columna correspondiente.
                          </p>
                        </div>
                      )}

                      {/* Barra de herramientas: elegir columnas visibles */}
                      {cuadreItems.length > 0 && (
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-[11px] text-gray-400">
                            {colsOcultas.size > 0
                              ? `${colsVisibles.length} de ${COLS_CUADRE.length} columnas visibles · menos desplazamiento`
                              : `${COLS_CUADRE.length} columnas`}
                          </p>
                          <div className="relative">
                            <button type="button" onClick={() => setColMenuAbierto(o => !o)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border text-gray-600 hover:bg-gray-50 transition-colors"
                              style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                              <Columns3 size={13} /> Columnas
                              {colsOcultas.size > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#1A5CD8]">{colsOcultas.size} ocultas</span>}
                              <ChevronDown size={12} className={colMenuAbierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
                            </button>
                            {colMenuAbierto && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setColMenuAbierto(false)} />
                                <div className="absolute right-0 mt-1 z-30 w-60 rounded-xl border bg-white shadow-xl py-1.5"
                                  style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                                  <div className="flex items-center justify-between px-3 py-1.5">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Mostrar columnas</span>
                                    <button type="button" onClick={mostrarTodasCols}
                                      className="text-[10px] font-bold text-[#1A5CD8] hover:underline disabled:text-gray-300 disabled:no-underline"
                                      disabled={colsOcultas.size === 0}>Todas</button>
                                  </div>
                                  <div className="max-h-[320px] overflow-y-auto">
                                    {COLS_CUADRE.map(c => (
                                      <label key={c.key}
                                        className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${c.fija ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-gray-50'}`}>
                                        <input type="checkbox" checked={verCol(c.key)} disabled={c.fija}
                                          onChange={() => !c.fija && toggleCol(c.key)}
                                          className="w-3.5 h-3.5 accent-[#1A5CD8]" />
                                        <span className="text-gray-700">{c.label}</span>
                                        {c.fija && <span className="text-[9px] text-gray-400 ml-auto">fija</span>}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Barra de filtros del cuadre */}
                      {cuadreItems.length > 0 && (
                        <div className="rounded-2xl border p-3 space-y-2.5" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative flex-1 min-w-[200px]">
                              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              <input type="text" value={filtroCuadre.q}
                                onChange={e => setFiltroCuadre(prev => ({ ...prev, q: e.target.value }))}
                                placeholder="Buscar mascota, ciudad, veterinaria o plan…"
                                className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-[12px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20"
                                style={{ borderColor: 'rgba(30,80,40,0.15)' }} />
                            </div>
                            <select value={filtroCuadre.vet} onChange={e => setFiltroCuadre(prev => ({ ...prev, vet: e.target.value }))}
                              className="rounded-lg border px-2 py-1.5 text-[12px] bg-white outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 max-w-[180px]"
                              style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                              <option value="">Veterinaria: todas</option>
                              {opcionesCuadre.vets.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <select value={filtroCuadre.ciudad} onChange={e => setFiltroCuadre(prev => ({ ...prev, ciudad: e.target.value }))}
                              className="rounded-lg border px-2 py-1.5 text-[12px] bg-white outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 max-w-[160px]"
                              style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                              <option value="">Ciudad: todas</option>
                              {opcionesCuadre.ciudades.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <select value={filtroCuadre.plan} onChange={e => setFiltroCuadre(prev => ({ ...prev, plan: e.target.value }))}
                              className="rounded-lg border px-2 py-1.5 text-[12px] bg-white outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 max-w-[160px]"
                              style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                              <option value="">Plan: todos</option>
                              {opcionesCuadre.planes.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            {filtroCuadreActivo && (
                              <button type="button" onClick={limpiarFiltroCuadre}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                                <X size={12} /> Limpiar
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide mr-1"><Filter size={11} /> Estado</span>
                            {CHIPS_ESTADO_CUADRE.map(c => {
                              const on = filtroCuadre.estados.has(c.k)
                              return (
                                <button key={c.k} type="button" onClick={() => toggleEstadoFiltro(c.k)}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${on ? 'bg-[#1A5CD8] text-white border-[#1A5CD8]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                  style={on ? undefined : { borderColor: 'rgba(30,80,40,0.15)' }}>
                                  {c.label}
                                </button>
                              )
                            })}
                            <span className="w-px h-4 bg-gray-200 mx-1" />
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mr-1">Medio</span>
                            {CHIPS_MEDIO_CUADRE.map(c => {
                              const on = filtroCuadre.medio === c.k
                              return (
                                <button key={c.k} type="button" onClick={() => setFiltroCuadre(prev => ({ ...prev, medio: on ? '' : c.k }))}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${on ? 'bg-[#16a34a] text-white border-[#16a34a]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                  style={on ? undefined : { borderColor: 'rgba(30,80,40,0.15)' }}>
                                  {c.label}
                                </button>
                              )
                            })}
                            {filtroCuadreActivo && (
                              <span className="ml-auto text-[11px] font-semibold text-gray-500 tabular-nums">
                                {cuadreItemsOrden.length} de {cuadreItems.length}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Tabla detalle */}
                      {cuadreItems.length === 0 ? (
                        <div className="py-12 text-center border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <div className="text-3xl mb-2">🧾</div>
                          <p className="text-[13px] text-gray-500">Sin recibos del técnico en este rango.</p>
                        </div>
                      ) : cuadreItemsOrden.length === 0 ? (
                        <div className="py-12 text-center border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <div className="text-3xl mb-2">🔍</div>
                          <p className="text-[13px] text-gray-500">Ningún servicio coincide con los filtros.</p>
                          <button type="button" onClick={limpiarFiltroCuadre}
                            className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#1A5CD8] hover:bg-[#EFF6FF] transition-colors">
                            <X size={13} /> Limpiar filtros
                          </button>
                        </div>
                      ) : (
                        <div className="overflow-auto scroll-grueso max-h-[68vh] border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <table className="w-full" style={{ minWidth: `${colsVisibles.length * 95}px` }}>
                            <thead className="sticky top-0 z-10" style={{ background: '#FAFAFA' }}>
                              <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                                {colsVisibles.map(c => {
                                  const sortable = c.key !== 'accion'
                                  const activo = orden.key === c.key
                                  return (
                                  <th key={c.key} title={sortable ? `${c.title ? c.title + ' · ' : ''}Clic para ordenar de mayor a menor` : c.title}
                                    onClick={sortable ? () => toggleOrden(c.key) : undefined}
                                    className={`text-left text-[11px] font-bold uppercase tracking-wide px-3 py-2.5 whitespace-nowrap ${sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''} ${activo ? 'text-[#1A5CD8]' : 'text-gray-500'}`}>
                                    <span className="inline-flex items-center gap-1">
                                      {c.label}
                                      {sortable && (activo
                                        ? (orden.dir === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />)
                                        : <ArrowUpDown size={12} className="text-gray-300" />)}
                                    </span>
                                  </th>
                                  )
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {cuadreItemsOrden.map(it => {
                                const d = diferenciaItem(it)
                                const alerta = faltaPlata(it)
                                const exceso = excesoValorARecoger(it)
                                const alertaGestion = alerta || cobroDeMasSinRevisar(it)
                                const sug = estadoSugerido(it)
                                const er = it.estado_conciliacion ? ESTADO_REV[it.estado_conciliacion] : null
                                return (
                                <tr key={it.id} className={`text-[13px] border-b transition-colors ${alertaGestion ? 'bg-amber-50/70 hover:bg-amber-100/60' : 'hover:bg-gray-50'}`}
                                  style={{ borderColor: 'rgba(30,80,40,0.06)', ...(alertaGestion ? { boxShadow: 'inset 3px 0 0 #f59e0b' } : {}) }}>
                                  {verCol('fecha') && <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(it.fecha_registro_servicio || it.fecha)}</td>}
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => it.servicio_id && setDetalleItem(it)} disabled={!it.servicio_id}
                                        className="font-semibold text-gray-900 hover:text-[#1A5CD8] hover:underline text-left flex items-center gap-1 disabled:no-underline disabled:hover:text-gray-900"
                                        title="Ver tarjeta completa de la mascota">
                                        {alertaGestion && <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />}
                                        {it.mascota_nombre || '—'}
                                      </button>
                                      {it.servicio_id && !it.sin_recibo && (
                                        <button type="button"
                                          onClick={async () => {
                                            // 1) el PDF real que el técnico envió por WhatsApp (si existe);
                                            // 2) si no, se genera al vuelo desde los datos del recibo — así
                                            // los de junio (sin PDF guardado) también se pueden ver.
                                            if (await abrirPdfReciboServicio(it.servicio_id)) return
                                            if (await abrirReciboPDFServicio(it.servicio_id)) return
                                            await showAlert('No se pudo generar el recibo de este servicio.', { title: 'Sin recibo' })
                                          }}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-[#0B1D4F] hover:bg-gray-100 transition-colors flex-shrink-0"
                                          title="Ver PDF del recibo">
                                          <FileText size={12} />
                                        </button>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                      {it.es_cancelado && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600">CANCELADO</span>}
                                      {it.sin_recibo && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-rose-100 text-rose-700" title="El técnico recogió este servicio pero no generó recibo (no cobró). Pendiente por cobrar.">SIN RECIBO</span>}
                                      {esFactMensual(it) && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#FFF3DC] text-[#9A5500]">FACT. MENSUAL</span>}
                                      {er && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: er.bg, color: er.color }}>{er.short}</span>}
                                      {it.conciliacion_resuelta && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-green-100 text-green-700">✓ conciliado</span>}
                                      <RecatBadges recat={recatServicios[it.servicio_id]} size="xs" />
                                    </div>
                                    {(() => {
                                      const exp = explicacionItem(it)
                                      return exp ? <p className="text-[10px] text-gray-500 leading-snug mt-1 max-w-[260px]">{exp}</p> : null
                                    })()}
                                    {(() => {
                                      const aj = ajustesTecnico[it.servicio_id]
                                      if (!aj) return null
                                      const recSug = (Number(it.transporte_reconocido) || 0) + (Number(it.recargo_aplicado) || 0) + (Number(it.pago_servicio) || 0)
                                      const cobDif = aj.cobrado_sugerido != null && Number(aj.cobrado_sugerido) !== Number(it.total_cobrado || 0)
                                      const recDif = aj.reconocido_sugerido != null && Number(aj.reconocido_sugerido) !== recSug
                                      return (
                                        <div className="mt-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 max-w-[260px]">
                                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-amber-700">
                                            <span>✎ El técnico sugiere</span>
                                            {cobDif && <span className="tabular-nums">cobrado {fmt(Number(aj.cobrado_sugerido))}</span>}
                                            {recDif && <span className="tabular-nums">reconoc. {fmt(Number(aj.reconocido_sugerido))}</span>}
                                          </div>
                                          <div className="text-[10px] text-amber-800/80 leading-snug mt-0.5">{aj.nota}</div>
                                        </div>
                                      )
                                    })()}
                                  </td>
                                  {verCol('ciudad') && <td className="px-3 py-2.5 text-gray-600">{it.ciudad || '—'}</td>}
                                  {verCol('veterinaria') && <td className="px-3 py-2.5 text-[12px]">{it.veterinaria ? <span className="font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3] text-[11px]">🏥 {it.veterinaria}</span> : <span className="text-gray-300">—</span>}</td>}
                                  {verCol('plan') && <td className="px-3 py-2.5 text-gray-600 text-[12px]">{it.plan_nombre || '—'}</td>}
                                  {verCol('total') && (
                                  <td className="px-3 py-2.5 tabular-nums font-semibold text-gray-900" title="Neto que paga el cliente (la comisión va en su propia columna)">
                                    {valorARecoger(it) != null ? fmt(valorARecoger(it)) : '—'}
                                    {Number(it.valor_adicionales) > 0 && <div className="text-[10px] font-medium text-gray-400">incl. adic. {fmt(it.valor_adicionales)}</div>}
                                  </td>
                                  )}
                                  {verCol('comision') && <td className="px-3 py-2.5 tabular-nums text-[#d97706] font-semibold">{it.comision > 0 ? fmt(it.comision) : '—'}</td>}
                                  {verCol('recogido') && (
                                  <td className="px-3 py-2.5 font-semibold text-gray-900 tabular-nums">
                                    <div className="flex items-center gap-1.5">
                                      {it.total_cobrado > 0 ? fmt(it.total_cobrado)
                                        : (it.es_cancelado ? '—'
                                          : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">no cobró</span>)}
                                      {puedeEditarCuadre && !cuadreCerrado && !it.es_cancelado && (
                                        <button type="button" onClick={() => setValorRecogidoItem(it)}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-[#1A5CD8] hover:bg-[#EFF6FF] transition-colors"
                                          title="Modificar valor recogido">
                                          <Pencil size={11} />
                                        </button>
                                      )}
                                    </div>
                                    {it.valor_recogido_editado_en && (
                                      <div className="text-[9px] font-bold text-[#1A5CD8] mt-0.5">
                                        editado{it.valor_recogido_original != null ? ` · original ${fmt(it.valor_recogido_original)}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  )}
                                  {verCol('diferencia') && (
                                  <td className="px-3 py-2.5 tabular-nums">
                                    {esFactMensual(it) ? (
                                      <span className="font-semibold text-[#9A5500] text-[12px]" title="Facturación mensual: el aliado nos debe el neto (bruto − comisión). Se cobra en la factura mensual.">x cobrar al aliado {fmt(pendienteAliado(it))}</span>
                                    ) : d == null ? <span className="text-gray-300">—</span>
                                      : exceso > 0 ? <span className="font-semibold text-[#1E40AF]" title="Cobro por encima del valor a recoger">+{fmt(exceso)}</span>
                                      : d > 0 ? <span className="font-bold text-[#DC2626]">{fmt(d)}</span>
                                      : d < 0 ? <span className="font-semibold text-[#1E40AF]" title="Recogió de más">+{fmt(-d)}</span>
                                      : <span className="text-[#16a34a] font-semibold inline-flex items-center gap-0.5"><Check size={11} /> $0</span>}
                                  </td>
                                  )}
                                  {verCol('efectivo') && (
                                  <td className="px-3 py-2.5 font-semibold text-[#16a34a] tabular-nums">
                                    <div className="flex items-center gap-1.5">
                                      {fmt(it.efectivo)}
                                      {puedeEditarCuadre && !cuadreCerrado && !it.es_cancelado
                                        && (Number(it.efectivo) > 0 || Number(it.digital) > 0) && (
                                        <button type="button" onClick={() => setMediosItem(it)}
                                          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-2 text-[10px] font-bold text-[#1A5CD8] hover:bg-[#DBEAFE] transition-colors whitespace-nowrap"
                                          title="Reclasificar medio de pago (efectivo ↔ digital)">
                                          <ArrowLeftRight size={12} /> Cambiar método
                                        </button>
                                      )}
                                    </div>
                                    {it.medios_editado_en && (
                                      <div className="text-[9px] font-bold text-[#1A5CD8] mt-0.5" title={it.medios_motivo || ''}>
                                        reclasificado
                                      </div>
                                    )}
                                  </td>
                                  )}
                                  {verCol('digital') && (
                                  <td className="px-3 py-2.5">
                                    {it.digital > 0 ? (
                                      <div className="flex flex-col gap-1">
                                        <span className="text-gray-600 font-medium tabular-nums">{fmt(it.digital)}</span>
                                        <div className="flex flex-wrap gap-1">
                                          {(it.medios_pago || []).filter(m => String(m.metodo).toUpperCase() !== 'EFECTIVO' && Number(m.monto) > 0).map((m, i) => (
                                            <button key={i} onClick={() => setComprobanteItem(it)} title="Ver o subir comprobante de pago"
                                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#1E40AF] hover:bg-[#DBEAFE] inline-flex items-center gap-0.5 transition-colors">
                                              <FileText size={9} /> {m.metodo}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : <span className="text-gray-400 tabular-nums">—</span>}
                                  </td>
                                  )}
                                  {verCol('transporte') && (
                                  <td className="px-3 py-2.5 tabular-nums">
                                    {it.transporte_sin_dato ? (
                                      <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md" title="Servicio sin transporte registrado (anterior a la mejora). Verificar manualmente.">sin dato ⚠</span>
                                    ) : (it.transporte_reconocido > 0 ? <span className="font-semibold text-[#7C3AED]">{fmt(it.transporte_reconocido)}</span> : '—')}
                                  </td>
                                  )}
                                  {verCol('pago') && (
                                  <td className="px-3 py-2.5 tabular-nums">
                                    <div className="flex items-center gap-1.5">
                                      {it.pago_servicio > 0 ? <span className="font-semibold text-[#0E7490]">{fmt(it.pago_servicio)}</span> : <span className="text-gray-400">—</span>}
                                      {puedeEditarCuadre && !cuadreCerrado && (
                                        <button type="button" onClick={() => setPagoTecnicoItem(it)}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-[#0E7490] hover:bg-[#ECFEFF] transition-colors"
                                          title={it.es_cancelado ? 'Modificar el pago por el viaje cancelado' : 'Modificar el pago al técnico'}>
                                          <Pencil size={11} />
                                        </button>
                                      )}
                                    </div>
                                    {it.pago_servicio_editado_en && (
                                      <div className="text-[9px] font-bold text-[#0E7490] mt-0.5" title={it.pago_servicio_motivo || ''}>
                                        editado{it.pago_servicio_original != null ? ` · original ${fmt(it.pago_servicio_original)}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  )}
                                  {verCol('recargo') && (
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-start gap-1.5">
                                      {it.recargo_aplicado > 0 ? (
                                        <div className="flex flex-col gap-0.5">
                                          <span className="font-semibold text-[#d97706] tabular-nums">{fmt(it.recargo_aplicado)}</span>
                                          <div className="flex gap-1">
                                            {it.es_festivo  && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600">FEST</span>}
                                            {it.es_dominical && !it.es_festivo && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-orange-100 text-orange-600">DOM</span>}
                                            {it.es_nocturno && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-indigo-100 text-indigo-600">NOC</span>}
                                            {it.es_lejania && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-600">LEJ</span>}
                                          </div>
                                        </div>
                                      ) : <span className="text-gray-400 tabular-nums">—</span>}
                                      {puedeEditarCuadre && !cuadreCerrado && (
                                        <button type="button" onClick={() => setRecargoManualItem(it)}
                                          className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg text-gray-400 hover:text-[#d97706] hover:bg-amber-50 transition-colors"
                                          title="Modificar recargo">
                                          <Pencil size={11} />
                                        </button>
                                      )}
                                    </div>
                                    {it.recargo_manual_editado_en && (
                                      <div className="text-[9px] font-bold text-[#d97706] mt-0.5">
                                        editado{it.recargo_manual_original != null ? ` - original ${fmt(it.recargo_manual_original)}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  )}
                                  {verCol('lejania') && (
                                  <td className="px-3 py-2.5">
                                    <label className={`flex items-center gap-1.5 ${cuadreCerrado ? 'cursor-default' : 'cursor-pointer'}`} title="Marcar lejanía (recargo manual al técnico)">
                                      <input type="checkbox" checked={!!it.es_lejania} disabled={cuadreCerrado}
                                        onChange={e => toggleLejania(it, e.target.checked)}
                                        className="w-4 h-4 accent-[#7C3AED] disabled:opacity-40" />
                                      <span className="text-[11px] text-gray-500">{it.es_lejania ? 'Sí' : '—'}</span>
                                    </label>
                                  </td>
                                  )}
                                  {/* Acción: estado de revisión (sugerido) + nota (features 3, 8) */}
                                  <td className="px-3 py-2.5">
                                    <div className="flex flex-col gap-1 min-w-[150px]">
                                      <select value={it.estado_conciliacion || ''} disabled={cuadreCerrado}
                                        onChange={e => guardarRevision(it, { estado: e.target.value || null })}
                                        className="text-[11px] rounded-lg border px-1.5 py-1 outline-none bg-white focus:ring-2 focus:ring-[#1A5CD8]/20 disabled:bg-gray-50"
                                        style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                                        <option value="">{sug ? `Sugerido: ${ESTADO_REV[sug].short}` : 'Sin revisar'}</option>
                                        {Object.entries(ESTADO_REV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                      </select>
                                      <button onClick={() => setObsItem(it)}
                                        className={`text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ${it.observaciones ? 'text-[#1A5CD8] bg-[#EFF6FF] hover:bg-[#DBEAFE]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                        title={it.observaciones || 'Agregar observación'}>
                                        <MessageSquare size={10} /> {it.observaciones ? 'Ver nota' : 'Nota'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )})}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Totales */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Desglose */}
                        <div className="bg-white border rounded-2xl p-5 space-y-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Resumen</p>
                          <FilaTotal label="Total a cobrar (servicios)"
                            hint="Neto: transporte a municipios incluido y comisión ya descontada"
                            valor={cuadreItems.reduce((a, it) => a + (it.es_cancelado ? 0 : (valorARecoger(it) || 0)), 0)} />
                          {cuadreItems.some(it => Number(it.comision) > 0) && (
                            <FilaTotal label="Comisión veterinarias" info
                              hint="Informativo · ya descontada del total a cobrar (no suma)"
                              valor={cuadreItems.reduce((a, it) => a + (Number(it.comision) || 0), 0)} />
                          )}
                          <FilaTotal label="Total recogido (cliente)" valor={cuadreData.total_cobrado} />
                          {(() => {
                            const falta = cuadreItems.reduce((a, it) => { const d = diferenciaItem(it); return a + (faltaPlata(it) && d > 0 ? d : 0) }, 0)
                            return falta > 0 ? (
                              <div className="flex items-center justify-between bg-amber-50 -mx-1 px-2 py-1 rounded-lg">
                                <span className="text-[12px] font-semibold text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> Falta por cobrar</span>
                                <span className="tabular-nums text-[13px] font-extrabold text-amber-700">{fmt(falta)}</span>
                              </div>
                            ) : null
                          })()}
                          <FilaTotal label="Efectivo recibido (técnico)" valor={cuadreData.efectivo_recibido} color="#16a34a" />
                          <FilaTotal label="Digital → directo a empresa" valor={cuadreData.digital_empresa} color="#6B7280" />
                          <div className="border-t my-1" style={{ borderColor: 'rgba(30,80,40,0.08)' }} />
                          <FilaTotal label="Transporte reconocido" valor={cuadreData.total_transporte} color="#7C3AED" />
                          <FilaTotal label="Pago por servicio" valor={cuadreData.total_pago_servicio} color="#0E7490" />
                          {Number(cuadreData.total_cancelados) > 0 && (
                            <FilaTotal label="Pago por cancelados" valor={cuadreData.total_cancelados} color="#DC2626" />
                          )}
                          <FilaTotal label="Recargos reconocidos" valor={cuadreData.total_recargos} color="#d97706" />
                          <FilaTotal label="Total reconocido al técnico" valor={cuadreData.total_reconocido} color="#7C3AED" bold />
                          {Number(cuadreData.ajustes_manuales) !== 0 && (
                            <FilaTotal label={`Ajuste manual${cuadreData.ajustes_motivo ? ` (${cuadreData.ajustes_motivo})` : ''}`} valor={cuadreData.ajustes_manuales} color="#ea580c" />
                          )}
                        </div>
                        {/* Resultado */}
                        <div className="rounded-2xl p-5 flex flex-col justify-center" style={{ background: 'linear-gradient(135deg,#0B1D4F 0%,#1A5CD8 100%)' }}>
                          <span className="text-[12px] font-semibold text-white/70 uppercase tracking-wide">Dinero a entregar a gerencia</span>
                          <span className="text-[34px] font-extrabold text-white tabular-nums leading-tight mt-1">{fmt(cuadreData.dinero_a_entregar)}</span>
                          <span className="text-[11px] text-white/60 mt-1">= efectivo − reconocido − ajuste</span>
                          {Number(cuadreData.saldo_a_favor_tecnico) > 0 && (
                            <div className="mt-3 px-3 py-2 rounded-xl bg-white/15 border border-white/20">
                              <span className="text-[11px] font-semibold text-white/80">⚠ La empresa le queda debiendo al técnico</span>
                              <div className="text-[18px] font-extrabold text-white tabular-nums">{fmt(cuadreData.saldo_a_favor_tecnico)}</div>
                            </div>
                          )}
                          {cuadreCerrado && (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                                <Lock size={12} /> Cerrado y firmado {cuadreData.cerrado_en ? `· ${new Date(cuadreData.cerrado_en).toLocaleDateString('es-CO')}` : ''}
                              </div>
                              {cuadreData.entrega_confirmada_en ? (
                                <div className="px-3 py-2 rounded-xl bg-white/15 border border-white/20">
                                  <span className="text-[12px] font-bold text-white inline-flex items-center gap-1">
                                    <CheckCircle2 size={13} /> Dinero recibido · {fmt(cuadreData.entrega_monto)}
                                  </span>
                                  <div className="text-[11px] text-white/70 mt-0.5">
                                    {entregaPorNombre ? `Recibió ${entregaPorNombre} · ` : ''}
                                    {new Date(cuadreData.entrega_confirmada_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    {cuadreData.entrega_notas ? ` · ${cuadreData.entrega_notas}` : ''}
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => setEntregaModal(true)}
                                  className="flex items-center gap-1.5 px-3 py-2 bg-white text-[#1A5CD8] hover:bg-white/90 rounded-xl text-[12px] font-bold transition-colors">
                                  <Banknote size={14} /> Confirmar dinero recibido
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Conciliaciones ──────────────────────────────────── */}
              {tab === 'conciliaciones' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <p className="text-[12px] text-gray-500 max-w-2xl">
                      Mascotas marcadas con <strong>plata faltante</strong> en algún cuadre (parcial o no recogió).
                      Aquí se gestiona el cobro: decidir si toca <strong>llamar a cobrar</strong> o si es una
                      veterinaria de <strong>facturación mensual</strong>. Al marcar como resuelto, sale de la lista.
                    </p>
                    <button onClick={cargarConciliaciones} disabled={concilLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
                      style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
                      <RefreshCw size={13} className={concilLoading ? 'animate-spin' : ''} /> Actualizar
                    </button>
                  </div>

                  {concilLoading || conciliaciones === null ? (
                    <div className="py-16 text-center text-gray-400 text-[13px]">Cargando conciliaciones…</div>
                  ) : conciliaciones.length === 0 ? (
                    <div className="py-16 text-center border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                      <CheckCircle2 size={32} className="mx-auto text-green-500 mb-2" />
                      <p className="text-[13px] text-gray-500">No hay mascotas pendientes de conciliar. Todo al día.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-3">
                        <div className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-100">
                          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Pendientes</div>
                          <div className="text-[20px] font-extrabold text-amber-700">{conciliaciones.length}</div>
                        </div>
                        <div className="px-4 py-2 rounded-xl bg-red-50 border border-red-100">
                          <div className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">Total por cobrar</div>
                          <div className="text-[20px] font-extrabold text-red-700 tabular-nums">
                            {fmt(conciliaciones.reduce((a, it) => a + montoPendiente(it), 0))}
                          </div>
                        </div>
                      </div>

                      <div className="overflow-x-auto border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <table className="w-full min-w-[1080px]">
                          <thead style={{ background: '#FAFAFA' }}>
                            <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                              {['Fecha', 'Mascota', 'Técnico', 'Veterinaria', 'A cobrar', 'Recogido', 'Falta', 'Estado', 'Vía de cobro', 'Observación', ''].map(h => (
                                <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {conciliaciones.map(it => {
                              const er = it.estado_conciliacion ? ESTADO_REV[it.estado_conciliacion] : null
                              const tec = it.cuadres_tecnico?.personal
                              return (
                                <tr key={it.id} className="text-[13px] border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(it.fecha_registro_servicio || it.fecha)}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => it.servicio_id && setDetalleItem(it)} disabled={!it.servicio_id}
                                        className="font-semibold text-gray-900 hover:text-[#1A5CD8] hover:underline text-left disabled:no-underline"
                                        title="Ver tarjeta completa de la mascota">{it.mascota_nombre || '—'}</button>
                                      {it.servicio_id && (
                                        <button type="button"
                                          onClick={async () => {
                                            // 1) el PDF real que el técnico envió por WhatsApp (si existe);
                                            // 2) si no, se genera al vuelo desde los datos del recibo — así
                                            // los de junio (sin PDF guardado) también se pueden ver.
                                            if (await abrirPdfReciboServicio(it.servicio_id)) return
                                            if (await abrirReciboPDFServicio(it.servicio_id)) return
                                            await showAlert('No se pudo generar el recibo de este servicio.', { title: 'Sin recibo' })
                                          }}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-[#0B1D4F] hover:bg-gray-100 transition-colors flex-shrink-0"
                                          title="Ver PDF del recibo">
                                          <FileText size={12} />
                                        </button>
                                      )}
                                    </div>
                                    {(() => {
                                      const exp = explicacionItem(it)
                                      return exp ? <p className="text-[10px] text-gray-500 leading-snug mt-1 max-w-[260px]">{exp}</p> : null
                                    })()}
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-600 text-[12px]">{tec ? `${tec.nombre} ${tec.apellido || ''}`.trim() : '—'}</td>
                                  <td className="px-3 py-2.5 text-[12px]">{it.veterinaria ? <span className="font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3] text-[11px]">🏥 {it.veterinaria}</span> : <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2.5 tabular-nums font-semibold text-gray-900">{valorARecoger(it) != null ? fmt(valorARecoger(it)) : '—'}</td>
                                  <td className="px-3 py-2.5 tabular-nums text-gray-700">{fmt(it.total_cobrado)}</td>
                                  <td className="px-3 py-2.5 tabular-nums font-bold text-[#DC2626]">{montoPendiente(it) > 0 ? fmt(montoPendiente(it)) : '—'}</td>
                                  <td className="px-3 py-2.5">
                                    {esFactMensual(it)
                                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FFF3DC] text-[#9A5500]">FACT. MENSUAL</span>
                                      : er
                                        ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: er.bg, color: er.color }}>{er.short}</span>
                                        : it.sin_recibo && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">SIN RECIBO</span>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <select value={it.conciliacion_via || ''} onChange={e => guardarConciliacion(it, { via: e.target.value || null })}
                                      className="text-[11px] rounded-lg border px-1.5 py-1 outline-none bg-white focus:ring-2 focus:ring-[#1A5CD8]/20"
                                      style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                                      <option value="">Definir…</option>
                                      {Object.entries(VIA_CONCIL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <button onClick={() => setObsItem(it)}
                                      className={`text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-md max-w-[180px] truncate transition-colors ${it.observaciones ? 'text-[#1A5CD8] bg-[#EFF6FF] hover:bg-[#DBEAFE]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                      title={it.observaciones || 'Agregar observación'}>
                                      <MessageSquare size={11} /> {it.observaciones ? <span className="truncate">{it.observaciones}</span> : 'Nota'}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <button onClick={() => guardarConciliacion(it, { resuelta: true })}
                                      className="flex items-center gap-1 px-2.5 py-1.5 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap">
                                      <Check size={12} /> Resuelto
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </div>

      {/* ── Modal tarjeta de mascota (detalle + evidencias + trazabilidad) ── */}
      {detalleItem && <MascotaDetalleModal item={detalleItem} explicacion={explicacionItem(detalleItem)} onClose={() => setDetalleItem(null)} />}

      {/* ── Modal comprobante de pago digital ────────────────────────────── */}
      {comprobanteItem && <ComprobanteModal item={comprobanteItem} editable={puedeEditarCuadre} actorId={personalData?.id || null} onClose={() => setComprobanteItem(null)} />}

      {/* ── Modal confirmar entrega del dinero (cuadre cerrado) ──────────── */}
      {entregaModal && cuadreData && (
        <EntregaModal
          cuadre={cuadreData}
          tecnicoNombre={nombreTecnicoSel(cuadreData.tecnico_id)}
          onClose={() => setEntregaModal(false)}
          onConfirm={confirmarEntrega}
        />
      )}

      {/* ── Modal guía del cuadre (¿cómo funciona?) ──────────────────────── */}
      {guiaOpen && <GuiaCuadreModal onClose={() => setGuiaOpen(false)} />}

      {/* ── Modal cerrar SIN firma del técnico (motivo obligatorio) ──────── */}
      {motivoCierreOpen && cuadreData && (
        <MotivoCierreModal
          tecnicoNombre={nombreTecnicoSel(cuadreData.tecnico_id)}
          estadoConf={confirmacionTecnico(cuadreData)}
          onClose={() => setMotivoCierreOpen(false)}
          onCerrar={motivo => { setMotivoCierreOpen(false); cerrarCuadre(motivo) }}
        />
      )}

      {/* ── Modal observaciones por mascota ──────────────────────────────── */}
      {/* ── Modal editar valor recogido por admin ────────────────────────── */}
      {valorRecogidoItem && (
        <ValorRecogidoModal
          item={valorRecogidoItem}
          onClose={() => setValorRecogidoItem(null)}
          onSave={async ({ total, motivo }) => {
            const ok = await guardarValorRecogido(valorRecogidoItem, { total, motivo })
            if (ok) setValorRecogidoItem(null)
          }}
        />
      )}

      {recargoManualItem && (
        <RecargoManualModal
          item={recargoManualItem}
          onClose={() => setRecargoManualItem(null)}
          onSave={async ({ recargo, motivo }) => {
            const ok = await guardarRecargoManual(recargoManualItem, { recargo, motivo })
            if (ok) setRecargoManualItem(null)
          }}
        />
      )}

      {/* ── Modal editar pago al técnico (incl. servicios cancelados) ──────── */}
      {pagoTecnicoItem && (
        <PagoTecnicoModal
          item={pagoTecnicoItem}
          onClose={() => setPagoTecnicoItem(null)}
          onSave={async ({ pago, motivo }) => {
            const ok = await guardarPagoTecnico(pagoTecnicoItem, { pago, motivo })
            if (ok) setPagoTecnicoItem(null)
          }}
        />
      )}

      {/* ── Modal reclasificar medios (efectivo↔digital) por admin ─────────── */}
      {mediosItem && (
        <MediosItemModal
          item={mediosItem}
          onClose={() => setMediosItem(null)}
          onSave={async ({ medios, motivo }) => {
            const ok = await guardarMediosItem(mediosItem, { medios, motivo })
            if (ok) setMediosItem(null)
          }}
        />
      )}


      {obsItem && (
        <ObsModal
          item={obsItem}
          cerrado={obsItem.cuadre_id && cuadreData?.id === obsItem.cuadre_id ? cuadreCerrado : (obsItem.cuadres_tecnico?.estado === 'CERRADO')}
          onClose={() => setObsItem(null)}
          onSave={async (texto, cerrado) => {
            if (cerrado) await guardarConciliacion(obsItem, { notas: texto })
            else await guardarRevision(obsItem, { observaciones: texto })
            setObsItem(null)
          }}
        />
      )}

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

                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    Comprobante de pago <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  {pagoComprobante ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                      <FileText size={14} className="text-[#1A5CD8] flex-shrink-0" />
                      <span className="text-[12px] text-gray-700 truncate flex-1">{pagoComprobante.name}</span>
                      <button type="button" onClick={() => setPagoComprobante(null)} className="text-gray-400 hover:text-red-500" title="Quitar"><X size={14} /></button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed cursor-pointer text-[12px] font-semibold text-gray-500 hover:bg-gray-50 transition-colors" style={{ borderColor: 'rgba(30,80,40,0.25)' }}>
                      <Paperclip size={14} /> Adjuntar imagen o PDF
                      <input type="file" accept="image/*,application/pdf" className="hidden"
                        onChange={e => { setPagoComprobante(e.target.files?.[0] || null); setPagoError('') }} />
                    </label>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">Imagen o PDF, máx. 8 MB.</p>
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

// ── Modal: tarjeta completa de la mascota (detalle + evidencias + trazabilidad) ─
// Muestra SOLO fotos de evidencia del servicio (recogida/pesaje/entrega/firma),
// NUNCA imágenes de recordatorios. Sirve para identificar la trayectoria.
function MascotaDetalleModal({ item, explicacion = null, onClose }) {
  const servicioId = item.servicio_id
  const [loading, setLoading]     = useState(true)
  const [svc, setSvc]             = useState(null)
  const [recogidas, setRecogidas] = useState([])
  const [cuartoFrio, setCuartoFrio] = useState([])
  const [entregas, setEntregas]   = useState([])
  const [novedades, setNovedades] = useState([])
  const [adicionales, setAdicionales] = useState([])
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!servicioId) { setLoading(false); return }
    let activo = true
    ;(async () => {
      try {
        const [{ data: s, error: se }, rg, cf, en, nv, ad] = await Promise.all([
          db.from('servicios')
            .select(`*, mascotas ( nombre, especies ( nombre ), clientes ( nombre, apellido, whatsapp ) ),
              planes ( nombre ), aliados:aliado_origen_id ( nombre, vip )`)
            .eq('id', servicioId).single(),
          db.from('recogidas').select('id, foto_recogida_url, contacto_nombre, contacto_telefono, tipo_lugar, fecha_programada, hora_programada, notas').eq('servicio_id', servicioId),
          db.from('cuarto_frio').select('nevera_codigo, posicion, peso_kg, foto_pesaje_url, created_at').eq('servicio_id', servicioId),
          db.from('entregas').select('foto_entrega_url, foto_firma_url, created_at').eq('servicio_id', servicioId),
          db.from('novedades_servicio')
            .select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por ( nombre, apellido )')
            .eq('servicio_id', servicioId).order('created_at', { ascending: true }),
          db.from('servicio_recordatorios')
            .select('id, origen, recordatorios ( nombre, precio_base )')
            .eq('servicio_id', servicioId).eq('origen', 'ADICIONAL'),
        ])
        if (se) throw se
        if (!activo) return
        setSvc(s); setRecogidas(rg.data || []); setCuartoFrio(cf.data || []); setEntregas(en.data || []); setNovedades(nv.data || []); setAdicionales(ad.data || [])
      } catch (err) {
        if (activo) setError(parsearErrorDB(err))
      } finally {
        if (activo) setLoading(false)
      }
    })()
    return () => { activo = false }
  }, [servicioId])

  const m = svc?.mascotas || {}
  const cli = m.clientes || {}
  const evidencias = [
    ...recogidas.map(r => ({ url: r.foto_recogida_url, etiqueta: 'Recogida' })),
    ...cuartoFrio.map(c => ({ url: c.foto_pesaje_url, etiqueta: 'Pesaje · cuarto frío' })),
    ...entregas.map(e => ({ url: e.foto_entrega_url, etiqueta: 'Entrega' })),
    ...entregas.map(e => ({ url: e.foto_firma_url, etiqueta: 'Firma de entrega' })),
  ].filter(x => x.url)
  const peso = cuartoFrio[0]?.peso_kg
  // Recategorización derivada de las novedades ya cargadas (sin query extra).
  const recatModal = (() => {
    const r = { plan: false, peso: false, detallePlan: null, detallePeso: null, soloComision: true }
    for (const n of novedades) {
      if (n.tipo_novedad === 'CAMBIO_PLAN') r.plan = true
      else if (n.tipo_novedad === 'RECATEGORIZACION_PESO') {
        r.peso = true; r.detallePeso = n.descripcion
        // Si ALGUNA movió el precio, manda la etiqueta de peso (misma regla que
        // recategorizacionesPorServicio, compartida para que no se desvíen).
        if (!esRecatSoloComision(n.descripcion)) r.soloComision = false
      }
      else if (n.tipo_novedad === 'NOTA' && /^Plan cambiado:/.test(n.descripcion || '')) { r.plan = true; r.detallePlan = n.descripcion }
    }
    if (!r.peso) r.soloComision = false
    return r
  })()
  const fmtTS = ts => ts ? new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const fmtD  = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

  // Desglose de cobros: para el DESGLOSE (plan, adicionales, transporte, descuento,
  // comisión, total a recaudar) se usa el valor ACTUAL del servicio, que refleja las
  // correcciones. La copia congelada del cuadre_item quedaba desactualizada en
  // cuadres CERRADOS (87 items) y mostraba el plan viejo. Lo RECOGIDO (total_cobrado
  // y medios) SÍ viene del item: es lo que el técnico recaudó en ESTE cuadre.
  const n = v => Number(v) || 0
  const comisionVal = svc?.comision_aliado != null ? n(svc.comision_aliado)
                    : item.comision != null ? n(item.comision) : 0
  // bruto (valor a cobrar) del servicio vivo = neto + comisión si está descontada.
  const grossVal = svc?.valor_total != null
    ? n(svc.valor_total) + (svc.comision_descontada ? comisionVal : 0)
    : n(item.valor_a_cobrar)
  const cob = {
    adic:        svc?.valor_adicionales != null ? n(svc.valor_adicionales)
               : item.valor_adicionales  != null ? n(item.valor_adicionales) : 0,
    transporte:  svc?.valor_transporte != null ? n(svc.valor_transporte)
               : item.transporte_reconocido != null ? n(item.transporte_reconocido) : 0,
    recargoNoct: n(svc?.recargo_nocturno),
    descuento:   n(svc?.descuento_adicional),
    descMotivo:  svc?.descuento_adicional_motivo || '',
    comision:    comisionVal,
    vet:         svc?.aliados?.nombre || item.veterinaria || '—',
    ciudad:      svc?.ciudad_recogida || item.ciudad || '',
    // NETO = bruto − comisión (lo que le queda a la empresa). La comisión es de
    // la vet y no la recoge el técnico → no es faltante suyo. Ver netoCuadreItem.
    neto:       grossVal - comisionVal,
    recogido:   n(item.total_cobrado),
    medios:     Array.isArray(item.medios_pago) ? item.medios_pago : [],
  }
  // Valor del plan: valor ACTUAL del servicio (corregido). El snapshot del item
  // solo se usa si el servicio aún no está cargado.
  cob.planSnapshot = svc?.valor_plan != null ? n(svc.valor_plan)
                   : item.valor_plan != null ? n(item.valor_plan) : null
  cob.planDerivado = cob.planSnapshot == null   // servicio anterior al desglose congelado
  // Sin snapshot (servicios previos al 23-jun): se DERIVA de forma que el desglose
  // reconstruya el bruto. bruto = plan + adicionales + transporte + recargo noct − descuento
  //   ⇒  plan = bruto + descuento − adicionales − transporte − recargo noct
  // (El fallback anterior era `bruto − adic − transporte` y OLVIDABA sumar el
  //  descuento, colapsando todo en el plan: CANDELA 169.000 salía 160.000.)
  cob.plan = cob.planSnapshot != null ? cob.planSnapshot
           : Math.max(0, grossVal + cob.descuento - cob.adic - cob.transporte - cob.recargoNoct)
  // Reconciliación: el desglose debe reconstruir el bruto registrado. Si no cuadra,
  // hay un dato mal capturado (p.ej. transporte guardado como descuento) → se avisa
  // en vez de esconderlo detrás de un total que sale por otro lado.
  cob.brutoDesglose = cob.plan + cob.adic + cob.transporte + cob.recargoNoct - cob.descuento
  cob.descuadre = Math.round(cob.brutoDesglose) - Math.round(grossVal)
  cob.cuadra    = Math.abs(cob.descuadre) <= 1
  // El desglose SOLO es verificable cuando todas sus piezas están en columnas: se
  // excluye la eutanasia (va por eutanasia_id, sin monto en el servicio), el
  // desamparado (recargo de prioridad sin columna) y el plan DERIVADO (se forzó a
  // cuadrar, así que su ✓ no probaría nada). En esos casos no se muestra el ✓/⚠.
  cob.eutanasia    = svc?.eutanasia_id != null
  cob.desamparado  = /desampar/i.test(svc?.planes?.nombre || item.plan_nombre || '')
  // Servicios anteriores al 23-jun-2026 (migración 010) no capturaban el desglose
  // congelado → su reconciliación no es fiable. Se tratan como HISTÓRICO: no se
  // marca ⚠, se acepta como está (decisión de David).
  cob.historico = !!(svc?.fecha_ingreso && svc.fecha_ingreso < '2026-06-23')
  cob.reconciliable = !cob.planDerivado && !cob.eutanasia && !cob.desamparado && !cob.historico
  // Adicional registrado pero NO sumado al total (el descuadre es justo el valor de
  // los adicionales): se cobra aparte, queda PENDIENTE. Es un caso explicado, así que
  // se muestra como tal y no como una alarma genérica de "desglose no cuadra".
  cob.adicPendiente = cob.adic > 0 && Math.abs(cob.descuadre - cob.adic) <= 1
  // Diferencia con banda aceptable [neto … bruto] (la comisión no es falta ni de más).
  cob.diferencia = cob.recogido < cob.neto ? cob.neto - cob.recogido
                 : cob.recogido > grossVal ? grossVal - cob.recogido
                 : 0

  const Dato = ({ label, children }) => (
    <div className="flex justify-between gap-3 py-1 border-b last:border-0" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
      <span className="text-[12px] text-gray-500">{label}</span>
      <span className="text-[12px] font-semibold text-gray-800 text-right">{children}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mb-10" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white rounded-t-2xl z-10" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐾</span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-bold text-gray-900">{m.nombre || 'Mascota'}</span>
                {esAliadoVip(svc) && <VipBadge />}
                <RecatBadges recat={recatModal} />
              </div>
              <div className="text-[11px] text-gray-400">{m.especies?.nombre || ''}{svc?.codigo ? ` · ${svc.codigo}` : ''}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-[13px]">Cargando trayectoria…</div>
        ) : error ? (
          <div className="p-5"><div className="flex items-center gap-2 bg-red-50 text-red-700 text-[12px] px-3 py-2 rounded-xl"><AlertCircle size={14} /> {error}</div></div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Estado / fechas */}
            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-700">{svc?.estado || '—'}</span>
              {svc?.estado_pago && <BadgeEstadoPago estado={svc.estado_pago} />}
              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500 inline-flex items-center gap-1"><Calendar size={11} /> Ingreso {fmtD(svc?.fecha_ingreso)}</span>
              {svc?.ciudad_recogida && <span className="text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500 inline-flex items-center gap-1"><MapPin size={11} /> {svc.ciudad_recogida}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Datos</p>
                <Dato label="Cliente">{`${cli.nombre || ''} ${cli.apellido || ''}`.trim() || '—'}</Dato>
                <Dato label="WhatsApp">{cli.whatsapp || '—'}</Dato>
                <Dato label="Plan">{svc?.planes?.nombre || '—'}</Dato>
                <Dato label="Veterinaria">{svc?.aliados?.nombre || '—'}</Dato>
                {peso != null && <Dato label="Peso">{peso} kg</Dato>}
                {(recogidas[0]?.contacto_nombre) && <Dato label="Contacto recogida">{recogidas[0].contacto_nombre}{recogidas[0].contacto_telefono ? ` · ${recogidas[0].contacto_telefono}` : ''}</Dato>}
              </div>
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Detalle de cobros</p>
                <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                  <span className="text-[12px] text-gray-500">
                    Valor del plan{svc?.planes?.nombre ? ` · ${svc.planes.nombre}` : ''}{peso != null ? ` · ${peso} kg` : ''}
                    {cob.planDerivado && <span className="ml-1 text-[10px] text-amber-600" title="Servicio anterior al desglose congelado (23-jun): el valor del plan se derivó del total. Se corrige con el backfill de precios.">≈ derivado</span>}
                  </span>
                  <span className="text-[12px] font-semibold text-gray-800 text-right tabular-nums">{fmt(cob.plan)}</span>
                </div>
                <div className="flex justify-between gap-3 py-1 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                  <span className="text-[12px] text-gray-500 inline-flex items-center gap-1.5">
                    Adicionales
                    {cob.adicPendiente && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FFF3DC] text-[#9A5500]">pendiente de cobro</span>
                    )}
                  </span>
                  <span className="text-[12px] font-semibold text-gray-800 text-right tabular-nums">{fmt(cob.adic)}</span>
                </div>
                {adicionales.length > 0 && (
                  <div className="pl-3 py-0.5 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                    {adicionales.map(a => (
                      <div key={a.id} className="flex justify-between gap-3 text-[11px] text-gray-500">
                        <span className="truncate">· {a.recordatorios?.nombre || 'Adicional'}</span>
                        <span className="tabular-nums">{fmt(a.recordatorios?.precio_base)}</span>
                      </div>
                    ))}
                    {cob.adicPendiente && (
                      <div className="text-[10px] text-[#9A5500] mt-0.5">Estos adicionales no están sumados al total: quedan pendientes de cobro.</div>
                    )}
                  </div>
                )}
                <Dato label={`Transporte${cob.ciudad ? ` · ${cob.ciudad}` : ''}`}>{fmt(cob.transporte)}</Dato>
                {cob.recargoNoct > 0 && <Dato label="Recargo nocturno">{fmt(cob.recargoNoct)}</Dato>}
                <Dato label="Descuento">{cob.descuento > 0 ? `- ${fmt(cob.descuento)}` : fmt(0)}</Dato>
                {cob.descMotivo && (
                  <div className="pl-3 py-0.5 text-[11px] text-orange-600 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>· Motivo: {cob.descMotivo}</div>
                )}
                <Dato label="Comisión veterinaria (info)">{fmt(cob.comision)}</Dato>
                <Dato label="Veterinaria">{cob.vet}</Dato>
                {cob.reconciliable && !cob.cuadra && !cob.adicPendiente && (
                  <div className="mt-1 flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
                    <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-amber-700 leading-snug">
                      El desglose no cuadra con el total registrado por {fmt(Math.abs(cob.descuadre))}.
                      Suele ser un dato mal capturado (p.ej. transporte registrado pero no sumado al total). Revisar el servicio.
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3 py-1.5 mt-1 border-t-2" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                  <span className="text-[12px] font-bold text-gray-700 inline-flex items-center gap-1">
                    Total a recaudar
                    {cob.reconciliable && ((cob.cuadra || cob.adicPendiente)
                      ? <Check size={12} className="text-[#16a34a]" />
                      : <AlertTriangle size={12} className="text-amber-500" />)}
                    {cob.historico && <span className="text-[10px] font-semibold text-gray-400" title="Servicio anterior al 23-jun: el desglose no se guardaba entonces. Aceptado como histórico.">histórico</span>}
                  </span>
                  <span className="text-[13px] font-extrabold text-gray-900 tabular-nums">{fmt(cob.neto)}</span>
                </div>
                <Dato label="Valor recogido">{fmt(cob.recogido)}</Dato>
                <div className="pl-3 py-0.5 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                  {cob.medios.length === 0 ? (
                    <div className="text-[11px] text-gray-400">· Sin medios de pago registrados</div>
                  ) : cob.medios.map((mp, i) => (
                    <div key={i} className="flex justify-between gap-3 text-[11px] text-gray-500">
                      <span>· {mp.metodo}</span>
                      <span className="tabular-nums">{fmt(mp.monto)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between gap-3 py-1.5 mt-1 rounded-lg px-2" style={{ background: cob.diferencia > 0 ? '#FEF3C7' : cob.diferencia < 0 ? '#EFF6FF' : '#F0FDF4' }}>
                  <span className="text-[12px] font-bold" style={{ color: cob.diferencia > 0 ? '#9A5500' : cob.diferencia < 0 ? '#1E40AF' : '#166534' }}>Diferencia</span>
                  <span className="text-[13px] font-extrabold tabular-nums" style={{ color: cob.diferencia > 0 ? '#9A5500' : cob.diferencia < 0 ? '#1E40AF' : '#166534' }}>
                    {cob.diferencia < 0 ? `+${fmt(-cob.diferencia)}` : fmt(cob.diferencia)}
                  </span>
                </div>
                {explicacion && (
                  <p className="text-[11px] text-gray-500 leading-snug mt-1.5 px-0.5">{explicacion}</p>
                )}
              </div>
            </div>

            {/* Evidencias (solo fotos del servicio, NO recordatorios) */}
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 inline-flex items-center gap-1"><Eye size={12} /> Evidencias del servicio</p>
              {evidencias.length === 0 ? (
                <p className="text-[12px] text-gray-400">Sin fotos de evidencia registradas.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {evidencias.map((ev, i) => (
                    <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer"
                      className="group relative rounded-xl overflow-hidden border block aspect-square" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                      <img src={ev.url} alt={ev.etiqueta} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <span className="absolute bottom-0 inset-x-0 text-[9px] font-semibold text-white bg-black/55 px-1.5 py-0.5">{ev.etiqueta}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Recibos del servicio (cuál afecta Finanzas + PDF + comprobantes) */}
            {servicioId && <RecibosServicio servicioId={servicioId} />}

            {/* Trazabilidad */}
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 inline-flex items-center gap-1"><Clock size={12} /> Trazabilidad</p>
              {novedades.length === 0 ? (
                <p className="text-[12px] text-gray-400">Sin novedades registradas.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {novedades.map(n => (
                    <div key={n.id} className="flex gap-2.5 text-[12px]">
                      <div className="flex flex-col items-center pt-1">
                        <div className={`w-2 h-2 rounded-full ${n.tipo_novedad === 'PAGO_RECIBIDO' ? 'bg-green-500' : 'bg-[#1A5CD8]'}`} />
                        <div className="flex-1 w-px bg-gray-200 mt-1" />
                      </div>
                      <div className="flex-1 pb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${n.tipo_novedad === 'PAGO_RECIBIDO' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700'}`}>{n.tipo_novedad}</span>
                          <span className="text-[10px] text-gray-400">{fmtTS(n.created_at)}</span>
                          {n.personal && <span className="text-[10px] text-gray-400">· {n.personal.nombre} {n.personal.apellido || ''}</span>}
                        </div>
                        <p className="text-gray-700 mt-0.5">{n.descripcion}{Number(n.valor_ajuste) ? ` (${fmt(n.valor_ajuste)})` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Modal: comprobante de pago digital (recibo_comprobantes → URL firmada) ─────
function ComprobanteModal({ item, editable = false, actorId = null, onClose }) {
  const [loading, setLoading] = useState(true)
  const [imgs, setImgs]       = useState([])
  const [error, setError]     = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [quitando, setQuitando]   = useState(null)   // storage_path en curso
  const [quitarError, setQuitarError] = useState('')
  const { confirm } = useConfirm()
  const { personalData } = useAuth()
  // La RPC exige el rol por nombre; `puedeEditarCuadre` también deja pasar por
  // `rol_principal_id`, así que aquí se traduce igual o el botón se vería
  // habilitado y la llamada moriría con NO_AUTORIZADO.
  const rolEfectivo = personalData?.rol
    || ({ 1: 'COORDINADOR', 6: 'ADMIN' })[Number(personalData?.rol_principal_id)]
    || null

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        // Buscar SIEMPRE por servicio_id cuando exista: es la llave universal y
        // siempre coincide. El recibo_id no sirve como filtro principal porque un
        // servicio puede tener varios recibos_tecnico (recreado/reabierto) y el
        // comprobante suele quedar bajo un recibo_id distinto al del item del cuadre
        // → daba "no hay comprobante" aunque el técnico sí lo había subido.
        let query = db.from('recibo_comprobantes').select('id, bucket, storage_path, mime_type, estado, eliminado_en')
        if (item.servicio_id)      query = query.eq('servicio_id', item.servicio_id)
        else if (item.recibo_id)   query = query.eq('recibo_id', item.recibo_id)
        else { if (activo) { setImgs([]); setLoading(false) } return }
        const { data: todas, error: ce } = await query
        if (ce) throw ce
        const out = []
        const rutasVistas = new Set()   // storage_path ya incluidos (para deduplicar)
        // Ocultas: quitadas por coordinación (migr. 141) o reemplazadas por el
        // técnico. ⚠️ Sus rutas TAMBIÉN entran en `rutasVistas`, o el respaldo
        // del jsonb de más abajo las devolvería a la galería por la otra puerta.
        const oculta = c => c.eliminado_en != null || c.estado === 'RECHAZADO'
        const comps  = (todas || []).filter(c => !oculta(c))
        for (const c of (todas || []).filter(oculta)) {
          if (c.storage_path) rutasVistas.add(c.storage_path)
        }
        for (const c of comps || []) {
          const { data: signed } = await db.storage.from(c.bucket || 'evidencias').createSignedUrl(c.storage_path, 300)
          if (signed?.signedUrl) { out.push({ ...c, url: signed.signedUrl }); if (c.storage_path) rutasVistas.add(c.storage_path) }
        }
        // Respaldo: muchos comprobantes viven SOLO en el jsonb del recibo
        // (recibos_tecnico.medios_pago[].comprobanteUrl) porque la inserción en
        // recibo_comprobantes es best-effort y a veces falla en silencio. El
        // técnico los ve desde ahí; Finanzas también debe. Son publicUrl del
        // bucket `evidencias`, se muestran directo. Se deduplica por storage_path.
        if (item.servicio_id) {
          const { data: recs } = await db.from('recibos_tecnico')
            .select('medios_pago').eq('servicio_id', item.servicio_id)
          for (const r of recs || []) {
            for (const mp of (Array.isArray(r.medios_pago) ? r.medios_pago : [])) {
              const publicUrl = mp?.comprobanteUrl
              if (!publicUrl) continue
              const ruta = publicUrl.split('/evidencias/')[1]
                ? decodeURIComponent(publicUrl.split('/evidencias/')[1])   // storage_path implícito
                : null
              if (ruta && rutasVistas.has(ruta)) continue
              if (ruta) rutasVistas.add(ruta)
              // Firmar la ruta (sirve con bucket público o privado); si no se pudo
              // derivar la ruta, usar la publicUrl tal cual como último recurso.
              let url = publicUrl
              if (ruta) {
                const { data: signed } = await db.storage.from('evidencias').createSignedUrl(ruta, 300)
                if (signed?.signedUrl) url = signed.signedUrl
              }
              out.push({ id: publicUrl, url, storage_path: ruta || publicUrl, mime_type: mp.mime_type || null, estado: null })
            }
          }
        }
        if (activo) setImgs(out)
      } catch (err) {
        if (activo) setError(parsearErrorDB(err))
      } finally {
        if (activo) setLoading(false)
      }
    })()
    return () => { activo = false }
  }, [item])

  async function subirDesdeAdmin(file) {
    if (!file || !item.servicio_id) return
    setUploading(true); setUploadError('')
    let comprobante = null
    try {
      comprobante = await subirComprobantePago(item.servicio_id, file)
      const { data: creado, error: insertError } = await db.from('recibo_comprobantes').insert({
        servicio_id: item.servicio_id,
        recibo_id: item.recibo_id || null,
        bucket: comprobante.bucket,
        storage_path: comprobante.storage_path,
        mime_type: comprobante.mime_type,
        estado: 'APROBADO',
        uploaded_by: actorId,
      }).select('id, bucket, storage_path, mime_type, estado').single()
      if (insertError) {
        await db.storage.from(comprobante.bucket).remove([comprobante.storage_path])
        throw insertError
      }
      const { data: signed } = await db.storage.from(creado.bucket || 'evidencias')
        .createSignedUrl(creado.storage_path, 300)
      setImgs(prev => [...prev, { ...creado, url: signed?.signedUrl || '' }])
    } catch (err) {
      setUploadError(parsearErrorDB(err))
    } finally {
      setUploading(false)
    }
  }

  // ── Quitar un comprobante duplicado (migración 141) ─────────────────────────
  // Solo coordinación/gerencia. Apaga las DOS fuentes —la fila de
  // `recibo_comprobantes` y el `comprobanteUrl` del jsonb del recibo—; si solo
  // se apagara una, la galería lo resucitaría en el siguiente render. El archivo
  // NO se borra de storage: la marca es reversible.
  async function quitarComprobante(c) {
    if (!item.servicio_id) return
    const ok = await confirm(
      'El comprobante deja de verse en el cuadro y en la ficha del servicio. El archivo NO se borra: queda guardado y se puede recuperar. Queda registrado quién lo quitó en la bitácora del servicio.',
      { title: '¿Quitar este comprobante?', variant: 'danger', confirmLabel: 'Sí, quitarlo' }
    )
    if (!ok) return
    setQuitando(c.storage_path || c.id); setQuitarError('')
    try {
      const esFila = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(c.id))
      const { data, error: e } = await db.rpc('eliminar_comprobante_pago', {
        p_servicio_id:    item.servicio_id,
        p_comprobante_id: esFila ? c.id : null,
        p_storage_path:   c.storage_path || null,
        p_url:            esFila ? null : String(c.id),   // en los del jsonb, el id ES la URL
        p_actor_id:       actorId,
        p_actor_rol:      rolEfectivo,
        p_motivo:         'Comprobante duplicado',
      })
      if (e) throw e
      if (data?.quitado === false) { setQuitarError(data?.motivo_no || 'No se pudo quitar.'); return }
      setImgs(prev => prev.filter(x => x.id !== c.id))
    } catch (err) {
      setQuitarError(parsearErrorDB(err))
    } finally { setQuitando(null) }
  }

  const digitales = (item.medios_pago || []).filter(mp => String(mp.metodo).toUpperCase() !== 'EFECTIVO' && Number(mp.monto) > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mb-10" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#1A5CD8]" />
            <span className="text-[14px] font-bold text-gray-900">Comprobante de pago</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="text-[12px] text-gray-500">{item.mascota_nombre || '—'}</span>
            {digitales.map((mp, i) => (
              <span key={i} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1E40AF]">{mp.metodo} · {fmt(mp.monto)}</span>
            ))}
          </div>
          {editable && item.servicio_id && (
            <div className="rounded-xl border bg-gray-50 px-3 py-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              <label className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[12px] font-semibold transition-colors ${uploading ? 'cursor-wait text-gray-400 bg-gray-100' : 'cursor-pointer text-[#1A5CD8] bg-white hover:bg-[#EFF6FF]'}`}
                style={{ borderColor: 'rgba(26,92,216,0.28)' }}>
                <Paperclip size={14} /> {uploading ? 'Subiendo comprobante…' : 'Subir comprobante desde Admin'}
                <input type="file" accept="image/*,application/pdf" disabled={uploading} className="sr-only"
                  onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) await subirDesdeAdmin(file) }} />
              </label>
              <p className="mt-1.5 text-[10px] text-gray-400">Imagen o PDF · máximo 8 MB.</p>
              {uploadError && <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700"><AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> {uploadError}</div>}
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-[13px]">Cargando comprobante…</div>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-[12px] px-3 py-2 rounded-xl"><AlertCircle size={14} /> {error}</div>
          ) : imgs.length === 0 ? (
            <div className="py-10 text-center">
              <AlertTriangle size={26} className="mx-auto text-amber-400 mb-2" />
              <p className="text-[13px] text-gray-500">No hay comprobante subido para este recibo.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {imgs.length > 1 && editable && (
                <div className="rounded-xl bg-[#FFF7ED] border border-[#FED7AA] px-3 py-2 text-[11px] text-[#9A3412] leading-snug">
                  Este servicio tiene {imgs.length} comprobantes. Si alguno sobra —el técnico guardó el recibo varias veces— quítalo con la papelera: el archivo no se borra.
                </div>
              )}
              {quitarError && (
                <div className="flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                  <AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> {quitarError}
                </div>
              )}
              {imgs.map(c => {
                const esPdf = (c.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf($|\?)/i.test(c.storage_path || '')
                return (
                  <div key={c.id}>
                    {esPdf ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 py-4 rounded-xl border text-[13px] font-semibold text-[#1A5CD8] hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <FileText size={16} /> Abrir comprobante (PDF)
                      </a>
                    ) : (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                        <img src={c.url} alt="Comprobante" className="w-full object-contain max-h-[60vh] bg-gray-50" />
                      </a>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {c.estado
                        ? <span className="text-[10px] text-gray-400">Estado: {c.estado}</span>
                        : <span className="text-[10px] text-gray-300">Sin registro formal · solo en el recibo</span>}
                      {editable && item.servicio_id && (
                        <button type="button" onClick={() => quitarComprobante(c)}
                          disabled={quitando != null}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-40">
                          <Trash2 size={12} />
                          {quitando === (c.storage_path || c.id) ? 'Quitando…' : 'Quitar'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: editar recargo en cuadre (solo ADMIN) ──────────────────────────
function RecargoManualModal({ item, onClose, onSave }) {
  const [valor, setValor]   = useState(String(item.recargo_aplicado ?? 0))
  const [motivo, setMotivo] = useState(item.recargo_manual_motivo || '')
  const [saving, setSaving] = useState(false)
  const actual = Number(item.recargo_aplicado) || 0
  const nuevo  = Number(valor)
  const invalido = !Number.isFinite(nuevo) || nuevo < 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-[#d97706]" />
            <span className="text-[14px] font-bold text-gray-900">Modificar recargo</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] font-bold text-gray-900">{item.mascota_nombre || 'Mascota'}</div>
            <div className="text-[11px] text-gray-500">Actual: {fmt(actual)}</div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nuevo valor de recargo</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
              <input type="number" min={0} step={1000} value={valor} autoFocus
                onChange={e => setValor(e.target.value)}
                className="w-full pl-6 pr-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#d97706]/20 focus:border-[#d97706]"
                style={{ borderColor: invalido ? '#FCA5A5' : 'rgba(30,80,40,0.2)' }} />
            </div>
            {invalido ? (
              <p className="text-[11px] text-red-600 mt-1">Debe ser mayor o igual a cero.</p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1">Este valor reemplaza el recargo final reconocido al tecnico.</p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Motivo</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Ej: ajuste autorizado por gerencia"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#d97706]/20 focus:border-[#d97706] resize-none"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button onClick={async () => { setSaving(true); await onSave({ recargo: nuevo, motivo: motivo.trim() }); setSaving(false) }} disabled={saving || invalido}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#d97706] hover:bg-[#b45309] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: editar el pago reconocido al técnico (ADMIN/COORDINADOR) ───────
// Pensado sobre todo para los servicios CANCELADOS: la tarifa del viaje perdido
// es un monto fijo igual para todos y aquí se ajusta al viaje real.
function PagoTecnicoModal({ item, onClose, onSave }) {
  const [valor, setValor]   = useState(String(item.pago_servicio ?? 0))
  const [motivo, setMotivo] = useState(item.pago_servicio_motivo || '')
  const [saving, setSaving] = useState(false)
  const actual = Number(item.pago_servicio) || 0
  const nuevo  = Number(valor)
  const invalido = !Number.isFinite(nuevo) || nuevo < 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-[#0E7490]" />
            <span className="text-[14px] font-bold text-gray-900">
              {item.es_cancelado ? 'Pago por el viaje cancelado' : 'Modificar pago al técnico'}
            </span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] font-bold text-gray-900">{item.mascota_nombre || 'Mascota'}</div>
            <div className="text-[11px] text-gray-500">
              Actual: {fmt(actual)}{item.ciudad ? ` · ${item.ciudad}` : ''}
            </div>
          </div>
          {item.es_cancelado && (
            <p className="text-[11px] text-gray-600 bg-[#ECFEFF] border rounded-xl px-3 py-2 leading-snug" style={{ borderColor: '#A5F3FC' }}>
              El servicio se canceló con el técnico ya en camino. El valor de arranque es la tarifa fija de cancelado; súbelo si el viaje lo justifica. Suma a <strong>Pago por cancelados</strong> y baja el dinero a entregar.
            </p>
          )}
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nuevo valor reconocido</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
              <input type="number" min={0} step={1000} value={valor} autoFocus
                onChange={e => setValor(e.target.value)}
                className="w-full pl-6 pr-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#0E7490]/20 focus:border-[#0E7490]"
                style={{ borderColor: invalido ? '#FCA5A5' : 'rgba(30,80,40,0.2)' }} />
            </div>
            {invalido ? (
              <p className="text-[11px] text-red-600 mt-1">Debe ser mayor o igual a cero.</p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1">Reemplaza el pago reconocido al técnico en esta fila.</p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Motivo</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Ej: cancelaron con el técnico ya en Chía"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#0E7490]/20 focus:border-[#0E7490] resize-none"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button onClick={async () => { setSaving(true); await onSave({ pago: nuevo, motivo: motivo.trim() }); setSaving(false) }} disabled={saving || invalido}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0E7490] hover:bg-[#155E75] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: editar valor recogido en cuadre (solo ADMIN) ───────────────────
function ValorRecogidoModal({ item, onClose, onSave }) {
  const [valor, setValor]   = useState(String(item.total_cobrado ?? 0))
  const [motivo, setMotivo] = useState(item.valor_recogido_motivo || '')
  const [saving, setSaving] = useState(false)
  const digital = Number(item.digital) || 0
  const actual  = Number(item.total_cobrado) || 0
  const nuevo   = Number(valor)
  const invalido = !Number.isFinite(nuevo) || nuevo < 0 || nuevo < digital
  const nuevoEfectivo = Number.isFinite(nuevo) ? Math.max(0, nuevo - digital) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-[#1A5CD8]" />
            <span className="text-[14px] font-bold text-gray-900">Modificar valor recogido</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] font-bold text-gray-900">{item.mascota_nombre || 'Mascota'}</div>
            <div className="text-[11px] text-gray-500">Actual: {fmt(actual)} · Digital fijo: {fmt(digital)}</div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Nuevo valor recogido</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
              <input type="number" min={digital} step={1000} value={valor} autoFocus
                onChange={e => setValor(e.target.value)}
                className="w-full pl-6 pr-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8]"
                style={{ borderColor: invalido ? '#FCA5A5' : 'rgba(30,80,40,0.2)' }} />
            </div>
            {invalido ? (
              <p className="text-[11px] text-red-600 mt-1">Debe ser mayor o igual a {fmt(digital)} porque ese valor digital ya está registrado.</p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1">Efectivo recalculado: <strong>{fmt(nuevoEfectivo)}</strong></p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Motivo</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Ej: el técnico cargó el valor errado en el recibo"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] resize-none"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button onClick={async () => { setSaving(true); await onSave({ total: nuevo, motivo: motivo.trim() }); setSaving(false) }} disabled={saving || invalido}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1A5CD8] hover:bg-[#1550C0] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: reclasificar medios de pago de una fila (ADMIN/COORDINADOR) ────────
// Cambia CÓMO se repartió lo cobrado entre efectivo y digital, SIN mover el
// total. Caso típico: se registró EFECTIVO pero pagaron por Nequi a la empresa.
// El recibo no se toca; la corrección vive en el cuadre con motivo (migración 060).
const METODOS_MEDIO = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO']
function MediosItemModal({ item, onClose, onSave }) {
  const total = Number(item.total_cobrado)
    || (Number(item.efectivo) || 0) + (Number(item.digital) || 0)
  const inicial = () => {
    const src = Array.isArray(item.medios_pago) ? item.medios_pago.filter(m => Number(m.monto) > 0) : []
    if (src.length) return src.map(m => ({ metodo: String(m.metodo || 'EFECTIVO').toUpperCase(), monto: String(Math.round(Number(m.monto) || 0)) }))
    const filas = []
    if (Number(item.efectivo) > 0) filas.push({ metodo: 'EFECTIVO', monto: String(Math.round(Number(item.efectivo))) })
    if (Number(item.digital)  > 0) filas.push({ metodo: 'OTRO',     monto: String(Math.round(Number(item.digital))) })
    return filas.length ? filas : [{ metodo: 'EFECTIVO', monto: String(Math.round(total)) }]
  }
  const [filas, setFilas]   = useState(inicial)
  const [motivo, setMotivo] = useState(item.medios_motivo || '')
  const [saving, setSaving] = useState(false)

  const suma = filas.reduce((a, f) => a + (Number(f.monto) || 0), 0)
  const cuadra = Math.round(suma) === Math.round(total)
  const efectivoNuevo = filas.filter(f => f.metodo === 'EFECTIVO').reduce((a, f) => a + (Number(f.monto) || 0), 0)
  const digitalNuevo  = suma - efectivoNuevo
  const invalido = !cuadra || !motivo.trim() || filas.some(f => !(Number(f.monto) > 0))

  const setFila  = (i, patch) => setFilas(prev => prev.map((f, k) => k === i ? { ...f, ...patch } : f))
  const addFila  = () => setFilas(prev => [...prev, { metodo: 'NEQUI', monto: '' }])
  const delFila  = (i) => setFilas(prev => prev.length > 1 ? prev.filter((_, k) => k !== i) : prev)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={16} className="text-[#1A5CD8]" />
            <span className="text-[14px] font-bold text-gray-900">Reclasificar medio de pago</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[13px] font-bold text-gray-900">{item.mascota_nombre || 'Mascota'}</div>
            <div className="text-[11px] text-gray-500">Total recogido (fijo): <strong>{fmt(total)}</strong> · el recibo del cliente no cambia</div>
          </div>

          <div className="rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] px-3 py-2 text-[11px] text-[#1E40AF] leading-snug">
            Cambia cómo se repartió lo cobrado entre efectivo y digital. Lo digital entra a la empresa y baja lo que el técnico debe entregar. No cambia el total.
          </div>

          <div className="space-y-2">
            {filas.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={f.metodo} onChange={e => setFila(i, { metodo: e.target.value })}
                  className="flex-1 px-2.5 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] bg-white"
                  style={{ borderColor: 'rgba(30,80,40,0.2)' }}>
                  {METODOS_MEDIO.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <div className="relative w-[130px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
                  <input type="number" min={0} step={1000} value={f.monto}
                    onChange={e => setFila(i, { monto: e.target.value })}
                    className="w-full pl-6 pr-2 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8]"
                    style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
                </div>
                <button type="button" onClick={() => delFila(i)} disabled={filas.length <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={addFila} className="text-[12px] font-semibold text-[#1A5CD8] hover:underline">+ Agregar medio</button>
          </div>

          <div className="flex items-center justify-between text-[12px] rounded-xl bg-gray-50 border px-3 py-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <span className="text-gray-600">Efectivo <strong className="text-[#16a34a]">{fmt(efectivoNuevo)}</strong> · Digital <strong className="text-[#1E40AF]">{fmt(digitalNuevo)}</strong></span>
            {cuadra
              ? <span className="text-[#16a34a] font-semibold inline-flex items-center gap-0.5"><Check size={12} /> {fmt(suma)}</span>
              : <span className="text-red-600 font-semibold">suman {fmt(suma)} ≠ {fmt(total)}</span>}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Motivo</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
              placeholder="Ej: le dijeron efectivo pero pagó por Nequi a la cuenta de la empresa"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] resize-none"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button onClick={async () => { setSaving(true); await onSave({ medios: filas.map(f => ({ metodo: f.metodo, monto: Number(f.monto) || 0 })), motivo: motivo.trim() }); setSaving(false) }}
              disabled={saving || invalido}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1A5CD8] hover:bg-[#1550C0] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Modal: observación por mascota (feature 3) ────────────────────────────────
// ── Modal: cerrar el cuadre SIN la firma del técnico ─────────────────────────
// El cierre está bloqueado por la DB (cerrar_cuadre v2, migración 038) hasta que
// el técnico confirme desde su app. Esta es la excepción: motivo obligatorio que
// queda registrado en firma.cierre_forzado del cuadre.
function MotivoCierreModal({ tecnicoNombre, estadoConf, onClose, onCerrar }) {
  const [motivo, setMotivo] = useState('')
  const valido = motivo.trim().length >= 5
  const detalle = estadoConf === 'DESACTUALIZADA'
    ? `${tecnicoNombre} firmó una versión anterior: los montos cambiaron después de su confirmación, así que su firma ya no es válida para esta versión.`
    : `${tecnicoNombre} aún no ha firmado este cuadre desde su app (Mis pagos › Cuadres). Le aparece un aviso apenas abra la app.`
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-[#D97706]" />
            <span className="text-[14px] font-bold text-gray-900">Falta la firma del técnico</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-gray-600">{detalle}</p>
          <p className="text-[12px] text-gray-500">
            Lo recomendado es <b>esperar su confirmación</b> para que el cuadre quede acordado por
            las dos partes. Si necesitas cerrarlo ya (técnico retirado, sin respuesta, urgencia),
            escribe el motivo — <b>queda registrado en el cuadre</b>.
          </p>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} autoFocus
            placeholder="Ej: el técnico se retiró de la empresa; no responde hace 5 días y hay cierre de mes…"
            className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#D97706]/20 focus:border-[#D97706] resize-none"
            style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          {!valido && motivo.length > 0 && (
            <p className="text-[11px] text-red-500">El motivo debe ser más específico.</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>
              Esperar la firma
            </button>
            <button onClick={() => valido && onCerrar(motivo.trim())} disabled={!valido}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#D97706' }}>
              <Lock size={14} /> Cerrar SIN firma del técnico
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ObsModal({ item, cerrado, onClose, onSave }) {
  const [texto, setTexto]   = useState(item.observaciones || '')
  const [saving, setSaving] = useState(false)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-[#1A5CD8]" />
            <span className="text-[14px] font-bold text-gray-900">Observación · {item.mascota_nombre || 'mascota'}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-gray-500">Por qué no cuadró esta mascota o cualquier novedad del proceso. Queda registrada.</p>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} autoFocus
            placeholder="Ej: el cliente quedó de pagar el lunes; la veterinaria factura mensual; faltó un adicional…"
            className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] resize-none"
            style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button onClick={async () => { setSaving(true); await onSave(texto.trim(), cerrado); setSaving(false) }} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1A5CD8] hover:bg-[#1550C0] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: confirmar entrega del dinero a gerencia (cuadre CERRADO) ──────────
// Registra quién recibió el efectivo, cuándo, el monto y notas. Es de una sola
// vez (la RPC confirmar_entrega_cuadre falla si ya está confirmada).
function EntregaModal({ cuadre, tecnicoNombre, onClose, onConfirm }) {
  const [monto, setMonto]   = useState(String(cuadre.dinero_a_entregar ?? ''))
  const [notas, setNotas]   = useState('')
  const [saving, setSaving] = useState(false)
  const montoNum = parseFloat(monto)
  const esperado = Number(cuadre.dinero_a_entregar) || 0
  const difiere  = !isNaN(montoNum) && montoNum !== esperado
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <Banknote size={16} className="text-[#16a34a]" />
            <span className="text-[14px] font-bold text-gray-900">Confirmar dinero recibido</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-gray-500">
            Registra que <strong>{tecnicoNombre}</strong> entregó el efectivo de este cuadre.
            Queda guardado quién lo recibió, cuándo y el monto. <strong>No se puede deshacer.</strong>
          </p>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Monto recibido</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-semibold select-none">$</span>
              <input type="number" min={0} step={1000} value={monto} autoFocus
                onChange={e => setMonto(e.target.value)}
                className="w-full pl-6 pr-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8]"
                style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Según el cuadre: {fmt(esperado)}</p>
            {difiere && (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg mt-1">
                <AlertTriangle size={12} /> El monto no coincide con el cuadre. Explica la diferencia en las notas.
              </div>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">Notas <span className="font-normal text-gray-400">(opcional)</span></label>
            <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Ej: entregó en la oficina; faltó $10.000 que trae mañana…"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20 focus:border-[#1A5CD8] resize-none"
              style={{ borderColor: 'rgba(30,80,40,0.2)' }} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold border text-gray-600 hover:bg-gray-50 disabled:opacity-60" style={{ borderColor: 'rgba(30,80,40,0.15)' }}>Cancelar</button>
            <button disabled={saving || isNaN(montoNum) || montoNum < 0 || (difiere && !notas.trim())}
              onClick={async () => { setSaving(true); await onConfirm(montoNum, notas.trim()); setSaving(false) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#16a34a] hover:bg-[#15803d] text-white rounded-xl text-[13px] font-semibold disabled:opacity-60">
              {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />} Confirmar recibido
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: guía del cuadre para gerencia (¿cómo funciona?) ───────────────────
// Resumen operable de docs/Finanzas_Cuadre_Flujo.md — mantener sincronizados.
function GuiaCuadreModal({ onClose }) {
  const Paso = ({ n, titulo, children }) => (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-[#1A5CD8] text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0">{n}</div>
      <div className="flex-1">
        <p className="text-[13px] font-bold text-gray-900">{titulo}</p>
        <div className="text-[12px] text-gray-600 mt-0.5 space-y-1">{children}</div>
      </div>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mb-10" style={{ border: '1px solid rgba(30,80,40,0.12)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white rounded-t-2xl z-10" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-[#1A5CD8]" />
            <span className="text-[14px] font-bold text-gray-900">Cómo hacer el cuadre con un técnico</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-5">
          <Paso n={1} titulo="Generar el cuadre">
            <p>Elige el técnico (el rango se sugiere solo: desde el día siguiente al último cuadre cerrado, hasta hoy) y pulsa <strong>Generar cuadre</strong>. Entran todos los servicios que el técnico recogió en el rango: con recibo, <strong>SIN RECIBO</strong> (recogió pero no cobró) y cancelados.</p>
            <p>Mientras esté en <strong>BORRADOR</strong> puedes regenerarlo las veces que quieras (cambiar rango, ajuste, lejanía…); no se pierde nada.</p>
            <p>· Si te quedaron borradores de prueba, en <strong>Cuadres anteriores</strong> cada uno trae un botón 🗑 para <strong>descartarlo</strong>. Solo borra el borrador: los recibos y servicios quedan intactos y vuelven a entrar en el próximo cuadre. Un cuadre <strong>CERRADO</strong> nunca se puede descartar.</p>
          </Paso>
          <Paso n={2} titulo="Revisar fila por fila">
            <p>· Cada mascota con algo por resolver trae su <strong>explicación en palabras</strong> debajo del nombre (por qué falta plata, qué hacer). Y el botón <strong>✨ Analizar con IA</strong> te da una guía del cuadre completo leyendo las notas del técnico — solo sugiere, tú confirmas.</p>
            <p>· <strong>Diferencia</strong>: compara lo recogido contra el valor a recoger. Si aparece un <strong>+</strong>, se cobró por encima de ese valor y la columna <strong>Acción</strong> sugerirá <strong>Pendiente gestionar</strong>.</p>
            <p>· Filas <span className="font-bold text-amber-700">ámbar</span> = falta plata o hay cobro por encima del valor a recoger. Elige en <strong>Acción</strong>: <strong>Verificado OK</strong> (saldado, no se debe nada) o <strong>Pendiente gestionar</strong> (queda para revisar/cobrar después en <strong>Conciliaciones</strong>).</p>
            <p>· <strong>FACT. MENSUAL</strong>: la veterinaria paga por factura a fin de mes; el técnico no recoge esa plata. <strong>SIN RECIBO</strong>: hay que cobrar ese servicio; va solo a Conciliaciones.</p>
            <p>· Marca <strong>Lejanía</strong> si la recogida fue lejos (reconocimiento extra al técnico). Solo <strong>efectivo</strong> cuenta como plata en manos del técnico; lo digital ya entró a la empresa.</p>
            <p>· <strong>CANCELADO</strong>: el técnico ya había salido, así que se le reconoce el viaje perdido con la tarifa fija de cancelado. Con el lápiz de <strong>Pago téc.</strong> lo ajustas al viaje real (y también puedes marcarle lejanía, recargo o dejar una nota). No hay cobro al cliente.</p>
          </Paso>
          <Paso n={3} titulo="Cerrar el cuadre">
            <p>· Antes de cerrar, el <strong>técnico firma el cuadre desde su app</strong> (Mis pagos › Cuadres — le aparece un aviso apenas la abre): el chip junto al estado te dice si ya firmó, si firmó otra versión (los montos cambiaron después) o si sigue sin firmar. <strong>Sin su firma el cierre queda bloqueado</strong>; solo puedes forzarlo escribiendo un motivo que queda registrado en el cuadre.</p>
            <p>· El botón <strong>Cerrar</strong> congela el cuadre (no se puede editar más). El sistema avisa si falta un comprobante de pago digital o si el técnico debe efectivo sin justificar — puedes cerrar de todas formas, pero revisa primero.</p>
            <p><strong>Dinero a entregar a gerencia</strong> = efectivo recogido − reconocido al técnico (transporte + recargos + pago por servicio + cancelados) − ajuste manual. Si da negativo, la empresa le queda debiendo al técnico (saldo a favor: se avisa en el siguiente cuadre).</p>
          </Paso>
          <Paso n={4} titulo="Confirmar la entrega del dinero">
            <p>Cuando el técnico entregue el efectivo, pulsa <strong>Confirmar dinero recibido</strong> en el cuadre cerrado. Queda registrado quién recibió, cuándo y el monto. En <strong>Cuadres anteriores</strong> se ve cuáles siguen pendientes de entrega.</p>
          </Paso>
          <div className="bg-gray-50 rounded-xl p-3 text-[11px] text-gray-500 border" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
            💡 Un pago pendiente del cliente <strong>no bloquea</strong> el cierre: se marca <em>Pendiente gestionar</em> y el cobro se sigue en <strong>Conciliaciones</strong>, incluso con el cuadre ya cerrado. El PDF del cuadre se puede volver a descargar abriendo el cuadre desde <strong>Cuadres anteriores</strong>.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-componente FilaTotal (resumen del cuadre) ────────────────────────────
function FilaTotal({ label, valor, color = '#374151', bold = false, hint = null, info = false }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${info ? 'opacity-70' : ''}`}>
      <span className={`text-[12px] ${bold ? 'font-bold text-gray-800' : 'text-gray-500'}`}>
        {label}
        {hint && <span className="block text-[10px] font-normal text-gray-400 italic leading-tight">{hint}</span>}
      </span>
      <span className={`tabular-nums whitespace-nowrap ${bold ? 'text-[14px] font-extrabold' : 'text-[13px] font-semibold'}`}
        style={info ? { color: '#9CA3AF' } : { color }}>{info ? `(${fmt(valor)})` : fmt(valor)}</span>
    </div>
  )
}

// ── PDF del cuadre (jsPDF directo — patrón del proyecto, NUNCA html2canvas) ──
async function generarCuadrePDF(c, items, tecnicoNombre) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('l', 'mm', 'a4')   // horizontal: caben todas las columnas
  const W = 297, H = 210, M = 10, CW = W - M * 2
  const G = [31, 90, 50]
  const t = (text, x, y, opts = {}) => pdf.text(String(text ?? ''), x, y, opts)
  const fechaCorta = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
  const EST = { VERIFICADO: 'OK', PENDIENTE_GESTIONAR: 'Pendiente' }
  // Diferencia por fila (misma regla que la pantalla: banda neto..bruto; FM = a cobrar al aliado).
  const difFila = it => {
    if (it.es_cancelado) return '—'
    if (it.modalidad_comision === 'FACTURACION_MENSUAL') return 'FM ' + fmt((Number(it.valor_a_cobrar) || 0) - (Number(it.comision) || 0))
    const neto = netoCuadreItem(it)
    if (neto == null) return '—'
    const bruto = it.valor_a_cobrar != null ? Number(it.valor_a_cobrar) : neto
    const recog = Number(it.total_cobrado) || 0
    if (recog < neto) return fmt(neto - recog)
    if (recog > bruto) return '+' + fmt(recog - bruto)
    return fmt(0)
  }
  const netoFila = it => { const v = netoCuadreItem(it); return v == null ? '—' : fmt(v) }

  // Cabecera
  pdf.setFillColor(...G); pdf.rect(0, 0, W, 22, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(255, 255, 255)
  t('Camino al Cielo', M, 10)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(196, 168, 122)
  t('CUADRE DE CUENTAS — TÉCNICO', M, 16.5)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(220, 230, 222)
  t(`${c.estado}${c.cerrado_en ? '  ·  Cerrado ' + new Date(c.cerrado_en).toLocaleDateString('es-CO') : ''}`, W - M, 16.5, { align: 'right' })

  let y = 30
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(20, 20, 20)
  t(tecnicoNombre, M, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 90, 90)
  t(`Periodo: ${fechaCorta(c.fecha_desde)} a ${fechaCorta(c.fecha_hasta)}  ·  ${c.total_servicios} servicio(s)`, M, y + 5)
  y += 11

  // Tabla — todas las columnas (anchos suman 277 = CW)
  const cols = [
    ['Fecha', 14, 'l'], ['Mascota', 24, 'l'], ['Ciudad', 15, 'l'], ['Veterinaria', 24, 'l'], ['Plan', 16, 'l'],
    ['A cobrar', 17, 'r'], ['Comisión', 15, 'r'], ['Recogido', 17, 'r'], ['Diferencia', 17, 'r'],
    ['Efectivo', 15, 'r'], ['Digital', 15, 'r'], ['Transp.', 14, 'r'], ['Pago', 13, 'r'], ['Recargo', 13, 'r'],
    ['Lej.', 11, 'c'], ['Estado', 17, 'l'], ['Observación', 20, 'l'],
  ]
  const drawHead = () => {
    pdf.setFillColor(240, 243, 240); pdf.rect(M, y, CW, 6.5, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.3); pdf.setTextColor(60, 60, 60)
    let x = M + 1.5
    cols.forEach(([h, w, a]) => {
      const tx = a === 'r' ? x + w - 1.5 : a === 'c' ? x + w / 2 : x
      t(h, tx, y + 4.3, { align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }); x += w
    })
    y += 6.5
  }
  drawHead()

  pdf.setFontSize(6); pdf.setTextColor(40, 40, 40)
  items.forEach(it => {
    if (y > H - 20) { pdf.addPage(); y = 14; drawHead(); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor(40, 40, 40) }
    pdf.setFont('helvetica', 'normal')
    let x = M + 1.5
    const vals = [
      fechaCorta(it.fecha_registro_servicio || it.fecha),
      (it.mascota_nombre || '—').slice(0, 18),
      (it.ciudad || '—').slice(0, 11),
      (it.veterinaria || '—').slice(0, 18),
      (it.plan_nombre || '—').slice(0, 12),
      netoFila(it),
      Number(it.comision) > 0 ? fmt(it.comision) : '—',
      it.es_cancelado ? '—' : fmt(it.total_cobrado),
      difFila(it),
      fmt(it.efectivo),
      Number(it.digital) > 0 ? fmt(it.digital) : '—',
      it.transporte_sin_dato ? 's/d' : fmt(it.transporte_reconocido),
      Number(it.pago_servicio) > 0 ? fmt(it.pago_servicio) : '—',
      Number(it.recargo_aplicado) > 0 ? fmt(it.recargo_aplicado) : '—',
      it.es_lejania ? 'Sí' : '—',
      it.es_cancelado
        ? (EST[it.estado_conciliacion] ? `CANCEL./${EST[it.estado_conciliacion]}` : 'CANCELADO')
        : (EST[it.estado_conciliacion] || '—'),
      (it.observaciones || '').slice(0, 24),
    ]
    cols.forEach(([, w, a], i) => {
      const tx = a === 'r' ? x + w - 1.5 : a === 'c' ? x + w / 2 : x
      t(vals[i], tx, y + 3.6, { align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' }); x += w
    })
    pdf.setDrawColor(225, 232, 226); pdf.setLineWidth(0.1); pdf.line(M, y + 4.8, W - M, y + 4.8)
    y += 5.2
  })

  y += 4
  if (y > H - 90) { pdf.addPage(); y = 16 }
  // Totales — la etiqueta arranca más a la izquierda y se envuelve con su propio
  // ancho (jsPDF no lo hace solo) para que NO se monte sobre el valor.
  const totLabelX = W - M - 120   // 167: etiqueta con más aire, alineada a la izquierda
  const totLabelW = 88            // ancho máx del texto de la etiqueta antes del valor
  const totValX   = W - M         // 287: valor alineado a la derecha
  const fila = (label, val, bold) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 10 : 9)
    pdf.setTextColor(bold ? 20 : 80, bold ? 20 : 80, bold ? 20 : 80)
    const lines = pdf.splitTextToSize(String(label ?? ''), totLabelW)
    pdf.text(lines, totLabelX, y)                       // etiqueta (posible multilínea)
    t(fmt(val), totValX, y, { align: 'right' })         // valor alineado a la 1ª línea
    y += (bold ? 7 : 5.5) + (lines.length - 1) * (bold ? 5 : 4.5)
  }
  const totalACobrar = items.reduce((a, it) => {
    if (it.es_cancelado) return a
    return a + (netoCuadreItem(it) || 0)
  }, 0)
  const totalComision = items.reduce((a, it) => a + (Number(it.comision) || 0), 0)
  fila('Total a cobrar (neto, transp. incl.)', totalACobrar)
  if (totalComision > 0) fila('Comision veterinarias (informativo)', totalComision)
  fila('Total recogido (cliente)', c.total_cobrado)
  const totalFalta = items.reduce((a, it) => {
    if (it.es_cancelado) return a
    const vr = netoCuadreItem(it)
    if (vr == null) return a
    const d = vr - (Number(it.total_cobrado) || 0)
    const resuelto = it.estado_conciliacion === 'VERIFICADO' || it.conciliacion_resuelta
    return a + (d > 0 && !resuelto ? d : 0)
  }, 0)
  if (totalFalta > 0) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(180, 90, 0)
    pdf.text(pdf.splitTextToSize('Falta por cobrar (conciliación)', totLabelW), totLabelX, y)
    t(fmt(totalFalta), totValX, y, { align: 'right' }); y += 5.5
  }
  fila('Efectivo recibido (técnico)', c.efectivo_recibido)
  fila('Digital directo a empresa', c.digital_empresa)
  fila('Transporte reconocido', c.total_transporte)
  fila('Pago por servicio', c.total_pago_servicio)
  if (Number(c.total_cancelados) > 0) fila('Pago por cancelados', c.total_cancelados)
  fila('Recargos reconocidos', c.total_recargos)
  fila('Total reconocido al técnico', c.total_reconocido)
  if (Number(c.ajustes_manuales) !== 0) fila(`Ajuste manual${c.ajustes_motivo ? ' (' + c.ajustes_motivo + ')' : ''}`, c.ajustes_manuales)
  y += 2
  pdf.setDrawColor(...G); pdf.setLineWidth(0.4); pdf.line(W - M - 70, y, W - M, y); y += 6
  pdf.setFillColor(...G); pdf.rect(W - M - 80, y - 4, 80, 11, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(255, 255, 255)
  t('A ENTREGAR A GERENCIA', W - M - 78, y + 3)
  t(fmt(c.dinero_a_entregar), W - M - 2, y + 3, { align: 'right' }); y += 14
  if (Number(c.saldo_a_favor_tecnico) > 0) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(180, 40, 40)
    pdf.text(pdf.splitTextToSize('Saldo a favor del técnico (empresa le debe):', totLabelW), totLabelX, y)
    t(fmt(c.saldo_a_favor_tecnico), totValX, y, { align: 'right' }); y += 8
  }

  // Firma
  y += 12
  if (y > H - 14) { pdf.addPage(); y = 24 }
  pdf.setDrawColor(120, 120, 120); pdf.setLineWidth(0.3)
  pdf.line(M, y, M + 70, y); pdf.line(W - M - 70, y, W - M, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 90)
  t(`Técnico: ${tecnicoNombre}`, M, y + 5)
  t('Recibido por gerencia', W - M - 70, y + 5)

  pdf.save(`Cuadre_${tecnicoNombre.replace(/\s+/g, '_')}_${c.fecha_desde}_${c.fecha_hasta}.pdf`)
}
