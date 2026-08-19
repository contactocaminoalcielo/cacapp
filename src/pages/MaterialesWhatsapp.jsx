// Materiales que se mandan por WhatsApp: brochure, tarifario, instructivos.
//
// Existe porque el 14-ago una veterinaria pidió el brochure y el agente no tenía
// forma de mandárselo: lo escaló, y acabó saliendo a mano por la otra línea. Es
// la petición más fácil de toda la línea —un archivo que ya existe— y era la
// única que no podía resolver.
//
// ⚠️ La `descripción` no es documentación: es lo que LEE EL AGENTE para decidir
// si este es el archivo que le están pidiendo. Si está mal escrita, no lo mandará
// nunca o lo mandará donde no debe.
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Plus, Trash2, Save, Loader2, AlertTriangle, Check, Bot,
  Upload, Eye, Image as ImageIcon, Film,
} from 'lucide-react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cargarMateriales, guardarMaterial, borrarMaterial, archivoMaterial,
  leerArchivo, comoLlega, pesoLegible, nuevoMaterial, MAX_BYTES, MAX_MB, TOPE_POR_CLASE,
} from '@/lib/materialesApi'

const ICONO = { imagen: ImageIcon, video: Film, documento: FileText }

export default function MaterialesWhatsapp() {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)
  const fileRef = useRef(null)

  const refrescar = useCallback(async () => {
    try {
      const r = await cargarMateriales()
      setLista(r.materiales || [])
      setError(null)
    } catch (e) { setError(e.message) } finally { setCargando(false) }
  }, [])

  useEffect(() => { refrescar() }, [refrescar])

  const editar = m => { setSel({ ...m, base64: null }); setError(null); setOk(false) }
  const crear  = () => { setSel(nuevoMaterial()); setError(null); setOk(false) }
  const set    = (k, v) => setSel(s => ({ ...s, [k]: v }))

  async function elegirArchivo(e) {
    const file = e.target.files?.[0]
    e.target.value = ''            // que volver a elegir el mismo archivo dispare el change
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError(`"${file.name}" pesa ${pesoLegible(file.size)} y el tope son ${MAX_MB} MB.`)
      return
    }
    // El tope que de verdad manda es el del TIPO: una imagen son 5 MB, no 64.
    // Se avisa al elegirla y no cuando la clínica se quede esperando.
    const { clase } = comoLlega(file.type)
    const topeClase = TOPE_POR_CLASE[clase]
    if (topeClase && file.size > topeClase * 1048576) {
      setError(`"${file.name}" pesa ${pesoLegible(file.size)} y WhatsApp solo admite ${topeClase} MB en `
        + `${clase === 'imagen' ? 'una imagen' : 'un ' + clase}. `
        + (clase === 'imagen' ? 'Redúcela, o guárdala como PDF y llegará como documento.' : 'Redúcelo antes de subirlo.'))
      return
    }
    setError(null)
    try {
      const base64 = await leerArchivo(file)
      setSel(s => ({
        ...s,
        base64, mime: file.type || 'application/octet-stream', bytes: file.size,
        // Se rellenan solo si están vacíos: al reemplazar el archivo de uno que
        // ya existe, el nombre que ve la clínica no debe cambiar sin querer.
        nombre_archivo: s.nombre_archivo || file.name,
        nombre: s.nombre || file.name.replace(/\.[^.]+$/, ''),
      }))
    } catch (err) { setError(err.message) }
  }

  async function ver(m) {
    try {
      const blob = await archivoMaterial(m.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Se suelta con holgura: revocarlo al momento deja la pestaña en blanco.
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { setError(e.message) }
  }

  async function guardar() {
    if (!sel.id && !sel.base64) { setError('Elige el archivo que quieres poder mandar.'); return }
    setGuardando(true); setError(null)
    try {
      await guardarMaterial(sel)
      setOk(true); setTimeout(() => setOk(false), 2500)
      await refrescar()
      setSel(null)
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  async function eliminar(m) {
    if (!window.confirm(`¿Eliminar "${m.nombre}"? El agente dejará de poder mandarlo.`)) return
    try { await borrarMaterial(m.id); await refrescar(); setSel(null) }
    catch (e) { setError(e.message) }
  }

  if (cargando) {
    return <div className="p-8 grid place-items-center text-neutral-400"><Loader2 className="animate-spin" /></div>
  }

  const llega = sel?.mime ? comoLlega(sel.mime) : null

  return (
    <>
      <Topbar titulo="Materiales de WhatsApp" />
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 leading-snug">
            Los archivos solo salen <strong>dentro de las 24 horas</strong> desde el último mensaje
            de la clínica, como todo lo que no es plantilla. Y ojo con lo que subes:
            el agente puede mandarlo <strong>solo</strong>, sin que nadie lo revise antes.
          </p>
        </div>

        {error && (
          <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
        )}

        <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
          {/* ── Catálogo ── */}
          <section className="rounded-2xl border bg-white p-3 shadow-sm space-y-2">
            <div className="flex items-center gap-2 px-1">
              <FileText size={15} className="text-neutral-400" />
              <h2 className="text-[13px] font-semibold text-neutral-800 flex-1">Catálogo</h2>
              <span className="text-[11px] text-neutral-400">{lista.length}</span>
            </div>

            <div className="space-y-1">
              {lista.map(m => {
                const Ico = ICONO[comoLlega(m.mime).clase] || FileText
                return (
                  <button
                    key={m.id} type="button" onClick={() => editar(m)}
                    className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${
                      sel?.id === m.id ? 'border-[#3D5A27] bg-[#F0F7EB]' : 'border-transparent hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Ico size={13} className="text-neutral-400 shrink-0" />
                      <span className={`text-[12.5px] font-semibold truncate flex-1 ${m.activo ? 'text-neutral-800' : 'text-neutral-400 line-through'}`}>
                        {m.nombre}
                      </span>
                      {m.usa_agente && <Bot size={12} className="text-emerald-600 shrink-0" title="El agente puede mandarlo" />}
                    </div>
                    <p className="text-[10.5px] text-neutral-400 truncate mt-0.5">
                      {m.clave} · {pesoLegible(m.bytes)}
                    </p>
                  </button>
                )
              })}
              {!lista.length && (
                <p className="text-[12px] text-neutral-400 px-2 py-3 leading-snug">
                  Todavía no hay ninguno. Mientras esté vacío, el agente no ofrece mandar archivos.
                </p>
              )}
            </div>

            <div className="border-t pt-2">
              <button type="button" onClick={crear}
                className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-neutral-600 hover:bg-neutral-50">
                <Plus size={12} /> Nuevo material
              </button>
            </div>
          </section>

          {/* ── Editor ── */}
          <AnimatePresence mode="wait">
            {!sel ? (
              <motion.section key="vacio" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-2xl border bg-white p-8 shadow-sm text-center">
                <FileText size={26} className="mx-auto text-neutral-300" />
                <p className="text-[13px] text-neutral-500 mt-3 max-w-md mx-auto leading-snug">
                  Sube aquí el brochure, el tarifario o cualquier archivo que las clínicas pidan.
                  El agente lo manda él mismo cuando se lo piden, en vez de escalarlo.
                </p>
              </motion.section>
            ) : (
              <motion.section key={sel.id || 'nuevo'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">

                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-semibold text-neutral-900 flex-1">
                    {sel.id ? 'Editar material' : 'Nuevo material'}
                  </h2>
                  {sel.id && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => ver(sel)} title="Ver el archivo">
                        <Eye size={14} className="text-neutral-500" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => eliminar(sel)}>
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setSel(null)}>Cancelar</Button>
                  <Button size="sm" onClick={guardar} disabled={guardando}>
                    {guardando ? <Loader2 size={14} className="animate-spin mr-1" />
                      : ok ? <Check size={14} className="mr-1" /> : <Save size={14} className="mr-1" />}
                    Guardar
                  </Button>
                </div>

                {/* ── El archivo ── */}
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-neutral-800 truncate">
                      {sel.nombre_archivo || <span className="text-neutral-400">Ningún archivo elegido</span>}
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      {sel.bytes ? pesoLegible(sel.bytes) : '—'}
                      {llega && <> · llega como <strong>{llega.clase}</strong></>}
                      {sel.base64 && <span className="text-amber-700"> · sin guardar</span>}
                    </p>
                  </div>
                  <input ref={fileRef} type="file" className="hidden" onChange={elegirArchivo} />
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload size={13} className="mr-1" /> {sel.id ? 'Reemplazar' : 'Elegir archivo'}
                  </Button>
                </div>

                {llega?.aviso && (
                  <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-snug">
                    {llega.aviso}
                  </p>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-semibold text-neutral-700">Nombre</label>
                    <Input className="mt-1" value={sel.nombre} onChange={e => set('nombre', e.target.value)}
                      placeholder="Brochure de planes" />
                    <p className="text-[11px] text-neutral-400 mt-1">Solo para ti, en esta lista.</p>
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-neutral-700">Clave</label>
                    <Input className="mt-1" value={sel.clave} onChange={e => set('clave', e.target.value.toUpperCase())}
                      placeholder="BROCHURE" disabled={!!sel.id} />
                    <p className="text-[11px] text-neutral-400 mt-1">Identificador interno, sin espacios.</p>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-semibold text-neutral-700">Cuándo debe mandarlo el agente</label>
                  <textarea rows={2} value={sel.descripcion || ''}
                    onChange={e => set('descripcion', e.target.value)}
                    placeholder="El folleto con los planes y qué incluye cada uno. Mándalo cuando la clínica pida el brochure o material para enseñárselo a una familia."
                    className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-y" />
                  <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                    ⚠️ Esto no es una nota para ti: es lo que el agente lee para decidir. Sé concreto.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[12px] font-semibold text-neutral-700">Nombre del archivo</label>
                    <Input className="mt-1" value={sel.nombre_archivo || ''}
                      onChange={e => set('nombre_archivo', e.target.value)}
                      placeholder="Brochure Camino al Cielo.pdf" />
                    <p className="text-[11px] text-neutral-400 mt-1">Es el título que ve la clínica en WhatsApp.</p>
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-neutral-700">Pie (opcional)</label>
                    <Input className="mt-1" value={sel.pie || ''} onChange={e => set('pie', e.target.value)}
                      placeholder="Aquí tienes el brochure con todos los planes." />
                    <p className="text-[11px] text-neutral-400 mt-1">El texto que acompaña al archivo, siempre el mismo.</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1 border-t">
                  <label className="flex items-center gap-2 text-[12px] text-neutral-700 pt-3">
                    <input type="checkbox" checked={sel.usa_agente !== false}
                      onChange={e => set('usa_agente', e.target.checked)} />
                    El agente puede mandarlo solo
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-neutral-700 pt-3">
                    <input type="checkbox" checked={sel.activo !== false}
                      onChange={e => set('activo', e.target.checked)} />
                    Activo
                  </label>
                  <div className="flex items-center gap-2 text-[12px] text-neutral-700 pt-3">
                    Orden
                    <Input type="number" className="w-20" value={sel.orden ?? 0}
                      onChange={e => set('orden', Number(e.target.value))} />
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
