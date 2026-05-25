import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import CargaIA from '@/components/CargaIA'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { db } from '@/lib/supabase'
import { fmt, today, needsAcomp, petEmoji, initials } from '@/lib/utils'
import {
  CheckCircle, ChevronRight, ChevronLeft, Search, X,
  User, Star, Loader2, MapPin, Clock, CreditCard, Truck, Sparkles
} from 'lucide-react'

const ESPECIE_NOMBRE_A_ID = { 'Perro':1, 'Gato':2, 'Conejo':3, 'Ave':4, 'Hámster':5, 'Pez':6, 'Reptil':7, 'Otro':8 }

// ─── constants ────────────────────────────────────────────────────────────────
const PASOS = [
  { label: 'Cliente',   short: '1' },
  { label: 'Mascota',   short: '2' },
  { label: 'Plan',      short: '3' },
  { label: 'Recogida',  short: '4' },
  { label: 'Confirmar', short: '5' },
]

const TIPOS_ACOMP = [
  { value: 'PRESENCIAL',   label: 'Presencial' },
  { value: 'VIDEOLLAMADA', label: 'Videollamada' },
  { value: 'EVIDENCIA',    label: 'Evidencia (fotos/video)' },
]

// Ciudades con recargo de transporte (en pesos COP)
// { MOTO, CAMIONETA } — Bogotá = sin recargo
const CIUDADES = [
  { value: 'Bogotá',      label: 'Bogotá (sin recargo)',  recargo: { MOTO: 0,     CAMIONETA: 0     } },
  { value: 'Soacha',      label: 'Soacha',                recargo: { MOTO: 12000, CAMIONETA: 20000 } },
  { value: 'Chía',        label: 'Chía',                  recargo: { MOTO: 18000, CAMIONETA: 30000 } },
  { value: 'Cajicá',      label: 'Cajicá',                recargo: { MOTO: 20000, CAMIONETA: 35000 } },
  { value: 'Zipaquirá',   label: 'Zipaquirá',             recargo: { MOTO: 28000, CAMIONETA: 45000 } },
  { value: 'Facatativá',  label: 'Facatativá',            recargo: { MOTO: 28000, CAMIONETA: 45000 } },
  { value: 'La Calera',   label: 'La Calera',             recargo: { MOTO: 22000, CAMIONETA: 35000 } },
  { value: 'Sopó',        label: 'Sopó',                  recargo: { MOTO: 22000, CAMIONETA: 35000 } },
  { value: 'Madrid',      label: 'Madrid',                recargo: { MOTO: 22000, CAMIONETA: 35000 } },
  { value: 'Mosquera',    label: 'Mosquera',              recargo: { MOTO: 22000, CAMIONETA: 35000 } },
  { value: 'Funza',       label: 'Funza',                 recargo: { MOTO: 22000, CAMIONETA: 35000 } },
  { value: 'Tabio',       label: 'Tabio',                 recargo: { MOTO: 30000, CAMIONETA: 50000 } },
  { value: 'Otro',        label: 'Otro municipio',        recargo: { MOTO: 40000, CAMIONETA: 60000 } },
]

const LABEL = 'text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1'
const CARD  = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-6'
const SUB   = 'text-[13px] font-semibold text-gray-700 mb-3'
const SELECTED_CARD = 'bg-green-50 border border-green-200 rounded-xl p-4'

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ nombre, apellido, size = 8 }) {
  return (
    <div className={`w-${size} h-${size} rounded-full bg-[#3D5A27] flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0`}>
      {initials(nombre, apellido)}
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ paso, setPaso }) {
  return (
    <div className="flex items-start mb-8">
      {PASOS.map((p, i) => (
        <div key={i} className="flex items-center flex-1 min-w-0">
          <div className="flex flex-col items-center gap-1">
            <button
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold border-2 transition-all ${
                i < paso
                  ? 'bg-[#3D5A27] text-white border-[#3D5A27] cursor-pointer'
                  : i === paso
                  ? 'border-[#3D5A27] text-[#3D5A27] bg-white cursor-default'
                  : 'border-gray-200 text-gray-400 bg-white cursor-default'
              }`}
              onClick={() => i < paso && setPaso(i)}
              disabled={i >= paso}
            >
              {i < paso ? <CheckCircle size={14} /> : i + 1}
            </button>
            <span className={`text-[10px] font-semibold hidden sm:block whitespace-nowrap ${
              i === paso ? 'text-[#3D5A27]' : i < paso ? 'text-gray-500' : 'text-gray-300'
            }`}>{p.label}</span>
          </div>
          {i < PASOS.length - 1 && (
            <div className="flex-1 h-0.5 mx-1 mb-4"
              style={{ background: i < paso ? '#3D5A27' : '#e5e7eb' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="animate-spin text-[#3D5A27]" />
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Registro() {
  const navigate = useNavigate()
  const [paso, setPaso]       = useState(0)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(false)
  const [iaOpen, setIaOpen]       = useState(false)
  const [iaDatos, setIaDatos]     = useState(false) // true = IA ya aplicó datos

  function aplicarDatosIA(d) {
    if (!d) return
    // Pre-llena cliente
    setFormCliente(prev => ({
      ...prev,
      nombre:    d.cliente_nombre    || prev.nombre,
      apellido:  d.cliente_apellido  || prev.apellido,
      whatsapp:  d.cliente_whatsapp  || prev.whatsapp,
      telefono:  d.cliente_telefono  || prev.telefono,
      email:     d.cliente_email     || prev.email,
      direccion: d.cliente_direccion || prev.direccion,
      barrio:    d.cliente_barrio    || prev.barrio,
      ciudad:    d.cliente_ciudad    || prev.ciudad,
    }))
    // Pre-llena mascota
    setFormMascota(prev => ({
      ...prev,
      nombre:     d.mascota_nombre  || prev.nombre,
      especie_id: ESPECIE_NOMBRE_A_ID[d.mascota_especie] ?? prev.especie_id,
      sexo:       d.mascota_sexo    || prev.sexo,
      peso_kg:    d.mascota_peso_kg != null ? String(d.mascota_peso_kg) : prev.peso_kg,
      tamano:     d.mascota_tamano  || prev.tamano,
      raza:       d.mascota_raza    || prev.raza,
      notas:      d.mascota_notas   || prev.notas,
    }))
    // Pre-llena recogida
    setFormRecogida(prev => ({
      ...prev,
      direccion_recogida: d.recogida_direccion || d.cliente_direccion || prev.direccion_recogida,
      barrio_recogida:    d.recogida_barrio    || d.cliente_barrio    || prev.barrio_recogida,
      ciudad_recogida:    d.recogida_ciudad    || d.cliente_ciudad    || prev.ciudad_recogida,
      hora_aproximada:    d.recogida_hora      || prev.hora_aproximada,
      notas:              d.recogida_notas     || prev.notas,
    }))
    // Activa modo "nuevo" para que el formulario pre-llenado sea visible
    setClienteNuevo(true)
    if (d.mascota_nombre || d.mascota_especie) setMascotaNueva(true)
    setIaDatos(true)
  }

  // catálogos
  const [especies, setEspecies]           = useState([])
  const [planes, setPlanes]               = useState([])
  const [aliados, setAliados]             = useState([])
  const [personal, setPersonal]           = useState([])
  const [recordatoriosAdic, setRecordatoriosAdic] = useState([])

  // paso 0: cliente
  const [clienteBusqueda, setClienteBusqueda]           = useState('')
  const [clienteResultados, setClienteResultados]       = useState([])
  const [clienteSeleccionado, setClienteSeleccionado]   = useState(null)
  const [clienteNuevo, setClienteNuevo]                 = useState(false)
  const [buscandoCliente, setBuscandoCliente]           = useState(false)
  const [formCliente, setFormCliente] = useState({
    nombre: '', apellido: '', cedula_nit: '', whatsapp: '',
    telefono: '', email: '', direccion: '', barrio: '',
    localidad: '', ciudad: 'Bogotá', tipo_cliente: 'NORMAL',
  })

  // paso 1: mascota
  const [mascotasCliente, setMascotasCliente]           = useState([])
  const [mascotaSeleccionada, setMascotaSeleccionada]   = useState(null)
  const [mascotaNueva, setMascotaNueva]                 = useState(false)
  const [pesoKgOverride, setPesoKgOverride]             = useState('')
  const [formMascota, setFormMascota] = useState({
    nombre: '', especie_id: '', raza: '', sexo: 'Macho',
    peso_kg: '', tamano: 'Mediano', notas: '',
  })

  // paso 2: plan
  const [planSeleccionado, setPlanSeleccionado]     = useState(null)
  const [preciosPorPlan, setPreciosPorPlan]         = useState({})
  const [precioSeleccionado, setPrecioSeleccionado] = useState(null)
  const [cargandoPrecios, setCargandoPrecios]       = useState(false)
  const [tipoAcomp, setTipoAcomp]                   = useState('EVIDENCIA')
  const [canalEntrada, setCanalEntrada]             = useState('DIRECTO')
  const [aliadoBusqueda, setAliadoBusqueda]         = useState('')
  const [aliadoSeleccionado, setAliadoSeleccionado] = useState(null)
  const [aliadoOpen, setAliadoOpen]                 = useState(false)
  const [adicionales, setAdicionales]               = useState([])
  const [adicionalBusqueda, setAdicionalBusqueda]   = useState('')
  const [comisionPorcentaje, setComisionPorcentaje] = useState(0)
  const [desamparadoPrioridad, setDesamparadoPrioridad] = useState(false)

  // paso 3: recogida + pago
  const [formRecogida, setFormRecogida] = useState({
    tipo_lugar:                'DOMICILIO',
    direccion_recogida:        '',
    ciudad_recogida:           'Bogotá',
    barrio_recogida:           '',
    nombre_contacto_recogida:  '',
    telefono_contacto_recogida:'',
    hora_aproximada:           '',
    estado_pago:               'PENDIENTE',
    metodo_pago:               '',
    valor_pagado:              '',
    notas:                     '',
  })
  const [vehiculoTipo, setVehiculoTipo]             = useState('MOTO')
  const [autoFilledRecogida, setAutoFilledRecogida] = useState(false)
  const [tecnicoBusqueda, setTecnicoBusqueda]       = useState('')
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState(null)
  const [tecnicoOpen, setTecnicoOpen]               = useState(false)

  // refs
  const debounceRef    = useRef(null)
  const aliadoRef      = useRef(null)
  const tecnicoRef     = useRef(null)
  const formClienteRef = useRef(formCliente)
  const clienteNuevoRef = useRef(clienteNuevo)
  useEffect(() => { formClienteRef.current = formCliente }, [formCliente])
  useEffect(() => { clienteNuevoRef.current = clienteNuevo }, [clienteNuevo])

  // ── computed ──
  const pesoKg = parseFloat(pesoKgOverride || mascotaSeleccionada?.peso_kg || formMascota.peso_kg) || 0
  // especie_id: int desde mascota existente o del form nuevo (select usa e.id → string → parseInt)
  const especieId = mascotaSeleccionada
    ? mascotaSeleccionada.especie_id
    : (parseInt(formMascota.especie_id) || null)
  const valorBase        = precioSeleccionado || 0
  // adicionales: cantidad × precio_base (precio fijo de DB, no editable)
  const valorAdicionales = adicionales.reduce((s, a) => s + ((a.precio_base || 0) * (a.cantidad || 1)), 0)
  const valorBruto       = valorBase + valorAdicionales
  const ciudadInfo       = CIUDADES.find(c => c.value === formRecogida.ciudad_recogida)
  const recargoCiudad    = ciudadInfo && ciudadInfo.value !== 'Bogotá'
    ? (ciudadInfo.recargo?.[vehiculoTipo] || 0) : 0
  const modalidadComision  = aliadoSeleccionado?.modalidad_comision
  // La comisión siempre reduce el valor del servicio cuando hay aliado en clínica
  // La modalidad solo afecta CÓMO se registra/cobra la comisión después
  const comisionCalculada  = comisionPorcentaje > 0
    ? Math.round(valorBase * comisionPorcentaje / 100) : 0
  const aplicaDescuento    = !!aliadoSeleccionado &&
    formRecogida.tipo_lugar === 'CLINICA_ALIADA' && comisionCalculada > 0
  const comisionMonto      = aplicaDescuento ? comisionCalculada : 0
  const recargoPrioridad  = planSeleccionado?.codigo === 'DESAMPARADO' && desamparadoPrioridad ? 16000 : 0
  const valorCobrado      = valorBruto - comisionMonto + recargoCiudad + recargoPrioridad

  // ── cargar catálogos ──
  useEffect(() => { cargarCatalogos() }, [])

  async function cargarCatalogos() {
    const [{ data: esp }, { data: pls }, { data: als }, { data: per }, { data: rec }] =
      await Promise.all([
        db.from('especies').select('*').order('nombre'),
        db.from('planes').select('*')
          .not('codigo', 'in', '(BRONCE,PLATA,ORO_EXCLUSIVO,DIAMANTE,VITALICIO)')
          .order('nombre'),
        db.from('aliados').select('*').eq('activo', true).order('nombre'),
        db.from('personal').select('*').eq('activo', true).order('nombre'),
        db.from('recordatorios').select('id,nombre,precio_base,categoria').eq('activo', true).order('nombre'),
      ])
    setEspecies(esp || [])
    setPlanes(pls || [])
    setAliados(als || [])
    setPersonal(per || [])
    setRecordatoriosAdic(rec || [])
  }

  // ── búsqueda cliente debounced ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!clienteBusqueda.trim()) { setClienteResultados([]); return }
    debounceRef.current = setTimeout(() => buscarCliente(clienteBusqueda.trim()), 350)
    return () => clearTimeout(debounceRef.current)
  }, [clienteBusqueda])

  async function buscarCliente(q) {
    setBuscandoCliente(true)
    try {
      const { data } = await db.from('clientes')
        .select('*, mascotas(id_mascota)')
        .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,cedula_nit.ilike.%${q}%,whatsapp.ilike.%${q}%`)
        .limit(10)
      setClienteResultados(data || [])
    } finally { setBuscandoCliente(false) }
  }

  async function seleccionarCliente(c) {
    setClienteSeleccionado(c)
    setClienteResultados([])
    setClienteBusqueda('')
    const { data } = await db.from('mascotas')
      .select('*, especies(nombre)')
      .eq('cliente_id', c.id_cliente)
    setMascotasCliente(data || [])
  }

  // ── cargar precios por especie + peso ──
  // FELINO (id=2) usa el rango 'FELINO'; demás especies usan rangos por kg.
  // PETIT (< 1 kg) aplica a todas las especies.
  async function cargarPreciosTodosPlanes(peso, especieIdActual) {
    const pesoG   = Math.round(peso * 1000)
    const esGato  = especieIdActual === 2
    setCargandoPrecios(true)
    try {
      let q = db.from('planes_precios').select('plan_id,precio,rango_nombre')
      if (pesoG < 1000) {
        // < 1 kg: todos los animales → PETIT
        q = q.eq('rango_nombre', 'PETIT')
      } else if (esGato) {
        // Gato >= 1 kg → FELINO
        q = q.eq('rango_nombre', 'FELINO')
      } else {
        // Perros y otras especies >= 1 kg → rangos por peso (excluye FELINO)
        q = q
          .lte('peso_min_gr', pesoG)
          .gte('peso_max_gr', pesoG)
          .neq('rango_nombre', 'FELINO')
      }
      const { data } = await q
      const map = {}
      ;(data || []).forEach(p => { map[p.plan_id] = p.precio })

      // ── Fallback de precios para planes sin entradas en planes_precios ────────
      const planByCode = {}
      planes.forEach(p => { planByCode[p.codigo] = p })

      // Plan Ángel
      const angelP = planByCode['ANGEL']
      if (angelP && map[angelP.id] === undefined) {
        if (pesoG < 1000)        map[angelP.id] = 69000
        else if (esGato)         map[angelP.id] = 79000
        else if (pesoG <= 10000) map[angelP.id] = 89000
        else if (pesoG <= 20000) map[angelP.id] = 119000
        else if (pesoG <= 35000) map[angelP.id] = 139000
        else                     map[angelP.id] = 189000
      }

      // Básico sin recordatorios = Básico × 80 %
      const basicoSinRecP = planByCode['BASICO_SIN_REC']
      const basicoP       = planByCode['BASICO']
      if (basicoSinRecP && basicoP && map[basicoSinRecP.id] === undefined && map[basicoP.id] !== undefined) {
        map[basicoSinRecP.id] = Math.round(map[basicoP.id] * 0.8)
      }

      // Desamparado: ≤10 kg → $46 000 fijo, >10 kg → $44 000 + $4 000/kg extra
      const desamparadoP = planByCode['DESAMPARADO']
      if (desamparadoP && map[desamparadoP.id] === undefined) {
        if (pesoG <= 10000) {
          map[desamparadoP.id] = 46000
        } else {
          const kgExtra = Math.max(0, pesoKg - 10)
          map[desamparadoP.id] = Math.round(44000 + kgExtra * 4000)
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      setPreciosPorPlan(map)
      return map
    } finally { setCargandoPrecios(false) }
  }

  useEffect(() => {
    if (paso === 2 && pesoKg > 0) {
      cargarPreciosTodosPlanes(pesoKg, especieId).then(map => {
        if (planSeleccionado && map[planSeleccionado.id] !== undefined) {
          setPrecioSeleccionado(map[planSeleccionado.id])
        }
      })
    } else if (paso === 2 && pesoKg <= 0) {
      setPreciosPorPlan({})
      setPrecioSeleccionado(null)
    }
  }, [paso, pesoKg, especieId])

  // sincronizar precio cuando cambia el plan
  useEffect(() => {
    if (planSeleccionado && preciosPorPlan[planSeleccionado.id] !== undefined) {
      setPrecioSeleccionado(preciosPorPlan[planSeleccionado.id])
    } else if (planSeleccionado) {
      setPrecioSeleccionado(null)
    }
  }, [planSeleccionado, preciosPorPlan])

  // ── comisión: plan + volumen mensual del aliado ──
  useEffect(() => {
    if (!aliadoSeleccionado || !planSeleccionado) { setComisionPorcentaje(0); return }
    async function calcularComision() {
      // 1. Contar servicios de este aliado en el mes actual
      const hoy = new Date()
      const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
      const { count } = await db.from('servicios')
        .select('*', { count: 'exact', head: true })
        .eq('aliado_origen_id', aliadoSeleccionado.id_aliado)
        .gte('fecha_ingreso', inicioMes)
      const serviciosMes = count || 0
      // 2. Traer todas las comisiones del aliado y filtrar en JS (evita problemas con OR doble en PostgREST)
      const { data: filas } = await db.from('config_comisiones')
        .select('porcentaje, plan_id, rango_min, rango_max')
        .eq('es_vip', aliadoSeleccionado.vip || false)
      const esVip = aliadoSeleccionado.vip || false
      const match = (filas || [])
        .filter(c =>
          (c.plan_id === planSeleccionado.id || c.plan_id === null) &&
          c.rango_min <= serviciosMes &&
          (c.rango_max === null || c.rango_max >= serviciosMes)
        )
        // plan específico primero, luego genérico (plan_id NULL), dentro de cada grupo el rango más alto
        .sort((a, b) => {
          if (a.plan_id && !b.plan_id) return -1
          if (!a.plan_id && b.plan_id) return 1
          return b.rango_min - a.rango_min
        })[0]
      setComisionPorcentaje(parseFloat(match?.porcentaje) || 0)
    }
    calcularComision()
  }, [aliadoSeleccionado, planSeleccionado])

  // ── auto-fill recogida ──
  useEffect(() => {
    const { tipo_lugar } = formRecogida
    if (tipo_lugar === 'DOMICILIO') {
      const cli = clienteSeleccionado
      const fCli = formClienteRef.current
      const isNuevo = clienteNuevoRef.current
      if (cli) {
        setFormRecogida(prev => ({
          ...prev,
          direccion_recogida:         cli.direccion || prev.direccion_recogida,
          ciudad_recogida:            cli.ciudad    || prev.ciudad_recogida,
          barrio_recogida:            prev.barrio_recogida,
          nombre_contacto_recogida:   `${cli.nombre} ${cli.apellido}`,
          telefono_contacto_recogida: cli.whatsapp || cli.telefono || prev.telefono_contacto_recogida,
        }))
        setAutoFilledRecogida(true)
      } else if (isNuevo && fCli.nombre) {
        setFormRecogida(prev => ({
          ...prev,
          direccion_recogida:         fCli.direccion || prev.direccion_recogida,
          ciudad_recogida:            fCli.ciudad    || prev.ciudad_recogida,
          nombre_contacto_recogida:   `${fCli.nombre} ${fCli.apellido}`.trim() || prev.nombre_contacto_recogida,
          telefono_contacto_recogida: fCli.whatsapp || fCli.telefono || prev.telefono_contacto_recogida,
        }))
        setAutoFilledRecogida(true)
      } else {
        setAutoFilledRecogida(false)
      }
    } else if (tipo_lugar === 'CLINICA_ALIADA' && aliadoSeleccionado) {
      const a = aliadoSeleccionado
      setFormRecogida(prev => ({
        ...prev,
        direccion_recogida:         a.direccion       || prev.direccion_recogida,
        ciudad_recogida:            a.ciudad          || prev.ciudad_recogida,
        barrio_recogida:            a.barrio          || prev.barrio_recogida,
        nombre_contacto_recogida:   a.contacto_nombre || prev.nombre_contacto_recogida,
        telefono_contacto_recogida: a.telefono        || a.whatsapp || prev.telefono_contacto_recogida,
      }))
      setAutoFilledRecogida(true)
    } else {
      setAutoFilledRecogida(false)
    }
  }, [paso, formRecogida.tipo_lugar, clienteSeleccionado, aliadoSeleccionado])

  // ── cerrar dropdowns al click afuera ──
  useEffect(() => {
    function h(e) {
      if (aliadoRef.current  && !aliadoRef.current.contains(e.target))  setAliadoOpen(false)
      if (tecnicoRef.current && !tecnicoRef.current.contains(e.target)) setTecnicoOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── adicionales helpers ──
  function addAdicional(rec) {
    if (adicionales.find(a => a.id === rec.id)) return
    setAdicionales(prev => [...prev, {
      id:          rec.id,
      nombre:      rec.nombre,
      precio_base: rec.precio_base || 0,
      cantidad:    1,
    }])
    // No limpiamos la búsqueda para que el usuario pueda seguir agregando
  }
  function removeAdicional(id) { setAdicionales(prev => prev.filter(a => a.id !== id)) }
  function updateAdicionalCantidad(id, val) {
    const c = Math.max(1, parseInt(val) || 1)
    setAdicionales(prev => prev.map(a => a.id === id ? { ...a, cantidad: c } : a))
  }

  // ── selectores aliado / técnico ──
  function selectAliado(a) {
    setAliadoSeleccionado(a)
    setCanalEntrada('ALIADO')
    setAliadoBusqueda('')
    setAliadoOpen(false)
    // Siempre marcar CLINICA_ALIADA al seleccionar cualquier aliado
    setFormRecogida(prev => ({ ...prev, tipo_lugar: 'CLINICA_ALIADA' }))
  }
  function clearAliado() {
    setAliadoSeleccionado(null)
    setAliadoBusqueda('')
    if (canalEntrada === 'ALIADO') setCanalEntrada('DIRECTO')
  }

  // ── filtros ──
  const aliadosFiltrados = aliados.filter(a => {
    const q = aliadoBusqueda.toLowerCase()
    return (
      (a.nombre              || '').toLowerCase().includes(q) ||
      (a.identificacion_nit  || '').toLowerCase().includes(q) ||
      (a.telefono            || '').includes(q) ||
      (a.whatsapp            || '').includes(q)
    )
  })
  const tecnicosFiltrados = personal.filter(p => {
    const q = tecnicoBusqueda.toLowerCase()
    return (p.nombre || '').toLowerCase().includes(q) ||
           (p.apellido || '').toLowerCase().includes(q) ||
           (p.cedula || '').toLowerCase().includes(q)
  })
  const recordatoriosFiltrados = recordatoriosAdic.filter(r =>
    r.nombre.toLowerCase().includes(adicionalBusqueda.toLowerCase()) &&
    !adicionales.find(a => a.id === r.id)
  )

  // ── guardar ──
  async function guardar() {
    if (!tecnicoSeleccionado) {
      const ok = window.confirm('No asignaste un técnico de recogida.\n¿Deseas guardar el servicio sin técnico asignado?')
      if (!ok) return
    }
    setSaving(true)
    setError(null)
    try {
      let clienteId = clienteSeleccionado?.id_cliente

      if (clienteNuevo) {
        const notasCliente = [
          formCliente.barrio    ? `Barrio: ${formCliente.barrio}`       : '',
          formCliente.localidad ? `Localidad: ${formCliente.localidad}` : '',
        ].filter(Boolean).join('. ') || null
        const { data, error: err } = await db.from('clientes').insert({
          nombre:       formCliente.nombre,
          apellido:     formCliente.apellido,
          cedula_nit:   formCliente.cedula_nit  || null,
          whatsapp:     formCliente.whatsapp,
          telefono:     formCliente.telefono    || null,
          email:        formCliente.email       || null,
          direccion:    formCliente.direccion   || null,
          ciudad:       formCliente.ciudad      || 'Bogotá',
          tipo_cliente: formCliente.tipo_cliente,
          notas:        notasCliente,
        }).select()
        if (err) throw err
        if (!data || data.length === 0) throw new Error('No se pudo crear el cliente')
        clienteId = data[0].id_cliente
      }

      // actualizar dirección cliente si cambió en DOMICILIO
      if (
        clienteSeleccionado && formRecogida.tipo_lugar === 'DOMICILIO' &&
        formRecogida.direccion_recogida &&
        formRecogida.direccion_recogida !== clienteSeleccionado.direccion
      ) {
        await db.from('clientes').update({
          direccion: formRecogida.direccion_recogida,
          ciudad:    formRecogida.ciudad_recogida,
        }).eq('id_cliente', clienteId)
      }

      let mascotaId = mascotaSeleccionada?.id_mascota

      if (mascotaNueva) {
        const { data, error: err } = await db.from('mascotas').insert({
          nombre:              formMascota.nombre,
          especie_id:          parseInt(formMascota.especie_id) || null,
          raza:                formMascota.raza       || null,
          sexo:                formMascota.sexo,
          tamano:              formMascota.tamano,
          notas:               formMascota.notas      || null,
          cliente_id:          clienteId,
          fallecida:           true,
          fecha_fallecimiento: today(),
          peso_kg:             parseFloat(formMascota.peso_kg) || 0,
        }).select()
        if (err) throw err
        if (!data || data.length === 0) throw new Error('No se pudo crear la mascota')
        mascotaId = data[0].id_mascota
      } else if (mascotaSeleccionada && pesoKgOverride &&
        parseFloat(pesoKgOverride) !== parseFloat(mascotaSeleccionada.peso_kg)) {
        // actualizar peso si fue corregido
        await db.from('mascotas').update({ peso_kg: parseFloat(pesoKgOverride) })
          .eq('id_mascota', mascotaId)
      }

      let notasFinales = formRecogida.notas || ''
      if (desamparadoPrioridad)
        notasFinales = `Recogida prioritaria (<16h) +${fmt(16000)}. ${notasFinales}`.trim()
      if (formRecogida.hora_aproximada)
        notasFinales = `Hora aprox. recogida: ${formRecogida.hora_aproximada}. ${notasFinales}`.trim()
      if (recargoCiudad > 0)
        notasFinales = `${notasFinales} Recargo transporte ${vehiculoTipo.toLowerCase()} ${formRecogida.ciudad_recogida}: ${fmt(recargoCiudad)}.`.trim()

      const { data: svcData, error: svcErr } = await db.from('servicios').insert({
        mascota_id:           mascotaId,
        plan_id:              planSeleccionado.id,
        estado:               'INGRESADO',
        fecha_ingreso:        today(),
        tipo_acompanamiento:  tipoAcomp,
        canal_entrada:        canalEntrada,
        aliado_origen_id:     aliadoSeleccionado?.id_aliado || null,
        valor_total:          valorCobrado,
        valor_pagado:         parseFloat(formRecogida.valor_pagado) || 0,
        estado_pago:          formRecogida.estado_pago,
        metodo_pago:          formRecogida.metodo_pago || null,
        punto_recogida:       formRecogida.tipo_lugar,
        direccion_recogida:   formRecogida.direccion_recogida,
        ciudad_recogida:      formRecogida.ciudad_recogida,
        barrio_recogida:      formRecogida.barrio_recogida || null,
        indicaciones_recogida: formRecogida.notas || null,
        tecnico_id:           tecnicoSeleccionado?.id || null,
        notas:                notasFinales || null,
        tipo_cliente:         clienteSeleccionado?.tipo_cliente || formCliente.tipo_cliente || 'NORMAL',
        comision_aliado:      comisionCalculada || 0,
        comision_descontada:  aplicaDescuento,
      }).select('id')
      if (svcErr) throw svcErr

      // El trigger crea la recogida automáticamente; actualizamos el contacto
      if (svcData?.[0]?.id) {
        await db.from('recogidas').update({
          contacto_nombre:    formRecogida.nombre_contacto_recogida || null,
          contacto_telefono:  formRecogida.telefono_contacto_recogida || null,
          aliado_id:          aliadoSeleccionado?.id_aliado || null,
          tecnico_id:         tecnicoSeleccionado?.id || null,
        }).eq('servicio_id', svcData[0].id)
      }

      setSuccess(true)
      setTimeout(() => navigate('/kanban'), 2000)
    } catch (e) {
      setError(e.message || 'Error al guardar el servicio')
    } finally {
      setSaving(false)
    }
  }

  const canNext = [
    () => clienteSeleccionado !== null || (clienteNuevo && !!formCliente.nombre && !!formCliente.whatsapp),
    () => mascotaSeleccionada !== null || (mascotaNueva && !!formMascota.nombre && !!formMascota.peso_kg),
    () => planSeleccionado !== null,
    () => true,
  ]

  // ─── SUCCESS ──────────────────────────────────────────────────────────────
  if (success) return (
    <div>
      <Topbar />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-8">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
          <CheckCircle size={44} className="text-green-600" />
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900 mb-1">Servicio registrado</div>
          <div className="text-sm text-gray-500">Redirigiendo al tablero...</div>
        </div>
      </div>
    </div>
  )

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Botón IA — visible solo en paso 0 */}
        {paso === 0 && (
          <button
            onClick={() => setIaOpen(true)}
            className="w-full flex items-center justify-center gap-2 mb-4 py-3 px-4 rounded-xl font-semibold text-[13px] transition-all hover:opacity-90 active:scale-98"
            style={{ background: 'linear-gradient(135deg, #263218 0%, #3D5A27 100%)', color: '#C4A87A' }}
          >
            <Sparkles size={15} />
            Cargar con IA — foto o mensaje WhatsApp
          </button>
        )}

        <Stepper paso={paso} setPaso={setPaso} />

        {iaDatos && (
          <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl text-[13px] font-medium"
            style={{ background: '#F0FDF4', border: '1px solid #86EFAC', color: '#15803D' }}>
            <Sparkles size={14} />
            Datos extraídos por IA — revisa y corrige cada paso antes de confirmar
            <button onClick={() => setIaDatos(false)} className="ml-auto opacity-50 hover:opacity-100">
              <X size={13} />
            </button>
          </div>
        )}

        {error && <Alert variant="error" className="mb-4">{error}</Alert>}

        {/* ══════ PASO 0: CLIENTE ══════ */}
        {paso === 0 && (
          <div className={CARD}>
            <div className="text-lg font-bold text-gray-900 mb-5">Seleccionar cliente</div>

            {!clienteSeleccionado && !clienteNuevo && (
              <>
                <div className="relative mb-3">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    {buscandoCliente ? <Spinner size={14} /> : <Search size={14} className="text-gray-400" />}
                  </div>
                  <Input className="pl-9" placeholder="Buscar por nombre, cédula o WhatsApp..."
                    value={clienteBusqueda} onChange={e => setClienteBusqueda(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && clienteBusqueda.trim() && buscarCliente(clienteBusqueda.trim())} />
                </div>
                {clienteResultados.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {clienteResultados.map(c => (
                      <button key={c.id_cliente}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#3D5A27]/30 hover:bg-green-50 transition-all text-left"
                        onClick={() => seleccionarCliente(c)}>
                        <Avatar nombre={c.nombre} apellido={c.apellido} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-gray-900 truncate">{c.nombre} {c.apellido}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {c.cedula_nit && <span>{c.cedula_nit} · </span>}{c.whatsapp}
                            {c.mascotas && <span className="ml-2 text-[#3D5A27] font-semibold">{c.mascotas.length} mascota{c.mascotas.length !== 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {clienteBusqueda && !buscandoCliente && clienteResultados.length === 0 && (
                  <p className="text-[12px] text-gray-400 mb-3 text-center py-2">No se encontraron clientes</p>
                )}
                <button
                  className="w-full mt-1 py-3 text-[12px] font-semibold text-[#3D5A27] border-2 border-dashed border-green-200 rounded-xl hover:bg-green-50 transition-all flex items-center justify-center gap-2"
                  onClick={() => setClienteNuevo(true)}>
                  <User size={14} /> Crear nuevo cliente
                </button>
              </>
            )}

            {clienteSeleccionado && (
              <div className={SELECTED_CARD}>
                <div className="flex items-center gap-3">
                  <Avatar nombre={clienteSeleccionado.nombre} apellido={clienteSeleccionado.apellido} size={10} />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{clienteSeleccionado.nombre} {clienteSeleccionado.apellido}</div>
                    <div className="text-[12px] text-gray-500">
                      {clienteSeleccionado.whatsapp}
                      {clienteSeleccionado.cedula_nit && ` · ${clienteSeleccionado.cedula_nit}`}
                    </div>
                  </div>
                  <button className="text-[11px] text-red-500 hover:text-red-700 font-semibold"
                    onClick={() => { setClienteSeleccionado(null); setMascotasCliente([]) }}>Cambiar</button>
                </div>
              </div>
            )}

            {clienteNuevo && (
              <div>
                <div className={`${SUB} mb-4`}>Datos del nuevo cliente</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={LABEL}>Nombre *</label>
                    <Input value={formCliente.nombre} onChange={e => setFormCliente(p => ({ ...p, nombre: e.target.value }))} /></div>
                  <div><label className={LABEL}>Apellido *</label>
                    <Input value={formCliente.apellido} onChange={e => setFormCliente(p => ({ ...p, apellido: e.target.value }))} /></div>
                  <div><label className={LABEL}>Cédula / NIT</label>
                    <Input value={formCliente.cedula_nit} onChange={e => setFormCliente(p => ({ ...p, cedula_nit: e.target.value }))} /></div>
                  <div><label className={LABEL}>WhatsApp *</label>
                    <Input value={formCliente.whatsapp} placeholder="3001234567"
                      onChange={e => setFormCliente(p => ({ ...p, whatsapp: e.target.value }))} /></div>
                  <div><label className={LABEL}>Teléfono</label>
                    <Input value={formCliente.telefono} onChange={e => setFormCliente(p => ({ ...p, telefono: e.target.value }))} /></div>
                  <div><label className={LABEL}>Email</label>
                    <Input value={formCliente.email} type="email" onChange={e => setFormCliente(p => ({ ...p, email: e.target.value }))} /></div>
                  <div><label className={LABEL}>Ciudad</label>
                    <Select value={formCliente.ciudad} onChange={e => setFormCliente(p => ({ ...p, ciudad: e.target.value }))}>
                      {CIUDADES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select></div>
                  <div><label className={LABEL}>Tipo cliente</label>
                    <Select value={formCliente.tipo_cliente} onChange={e => setFormCliente(p => ({ ...p, tipo_cliente: e.target.value }))}>
                      <option value="NORMAL">Normal</option>
                      <option value="VIP">VIP</option>
                      <option value="RECURRENTE">Recurrente</option>
                    </Select></div>
                  <div className="sm:col-span-2"><label className={LABEL}>Dirección</label>
                    <Input value={formCliente.direccion} onChange={e => setFormCliente(p => ({ ...p, direccion: e.target.value }))} /></div>
                  <div><label className={LABEL}>Barrio</label>
                    <Input value={formCliente.barrio} placeholder="Ej: Chapinero Alto"
                      onChange={e => setFormCliente(p => ({ ...p, barrio: e.target.value }))} /></div>
                  <div><label className={LABEL}>Localidad / Municipio</label>
                    <Input value={formCliente.localidad} placeholder="Ej: Chapinero"
                      onChange={e => setFormCliente(p => ({ ...p, localidad: e.target.value }))} /></div>
                </div>
                <button className="text-[11px] text-red-500 hover:text-red-700 mt-3 font-semibold"
                  onClick={() => setClienteNuevo(false)}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        {/* ══════ PASO 1: MASCOTA ══════ */}
        {paso === 1 && (
          <div className={CARD}>
            <div className="text-lg font-bold text-gray-900 mb-5">Seleccionar mascota</div>

            {!mascotaSeleccionada && !mascotaNueva && (
              <>
                {mascotasCliente.length > 0 && (
                  <div className="mb-4">
                    <div className={`${SUB} mb-3`}>Mascotas del cliente</div>
                    {mascotasCliente.map(m => (
                      <button key={m.id_mascota}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#3D5A27]/30 hover:bg-green-50 transition-all text-left mb-2"
                        onClick={() => setMascotaSeleccionada(m)}>
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-lg flex-shrink-0">
                          {petEmoji(m.especies?.nombre)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-gray-900">{m.nombre}</div>
                          <div className="text-[11px] text-gray-500">
                            {m.especies?.nombre}{m.raza && ` · ${m.raza}`}{m.peso_kg && ` · ${m.peso_kg} kg`}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="w-full py-3 text-[12px] font-semibold text-[#3D5A27] border-2 border-dashed border-green-200 rounded-xl hover:bg-green-50 transition-all"
                  onClick={() => setMascotaNueva(true)}>
                  + Registrar nueva mascota
                </button>
              </>
            )}

            {mascotaSeleccionada && (
              <div>
                <div className={`${SELECTED_CARD} mb-4`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-xl flex-shrink-0">
                      {petEmoji(mascotaSeleccionada.especies?.nombre)}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{mascotaSeleccionada.nombre}</div>
                      <div className="text-[12px] text-gray-500">
                        {mascotaSeleccionada.especies?.nombre}{mascotaSeleccionada.raza && ` · ${mascotaSeleccionada.raza}`}
                      </div>
                    </div>
                    <button className="text-[11px] text-red-500 hover:text-red-700 font-semibold"
                      onClick={() => { setMascotaSeleccionada(null); setPesoKgOverride('') }}>Cambiar</button>
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Peso (kg) *</label>
                  <Input type="text" inputMode="decimal"
                    value={pesoKgOverride !== '' ? pesoKgOverride : (mascotaSeleccionada.peso_kg || '')}
                    placeholder="Ej: 28.5"
                    onChange={e => setPesoKgOverride(e.target.value.replace(',', '.'))} />
                  <p className="text-[10px] text-gray-400 mt-1">El peso determina el precio del plan. Corrígelo si es necesario.</p>
                </div>
              </div>
            )}

            {mascotaNueva && (
              <div>
                <div className={`${SUB} mb-4`}>Datos de la mascota</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={LABEL}>Nombre *</label>
                    <Input value={formMascota.nombre} onChange={e => setFormMascota(p => ({ ...p, nombre: e.target.value }))} /></div>
                  <div><label className={LABEL}>Especie</label>
                    <Select value={formMascota.especie_id} onChange={e => setFormMascota(p => ({ ...p, especie_id: e.target.value }))}>
                      <option value="">Seleccionar...</option>
                      {especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </Select></div>
                  <div><label className={LABEL}>Raza</label>
                    <Input value={formMascota.raza} onChange={e => setFormMascota(p => ({ ...p, raza: e.target.value }))} /></div>
                  <div><label className={LABEL}>Peso (kg) *</label>
                    <Input type="text" inputMode="decimal" placeholder="Ej: 28.5" value={formMascota.peso_kg}
                      onChange={e => setFormMascota(p => ({ ...p, peso_kg: e.target.value.replace(',', '.') }))} /></div>
                  <div><label className={LABEL}>Sexo</label>
                    <Select value={formMascota.sexo} onChange={e => setFormMascota(p => ({ ...p, sexo: e.target.value }))}>
                      <option value="Macho">Macho</option>
                      <option value="Hembra">Hembra</option>
                    </Select></div>
                  <div><label className={LABEL}>Tamaño</label>
                    <Select value={formMascota.tamano} onChange={e => setFormMascota(p => ({ ...p, tamano: e.target.value }))}>
                      <option value="Mini">Mini</option>
                      <option value="Pequeño">Pequeño</option>
                      <option value="Mediano">Mediano</option>
                      <option value="Grande">Grande</option>
                      <option value="Gigante">Gigante</option>
                    </Select></div>
                  <div className="sm:col-span-2"><label className={LABEL}>Notas</label>
                    <Textarea value={formMascota.notas} onChange={e => setFormMascota(p => ({ ...p, notas: e.target.value }))} /></div>
                </div>
                <button className="text-[11px] text-red-500 hover:text-red-700 mt-3 font-semibold"
                  onClick={() => setMascotaNueva(false)}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        {/* ══════ PASO 2: PLAN ══════ */}
        {paso === 2 && (
          <div className={CARD}>
            <div className="text-lg font-bold text-gray-900 mb-5">Seleccionar plan</div>

            {pesoKg <= 0 && (
              <Alert variant="warn" className="mb-4">
                El peso de la mascota es necesario para mostrar precios. Vuelve al paso anterior e ingrésalo.
              </Alert>
            )}
            {cargandoPrecios && (
              <div className="flex items-center gap-2 mb-4 text-[12px] text-gray-500">
                <Spinner size={13} /> Cargando precios...
              </div>
            )}

            {/* Tarjetas de planes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {planes.map(p => {
                const precio   = preciosPorPlan[p.id]
                const selected = planSeleccionado?.id === p.id
                return (
                  <button key={p.id}
                    className={`p-4 border-2 rounded-xl text-left transition-all ${
                      selected ? 'border-[#3D5A27] bg-green-50 shadow-sm' : 'border-gray-100 hover:border-[#3D5A27]/40 bg-white'
                    }`}
                    onClick={() => { setPlanSeleccionado(p); setDesamparadoPrioridad(false) }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold text-gray-900">{p.nombre}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{p.tipo_proceso?.replace(/_/g, ' ')}</div>
                      </div>
                      {selected && <CheckCircle size={16} className="text-[#3D5A27] flex-shrink-0 mt-0.5" />}
                    </div>
                    <div className="mt-2">
                      {precio !== undefined ? (
                        <span className="text-[15px] font-bold text-[#3D5A27]">{fmt(precio)}</span>
                      ) : pesoKg > 0 ? (
                        <span className="text-[11px] text-gray-400">Sin precio configurado</span>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">Ingrese peso para ver precio</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Prioridad Desamparado */}
            {planSeleccionado?.codigo === 'DESAMPARADO' && (
              <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-[#3D5A27] flex-shrink-0"
                    checked={desamparadoPrioridad}
                    onChange={e => setDesamparadoPrioridad(e.target.checked)} />
                  <div>
                    <div className="text-[13px] font-semibold text-gray-900">Recogida prioritaria</div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      Recogida en 16 h o menos (sin prioridad: 24-48 h). Recargo adicional: <strong>+{fmt(16000)}</strong>
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* Acompañamiento */}
            {planSeleccionado && needsAcomp(planSeleccionado) && (
              <div className="mb-6">
                <div className={SUB}>Tipo de acompañamiento</div>
                <div className="flex flex-wrap gap-2">
                  {TIPOS_ACOMP.map(t => (
                    <button key={t.value}
                      className={`px-4 py-2 text-[12px] font-semibold rounded-lg border-2 transition-all ${
                        tipoAcomp === t.value
                          ? 'border-[#3D5A27] bg-green-50 text-[#3D5A27]'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                      onClick={() => setTipoAcomp(t.value)}>{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Veterinaria / Aliado — SIEMPRE visible */}
            <div className="mb-6">
              <div className={SUB}>Veterinaria / Aliado (opcional)</div>
              <div ref={aliadoRef} className="relative">
                {aliadoSeleccionado ? (
                  <div className="flex items-center gap-2 px-3 py-2 border border-[#3D5A27] rounded-lg bg-green-50">
                    {aliadoSeleccionado.vip && <Star size={13} className="text-amber-500 flex-shrink-0" />}
                    <span className="text-[13px] font-medium text-gray-900 flex-1">{aliadoSeleccionado.nombre}</span>
                    {comisionPorcentaje > 0 && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
                        {comisionPorcentaje}%
                        {aliadoSeleccionado.modalidad_comision === 'DESCUENTO_INMEDIATO' ? ' desc. inmediato'
                         : aliadoSeleccionado.modalidad_comision === 'CREDITO_ACUMULADO' ? ' crédito'
                         : ' facturación mensual'}
                      </span>
                    )}
                    <button className="text-gray-400 hover:text-red-500" onClick={clearAliado}><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <Input placeholder="Buscar veterinaria o aliado..."
                      value={aliadoBusqueda}
                      onChange={e => { setAliadoBusqueda(e.target.value); setAliadoOpen(true) }}
                      onFocus={() => setAliadoOpen(true)} />
                    {aliadoOpen && aliadosFiltrados.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="max-h-48 overflow-y-auto">
                          {aliadosFiltrados.map(a => (
                            <button key={a.id_aliado}
                              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-green-50 text-left text-[13px]"
                              onMouseDown={e => { e.preventDefault(); selectAliado(a) }}>
                              {a.vip && <Star size={12} className="text-amber-500 flex-shrink-0" />}
                              <span className="font-medium text-gray-900 flex-1">{a.nombre}</span>
                              {a.modalidad_comision === 'DESCUENTO_INMEDIATO' && (
                                <span className="text-[10px] text-amber-600 font-medium">desc. inmediato</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {!aliadoSeleccionado && (
                <p className="text-[10px] text-gray-400 mt-1">Si el servicio viene de una veterinaria aliada, selecciónala aquí para aplicar comisión y recordatorios VIP.</p>
              )}
            </div>

            {/* Canal de entrada */}
            <div className="mb-6">
              <div className={SUB}>Canal de entrada</div>
              <Select value={canalEntrada} onChange={e => setCanalEntrada(e.target.value)}>
                <option value="DIRECTO">Directo</option>
                <option value="ALIADO">Aliado / Veterinaria</option>
                <option value="REFERIDO">Referido</option>
                <option value="REDES_SOCIALES">Redes sociales</option>
                <option value="GOOGLE">Google</option>
              </Select>
            </div>

            {/* Adicionales */}
            <div>
              <div className={SUB}>Adicionales</div>
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-8" placeholder="Buscar adicional (ej: cofre, collar)..."
                  value={adicionalBusqueda} onChange={e => setAdicionalBusqueda(e.target.value)} />
              </div>

              {adicionalBusqueda && (
                <div className="border border-gray-100 rounded-xl overflow-hidden mb-3 max-h-44 overflow-y-auto">
                  {recordatoriosFiltrados.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-gray-400 text-center">Sin resultados</div>
                  ) : (
                    recordatoriosFiltrados.slice(0, 20).map(r => (
                      <button key={r.id}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-green-50 text-left border-b border-gray-50 last:border-0"
                        onClick={() => addAdicional(r)}>
                        <div>
                          <span className="text-[12px] text-gray-800">{r.nombre}</span>
                          {r.precio_base > 0 && (
                            <span className="ml-2 text-[10px] text-[#3D5A27] font-semibold">{fmt(r.precio_base)}</span>
                          )}
                        </div>
                        <span className="text-[11px] text-[#3D5A27] font-semibold flex-shrink-0 ml-2">+ Agregar</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {adicionales.length > 0 && (
                <div className="space-y-2 mb-3">
                  {/* Cabecera */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 pb-1 border-b border-gray-100">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Producto</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase text-right w-20">Precio</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase text-center w-16">Cant.</span>
                    <span className="w-5" />
                  </div>
                  {adicionales.map(a => (
                    <div key={a.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-[12px] text-gray-800 truncate">{a.nombre}</span>
                      <span className="text-[12px] font-semibold text-[#3D5A27] w-20 text-right">{fmt(a.precio_base)}</span>
                      <Input type="number" min="1" className="w-16 text-center"
                        value={a.cantidad}
                        onChange={e => updateAdicionalCantidad(a.id, e.target.value)} />
                      <button className="text-gray-400 hover:text-red-500 w-5" onClick={() => removeAdicional(a.id)}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-1 px-1">
                    <span className="text-[12px] text-gray-500 font-semibold">Subtotal adicionales</span>
                    <span className="text-[13px] font-bold text-gray-700">{fmt(valorAdicionales)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════ PASO 3: RECOGIDA ══════ */}
        {paso === 3 && (
          <div className={CARD}>
            <div className="text-lg font-bold text-gray-900 mb-5">Datos de recogida</div>

            {autoFilledRecogida && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-700 font-semibold">
                <MapPin size={12} /> Datos cargados automáticamente — puedes editarlos
              </div>
            )}

            <div className="space-y-5">
              {/* Tipo lugar */}
              <div>
                <label className={LABEL}>Tipo de lugar</label>
                <Select value={formRecogida.tipo_lugar}
                  onChange={e => {
                    const v = e.target.value
                    if (v === 'OTRO') {
                      setFormRecogida(prev => ({
                        ...prev, tipo_lugar: 'OTRO',
                        direccion_recogida: '', barrio_recogida: '',
                        nombre_contacto_recogida: '', telefono_contacto_recogida: '',
                      }))
                      setAutoFilledRecogida(false)
                    } else {
                      setFormRecogida(prev => ({ ...prev, tipo_lugar: v }))
                    }
                  }}>
                  <option value="DOMICILIO">Domicilio</option>
                  <option value="CLINICA_ALIADA">Clínica / Veterinaria aliada</option>
                  <option value="OTRO">Otro</option>
                </Select>
                {formRecogida.tipo_lugar === 'CLINICA_ALIADA' && !aliadoSeleccionado && (
                  <p className="text-[10px] text-amber-600 mt-1">Recuerda seleccionar la veterinaria aliada en el Paso 3 (Plan) para aplicar la comisión.</p>
                )}
                {formRecogida.tipo_lugar === 'CLINICA_ALIADA' && aliadoSeleccionado && aplicaDescuento && (
                  <div className="mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700 font-semibold">
                    ✓ Descuento de comisión ({comisionPorcentaje}%) aplicado — recogida en clínica aliada
                  </div>
                )}
              </div>

              {/* Ciudad y barrio */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Ciudad / Municipio</label>
                  <Select value={formRecogida.ciudad_recogida}
                    onChange={e => setFormRecogida(p => ({ ...p, ciudad_recogida: e.target.value }))}>
                    {CIUDADES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className={LABEL}>Barrio</label>
                  <Input value={formRecogida.barrio_recogida} placeholder="Barrio o localidad"
                    onChange={e => setFormRecogida(p => ({ ...p, barrio_recogida: e.target.value }))} />
                </div>
              </div>

              {/* Recargo transporte fuera de Bogotá */}
              {formRecogida.ciudad_recogida !== 'Bogotá' && ciudadInfo && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Truck size={14} className="text-amber-600" />
                    <span className="text-[12px] font-bold text-amber-700">Recargo transporte — {formRecogida.ciudad_recogida}</span>
                  </div>
                  <div>
                    <label className={LABEL}>Tipo de vehículo</label>
                    <div className="flex gap-2 mt-1">
                      {['MOTO', 'CAMIONETA'].map(v => (
                        <button key={v}
                          className={`flex-1 py-2 text-[12px] font-semibold rounded-lg border-2 transition-all ${
                            vehiculoTipo === v
                              ? 'border-amber-500 bg-amber-50 text-amber-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                          onClick={() => setVehiculoTipo(v)}>
                          {v === 'MOTO' ? '🏍 Moto' : '🚙 Camioneta'}
                          <span className="ml-1 text-[10px]">+{fmt(ciudadInfo.recargo[v])}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Dirección */}
              <div>
                <label className={LABEL}>Dirección de recogida</label>
                <Input value={formRecogida.direccion_recogida}
                  onChange={e => setFormRecogida(p => ({ ...p, direccion_recogida: e.target.value }))} />
              </div>

              {/* Hora */}
              <div>
                <label className={LABEL}>Hora aproximada</label>
                <Input type="time" value={formRecogida.hora_aproximada}
                  onChange={e => setFormRecogida(p => ({ ...p, hora_aproximada: e.target.value }))} />
                <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                  <Clock size={10} /> La hora exacta la confirma el técnico al aceptar el servicio
                </p>
              </div>

              {/* Contacto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Nombre contacto</label>
                  <Input value={formRecogida.nombre_contacto_recogida} placeholder="Quien entrega la mascota"
                    onChange={e => setFormRecogida(p => ({ ...p, nombre_contacto_recogida: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>Teléfono contacto</label>
                  <Input value={formRecogida.telefono_contacto_recogida}
                    onChange={e => setFormRecogida(p => ({ ...p, telefono_contacto_recogida: e.target.value }))} />
                </div>
              </div>

              {/* Técnico */}
              <div ref={tecnicoRef} className="relative">
                <label className={LABEL}>Técnico asignado</label>
                {tecnicoSeleccionado ? (
                  <div className="flex items-center gap-2 px-3 py-2 border border-[#3D5A27] rounded-lg bg-green-50">
                    <Avatar nombre={tecnicoSeleccionado.nombre} apellido={tecnicoSeleccionado.apellido} size={6} />
                    <span className="text-[13px] font-medium text-gray-900 flex-1">{tecnicoSeleccionado.nombre} {tecnicoSeleccionado.apellido}</span>
                    <button className="text-gray-400 hover:text-red-500"
                      onClick={() => { setTecnicoSeleccionado(null); setTecnicoBusqueda('') }}><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <Input placeholder="Buscar técnico o dejar sin asignar..."
                      value={tecnicoBusqueda}
                      onChange={e => { setTecnicoBusqueda(e.target.value); setTecnicoOpen(true) }}
                      onFocus={() => setTecnicoOpen(true)} />
                    {tecnicoOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="max-h-52 overflow-y-auto">
                          <button className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 text-left border-b border-gray-100"
                            onMouseDown={e => { e.preventDefault(); setTecnicoSeleccionado(null); setTecnicoBusqueda(''); setTecnicoOpen(false) }}>
                            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center"><X size={10} className="text-gray-500" /></div>
                            <span className="text-[12px] text-gray-500 font-medium">Sin asignar</span>
                          </button>
                          {tecnicosFiltrados.map(t => (
                            <button key={t.id}
                              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-green-50 text-left"
                              onMouseDown={e => { e.preventDefault(); setTecnicoSeleccionado(t); setTecnicoBusqueda(''); setTecnicoOpen(false) }}>
                              <Avatar nombre={t.nombre} apellido={t.apellido} size={7} />
                              <div>
                                <div className="text-[13px] font-medium text-gray-900">{t.nombre} {t.apellido}</div>
                                {t.cedula && <div className="text-[10px] text-gray-400">{t.cedula}</div>}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Valor del servicio */}
              <div className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                <div className={`${SUB} flex items-center gap-2`}>
                  <CreditCard size={14} className="text-gray-500" /> Valor del servicio
                </div>
                <div className="space-y-1.5 mb-4">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-gray-500">Plan base</span>
                    <span className="font-medium text-gray-700">{fmt(valorBase)}</span>
                  </div>
                  {valorAdicionales > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-gray-500">Adicionales</span>
                      <span className="font-medium text-gray-700">+ {fmt(valorAdicionales)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[12px] border-t border-gray-200 pt-1.5">
                    <span className="text-gray-600 font-semibold">Subtotal</span>
                    <span className="font-semibold text-gray-800">{fmt(valorBruto)}</span>
                  </div>
                  {aplicaDescuento && comisionMonto > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-amber-600">
                        - Comisión {comisionPorcentaje}% · {aliadoSeleccionado?.nombre} (sobre plan base {fmt(valorBase)})
                      </span>
                      <span className="font-medium text-amber-600">- {fmt(comisionMonto)}</span>
                    </div>
                  )}
                  {recargoCiudad > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-blue-600">+ Recargo transporte ({vehiculoTipo.toLowerCase()})</span>
                      <span className="font-medium text-blue-600">+ {fmt(recargoCiudad)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-1.5">
                    <span className="text-[13px] font-bold text-gray-900">Valor a cobrar</span>
                    <span className="text-[16px] font-bold text-[#3D5A27]">{fmt(valorCobrado)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Valor recibido ahora</label>
                    <Input type="number" min="0" value={formRecogida.valor_pagado} placeholder="0"
                      onChange={e => setFormRecogida(p => ({ ...p, valor_pagado: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL}>Método de pago</label>
                    <Select value={formRecogida.metodo_pago}
                      onChange={e => setFormRecogida(p => ({ ...p, metodo_pago: e.target.value }))}>
                      <option value="">Seleccionar...</option>
                      <option value="EFECTIVO">Efectivo</option>
                      <option value="TRANSFERENCIA">Transferencia / Nequi</option>
                      <option value="DATAFONO">Datáfono</option>
                      <option value="PENDIENTE">Pendiente</option>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={LABEL}>Estado de pago</label>
                    <Select value={formRecogida.estado_pago}
                      onChange={e => setFormRecogida(p => ({ ...p, estado_pago: e.target.value }))}>
                      <option value="PENDIENTE">Pendiente</option>
                      <option value="PARCIAL">Parcial</option>
                      <option value="COMPLETO">Completo</option>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className={LABEL}>Notas adicionales</label>
                <Textarea value={formRecogida.notas} rows={3}
                  placeholder="Instrucciones especiales, observaciones..."
                  onChange={e => setFormRecogida(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* ══════ PASO 4: CONFIRMACIÓN ══════ */}
        {paso === 4 && (
          <div className={CARD}>
            <div className="text-lg font-bold text-gray-900 mb-5">Confirmar servicio</div>
            <div className={`${SELECTED_CARD} mb-5`}>
              <div className="font-bold text-gray-900 mb-4 text-[13px] uppercase tracking-wider text-[#3D5A27]">Resumen</div>
              <div className="space-y-2.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Cliente</span>
                  <span className="font-semibold text-gray-900 text-right">
                    {clienteSeleccionado ? `${clienteSeleccionado.nombre} ${clienteSeleccionado.apellido}` : `${formCliente.nombre} ${formCliente.apellido}`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Mascota</span>
                  <span className="font-semibold text-gray-900 text-right">
                    {mascotaSeleccionada?.nombre || formMascota.nombre}
                    {' · '}{pesoKg} kg
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Plan</span>
                  <span className="font-semibold text-gray-900 text-right">{planSeleccionado?.nombre}</span>
                </div>
                {aliadoSeleccionado && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Aliado</span>
                    <span className="font-semibold text-gray-900 text-right">
                      {aliadoSeleccionado.vip && '⭐ '}{aliadoSeleccionado.nombre}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Recogida</span>
                  <span className="font-semibold text-gray-900 text-right">
                    {formRecogida.tipo_lugar.replace(/_/g, ' ')}
                    {formRecogida.ciudad_recogida && formRecogida.ciudad_recogida !== 'Bogotá' && ` · ${formRecogida.ciudad_recogida}`}
                    {formRecogida.hora_aproximada && ` · ${formRecogida.hora_aproximada}`}
                  </span>
                </div>
                {tecnicoSeleccionado && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Técnico</span>
                    <span className="font-semibold text-gray-900 text-right">{tecnicoSeleccionado.nombre} {tecnicoSeleccionado.apellido}</span>
                  </div>
                )}
                <div className="border-t border-green-200 pt-3 mt-1 space-y-1.5">
                  {valorAdicionales > 0 && (
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="text-gray-500">Adicionales ({adicionales.length})</span>
                      <span className="text-gray-700">+ {fmt(valorAdicionales)}</span>
                    </div>
                  )}
                  {aplicaDescuento && comisionMonto > 0 && (
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="text-amber-600">Comisión aliado ({comisionPorcentaje}%)</span>
                      <span className="text-amber-600">- {fmt(comisionMonto)}</span>
                    </div>
                  )}
                  {recargoCiudad > 0 && (
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="text-blue-600">Recargo transporte</span>
                      <span className="text-blue-600">+ {fmt(recargoCiudad)}</span>
                    </div>
                  )}
                  {recargoPrioridad > 0 && (
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="text-orange-600">Recogida prioritaria</span>
                      <span className="text-orange-600">+ {fmt(recargoPrioridad)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-gray-700">Valor a cobrar</span>
                    <span className="font-bold text-[#3D5A27] text-[16px]">{fmt(valorCobrado)}</span>
                  </div>
                  {formRecogida.valor_pagado && parseFloat(formRecogida.valor_pagado) > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500">Recibido ahora</span>
                      <span className="font-semibold text-gray-700">{fmt(parseFloat(formRecogida.valor_pagado))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Alert variant="info">
              Al guardar, el servicio quedará en estado <strong>Ingresado</strong> en el tablero.
              Los recordatorios del plan se asignarán automáticamente.
            </Alert>
          </div>
        )}

        {/* Navegación */}
        <div className="flex justify-between mt-5 gap-3">
          <Button variant="secondary"
            onClick={() => paso > 0 ? setPaso(p => p - 1) : navigate('/kanban')}
            disabled={saving}>
            <ChevronLeft size={15} />
            {paso === 0 ? 'Cancelar' : 'Anterior'}
          </Button>
          {paso < PASOS.length - 1 ? (
            <Button onClick={() => setPaso(p => p + 1)} disabled={!canNext[paso]?.()}>
              Siguiente <ChevronRight size={15} />
            </Button>
          ) : (
            <Button onClick={guardar} disabled={saving} size="lg">
              {saving ? <><Spinner size={14} /> Guardando...</> : <><CheckCircle size={15} /> Guardar servicio</>}
            </Button>
          )}
        </div>
      </div>

      {/* Modal IA */}
      <AnimatePresence>
        {iaOpen && (
          <CargaIA
            onDatos={aplicarDatosIA}
            onClose={() => setIaOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
