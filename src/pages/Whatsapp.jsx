// Bandejas de WhatsApp separadas por línea (Cloud API directo).
//
// Esta pantalla solo ve los números habilitados en nuestra app de Meta
// (WHATSAPP_ALLOWED_PHONE_IDS), incluidos los historiales que ya migramos.
//
// Los datos NO vienen de Supabase: las tablas `whatsapp_*` no están expuestas
// por PostgREST. Todo entra por orbit-backend con JWT + rol. Ver lib/whatsappInbox.js.
//
// ⚠️ Refrescos: el polling NUNCA toca `cargando`. Poner el spinner en cada
// refresco desmonta el hilo y el coordinador pierde lo que estaba escribiendo
// (es el mismo bug que ya mordió en la app del técnico).
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConfirm } from '@/contexts/ConfirmContext'
import ValorarRespuesta from '@/components/ValorarRespuesta'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  listarConversaciones, abrirHilo, marcarLeido, enviarMensaje, cambiarAgente, bloquearConversacion,
  listarEtiquetas, ponerEtiqueta, quitarEtiqueta, GRUPOS,
  formatearNumero, haceCuanto, horaMensaje, etiquetaDia, restanteVentana, ESTADO_ENVIO,
  sePuedeGrabar, formatoGrabacion, duracionAudio,
  bajarAdjunto, esImagen, enviarArchivo, prepararArchivo, claseArchivo, TOPES_ARCHIVO,
  identidadLinea, claveConversacion,
} from '@/lib/whatsappInbox'
import { listarAgentes } from '@/lib/agenteApi'
import {
  Search, Send, ArrowLeft, MessageCircle, Building2, User, AlertTriangle,
  Loader2, RefreshCw, Inbox, Tag, X, Plus, Download, Paperclip, Mic, Video, FileText,
  Bot, BotOff, Ban, Square, Trash2, ChevronDown, Check,
} from 'lucide-react'

/** Cada cuánto se relee la bandeja. La tabla no está en Realtime (es del backend). */
const POLL_MS = 10000

export default function Whatsapp() {
  // `todas` es lo que devuelve el backend; `convs` es lo que se pinta, ya
  // filtrado por la línea elegida. Ver más abajo.
  const [todas, setConvs]         = useState([])
  const [cargando, setCargando]   = useState(true)
  const [q, setQ]                 = useState('')
  const [activo, setActivo]       = useState(null)
  const [hilo, setHilo]           = useState(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const [texto, setTexto]         = useState('')
  const [enviando, setEnviando]   = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [errorCarga, setErrorCarga] = useState(null)
  const [catalogo, setCatalogo]   = useState([])
  // Qué lista se está mirando dentro de la línea: null = todos · 'NO_LEIDAS' · un grupo · una etiqueta.
  const [vista, setVista]         = useState(null)

  // ── Líneas ──
  // Una conversación es (línea, número): la misma clínica puede hablar por dos
  // líneas y son DOS conversaciones. `lineaActiva` es la de la que está abierta,
  // y viaja en cada llamada para que la respuesta salga por donde llegó.
  const [filtroLinea, setFiltroLinea] = useState(
    () => localStorage.getItem('orbit.wa.bandeja') || null
  )
  const [lineaActiva, setLineaActiva] = useState(null)
  const [nombreLinea, setNombreLinea] = useState({})

  const finRef      = useRef(null)
  const scrollRef   = useRef(null)
  const pegadoAbajo = useRef(true)
  const activoRef   = useRef(null)
  activoRef.current = activo
  const lineaRef    = useRef(null)
  lineaRef.current  = lineaActiva

  // El nombre de cada línea sale del agente que la atiende: un
  // `phone_number_id` en crudo no le dice nada a nadie. Si falla, el selector
  // cae a los últimos cuatro dígitos y la bandeja sigue funcionando igual.
  useEffect(() => {
    listarAgentes()
      .then(r => {
        const m = {}
        for (const a of r?.agentes || []) {
          for (const id of a.phone_number_ids || []) m[id] = a.nombre
        }
        setNombreLinea(m)
      })
      .catch(() => {})
  }, [])

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
      const r = await abrirHilo(contacto, lineaRef.current)
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

  // El catálogo se lee una vez: son nueve filas que casi nunca cambian.
  useEffect(() => {
    listarEtiquetas().then(r => setCatalogo(r.etiquetas || [])).catch(() => {})
  }, [])

  // ── Etiquetar a mano ───────────────────────────────────────────────────────
  // Optimista: la lista se repinta al instante y el polling la confirma. Si el
  // backend falla, el siguiente refresco devuelve la verdad.
  async function alternarEtiqueta(contacto, clave, puesta) {
    setConvs(cs => cs.map(c =>
      c.contacto !== contacto || c.phone_number_id !== lineaRef.current ? c : {
      ...c,
      etiquetas: puesta
        ? (c.etiquetas || []).filter(e => e.clave !== clave)
        : [...(c.etiquetas || []), { ...catalogo.find(e => e.clave === clave), origen: 'MANUAL' }],
      }
    ))
    try {
      if (puesta) await quitarEtiqueta(contacto, clave, lineaRef.current)
      else await ponerEtiqueta(contacto, clave, lineaRef.current)
    } catch { /* el refresco lo corrige */ }
    cargarLista({ silencioso: true })
  }

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
  async function abrir(contacto, linea = null) {
    // La línea se fija ANTES de pedir nada: `lineaRef` la lee el hilo, el acuse
    // de leído y el envío. Sin ella, con el mismo número en dos líneas el
    // backend no sabría cuál abrir.
    setLineaActiva(linea)
    lineaRef.current = linea
    setActivo(contacto)
    setHilo(null)
    setTexto('')
    setErrorEnvio(null)
    pegadoAbajo.current = true
    await cargarHilo(contacto)
    try {
      await marcarLeido(contacto, lineaRef.current)
      setConvs(cs => cs.map(c =>
        c.contacto === contacto && (!linea || c.phone_number_id === linea)
          ? { ...c, sin_leer: 0 } : c))
    } catch { /* el badge se corrige solo en el siguiente refresco */ }
  }

  // ── Enviar ─────────────────────────────────────────────────────────────────
  async function enviar() {
    const cuerpo = texto.trim()
    if (!cuerpo || enviando || !activo) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      await enviarMensaje(activo, cuerpo, lineaActiva)
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

  // Todo lo que se pinta parte de aquí: si hay una línea elegida, las demás no
  // existen para esta pantalla — ni en la lista, ni en los contadores.
  const convs = useMemo(
    () => (filtroLinea ? todas.filter(c => c.phone_number_id === filtroLinea) : []),
    [todas, filtroLinea]
  )

  // Las líneas que aparecen en la bandeja, en orden estable.
  const lineas = useMemo(() => {
    const vistas = []
    for (const c of todas) {
      if (c.phone_number_id && !vistas.includes(c.phone_number_id)) vistas.push(c.phone_number_id)
    }
    const prioridad = ['1313164878540238', '1317926468072324']
    return vistas.sort((a, b) => {
      const ia = prioridad.indexOf(a); const ib = prioridad.indexOf(b)
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
      return a.localeCompare(b)
    })
  }, [todas])

  // Nunca existe una bandeja combinada. Al llegar la lista se restaura la
  // última línea elegida si todavía existe; de lo contrario se abre la primera.
  useEffect(() => {
    if (!lineas.length) return
    if (!filtroLinea || !lineas.includes(filtroLinea)) {
      setFiltroLinea(lineas[0])
      localStorage.setItem('orbit.wa.bandeja', lineas[0])
    }
  }, [lineas, filtroLinea])

  function elegirLinea(id) {
    if (id === filtroLinea) return
    setFiltroLinea(id)
    localStorage.setItem('orbit.wa.bandeja', id)
    setActivo(null)
    setLineaActiva(null)
    lineaRef.current = null
    setHilo(null)
    setVista(null)
    setErrorEnvio(null)
  }

  // Sin leer por LÍNEA, sobre `todas`. Se cuentan CONVERSACIONES, no mensajes:
  // es lo mismo que cuenta la pastilla "Sin leer", y tener las dos cifras a 40 px
  // una de otra, distintas, se leía como un error. Lo que sí faltaba es saber qué
  // espera en las OTRAS líneas sin tener que entrar a mirarlas una por una.
  const sinLeerPorLinea = useMemo(() => {
    const n = {}
    for (const c of todas) {
      if ((c.sin_leer || 0) > 0 && c.phone_number_id) {
        n[c.phone_number_id] = (n[c.phone_number_id] || 0) + 1
      }
    }
    return n
  }, [todas])

  // Las listas se cuentan sobre TODAS las conversaciones, no sobre la lista ya
  // filtrada: si no, al entrar en "Novedades" las demás pestañas marcarían 0.
  const conteos = useMemo(() => {
    const n = { NO_LEIDAS: convs.filter(c => (c.sin_leer || 0) > 0).length }
    for (const c of convs) {
      for (const e of c.etiquetas || []) {
        n[e.grupo] = (n[e.grupo] || 0) + 1
        n[e.clave] = (n[e.clave] || 0) + 1
      }
    }
    return n
  }, [convs])

  const visibles = useMemo(() => {
    if (!vista) return convs
    if (vista === 'NO_LEIDAS') return convs.filter(c => (c.sin_leer || 0) > 0)
    return convs.filter(c => (c.etiquetas || []).some(e => e.grupo === vista || e.clave === vista))
  }, [convs, vista])

  const conv = hilo?.contacto
    || convs.find(c => c.contacto === activo
         && (!lineaActiva || c.phone_number_id === lineaActiva))
    || null
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
            {/* 🩸 LA CABECERA SE COMÍA LA BANDEJA. Antes: título propio, buscador,
                las líneas como botones apilados a lo ancho y los filtros en dos
                filas = ~320 px de cromo sobre 620 de panel, con 2,5 conversaciones
                a la vista sobre 145. El título sobraba (el Topbar ya dice "Bandeja
                de WhatsApp") y las líneas no necesitan una tarjeta cada una. */}
            <div className="p-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center gap-2">
                {/* Cada línea es una bandeja independiente. No existe “Todas”:
                    mezclar empresas o líneas vuelve ambiguos el hilo y la salida. */}
                <SelectorLinea lineas={lineas} activa={filtroLinea} onElegir={elegirLinea}
                               nombreLinea={nombreLinea} sinLeerPorLinea={sinLeerPorLinea} />
                <button onClick={() => cargarLista({ silencioso: true })}
                        aria-label="Actualizar la lista de conversaciones"
                        className="p-2 rounded-lg text-gray-400 hover:text-[#1A5CD8] hover:bg-gray-100 cursor-pointer
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/40 flex-shrink-0"
                        title="Actualizar">
                  <RefreshCw size={14} />
                </button>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-8" placeholder="Buscar por nombre o número..."
                       value={q} onChange={e => setQ(e.target.value)} />
              </div>

              <Listas vista={vista} setVista={setVista} conteos={conteos}
                      catalogo={catalogo} total={convs.length} />
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
              ) : visibles.length === 0 ? (
                <VacioLista hayFiltro={!!q.trim()} hayVista={!!vista} />
              ) : (
                visibles.map(c => (
                  <ItemConversacion key={claveConversacion(c.contacto, c.phone_number_id)} c={c}
                                    activo={c.contacto === activo && c.phone_number_id === lineaActiva}
                                    onClick={() => abrir(c.contacto, c.phone_number_id)} />
                ))
              )}
            </div>
          </aside>

          {/* ── Hilo ── */}
          <section className={`${activo ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
            {!activo ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <MessageCircle size={40} strokeWidth={1.3} className="text-gray-300" />
                {/* Estaba todo en gray-300: 1.9:1 sobre blanco, por debajo de
                    cualquier mínimo. El icono puede ser tenue; el texto no. */}
                <p className="text-[13px] font-semibold text-gray-600">Elige una conversación</p>
                <p className="text-[12px] text-gray-500 max-w-xs">
                  Las de la izquierda son solo de esta línea. Para ver otra, cámbiala arriba.
                </p>
              </div>
            ) : (
              <>
                <CabeceraHilo conv={conv} contacto={activo}
                              onVolver={() => { setActivo(null); setHilo(null) }}
                              etiquetas={convs.find(c => c.contacto === activo
                                && (!lineaActiva || c.phone_number_id === lineaActiva))?.etiquetas || []}
                              catalogo={catalogo}
                              onAlternar={(clave, puesta) => alternarEtiqueta(activo, clave, puesta)}
                              onAgente={async (encender) => {
                                await cambiarAgente(activo, encender, lineaActiva)
                                // Se recarga hilo y lista: el estado se pinta en
                                // los dos sitios y verlos discrepar da la
                                // sensación de que no se guardó.
                                setHilo(h => h ? { ...h, contacto: { ...h.contacto, agente_activo: encender } } : h)
                                cargarLista({ silencioso: true })
                              }}
                              onBloquear={async (bloquear) => {
                                await bloquearConversacion(activo, bloquear, null, lineaActiva)
                                // Bloquear implica pausar, así que se repintan
                                // los dos estados: verlos discrepar da la
                                // sensación de que no se guardó.
                                setHilo(h => h ? { ...h, contacto: {
                                  ...h.contacto, bloqueado: bloquear,
                                  agente_activo: bloquear ? false : h.contacto?.agente_activo,
                                } } : h)
                                cargarLista({ silencioso: true })
                              }} />

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
                  contacto={activo}
                  onEnviada={() => { cargarHilo(activo, { silencioso: true }); cargarLista({ silencioso: true }) }}
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

/**
 * Las listas de trabajo. Sin esto la bandeja es una pila plana: con el agente
 * respondiendo solo, coordinación necesita ver de un vistazo qué exige a una
 * persona (Novedades) y qué es consulta de algo en curso (Servicios).
 */
function Listas({ vista, setVista, conteos, catalogo, total }) {
  const [abierto, setAbierto] = useState(false)

  // Solo se ofrecen etiquetas que HOY tienen conversaciones: una lista de nueve
  // filtros en cero es ruido.
  const conUso = catalogo.filter(e => conteos[e.clave] > 0)

  return (
    <div className="space-y-1.5">
      {/* Una sola fila que se desplaza, no dos que se parten. Con seis filtros el
          `flex-wrap` se comía otros 28 px de alto y dejaba una pastilla huérfana
          en la segunda fila, que además se leía como si fuera de otro grupo.
          El degradado del borde derecho NO es adorno: sin él la última pastilla
          queda cortada a hueso contra el borde y se lee como algo roto, no como
          algo que sigue. Sobre blanco desaparece solo cuando no hay desborde. */}
      <div className="relative">
        <div className="flex gap-1 overflow-x-auto pb-0.5 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Pastilla activa={!vista} onClick={() => setVista(null)} n={total}>Todos</Pastilla>
        <Pastilla activa={vista === 'NO_LEIDAS'} onClick={() => setVista('NO_LEIDAS')}
                  n={conteos.NO_LEIDAS} color="#1A5CD8">Sin leer</Pastilla>
        {GRUPOS.map(g => (
          <Pastilla key={g.clave} activa={vista === g.clave} onClick={() => setVista(g.clave)}
                    n={conteos[g.clave]} color={g.clave === 'NOVEDAD' ? '#DC2626' : undefined}>
            {g.nombre}
          </Pastilla>
        ))}
        {conUso.length > 0 && (
          <button onClick={() => setAbierto(v => !v)} aria-expanded={abierto}
                  className="px-2.5 py-1 rounded-full border border-gray-200 text-[10.5px] font-semibold
                             text-gray-500 hover:bg-gray-50 cursor-pointer flex items-center gap-1
                             whitespace-nowrap flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/40">
            <Tag size={10} /> Etiquetas
          </button>
        )}
        </div>
        <div aria-hidden
             className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent" />
      </div>

      <AnimatePresence>
        {abierto && conUso.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-1 pt-0.5">
              {conUso.map(e => (
                <Pastilla key={e.clave} activa={vista === e.clave} color={e.color}
                          onClick={() => setVista(vista === e.clave ? null : e.clave)}
                          n={conteos[e.clave]}>
                  {e.nombre}
                </Pastilla>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Cómo se llama una línea en el selector.
 *
 * 🩸 UN AGENTE PUEDE ATENDER VARIAS LÍNEAS: hoy mismo, la real y la de pruebas
 * cuelgan del mismo agente. Poner solo su nombre daba DOS botones idénticos —
 * imposible saber cuál es cuál, que es justo lo contrario de lo que hace falta.
 * Cuando el nombre se repite, se desempata con los últimos cuatro dígitos.
 */
/**
 * Elegir la línea. Sin esto, dos líneas se leen como una sola conversación.
 *
 * Va en UNA fila con desplegable en vez de un botón apilado por línea. Con tres
 * líneas aquello ocupaba 156 px permanentes de una bandeja donde lo escaso es el
 * alto; con seis habría ocupado el panel entero. El nombre de la línea activa
 * sigue siempre visible —es el dato que no se puede perder de vista, porque
 * determina por dónde sale lo que escribas— y las demás están a un clic.
 */
function SelectorLinea({ lineas, activa, onElegir, nombreLinea, sinLeerPorLinea = {} }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)

  // Cerrar al tocar fuera o con Escape: un popover que solo cierra con su propio
  // botón se queda abierto tapando conversaciones.
  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    const esc = e => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  if (!lineas.length) return <div className="flex-1" />

  const yo = identidadLinea(activa, nombreLinea)
  const sola = lineas.length === 1
  const otras = lineas.reduce((a, id) => id === activa ? a : a + (sinLeerPorLinea[id] || 0), 0)

  return (
    <div ref={caja} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => !sola && setAbierto(v => !v)}
        aria-haspopup={sola ? undefined : 'listbox'}
        aria-expanded={sola ? undefined : abierto}
        disabled={sola}
        title={sola ? yo.nombre : 'Cambiar de línea'}
        className={`w-full min-h-11 pl-3 pr-2 py-1.5 rounded-xl border text-left transition-colors duration-200
                    flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/40
                    bg-[#0B1D4F] border-[#0B1D4F] text-white ${sola ? '' : 'cursor-pointer hover:bg-[#12275C]'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-bold leading-tight truncate">{yo.nombre}</span>
          <span className="block text-[10px] font-mono text-white/75 truncate">{yo.numero}</span>
        </span>
        {otras > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-[#F5C842] text-[#0B1D4F] text-[10px] font-bold flex-shrink-0"
                title={`${otras} conversación(es) sin leer en otras líneas`}>
            +{otras}
          </span>
        )}
        {!sola && <ChevronDown size={14} className={`flex-shrink-0 text-white/70 transition-transform ${abierto ? 'rotate-180' : ''}`} />}
      </button>

      {abierto && !sola && (
        <div role="listbox" aria-label="Bandejas por línea de WhatsApp"
             className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {lineas.map(id => {
            const l = identidadLinea(id, nombreLinea)
            const esta = id === activa
            return (
              <button key={id} type="button" role="option" aria-selected={esta}
                      onClick={() => { onElegir(id); setAbierto(false) }}
                      className={`w-full min-h-11 px-3 py-2 text-left cursor-pointer transition-colors
                                  flex items-center gap-2 focus-visible:outline-none focus-visible:bg-[#EEF3FF]
                                  ${esta ? 'bg-[#EEF3FF]' : 'hover:bg-gray-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[11.5px] font-bold leading-tight truncate ${esta ? 'text-[#0B1D4F]' : 'text-gray-700'}`}>
                    {l.nombre}
                  </span>
                  <span className="block text-[10px] font-mono text-gray-500 truncate">{l.numero}</span>
                </span>
                {(sinLeerPorLinea[id] || 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[#1A5CD8] text-white text-[10px] font-bold flex-shrink-0">
                    {sinLeerPorLinea[id]}
                  </span>
                )}
                {esta && <Check size={14} className="text-[#1A5CD8] flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Pastilla({ activa, onClick, n, color = '#0B1D4F', children }) {
  return (
    <button onClick={onClick} aria-pressed={activa}
            className="px-2.5 py-1 rounded-full text-[10.5px] font-semibold border transition-colors cursor-pointer
                       whitespace-nowrap flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/40"
            style={activa
              ? { background: color, borderColor: color, color: '#fff' }
              // #6B7280 sobre blanco da 4.8:1 — el gris más claro que pasa AA.
              : { background: '#fff', borderColor: '#E5E7EB', color: '#6B7280' }}>
      {children}{n ? ` ${n}` : ''}
    </button>
  )
}

/** Chip de etiqueta. En la cabecera del hilo se puede quitar; en la lista, no. */
function Chip({ e, onQuitar }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold"
          style={{ background: `${e.color}1A`, color: e.color }}
          title={e.motivo || (e.origen === 'AGENTE' ? 'Puesta por el agente' : undefined)}>
      {e.nombre}
      {onQuitar && (
        <button onClick={onQuitar} className="hover:opacity-60 cursor-pointer" title="Quitar etiqueta">
          <X size={9} />
        </button>
      )}
    </span>
  )
}

function VacioLista({ hayFiltro, hayVista }) {
  return (
    <div className="p-6 text-center">
      <Inbox size={26} className="mx-auto mb-3 text-gray-300" strokeWidth={1.4} />
      {hayVista ? (
        <p className="text-[12px] text-gray-500">Nada pendiente en esta lista.</p>
      ) : hayFiltro ? (
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
            <span className={`text-[13px] truncate flex items-center gap-1 ${noLeidos ? 'font-bold text-[#0B1D4F]' : 'font-semibold text-gray-700'}`}>
              {/* Un apagado que solo se ve al abrir la conversación es un
                  apagado que se olvida, y esa clínica se queda sin agente. */}
              {c.agente_activo === false && (
                <BotOff size={12} className="text-amber-600 flex-shrink-0"
                        title="El agente está apagado en esta conversación" />
              )}
              <span className="truncate">{c.nombre || formatearNumero(c.contacto)}</span>
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

          {(c.etiquetas || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {c.etiquetas.map(e => <Chip key={e.clave} e={e} />)}
            </div>
          )}

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

function CabeceraHilo({ conv, contacto, onVolver, etiquetas = [], catalogo = [], onAlternar, onAgente, onBloquear }) {
  const { confirm } = useConfirm()
  const esAliado = conv?.tipo_contacto === 'ALIADO'
  const [eligiendo, setEligiendo] = useState(false)
  const [cambiando, setCambiando] = useState(false)
  const puestas = new Set(etiquetas.map(e => e.clave))
  // Sin dato todavía = encendido: es el valor por defecto en la base, y pintar
  // "apagado" mientras carga asustaría sin motivo.
  const agenteOn = conv?.agente_activo !== false

  async function alternarAgente() {
    setCambiando(true)
    try { await onAgente(!agenteOn) } finally { setCambiando(false) }
  }

  const bloqueado = conv?.bloqueado === true
  const [bloqueando, setBloqueando] = useState(false)

  async function alternarBloqueo() {
    // Bloquear se confirma; desbloquear no. Es la asimetría de siempre: lo que
    // apaga algo a lo bruto se pregunta, lo que lo devuelve a la normalidad no.
    if (!bloqueado && !await confirm(
      'El agente no volverá a responder en esta conversación ni acusará recibo. '
      + 'Los mensajes seguirán entrando y tú sí puedes escribir. Se usa cuando al otro lado '
      + 'hay otro bot o un número que nunca debe recibir respuestas automáticas.',
      { title: '¿Bloquear esta conversación?', variant: 'danger', confirmLabel: 'Bloquear' }
    )) return
    setBloqueando(true)
    try { await onBloquear(!bloqueado) } finally { setBloqueando(false) }
  }

  return (
    <div className="px-3 py-2.5 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-3">
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

        {/* La ventana de 24 h vivía también aquí, como un «23 h 54 m» suelto sin
            decir de qué. El mismo dato ya está al pie del cuadro de escribir,
            donde sí se explica («quedan 23 h 54 m para responder con texto
            libre») y donde de verdad hace falta: al ir a escribir. Dos veces el
            mismo número, con dos formas distintas, se lee como dos cosas. */}

        {/* El interruptor del agente. Va en la cabecera y no en un menú: si
            está apagado, hay que verlo sin buscarlo — una conversación que
            nadie sabe que quedó a cargo de una persona es una sin atender. */}
        <button onClick={alternarAgente} disabled={cambiando}
                title={agenteOn
                  ? 'El agente responde en esta conversación. Tócalo para apagarlo y atenderla tú.'
                  : `Apagado${conv?.agente_cambiado_por ? ` por ${conv.agente_cambiado_por}` : ''}. Tócalo para que el agente vuelva a responder.`}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold
                            border transition flex-shrink-0 cursor-pointer disabled:opacity-50
                            ${agenteOn
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}>
          {cambiando ? <Loader2 size={11} className="animate-spin" />
            : agenteOn ? <Bot size={11} /> : <BotOff size={11} />}
          <span className="hidden sm:inline">{agenteOn ? 'Agente activo' : 'Agente apagado'}</span>
        </button>

        {/* Bloquear es más fuerte que pausar y por eso va aparte, en rojo: el
            agente no vuelve por su cuenta y ni siquiera acusa recibo. Es para
            cuando al otro lado hay otro bot y se ponen a hablar entre ellos. */}
        <button onClick={alternarBloqueo} disabled={bloqueando}
                title={bloqueado
                  ? `Bloqueada${conv?.bloqueado_motivo ? `: ${conv.bloqueado_motivo}` : ''}. Tócalo para desbloquear.`
                  : 'Bloquear: el agente no responderá nunca aquí, ni acusará recibo. Tú sí puedes escribir.'}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold
                            border transition flex-shrink-0 cursor-pointer disabled:opacity-50
                            ${bloqueado
                              ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-gray-200 bg-white text-gray-400 hover:text-red-600 hover:border-red-300'}`}>
          {bloqueando ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
          <span className="hidden sm:inline">{bloqueado ? 'Bloqueada' : 'Bloquear'}</span>
        </button>
      </div>

      {/* Quitar la etiqueta es cómo se cierra una novedad: la conversación sale
          de la lista de pendientes. Por eso vive aquí y no escondida en un menú. */}
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {etiquetas.map(e => (
          <Chip key={e.clave} e={e} onQuitar={() => onAlternar(e.clave, true)} />
        ))}
        <button onClick={() => setEligiendo(v => !v)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-dashed
                           border-gray-300 text-[9.5px] font-semibold text-gray-400
                           hover:text-[#1A5CD8] hover:border-[#1A5CD8] cursor-pointer">
          <Plus size={9} /> Etiqueta
        </button>
      </div>

      <AnimatePresence>
        {eligiendo && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-1 pt-1.5">
              {catalogo.filter(e => !puestas.has(e.clave)).map(e => (
                <button key={e.clave}
                        onClick={() => { onAlternar(e.clave, false); setEligiendo(false) }}
                        className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold cursor-pointer hover:opacity-75"
                        style={{ background: `${e.color}14`, color: e.color }}>
                  {e.nombre}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

/**
 * El archivo que mandaron: la foto se ve, el audio SE OYE, lo demás se descarga.
 *
 * El audio se reproduce aquí mismo y no se descarga por una razón práctica: una
 * nota de voz es lo que más rápido se despacha —se oye y se sigue— y bajar un
 * fichero para oír diez segundos rompe ese ritmo. Vale para las que llegan y
 * para las que uno manda, que es como se comprueba que salió bien.
 *
 * Se baja con fetch y no con `<img src>` / `<audio src>` porque el endpoint
 * exige sesión y rol (son conversaciones con clínicas y familias, no van por una
 * URL pública). El object URL se libera al desmontar: sin eso, abrir varios
 * hilos con archivos deja la memoria del navegador llena.
 */
function Adjunto({ m, mio }) {
  const [url, setUrl] = useState(null)
  const [fallo, setFallo] = useState(m.archivo_error || null)
  const imagen = esImagen(m.archivo_mime)
  const audio = claseArchivo(m.archivo_mime) === 'audio'
  const enLinea = imagen || audio

  useEffect(() => {
    if (!m.tiene_archivo || !enLinea) return
    let vivo = true
    let creada = null
    bajarAdjunto(m.id)
      .then(blob => {
        if (!vivo) return
        creada = URL.createObjectURL(blob)
        setUrl(creada)
      })
      .catch(e => { if (vivo) setFallo(e.message) })
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada) }
  }, [m.id, m.tiene_archivo, enLinea])

  async function descargar() {
    try {
      const blob = await bajarAdjunto(m.id)
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = `whatsapp-${m.id}`
      a.click()
      URL.revokeObjectURL(u)
    } catch (e) { setFallo(e.message) }
  }

  if (fallo) {
    return (
      <p className={`text-[10.5px] mb-1 italic ${mio ? 'text-white/70' : 'text-amber-700'}`}>
        No se pudo traer el archivo: {fallo}
      </p>
    )
  }

  if (imagen) {
    return url
      ? <img src={url} alt={m.texto || 'Imagen recibida'} loading="lazy"
             onClick={() => window.open(url, '_blank')}
             className="rounded-xl mb-1.5 max-h-72 w-auto cursor-zoom-in object-contain" />
      : <div className="rounded-xl mb-1.5 h-32 w-44 bg-black/5 animate-pulse" />
  }

  if (audio) {
    // El reproductor del navegador ya trae descargar en su menú, así que no
    // hace falta un botón aparte para lo mismo.
    return url
      ? <audio src={url} controls preload="metadata" className="mb-1.5 h-9 w-56 max-w-full" />
      : <div className="rounded-full mb-1.5 h-9 w-56 max-w-full bg-black/5 animate-pulse" />
  }

  return (
    <button onClick={descargar}
            className={`flex items-center gap-1.5 mb-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold
                        ${mio ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
      <Download className="w-3.5 h-3.5" />
      Descargar {m.tipo}
      {m.archivo_bytes ? ` · ${Math.max(1, Math.round(m.archivo_bytes / 1024))} KB` : ''}
    </button>
  )
}

/**
 * Lo que sale por una plantilla se guarda con su nombre de sistema al frente:
 * `[plantilla alerta_fin_de_contacto_individuales] Angel David · ...`. Eso es un
 * identificador de la base de datos, no un mensaje, y el coordinador no tiene por
 * qué leerlo. Se separa para pintarlo como etiqueta y dejar el texto limpio.
 */
function partirPlantilla(texto) {
  const m = /^\[plantilla ([a-z0-9_]+)\]\s*/i.exec(texto || '')
  if (!m) return { plantilla: null, cuerpo: texto }
  return { plantilla: m[1].replace(/_/g, ' '), cuerpo: (texto || '').slice(m[0].length) }
}

function Burbuja({ m }) {
  const mio = m.direccion === 'OUT'
  const est = mio ? ESTADO_ENVIO[m.estado] : null
  const fallo = m.estado === 'failed'
  const { plantilla, cuerpo } = partirPlantilla(m.texto)

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={`flex ${mio ? 'justify-end' : 'justify-start'} mb-1`}>
      {/* 🩸 EL AGENTE GRITABA Y EL CLIENTE SUSURRABA. Las dos burbujas tenían el
          mismo 75 %, pero el agente escribe párrafos y la clínica escribe "Busco":
          el azul saturado ocupaba tres cuartos del panel y lo que hay que leer
          rápido —lo que dijo la clínica— quedaba de adorno. Lo que entra ahora
          tiene más peso (borde y texto más firmes) y lo que sale, menos ancho. */}
      <div className={`px-3 py-2 rounded-2xl shadow-sm
                       ${mio
                         ? fallo ? 'max-w-[68%] bg-red-50 border border-red-200 rounded-br-sm'
                                 : 'max-w-[68%] bg-[#1A5CD8] text-white rounded-br-sm'
                         : 'max-w-[78%] bg-white border border-gray-200 rounded-bl-sm'}`}>
        {(m.tiene_archivo || m.archivo_error) && <Adjunto m={m} mio={mio} />}

        {plantilla && (
          <span className={`inline-flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide
                            ${mio && !fallo ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}
                title="Enviado con una plantilla aprobada por Meta">
            <FileText size={9} /> {plantilla}
          </span>
        )}

        <p className={`text-[13px] whitespace-pre-wrap break-words leading-snug
                       ${mio && !fallo ? 'text-white' : 'text-gray-900'}`}>
          {cuerpo || <span className="italic opacity-70">[sin texto]</span>}
        </p>

        <div className={`flex items-center gap-1.5 mt-1 justify-end`}>
          {/* Lo que salió del AGENTE se puede corregir aquí mismo: `enviado_por`
              en NULL es justo lo que lo distingue de lo que escribió una
              persona (migración 099). No se ofrece sobre un envío fallido:
              corregir algo que la veterinaria nunca recibió no significa nada. */}
          {mio && !m.enviado_por && !fallo && (
            <ValorarRespuesta mensajeId={m.id} claro />
          )}
          {/* Blanco al 60-70 % sobre #1A5CD8 no llega a 4.5:1, y justo ahí viven
              la hora y el nombre de quien respondió. Subido a 85-90 %. */}
          {mio && m.enviado_por_nombre && (
            <span className={`text-[9.5px] ${fallo ? 'text-gray-500' : 'text-white/85'}`}>
              {m.enviado_por_nombre}
            </span>
          )}
          <span className={`text-[10px] ${mio && !fallo ? 'text-white/90' : 'text-gray-500'}`}>
            {horaMensaje(m.ocurrido_en)}
          </span>
          {est && (
            <span className={`text-[10px] font-bold ${fallo ? est.clase : mio ? 'text-white' : est.clase}`}
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

function Redaccion({ texto, setTexto, enviando, onEnviar, ventanaAbierta, restante, error, contacto, onEnviada }) {
  const ref = useRef(null)
  const fileRef = useRef(null)
  const [foto, setFoto] = useState(null)          // el adjunto elegido, ya preparado
  const [subiendo, setSubiendo] = useState(false)
  const [errorFoto, setErrorFoto] = useState(null)

  // ── Nota de voz ────────────────────────────────────────────────────────────
  // Se graba y, al parar, entra por `tomarArchivo` como cualquier adjunto: la
  // previa, el tope de tamaño y el envío ya existen y no hay por qué tener dos
  // caminos que se puedan desincronizar.
  const [grabando, setGrabando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const grabadoraRef = useRef(null)
  const trozosRef = useRef([])
  const cronoRef = useRef(null)
  const puedeGrabar = sePuedeGrabar()

  // Soltar el micrófono SIEMPRE. Si no, Chrome deja el punto rojo de "grabando"
  // encendido en la pestaña y da la sensación de que Orbit sigue escuchando.
  const soltarMicro = () => {
    grabadoraRef.current?.stream?.getTracks().forEach(t => t.stop())
    grabadoraRef.current = null
    clearInterval(cronoRef.current)
  }

  useEffect(() => () => soltarMicro(), [])

  async function empezarGrabacion() {
    setErrorFoto(null)
    const formato = formatoGrabacion()
    if (!formato) {
      setErrorFoto('Este navegador no puede grabar en un formato que WhatsApp acepte. Adjunta el audio como archivo.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: formato })
      trozosRef.current = []
      rec.ondataavailable = e => { if (e.data.size) trozosRef.current.push(e.data) }
      rec.onstop = async () => {
        const dur = segundos
        soltarMicro()
        setGrabando(false)
        if (rec.cancelada) return
        const blob = new Blob(trozosRef.current, { type: formato })
        // El nombre y la extensión los arregla el servidor al reenvasar: aquí
        // sale lo que el navegador sepa grabar, y lo que llega a la clínica es
        // siempre un .ogg.
        const archivo = new File([blob], `nota-de-voz-${duracionAudio(dur).replace(':', 'm')}s`,
                                 { type: formato })
        archivo.esNotaDeVoz = true
        await tomarArchivo(archivo)
      }
      grabadoraRef.current = rec
      rec.start()
      setSegundos(0)
      setGrabando(true)
      cronoRef.current = setInterval(() => setSegundos(v => v + 1), 1000)
    } catch {
      // El navegador no dice por qué: casi siempre es que se denegó el permiso.
      setErrorFoto('No se pudo usar el micrófono. Revisa que le hayas dado permiso a Orbit en el navegador.')
      soltarMicro()
      setGrabando(false)
    }
  }

  function pararGrabacion({ descartar = false } = {}) {
    const rec = grabadoraRef.current
    if (!rec) return
    rec.cancelada = descartar
    // `stop()` dispara `onstop`, que es donde se arma el archivo y se suelta el
    // micrófono. Descartar es lo mismo, pero tirando lo grabado.
    if (rec.state !== 'inactive') rec.stop()
    else { soltarMicro(); setGrabando(false) }
  }

  async function tomarArchivo(file) {
    if (!file) return
    setErrorFoto(null)
    try {
      // Las fotos se reducen ANTES de tocar la red; lo demás viaja tal cual.
      const listo = await prepararArchivo(file)
      // Lo graba el micrófono, no lo elige el selector de archivos: de ahí sale
      // el `voice: true` que hace que llegue como nota de voz.
      if (file.esNotaDeVoz) { listo.notaDeVoz = true; listo.clase = 'audio' }
      const tope = TOPES_ARCHIVO[listo.clase]
      // Se avisa aquí y no después de subir 15 MB por una red móvil.
      if (listo.bytes > tope * 1048576) {
        setErrorFoto(`Pesa ${(listo.bytes / 1048576).toFixed(1)} MB y el tope para ${listo.clase} son ${tope} MB.`)
        return
      }
      setFoto(listo)
    } catch (e) { setErrorFoto(e.message) }
  }

  async function mandarFoto() {
    if (!foto || subiendo) return
    setSubiendo(true); setErrorFoto(null)
    try {
      await enviarArchivo({ contacto, linea: lineaRef.current, base64: foto.base64, mime: foto.mime, nombre: foto.nombre,
                            pie: texto.trim(), notaDeVoz: !!foto.notaDeVoz })
      setFoto(null)
      setTexto('')
      onEnviada?.()
    } catch (e) { setErrorFoto(e.message) } finally { setSubiendo(false) }
  }

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
      // Con una foto elegida, el texto es su PIE: enviar manda la foto, no un
      // mensaje suelto que dejaría la imagen sin mandar y al coordinador
      // creyendo que ya salió.
      foto ? mandarFoto() : onEnviar()
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

      {foto && (
        <div className="px-3 pt-3 flex items-start gap-2">
          {foto.previsualizacion ? (
            <img src={foto.previsualizacion} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
          ) : (
            <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 grid place-items-center text-gray-400">
              {foto.clase === 'audio' ? <Mic size={20} /> : foto.clase === 'video' ? <Video size={20} /> : <FileText size={20} />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-gray-700 truncate">{foto.nombre}</p>
            <p className="text-[11px] text-gray-500">
              {(foto.bytes / 1024).toFixed(0)} kB ·{' '}
              {/* WhatsApp NO admite pie en los audios: prometerlo sería mentir. */}
              {foto.clase === 'audio'
                ? 'los audios no llevan texto'
                : 'lo que escribas abajo va como pie'}
            </p>
            <button type="button" onClick={() => setFoto(null)}
              className="text-[11px] text-gray-400 hover:text-red-500 mt-0.5">Quitar</button>
          </div>
        </div>
      )}
      {errorFoto && (
        <p className="px-4 pt-2 text-[11.5px] text-red-600 flex items-start gap-1.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {errorFoto}
        </p>
      )}

      {grabando && (
        <div className="p-3 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-[13px] font-semibold text-gray-700 tabular-nums">
            {duracionAudio(segundos)}
          </span>
          <span className="text-[11.5px] text-gray-400 flex-1 truncate">
            Grabando… la clínica lo recibirá como nota de voz
          </span>
          <button type="button" onClick={() => pararGrabacion({ descartar: true })}
            title="Descartar la grabación"
            className="h-10 w-10 grid place-items-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 size={16} />
          </button>
          <Button onClick={() => pararGrabacion()} className="h-10 px-4">
            <Square size={14} className="mr-1.5" /> Listo
          </Button>
        </div>
      )}

      <div className={`p-3 flex items-end gap-2 ${grabando ? 'hidden' : ''}`}>
        <input ref={fileRef} type="file" className="hidden"
          onChange={e => { tomarArchivo(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={enviando || subiendo}
          title="Adjuntar imagen, audio, video o documento"
          className="h-10 w-10 grid place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
          <Paperclip size={16} />
        </button>
        {/* Grabar va aparte de adjuntar: es el gesto más frecuente de WhatsApp
            y esconderlo dentro del selector de archivos sería no tenerlo. */}
        {puedeGrabar && !foto && (
          <button type="button" onClick={empezarGrabacion} disabled={enviando || subiendo}
            title="Grabar una nota de voz"
            className="h-10 w-10 grid place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
            <Mic size={16} />
          </button>
        )}
        <textarea
          ref={ref} rows={1} value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={enviando}
          placeholder={foto ? (foto.clase === 'audio' ? 'Los audios se envían sin texto' : 'Pie (opcional)…') : 'Escribe un mensaje...'}
          className="flex-1 resize-none px-3 py-2.5 text-[13px] text-gray-900 bg-white
                     border border-gray-200 rounded-lg placeholder:text-gray-400
                     outline-none transition-all focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/10
                     disabled:bg-gray-50"
        />
        <Button onClick={foto ? mandarFoto : onEnviar}
          disabled={enviando || subiendo || (!foto && !texto.trim())} className="h-10 px-4">
          {(enviando || subiendo) ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
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
