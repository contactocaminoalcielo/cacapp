// Portal público donde la familia elige la planta en la que queda su mascota
// al terminar el compostaje (migración 149). Sin sesión: el código del enlace es
// el secreto, y es el MISMO del portal de fotos — el cliente ya lo tiene.
//
// El precio nunca sale de aquí: esta pantalla manda ids y cantidades, y el
// backend resuelve el monto contra `plantas` dentro de su transacción.
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, Leaf, Loader2, Send, Plus, Minus } from 'lucide-react'
import { portalPlanta, portalElegirPlanta } from '@/lib/plantas'

const VERDE  = '#1D8A55'
const V_LITE = '#E8F3EB'
const V_MID  = '#A0D4B0'
const BG     = '#F4F7F4'
const BORD   = '#D8E5D8'

const pesos = v => `$${Number(v || 0).toLocaleString('es-CO')}`

export default function PlantaCliente({ codigo: codigoProp }) {
  const [fase,      setFase]      = useState(codigoProp ? 'cargando' : 'entrada')
  const [cInput,    setCInput]    = useState(codigoProp || '')
  const [codigo,    setCodigo]    = useState((codigoProp || '').toUpperCase())
  const [datos,     setDatos]     = useState(null)
  const [elegida,   setElegida]   = useState('')
  const [extras,    setExtras]    = useState({})   // { [planta_id]: cantidad }
  const [error,     setError]     = useState('')
  const [enviando,  setEnviando]  = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  async function cargar(cod) {
    const c = String(cod || '').trim().toUpperCase()
    if (!c) return
    setFase('cargando'); setError(''); setCodigo(c)
    try {
      const r = await portalPlanta(c)
      if (r.status === 404 || !r.ok) {
        setError('No encontramos este enlace. Verifica el código o escríbenos.')
        setFase('entrada')
        return
      }
      setDatos(r)
      setElegida(r.eleccion?.planta_id || '')
      setFase(r.cerrado ? 'cerrado' : (r.ya_eligio && !r.adicionales?.length ? 'listo' : 'form'))
    } catch {
      setError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.')
      setFase('entrada')
    }
  }

  const mascota    = datos?.servicio?.mascota || 'tu mascota'
  const saludo     = datos?.servicio?.nombre_cliente ? `Hola, ${datos.servicio.nombre_cliente}.` : 'Hola.'
  const yaEligio   = !!datos?.ya_eligio
  const opciones   = datos?.opciones || []
  const disponibles = datos?.adicionales || []
  const comprados  = datos?.comprados || []
  const totalExtras = disponibles.reduce((s, p) => s + (extras[p.id] || 0) * (p.precio || 0), 0)
  const puedeEnviar = (yaEligio || !!elegida) && (!yaEligio || totalExtras > 0 || Object.keys(extras).length > 0)

  function cambiarExtra(id, delta) {
    setExtras(p => {
      const n = { ...p }
      const v = (n[id] || 0) + delta
      if (v <= 0) delete n[id]; else n[id] = Math.min(v, 10)
      return n
    })
  }

  async function enviar() {
    if (enviando) return
    setEnviando(true); setError('')
    try {
      const r = await portalElegirPlanta(codigo, {
        planta_id: yaEligio ? undefined : elegida,
        adicionales: Object.entries(extras).map(([planta_id, cantidad]) => ({ planta_id, cantidad })),
      })
      if (!r.ok) {
        setError(r.error === 'cerrado'
          ? 'Este enlace ya no está disponible. Escríbenos y te ayudamos.'
          : 'No pudimos guardar tu elección. Inténtalo de nuevo en un momento.')
        return
      }
      setResultado(r)
      setFase('listo')
    } catch {
      setError('No pudimos guardar tu elección. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  // ── Pantallas simples ──────────────────────────────────────────────────────
  if (fase === 'cargando') return (
    <Marco>
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Loader2 className="animate-spin" size={26} color={VERDE} />
        <p className="text-[13px] text-gray-500">Un momento…</p>
      </div>
    </Marco>
  )

  if (fase === 'entrada') return (
    <Marco>
      <div className="py-8">
        <Leaf size={30} color={VERDE} className="mx-auto mb-3" />
        <h1 className="text-[19px] font-bold text-center text-gray-900 mb-1">Elige la planta</h1>
        <p className="text-[13px] text-gray-500 text-center mb-6">
          Escribe el código que te enviamos por WhatsApp.
        </p>
        <input
          value={cInput}
          onChange={e => setCInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && cargar(cInput)}
          placeholder="CÓDIGO"
          className="w-full text-center tracking-[0.3em] text-[18px] font-bold rounded-xl border-2 px-4 py-3 outline-none"
          style={{ borderColor: BORD, background: '#fff' }}
        />
        {error && <p role="alert" className="text-[12px] text-red-600 mt-3 text-center">{error}</p>}
        <button onClick={() => cargar(cInput)} disabled={!cInput.trim()}
          className="w-full mt-4 rounded-xl py-3.5 text-white font-semibold text-[14px] disabled:opacity-40"
          style={{ background: VERDE }}>
          Continuar
        </button>
      </div>
    </Marco>
  )

  if (fase === 'cerrado') return (
    <Marco>
      <div className="py-12 text-center">
        <Leaf size={30} color="#9CA3AF" className="mx-auto mb-3" />
        <h1 className="text-[17px] font-bold text-gray-900 mb-2">Este enlace ya no está disponible</h1>
        <p className="text-[13px] text-gray-500">
          Escríbenos por WhatsApp y con gusto continuamos contigo.
        </p>
      </div>
    </Marco>
  )

  if (fase === 'listo') {
    const nombre = resultado?.planta || datos?.eleccion?.planta_nombre
    const nuevos = resultado?.extras || []
    return (
      <Marco>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-10 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center"
               style={{ background: V_LITE, border: `2px solid ${V_MID}` }}>
            <Check size={26} color={VERDE} />
          </div>
          <h1 className="text-[18px] font-bold text-gray-900 mb-2">Gracias por confiar en nosotros</h1>
          {nombre && (
            <p className="text-[14px] text-gray-700 mb-1">
              {mascota} continuará su camino en un <strong>{nombre}</strong>.
            </p>
          )}
          {!!nuevos.length && (
            <div className="mt-4 rounded-xl p-3 text-left" style={{ background: V_LITE, border: `1px solid ${V_MID}` }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Agregaste</p>
              {nuevos.map((x, i) => (
                <div key={i} className="flex justify-between text-[13px] text-gray-800">
                  <span>{x.cantidad}× {x.nombre}</span><span className="font-semibold">{pesos(x.total)}</span>
                </div>
              ))}
              <p className="text-[11px] text-gray-500 mt-2">Coordinamos el pago contigo al momento de la entrega.</p>
            </div>
          )}
          <p className="text-[12px] text-gray-500 mt-5">Te escribiremos para coordinar la entrega.</p>
        </motion.div>
      </Marco>
    )
  }

  // ── Formulario ─────────────────────────────────────────────────────────────
  return (
    <Marco>
      <div className="pb-24">
        <div className="text-center pt-6 pb-5">
          <Leaf size={28} color={VERDE} className="mx-auto mb-2.5" />
          <h1 className="text-[18px] font-bold text-gray-900 leading-snug">
            El proceso de {mascota} ha terminado
          </h1>
          <p className="text-[13px] text-gray-600 mt-2 leading-relaxed">
            {saludo} Su compostaje se completó con todo el cuidado.
            Ahora {mascota} vuelve a la vida en forma de planta:
            elige la que quieres que la acompañe.
          </p>
        </div>

        {/* Elección de especie */}
        {yaEligio ? (
          <div className="rounded-xl px-4 py-3 mb-5" style={{ background: V_LITE, border: `1px solid ${V_MID}` }}>
            <p className="text-[13px] text-gray-800">
              Ya elegiste <strong>{datos?.eleccion?.planta_nombre}</strong>.
              Si necesitas cambiarla, escríbenos por WhatsApp.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Elige la planta</p>
            <div className="space-y-2.5 mb-6">
              {opciones.map(p => {
                const sel = elegida === p.id
                return (
                  <button key={p.id} onClick={() => setElegida(p.id)}
                    className="w-full text-left rounded-2xl border-2 p-3.5 flex items-center gap-3 transition-all"
                    style={{ borderColor: sel ? VERDE : BORD, background: sel ? V_LITE : '#fff' }}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
                      : <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: V_LITE }}>
                          <Leaf size={20} color={VERDE} />
                        </div>}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-gray-900">{p.nombre}</div>
                      {p.descripcion && <div className="text-[12px] text-gray-500 leading-snug mt-0.5">{p.descripcion}</div>}
                    </div>
                    <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0"
                         style={{ borderColor: sel ? VERDE : '#D1D5DB', background: sel ? VERDE : '#fff' }}>
                      {sel && <Check size={14} color="#fff" />}
                    </div>
                  </button>
                )
              })}
              {!opciones.length && (
                <p className="text-[13px] text-gray-500">
                  Estamos preparando las opciones. Escríbenos por WhatsApp y te ayudamos.
                </p>
              )}
            </div>
          </>
        )}

        {/* Extras ya comprados antes */}
        {!!comprados.length && (
          <div className="rounded-xl p-3 mb-5" style={{ background: '#F9FAFB', border: `1px solid ${BORD}` }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Ya agregaste</p>
            {comprados.map(x => (
              <div key={x.planta_id} className="flex justify-between text-[13px] text-gray-700">
                <span>{x.cantidad}× {x.nombre}</span><span>{pesos(x.total)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Extras disponibles */}
        {!!disponibles.length && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">¿Deseas algo más?</p>
            <p className="text-[12px] text-gray-500 mb-2.5">Opcional. Lo coordinamos contigo en la entrega.</p>
            <div className="space-y-2.5">
              {disponibles.map(p => {
                const n = extras[p.id] || 0
                return (
                  <div key={p.id} className="rounded-2xl border-2 p-3.5 flex items-center gap-3"
                       style={{ borderColor: n > 0 ? VERDE : BORD, background: n > 0 ? V_LITE : '#fff' }}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                      : <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#F3F4F6' }}>
                          <Plus size={18} color="#9CA3AF" />
                        </div>}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-gray-900">{p.nombre}</div>
                      {p.descripcion && <div className="text-[12px] text-gray-500 leading-snug">{p.descripcion}</div>}
                      <div className="text-[13px] font-bold mt-0.5" style={{ color: VERDE }}>{pesos(p.precio)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => cambiarExtra(p.id, -1)} disabled={!n}
                        aria-label={`Quitar ${p.nombre}`}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center disabled:opacity-30"
                        style={{ borderColor: BORD }}>
                        <Minus size={14} />
                      </button>
                      <span className="w-5 text-center text-[14px] font-bold">{n}</span>
                      <button onClick={() => cambiarExtra(p.id, 1)}
                        aria-label={`Agregar ${p.nombre}`}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                        style={{ background: VERDE }}>
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {error && <p role="alert" className="text-[12px] text-red-600 mt-4">{error}</p>}
      </div>

      {/* Barra fija de envío */}
      <div className="fixed left-0 right-0 bottom-0 px-4 py-3 border-t"
           style={{ background: '#fff', borderColor: BORD }}>
        <div className="max-w-md mx-auto">
          {totalExtras > 0 && (
            <div className="flex justify-between text-[13px] mb-2">
              <span className="text-gray-500">Adicionales</span>
              <span className="font-bold text-gray-900">{pesos(totalExtras)}</span>
            </div>
          )}
          <button onClick={enviar} disabled={!puedeEnviar || enviando}
            className="w-full rounded-xl py-3.5 text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: VERDE }}>
            {enviando ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            {enviando ? 'Enviando…' : (yaEligio ? 'Agregar' : 'Confirmar mi elección')}
          </button>
        </div>
      </div>
    </Marco>
  )
}

function Marco({ children }) {
  return (
    <div className="min-h-screen px-4" style={{ background: BG }}>
      <div className="max-w-md mx-auto">
        {children}
        <p className="text-center text-[11px] text-gray-400 py-6">Camino al Cielo</p>
      </div>
    </div>
  )
}
