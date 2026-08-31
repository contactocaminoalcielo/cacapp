// Abrir conversación con una plantilla, desde la bandeja.
//
// POR QUÉ EXISTE: pasadas 24 horas del último mensaje del contacto, Meta no
// deja escribir texto libre. Hasta ahora la bandeja se limitaba a decirlo —
// "hace falta una plantilla aprobada, todavía no está disponible en Orbit"— y
// el coordinador tenía que irse a Plantillas, buscar la que quería, teclear el
// número a mano y volver. Es el mismo envío, solo que con tres pasos donde el
// hilo ya tiene el contacto y la línea delante.
//
// LO QUE NO SE PUEDE PERDER POR EL CAMINO:
//  · La LÍNEA. Una conversación es (línea, número): la plantilla tiene que
//    salir por la línea del hilo abierto o le llega a la clínica desde un
//    número con el que nunca ha hablado. Viaja en `linea` y el backend la
//    valida contra las del agente (ver `contexto` en whatsapp-plantillas.js).
//  · La WABA. Cada línea vive en su cuenta y cada cuenta tiene SUS plantillas:
//    la lista se pide por línea, no "todas las plantillas".
//  · Solo las APROBADAS. Meta rechaza el envío de cualquier otra, así que las
//    demás no se ofrecen; una en revisión ni siquiera se puede probar.
import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import VistaPreviaPlantilla from '@/components/whatsapp/VistaPreviaPlantilla'
import {
  listarPlantillas, enviarPlantilla, buscarServicios, valoresDeServicio,
  variablesDePlantilla, camposDisponibles, huecosDePlantilla, componente,
  ESTADOS, CATEGORIAS,
} from '@/lib/plantillasWa'
import {
  X, Search, Loader2, Send, AlertTriangle, Database, ArrowLeft, FileText,
} from 'lucide-react'

export default function EnviarPlantilla({ contacto, linea, nombreLinea, onCerrar, onEnviada }) {
  const [plantillas, setPlantillas] = useState(null)   // null = cargando
  const [errorLista, setErrorLista] = useState(null)
  const [agente, setAgente] = useState(null)
  const [q, setQ] = useState('')
  const [elegida, setElegida] = useState(null)
  const [campos, setCampos] = useState([])

  // La lista va POR LÍNEA: sin esto, un hilo de la segunda cuenta vería las
  // plantillas de la primera y ninguna se podría enviar.
  useEffect(() => {
    let vivo = true
    listarPlantillas(null, linea)
      .then(r => {
        if (!vivo) return
        setPlantillas((r.plantillas || []).filter(p => p.status === 'APPROVED'))
        setAgente(r.agente || null)
      })
      .catch(e => { if (vivo) { setErrorLista(e.message); setPlantillas([]) } })
    return () => { vivo = false }
  }, [linea])

  // El catálogo de campos es solo para decir DE DÓNDE sale cada hueco. Que
  // falle no impide enviar: se escriben a mano, como siempre.
  useEffect(() => {
    camposDisponibles().then(r => setCampos(r.campos || [])).catch(() => {})
  }, [])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return plantillas || []
    return (plantillas || []).filter(p =>
      p.name.toLowerCase().includes(t)
      || (componente(p, 'BODY')?.text || '').toLowerCase().includes(t))
  }, [plantillas, q])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onClick={onCerrar}>
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl
                   max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden">

        <header className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
          {elegida && (
            <button onClick={() => setElegida(null)} aria-label="Volver a la lista de plantillas"
                    className="p-1.5 -ml-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[13.5px] font-semibold text-gray-800 truncate">
              {elegida ? elegida.name : 'Abrir con una plantilla'}
            </h2>
            <p className="text-[11px] text-gray-500 truncate">
              {/* Se dice a quién y por dónde ANTES de enviar: es lo único que
                  distingue este envío de mandárselo a la línea equivocada. */}
              A {contacto}{nombreLinea ? ` · por ${nombreLinea}` : ''}
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer">
            <X size={16} />
          </button>
        </header>

        {elegida ? (
          <Formulario p={elegida} contacto={contacto} linea={linea} campos={campos}
                      agenteId={agente?.id || null} onEnviada={onEnviada} />
        ) : (
          <>
            <div className="px-4 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-8" placeholder="Buscar por nombre o texto…"
                       value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {plantillas === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-[13px]">
                  <Loader2 size={15} className="animate-spin" /> Cargando plantillas…
                </div>
              ) : errorLista ? (
                <div className="py-8 text-center">
                  <AlertTriangle size={20} className="mx-auto mb-2 text-amber-500" />
                  <p className="text-[12px] text-gray-600">{errorLista}</p>
                </div>
              ) : filtradas.length === 0 ? (
                <div className="py-8 text-center px-4">
                  <FileText size={20} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-[12.5px] font-semibold text-gray-600">
                    {q.trim() ? 'Ninguna coincide' : 'Esta línea no tiene plantillas aprobadas'}
                  </p>
                  <p className="text-[11.5px] text-gray-500 mt-1">
                    {q.trim()
                      ? 'Prueba con otra palabra del mensaje.'
                      : 'Solo se pueden enviar las que Meta ya aprobó. Créalas en Plantillas de WhatsApp; la revisión tarda de minutos a días.'}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {filtradas.map(p => (
                    <li key={`${p.name}:${p.language}`}>
                      <button onClick={() => setElegida(p)}
                              className="w-full text-left p-2.5 rounded-xl border border-gray-200 hover:border-[#1A5CD8]/40
                                         hover:bg-blue-50/40 cursor-pointer transition-colors
                                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/40">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-semibold text-gray-800 truncate">{p.name}</p>
                            <p className="text-[11.5px] text-gray-500 line-clamp-2 leading-snug mt-0.5">
                              {componente(p, 'BODY')?.text || 'Sin texto'}
                            </p>
                          </div>
                          <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0
                                            ${ESTADOS[p.status]?.clase || ''}`}>
                            {CATEGORIAS.find(c => c.valor === p.category)?.label || p.category}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rellenar los huecos y enviar.
 *
 * El número NO se pide: es el del hilo. Pedirlo otra vez es la vía de escribir
 * mal un dígito y mandarle a otra persona un mensaje que se cobra.
 */
function Formulario({ p, contacto, linea, campos, agenteId, onEnviada }) {
  const [valores, setValores] = useState({})
  const [asignado, setAsignado] = useState({})
  const [servicio, setServicio] = useState(null)
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const huecos = huecosDePlantilla(p)
  const mapa = useMemo(() => Object.fromEntries(campos.map(c => [c.clave, c])), [campos])

  // Qué dato de Orbit rellena cada hueco (migraciones 097/102). Solo sirve para
  // decirlo en la ayuda: los valores llegan del servicio elegido.
  useEffect(() => {
    variablesDePlantilla(p.name, p.language, agenteId)
      .then(r => {
        const m = {}
        for (const v of r.variables || []) m[`${v.destino}:${v.param ?? v.posicion}`] = v.campo
        setAsignado(m)
      })
      .catch(() => {})
  }, [p.name, p.language, agenteId])

  // Buscar por lo que se tiene a mano: mascota, familia o código de fotos.
  useEffect(() => {
    if (q.trim().length < 2) { setResultados([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await buscarServicios(q.trim())
        if (vivo) setResultados(r.servicios || [])
      } catch { /* la búsqueda no bloquea escribir los huecos a mano */ }
      finally { if (vivo) setBuscando(false) }
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])

  async function tomar(s) {
    setServicio(s); setResultados([]); setQ(''); setAviso(null)
    try {
      const r = await valoresDeServicio(p.name, s.id, p.language, agenteId)
      setValores(prev => ({
        ...prev,
        ...Object.fromEntries(Object.entries(r.valores || {}).filter(([, v]) => v)),
      }))
      if (!r.variables?.length) {
        setAviso('Esta plantilla no tiene datos asignados: los huecos se escriben a mano. Se atan en Plantillas → Datos.')
      } else if (r.sinAsignar?.length) {
        setAviso(`Ese servicio no tiene: ${r.sinAsignar.join(', ')}. Complétalo abajo.`)
      }
    } catch (e) { setAviso(e.message) }
  }

  const listo = huecos.every(h => String(valores[h.clave] || '').trim())

  async function mandar() {
    if (enviando) return
    setEnviando(true); setError(null)
    try {
      await enviarPlantilla(p.name, {
        contacto, idioma: p.language, valores,
        // El servicio va aunque los valores ya estén rellenos: el backend
        // vuelve a leer de Orbit lo que esté mapeado, que es más fiable que lo
        // que quedó en pantalla si alguien tardó en darle a Enviar.
        servicioId: servicio?.id || null,
        // Por dónde sale. Es lo que distingue responder a este hilo de mandarle
        // el mensaje desde otro número.
        linea, agenteId,
      })
      // No hay confirmación aparte: el mensaje aparece en el hilo, que es donde
      // se estaba mirando. Un modal de "Listo" encima taparía justo eso.
      onEnviada?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  // La previa va por HUECO, sin el destino: el título y el cuerpo pueden
  // nombrar el mismo dato.
  const previaValores = Object.fromEntries(
    Object.entries(valores).map(([k, v]) => [k.split(':')[1], v]))

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {huecos.length > 0 && (
          <div>
            <label className="text-[11.5px] font-semibold text-gray-600 block mb-1">
              ¿De qué servicio salen los datos?
            </label>
            {servicio ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50/60 border border-blue-100">
                <Database size={15} className="text-[#1A5CD8] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-gray-800 truncate">
                    {servicio.mascota || 'Sin mascota'} · {servicio.cliente || 'sin familia'}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {servicio.plan || 'sin plan'} · {servicio.estado}
                  </p>
                </div>
                <button onClick={() => setServicio(null)} aria-label="Quitar el servicio"
                        className="p-1 rounded text-gray-400 hover:text-red-500 cursor-pointer">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)}
                       placeholder="Toby, Marta Gómez, AB12CD…" />
                {buscando && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
                {resultados.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                    {resultados.map(s => (
                      <button key={s.id} onClick={() => tomar(s)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 cursor-pointer">
                        <p className="text-[12.5px] font-semibold text-gray-800">
                          {s.mascota || 'Sin mascota'} · <span className="font-normal text-gray-500">{s.cliente}</span>
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {s.plan || 'sin plan'} · {s.estado}{s.fecha_ingreso && ` · ${s.fecha_ingreso}`}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {aviso && <p className="text-[11px] text-amber-700 mt-1">{aviso}</p>}
          </div>
        )}

        {huecos.map(h => {
          const campo = mapa[asignado[h.clave]]
          return (
            <div key={h.clave}>
              <label className="text-[11.5px] font-semibold text-gray-600 block mb-1">
                {h.destino === 'HEADER' ? 'Título' : h.destino === 'BUTTON' ? 'Enlace del botón' : 'Mensaje'}
                {' '}<span className="font-mono text-gray-400">{`{{${h.hueco}}}`}</span>
              </label>
              <Input value={valores[h.clave] || ''}
                     onChange={e => setValores(v => ({ ...v, [h.clave]: e.target.value }))} />
              <p className="text-[10.5px] text-gray-400 mt-0.5">
                {campo ? `Sale de Orbit: ${campo.grupo} — ${campo.etiqueta}` : 'Sin dato asignado: se escribe a mano.'}
              </p>
            </div>
          )
        })}

        <div>
          <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">Así le llegará</p>
          <VistaPreviaPlantilla p={p} valores={previaValores} />
        </div>

        {/* Se dice ANTES de enviar, no después: una plantilla se cobra y no se
            puede deshacer, y además reabre la conversación para el agente. */}
        <p className="text-[10.5px] text-gray-400 leading-relaxed">
          Al enviarla se abre otra vez la ventana de 24 horas si el contacto responde.
          Meta cobra cada plantilla y no se puede deshacer.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0 space-y-2">
        {error && (
          <p className="text-[11.5px] text-red-600 flex items-start gap-1.5">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {error}
          </p>
        )}
        {!listo && huecos.length > 0 && (
          <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            {/* Meta acepta el envío con un hueco vacío: llega un espacio en
                blanco en mitad de la frase y ya está mandado. */}
            Faltan huecos por rellenar. Uno vacío llega como un blanco en mitad de la frase.
          </p>
        )}
        <Button onClick={mandar} disabled={!listo || enviando} className="w-full">
          {enviando ? <Loader2 size={15} className="mr-1.5 animate-spin" />
            : <Send size={15} className="mr-1.5" />}
          Enviar plantilla
        </Button>
      </div>
    </>
  )
}
