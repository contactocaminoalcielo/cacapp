import { useState, useEffect, useRef } from 'react'
import { db } from '@/lib/supabase'
import { fmt, petEmoji } from '@/lib/utils'
import { aliadoValidar, aliadoCrearSolicitud, aliadoAfiliacion } from '@/lib/aliados'
import { LocalidadSelect } from '@/components/ui/localidad-select'
import { CheckCircle, ChevronRight, ChevronLeft, MapPin, Building2, Clock, AlertCircle, X, Stethoscope } from 'lucide-react'

// ── Anti doble-envío en el mismo navegador ───────────────────────────────────
const RATE_KEY = 'cac_aliado_ts'
const RATE_MS  = 10 * 60 * 1000

const LABEL = 'block text-[12px] font-semibold text-gray-600 mb-1'
const INPUT = 'w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400'
const SEXOS = [{ v: 'Macho', e: '♂' }, { v: 'Hembra', e: '♀' }]

// ── Rango de peso (misma regla que /solicitud y Registro) ─────────────────────
function getRango(pesoKg, especieId) {
  if (!pesoKg || pesoKg <= 0) return null
  if (pesoKg < 1) return 'PETIT'
  if (especieId === 2 || especieId === 3) return 'FELINO'   // Gato (2) o Conejo (3)
  if (pesoKg < 11) return '1-10KG'
  if (pesoKg < 21) return '11-20KG'
  if (pesoKg < 36) return '21-35KG'
  return '36-60KG'
}

function validarTelefono(v, requerido = false) {
  const val = (v || '').trim()
  if (!val) return requerido ? 'Este campo es requerido' : null
  if (val.startsWith('+') || val.startsWith('00')) {
    const prefix = val.startsWith('+') ? val.slice(1) : val.slice(2)
    const digits = prefix.replace(/\D/g, '')
    return digits.length < 7 || digits.length > 15 ? 'Número internacional inválido' : null
  }
  const digits = val.replace(/\D/g, '')
  if (digits.length !== 10) return 'Debe tener 10 dígitos — ej: 3001234567'
  if (!digits.startsWith('3')) return 'Los celulares colombianos empiezan por 3'
  return null
}

function ErrMsg({ msg }) {
  if (!msg) return null
  return (
    <div className="flex items-start gap-1.5 mt-1.5">
      <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
      <p className="text-[11px] text-red-600 font-medium leading-tight">{msg}</p>
    </div>
  )
}

function Pantalla({ children }) {
  return <div className="min-h-screen bg-gradient-to-b from-[#F0F7EB] to-white flex flex-col">{children}</div>
}

function Exito({ titulo, texto }) {
  return (
    <Pantalla>
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5 animate-bounce">
          <CheckCircle size={40} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">{titulo}</h1>
        <p className="text-gray-500 text-center text-[15px] max-w-xs leading-relaxed">{texto}</p>
        <p className="mt-6 text-[13px] text-gray-400">Camino al Cielo 🌿</p>
      </div>
    </Pantalla>
  )
}

export default function SolicitudAliado({ token = '' }) {
  // fase: 'cargando' | 'A' (aliado validado) | 'B' (afiliación de vet nueva)
  const [fase, setFase] = useState('cargando')
  const [aliado, setAliado] = useState(null)
  const [submitted, setSubmitted] = useState(null)  // 'A' | 'B'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Catálogos (Flujo A)
  const [especies, setEspecies] = useState([])
  const [planes, setPlanes] = useState([])
  const [precios, setPrecios] = useState([])

  // ── Validar token al entrar ──────────────────────────────────────────────
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!token) { if (vivo) setFase('B'); return }
      try {
        const r = await aliadoValidar(token)
        if (!vivo) return
        if (r.status === 200 && r.ok) { setAliado(r.aliado); setFase('A') }
        else setFase('B')
      } catch { if (vivo) setFase('B') }
    })()
    return () => { vivo = false }
  }, [token])

  // Catálogos solo cuando hace falta (Flujo A)
  useEffect(() => {
    if (fase !== 'A') return
    Promise.all([
      db.from('especies').select('id,nombre').order('nombre'),
      db.from('planes').select('id,nombre,codigo,tipo_proceso,descripcion').order('nombre'),
      db.from('planes_precios').select('plan_id,rango_nombre,precio'),
    ]).then(([e, p, pr]) => {
      setEspecies(e.data || [])
      setPlanes(p.data || [])   // aliado validado ve TODOS los planes (incl. exclusivos)
      setPrecios(pr.data || [])
    })
  }, [fase])

  if (fase === 'cargando') {
    return (
      <Pantalla>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#3D5A27] border-t-transparent rounded-full animate-spin" />
        </div>
      </Pantalla>
    )
  }

  if (submitted === 'A') return <Exito titulo="¡Solicitud recibida!" texto="Nuestro equipo revisará la información y programará la ruta de recolección. Te confirmaremos los detalles." />
  if (submitted === 'B') return <Exito titulo="¡Datos recibidos!" texto="Recibimos los datos de tu veterinaria. Te contactaremos para validar la afiliación y enviarte tu acceso." />

  return fase === 'A'
    ? <FlujoServicio
        token={token} aliado={aliado} especies={especies} planes={planes} precios={precios}
        submitting={submitting} setSubmitting={setSubmitting} error={error} setError={setError}
        onDone={() => setSubmitted('A')} />
    : <FlujoAfiliacion
        submitting={submitting} setSubmitting={setSubmitting} error={error} setError={setError}
        onDone={() => setSubmitted('B')} />
}

// ════════════════════════════════════════════════════════════════════════════
// FLUJO A — aliado validado: solicita un servicio
// ════════════════════════════════════════════════════════════════════════════
const PASOS = ['Propietario', 'Mascota', 'Plan', 'Recogida']

function FlujoServicio({ token, aliado, especies, planes, precios, submitting, setSubmitting, error, setError, onDone }) {
  const formRef = useRef(null)
  const [paso, setPaso] = useState(0)
  const [errores, setErrores] = useState({})
  const [tocados, setTocados] = useState({})

  const [prop, setProp] = useState({ nombre: '', apellido: '', cedula: '', whatsapp: '', telefono: '', email: '', ciudad: 'Bogotá', localidad: '', barrio: '', direccion: '' })
  const [masc, setMasc] = useState({ nombre: '', especie_id: '', sexo: '', peso_kg: '', raza: '' })
  const [planId, setPlanId] = useState('')
  const [rec, setRec]   = useState({ tipo: 'veterinaria', ciudad: aliado?.ciudad || 'Bogotá', localidad: aliado?.localidad || '', barrio: aliado?.barrio || '', direccion: '', hora_aproximada: '', notas: '' })

  function getPrecio(pid) {
    if (!pid || !masc.peso_kg) return null

    // El Desamparado no tiene tarifa por rangos: se calcula con la fórmula, así
    // que sin esto salía "Por consultar" justo en el plan que más piden las
    // veterinarias. Espejo exacto de `precios.js` (DESAMPARADO) — si allá cambia,
    // aquí también.
    if (planes.find(p => p.id === pid)?.codigo === 'DESAMPARADO') {
      const kg = parseFloat(masc.peso_kg)
      if (!Number.isFinite(kg) || kg <= 0) return null
      return kg <= 10 ? 46000 : Math.round(44000 + (kg - 10) * 4000)
    }

    const rango = getRango(parseFloat(masc.peso_kg), parseInt(masc.especie_id))
    if (!rango) return null
    const directo = precios.find(p => p.plan_id === pid && p.rango_nombre === rango)?.precio
    if (directo != null) return directo
    const baseCod = {
      EXCLUSIVO_PRESENCIAL_SIN_REC:   'EXCLUSIVO_PRESENCIAL',
      EXCLUSIVO_VIDEOLLAMADA_SIN_REC: 'EXCLUSIVO_VIDEOLLAMADA',
    }[planes.find(p => p.id === pid)?.codigo]
    if (baseCod) {
      const basePlan = planes.find(p => p.codigo === baseCod)
      const basePrecio = precios.find(p => p.plan_id === basePlan?.id && p.rango_nombre === rango)?.precio
      if (basePrecio != null) return Math.round(basePrecio * 0.8)
    }
    return null
  }

  function avanzar() {
    let hay = false
    const ne = { ...errores }, nt = { ...tocados }
    const set = (k, e) => { nt[k] = true; ne[k] = e; if (e) hay = true }
    if (paso === 0) {
      set('nombre', !prop.nombre.trim() ? 'El nombre es requerido' : null)
      set('whatsapp', validarTelefono(prop.whatsapp, true))
      set('telefono', validarTelefono(prop.telefono, false))
    }
    if (paso === 1) {
      set('masc_nombre', !masc.nombre.trim() ? 'El nombre de la mascota es requerido' : null)
      set('especie_id', !masc.especie_id ? 'Selecciona la especie' : null)
      const n = parseFloat(String(masc.peso_kg).replace(',', '.'))
      set('peso_kg', !masc.peso_kg ? 'El peso es requerido' : isNaN(n) || n <= 0 ? 'Peso inválido' : n > 100 ? '¿Está en kg?' : null)
    }
    if (paso === 2 && !planId) { setError('Selecciona un plan para continuar.'); return }
    if (paso === 3 && rec.tipo === 'domicilio') {
      set('rec_direccion', !rec.direccion.trim() ? 'La dirección de recogida es requerida' : null)
    }
    setErrores(ne); setTocados(nt)
    if (hay) { setTimeout(() => formRef.current?.querySelector('.border-red-400')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); return }
    setError(''); setPaso(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function enviar() {
    const last = localStorage.getItem(RATE_KEY)
    if (last && Date.now() - parseInt(last) < RATE_MS) { setError('Acabas de enviar una solicitud. Espera unos minutos.'); return }
    setSubmitting(true); setError('')
    try {
      const r = await aliadoCrearSolicitud({
        token,
        propietario: {
          nombre: prop.nombre, apellido: prop.apellido, cedula: prop.cedula,
          whatsapp: prop.whatsapp, telefono: prop.telefono, email: prop.email,
          ciudad: prop.ciudad, localidad: prop.localidad, barrio: prop.barrio, direccion: prop.direccion,
        },
        mascota: { nombre: masc.nombre, especie_id: masc.especie_id, peso_kg: masc.peso_kg, sexo: masc.sexo, raza: masc.raza },
        plan_id: planId,
        recogida: {
          tipo: rec.tipo,
          ciudad: rec.tipo === 'domicilio' ? rec.ciudad : (aliado?.ciudad || rec.ciudad),
          localidad: rec.tipo === 'domicilio' ? rec.localidad : (aliado?.localidad || ''),
          barrio: rec.tipo === 'domicilio' ? rec.barrio : (aliado?.barrio || ''),
          direccion: rec.tipo === 'domicilio' ? rec.direccion : '',
          hora_aproximada: rec.hora_aproximada, notas: rec.notas,
        },
      })
      if (r.status === 200 && r.ok) { localStorage.setItem(RATE_KEY, Date.now().toString()); onDone(); return }
      if (r.status === 422 && r.faltan?.length) { setError('Faltan datos: ' + r.faltan.join(', ') + '.'); return }
      if (r.status === 404) { setError('Tu enlace de acceso no es válido o fue desactivado. Comunícate con Camino al Cielo.'); return }
      setError('No se pudo enviar la solicitud. Intenta de nuevo en unos minutos.')
    } catch {
      setError('Hubo un error de conexión. Intenta de nuevo.')
    } finally { setSubmitting(false) }
  }

  return (
    <Pantalla>
      <div className="px-5 pt-8 pb-4 text-center">
        <div className="text-[13px] font-bold tracking-widest text-[#3D5A27] uppercase mb-1">Camino al Cielo · Aliados</div>
        <h1 className="text-[22px] font-bold text-gray-900 leading-tight">Solicitar recolección</h1>
        <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#3D5A27]/10 text-[#3D5A27]">
          <Stethoscope size={13} />
          <span className="text-[12px] font-bold">{aliado?.nombre}</span>
        </div>
      </div>

      {/* Pasos */}
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

      <div ref={formRef} className="flex-1 px-5 pb-6 max-w-md mx-auto w-full">
        {/* PASO 0 — Propietario */}
        {paso === 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
              <p className="text-[13px] font-bold text-gray-700">Datos del propietario</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Nombre *</label>
                  <input className={INPUT} placeholder="María" value={prop.nombre}
                    onChange={e => setProp(p => ({ ...p, nombre: e.target.value }))} onBlur={() => avanzarTocar()} />
                  <ErrMsg msg={tocados.nombre && errores.nombre} />
                </div>
                <div>
                  <label className={LABEL}>Apellido</label>
                  <input className={INPUT} placeholder="González" value={prop.apellido}
                    onChange={e => setProp(p => ({ ...p, apellido: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Cédula <span className="font-normal text-gray-400">(opcional)</span></label>
                <input className={INPUT} placeholder="1234567890" value={prop.cedula} inputMode="numeric"
                  onChange={e => setProp(p => ({ ...p, cedula: e.target.value.replace(/\D/g, '') }))} />
              </div>
              <div>
                <label className={LABEL}>WhatsApp del propietario *</label>
                <input className={INPUT} placeholder="3001234567" value={prop.whatsapp} inputMode="tel" maxLength={25}
                  onChange={e => setProp(p => ({ ...p, whatsapp: e.target.value }))} />
                <ErrMsg msg={tocados.whatsapp && errores.whatsapp} />
              </div>
              <div>
                <label className={LABEL}>Otro contacto <span className="font-normal text-gray-400">(opcional)</span></label>
                <input className={INPUT} placeholder="3XX XXX XXXX" value={prop.telefono} inputMode="tel" maxLength={25}
                  onChange={e => setProp(p => ({ ...p, telefono: e.target.value }))} />
                <ErrMsg msg={tocados.telefono && errores.telefono} />
              </div>
              <div>
                <label className={LABEL}>Correo <span className="font-normal text-gray-400">(opcional)</span></label>
                <input className={INPUT} type="email" placeholder="correo@ejemplo.com" value={prop.email}
                  onChange={e => setProp(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* PASO 1 — Mascota */}
        {paso === 1 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
            <p className="text-[13px] font-bold text-gray-700">Datos de la mascota</p>
            <div>
              <label className={LABEL}>Nombre de la mascota *</label>
              <input className={INPUT} placeholder="Luna, Max…" value={masc.nombre}
                onChange={e => setMasc(p => ({ ...p, nombre: e.target.value }))} />
              <ErrMsg msg={tocados.masc_nombre && errores.masc_nombre} />
            </div>
            <div>
              <label className={LABEL}>Especie *</label>
              <div className="grid grid-cols-3 gap-2">
                {especies.map(esp => (
                  <button key={esp.id} type="button"
                    onClick={() => setMasc(p => ({ ...p, especie_id: String(esp.id) }))}
                    className={`py-2.5 rounded-xl text-[12px] font-semibold border transition-all flex flex-col items-center gap-0.5 ${
                      masc.especie_id === String(esp.id) ? 'border-[#3D5A27] bg-[#F0F7EB] text-[#3D5A27]' : 'border-gray-200 text-gray-500'
                    }`}>
                    <span className="text-xl">{petEmoji(esp.nombre)}</span><span>{esp.nombre}</span>
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
                    <button key={s.v} type="button" onClick={() => setMasc(p => ({ ...p, sexo: s.v }))}
                      className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                        masc.sexo === s.v ? 'border-[#3D5A27] bg-[#F0F7EB] text-[#3D5A27]' : 'border-gray-200 text-gray-400'
                      }`}>{s.e} {s.v}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className={LABEL}>Peso aprox. (kg) *</label>
                <input className={INPUT} placeholder="4.5" value={masc.peso_kg} inputMode="decimal"
                  onChange={e => setMasc(p => ({ ...p, peso_kg: e.target.value.replace(',', '.') }))} />
                <ErrMsg msg={tocados.peso_kg && errores.peso_kg} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Raza <span className="font-normal text-gray-400">(opcional)</span></label>
              <input className={INPUT} placeholder="Labrador, Persa…" value={masc.raza}
                onChange={e => setMasc(p => ({ ...p, raza: e.target.value }))} />
            </div>
          </div>
        )}

        {/* PASO 2 — Plan */}
        {paso === 2 && (
          <div className="space-y-3">
            <p className="text-[13px] font-bold text-gray-700 px-1">Selecciona el plan</p>
            {!masc.peso_kg && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700">
                <AlertCircle size={14} /> Indica el peso para ver precios estimados
              </div>
            )}
            {planes.map(plan => {
              const precio = getPrecio(plan.id)
              const activo = planId === plan.id
              return (
                <button key={plan.id} type="button" onClick={() => { setPlanId(plan.id); setError('') }}
                  className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${activo ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-bold leading-tight ${activo ? 'text-[#3D5A27]' : 'text-gray-800'}`}>{plan.nombre}</div>
                      {plan.descripcion && <p className="text-[12px] text-gray-500 leading-snug mt-1">{plan.descripcion}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {precio != null ? (
                        <div className={`text-[16px] font-bold ${activo ? 'text-[#3D5A27]' : 'text-gray-700'}`}>{fmt(precio)}</div>
                      ) : masc.peso_kg ? <span className="text-[11px] text-gray-400">Por consultar</span> : null}
                      {activo && <div className="mt-1 flex items-center justify-end gap-1 text-[11px] font-semibold text-[#3D5A27]"><CheckCircle size={11} /> Seleccionado</div>}
                    </div>
                  </div>
                </button>
              )
            })}
            <p className="text-[11px] text-gray-400 text-center px-2 pt-1">* Precios estimados según el peso; se confirman al programar el servicio.</p>
          </div>
        )}

        {/* PASO 3 — Recogida */}
        {paso === 3 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-3">¿Dónde se recoge la mascota?</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: 'veterinaria', icon: Building2, label: 'En mi veterinaria' },
                  { v: 'domicilio',   icon: MapPin,    label: 'En domicilio del propietario' },
                ].map(({ v, icon: Icon, label }) => (
                  <button key={v} type="button" onClick={() => { setRec(p => ({ ...p, tipo: v })); setError('') }}
                    className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all ${rec.tipo === v ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-white'}`}>
                    <Icon size={22} className={rec.tipo === v ? 'text-[#3D5A27]' : 'text-gray-400'} />
                    <span className={`text-[12px] font-semibold text-center ${rec.tipo === v ? 'text-[#3D5A27]' : 'text-gray-500'}`}>{label}</span>
                  </button>
                ))}
              </div>
              {rec.tipo === 'veterinaria' && (
                <p className="mt-3 text-[12px] text-gray-500">Se recoge en <span className="font-semibold">{aliado?.nombre}</span>{aliado?.direccion ? ` · ${aliado.direccion}` : ''}.</p>
              )}
            </div>

            {rec.tipo === 'domicilio' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
                <p className="text-[13px] font-bold text-gray-700">Dirección de recogida</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Ciudad</label>
                    <input className={INPUT} value={rec.ciudad} onChange={e => setRec(p => ({ ...p, ciudad: e.target.value, localidad: '' }))} />
                  </div>
                  {rec.ciudad === 'Bogotá' && (
                    <div>
                      <label className={LABEL}>Localidad</label>
                      <LocalidadSelect value={rec.localidad} onChange={v => setRec(p => ({ ...p, localidad: v }))} placeholder="Seleccionar…" />
                    </div>
                  )}
                </div>
                <div>
                  <label className={LABEL}>Barrio</label>
                  <input className={INPUT} placeholder="Chapinero" value={rec.barrio} onChange={e => setRec(p => ({ ...p, barrio: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>Dirección exacta *</label>
                  <input className={`${INPUT} ${tocados.rec_direccion && errores.rec_direccion ? 'border-red-400 bg-red-50/40' : ''}`}
                    placeholder="Calle 45 # 12-34" value={rec.direccion}
                    onChange={e => setRec(p => ({ ...p, direccion: e.target.value }))} />
                  <ErrMsg msg={tocados.rec_direccion && errores.rec_direccion} />
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
              <div>
                <label className={LABEL}><Clock size={12} className="inline mr-1" />Hora aproximada <span className="font-normal text-gray-400">(opcional)</span></label>
                <input type="time" className={INPUT} value={rec.hora_aproximada} onChange={e => setRec(p => ({ ...p, hora_aproximada: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>Observaciones <span className="font-normal text-gray-400">(opcional)</span></label>
                <textarea className={`${INPUT} resize-none`} rows={2} placeholder="Urgencia, indicaciones, ¿requiere devolución?, etc." value={rec.notas}
                  onChange={e => setRec(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-700">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="shrink-0 opacity-60"><X size={13} /></button>
          </div>
        )}

        <div className={`flex gap-3 mt-6 ${paso > 0 ? 'justify-between' : 'justify-end'}`}>
          {paso > 0 && (
            <button type="button" onClick={() => { setPaso(p => p - 1); setError(''); window.scrollTo({ top: 0 }) }}
              className="flex items-center gap-1.5 px-5 py-3 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 bg-white">
              <ChevronLeft size={16} /> Atrás
            </button>
          )}
          {paso < PASOS.length - 1 ? (
            <button type="button" onClick={avanzar}
              className="flex items-center gap-1.5 px-6 py-3 rounded-xl text-[13px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
              Continuar <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={enviar} disabled={submitting}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-[13px] font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
              {submitting ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando…</> : <><CheckCircle size={16} /> Enviar solicitud</>}
            </button>
          )}
        </div>
      </div>
    </Pantalla>
  )

  // Marca tocado + valida el paso 0 en vivo (nombre/whatsapp) sin avanzar
  function avanzarTocar() {
    setTocados(t => ({ ...t, nombre: true, whatsapp: true }))
    setErrores(e => ({
      ...e,
      nombre: !prop.nombre.trim() ? 'El nombre es requerido' : null,
      whatsapp: validarTelefono(prop.whatsapp, true),
    }))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FLUJO B — veterinaria nueva: solicita afiliación
// ════════════════════════════════════════════════════════════════════════════
function FlujoAfiliacion({ submitting, setSubmitting, error, setError, onDone }) {
  const [f, setF] = useState({ nombre: '', identificacion_nit: '', contacto_nombre: '', whatsapp: '', telefono: '', email: '', ciudad: 'Bogotá', localidad: '', barrio: '', direccion: '', notas: '' })
  const [tocado, setTocado] = useState(false)
  const errNombre = tocado && !f.nombre.trim() ? 'El nombre comercial es requerido' : null

  async function enviar() {
    setTocado(true)
    if (!f.nombre.trim()) { setError('Ingresa el nombre comercial de la veterinaria.'); return }
    const last = localStorage.getItem(RATE_KEY)
    if (last && Date.now() - parseInt(last) < RATE_MS) { setError('Acabas de enviar una solicitud. Espera unos minutos.'); return }
    setSubmitting(true); setError('')
    try {
      const r = await aliadoAfiliacion(f)
      if (r.status === 200 && r.ok) { localStorage.setItem(RATE_KEY, Date.now().toString()); onDone(); return }
      setError('No se pudo enviar. Intenta de nuevo en unos minutos.')
    } catch {
      setError('Hubo un error de conexión. Intenta de nuevo.')
    } finally { setSubmitting(false) }
  }

  const upd = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  return (
    <Pantalla>
      <div className="px-5 pt-8 pb-4 text-center">
        <div className="text-[13px] font-bold tracking-widest text-[#3D5A27] uppercase mb-1">Camino al Cielo · Aliados</div>
        <h1 className="text-[22px] font-bold text-gray-900 leading-tight">Afilia tu veterinaria</h1>
        <p className="text-[13px] text-gray-500 mt-1 max-w-sm mx-auto">Regístrate como aliado para solicitar recolecciones directamente. Validamos tus datos y te enviamos tu acceso.</p>
      </div>

      <div className="flex-1 px-5 pb-6 max-w-md mx-auto w-full space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <p className="text-[13px] font-bold text-gray-700">Datos de la veterinaria</p>
          <div>
            <label className={LABEL}>Nombre comercial *</label>
            <input className={`${INPUT} ${errNombre ? 'border-red-400 bg-red-50/40' : ''}`} placeholder="Clínica Veterinaria…" value={f.nombre} onChange={upd('nombre')} onBlur={() => setTocado(true)} />
            <ErrMsg msg={errNombre} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>NIT / Cédula</label>
              <input className={INPUT} placeholder="900123456" value={f.identificacion_nit} onChange={upd('identificacion_nit')} />
            </div>
            <div>
              <label className={LABEL}>Responsable</label>
              <input className={INPUT} placeholder="Dr. Pérez" value={f.contacto_nombre} onChange={upd('contacto_nombre')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>WhatsApp</label>
              <input className={INPUT} placeholder="3001234567" inputMode="tel" maxLength={25} value={f.whatsapp} onChange={upd('whatsapp')} />
            </div>
            <div>
              <label className={LABEL}>Teléfono</label>
              <input className={INPUT} placeholder="601 1234567" inputMode="tel" maxLength={25} value={f.telefono} onChange={upd('telefono')} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Correo <span className="font-normal text-gray-400">(opcional)</span></label>
            <input className={INPUT} type="email" placeholder="contacto@veterinaria.com" value={f.email} onChange={upd('email')} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <p className="text-[13px] font-bold text-gray-700">Ubicación</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Ciudad</label>
              <input className={INPUT} value={f.ciudad} onChange={e => setF(p => ({ ...p, ciudad: e.target.value, localidad: '' }))} />
            </div>
            {f.ciudad === 'Bogotá' && (
              <div>
                <label className={LABEL}>Localidad</label>
                <LocalidadSelect value={f.localidad} onChange={v => setF(p => ({ ...p, localidad: v }))} placeholder="Seleccionar…" />
              </div>
            )}
          </div>
          <div>
            <label className={LABEL}>Barrio</label>
            <input className={INPUT} placeholder="Chapinero" value={f.barrio} onChange={upd('barrio')} />
          </div>
          <div>
            <label className={LABEL}>Dirección</label>
            <input className={INPUT} placeholder="Calle 45 # 12-34" value={f.direccion} onChange={upd('direccion')} />
          </div>
          <div>
            <label className={LABEL}>Observaciones <span className="font-normal text-gray-400">(opcional)</span></label>
            <textarea className={`${INPUT} resize-none`} rows={2} placeholder="Horario, referencias, etc." value={f.notas} onChange={upd('notas')} />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-700">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="shrink-0 opacity-60"><X size={13} /></button>
          </div>
        )}

        <button type="button" onClick={enviar} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-[14px] font-bold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
          {submitting ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando…</> : <><CheckCircle size={16} /> Solicitar afiliación</>}
        </button>
      </div>
    </Pantalla>
  )
}
