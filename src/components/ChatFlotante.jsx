// La ventanita de WhatsApp abajo a la derecha, en toda la app.
//
// No sustituye a la pantalla `/whatsapp` —ahí están las listas de trabajo, las
// etiquetas y los adjuntos—: esto es para lo que pasa AHORA. Que una vet
// escriba mientras estás en el Kanban y puedas contestarle sin perder lo que
// tenías abierto.
import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, X, ChevronLeft, Send, Volume2, VolumeX, Loader2 } from 'lucide-react'
import { useChatWa } from '@/contexts/ChatWaContext'
import {
  abrirHilo, enviarMensaje, marcarLeido,
  formatearNumero, haceCuanto, horaMensaje, restanteVentana,
  identidadLinea, claveConversacion,
} from '@/lib/whatsappInbox'
import ValorarRespuesta from '@/components/ValorarRespuesta'

const VERDE = '#3D5A27'

/** Aviso emergente: quién escribió y qué dijo. Al tocarlo, abre esa charla. */
function Aviso({ aviso, onAbrir, onCerrar }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="w-[300px] rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onAbrir(aviso.contacto, aviso.linea)}
        className="w-full text-left p-3 pr-9 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: VERDE }} />
          <span className="text-[13px] font-bold text-gray-800 truncate">{aviso.nombre}</span>
        </div>
        <p className="mt-1 text-[12px] text-gray-500 line-clamp-2 leading-snug">
          {aviso.texto || 'Te escribió por WhatsApp'}
        </p>
        <p className="mt-1 text-[10px] font-semibold text-gray-400">
          {identidadLinea(aviso.linea).nombre}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onCerrar(aviso.contacto, aviso.linea)}
        aria-label="Descartar aviso"
        className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}

function Lista({ conversaciones, onAbrir }) {
  if (!conversaciones.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-[12px] text-gray-400">Todavía no hay conversaciones.</p>
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {conversaciones.map(c => (
        <button
          key={claveConversacion(c.contacto, c.phone_number_id)}
          type="button"
          onClick={() => onAbrir(c.contacto, c.phone_number_id)}
          className="w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[13px] truncate ${c.sin_leer ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
              {c.nombre || formatearNumero(c.contacto)}
            </span>
            <span className="text-[10px] text-gray-400 flex-shrink-0">{haceCuanto(c.ultimo_mensaje_en)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className={`text-[11px] truncate ${c.sin_leer ? 'text-gray-700' : 'text-gray-400'}`}>
              {c.ultima_direccion === 'OUT' ? '· ' : ''}{c.ultimo_texto || ''}
            </p>
            {c.sin_leer > 0 && (
              <span
                className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white grid place-items-center"
                style={{ backgroundColor: VERDE }}
              >
                {c.sin_leer}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

function Hilo({ contacto, linea, onVolver }) {
  const { marcarVistaLocal } = useChatWa()
  const [hilo, setHilo] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const finRef = useRef(null)

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true)
    try {
      const r = await abrirHilo(contacto, linea)
      setHilo(r)
      setError(null)
    } catch (e) {
      if (!silencioso) setError(e.message)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [contacto, linea])

  useEffect(() => {
    cargar()
    marcarLeido(contacto, linea).then(() => marcarVistaLocal(contacto, linea)).catch(() => {})
    // Refresco silencioso: NUNCA toca `cargando`, o la ventana parpadearía
    // cada cinco segundos mientras alguien escribe.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') cargar({ silencioso: true })
    }, 5000)
    return () => clearInterval(id)
  }, [contacto, linea, cargar, marcarVistaLocal])

  useEffect(() => { finRef.current?.scrollIntoView({ block: 'end' }) }, [hilo?.mensajes?.length])

  const conv = hilo?.contacto || {}
  const ventana = restanteVentana(conv.ventana_hasta)
  const cerrada = conv.ventana_abierta === false

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setError(null)
    try {
      await enviarMensaje(contacto, t, linea)
      setTexto('')
      await cargar({ silencioso: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 px-2 py-2 border-b border-gray-200 bg-gray-50">
        <button type="button" onClick={onVolver} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-600">
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-gray-800 truncate">
            {conv.nombre || formatearNumero(contacto)}
          </div>
          {ventana && <div className="text-[10px] text-gray-400">{ventana}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 bg-[#F7F7F5]">
        {cargando && (
          <div className="h-full grid place-items-center text-gray-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {!cargando && (hilo?.mensajes || []).map(m => (
          <div key={m.id} className={`flex ${m.direccion === 'OUT' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${m.direccion === 'OUT' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div
                className={`rounded-2xl px-3 py-1.5 text-[12px] leading-snug whitespace-pre-wrap break-words ${
                  m.direccion === 'OUT' ? 'text-white rounded-br-sm' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'
                }`}
                style={m.direccion === 'OUT' ? { backgroundColor: VERDE } : undefined}
              >
                {m.texto || <span className="italic opacity-70">[adjunto — ábrelo en WhatsApp]</span>}
                <div className={`mt-0.5 text-[9px] ${m.direccion === 'OUT' ? 'text-white/60' : 'text-gray-400'}`}>
                  {horaMensaje(m.ocurrido_en)}
                  {m.direccion === 'OUT' && m.enviado_por == null && ' · agente'}
                </div>
              </div>
              {/* Solo las respuestas del AGENTE: valorar lo que escribió una
                  persona no significa nada, y `enviado_por` es justo lo que los
                  distingue (el backend lo vuelve a comprobar). */}
              {m.direccion === 'OUT' && !m.enviado_por && m.estado !== 'failed' && (
                <span className="mt-0.5"><ValorarRespuesta mensajeId={m.id} /></span>
              )}
            </div>
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {error && <div className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 border-t border-red-100">{error}</div>}

      {cerrada ? (
        <div className="px-3 py-2.5 border-t border-gray-200 bg-amber-50 text-[11px] text-amber-800">
          Pasaron más de 24 h desde su último mensaje: WhatsApp no deja escribir texto libre.
          Hay que usar una plantilla.
        </div>
      ) : (
        <div className="p-2 border-t border-gray-200 flex items-end gap-1.5">
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            rows={1}
            placeholder="Escribe…"
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-[12px] outline-none focus:border-gray-400 max-h-24"
          />
          <button
            type="button"
            onClick={enviar}
            disabled={!texto.trim() || enviando}
            className="p-2 rounded-xl text-white disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: VERDE }}
            aria-label="Enviar"
          >
            {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      )}
    </>
  )
}

export default function ChatFlotante() {
  const chat = useChatWa()
  if (!chat?.vigila) return null

  const {
    conversaciones, sinLeer, avisos, abierto, contactoActivo,
    lineas, lineaSeleccionada, lineaActiva, seleccionarLinea,
    conSonido, alternarSonido, abrirChat, cerrarChat, descartarAviso,
  } = chat

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {/* Los avisos solo mientras la ventana está cerrada: con el chat abierto
          delante, una tarjeta encima es ruido sobre lo mismo. */}
      <AnimatePresence>
        {!abierto && avisos.map(a => (
          <div key={claveConversacion(a.contacto, a.linea)} className="relative">
            <Aviso aviso={a} onAbrir={abrirChat} onCerrar={descartarAviso} />
          </div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {abierto && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="w-[330px] h-[460px] max-h-[75vh] rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
          >
            <div className="px-3 py-2 text-white" style={{ backgroundColor: VERDE }}>
              <div className="flex items-center gap-2">
                <MessageCircle size={15} />
                <span className="text-[13px] font-bold flex-1">WhatsApp</span>
                <button
                  type="button"
                  onClick={alternarSonido}
                  title={conSonido ? 'Silenciar el aviso' : 'Activar el sonido'}
                  className="min-w-11 min-h-11 grid place-items-center rounded-lg hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {conSonido ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
                <button type="button" onClick={cerrarChat}
                        className="min-w-11 min-h-11 grid place-items-center rounded-lg hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        aria-label="Cerrar">
                  <X size={15} />
                </button>
              </div>
              {lineas.length > 0 && (
                <label className="block mt-1">
                  <span className="sr-only">Bandeja de WhatsApp</span>
                  <select value={lineaSeleccionada || ''}
                          onChange={e => seleccionarLinea(e.target.value)}
                          className="w-full min-h-11 rounded-xl border border-white/25 bg-white/15 px-3 text-[12px] font-semibold text-white outline-none focus:ring-2 focus:ring-white cursor-pointer">
                    {lineas.map(id => {
                      const l = identidadLinea(id)
                      return <option key={id} value={id} className="text-gray-900">{l.nombre} · {l.numero}</option>
                    })}
                  </select>
                </label>
              )}
            </div>

            {contactoActivo
              ? <Hilo contacto={contactoActivo} linea={lineaActiva || lineaSeleccionada}
                      onVolver={() => abrirChat(null)} />
              : <Lista conversaciones={conversaciones} onAbrir={abrirChat} />}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => (abierto ? cerrarChat() : abrirChat(null))}
        className="relative w-12 h-12 rounded-full shadow-lg grid place-items-center text-white"
        style={{ backgroundColor: VERDE }}
        aria-label="Conversaciones de WhatsApp"
      >
        {abierto ? <X size={20} /> : <MessageCircle size={20} />}
        {!abierto && sinLeer > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-red-500 text-[10px] font-bold grid place-items-center border-2 border-white">
            {sinLeer > 99 ? '99+' : sinLeer}
          </span>
        )}
      </motion.button>
    </div>
  )
}
