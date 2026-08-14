// La ventanita de WhatsApp abajo a la derecha, en toda la app.
//
// No sustituye a la pantalla `/whatsapp` —ahí están las listas de trabajo, las
// etiquetas y los adjuntos—: esto es para lo que pasa AHORA. Que una vet
// escriba mientras estás en el Kanban y puedas contestarle sin perder lo que
// tenías abierto.
import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, X, ChevronLeft, Send, Volume2, VolumeX, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useChatWa } from '@/contexts/ChatWaContext'
import {
  abrirHilo, enviarMensaje, marcarLeido,
  formatearNumero, haceCuanto, horaMensaje, restanteVentana,
} from '@/lib/whatsappInbox'
import { valorarRespuesta } from '@/lib/agenteApi'

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
        onClick={() => onAbrir(aviso.contacto)}
        className="w-full text-left p-3 pr-9 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: VERDE }} />
          <span className="text-[13px] font-bold text-gray-800 truncate">{aviso.nombre}</span>
        </div>
        <p className="mt-1 text-[12px] text-gray-500 line-clamp-2 leading-snug">
          {aviso.texto || 'Te escribió por WhatsApp'}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onCerrar(aviso.contacto)}
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
          key={c.contacto}
          type="button"
          onClick={() => onAbrir(c.contacto)}
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

/**
 * Marcar una respuesta del agente como buena o mala, y decir qué debió decir.
 *
 * No cambia nada del agente por sí solo: queda como corrección para que
 * coordinación la revise en la pantalla del agente y decida si se vuelve regla
 * (migración 099). Aquí se marca en caliente, que es cuando uno se acuerda.
 */
function Valorar({ mensajeId }) {
  const [marca, setMarca] = useState(null)      // null | true | false
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function marcar(buena, correccion = null) {
    setGuardando(true)
    try {
      await valorarRespuesta(mensajeId, buena, correccion)
      setMarca(buena)
      setAbierto(false)
      setTexto('')
    } catch { /* se puede volver a intentar; no se rompe el chat */ }
    finally { setGuardando(false) }
  }

  if (marca !== null && !abierto) {
    return (
      <span className="mt-0.5 text-[9px] text-gray-400">
        {marca ? '👍 marcada como buena' : '👎 corrección enviada'}
      </span>
    )
  }

  return (
    <div className="mt-0.5 flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button" disabled={guardando} onClick={() => marcar(true)}
          title="Estuvo bien" className="p-0.5 text-gray-300 hover:text-emerald-600 transition-colors"
        >
          <ThumbsUp size={12} />
        </button>
        <button
          type="button" disabled={guardando} onClick={() => setAbierto(a => !a)}
          title="Estuvo mal" className={`p-0.5 transition-colors ${abierto ? 'text-red-500' : 'text-gray-300 hover:text-red-500'}`}
        >
          <ThumbsDown size={12} />
        </button>
      </div>
      {abierto && (
        <div className="w-[240px] rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <textarea
            rows={2} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="¿Qué debió responder?"
            className="w-full text-[11px] rounded-lg border border-gray-200 px-2 py-1.5 resize-y outline-none focus:border-gray-400"
          />
          <div className="flex justify-end gap-1 mt-1">
            <button type="button" onClick={() => setAbierto(false)}
              className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800">Cancelar</button>
            <button
              type="button" disabled={guardando || !texto.trim()}
              onClick={() => marcar(false, texto.trim())}
              className="px-2 py-1 text-[11px] rounded-lg text-white disabled:opacity-40"
              style={{ backgroundColor: VERDE }}
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Hilo({ contacto, onVolver }) {
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
      const r = await abrirHilo(contacto)
      setHilo(r)
      setError(null)
    } catch (e) {
      if (!silencioso) setError(e.message)
    } finally {
      if (!silencioso) setCargando(false)
    }
  }, [contacto])

  useEffect(() => {
    cargar()
    marcarLeido(contacto).then(() => marcarVistaLocal(contacto)).catch(() => {})
    // Refresco silencioso: NUNCA toca `cargando`, o la ventana parpadearía
    // cada cinco segundos mientras alguien escribe.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') cargar({ silencioso: true })
    }, 5000)
    return () => clearInterval(id)
  }, [contacto, cargar])

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
      await enviarMensaje(contacto, t)
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
              {m.direccion === 'OUT' && m.enviado_por == null && (
                <Valorar mensajeId={m.id} />
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
    conSonido, alternarSonido, abrirChat, cerrarChat, descartarAviso,
  } = chat

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 print:hidden">
      {/* Los avisos solo mientras la ventana está cerrada: con el chat abierto
          delante, una tarjeta encima es ruido sobre lo mismo. */}
      <AnimatePresence>
        {!abierto && avisos.map(a => (
          <div key={a.contacto} className="relative">
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
            <div className="flex items-center gap-2 px-3 py-2 text-white" style={{ backgroundColor: VERDE }}>
              <MessageCircle size={15} />
              <span className="text-[13px] font-bold flex-1">WhatsApp</span>
              <button
                type="button"
                onClick={alternarSonido}
                title={conSonido ? 'Silenciar el aviso' : 'Activar el sonido'}
                className="p-1 rounded-lg hover:bg-white/15"
              >
                {conSonido ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              <button type="button" onClick={cerrarChat} className="p-1 rounded-lg hover:bg-white/15" aria-label="Cerrar">
                <X size={15} />
              </button>
            </div>

            {contactoActivo
              ? <Hilo contacto={contactoActivo} onVolver={() => abrirChat(null)} />
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
