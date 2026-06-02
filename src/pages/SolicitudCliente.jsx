import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { fmt, today, petEmoji } from '@/lib/utils'
import { CheckCircle, ChevronRight, ChevronLeft, MapPin, Building2, Clock, AlertCircle } from 'lucide-react'

// ── Anti-spam ───────────────────────────────────────────────────────────────
const RATE_LIMIT_KEY = 'cac_solicitud_ts'
const RATE_LIMIT_MS  = 20 * 60 * 1000 // 20 min

// ── Rango de peso → nombre de rango en planes_precios ──────────────────────
function getRango(pesoKg, especieId) {
  if (!pesoKg || pesoKg <= 0) return null
  if (pesoKg < 1)   return 'PETIT'
  if (especieId === 2) return 'FELINO'
  if (pesoKg <= 10) return '1-10KG'
  if (pesoKg <= 20) return '11-20KG'
  if (pesoKg <= 35) return '21-35KG'
  return '36-60KG'
}

const PASOS = ['Propietario', 'Mascota', 'Plan', 'Recogida']

const LABEL  = 'block text-[12px] font-semibold text-gray-600 mb-1'
const INPUT  = 'w-full px-3.5 py-3 text-[14px] font-medium text-gray-900 bg-white border border-gray-200 rounded-xl outline-none focus:border-[#3D5A27] focus:ring-2 focus:ring-[#3D5A27]/10 transition-all placeholder:text-gray-400 placeholder:font-normal'
const SEXOS  = [{ v: 'Macho', e: '♂' }, { v: 'Hembra', e: '♀' }]

export default function SolicitudCliente() {
  const [paso,        setPaso]        = useState(0)
  const [submitting,  setSubmitting]  = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [error,       setError]       = useState('')

  // Catálogos
  const [especies,    setEspecies]    = useState([])
  const [planes,      setPlanes]      = useState([])
  const [precios,     setPrecios]     = useState([])
  const [aliados,     setAliados]     = useState([])
  const [busqVet,     setBusqVet]     = useState('')

  // Formulario
  const [cliente, setCliente] = useState({ nombre:'', apellido:'', whatsapp:'', email:'' })
  const [mascota, setMascota] = useState({ nombre:'', especie_id:'', sexo:'', peso_kg:'', raza:'' })
  const [planId,  setPlanId]  = useState('')
  const [recogida, setRecogida] = useState({
    tipo: 'domicilio',
    ciudad: 'Bogotá', localidad:'', barrio:'', direccion:'',
    aliado_id:'', aliado_nombre_otro:'', hora_aproximada:'', notas:'',
  })

  // Honeypot (campo oculto — si está lleno es un bot)
  const [hp, setHp] = useState('')

  useEffect(() => {
    Promise.all([
      db.from('especies').select('id,nombre').order('nombre'),
      db.from('planes').select('id,nombre,tipo_proceso,descripcion').order('nombre'),
      db.from('planes_precios').select('plan_id,rango_nombre,precio'),
      db.from('aliados').select('id_aliado,nombre,ciudad').eq('activo', true).order('nombre'),
    ]).then(([e, p, pr, a]) => {
      setEspecies(e.data || [])
      // Excluir planes presequiales del selector público
      setPlanes((p.data || []).filter(pl => !['BRONCE','PLATA','ORO','DIAMANTE','VITALICIO'].includes(pl.nombre)))
      setPrecios(pr.data || [])
      setAliados(a.data || [])
    })
  }, [])

  // ── Precio estimado según selección ──────────────────────────────────────
  function getPrecio(pid) {
    if (!pid || !mascota.peso_kg) return null
    const rango = getRango(parseFloat(mascota.peso_kg), parseInt(mascota.especie_id))
    if (!rango) return null
    return precios.find(p => p.plan_id === pid && p.rango_nombre === rango)?.precio ?? null
  }

  // ── Validación por paso ───────────────────────────────────────────────────
  function canNext() {
    if (paso === 0) return !!(cliente.nombre.trim() && cliente.whatsapp.trim().replace(/\D/g,'').length >= 10)
    if (paso === 1) return !!(mascota.nombre.trim() && mascota.especie_id && mascota.peso_kg)
    if (paso === 2) return !!planId
    if (paso === 3) {
      if (recogida.tipo === 'domicilio') return !!recogida.direccion.trim()
      return !!(recogida.aliado_id || recogida.aliado_nombre_otro.trim())
    }
    return true
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function enviar() {
    if (hp) { setSubmitted(true); return } // Honeypot: bot → simular éxito

    const lastTs = localStorage.getItem(RATE_LIMIT_KEY)
    if (lastTs && Date.now() - parseInt(lastTs) < RATE_LIMIT_MS) {
      setError('Ya enviaste una solicitud recientemente. Por favor espera unos minutos antes de intentar de nuevo.')
      return
    }

    setSubmitting(true); setError('')
    try {
      const { error: err } = await db.from('solicitudes_servicio').insert({
        cliente_nombre:      cliente.nombre.trim(),
        cliente_apellido:    cliente.apellido.trim() || null,
        cliente_whatsapp:    cliente.whatsapp.replace(/\D/g, ''),
        cliente_email:       cliente.email.trim() || null,
        mascota_nombre:      mascota.nombre.trim(),
        especie_id:          parseInt(mascota.especie_id) || null,
        mascota_peso_kg:     parseFloat(mascota.peso_kg) || null,
        mascota_sexo:        mascota.sexo || null,
        mascota_raza:        mascota.raza.trim() || null,
        plan_id:             planId || null,
        tipo_recogida:       recogida.tipo,
        aliado_id:           recogida.aliado_id   || null,
        aliado_nombre_otro:  recogida.aliado_nombre_otro.trim() || null,
        ciudad:              recogida.ciudad || 'Bogotá',
        localidad:           recogida.localidad || null,
        barrio:              recogida.barrio.trim() || null,
        direccion:           recogida.tipo === 'domicilio' ? recogida.direccion.trim() : null,
        hora_aproximada:     recogida.hora_aproximada || null,
        notas_cliente:       recogida.notas.trim() || null,
      })
      if (err) throw err
      localStorage.setItem(RATE_LIMIT_KEY, Date.now().toString())
      setSubmitted(true)
    } catch {
      setError('Hubo un error al enviar tu solicitud. Por favor intenta de nuevo o comunícate con nosotros.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Vets filtradas ────────────────────────────────────────────────────────
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
      <div className="flex-1 px-5 pb-6 max-w-md mx-auto w-full">
        {/* Honeypot oculto para bots */}
        <input type="text" name="website" value={hp} onChange={e => setHp(e.target.value)}
          style={{ opacity: 0, position: 'absolute', height: 0, pointerEvents: 'none' }} tabIndex={-1} />

        {/* ── PASO 0: Propietario ─────────────────────────────────────────── */}
        {paso === 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Tus datos de contacto</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Nombre *</label>
                    <input className={INPUT} placeholder="María" value={cliente.nombre}
                      onChange={e => setCliente(p => ({ ...p, nombre: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL}>Apellido</label>
                    <input className={INPUT} placeholder="González" value={cliente.apellido}
                      onChange={e => setCliente(p => ({ ...p, apellido: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>WhatsApp *</label>
                  <input className={INPUT} placeholder="3XX XXX XXXX" value={cliente.whatsapp}
                    inputMode="tel" maxLength={15}
                    onChange={e => setCliente(p => ({ ...p, whatsapp: e.target.value }))} />
                  <p className="text-[11px] text-gray-400 mt-1">Te contactaremos por este número</p>
                </div>
                <div>
                  <label className={LABEL}>Correo electrónico</label>
                  <input className={INPUT} type="email" placeholder="correo@ejemplo.com" value={cliente.email}
                    onChange={e => setCliente(p => ({ ...p, email: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PASO 1: Mascota ─────────────────────────────────────────────── */}
        {paso === 1 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-4">Datos de tu mascota</p>
              <div className="space-y-3">
                <div>
                  <label className={LABEL}>Nombre de la mascota *</label>
                  <input className={INPUT} placeholder="Luna, Max, etc." value={mascota.nombre}
                    onChange={e => setMascota(p => ({ ...p, nombre: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>Especie *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {especies.map(esp => (
                      <button key={esp.id} type="button"
                        onClick={() => setMascota(p => ({ ...p, especie_id: String(esp.id) }))}
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
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Sexo</label>
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
                    <input className={INPUT} placeholder="4.5" value={mascota.peso_kg}
                      inputMode="decimal"
                      onChange={e => setMascota(p => ({ ...p, peso_kg: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Raza <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input className={INPUT} placeholder="Labrador, Persa, etc." value={mascota.raza}
                    onChange={e => setMascota(p => ({ ...p, raza: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PASO 2: Plan ────────────────────────────────────────────────── */}
        {paso === 2 && (
          <div className="space-y-3">
            <p className="text-[13px] font-bold text-gray-700 px-1">Selecciona el plan</p>
            {!mascota.peso_kg && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700">
                <AlertCircle size={14} />
                Ingresa el peso de tu mascota para ver precios estimados
              </div>
            )}
            {planes.map(plan => {
              const precio = getPrecio(plan.id)
              const activo = planId === plan.id
              return (
                <button key={plan.id} type="button" onClick={() => setPlanId(plan.id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                    activo ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className={`text-[14px] font-bold mb-0.5 ${activo ? 'text-[#3D5A27]' : 'text-gray-800'}`}>
                        {plan.nombre}
                      </div>
                      {plan.descripcion && (
                        <p className="text-[12px] text-gray-500 leading-snug">{plan.descripcion}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {precio != null ? (
                        <div className={`text-[15px] font-bold ${activo ? 'text-[#3D5A27]' : 'text-gray-700'}`}>
                          {fmt(precio)}
                        </div>
                      ) : mascota.peso_kg ? (
                        <span className="text-[11px] text-gray-400">Precio por consultar</span>
                      ) : null}
                    </div>
                  </div>
                  {activo && (
                    <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#3D5A27]">
                      <CheckCircle size={12} /> Seleccionado
                    </div>
                  )}
                </button>
              )
            })}
            <p className="text-[11px] text-gray-400 text-center px-2 pt-1">
              * Los precios son estimados según el peso indicado y pueden ajustarse al momento del servicio.
            </p>
          </div>
        )}

        {/* ── PASO 3: Recogida ────────────────────────────────────────────── */}
        {paso === 3 && (
          <div className="space-y-4">
            {/* Tipo de recogida */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-[13px] font-bold text-gray-700 mb-3">¿Dónde recogemos a tu mascota?</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: 'domicilio',    icon: MapPin,      label: 'En mi domicilio' },
                  { v: 'veterinaria',  icon: Building2,   label: 'En veterinaria'  },
                ].map(({ v, icon: Icon, label }) => (
                  <button key={v} type="button" onClick={() => setRecogida(p => ({ ...p, tipo: v }))}
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Ciudad</label>
                    <input className={INPUT} value={recogida.ciudad}
                      onChange={e => setRecogida(p => ({ ...p, ciudad: e.target.value }))} />
                  </div>
                  <div>
                    <label className={LABEL}>Barrio</label>
                    <input className={INPUT} placeholder="Chapinero" value={recogida.barrio}
                      onChange={e => setRecogida(p => ({ ...p, barrio: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Dirección exacta *</label>
                  <input className={INPUT} placeholder="Calle 45 # 12-34" value={recogida.direccion}
                    onChange={e => setRecogida(p => ({ ...p, direccion: e.target.value }))} />
                </div>
              </div>
            )}

            {/* Veterinaria */}
            {recogida.tipo === 'veterinaria' && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
                <p className="text-[13px] font-bold text-gray-700">Veterinaria</p>
                <div>
                  <label className={LABEL}>Buscar veterinaria</label>
                  <input className={INPUT} placeholder="Escribe el nombre..." value={busqVet}
                    onChange={e => { setBusqVet(e.target.value); setRecogida(p => ({ ...p, aliado_id: '', aliado_nombre_otro: '' })) }} />
                </div>
                {busqVet && vetsFiltradas.length > 0 && (
                  <div className="space-y-1.5">
                    {vetsFiltradas.map(a => (
                      <button key={a.id_aliado} type="button"
                        onClick={() => { setRecogida(p => ({ ...p, aliado_id: a.id_aliado, aliado_nombre_otro: '' })); setBusqVet(a.nombre) }}
                        className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all ${
                          recogida.aliado_id === a.id_aliado
                            ? 'border-[#3D5A27] bg-[#F0F7EB]'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
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
                    <input className={INPUT} placeholder="Clínica Veterinaria Ejemplo" value={recogida.aliado_nombre_otro}
                      onChange={e => setRecogida(p => ({ ...p, aliado_nombre_otro: e.target.value, aliado_id: '' }))} />
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
                <input type="time" className={INPUT} value={recogida.hora_aproximada}
                  onChange={e => setRecogida(p => ({ ...p, hora_aproximada: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL}>Indicaciones adicionales <span className="font-normal text-gray-400">(opcional)</span></label>
                <textarea className={`${INPUT} resize-none`} rows={2}
                  placeholder="Piso, portería, referencias, etc." value={recogida.notas}
                  onChange={e => setRecogida(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-700">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Nav buttons */}
        <div className={`flex gap-3 mt-6 ${paso > 0 ? 'justify-between' : 'justify-end'}`}>
          {paso > 0 && (
            <button type="button" onClick={() => { setPaso(p => p - 1); setError('') }}
              className="flex items-center gap-1.5 px-5 py-3 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-all">
              <ChevronLeft size={16} /> Atrás
            </button>
          )}
          {paso < PASOS.length - 1 ? (
            <button type="button" onClick={() => { if (canNext()) { setPaso(p => p + 1); setError('') } }}
              disabled={!canNext()}
              className="flex items-center gap-1.5 px-6 py-3 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #3D5A27, #263218)' }}>
              Continuar <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={enviar} disabled={submitting || !canNext()}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
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
