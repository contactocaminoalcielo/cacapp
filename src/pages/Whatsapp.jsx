// Bandeja de WhatsApp — línea de VETERINARIAS (Cloud API directo).
//
// Lo que ya opera en Zolutium NO pasa por aquí: esta pantalla solo ve los
// números migrados a nuestra app de Meta (WHATSAPP_ALLOWED_PHONE_IDS).
//
// Los datos NO vienen de Supabase: las tablas `whatsapp_*` no están expuestas
// por PostgREST. Todo entra por orbit-backend con JWT + rol. Ver lib/whatsappInbox.js.
//
// ⚠️ Refrescos: el polling NUNCA toca `cargando`. Poner el spinner en cada
// refresco desmonta el hilo y el coordinador pierde lo que estaba escribiendo
// (es el mismo bug que ya mordió en la app del técnico).
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  listarConversaciones, abrirHilo, marcarLeido, enviarMensaje,
  formatearNumero, haceCuanto, horaMensaje, etiquetaDia, restanteVentana, ESTADO_ENVIO,
} from '@/lib/whatsappInbox'
import {
  Search, Send, ArrowLeft, MessageCircle, Building2, User, AlertTriangle,
  Loader2, Clock, RefreshCw, Inbox,
} from 'lucide-react'

/** Cada cuánto se relee la bandeja. La tabla no está en Realtime (es del backend). */
const POLL_MS = 10000

export default function Whatsapp() {
  const [convs, setConvs]         = useState([])
  const [cargando, setCargando]   = useState(true)
  const [q, setQ]                 = useState('')
  const [activo, setActivo]       = useState(null)
  const [hilo, setHilo]           = useState(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const [texto, setTexto]         = useState('')
  const [enviando, setEnviando]   = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [errorCarga, setErrorCarga] = useState(null)

  const finRef      = useRef(null)
  const scrollRef   = useRef(null)
  const pegadoAbajo = useRef(true)
  const activoRef   = useRef(null)
  activoRef.current = activo

  // ── Carga ──────────────────────────────────────────────────────────────────
  const cargarLista = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true)
    try {
      const r = await listarConversaciones(q)
      setConvs(r.conversaciones || [])
      setErrorCarga(null)
    } catch (e) {
      // En el refresco silencioso no se molesta al usuario: si la red vuelve,
      // el siguiente tick lo arregla solo.
      if (!silencioso) setErrorCarga(e.message)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [q])

  const cargarHilo = useCallback(async (contacto, { silencioso = false } = {}) => {
    if (!contacto) return
    if (!silencioso) setCargandoHilo(true)
    try {
      const r = await abrirHilo(contacto)
      // Si el usuario cambió de conversación mientras la petición viajaba, esta
      // respuesta ya no sirve — pintarla metería el hilo equivocado.
      if (activoRef.current !== contacto) return
      setHilo(r)
    } catch (e) {
      if (!silencioso) setErrorCarga(e.message)
    } finally {
      if (!silencioso) setCargandoHilo(false)
    }
  }, [])

  useEffect(() => { cargarLista() }, [cargarLista])

  // Polling: se detiene con la pestaña en segundo plano (no tiene sentido
  // consultar cada 10s una pantalla que nadie está mirando).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      cargarLista({ silencioso: true })
      if (activoRef.current) cargarHilo(activoRef.current, { silencioso: true })
    }
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [cargarLista, cargarHilo])

  // ── Abrir conversación ─────────────────────────────────────────────────────
  async function abrir(contacto) {
    setActivo(contacto)
    setHilo(null)
    setTexto('')
    setErrorEnvio(null)
    pegadoAbajo.current = true
    await cargarHilo(contacto)
    try {
      await marcarLeido(contacto)
      setConvs(cs => cs.map(c => c.contacto === contacto ? { ...c, sin_leer: 0 } : c))
    } catch { /* el badge se corrige solo en el siguiente refresco */ }
  }

  // ── Enviar ─────────────────────────────────────────────────────────────────
  async function enviar() {
    const cuerpo = texto.trim()
    if (!cuerpo || enviando || !activo) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      await enviarMensaje(activo, cuerpo)
      setTexto('')
      pegadoAbajo.current = true
      await cargarHilo(activo, { silencioso: true })
      cargarLista({ silencioso: true })
    } catch (e) {
      // El texto NO se borra: el coordinador puede corregir y reintentar.
      setErrorEnvio(e.detalle?.ventana_cerrada
        ? 'La ventana de 24 horas se cerró. Para retomar esta conversación hace falta una plantilla aprobada (todavía no disponible en Orbit).'
        : e.message)
    } finally {
      setEnviando(false)
    }
  }

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  // Solo baja si el usuario ya estaba abajo. Si subió a leer algo viejo, un
  // mensaje nuevo no debe arrancarle la vista.
  useEffect(() => {
    if (pegadoAbajo.current) finRef.current?.scrollIntoView({ block: 'end' })
  }, [hilo])

  function onScroll(e) {
    const el = e.currentTarget
    pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const sinLeerTotal = useMemo(
    () => convs.reduce((a, c) => a + (c.sin_leer || 0), 0), [convs]
  )

  const conv = hilo?.contacto || convs.find(c => c.contacto === activo) || null
  const ventanaAbierta = conv?.ventana_abierta
  const restante = restanteVentana(conv?.ventana_hasta)

  return (
    <div>
      <Topbar />
      <div className="p-4 sm:p-6">
        <div className="flex rounded-2xl border border-gray-200 bg-white overflow-hidden"
             style={{ height: 'calc(100vh - 150px)', minHeight: 420 }}>

          {/* ── Lista de conversaciones ── */}
          <aside className={`${activo ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96 flex-col border-r border-gray-200 flex-shrink-0`}>
            <div className="p-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-bold text-[#0B1D4F]">Conversaciones</h2>
                  {sinLeerTotal > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[#1A5CD8] text-white text-[10px] font-bold">
                      {sinLeerTotal}
                    </span>
                  )}
                </div>
                <button onClick={() => cargarLista({ silencioso: true })}
                        className="p-1 rounded-md text-gray-400 hover:text-[#1A5CD8] hover:bg-gray-100 cursor-pointer"
                        title="Actualizar">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-8" placeholder="Buscar por nombre o número..."
                       value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {cargando ? (
                <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-[13px]">
                  <Loader2 size={15} className="animate-spin" /> Cargando...
                </div>
              ) : errorCarga ? (
                <div className="p-5 text-center">
                  <AlertTriangle size={20} className="mx-auto mb-2 text-amber-500" />
                  <p className="text-[12px] text-gray-500">{errorCarga}</p>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => cargarLista()}>
                    Reintentar
                  </Button>
                </div>
              ) : convs.length === 0 ? (
                <VacioLista hayFiltro={!!q.trim()} />
              ) : (
                convs.map(c => (
                  <ItemConversacion key={c.contacto} c={c}
                                    activo={c.contacto === activo}
                                    onClick={() => abrir(c.contacto)} />
                ))
              )}
            </div>
          </aside>

          {/* ── Hilo ── */}
          <section className={`${activo ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
            {!activo ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-2">
                <MessageCircle size={40} strokeWidth={1.3} />
                <p className="text-[13px] font-medium">Elige una conversación</p>
              </div>
            ) : (
              <>
                <CabeceraHilo conv={conv} contacto={activo} restante={restante}
                              onVolver={() => { setActivo(null); setHilo(null) }} />

                <div ref={scrollRef} onScroll={onScroll}
                     className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
                     style={{ background: '#F8F9FA' }}>
                  {cargandoHilo && !hilo ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-[13px]">
                      <Loader2 size={15} className="animate-spin" /> Cargando conversación...
                    </div>
                  ) : (
                    <Mensajes mensajes={hilo?.mensajes || []} />
                  )}
                  <div ref={finRef} />
                </div>

                <Redaccion
                  texto={texto} setTexto={setTexto}
                  enviando={enviando} onEnviar={enviar}
                  ventanaAbierta={ventanaAbierta} restante={restante}
                  error={errorEnvio}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function VacioLista({ hayFiltro }) {
  return (
    <div className="p-6 text-center">
      <Inbox size={26} className="mx-auto mb-3 text-gray-300" strokeWidth={1.4} />
      {hayFiltro ? (
        <p className="text-[12px] text-gray-500">Ningún contacto coincide con la búsqueda.</p>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-gray-600 mb-1">Todavía no hay conversaciones</p>
          <p className="text-[11.5px] text-gray-400 leading-relaxed">
            Aparecerán aquí en cuanto el número de veterinarias esté conectado a
            Cloud API y alguien escriba. Lo que sigue en Zolutium no pasa por acá.
          </p>
        </>
      )}
    </div>
  )
}

function ItemConversacion({ c, activo, onClick }) {
  const esAliado = c.tipo_contacto === 'ALIADO'
  const Icono = esAliado ? Building2 : User
  const noLeidos = c.sin_leer || 0

  return (
    <button onClick={onClick}
            className={`w-full text-left px-3 py-3 border-b border-gray-50 transition-colors cursor-pointer
                        ${activo ? 'bg-[#EEF3FF]' : 'hover:bg-gray-50'}`}>
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
                         ${esAliado ? 'bg-[#0B1D4F]' : 'bg-gray-300'}`}>
          <Icono size={14} className="text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[13px] truncate ${noLeidos ? 'font-bold text-[#0B1D4F]' : 'font-semibold text-gray-700'}`}>
              {c.nombre || formatearNumero(c.contacto)}
            </span>
            <span className="text-[10.5px] text-gray-400 flex-shrink-0">
              {haceCuanto(c.ultimo_mensaje_en)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className={`text-[11.5px] truncate ${noLeidos ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
              {c.ultima_direccion === 'OUT' && <span className="text-gray-400">Tú: </span>}
              {c.ultimo_texto || '—'}
            </span>
            {noLeidos > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#1A5CD8] text-white text-[10px] font-bold flex-shrink-0">
                {noLeidos}
              </span>
            )}
          </div>

          {/* Solo se anuncia el nombre cuando lo resolvió contra el catálogo: si
              es un número desconocido no hay nada útil que mostrar aquí. */}
          {c.nombre && (
            <span className="text-[10px] text-gray-400">
              {esAliado ? 'Veterinaria' : c.tipo_contacto === 'CLIENTE' ? 'Cliente' : 'Sin identificar'}
              {' · '}{formatearNumero(c.contacto)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function CabeceraHilo({ conv, contacto, restante, onVolver }) {
  const esAliado = conv?.tipo_contacto === 'ALIADO'
  return (
    <div className="px-3 py-2.5 border-b border-gray-200 flex items-center gap-3 bg-white">
      <button onClick={onVolver}
              className="md:hidden p-1 rounded-md text-gray-500 hover:bg-gray-100 cursor-pointer">
        <ArrowLeft size={17} />
      </button>

      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                       ${esAliado ? 'bg-[#0B1D4F]' : 'bg-gray-300'}`}>
        {esAliado ? <Building2 size={14} className="text-white" /> : <User size={14} className="text-white" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-[#0B1D4F] truncate">
          {conv?.nombre || formatearNumero(contacto)}
        </p>
        <p className="text-[11px] text-gray-400 truncate">
          {formatearNumero(contacto)}
          {conv?.nombre_perfil && conv.nombre_perfil !== conv.nombre && ` · ${conv.nombre_perfil}`}
        </p>
      </div>

      {restante && (
        <span className="hidden sm:flex items-center gap-1 text-[10.5px] text-gray-400 flex-shrink-0"
              title="Tiempo restante para responder con texto libre">
          <Clock size={11} /> {restante}
        </span>
      )}
    </div>
  )
}

function Mensajes({ mensajes }) {
  if (!mensajes.length) {
    return <p className="text-center text-[12px] text-gray-400 py-8">No hay mensajes en esta conversación.</p>
  }

  let ultimoDia = null
  return mensajes.map(m => {
    const dia = etiquetaDia(m.ocurrido_en)
    const nuevoDia = dia !== ultimoDia
    ultimoDia = dia
    return (
      <div key={m.id}>
        {nuevoDia && (
          <div className="flex justify-center my-3">
            <span className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[10.5px] font-semibold text-gray-500">
              {dia}
            </span>
          </div>
        )}
        <Burbuja m={m} />
      </div>
    )
  })
}

function Burbuja({ m }) {
  const mio = m.direccion === 'OUT'
  const est = mio ? ESTADO_ENVIO[m.estado] : null
  const fallo = m.estado === 'failed'

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex ${mio ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`max-w-[75%] px-3 py-2 rounded-2xl shadow-sm
                       ${mio
                         ? fallo ? 'bg-red-50 border border-red-200 rounded-br-sm'
                                 : 'bg-[#1A5CD8] text-white rounded-br-sm'
                         : 'bg-white border border-gray-100 rounded-bl-sm'}`}>
        <p className={`text-[13px] whitespace-pre-wrap break-words leading-snug
                       ${mio && !fallo ? 'text-white' : 'text-gray-800'}`}>
          {m.texto || <span className="italic opacity-70">[sin texto]</span>}
        </p>

        <div className={`flex items-center gap-1.5 mt-1 justify-end`}>
          {mio && m.enviado_por_nombre && (
            <span className={`text-[9.5px] ${fallo ? 'text-gray-400' : 'text-white/60'}`}>
              {m.enviado_por_nombre}
            </span>
          )}
          <span className={`text-[10px] ${mio && !fallo ? 'text-white/70' : 'text-gray-400'}`}>
            {horaMensaje(m.ocurrido_en)}
          </span>
          {est && (
            <span className={`text-[10px] font-bold ${fallo ? est.clase : mio ? 'text-white/80' : est.clase}`}
                  title={est.label}>
              {est.icono}
            </span>
          )}
        </div>

        {fallo && m.error && (
          <p className="text-[10.5px] text-red-600 mt-1 border-t border-red-200 pt-1">
            No se envió: {m.error}
          </p>
        )}
      </div>
    </motion.div>
  )
}

function Redaccion({ texto, setTexto, enviando, onEnviar, ventanaAbierta, restante, error }) {
  const ref = useRef(null)

  // El textarea crece con el contenido hasta un tope, como en WhatsApp.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [texto])

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onEnviar()
    }
  }

  if (!ventanaAbierta) {
    return (
      <div className="px-4 py-3 border-t border-gray-200 bg-amber-50">
        <div className="flex gap-2 items-start">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-semibold text-amber-900">Ventana de 24 horas cerrada</p>
            <p className="text-[11px] text-amber-700 leading-relaxed mt-0.5">
              WhatsApp solo permite escribir libremente durante las 24 horas siguientes
              al último mensaje del contacto. Para retomar hace falta una plantilla
              aprobada por Meta — todavía no está disponible en Orbit.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-gray-200 bg-white">
      <AnimatePresence>
        {error && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="px-4 pt-2 overflow-hidden">
            <p className="text-[11.5px] text-red-600 flex items-start gap-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {error}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-3 flex items-end gap-2">
        <textarea
          ref={ref} rows={1} value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={enviando}
          placeholder="Escribe un mensaje..."
          className="flex-1 resize-none px-3 py-2.5 text-[13px] text-gray-900 bg-white
                     border border-gray-200 rounded-lg placeholder:text-gray-400
                     outline-none transition-all focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10
                     disabled:bg-gray-50"
        />
        <Button onClick={onEnviar} disabled={enviando || !texto.trim()} className="h-10 px-4">
          {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </Button>
      </div>

      {restante && (
        <p className="px-4 pb-2 text-[10px] text-gray-400">
          Ventana abierta · quedan {restante} para responder con texto libre
        </p>
      )}
    </div>
  )
}
