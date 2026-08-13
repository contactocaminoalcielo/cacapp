import { useState, useEffect, useRef } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import CargaIA from '@/components/CargaIA'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { db } from '@/lib/supabase'
import { fmt, today, needsAcomp, petEmoji, initials } from '@/lib/utils'
import { planComisiona, volumenMesAliado } from '@/lib/precios'
import {
  CheckCircle, ChevronRight, ChevronLeft, Search, X,
  User, Star, Loader2, MapPin, Clock, CreditCard, Truck, Sparkles, MessageSquare, AlertCircle, HeartPulse
} from 'lucide-react'

// Precio de eutanasia por peso (tabla eutanasia_tarifas; peso_max_kg null = "o más")
function precioEutanasiaPorPeso(tarifas, pesoKg) {
  const p = parseFloat(pesoKg)
  if (Number.isNaN(p)) return null
  const orden = [...tarifas].filter(t => t.activo !== false)
    .sort((a, b) => (a.peso_max_kg == null ? Infinity : +a.peso_max_kg) - (b.peso_max_kg == null ? Infinity : +b.peso_max_kg))
  const m = orden.find(t => t.peso_max_kg == null || p <= +t.peso_max_kg)
  return m ? +m.precio : null
}

const ESPECIE_NOMBRE_A_ID = { 'Perro':1, 'Gato':2, 'Conejo':3, 'Ave':4, 'Hámster':5, 'Pez':6, 'Reptil':7, 'Otro':8 }

// ─── Validaciones ─────────────────────────────────────────────────────────────
function validarTel(v, requerido = false) {
  const val = (v || '').trim()
  if (!val) return requerido ? 'Campo requerido' : null
  if (val.startsWith('+') || val.startsWith('00')) {
    const d = (val.startsWith('+') ? val.slice(1) : val.slice(2)).replace(/\D/g,'')
    if (d.length < 7 || d.length > 15) return 'Número internacional inválido — ej: +1 555 1234567'
    return null
  }
  const d = val.replace(/\D/g,'')
  if (d.length !== 10) return '10 dígitos requeridos — ej: 3001234567'
  if (!d.startsWith('3')) return 'Los celulares colombianos empiezan por 3'
  return null
}

const REGLAS_REG = {
  nombre:         v => !v?.trim() ? 'El nombre es requerido' : null,
  whatsapp:       v => validarTel(v, true),
  telefono:       v => validarTel(v, false),
  telefono2:      v => validarTel(v, false),
  email:          v => v?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 'Correo inválido' : null,
  mascota_nombre: v => !v?.trim() ? 'El nombre de la mascota es requerido' : null,
  peso_kg: v => {
    if (!v) return 'El peso es requerido'
    const n = parseFloat(String(v).replace(',','.'))
    if (isNaN(n) || n <= 0) return 'Ingresa un peso válido (ej: 4.5)'
    if (n > 120) return '¿Está en kg? El valor parece muy alto'
    return null
  },
}

function ErrMsgR({ msg }) {
  if (!msg) return null
  return (
    <div className="flex items-start gap-1.5 mt-1.5">
      <AlertCircle size={11} className="text-red-500 shrink-0 mt-0.5" />
      <p className="text-[11px] text-red-600 font-medium leading-tight">{msg}</p>
    </div>
  )
}

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

// Bogotá siempre como primera opción (sin recargo). Municipios vienen de DB (tarifas_transporte).
const BOGOTA_OPCION = { value: 'Bogotá', label: 'Bogotá (sin recargo)', tarifa_moto: 0, tarifa_camioneta: 0 }

const LABEL = 'text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5'
const CARD  = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6'
const SUB   = 'text-[13px] font-semibold text-gray-700 mb-3'
const SELECTED_CARD = 'bg-blue-50 border border-blue-200 rounded-xl p-4'

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ nombre, apellido, size = 8 }) {
  return (
    <div className={`w-${size} h-${size} rounded-full bg-[#1A5CD8] flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0`}>
      {initials(nombre, apellido)}
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ paso, setPaso }) {
  return (
    <div className="flex items-start mb-4 sm:mb-8">
      {PASOS.map((p, i) => (
        <div key={i} className="flex items-center flex-1 min-w-0">
          <div className="flex flex-col items-center gap-1">
            <button
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold border-2 transition-all ${
                i < paso
                  ? 'bg-[#1A5CD8] text-white border-[#1A5CD8] cursor-pointer'
                  : i === paso
                  ? 'border-[#1A5CD8] text-[#1A5CD8] bg-white cursor-default'
                  : 'border-gray-200 text-gray-400 bg-white cursor-default'
              }`}
              onClick={() => i < paso && setPaso(i)}
              disabled={i >= paso}
            >
              {i < paso ? <CheckCircle size={14} /> : i + 1}
            </button>
            <span className={`text-[10px] font-semibold hidden sm:block whitespace-nowrap ${
              i === paso ? 'text-[#1A5CD8]' : i < paso ? 'text-gray-500' : 'text-gray-300'
            }`}>{p.label}</span>
          </div>
          {i < PASOS.length - 1 && (
            <div className="flex-1 h-0.5 mx-1 mb-4"
              style={{ background: i < paso ? '#1A5CD8' : '#e5e7eb' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="animate-spin text-[#1A5CD8]" />
}

// ─── Persistencia de borrador ─────────────────────────────────────────────────
const DRAFT_KEY = 'registro_borrador_v1'

function leerBorrador() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}
function guardarBorrador(data) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, _ts: Date.now() })) } catch {}
}
function limpiarBorrador() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Registro() {
  const { confirm } = useConfirm()
  const { personalData } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const borrador = leerBorrador()

  const [paso, setPaso]       = useState(borrador?.paso ?? 0)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(false)
  const [iaOpen, setIaOpen]       = useState(false)

  // Validación campo a campo
  const [errReg, setErrReg]     = useState({})
  const [tocReg, setTocReg]     = useState({})

  function vldR(campo, valor) {
    const e = REGLAS_REG[campo]?.(valor) ?? null
    setErrReg(p => ({ ...p, [campo]: e }))
    return e
  }
  function tocarR(campo, valor) {
    setTocReg(p => ({ ...p, [campo]: true }))
    vldR(campo, valor)
  }
  // Clase de Input con feedback visual
  function icR(campo) {
    if (!tocReg[campo]) return ''
    if (errReg[campo])  return 'border-red-400 bg-red-50/40 focus:border-red-500 focus:ring-red-400/10'
    return 'border-green-400 focus:border-green-500 focus:ring-green-400/10'
  }
  const [iaDatos, setIaDatos]     = useState(false)
  const [borradorRestaurado, setBorradorRestaurado] = useState(!!borrador)

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
  const [tarifasTransporte, setTarifasTransporte] = useState([])
  const [eutanasiaTarifas, setEutanasiaTarifas]   = useState([])
  const [veterinarios, setVeterinarios]           = useState([])

  // paso 0: cliente
  const [clienteBusqueda, setClienteBusqueda]           = useState('')
  const [clienteResultados, setClienteResultados]       = useState([])
  const [clienteSeleccionado, setClienteSeleccionado]   = useState(borrador?.clienteSeleccionado ?? null)
  const [clienteNuevo, setClienteNuevo]                 = useState(borrador?.clienteNuevo ?? false)
  const [buscandoCliente, setBuscandoCliente]           = useState(false)
  const [cedulaDuplicada, setCedulaDuplicada]           = useState(null)
  const [formCliente, setFormCliente] = useState(borrador?.formCliente ?? {
    nombre: '', apellido: '', cedula_nit: '', whatsapp: '',
    telefono: '', telefono2: '', email: '', direccion: '', barrio: '',
    localidad: '', ciudad: 'Bogotá', tipo_cliente: 'NORMAL',
  })

  // paso 1: mascota
  const [mascotasCliente, setMascotasCliente]           = useState([])
  const [mascotaSeleccionada, setMascotaSeleccionada]   = useState(borrador?.mascotaSeleccionada ?? null)
  const [mascotaNueva, setMascotaNueva]                 = useState(borrador?.mascotaNueva ?? false)
  const [pesoKgOverride, setPesoKgOverride]             = useState(borrador?.pesoKgOverride ?? '')
  const [formMascota, setFormMascota] = useState(borrador?.formMascota ?? {
    nombre: '', especie_id: '', raza: '', sexo: 'Macho',
    peso_kg: '', tamano: 'Mediano', notas: '',
  })

  // paso 2: plan
  const [planSeleccionado, setPlanSeleccionado]     = useState(borrador?.planSeleccionado ?? null)
  const [preciosPorPlan, setPreciosPorPlan]         = useState({})
  const [precioSeleccionado, setPrecioSeleccionado] = useState(borrador?.precioSeleccionado ?? null)
  // Afiliación pre-exequial: el cobro viene de la cláusula del contrato, no del
  // precio del plan por peso — mientras exista, ningún recálculo lo puede pisar.
  const valorAfiliacion = location.state?.presequial?.valor_plan_override ?? null
  const [cargandoPrecios, setCargandoPrecios]       = useState(false)
  const [tipoAcomp, setTipoAcomp]                   = useState(borrador?.tipoAcomp ?? 'EVIDENCIA')
  const [canalEntrada, setCanalEntrada]             = useState(borrador?.canalEntrada ?? 'DIRECTO')
  const [aliadoBusqueda, setAliadoBusqueda]         = useState('')
  const [aliadoSeleccionado, setAliadoSeleccionado] = useState(borrador?.aliadoSeleccionado ?? null)
  const [aliadoOpen, setAliadoOpen]                 = useState(false)
  const [adicionales, setAdicionales]               = useState(borrador?.adicionales ?? [])
  const [adicionalBusqueda, setAdicionalBusqueda]   = useState('')
  const [comisionPorcentaje, setComisionPorcentaje] = useState(borrador?.comisionPorcentaje ?? 0)
  const [desamparadoPrioridad, setDesamparadoPrioridad] = useState(borrador?.desamparadoPrioridad ?? false)
  // Eutanasia compasiva combinada con el plan (Caso 2/3) — entidad propia vinculada
  const [eutanasiaIncluida,   setEutanasiaIncluida]   = useState(borrador?.eutanasiaIncluida ?? false)
  const [eutanasiaVetId,      setEutanasiaVetId]      = useState(borrador?.eutanasiaVetId ?? '')
  const [eutanasiaFecha,      setEutanasiaFecha]      = useState(borrador?.eutanasiaFecha ?? '')
  const [eutanasiaHora,       setEutanasiaHora]       = useState(borrador?.eutanasiaHora ?? '')
  const [eutanasiaValorManual, setEutanasiaValorManual] = useState(borrador?.eutanasiaValorManual ?? '')

  // paso 3: recogida + pago
  const [formRecogida, setFormRecogida] = useState(borrador?.formRecogida ?? {
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
  const [vehiculoTipo, setVehiculoTipo]             = useState(borrador?.vehiculoTipo ?? 'MOTO')
  const [autoFilledRecogida, setAutoFilledRecogida] = useState(false)
  const [descuentoAdicional,       setDescuentoAdicional]       = useState(borrador?.descuentoAdicional ?? 0)
  const [descuentoAdicionalMotivo, setDescuentoAdicionalMotivo] = useState(borrador?.descuentoAdicionalMotivo ?? '')
  const [recargoNocturno,          setRecargoNocturno]          = useState(borrador?.recargoNocturno ?? 0)
  const [tecnicoBusqueda, setTecnicoBusqueda]       = useState('')
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState(borrador?.tecnicoSeleccionado ?? null)
  const [tecnicoOpen, setTecnicoOpen]               = useState(false)

  // refs
  const debounceRef    = useRef(null)
  const aliadoRef      = useRef(null)
  const tecnicoRef     = useRef(null)
  const formClienteRef = useRef(formCliente)
  const clienteNuevoRef = useRef(clienteNuevo)
  useEffect(() => { formClienteRef.current = formCliente }, [formCliente])
  useEffect(() => { clienteNuevoRef.current = clienteNuevo }, [clienteNuevo])

  // ── Auto-guardar borrador en localStorage ─────────────────────────────────
  useEffect(() => {
    if (success) return
    guardarBorrador({
      paso,
      formCliente, clienteSeleccionado, clienteNuevo,
      formMascota, mascotaSeleccionada, mascotaNueva, pesoKgOverride,
      planSeleccionado, precioSeleccionado, tipoAcomp, canalEntrada,
      aliadoSeleccionado, adicionales, comisionPorcentaje, desamparadoPrioridad,
      formRecogida, vehiculoTipo, tecnicoSeleccionado,
      descuentoAdicional, descuentoAdicionalMotivo, recargoNocturno,
    })
  }, [
    paso, formCliente, clienteSeleccionado, clienteNuevo,
    formMascota, mascotaSeleccionada, mascotaNueva, pesoKgOverride,
    planSeleccionado, precioSeleccionado, tipoAcomp, canalEntrada,
    aliadoSeleccionado, adicionales, comisionPorcentaje, desamparadoPrioridad,
    formRecogida, vehiculoTipo, tecnicoSeleccionado, success,
    descuentoAdicional, descuentoAdicionalMotivo, recargoNocturno,
  ])

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
  const ciudadesList     = [BOGOTA_OPCION, ...tarifasTransporte.map(t => ({ value: t.ciudad, label: t.ciudad, tarifa_moto: t.tarifa_moto, tarifa_camioneta: t.tarifa_camioneta }))]
  // La ciudad NO siempre viene del selector: la copia el registro del aliado
  // (`aliados.ciudad`, que a veces está en MAYÚSCULAS), la del cliente o la
  // extracción con IA. Comparar con `===` contra la tarifa ('Soacha') no casaba
  // con 'SOACHA', y el viejo `|| ciudadesList[0]` la hacía caer a Bogotá →
  // transporte $0 guardado en silencio, con el selector mostrando "Bogotá"
  // aunque el estado dijera otra cosa (6 recogidas de Soacha sin cobrar el
  // transporte). Ahora se compara normalizado y NO hay caída a Bogotá: si la
  // ciudad no tiene tarifa se avisa en pantalla en vez de valer cero callado.
  const normCiudad       = s => String(s || '').trim().toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u')
  const ciudadInfo       = ciudadesList.find(c => normCiudad(c.value) === normCiudad(formRecogida.ciudad_recogida)) || null
  const ciudadSinTarifa  = !!formRecogida.ciudad_recogida && !ciudadInfo
  // Nombre canónico de la tarifa: es el que se guarda, para que no vuelvan a
  // quedar filas 'SOACHA' que ningún cálculo posterior reconoce.
  const ciudadCanonica   = ciudadInfo?.value || formRecogida.ciudad_recogida
  const recargoCiudad    = (ciudadInfo && ciudadInfo.value !== 'Bogotá')
    ? (vehiculoTipo === 'MOTO' ? (ciudadInfo.tarifa_moto || 0) : (ciudadInfo.tarifa_camioneta || 0))
    : 0
  const modalidadComision  = aliadoSeleccionado?.modalidad_comision
  // El DESCUENTO EN EL RECIBO depende del punto de recogida:
  //   • CLINICA_ALIADA: la vet maneja la plata → el recibo va neto (se descuenta la comisión).
  //   • DOMICILIO: se cobra el VALOR COMPLETO al cliente y la comisión se cuadra
  //     aparte con la veterinaria (NO se descuenta del recibo).
  // La comisión se registra igual (comision_aliado) en ambos casos; lo que cambia es
  // si se resta del total. La modalidad solo afecta CUÁNDO se paga.
  const comisionCalculada  = comisionPorcentaje > 0
    ? Math.round(valorBase * comisionPorcentaje / 100) : 0
  const aplicaDescuento    = !!aliadoSeleccionado &&
    ['DESCUENTO_INMEDIATO', 'FACTURACION_MENSUAL'].includes(aliadoSeleccionado?.modalidad_comision) &&
    formRecogida.tipo_lugar === 'CLINICA_ALIADA' && comisionCalculada > 0
  const comisionMonto      = aplicaDescuento ? comisionCalculada : 0
  const recargoPrioridad  = planSeleccionado?.codigo === 'DESAMPARADO' && desamparadoPrioridad ? 16000 : 0
  const descuentoAdicionalNum = Math.max(0, parseFloat(descuentoAdicional) || 0)
  const recargoNocturnoNum    = Math.max(0, parseFloat(recargoNocturno) || 0)
  const esHorarioNocturno     = new Date().getHours() >= 21
  // Eutanasia: valor propio (cuenta aparte) que además se SUMA al total del servicio (cobro conjunto)
  const precioEutanasiaAuto   = eutanasiaIncluida ? precioEutanasiaPorPeso(eutanasiaTarifas, pesoKg) : null
  const valorEutanasia        = eutanasiaIncluida
    ? (eutanasiaValorManual !== '' ? (parseFloat(eutanasiaValorManual) || 0) : (precioEutanasiaAuto || 0))
    : 0
  const valorCobrado          = valorBruto - comisionMonto + recargoCiudad + recargoPrioridad + recargoNocturnoNum - descuentoAdicionalNum + valorEutanasia

  // ── cargar catálogos ──
  useEffect(() => { cargarCatalogos() }, [])

  async function cargarCatalogos() {
    const [{ data: esp }, { data: pls }, { data: als }, { data: per }, { data: rec }, { data: tar }, { data: eutTar }, { data: vets }] =
      await Promise.all([
        db.from('especies').select('*').order('nombre'),
        db.from('planes').select('*')
          .not('codigo', 'in', '(BRONCE,PLATA,ORO_EXCLUSIVO,DIAMANTE,VITALICIO)')
          .order('nombre'),
        db.from('aliados').select('*').eq('activo', true).order('nombre'),
        db.from('personal').select('*').eq('activo', true).order('nombre'),
        db.from('recordatorios').select('id,nombre,precio_base,categoria').eq('activo', true).order('nombre'),
        db.from('tarifas_transporte').select('ciudad,tarifa_moto,tarifa_camioneta').eq('activo', true).order('ciudad'),
        db.from('eutanasia_tarifas').select('*').order('peso_min_kg'),
        db.from('veterinarios').select('id,nombre,telefono,activo').eq('activo', true).order('nombre'),
      ])
    setEspecies(esp || [])
    setPlanes(pls || [])
    setAliados(als || [])
    setPersonal(per || [])
    // Eutanasia se gestiona en su propio módulo (/eutanasias), NO como adicional
    setRecordatoriosAdic((rec || []).filter(r => !/eutanas/i.test(r.nombre || '')))
    setTarifasTransporte(tar || [])
    setEutanasiaTarifas(eutTar || [])
    setVeterinarios(vets || [])

    // Auto-cargar desde plan presequial activado
    const pre = location.state?.presequial
    if (pre) {
      const [{ data: cli }, { data: msc }, { data: pl }] = await Promise.all([
        pre.cliente_id ? db.from('clientes').select('*').eq('id_cliente', pre.cliente_id).maybeSingle() : { data: null },
        pre.mascota_id ? db.from('mascotas').select('*, especies(nombre)').eq('id_mascota', pre.mascota_id).maybeSingle() : { data: null },
        pre.plan_id    ? db.from('planes').select('*').eq('id', pre.plan_id).maybeSingle()                   : { data: null },
      ])
      if (cli) {
        setClienteSeleccionado(cli)
        setClienteNuevo(false)
        if (cli.direccion) {
          setFormRecogida(prev => ({
            ...prev,
            direccion_recogida: cli.direccion,
            ciudad_recogida: cli.ciudad || 'Bogotá',
          }))
        }
        if (msc) {
          setMascotasCliente([msc])
          setMascotaSeleccionada(msc)
        }
      }
      if (pl) {
        setPlanSeleccionado(pl)
      }
      // Afiliación pre-exequial: el cliente NO paga el plan — paga la cláusula
      // del primer año (5×/3× la afiliación) o $0 si está cubierto. El transporte
      // se suma como siempre. Ver src/lib/afiliaciones.js.
      if (pre.valor_plan_override !== undefined && pre.valor_plan_override !== null) {
        setPrecioSeleccionado(pre.valor_plan_override)
      }
    }
  }

  // ── búsqueda cliente debounced ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!clienteBusqueda.trim()) { setClienteResultados([]); return }
    debounceRef.current = setTimeout(() => buscarCliente(clienteBusqueda.trim()), 350)
    return () => clearTimeout(debounceRef.current)
  }, [clienteBusqueda])

  // Verificar si la cédula ya existe mientras el usuario escribe (en formulario nuevo cliente)
  useEffect(() => {
    const cedula = formCliente.cedula_nit.trim()
    if (!clienteNuevo || !cedula) { setCedulaDuplicada(null); return }
    const t = setTimeout(async () => {
      const { data } = await db.from('clientes')
        .select('id_cliente, nombre, apellido, whatsapp')
        .eq('cedula_nit', cedula)
        .maybeSingle()
      setCedulaDuplicada(data || null)
    }, 400)
    return () => clearTimeout(t)
  }, [formCliente.cedula_nit, clienteNuevo])

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
  // FELINO (id=2) y CONEJO (id=3) usan el rango 'FELINO'; demás especies usan rangos por kg.
  // PETIT (< 1 kg) aplica a todas las especies.
  async function cargarPreciosTodosPlanes(peso, especieIdActual) {
    const pesoG        = Math.round(peso * 1000)
    const usaFelino    = especieIdActual === 2 || especieIdActual === 3  // Gato o Conejo
    setCargandoPrecios(true)
    try {
      let q = db.from('planes_precios').select('plan_id,precio,rango_nombre')
      if (pesoG < 1000) {
        // < 1 kg: todos los animales → PETIT
        q = q.eq('rango_nombre', 'PETIT')
      } else if (usaFelino) {
        // Gato o Conejo >= 1 kg → FELINO
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
        else if (usaFelino)      map[angelP.id] = 79000  // Gato o Conejo
        else if (pesoG < 11000)  map[angelP.id] = 89000   // decimales: 10.4 sigue en 1-10
        else if (pesoG < 21000)  map[angelP.id] = 119000
        else if (pesoG < 36000)  map[angelP.id] = 139000
        else                     map[angelP.id] = 189000
      }

      // Básico sin recordatorios = Básico × 80 %
      const basicoSinRecP = planByCode['BASICO_SIN_REC']
      const basicoP       = planByCode['BASICO']
      if (basicoSinRecP && basicoP && map[basicoSinRecP.id] === undefined && map[basicoP.id] !== undefined) {
        map[basicoSinRecP.id] = Math.round(map[basicoP.id] * 0.8)
      }

      // Compets sin recordatorios: precios en planes_precios (sin fallback —
      // si falta el rango, la tarjeta muestra "Sin precio configurado")

      // Exclusivo sin recordatorios = plan base × 80 % (regla aritmética válida,
      // confirmada por David 2026-06-12 — sigue automáticamente al precio base)
      ;[['EXCLUSIVO_PRESENCIAL_SIN_REC', 'EXCLUSIVO_PRESENCIAL'],
        ['EXCLUSIVO_VIDEOLLAMADA_SIN_REC', 'EXCLUSIVO_VIDEOLLAMADA']].forEach(([sinRec, baseCod]) => {
        const sinRecP = planByCode[sinRec]
        const baseP   = planByCode[baseCod]
        if (sinRecP && baseP && map[sinRecP.id] === undefined && map[baseP.id] !== undefined) {
          map[sinRecP.id] = Math.round(map[baseP.id] * 0.8)
        }
      })

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
        if (valorAfiliacion !== null) return
        if (planSeleccionado && map[planSeleccionado.id] !== undefined) {
          setPrecioSeleccionado(map[planSeleccionado.id])
        }
      })
    } else if (paso === 2 && pesoKg <= 0) {
      setPreciosPorPlan({})
      if (valorAfiliacion === null) setPrecioSeleccionado(null)
    }
  }, [paso, pesoKg, especieId])

  // sincronizar precio cuando cambia el plan
  useEffect(() => {
    if (valorAfiliacion !== null) { setPrecioSeleccionado(valorAfiliacion); return }
    if (planSeleccionado && preciosPorPlan[planSeleccionado.id] !== undefined) {
      setPrecioSeleccionado(preciosPorPlan[planSeleccionado.id])
    } else if (planSeleccionado) {
      setPrecioSeleccionado(null)
    }
  }, [planSeleccionado, preciosPorPlan])

  // ── comisión: plan + volumen mensual del aliado ──
  useEffect(() => {
    if (!aliadoSeleccionado || !planSeleccionado) { setComisionPorcentaje(0); return }
    // ── Planes que no comisionan (DESAMPARADO): 0 % siempre ────────────────
    // Va ANTES del bloque VIP: la tasa fija de CREMACION_GRUPAL (32 %) le
    // aplicaba al desamparado y el total salía con un descuento inexistente.
    if (!planComisiona(planSeleccionado?.codigo)) { setComisionPorcentaje(0); return }
    async function calcularComision() {
      // ── VIP: comisión máxima fija, sin pisos de volumen ──────────────────
      if (aliadoSeleccionado?.vip) {
        const tipo = planSeleccionado?.tipo_proceso || ''
        let pct = 32 // CREMACION_GRUPAL: 32%
        if (tipo === 'COMPOSTAJE_GRUPAL')    pct = 10 // Eco-grupal: 10%
        else if (tipo === 'CREMACION_INDIVIDUAL' ||
                 tipo === 'COMPOSTAJE_INDIVIDUAL') pct = 27 // Individuales: 27%
        setComisionPorcentaje(pct)
        return
      }

      // ── No VIP: pisos de volumen mensual ─────────────────────────────────
      // 1. Contar servicios de este aliado en el mes actual
      // Servicio NUEVO: su fila todavía no existe, así que el mes corriente
      // completo son justamente "los servicios ya hechos". Misma cuenta que usa
      // el recálculo posterior (volumenMesAliado), que es lo que hace que la
      // comisión no cambie sola después de emitido el recibo.
      const serviciosMes = await volumenMesAliado(aliadoSeleccionado.id_aliado)
      // 2. Traer todas las comisiones y filtrar en JS (evita problemas con OR doble en PostgREST)
      const { data: filas } = await db.from('config_comisiones')
        .select('porcentaje, plan_id, rango_min, rango_max')
        .eq('es_vip', false)
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
    // Solo ejecutar en el paso de recogida — evita que al avanzar al paso 4
    // se resetee ciudad_recogida al valor del cliente (borrando el municipio y su recargo)
    if (paso !== 3) return
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
          telefono_contacto_recogida: cli.whatsapp || cli.telefono || cli.telefono2 || prev.telefono_contacto_recogida,
        }))
        setAutoFilledRecogida(true)
      } else if (isNuevo && fCli.nombre) {
        setFormRecogida(prev => ({
          ...prev,
          direccion_recogida:         fCli.direccion || prev.direccion_recogida,
          ciudad_recogida:            fCli.ciudad    || prev.ciudad_recogida,
          nombre_contacto_recogida:   `${fCli.nombre} ${fCli.apellido}`.trim() || prev.nombre_contacto_recogida,
          telefono_contacto_recogida: fCli.whatsapp || fCli.telefono || fCli.telefono2 || prev.telefono_contacto_recogida,
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
        // Solo sobreescribir ciudad si el aliado está en un municipio fuera de Bogotá;
        // si está en Bogotá o no tiene ciudad, preservar la ciudad ya seleccionada
        // (puede haber recargo de transporte independientemente de si el punto es domicilio o clínica)
        ciudad_recogida:            (a.ciudad && a.ciudad !== 'Bogotá') ? a.ciudad : prev.ciudad_recogida,
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
      const ok = await confirm('No asignaste un técnico de recogida.\n¿Deseas guardar el servicio sin técnico asignado?', { title: 'Sin técnico asignado', variant: 'warning', confirmLabel: 'Guardar sin técnico', cancelLabel: 'Volver' })
      if (!ok) return
    }
    setSaving(true)
    setError(null)
    try {
      let clienteId = clienteSeleccionado?.id_cliente

      if (clienteNuevo) {
        // Verificar si ya existe un cliente con esa cédula antes de insertar
        if (formCliente.cedula_nit?.trim()) {
          const { data: existe } = await db.from('clientes')
            .select('id_cliente')
            .eq('cedula_nit', formCliente.cedula_nit.trim())
            .maybeSingle()
          if (existe) {
            clienteId = existe.id_cliente
            // Saltar el INSERT — reusar cliente existente
          }
        }

        if (!clienteId) {
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
            telefono2:    formCliente.telefono2   || null,
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
      if (recargoNocturnoNum > 0)
        notasFinales = `${notasFinales} Recargo nocturno: ${fmt(recargoNocturnoNum)}.`.trim()

      const { data: svcData, error: svcErr } = await db.from('servicios').insert({
        mascota_id:           mascotaId,
        plan_id:              planSeleccionado.id,
        estado:               'INGRESADO',
        fecha_ingreso:        today(),
        tipo_acompanamiento:  tipoAcomp,
        canal_entrada:        canalEntrada,
        registrado_por:       personalData?.id || null,
        aliado_origen_id:     aliadoSeleccionado?.id_aliado || null,
        valor_total:          valorCobrado,
        valor_pagado:         parseFloat(formRecogida.valor_pagado) || 0,
        estado_pago:          formRecogida.estado_pago,
        metodo_pago:          formRecogida.metodo_pago || null,
        punto_recogida:       formRecogida.tipo_lugar,
        direccion_recogida:   formRecogida.direccion_recogida,
        ciudad_recogida:      ciudadCanonica,
        barrio_recogida:      formRecogida.barrio_recogida || null,
        indicaciones_recogida: formRecogida.notas || null,
        tecnico_id:           tecnicoSeleccionado?.id || null,
        notas:                notasFinales || null,
        tipo_cliente:         clienteSeleccionado?.tipo_cliente || formCliente.tipo_cliente || 'NORMAL',
        comision_aliado:             comisionCalculada || 0,
        comision_descontada:         aplicaDescuento,
        descuento_adicional:         descuentoAdicionalNum,
        descuento_adicional_motivo:  descuentoAdicionalMotivo.trim() || null,
        // Desglose congelado del cobro (migración 010) — para el cuadre con técnicos.
        valor_plan:                  valorBase,
        valor_adicionales:           valorAdicionales,
        valor_transporte:            recargoCiudad,
        recargo_nocturno:            recargoNocturnoNum,
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

      // Materializar los adicionales como ítems de producción (origen ADICIONAL)
      // para que cuenten en el tablero y producción los fabrique. El cobro ya
      // viaja en valor_adicionales/valor_total; aquí solo se crean los ítems.
      // Misma convención que el modal del Kanban: precio_cobrado = subtotal.
      if (adicionales.length > 0 && svcData?.[0]?.id) {
        await db.from('servicio_recordatorios').insert(
          adicionales.map(a => ({
            servicio_id:     svcData[0].id,
            recordatorio_id: a.id,
            cantidad:        a.cantidad || 1,
            origen:          'ADICIONAL',
            estado:          'PENDIENTE',
            precio_cobrado:  (a.precio_base || 0) * (a.cantidad || 1),
          }))
        )
      }

      // Afiliación pre-exequial: cerrar el ciclo SOLO cuando el servicio existe
      // (marcar ACTIVADA antes de crear el servicio era el bug del módulo viejo).
      // Un contrato cubre varias mascotas: se activa SOLO la que falleció; las
      // hermanas siguen cubiertas. El contrato entero pasa a ACTIVADA nada más
      // cuando ya no le queda ninguna mascota viva.
      const pre = location.state?.presequial
      if (pre?.afiliacion_mascota_id && svcData?.[0]?.id) {
        await db.from('afiliacion_mascotas').update({
          estado:               'ACTIVADA',
          servicio_activado_id: svcData[0].id,
          fecha_activacion:     today(),
        }).eq('id', pre.afiliacion_mascota_id)

        const { count: vivas } = await db.from('afiliacion_mascotas')
          .select('id', { count: 'exact', head: true })
          .eq('afiliacion_id', pre.id).eq('estado', 'VIGENTE')
        if (!vivas) await db.from('afiliaciones').update({ estado: 'ACTIVADA' }).eq('id', pre.id)

        await db.from('mascotas').update({
          fallecida: true, fecha_fallecimiento: today(),
        }).eq('id_mascota', pre.mascota_id).eq('fallecida', false)
      }

      // Eutanasia combinada (Caso 2/3): entidad propia vinculada al servicio.
      // cobro_conjunto=true → su valor ya está sumado en valor_total, pero se
      // conserva aparte en `eutanasias.valor` para reportes/cuenta separada.
      if (eutanasiaIncluida && svcData?.[0]?.id) {
        const { data: eutData, error: eutErr } = await db.from('eutanasias').insert({
          cliente_id:       clienteId,
          mascota_id:       mascotaId,
          peso_kg:          pesoKg || null,
          direccion:        formRecogida.direccion_recogida || null,
          ciudad:           ciudadCanonica || null,
          fecha_solicitada: eutanasiaFecha || null,
          hora_solicitada:  eutanasiaHora || null,
          veterinario_id:   eutanasiaVetId || null,
          estado:           eutanasiaVetId ? 'VETERINARIO_ASIGNADO' : 'SOLICITADA',
          valor:            valorEutanasia || null,
          cobro_conjunto:   true,
          servicio_id:      svcData[0].id,
        }).select('id').single()
        if (eutErr) throw eutErr
        if (eutData?.id) {
          await db.from('servicios').update({ eutanasia_id: eutData.id }).eq('id', svcData[0].id)
        }
      }

      limpiarBorrador()
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
          <div className="text-sm text-gray-500 mb-3">Redirigiendo al tablero...</div>
          {tecnicoSeleccionado && (
            <div className="text-[12px] text-gray-500">
              Técnico asignado: <span className="font-semibold text-gray-700">{tecnicoSeleccionado.nombre}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="max-w-2xl mx-auto px-4 py-3 sm:py-6">
        {/* Botón IA — visible solo en paso 0 */}
        {paso === 0 && (
          <button
            onClick={() => setIaOpen(true)}
            className="w-full flex items-center justify-center gap-2 mb-4 py-3 px-4 rounded-xl font-semibold text-[13px] transition-all hover:opacity-90 active:scale-98"
            style={{ background: 'linear-gradient(135deg, #0B1D4F 0%, #1A5CD8 100%)', color: '#C4A87A' }}
          >
            <Sparkles size={15} />
            Cargar con IA — foto o mensaje WhatsApp
          </button>
        )}

        {/* Banner borrador restaurado */}
        {borradorRestaurado && (
          <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl text-[13px] font-medium"
            style={{ background: '#EFF5FF', border: '1px solid #93C5FD', color: '#1D4ED8' }}>
            <span>📋 Borrador restaurado — puedes continuar desde donde lo dejaste</span>
            <button
              onClick={async () => {
                const ok = await confirm('¿Descartar el borrador y empezar desde cero?', { title: 'Descartar borrador', confirmLabel: 'Descartar', cancelLabel: 'Continuar' })
                if (!ok) return
                limpiarBorrador()
                window.location.reload()
              }}
              className="ml-auto text-[11px] font-bold text-red-500 hover:text-red-700 whitespace-nowrap"
            >
              Descartar
            </button>
          </div>
        )}

        <Stepper paso={paso} setPaso={setPaso} />

        {location.state?.presequial && (
          <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl text-[13px] font-medium"
            style={{ background: '#EDE9FE', border: '1px solid #C4B5FD', color: '#5B21B6' }}>
            <Star size={14} />
            <span>
              Activando afiliación pre-exequial {location.state.presequial.nivel} — cliente, mascota y plan precargados.
              {location.state.presequial.valor_plan_override !== undefined && (
                <> Cobro del plan: <strong>{fmt(location.state.presequial.valor_plan_override)}</strong>
                {location.state.presequial.motivo ? ` (${location.state.presequial.motivo})` : ''}. El precio queda fijado por la afiliación aunque cambie el plan o el peso.</>
              )}
            </span>
          </div>
        )}

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
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#1A5CD8]/30 hover:bg-green-50 transition-all text-left"
                        onClick={() => seleccionarCliente(c)}>
                        <Avatar nombre={c.nombre} apellido={c.apellido} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-gray-900 truncate">{c.nombre} {c.apellido}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {c.cedula_nit && <span>{c.cedula_nit} · </span>}{c.whatsapp}
                            {c.mascotas && <span className="ml-2 text-[#1A5CD8] font-semibold">{c.mascotas.length} mascota{c.mascotas.length !== 1 ? 's' : ''}</span>}
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
                  className="w-full mt-1 py-3 text-[12px] font-semibold text-[#1A5CD8] border-2 border-dashed border-green-200 rounded-xl hover:bg-green-50 transition-all flex items-center justify-center gap-2"
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
                      {clienteSeleccionado.telefono && ` · ${clienteSeleccionado.telefono}`}
                      {clienteSeleccionado.telefono2 && ` · ${clienteSeleccionado.telefono2}`}
                      {clienteSeleccionado.cedula_nit && ` · CC ${clienteSeleccionado.cedula_nit}`}
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
                  <div>
                    <label className={LABEL}>Nombre *</label>
                    <Input className={icR('nombre')} value={formCliente.nombre}
                      onChange={e => { const v = e.target.value.toUpperCase(); setFormCliente(p => ({ ...p, nombre: v })); if (tocReg.nombre) vldR('nombre', v) }}
                      onBlur={e => tocarR('nombre', e.target.value)} maxLength={80} />
                    <ErrMsgR msg={tocReg.nombre && errReg.nombre} />
                  </div>
                  <div>
                    <label className={LABEL}>Apellido</label>
                    <Input value={formCliente.apellido} onChange={e => setFormCliente(p => ({ ...p, apellido: e.target.value.toUpperCase() }))} maxLength={80} />
                  </div>
                  <div>
                    <label className={LABEL}>Cédula / NIT</label>
                    <Input
                      value={formCliente.cedula_nit}
                      onChange={e => setFormCliente(p => ({ ...p, cedula_nit: e.target.value }))}
                      className={cedulaDuplicada ? 'border-amber-400 bg-amber-50' : ''}
                      maxLength={30}
                    />
                    {cedulaDuplicada && (
                      <div className="mt-1.5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-amber-800">
                            Esta cédula ya está registrada: {cedulaDuplicada.nombre} {cedulaDuplicada.apellido}
                          </p>
                          <p className="text-[11px] text-amber-600">Al confirmar el servicio se usará ese cliente existente.</p>
                        </div>
                        <button
                          type="button"
                          className="text-[11px] font-bold text-[#1A5CD8] underline flex-shrink-0"
                          onClick={() => {
                            setClienteSeleccionado(cedulaDuplicada)
                            setClienteNuevo(false)
                            setCedulaDuplicada(null)
                          }}>
                          Usar este cliente
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className={LABEL}>WhatsApp *</label>
                    <Input className={icR('whatsapp')} value={formCliente.whatsapp} placeholder="3001234567 · +1 555 1234"
                      onChange={e => { const v = e.target.value; setFormCliente(p => ({ ...p, whatsapp: v })); if (tocReg.whatsapp) vldR('whatsapp', v) }}
                      onBlur={e => tocarR('whatsapp', e.target.value)} maxLength={25} />
                    <ErrMsgR msg={tocReg.whatsapp && errReg.whatsapp} />
                  </div>
                  <div>
                    <label className={LABEL}>Segundo contacto</label>
                    <Input className={icR('telefono')} value={formCliente.telefono} placeholder="3001234567 · +57 601 1234"
                      onChange={e => { const v = e.target.value; setFormCliente(p => ({ ...p, telefono: v })); if (tocReg.telefono) vldR('telefono', v) }}
                      onBlur={e => tocarR('telefono', e.target.value)} maxLength={25} />
                    <ErrMsgR msg={tocReg.telefono && errReg.telefono} />
                  </div>
                  <div>
                    <label className={LABEL}>Tercer contacto</label>
                    <Input className={icR('telefono2')} value={formCliente.telefono2} placeholder="3001234567 · +34 612 345 678"
                      onChange={e => { const v = e.target.value; setFormCliente(p => ({ ...p, telefono2: v })); if (tocReg.telefono2) vldR('telefono2', v) }}
                      onBlur={e => tocarR('telefono2', e.target.value)} maxLength={25} />
                    <ErrMsgR msg={tocReg.telefono2 && errReg.telefono2} />
                  </div>
                  <div>
                    <label className={LABEL}>Email</label>
                    <Input className={icR('email')} value={formCliente.email} type="email"
                      onChange={e => { const v = e.target.value; setFormCliente(p => ({ ...p, email: v })); if (tocReg.email) vldR('email', v) }}
                      onBlur={e => tocarR('email', e.target.value)} />
                    <ErrMsgR msg={tocReg.email && errReg.email} />
                  </div>
                  <div><label className={LABEL}>Ciudad</label>
                    <Select value={formCliente.ciudad} onChange={e => setFormCliente(p => ({ ...p, ciudad: e.target.value, localidad: '' }))}>
                      {ciudadesList.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select></div>
                  <div><label className={LABEL}>Tipo cliente</label>
                    <Select value={formCliente.tipo_cliente} onChange={e => setFormCliente(p => ({ ...p, tipo_cliente: e.target.value }))}>
                      <option value="NORMAL">Normal</option>
                      <option value="VIP">VIP</option>
                      <option value="RECURRENTE">Recurrente</option>
                    </Select></div>
                  <div className="sm:col-span-2"><label className={LABEL}>Dirección</label>
                    <Input value={formCliente.direccion} onChange={e => setFormCliente(p => ({ ...p, direccion: e.target.value.toUpperCase() }))} /></div>
                  <div><label className={LABEL}>Barrio</label>
                    <Input value={formCliente.barrio} placeholder="Ej: CHAPINERO ALTO"
                      onChange={e => setFormCliente(p => ({ ...p, barrio: e.target.value.toUpperCase() }))} /></div>
                  {formCliente.ciudad === 'Bogotá' && (
                    <div><label className={LABEL}>Localidad</label>
                      <LocalidadSelect value={formCliente.localidad} onChange={v => setFormCliente(p => ({ ...p, localidad: v }))} /></div>
                  )}
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
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-[#1A5CD8]/30 hover:bg-green-50 transition-all text-left mb-2"
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
                  className="w-full py-3 text-[12px] font-semibold text-[#1A5CD8] border-2 border-dashed border-green-200 rounded-xl hover:bg-green-50 transition-all"
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
                  <Input className={icR('peso_kg')} type="text" inputMode="decimal"
                    value={pesoKgOverride !== '' ? pesoKgOverride : (mascotaSeleccionada.peso_kg || '')}
                    placeholder="Ej: 28.5"
                    onChange={e => { const v = e.target.value.replace(',', '.'); setPesoKgOverride(v); if (tocReg.peso_kg) vldR('peso_kg', v) }}
                    onBlur={e => tocarR('peso_kg', e.target.value)} />
                  {tocReg.peso_kg && errReg.peso_kg
                    ? <ErrMsgR msg={errReg.peso_kg} />
                    : <p className="text-[10px] text-gray-400 mt-1">El peso determina el precio del plan. Corrígelo si es necesario.</p>
                  }
                </div>
              </div>
            )}

            {mascotaNueva && (
              <div>
                <div className={`${SUB} mb-4`}>Datos de la mascota</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL}>Nombre *</label>
                    <Input className={icR('mascota_nombre')} value={formMascota.nombre}
                      onChange={e => { const v = e.target.value.toUpperCase(); setFormMascota(p => ({ ...p, nombre: v })); if (tocReg.mascota_nombre) vldR('mascota_nombre', v) }}
                      onBlur={e => tocarR('mascota_nombre', e.target.value)} />
                    <ErrMsgR msg={tocReg.mascota_nombre && errReg.mascota_nombre} />
                  </div>
                  <div><label className={LABEL}>Especie</label>
                    <Select value={formMascota.especie_id} onChange={e => setFormMascota(p => ({ ...p, especie_id: e.target.value }))}>
                      <option value="">Seleccionar...</option>
                      {especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </Select></div>
                  <div>
                    <label className={LABEL}>Peso (kg) *</label>
                    <Input className={icR('peso_kg')} type="text" inputMode="decimal" placeholder="Ej: 28.5" value={formMascota.peso_kg}
                      onChange={e => { const v = e.target.value.replace(',', '.'); setFormMascota(p => ({ ...p, peso_kg: v })); if (tocReg.peso_kg) vldR('peso_kg', v) }}
                      onBlur={e => tocarR('peso_kg', e.target.value)} />
                    <ErrMsgR msg={tocReg.peso_kg && errReg.peso_kg} />
                  </div>
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
                      selected ? 'border-[#1A5CD8] bg-green-50 shadow-sm' : 'border-gray-100 hover:border-[#1A5CD8]/40 bg-white'
                    }`}
                    onClick={() => { setPlanSeleccionado(p); setDesamparadoPrioridad(false) }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-[13px] font-semibold text-gray-900">{p.nombre}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{p.tipo_proceso?.replace(/_/g, ' ')}</div>
                      </div>
                      {selected && <CheckCircle size={16} className="text-[#1A5CD8] flex-shrink-0 mt-0.5" />}
                    </div>
                    <div className="mt-2">
                      {precio !== undefined ? (
                        <span className="text-[15px] font-bold text-[#1A5CD8]">{fmt(precio)}</span>
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
                    className="mt-0.5 w-4 h-4 accent-[#1A5CD8] flex-shrink-0"
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
                          ? 'border-[#1A5CD8] bg-green-50 text-[#1A5CD8]'
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
                  <div className="flex items-center gap-2 px-3 py-2 border border-[#1A5CD8] rounded-lg bg-green-50">
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
                <option value="CLIENTE_ANTIGUO">Cliente antiguo</option>
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
                            <span className="ml-2 text-[10px] text-[#1A5CD8] font-semibold">{fmt(r.precio_base)}</span>
                          )}
                        </div>
                        <span className="text-[11px] text-[#1A5CD8] font-semibold flex-shrink-0 ml-2">+ Agregar</span>
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
                    <span className="text-[10px] font-bold text-gray-400 uppercase text-right w-16 sm:w-20">Precio</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase text-center w-14 sm:w-16">Cant.</span>
                    <span className="w-5" />
                  </div>
                  {adicionales.map(a => (
                    <div key={a.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-[12px] text-gray-800 truncate">{a.nombre}</span>
                      <span className="text-[12px] font-semibold text-[#1A5CD8] w-16 sm:w-20 text-right">{fmt(a.precio_base)}</span>
                      <Input type="number" min="1" className="w-14 sm:w-16 text-center"
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

              {/* Eutanasia compasiva combinada (Caso 2/3) */}
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={eutanasiaIncluida}
                    onChange={e => { setEutanasiaIncluida(e.target.checked); if (e.target.checked && !eutanasiaFecha) setEutanasiaFecha(today()) }} />
                  <HeartPulse size={15} className="text-rose-500" />
                  <span className="text-[13px] font-bold text-rose-700">Incluir eutanasia compasiva</span>
                </label>
                <p className="text-[11px] text-rose-500/90 mt-1 ml-6">Se registra como servicio propio vinculado a este plan. Su valor se suma al total y queda con cuenta aparte.</p>

                {eutanasiaIncluida && (
                  <div className="mt-3 space-y-2">
                    {pesoKg > 0 ? (
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-gray-600">Valor por peso ({pesoKg} kg)</span>
                        <span className="font-bold text-rose-700">{fmt(valorEutanasia)}</span>
                      </div>
                    ) : (
                      <p className="text-[12px] text-amber-600">Indica el peso de la mascota (paso anterior) para calcular el valor.</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL}>Fecha</label>
                        <Input type="date" value={eutanasiaFecha} onChange={e => setEutanasiaFecha(e.target.value)} />
                      </div>
                      <div>
                        <label className={LABEL}>Hora</label>
                        <Input type="time" value={eutanasiaHora} onChange={e => setEutanasiaHora(e.target.value)} />
                      </div>
                      <div>
                        <label className={LABEL}>Veterinario <span className="font-normal text-gray-400">(opcional)</span></label>
                        <Select value={eutanasiaVetId} onChange={e => setEutanasiaVetId(e.target.value)}>
                          <option value="">Sin asignar…</option>
                          {veterinarios.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                        </Select>
                      </div>
                      <div>
                        <label className={LABEL}>Valor ($) <span className="font-normal text-gray-400">auto por peso</span></label>
                        <Input type="number" placeholder={precioEutanasiaAuto != null ? String(precioEutanasiaAuto) : 'Valor'}
                          value={eutanasiaValorManual} onChange={e => setEutanasiaValorManual(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
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

            {(esHorarioNocturno || recargoNocturnoNum > 0) && (
              <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5">
                <div className="flex items-start gap-2 mb-2.5">
                  <Clock size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-bold text-amber-800">Servicio en horario nocturno</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Es después de las 9:00 PM — aplica recargo nocturno. Ingresa el valor acordado.
                    </p>
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Valor recargo nocturno ($)</label>
                  <Input
                    type="number" min="0" placeholder="0"
                    value={recargoNocturno || ''}
                    onChange={e => setRecargoNocturno(e.target.value)}
                  />
                </div>
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
                    {ciudadesList.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label className={LABEL}>Barrio</label>
                  <Input value={formRecogida.barrio_recogida} placeholder="BARRIO O LOCALIDAD"
                    onChange={e => setFormRecogida(p => ({ ...p, barrio_recogida: e.target.value.toUpperCase() }))} />
                </div>
              </div>

              {/* La ciudad que traía el registro del aliado (o el cliente, o la IA)
                  no corresponde a ninguna tarifa. Antes esto valía $0 en silencio
                  y el selector seguía mostrando "Bogotá": el coordinador no tenía
                  cómo enterarse de que no se estaba cobrando el transporte. */}
              {ciudadSinTarifa && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3">
                  <div className="text-[12px] font-bold text-amber-800 mb-1">
                    ⚠️ "{formRecogida.ciudad_recogida}" no tiene tarifa de transporte
                  </div>
                  <p className="text-[11px] text-amber-700 leading-snug">
                    Este servicio se va a guardar <b>sin cobrar transporte</b>. Si la recogida es
                    fuera de Bogotá, elige el municipio en la lista de arriba; si el municipio no
                    aparece, hay que crear su tarifa en Configuración.
                  </p>
                </div>
              )}

              {/* Recargo transporte fuera de Bogotá */}
              {ciudadInfo && ciudadInfo.value !== 'Bogotá' && (
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
                          <span className="ml-1 text-[10px]">+{fmt(v === 'MOTO' ? ciudadInfo.tarifa_moto : ciudadInfo.tarifa_camioneta)}</span>
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
                  onChange={e => setFormRecogida(p => ({ ...p, direccion_recogida: e.target.value.toUpperCase() }))} />
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
                  <Input value={formRecogida.nombre_contacto_recogida} placeholder="QUIEN ENTREGA LA MASCOTA"
                    onChange={e => setFormRecogida(p => ({ ...p, nombre_contacto_recogida: e.target.value.toUpperCase() }))} />
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
                  <div>
                    <div className="flex items-center gap-2 px-3 py-2 border border-[#1A5CD8] rounded-lg bg-green-50">
                      <Avatar nombre={tecnicoSeleccionado.nombre} apellido={tecnicoSeleccionado.apellido} size={6} />
                      <span className="text-[13px] font-medium text-gray-900 flex-1">{tecnicoSeleccionado.nombre} {tecnicoSeleccionado.apellido}</span>
                      <button className="text-gray-400 hover:text-red-500"
                        onClick={() => { setTecnicoSeleccionado(null); setTecnicoBusqueda('') }}><X size={14} /></button>
                    </div>
                    {/* Indicador notificación WA */}
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px]"
                      style={{ color: tecnicoSeleccionado.whatsapp ? '#15803D' : '#9CA3AF' }}>
                      <MessageSquare size={11} />
                      {tecnicoSeleccionado.whatsapp
                        ? `Se enviará notificación automática al WhatsApp del técnico (${tecnicoSeleccionado.whatsapp})`
                        : 'Sin WhatsApp registrado — no se enviará notificación automática'}
                    </div>
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
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-amber-600 min-w-0 break-words">
                        - Comisión {comisionPorcentaje}% · {aliadoSeleccionado?.nombre}
                      </span>
                      <span className="font-medium text-amber-600 shrink-0">- {fmt(comisionMonto)}</span>
                    </div>
                  )}
                  {recargoCiudad > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-blue-600">+ Recargo transporte ({vehiculoTipo.toLowerCase()})</span>
                      <span className="font-medium text-blue-600">+ {fmt(recargoCiudad)}</span>
                    </div>
                  )}
                  {recargoNocturnoNum > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-amber-600">+ Recargo nocturno 🌙</span>
                      <span className="font-medium text-amber-600">+ {fmt(recargoNocturnoNum)}</span>
                    </div>
                  )}
                  {valorEutanasia > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-rose-600">+ Eutanasia compasiva 🕊️</span>
                      <span className="font-medium text-rose-600">+ {fmt(valorEutanasia)}</span>
                    </div>
                  )}
                  {descuentoAdicionalNum > 0 && (
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-orange-600 min-w-0 truncate">
                        - Descuento{descuentoAdicionalMotivo ? `: ${descuentoAdicionalMotivo}` : ' adicional'}
                      </span>
                      <span className="font-medium text-orange-600 shrink-0">- {fmt(descuentoAdicionalNum)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-1.5">
                    <span className="text-[13px] font-bold text-gray-900">Valor a cobrar</span>
                    <span className="text-[16px] font-bold text-[#1A5CD8]">{fmt(valorCobrado)}</span>
                  </div>
                </div>

                {/* Descuento adicional opcional */}
                <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50/60 p-3">
                  <p className="text-[11px] font-bold text-orange-700 mb-2">Descuento adicional <span className="font-normal text-orange-500">(opcional)</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={LABEL}>Valor ($)</label>
                      <Input type="number" min="0" placeholder="0"
                        value={descuentoAdicional || ''}
                        onChange={e => setDescuentoAdicional(e.target.value)} />
                    </div>
                    <div>
                      <label className={LABEL}>Motivo / descripción</label>
                      <Input placeholder="Ej: acuerdo comercial, cortesía..."
                        value={descuentoAdicionalMotivo}
                        onChange={e => setDescuentoAdicionalMotivo(e.target.value)} />
                    </div>
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
              <div className="font-bold text-gray-900 mb-4 text-[13px] uppercase tracking-wider text-[#1A5CD8]">Resumen</div>
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
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-amber-600 min-w-0 truncate">Comisión aliado ({comisionPorcentaje}%)</span>
                      <span className="text-amber-600 shrink-0">- {fmt(comisionMonto)}</span>
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
                  {recargoNocturnoNum > 0 && (
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="text-amber-600">Recargo nocturno 🌙</span>
                      <span className="text-amber-600">+ {fmt(recargoNocturnoNum)}</span>
                    </div>
                  )}
                  {descuentoAdicionalNum > 0 && (
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-orange-600 min-w-0 truncate">Descuento{descuentoAdicionalMotivo ? `: ${descuentoAdicionalMotivo}` : ' adicional'}</span>
                      <span className="text-orange-600 shrink-0">- {fmt(descuentoAdicionalNum)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-gray-700">Valor a cobrar</span>
                    <span className="font-bold text-[#1A5CD8] text-[16px]">{fmt(valorCobrado)}</span>
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
        <div className="flex justify-between mt-4 sm:mt-5 gap-3">
          <Button variant="secondary" size="lg" className="flex-1 sm:flex-none"
            onClick={() => paso > 0 ? setPaso(p => p - 1) : navigate('/kanban')}
            disabled={saving}>
            <ChevronLeft size={16} />
            {paso === 0 ? 'Cancelar' : 'Anterior'}
          </Button>
          {paso < PASOS.length - 1 ? (
            <Button size="lg" className="flex-1 sm:flex-none"
              onClick={() => {
                // Validar campos del paso actual antes de avanzar
                if (paso === 0 && clienteNuevo) {
                  const campos = { nombre: formCliente.nombre, whatsapp: formCliente.whatsapp, telefono: formCliente.telefono, telefono2: formCliente.telefono2, email: formCliente.email }
                  let hayErr = false
                  const newToc = { ...tocReg }; const newErr = { ...errReg }
                  Object.entries(campos).forEach(([k, v]) => {
                    newToc[k] = true
                    const e = REGLAS_REG[k]?.(v) ?? null
                    newErr[k] = e
                    if (e) hayErr = true
                  })
                  setTocReg(newToc); setErrReg(newErr)
                  if (hayErr) return
                }
                if (paso === 1 && mascotaNueva) {
                  const campos = { mascota_nombre: formMascota.nombre, peso_kg: formMascota.peso_kg }
                  let hayErr = false
                  const newToc = { ...tocReg }; const newErr = { ...errReg }
                  Object.entries(campos).forEach(([k, v]) => {
                    newToc[k] = true
                    const e = REGLAS_REG[k]?.(v) ?? null
                    newErr[k] = e
                    if (e) hayErr = true
                  })
                  setTocReg(newToc); setErrReg(newErr)
                  if (hayErr) return
                }
                if (!canNext[paso]?.()) return
                setPaso(p => p + 1)
              }}>
              Siguiente <ChevronRight size={16} />
            </Button>
          ) : (
            <Button onClick={guardar} disabled={saving} size="lg" className="flex-1 sm:flex-none">
              {saving ? <><Spinner size={14} /> Guardando...</> : <><CheckCircle size={16} /> Guardar servicio</>}
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
