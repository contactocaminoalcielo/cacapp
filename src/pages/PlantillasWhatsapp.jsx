// Plantillas de WhatsApp — construir, revisar, mapear a Orbit y enviar.
//
// Una plantilla es el ÚNICO modo de escribirle a alguien pasadas 24 horas desde
// su último mensaje. Meta las revisa antes de dejarlas usar, y esa revisión
// tarda de minutos a días: por eso se preparan antes de necesitarlas.
//
// 🩸 EL ERROR QUE ESTA PANTALLA VIENE A CORREGIR: en la cuenta vieja hay 251
// plantillas con nombres como `mango_compet_26_3_2026` — una por mascota, con el
// texto quemado. Eso obliga a esperar una aprobación por cada servicio. Una sola
// plantilla con un hueco sirve para todas. Por eso el constructor empuja a usar
// variables, y por eso cada hueco se puede atar a un dato de Orbit: si el nombre
// de la mascota sale solo, nadie necesita una plantilla por mascota.
//
// Lo que se comprobó contra la API el 2026-08-19 y esta pantalla ya usa:
// variables CON NOMBRE (`{{mascota}}`), cabecera con imagen/video/PDF, botones
// de llamada y de copiar código, y **editar una plantilla ya aprobada** — que se
// creía imposible.
//
// Los datos NO vienen de Supabase: las plantillas viven en la cuenta de WhatsApp
// y el mapeo en Orbit; todo pasa por el backend. Ver lib/plantillasWa.js.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  listarPlantillas, crearPlantilla, editarPlantilla, borrarPlantilla, enviarPlantilla,
  subirCabecera, buscarServicios,
  ESTADOS, CATEGORIAS, IDIOMAS, FORMATOS, CABECERAS, BOTONES, esMedia,
  huecosDe, componente, esNamed, huecosDePlantilla, conValores,
  camposDisponibles, variablesDePlantilla, guardarVariables, valoresDeServicio, porGrupo,
} from '@/lib/plantillasWa'
import { cargarMateriales, leerArchivo } from '@/lib/materialesApi'
import CampanasWa from '@/pages/whatsapp/CampanasWa'
import {
  Plus, Loader2, RefreshCw, Trash2, Send, X, AlertTriangle, MessageSquare,
  Link2, Reply, Search, Database, Check, Pencil, Phone, Copy, Image as ImageIcon,
  FileText, Film, MapPin, Upload, Megaphone,
} from 'lucide-react'

const VACIA = {
  nombre: '', idioma: 'es_MX', categoria: 'UTILITY', formato: 'NAMED',
  cabTipo: '', cabTexto: '', cabHandle: '', cabArchivo: null,
  cuerpo: '', pie: '', botones: [],
}

export default function PlantillasWhatsapp() {
  const { alert: showAlert, confirm } = useConfirm()
  const [plantillas, setPlantillas] = useState([])
  const [waba, setWaba] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null)   // null | 'nueva' | plantilla
  const [enviando, setEnviando] = useState(null)
  const [mapeando, setMapeando] = useState(null)
  const [campos, setCampos] = useState([])
  const [pestana, setPestana] = useState('plantillas')
  // Entrar al envío masivo YA con la plantilla puesta: llegar a esta pantalla
  // con una plantilla en la cabeza y tener que volver a elegirla es fricción
  // gratis.
  const [masivoDe, setMasivoDe] = useState(null)

  // El catálogo de datos de Orbit que pueden ir en un hueco. Es cerrado y viene
  // del backend: la pantalla no inventa campos.
  useEffect(() => {
    camposDisponibles().then(r => setCampos(r.campos || [])).catch(() => {})
  }, [])

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
      `Se borrará "${p.name}" de la cuenta de WhatsApp, y con ella el mapeo de datos. `
      + 'Si algún envío automático la usa, dejará de funcionar. '
      + 'Si solo quieres cambiarle el texto, usa Editar: ya no hace falta borrarla.',
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
        <div className="flex gap-1 p-1 bg-gray-100/70 rounded-xl w-fit">
          {[['plantillas', 'Plantillas', MessageSquare], ['campanas', 'Envíos masivos', Megaphone]].map(([v, txt, Icono]) => (
            <button key={v} onClick={() => setPestana(v)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition
                      ${pestana === v ? 'bg-white text-[#1A5CD8] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icono className="w-3.5 h-3.5" /> {txt}
            </button>
          ))}
        </div>

        {pestana === 'campanas' ? (
          <CampanasWa plantillas={plantillas} abrirCon={masivoDe}
                      onAbierto={() => setMasivoDe(null)} />
        ) : (
        <>
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
          <Button onClick={() => setEditando('nueva')}>
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
                       onEnviar={() => setEnviando(p)} onBorrar={() => quitar(p)}
                       onEditar={() => setEditando(p)} onMapear={() => setMapeando(p)}
                       onMasivo={() => { setMasivoDe(p.name); setPestana('campanas') }} />
            ))}
          </div>
        )}
        </>
        )}
      </div>

      <AnimatePresence>
        {editando && (
          <Constructor original={editando === 'nueva' ? null : editando}
                       onCerrar={() => setEditando(null)}
                       onGuardada={async () => { setEditando(null); await cargar(false) }} />
        )}
        {enviando && (
          <Enviar p={enviando} campos={campos} onCerrar={() => setEnviando(null)} />
        )}
        {mapeando && (
          <Mapeo p={mapeando} campos={campos} onCerrar={() => setMapeando(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Tarjeta({ p, onEnviar, onBorrar, onEditar, onMapear, onMasivo }) {
  const est = ESTADOS[p.status] || { label: p.status, clase: 'bg-gray-100 text-gray-600 border-gray-200' }
  const cuerpo = componente(p, 'BODY')?.text || ''
  const huecos = huecosDePlantilla(p)
  const cambiada = p.previous_category && p.previous_category !== p.category

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[13px] text-gray-800 truncate">{p.name}</p>
          <p className="text-[11px] text-gray-400">
            {p.language}{esNamed(p) && ' · variables con nombre'}
          </p>
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
                          ${huecos.length ? 'bg-blue-50 text-[#1A5CD8]' : 'bg-orange-50 text-orange-700'}`}
              title={huecos.length
                ? 'Reutilizable: los datos se rellenan al enviar'
                : 'Sin variables: solo sirve para este texto exacto'}>
          {huecos.length ? `${huecos.length} variable(s)` : 'texto fijo'}
        </span>

        <div className="ml-auto flex gap-1">
          {huecos.length > 0 && (
            <Button size="sm" variant="outline" onClick={onMapear} title="Decir qué dato de Orbit va en cada variable">
              <Database className="w-3.5 h-3.5 mr-1" /> Datos
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEditar} disabled={p.status === 'PENDING'}
                  title={p.status === 'PENDING'
                    ? 'Mientras Meta la revisa no se puede editar: espera a que la apruebe o la rechace'
                    : 'Cambiar el texto (vuelve a revisión de Meta)'}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          {p.status === 'APPROVED' && (
            <>
              <Button size="sm" variant="outline" onClick={onMasivo}
                      title="Mandarla a muchos a la vez">
                <Megaphone className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={onEnviar}>
                <Send className="w-3.5 h-3.5 mr-1" /> Enviar
              </Button>
            </>
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

const ICONO_CAB = { IMAGE: ImageIcon, VIDEO: Film, DOCUMENT: FileText, LOCATION: MapPin }

/** Cómo se ve en WhatsApp: es lo que evita aprobar algo que se lee mal. */
function VistaPrevia({ p, valores = {} }) {
  const cab = componente(p, 'HEADER')
  const cuerpo = componente(p, 'BODY')?.text || ''
  const pie = componente(p, 'FOOTER')?.text
  const botones = componente(p, 'BUTTONS')?.buttons || []
  const Icono = ICONO_CAB[cab?.format]

  return (
    <div className="rounded-xl bg-[#E7F3E9] p-2.5 space-y-1.5">
      <div className="bg-white rounded-lg rounded-tl-sm p-2.5 shadow-sm space-y-1">
        {cab?.format === 'TEXT' && cab.text && (
          <p className="text-[12.5px] font-bold text-gray-800">{conValores(cab.text, valores)}</p>
        )}
        {Icono && (
          <div className="h-16 rounded-md bg-gray-100 flex flex-col items-center justify-center gap-1 text-gray-400">
            <Icono className="w-5 h-5" />
            <span className="text-[10px]">
              {CABECERAS.find(c => c.valor === cab.format)?.label || cab.format}
            </span>
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
            : b.type === 'QUICK_REPLY' ? <Reply className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'PHONE_NUMBER' ? <Phone className="w-3 h-3 inline mr-1 -mt-0.5" />
            : b.type === 'COPY_CODE' ? <Copy className="w-3 h-3 inline mr-1 -mt-0.5" /> : null}
          {b.text || (b.type === 'COPY_CODE' ? 'Copiar código' : '')}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/** Lee una plantilla de Meta y la convierte en el formulario del constructor. */
function desdePlantilla(p) {
  if (!p) return VACIA
  const cab = componente(p, 'HEADER')
  const pie = componente(p, 'FOOTER')
  const botones = (componente(p, 'BUTTONS')?.buttons || []).map(b => ({ ...b }))
  return {
    nombre: p.name, idioma: p.language, categoria: p.category,
    formato: esNamed(p) ? 'NAMED' : 'POSITIONAL',
    cabTipo: cab?.format || '',
    cabTexto: cab?.format === 'TEXT' ? cab.text || '' : '',
    // Meta devuelve la URL de su CDN donde estaba el `handle`, y esa URL no vale
    // para volver a crearla: si se cambia una plantilla con imagen hay que
    // subir el archivo otra vez. Se avisa en la pantalla, no se adivina.
    cabHandle: '', cabArchivo: null,
    cuerpo: componente(p, 'BODY')?.text || '',
    pie: pie?.text || '',
    botones,
  }
}

/** Los ejemplos que ya tiene la plantilla, indexados por hueco. */
function ejemplosDe(p) {
  if (!p) return {}
  const out = {}
  const named = esNamed(p)
  for (const c of p.components || []) {
    if (c.type !== 'BODY' && c.type !== 'HEADER') continue
    const destino = c.type
    if (named) {
      const lista = c.example?.[c.type === 'BODY' ? 'body_text_named_params' : 'header_text_named_params'] || []
      lista.forEach(d => { out[`${destino}:${d.param_name}`] = d.example })
    } else {
      const lista = c.type === 'BODY' ? (c.example?.body_text?.[0] || []) : (c.example?.header_text || [])
      huecosDe(c.text).forEach((h, i) => { out[`${destino}:${h}`] = lista[i] })
    }
  }
  return out
}

function Constructor({ original, onCerrar, onGuardada }) {
  const { alert: showAlert } = useConfirm()
  const editar = !!original
  const [f, setF] = useState(() => desdePlantilla(original))
  const [ejemplos, setEjemplos] = useState(() => ejemplosDe(original))
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const archivoRef = useRef(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const ejemplo = k => ejemplos[k] || ''

  const named = f.formato === 'NAMED'
  const huecosCuerpo = huecosDe(f.cuerpo)
  const huecosCab = f.cabTipo === 'TEXT' ? huecosDe(f.cabTexto) : []
  const iBotonUrl = f.botones.findIndex(b => b.type === 'URL' && huecosDe(b.url).length)

  const previa = useMemo(() => ({
    parameter_format: f.formato,
    components: [
      ...(f.cabTipo === 'TEXT' && f.cabTexto ? [{ type: 'HEADER', format: 'TEXT', text: f.cabTexto }] : []),
      ...(f.cabTipo && f.cabTipo !== 'TEXT' ? [{ type: 'HEADER', format: f.cabTipo }] : []),
      { type: 'BODY', text: f.cuerpo },
      ...(f.pie ? [{ type: 'FOOTER', text: f.pie }] : []),
      ...(f.botones.length ? [{ type: 'BUTTONS', buttons: f.botones }] : []),
    ],
  }), [f])

  // Insertar el hueco donde está el cursor es lo que hace que la gente los use.
  // Escribirlos a mano invita a equivocarse de número y, sobre todo, a no
  // ponerlos — que es como se llega a una plantilla por mascota.
  const cuerpoRef = useRef(null)
  const [nombreHueco, setNombreHueco] = useState('')
  function insertarHueco() {
    const nombre = named ? nombreHueco.trim() : String(huecosCuerpo.length + 1)
    if (!nombre) return
    const el = cuerpoRef.current
    const i = el?.selectionStart ?? f.cuerpo.length
    set('cuerpo', f.cuerpo.slice(0, i) + `{{${nombre}}}` + f.cuerpo.slice(i))
    setNombreHueco('')
    // Devolver el foco al mensaje: el hueco casi nunca es lo último que se
    // escribe, y perder el cursor obliga a buscar el sitio otra vez.
    requestAnimationFrame(() => {
      el?.focus()
      const fin = i + nombre.length + 4
      el?.setSelectionRange(fin, fin)
    })
  }

  async function elegirArchivo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(true)
    try {
      const base64 = await leerArchivo(file)
      const r = await subirCabecera({ base64, mime: file.type, nombre: file.name })
      setF(p => ({ ...p, cabHandle: r.handle, cabArchivo: { nombre: file.name, mime: file.type } }))
    } catch (err) {
      await showAlert(err.message, { title: 'No se pudo subir el archivo' })
    } finally {
      setSubiendo(false)
    }
  }

  function agregarBoton(tipo) {
    if (f.botones.length >= 10) return
    const nuevo = {
      QUICK_REPLY:  { type: 'QUICK_REPLY', text: 'Responder' },
      URL:          { type: 'URL', text: 'Abrir enlace', url: 'https://orbit.orbitacac.com/' },
      PHONE_NUMBER: { type: 'PHONE_NUMBER', text: 'Llámanos', phone_number: '+573180967711' },
      COPY_CODE:    { type: 'COPY_CODE', example: 'CODIGO123' },
    }[tipo]
    set('botones', [...f.botones, nuevo])
  }
  const editarBoton = (i, campo, valor) =>
    set('botones', f.botones.map((b, j) => j === i ? { ...b, [campo]: valor } : b))

  /** El ejemplo de cada hueco, en la forma que pide Meta según el formato. */
  function ejemploDe(destino, huecos) {
    if (!huecos.length) return undefined
    if (named) {
      const clave = destino === 'BODY' ? 'body_text_named_params' : 'header_text_named_params'
      return { [clave]: huecos.map(h => ({ param_name: h, example: ejemplo(`${destino}:${h}`) })) }
    }
    const vals = huecos.map(h => ejemplo(`${destino}:${h}`))
    return destino === 'BODY' ? { body_text: [vals] } : { header_text: vals }
  }

  async function guardar() {
    setGuardando(true)
    try {
      const componentes = []

      if (f.cabTipo === 'TEXT' && f.cabTexto.trim()) {
        componentes.push({
          type: 'HEADER', format: 'TEXT', text: f.cabTexto.trim(),
          ...(huecosCab.length ? { example: ejemploDe('HEADER', huecosCab) } : {}),
        })
      } else if (esMedia(f.cabTipo)) {
        componentes.push({ type: 'HEADER', format: f.cabTipo, example: { header_handle: [f.cabHandle] } })
      } else if (f.cabTipo === 'LOCATION') {
        componentes.push({ type: 'HEADER', format: 'LOCATION' })
      }

      componentes.push({
        type: 'BODY', text: f.cuerpo.trim(),
        ...(huecosCuerpo.length ? { example: ejemploDe('BODY', huecosCuerpo) } : {}),
      })

      if (f.pie.trim()) componentes.push({ type: 'FOOTER', text: f.pie.trim() })

      if (f.botones.length) {
        componentes.push({
          type: 'BUTTONS',
          buttons: f.botones.map(b => {
            if (b.type === 'URL') {
              return {
                type: 'URL', text: b.text, url: b.url,
                // El ejemplo del enlace solo hace falta si lleva variable, y
                // Meta lo quiere ya sustituido: una URL de verdad.
                ...(huecosDe(b.url).length
                  ? { example: [b.url.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, 'ejemplo')] }
                  : {}),
              }
            }
            if (b.type === 'PHONE_NUMBER') {
              return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
            }
            if (b.type === 'COPY_CODE') return { type: 'COPY_CODE', example: b.example || 'CODIGO' }
            return { type: 'QUICK_REPLY', text: b.text }
          }),
        })
      }

      const r = editar
        ? await editarPlantilla(f.nombre, {
            id: original.id, categoria: f.categoria, componentes, formato: f.formato,
          })
        : await crearPlantilla({
            nombre: f.nombre.trim(), idioma: f.idioma, categoria: f.categoria,
            componentes, formato: f.formato,
          })
      if (r.aviso) await showAlert(r.aviso, { title: editar ? 'Editada' : 'Enviada, con un cambio' })
      onGuardada()
    } catch (e) {
      await showAlert(e.message, { title: 'Meta no la aceptó' })
    } finally {
      setGuardando(false)
    }
  }

  const faltaArchivo = esMedia(f.cabTipo) && !f.cabHandle
  const listo = f.nombre.trim() && f.cuerpo.trim() && !faltaArchivo
    && [...huecosCuerpo.map(h => `BODY:${h}`), ...huecosCab.map(h => `HEADER:${h}`)]
       .every(k => ejemplo(k).trim())

  return (
    <Modal titulo={editar ? `Editar "${original.name}"` : 'Nueva plantilla'} onCerrar={onCerrar} ancho="max-w-3xl">
      {editar && (
        <div className="flex gap-2.5 p-3 mb-4 rounded-xl bg-blue-50/70 border border-blue-100">
          <Pencil className="w-4 h-4 text-[#1A5CD8] shrink-0 mt-0.5" />
          <p className="text-[12px] text-[#1A5CD8]">
            Al guardar vuelve a revisión de Meta y no se podrá enviar hasta que la aprueben.
            El nombre y el idioma no se pueden cambiar — <b>el mapeo de datos se conserva</b>.
            Solo se puede editar una plantilla aprobada o rechazada: mientras está en revisión,
            Meta no lo permite.
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_260px] gap-5">
        <div className="space-y-4">
          <Campo etiqueta="Nombre" ayuda="Solo minúsculas, números y guion bajo. No se puede cambiar después.">
            <Input value={f.nombre} placeholder="recordatorios_listos" disabled={editar}
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
              <select value={f.idioma} onChange={e => set('idioma', e.target.value)} disabled={editar}
                      className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] disabled:bg-gray-50">
                {IDIOMAS.map(i => <option key={i.valor} value={i.valor}>{i.label}</option>)}
              </select>
            </Campo>
          </div>

          <Campo etiqueta="Cómo se llaman las variables">
            <div className="flex gap-2">
              {FORMATOS.map(x => (
                <button key={x.valor} type="button" onClick={() => !editar && set('formato', x.valor)}
                        disabled={editar}
                        className={`flex-1 px-3 py-2 rounded-lg border text-left transition
                          ${f.formato === x.valor
                            ? 'border-[#1A5CD8] bg-blue-50/60 text-[#1A5CD8]'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'}
                          ${editar ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <span className="block text-[12px] font-semibold">{x.label}</span>
                  <span className="block font-mono text-[11px] opacity-70">{x.ejemplo}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {editar
                ? 'El formato de las variables no se puede cambiar en una plantilla que ya existe.'
                : FORMATOS.find(x => x.valor === f.formato)?.ayuda}
            </p>
          </Campo>

          <Campo etiqueta="Título (opcional)">
            <select value={f.cabTipo} onChange={e => set('cabTipo', e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] mb-2">
              {CABECERAS.map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
            </select>
            {f.cabTipo === 'TEXT' && (
              <Input value={f.cabTexto} onChange={e => set('cabTexto', e.target.value)}
                     placeholder={named ? 'Los recordatorios de {{mascota}} ya están listos'
                                        : 'Los recordatorios de {{1}} ya están listos'} />
            )}
            {esMedia(f.cabTipo) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => archivoRef.current?.click()} disabled={subiendo}>
                    {subiendo ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
                    {f.cabHandle ? 'Cambiar archivo' : 'Subir archivo'}
                  </Button>
                  {f.cabArchivo && (
                    <span className="text-[11.5px] text-emerald-700 truncate">
                      <Check className="w-3 h-3 inline mr-0.5 -mt-0.5" />{f.cabArchivo.nombre}
                    </span>
                  )}
                </div>
                <input ref={archivoRef} type="file" className="hidden" onChange={elegirArchivo}
                       accept={f.cabTipo === 'IMAGE' ? 'image/jpeg,image/png'
                             : f.cabTipo === 'VIDEO' ? 'video/mp4' : 'application/pdf'} />
                {editar && !f.cabHandle && (
                  <p className="text-[11px] text-amber-700">
                    Meta no devuelve el archivo original: vuelve a subirlo para poder guardar.
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              {CABECERAS.find(c => c.valor === f.cabTipo)?.ayuda}
            </p>
          </Campo>

          <Campo etiqueta="Mensaje"
                 ayuda="Los huecos son lo que hace que una plantilla sirva para todos: sin ellos hay que crear (y esperar que aprueben) una nueva por cada mascota.">
            <Textarea rows={5} ref={cuerpoRef} value={f.cuerpo} onChange={e => set('cuerpo', e.target.value)}
                      placeholder={named
                        ? 'Hola {{cliente}}, los recordatorios de {{mascota}} ya están listos.'
                        : 'Hola {{1}}, los recordatorios de {{2}} ya están listos.'} />
            <div className="flex gap-2 mt-1.5">
              {named && (
                <Input value={nombreHueco} className="h-8 max-w-[200px]"
                       placeholder="mascota, cliente, enlace…"
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertarHueco() } }}
                       onChange={e => setNombreHueco(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
              )}
              <Button size="sm" variant="outline" onClick={insertarHueco}
                      disabled={named && !nombreHueco.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                {named ? 'Insertar' : `Insertar {{${huecosCuerpo.length + 1}}}`}
              </Button>
            </div>
          </Campo>

          {(huecosCuerpo.length > 0 || huecosCab.length > 0) && (
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
              <p className="text-[11.5px] font-semibold text-[#1A5CD8]">
                Ejemplo de cada variable — Meta los exige para poder revisarla
              </p>
              {huecosCab.map(h => (
                <EjemploVar key={`HEADER:${h}`} etiqueta={`Título {{${h}}}`}
                            valor={ejemplo(`HEADER:${h}`)}
                            onChange={v => setEjemplos(e => ({ ...e, [`HEADER:${h}`]: v }))} />
              ))}
              {huecosCuerpo.map(h => (
                <EjemploVar key={`BODY:${h}`} etiqueta={`Mensaje {{${h}}}`}
                            valor={ejemplo(`BODY:${h}`)}
                            onChange={v => setEjemplos(e => ({ ...e, [`BODY:${h}`]: v }))} />
              ))}
              <p className="text-[11px] text-[#1A5CD8]/70">
                Es solo para la revisión. Lo que llegue de verdad se decide en "Datos".
              </p>
            </div>
          )}

          <Campo etiqueta="Pie (opcional)" ayuda="Texto fijo: no admite variables.">
            <Input value={f.pie} onChange={e => set('pie', e.target.value)} placeholder="Camino al Cielo" />
          </Campo>

          <Campo etiqueta="Botones (opcional)">
            <div className="space-y-2">
              {f.botones.map((b, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] font-semibold text-gray-400 w-24 shrink-0">
                        {BOTONES.find(x => x.tipo === b.type)?.label || b.type}
                      </span>
                      {b.type !== 'COPY_CODE' && (
                        <Input value={b.text || ''} onChange={e => editarBoton(i, 'text', e.target.value)}
                               placeholder="Texto del botón" className="h-8" />
                      )}
                    </div>
                    {b.type === 'URL' && (
                      <Input value={b.url || ''} onChange={e => editarBoton(i, 'url', e.target.value)}
                             placeholder={named ? 'https://… (usa {{enlace}} para uno distinto por persona)'
                                                : 'https://… (usa {{1}} para uno distinto por persona)'}
                             className="h-8" />
                    )}
                    {b.type === 'PHONE_NUMBER' && (
                      <Input value={b.phone_number || ''} onChange={e => editarBoton(i, 'phone_number', e.target.value)}
                             placeholder="+573180967711" className="h-8" />
                    )}
                    {b.type === 'COPY_CODE' && (
                      <Input value={b.example || ''} onChange={e => editarBoton(i, 'example', e.target.value)}
                             placeholder="Código de ejemplo" className="h-8" />
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => set('botones', f.botones.filter((_, j) => j !== i))}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {BOTONES.map(x => (
                  <Button key={x.tipo} size="sm" variant="outline" title={x.ayuda}
                          onClick={() => agregarBoton(x.tipo)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> {x.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">
                {BOTONES[0].ayuda}
              </p>
            </div>
          </Campo>
        </div>

        <div className="space-y-2">
          <p className="text-[11.5px] font-semibold text-gray-500">Así se verá</p>
          <VistaPrevia p={previa} />
          {iBotonUrl > 0 && (
            <p className="text-[11px] text-gray-400">
              El botón de enlace con variable va en la posición {iBotonUrl + 1}: al enviar, el
              dato se manda a ese botón y no al primero.
            </p>
          )}
          <p className="text-[11px] text-gray-400">
            {editar
              ? 'Al guardar vuelve a revisión. Suele tardar minutos, a veces días.'
              : 'Al guardar se envía a Meta para revisión. Suele tardar minutos, a veces días.'}
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
        <Button onClick={guardar} disabled={!listo || guardando}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          {editar ? 'Guardar cambios' : 'Enviar a revisión'}
        </Button>
      </div>
    </Modal>
  )
}

function EjemploVar({ etiqueta, valor, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-gray-500 w-32 shrink-0 truncate" title={etiqueta}>{etiqueta}</span>
      <Input value={valor} onChange={e => onChange(e.target.value)} placeholder="Ej: Toby" className="h-8" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Enviar({ p, campos, onCerrar }) {
  const { alert: showAlert } = useConfirm()
  const [contacto, setContacto] = useState('')
  const [valores, setValores] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [servicio, setServicio] = useState(null)
  const [aviso, setAviso] = useState(null)

  const huecos = huecosDePlantilla(p)
  const mapa = useMemo(() => {
    const m = {}
    for (const c of campos) m[c.clave] = c
    return m
  }, [campos])
  const [asignado, setAsignado] = useState({})

  useEffect(() => {
    variablesDePlantilla(p.name, p.language)
      .then(r => {
        const m = {}
        for (const v of r.variables || []) m[`${v.destino}:${v.param ?? v.posicion}`] = v.campo
        setAsignado(m)
      })
      .catch(() => {})
  }, [p.name, p.language])

  // Buscar por lo que la gente sí tiene a mano: el nombre de la mascota, el de
  // la familia o el código de fotos. Pegar un UUID no es una opción real.
  useEffect(() => {
    if (q.trim().length < 2) { setResultados([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await buscarServicios(q.trim())
        if (vivo) setResultados(r.servicios || [])
      } catch { /* la búsqueda no bloquea el envío manual */ }
      finally { if (vivo) setBuscando(false) }
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])

  async function tomar(s) {
    setServicio(s); setResultados([]); setQ(''); setAviso(null)
    try {
      const r = await valoresDeServicio(p.name, s.id, p.language)
      setValores(prev => ({ ...prev, ...Object.fromEntries(
        Object.entries(r.valores || {}).filter(([, v]) => v)) }))
      if (r.contacto) setContacto(r.contacto)
      if (!r.variables?.length) {
        setAviso('Esta plantilla todavía no tiene datos asignados: usa el botón "Datos" en su tarjeta y no habrá que escribir nada aquí.')
      } else if (r.sinAsignar?.length) {
        setAviso(`Ese servicio no tiene: ${r.sinAsignar.join(', ')}. Complétalo a mano.`)
      }
    } catch (e) {
      setAviso(e.message)
    }
  }

  const listo = contacto.replace(/\D/g, '').length >= 10
    && huecos.every(h => String(valores[h.clave] || '').trim())

  async function mandar() {
    setEnviando(true)
    try {
      await enviarPlantilla(p.name, {
        contacto: contacto.replace(/\D/g, ''), idioma: p.language,
        valores, servicioId: servicio?.id || null,
      })
      await showAlert('Enviada. Aparecerá en la bandeja de WhatsApp.', { title: 'Listo' })
      onCerrar()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo enviar' })
    } finally {
      setEnviando(false)
    }
  }

  // Los valores de la previa van por hueco, sin el destino: el cuerpo y el
  // título pueden usar el mismo nombre para el mismo dato.
  const previaValores = Object.fromEntries(
    Object.entries(valores).map(([k, v]) => [k.split(':')[1], v]))

  return (
    <Modal titulo={`Enviar "${p.name}"`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="space-y-4">
        <Campo etiqueta="¿De qué servicio salen los datos?"
               ayuda="Busca por mascota, familia o código de fotos. Los huecos con un dato asignado se rellenan solos.">
          {servicio ? (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50/60 border border-blue-100">
              <Database className="w-4 h-4 text-[#1A5CD8] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-gray-800 truncate">
                  {servicio.mascota || 'Sin mascota'} · {servicio.cliente || 'sin familia'}
                </p>
                <p className="text-[11px] text-gray-500 truncate">
                  {servicio.plan || 'sin plan'} · {servicio.estado}
                  {servicio.codigo_fotos && ` · ${servicio.codigo_fotos}`}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setServicio(null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} className="pl-9"
                     placeholder="Toby, Marta Gómez, AB12CD…" />
              {buscando && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
              {resultados.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                  {resultados.map(s => (
                    <button key={s.id} onClick={() => tomar(s)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0">
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
        </Campo>

        <Campo etiqueta="Número de destino" ayuda="Solo dígitos, con indicativo. Ej: 573001234567">
          <Input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="573001234567" />
        </Campo>

        {huecos.map(h => {
          const campo = mapa[asignado[h.clave]]
          return (
            <Campo key={h.clave}
                   etiqueta={`${h.destino === 'HEADER' ? 'Título' : h.destino === 'BUTTON' ? 'Enlace del botón' : 'Mensaje'} {{${h.hueco}}}`}
                   ayuda={campo ? `Sale de Orbit: ${campo.grupo} — ${campo.etiqueta}` : 'Sin dato asignado: se escribe a mano cada vez.'}>
              <Input value={valores[h.clave] || ''}
                     onChange={e => setValores(v => ({ ...v, [h.clave]: e.target.value }))} />
            </Campo>
          )
        })}

        <div>
          <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">Así le llegará</p>
          <VistaPrevia p={p} valores={previaValores} />
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

/**
 * Qué dato de Orbit rellena cada hueco.
 *
 * Es lo que convierte una plantilla en reutilizable de verdad: sin esto hay que
 * teclear el nombre de la mascota en cada envío, y de ahí a crear una plantilla
 * por mascota hay un paso — que es exactamente lo que pasó con las 251 de la
 * cuenta vieja.
 */
function Mapeo({ p, campos, onCerrar }) {
  const { alert: showAlert } = useConfirm()
  const [asignado, setAsignado] = useState({})
  const [cabecera, setCabecera] = useState(null)     // { material_id } | { url }
  const [materiales, setMateriales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const huecos = huecosDePlantilla(p)
  const cuerpo = componente(p, 'BODY')?.text || ''
  const cab = componente(p, 'HEADER')
  const cabMedia = cab && esMedia(cab.format)
  const grupos = useMemo(() => porGrupo(campos), [campos])
  const porClave = useMemo(() => Object.fromEntries(campos.map(c => [c.clave, c])), [campos])

  useEffect(() => {
    variablesDePlantilla(p.name, p.language)
      .then(r => {
        const m = {}
        for (const v of r.variables || []) m[`${v.destino}:${v.param ?? v.posicion}`] = v.campo
        setAsignado(m)
        setCabecera(r.cabecera || null)
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [p.name, p.language])

  useEffect(() => {
    if (!cabMedia) return
    cargarMateriales().then(r => setMateriales(r.materiales || [])).catch(() => {})
  }, [cabMedia])

  // Meta reclasifica de UTILITY a MARKETING cuando el texto habla de plata, y
  // MARKETING se cobra distinto. Vale la pena decirlo antes, no en la factura.
  const conDinero = Object.values(asignado).some(c => porClave[c]?.dinero)

  async function guardar() {
    setGuardando(true)
    try {
      const named = esNamed(p)
      const variables = Object.entries(asignado)
        .filter(([, campo]) => campo)
        .map(([k, campo]) => {
          const [destino, hueco] = k.split(':')
          return named ? { destino, param: hueco, campo } : { destino, posicion: Number(hueco), campo }
        })
      await guardarVariables(p.name, p.language, variables, cabMedia ? cabecera : undefined)
      onCerrar()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo guardar' })
    } finally {
      setGuardando(false)
    }
  }

  const fila = (h) => (
    <div key={h.clave} className="flex items-center gap-2">
      <span className="font-mono text-[12px] text-[#1A5CD8] w-32 shrink-0 truncate"
            title={`${h.destino} {{${h.hueco}}}`}>
        {h.destino === 'BUTTON' ? '🔗 ' : h.destino === 'HEADER' ? '▲ ' : ''}{`{{${h.hueco}}}`}
      </span>
      <select value={asignado[h.clave] || ''}
              onChange={e => setAsignado(a => ({ ...a, [h.clave]: e.target.value }))}
              className="flex-1 h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white">
        <option value="">— se escribe a mano al enviar —</option>
        {grupos.map(g => (
          <optgroup key={g.nombre} label={g.nombre}>
            {g.campos.map(c => <option key={c.clave} value={c.clave}>{c.etiqueta}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )

  const ejemploValores = Object.fromEntries(
    huecos.map(h => [h.hueco, porClave[asignado[h.clave]]?.ejemplo]).filter(([, v]) => v))

  return (
    <Modal titulo="Qué dato va en cada variable" onCerrar={onCerrar}>
      {cargando ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-[12.5px] text-gray-700 whitespace-pre-wrap">{cuerpo}</p>
          </div>

          <p className="text-[11.5px] text-gray-500">
            Asigna un dato de Orbit a cada hueco y al enviar se rellenan solos desde el
            servicio. Lo que dejes sin asignar habrá que escribirlo a mano cada vez.
          </p>

          <div className="space-y-2">{huecos.map(fila)}</div>

          {conDinero && (
            <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-900">
                Esta plantilla va a mencionar precios. <b>Meta suele reclasificar de Utilidad a
                Marketing</b> las que hablan de plata, y Marketing se cobra más y permite darse
                de baja. Ya pasó con una plantilla de esta cuenta.
              </p>
            </div>
          )}

          {cabMedia && (
            <div className="space-y-2 pt-1">
              <p className="text-[11.5px] font-semibold text-gray-600">
                Archivo del título ({CABECERAS.find(c => c.valor === cab.format)?.label})
              </p>
              <p className="text-[11px] text-gray-400">
                Meta obliga a mandar el archivo en cada envío: el que se usó para aprobarla solo
                sirvió para la revisión. Sin esto, la plantilla no se puede enviar.
              </p>
              <select value={cabecera?.material_id || ''}
                      onChange={e => setCabecera(e.target.value ? { material_id: Number(e.target.value) } : null)}
                      className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white">
                <option value="">— elige un material del catálogo —</option>
                {materiales.map(m => (
                  <option key={m.id} value={m.id}>{m.nombre} ({m.nombre_archivo})</option>
                ))}
              </select>
              {!materiales.length && (
                <p className="text-[11px] text-amber-700">
                  No hay materiales cargados todavía. Súbelos en Clientes → Materiales WA.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">Ejemplo con datos reales</p>
            <VistaPrevia p={p} valores={ejemploValores} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
        <Button onClick={guardar} disabled={guardando || cargando}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
          Guardar
        </Button>
      </div>
    </Modal>
  )
}

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
