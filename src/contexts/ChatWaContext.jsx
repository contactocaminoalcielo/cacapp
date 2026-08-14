// Vigilancia de la bandeja de WhatsApp para toda la app.
//
// Antes, que una veterinaria escribiera solo se notaba si estabas mirando el
// número del menú lateral. Ahora suena, sale un aviso y se puede contestar sin
// salir de donde estés — la conversación llega a ti, no al revés.
//
// Vive aquí y no en la página `/whatsapp` a propósito: el aviso tiene que
// funcionar estando en Kanban, en Producción o en Finanzas.
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { listarConversaciones } from '@/lib/whatsappInbox'

const POLL_MS = 10000
// Se lee del documento en vez de escribirlo a mano: puesto a pelo ("Orbit")
// renombraría la pestaña en silencio la primera vez que llegue un mensaje.
const TITULO_BASE = typeof document !== 'undefined' ? document.title : 'Orbit'

const ChatWaContext = createContext(null)

/**
 * Un pitido corto sintetizado, sin archivo de audio.
 *
 * Se genera con WebAudio en vez de servir un .mp3 porque el bundle va por
 * Actions y un asset más es un asset que se puede quedar sin desplegar. Además
 * los navegadores bloquean el audio hasta que el usuario ha interactuado con la
 * página: si falla, falla en silencio — el aviso visual sigue estando.
 */
function pitar() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const ahora = ctx.currentTime
    // Dos notas cortas, tipo timbre. Volumen bajo: esto suena en una oficina.
    ;[[880, 0], [1174, 0.12]].forEach(([hz, t]) => {
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      vol.gain.setValueAtTime(0.0001, ahora + t)
      vol.gain.exponentialRampToValueAtTime(0.12, ahora + t + 0.02)
      vol.gain.exponentialRampToValueAtTime(0.0001, ahora + t + 0.11)
      osc.connect(vol).connect(ctx.destination)
      osc.start(ahora + t)
      osc.stop(ahora + t + 0.12)
    })
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch { /* sin sonido, pero el aviso visual queda */ }
}

export function ChatWaProvider({ children }) {
  const { personalData } = useAuth()
  // La bandeja es de coordinación. Sin esto, PRODUCTOR y OPERARIO recibirían un
  // 403 cada diez segundos — el mismo criterio que ya usa BadgesContext.
  const vigila = ['COORDINADOR', 'ADMIN'].includes(personalData?.rol)

  const [conversaciones, setConversaciones] = useState([])
  const [sinLeer, setSinLeer] = useState(0)
  const [avisos, setAvisos] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [contactoActivo, setContactoActivo] = useState(null)
  const [conSonido, setConSonido] = useState(
    () => localStorage.getItem('orbit.chat.sonido') !== 'no'
  )

  // Lo último que habíamos visto de cada conversación. Es un ref y no un
  // estado: cambia en cada vuelta del reloj y no debe repintar nada.
  const visto = useRef(new Map())
  const primeraVuelta = useRef(true)
  const sonidoRef = useRef(conSonido)
  sonidoRef.current = conSonido

  const alternarSonido = useCallback(() => {
    setConSonido(s => {
      localStorage.setItem('orbit.chat.sonido', s ? 'no' : 'si')
      return !s
    })
  }, [])

  const descartarAviso = useCallback(contacto => {
    setAvisos(a => a.filter(x => x.contacto !== contacto))
  }, [])

  const abrirChat = useCallback(contacto => {
    setAbierto(true)
    setContactoActivo(contacto || null)
    if (contacto) descartarAviso(contacto)
  }, [descartarAviso])

  const cerrarChat = useCallback(() => {
    setAbierto(false)
    setContactoActivo(null)
  }, [])

  /** Marca en memoria que esta conversación queda leída, sin esperar al reloj. */
  const marcarVistaLocal = useCallback(contacto => {
    setConversaciones(cs => cs.map(c => c.contacto === contacto ? { ...c, sin_leer: 0 } : c))
    setSinLeer(n => {
      const c = conversaciones.find(x => x.contacto === contacto)
      return Math.max(0, n - (c?.sin_leer || 0))
    })
  }, [conversaciones])

  useEffect(() => {
    if (!vigila) return
    let vivo = true

    async function mirar() {
      try {
        const r = await listarConversaciones()
        if (!vivo) return
        const lista = r.conversaciones || []
        setConversaciones(lista)
        setSinLeer(r.sin_leer_total || 0)

        // ── ¿Qué es nuevo? ──
        // Se compara contra lo que vimos la vuelta anterior. En la PRIMERA
        // vuelta no se avisa de nada: si no, al abrir Orbit sonaría un pitido
        // por cada conversación sin leer que llevara días ahí.
        const nuevos = []
        for (const c of lista) {
          const antes = visto.current.get(c.contacto)
          visto.current.set(c.contacto, c.ultimo_mensaje_en)
          if (primeraVuelta.current) continue
          // Solo lo ENTRANTE: nuestras propias respuestas y las del agente
          // también mueven `ultimo_mensaje_en`, y avisar de lo que acabamos de
          // enviar sería absurdo.
          if (c.ultima_direccion !== 'IN') continue
          if (antes && antes === c.ultimo_mensaje_en) continue
          if (!antes && !c.sin_leer) continue
          nuevos.push(c)
        }
        primeraVuelta.current = false

        if (nuevos.length) {
          setAvisos(prev => {
            const otros = prev.filter(p => !nuevos.some(n => n.contacto === p.contacto))
            const frescos = nuevos.map(c => ({
              contacto: c.contacto,
              nombre: c.nombre || c.contacto,
              texto: c.ultimo_texto || '',
              en: Date.now(),
            }))
            // Tres como mucho: un montón de tarjetas apiladas tapa la pantalla
            // justo cuando hace falta trabajar.
            return [...frescos, ...otros].slice(0, 3)
          })
          if (sonidoRef.current) pitar()
        }
      } catch { /* si la red falla, la siguiente vuelta lo arregla */ }
    }

    mirar()
    const id = setInterval(mirar, POLL_MS)
    return () => { vivo = false; clearInterval(id) }
  }, [vigila])

  // El título de la pestaña. Es el aviso que funciona con Orbit en otra
  // pestaña, que es donde suele estar mientras se trabaja en otra cosa.
  useEffect(() => {
    document.title = sinLeer > 0 ? `(${sinLeer}) ${TITULO_BASE}` : TITULO_BASE
  }, [sinLeer])

  // Los avisos se van solos: son un aviso, no una bandeja.
  useEffect(() => {
    if (!avisos.length) return
    const id = setTimeout(() => setAvisos(a => a.slice(0, -1)), 9000)
    return () => clearTimeout(id)
  }, [avisos])

  return (
    <ChatWaContext.Provider value={{
      vigila, conversaciones, sinLeer, avisos, abierto, contactoActivo,
      conSonido, alternarSonido, abrirChat, cerrarChat, descartarAviso,
      marcarVistaLocal,
    }}>
      {children}
    </ChatWaContext.Provider>
  )
}

export const useChatWa = () => useContext(ChatWaContext)
