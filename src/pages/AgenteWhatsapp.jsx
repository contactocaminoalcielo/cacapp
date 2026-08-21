// Configuración del agente de WhatsApp de la línea de veterinarias.
//
// El agente es AISLADO: no consulta la operación (servicios, clientes, aliados).
// Todo lo que sabe sale de lo que se escribe aquí — el contexto y la base de
// conocimiento — y de nada más. Esta pantalla es su única fuente.
//
// Los datos NO vienen de Supabase: las tablas `agente_wa*` no están expuestas
// por PostgREST. Todo entra por orbit-backend con JWT + rol. Ver lib/agenteApi.js.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import ReglasYCorrecciones from '@/components/agente/ReglasYCorrecciones'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import MaterialesWhatsapp from '@/pages/MaterialesWhatsapp'
import InteractivosWhatsapp from '@/pages/InteractivosWhatsapp'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  cargarAgente, guardarAgente, agregarPieza, actualizarPieza, borrarPieza, archivoPieza,
  leerBase64, leerTexto, csvAMarkdown, tokensAprox, costoConversacion,
  cargarEjecuciones, vaciosDeConocimiento,
  TIPOS_KB, EFFORT_OPCIONES, MODELOS,
} from '@/lib/agenteApi'
import {
  Bot, Power, Save, Plus, Trash2, Eye, EyeOff, Loader2, AlertTriangle,
  FileText, Table2, Image as ImageIcon, FileType, Upload, BookOpen, Settings2, Check, ArrowLeft,
  History, HelpCircle, RefreshCw, User, MessageSquare, Scale,
} from 'lucide-react'

const ICONO_TIPO = { TEXTO: FileText, TABLA: Table2, IMAGEN: ImageIcon, DOCUMENTO: FileType }

export default function AgenteWhatsapp() {
  // El agente viene de la URL. Antes estaba fijo en 'VETERINARIAS' porque solo
  // había uno; van a llegar más líneas y cada una es una fila de `agente_wa`.
  const { clave = 'VETERINARIAS' } = useParams()

  const [pestana, setPestana]       = useState('cerebro')
  const [agente, setAgente]         = useState(null)
  const [kb, setKb]                 = useState([])
  const [resumen, setResumen]       = useState(null)
  const [cargando, setCargando]     = useState(true)
  const [error, setError]           = useState(null)

  const [instrucciones, setInstrucciones] = useState('')
  const [ajustes, setAjustes]             = useState(null)
  const [guardando, setGuardando]         = useState(false)
  const [guardado, setGuardado]           = useState(false)

  const [nueva, setNueva]           = useState(null)
  const [subiendo, setSubiendo]     = useState(false)
  const [errorPieza, setErrorPieza] = useState(null)
  const [previews, setPreviews]     = useState({})
  const fileRef = useRef(null)

  const [ejecuciones, setEjecuciones]   = useState([])
  const [cargandoBit, setCargandoBit]   = useState(false)
  const [verBitacora, setVerBitacora]   = useState(false)

  const refrescar = useCallback(async () => {
    try {
      const r = await cargarAgente(clave)
      setAgente(r.agente)
      setKb(r.conocimiento || [])
      setResumen(r.resumen || null)
      setInstrucciones(r.agente.instrucciones || '')
      setAjustes({
        modelo:           r.agente.modelo,
        effort:           r.agente.effort,
        max_turnos:       r.agente.max_turnos,
        phone_number_ids: (r.agente.phone_number_ids || []).join(', '),
        // Se muestran en SEGUNDOS: nadie piensa en milisegundos, y pedirlos así
        // invita a equivocarse por un factor de mil justo en el número que
        // decide si el agente interrumpe a media frase.
        espera_s:         Math.round((r.agente.espera_ms ?? 12000) / 1000),
        espera_max_s:     Math.round((r.agente.espera_max_ms ?? 30000) / 1000),
        seg_minutos:      r.agente.seguimiento_enlace_minutos ?? 15,
        seg_texto:        r.agente.seguimiento_enlace_texto || '',
      })
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [clave])

  useEffect(() => { refrescar() }, [refrescar])

  // La bitácora se pide aparte y solo cuando se abre: son hasta 200 conversaciones
  // con su texto completo y no tiene sentido cargarlas para ver los ajustes.
  const cargarBitacora = useCallback(async () => {
    if (!agente?.id) return
    setCargandoBit(true)
    try {
      const r = await cargarEjecuciones(agente.id, 200)
      setEjecuciones(r.ejecuciones || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setCargandoBit(false)
    }
  }, [agente?.id])

  useEffect(() => { if (verBitacora) cargarBitacora() }, [verBitacora, cargarBitacora])

  const vacios = useMemo(() => vaciosDeConocimiento(ejecuciones), [ejecuciones])

  const sucio = useMemo(() => {
    if (!agente || !ajustes) return false
    return instrucciones !== (agente.instrucciones || '')
      || ajustes.modelo !== agente.modelo
      || ajustes.effort !== agente.effort
      || Number(ajustes.max_turnos) !== agente.max_turnos
      || ajustes.phone_number_ids !== (agente.phone_number_ids || []).join(', ')
      || Number(ajustes.espera_s) * 1000 !== (agente.espera_ms ?? 12000)
      || Number(ajustes.espera_max_s) * 1000 !== (agente.espera_max_ms ?? 30000)
      || Number(ajustes.seg_minutos) !== (agente.seguimiento_enlace_minutos ?? 15)
      || ajustes.seg_texto !== (agente.seguimiento_enlace_texto || '')
  }, [agente, ajustes, instrucciones])

  const guardar = async () => {
    setGuardando(true); setError(null)
    try {
      const ids = ajustes.phone_number_ids.split(',').map(s => s.trim()).filter(Boolean)
      const r = await guardarAgente(agente.clave, {
        instrucciones,
        modelo:           ajustes.modelo,
        effort:           ajustes.effort,
        max_turnos:       Number(ajustes.max_turnos),
        phone_number_ids: ids,
        espera_ms:        Math.round(Number(ajustes.espera_s) * 1000),
        espera_max_ms:    Math.round(Number(ajustes.espera_max_s) * 1000),
        seguimiento_enlace_minutos: Number(ajustes.seg_minutos),
        seguimiento_enlace_texto:   ajustes.seg_texto,
      })
      setAgente(a => ({ ...a, ...r.agente }))
      setGuardado(true); setTimeout(() => setGuardado(false), 2500)
      refrescar()
    } catch (e) { setError(e.message) } finally { setGuardando(false) }
  }

  const alternarEncendido = async () => {
    const encender = !agente.activo
    if (encender && !(agente.phone_number_ids || []).length) {
      setError('Asigna al menos una línea antes de encenderlo, o no responderá a nadie.')
      return
    }
    try {
      const r = await guardarAgente(agente.clave, { activo: encender })
      setAgente(a => ({ ...a, ...r.agente }))
      setError(null)
    } catch (e) { setError(e.message) }
  }

  // ── Base de conocimiento ──

  const abrirNueva = (tipo) => { setNueva({ tipo, titulo: '', texto: '', archivo_base64: null, mime: null, nombreArchivo: null }); setErrorPieza(null) }

  const tomarArchivo = async (file) => {
    if (!file) return
    setErrorPieza(null)
    try {
      if (nueva.tipo === 'IMAGEN') {
        if (file.size > 5 * 1024 * 1024) {
          setErrorPieza(`Pesa ${(file.size / 1048576).toFixed(1)} MB y el tope son 5 MB. Recórtala antes de subirla.`)
          return
        }
        setNueva(n => ({
          ...n, archivo_base64: null, mime: file.type, nombreArchivo: file.name,
          titulo: n.titulo || file.name.replace(/\.[^.]+$/, ''),
        }))
        const b64 = await leerBase64(file)
        setNueva(n => ({ ...n, archivo_base64: b64 }))
      } else {
        const txt = await leerTexto(file)
        const esCsv = /\.csv$/i.test(file.name)
        setNueva(n => ({
          ...n,
          texto: esCsv ? csvAMarkdown(txt) : txt,
          nombreArchivo: file.name,
          titulo: n.titulo || file.name.replace(/\.[^.]+$/, ''),
        }))
      }
    } catch (e) { setErrorPieza(e.message) }
  }

  const guardarPieza = async () => {
    setSubiendo(true); setErrorPieza(null)
    try {
      await agregarPieza(agente.id, {
        tipo:  nueva.tipo,
        titulo: nueva.titulo,
        texto:  nueva.tipo === 'IMAGEN' ? undefined : nueva.texto,
        archivo_base64: nueva.tipo === 'IMAGEN' ? nueva.archivo_base64 : undefined,
        mime:   nueva.tipo === 'IMAGEN' ? nueva.mime : undefined,
      })
      setNueva(null)
      refrescar()
    } catch (e) { setErrorPieza(e.message) } finally { setSubiendo(false) }
  }

  const alternarPieza = async (p) => {
    try { await actualizarPieza(p.id, { activo: !p.activo }); refrescar() }
    catch (e) { setError(e.message) }
  }

  const eliminarPieza = async (p) => {
    if (!window.confirm(`¿Eliminar "${p.titulo}" de la base de conocimiento?`)) return
    try { await borrarPieza(p.id); refrescar() }
    catch (e) { setError(e.message) }
  }

  const verImagen = async (p) => {
    if (previews[p.id]) { setPreviews(v => ({ ...v, [p.id]: null })); return }
    try {
      const r = await archivoPieza(p.id)
      setPreviews(v => ({ ...v, [p.id]: `data:${r.mime};base64,${r.base64}` }))
    } catch (e) { setError(e.message) }
  }

  if (cargando) {
    return (
      <>
        <Topbar titulo="Agente de WhatsApp" />
        <div className="flex items-center justify-center py-24 text-neutral-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </>
    )
  }

  if (!agente) {
    return (
      <>
        <Topbar titulo="Agente de WhatsApp" />
        <div className="p-6"><Aviso tono="error">{error || 'No se pudo cargar el agente.'}</Aviso></div>
      </>
    )
  }

  const tokens = resumen ? tokensAprox(resumen) : 0

  return (
    <>
      <Topbar titulo="Agente de WhatsApp" />

      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        {error && <Aviso tono="error" onCerrar={() => setError(null)}>{error}</Aviso>}

        <Link
          to="/agentes"
          className="inline-flex items-center gap-1.5 text-[13px] text-neutral-500 hover:text-neutral-900 no-underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Todos los agentes
        </Link>

        {/* ── Estado ── */}
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-xl p-2.5 ${agente.activo ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-400'}`}>
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-neutral-900">{agente.nombre}</h2>
                <p className="text-sm text-neutral-500">
                  {agente.activo
                    ? 'Encendido: responde solo a las veterinarias en las líneas asignadas.'
                    : 'Apagado: no responde nada. La bandeja funciona con normalidad.'}
                </p>
              </div>
            </div>
            <Button
              onClick={alternarEncendido}
              className={agente.activo
                ? 'bg-neutral-900 hover:bg-neutral-800'
                : 'bg-emerald-600 hover:bg-emerald-700'}
            >
              <Power className="w-4 h-4 mr-2" />
              {agente.activo ? 'Apagar' : 'Encender'}
            </Button>
          </div>

          {agente.activo && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Está hablando con veterinarias reales. Lo que responda sale a nombre de Camino al
                Cielo — revisa la bitácora con frecuencia los primeros días.
              </span>
            </div>
          )}
        </motion.section>

        {/* Los precios de la base de conocimiento son texto congelado: si alguien
            cambia una tarifa en Configuración, el agente sigue cotizando la vieja
            a todas las veterinarias y nadie se entera hasta el reclamo. */}
        {resumen?.precios?.desfasados?.length > 0 && (
          <Aviso tono="error">
            <strong>Hay precios desactualizados en la base de conocimiento.</strong>{' '}
            {resumen.precios.desfasados.length === 1 ? 'Esta cifra ya no existe' : 'Estas cifras ya no existen'} en
            el catálogo:{' '}
            {resumen.precios.desfasados.map(n => `$${n.toLocaleString('es-CO')}`).join(', ')}.
            {' '}El agente se las está cotizando a las veterinarias — actualiza la pieza de tarifas.
          </Aviso>
        )}

        {/* ── Todo lo del agente, en pestañas ──
            Antes esto era una sola columna de siete tarjetas: había que bajar
            media pantalla para llegar a la bitácora, y los materiales y los
            botones vivían en OTRAS dos entradas del menú, sin nada que dijera
            que eran de este agente. Con más líneas por venir, esa forma no
            escalaba: cada agente nuevo habría sumado tres entradas más al menú. */}
        <Tabs value={pestana} onValueChange={setPestana} className="space-y-5">
          <TabsList className="flex-wrap">
            <TabsTrigger value="cerebro">Cerebro</TabsTrigger>
            <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
            <TabsTrigger value="reglas">Reglas</TabsTrigger>
            <TabsTrigger value="materiales">Materiales</TabsTrigger>
            <TabsTrigger value="interactivos">Botones y menús</TabsTrigger>
            <TabsTrigger value="bitacora">Bitácora</TabsTrigger>
          </TabsList>

          <TabsContent value="cerebro" className="space-y-6 mt-0">
          {/* ── Contexto ── */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
            <Cabecera icono={BookOpen} titulo="Contexto"
              sub="Quién es, cómo habla y qué puede o no puede decir. Es lo primero que lee en cada conversación." />
            <Textarea
              value={instrucciones}
              onChange={e => setInstrucciones(e.target.value)}
              rows={12}
              className="font-mono text-sm leading-relaxed"
              placeholder="Eres el asistente de WhatsApp de Camino al Cielo para veterinarias aliadas…"
            />
            <p className="text-xs text-neutral-500">
              {instrucciones.length.toLocaleString('es-CO')} caracteres. Sé concreto: el agente sigue
              estas instrucciones al pie de la letra y no sabe nada que no esté aquí o en la base de
              conocimiento.
            </p>
          </section>

          {/* ── Base de conocimiento ── */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
            <Cabecera icono={BookOpen} titulo="Base de conocimiento"
              sub="Lo que puede consultar para responder. Si no está aquí, no lo sabe." />

            <div className="flex flex-wrap gap-2">
              {Object.entries(TIPOS_KB).map(([tipo, meta]) => {
                const Icono = ICONO_TIPO[tipo]
                return (
                  <Button key={tipo} variant="outline" size="sm" onClick={() => abrirNueva(tipo)}>
                    <Icono className="w-4 h-4 mr-1.5" /><Plus className="w-3 h-3 mr-1" />{meta.label}
                  </Button>
                )
              })}
            </div>

            <AnimatePresence>
              {nueva && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                    <p className="text-sm font-medium text-neutral-800">
                      Nueva pieza — {TIPOS_KB[nueva.tipo].label}
                    </p>
                    <p className="text-xs text-neutral-500">{TIPOS_KB[nueva.tipo].ayuda}</p>

                    <Input
                      value={nueva.titulo}
                      onChange={e => setNueva(n => ({ ...n, titulo: e.target.value }))}
                      placeholder="Título (para que lo reconozcas después)"
                    />

                    {nueva.tipo === 'IMAGEN' ? (
                      <div className="space-y-2">
                        <input
                          ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          onChange={e => tomarArchivo(e.target.files?.[0])}
                        />
                        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                          <Upload className="w-4 h-4 mr-1.5" />
                          {nueva.nombreArchivo || 'Elegir imagen'}
                        </Button>
                        {nueva.archivo_base64 && (
                          <img
                            src={`data:${nueva.mime};base64,${nueva.archivo_base64}`}
                            alt="" className="max-h-48 rounded-lg border"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          ref={fileRef} type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                          className="hidden"
                          onChange={e => tomarArchivo(e.target.files?.[0])}
                        />
                        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                          <Upload className="w-4 h-4 mr-1.5" />
                          {nueva.nombreArchivo || 'Subir .txt / .md / .csv'}
                        </Button>
                        <Textarea
                          value={nueva.texto}
                          onChange={e => setNueva(n => ({ ...n, texto: e.target.value }))}
                          rows={8} className="font-mono text-xs"
                          placeholder="…o pega el contenido aquí"
                        />
                      </div>
                    )}

                    {errorPieza && <Aviso tono="error">{errorPieza}</Aviso>}

                    <div className="flex gap-2">
                      <Button size="sm" onClick={guardarPieza} disabled={subiendo}>
                        {subiendo ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
                        Agregar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setNueva(null)}>Cancelar</Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!kb.length ? (
              <p className="text-sm text-neutral-500 py-6 text-center">
                Todavía no hay nada cargado. El agente solo sabrá lo que digas en el contexto.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {kb.map(p => {
                  const Icono = ICONO_TIPO[p.tipo]
                  return (
                    <li key={p.id} className={`p-3 ${p.activo ? '' : 'bg-neutral-50'}`}>
                      <div className="flex items-start gap-3">
                        <Icono className={`w-4 h-4 mt-1 shrink-0 ${p.activo ? 'text-neutral-500' : 'text-neutral-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${p.activo ? 'text-neutral-900' : 'text-neutral-400'}`}>
                            {p.titulo}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {TIPOS_KB[p.tipo].label}
                            {p.tipo === 'IMAGEN'
                              ? ` · ${(p.bytes / 1024).toFixed(0)} kB`
                              : ` · ${(p.texto?.length || 0).toLocaleString('es-CO')} caracteres`}
                            {!p.activo && ' · desactivada'}
                          </p>
                          {previews[p.id] && (
                            <img src={previews[p.id]} alt="" className="mt-2 max-h-56 rounded-lg border" />
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {p.tipo === 'IMAGEN' && (
                            <Button variant="ghost" size="sm" onClick={() => verImagen(p)} title="Ver">
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => alternarPieza(p)}
                            title={p.activo ? 'Desactivar' : 'Activar'}>
                            {p.activo ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => eliminarPieza(p)} title="Eliminar">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {resumen && (
              <p className="text-xs text-neutral-500">
                Contexto activo: <strong>{resumen.piezas_activas}</strong> piezas ·{' '}
                <strong>{resumen.caracteres_texto.toLocaleString('es-CO')}</strong> caracteres ·{' '}
                <strong>{resumen.imagenes}</strong> imágenes · ≈{' '}
                <strong>{tokens.toLocaleString('es-CO')}</strong> tokens por conversación.
              </p>
            )}
          </section>

          </TabsContent>

          <TabsContent value="ajustes" className="space-y-6 mt-0">
          {/* ── Ajustes ── */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
            <Cabecera icono={Settings2} titulo="Ajustes" sub="Cómo y dónde trabaja." />

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Modelo" className="sm:col-span-2"
                ayuda={MODELOS.find(m => m.valor === ajustes.modelo)?.ayuda}>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODELOS.map(m => {
                    const elegido = ajustes.modelo === m.valor
                    const costo   = costoConversacion({ modelo: m.valor, contexto: tokens })
                    return (
                      <button
                        key={m.valor} type="button"
                        onClick={() => setAjustes(a => ({ ...a, modelo: m.valor }))}
                        className={`rounded-xl border p-3 text-left transition ${
                          elegido
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-200 hover:border-neutral-400'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{m.label}</span>
                        <span className={`block text-xs ${elegido ? 'text-neutral-300' : 'text-neutral-500'}`}>
                          ${m.entrada} / ${m.salida} por millón
                        </span>
                        <span className={`block text-xs mt-1 ${elegido ? 'text-white' : 'text-neutral-700'}`}>
                          ≈ {pesos(costo)} por conversación
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Estimado sobre 6 respuestas y el contexto actual ({tokens.toLocaleString('es-CO')} tokens).
                  Es una cuenta de servilleta: la bitácora guarda los tokens reales de cada conversación.
                </p>
              </Campo>

              <Campo label="Profundidad de razonamiento"
                ayuda={EFFORT_OPCIONES.find(o => o.valor === ajustes.effort)?.ayuda}>
                <select
                  value={ajustes.effort}
                  onChange={e => setAjustes(a => ({ ...a, effort: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                >
                  {EFFORT_OPCIONES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                </select>
              </Campo>

              <Campo label="Tope de respuestas por conversación"
                ayuda="Al superarlo deja de responder y la conversación queda para una persona.">
                <Input type="number" min={1} max={200} value={ajustes.max_turnos}
                  onChange={e => setAjustes(a => ({ ...a, max_turnos: e.target.value }))} />
              </Campo>

              <Campo label="Espera antes de responder (segundos)"
                ayuda="Las clínicas escriben de tres en tres. El agente aguarda este silencio para contestar UNA vez a todo. Corto interrumpe a media frase; largo parece abandono.">
                <Input type="number" min={0} max={120} value={ajustes.espera_s}
                  onChange={e => setAjustes(a => ({ ...a, espera_s: e.target.value }))} />
              </Campo>

              <Campo label="Espera máxima (segundos)"
                ayuda="Techo contado desde el primer mensaje sin responder. Sin él, quien escribe sin pausas no recibiría respuesta nunca. No puede ser menor que la espera.">
                <Input type="number" min={0} max={300} value={ajustes.espera_max_s}
                  onChange={e => setAjustes(a => ({ ...a, espera_max_s: e.target.value }))} />
              </Campo>

              <Campo label="Volver sobre el enlace (minutos)"
                ayuda="Si mandó el enlace de registro y nadie contestó, vuelve a preguntar una sola vez. 0 lo apaga. Se cancela solo si contestan, si llega la solicitud o si la toma una persona.">
                <Input type="number" min={0} max={1440} value={ajustes.seg_minutos}
                  onChange={e => setAjustes(a => ({ ...a, seg_minutos: e.target.value }))} />
              </Campo>

              <Campo label="Qué dice al volver" className="sm:col-span-2"
                ayuda="El mensaje exacto del recordatorio. Ofrecer tomar los datos por chat es lo que recupera el registro.">
                <textarea rows={2} value={ajustes.seg_texto}
                  onChange={e => setAjustes(a => ({ ...a, seg_texto: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm resize-y" />
              </Campo>

              <Campo label="Líneas donde responde" className="sm:col-span-2"
                ayuda="Identificadores de número de Meta, separados por coma. Vacío = no responde en ninguna.">
                <Input value={ajustes.phone_number_ids}
                  onChange={e => setAjustes(a => ({ ...a, phone_number_ids: e.target.value }))}
                  placeholder="805890339283619" />
              </Campo>
            </div>
          </section>

          </TabsContent>

          <TabsContent value="reglas" className="space-y-6 mt-0">
          {/* ── Correcciones y reglas (migración 099) ── */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
            <Cabecera icono={Scale} titulo="Correcciones y reglas"
              sub="Lo que marcas en el chat llega aquí. Tú decides qué se convierte en norma para el agente." />
            <ReglasYCorrecciones agenteId={agente.id} onCambio={refrescar} />
          </section>

          </TabsContent>

          {/* ⚠️ Materiales y botones son catálogos GLOBALES todavía, no por
              agente: la tabla no tiene columna `agente_id`. Se muestran aquí
              porque es donde se buscan, pero cuando llegue la segunda línea
              habrá que separarlos o las dos compartirán brochure y menús. */}
          <TabsContent value="materiales" className="mt-0">
            <MaterialesWhatsapp embebido />
          </TabsContent>

          <TabsContent value="interactivos" className="mt-0">
            <InteractivosWhatsapp embebido />
          </TabsContent>

          <TabsContent value="bitacora" className="space-y-6 mt-0">
          {/* ── Bitácora ── */}
          <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <Cabecera icono={History} titulo="Lo que ha respondido"
                sub="Cada conversación que atendió, con lo que le preguntaron y lo que contestó. Es donde se ve si está haciendo bien el trabajo." />
              <div className="flex items-center gap-2 shrink-0">
                {verBitacora && (
                  <button onClick={cargarBitacora} title="Actualizar"
                    className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer">
                    <RefreshCw className={`w-4 h-4 ${cargandoBit ? 'animate-spin' : ''}`} />
                  </button>
                )}
                <Button variant="secondary" onClick={() => setVerBitacora(v => !v)}>
                  {verBitacora ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                  {verBitacora ? 'Ocultar' : 'Ver'}
                </Button>
              </div>
            </div>

            {verBitacora && (cargandoBit && !ejecuciones.length ? (
              <p className="text-sm text-neutral-400 flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
              </p>
            ) : !ejecuciones.length ? (
              <p className="text-sm text-neutral-500 py-4">
                Todavía no ha respondido nada. Aparecerá aquí en cuanto atienda su primera conversación.
              </p>
            ) : (
              <>
                {/* Lo que no supo: es la razón de ser de esta pantalla */}
                <div className={`rounded-xl border p-4 ${vacios.length ? 'border-orange-200 bg-orange-50' : 'border-neutral-200 bg-neutral-50'}`}>
                  <div className="flex items-start gap-2.5">
                    <HelpCircle className={`w-5 h-5 shrink-0 mt-0.5 ${vacios.length ? 'text-orange-600' : 'text-neutral-400'}`} />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-neutral-900 text-sm">
                        Lo que no supo responder{vacios.length > 0 && ` · ${vacios.length}`}
                      </h4>
                      {vacios.length === 0 ? (
                        <p className="text-sm text-neutral-500 mt-1">
                          Nada pendiente: respondió todo con lo que tiene cargado.
                        </p>
                      ) : (
                        <>
                          <p className="text-[13px] text-neutral-600 mt-1 mb-3">
                            Preguntas reales que tuvo que pasar a una persona. Escribe la respuesta
                            arriba, en la base de conocimiento, y deja de escalarlas.
                          </p>
                          <ul className="space-y-2">
                            {vacios.map(v => (
                              <li key={v.id} className="rounded-lg bg-white border border-orange-200 px-3 py-2">
                                <p className="text-sm text-neutral-900">{v.pregunta}</p>
                                <p className="text-[11px] text-neutral-400 mt-0.5">
                                  {v.contacto} · {new Date(v.cuando).toLocaleString('es-CO')}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {ejecuciones.map(e => <Ejecucion key={e.id} e={e} />)}
                </div>
              </>
            ))}
          </section>

          </TabsContent>
        </Tabs>

        {/* ── Guardar ── */}
        <div className="sticky bottom-4 flex justify-end">
          <AnimatePresence>
            {(sucio || guardado) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              >
                <Button onClick={guardar} disabled={guardando || !sucio}
                  className="shadow-lg bg-neutral-900 hover:bg-neutral-800">
                  {guardando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : guardado ? <Check className="w-4 h-4 mr-2" />
                    : <Save className="w-4 h-4 mr-2" />}
                  {guardado ? 'Guardado' : 'Guardar cambios'}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

// Anthropic factura en dólares; el peso es solo para dar magnitud, por eso la
// tasa es aproximada y se muestran las dos cifras en vez de esconder la de USD.
const TRM_APROX = 4000

function pesos(usd) {
  const cop = Math.round(usd * TRM_APROX)
  return `US$${usd.toFixed(3)} · ${cop.toLocaleString('es-CO')} COP`
}

/** Una conversación de la bitácora: qué le dijeron, qué respondió y qué hizo. */
function Ejecucion({ e }) {
  const etiquetas = e.herramientas?.etiquetas || []
  const fallo = !!e.error
  return (
    <div className={`rounded-xl border p-3.5 ${fallo ? 'border-red-200 bg-red-50' : 'border-neutral-200'}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[11px] text-neutral-400 flex items-center gap-1.5">
          <User className="w-3 h-3" />
          {e.origen === 'PRUEBA' ? 'Prueba desde esta pantalla' : e.contacto}
          {' · '}{new Date(e.creado_en).toLocaleString('es-CO')}
        </span>
        <span className="text-[11px] text-neutral-400 shrink-0">
          {(e.tokens_entrada || 0).toLocaleString('es-CO')} tokens
        </span>
      </div>

      {e.entrada && (
        <p className="text-sm text-neutral-600 mb-2 pl-3 border-l-2 border-neutral-200 whitespace-pre-wrap">
          {e.entrada}
        </p>
      )}

      {fallo ? (
        <p className="text-sm text-red-700 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>No pudo responder: {e.error}</span>
        </p>
      ) : (
        <p className="text-sm text-neutral-900 whitespace-pre-wrap">{e.salida || '—'}</p>
      )}

      {(etiquetas.length > 0 || (e.herramientas?.usadas || []).length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {etiquetas.map((x, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600 text-[10px] font-semibold">
              {x.clave}
            </span>
          ))}
          {(e.herramientas?.usadas || []).map((u, i) => (
            <span key={`u${i}`} className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5" />{u}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Piezas de presentación ──

function Cabecera({ icono: Icono, titulo, sub }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icono className="w-5 h-5 text-neutral-400 mt-0.5 shrink-0" />
      <div>
        <h3 className="font-semibold text-neutral-900">{titulo}</h3>
        <p className="text-sm text-neutral-500">{sub}</p>
      </div>
    </div>
  )
}

function Campo({ label, ayuda, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      {children}
      {ayuda && <p className="mt-1 text-xs text-neutral-500">{ayuda}</p>}
    </div>
  )
}

function Aviso({ tono = 'error', children, onCerrar }) {
  const estilos = tono === 'error'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900'
  return (
    <div className={`rounded-xl border p-3 text-sm flex gap-2 ${estilos}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1">{children}</span>
      {onCerrar && (
        <button onClick={onCerrar} className="text-xs underline shrink-0">cerrar</button>
      )}
    </div>
  )
}
