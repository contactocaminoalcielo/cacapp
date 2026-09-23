// "Esperan respuesta de coordinación" — la alerta cuando el agente escala.
//
// Nació de un caso real (23-sep): una clínica pidió pasar su recogida de las
// 4:20 a las 5:00, el agente le dijo "coordinación te confirma"… y solo quedó
// una etiqueta en la bandeja que nadie estaba mirando.
//
// Dos niveles, y el segundo llega solo:
//   · Franja arriba, estilo isla de iPhone, en CUALQUIER pantalla.
//   · Pantalla gris completa si la etiqueta es urgente (INMEDIATA) o si pasan
//     MIN_PARA_BLOQUEAR minutos sin que nadie responda.
//
// 🔑 La alerta se apaga RESPONDIENDO, no cerrándola. Una ✕ se cerraría "para
// después" y volvería a pasar lo mismo. "Revisar conversación" solo la aparta
// unos minutos mientras se escribe; si no se contesta, vuelve. La única salida
// sin responder es "Ya lo resolví por teléfono", y deja quién y cuándo.
//
// Vive al lado de ChatFlotante (fuera del AppShell) por la misma razón que él:
// tiene que verse en Kanban, en Finanzas o en Tenjo.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MessageCircle, ChevronDown, Phone } from 'lucide-react'
import { useChatWa, pitar } from '@/contexts/ChatWaContext'
import {
  listarEsperas, cerrarEspera, identidadLinea, formatearNumero,
} from '@/lib/whatsappInbox'
import { lecturaSerial } from '@/lib/lecturas'

const POLL_MS = 15000
const MIN_PARA_BLOQUEAR = 10
// Lo que "Revisar conversación" aparta la pantalla gris: lo justo para leer y
// contestar. Si al volver sigue sin respuesta, es que no se contestó.
const MIN_APARTADA = 3

const muelle = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }

function tiempoEsperando(min) {
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `hace ${h} h ${m} min` : `hace ${h} h`
}

function nombreDe(e) {
  return e.nombre || formatearNumero(e.contacto)
}

export default function EsperasCoordinacion() {
  const chat = useChatWa()
  const vigila = chat?.vigila
  const quieto = useReducedMotion()

  const [esperas, setEsperas] = useState([])
  // Diferencia entre el reloj del servidor y el de este computador: los
  // minutos se cuentan contra el servidor, que es quien selló `abierta_en`.
  const [desfase, setDesfase] = useState(0)
  const [ahora, setAhora] = useState(() => Date.now())
  const [apartadas, setApartadas] = useState({})   // id → hasta cuándo (ms)
  const [abierta, setAbierta] = useState(false)    // la isla desplegada
  const [cerrando, setCerrando] = useState(null)
  const vistas = useRef(new Set())
  const primeraVuelta = useRef(true)
  const sonidoRef = useRef(chat?.conSonido)
  sonidoRef.current = chat?.conSonido

  useEffect(() => {
    if (!vigila) return
    let vivo = true
    const mirar = lecturaSerial(async () => {
      try {
        const r = await listarEsperas()
        if (!vivo) return
        const lista = r.esperas || []
        if (r.ahora) setDesfase(new Date(r.ahora).getTime() - Date.now())
        setEsperas(lista)
        // Suena cuando aparece una espera NUEVA. En la primera vuelta no: al
        // abrir Orbit la alerta ya se ve, no hace falta además un pitido.
        const nuevas = lista.filter(e => !vistas.current.has(e.id))
        lista.forEach(e => vistas.current.add(e.id))
        if (!primeraVuelta.current && nuevas.length && sonidoRef.current) pitar()
        primeraVuelta.current = false
      } catch {
        // Sin migración o sin red: no hay alerta, y la etiqueta en la bandeja
        // sigue siendo la señal de respaldo. No se ensucia la pantalla.
      }
    })
    mirar()
    const id = setInterval(mirar, POLL_MS)
    return () => { vivo = false; clearInterval(id) }
  }, [vigila])

  // El reloj de los minutos. Cada 15 s basta: se muestra en minutos.
  useEffect(() => {
    if (!esperas.length) return
    const id = setInterval(() => setAhora(Date.now()), 15000)
    return () => clearInterval(id)
  }, [esperas.length])

  const conMinutos = useMemo(() => esperas.map(e => ({
    ...e,
    min: Math.max(0, Math.floor((ahora + desfase - new Date(e.abierta_en).getTime()) / 60000)),
  })), [esperas, ahora, desfase])

  // Qué tapa la pantalla. No la tapa la conversación que ya está abierta en el
  // chat flotante: esa persona está contestando justo ahora.
  const bloqueantes = useMemo(() => conMinutos.filter(e =>
    (e.nivel === 'INMEDIATA' || e.min >= MIN_PARA_BLOQUEAR)
    && !((apartadas[e.id] || 0) > ahora)
    && !(chat?.abierto && chat?.contactoActivo === e.contacto)
  ), [conMinutos, apartadas, ahora, chat?.abierto, chat?.contactoActivo])

  const revisar = useCallback((e) => {
    setApartadas(a => ({ ...a, [e.id]: Date.now() + MIN_APARTADA * 60000 }))
    setAbierta(false)
    chat?.abrirChat(e.contacto, e.phone_number_id)
  }, [chat])

  const resolver = useCallback(async (e) => {
    setCerrando(e.id)
    try {
      await cerrarEspera(e.id)
      setEsperas(l => l.filter(x => x.id !== e.id))
    } catch {
      // Si no se pudo cerrar, la alerta sigue: es lo seguro.
    } finally {
      setCerrando(null)
    }
  }, [])

  if (!vigila || !conMinutos.length) return null

  const primera = conMinutos[0]
  const varias = conMinutos.length > 1
  const hayUrgente = conMinutos.some(e => e.nivel === 'INMEDIATA' || e.min >= MIN_PARA_BLOQUEAR)
  const alerta = bloqueantes[0]

  return (
    <>
      {/* ── La isla ─────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-x-0 top-0 z-[65] flex justify-center px-3 pointer-events-none print:hidden"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <motion.div
          layout={!quieto}
          initial={quieto ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={muelle}
          style={{ borderRadius: abierta ? 26 : 999 }}
          className="pointer-events-auto w-full max-w-[420px] overflow-hidden bg-[#0A0A0C]/[0.92] text-white shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-2xl backdrop-saturate-150"
        >
          <motion.button
            layout="position"
            type="button"
            onClick={() => (varias ? setAbierta(a => !a) : revisar(primera))}
            className="flex w-full items-center gap-3 py-2 pl-2 pr-2 text-left"
            aria-expanded={varias ? abierta : undefined}
          >
            <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10">
              <MessageCircle size={17} strokeWidth={2.2} className="text-white" />
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${hayUrgente ? 'bg-[#FF453A]' : 'bg-[#FF9F0A]'}`} />
                <span className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-[#0A0A0C] ${hayUrgente ? 'bg-[#FF453A]' : 'bg-[#FF9F0A]'}`} />
              </span>
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]">
                {varias ? `${conMinutos.length} esperan respuesta` : nombreDe(primera)}
              </span>
              <span className="block truncate text-[11.5px] leading-tight text-white/55">
                {varias
                  ? `La más antigua ${tiempoEsperando(primera.min)}`
                  : `Espera respuesta · ${tiempoEsperando(primera.min)}`}
              </span>
            </span>

            {varias ? (
              <motion.span
                animate={{ rotate: abierta ? 180 : 0 }}
                transition={muelle}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10"
              >
                <ChevronDown size={16} />
              </motion.span>
            ) : (
              <span className="flex-shrink-0 rounded-full bg-[#0A84FF] px-3.5 py-1.5 text-[12px] font-semibold">
                Revisar
              </span>
            )}
          </motion.button>

          <AnimatePresence initial={false}>
            {abierta && varias && (
              <motion.ul
                key="lista"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={muelle}
                className="max-h-[60vh] overflow-y-auto border-t border-white/10 px-2 pb-2"
              >
                {conMinutos.map(e => (
                  <li key={e.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-white/[0.06]">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${e.nivel === 'INMEDIATA' || e.min >= MIN_PARA_BLOQUEAR ? 'bg-[#FF453A]' : 'bg-[#FF9F0A]'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">{nombreDe(e)}</span>
                      <span className="block truncate text-[11.5px] leading-tight text-white/50">
                        {e.etiqueta_nombre || 'Espera respuesta'} · {tiempoEsperando(e.min)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => revisar(e)}
                      className="flex-shrink-0 rounded-full bg-[#0A84FF] px-3 py-1.5 text-[12px] font-semibold active:opacity-80"
                    >
                      Revisar
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── La pantalla gris ────────────────────────────────────────────────
          Mismas clases que la alerta de inicio de ruta del Kanban
          (.cac-overlay/.cac-modal): solo anima la ENTRADA, ver index.css. Sin
          Radix a propósito: ni Esc ni un clic fuera la cierran. */}
      {alerta && (
        <div
          className="cac-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[6px] print:hidden"
          data-state="open"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="espera-titulo"
        >
          <div
            key={alerta.id}
            data-state="open"
            className="cac-modal w-[300px] max-w-full overflow-hidden rounded-[22px] bg-white/[0.94] text-center shadow-2xl ring-1 ring-black/5 backdrop-blur-2xl backdrop-saturate-150"
          >
            <div className="px-5 pb-4 pt-5">
              <div
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                style={{ background: `${alerta.etiqueta_color || '#FF453A'}1A` }}
              >
                <MessageCircle size={22} strokeWidth={2.2} style={{ color: alerta.etiqueta_color || '#FF453A' }} />
              </div>
              <p id="espera-titulo" className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-gray-900">
                {nombreDe(alerta)} espera respuesta
              </p>
              <p className="mt-1 text-[12.5px] text-gray-500">
                {alerta.etiqueta_nombre || 'El agente la pasó a coordinación'} · {tiempoEsperando(alerta.min)}
              </p>

              {(alerta.motivo || alerta.ultimo_entrante) && (
                <div className="mt-3 rounded-2xl bg-black/[0.04] px-3 py-2.5 text-left">
                  {alerta.motivo && (
                    <p className="text-[12.5px] font-medium leading-snug text-gray-800">{alerta.motivo}</p>
                  )}
                  {alerta.ultimo_entrante && (
                    <p className={`line-clamp-3 text-[12px] italic leading-snug text-gray-500 ${alerta.motivo ? 'mt-1.5' : ''}`}>
                      «{alerta.ultimo_entrante}»
                    </p>
                  )}
                </div>
              )}

              <p className="mt-3 text-[11px] text-gray-400">
                Línea {identidadLinea(alerta.phone_number_id).nombre}
                {bloqueantes.length > 1 && ` · y ${bloqueantes.length - 1} más esperando`}
              </p>
            </div>

            <div className="divide-y divide-black/10 border-t border-black/10">
              <button
                type="button"
                autoFocus
                onClick={() => revisar(alerta)}
                className="flex w-full items-center justify-center gap-2 py-3 text-[16px] font-semibold text-[#007AFF] active:bg-black/5"
              >
                Revisar conversación
              </button>
              <button
                type="button"
                disabled={cerrando === alerta.id}
                onClick={() => resolver(alerta)}
                className="flex w-full items-center justify-center gap-1.5 py-3 text-[14px] text-[#007AFF] active:bg-black/5 disabled:opacity-50"
              >
                <Phone size={13} />
                {cerrando === alerta.id ? 'Guardando…' : 'Ya lo resolví por teléfono'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
