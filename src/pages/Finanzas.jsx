import { useState, useEffect, useMemo } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import Topbar from '@/components/layout/Topbar'
import { db } from '@/lib/supabase'
import { fmt, parsearErrorDB } from '@/lib/utils'
import {
  DollarSign, TrendingUp, AlertCircle, Check, X,
  RefreshCw, ChevronDown, ChevronUp, CreditCard,
  Banknote, Building2, Receipt, User2, Tag,
  Calendar, Lock, Download, Eye, FileText, Phone,
  CheckCircle2, AlertTriangle, MapPin, Clock, ClipboardList, MessageSquare,
} from 'lucide-react'

// Estados de revisión por mascota (feature 8). NULL = sin revisar.
const ESTADO_REV = {
  VERIFICADO: { label: 'Verificado OK',     short: 'OK',       color: '#166534', bg: '#F0FDF4', border: '#86EFAC' },
  CORRECTO:   { label: 'Recogió correcto',  short: 'Correcto', color: '#166534', bg: '#F0FDF4', border: '#86EFAC' },
  PARCIAL:    { label: 'Recogió parcial',   short: 'Parcial',  color: '#9A5500', bg: '#FFF3DC', border: '#FFD980' },
  NO_RECOGIO: { label: 'No recogió',        short: 'No cobró', color: '#C03030', bg: '#FEE8E8', border: '#FCA5A5' },
  EXCEDENTE:  { label: 'Recogió de más',    short: 'De más',   color: '#1E40AF', bg: '#EFF6FF', border: '#BFDBFE' },
}
const VIA_CONCIL = {
  LLAMAR_COBRAR:      { label: 'Llamar a cobrar',      icon: Phone },
  FACTURACION_MENSUAL:{ label: 'Facturación mensual',  icon: Building2 },
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

  // ── State cuadre con técnicos ───────────────────────────────────────────────
  const [tecnicos,        setTecnicos]        = useState([])
  const [cuadreTec,       setCuadreTec]       = useState('')
  const [cuadreDesde,     setCuadreDesde]     = useState('')
  const [cuadreHasta,     setCuadreHasta]     = useState('')
  const [cuadreAjustes,   setCuadreAjustes]   = useState('')
  const [cuadreAjusteMot, setCuadreAjusteMot] = useState('')
  const [cuadreData,      setCuadreData]      = useState(null)   // cabecera cuadres_tecnico
  const [cuadreItems,     setCuadreItems]     = useState([])
  const [cuadreLoading,   setCuadreLoading]   = useState(false)
  const [cuadreError,     setCuadreError]     = useState('')
  const [cerrando,        setCerrando]        = useState(false)
  const [cuadrePdfGen,    setCuadrePdfGen]    = useState(false)
  const [detalleItem,     setDetalleItem]     = useState(null)   // cuadre_item → tarjeta de mascota
  const [comprobanteItem, setComprobanteItem] = useState(null)   // cuadre_item → ver comprobante
  const [obsItem,         setObsItem]         = useState(null)   // cuadre_item → editar observaciones

  // ── State Conciliaciones (mascotas con plata faltante) ──────────────────────
  const [conciliaciones, setConciliaciones] = useState(null)  // null = aún no cargado
  const [concilLoading,  setConcilLoading]  = useState(false)

  // ── State "No cobrados" (pago pendiente / facturación mensual) ──────────────
  const [noCobrados,    setNoCobrados]    = useState(null)   // null = aún no cargado
  const [noCobLoading,  setNoCobLoading]  = useState(false)

  // ── Carga de datos ──────────────────────────────────────────────────────────
  async function cargar() {
    setLoading(true)
    try {
      // 1. Servicios activos (sin cancelados)
      const { data: svcs, error: errSvcs } = await db
        .from('servicios')
        .select('id, fecha_ingreso, valor_total, valor_pagado, estado_pago, metodo_pago, canal_entrada, estado, comision_aliado, comision_descontada, descuento_adicional, descuento_adicional_motivo, mascota_id, aliado_origen_id, plan_id, notas, tecnico_id')
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

      // TODO Fase 5 (revisión financiera admin/coordinador):
      //   - Listar recibos con comprobantes en `recibo_comprobantes`
      //     (estado='PENDIENTE_REVISION') y permitir APROBAR/RECHAZAR
      //     (UPDATE estado + reviewed_by=personal.id + reviewed_at=now()).
      //   - Abrir el comprobante con `db.storage.from(bucket).createSignedUrl(storage_path, 60)`
      //     en vez de la publicUrl del jsonb (ver TODO Fase 3/7 en TecnicoApp).
      //   - Cierre financiero: detectar medios digitales (recibo_medios_pago.metodo
      //     IN TRANSFERENCIA/NEQUI/DAVIPLATA/TARJETA) sin comprobante APROBADO.
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

  function nombreTecnicoSel(id = cuadreTec) {
    const t = tecnicos.find(t => t.id === id)
    return t ? `${t.nombre} ${t.apellido || ''}`.trim() : '—'
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
      setCuadreData(hdr); setCuadreItems(items || [])
    } catch (err) {
      setCuadreError(parsearErrorDB(err))
    } finally {
      setCuadreLoading(false)
    }
  }

  async function cerrarCuadre() {
    if (!cuadreData) return
    // Doble verificación (feature 4): 1) advertencia de congelado, 2) confirmación del monto.
    if (!await confirm('Una vez cerrado, el cuadre queda congelado y no se podrá editar. El técnico confirma el dinero a entregar.', { title: '¿Cerrar cuadre?', variant: 'warning', confirmLabel: 'Continuar' })) return
    if (!await confirm(`Confirma que el dinero a entregar a gerencia es ${fmt(cuadreData.dinero_a_entregar)} y que el cuadre quedará inmutable. Esta acción no se puede deshacer.`, { title: 'Confirmación final', variant: 'warning', confirmLabel: 'Sí, cerrar definitivamente' })) return
    setCerrando(true)
    try {
      const firma = {
        tecnico:        nombreTecnicoSel(cuadreData.tecnico_id),
        confirmado_en:  new Date().toISOString(),
        cerrado_por:    personalData ? `${personalData.nombre || ''} ${personalData.apellido || ''}`.trim() : null,
      }
      const { error } = await db.rpc('cerrar_cuadre', {
        p_cuadre_id: cuadreData.id,
        p_actor_id:  personalData?.id || null,
        p_firma:     firma,
      })
      if (error) throw error
      const { data: hdr } = await db.from('cuadres_tecnico').select('*').eq('id', cuadreData.id).single()
      setCuadreData(hdr)
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al cerrar el cuadre' })
    } finally {
      setCerrando(false)
    }
  }

  function limpiarCuadre() {
    setCuadreData(null); setCuadreItems([]); setCuadreError('')
    setCuadreAjustes(''); setCuadreAjusteMot('')
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
      // Refrescar fila (recargo recalculado) + cabecera (totales)
      setCuadreItems(prev => prev.map(it => it.id === item.id ? { ...it, es_lejania: aplica, recargo_aplicado: data.recargo_aplicado } : it))
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
  // Valor a RECOGER = lo que el cliente paga (neto, servicios.valor_total). NO el
  // bruto (valor_a_cobrar incluye la comisión descontada y no se recoge). Si el
  // item es viejo (sin valor_a_recoger) se cae al valor_a_cobrar.
  function valorARecoger(it) {
    if (it.valor_a_recoger != null) return Number(it.valor_a_recoger)
    if (it.valor_a_cobrar  != null) return Number(it.valor_a_cobrar)
    return null
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
  // ¿Falta plata del técnico sin resolver? (alerta visual). Fact. mensual no es
  // falta del técnico → se gestiona aparte en Conciliaciones.
  function faltaPlata(it) {
    if (esFactMensual(it)) return false
    const d = diferenciaItem(it)
    return d != null && d > 0
      && !['VERIFICADO', 'CORRECTO'].includes(it.estado_conciliacion)
      && !it.conciliacion_resuelta
  }
  // ¿Debe estar en Conciliaciones? Parcial/no recogió, o facturación mensual.
  function enConciliacion(it) {
    return !it.conciliacion_resuelta
      && (['PARCIAL', 'NO_RECOGIO'].includes(it.estado_conciliacion) || esFactMensual(it))
  }
  // Monto pendiente por cobrar de un item (técnico: diferencia; aliado: neto).
  function montoPendiente(it) {
    if (esFactMensual(it)) return pendienteAliado(it)
    const d = diferenciaItem(it)
    return d > 0 ? d : 0
  }
  // Estado sugerido según la diferencia (feature 8 — el coordinador puede cambiarlo).
  function estadoSugerido(it) {
    const d = diferenciaItem(it)
    if (d == null) return null
    if (d > 0) return (Number(it.total_cobrado) || 0) > 0 ? 'PARCIAL' : 'NO_RECOGIO'
    if (d < 0) return 'EXCEDENTE'
    return 'CORRECTO'
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
        .or('estado_conciliacion.in.(PARCIAL,NO_RECOGIO),modalidad_comision.eq.FACTURACION_MENSUAL')
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
        .order('fecha_emision', { ascending: false })
        .limit(800)

      const clasificados = (recibos || []).map(r => {
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
      let mascMap = {}
      if (mascIds.length) {
        const { data: ms } = await db.from('mascotas').select('id_mascota, nombre, cliente_id').in('id_mascota', mascIds)
        mascMap = Object.fromEntries((ms || []).map(m => [m.id_mascota, m]))
        const cliIds = [...new Set(Object.values(mascMap).map(m => m.cliente_id).filter(Boolean))]
        if (cliIds.length) {
          const { data: cs } = await db.from('clientes').select('id_cliente, nombre, apellido').in('id_cliente', cliIds)
          const cliMap = Object.fromEntries((cs || []).map(c => [c.id_cliente, c]))
          Object.values(mascMap).forEach(m => { m.cliente = cliMap[m.cliente_id] || null })
        }
      }

      // Última novedad NOTA por servicio
      const svcIds = [...new Set(clasificados.map(r => r.servicio_id).filter(Boolean))]
      let novMap = {}
      if (svcIds.length) {
        const { data: novs } = await db.from('novedades_servicio')
          .select('servicio_id, descripcion, created_at, tipo_novedad')
          .in('servicio_id', svcIds)
          .order('created_at', { ascending: false })
        ;(novs || []).forEach(n => { if (!novMap[n.servicio_id]) novMap[n.servicio_id] = n })
      }

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

  async function descargarCuadrePDF() {
    if (!cuadreData) return
    setCuadrePdfGen(true)
    try {
      await generarCuadrePDF(cuadreData, cuadreItems, nombreTecnicoSel(cuadreData.tecnico_id))
    } catch (err) {
      await showAlert('Error al generar el PDF: ' + (err.message || err), { title: 'Error' })
    } finally {
      setCuadrePdfGen(false)
    }
  }

  // ── Computed ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalFacturado   = servicios.reduce((a, s) => a + (s.valor_total  || 0), 0)
    const totalRecaudado   = servicios.reduce((a, s) => a + (s.valor_pagado || 0), 0)
    const porCobrar        = servicios.reduce((a, s) => a + s.saldo, 0)
    const comisionesAliado = servicios
      .filter(s => s.canal_entrada === 'ALIADO' && !s.comision_descontada && (s.comision_aliado || 0) > 0)
      .reduce((a, s) => a + (s.comision_aliado || 0), 0)
    const descuentosAdicionales = servicios.reduce((a, s) => a + (s.descuento_adicional || 0), 0)
    return { totalFacturado, totalRecaudado, porCobrar, comisionesAliado, descuentosAdicionales }
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
      if (noCobrados !== null) cargarNoCobrados()
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
              {kpis.descuentosAdicionales > 0 && (
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
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full min-w-[920px]">
                        <thead>
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
                <div className="p-5 space-y-5">
                  <p className="text-[12px] text-gray-500">
                    Cuadre de cuentas por técnico y rango de fechas. Solo el <strong>efectivo</strong> cuenta como
                    recibido por el técnico (lo digital entra directo a la empresa). El dinero a entregar a gerencia
                    es: efectivo − reconocimientos (transporte + recargos) − ajustes.
                  </p>

                  {/* Formulario */}
                  <div className="bg-white border rounded-2xl p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Técnico</label>
                        <select value={cuadreTec} onChange={e => setCuadreTec(e.target.value)} disabled={cuadreCerrado}
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
                        <div className="flex items-center gap-2 ml-auto">
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

                      {/* Tabla detalle */}
                      {cuadreItems.length === 0 ? (
                        <div className="py-12 text-center border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <div className="text-3xl mb-2">🧾</div>
                          <p className="text-[13px] text-gray-500">Sin recibos del técnico en este rango.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border rounded-2xl" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                          <table className="w-full min-w-[1480px]">
                            <thead style={{ background: '#FAFAFA' }}>
                              <tr style={{ borderBottom: '1px solid rgba(30,80,40,0.08)' }}>
                                {['Fecha', 'Mascota', 'Ciudad', 'Veterinaria', 'Plan', 'Total a cobrar', 'Comisión', 'Recogido', 'Diferencia', 'Efectivo', 'Digital → empresa', 'Transporte téc.', 'Pago téc.', 'Recargo', 'Lejanía', 'Acción'].map(h => (
                                  <th key={h} className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {cuadreItems.map(it => {
                                const d = diferenciaItem(it)
                                const alerta = faltaPlata(it)
                                const sug = estadoSugerido(it)
                                const er = it.estado_conciliacion ? ESTADO_REV[it.estado_conciliacion] : null
                                return (
                                <tr key={it.id} className={`text-[13px] border-b transition-colors ${alerta ? 'bg-amber-50/70 hover:bg-amber-100/60' : 'hover:bg-gray-50'}`}
                                  style={{ borderColor: 'rgba(30,80,40,0.06)', ...(alerta ? { boxShadow: 'inset 3px 0 0 #f59e0b' } : {}) }}>
                                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(it.fecha)}</td>
                                  <td className="px-3 py-2.5">
                                    <button onClick={() => it.servicio_id && setDetalleItem(it)} disabled={!it.servicio_id}
                                      className="font-semibold text-gray-900 hover:text-[#1A5CD8] hover:underline text-left flex items-center gap-1 disabled:no-underline disabled:hover:text-gray-900"
                                      title="Ver tarjeta completa de la mascota">
                                      {alerta && <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />}
                                      {it.mascota_nombre || '—'}
                                    </button>
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                      {it.es_cancelado && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600">CANCELADO</span>}
                                      {esFactMensual(it) && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#FFF3DC] text-[#9A5500]">FACT. MENSUAL</span>}
                                      {er && <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: er.bg, color: er.color }}>{er.short}</span>}
                                      {it.conciliacion_resuelta && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-green-100 text-green-700">✓ conciliado</span>}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-600">{it.ciudad || '—'}</td>
                                  <td className="px-3 py-2.5 text-[12px]">{it.veterinaria ? <span className="font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3] text-[11px]">🏥 {it.veterinaria}</span> : <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2.5 text-gray-600 text-[12px]">{it.plan_nombre || '—'}</td>
                                  <td className="px-3 py-2.5 tabular-nums font-semibold text-gray-900" title="Neto que paga el cliente (la comisión va en su propia columna)">
                                    {valorARecoger(it) != null ? fmt(valorARecoger(it)) : '—'}
                                    {Number(it.valor_adicionales) > 0 && <div className="text-[10px] font-medium text-gray-400">incl. adic. {fmt(it.valor_adicionales)}</div>}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums text-[#d97706] font-semibold">{it.comision > 0 ? fmt(it.comision) : '—'}</td>
                                  <td className="px-3 py-2.5 font-semibold text-gray-900 tabular-nums">
                                    {it.total_cobrado > 0 ? fmt(it.total_cobrado)
                                      : (it.es_cancelado ? '—'
                                        : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">no cobró</span>)}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums">
                                    {esFactMensual(it) ? (
                                      <span className="font-semibold text-[#9A5500] text-[12px]" title="Facturación mensual: el aliado nos debe el neto (bruto − comisión). Se cobra en la factura mensual.">x cobrar al aliado {fmt(pendienteAliado(it))}</span>
                                    ) : d == null ? <span className="text-gray-300">—</span>
                                      : d > 0 ? <span className="font-bold text-[#DC2626]">{fmt(d)}</span>
                                      : d < 0 ? <span className="font-semibold text-[#1E40AF]" title="Recogió de más">+{fmt(-d)}</span>
                                      : <span className="text-[#16a34a] font-semibold inline-flex items-center gap-0.5"><Check size={11} /> $0</span>}
                                  </td>
                                  <td className="px-3 py-2.5 font-semibold text-[#16a34a] tabular-nums">{fmt(it.efectivo)}</td>
                                  <td className="px-3 py-2.5">
                                    {it.digital > 0 ? (
                                      <div className="flex flex-col gap-1">
                                        <span className="text-gray-600 font-medium tabular-nums">{fmt(it.digital)}</span>
                                        <div className="flex flex-wrap gap-1">
                                          {(it.medios_pago || []).filter(m => String(m.metodo).toUpperCase() !== 'EFECTIVO' && Number(m.monto) > 0).map((m, i) => (
                                            <button key={i} onClick={() => setComprobanteItem(it)} title="Ver comprobante de pago"
                                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#1E40AF] hover:bg-[#DBEAFE] inline-flex items-center gap-0.5 transition-colors">
                                              <FileText size={9} /> {m.metodo}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : <span className="text-gray-400 tabular-nums">—</span>}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums">
                                    {it.transporte_sin_dato ? (
                                      <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md" title="Servicio sin transporte registrado (anterior a la mejora). Verificar manualmente.">sin dato ⚠</span>
                                    ) : (it.transporte_reconocido > 0 ? <span className="font-semibold text-[#7C3AED]">{fmt(it.transporte_reconocido)}</span> : '—')}
                                  </td>
                                  <td className="px-3 py-2.5 tabular-nums">
                                    {it.pago_servicio > 0 ? <span className="font-semibold text-[#0E7490]">{fmt(it.pago_servicio)}</span> : '—'}
                                  </td>
                                  <td className="px-3 py-2.5">
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
                                    ) : '—'}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <label className={`flex items-center gap-1.5 ${cuadreCerrado ? 'cursor-default' : 'cursor-pointer'}`} title="Marcar lejanía (recargo manual al técnico)">
                                      <input type="checkbox" checked={!!it.es_lejania} disabled={cuadreCerrado || it.es_cancelado}
                                        onChange={e => toggleLejania(it, e.target.checked)}
                                        className="w-4 h-4 accent-[#7C3AED] disabled:opacity-40" />
                                      <span className="text-[11px] text-gray-500">{it.es_lejania ? 'Sí' : '—'}</span>
                                    </label>
                                  </td>
                                  {/* Acción: estado de revisión (sugerido) + nota (features 3, 8) */}
                                  <td className="px-3 py-2.5">
                                    {it.es_cancelado ? <span className="text-gray-300 text-[11px]">—</span> : (
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
                                    )}
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
                          <FilaTotal label="Total a cobrar (servicios)" valor={cuadreItems.reduce((a, it) => a + (it.es_cancelado ? 0 : (valorARecoger(it) || 0)), 0)} />
                          {cuadreItems.some(it => Number(it.comision) > 0) && (
                            <FilaTotal label="Comisión veterinarias" valor={cuadreItems.reduce((a, it) => a + (Number(it.comision) || 0), 0)} color="#d97706" />
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
                            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-white/70">
                              <Lock size={12} /> Cerrado y firmado {cuadreData.cerrado_en ? `· ${new Date(cuadreData.cerrado_en).toLocaleDateString('es-CO')}` : ''}
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
                                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(it.fecha)}</td>
                                  <td className="px-3 py-2.5">
                                    <button onClick={() => it.servicio_id && setDetalleItem(it)} disabled={!it.servicio_id}
                                      className="font-semibold text-gray-900 hover:text-[#1A5CD8] hover:underline text-left disabled:no-underline"
                                      title="Ver tarjeta completa de la mascota">{it.mascota_nombre || '—'}</button>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-600 text-[12px]">{tec ? `${tec.nombre} ${tec.apellido || ''}`.trim() : '—'}</td>
                                  <td className="px-3 py-2.5 text-[12px]">{it.veterinaria ? <span className="font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#3730A3] text-[11px]">🏥 {it.veterinaria}</span> : <span className="text-gray-300">—</span>}</td>
                                  <td className="px-3 py-2.5 tabular-nums font-semibold text-gray-900">{valorARecoger(it) != null ? fmt(valorARecoger(it)) : '—'}</td>
                                  <td className="px-3 py-2.5 tabular-nums text-gray-700">{fmt(it.total_cobrado)}</td>
                                  <td className="px-3 py-2.5 tabular-nums font-bold text-[#DC2626]">{montoPendiente(it) > 0 ? fmt(montoPendiente(it)) : '—'}</td>
                                  <td className="px-3 py-2.5">
                                    {esFactMensual(it)
                                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FFF3DC] text-[#9A5500]">FACT. MENSUAL</span>
                                      : er && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: er.bg, color: er.color }}>{er.short}</span>}
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
      {detalleItem && <MascotaDetalleModal item={detalleItem} onClose={() => setDetalleItem(null)} />}

      {/* ── Modal comprobante de pago digital ────────────────────────────── */}
      {comprobanteItem && <ComprobanteModal item={comprobanteItem} onClose={() => setComprobanteItem(null)} />}

      {/* ── Modal observaciones por mascota ──────────────────────────────── */}
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
function MascotaDetalleModal({ item, onClose }) {
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
              planes ( nombre ), aliados:aliado_origen_id ( nombre )`)
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
  const fmtTS = ts => ts ? new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const fmtD  = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

  // Desglose de cobros: prioriza el snapshot del cuadre (item) y cae al servicio.
  const n = v => Number(v) || 0
  const grossVal = item.valor_a_cobrar != null ? n(item.valor_a_cobrar) : n(svc?.valor_total)
  const cob = {
    adic:       item.valor_adicionales != null ? n(item.valor_adicionales) : n(svc?.valor_adicionales),
    transporte: item.transporte_reconocido != null ? n(item.transporte_reconocido) : n(svc?.valor_transporte),
    descuento:  n(svc?.descuento_adicional),
    descMotivo: svc?.descuento_adicional_motivo || '',
    comision:   item.comision != null ? n(item.comision) : n(svc?.comision_aliado),
    vet:        item.veterinaria || svc?.aliados?.nombre || '—',
    neto:       item.valor_a_recoger != null ? n(item.valor_a_recoger)
                : item.valor_a_cobrar != null ? n(item.valor_a_cobrar) : n(svc?.valor_total),
    recogido:   n(item.total_cobrado),
    medios:     Array.isArray(item.medios_pago) ? item.medios_pago : [],
  }
  // Valor del plan: snapshot; para históricos sin desglose lo deriva del bruto.
  cob.plan = item.valor_plan != null ? n(item.valor_plan)
           : svc?.valor_plan != null ? n(svc.valor_plan)
           : Math.max(0, grossVal - cob.adic - cob.transporte)
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
              <div className="text-[15px] font-bold text-gray-900">{m.nombre || 'Mascota'}</div>
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
                <Dato label="Valor del plan">{fmt(cob.plan)}</Dato>
                <Dato label="Adicionales">{fmt(cob.adic)}</Dato>
                {adicionales.length > 0 && (
                  <div className="pl-3 py-0.5 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                    {adicionales.map(a => (
                      <div key={a.id} className="flex justify-between gap-3 text-[11px] text-gray-500">
                        <span className="truncate">· {a.recordatorios?.nombre || 'Adicional'}</span>
                        <span className="tabular-nums">{fmt(a.recordatorios?.precio_base)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Dato label="Transporte">{fmt(cob.transporte)}</Dato>
                <Dato label="Descuento">{cob.descuento > 0 ? `- ${fmt(cob.descuento)}` : fmt(0)}</Dato>
                {cob.descMotivo && (
                  <div className="pl-3 py-0.5 text-[11px] text-orange-600 border-b" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>· Motivo: {cob.descMotivo}</div>
                )}
                <Dato label="Comisión veterinaria">{fmt(cob.comision)}</Dato>
                <Dato label="Veterinaria">{cob.vet}</Dato>
                <div className="flex justify-between gap-3 py-1.5 mt-1 border-t-2" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                  <span className="text-[12px] font-bold text-gray-700">Total a recaudar</span>
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
function ComprobanteModal({ item, onClose }) {
  const [loading, setLoading] = useState(true)
  const [imgs, setImgs]       = useState([])
  const [error, setError]     = useState('')

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        if (!item.recibo_id) { if (activo) { setImgs([]); setLoading(false) } return }
        const { data: comps, error: ce } = await db.from('recibo_comprobantes')
          .select('id, bucket, storage_path, mime_type, estado').eq('recibo_id', item.recibo_id)
        if (ce) throw ce
        const out = []
        for (const c of comps || []) {
          const { data: signed } = await db.storage.from(c.bucket || 'evidencias').createSignedUrl(c.storage_path, 300)
          if (signed?.signedUrl) out.push({ ...c, url: signed.signedUrl })
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
              {imgs.map(c => (
                <div key={c.id}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <img src={c.url} alt="Comprobante" className="w-full object-contain max-h-[60vh] bg-gray-50" />
                  </a>
                  {c.estado && <span className="text-[10px] text-gray-400 mt-1 inline-block">Estado: {c.estado}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: observación por mascota (feature 3) ────────────────────────────────
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

// ── Sub-componente FilaTotal (resumen del cuadre) ────────────────────────────
function FilaTotal({ label, valor, color = '#374151', bold = false }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[12px] ${bold ? 'font-bold text-gray-800' : 'text-gray-500'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-[14px] font-extrabold' : 'text-[13px] font-semibold'}`} style={{ color }}>{fmt(valor)}</span>
    </div>
  )
}

// ── PDF del cuadre (jsPDF directo — patrón del proyecto, NUNCA html2canvas) ──
async function generarCuadrePDF(c, items, tecnicoNombre) {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const W = 210, M = 12, CW = W - M * 2
  const G = [31, 90, 50]
  const t = (text, x, y, opts = {}) => pdf.text(String(text ?? ''), x, y, opts)
  const fechaCorta = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

  // Cabecera
  pdf.setFillColor(...G); pdf.rect(0, 0, W, 26, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(255, 255, 255)
  t('Camino al Cielo', M, 11)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(196, 168, 122)
  t('CUADRE DE CUENTAS — TÉCNICO', M, 18)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(220, 230, 222)
  t(`${c.estado}${c.cerrado_en ? '  ·  Cerrado ' + new Date(c.cerrado_en).toLocaleDateString('es-CO') : ''}`, W - M, 18, { align: 'right' })

  let y = 34
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(20, 20, 20)
  t(tecnicoNombre, M, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 90, 90)
  t(`Periodo: ${fechaCorta(c.fecha_desde)} a ${fechaCorta(c.fecha_hasta)}  ·  ${c.total_servicios} servicio(s)`, M, y + 5)
  y += 12

  // Tabla
  const cols = [
    ['Fecha', 15, 'l'], ['Mascota', 28, 'l'], ['Ciudad', 22, 'l'],
    ['Cobrado', 24, 'r'], ['Efvo', 22, 'r'], ['Transp.', 20, 'r'], ['Pago', 20, 'r'], ['Recargo', 15, 'r'],
  ]
  pdf.setFillColor(240, 243, 240); pdf.rect(M, y, CW, 7, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(60, 60, 60)
  let x = M + 2
  cols.forEach(([h, w, a]) => { t(h, a === 'r' ? x + w - 2 : x, y + 4.6, { align: a === 'r' ? 'right' : 'left' }); x += w })
  y += 7

  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(40, 40, 40)
  items.forEach(it => {
    if (y > 250) { pdf.addPage(); y = 18 }
    x = M + 2
    const vals = [
      [fechaCorta(it.fecha), 'l'],
      [(it.mascota_nombre || '—').slice(0, 15), 'l'],
      [(it.ciudad || '—').slice(0, 12), 'l'],
      [fmt(it.total_cobrado), 'r'],
      [fmt(it.efectivo), 'r'],
      [it.transporte_sin_dato ? 's/d' : fmt(it.transporte_reconocido), 'r'],
      [fmt(it.pago_servicio), 'r'],
      [fmt(it.recargo_aplicado), 'r'],
    ]
    cols.forEach(([, w, a], i) => { t(vals[i][0], a === 'r' ? x + w - 2 : x, y + 4, { align: a === 'r' ? 'right' : 'left' }); x += w })
    pdf.setDrawColor(225, 232, 226); pdf.setLineWidth(0.1); pdf.line(M, y + 5.5, W - M, y + 5.5)
    y += 6
  })

  y += 4
  // Totales
  const fila = (label, val, bold) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 10 : 9)
    pdf.setTextColor(bold ? 20 : 80, bold ? 20 : 80, bold ? 20 : 80)
    t(label, W - M - 60, y); t(fmt(val), W - M, y, { align: 'right' }); y += bold ? 7 : 5.5
  }
  const totalACobrar = items.reduce((a, it) => {
    if (it.es_cancelado) return a
    const vr = it.valor_a_recoger != null ? Number(it.valor_a_recoger) : (Number(it.valor_a_cobrar) || 0)
    return a + vr
  }, 0)
  const totalComision = items.reduce((a, it) => a + (Number(it.comision) || 0), 0)
  fila('Total a cobrar (servicios)', totalACobrar)
  if (totalComision > 0) fila('Comisión veterinarias', totalComision)
  fila('Total recogido (cliente)', c.total_cobrado)
  const totalFalta = items.reduce((a, it) => {
    if (it.es_cancelado) return a
    const vr = it.valor_a_recoger != null ? Number(it.valor_a_recoger)
             : it.valor_a_cobrar != null ? Number(it.valor_a_cobrar) : null
    if (vr == null) return a
    const d = vr - (Number(it.total_cobrado) || 0)
    const resuelto = ['VERIFICADO', 'CORRECTO'].includes(it.estado_conciliacion) || it.conciliacion_resuelta
    return a + (d > 0 && !resuelto ? d : 0)
  }, 0)
  if (totalFalta > 0) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(180, 90, 0)
    t('Falta por cobrar (conciliación)', W - M - 60, y); t(fmt(totalFalta), W - M, y, { align: 'right' }); y += 5.5
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
    t('Saldo a favor del técnico (empresa le debe):', W - M - 70, y)
    t(fmt(c.saldo_a_favor_tecnico), W - M, y, { align: 'right' }); y += 8
  }

  // Firma
  y = Math.max(y + 10, 250)
  pdf.setDrawColor(120, 120, 120); pdf.setLineWidth(0.3)
  pdf.line(M, y, M + 70, y); pdf.line(W - M - 70, y, W - M, y)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 90)
  t(`Técnico: ${tecnicoNombre}`, M, y + 5)
  t('Recibido por gerencia', W - M - 70, y + 5)

  pdf.save(`Cuadre_${tecnicoNombre.replace(/\s+/g, '_')}_${c.fecha_desde}_${c.fecha_hasta}.pdf`)
}
