import { useState, useEffect } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import Topbar from '@/components/layout/Topbar'
import { EstadoBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { db } from '@/lib/supabase'
import { petEmoji, fmt, parsearErrorDB, today, parseDate, fmtDateTime, waLink, calcularEstadoVet } from '@/lib/utils'
import { ESTADO_COLOR, ESTADO_LABEL } from '@/lib/constants'
import { useAuth } from '@/contexts/AuthContext'
import { crearNotificacion, obtenerNoLeidas, marcarLeida } from '@/lib/notificaciones'
import { quitarItemServicio, precioSugeridoItem } from '@/lib/servicios'
import { orbitApi } from '@/lib/orbitApi'
import {
  MessageCircle, RefreshCw, AlertTriangle, Package,
  LayoutGrid, Table2, Search, X, ChevronUp, ChevronDown,
  User, MapPin, CreditCard, Pencil, Save, MessageSquare, Send,
  Camera, Download, Images, Truck, ArrowRightLeft, UserX,
  Copy, Check, Phone,
} from 'lucide-react'
import ModalPreparaEntrega from '@/components/delivery/ModalPreparaEntrega'
import { LocalidadSelect } from '@/components/ui/localidad-select'

// ── Enlace público del formulario de solicitud ────────────────────────────────
const APP_URL        = import.meta.env.VITE_APP_URL || window.location.origin
const LINK_SOLICITUD = `${APP_URL}/#/solicitud`

// Las alertas de inicio de ruta / declinación de más de estos días se marcan
// leídas automáticamente (evita el backlog viejo que reaparecía y bloqueaba).
const DIAS_EXPIRA_ALERTA = 2

// ── Motivos de cancelación de servicio ───────────────────────────────────────
const MOTIVOS_CANCELACION = [
  'Cliente canceló',
  'Servicio duplicado',
  'Error en datos',
  'No se pudo contactar',
  'Cambio de decisión',
  'Otro',
]

// ── Columnas por tablero ──────────────────────────────────────────────────────
const COLS_COORDINACION = ['SOLICITUDES', 'INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO']
const COLS_PRODUCCION   = ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO']
const TODAS_COLS        = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO']

const COLS_POR_ROL = {
  COORDINADOR: COLS_COORDINACION,
  PRODUCTOR:   COLS_PRODUCCION,
}

const COL_STYLE = {
  SOLICITUDES:    { bar: '#C4A87A', dot: '#FFF9ED' },
  INGRESADO:      { bar: '#3B82F6', dot: '#DBEAFE' },
  EN_RECOGIDA:    { bar: '#F59E0B', dot: '#FEF3C7' },
  EN_CUARTO_FRIO: { bar: '#06B6D4', dot: '#CFFAFE' },
  EN_PROCESO:     { bar: '#8B5CF6', dot: '#EDE9FE' },
  EN_PRODUCCION:  { bar: '#F97316', dot: '#FFEDD5' },
  LISTO:          { bar: '#10B981', dot: '#D1FAE5' },
  EN_ENTREGA:     { bar: '#6366F1', dot: '#E0E7FF' },
  ENTREGADO:      { bar: '#6B7280', dot: '#F3F4F6' },
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return null
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="text-gray-600" />
    : <ChevronDown size={11} className="text-gray-600" />
}

function EvidenciasColapsable({ fotos }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#FED7AA' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-orange-50"
        style={{ background: '#FFF7ED' }}
      >
        <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: '#C2410C' }}>
          <Camera size={12} /> Evidencias del técnico ({fotos.length} foto{fotos.length !== 1 ? 's' : ''})
        </span>
        {open ? <ChevronUp size={13} style={{ color: '#C2410C' }} /> : <ChevronDown size={13} style={{ color: '#C2410C' }} />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 grid grid-cols-3 gap-2" style={{ background: '#FFF7ED' }}>
          {fotos.map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noreferrer"
              className="group relative rounded-lg overflow-hidden bg-orange-100 block"
              style={{ aspectRatio: '1/1' }}
              title={f.label}
            >
              <img src={f.url} alt={f.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[9px] font-semibold text-white leading-tight"
                style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}>
                {f.emoji} {f.label}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Kanban() {
  const { alert: showAlert, confirm } = useConfirm()
  const { personalData } = useAuth()
  const rol = personalData?.rol

  // ── Estado tablero activo (solo para ADMIN) ───────────────────────────────
  const [tableroActivo, setTableroActivo] = useState('coordinacion') // 'coordinacion' | 'produccion'

  // Derivados de rol — COORDINADOR tiene los mismos permisos que ADMIN
  const esAdmin     = ['ADMIN', 'COORDINADOR'].includes(rol)
  const esCoord     = rol === 'COORDINADOR'
  const esProductor = rol === 'PRODUCTOR'
  const puedeVerImagenes = esAdmin || esProductor

  const COLUMNAS = (esAdmin || esCoord)
    ? (tableroActivo === 'produccion' ? COLS_PRODUCCION : COLS_COORDINACION)
    : (COLS_POR_ROL[rol] ?? TODAS_COLS)

  const esVistaProd = esProductor || ((esAdmin || esCoord) && tableroActivo === 'produccion')
  const colLabel    = col => {
    if (col === 'SOLICITUDES') return 'Solicitudes'
    if (esVistaProd && col === 'EN_CUARTO_FRIO') return 'Pendiente'
    return ESTADO_LABEL[col]
  }

  // ── Estado botones Contactar / Notificar técnico ──
  const [contactarLoadingId,  setContactarLoadingId]  = useState(null)
  const [notifTecLoadingId,   setNotifTecLoadingId]   = useState(null)

  // ── Enviar enlace de solicitud al cliente (wa.me, desde el WA propio) ─────
  const [modalEnlace,     setModalEnlace]     = useState(false)
  const [enlaceNombre,    setEnlaceNombre]    = useState('')
  const [enlaceTelefono,  setEnlaceTelefono]  = useState('')
  const [enlaceCopiado,   setEnlaceCopiado]   = useState(false)

  function mensajeEnlaceSolicitud(nombre) {
    const saludo = nombre.trim() ? `Hola ${nombre.trim()} 🌿` : 'Hola 🌿'
    return `${saludo} Somos *Camino al Cielo*, servicios funerarios para mascotas.\n\n` +
      `Para solicitar nuestro servicio, completa este formulario con los datos de tu mascota ` +
      `y un miembro de nuestro equipo te contactará para coordinar todos los detalles:\n\n` +
      `${LINK_SOLICITUD}\n\nQuedamos atentos a cualquier inquietud 💚`
  }

  function validarTelefonoEnlace(v) {
    const val = (v || '').trim()
    if (val.startsWith('+') || val.startsWith('00')) {
      const digits = (val.startsWith('+') ? val.slice(1) : val.slice(2)).replace(/\D/g, '')
      return digits.length >= 7 && digits.length <= 15
    }
    const digits = val.replace(/\D/g, '')
    return digits.length === 10 && digits.startsWith('3')
  }

  async function enviarEnlaceSolicitud() {
    if (!validarTelefonoEnlace(enlaceTelefono)) {
      await showAlert('Ingresa un celular colombiano de 10 dígitos (3XX...) o internacional con +.', { title: 'Número inválido' })
      return
    }
    // Abre WhatsApp (app o web) con el chat del cliente y el mensaje listo —
    // el coordinador lo envía desde su propio número
    window.open(waLink(enlaceTelefono, mensajeEnlaceSolicitud(enlaceNombre)), '_blank', 'noopener')
    setModalEnlace(false)
    setEnlaceNombre(''); setEnlaceTelefono('')
  }

  async function copiarEnlaceSolicitud() {
    try {
      await navigator.clipboard.writeText(LINK_SOLICITUD)
      setEnlaceCopiado(true)
      setTimeout(() => setEnlaceCopiado(false), 2000)
    } catch {}
  }

  // ── Solicitudes de clientes ───────────────────────────────────────────────
  const [solicitudes,    setSolicitudes]    = useState([])
  const [selSolicitud,   setSelSolicitud]   = useState(null)
  const [convirtiendo,   setConvirtiendo]   = useState(false)
  const [planesKanban,   setPlanesKanban]   = useState([])
  const [especiesKanban, setEspeciesKanban] = useState([])
  const [aliados,        setAliados]        = useState([])
  const [convForm, setConvForm] = useState({
    // Cliente
    cliente_nombre: '', cliente_apellido: '', cliente_whatsapp: '', cliente_telefono: '', cliente_telefono2: '', cliente_email: '',
    cliente_cedula: '', cliente_ciudad: 'Bogotá', cliente_localidad: '', cliente_barrio: '', cliente_direccion: '',
    // Mascota
    mascota_nombre: '', especie_id: '', mascota_peso_kg: '', mascota_raza: '', mascota_sexo: 'Macho',
    // Plan y recogida
    plan_id: '', tipo_recogida: 'domicilio',
    ciudad: 'Bogotá', localidad: '', barrio: '', direccion: '', hora_aproximada: '', notas_cliente: '',
    // Servicio
    tipo_acompanamiento: 'PRESENCIAL', tecnico_id: '', valor_total: '', estado_pago: 'PENDIENTE', metodo_pago: '',
  })

  // ── Data ──────────────────────────────────────────────────────────────────
  const [servicios, setServicios]         = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [vista, setVista]                 = useState('kanban')
  const [busqueda, setBusqueda]           = useState('')
  const [filtroEstado, setFiltroEstado]   = useState('todos')
  const [filtroPlan, setFiltroPlan]       = useState('todos')
  const [sortField, setSortField]         = useState('fecha_ingreso')
  const [sortDir, setSortDir]             = useState('desc')
  const [soloHoy, setSoloHoy]             = useState(true) // mostrar solo la operación que ingresó hoy

  // ── DnD ───────────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId]       = useState(null)
  const [dragOverCol, setDragOverCol]     = useState(null)
  const [groupsOpen, setGroupsOpen]       = useState({}) // `${col}-${tierKey}` → bool

  // ── Alertas inicio ruta ───────────────────────────────────────────────────
  const [alertasRuta, setAlertasRuta]     = useState([])   // notificaciones TECNICO_INICIO_RUTA pendientes (toasts en esquina)

  // ── Modal ─────────────────────────────────────────────────────────────────
  const [selected, setSelected]           = useState(null)
  const [detalle, setDetalle]             = useState(null)
  const [recordatorios, setRecordatorios] = useState([])
  const [saving, setSaving]               = useState(false)
  const [guardando, setGuardando]         = useState(false)
  const [mensajeros, setMensajeros]       = useState([])
  const [tecnicos, setTecnicos]           = useState([])
  const [mensajeroId, setMensajeroId]     = useState('')
  const [modalEntrega, setModalEntrega]   = useState(null) // servicioId para modal entrega

  // ── Cancelación formal de servicio ──
  const [modalCancelar,  setModalCancelar]  = useState(false)
  const [motivoCancelar, setMotivoCancelar] = useState('')
  const [obsCancelar,    setObsCancelar]    = useState('')
  const [cancelando,     setCancelando]     = useState(false)
  const [cancelInfo,     setCancelInfo]     = useState(null) // motivo/fecha/usuario de un servicio ya cancelado
  const [editTecnicoId, setEditTecnicoId] = useState('')
  const [editEstadoPago, setEditEstadoPago] = useState('')
  const [editNotas, setEditNotas]         = useState('')
  const [editComisionAliado, setEditComisionAliado] = useState('')
  const [novedades, setNovedades]         = useState([])
  const [nuevoComentario, setNuevoComentario] = useState('')
  const [guardandoComentario, setGuardandoComentario] = useState(false)

  // ── Horario aliado (para alerta en modal) ────────────────────────────────
  const [aliadoHorario, setAliadoHorario] = useState(null) // { nombre, horario }

  // ── Comisión en conversión de solicitud ───────────────────────────────────
  const [comisionSol,     setComisionSol]     = useState(0)    // monto editable ($)
  const [comisionSolPct,  setComisionSolPct]  = useState(0)    // porcentaje calculado
  const [aliadoSolData,   setAliadoSolData]   = useState(null) // datos del aliado de la solicitud

  async function calcularComisionPct(aliadoId, esVip, planId, tipoProceso) {
    if (!aliadoId || !planId) return 0
    if (esVip) {
      if (tipoProceso === 'COMPOSTAJE_GRUPAL')    return 10
      if (['CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL'].includes(tipoProceso)) return 27
      return 32
    }
    const hoy = new Date()
    const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`
    const [{ count }, { data: filas }] = await Promise.all([
      db.from('servicios').select('*', { count:'exact', head:true })
        .eq('aliado_origen_id', aliadoId).gte('fecha_ingreso', inicioMes),
      db.from('config_comisiones').select('porcentaje,plan_id,rango_min,rango_max').eq('es_vip', false),
    ])
    const vol = count || 0
    const match = (filas || [])
      .filter(c => (c.plan_id === planId || c.plan_id === null) && c.rango_min <= vol && (c.rango_max === null || c.rango_max >= vol))
      .sort((a,b) => { if (a.plan_id && !b.plan_id) return -1; if (!a.plan_id && b.plan_id) return 1; return b.rango_min - a.rango_min })[0]
    return parseFloat(match?.porcentaje) || 0
  }

  // ── Cambio de plan ────────────────────────────────────────────────────────
  const [editPlanId,      setEditPlanId]      = useState('')
  const [nuevoPrecio,     setNuevoPrecio]     = useState('')
  const [cambiandoPlan,   setCambiandoPlan]   = useState(false)
  const [mascotaParaPlan, setMascotaParaPlan] = useState(null) // { peso_kg, especie_id }
  // ── Alertas técnico declina ───────────────────────────────────────────────
  const [alertasDeclinas, setAlertasDeclinas] = useState([])
  // ── Agregar recordatorio adicional ───────────────────────────────────────
  const [recListOpts,  setRecListOpts]  = useState([]) // {id,nombre,precio_base,categoria}
  const [addRecId,     setAddRecId]     = useState('')
  const [addRecQty,    setAddRecQty]    = useState(1)
  const [addingRec,    setAddingRec]    = useState(false)
  // ── Quitar ítem / ajuste por adicional no tomado ──────────────────────────
  const [itemAQuitar, setItemAQuitar] = useState(null)  // fila servicio_recordatorios, o {} para ajuste manual
  const [quitarMonto, setQuitarMonto] = useState('')
  const [quitarMotivo, setQuitarMotivo] = useState('')
  const [quitando, setQuitando] = useState(false)

  async function cargarSolicitudes() {
    const { data } = await db.from('solicitudes_servicio')
      .select('*').eq('estado', 'PENDIENTE').order('created_at', { ascending: true })
    setSolicitudes(data || [])
  }

  function planPorId(planId) {
    return planesKanban.find(p => String(p.id) === String(planId))
  }

  function aliadoPorId(aliadoId) {
    return aliados.find(a => String(a.id_aliado) === String(aliadoId))
  }

  async function calcularPrecioPara(planId, pesoKgRaw, especieIdRaw) {
    const pesoKg = parseFloat(pesoKgRaw) || 0
    if (!planId || pesoKg <= 0) return null

    const pesoG = Math.round(pesoKg * 1000)
    const especieId = parseInt(especieIdRaw) || 0
    const usaFelino = especieId === 2 || especieId === 3  // Gato o Conejo → rango FELINO

    let q = db.from('planes_precios').select('precio').eq('plan_id', planId)
    if (pesoG < 1000) {
      q = q.eq('rango_nombre', 'PETIT')
    } else if (usaFelino) {
      q = q.eq('rango_nombre', 'FELINO')
    } else {
      q = q.lte('peso_min_gr', pesoG).gte('peso_max_gr', pesoG).neq('rango_nombre', 'FELINO')
    }

    const { data } = await q.maybeSingle()
    if (data?.precio != null) return data.precio

    const planActual = planPorId(planId)
    const planByCode = {}
    planesKanban.forEach(p => { planByCode[p.codigo] = p })

    if (planActual?.codigo === 'ANGEL') {
      if (pesoG < 1000) return 69000
      if (usaFelino) return 79000
      if (pesoG < 11000) return 89000   // decimales: 10.4 sigue en 1-10
      if (pesoG < 21000) return 119000
      if (pesoG < 36000) return 139000
      return 189000
    }

    if (planActual?.codigo === 'BASICO_SIN_REC' && planByCode.BASICO) {
      const base = await calcularPrecioPara(planByCode.BASICO.id, pesoKg, especieId)
      return base ? Math.round(base * 0.8) : null
    }

    // COMPETS_SIN_REC: precios propios en planes_precios, sin fallback —
    // si falta el rango configurado se devuelve null (no inventar tarifa)

    // Exclusivo sin recordatorios = plan base × 80 %
    const baseSinRec = {
      EXCLUSIVO_PRESENCIAL_SIN_REC:   'EXCLUSIVO_PRESENCIAL',
      EXCLUSIVO_VIDEOLLAMADA_SIN_REC: 'EXCLUSIVO_VIDEOLLAMADA',
    }[planActual?.codigo]
    if (baseSinRec && planByCode[baseSinRec]) {
      const base = await calcularPrecioPara(planByCode[baseSinRec].id, pesoKg, especieId)
      return base ? Math.round(base * 0.8) : null
    }

    if (planActual?.codigo === 'DESAMPARADO') {
      if (pesoG <= 10000) return 46000
      const kgExtra = Math.max(0, pesoKg - 10)
      return Math.round(44000 + kgExtra * 4000)
    }

    return null
  }

  async function abrirSolicitud(s) {
    const planId = s.plan_id || ''
    setSelSolicitud(s)

    // Consultar datos completos del aliado si el cliente seleccionó una vet registrada
    let aliado = null
    setComisionSol(0); setComisionSolPct(0); setAliadoSolData(null)
    if (s.aliado_id) {
      const { data } = await db.from('aliados')
        .select('id_aliado,nombre,direccion,ciudad,barrio,localidad,telefono,whatsapp,contacto_nombre,vip,modalidad_comision')
        .eq('id_aliado', s.aliado_id)
        .maybeSingle()
      aliado = data
      setAliadoSolData(data)
    }

    setConvForm({
      // Cliente — pre-llenado desde la solicitud, editable
      cliente_nombre:    s.cliente_nombre    || '',
      cliente_apellido:  s.cliente_apellido  || '',
      cliente_whatsapp:  s.cliente_whatsapp  || '',
      cliente_telefono:  s.cliente_telefono  || '',
      cliente_telefono2: s.cliente_telefono2 || '',
      cliente_email:     s.cliente_email     || '',
      cliente_cedula:    s.cliente_cedula    || '',
      cliente_ciudad:    s.cliente_ciudad    || 'Bogotá',
      cliente_localidad: s.cliente_localidad || '',
      cliente_barrio:    s.cliente_barrio    || '',
      cliente_direccion: s.cliente_direccion || '',
      // Mascota
      mascota_nombre:    s.mascota_nombre    || '',
      especie_id:        s.especie_id        ? String(s.especie_id) : '',
      mascota_peso_kg:   s.mascota_peso_kg   ? String(s.mascota_peso_kg) : '',
      mascota_raza:      s.mascota_raza      || '',
      mascota_sexo:      s.mascota_sexo      || 'Macho',
      // Recogida — si hay aliado, precargar su dirección
      plan_id:         planId,
      tipo_recogida:   s.tipo_recogida   || 'domicilio',
      ciudad:          aliado?.ciudad    || s.ciudad    || 'Bogotá',
      localidad:       aliado?.localidad || s.localidad || '',
      barrio:          aliado?.barrio    || s.barrio    || '',
      direccion:       aliado?.direccion || s.direccion || '',
      hora_aproximada: s.hora_aproximada || '',
      notas_cliente:   s.notas_cliente   || '',
      // Servicio
      tipo_acompanamiento: 'PRESENCIAL', tecnico_id: '', valor_total: '',
      estado_pago: 'PENDIENTE', metodo_pago: '',
    })

    calcularPrecioPara(planId, s.mascota_peso_kg, s.especie_id).then(precio => {
      if (!precio) return
      setConvForm(prev => String(prev.plan_id) === String(planId)
        ? { ...prev, valor_total: String(precio) }
        : prev)
      // Calcular comisión si hay aliado
      if (aliado && planId) {
        const plan = planesKanban.find(p => String(p.id) === String(planId))
        calcularComisionPct(aliado.id_aliado, aliado.vip, planId, plan?.tipo_proceso).then(pct => {
          setComisionSolPct(pct)
          setComisionSol(pct > 0 ? Math.round(precio * pct / 100) : 0)
        })
      }
    })
  }

  async function convertirSolicitud() {
    if (!selSolicitud) return
    setConvirtiendo(true)
    try {
      const telefonoCliente = convForm.cliente_whatsapp.replace(/\D/g,'')
      const pesoKg = parseFloat(convForm.mascota_peso_kg) || 0
      const direccionDomicilio = convForm.direccion || convForm.cliente_direccion

      if (!convForm.cliente_nombre.trim()) {
        await showAlert('La solicitud no tiene nombre del cliente.', { title: 'Datos incompletos' })
        return
      }
      if (telefonoCliente.length < 10) {
        await showAlert('La solicitud no tiene un WhatsApp valido del cliente.', { title: 'Datos incompletos' })
        return
      }
      if (!convForm.mascota_nombre.trim() || !convForm.especie_id || pesoKg <= 0) {
        await showAlert('Revisa nombre, especie y peso de la mascota antes de aceptar.', { title: 'Datos incompletos' })
        return
      }
      if (!convForm.plan_id) {
        await showAlert('Selecciona el plan solicitado antes de aceptar.', { title: 'Datos incompletos' })
        return
      }
      if (convForm.tipo_recogida === 'domicilio' && !direccionDomicilio.trim()) {
        await showAlert('La solicitud de domicilio necesita direccion de recogida.', { title: 'Datos incompletos' })
        return
      }

      // 1. Buscar o crear cliente (usa datos editados del convForm)
      const { data: clis } = await db.from('clientes')
        .select('id_cliente,tipo_cliente').eq('whatsapp', telefonoCliente).limit(1)
      let clienteId
      if (clis?.length) {
        clienteId = clis[0].id_cliente
        // Actualizar datos del cliente existente con los datos corregidos
        await db.from('clientes').update({
          nombre:     convForm.cliente_nombre,
          apellido:   convForm.cliente_apellido  || null,
          telefono:   convForm.cliente_telefono  || null,
          telefono2:  convForm.cliente_telefono2 || null,
          email:      convForm.cliente_email     || null,
          cedula_nit: convForm.cliente_cedula    || null,
          ciudad:     convForm.cliente_ciudad    || null,
          localidad:  convForm.cliente_localidad || null,
          barrio:     convForm.cliente_barrio    || null,
          direccion:  convForm.cliente_direccion || null,
        }).eq('id_cliente', clienteId)
      } else {
        const { data: nc, error: ce } = await db.from('clientes').insert({
          nombre:       convForm.cliente_nombre,
          apellido:     convForm.cliente_apellido  || null,
          whatsapp:     telefonoCliente,
          telefono:     convForm.cliente_telefono  || null,
          telefono2:    convForm.cliente_telefono2 || null,
          email:        convForm.cliente_email     || null,
          cedula_nit:   convForm.cliente_cedula    || null,
          ciudad:       convForm.cliente_ciudad    || null,
          localidad:    convForm.cliente_localidad || null,
          barrio:       convForm.cliente_barrio    || null,
          direccion:    convForm.cliente_direccion || null,
          tipo_cliente: 'NORMAL',
        }).select('id_cliente')
        if (ce) throw ce
        clienteId = nc[0].id_cliente
      }

      // 2. Crear mascota (con datos editados)
      const tamano = pesoKg < 1 ? 'Mini' : pesoKg <= 10 ? 'Pequeño' : pesoKg <= 20 ? 'Mediano' : pesoKg <= 35 ? 'Grande' : 'Gigante'
      const { data: nm, error: me } = await db.from('mascotas').insert({
        nombre:     convForm.mascota_nombre,
        especie_id: parseInt(convForm.especie_id) || null,
        raza:       convForm.mascota_raza || null,
        sexo:       convForm.mascota_sexo,
        tamano, peso_kg: pesoKg, cliente_id: clienteId,
        fallecida: true, fecha_fallecimiento: today(),
      }).select('id_mascota')
      if (me) throw me
      const mascotaId = nm[0].id_mascota

      // 3. Crear servicio (el trigger de DB crea recogida, entrega y cuarto_frio)
      const precioCalculado = await calcularPrecioPara(convForm.plan_id, pesoKg, convForm.especie_id)
      const valorTotal = parseFloat(convForm.valor_total) || precioCalculado || 0
      if (valorTotal <= 0) {
        await showAlert('No se pudo calcular el valor del plan. Ingresa el valor total antes de aceptar.', { title: 'Precio requerido' })
        return
      }

      const esVeterinaria = convForm.tipo_recogida === 'veterinaria'
      const puntoRecogida = esVeterinaria ? 'CLINICA_ALIADA' : 'DOMICILIO'
      const aliadoActual = aliadoPorId(selSolicitud.aliado_id)
      const clienteCompleto = `${convForm.cliente_nombre} ${convForm.cliente_apellido || ''}`.trim()
      const direccionRecogida = esVeterinaria
        ? (aliadoActual?.direccion || convForm.direccion || null)
        : (direccionDomicilio || null)
      const ciudadRecogida = esVeterinaria
        ? (aliadoActual?.ciudad || convForm.ciudad || 'Bogotá')
        : (convForm.ciudad || convForm.cliente_ciudad || 'Bogotá')
      const barrioRecogida = esVeterinaria
        ? (aliadoActual?.barrio || aliadoActual?.localidad || convForm.barrio || null)
        : (convForm.barrio || convForm.localidad || convForm.cliente_barrio || null)
      const contactoRecogidaNombre = esVeterinaria
        ? (aliadoActual?.contacto_nombre || aliadoActual?.nombre || selSolicitud.aliado_nombre_otro || clienteCompleto)
        : clienteCompleto
      const contactoRecogidaTelefono = esVeterinaria
        ? (aliadoActual?.whatsapp || aliadoActual?.telefono || telefonoCliente)
        : telefonoCliente
      const notasRecogida = [
        convForm.hora_aproximada ? `Hora aprox. recogida: ${convForm.hora_aproximada}` : '',
        convForm.notas_cliente || '',
      ].filter(Boolean).join('. ') || null
      const notasServicio = [
        selSolicitud.aliado_nombre_otro ? `Veterinaria indicada por cliente: ${selSolicitud.aliado_nombre_otro}` : '',
        convForm.hora_aproximada ? `Hora aprox. recogida: ${convForm.hora_aproximada}` : '',
      ].filter(Boolean).join('. ') || null
      const planSeleccionado = planPorId(convForm.plan_id)
      const esIndividual  = ['CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL'].includes(planSeleccionado?.tipo_proceso)

      const { data: sv, error: se } = await db.from('servicios').insert({
        mascota_id:            mascotaId,
        plan_id:               convForm.plan_id || null,
        estado:                'INGRESADO',
        fecha_ingreso:         today(),
        tipo_acompanamiento:   esIndividual ? convForm.tipo_acompanamiento : 'EVIDENCIA',
        canal_entrada:         selSolicitud.aliado_id ? 'ALIADO' : 'DIRECTO',
        registrado_por:        personalData?.id || null,
        aliado_origen_id:      selSolicitud.aliado_id || null,
        valor_total:           valorTotal,
        valor_pagado:          0,
        estado_pago:           convForm.estado_pago,
        metodo_pago:           convForm.metodo_pago || null,
        tecnico_id:            convForm.tecnico_id || null,
        punto_recogida:        puntoRecogida,
        direccion_recogida:    direccionRecogida,
        ciudad_recogida:       ciudadRecogida,
        barrio_recogida:       barrioRecogida,
        indicaciones_recogida: notasRecogida,
        tipo_cliente:          'NORMAL',
        comision_aliado:       comisionSol || 0,
        comision_descontada:   false,  // Solicitudes públicas: cliente paga completo siempre
        notas:                 notasServicio,
        // Desglose congelado (migración 010). El flujo público NO cobra transporte
        // ni adicionales: el valor es solo el plan → transporte = 0 (no "sin dato").
        valor_plan:            valorTotal,
        valor_adicionales:     0,
        valor_transporte:      0,
        recargo_nocturno:      0,
      }).select('id')
      if (se) throw se
      const servicioId = sv[0].id

      // 4. Actualizar recogida con info adicional
      await db.from('recogidas').update({
        tipo_lugar:        puntoRecogida,
        contacto_nombre:   contactoRecogidaNombre || null,
        contacto_telefono: contactoRecogidaTelefono || null,
        aliado_id:         selSolicitud.aliado_id || null,
        tecnico_id:        convForm.tecnico_id || null,
        notas:             notasRecogida,
      }).eq('servicio_id', servicioId)

      // 5. Marcar solicitud como convertida
      await db.from('solicitudes_servicio').update({
        estado: 'CONVERTIDO', servicio_id: servicioId,
      }).eq('id', selSolicitud.id)

      setSelSolicitud(null)
      await Promise.all([cargar(), cargarSolicitudes()])
    } catch (err) {
      const parsed = parsearErrorDB(err)
      const raw = err?.message || err?.details || ''
      await showAlert(
        raw && raw !== parsed ? `${parsed}\n\nDetalle técnico: ${raw}` : parsed,
        { title: 'Error al crear servicio' }
      )
    } finally {
      setConvirtiendo(false)
    }
  }

  async function descartarSolicitud(id) {
    if (!await confirm('Esta solicitud se marcará como descartada y no se procesará.', {
      title: '¿Descartar solicitud?', variant: 'danger', confirmLabel: 'Descartar',
    })) return
    await db.from('solicitudes_servicio').update({ estado: 'DESCARTADO' }).eq('id', id)
    setSelSolicitud(null)
    cargarSolicitudes()
  }

  useEffect(() => {
    cargar()
    cargarSolicitudes()
    Promise.all([
      db.from('planes').select('id,nombre,codigo,tipo_proceso').order('nombre'),
      db.from('especies').select('id,nombre').order('nombre'),
      db.from('aliados').select('id_aliado,nombre,direccion,ciudad,localidad,barrio,contacto_nombre,whatsapp,telefono').eq('activo', true).order('nombre'),
    ]).then(([p, e, a]) => {
      setPlanesKanban(p.data || [])
      setEspeciesKanban(e.data || [])
      setAliados(a.data || [])
    })
    db.from('personal').select('id,nombre,apellido,rol_principal_id,whatsapp')
      .eq('activo', true).order('nombre')
      .then(({ data }) => {
        const all = data || []
        setTecnicos(all.filter(p => p.rol_principal_id === 2))
        setMensajeros(all.filter(p => p.rol_principal_id === 3))
      })
    db.from('recordatorios').select('id,nombre,precio_base,categoria')
      .eq('activo', true).order('nombre')
      // Eutanasia se gestiona en su propio módulo (/eutanasias), NO como adicional
      .then(({ data }) => setRecListOpts((data || []).filter(r => !/eutanas/i.test(r.nombre || ''))))

    const canal = db
      .channel('kanban-servicios-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, () => {
        cargar()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes_servicio' }, () => {
        cargarSolicitudes()
      })
      .subscribe()

    return () => { db.removeChannel(canal) }
  }, [])

  // Polling alertas de inicio de ruta para coordinador/admin
  useEffect(() => {
    if (!personalData?.id) return
    const esCoord = ['COORDINADOR','ADMIN'].includes(personalData?.rol)
    if (!esCoord) return
    const verificar = async () => {
      const notifs = await obtenerNoLeidas(personalData.id)
      const TIPOS_ALERTA = ['TECNICO_INICIO_RUTA', 'TECNICO_DECLINA', 'TECNICO_PROBLEMA_RUTA']
      // Auto-expirar: las alertas de más de DIAS_EXPIRA_ALERTA se marcan leídas
      // solas para que no se acumule un backlog viejo que reaparece cada vez.
      const limite = Date.now() - DIAS_EXPIRA_ALERTA * 24 * 60 * 60 * 1000
      const viejas = notifs.filter(n =>
        TIPOS_ALERTA.includes(n.tipo) && n.created_at && new Date(n.created_at).getTime() < limite
      )
      if (viejas.length) await Promise.all(viejas.map(n => marcarLeida(n.id)))
      const viejasIds = new Set(viejas.map(n => n.id))
      const vigentes  = notifs.filter(n => !viejasIds.has(n.id))
      setAlertasRuta(vigentes.filter(n => n.tipo === 'TECNICO_INICIO_RUTA'))
      setAlertasDeclinas(vigentes.filter(n => ['TECNICO_DECLINA', 'TECNICO_PROBLEMA_RUTA'].includes(n.tipo)))
    }
    verificar()
    const iv = setInterval(verificar, 20_000)
    return () => clearInterval(iv)
  }, [personalData?.id, personalData?.rol])

  // Marca leídas todas las alertas de inicio de ruta mostradas (botón "limpiar").
  async function limpiarAlertasRuta() {
    const ids = alertasRuta.map(n => n.id)
    setAlertasRuta([])
    await Promise.all(ids.map(id => marcarLeida(id)))
  }
  // Marca leída una sola alerta de inicio de ruta y la saca de la pila.
  async function descartarAlertaRuta(id) {
    setAlertasRuta(prev => prev.filter(n => n.id !== id))
    await marcarLeida(id)
  }

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await db
        .from('v_kanban').select('*').order('fecha_ingreso', { ascending: false })
      if (err) throw err
      let rows = data || []

      // v_kanban solo expone un número (cliente_wa); traemos los teléfonos
      // alternos del cliente (telefono / telefono2) para mostrarlos en la tarjeta.
      const ids = rows.map(s => s.servicio_id).filter(Boolean)
      if (ids.length) {
        const { data: tels } = await db.from('servicios')
          .select('id, mascotas(clientes(whatsapp, telefono, telefono2))')
          .in('id', ids)
        const mapa = {}
        ;(tels || []).forEach(t => {
          const c = t.mascotas?.clientes
          if (c) mapa[t.id] = c
        })
        rows = rows.map(s => {
          const c = mapa[s.servicio_id]
          if (!c) return s
          return {
            ...s,
            cliente_wa:        s.cliente_wa || c.whatsapp || null,
            cliente_telefono:  c.telefono  || null,
            cliente_telefono2: c.telefono2 || null,
          }
        })
      }

      setServicios(rows)
      await autoCorregirDesdeKanban(rows)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function autoCorregirDesdeKanban(svcs) {
    const candidatos = svcs
      .filter(s => ['EN_PRODUCCION', 'EN_PROCESO', 'EN_CUARTO_FRIO', 'INGRESADO'].includes(s.estado))
      .map(s => s.servicio_id)
    if (!candidatos.length) return
    const { data: items } = await db.from('servicio_recordatorios')
      .select('servicio_id, estado')
      .in('servicio_id', candidatos)
      .neq('origen', 'REMOVIDO')
      .neq('estado', 'NA')
    if (!items?.length) return
    const porSvc = {}
    items.forEach(i => {
      if (!porSvc[i.servicio_id]) porSvc[i.servicio_id] = []
      porSvc[i.servicio_id].push(i)
    })
    const fijarListo = Object.entries(porSvc)
      .filter(([_, its]) => its.length > 0 && its.every(i => i.estado === 'LISTO' || i.estado === 'ENTREGADO'))
      .map(([id]) => id)
    if (!fijarListo.length) return
    await db.from('servicios').update({ estado: 'LISTO' }).in('id', fijarListo)
    setServicios(prev => prev.map(s => fijarListo.includes(s.servicio_id) ? { ...s, estado: 'LISTO' } : s))
  }

  async function abrirModal(s) {
    setSelected(s); setMensajeroId(''); setDetalle(null); setAliadoHorario(null)
    setEditTecnicoId(s.tecnico_id || ''); setEditEstadoPago(s.estado_pago || '')
    setEditNotas(s.notas || ''); setEditComisionAliado('')
    setEditPlanId(''); setNuevoPrecio(''); setMascotaParaPlan(null)
    setAddRecId(''); setAddRecQty(1)
    setCancelInfo(null); setModalCancelar(false); setMotivoCancelar(''); setObsCancelar('')

    // Si está cancelado, traer la trazabilidad en query aparte (defensivo: si
    // las columnas de cancelación aún no existen en DB, el detalle normal no se rompe)
    if (s.estado === 'CANCELADO') {
      db.from('servicios')
        .select('cancelado_en, motivo_cancelacion, observacion_cancelacion, etapa_cancelacion, cancelado_por_p:personal!cancelado_por(nombre, apellido)')
        .eq('id', s.servicio_id).maybeSingle()
        .then(({ data }) => { if (data) setCancelInfo(data) })
        .catch(() => {})
    }

    const [{ data: svcFull }, { data: rec }, { data: recs }, { data: novs }, { data: cf }] = await Promise.all([
      db.from('servicios')
        .select('punto_recogida, direccion_recogida, ciudad_recogida, barrio_recogida, indicaciones_recogida, mensajero_id, comision_aliado, comision_descontada, metodo_pago, fecha_limite_cambio_plan, aliado_origen_id, plan_id, mascota_id, created_at')
        .eq('id', s.servicio_id).maybeSingle(),
      db.from('recogidas')
        .select('contacto_nombre, contacto_telefono, estado, tecnico_id, foto_recogida_url')
        .eq('servicio_id', s.servicio_id).maybeSingle(),
      db.from('servicio_recordatorios')
        .select('*, recordatorios(nombre, precio_base)')
        .eq('servicio_id', s.servicio_id).neq('origen', 'REMOVIDO'),
      db.from('novedades_servicio')
        .select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
        .eq('servicio_id', s.servicio_id)
        .in('tipo_novedad', ['NOTA', 'PAGO_RECIBIDO'])
        .order('created_at', { ascending: true }),
      db.from('cuarto_frio')
        .select('foto_ingreso_url, foto_pesaje_url, peso_kg')
        .eq('servicio_id', s.servicio_id).maybeSingle(),
    ])

    setDetalle({ ...svcFull, recogida: rec, cuartoFrio: cf })
    setRecordatorios(recs || [])
    setNovedades(novs || [])
    setNuevoComentario('')
    setEditPlanId(svcFull?.plan_id || '')

    if (svcFull?.mascota_id) {
      db.from('mascotas').select('peso_kg, especie_id')
        .eq('id_mascota', svcFull.mascota_id).maybeSingle()
        .then(({ data }) => setMascotaParaPlan(data))
    }
    // Cargar horario del aliado si viene de veterinaria
    if (svcFull?.aliado_origen_id) {
      db.from('aliados').select('nombre, horario, telefono, whatsapp')
        .eq('id_aliado', svcFull.aliado_origen_id).maybeSingle()
        .then(({ data }) => { if (data) setAliadoHorario(data) })
    }
  }

  async function guardarCambios() {
    if (!selected) return
    setGuardando(true)
    const updates = {}
    if (editTecnicoId !== (selected.tecnico_id || ''))   updates.tecnico_id  = editTecnicoId  || null
    if (editEstadoPago !== (selected.estado_pago || '')) updates.estado_pago = editEstadoPago
    if (editNotas !== (selected.notas || ''))            updates.notas       = editNotas       || null
    // comision_aliado se guarda con su propio botón dedicado en la sección Financiero

    if (Object.keys(updates).length > 0) {
      const { error } = await db.from('servicios').update(updates).eq('id', selected.servicio_id)
      if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); setGuardando(false); return }

      if ('tecnico_id' in updates) {
        await db.from('recogidas').update({ tecnico_id: updates.tecnico_id }).eq('servicio_id', selected.servicio_id)

        const mascotaNombre = selected.mascota || 'la mascota'
        // Notificar al técnico anterior que fue removido
        if (selected.tecnico_id && selected.tecnico_id !== updates.tecnico_id) {
          await crearNotificacion({
            para_personal_id: selected.tecnico_id,
            de_personal_id:   personalData?.id,
            tipo:             'REASIGNACION_REMOVIDO',
            titulo:           'Te reasignaron una recogida',
            mensaje:          `Ya no estás asignado a la recogida de ${mascotaNombre}. Otro técnico tomará el servicio.`,
            servicio_id:      selected.servicio_id,
          })
        }
        // Notificar al nuevo técnico
        if (updates.tecnico_id) {
          await crearNotificacion({
            para_personal_id: updates.tecnico_id,
            de_personal_id:   personalData?.id,
            tipo:             'REASIGNACION_TECNICO',
            titulo:           'Nueva recogida asignada',
            mensaje:          `Se te asignó la recogida de ${mascotaNombre}. Revisa los detalles en tu app.`,
            servicio_id:      selected.servicio_id,
          })
        }
      }

      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, ...updates } : s))
      setSelected(prev => ({ ...prev, ...updates }))
    }
    setGuardando(false)
  }

  async function calcularPrecioPlan(planId) {
    if (!planId) return null
    return calcularPrecioPara(planId, mascotaParaPlan?.peso_kg || 0, mascotaParaPlan?.especie_id || 0)
  }

  async function cambiarPlan() {
    if (!editPlanId || editPlanId === detalle?.plan_id || !selected) return
    const planAnterior = planPorId(detalle?.plan_id)?.nombre || 'plan anterior'
    const planNuevo    = planPorId(editPlanId)?.nombre        || 'nuevo plan'
    const precioFinal  = nuevoPrecio ? parseFloat(nuevoPrecio) : null

    const fuera = detalle?.fecha_limite_cambio_plan && parseDate(detalle.fecha_limite_cambio_plan) < new Date()
    const msg = [
      fuera ? `⚠️ Este servicio está fuera del plazo de cambio de plan (${parseDate(detalle.fecha_limite_cambio_plan)?.toLocaleDateString('es-CO')}).` : null,
      `Plan: "${planAnterior}" → "${planNuevo}"`,
      precioFinal ? `Nuevo valor total: ${fmt(precioFinal)}` : null,
      'Se actualizarán los ítems de producción del servicio.',
    ].filter(Boolean).join('\n\n')

    if (!await confirm(msg, { title: '¿Confirmar cambio de plan?', confirmLabel: 'Sí, cambiar' })) return
    setCambiandoPlan(true)
    try {
      const updates = { plan_id: editPlanId }
      if (precioFinal) updates.valor_total = precioFinal

      const { error: svErr } = await db.from('servicios').update(updates).eq('id', selected.servicio_id)
      if (svErr) throw svErr

      // Criterio #11: si el servicio estaba en proceso grupal y su clasificación cambia,
      // sacarlo del lote + excluir del reporte + alerta (transaccional en backend).
      const TIPOS_GRUPALES = ['CREMACION_GRUPAL', 'COMPOSTAJE_GRUPAL']
      const tipoAnterior = planPorId(detalle?.plan_id)?.tipo_proceso
      const tipoNuevo    = planPorId(editPlanId)?.tipo_proceso
      if (TIPOS_GRUPALES.includes(tipoAnterior) && tipoAnterior !== tipoNuevo) {
        try {
          await orbitApi('/grupales/desvincular', {
            method: 'POST',
            body: { servicio_id: selected.servicio_id, motivo: `Cambio de plan: ${planAnterior} → ${planNuevo}` },
          })
        } catch (e) {
          console.warn('No se pudo desvincular del lote grupal:', e.message)
        }
      }

      // Marcar REMOVIDO los ítems del plan anterior
      await db.from('servicio_recordatorios')
        .update({ origen: 'REMOVIDO' })
        .eq('servicio_id', selected.servicio_id)
        .eq('origen', 'PLAN')

      // Cargar ítems del nuevo plan e insertar
      const { data: nuevosItems } = await db.from('plan_recordatorios')
        .select('recordatorio_id')
        .eq('plan_id', editPlanId)

      if (nuevosItems?.length) {
        await db.from('servicio_recordatorios').insert(
          nuevosItems.map(r => ({
            servicio_id:     selected.servicio_id,
            recordatorio_id: r.recordatorio_id,
            origen:          'PLAN',
            estado:          'PENDIENTE',
          }))
        )
      }

      // Registrar novedad
      const { data: novInserted } = await db.from('novedades_servicio').insert({
        servicio_id:    selected.servicio_id,
        tipo_novedad:   'NOTA',
        descripcion:    `Plan cambiado: ${planAnterior} → ${planNuevo}` +
                        (precioFinal ? ` · Nuevo valor: ${fmt(precioFinal)}` : '') +
                        '. Cambio realizado por coordinador.',
        registrado_por: personalData?.id || null,
      }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')

      // Recargar recordatorios frescos
      const { data: recsNuevos } = await db.from('servicio_recordatorios')
        .select('*, recordatorios(nombre, precio_base)')
        .eq('servicio_id', selected.servicio_id)
        .neq('origen', 'REMOVIDO')
      setRecordatorios(recsNuevos || [])
      if (novInserted?.[0]) setNovedades(prev => [...prev, novInserted[0]])

      // Update local state
      const upd = {
        plan: planNuevo,
        ...(precioFinal ? { valor_total: precioFinal, saldo_pendiente: precioFinal - (selected.valor_pagado || 0) } : {}),
      }
      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, ...upd } : s))
      setSelected(prev => ({ ...prev, ...upd }))
      setDetalle(prev => ({ ...prev, plan_id: editPlanId }))
      setNuevoPrecio('')
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al cambiar plan' })
    } finally {
      setCambiandoPlan(false)
    }
  }

  async function agregarAdicional() {
    if (!addRecId || !selected) return
    const rec      = recListOpts.find(r => r.id === addRecId)
    if (!rec) return
    const qty      = Math.max(1, parseInt(addRecQty) || 1)
    const subtotal = (rec.precio_base || 0) * qty

    setAddingRec(true)
    try {
      // Insertar ítem adicional (guardamos el precio cobrado para que sea
      // removible después con el monto correcto prellenado)
      const { error: recErr } = await db.from('servicio_recordatorios').insert({
        servicio_id:     selected.servicio_id,
        recordatorio_id: addRecId,
        origen:          'ADICIONAL',
        estado:          'PENDIENTE',
        precio_cobrado:  subtotal,
      })
      if (recErr) throw recErr

      // Actualizar valor_total + desglose de adicionales del servicio.
      // valor_adicionales solo se toca con su valor real en DB (no pisar con
      // estado local que puede no traer la columna).
      const nuevoTotal = (selected.valor_total || 0) + subtotal
      const { data: curSv } = await db.from('servicios')
        .select('valor_adicionales').eq('id', selected.servicio_id).maybeSingle()
      const updSv = { valor_total: nuevoTotal }
      if (curSv?.valor_adicionales != null) updSv.valor_adicionales = curSv.valor_adicionales + subtotal
      const { error: svErr } = await db.from('servicios')
        .update(updSv)
        .eq('id', selected.servicio_id)
      if (svErr) throw svErr

      // Registrar novedad
      const { data: novInserted } = await db.from('novedades_servicio').insert({
        servicio_id:    selected.servicio_id,
        tipo_novedad:   'NOTA',
        descripcion:    `Adicional agregado: ${rec.nombre}${qty > 1 ? ` × ${qty}` : ''} — ${fmt(subtotal)}. Pendiente de cobro en entrega.`,
        valor_ajuste:   subtotal,
        registrado_por: personalData?.id || null,
      }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')

      // Recargar ítems
      const { data: recsNuevos } = await db.from('servicio_recordatorios')
        .select('*, recordatorios(nombre, precio_base)')
        .eq('servicio_id', selected.servicio_id)
        .neq('origen', 'REMOVIDO')
      setRecordatorios(recsNuevos || [])
      if (novInserted?.[0]) setNovedades(prev => [...prev, novInserted[0]])

      // Update local state
      const saldoNuevo = nuevoTotal - (selected.valor_pagado || 0)
      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id
        ? { ...s, valor_total: nuevoTotal, saldo_pendiente: saldoNuevo }
        : s
      ))
      setSelected(prev => ({ ...prev, valor_total: nuevoTotal, saldo_pendiente: saldoNuevo }))
      setAddRecId(''); setAddRecQty(1)
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al agregar adicional' })
    } finally {
      setAddingRec(false)
    }
  }

  // Abrir el modal de "quitar ítem". `item` = fila servicio_recordatorios, o
  // null para el modo "ajuste manual" (adicional registrado al inicio, sin fila).
  function abrirQuitar(item) {
    setItemAQuitar(item || { __manual: true })
    setQuitarMonto(item ? String(precioSugeridoItem(item)) : '')
    setQuitarMotivo('')
  }

  async function quitarItem() {
    if (!selected || !itemAQuitar) return
    const esManual = !!itemAQuitar.__manual
    setQuitando(true)
    try {
      const res = await quitarItemServicio({
        servicio: {
          id:           selected.servicio_id,
          valor_total:  selected.valor_total,
          valor_pagado: selected.valor_pagado,
        },
        item:       esManual ? null : itemAQuitar,
        monto:      quitarMonto,
        motivo:     quitarMotivo,
        personalId: personalData?.id || null,
      })

      // Recargar ítems (los REMOVIDO quedan filtrados)
      const { data: recsNuevos } = await db.from('servicio_recordatorios')
        .select('*, recordatorios(nombre, precio_base)')
        .eq('servicio_id', selected.servicio_id)
        .neq('origen', 'REMOVIDO')
      setRecordatorios(recsNuevos || [])
      if (res.novedad) setNovedades(prev => [...prev, res.novedad])

      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id
        ? { ...s, valor_total: res.nuevoTotal, saldo_pendiente: res.saldo, estado_pago: res.nuevoEstadoPago }
        : s
      ))
      setSelected(prev => ({ ...prev, valor_total: res.nuevoTotal, saldo_pendiente: res.saldo, estado_pago: res.nuevoEstadoPago }))
      setItemAQuitar(null); setQuitarMonto(''); setQuitarMotivo('')
    } catch (err) {
      await showAlert(parsearErrorDB(err), { title: 'Error al quitar el ítem' })
    } finally {
      setQuitando(false)
    }
  }

  async function cambiarEstado(servicioId, nuevoEstado) {
    setServicios(prev => prev.map(s => s.servicio_id === servicioId ? { ...s, estado: nuevoEstado } : s))
    if (selected?.servicio_id === servicioId) setSelected(prev => ({ ...prev, estado: nuevoEstado }))
    const { error: err } = await db.from('servicios').update({ estado: nuevoEstado }).eq('id', servicioId)
    if (err) { await showAlert(parsearErrorDB(err), { title: 'Error' }); cargar() }
  }

  // Cancelación formal: transición de estado trazable — nunca borra datos,
  // evidencias, recibos ni historial del servicio
  async function cancelarServicio() {
    if (!selected || cancelando) return
    if (!motivoCancelar) {
      await showAlert('Selecciona el motivo de la cancelación.', { title: 'Motivo requerido' })
      return
    }
    setCancelando(true)
    try {
      const etapa  = selected.estado
      const ahora  = new Date().toISOString()
      const { error: err } = await db.from('servicios').update({
        estado:                  'CANCELADO',
        cancelado_en:            ahora,
        cancelado_por:           personalData?.id || null,
        motivo_cancelacion:      motivoCancelar,
        observacion_cancelacion: obsCancelar.trim() || null,
        etapa_cancelacion:       etapa,
      }).eq('id', selected.servicio_id)
      if (err) throw err

      // Trazabilidad también en el historial de novedades (visible en este modal)
      await db.from('novedades_servicio').insert({
        servicio_id:    selected.servicio_id,
        tipo_novedad:   'NOTA',
        descripcion:    `🚫 SERVICIO CANCELADO — Motivo: ${motivoCancelar}.` +
          (obsCancelar.trim() ? ` Observación: ${obsCancelar.trim()}.` : '') +
          ` Etapa al cancelar: ${ESTADO_LABEL[etapa] || etapa}.`,
        registrado_por: personalData?.id || null,
      })

      // Avisar al técnico asignado para que no salga a ruta
      if (selected.tecnico_id) {
        try {
          await crearNotificacion({
            para_personal_id: selected.tecnico_id,
            de_personal_id:   personalData?.id,
            tipo:             'SERVICIO_CANCELADO',
            titulo:           `Servicio cancelado — ${selected.mascota}`,
            mensaje:          `El servicio de ${selected.mascota} fue cancelado. Motivo: ${motivoCancelar}. No realices la recogida.`,
            servicio_id:      selected.servicio_id,
            datos:            { motivo: motivoCancelar },
          })
        } catch (_) { /* la notificación no debe bloquear la cancelación */ }
      }

      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, estado: 'CANCELADO' } : s))
      setSelected(prev => ({ ...prev, estado: 'CANCELADO' }))
      setCancelInfo({
        cancelado_en:            ahora,
        motivo_cancelacion:      motivoCancelar,
        observacion_cancelacion: obsCancelar.trim() || null,
        etapa_cancelacion:       etapa,
        cancelado_por_p:         { nombre: personalData?.nombre || '', apellido: personalData?.apellido || '' },
      })
      setModalCancelar(false)
      await showAlert('Servicio cancelado correctamente.', { title: 'Servicio cancelado' })
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al cancelar', variant: 'danger' })
    } finally {
      setCancelando(false)
    }
  }

  async function confirmarEntrega() {
    if (!selected || saving) return
    setSaving(true)
    try {
      await db.from('servicios').update({ estado: 'EN_ENTREGA' }).eq('id', selected.servicio_id)
      if (mensajeroId)
        await db.from('entregas').update({ mensajero_id: mensajeroId }).eq('servicio_id', selected.servicio_id).in('estado', ['PENDIENTE'])
      setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, estado: 'EN_ENTREGA' } : s))
      setSelected(prev => ({ ...prev, estado: 'EN_ENTREGA' })); setMensajeroId('')
    } catch (e) { await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' }) }
    finally { setSaving(false) }
  }

  async function ciclarRecordatorio(rec) {
    if (rec.estado === 'NA') return
    const ciclo = { PENDIENTE: 'EN_PROCESO', EN_PROCESO: 'LISTO', LISTO: 'ENTREGADO', ENTREGADO: 'PENDIENTE' }
    const next = ciclo[rec.estado] || 'PENDIENTE'
    await db.from('servicio_recordatorios').update({ estado: next }).eq('id', rec.id)

    const updatedRecs = recordatorios.map(r => r.id === rec.id ? { ...r, estado: next } : r)
    setRecordatorios(updatedRecs)

    const esTerminado = e => e === 'LISTO' || e === 'ENTREGADO'
    const cambio = (esTerminado(next) ? 1 : 0) - (esTerminado(rec.estado) ? 1 : 0)
    if (cambio !== 0) {
      setServicios(prev => prev.map(s =>
        s.servicio_id === selected?.servicio_id
          ? { ...s, items_listos: Math.max(0, (s.items_listos || 0) + cambio) }
          : s
      ))
    }

    // Recalcular estado del servicio dinámicamente
    const svcId = selected?.servicio_id
    if (!svcId) return
    try {
      const activos = updatedRecs.filter(r => r.estado !== 'NA' && r.origen !== 'REMOVIDO')
      if (!activos.length) return
      const { data: svc } = await db.from('servicios').select('estado').eq('id', svcId).maybeSingle()
      const estadoActual = svc?.estado
      if (['EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estadoActual)) return
      const todosTerminados = activos.every(r => esTerminado(r.estado))
      const algunoEnProceso = activos.some(r => r.estado === 'EN_PROCESO')
      let nuevoEstado = null
      if (todosTerminados && estadoActual !== 'LISTO') {
        nuevoEstado = 'LISTO'
      } else if (!todosTerminados && estadoActual === 'LISTO') {
        nuevoEstado = 'EN_PRODUCCION'
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estadoActual)) {
        nuevoEstado = 'EN_PRODUCCION'
      }
      if (nuevoEstado) {
        await db.from('servicios').update({ estado: nuevoEstado }).eq('id', svcId)
        setServicios(prev => prev.map(s => s.servicio_id === svcId ? { ...s, estado: nuevoEstado } : s))
        setSelected(prev => ({ ...prev, estado: nuevoEstado }))
      }
    } catch (_) { /* silencioso */ }
  }

  async function agregarComentario() {
    if (!nuevoComentario.trim() || !selected) return
    setGuardandoComentario(true)
    try {
      const { data: inserted } = await db.from('novedades_servicio').insert({
        servicio_id:    selected.servicio_id,
        tipo_novedad:   'NOTA',
        descripcion:    nuevoComentario.trim(),
        registrado_por: personalData?.id || null,
      }).select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
      setNuevoComentario('')
      if (inserted?.[0]) setNovedades(prev => [...prev, inserted[0]])
    } finally { setGuardandoComentario(false) }
  }

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function generateCodigo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  }

  async function contactar(e, s) {
    e.stopPropagation()
    if (contactarLoadingId || !s.cliente_wa) return
    setContactarLoadingId(s.servicio_id)
    try {
      const { data: svcRow, error: selErr } = await db
        .from('servicios').select('codigo_fotos, fecha_codigo_enviado').eq('id', s.servicio_id).single()
      if (selErr) { await showAlert(parsearErrorDB(selErr), { title: 'Error al leer servicio' }); return }
      let codigo = svcRow?.codigo_fotos
      if (!codigo) {
        codigo = generateCodigo()
        const { error: updErr } = await db.from('servicios').update({
          codigo_fotos: codigo,
          fecha_codigo_enviado: new Date().toISOString().split('T')[0],
        }).eq('id', s.servicio_id)
        if (updErr) { await showAlert(parsearErrorDB(updErr), { title: 'Error al generar código' }); return }
      } else if (!svcRow?.fecha_codigo_enviado) {
        // El código ya existía pero no se había registrado la fecha de envío
        await db.from('servicios').update({ fecha_codigo_enviado: new Date().toISOString().split('T')[0] }).eq('id', s.servicio_id)
      }
      const base = window.location.href.split('#')[0]
      const portalUrl = `${base}#/fotos/${codigo}`
      const msg =
        `Hola, le escribimos de Camino al Cielo 🌿\n\n` +
        `Le informamos que hemos recibido a *${s.mascota}* y será atendido con el *${s.plan}*.\n\n` +
        `Para iniciar el proceso, ingrese al siguiente enlace y comparta las fotos de ${s.mascota}:\n` +
        `${portalUrl}\n\n` +
        `Si prefiere, puede ingresar el código: *${codigo}*\n\n` +
        `Gracias por confiar en nosotros 🙏`
      window.open(waLink(s.cliente_wa, msg), '_blank')
    } finally { setContactarLoadingId(null) }
  }

  async function notificarTecnico(e, s) {
    e.stopPropagation()
    if (notifTecLoadingId || !s.tecnico_id) return
    const tec = tecnicos.find(t => t.id === s.tecnico_id)
    if (!tec?.whatsapp) {
      await showAlert('El técnico asignado no tiene número de WhatsApp registrado.', { title: 'Sin WhatsApp' })
      return
    }
    setNotifTecLoadingId(s.servicio_id)
    try {
      const { data: svc } = await db.from('servicios')
        .select('direccion_recogida, barrio_recogida, ciudad_recogida, indicaciones_recogida, notas')
        .eq('id', s.servicio_id).maybeSingle()
      const { data: rec } = await db.from('recogidas')
        .select('notas')
        .eq('servicio_id', s.servicio_id).maybeSingle()

      const fechaHoy  = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      const direccion = [svc?.direccion_recogida, svc?.barrio_recogida, svc?.ciudad_recogida].filter(Boolean).join(', ')
      const notasRec  = rec?.notas || svc?.indicaciones_recogida || ''
      const horaMatch = notasRec.match(/Hora aprox\. recogida: ([^.]+)/)
      const horaAprox = horaMatch?.[1]?.trim() || ''
      const indicaciones = svc?.indicaciones_recogida?.replace(/Hora aprox\. recogida:[^.]+\.\s*/i, '').trim() || ''

      const lineas = [
        `Camino al Cielo - Asignacion de servicio`,
        `Fecha: ${fechaHoy}`,
        ``,
        `Se le ha asignado un nuevo servicio de recogida con los siguientes datos:`,
        ``,
        `Mascota: ${s.mascota}${s.especie ? ` (${s.especie})` : ''}`,
        `Propietario: ${s.cliente}`,
        s.cliente_wa ? `Contacto: ${s.cliente_wa}` : '',
        `Plan: ${s.plan}`,
        ``,
        `Direccion de recogida: ${direccion || 'Por confirmar'}`,
        horaAprox ? `Hora aproximada: ${horaAprox}` : '',
        indicaciones ? `Indicaciones: ${indicaciones}` : '',
        ``,
        `Por favor ingrese a la aplicacion para confirmar la recogida y ver el detalle completo del servicio.`,
        ``,
        `Camino al Cielo`,
      ].filter(v => v !== null && v !== undefined)

      const mensaje = lineas.join('\n')

      window.open(waLink(tec.whatsapp, mensaje), '_blank')
    } finally {
      setNotifTecLoadingId(null)
    }
  }

  function alertLevel(s) {
    if (s.dias_para_vencer == null) return null
    if (s.dias_para_vencer < 0)  return 'vencido'
    if (s.dias_para_vencer === 0) return 'hoy'
    if (s.dias_para_vencer <= 3) return 'pronto'
    return null
  }

  // Días transcurridos desde fecha_ingreso (columna DATE) hasta hoy. Usa parseDate
  // —NUNCA new Date() crudo— para no correr un día en Colombia (UTC-5).
  function diasDesdeIngreso(fechaStr) {
    if (!fechaStr) return null
    const f = parseDate(fechaStr), h = parseDate(hoyStr)
    if (!f || !h) return null
    return Math.round((h - f) / 86400000)
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const planesUnicos = [...new Set(servicios.map(s => s.plan).filter(Boolean))].sort()

  // ── Valores derivados del modal de solicitud (evita IIFE en JSX) ─────────
  const SOL_LABL = 'block text-[11px] font-bold text-gray-500 mb-1'
  const SOL_INP  = 'w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10 transition-all bg-white'
  const hoyStr = today()
  const filtrados = servicios.filter(s => {
    if (!COLUMNAS.includes(s.estado)) return false
    // "Solo hoy": muestra únicamente lo que ingresó hoy. Las solicitudes pendientes
    // (columna SOLICITUDES) no se ven afectadas porque viven en otro arreglo.
    if (soloHoy && s.fecha_ingreso !== hoyStr) return false
    if (filtroEstado !== 'todos' && s.estado !== filtroEstado) return false
    if (filtroPlan   !== 'todos' && s.plan    !== filtroPlan)   return false
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase()
      return [s.mascota, s.cliente, s.plan, s.especie].some(v => v?.toLowerCase().includes(q))
    }
    return true
  })

  const sorted = [...filtrados].sort((a, b) => {
    const va = a[sortField] ?? '', vb = b[sortField] ?? ''
    return sortDir === 'asc'
      ? String(va).localeCompare(String(vb), 'es', { numeric: true })
      : String(vb).localeCompare(String(va), 'es', { numeric: true })
  })

  // ── DnD handlers ─────────────────────────────────────────────────────────
  function onDragStart(e, svc) { e.dataTransfer.setData('svc_id', svc.servicio_id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(svc.servicio_id) }
  function onDragEnd() { setDraggingId(null); setDragOverCol(null) }
  function onDragOver(e, col) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(col) }
  function onDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null) }
  function onDrop(e, col) {
    e.preventDefault()
    const id  = e.dataTransfer.getData('svc_id')
    const svc = servicios.find(s => s.servicio_id === id)
    if (id && svc && svc.estado !== col) cambiarEstado(id, col)
    setDraggingId(null); setDragOverCol(null)
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
      <div className="spinner" /><span className="text-sm font-medium">Cargando tablero…</span>
    </div>
  )
  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 text-sm">Error: {error}</div>
    </div>
  )

  // ── Imágenes del cliente (para modal productor/admin) ────────────────────
  const imagenesDelCliente = recordatorios
    .filter(r => r.origen !== 'REMOVIDO')
    .flatMap(r => {
      const urls = r.imagenes_cliente_urls?.length
        ? r.imagenes_cliente_urls
        : r.imagen_cliente_url ? [r.imagen_cliente_url] : []
      return urls.map((url, i) => ({ url, nombre: r.recordatorios?.nombre || 'Foto', idx: i, total: urls.length, recId: r.id }))
    })

  // ── WhatsApp message según tipo_lugar ────────────────────────────────────
  function generarMsgRuta(notif) {
    const d        = notif.datos || {}
    const mascota  = d.mascota        || 'su mascota'
    const hora     = d.hora_llegada   || '(hora por confirmar)'
    const tecnico  = d.tecnico_nombre || 'nuestro técnico'
    const direccion = d.direccion     || d.lugar || ''

    return [
      `Hola, esperamos que te encuentres bien.`,
      ``,
      `Te informamos que nuestro técnico *${tecnico}* estará acompañándonos en la recolección de *${mascota}*${direccion ? ` en la dirección *${direccion}*` : ''}, aproximadamente a las *${hora}*.`,
      ``,
      `Agradecemos la confianza que has depositado en nosotros en este momento tan especial. Si tienes alguna inquietud, estaremos atentos para ayudarte.`,
      ``,
      `Con cariño,`,
      `Equipo Camino al Cielo 🤍🐾`,
    ].join('\n')
  }

  return (
    <>
    {/* ── ALERTAS INICIO RUTA — toasts apilados en esquina (no bloquean) ── */}
    {alertasRuta.length > 0 && (
      <div className="fixed bottom-4 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-2 pointer-events-none">
        {alertasRuta.length > 1 && (
          <div className="flex items-center justify-between bg-white/95 backdrop-blur rounded-xl shadow border border-gray-100 px-3 py-2 pointer-events-auto">
            <span className="text-[11px] font-bold text-gray-600">{alertasRuta.length} inicios de ruta</span>
            <button onClick={limpiarAlertasRuta}
              className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 transition-colors">
              Marcar todas como leídas
            </button>
          </div>
        )}
        {alertasRuta.map(n => {
          const d     = n.datos || {}
          const waNum = d.wa_cliente || d.wa_aliado || ''
          const msg   = generarMsgRuta(n)
          return (
            <div key={n.id} className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden pointer-events-auto">
              <div className="px-4 py-3 border-b flex items-start gap-2" style={{ background: '#EEF3FB', borderColor: '#C5D8F5' }}>
                <span className="text-lg leading-none">🚗</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-[13px] leading-tight">{n.titulo}</p>
                  <p className="text-[11px] text-gray-500 truncate">{n.mensaje}</p>
                </div>
                <button onClick={() => descartarAlertaRuta(n.id)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white/60 transition-colors flex-shrink-0"
                  title="Marcar visto sin enviar">
                  <X size={14} />
                </button>
              </div>
              <div className="px-4 py-3">
                {waNum ? (
                  <a href={waLink(waNum, msg)}
                    target="_blank" rel="noreferrer"
                    onClick={() => descartarAlertaRuta(n.id)}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-bold"
                    style={{ background: '#25D366', color: '#fff' }}>
                    <MessageCircle size={15} /> Avisar al cliente por WhatsApp
                  </a>
                ) : (
                  <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    ⚠️ No hay número WhatsApp registrado para este servicio.
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )}
    <div className="flex flex-col flex-1 min-h-0">
      <Topbar actions={
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={cargar} title="Actualizar">
          <RefreshCw size={14} />
        </button>
      } />

      <div className={`p-5 flex flex-col gap-4 ${vista === 'kanban' ? 'flex-1 min-h-0' : ''}`}>

        {/* ── Alerta fotos pendientes (3+ días hábiles sin subir) ──────────── */}
        {(() => {
          const pendientes = servicios.filter(s => s.alerta_fotos_pendientes)
          if (!pendientes.length) return null
          return (
            <div className="rounded-xl border-2 px-4 py-3 flex items-start gap-3" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-amber-800 mb-1">
                  {pendientes.length} servicio{pendientes.length > 1 ? 's' : ''} sin fotos ({'>'}3 días hábiles)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pendientes.map(s => (
                    <button key={s.servicio_id} onClick={() => { const item = servicios.find(x => x.servicio_id === s.servicio_id); if (item) abrirModal(item) }}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-all hover:opacity-80"
                      style={{ background: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }}>
                      {s.mascota} · {s.cliente.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Alertas técnico declina / problema en ruta ───────────────────── */}
        {alertasDeclinas.length > 0 && (
          <div className="rounded-xl border-2 px-4 py-3 flex items-start gap-3" style={{ borderColor: '#FECACA', background: '#FEF2F2' }}>
            <UserX size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-red-800 mb-1.5">
                Reasignación urgente — {alertasDeclinas.length} alerta{alertasDeclinas.length > 1 ? 's' : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {alertasDeclinas.map(n => {
                  const svc = servicios.find(s => s.servicio_id === n.servicio_id)
                  const esProblema = n.tipo === 'TECNICO_PROBLEMA_RUTA'
                  return (
                    <button key={n.id}
                      onClick={async () => {
                        await marcarLeida(n.id)
                        setAlertasDeclinas(prev => prev.filter(a => a.id !== n.id))
                        if (svc) abrirModal(svc)
                      }}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 flex items-center gap-1"
                      style={esProblema
                        ? { background: '#FFF7ED', color: '#92400E', borderColor: '#FED7AA' }
                        : { background: '#FEE2E2', color: '#991B1B', borderColor: '#FECACA' }}>
                      {esProblema ? '⚠️' : '❌'} {n.titulo} · Reasignar
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Solicitudes movidas a columna del tablero */}

        {/* ── Selector de tablero (ADMIN y COORDINADOR) ────────────────────── */}
        {(esAdmin || esCoord) && (
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 self-start">
            <button
              onClick={() => setTableroActivo('coordinacion')}
              className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${tableroActivo === 'coordinacion' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              🗂 Coordinación
            </button>
            <button
              onClick={() => setTableroActivo('produccion')}
              className={`px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${tableroActivo === 'produccion' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              🎨 Producción / Diseño
            </button>
          </div>
        )}

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input className="pl-8 pr-7 h-9 text-[13px]" placeholder="Buscar mascota, cliente, plan…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {busqueda && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setBusqueda('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {planesUnicos.length > 1 && (
            <Select value={filtroPlan} onChange={e => setFiltroPlan(e.target.value)} className="h-9 text-[12px] w-44">
              <option value="todos">Todos los planes</option>
              {planesUnicos.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}

          {vista === 'tabla' && (
            <div className="flex flex-wrap gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${filtroEstado === 'todos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`} onClick={() => setFiltroEstado('todos')}>Todos</button>
              {COLUMNAS.map(col => {
                const cs = COL_STYLE[col]; const active = filtroEstado === col
                return (
                  <button key={col} className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${active ? 'bg-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`} style={active ? { color: cs.bar } : {}} onClick={() => setFiltroEstado(active ? 'todos' : col)}>
                    {colLabel(col)}
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={() => setSoloHoy(v => !v)}
            title={soloHoy ? 'Mostrando solo la operación de hoy — clic para ver todo' : 'Mostrando todo — clic para ver solo hoy'}
            className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-bold border transition-all ${soloHoy ? 'text-white border-transparent shadow-sm' : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50'}`}
            style={soloHoy ? { background: '#06B6D4' } : {}}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${soloHoy ? 'bg-white' : 'bg-gray-300'}`} />
            {soloHoy ? 'Solo hoy' : 'Todo'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-gray-400 font-medium hidden sm:block">{filtrados.length} servicio{filtrados.length !== 1 ? 's' : ''}</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              <button className={`w-8 h-7 flex items-center justify-center rounded-md transition-all ${vista === 'kanban' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} onClick={() => setVista('kanban')} title="Tablero Kanban"><LayoutGrid size={14} /></button>
              <button className={`w-8 h-7 flex items-center justify-center rounded-md transition-all ${vista === 'tabla' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} onClick={() => setVista('tabla')} title="Vista Tabla"><Table2 size={14} /></button>
            </div>
          </div>
        </div>

        {/* ── KANBAN VIEW ─────────────────────────────────────────────────── */}
        {vista === 'kanban' && (
          <div className="overflow-x-auto flex-1 pb-2 min-h-0">
            <div className="flex gap-3 h-full" style={{ minWidth: `${COLUMNAS.length * 256}px` }}>
              {COLUMNAS.map(col => {
                const esSolicitudes = col === 'SOLICITUDES'
                const items  = esSolicitudes ? [] : filtrados.filter(s => s.estado === col)
                const count  = esSolicitudes ? solicitudes.length : items.length
                const cs     = COL_STYLE[col]
                const isOver = dragOverCol === col

                return (
                  <div key={col} className="w-[248px] flex-shrink-0 flex flex-col gap-2"
                    onDragOver={e => { if (!esSolicitudes) onDragOver(e, col) }}
                    onDragLeave={onDragLeave}
                    onDrop={e => { if (!esSolicitudes) onDrop(e, col) }}>

                    {/* Cabecera columna */}
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all duration-150"
                      style={{ backgroundColor: isOver ? cs.bar + '22' : cs.dot, outline: isOver ? `2px dashed ${cs.bar}66` : '2px solid transparent', outlineOffset: '-2px' }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cs.bar }} />
                      <span className="text-[12px] font-bold flex-1 truncate" style={{ color: cs.bar }}>{colLabel(col)}</span>
                      <span className="text-[11px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full" style={{ backgroundColor: cs.bar, color: '#fff' }}>{count}</span>
                    </div>

                    {/* Área de tarjetas */}
                    <div className="space-y-2 flex-1 rounded-xl p-1 -m-1 transition-colors duration-150 min-h-[80px]"
                      style={{ backgroundColor: isOver ? '#F9FAFB' : 'transparent' }}>

                      {/* ── Columna SOLICITUDES ── */}
                      {esSolicitudes && (
                        <div className="space-y-2">
                          <button
                            onClick={() => setModalEnlace(true)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold border-2 border-dashed transition-all hover:opacity-80"
                            style={{ borderColor: '#C4A87A', color: '#9A7B4F', background: '#FFFDF7' }}>
                            <Send size={12} /> Enviar enlace a cliente
                          </button>
                          {solicitudes.length === 0 ? (
                            <div className="text-center py-8 text-[12px] text-gray-400">Sin solicitudes pendientes</div>
                          ) : solicitudes.map(s => {
                            const planNombre    = planPorId(s.plan_id)?.nombre || '—'
                            const especieNombre = especiesKanban.find(e => e.id === s.especie_id)?.nombre || ''
                            return (
                              <div key={s.id}
                                onClick={() => abrirSolicitud(s)}
                                className="bg-white border-2 rounded-xl p-3.5 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-px transition-all"
                                style={{ borderColor: '#F3E8CC' }}>
                                <div className="flex items-start gap-2 mb-2">
                                  <span className="text-xl leading-none flex-shrink-0">{petEmoji(especieNombre)}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-gray-900 truncate leading-tight">{s.mascota_nombre}</div>
                                    <div className="text-[11px] text-gray-400 truncate">{s.cliente_nombre} {s.cliente_apellido || ''}</div>
                                  </div>
                                </div>
                                <div className="text-[11px] text-gray-500 font-medium mb-2 truncate">{planNombre}</div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                    style={{ background: s.tipo_recogida === 'veterinaria' ? '#EFF5FF' : '#F0F7EB', color: s.tipo_recogida === 'veterinaria' ? '#1A5CD8' : '#3D5A27' }}>
                                    {s.tipo_recogida === 'veterinaria' ? '🏥' : '🏠'} {s.tipo_recogida === 'veterinaria' ? (aliados.find(a => a.id_aliado === s.aliado_id)?.nombre || s.aliado_nombre_otro || 'Veterinaria') : (s.barrio || s.ciudad || 'Domicilio')}
                                  </span>
                                  <span className="text-[10px] text-gray-300 shrink-0">
                                    {new Date(s.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                  </span>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); abrirSolicitud(s) }}
                                  className="mt-2.5 w-full py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-90"
                                  style={{ background: '#C4A87A', color: '#fff' }}>
                                  Revisar y convertir →
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {!esSolicitudes && (() => {
                        // Producción agrupa por urgencia (vencimiento del SLA);
                        // Coordinación agrupa por fecha de ingreso (Hoy/Ayer/…) para
                        // reducir scroll cuando se ve "Todo".
                        const TIERS_URGENCIA = [
                          { key: 'vencido', label: 'Vencidos',    color: '#C03030', bg: '#FEE2E2', urgent: true,  test: s => s.dias_para_vencer != null && s.dias_para_vencer < 0 },
                          { key: 'hoy',    label: 'Vence hoy',   color: '#B45309', bg: '#FEF3C7', urgent: true,  test: s => s.dias_para_vencer === 0 },
                          { key: 'pronto', label: '≤ 3 días',    color: '#9A5500', bg: '#FFF3DC', urgent: true,  test: s => s.dias_para_vencer != null && s.dias_para_vencer >= 1 && s.dias_para_vencer <= 3 },
                          { key: 'proximo',label: '4-7 días',    color: '#1D8A55', bg: '#E8F3EB', urgent: false, test: s => s.dias_para_vencer != null && s.dias_para_vencer >= 4 && s.dias_para_vencer <= 7 },
                          { key: 'normal', label: 'Sin urgencia', color: '#3B6FBF', bg: '#EEF3FB', urgent: false, test: s => s.dias_para_vencer != null && s.dias_para_vencer > 7 },
                          { key: 'sin_fecha', label: 'Sin fecha', color: '#9CA3AF', bg: '#F3F4F6', urgent: false, test: s => s.dias_para_vencer == null },
                        ]
                        const TIERS_FECHA = [
                          { key: 'hoy',     label: 'Hoy',          color: '#06B6D4', bg: '#CFFAFE', urgent: true,  test: s => { const d = diasDesdeIngreso(s.fecha_ingreso); return d != null && d <= 0 } },
                          { key: 'ayer',    label: 'Ayer',         color: '#3B82F6', bg: '#DBEAFE', urgent: true,  test: s => diasDesdeIngreso(s.fecha_ingreso) === 1 },
                          { key: 'semana',  label: 'Esta semana',  color: '#8B5CF6', bg: '#EDE9FE', urgent: false, test: s => { const d = diasDesdeIngreso(s.fecha_ingreso); return d != null && d >= 2 && d <= 6 } },
                          { key: 'antiguos',label: 'Más antiguos', color: '#6B7280', bg: '#F3F4F6', urgent: false, test: s => { const d = diasDesdeIngreso(s.fecha_ingreso); return d != null && d >= 7 } },
                          { key: 'sin_fecha', label: 'Sin fecha',  color: '#9CA3AF', bg: '#F3F4F6', urgent: false, test: s => diasDesdeIngreso(s.fecha_ingreso) == null },
                        ]
                        const TIERS = esVistaProd ? TIERS_URGENCIA : TIERS_FECHA

                        const renderCard = s => {
                          const al  = alertLevel(s)
                          const pct = s.total_items > 0 ? Math.round((s.items_listos / s.total_items) * 100) : 0
                          const tieneImagenes = s.fecha_imagenes_recibidas && s.estado === 'EN_PROCESO'
                          // Números registrados del cliente (WhatsApp + alternos), sin repetir
                          const telefonos = [...new Set(
                            [s.cliente_wa, s.cliente_telefono, s.cliente_telefono2]
                              .map(t => (t || '').trim()).filter(Boolean)
                          )]
                          const puedeContactar = (esVistaProd || esAdmin) && col === 'EN_CUARTO_FRIO' && s.cliente_wa
                          const puedeNotifTec  = !esVistaProd && col === 'INGRESADO' && !!s.tecnico_id
                          const sinTecnico     = !esVistaProd && ['INGRESADO','EN_RECOGIDA'].includes(col) && !s.tecnico_id
                          return (
                            <div key={s.servicio_id} draggable
                              onDragStart={e => onDragStart(e, s)} onDragEnd={onDragEnd}
                              className="bg-white border rounded-xl p-3.5 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-px transition-all select-none"
                              style={{ borderColor: al === 'vencido' ? '#FECACA' : al === 'hoy' ? '#FDE68A' : '#F3F4F6', opacity: draggingId === s.servicio_id ? 0.35 : 1 }}
                              onClick={() => draggingId === null && abrirModal(s)}
                            >
                              <div className="flex items-start gap-2 mb-2">
                                <span className="text-xl leading-none flex-shrink-0">{petEmoji(s.especie)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-bold text-gray-900 truncate leading-tight">{s.mascota}</div>
                                  <div className="text-[11px] text-gray-400 truncate mt-0.5">{s.cliente}</div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="text-[11px] text-gray-500 font-medium truncate flex-1">{s.plan}</div>
                                {s.fecha_ingreso && (
                                  <div className="flex items-center gap-1 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                                    style={{ background: '#F1F5F9', color: '#64748B' }}>
                                    📅 {new Date(s.fecha_ingreso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                                  </div>
                                )}
                              </div>
                              {telefonos.length > 0 && (
                                <div className="flex flex-col gap-1 mb-2">
                                  {telefonos.map((tel, i) => (
                                    <a key={i} href={waLink(tel)} target="_blank" rel="noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 hover:text-green-600 transition-colors w-fit">
                                      <Phone size={11} className="text-green-600 shrink-0" />
                                      {tel}
                                    </a>
                                  ))}
                                </div>
                              )}
                              {al && (
                                <div className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 ${al === 'vencido' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                  <AlertTriangle size={9} />
                                  {s.dias_para_vencer < 0 ? `Vencido ${Math.abs(s.dias_para_vencer)}d` : s.dias_para_vencer === 0 ? 'Vence hoy' : `${s.dias_para_vencer}d`}
                                </div>
                              )}
                              {tieneImagenes && (
                                <div className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 bg-purple-100 text-purple-700">
                                  <Camera size={9} /> Imágenes listas
                                </div>
                              )}
                              {sinTecnico && (
                                <div className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 bg-orange-100 text-orange-700">
                                  <AlertTriangle size={9} /> Sin técnico
                                </div>
                              )}
                              {puedeContactar && (
                                <button
                                  onClick={e => contactar(e, s)}
                                  disabled={contactarLoadingId === s.servicio_id}
                                  className="mt-2.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                  style={{ backgroundColor: '#25D366' }}
                                >
                                  {contactarLoadingId === s.servicio_id
                                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                    : <MessageCircle size={11} />}
                                  Contactar cliente
                                </button>
                              )}
                              {puedeNotifTec && (
                                <button
                                  onClick={e => notificarTecnico(e, s)}
                                  disabled={notifTecLoadingId === s.servicio_id}
                                  className="mt-2.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                  style={{ backgroundColor: '#1A5CD8' }}
                                >
                                  {notifTecLoadingId === s.servicio_id
                                    ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                    : <Send size={11} />}
                                  Notificar técnico
                                </button>
                              )}
                            </div>
                          )
                        }

                        if (items.length === 0) return (
                          <div className="border-2 border-dashed rounded-xl p-5 text-center text-[12px] font-medium transition-all"
                            style={{ borderColor: isOver ? cs.bar : cs.dot, color: isOver ? cs.bar : '#D1D5DB' }}>
                            {isOver ? '↓ Soltar aquí' : 'Sin servicios'}
                          </div>
                        )

                        const tiered = TIERS.map(t => ({ ...t, items: items.filter(t.test) })).filter(t => t.items.length > 0)

                        // Un solo grupo → render directo sin cabecera
                        if (tiered.length === 1) return <div className="space-y-2">{tiered[0].items.map(renderCard)}</div>

                        // Múltiples grupos → jerarquía colapsable
                        return tiered.map(tier => {
                          const gKey = `${col}-${tier.key}`
                          const defaultOpen = tier.urgent || tier.items.length <= 3
                          const isOpenTier = gKey in groupsOpen ? groupsOpen[gKey] : defaultOpen
                          return (
                            <div key={tier.key} className="mb-0.5">
                              {/* Cabecera del grupo */}
                              <button
                                className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-colors hover:bg-gray-50 mb-1"
                                onClick={() => setGroupsOpen(prev => ({ ...prev, [gKey]: !isOpenTier }))}
                              >
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tier.color }} />
                                <span className="text-[11px] font-bold flex-1 text-left" style={{ color: tier.color }}>{tier.label}</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tier.color + '22', color: tier.color }}>{tier.items.length}</span>
                                <ChevronDown size={11} className="transition-transform flex-shrink-0" style={{ color: tier.color, transform: isOpenTier ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                              </button>

                              {isOpenTier ? (
                                <div className="space-y-2 pl-0.5">{tier.items.map(renderCard)}</div>
                              ) : (
                                /* Vista pila colapsada */
                                <button
                                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all hover:shadow-sm"
                                  style={{ background: tier.bg, borderColor: tier.color + '44' }}
                                  onClick={() => setGroupsOpen(prev => ({ ...prev, [gKey]: true }))}
                                >
                                  <div className="flex -space-x-2 flex-shrink-0">
                                    {tier.items.slice(0, 4).map((s, i) => (
                                      <div key={s.servicio_id}
                                        className="w-7 h-7 rounded-full bg-white border-2 flex items-center justify-center text-[13px] leading-none shadow-sm"
                                        style={{ borderColor: tier.color + '66', zIndex: 4 - i }}>
                                        {petEmoji(s.especie)}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex-1 text-left min-w-0">
                                    <div className="text-[11px] font-bold" style={{ color: tier.color }}>{tier.items.length} en cola</div>
                                    <div className="text-[10px] text-gray-400 truncate">{tier.items.map(s => s.mascota).join(', ')}</div>
                                  </div>
                                  <ChevronDown size={11} className="flex-shrink-0" style={{ color: tier.color, transform: 'rotate(-90deg)' }} />
                                </button>
                              )}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TABLE VIEW ──────────────────────────────────────────────────── */}
        {vista === 'tabla' && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    {[
                      { field: 'mascota', label: 'Mascota' }, { field: 'cliente', label: 'Cliente' },
                      { field: 'plan', label: 'Plan' }, { field: 'estado', label: 'Estado' },
                      { field: 'fecha_ingreso', label: 'Ingreso' }, { field: 'dias_para_vencer', label: 'Días' },
                    ].map(({ field, label }) => (
                      <th key={field} className="text-left px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none transition-colors whitespace-nowrap" onClick={() => toggleSort(field)}>
                        <div className="flex items-center gap-1">{label}<SortIcon field={field} sortField={sortField} sortDir={sortDir} /></div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Ítems</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => {
                    const al  = alertLevel(s)
                    const pct = s.total_items > 0 ? Math.round((s.items_listos / s.total_items) * 100) : 0
                    return (
                      <tr key={s.servicio_id} className="hover:bg-gray-50/70 transition-colors cursor-pointer" style={{ borderBottom: i < sorted.length - 1 ? '1px solid #F9FAFB' : 'none' }} onClick={() => abrirModal(s)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xl leading-none">{petEmoji(s.especie)}</span>
                            <div>
                              <div className="text-[13px] font-semibold text-gray-900">{s.mascota}</div>
                              <div className="text-[11px] text-gray-400">{s.especie}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[13px] text-gray-700">{s.cliente}</td>
                        <td className="px-4 py-3 text-[12px] text-gray-500">{s.plan}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <EstadoBadge estado={s.estado} />
                            {s.fecha_imagenes_recibidas && s.estado === 'EN_PROCESO' && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 w-fit">
                                <Camera size={8} /> Imágenes listas
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-gray-500 whitespace-nowrap">
                          {s.fecha_ingreso ? parseDate(s.fecha_ingreso)?.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {s.dias_para_vencer != null ? (
                            <span className={`text-[12px] font-semibold ${al === 'vencido' ? 'text-red-600' : al === 'hoy' ? 'text-amber-600' : al === 'pronto' ? 'text-amber-500' : 'text-gray-500'}`}>
                              {s.dias_para_vencer < 0 ? `−${Math.abs(s.dias_para_vencer)}d` : s.dias_para_vencer === 0 ? 'Hoy' : `${s.dias_para_vencer}d`}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {s.total_items > 0 ? (
                            <div className="flex items-center gap-1.5 min-w-[80px]">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">{s.items_listos}/{s.total_items}</span>
                            </div>
                          ) : <span className="text-gray-300 text-[12px]">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {sorted.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">{busqueda.trim() ? `Sin resultados para "${busqueda}"` : 'Sin servicios'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal detalle / gestión ───────────────────────────────────────── */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={`${petEmoji(selected.especie)} ${selected.mascota}`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4">

            {/* Cabecera: estado + fechas */}
            <div className="flex flex-wrap items-center gap-3">
              <EstadoBadge estado={selected.estado} />
              {selected.fecha_imagenes_recibidas && selected.estado === 'EN_PROCESO' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
                  <Camera size={11} /> Imágenes recibidas
                </span>
              )}
              <span className="text-[11px] text-gray-400">Ingreso: <strong className="text-gray-700">{detalle?.created_at ? fmtDateTime(detalle.created_at) : (selected.fecha_ingreso ? parseDate(selected.fecha_ingreso)?.toLocaleDateString('es-CO') : '—')}</strong></span>
              {selected.fecha_limite_entrega && (
                <span className="text-[11px] text-gray-400">Límite: <strong className="text-gray-700">{parseDate(selected.fecha_limite_entrega)?.toLocaleDateString('es-CO')}</strong></span>
              )}
              {selected.dias_para_vencer != null && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${selected.dias_para_vencer < 0 ? 'bg-red-50 text-red-600' : selected.dias_para_vencer <= 2 ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
                  {selected.dias_para_vencer < 0 ? `${Math.abs(selected.dias_para_vencer)}d vencido` : `${selected.dias_para_vencer}d restantes`}
                </span>
              )}
            </div>

            {/* ── Banner servicio cancelado: trazabilidad completa ── */}
            {selected.estado === 'CANCELADO' && (
              <div className="rounded-xl px-4 py-3 space-y-1"
                style={{ background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
                <p className="text-[13px] font-bold" style={{ color: '#991B1B' }}>🚫 Este servicio fue cancelado</p>
                {cancelInfo ? (
                  <div className="text-[12px] space-y-0.5" style={{ color: '#B91C1C' }}>
                    {cancelInfo.motivo_cancelacion && <p><strong>Motivo:</strong> {cancelInfo.motivo_cancelacion}</p>}
                    {cancelInfo.observacion_cancelacion && <p><strong>Observación:</strong> {cancelInfo.observacion_cancelacion}</p>}
                    <p>
                      {cancelInfo.cancelado_por_p && <><strong>Por:</strong> {cancelInfo.cancelado_por_p.nombre} {cancelInfo.cancelado_por_p.apellido} · </>}
                      {cancelInfo.cancelado_en && <><strong>Fecha:</strong> {new Date(cancelInfo.cancelado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</>}
                    </p>
                    {cancelInfo.etapa_cancelacion && (
                      <p><strong>Etapa al cancelar:</strong> {ESTADO_LABEL[cancelInfo.etapa_cancelacion] || cancelInfo.etapa_cancelacion}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px]" style={{ color: '#B91C1C' }}>El detalle de la cancelación está en el historial de comentarios.</p>
                )}
                <p className="text-[11px]" style={{ color: '#DC2626' }}>Los datos, evidencias y recibos del servicio se conservan para auditoría.</p>
              </div>
            )}

            {/* ── Alerta horario veterinaria ── */}
            {aliadoHorario && (() => {
              const est = calcularEstadoVet(aliadoHorario.horario)
              if (!est.tieneHorario) return null
              const COLOR = { verde: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }, naranja: { bg: '#FFF7ED', border: '#FED7AA', text: '#92400E' }, rojo: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' } }
              const c = COLOR[est.nivel] || COLOR.rojo
              return (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                  style={{ background: c.bg, border: `1.5px solid ${c.border}` }}>
                  <span className="text-lg shrink-0">🏥</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold" style={{ color: c.text }}>{aliadoHorario.nombre}</p>
                    <p className="text-[12px] font-semibold mt-0.5" style={{ color: c.text }}>{est.textoEstado}</p>
                  </div>
                </div>
              )
            })()}

            {/* ── Galería de imágenes del cliente (productor y admin) ── */}
            {puedeVerImagenes && imagenesDelCliente.length > 0 && (
              <div className="rounded-xl border-2 p-3 space-y-2.5" style={{ borderColor: '#E9D5FF', background: '#FAF5FF' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#7C3AED' }}>
                    <Images size={12} /> Imágenes del cliente ({imagenesDelCliente.length})
                  </div>
                  <span className="text-[10px] text-purple-400">Clic para abrir · clic derecho para descargar</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {imagenesDelCliente.map((img, i) => (
                    <a key={i} href={img.url} target="_blank" rel="noreferrer"
                      className="group relative rounded-lg overflow-hidden bg-purple-100 block"
                      style={{ aspectRatio: '1/1' }}
                      title={img.total > 1 ? `${img.nombre} — foto ${img.idx + 1}/${img.total}` : img.nombre}
                    >
                      <img src={img.url} alt={img.nombre} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <Download size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[8px] font-semibold text-white truncate leading-tight" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
                        {img.total > 1 ? `${img.nombre} ${img.idx + 1}` : img.nombre}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* ── Evidencias del técnico (colapsable) ── */}
            {detalle && (() => {
              const fotos = [
                detalle.recogida?.foto_recogida_url  && { url: detalle.recogida.foto_recogida_url,  label: 'Identidad mascota',  emoji: '🪪' },
                detalle.cuartoFrio?.foto_ingreso_url && { url: detalle.cuartoFrio.foto_ingreso_url, label: 'Ingreso cuarto frío', emoji: '❄️' },
                detalle.cuartoFrio?.foto_pesaje_url  && { url: detalle.cuartoFrio.foto_pesaje_url,  label: 'Foto pesaje',         emoji: '⚖️' },
              ].filter(Boolean)
              if (!fotos.length) return null
              return <EvidenciasColapsable fotos={fotos} />
            })()}

            {/* ── Frases y textos del cliente (productor y admin) ── */}
            {puedeVerImagenes && (() => {
              const conTextos = recordatorios.filter(r => r.datos_cliente && Object.keys(r.datos_cliente).length > 0)
              if (!conTextos.length) return null
              return (
                <div className="rounded-xl border-2 p-3 space-y-2.5" style={{ borderColor: '#BBF7D0', background: '#F0FFF4' }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#15803D' }}>
                    <MessageSquare size={12} /> Textos del cliente
                  </div>
                  <div className="space-y-3">
                    {conTextos.map(r => (
                      <div key={r.id}>
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                          {r.recordatorios?.nombre || 'Recordatorio'}
                        </div>
                        <div className="space-y-1.5">
                          {Object.entries(r.datos_cliente).map(([label, valores]) => (
                            <div key={label}>
                              <div className="text-[10px] font-semibold mb-1" style={{ color: '#166534' }}>{label}</div>
                              {(Array.isArray(valores) ? valores : [valores]).filter(v => v?.trim()).map((v, i) => (
                                <div key={i} className="text-[12px] bg-white rounded-lg px-3 py-1.5 border mb-1" style={{ borderColor: '#BBF7D0' }}>
                                  "{v}"
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Columna izquierda */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><User size={10} /> Cliente</div>
                  <div>
                    <div className="text-[13px] font-bold text-gray-900">{selected.cliente}</div>
                    {selected.cliente_wa && <div className="text-[11px] text-gray-500">{selected.cliente_wa}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-gray-400">Especie:</span> <span className="font-semibold">{selected.especie}</span></div>
                    {selected.raza && <div><span className="text-gray-400">Raza:</span> <span className="font-semibold">{selected.raza}</span></div>}
                    <div><span className="text-gray-400">Plan:</span> <span className="font-semibold">{selected.plan}</span></div>
                    <div><span className="text-gray-400">Acomp.:</span> <span className="font-semibold">{selected.tipo_acompanamiento || '—'}</span></div>
                    {selected.aliado_origen && (
                      <div className="col-span-2"><span className="text-gray-400">Aliado:</span> <span className="font-semibold">{selected.aliado_origen}{selected.aliado_vip ? ' ⭐' : ''}</span></div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><MapPin size={10} /> Recogida</div>
                  {detalle ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-gray-400">Punto:</span> <span className="font-semibold">{detalle.punto_recogida === 'CLINICA_ALIADA' ? 'Clínica aliada' : detalle.punto_recogida === 'DOMICILIO' ? 'Domicilio' : detalle.punto_recogida === 'SEDE' ? 'Sede CaC' : detalle.punto_recogida || '—'}</span></div>
                        <div><span className="text-gray-400">Ciudad:</span> <span className="font-semibold">{detalle.ciudad_recogida || '—'}</span></div>
                      </div>
                      {detalle.direccion_recogida && <div><span className="text-gray-400">Dirección:</span> <span className="font-semibold">{detalle.direccion_recogida}</span>{detalle.barrio_recogida ? ` · ${detalle.barrio_recogida}` : ''}</div>}
                      {detalle.recogida?.contacto_nombre && <div><span className="text-gray-400">Contacto:</span> <span className="font-semibold">{detalle.recogida.contacto_nombre}</span>{detalle.recogida.contacto_telefono ? ` · ${detalle.recogida.contacto_telefono}` : ''}</div>}
                      {detalle.indicaciones_recogida && <div className="text-gray-500 italic">"{detalle.indicaciones_recogida}"</div>}
                    </div>
                  ) : <div className="text-[11px] text-gray-400">Cargando…</div>}
                </div>
              </div>

              {/* Columna derecha */}
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider flex items-center gap-1.5"><User size={10} /> Técnico de recogida</div>
                  <Select value={editTecnicoId} onChange={e => setEditTecnicoId(e.target.value)} className="w-full text-[12px]">
                    <option value="">Sin asignar</option>
                    {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.apellido}</option>)}
                  </Select>
                  {editTecnicoId !== (selected.tecnico_id || '') && editTecnicoId && (
                    <p className="text-[10px] text-blue-600 font-medium">↳ Reasignación pendiente · guarda los cambios abajo</p>
                  )}
                </div>

                {/* ── Cambiar plan (solo COORDINADOR / ADMIN) ── */}
                {(esAdmin || rol === 'COORDINADOR') && !['CANCELADO','ENTREGADO'].includes(selected.estado) && detalle && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: '#F0FFF4', border: '1.5px solid #86EFAC' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#15803D' }}>
                      <ArrowRightLeft size={10} /> Cambiar plan
                    </div>
                    {detalle?.fecha_limite_cambio_plan && (
                      <div className={`text-[10px] px-2 py-1 rounded-lg font-medium ${parseDate(detalle.fecha_limite_cambio_plan) < new Date() ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {parseDate(detalle.fecha_limite_cambio_plan) < new Date()
                          ? `⚠️ Plazo vencido: ${parseDate(detalle.fecha_limite_cambio_plan)?.toLocaleDateString('es-CO')}`
                          : `Límite cambio: ${parseDate(detalle.fecha_limite_cambio_plan)?.toLocaleDateString('es-CO')}`}
                      </div>
                    )}
                    <Select
                      value={editPlanId}
                      onChange={async e => {
                        const pid = e.target.value
                        setEditPlanId(pid)
                        setNuevoPrecio('')
                        if (pid && pid !== detalle?.plan_id) {
                          const precio = await calcularPrecioPlan(pid)
                          if (precio) setNuevoPrecio(String(precio))
                        }
                      }}
                      className="w-full text-[12px]"
                    >
                      <option value="">Seleccionar plan…</option>
                      {planesKanban
                        .filter(p => !['BRONCE','PLATA','ORO_EXCLUSIVO','DIAMANTE','VITALICIO'].includes(p.codigo))
                        .map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </Select>
                    {editPlanId && editPlanId !== detalle?.plan_id && (
                      <div className="space-y-2">
                        <div>
                          <div className="text-[10px] text-gray-500 mb-1">Nuevo valor total</div>
                          <input
                            type="number"
                            value={nuevoPrecio}
                            onChange={e => setNuevoPrecio(e.target.value)}
                            placeholder="Precio del nuevo plan…"
                            className="w-full px-2.5 py-2 rounded-lg border text-[12px] outline-none focus:ring-2"
                            style={{ borderColor: '#BBF7D0', focusRingColor: '#86EFAC' }}
                          />
                          {!nuevoPrecio && (
                            <p className="text-[10px] text-amber-600 mt-1">⚠️ Ingresa el precio si no fue calculado automáticamente</p>
                          )}
                        </div>
                        <button
                          onClick={cambiarPlan}
                          disabled={cambiandoPlan}
                          className="w-full py-2 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#15803D', color: '#fff' }}>
                          <ArrowRightLeft size={12} />
                          {cambiandoPlan ? 'Cambiando…' : 'Confirmar cambio de plan'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><CreditCard size={10} /> Financiero</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-gray-400">Total:</span> <span className="font-bold text-gray-900">{fmt(selected.valor_total)}</span></div>
                    <div><span className="text-gray-400">Pagado:</span> <span className="font-semibold text-green-700">{fmt(selected.valor_pagado)}</span></div>
                    {selected.saldo_pendiente > 0 && <div><span className="text-gray-400">Saldo:</span> <span className="font-bold text-red-600">{fmt(selected.saldo_pendiente)}</span></div>}
                    {detalle?.metodo_pago && <div><span className="text-gray-400">Método:</span> <span className="font-semibold">{detalle.metodo_pago}</span></div>}
                  </div>

                  {/* Comisión aliado — visible cuando viene de aliado y no fue descontada del precio */}
                  {detalle?.aliado_origen_id && !detalle?.comision_descontada && (
                    <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Comisión aliado</div>
                      <div className="text-[11px] text-amber-700">
                        {detalle.comision_aliado > 0
                          ? <>Actual: <strong>{fmt(detalle.comision_aliado)}</strong> ({Math.round(detalle.comision_aliado / selected.valor_total * 100)}%)</>
                          : 'Sin comisión registrada'}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            type="number" min="0" max="100" step="0.5"
                            placeholder={detalle.comision_aliado > 0
                              ? String(Math.round(detalle.comision_aliado / selected.valor_total * 100))
                              : 'Ej: 15'}
                            value={editComisionAliado}
                            onChange={e => setEditComisionAliado(e.target.value)}
                            className="w-16 px-2 py-1 text-[12px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg outline-none focus:border-amber-500 text-right"
                          />
                          <span className="text-[12px] font-bold text-amber-700">%</span>
                          {editComisionAliado !== '' && (
                            <span className="text-[11px] text-amber-600 ml-1">
                              = {fmt(Math.round(selected.valor_total * (parseFloat(editComisionAliado) || 0) / 100))}
                            </span>
                          )}
                        </div>
                        <button
                          disabled={editComisionAliado === '' || guardando}
                          onClick={async () => {
                            const monto = Math.round(selected.valor_total * (parseFloat(editComisionAliado) || 0) / 100)
                            const { error } = await db.from('servicios')
                              .update({ comision_aliado: monto })
                              .eq('id', selected.servicio_id)
                            if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
                            setDetalle(prev => prev ? { ...prev, comision_aliado: monto } : prev)
                            setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, comision_aliado: monto } : s))
                            setEditComisionAliado('')
                          }}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-40"
                          style={{ background: '#F59E0B', color: '#fff' }}>
                          Guardar
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Estado de pago</div>
                    <Select value={editEstadoPago} onChange={e => setEditEstadoPago(e.target.value)} className="w-full text-[12px]">
                      <option value="PENDIENTE">Pendiente</option>
                      <option value="PARCIAL">Parcial</option>
                      <option value="COMPLETO">Completo</option>
                    </Select>
                  </div>

                  {/* Recalcular precio y comisión según peso actual de la mascota */}
                  {(esAdmin || rol === 'COORDINADOR') && mascotaParaPlan?.peso_kg > 0 && detalle?.plan_id && !['ENTREGADO','CANCELADO'].includes(selected.estado) && (
                    <button
                      onClick={async () => {
                        const nuevoPrecioBase = await calcularPrecioPlan(detalle.plan_id)
                        if (!nuevoPrecioBase) { await showAlert('No se pudo calcular el precio para este peso y plan.', { title: 'Sin precio' }); return }

                        // Recalcular comisión si hay aliado con comisión registrada
                        let nuevaComision = null
                        if (detalle?.aliado_origen_id && (detalle?.comision_aliado ?? 0) > 0) {
                          const hoy = new Date()
                          const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
                          const [{ data: aliado }, { data: svcsDelMes }, { data: filas }] = await Promise.all([
                            db.from('aliados').select('vip').eq('id_aliado', detalle.aliado_origen_id).maybeSingle(),
                            db.from('servicios').select('id, planes(codigo)').eq('aliado_origen_id', detalle.aliado_origen_id).gte('fecha_ingreso', inicioMes),
                            db.from('config_comisiones').select('porcentaje, plan_id, rango_min, rango_max').eq('es_vip', aliado?.vip ?? false),
                          ])
                          const serviciosMes = (svcsDelMes || []).filter(s => s.planes?.codigo !== 'DESAMPARADO').length
                          const match = (filas || [])
                            .filter(c =>
                              (c.plan_id === detalle.plan_id || c.plan_id === null) &&
                              c.rango_min <= serviciosMes &&
                              (c.rango_max === null || c.rango_max >= serviciosMes)
                            )
                            .sort((a, b) => {
                              if (a.plan_id && !b.plan_id) return -1
                              if (!a.plan_id && b.plan_id) return 1
                              return b.rango_min - a.rango_min
                            })[0]
                          const pct = parseFloat(match?.porcentaje) || 0
                          if (pct > 0) nuevaComision = Math.round(nuevoPrecioBase * pct / 100)
                        }

                        const cambioPrecio   = Math.abs(nuevoPrecioBase - selected.valor_total) > 0.5
                        const cambioComision = nuevaComision != null && Math.abs(nuevaComision - (detalle?.comision_aliado ?? 0)) > 0.5
                        if (!cambioPrecio && !cambioComision) {
                          await showAlert(`Los valores ya están correctos para el peso actual (${mascotaParaPlan.peso_kg} kg).`, { title: 'Sin cambios' })
                          return
                        }

                        const lineas = []
                        if (cambioPrecio)   lineas.push(`Precio: ${fmt(selected.valor_total)} → ${fmt(nuevoPrecioBase)}`)
                        if (cambioComision) lineas.push(`Comisión aliado: ${fmt(detalle.comision_aliado)} → ${fmt(nuevaComision)}`)

                        const ok = await confirm(
                          `Recalcular según peso actual (${mascotaParaPlan.peso_kg} kg):\n\n${lineas.join('\n')}\n\n¿Actualizar?`,
                          { title: 'Recalcular precio por peso', confirmLabel: 'Sí, actualizar' }
                        )
                        if (!ok) return

                        const updates = {}
                        if (cambioPrecio)   updates.valor_total     = nuevoPrecioBase
                        if (cambioComision) updates.comision_aliado = nuevaComision

                        const { error } = await db.from('servicios').update(updates).eq('id', selected.servicio_id)
                        if (error) { await showAlert(parsearErrorDB(error), { title: 'Error' }); return }
                        setServicios(prev => prev.map(s => s.servicio_id === selected.servicio_id ? { ...s, ...updates } : s))
                        setSelected(prev => ({ ...prev, ...updates }))
                        if (cambioComision) setDetalle(prev => prev ? { ...prev, comision_aliado: nuevaComision } : prev)
                      }}
                      className="w-full py-1.5 px-3 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={11} /> Recalcular precio por peso actual
                    </button>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><Pencil size={10} /> Notas</div>
                  <textarea value={editNotas} onChange={e => setEditNotas(e.target.value)} rows={2} placeholder="Sin notas…" className="w-full text-[12px] text-gray-700 bg-white border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-200" />
                </div>

                <button onClick={guardarCambios} disabled={guardando} className="w-full py-2 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50" style={{ background: '#1A5CD8', color: '#fff' }}>
                  <Save size={13} />
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>

            {/* Preparar entrega (LISTO) */}
            {selected.estado === 'LISTO' && (
              <button
                onClick={() => { setModalEntrega(selected.servicio_id); setSelected(null) }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all hover:opacity-90"
                style={{ background: '#4F46E5', color: '#fff' }}>
                <Truck size={14} /> Preparar entrega
              </button>
            )}

            {/* Mover estado — un CANCELADO solo lo puede reactivar un ADMIN */}
            {(selected.estado !== 'CANCELADO' || esAdmin) && (
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                {selected.estado === 'CANCELADO' ? 'Reactivar a… (solo admin)' : 'Mover a…'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TODAS_COLS.filter(c => c !== selected.estado && !(selected.estado === 'LISTO' && c === 'EN_ENTREGA')).map(col => (
                  <button key={col} disabled={saving} onClick={() => cambiarEstado(selected.servicio_id, col)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all hover:opacity-80 disabled:opacity-40"
                    style={ESTADO_COLOR[col] ? { background: ESTADO_COLOR[col].bg, color: ESTADO_COLOR[col].text, borderColor: ESTADO_COLOR[col].border } : { background: '#F3F4F6', color: '#6B7280', borderColor: '#E5E7EB' }}>
                    {ESTADO_LABEL[col]}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* ── Opción anticipados compostaje ── */}
            {selected.tipo_proceso?.startsWith('COMPOSTAJE') && selected.recordatorios_anticipados !== null && selected.recordatorios_anticipados !== undefined && (
              <div className="rounded-xl border-2 px-3 py-2.5 flex items-center gap-2"
                style={{ borderColor: selected.recordatorios_anticipados ? '#86EFAC' : '#FDE68A', background: selected.recordatorios_anticipados ? '#F0FFF4' : '#FFFBEB' }}>
                <span className="text-base">{selected.recordatorios_anticipados ? '⚡' : '⏳'}</span>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: selected.recordatorios_anticipados ? '#15803D' : '#92400E' }}>
                    {selected.recordatorios_anticipados ? 'Cliente quiere recordatorios ANTICIPADOS' : 'Cliente prefiere ESPERAR al proceso completo'}
                  </div>
                  <div className="text-[10px]" style={{ color: selected.recordatorios_anticipados ? '#166534' : '#78350F' }}>
                    {selected.recordatorios_anticipados ? 'Producir mientras el compostaje avanza.' : 'No producir hasta terminar el compostaje (~2 meses).'}
                  </div>
                </div>
              </div>
            )}

            {/* ── Indicaciones de diseño del cliente ── */}
            {selected.comentarios_cliente && (
              <div className="rounded-xl border-2 p-3 space-y-1" style={{ borderColor: '#93C5FD', background: '#EFF6FF' }}>
                <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#1D4ED8' }}>
                  💬 Indicaciones del cliente
                </div>
                <p className="text-[12px] text-blue-800 leading-relaxed">"{selected.comentarios_cliente}"</p>
              </div>
            )}

            {/* Ítems del servicio */}
            {recordatorios.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Ítems del servicio ({recordatorios.filter(r => r.estado === 'LISTO' || r.estado === 'ENTREGADO').length}/{recordatorios.filter(r => r.estado !== 'NA' && r.origen !== 'REMOVIDO').length} listos)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recordatorios.map(r => {
                    if (r.estado === 'NA')
                      return (
                        <span key={r.id} className="text-[11px] px-2.5 py-1.5 rounded-full line-through opacity-50"
                          style={{ background: '#F3F4F6', color: '#9CA3AF' }} title="Cliente no desea este recordatorio">
                          {r.recordatorios?.nombre || 'Ítem'} · No desea
                        </span>
                      )
                    const puedeQuitar = (esAdmin || rol === 'COORDINADOR') && !['CANCELADO', 'ENTREGADO'].includes(selected.estado)
                    return (
                      <span key={r.id} className="inline-flex items-center gap-1">
                        <button className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full cursor-pointer transition-all prod-pill-${r.estado}`} onClick={() => ciclarRecordatorio(r)}>
                          {r.recordatorios?.nombre || 'Ítem'} · {r.estado.replace(/_/g, ' ')}
                        </button>
                        {puedeQuitar && (
                          <button onClick={() => abrirQuitar(r)} title="Quitar este ítem (el cliente no lo tomó)"
                            className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Agregar recordatorio adicional (solo COORDINADOR/ADMIN) ── */}
            {(esAdmin || rol === 'COORDINADOR') && !['CANCELADO','ENTREGADO'].includes(selected.estado) && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#92400E' }}>
                  <Package size={10} /> Agregar ítem adicional
                </div>
                <div className="flex gap-2">
                  <Select
                    value={addRecId}
                    onChange={e => { setAddRecId(e.target.value); setAddRecQty(1) }}
                    className="flex-1 text-[12px]"
                  >
                    <option value="">Seleccionar ítem…</option>
                    {recListOpts.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}{r.precio_base ? ` — ${fmt(r.precio_base)}` : ''}
                      </option>
                    ))}
                  </Select>
                  <input
                    type="number" min={1} max={99}
                    value={addRecQty}
                    onChange={e => setAddRecQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-14 px-2 py-2 rounded-lg border text-[12px] text-center outline-none"
                    style={{ borderColor: '#FDE68A' }}
                    title="Cantidad"
                  />
                </div>
                {addRecId && (() => {
                  const r = recListOpts.find(x => x.id === addRecId)
                  if (!r) return null
                  const sub = (r.precio_base || 0) * addRecQty
                  return (
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-amber-700">
                        {sub > 0 ? `+${fmt(sub)} — pendiente de cobro en entrega` : 'Sin costo adicional'}
                      </p>
                      <button
                        onClick={agregarAdicional}
                        disabled={addingRec}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50"
                        style={{ background: '#D97706', color: '#fff' }}>
                        <Package size={11} />
                        {addingRec ? 'Agregando…' : 'Agregar'}
                      </button>
                    </div>
                  )
                })()}
                <div className="pt-1 mt-1 border-t border-amber-200/70">
                  <button onClick={() => abrirQuitar(null)}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline-offset-2 hover:underline">
                    ¿El cliente no tomó un adicional registrado al inicio? Quitar / ajustar cobro
                  </button>
                </div>
              </div>
            )}

            {/* Comentarios del proceso */}
            <div className="pt-2" style={{ borderTop: '1px solid #F0F0F0' }}>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MessageSquare size={11} /> Comentarios del proceso
              </div>
              {novedades.length === 0
                ? <p className="text-[11px] text-gray-400 mb-2">Sin comentarios aún</p>
                : (
                  <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-1">
                    {novedades.map(c => (
                      <div key={c.id} className="rounded-lg px-3 py-2"
                        style={{ background: c.tipo_novedad === 'PAGO_RECIBIDO' ? '#F0FDF4' : '#F9FAFB', border: `1px solid ${c.tipo_novedad === 'PAGO_RECIBIDO' ? '#86EFAC' : '#E5E7EB'}` }}>
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[11px] font-semibold text-gray-700">{c.personal ? `${c.personal.nombre} ${c.personal.apellido}` : 'Sistema'}</span>
                          <span className="text-[10px] text-gray-400">{c.created_at ? new Date(c.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-relaxed">{c.descripcion}</p>
                        {c.valor_ajuste != null && <p className="text-[11px] font-bold mt-0.5" style={{ color: '#15803D' }}>💰 {fmt(c.valor_ajuste)}</p>}
                      </div>
                    ))}
                  </div>
                )
              }
              <div className="flex gap-2">
                <input type="text" value={nuevoComentario}
                  onChange={e => setNuevoComentario(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agregarComentario() } }}
                  placeholder="Agregar comentario al proceso…"
                  className="flex-1 px-3 py-2 rounded-xl border text-[12px] outline-none"
                  style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }} />
                <button onClick={agregarComentario} disabled={guardandoComentario || !nuevoComentario.trim()}
                  className="px-3 py-2 rounded-xl font-bold text-[12px] flex items-center gap-1.5 disabled:opacity-40 transition-all hover:opacity-90"
                  style={{ background: '#1A5CD8', color: '#fff' }}>
                  <Send size={13} />
                </button>
              </div>
            </div>

            {/* WhatsApp */}
            {selected.cliente_wa && (
              <a href={waLink(selected.cliente_wa, `Hola, le escribimos de Camino al Cielo sobre el servicio de ${selected.mascota}`)}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#25D366' }}>
                <MessageCircle size={14} /> Escribir por WhatsApp
              </a>
            )}

            {/* ── Cancelar servicio (solo COORDINADOR / ADMIN, nunca entregados) ── */}
            {(esAdmin || esCoord) && !['CANCELADO', 'ENTREGADO'].includes(selected.estado) && (
              <div className="pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
                <button onClick={() => { setMotivoCancelar(''); setObsCancelar(''); setModalCancelar(true) }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold transition-all hover:bg-red-50"
                  style={{ color: '#DC2626', border: '1.5px solid #FECACA' }}>
                  <X size={13} /> Cancelar servicio
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Modal confirmación de cancelación ─────────────────────────────── */}
      {itemAQuitar && selected && (() => {
        const esManual = !!itemAQuitar.__manual
        const nombre   = esManual ? 'Adicional no listado' : (itemAQuitar.recordatorios?.nombre || 'Ítem')
        const monto    = Math.max(0, parseFloat(quitarMonto) || 0)
        const pagado   = selected.valor_pagado || 0
        const totalPrev = Math.max(0, (selected.valor_total || 0) - monto)
        return (
          <Modal open onClose={() => { if (!quitando) setItemAQuitar(null) }}
            title={esManual ? 'Quitar adicional / ajustar cobro' : 'Quitar ítem del servicio'}
            maxWidth="max-w-md"
            footer={
              <div className="flex gap-2 justify-end w-full">
                <button onClick={() => setItemAQuitar(null)} disabled={quitando}
                  className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={quitarItem} disabled={quitando}
                  className="px-5 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                  style={{ background: '#DC2626' }}>
                  {quitando ? 'Quitando…' : 'Quitar y descontar'}
                </button>
              </div>
            }>
            <div className="space-y-4">
              <p className="text-[12px] leading-relaxed text-gray-600">
                {esManual
                  ? <>Descuenta del valor a cobrar un adicional que se registró al inicio y el cliente <strong>no tomó</strong>. El ítem no figura en la lista, por eso ingresas el monto manualmente.</>
                  : <>Se quitará <strong>{nombre}</strong> de <strong>{selected.mascota}</strong>. El ítem deja de producirse y se descuenta su valor de lo que el técnico debe cobrar.</>}
              </p>

              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Monto a descontar
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[13px]">$</span>
                  <Input type="number" min={0} className="pl-7 text-[13px]"
                    value={quitarMonto} onChange={e => setQuitarMonto(e.target.value)}
                    placeholder="0" />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Editable. Pon 0 si no cambia el valor a cobrar.</p>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Motivo (opcional)
                </label>
                <textarea value={quitarMotivo} onChange={e => setQuitarMotivo(e.target.value)}
                  rows={2} placeholder="Ej: el cliente no quiso el cofre en la puerta…"
                  className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none"
                  style={{ borderColor: '#E5E7EB' }} />
              </div>

              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 space-y-1">
                <div className="flex justify-between text-[12px]"><span className="text-gray-500">Valor actual</span><span className="font-semibold text-gray-800">{fmt(selected.valor_total || 0)}</span></div>
                <div className="flex justify-between text-[12px]"><span className="text-gray-500">Descuento</span><span className="font-semibold text-red-600">– {fmt(monto)}</span></div>
                <div className="flex justify-between text-[13px] border-t border-gray-200 pt-1.5 mt-1.5">
                  <span className="font-bold text-gray-800">Nuevo valor a cobrar</span>
                  <span className="font-extrabold text-gray-900">{fmt(totalPrev)}</span>
                </div>
              </div>

              {pagado > 0 && (
                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ⚠️ Este servicio ya tiene {fmt(pagado)} pagados. Al bajar el total revisa que el recibo y el pago sigan cuadrando.
                </div>
              )}
            </div>
          </Modal>
        )
      })()}

      {modalCancelar && selected && (
        <Modal open={modalCancelar} onClose={() => { if (!cancelando) setModalCancelar(false) }}
          title="Cancelar servicio"
          maxWidth="max-w-md"
          footer={
            <div className="flex gap-2 justify-end w-full">
              <button onClick={() => setModalCancelar(false)} disabled={cancelando}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={cancelarServicio} disabled={cancelando || !motivoCancelar}
                className="px-5 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: '#DC2626' }}>
                {cancelando ? 'Cancelando…' : 'Confirmar cancelación'}
              </button>
            </div>
          }>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}>
              <AlertTriangle size={18} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
              <p className="text-[12px] leading-relaxed" style={{ color: '#991B1B' }}>
                Esta acción marcará el servicio de <strong>{selected.mascota}</strong> como cancelado.
                No se eliminará, pero dejará de aparecer como servicio activo.
                Las evidencias, recibos e historial se conservan.
              </p>
            </div>

            {/* Advertencia si el proceso ya inició (mascota ya recogida) */}
            {!['INGRESADO', 'EN_RECOGIDA'].includes(selected.estado) && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
                <span className="text-base flex-shrink-0">⚠️</span>
                <p className="text-[12px]" style={{ color: '#92400E' }}>
                  Este servicio ya tiene <strong>proceso iniciado</strong> (etapa actual:{' '}
                  <strong>{ESTADO_LABEL[selected.estado] || selected.estado}</strong>).
                  La cancelación quedará registrada con esta etapa para trazabilidad.
                </p>
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
                Motivo de cancelación <span className="text-red-500">*</span>
              </label>
              <Select value={motivoCancelar} onChange={e => setMotivoCancelar(e.target.value)} className="w-full text-[13px]">
                <option value="">Seleccionar motivo…</option>
                {MOTIVOS_CANCELACION.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
                Observación (opcional)
              </label>
              <textarea value={obsCancelar} onChange={e => setObsCancelar(e.target.value)}
                rows={3} placeholder="Detalle adicional de la cancelación…"
                className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none"
                style={{ borderColor: '#E5E7EB' }} />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal preparar entrega */}
      {modalEntrega && (
        <ModalPreparaEntrega
          servicioId={modalEntrega}
          onClose={() => setModalEntrega(null)}
          onGuardado={() => { setModalEntrega(null); cargar() }}
        />
      )}

      {/* ── Modal revisión / conversión de solicitud ─────────────────────── */}
      {selSolicitud && (() => {
        const cf  = convForm
        const set = (k, v) => setConvForm(p => ({ ...p, [k]: v }))
        const planActual = planPorId(cf.plan_id)
        const esIndividual = ['CREMACION_INDIVIDUAL','COMPOSTAJE_INDIVIDUAL'].includes(planActual?.tipo_proceso)

        return (
        <Modal open={!!selSolicitud} onClose={() => setSelSolicitud(null)}
          title="Revisión y corrección de solicitud"
          maxWidth="max-w-2xl"
          footer={
            <div className="flex items-center justify-between w-full gap-3">
              <button onClick={() => descartarSolicitud(selSolicitud.id)}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-red-600 border border-red-200 hover:bg-red-50 transition-all">
                Descartar
              </button>
              <div className="flex gap-2">
                <button onClick={() => setSelSolicitud(null)}
                  className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all">
                  Cancelar
                </button>
                <button onClick={convertirSolicitud} disabled={convirtiendo}
                  className="px-5 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-50 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#3D5A27,#1A5CD8)' }}>
                  {convirtiendo
                    ? <><div className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />Creando...</>
                    : '✅ Crear servicio'}
                </button>
              </div>
            </div>
          }>
          <div className="space-y-4">

            {/* ── Propietario ── */}
            <section className="rounded-xl p-4 space-y-3" style={{ background: '#F8F9FA', border: '1px solid #E5E7EB' }}>
              <p className={SOL_LABL} style={{ fontSize: 11 }}>PROPIETARIO</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={SOL_LABL}>Nombre *</label>
                  <input className={SOL_INP} value={cf.cliente_nombre} onChange={e => set('cliente_nombre', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Apellido</label>
                  <input className={SOL_INP} value={cf.cliente_apellido} onChange={e => set('cliente_apellido', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>WhatsApp *</label>
                  <input className={SOL_INP} inputMode="tel" value={cf.cliente_whatsapp} onChange={e => set('cliente_whatsapp', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>2do contacto</label>
                  <input className={SOL_INP} inputMode="tel" placeholder="Cel / fijo alternativo" value={cf.cliente_telefono} onChange={e => set('cliente_telefono', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>3er contacto</label>
                  <input className={SOL_INP} inputMode="tel" placeholder="Otro número" value={cf.cliente_telefono2} onChange={e => set('cliente_telefono2', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Cédula</label>
                  <input className={SOL_INP} value={cf.cliente_cedula} onChange={e => set('cliente_cedula', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Email</label>
                  <input className={SOL_INP} type="email" value={cf.cliente_email} onChange={e => set('cliente_email', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Ciudad residencia</label>
                  <input className={SOL_INP} value={cf.cliente_ciudad} onChange={e => set('cliente_ciudad', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Localidad</label>
                  <LocalidadSelect value={cf.cliente_localidad} onChange={v => set('cliente_localidad', v)} placeholder="Seleccionar…" />
                </div>
                <div>
                  <label className={SOL_LABL}>Barrio</label>
                  <input className={SOL_INP} value={cf.cliente_barrio} onChange={e => set('cliente_barrio', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={SOL_LABL}>Dirección residencia</label>
                  <input className={SOL_INP} value={cf.cliente_direccion} onChange={e => set('cliente_direccion', e.target.value)} />
                </div>
              </div>
            </section>

            {/* ── Mascota ── */}
            <section className="rounded-xl p-4 space-y-3" style={{ background: '#F8F9FA', border: '1px solid #E5E7EB' }}>
              <p className={SOL_LABL} style={{ fontSize: 11 }}>MASCOTA</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={SOL_LABL}>Nombre *</label>
                  <input className={SOL_INP} value={cf.mascota_nombre} onChange={e => set('mascota_nombre', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Especie</label>
                  <select className={SOL_INP} value={cf.especie_id} onChange={e => set('especie_id', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {especiesKanban.map(e => <option key={e.id} value={String(e.id)}>{petEmoji(e.nombre)} {e.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={SOL_LABL}>Peso (kg) *</label>
                  <input className={SOL_INP} type="number" inputMode="decimal" step="0.1"
                    value={cf.mascota_peso_kg} onChange={e => set('mascota_peso_kg', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Raza</label>
                  <input className={SOL_INP} value={cf.mascota_raza} onChange={e => set('mascota_raza', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={SOL_LABL}>Sexo</label>
                  <div className="flex gap-2">
                    {['Macho','Hembra'].map(v => (
                      <button key={v} type="button" onClick={() => set('mascota_sexo', v)}
                        className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-all ${cf.mascota_sexo === v ? 'border-[#1A5CD8] bg-[#EFF5FF] text-[#1A5CD8]' : 'border-gray-200 text-gray-400'}`}>
                        {v === 'Macho' ? '♂' : '♀'} {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Plan y precio ── */}
            <section className="rounded-xl p-4 space-y-3" style={{ background: '#F8F9FA', border: '1px solid #E5E7EB' }}>
              <p className={SOL_LABL} style={{ fontSize: 11 }}>PLAN Y PRECIO</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={SOL_LABL}>Plan *</label>
                  <select className={SOL_INP} value={cf.plan_id} onChange={async e => {
                    const pid = e.target.value
                    set('plan_id', pid)
                    set('valor_total', '')
                    const precio = await calcularPrecioPara(pid, cf.mascota_peso_kg, cf.especie_id)
                    if (!precio) return
                    setConvForm(prev => String(prev.plan_id) === String(pid)
                      ? { ...prev, valor_total: String(precio) }
                      : prev)
                    // Recalcular comisión con el nuevo plan
                    if (aliadoSolData && pid) {
                      const plan = planesKanban.find(p => String(p.id) === String(pid))
                      const pct  = await calcularComisionPct(aliadoSolData.id_aliado, aliadoSolData.vip, pid, plan?.tipo_proceso)
                      setComisionSolPct(pct)
                      setComisionSol(pct > 0 ? Math.round(precio * pct / 100) : 0)
                    }
                  }}>
                    <option value="">— Seleccionar plan —</option>
                    {planesKanban.filter(p => !['BRONCE','PLATA','ORO_EXCLUSIVO','DIAMANTE','VITALICIO'].includes(p.codigo))
                      .map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={SOL_LABL}>Valor total (COP)</label>
                  <input type="number" className={SOL_INP} placeholder="0" value={cf.valor_total}
                    onChange={e => set('valor_total', e.target.value)} />
                </div>

                {/* Comisión aliado — solo visible si hay aliado en la solicitud */}
                {selSolicitud?.aliado_id && (
                  <div className="col-span-2">
                    <div className="rounded-xl p-3 space-y-2" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-amber-800">
                            Comision aliado{comisionSolPct > 0 ? ` (${comisionSolPct}% calculado automaticamente)` : ''}
                          </p>
                          <p className="text-[10px] text-amber-600 mt-0.5">
                            El cliente paga el valor completo. Esta comision se registra para {aliadoSolData?.modalidad_comision === 'FACTURACION_MENSUAL' ? 'facturacion mensual' : aliadoSolData?.modalidad_comision === 'CREDITO_ACUMULADO' ? 'credito acumulado' : 'seguimiento'} al aliado.
                          </p>
                        </div>
                        <input type="number" min="0"
                          className="w-28 px-3 py-2 text-[13px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg outline-none focus:border-amber-500 text-right"
                          value={comisionSol}
                          onChange={e => setComisionSol(Math.max(0, parseFloat(e.target.value) || 0))}
                        />
                      </div>
                      {comisionSol > 0 && cf.valor_total && (
                        <p className="text-[10px] text-amber-700">
                          Neto para Camino al Cielo: <strong>{fmt(parseFloat(cf.valor_total) - comisionSol)}</strong> de <strong>{fmt(parseFloat(cf.valor_total))}</strong> cobrados al cliente
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className={SOL_LABL}>Estado de pago</label>
                  <select className={SOL_INP} value={cf.estado_pago} onChange={e => set('estado_pago', e.target.value)}>
                    <option value="PENDIENTE">Pendiente</option>
                    <option value="PARCIAL">Parcial</option>
                    <option value="COMPLETO">Completo</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={SOL_LABL}>Método de pago</label>
                  <select className={SOL_INP} value={cf.metodo_pago} onChange={e => set('metodo_pago', e.target.value)}>
                    <option value="">— Sin especificar —</option>
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="TARJETA">Tarjeta</option>
                    <option value="NEQUI">Nequi / Daviplata</option>
                  </select>
                </div>
              </div>
              {selSolicitud.notas_cliente && (
                <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
                  💬 Notas del cliente: <span className="font-semibold">{selSolicitud.notas_cliente}</span>
                </div>
              )}
            </section>

            {/* ── Recogida ── */}
            <section className="rounded-xl p-4 space-y-3" style={{ background: '#F8F9FA', border: '1px solid #E5E7EB' }}>
              <p className={SOL_LABL} style={{ fontSize: 11 }}>RECOGIDA</p>

              {/* Banner veterinaria seleccionada por el cliente */}
              {cf.tipo_recogida === 'veterinaria' && selSolicitud?.aliado_id && (() => {
                const al = aliados.find(a => a.id_aliado === selSolicitud.aliado_id)
                if (!al) return null
                return (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: '#EFF5FF', border: '1px solid #BFDBFE' }}>
                    <span className="text-base shrink-0">🏥</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-blue-800 leading-tight">{al.nombre}</p>
                      {(al.direccion || al.ciudad) && (
                        <p className="text-[11px] text-blue-600 mt-0.5 truncate">
                          {[al.direccion, al.barrio, al.ciudad].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {al.telefono && <p className="text-[11px] text-blue-500">{al.telefono}</p>}
                    </div>
                  </div>
                )
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={SOL_LABL}>Punto de recogida</label>
                  <div className="flex gap-2">
                    {[{v:'domicilio',l:'🏠 Domicilio'},{v:'veterinaria',l:'🏥 Veterinaria'}].map(o => (
                      <button key={o.v} type="button" onClick={() => set('tipo_recogida', o.v)}
                        className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-all ${cf.tipo_recogida === o.v ? 'border-[#3D5A27] bg-[#F0F7EB] text-[#3D5A27]' : 'border-gray-200 text-gray-400'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={SOL_LABL}>Ciudad</label>
                  <input className={SOL_INP} value={cf.ciudad} onChange={e => set('ciudad', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Barrio</label>
                  <input className={SOL_INP} value={cf.barrio} onChange={e => set('barrio', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={SOL_LABL}>Dirección de recogida</label>
                  <input className={SOL_INP} value={cf.direccion} onChange={e => set('direccion', e.target.value)} />
                </div>
                <div>
                  <label className={SOL_LABL}>Hora aproximada</label>
                  <input type="time" className={SOL_INP} value={cf.hora_aproximada} onChange={e => set('hora_aproximada', e.target.value)} />
                </div>
                {cf.tipo_recogida === 'veterinaria' && selSolicitud?.aliado_nombre_otro && (
                  <div className="flex items-center gap-2 col-span-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠️ Vet no registrada: {selSolicitud.aliado_nombre_otro}</span>
                  </div>
                )}
              </div>
            </section>

            {/* ── Asignación ── */}
            <section className="rounded-xl p-4 space-y-3" style={{ border: '2px solid #EFF5FF', background: '#FAFCFF' }}>
              <p className="text-[11px] font-bold text-[#1A5CD8] uppercase tracking-wider">Asignación</p>
              <div className="grid grid-cols-2 gap-3">
                <div className={esIndividual ? '' : 'col-span-2'}>
                  <label className={SOL_LABL}>Técnico asignado</label>
                  <select className={SOL_INP} value={cf.tecnico_id} onChange={e => set('tecnico_id', e.target.value)}>
                    <option value="">Sin asignar</option>
                    {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.apellido || ''}</option>)}
                  </select>
                </div>
                {esIndividual && (
                  <div>
                    <label className={SOL_LABL}>Tipo de acompañamiento</label>
                    <select className={SOL_INP} value={cf.tipo_acompanamiento} onChange={e => set('tipo_acompanamiento', e.target.value)}>
                      <option value="PRESENCIAL">Presencial</option>
                      <option value="VIDEOLLAMADA">Videollamada</option>
                      <option value="EVIDENCIA">Solo evidencias</option>
                    </select>
                  </div>
                )}
              </div>
            </section>

          </div>
        </Modal>
        )
      })()}

      {/* ── Modal: enviar enlace de solicitud al cliente ──────────────────── */}
      <Modal open={modalEnlace} onClose={() => setModalEnlace(false)}
        title="Enviar enlace de solicitud al cliente"
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center justify-end w-full gap-2">
            <button onClick={() => setModalEnlace(false)}
              className="px-4 py-2 rounded-xl text-[12px] font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all">
              Cancelar
            </button>
            <button onClick={enviarEnlaceSolicitud}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)' }}>
              <MessageCircle size={13} /> Abrir WhatsApp
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-[12px] text-gray-500 leading-relaxed">
            Se abrirá WhatsApp con el chat del cliente y el mensaje listo — solo dale enviar
            desde tu número. Cuando el cliente complete el formulario, la solicitud aparecerá
            automáticamente en esta columna.
          </p>

          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">Nombre del cliente <span className="font-normal text-gray-400">(opcional)</span></label>
            <Input placeholder="María" value={enlaceNombre}
              onChange={e => setEnlaceNombre(e.target.value)} />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-gray-600 mb-1">WhatsApp del cliente *</label>
            <Input placeholder="3001234567" inputMode="tel" maxLength={25} value={enlaceTelefono}
              onChange={e => setEnlaceTelefono(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">Colombia: 3XX XXX XXXX · Internacional: +1 555 1234</p>
          </div>

          {/* Vista previa del mensaje */}
          <div className="rounded-xl p-3.5" style={{ background: '#F0F7EB', border: '1px solid #D9E8CC' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#3D5A27' }}>Vista previa del mensaje</p>
            <p className="text-[12px] text-gray-700 whitespace-pre-line leading-relaxed">
              {mensajeEnlaceSolicitud(enlaceNombre)}
            </p>
          </div>

          {/* Copiar enlace manual */}
          <button type="button" onClick={copiarEnlaceSolicitud}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
            {enlaceCopiado ? <><Check size={12} className="text-green-600" /> Enlace copiado</> : <><Copy size={12} /> Copiar solo el enlace</>}
          </button>
        </div>
      </Modal>
    </div>
    </>
  )
}
