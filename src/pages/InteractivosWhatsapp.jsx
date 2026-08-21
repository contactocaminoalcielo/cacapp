// Editor de mensajes interactivos de WhatsApp: botones, menús y botón de enlace.
//
// Existe para que añadir un menú nuevo NO sea tocar el código: el agente lee
// este catálogo y elige por clave, así que basta con crear el mensaje aquí y
// describirle bien cuándo usarlo.
//
// ⚠️ La `descripción` no es documentación: es lo que LEE EL AGENTE para decidir.
// Si está mal escrita, no lo usará nunca o lo usará donde no debe.
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Plus, Trash2, Save, Loader2, AlertTriangle, Check,
  Link2, List, SquareStack, Bot, Eye,
} from 'lucide-react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cargarInteractivos, guardarInteractivo, borrarInteractivo,
  TIPOS, TOPES, VARIABLES, contarFilas, nuevoInteractivo,
} from '@/lib/interactivosApi'

const ICONO = { BOTONES: SquareStack, LISTA: List, CTA_URL: Link2 }

/** Cómo lo verá la veterinaria. Vale más que cualquier explicación. */
function Vista({ m }) {
  const filas = m.tipo === 'LISTA' ? contarFilas(m.opciones) : 0
  return (
    <div className="rounded-2xl bg-[#F7F7F5] p-3">
      <div className="max-w-[280px] rounded-2xl rounded-bl-sm bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3">
          {m.encabezado && <p className="text-[12px] font-bold text-gray-900 mb-1">{m.encabezado}</p>}
          <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-snug">
            {m.cuerpo || <span className="text-gray-300">El texto del mensaje…</span>}
          </p>
          {m.pie && <p className="text-[10.5px] text-gray-400 mt-1.5">{m.pie}</p>}
        </div>

        {m.tipo === 'BOTONES' && (
          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {(m.opciones || []).map((o, i) => (
              <div key={i} className="px-3 py-2 text-center text-[12.5px] font-semibold text-[#1A5CD8]">
                {o.titulo || <span className="text-gray-300">botón</span>}
              </div>
            ))}
          </div>
        )}

        {m.tipo === 'LISTA' && (
          <div className="border-t border-gray-100 px-3 py-2 text-center text-[12.5px] font-semibold text-[#1A5CD8]">
            ☰ {m.boton_texto || 'Ver opciones'}
            <div className="text-[10px] font-normal text-gray-400 mt-0.5">{filas} opciones</div>
          </div>
        )}

        {m.tipo === 'CTA_URL' && (
          <div className="border-t border-gray-100 px-3 py-2 text-center text-[12.5px] font-semibold text-[#1A5CD8]">
            🔗 {m.boton_texto || 'Abrir'}
          </div>
        )}
      </div>
    </div>
  )
}

function Campo({ label, ayuda, tope, valor, children }) {
  const largo = String(valor ?? '').length
  const pasado = tope && largo > tope
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[12px] font-semibold text-neutral-700">{label}</label>
        {tope && (
          <span className={`text-[10px] ${pasado ? 'text-red-600 font-bold' : 'text-neutral-400'}`}>
            {largo}/{tope}
          </span>
        )}
      </div>
      <div className="mt-1">{children}</div>
      {ayuda && <p className="text-[11px] text-neutral-400 mt-1 leading-snug">{ayuda}</p>}
    </div>
  )
}

/**
 * `embebido`: la misma pantalla, montada como pestaña dentro de un agente.
 *
 * Se hace con una bandera en vez de partir el archivo en dos porque es
 * EXACTAMENTE la misma pantalla: lo único que sobra al incrustarla es la
 * cabecera de página y el margen exterior, que ya los pone quien la contiene.
 * Duplicar el componente para eso condena a arreglar cada bug dos veces.
 */
export default function InteractivosWhatsapp({ embebido = false }) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState(null)          // el que se está editando
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  const refrescar = useCallback(async () => {
    try {
      const r = await cargarInteractivos()
      setLista(r.interactivos || [])
      setError(null)
    } catch (e) { setError(e.message) } finally { setCargando(false) }
  }, [])

  useEffect(() => { refrescar() }, [refrescar])

  const editar = m => { setSel(JSON.parse(JSON.stringify(m))); setError(null); setOk(false) }
  const crear  = tipo => { setSel(nuevoInteractivo(tipo)); setError(null); setOk(false) }
  const set    = (k, v) => setSel(s => ({ ...s, [k]: v }))

  async function guardar() {
    setGuardando(true); setError(null)
    try {
      await guardarInteractivo(sel)
      setOk(true); setTimeout(() => setOk(false), 2500)
      await refrescar()
      setSel(null)
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  async function eliminar(m) {
    if (!window.confirm(`¿Eliminar "${m.nombre}"? El agente dejará de poder usarlo.`)) return
    try { await borrarInteractivo(m.id); await refrescar(); setSel(null) }
    catch (e) { setError(e.message) }
  }

  // ── Opciones (botones / filas del menú) ──
  const setOpciones = ops => set('opciones', ops)

  if (cargando) {
    return <div className="p-8 grid place-items-center text-neutral-400"><Loader2 className="animate-spin" /></div>
  }

  return (
    <>
      {!embebido && <Topbar />}
      <div className={embebido ? 'space-y-4' : 'p-4 sm:p-6 max-w-6xl mx-auto space-y-4'}>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 leading-snug">
            WhatsApp solo deja enviar botones y menús <strong>dentro de las 24 horas</strong> desde
            el último mensaje de la clínica. Fuera de esa ventana hace falta una plantilla aprobada.
          </p>
        </div>

        {error && (
          <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
        )}

        <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
          {/* ── Lista ── */}
          <section className="rounded-2xl border bg-white p-3 shadow-sm space-y-2">
            <div className="flex items-center gap-2 px-1">
              <MessageSquare size={15} className="text-neutral-400" />
              <h2 className="text-[13px] font-semibold text-neutral-800 flex-1">Catálogo</h2>
              <span className="text-[11px] text-neutral-400">{lista.length}</span>
            </div>

            <div className="space-y-1">
              {lista.map(m => {
                const Ico = ICONO[m.tipo] || MessageSquare
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
                      {m.usa_agente && <Bot size={12} className="text-emerald-600 shrink-0" title="El agente puede usarlo" />}
                    </div>
                    <p className="text-[10.5px] text-neutral-400 truncate mt-0.5">{m.clave}</p>
                  </button>
                )
              })}
              {!lista.length && <p className="text-[12px] text-neutral-400 px-2 py-3">Todavía no hay ninguno.</p>}
            </div>

            <div className="border-t pt-2 space-y-1">
              {Object.entries(TIPOS).map(([tipo, t]) => {
                const Ico = ICONO[tipo]
                return (
                  <button
                    key={tipo} type="button" onClick={() => crear(tipo)}
                    className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-neutral-600 hover:bg-neutral-50"
                  >
                    <Plus size={12} /> <Ico size={13} /> Nuevo: {t.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Editor ── */}
          <AnimatePresence mode="wait">
            {!sel ? (
              <motion.section key="vacio" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-2xl border bg-white p-8 shadow-sm text-center">
                <MessageSquare size={26} className="mx-auto text-neutral-300" />
                <p className="text-[13px] text-neutral-500 mt-3">
                  Elige uno del catálogo para editarlo, o crea uno nuevo.
                </p>
                <div className="mt-4 grid sm:grid-cols-3 gap-2 text-left">
                  {Object.entries(TIPOS).map(([tipo, t]) => (
                    <div key={tipo} className="rounded-xl border border-neutral-100 bg-neutral-50 p-3">
                      <p className="text-[12px] font-semibold text-neutral-700">{t.label}</p>
                      <p className="text-[11px] text-neutral-500 mt-1 leading-snug">{t.cuando}</p>
                    </div>
                  ))}
                </div>
              </motion.section>
            ) : (
              <motion.section key={sel.id || 'nuevo'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">

                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-semibold text-neutral-900 flex-1">
                    {sel.id ? 'Editar' : 'Nuevo'} · {TIPOS[sel.tipo].label}
                  </h2>
                  {sel.id && (
                    <Button variant="ghost" size="sm" onClick={() => eliminar(sel)}>
                      <Trash2 size={14} className="text-red-500" />
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setSel(null)}>Cancelar</Button>
                  <Button size="sm" onClick={guardar} disabled={guardando}>
                    {guardando ? <Loader2 size={14} className="animate-spin mr-1" />
                      : ok ? <Check size={14} className="mr-1" /> : <Save size={14} className="mr-1" />}
                    Guardar
                  </Button>
                </div>

                <p className="text-[11.5px] text-neutral-500 bg-neutral-50 rounded-xl px-3 py-2 leading-snug">
                  {TIPOS[sel.tipo].ayuda}
                </p>

                <div className="grid sm:grid-cols-2 gap-3">
                  <Campo label="Nombre" ayuda="Solo para ti, en esta lista.">
                    <Input value={sel.nombre} onChange={e => set('nombre', e.target.value)}
                      placeholder="Dónde se recoge" />
                  </Campo>
                  <Campo label="Clave" ayuda="Identificador interno. En MAYÚSCULAS y sin espacios.">
                    <Input value={sel.clave} onChange={e => set('clave', e.target.value.toUpperCase())}
                      placeholder="DONDE_RECOGER" disabled={!!sel.id} />
                  </Campo>
                </div>

                <Campo label="Cuándo debe usarlo el agente"
                  ayuda="⚠️ Esto NO es una nota para ti: es lo que el agente lee para decidir si este es el mensaje que toca. Sé concreto.">
                  <textarea rows={2} value={sel.descripcion || ''}
                    onChange={e => set('descripcion', e.target.value)}
                    placeholder="Úsalo cuando estés tomando los datos de una recogida y falte saber dónde se recoge."
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-y" />
                </Campo>

                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <Campo label="Encabezado (opcional)" tope={TOPES.encabezado} valor={sel.encabezado}>
                      <Input value={sel.encabezado || ''} onChange={e => set('encabezado', e.target.value)} />
                    </Campo>

                    <Campo label="Mensaje" tope={TOPES.cuerpo} valor={sel.cuerpo}>
                      <textarea rows={3} value={sel.cuerpo}
                        onChange={e => set('cuerpo', e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-y" />
                    </Campo>

                    <Campo label="Pie (opcional)" tope={TOPES.pie} valor={sel.pie}>
                      <Input value={sel.pie || ''} onChange={e => set('pie', e.target.value)} />
                    </Campo>

                    {sel.tipo !== 'BOTONES' && (
                      <Campo label={sel.tipo === 'LISTA' ? 'Rótulo del botón que abre el menú' : 'Rótulo del botón'}
                        tope={TOPES.boton} valor={sel.boton_texto}>
                        <Input value={sel.boton_texto || ''} onChange={e => set('boton_texto', e.target.value)}
                          placeholder={sel.tipo === 'LISTA' ? 'Ver planes' : 'Registrar servicio'} />
                      </Campo>
                    )}

                    {sel.tipo === 'CTA_URL' && (
                      <Campo label="Dirección"
                        ayuda={VARIABLES.map(v => `${v.clave} — ${v.ayuda}`).join(' · ')}>
                        <Input value={sel.url || ''} onChange={e => set('url', e.target.value)}
                          placeholder="{{enlace_registro}}" />
                      </Campo>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-700">
                      <Eye size={13} /> Así lo verá la clínica
                    </div>
                    <Vista m={sel} />

                    <label className="flex items-center gap-2 text-[12px] text-neutral-700">
                      <input type="checkbox" checked={sel.usa_agente !== false}
                        onChange={e => set('usa_agente', e.target.checked)} />
                      El agente puede mandarlo solo
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-neutral-700">
                      <input type="checkbox" checked={sel.activo !== false}
                        onChange={e => set('activo', e.target.checked)} />
                      Activo
                    </label>
                  </div>
                </div>

                {/* ── Opciones ── */}
                {sel.tipo === 'BOTONES' && (
                  <Opciones
                    titulo={`Botones (${(sel.opciones || []).length}/${TOPES.botones})`}
                    filas={sel.opciones || []}
                    tope={TOPES.botones}
                    topeTexto={TOPES.tituloBtn}
                    onChange={setOpciones}
                  />
                )}

                {sel.tipo === 'LISTA' && (
                  <Menu opciones={sel.opciones || []} onChange={setOpciones} />
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

/** Los botones de respuesta: lista plana con tope de 3. */
function Opciones({ titulo, filas, tope, topeTexto, onChange }) {
  const set = (i, k, v) => onChange(filas.map((f, j) => j === i ? { ...f, [k]: v } : f))
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold text-neutral-700">{titulo}</p>
      {filas.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={f.titulo || ''} onChange={e => set(i, 'titulo', e.target.value)}
            placeholder={`Texto del botón (máx. ${topeTexto})`} />
          <Input value={f.id || ''} onChange={e => set(i, 'id', e.target.value)}
            placeholder="id (opcional)" className="max-w-[140px]" />
          <button type="button" onClick={() => onChange(filas.filter((_, j) => j !== i))}
            className="text-neutral-300 hover:text-red-500"><Trash2 size={14} /></button>
        </div>
      ))}
      {filas.length < tope && (
        <Button variant="secondary" size="sm" onClick={() => onChange([...filas, { id: '', titulo: '' }])}>
          <Plus size={13} className="mr-1" /> Añadir botón
        </Button>
      )}
    </div>
  )
}

/** El menú: secciones con filas. Meta cuenta las filas en TOTAL, no por sección. */
function Menu({ opciones, onChange }) {
  const total = contarFilas(opciones)
  const lleno = total >= TOPES.filas

  const setSec = (i, v) => onChange(opciones.map((s, j) => j === i ? v : s))

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <p className="text-[12px] font-semibold text-neutral-700">Opciones del menú</p>
        <span className={`text-[10.5px] ${lleno ? 'text-red-600 font-bold' : 'text-neutral-400'}`}>
          {total}/{TOPES.filas} en total
        </span>
      </div>

      {opciones.map((sec, i) => (
        <div key={i} className="rounded-xl border border-neutral-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input value={sec.titulo || ''} onChange={e => setSec(i, { ...sec, titulo: e.target.value })}
              placeholder="Título de la sección" />
            <button type="button" onClick={() => onChange(opciones.filter((_, j) => j !== i))}
              className="text-neutral-300 hover:text-red-500"><Trash2 size={14} /></button>
          </div>

          {(sec.filas || []).map((f, k) => (
            <div key={k} className="flex items-center gap-2 pl-3">
              <Input value={f.titulo || ''} className="max-w-[200px]"
                onChange={e => setSec(i, { ...sec, filas: sec.filas.map((x, y) => y === k ? { ...x, titulo: e.target.value } : x) })}
                placeholder={`Opción (máx. ${TOPES.titulo})`} />
              <Input value={f.descripcion || ''}
                onChange={e => setSec(i, { ...sec, filas: sec.filas.map((x, y) => y === k ? { ...x, descripcion: e.target.value } : x) })}
                placeholder={`Detalle, opcional (máx. ${TOPES.desc})`} />
              <button type="button"
                onClick={() => setSec(i, { ...sec, filas: sec.filas.filter((_, y) => y !== k) })}
                className="text-neutral-300 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          ))}

          {!lleno && (
            <Button variant="ghost" size="sm"
              onClick={() => setSec(i, { ...sec, filas: [...(sec.filas || []), { id: '', titulo: '', descripcion: '' }] })}>
              <Plus size={12} className="mr-1" /> Añadir opción
            </Button>
          )}
        </div>
      ))}

      <Button variant="secondary" size="sm"
        onClick={() => onChange([...opciones, { titulo: '', filas: [] }])}>
        <Plus size={13} className="mr-1" /> Añadir sección
      </Button>
    </div>
  )
}
