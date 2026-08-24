import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Film, Image as ImageIcon, Layers3,
  Link2, Loader2, MessageSquareReply, Plus, Trash2, Upload,
} from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  CATEGORIAS, FORMATOS, IDIOMAS, crearPlantilla, editarPlantilla,
  guardarTarjetas, huecosDe, subirCabecera, tarjetasDe, conValores,
} from '@/lib/plantillasWa'
import { leerArchivo } from '@/lib/materialesApi'

const tarjetaVacia = () => ({
  texto: '', handle: '', material_id: null, archivo: null, preview: null, botones: [],
})

function inicial(original) {
  if (!original) {
    return {
      nombre: '', idioma: 'es_MX', categoria: 'MARKETING', formato: 'POSITIONAL',
      cuerpo: '', medio: 'IMAGE', tarjetas: [tarjetaVacia(), tarjetaVacia()],
    }
  }
  const cards = tarjetasDe(original)
  const medio = cards[0]?.components?.find(c => c.type === 'HEADER')?.format || 'IMAGE'
  return {
    nombre: original.name,
    idioma: original.language,
    categoria: original.category,
    formato: original.parameter_format === 'NAMED' ? 'NAMED' : 'POSITIONAL',
    cuerpo: original.components?.find(c => c.type === 'BODY')?.text || '',
    medio,
    tarjetas: cards.map(card => ({
      ...tarjetaVacia(),
      texto: card.components?.find(c => c.type === 'BODY')?.text || '',
      botones: (card.components?.find(c => c.type === 'BUTTONS')?.buttons || []).map(b => ({ ...b })),
    })),
  }
}

function ejemplosIniciales(original) {
  const out = {}
  if (!original) return out
  const named = original.parameter_format === 'NAMED'
  const tomar = (component, prefijo) => {
    const huecos = huecosDe(component?.text)
    if (named) {
      const lista = component?.example?.body_text_named_params || []
      lista.forEach(x => { out[`${prefijo}:${x.param_name}`] = x.example })
    } else {
      const lista = component?.example?.body_text?.[0] || []
      huecos.forEach((h, i) => { out[`${prefijo}:${h}`] = lista[i] || '' })
    }
  }
  tomar(original.components?.find(c => c.type === 'BODY'), 'BODY')
  tarjetasDe(original).forEach((card, i) => {
    tomar(card.components?.find(c => c.type === 'BODY'), `CARD:${i}:BODY`)
  })
  return out
}

export default function ConstructorCarrusel({ original = null, agenteId, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const [f, setF] = useState(() => inicial(original))
  const [ejemplos, setEjemplos] = useState(() => ejemplosIniciales(original))
  const [activa, setActiva] = useState(0)
  const [subiendo, setSubiendo] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const archivos = useRef([])
  const editar = !!original
  const named = f.formato === 'NAMED'

  const plantillaPrevia = useMemo(() => ({
    parameter_format: f.formato,
    components: [
      { type: 'BODY', text: f.cuerpo },
      {
        type: 'CAROUSEL',
        cards: f.tarjetas.map(t => ({ components: [
          { type: 'HEADER', format: f.medio },
          { type: 'BODY', text: t.texto },
          ...(t.botones.length ? [{ type: 'BUTTONS', buttons: t.botones }] : []),
        ] })),
      },
    ],
  }), [f])

  const set = (campo, valor) => { setF(x => ({ ...x, [campo]: valor })); setError(null) }
  const cambiarTarjeta = (i, campo, valor) => {
    setF(x => ({ ...x, tarjetas: x.tarjetas.map((t, j) => j === i ? { ...t, [campo]: valor } : t) }))
    setError(null)
  }

  async function elegirArchivo(e, i) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubiendo(i); setError(null)
    try {
      const base64 = await leerArchivo(file)
      const r = await subirCabecera({
        base64, mime: file.type, nombre: file.name, agenteId,
        plantilla: `${f.nombre || 'carrusel'}_tarjeta_${i + 1}`,
      })
      const preview = URL.createObjectURL(file)
      setF(x => ({
        ...x,
        tarjetas: x.tarjetas.map((t, j) => j === i ? {
          ...t, handle: r.handle, material_id: r.material_id,
          archivo: { nombre: file.name, mime: file.type }, preview,
        } : t),
      }))
      if (r.aviso) await showAlert(r.aviso, { title: 'Archivo subido con aviso' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubiendo(null)
    }
  }

  function agregarTarjeta() {
    if (f.tarjetas.length >= 10) return
    const estructura = f.tarjetas[0]?.botones || []
    set('tarjetas', [...f.tarjetas, {
      ...tarjetaVacia(),
      botones: estructura.map(b => ({ ...b, text: '', ...(b.type === 'URL' ? { url: 'https://' } : {}) })),
    }])
    setActiva(f.tarjetas.length)
  }

  function quitarTarjeta(i) {
    if (f.tarjetas.length <= 2) return
    set('tarjetas', f.tarjetas.filter((_, j) => j !== i))
    setActiva(a => Math.min(a, f.tarjetas.length - 2))
  }

  function moverTarjeta(i, delta) {
    const j = i + delta
    if (j < 0 || j >= f.tarjetas.length) return
    const copia = [...f.tarjetas]
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    set('tarjetas', copia); setActiva(j)
  }

  function agregarBoton(tipo) {
    if ((f.tarjetas[0]?.botones || []).length >= 2) return
    set('tarjetas', f.tarjetas.map(t => ({
      ...t,
      botones: [...t.botones, tipo === 'URL'
        ? { type: 'URL', text: 'Ver más', url: 'https://' }
        : { type: 'QUICK_REPLY', text: 'Me interesa' }],
    })))
  }

  function quitarBoton(buttonIndex) {
    set('tarjetas', f.tarjetas.map(t => ({
      ...t, botones: t.botones.filter((_, i) => i !== buttonIndex),
    })))
  }

  function cambiarBoton(cardIndex, buttonIndex, campo, valor) {
    set('tarjetas', f.tarjetas.map((t, i) => i !== cardIndex ? t : ({
      ...t, botones: t.botones.map((b, j) => j === buttonIndex ? { ...b, [campo]: valor } : b),
    })))
  }

  function cambiarMedio(medio) {
    if (medio === f.medio) return
    // El handle de revisión y el material guardado pertenecen al tipo de medio
    // que se subió. Conservarlos al pasar de imagen a video (o al revés) deja
    // un formulario aparentemente listo que Meta rechaza por formato.
    f.tarjetas.forEach(t => { if (t.preview) URL.revokeObjectURL(t.preview) })
    setF(x => ({
      ...x,
      medio,
      tarjetas: x.tarjetas.map(t => ({
        ...t, handle: '', material_id: null, archivo: null, preview: null,
      })),
    }))
    setError(null)
  }

  function ejemploDe(prefijo, texto) {
    const huecos = huecosDe(texto)
    if (!huecos.length) return undefined
    if (named) {
      return { body_text_named_params: huecos.map(h => ({
        param_name: h, example: ejemplos[`${prefijo}:${h}`] || '',
      })) }
    }
    return { body_text: [huecos.map(h => ejemplos[`${prefijo}:${h}`] || '')] }
  }

  function botonParaMeta(b) {
    if (b.type === 'URL') {
      return {
        type: 'URL', text: b.text.trim(), url: b.url.trim(),
        ...(huecosDe(b.url).length
          ? { example: [b.url.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, 'ejemplo')] }
          : {}),
      }
    }
    return { type: 'QUICK_REPLY', text: b.text.trim() }
  }

  const faltanEjemplos = [
    ...huecosDe(f.cuerpo).map(h => `BODY:${h}`),
    ...f.tarjetas.flatMap((t, i) => huecosDe(t.texto).map(h => `CARD:${i}:BODY:${h}`)),
  ].some(k => !String(ejemplos[k] || '').trim())
  const faltaArchivo = f.tarjetas.some(t => !t.handle || !t.material_id)
  const faltaContenido = f.tarjetas.some(t => !t.texto.trim()
    || t.botones.some(b => !b.text?.trim() || (b.type === 'URL' && !b.url?.trim())))
  const listo = f.nombre.trim() && f.cuerpo.trim() && f.tarjetas.length >= 2
    && !faltaArchivo && !faltaContenido && !faltanEjemplos

  async function guardar() {
    if (!listo) return
    setGuardando(true); setError(null)
    try {
      const componentes = [{
        type: 'BODY', text: f.cuerpo.trim(),
        ...(huecosDe(f.cuerpo).length ? { example: ejemploDe('BODY', f.cuerpo) } : {}),
      }, {
        type: 'CAROUSEL',
        cards: f.tarjetas.map((t, i) => ({ components: [
          { type: 'HEADER', format: f.medio, example: { header_handle: [t.handle] } },
          {
            type: 'BODY', text: t.texto.trim(),
            ...(huecosDe(t.texto).length
              ? { example: ejemploDe(`CARD:${i}:BODY`, t.texto) } : {}),
          },
          ...(t.botones.length
            ? [{ type: 'BUTTONS', buttons: t.botones.map(botonParaMeta) }] : []),
        ] })),
      }]

      const payload = {
        id: original?.id, nombre: f.nombre.trim(), idioma: f.idioma,
        categoria: f.categoria, formato: f.formato, componentes, agenteId,
      }
      const r = editar
        ? await editarPlantilla(f.nombre, payload)
        : await crearPlantilla(payload)

      await guardarTarjetas(f.nombre.trim(), f.idioma, agenteId, f.tarjetas.map((t, i) => ({
        card_index: i, material_id: t.material_id,
      })))
      if (r.aviso) await showAlert(r.aviso, { title: editar ? 'Carrusel editado' : 'Carrusel enviado a revisión' })
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const card = f.tarjetas[activa]
  const inputAccept = f.medio === 'VIDEO' ? 'video/mp4' : 'image/jpeg,image/png'

  return (
    <Modal open onClose={onClose} title={editar ? `Editar carrusel “${f.nombre}”` : 'Nuevo carrusel de WhatsApp'}
           maxWidth="max-w-6xl" footer={<>
      <p className="text-xs text-slate-600">
        {editar ? 'Al guardar vuelve a revisión de Meta.' : 'Se enviará a Meta para revisión.'}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={!listo || guardando || subiendo !== null}>
          {guardando ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {editar ? 'Guardar cambios' : 'Enviar a revisión'}
        </Button>
      </div>
    </>}>
      <div className="space-y-5">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 flex gap-3">
          <Layers3 className="w-5 h-5 text-[#1A5CD8] shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Una sola plantilla, varias tarjetas deslizables</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Cada tarjeta tiene su propio medio, texto y botones. Todas comparten el tipo de medio y la estructura de botones, como exige Meta.
            </p>
          </div>
        </div>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5 min-w-0">
            <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2">
              <Campo id="carrusel-nombre" label="Nombre" help="Minúsculas, números y guion bajo.">
                <Input id="carrusel-nombre" value={f.nombre} disabled={editar}
                       onChange={e => set('nombre', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                       placeholder="planes_veterinarias" />
              </Campo>
              <Campo id="carrusel-categoria" label="Categoría">
                <select id="carrusel-categoria" value={f.categoria} onChange={e => set('categoria', e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30">
                  {CATEGORIAS.filter(c => c.valor !== 'AUTHENTICATION').map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
                </select>
              </Campo>
              <Campo id="carrusel-idioma" label="Idioma">
                <select id="carrusel-idioma" value={f.idioma} disabled={editar} onChange={e => set('idioma', e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 disabled:bg-slate-50">
                  {IDIOMAS.map(x => <option key={x.valor} value={x.valor}>{x.label}</option>)}
                </select>
              </Campo>
              <Campo id="carrusel-formato" label="Variables">
                <select id="carrusel-formato" value={f.formato} disabled={editar} onChange={e => set('formato', e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 disabled:bg-slate-50">
                  {FORMATOS.map(x => <option key={x.valor} value={x.valor}>{x.label} · {x.ejemplo}</option>)}
                </select>
              </Campo>
              <Campo id="carrusel-cuerpo" label="Mensaje principal" help="Aparece encima de las tarjetas." className="sm:col-span-2">
                <Textarea id="carrusel-cuerpo" rows={4} value={f.cuerpo} onChange={e => set('cuerpo', e.target.value)}
                          placeholder={named ? 'Hola {{nombre}}, conoce nuestras opciones:' : 'Hola {{1}}, conoce nuestras opciones:'} />
                <Ejemplos prefijo="BODY" texto={f.cuerpo} valores={ejemplos} setValores={setEjemplos} />
              </Campo>
              <Campo id="carrusel-medio" label="Medio de las tarjetas" className="sm:col-span-2">
                <div className="grid grid-cols-2 gap-2">
                  {[["IMAGE", ImageIcon, 'Imagen'], ["VIDEO", Film, 'Video']].map(([valor, Icon, label]) => (
                    <button key={valor} type="button" onClick={() => cambiarMedio(valor)}
                            className={`min-h-11 cursor-pointer rounded-lg border px-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 ${f.medio === valor ? 'border-[#1A5CD8] bg-blue-50 text-[#1A5CD8]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      <Icon className="inline w-4 h-4 mr-2" />{label}
                    </button>
                  ))}
                </div>
              </Campo>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Tarjetas</h3>
                  <p className="text-xs text-slate-600 mt-1">Selecciona una para configurar exactamente lo que verá la persona.</p>
                </div>
                <Button variant="secondary" onClick={agregarTarjeta} disabled={f.tarjetas.length >= 10}>
                  <Plus size={15} /> Añadir tarjeta
                </Button>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Tarjetas del carrusel">
                {f.tarjetas.map((t, i) => (
                  <button key={i} type="button" role="tab" aria-selected={activa === i} onClick={() => setActiva(i)}
                          className={`min-h-11 min-w-28 cursor-pointer rounded-lg border px-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 ${activa === i ? 'border-[#1A5CD8] bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <span className="block text-xs font-semibold text-slate-800">Tarjeta {i + 1}</span>
                    <span className="block max-w-24 truncate text-[11px] text-slate-500">{t.texto || 'Sin texto'}</span>
                  </button>
                ))}
              </div>

              {card && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Tarjeta {activa + 1}</p>
                  <div className="flex gap-1">
                    <IconButton label="Mover a la izquierda" onClick={() => moverTarjeta(activa, -1)} disabled={activa === 0}><ArrowLeft size={16} /></IconButton>
                    <IconButton label="Mover a la derecha" onClick={() => moverTarjeta(activa, 1)} disabled={activa === f.tarjetas.length - 1}><ArrowRight size={16} /></IconButton>
                    <IconButton label="Eliminar tarjeta" onClick={() => quitarTarjeta(activa)} disabled={f.tarjetas.length <= 2} danger><Trash2 size={16} /></IconButton>
                  </div>
                </div>

                <Campo id={`archivo-tarjeta-${activa}`} label={f.medio === 'VIDEO' ? 'Video' : 'Imagen'} help="Se usa para revisión y queda guardado para cada envío.">
                  <input ref={el => { archivos.current[activa] = el }} id={`archivo-tarjeta-${activa}`} type="file" className="sr-only"
                         accept={inputAccept} onChange={e => elegirArchivo(e, activa)} />
                  <Button variant="secondary" onClick={() => archivos.current[activa]?.click()} disabled={subiendo === activa}>
                    {subiendo === activa ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {card.archivo ? 'Cambiar archivo' : 'Subir archivo'}
                  </Button>
                  {card.archivo && <p className="mt-2 text-xs font-medium text-emerald-700">{card.archivo.nombre}</p>}
                  {editar && !card.handle && <p className="mt-2 text-xs text-amber-700">Para editar una plantilla Meta exige volver a subir el archivo de cada tarjeta.</p>}
                </Campo>

                <Campo id={`texto-tarjeta-${activa}`} label="Texto de la tarjeta">
                  <Textarea id={`texto-tarjeta-${activa}`} rows={4} value={card.texto}
                            onChange={e => cambiarTarjeta(activa, 'texto', e.target.value)}
                            placeholder={named ? 'Plan {{plan}} · Desde {{precio}}' : 'Plan {{1}} · Desde {{2}}'} />
                  <Ejemplos prefijo={`CARD:${activa}:BODY`} texto={card.texto} valores={ejemplos} setValores={setEjemplos} />
                </Campo>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Botones y posición</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">Botón 1 aparece arriba de Botón 2. La estructura se replica en todas las tarjetas.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => agregarBoton('QUICK_REPLY')} disabled={card.botones.length >= 2}><MessageSquareReply size={14} /> Respuesta</Button>
                      <Button size="sm" variant="secondary" onClick={() => agregarBoton('URL')} disabled={card.botones.length >= 2}><Link2 size={14} /> Enlace</Button>
                    </div>
                  </div>
                  {card.botones.map((b, i) => <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">Botón {i + 1} · {b.type === 'URL' ? 'Enlace' : 'Respuesta rápida'}</p>
                      <IconButton label={`Quitar botón ${i + 1}`} onClick={() => quitarBoton(i)} danger><Trash2 size={15} /></IconButton>
                    </div>
                    <Input value={b.text || ''} onChange={e => cambiarBoton(activa, i, 'text', e.target.value)} placeholder="Texto del botón" />
                    {b.type === 'URL' && <Input value={b.url || ''} onChange={e => cambiarBoton(activa, i, 'url', e.target.value)} placeholder="https://sitio.com/{{1}}" />}
                  </div>)}
                </div>
              </div>}
            </section>
          </div>

          <aside className="lg:sticky lg:top-4 lg:self-start space-y-2 min-w-0">
            <p className="text-xs font-semibold text-slate-700">Así se verá en WhatsApp</p>
            <PreviaCarrusel plantilla={plantillaPrevia} tarjetas={f.tarjetas} ejemplos={ejemplos} />
            <p className="text-[11px] leading-relaxed text-slate-500">La persona desliza horizontalmente. Orbit enviará los archivos configurados en el mismo orden.</p>
          </aside>
        </div>
      </div>
    </Modal>
  )
}

function PreviaCarrusel({ plantilla, tarjetas, ejemplos }) {
  const cuerpo = plantilla.components.find(c => c.type === 'BODY')?.text || ''
  const valsTop = Object.fromEntries(huecosDe(cuerpo).map(h => [h, ejemplos[`BODY:${h}`]]))
  return <div className="overflow-hidden rounded-2xl bg-[#E7F3E9] p-3">
    <div className="mb-2 max-w-[92%] rounded-lg rounded-tl-sm bg-white p-3 text-sm text-slate-800 shadow-sm">
      {conValores(cuerpo, valsTop) || <span className="italic text-slate-400">Mensaje principal</span>}
    </div>
    <div className="flex snap-x gap-2 overflow-x-auto pb-2" aria-label="Vista previa de tarjetas">
      {tarjetas.map((t, i) => {
        const vals = Object.fromEntries(huecosDe(t.texto).map(h => [h, ejemplos[`CARD:${i}:BODY:${h}`]]))
        return <article key={i} className="w-56 shrink-0 snap-start overflow-hidden rounded-xl border border-white/70 bg-white shadow-sm">
          {t.preview ? (t.archivo?.mime?.startsWith('video/')
            ? <video src={t.preview} className="h-28 w-full object-cover" muted />
            : <img src={t.preview} alt={`Vista previa de la tarjeta ${i + 1}`} className="h-28 w-full object-cover" />)
            : <div className="grid h-28 place-items-center bg-slate-100 text-slate-400">{plantilla.components[1]?.cards?.[i]?.components?.[0]?.format === 'VIDEO' ? <Film /> : <ImageIcon />}</div>}
          <div className="p-3 text-xs leading-relaxed text-slate-700 min-h-16">{conValores(t.texto, vals) || 'Texto de la tarjeta'}</div>
          <div className="border-t border-slate-100">
            {t.botones.map((b, j) => <div key={j} className="border-b border-slate-100 px-2 py-2 text-center text-xs font-semibold text-[#0a7cff] last:border-0">
              {b.type === 'URL' ? <Link2 className="mr-1 inline h-3 w-3" /> : <MessageSquareReply className="mr-1 inline h-3 w-3" />}{b.text || `Botón ${j + 1}`}
            </div>)}
          </div>
        </article>
      })}
    </div>
  </div>
}

function Ejemplos({ prefijo, texto, valores, setValores }) {
  const huecos = huecosDe(texto)
  if (!huecos.length) return null
  return <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
    <p className="text-[11px] font-semibold text-[#1A5CD8]">Ejemplos para revisión de Meta</p>
    {huecos.map(h => <label key={h} className="grid gap-1 sm:grid-cols-[130px_1fr] sm:items-center">
      <span className="truncate font-mono text-[11px] text-slate-600">{`{{${h}}}`}</span>
      <Input value={valores[`${prefijo}:${h}`] || ''} onChange={e => setValores(v => ({ ...v, [`${prefijo}:${h}`]: e.target.value }))} placeholder="Ejemplo real" />
    </label>)}
  </div>
}

function Campo({ id, label, help, className = '', children }) {
  return <div className={className}>
    <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label>
    {children}
    {help && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{help}</p>}
  </div>
}

function IconButton({ label, onClick, disabled, danger = false, children }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
                 className={`grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A5CD8]/30 disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-100'}`}>
    {children}
  </button>
}
