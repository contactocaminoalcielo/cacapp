// Envíos masivos: mandar una plantilla a mucha gente (migración 104).
//
// 🩸 LA IDEA QUE MANDA SOBRE TODA ESTA PANTALLA: **esto no se puede deshacer.**
// Un error en un envío suelto es un mensaje raro a una clínica; el mismo error
// aquí son 203. Por eso el circuito va en dos tiempos:
//
//   1. Armar la campaña → se ve A CUÁNTOS y a QUIÉNES, y cómo les llegaría.
//      No se manda nada.
//   2. Empezar a enviar → un acto aparte, con el número por delante.
//
// Y por eso el freno de mano (Pausar) está siempre a un clic mientras envía:
// uno se da cuenta de que el texto está mal al décimo mensaje, no al primero.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  listarAudiencias, previsualizar, crearCampana, listarCampanas, verCampana,
  accionCampana, borrarCampana, ESTADOS_CAMPANA, ESTADOS_DESTINO, cuantoTarda,
} from '@/lib/campanasWa'
import { huecosDePlantilla, conValores, componente } from '@/lib/plantillasWa'
import {
  Plus, Loader2, Send, X, AlertTriangle, Users, Pause, Play, Ban, Trash2,
  RefreshCw, Eye, Megaphone, Check,
} from 'lucide-react'

export default function CampanasWa({ plantillas = [], abrirCon = null, onAbierto }) {
  const { alert: showAlert, confirm } = useConfirm()
  const [campanas, setCampanas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [viendo, setViendo] = useState(null)
  const [prefijada, setPrefijada] = useState(null)

  const aprobadas = useMemo(
    () => plantillas.filter(p => p.status === 'APPROVED'), [plantillas])

  const cargar = useCallback(async () => {
    try {
      const r = await listarCampanas()
      setCampanas(r.campanas || [])
    } catch { /* la lista no es crítica: se reintenta al siguiente refresco */ }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Mientras algo está enviando, la pantalla se refresca sola: ver la barra
  // avanzar es lo que dice que aquello sigue vivo.
  useEffect(() => {
    if (!campanas.some(c => c.estado === 'EN_CURSO')) return
    const t = setInterval(cargar, 8000)
    return () => clearInterval(t)
  }, [campanas, cargar])

  // Entrada desde la tarjeta de una plantilla ("Envío masivo").
  useEffect(() => {
    if (!abrirCon) return
    setPrefijada(abrirCon)
    setCreando(true)
    onAbierto?.()
  }, [abrirCon, onAbierto])

  async function accion(c, verbo, texto) {
    if (texto) {
      const ok = await confirm(texto, {
        title: verbo === 'iniciar' ? 'Empezar a enviar' : 'Confirmar',
        confirmText: verbo === 'iniciar' ? 'Empezar' : 'Sí',
        danger: verbo === 'cancelar',
      })
      if (!ok) return
    }
    try {
      await accionCampana(c.id, verbo)
      await cargar()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo' })
    }
  }

  async function quitar(c) {
    const ok = await confirm(`Se borrará "${c.nombre}". Todavía no ha enviado nada.`,
      { title: 'Borrar campaña', confirmText: 'Borrar', danger: true })
    if (!ok) return
    try { await borrarCampana(c.id); await cargar() }
    catch (e) { await showAlert(e.message, { title: 'No se pudo borrar' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[12px] text-gray-400 flex-1 min-w-[220px]">
          Mandar una plantilla a muchos a la vez. Se arma la lista, se mira a quiénes va, y
          solo entonces empieza. Se puede pausar en cualquier momento.
        </p>
        <Button variant="outline" onClick={cargar}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Actualizar
        </Button>
        <Button onClick={() => { setPrefijada(null); setCreando(true) }} disabled={!aprobadas.length}>
          <Plus className="w-4 h-4 mr-1.5" /> Nuevo envío masivo
        </Button>
      </div>

      {!aprobadas.length && (
        <div className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-900">
            No hay ninguna plantilla aprobada todavía. Meta solo deja enviar las aprobadas,
            así que primero hay que crear una y esperar su revisión.
          </p>
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !campanas.length ? (
        <div className="text-center py-16">
          <Megaphone className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-[13px] text-gray-500">Todavía no has hecho ningún envío masivo.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campanas.map(c => (
            <Ficha key={c.id} c={c} onVer={() => setViendo(c.id)} onBorrar={() => quitar(c)}
                   onAccion={accion} />
          ))}
        </div>
      )}

      {creando && (
        <Asistente plantillas={aprobadas} prefijada={prefijada}
                   onCerrar={() => setCreando(false)}
                   onCreada={async () => { setCreando(false); await cargar() }} />
      )}
      {viendo && <Detalle id={viendo} onCerrar={() => setViendo(null)} onCambio={cargar} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Ficha({ c, onVer, onBorrar, onAccion }) {
  const est = ESTADOS_CAMPANA[c.estado] || { label: c.estado, clase: 'bg-gray-100 text-gray-600' }
  const hechos = c.enviados + c.fallidos + c.omitidos
  const pct = c.total ? Math.round((hechos / c.total) * 100) : 0

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[13.5px] text-gray-800 truncate">{c.nombre}</p>
          <p className="text-[11px] text-gray-400">
            <span className="font-mono">{c.plantilla}</span> · {c.total} destinatario(s) · {c.por_hora}/hora
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold border shrink-0 ${est.clase}`}>
          {est.label}
        </span>
      </div>

      {c.pausa_motivo && (
        <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-amber-900">{c.pausa_motivo}</p>
        </div>
      )}

      <div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <motion.div className="h-full bg-[#1A5CD8]" initial={false}
                      animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]">
          <span className="text-emerald-600">{c.enviados} enviados</span>
          {c.fallidos > 0 && <span className="text-red-600">{c.fallidos} fallaron</span>}
          {c.omitidos > 0 && <span className="text-amber-600">{c.omitidos} saltados</span>}
          {c.pendientes > 0 && <span className="text-gray-400">{c.pendientes} en cola</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={onVer}>
          <Eye className="w-3.5 h-3.5 mr-1" /> Ver uno por uno
        </Button>

        {c.estado === 'BORRADOR' && (
          <Button size="sm" onClick={() => onAccion(c, 'iniciar',
            `Se le va a escribir por WhatsApp a ${c.total} destinatario(s), a ${c.por_hora} por hora `
            + `(${cuantoTarda(c.total, c.por_hora)}). Esto no se puede deshacer, aunque sí pausar.`)}>
            <Send className="w-3.5 h-3.5 mr-1" /> Empezar a enviar
          </Button>
        )}
        {c.estado === 'EN_CURSO' && (
          <Button size="sm" variant="outline" onClick={() => onAccion(c, 'pausar')}>
            <Pause className="w-3.5 h-3.5 mr-1" /> Pausar
          </Button>
        )}
        {c.estado === 'PAUSADA' && (
          <Button size="sm" onClick={() => onAccion(c, 'reanudar',
            `Quedan ${c.pendientes} por enviar. ¿Seguimos?`)}>
            <Play className="w-3.5 h-3.5 mr-1" /> Seguir
          </Button>
        )}
        {['EN_CURSO', 'PAUSADA'].includes(c.estado) && (
          <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-600"
                  onClick={() => onAccion(c, 'cancelar',
                    `Se detiene definitivamente. Los ${c.enviados} ya enviados no se pueden recuperar; `
                    + `los ${c.pendientes} en cola no se enviarán.`)}>
            <Ban className="w-3.5 h-3.5 mr-1" /> Cancelar
          </Button>
        )}
        {['BORRADOR', 'CANCELADA'].includes(c.estado) && (
          <Button size="sm" variant="ghost" className="ml-auto text-gray-400 hover:text-red-600"
                  onClick={onBorrar}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Asistente({ plantillas, prefijada, onCerrar, onCreada }) {
  const { alert: showAlert } = useConfirm()
  const [audiencias, setAudiencias] = useState([])
  const [f, setF] = useState({
    nombre: '', plantilla: prefijada || plantillas[0]?.name || '',
    audiencia: 'ALIADOS', filtros: {}, porHora: 200,
  })
  const [fijos, setFijos] = useState({})
  const [previa, setPrevia] = useState(null)
  const [mirando, setMirando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setPrevia(null) }

  useEffect(() => {
    listarAudiencias().then(r => setAudiencias(r.audiencias || [])).catch(() => {})
  }, [])

  const plantilla = plantillas.find(p => p.name === f.plantilla)
  const aud = audiencias.find(a => a.clave === f.audiencia)
  const huecos = plantilla ? huecosDePlantilla(plantilla) : []

  async function mirar() {
    setMirando(true)
    try {
      const r = await previsualizar({
        audiencia: f.audiencia, filtros: f.filtros,
        plantilla: f.plantilla, idioma: plantilla?.language,
      })
      setPrevia(r)
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo calcular' })
    } finally {
      setMirando(false)
    }
  }

  async function crear() {
    setGuardando(true)
    try {
      await crearCampana({
        nombre: f.nombre.trim(), plantilla: f.plantilla, idioma: plantilla?.language,
        audiencia: f.audiencia, filtros: f.filtros, valoresFijos: fijos,
        porHora: Number(f.porHora) || 200,
      })
      onCreada()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo crear' })
    } finally {
      setGuardando(false)
    }
  }

  // Los huecos que esta audiencia no puede rellenar sola. Se escriben una vez y
  // valen para todos: es lo que hace que una lista de números pegada sirva.
  const faltantes = previa?.huecosSinDato || []
  const listoParaCrear = f.nombre.trim() && f.plantilla && previa?.total > 0
    && faltantes.every(h => String(fijos[claveDe(huecos, h)] || '').trim())

  const valoresPrevia = {
    ...Object.fromEntries(Object.entries(fijos).map(([k, v]) => [k.split(':')[1], v])),
    ...Object.fromEntries(Object.entries(previa?.muestra?.[0]?.valores || {})
      .map(([k, v]) => [k.split(':')[1], v])),
  }

  return (
    <Modal titulo="Nuevo envío masivo" onCerrar={onCerrar} ancho="max-w-3xl">
      <div className="grid lg:grid-cols-[1fr_270px] gap-5">
        <div className="space-y-4">
          <Campo etiqueta="¿Cómo se llama este envío?"
                 ayuda="Solo para reconocerlo después. Nadie más lo ve.">
            <Input value={f.nombre} onChange={e => setF(p => ({ ...p, nombre: e.target.value }))}
                   placeholder="Aviso de la línea nueva a veterinarias" />
          </Campo>

          <Campo etiqueta="¿Qué plantilla?" ayuda="Solo aparecen las que Meta ya aprobó.">
            <select value={f.plantilla} onChange={e => set('plantilla', e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white">
              {plantillas.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </Campo>

          <Campo etiqueta="¿A quiénes?" ayuda={aud?.ayuda}>
            <select value={f.audiencia}
                    onChange={e => { setF(p => ({ ...p, audiencia: e.target.value, filtros: {} })); setPrevia(null) }}
                    className="w-full h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white">
              {audiencias.map(a => <option key={a.clave} value={a.clave}>{a.etiqueta}</option>)}
            </select>
          </Campo>

          {aud?.filtros?.map(fl => (
            <Campo key={fl.clave} etiqueta={fl.etiqueta} ayuda={fl.ayuda}>
              {fl.tipo === 'si_no' ? (
                <label className="flex items-center gap-2 text-[13px] text-gray-700">
                  <input type="checkbox" checked={!!f.filtros[fl.clave]}
                         onChange={e => { setF(p => ({ ...p, filtros: { ...p.filtros, [fl.clave]: e.target.checked } })); setPrevia(null) }} />
                  Sí
                </label>
              ) : fl.tipo === 'lista' ? (
                <Textarea rows={5} value={f.filtros[fl.clave] || ''}
                          placeholder={'573001234567\n3009876543'}
                          onChange={e => { setF(p => ({ ...p, filtros: { ...p.filtros, [fl.clave]: e.target.value } })); setPrevia(null) }} />
              ) : (
                <Input type={fl.tipo === 'numero' ? 'number' : 'text'} min={fl.tipo === 'numero' ? 1 : undefined}
                       className={fl.tipo === 'numero' ? 'w-32' : undefined}
                       value={f.filtros[fl.clave] || ''}
                       onChange={e => { setF(p => ({ ...p, filtros: { ...p.filtros, [fl.clave]: e.target.value } })); setPrevia(null) }} />
              )}
            </Campo>
          ))}

          <Button variant="outline" onClick={mirar} disabled={mirando || !f.plantilla}>
            {mirando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Users className="w-4 h-4 mr-1.5" />}
            Ver a quiénes le llegaría
          </Button>

          {previa && (
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
              <p className="text-[13px] font-semibold text-[#1A5CD8]">
                {previa.total} destinatario(s)
              </p>
              {previa.excluidos > 0 && (
                <p className="text-[11.5px] text-[#1A5CD8]/80">
                  Se saltaron {previa.excluidos} que pidieron no recibir masivos.
                </p>
              )}
              {previa.total === 0 && (
                <p className="text-[11.5px] text-red-600">
                  Con esos filtros no queda nadie. Revísalos antes de seguir.
                </p>
              )}
              {previa.muestra?.length > 0 && (
                <ul className="text-[11.5px] text-gray-600 space-y-0.5">
                  {previa.muestra.map(m => (
                    <li key={m.contacto} className="truncate">
                      · {m.nombre || m.contacto} <span className="text-gray-400 font-mono">{m.contacto}</span>
                    </li>
                  ))}
                  {previa.total > previa.muestra.length && (
                    <li className="text-gray-400">…y {previa.total - previa.muestra.length} más</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {previa && faltantes.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-900">
                  Esta audiencia no puede rellenar {faltantes.join(', ')} —{' '}
                  {f.audiencia === 'LISTA'
                    ? 'una lista de números no trae datos de Orbit.'
                    : 'esos datos están mapeados a un servicio, y aquí el destinatario no es una familia.'}
                  {' '}Escribe qué debe decir; será lo mismo para todos.
                </p>
              </div>
              {faltantes.map(h => {
                const clave = claveDe(huecos, h)
                return (
                  <div key={h} className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-amber-800 w-20 shrink-0">{h}</span>
                    <Input className="h-8" value={fijos[clave] || ''}
                           onChange={e => setFijos(v => ({ ...v, [clave]: e.target.value }))} />
                  </div>
                )
              })}
            </div>
          )}

          <Campo etiqueta="¿A qué ritmo?"
                 ayuda="Meta castiga las ráfagas: si mucha gente bloquea o reporta, baja la calidad de la línea. Con dudas, déjalo en 200.">
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={3600} className="w-28"
                     value={f.porHora} onChange={e => setF(p => ({ ...p, porHora: e.target.value }))} />
              <span className="text-[12.5px] text-gray-500">mensajes por hora</span>
            </div>
            {previa?.total > 0 && (
              <p className="text-[11.5px] text-gray-500 mt-1">
                Tardaría <b>{cuantoTarda(previa.total, Number(f.porHora) || 200)}</b> en llegar a todos.
              </p>
            )}
          </Campo>
        </div>

        <div className="space-y-2">
          <p className="text-[11.5px] font-semibold text-gray-500">Así les llegará</p>
          {plantilla
            ? <PrevisualizarMensaje p={plantilla} valores={valoresPrevia} />
            : <p className="text-[12px] text-gray-400">Elige una plantilla.</p>}
          <div className="flex gap-2 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
            <AlertTriangle className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-500">
              Al crear todavía <b>no se manda nada</b>: queda listo y hay que darle a
              "Empezar a enviar".
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
        <Button onClick={crear} disabled={!listoParaCrear || guardando}>
          {guardando ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
          Crear (sin enviar)
        </Button>
      </div>
    </Modal>
  )
}

/** De `{{1}}` o `{{mascota}}` a la clave con destino que usa el backend. */
function claveDe(huecos, marca) {
  const nombre = marca.replace(/[{}]/g, '')
  return huecos.find(h => h.hueco === nombre)?.clave || `BODY:${nombre}`
}

/** La burbuja de WhatsApp, con lo que se sabe hasta ahora. */
function PrevisualizarMensaje({ p, valores }) {
  const cuerpo = componente(p, 'BODY')?.text || ''
  const cab = componente(p, 'HEADER')
  const pie = componente(p, 'FOOTER')?.text
  const botones = componente(p, 'BUTTONS')?.buttons || []
  return (
    <div className="rounded-xl bg-[#E7F3E9] p-2.5 space-y-1.5">
      <div className="bg-white rounded-lg rounded-tl-sm p-2.5 shadow-sm space-y-1">
        {cab?.format === 'TEXT' && cab.text && (
          <p className="text-[12.5px] font-bold text-gray-800">{conValores(cab.text, valores)}</p>
        )}
        <p className="text-[12.5px] text-gray-800 whitespace-pre-wrap leading-snug">
          {conValores(cuerpo, valores)}
        </p>
        {pie && <p className="text-[10.5px] text-gray-400">{pie}</p>}
      </div>
      {botones.map((b, i) => (
        <div key={i} className="bg-white rounded-lg py-1.5 text-center text-[12px] font-semibold text-[#0a7cff] shadow-sm">
          {b.text || 'Copiar código'}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uno por uno.
 *
 * Existe para la pregunta que siempre llega después: "¿y a la clínica tal le
 * llegó?". Los que fallaron y los saltados salen primero — son los únicos sobre
 * los que hay que hacer algo.
 */
function Detalle({ id, onCerrar }) {
  const [datos, setDatos] = useState(null)
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    let vivo = true
    const traer = () => verCampana(id, filtro || undefined)
      .then(r => { if (vivo) setDatos(r) }).catch(() => {})
    traer()
    const t = setInterval(traer, 8000)
    return () => { vivo = false; clearInterval(t) }
  }, [id, filtro])

  const c = datos?.campana

  return (
    <Modal titulo={c?.nombre || 'Envío masivo'} onCerrar={onCerrar} ancho="max-w-2xl">
      {!datos ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {[['', `Todos (${c.total})`], ['ENVIADO', `Enviados (${c.enviados})`],
              ['FALLIDO', `Fallaron (${c.fallidos})`], ['OMITIDO', `Saltados (${c.omitidos})`],
              ['PENDIENTE', `En cola (${c.pendientes})`]].map(([v, txt]) => (
              <button key={v} onClick={() => setFiltro(v)}
                      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold border transition
                        ${filtro === v ? 'border-[#1A5CD8] bg-blue-50/60 text-[#1A5CD8]'
                                       : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                {txt}
              </button>
            ))}
          </div>

          <div className="max-h-[50vh] overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
            {!datos.destinos.length ? (
              <p className="text-[12.5px] text-gray-400 text-center py-8">Nada por aquí.</p>
            ) : datos.destinos.map(d => {
              const e = ESTADOS_DESTINO[d.estado] || { label: d.estado, clase: 'text-gray-400' }
              return (
                <div key={d.contacto} className="px-3 py-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-gray-800 truncate">
                      {d.nombre || <span className="font-mono">{d.contacto}</span>}
                    </p>
                    {d.nombre && <p className="text-[11px] text-gray-400 font-mono">{d.contacto}</p>}
                    {d.error && <p className="text-[11px] text-red-600 mt-0.5">{d.error}</p>}
                  </div>
                  <span className={`text-[11px] font-semibold shrink-0 ${e.clase}`}>{e.label}</span>
                </div>
              )
            })}
          </div>
          {datos.destinos.length >= 300 && (
            <p className="text-[11px] text-gray-400">
              Se muestran los primeros 300. Filtra por estado para ver el resto.
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end pt-4 mt-4 border-t border-gray-100">
        <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
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
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
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
