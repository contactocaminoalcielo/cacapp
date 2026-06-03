import { useState, useEffect, useRef } from 'react'
import { db } from '@/lib/supabase'
import { fmt, today, petEmoji } from '@/lib/utils'
import { CheckCircle, ChevronRight, ChevronLeft, MapPin, Building2, Clock, AlertCircle, X, ChevronDown, ChevronUp, Package, Smartphone, Leaf, ExternalLink, Truck } from 'lucide-react'
import { LocalidadSelect } from '@/components/ui/localidad-select'

// ── Anti-spam ───────────────────────────────────────────────────────────────
const RATE_LIMIT_KEY = 'cac_solicitud_ts'
const RATE_LIMIT_MS  = 20 * 60 * 1000

// ── URL catálogo externo (dejar vacío si no hay) ─────────────────────────────
const URL_CATALOGO = ''  // ej: 'https://www.instagram.com/caminoalcielo/'

// ── Planes excluidos del formulario público ───────────────────────────────────
// Presequiales (afiliación) + exclusivos de veterinaria
const CODIGOS_EXCLUIDOS = new Set([
  'BRONCE', 'PLATA', 'ORO_EXCLUSIVO', 'DIAMANTE', 'VITALICIO',
  'DESAMPARADO', 'ANGEL',
])

// ── Ciudades con recargo de transporte ───────────────────────────────────────
const CIUDADES = [
  { value: 'Bogotá',     label: 'Bogotá',              recargo: { min: 0,     max: 0     } },
  { value: 'Soacha',     label: 'Soacha',               recargo: { min: 12000, max: 20000 } },
  { value: 'Chía',       label: 'Chía',                 recargo: { min: 18000, max: 30000 } },
  { value: 'Cajicá',     label: 'Cajicá',               recargo: { min: 20000, max: 35000 } },
  { value: 'Zipaquirá',  label: 'Zipaquirá',            recargo: { min: 28000, max: 45000 } },
  { value: 'Facatativá', label: 'Facatativá',           recargo: { min: 28000, max: 45000 } },
  { value: 'La Calera',  label: 'La Calera',            recargo: { min: 22000, max: 35000 } },
  { value: 'Sopó',       label: 'Sopó',                 recargo: { min: 22000, max: 35000 } },
  { value: 'Madrid',     label: 'Madrid',               recargo: { min: 22000, max: 35000 } },
  { value: 'Mosquera',   label: 'Mosquera',             recargo: { min: 22000, max: 35000 } },
  { value: 'Funza',      label: 'Funza',                recargo: { min: 22000, max: 35000 } },
  { value: 'Tabio',      label: 'Tabio',                recargo: { min: 30000, max: 50000 } },
  { value: 'Otro',       label: 'Otro municipio',       recargo: { min: 40000, max: 60000 } },
]

// ── Categorías de items ───────────────────────────────────────────────────────
const CAT = {
  fisico:    { label: 'Artículos físicos',  icon: Package,     color: '#92400E', bg: '#FEF3C7' },
  digital:   { label: 'Artículos digitales', icon: Smartphone,  color: '#1D4ED8', bg: '#DBEAFE' },
  ceremonia: { label: 'Ceremonia',           icon: Leaf,        color: '#065F46', bg: '#D1FAE5' },
}

// ── Borrador ────────────────────────────────────────────────────────────────
const DRAFT_KEY = 'cac_solicitud_borrador'
const DRAFT_TTL = 48 * 60 * 60 * 1000

function cargarBorrador() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > DRAFT_TTL) { localStorage.removeItem(DRAFT_KEY); return null }
    return data
  } catch { return null }
}
function limpiarBorrador() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ── Rango de peso ────────────────────────────────────────────────────────────
function getRango(pesoKg, especieId) {
  if (!pesoKg || pesoKg <= 0) return null
  if (pesoKg < 1) return 'PETIT'
  if (especieId === 2 || especieId === 3) return 'FELINO'  // Gato (2) o Conejo (3)
  if (pesoKg <= 10) return '1-10KG'
  if (pesoKg <= 20) return '11-20KG'
  if (pesoKg <= 35) return '21-35KG'
  return '36-60KG'
}

// ── Validaciones ─────────────────────────────────────────────────────────────
function validarTelefono(v, requerido = false) {
  const val = (v || '').trim()
  if (!val) return requerido ? 'Este campo es requerido' : null
  if (val.startsWith('+') || val.startsWith('00')) {
    const prefix = val.startsWith('+') ? val.slice(1) : val.slice(2)
    const digits = prefix.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15)
      return 'Número internacional inválido — ej: +1 555 1234567'
    return null
  }
  const digits = val.replace(/\D/g, '')
  if (digits.length !== 10)
    return 'Debe tener 10 dígitos — ej: 3001234567'
  if (!digits.startsWith('3'))
    return 'Los celulares colombianos empiezan por 3'
  return null
}

const REGLAS = {
  // Paso 0
  nombre:    v => !v?.trim() ? 'El nombre es requerido' : v.trim().length < 2 ? 'Mínimo 2 caracteres' : null,
  apellido:  v => v?.trim() && v.trim().length < 2 ? 'Mínimo 2 caracteres' : null,
  whatsapp:  v => validarTelefono(v, true),
  telefono:  v => validarTelefono(v, false),
  telefono2: v => validarTelefono(v, false),
  email:     v => v?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
               ? 'Correo inválido — ej: nombre@dominio.com' : null,
  direccion: v => !v?.trim() ? 'La dirección es requerida' : v.trim().length < 5 ? 'Ingresa la dirección completa' : null,
  // Paso 1
  mascota_nombre: v => !v?.trim() ? 'El nombre de la mascota es requerido' : null,
  especie_id:     v => !v ? 'Selecciona la especie' : null,
  peso_kg: v => {
    if (!v) return 'El peso es requerido'
    const n = parseFloat(String(v).replace(',', '.'))
    if (isNaN(n) || n <= 0) return 'Ingresa un peso válido mayor a 0'
    if (n > 100) return '¿Está en kg? El peso parece muy alto'
    return null
  },
  // Paso 3
  recogida_direccion: v => !v?.trim() ? 'La dirección de recogida es requerida' : v.trim().length < 5 ? 'Ingresa la dirección completa' : null,
}

// Campos obligatorios por paso
const CAMPOS_PASO = {
  0: ['nombre', 'whatsapp', 'direccion'],
  1: ['mascota_nombre', 'especie_id', 'peso_kg'],
  2: [],
  3: [],
}

const PASOS = ['Propietario', 'Mascota', 'Plan', 'Recogida']
const LABEL  = 'block text-[12px] font-semibold text-gray-600 mb-1'
const SEXOS  = [{ v: 'Macho', e: '♂' }, { v: 'Hembra', e: '♀' }]

// ── Componente mensaje de error ───────────────────────────────────────────────
function ErrMsg({ msg }) {
  if (!msg) return null
  return (
    <div className="flex items-start gap-1.5 mt-1.5">
      <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
      <p className="text-[11px] text-red-600 font-medium leading-tight">{msg}</p>
    </div>
  )
}

export default function SolicitudCliente() {
  const borrador = cargarBorrador()
  const formRef  = useRef(null)

  const [paso,        setPaso]        = useState(borrador?.paso ?? 0)
  const [submitting,  setSubmitting]  = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [error,       setError]       = useState('')
  const [haiBorrador, setHayBorrador] = useState(!!borrador)

  // Validación
  const [errores,  setErrores]  = useState({})
  const [tocados,  setTocados]  = useState({})

  // Catálogos
  const [especies,   setEspecies]   = useState([])
  const [planes,     setPlanes]     = useState([])
  const [precios,    setPrecios]    = useState([])
  const [aliados,    setAliados]    = useState([])
  const [planItems,  setPlanItems]  = useState({})   // { plan_id: [{nombre,categoria,cantidad}] }
  const [expandedPlan, setExpandedPlan] = useState(null) // plan_id expandido
  const [busqVet,    setBusqVet]    = useState('')

  const DEFAULT_CLIENTE  = { nombre:'', apellido:'', cedula_nit:'', whatsapp:'', telefono:'', telefono2:'', email:'', ciudad:'Bogotá', localidad:'', barrio:'', direccion:'' }
  const DEFAULT_MASCOTA  = { nombre:'', especie_id:'', sexo:'', peso_kg:'', raza:'' }
  const DEFAULT_RECOGIDA = { tipo:'domicilio', ciudad:'Bogotá', localidad:'', barrio:'', direccion:'', aliado_id:'', aliado_nombre_otro:'', hora_aproximada:'', notas:'' }

  const [cliente,  setCliente]  = useState({ ...DEFAULT_CLIENTE,  ...(borrador?.cliente  ?? {}) })
  const [mascota,  setMascota]  = useState({ ...DEFAULT_MASCOTA,  ...(borrador?.mascota  ?? {}) })
  const [planId,   setPlanId]   = useState(borrador?.planId ?? '')
  const [recogida, setRecogida] = useState({ ...DEFAULT_RECOGIDA, ...(borrador?.recogida ?? {}) })
  const [hp, setHp] = useState('')

  // Auto-guardado
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        ts: Date.now(),
        data: { paso, cliente, mascota, planId, recogida },
      }))
    } catch {}
  }, [paso, cliente, mascota, planId, recogida])

  useEffect(() => {
    Promise.all([
      db.from('especies').select('id,nombre').order('nombre'),
      db.from('planes').select('id,nombre,codigo,tipo_proceso,descripcion').order('nombre'),
      db.from('planes_precios').select('plan_id,rango_nombre,precio'),
      db.from('aliados').select('id_aliado,nombre,ciudad').eq('activo', true).order('nombre'),
      db.from('plan_recordatorios').select('plan_id,cantidad,recordatorios(nombre,categoria)').order('recordatorios(categoria)'),
    ]).then(([e, p, pr, a, pi]) => {
      setEspecies(e.data || [])
      const planesPublicos = (p.data || []).filter(pl => !CODIGOS_EXCLUIDOS.has(pl.codigo))
      setPlanes(planesPublicos)
      setPrecios(pr.data || [])
      setAliados(a.data || [])
      // Agrupar items por plan_id
      const map = {}
      ;(pi.data || []).forEach(row => {
        if (!row.recordatorios) return
        if (!map[row.plan_id]) map[row.plan_id] = []
        map[row.plan_id].push({
          nombre:   row.recordatorios.nombre,
          categoria: row.recordatorios.categoria || 'fisico',
          cantidad:  row.cantidad || 1,
        })
      })
      setPlanItems(map)
    })
  }, [])

  // ── Helpers de validación ─────────────────────────────────────────────────
  function vld(campo, valor) {
    const err = REGLAS[campo]?.(valor) ?? null
    setErrores(p => ({ ...p, [campo]: err }))
    return err
  }

  function tocar(campo, valor) {
    setTocados(p => ({ ...p, [campo]: true }))
    vld(campo, valor)
  }

  // Devuelve la clase CSS del input según si tiene error o está válido
  function ic(campo) {
    const base = 'w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border rounded-xl outline-none focus:ring-2 transition-all placeholder:text-gray-400 placeholder:font-normal'
    if (!tocados[campo]) return `${base} border-gray-200 focus:border-[#3D5A27] focus:ring-[#3D5A27]/10`
    if (errores[campo])  return `${base} border-red-400 bg-red-50/40 focus:border-red-500 focus:ring-red-400/15`
    return `${base} border-green-400 focus:border-green-500 focus:ring-green-400/15`
  }

  // ── Precio estimado ──────────────────────────────────────────────────────
  function getPrecio(pid) {
    if (!pid || !mascota.peso_kg) return null
    const rango = getRango(parseFloat(mascota.peso_kg), parseInt(mascota.especie_id))
    if (!rango) return null
    return precios.find(p => p.plan_id === pid && p.rango_nombre === rango)?.precio ?? null
  }

  // ── Avanzar con validación ────────────────────────────────────────────────
  function avanzar() {
    // Validar todos los campos del paso actual
    let hayError = false
    const nuevosErrores = { ...errores }
    const nuevosTocados = { ...tocados }

    if (paso === 0) {
      const campos = {
        nombre: cliente.nombre, whatsapp: cliente.whatsapp, direccion: cliente.direccion,
        apellido: cliente.apellido, email: cliente.email,
        telefono: cliente.telefono, telefono2: cliente.telefono2,
      }
      Object.entries(campos).forEach(([k, v]) => {
        nuevosTocados[k] = true
        const e = REGLAS[k]?.(v) ?? null
        nuevosErrores[k] = e
        if (e) hayError = true
      })
    }

    if (paso === 1) {
      const campos = {
        mascota_nombre: mascota.nombre,
        especie_id: mascota.especie_id,
        peso_kg: mascota.peso_kg,
      }
      Object.entries(campos).forEach(([k, v]) => {
        nuevosTocados[k] = true
        const e = REGLAS[k]?.(v) ?? null
        nuevosErrores[k] = e
        if (e) hayError = true
      })
    }

    if (paso === 2 && !planId) {
      hayError = true
      setError('Selecciona un plan para continuar.')
      return
    }

    if (paso === 3) {
      if (recogida.tipo === 'domicilio') {
        nuevosTocados['recogida_direccion'] = true
        const e = REGLAS.recogida_direccion?.(recogida.direccion) ?? null
        nuevosErrores['recogida_direccion'] = e
        if (e) hayError = true
      } else {
        if (!recogida.aliado_id && !recogida.aliado_nombre_otro.trim()) {
          hayError = true
          setError('Indica en qué veterinaria se realizará la recogida.')
          setErrores({ ...nuevosErrores }); setTocados({ ...nuevosTocados }); return
        }
      }
    }

    setErrores(nuevosErrores)
    setTocados(nuevosTocados)

    if (hayError) {
      // Scroll al primer error
      setTimeout(() => {
        formRef.current?.querySelector('.border-red-400')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
      return
    }

    setError('')
    setPaso(p => p + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function enviar() {
    if (hp) { setSubmitted(true); return }
    const lastTs = localStorage.getItem(RATE_LIMIT_KEY)
    if (lastTs && Date.now() - parseInt(lastTs) < RATE_LIMIT_MS) {
      setError('Ya enviaste una solicitud recientemente. Por favor espera unos minutos.')
      return
    }
    setSubmitting(true); setError('')
    try {
      const t = s => (s ?? '').trim()
      const { error: err } = await db.from('solicitudes_servicio').insert({
        cliente_nombre:      t(cliente.nombre),
        cliente_apellido:    t(cliente.apellido)   || null,
        cliente_cedula:      t(cliente.cedula_nit) || null,
        cliente_whatsapp:    (cliente.whatsapp ?? '').replace(/\D/g, ''),
        cliente_telefono:    t(cliente.telefono)   || null,
        cliente_telefono2:   t(cliente.telefono2)  || null,
        cliente_email:       t(cliente.email)      || null,
        cliente_ciudad:      t(cliente.ciudad)     || null,
        cliente_localidad:   t(cliente.localidad)  || null,
        cliente_barrio:      t(cliente.barrio)     || null,
        cliente_direccion:   t(cliente.direccion)  || null,
        mascota_nombre:      t(mascota.nombre),
        especie_id:          parseInt(mascota.especie_id) || null,
        mascota_peso_kg:     parseFloat(mascota.peso_kg)  || null,
        mascota_sexo:        mascota.sexo || null,
        mascota_raza:        t(mascota.raza) || null,
        plan_id:             planId || null,
        tipo_recogida:       recogida.tipo,
        aliado_id:           recogida.aliado_id || null,
        aliado_nombre_otro:  t(recogida.aliado_nombre_otro) || null,
        ciudad:              recogida.ciudad || 'Bogotá',
        localidad:           recogida.localidad || null,
        barrio:              t(recogida.barrio) || null,
        direccion:           recogida.tipo === 'domicilio' ? t(recogida.direccion) : null,
        hora_aproximada:     recogida.hora_aproximada || null,
        notas_cliente:       recogida.notas.trim() || null,
      })
      if (err) throw err
      localStorage.setItem(RATE_LIMIT_KEY, Date.now().toString())
      limpiarBorrador()
      setSubmitted(true)
    } catch (e) {
      console.error('[SolicitudCliente]', e)
      setError('Hubo un error al enviar. Por favor intenta de nuevo o comunícate con nosotros.')
    } finally {
      setSubmitting(false)
    }
  }

  const vetsFiltradas = aliados.filter(a =>
    !busqVet || a.nombre.toLowerCase().includes(busqVet.toLowerCase())
  ).slice(0, 8)

  // ── Success ───────────────────────────────────────────────────────────────
  if (submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#F0F7EB] to-white">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5 animate-bounce">
        <CheckCircle size={40} className="text-green-600" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">¡Solicitud enviada!</h1>
      <p className="text-gray-500 text-center text-[15px] max-w-xs leading-relaxed">
        Recibimos tu información. Un miembro de nuestro equipo te contactará pronto al WhatsApp que dejaste para coordinar todos los detalles.
      </p>
      <p className="mt-6 text-[13px] text-gray-400">Camino al Cielo 🌿</p>
    </div>
  )

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F0F7EB] to-white flex flex-col">
      {/* Header */}
      <div className="px-5 pt-8 pb-4 text-center">
        <div className="text-[13px] font-bold tracking-widest text-[#3D5A27] uppercase mb-1">Camino al Cielo</div>
        <h1 className="text-[22px] font-bold text-gray-900 leading-tight">Solicitud de servicio</h1>
        <p className="text-[13px] text-gray-500 mt-1">Cuéntanos sobre tu mascota y te contactamos</p>
      </div>

      {/* Banner borrador */}
      {haiBorrador && (
        <div className="mx-5 mb-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl"
          style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <span className="text-[12px] text-blue-700 font-medium">📋 Continuando donde lo dejaste</span>
          <button onClick={() => {
            limpiarBorrador(); setPaso(0)
            setCliente({ ...DEFAULT_CLIENTE }); setMascota({ ...DEFAULT_MASCOTA })
            setPlanId(''); setRecogida({ ...DEFAULT_RECOGIDA })
            setErrores({}); setTocados({}); setHayBorrador(false)
          }} className="text-[11px] font-semibold text-blue-500 underline shrink-0">
            Empezar de cero
          </button>
        </div>
      )}

      {/* Steps */}
      <div className="flex items-center justify-center gap-1 px-6 mb-6">
        {PASOS.map((label, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
              i < paso ? 'bg-[#3D5A27] text-white' : i === paso ? 'bg-[#3D5A27] text-white ring-4 ring-[#3D5A27]/20' : 'bg-gray-200 text-gray-400'
            }`}>{i < paso ? '✓' : i + 1}</div>
            {i < PASOS.length - 1 && <div className={`w-6 h-0.5 rounded ${i < paso ? 'bg-[#3D5A27]' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Form */}
      <div ref={formRef} className="flex-1 px-5 pb-6 max-w-md mx-auto w-full">
        <input type="text" name="website" value={hp} onChange={e => setHp(e.target.value)}
          style={{ opacity: 0, position: 'absolute', height: 0, pointerEvents: 'none' }} tabIndex={-1} />

        {/* ── PASO 0: Propietario ───────────────────────────────────────── */}
        {paso === 0 && (
          <div className="space-y-4">
            {/* Datos personales */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Datos personales</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Nombre *</label>
                    <input className={ic('nombre')} placeholder="María" value={cliente.nombre}
                      onChange={e => {
                        const v = e.target.value
                        setCliente(p => ({ ...p, nombre: v }))
                        if (tocados.nombre) vld('nombre', v)
                      }}
                      onBlur={e => tocar('nombre', e.target.value)} />
                    <ErrMsg msg={tocados.nombre && errores.nombre} />
                  </div>
                  <div>
                    <label className={LABEL}>Apellido</label>
                    <input className={ic('apellido')} placeholder="González" value={cliente.apellido}
                      onChange={e => {
                        const v = e.target.value
                        setCliente(p => ({ ...p, apellido: v }))
                        if (tocados.apellido) vld('apellido', v)
                      }}
                      onBlur={e => tocar('apellido', e.target.value)} />
                    <ErrMsg msg={tocados.apellido && errores.apellido} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Cédula / Documento <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400"
                    placeholder="1234567890" value={cliente.cedula_nit}
                    inputMode="numeric"
                    onChange={e => setCliente(p => ({ ...p, cedula_nit: e.target.value.replace(/\D/g,'') }))} />
                </div>
              </div>
            </div>

            {/* Contacto */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Contacto</p>
              <div className="space-y-3">
                <div>
                  <label className={LABEL}>WhatsApp *</label>
                  <input className={ic('whatsapp')} placeholder="3001234567" value={cliente.whatsapp}
                    inputMode="tel" maxLength={25}
                    onChange={e => {
                      const v = e.target.value
                      setCliente(p => ({ ...p, whatsapp: v }))
                      if (tocados.whatsapp) vld('whatsapp', v)
                    }}
                    onBlur={e => tocar('whatsapp', e.target.value)} />
                  {tocados.whatsapp && errores.whatsapp
                    ? <ErrMsg msg={errores.whatsapp} />
                    : <p className="text-[11px] text-gray-400 mt-1">Colombia: 3XX XXX XXXX · Internacional: +1 555 1234</p>
                  }
                </div>
                <div>
                  <label className={LABEL}>Segundo contacto <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className={ic('telefono')} placeholder="3XX XXX XXXX · +57 601 1234" value={cliente.telefono}
                    inputMode="tel" maxLength={25}
                    onChange={e => {
                      const v = e.target.value
                      setCliente(p => ({ ...p, telefono: v }))
                      if (tocados.telefono) vld('telefono', v)
                    }}
                    onBlur={e => tocar('telefono', e.target.value)} />
                  <ErrMsg msg={tocados.telefono && errores.telefono} />
                </div>
                <div>
                  <label className={LABEL}>Tercer contacto <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className={ic('telefono2')} placeholder="3XX XXX XXXX · +34 612 345 678" value={cliente.telefono2}
                    inputMode="tel" maxLength={25}
                    onChange={e => {
                      const v = e.target.value
                      setCliente(p => ({ ...p, telefono2: v }))
                      if (tocados.telefono2) vld('telefono2', v)
                    }}
                    onBlur={e => tocar('telefono2', e.target.value)} />
                  <ErrMsg msg={tocados.telefono2 && errores.telefono2} />
                </div>
                <div>
                  <label className={LABEL}>Correo electrónico <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className={ic('email')} type="email" placeholder="correo@ejemplo.com" value={cliente.email}
                    onChange={e => {
                      const v = e.target.value
                      setCliente(p => ({ ...p, email: v }))
                      if (tocados.email) vld('email', v)
                    }}
                    onBlur={e => tocar('email', e.target.value)} />
                  <ErrMsg msg={tocados.email && errores.email} />
                </div>
              </div>
            </div>

            {/* Dirección */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Dirección de residencia</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Ciudad</label>
                    <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all"
                      value={cliente.ciudad}
                      onChange={e => setCliente(p => ({ ...p, ciudad: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL}>Localidad</label>
                    <LocalidadSelect value={cliente.localidad}
                      onChange={v => setCliente(p => ({ ...p, localidad: v }))}
                      placeholder="Seleccionar…" />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Barrio</label>
                  <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400"
                    placeholder="Nombre del barrio" value={cliente.barrio}
                    onChange={e => setCliente(p => ({ ...p, barrio: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>Dirección exacta *</label>
                  <input className={ic('direccion')} placeholder="Calle 45 # 12-34" value={cliente.direccion}
                    onChange={e => {
                      const v = e.target.value
                      setCliente(p => ({ ...p, direccion: v }))
                      if (tocados.direccion) vld('direccion', v)
                    }}
                    onBlur={e => tocar('direccion', e.target.value)} />
                  <ErrMsg msg={tocados.direccion && errores.direccion} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PASO 1: Mascota ──────────────────────────────────────────── */}
        {paso === 1 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Datos de tu mascota</p>
              <div className="space-y-3">
                <div>
                  <label className={LABEL}>Nombre de la mascota *</label>
                  <input className={ic('mascota_nombre')} placeholder="Luna, Max, etc." value={mascota.nombre}
                    onChange={e => {
                      const v = e.target.value
                      setMascota(p => ({ ...p, nombre: v }))
                      if (tocados.mascota_nombre) vld('mascota_nombre', v)
                    }}
                    onBlur={e => tocar('mascota_nombre', e.target.value)} />
                  <ErrMsg msg={tocados.mascota_nombre && errores.mascota_nombre} />
                </div>

                <div>
                  <label className={LABEL}>Especie *</label>
                  <div className={`grid grid-cols-3 gap-2 p-2 rounded-xl transition-all ${
                    tocados.especie_id && errores.especie_id ? 'bg-red-50/40 ring-1 ring-red-400' : ''
                  }`}>
                    {especies.map(esp => (
                      <button key={esp.id} type="button"
                        onClick={() => { setMascota(p => ({ ...p, especie_id: String(esp.id) })); tocar('especie_id', String(esp.id)) }}
                        className={`py-2.5 rounded-xl text-[12px] font-semibold border transition-all flex flex-col items-center gap-0.5 ${
                          mascota.especie_id === String(esp.id)
                            ? 'border-[#3D5A27] bg-[#F0F7EB] text-[#3D5A27]'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>
                        <span className="text-xl">{petEmoji(esp.nombre)}</span>
                        <span>{esp.nombre}</span>
                      </button>
                    ))}
                  </div>
                  <ErrMsg msg={tocados.especie_id && errores.especie_id} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Sexo <span className="font-normal text-gray-400">(opcional)</span></label>
                    <div className="flex gap-2">
                      {SEXOS.map(s => (
                        <button key={s.v} type="button"
                          onClick={() => setMascota(p => ({ ...p, sexo: s.v }))}
                          className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                            mascota.sexo === s.v ? 'border-[#3D5A27] bg-[#F0F7EB] text-[#3D5A27]' : 'border-gray-200 text-gray-400'
                          }`}>
                          {s.e} {s.v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>Peso aprox. (kg) *</label>
                    <input className={ic('peso_kg')} placeholder="4.5" value={mascota.peso_kg}
                      inputMode="decimal"
                      onChange={e => {
                        const v = e.target.value.replace(',', '.')
                        setMascota(p => ({ ...p, peso_kg: v }))
                        if (tocados.peso_kg) vld('peso_kg', v)
                      }}
                      onBlur={e => tocar('peso_kg', e.target.value)} />
                    <ErrMsg msg={tocados.peso_kg && errores.peso_kg} />
                  </div>
                </div>

                <div>
                  <label className={LABEL}>Raza <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400"
                    placeholder="Labrador, Persa, etc." value={mascota.raza}
                    onChange={e => setMascota(p => ({ ...p, raza: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PASO 2: Plan ─────────────────────────────────────────────── */}
        {paso === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-[13px] font-bold text-gray-700">Selecciona el plan</p>
              {URL_CATALOGO && (
                <a href={URL_CATALOGO} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#3D5A27] underline underline-offset-2">
                  <ExternalLink size={11} /> Ver catálogo completo
                </a>
              )}
            </div>

            {!mascota.peso_kg && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700">
                <AlertCircle size={14} />
                Ingresa el peso de tu mascota para ver precios estimados
              </div>
            )}

            {planes.map(plan => {
              const precio  = getPrecio(plan.id)
              const activo  = planId === plan.id
              const items   = planItems[plan.id] || []
              const abierto = expandedPlan === plan.id

              // Agrupar items por categoría
              const grupos = {}
              items.forEach(it => {
                const cat = it.categoria || 'fisico'
                if (!grupos[cat]) grupos[cat] = []
                grupos[cat].push(it)
              })
              const catOrden = ['fisico', 'digital', 'ceremonia']
              const totalItems = items.length

              return (
                <div key={plan.id}
                  className={`rounded-2xl border-2 transition-all overflow-hidden ${
                    activo ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-white'
                  }`}>

                  {/* Cabecera del plan — clickeable para seleccionar */}
                  <button type="button" onClick={() => { setPlanId(plan.id); setError('') }}
                    className="w-full text-left p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className={`text-[15px] font-bold leading-tight ${activo ? 'text-[#3D5A27]' : 'text-gray-800'}`}>
                          {plan.nombre}
                        </div>
                        {plan.descripcion && (
                          <p className="text-[12px] text-gray-500 leading-snug mt-1">{plan.descripcion}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {precio != null ? (
                          <div className={`text-[16px] font-bold ${activo ? 'text-[#3D5A27]' : 'text-gray-700'}`}>
                            {fmt(precio)}
                          </div>
                        ) : mascota.peso_kg ? (
                          <span className="text-[11px] text-gray-400">Por consultar</span>
                        ) : null}
                        {activo && (
                          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] font-semibold text-[#3D5A27]">
                            <CheckCircle size={11} /> Seleccionado
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Resumen de categorías (chips) */}
                    {totalItems > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {catOrden.filter(c => grupos[c]?.length).map(c => {
                          const cfg = CAT[c] || CAT.fisico
                          const Icon = cfg.icon
                          return (
                            <span key={c}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ background: cfg.bg, color: cfg.color }}>
                              <Icon size={10} /> {grupos[c].length} {cfg.label.split(' ')[1] || cfg.label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </button>

                  {/* Botón expandir artículos */}
                  {totalItems > 0 && (
                    <div className="border-t" style={{ borderColor: activo ? '#BBF7D0' : '#F3F4F6' }}>
                      <button type="button"
                        onClick={e => { e.stopPropagation(); setExpandedPlan(abierto ? null : plan.id) }}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-black/5"
                        style={{ color: activo ? '#065F46' : '#6B7280' }}>
                        <span className="text-[12px] font-semibold flex items-center gap-1.5">
                          {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          {abierto ? 'Ocultar artículos' : `Ver ${totalItems} artículo${totalItems !== 1 ? 's' : ''} incluidos`}
                        </span>
                        {URL_CATALOGO && (
                          <a href={URL_CATALOGO} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[11px] font-semibold flex items-center gap-1 underline underline-offset-2"
                            style={{ color: '#3D5A27' }}>
                            <ExternalLink size={10} /> Ver catálogo
                          </a>
                        )}
                      </button>

                      {/* Lista expandida */}
                      {abierto && (
                        <div className="px-4 pb-4 space-y-3">
                          {catOrden.filter(c => grupos[c]?.length).map(c => {
                            const cfg = CAT[c] || CAT.fisico
                            const Icon = cfg.icon
                            return (
                              <div key={c}>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                                    style={{ background: cfg.bg, color: cfg.color }}>
                                    <Icon size={10} /> {cfg.label}
                                  </span>
                                </div>
                                <ul className="space-y-1 pl-1">
                                  {grupos[c].map((it, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-[12px] text-gray-700">
                                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cfg.color }} />
                                      <span className="font-medium leading-snug">
                                        {it.nombre}
                                        {it.cantidad > 1 && (
                                          <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                            style={{ background: cfg.bg, color: cfg.color }}>×{it.cantidad}</span>
                                        )}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )
                          })}
                          {URL_CATALOGO && (
                            <a href={URL_CATALOGO} target="_blank" rel="noreferrer"
                              className="mt-2 flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[12px] font-bold border-2 transition-all"
                              style={{ borderColor: '#3D5A27', color: '#3D5A27', background: 'transparent' }}>
                              <ExternalLink size={13} /> Ver cómo son los artículos → Catálogo
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <p className="text-[11px] text-gray-400 text-center px-2 pt-1">
              * Los precios son estimados según el peso indicado y pueden ajustarse al momento del servicio.
            </p>
          </div>
        )}

        {/* ── PASO 3: Recogida ─────────────────────────────────────────── */}
        {paso === 3 && (
          <div className="space-y-4">
            {/* Tipo */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-3">¿Dónde recogemos a tu mascota?</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: 'domicilio',   icon: MapPin,    label: 'En mi domicilio' },
                  { v: 'veterinaria', icon: Building2,  label: 'En veterinaria'  },
                ].map(({ v, icon: Icon, label }) => (
                  <button key={v} type="button"
                    onClick={() => { setRecogida(p => ({ ...p, tipo: v })); setError('') }}
                    className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all ${
                      recogida.tipo === v ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                    <Icon size={22} className={recogida.tipo === v ? 'text-[#3D5A27]' : 'text-gray-400'} />
                    <span className={`text-[12px] font-semibold ${recogida.tipo === v ? 'text-[#3D5A27]' : 'text-gray-500'}`}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Domicilio */}
            {recogida.tipo === 'domicilio' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
                <p className="text-[13px] font-bold text-gray-700">Dirección de recogida</p>

                {/* Selector de ciudad con recargo */}
                <div>
                  <label className={LABEL}>Ciudad / Municipio *</label>
                  <select
                    className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all"
                    value={recogida.ciudad}
                    onChange={e => setRecogida(p => ({ ...p, ciudad: e.target.value }))}>
                    {CIUDADES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>

                  {/* Aviso de recargo */}
                  {(() => {
                    const ciudad = CIUDADES.find(c => c.value === recogida.ciudad)
                    if (!ciudad || ciudad.recargo.min === 0) return null
                    return (
                      <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl"
                        style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                        <Truck size={14} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[12px] font-bold text-amber-800">
                            Recargo de transporte a {ciudad.label}
                          </p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            Este municipio tiene un recargo adicional de{' '}
                            <strong>{fmt(ciudad.recargo.min)}</strong>
                            {ciudad.recargo.min !== ciudad.recargo.max && (
                              <> a <strong>{fmt(ciudad.recargo.max)}</strong></>
                            )}{' '}
                            según el vehículo de recogida. El coordinador lo confirmará contigo.
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Localidad</label>
                    <LocalidadSelect value={recogida.localidad}
                      onChange={v => setRecogida(p => ({ ...p, localidad: v }))}
                      placeholder="Seleccionar…" />
                  </div>
                  <div>
                    <label className={LABEL}>Barrio</label>
                    <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400"
                      placeholder="Chapinero" value={recogida.barrio}
                      onChange={e => setRecogida(p => ({ ...p, barrio: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Dirección exacta *</label>
                  <input
                    className={(() => {
                      const base = 'w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border rounded-xl outline-none focus:ring-2 transition-all placeholder:text-gray-400'
                      if (!tocados.recogida_direccion) return `${base} border-gray-200 focus:border-[#3D5A27] focus:ring-[#3D5A27]/10`
                      if (errores.recogida_direccion)  return `${base} border-red-400 bg-red-50/40 focus:border-red-500 focus:ring-red-400/15`
                      return `${base} border-green-400 focus:border-green-500 focus:ring-green-400/15`
                    })()}
                    placeholder="Calle 45 # 12-34" value={recogida.direccion}
                    onChange={e => {
                      const v = e.target.value
                      setRecogida(p => ({ ...p, direccion: v }))
                      if (tocados.recogida_direccion) vld('recogida_direccion', v)
                    }}
                    onBlur={e => { setTocados(p => ({ ...p, recogida_direccion: true })); vld('recogida_direccion', e.target.value) }} />
                  <ErrMsg msg={tocados.recogida_direccion && errores.recogida_direccion} />
                </div>
              </div>
            )}

            {/* Veterinaria */}
            {recogida.tipo === 'veterinaria' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
                <p className="text-[13px] font-bold text-gray-700">Veterinaria</p>
                <div>
                  <label className={LABEL}>Buscar veterinaria</label>
                  <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400"
                    placeholder="Escribe el nombre..." value={busqVet}
                    onChange={e => { setBusqVet(e.target.value); setRecogida(p => ({ ...p, aliado_id: '', aliado_nombre_otro: '' })) }} />
                </div>
                {busqVet && vetsFiltradas.length > 0 && (
                  <div className="space-y-1.5">
                    {vetsFiltradas.map(a => (
                      <button key={a.id_aliado} type="button"
                        onClick={() => { setRecogida(p => ({ ...p, aliado_id: a.id_aliado, aliado_nombre_otro: '' })); setBusqVet(a.nombre); setError('') }}
                        className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all ${
                          recogida.aliado_id === a.id_aliado ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}>
                        <div className="text-[13px] font-semibold text-gray-800">{a.nombre}</div>
                        {a.ciudad && <div className="text-[11px] text-gray-400">{a.ciudad}</div>}
                      </button>
                    ))}
                  </div>
                )}
                {busqVet && vetsFiltradas.length === 0 && (
                  <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-[12px] text-amber-800 font-semibold mb-2">No encontramos esa veterinaria en nuestro listado</p>
                    <label className={LABEL}>Escribe el nombre completo *</label>
                    <input className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/15 transition-all placeholder:text-gray-400"
                      placeholder="Clínica Veterinaria Ejemplo" value={recogida.aliado_nombre_otro}
                      onChange={e => { setRecogida(p => ({ ...p, aliado_nombre_otro: e.target.value, aliado_id: '' })); setError('') }} />
                  </div>
                )}
                {recogida.aliado_id && (
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#3D5A27]">
                    <CheckCircle size={14} /> Veterinaria seleccionada
                  </div>
                )}
              </div>
            )}

            {/* Hora y notas */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
              <div>
                <label className={LABEL}><Clock size={12} className="inline mr-1" />Hora aproximada <span className="font-normal text-gray-400">(opcional)</span></label>
                <input type="time"
                  className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all"
                  value={recogida.hora_aproximada}
                  onChange={e => setRecogida(p => ({ ...p, hora_aproximada: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>Indicaciones adicionales <span className="font-normal text-gray-400">(opcional)</span></label>
                <textarea
                  className="w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400 resize-none"
                  rows={2} placeholder="Piso, portería, referencias, etc." value={recogida.notas}
                  onChange={e => setRecogida(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* Error global */}
        {error && (
          <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-700">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="shrink-0 opacity-60 hover:opacity-100"><X size={13} /></button>
          </div>
        )}

        {/* Nav buttons */}
        <div className={`flex gap-3 mt-6 ${paso > 0 ? 'justify-between' : 'justify-end'}`}>
          {paso > 0 && (
            <button type="button" onClick={() => { setPaso(p => p - 1); setError(''); window.scrollTo({ top: 0 }) }}
              className="flex items-center gap-1.5 px-5 py-3 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-all">
              <ChevronLeft size={16} /> Atrás
            </button>
          )}
          {paso < PASOS.length - 1 ? (
            <button type="button" onClick={avanzar}
              className="flex items-center gap-1.5 px-6 py-3 rounded-xl text-[13px] font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
              Continuar <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={enviar} disabled={submitting}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-50 hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
              {submitting ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando...</>
              ) : (
                <><CheckCircle size={16} /> Enviar solicitud</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
