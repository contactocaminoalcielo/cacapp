// Plantillas de WhatsApp — crear, revisar y enviar.
//
// Una plantilla es el ÚNICO modo de escribirle a alguien pasadas 24 horas desde
// su último mensaje. Meta las revisa antes de dejarlas usar, y esa revisión
// tarda de minutos a días: por eso se preparan antes de necesitarlas.
//
// 🩸 EL ERROR QUE ESTA PANTALLA VIENE A CORREGIR: en la cuenta vieja hay 251
// plantillas con nombres como `mango_compet_26_3_2026` — una por mascota, con el
// texto quemado. Eso obliga a esperar una aprobación por cada servicio. Una sola
// plantilla con {{1}} sirve para todas. Por eso el constructor empuja a usar
// variables y muestra en todo momento cuántas lleva.
//
// Los datos NO vienen de Supabase ni de Orbit: viven en la cuenta de WhatsApp y
// se piden a Meta a través del backend. Ver lib/plantillasWa.js.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  listarPlantillas, crearPlantilla, borrarPlantilla, enviarPlantilla,
  ESTADOS, CATEGORIAS, IDIOMAS, variablesDe, componente,
  variablesDelCuerpo, variablesDelBoton, conValores,
} from '@/lib/plantillasWa'
import {
  Plus, Loader2, RefreshCw, Trash2, Send, X, AlertTriangle, MessageSquare,
  Link2, Reply, Search,
} from 'lucide-react'

const VACIA = {
  nombre: '', idioma: 'es_MX', categoria: 'UTILITY',
  cabecera: '', cuerpo: '', pie: '', botones: [],
}

export default function PlantillasWhatsapp() {
  const { alert: showAlert, confirm } = useConfirm()
  const [plantillas, setPlantillas] = useState([])
  const [waba, setWaba] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)
  const [enviando, setEnviando] = useState(null)

  const cargar = useCallback(async (conSpinner = true) => {
    if (conSpinner) setCargando(true)
    try {
      const r = await listarPlantillas()
      setPlantillas(r.plantillas || [])
      setWaba(r.waba || '')
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return plantillas
    return plantillas.filter(p =>
      p.name?.toLowerCase().includes(q)
      || componente(p, 'BODY')?.text?.toLowerCase().includes(q))
  }, [plantillas, busqueda])

  // Las que Meta reclasificó: se cobran distinto de lo que se pidió, y si nadie
  // lo mira el cambio aparece en la factura.
  const reclasificadas = plantillas.filter(p => p.previous_category && p.previous_category !== p.category)

  async function quitar(p) {
    const ok = await confirm(
      `Se borrará "${p.name}" de la cuenta de WhatsApp. Si algún envío automático la usa, dejará de funcionar.`,
      { title: 'Borrar plantilla', confirmText: 'Borrar', danger: true }
    )
    if (!ok) return
    try {
      await borrarPlantilla(p.name)
      await cargar(false)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo borrar' })
    }
  }

  return (
    <>
      <Topbar titulo="Plantillas de WhatsApp" />

      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                   placeholder="Buscar por nombre o texto" className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => cargar()} disabled={cargando}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button onClick={() => setCreando(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Nueva plantilla
          </Button>
        </div>

        <p className="text-[12px] text-gray-400">
          Una plantilla es la única forma de escribirle a alguien pasadas 24 horas desde su
          último mensaje. Meta las revisa antes de dejarlas usar
          {waba && <> · cuenta <span className="font-mono">{waba}</span></>}
        </p>

        {reclasificadas.length > 0 && (
          <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-amber-900">
              <b>Meta cambió la categoría de {reclasificadas.length} plantilla(s).</b>{' '}
              {reclasificadas.map(p => p.name).join(', ')}. La categoría decide cuánto cuesta
              cada envío: Marketing se cobra más que Utilidad y permite darse de baja.
            </p>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        {cargando ? (
          <div className="flex justify-center py-20 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !filtradas.length ? (
          <div className="text-center py-16">
            <MessageSquare className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-[13px] text-gray-500">
              {plantillas.length ? 'Ninguna coincide con la búsqueda.' : 'Todavía no hay plantillas en esta cuenta.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtradas.map(p => (
              <Tarjeta key={p.id || p.name} p={p}
                       onEnviar={() => setEnviando(p)} onBorrar={() => quitar(p)} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {creando && (
          <Constructor onCerrar={() => setCreando(false)}
                       onCreada={async () => { setCreando(false); await cargar(false) }} />
        )}
        {enviando && (
          <Enviar p={enviando} onCerrar={() => setEnviando(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Tarjeta({ p, onEnviar, onBorrar }) {
  const est = ESTADOS[p.status] || { label: p.status, clase: 'bg-gray-100 text-gray-600 border-gray-200' }
  const cuerpo = componente(p, 'BODY')?.text || ''
  const vars = variablesDelCuerpo(p)
  const cambiada = p.previous_category && p.previous_category !== p.category

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[13px] text-gray-800 truncate">{p.name}</p>
          <p className="text-[11px] text-gray-400">{p.language}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold border shrink-0 ${est.clase}`}>
          {est.label}
        </span>
      </div>

      <VistaPrevia p={p} />

      {p.status === 'REJECTED' && p.rejected_reason && (
        <p className="text-[11px] text-red-600">Motivo del rechazo: {p.rejected_reason}</p>
      )}

      <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
        <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold
                          ${p.category === 'MARKETING' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
          {p.category}
        </span>
        {cambiada && (
          <span className="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-amber-50 text-amber-700"
                title={`La enviaste como ${p.previous_category} y Meta la cambió`}>
            antes {p.previous_category}
          </span>
        )}
        <span className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold
                          ${vars.length ? 'bg-blue-50 text-[#1A5CD8]' : 'bg-orange-50 text-orange-700'}`}
              title={vars.length
                ? 'Reutilizable: los datos se rellenan al enviar'
                : 'Sin variables: solo sirve para este texto exacto'}>
          {vars.length ? `${vars.length} variable(s)` : 'texto fijo'}
        </span>

        <div className="ml-auto flex gap-1">
          {p.status === 'APPROVED' && (
            <Button size="sm" variant="outline" onClick={onEnviar}>
              <Send className="w-3.5 h-3.5 mr-1" /> Enviar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onBorrar}
                  className="text-gray-400 hover:text-red-600">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {!cuerpo && <p className="text-[11px] text-gray-400 italic">Sin cuerpo</p>}
    </div>
  )
}

/** Cómo se ve en WhatsApp: es lo que evita aprobar algo que se lee mal. */
function VistaPrevia({ p, valores = [] }) {
  const cab = componente(p, 'HEADER')
  const cuerpo = componente(p, 'BODY')?.text || ''
  const pie = componente(p, 'FOOTER')?.text
  const botones = componente(p, 'BUTTONS')?.buttons || []

  return (
    <div className="rounded-xl bg-[#E7F3E9] p-2.5 space-y-1.5">
      <div className="bg-white rounded-lg rounded-tl-sm p-2.5 shadow-sm space-y-1">
        {cab?.format === 'TEXT' && cab.text && (
          <p className="text-[12.5px] font-bold text-gray-800">{conValores(cab.text, valores)}</p>
        )}
        {cab && cab.format !== 'TEXT' && (
          <div className="h-14 rounded-md bg-gray-100 flex items-center justify-center text-[10.5px] text-gray-500">
            {cab.format}
          </div>
        )}
        <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-snug">
          {conValores(cuerpo, valores) || <span className="italic text-gray-400">(sin texto)</span>}
        </p>
        {pie && <p className="text-[10.5px] text-gray-400">{pie}</p>}
      </div>
      {botones.map((b, i) => (
        <div key={i} className="bg-white rounded-lg py-1.5 text-center text-[12px] font-semibold text-[#0a7cff] shadow-sm">
          {b.type === 'URL' ? <Link2 className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'QUICK_REPLY' ? <Reply className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
          {b.text}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Constructor({ onCerrar, onCreada }) {
  const { alert: showAlert } = useConfirm()
  const [f, setF] = useState(VACIA)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const varsCuerpo = variablesDe(f.cuerpo)
  const varsCab = variablesDe(f.cabecera)

  // Meta exige un ejemplo por variable. Se piden aquí y no después porque su
  // error llega cuando uno ya cree haber terminado.
  const [ejemplos, setEjemplos] = useState({})
  const ejemplo = n => ejemplos[n] || ''

  const previa = useMemo(() => ({
    components: [
      ...(f.cabecera ? [{ type: 'HEADER', format: 'TEXT', text: f.cabecera }] : []),
      { type: 'BODY', text: f.cuerpo },
      ...(f.pie ? [{ type: 'FOOTER', text: f.pie }] : []),
      ...(f.botones.length ? [{ type: 'BUTTONS', buttons: f.botones }] : []),
    ],
  }), [f])

  function agregarBoton(tipo) {
    if (f.botones.length >= 10) return
    const b = tipo === 'URL'
      ? { type: 'URL', text: 'Abrir enlace', url: 'https://orbit.orbitacac.com/', example: ['https://orbit.orbitacac.com/'] }
      : { type: 'QUICK_REPLY', text: 'Responder' }
    set('botones', [...f.botones, b])
  }
  const editarBoton = (i, campo, valor) =>
    set('botones', f.botones.map((b, j) => j === i ? { ...b, [campo]: valor } : b))

  async function guardar() {
    setGuardando(true)
    try {
      const componentes = []
      if (f.cabecera.trim()) {
        const c = { type: 'HEADER', format: 'TEXT', text: f.cabecera.trim() }
        if (varsCab.length) c.example = { header_text: varsCab.map(n => ejemplo(`h${n}`)) }
        componentes.push(c)
      }
      const cuerpo = { type: 'BODY', text: f.cuerpo.trim() }
      if (varsCuerpo.length) cuerpo.example = { body_text: [varsCuerpo.map(n => ejemplo(`b${n}`))] }
      componentes.push(cuerpo)
      if (f.pie.trim()) componentes.push({ type: 'FOOTER', text: f.pie.trim() })
      if (f.botones.length) {
        componentes.push({
          type: 'BUTTONS',
          buttons: f.botones.map(b => b.type === 'URL'
            ? { type: 'URL', text: b.text, url: b.url, example: [b.example?.[0] || b.url] }
            : { type: 'QUICK_REPLY', text: b.text }),
        })
      }

      const r = await crearPlantilla({
        nombre: f.nombre.trim(), idioma: f.idioma, categoria: f.categoria, componentes,
      })
      if (r.aviso) await showAlert(r.aviso, { title: 'Enviada, con un cambio' })
      onCreada()
    } catch (e) {
      await showAlert(e.message, { title: 'Meta no la aceptó' })
    } finally {
      setGuardando(false)
    }
  }

  const listo = f.nombre.trim() && f.cuerpo.trim()
    && [...varsCuerpo.map(n => `b${n}`), ...varsCab.map(n => `h${n}`)].every(k => ejemplo(k).trim())

  return (
    <Modal titulo="Nueva plantilla" onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="grid lg:grid-cols-[1fr_260px] gap-5">
        <div className="space-y-4">
          <Campo etiqueta="Nombre" ayuda="Solo minúsculas, números y guion bajo. No se puede cambiar después.">
            <Input value={f.nombre} placeholder="recordatorios_listos"
                   onChange={e => set('nombre', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
          </Campo>

          <div className="grid sm:grid-cols-2 gap-3">
            <Campo etiqueta="Categoría">
              <select value={f.categoria} onChange={e => set('categoria', e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px]">
                {CATEGORIAS.map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                {CATEGORIAS.find(c => c.valor === f.categoria)?.ayuda}
              </p>
            </Campo>
            <Campo etiqueta="Idioma">
              <select value={f.idioma} onChange={e => set('idioma', e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px]">
                {IDIOMAS.map(i => <option key={i.valor} value={i.valor}>{i.label}</option>)}
              </select>
            </Campo>
          </div>

          <Campo etiqueta="Título (opcional)">
            <Input value={f.cabecera} onChange={e => set('cabecera', e.target.value)}
                   placeholder="Los recordatorios de {{1}} ya están listos" />
          </Campo>

          <Campo etiqueta="Mensaje"
                 ayuda="Escribe {{1}}, {{2}}… donde vayan los datos que cambian. Con variables la misma plantilla sirve para todas las mascotas; sin ellas hay que crear (y esperar que aprueben) una nueva cada vez.">
            <Textarea rows={5} value={f.cuerpo} onChange={e => set('cuerpo', e.target.value)}
                      placeholder="Hola, los recordatorios de {{1}} ya están listos para entrega." />
          </Campo>

          {(varsCuerpo.length > 0 || varsCab.length > 0) && (
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
              <p className="text-[11.5px] font-semibold text-[#1A5CD8]">
                Ejemplo de cada variable — Meta los exige para poder revisarla
              </p>
              {varsCab.map(n => (
                <EjemploVar key={`h${n}`} etiqueta={`Título {{${n}}}`}
                            valor={ejemplo(`h${n}`)} onChange={v => setEjemplos(e => ({ ...e, [`h${n}`]: v }))} />
              ))}
              {varsCuerpo.map(n => (
                <EjemploVar key={`b${n}`} etiqueta={`Mensaje {{${n}}}`}
                            valor={ejemplo(`b${n}`)} onChange={v => setEjemplos(e => ({ ...e, [`b${n}`]: v }))} />
              ))}
            </div>
          )}

          <Campo etiqueta="Pie (opcional)">
            <Input value={f.pie} onChange={e => set('pie', e.target.value)} placeholder="Camino al Cielo" />
          </Campo>

          <Campo etiqueta="Botones (opcional)"
                 ayuda="El de respuesta rápida es especial: al tocarlo la persona nos escribe, y eso reabre la ventana de 24 horas para poder conversar.">
            <div className="space-y-2">
              {f.botones.map((b, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <Input value={b.text} onChange={e => editarBoton(i, 'text', e.target.value)}
                           placeholder="Texto del botón" />
                    {b.type === 'URL' && (
                      <Input value={b.url} onChange={e => editarBoton(i, 'url', e.target.value)}
                             placeholder="https://… (usa {{1}} para un enlace distinto por persona)" />
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => set('botones', f.botones.filter((_, j) => j !== i))}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => agregarBoton('QUICK_REPLY')}>
                  <Reply className="w-3.5 h-3.5 mr-1" /> Respuesta rápida
                </Button>
                <Button size="sm" variant="outline" onClick={() => agregarBoton('URL')}>
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Enlace
                </Button>
              </div>
            </div>
          </Campo>
        </div>

        <div className="space-y-2">
          <p className="text-[11.5px] font-semibold text-gray-500">Así se verá</p>
          <VistaPrevia p={previa} />
          <p className="text-[11px] text-gray-400">
            Al guardar se envía a Meta para revisión. Suele tardar minutos, a veces días.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
        <Button onClick={guardar} disabled={!listo || guardando}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          Enviar a revisión
        </Button>
      </div>
    </Modal>
  )
}

function EjemploVar({ etiqueta, valor, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-gray-500 w-24 shrink-0">{etiqueta}</span>
      <Input value={valor} onChange={e => onChange(e.target.value)} placeholder="Ej: Toby" className="h-8" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Enviar({ p, onCerrar }) {
  const { alert: showAlert } = useConfirm()
  const [contacto, setContacto] = useState('')
  const [valores, setValores] = useState([])
  const [valoresBoton, setValoresBoton] = useState([])
  const [enviando, setEnviando] = useState(false)

  const vars = variablesDelCuerpo(p)
  const varsBoton = variablesDelBoton(p)
  const listo = contacto.replace(/\D/g, '').length >= 10
    && vars.every((_, i) => (valores[i] || '').trim())
    && varsBoton.every((_, i) => (valoresBoton[i] || '').trim())

  async function mandar() {
    setEnviando(true)
    try {
      await enviarPlantilla(p.name, {
        contacto: contacto.replace(/\D/g, ''), idioma: p.language,
        variables: valores.slice(0, vars.length),
        variablesBoton: valoresBoton.slice(0, varsBoton.length),
      })
      await showAlert('Enviada. Aparecerá en la bandeja de WhatsApp.', { title: 'Listo' })
      onCerrar()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo enviar' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Enviar "${p.name}"`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="space-y-4">
        <Campo etiqueta="Número de destino" ayuda="Solo dígitos, con indicativo. Ej: 573001234567">
          <Input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="573001234567" />
        </Campo>

        {vars.map((n, i) => (
          <Campo key={n} etiqueta={`Variable {{${n}}}`}>
            <Input value={valores[i] || ''}
                   onChange={e => setValores(v => Object.assign([...v], { [i]: e.target.value }))} />
          </Campo>
        ))}
        {varsBoton.map((n, i) => (
          <Campo key={`btn${n}`} etiqueta={`Enlace del botón {{${n}}}`}>
            <Input value={valoresBoton[i] || ''}
                   onChange={e => setValoresBoton(v => Object.assign([...v], { [i]: e.target.value }))} />
          </Campo>
        ))}

        <div>
          <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">Así le llegará</p>
          <VistaPrevia p={p} valores={valores} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
        <Button onClick={mandar} disabled={!listo || enviando}>
          {enviando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Enviar
        </Button>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Campo({ etiqueta, ayuda, children }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-gray-600 mb-1">{etiqueta}</label>
      {children}
      {ayuda && <p className="text-[11px] text-gray-400 mt-1">{ayuda}</p>}
    </div>
  )
}

function Modal({ titulo, ancho = 'max-w-2xl', onCerrar, children }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
                onClick={onCerrar}>
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`bg-white rounded-2xl shadow-xl w-full ${ancho} my-8 p-5`}
                  onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-gray-800">{titulo}</h2>
          <Button size="sm" variant="ghost" onClick={onCerrar}><X className="w-4 h-4" /></Button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
