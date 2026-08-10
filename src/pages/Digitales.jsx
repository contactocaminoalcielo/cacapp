import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { TableWrap, Table, Th, Td } from '@/components/ui/table'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  Film, Sparkles, CheckCircle2, RefreshCw, Download, Instagram, Youtube,
  Loader2, AlertTriangle, X, Crop, Link2, Send, Copy, MessageCircle, History, Search,
  Eye, PawPrint, Phone, Ban,
} from 'lucide-react'
import { esAliadoVip, VipStar } from '@/components/servicio/VipAliado'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

const ESTADO = {
  PENDIENTE:  { label: 'Pendiente',    variant: 'gray' },
  GENERANDO:  { label: 'Generando…',   variant: 'gray' },
  GENERADO:   { label: 'Generado',     variant: 'blue' },
  APROBADO:   { label: 'Aprobado',     variant: 'purple' },
  PUBLICANDO: { label: 'Publicando…',  variant: 'amber' },
  PUBLICADO:  { label: 'Publicado',    variant: 'green' },
  ERROR:      { label: 'Error',        variant: 'red' },
  DESCARTADO: { label: 'Descartado',   variant: 'gray' },
}

const TIPO_LABEL = { MEMORIAL: 'Memorial', VIDEO: 'Video conmemorativo', SHORT: 'Short' }
const TIPO_CORTO = { MEMORIAL: 'Memorial', VIDEO: 'Video', SHORT: 'Short' }
const TIPOS = ['MEMORIAL', 'VIDEO', 'SHORT']

// Pieza activa de un tipo (ignora descartadas)
const piezaDe = (s, tipo) => s.piezas.find(p => p.tipo === tipo && p.estado !== 'DESCARTADO')

// Tipos que este servicio maneja: los del plan + cualquier pieza ya creada
const tiposDe = (s) => TIPOS.filter(t => s.esperadas.includes(t) || piezaDe(s, t))

// Digitales que el cliente declinó en el portal de imágenes ("no deseo este
// recordatorio"). No se generan ni se envían — solo se informan, para que no
// parezca que el pipeline los olvidó. Si por lo que sea ya existe la pieza, manda
// la pieza (aparece en tiposDe) y no se duplica el aviso.
const declinadasDe = (s) => (s.declinadas || []).filter(t => !piezaDe(s, t))

const publicadas = (s) => s.piezas.filter(p => p.estado === 'PUBLICADO' && p.url_publica)

const listoParaEnviar = (s) => {
  const tipos = tiposDe(s)
  return tipos.length > 0 && tipos.every(t => {
    const p = piezaDe(s, t)
    return p && p.estado === 'PUBLICADO' && p.url_publica
  })
}

function normalizarTel(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10 && d.startsWith('3')) return `57${d}`
  return d.length >= 10 ? d : null
}

// ¿Ya hubo un envío exitoso? Los intentos fallidos de Zolutium (estado ERROR)
// no cuentan como enviado — el servicio sigue en "Para enviar".
const fueEnviado = (s) => s.envios.some(e => (e.estado || 'ENVIADO') === 'ENVIADO')
const envioExitoso = (s) => s.envios.find(e => (e.estado || 'ENVIADO') === 'ENVIADO')
const ultimoError = (s) => (s.envios[0]?.estado === 'ERROR' ? s.envios[0] : null)

// Lo que el PLAN lleva: piezas vivas + las que el cliente declinó. La declinada
// no se produce, pero el plan no cambió — y la plantilla la nombra igual, con un
// texto en vez del enlace.
const tiposDelPlan = (s) => TIPOS.filter(t => tiposDe(s).includes(t) || (s.declinadas || []).includes(t))

// Plantilla Zolutium aplicable según lo que lleva el plan:
// 3 digitales → plantilla completa · solo memorial → plantilla de memorial ·
// cualquier otra combinación → sin plantilla (envío manual).
function plantillaAplicable(s, zolutium) {
  if (!zolutium?.activo) return null
  if (!tiposDe(s).length) return null   // todo declinado: no hay nada que enviar
  const tipos = tiposDelPlan(s)
  if (tipos.length === 3) return zolutium.plantilla_completos
  if (tipos.length === 1 && tipos[0] === 'MEMORIAL') return zolutium.plantilla_memorial
  return null
}

// ¿Alguna pieza del servicio quedó en error (render o Instagram)?
const conError = (s) => s.piezas.some(p => p.estado === 'ERROR' || (p.error && p.estado !== 'DESCARTADO'))

// Tipos que aún no tienen enlace publicado
const piezasFaltantes = (s) => tiposDe(s).filter(t => {
  const p = piezaDe(s, t)
  return !(p && p.estado === 'PUBLICADO' && p.url_publica)
})

const matchTexto = (q, ...campos) => {
  const n = q.trim().toLowerCase()
  if (!n) return true
  // Si la búsqueda trae dígitos, comparar también solo-dígitos: así "3123456789"
  // encuentra teléfonos guardados como "+57 312 345 6789" o "312-3456789".
  const dq = n.replace(/\D/g, '')
  return campos.some(c => {
    const s = String(c || '').toLowerCase()
    if (s.includes(n)) return true
    return dq.length >= 3 && s.replace(/\D/g, '').includes(dq)
  })
}

function buildMensaje(plantilla, s) {
  const links = publicadas(s).map(p => `• ${TIPO_LABEL[p.tipo] || p.tipo}: ${p.url_publica}`).join('\n')
  const base = plantilla || 'Hola 💛 Te compartimos los recuerdos digitales de {mascota}:\n\n{enlaces}\n\nCamino al Cielo 🕊️'
  return base.replaceAll('{mascota}', s.mascota || '').replaceAll('{enlaces}', links)
}

function estadoServicio(s) {
  if (conError(s)) return { label: 'Con error', variant: 'red' }
  if (fueEnviado(s)) return { label: 'Enviado', variant: 'green' }
  // Todo lo que llevaba lo declinó el cliente: no hay nada que producir.
  if (!tiposDe(s).length && declinadasDe(s).length) return { label: 'No lo desea el cliente', variant: 'gray' }
  if (listoParaEnviar(s)) return { label: 'Listo para enviar', variant: 'green' }
  if (s.piezas.some(p => ['GENERANDO', 'PUBLICANDO'].includes(p.estado))) {
    return { label: 'En proceso', variant: 'amber' }
  }
  return { label: 'Con pendientes', variant: 'gray' }
}

function progresoServicio(s) {
  const tipos = tiposDe(s)
  const hechas = tipos.filter(t => {
    const p = piezaDe(s, t)
    return p && p.estado === 'PUBLICADO' && p.url_publica
  }).length
  return { hechas, total: tipos.length }
}

export default function Digitales() {
  const [tab, setTab] = useState('pipeline')
  const [formato, setFormato] = useState('1080x1350')
  const [candidatos, setCandidatos] = useState([])
  const [data, setData] = useState({ servicios: [], ig_configurado: false, plantillas: {}, zolutium: {} })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({})            // clave → true mientras hace una acción
  const [msg, setMsg] = useState(null)            // {tipo:'ok'|'err', texto}
  const [enlaces, setEnlaces] = useState({})      // `${servicioId}:${tipo}` → url en edición
  const [manual, setManual] = useState({})        // piezaId → url manual en edición
  const [mensajes, setMensajes] = useState({})    // servicioId → mensaje editado
  const [tels, setTels] = useState({})            // servicioId → teléfono editado
  const [encuadre, setEncuadre] = useState(null)  // {servicioId, fotoUrl, mascota, ajuste}
  const [detalleId, setDetalleId] = useState(null) // servicio abierto desde la tabla
  const [q, setQ] = useState('')                  // buscador (todas las pestañas)
  const [fEstado, setFEstado] = useState('TODOS') // filtro Pipeline: estado del servicio
  const [fPieza, setFPieza] = useState('TODAS')   // filtro Pipeline: pieza faltante
  const pollRef = useRef(null)
  const { confirm } = useConfirm()

  const flash = (tipo, texto) => { setMsg({ tipo, texto }); setTimeout(() => setMsg(null), 4500) }
  const setBusyKey = (k, v) => setBusy(b => ({ ...b, [k]: v }))

  const cargar = useCallback(async () => {
    try {
      const [cand, dig] = await Promise.all([
        orbitApi('/digitales/candidatos'),
        orbitApi('/digitales/servicios'),
      ])
      setCandidatos(cand || [])
      setData(dig || { servicios: [], ig_configurado: false, plantillas: {}, zolutium: {} })
    } catch (e) {
      flash('err', e.message || 'No se pudo cargar')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Poll mientras haya renders o publicaciones de Instagram en curso
  useEffect(() => {
    const enCurso = data.servicios.some(s => s.piezas.some(p => ['GENERANDO', 'PUBLICANDO'].includes(p.estado)))
    clearInterval(pollRef.current)
    if (enCurso) pollRef.current = setInterval(cargar, 5000)
    return () => clearInterval(pollRef.current)
  }, [data, cargar])

  const accion = async (key, fn, okTexto) => {
    setBusyKey(key, true)
    try {
      await fn()
      if (okTexto) flash('ok', okTexto)
      await cargar()
    } catch (e) { flash('err', e.message) }
    finally { setBusyKey(key, false) }
  }

  const generar = (servicioId, ajuste) => accion(servicioId, async () => {
    await orbitApi('/digitales/generar', { method: 'POST', body: { servicio_id: servicioId, formato, ajuste } })
    setEncuadre(null)
    setTab('pipeline')
  }, 'Generando el memorial… tarda unos segundos.')

  const aprobar = (id) => accion(id, () => orbitApi(`/digitales/${id}/aprobar`, { method: 'POST' }))
  const descartar = (id) => accion(id, () => orbitApi(`/digitales/${id}/descartar`, { method: 'POST' }))

  const publicarIG = (id) => accion(id, () =>
    orbitApi(`/digitales/${id}/publicar-instagram`, { method: 'POST' }),
    'Publicando en Instagram… el enlace se registrará solo.')

  const publicarManual = (id) => {
    const url = (manual[id] || '').trim()
    if (!/^https?:\/\//i.test(url)) return flash('err', 'Pega un enlace válido (https://…)')
    accion(id, () => orbitApi(`/digitales/${id}/publicar`, { method: 'POST', body: { url } }), 'Enlace registrado.')
  }

  const guardarEnlace = (servicioId, tipo) => {
    const url = (enlaces[`${servicioId}:${tipo}`] || '').trim()
    if (!url) return flash('err', 'Pega el enlace de YouTube primero.')
    accion(`${servicioId}:${tipo}`, () =>
      orbitApi('/digitales/enlace', { method: 'POST', body: { servicio_id: servicioId, tipo, url } }),
      `${TIPO_LABEL[tipo]} registrado.`)
  }

  // Envío automático por Zolutium: el backend manda la plantilla aprobada y
  // registra la evidencia (message_id) + marca ENTREGADO, todo en una operación.
  const enviarAuto = async (s) => {
    const tel = tels[s.servicio_id] ?? (s.telefono || '')
    if (!normalizarTel(tel)) return flash('err', 'No hay un teléfono válido para WhatsApp.')
    const plantilla = plantillaAplicable(s, data.zolutium)
    const noPedidas = (s.declinadas || []).filter(t => !tiposDe(s).includes(t))
    const ok = await confirm(
      `Se enviará la plantilla «${plantilla}» por WhatsApp al ${tel} con los enlaces de ${s.mascota}.` +
      (noPedidas.length
        ? ` ${noPedidas.map(t => TIPO_CORTO[t]).join(' y ')} no lo pidió el cliente: en su lugar irá una nota, no un enlace.`
        : ''),
      { title: 'Enviar digitales al cliente', variant: 'success', confirmLabel: 'Enviar' }
    )
    if (!ok) return
    accion(`envio:${s.servicio_id}`, () =>
      orbitApi(`/digitales/${s.servicio_id}/enviar-zolutium`, { method: 'POST', body: { telefono: tel } }),
      'Enviado por WhatsApp — los digitales quedaron como entregados.')
  }

  const registrarEnvio = (s, abrirWhatsApp) => {
    const texto = mensajes[s.servicio_id] ?? buildMensaje(data.plantillas.mensaje_cliente, s)
    const tel = tels[s.servicio_id] ?? (s.telefono || '')
    const num = normalizarTel(tel)
    if (abrirWhatsApp) {
      if (!num) return flash('err', 'No hay un teléfono válido para WhatsApp.')
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
    }
    accion(`envio:${s.servicio_id}`, () =>
      orbitApi(`/digitales/${s.servicio_id}/envio`, { method: 'POST', body: { telefono: tel, mensaje: texto } }),
      'Envío registrado — los digitales quedaron como entregados.')
  }

  const copiarMensaje = async (s) => {
    const texto = mensajes[s.servicio_id] ?? buildMensaje(data.plantillas.mensaje_cliente, s)
    try { await navigator.clipboard.writeText(texto); flash('ok', 'Mensaje copiado al portapapeles.') }
    catch { flash('err', 'No se pudo copiar.') }
  }

  const copiarEnlaces = async () => {
    const filas = data.servicios.flatMap(s => publicadas(s).map(p => `${s.mascota} — ${TIPO_LABEL[p.tipo]}: ${p.url_publica}`))
    if (!filas.length) return flash('err', 'No hay piezas publicadas con enlace.')
    try {
      await navigator.clipboard.writeText(filas.join('\n'))
      flash('ok', `${filas.length} enlace${filas.length > 1 ? 's' : ''} copiado${filas.length > 1 ? 's' : ''}.`)
    } catch { flash('err', 'No se pudo copiar al portapapeles.') }
  }

  const videoUrl = (p) => p?.archivo_url ? `${API_BASE}${p.archivo_url}` : null

  const buscados = useMemo(() =>
    data.servicios.filter(s => matchTexto(q, s.mascota, s.propietario, s.plan_nombre, s.plan_codigo, s.telefono)), [data, q])

  const pipeline = useMemo(() => buscados.filter(s => {
    const enviado = fueEnviado(s)
    if (fEstado === 'PENDIENTES' && (enviado || listoParaEnviar(s))) return false
    if (fEstado === 'LISTOS'     && !(listoParaEnviar(s) && !enviado)) return false
    if (fEstado === 'ENVIADOS'   && !enviado) return false
    if (fEstado === 'ERROR'      && !conError(s)) return false
    if (fPieza !== 'TODAS' && !piezasFaltantes(s).includes(fPieza)) return false
    return true
  }), [buscados, fEstado, fPieza])

  const nEstado = useMemo(() => ({
    TODOS:      buscados.length,
    PENDIENTES: buscados.filter(s => !fueEnviado(s) && !listoParaEnviar(s)).length,
    LISTOS:     buscados.filter(s => !fueEnviado(s) && listoParaEnviar(s)).length,
    ENVIADOS:   buscados.filter(fueEnviado).length,
    ERROR:      buscados.filter(conError).length,
  }), [buscados])

  const listos = useMemo(() => buscados.filter(s => listoParaEnviar(s) && !fueEnviado(s)), [buscados])
  const enviados = useMemo(() =>
    buscados.flatMap(s => s.envios.map(e => ({ ...e, mascota: s.mascota, propietario: s.propietario, telefono: e.telefono || s.telefono }))), [buscados])
  const candidatosFiltrados = useMemo(() =>
    candidatos.filter(c => matchTexto(q, c.mascota, c.propietario, c.plan_nombre, c.plan_codigo, c.telefono)), [candidatos, q])
  // Los que el cliente declinó siguen a la vista, pero aparte: no se generan.
  const porGenerar = useMemo(() => candidatosFiltrados.filter(c => !c.memorial_declinado), [candidatosFiltrados])
  const declinados = useMemo(() => candidatosFiltrados.filter(c => c.memorial_declinado), [candidatosFiltrados])
  const servicioDetalle = useMemo(() =>
    data.servicios.find(s => s.servicio_id === detalleId) || null, [data.servicios, detalleId])

  const tabs = [
    ['pipeline', `Pipeline (${pipeline.length})`],
    ['enviar', `Para enviar (${listos.length})`],
    ['enviados', `Enviados (${enviados.length})`],
    ['candidatos', `Por generar (${porGenerar.length})`],
  ]

  return (
    <>
      <Topbar />

      <div className="p-4 sm:p-6 max-w-6xl mx-auto w-full">
        {msg && (
          <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
            msg.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {msg.tipo === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {msg.texto}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                  tab === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {['pipeline', 'candidatos'].includes(tab) && (
              <>
                <span className="text-[12px] text-gray-400 font-medium">Formato al generar:</span>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                  {[['1080x1350', 'Feed 4:5'], ['1080x1920', 'Reels 9:16']].map(([k, label]) => (
                    <button key={k} onClick={() => setFormato(k)}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
                        formato === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === 'pipeline' && (
              <Button variant="secondary" size="sm" onClick={copiarEnlaces}>
                <Link2 size={14} /> Copiar enlaces
              </Button>
            )}
          </div>
        </div>

        {/* Buscador + filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <Input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar mascota, propietario, plan o teléfono…"
              className="pl-9 text-[13px]"
            />
            {q && (
              <button onClick={() => setQ('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={14} />
              </button>
            )}
          </div>

          {tab === 'pipeline' && (
            <>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
                {[['TODOS', 'Todos'], ['PENDIENTES', 'Con pendientes'], ['LISTOS', 'Listos p/ enviar'],
                  ['ENVIADOS', 'Enviados'], ['ERROR', 'Con error']].map(([k, label]) => (
                  <button key={k} onClick={() => setFEstado(k)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition ${
                      fEstado === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {label} <span className={fEstado === k ? 'text-gray-400' : 'text-gray-300'}>{nEstado[k]}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
                {[['TODAS', 'Todas las piezas'], ['MEMORIAL', 'Falta memorial'],
                  ['VIDEO', 'Falta video'], ['SHORT', 'Falta short']].map(([k, label]) => (
                  <button key={k} onClick={() => setFPieza(k)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition ${
                      fPieza === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {!data.ig_configurado && tab === 'pipeline' && !loading && (
          <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] bg-amber-50 text-amber-700">
            <Instagram size={15} className="shrink-0" />
            La publicación automática en Instagram aún no está activada — se registra el enlace a mano.
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
            <Loader2 className="animate-spin" size={18} /> Cargando…
          </div>
        ) : tab === 'candidatos' ? (
          <CandidatosList candidatos={porGenerar} declinados={declinados} busy={busy} onGenerar={generar}
            onEncuadrar={(c) => setEncuadre({ servicioId: c.servicio_id, fotoUrl: c.foto_url, mascota: c.mascota, ajuste: null })} />
        ) : tab === 'enviados' ? (
          <EnviadosList enviados={enviados} q={q} />
        ) : tab === 'enviar' ? (
          listos.length === 0
            ? <Empty icon={Send} texto={q ? 'Nada coincide con la búsqueda.' : 'No hay servicios con todas sus piezas publicadas pendientes de envío.'} />
            : <div className="grid gap-4">{listos.map(s => (
                <EnvioCard key={s.servicio_id} s={s} busy={busy} tels={tels} setTels={setTels}
                  mensajes={mensajes} setMensajes={setMensajes}
                  plantilla={data.plantillas.mensaje_cliente}
                  zolutium={data.zolutium}
                  onEnviarAuto={() => enviarAuto(s)}
                  onEnviar={() => registrarEnvio(s, true)}
                  onMarcar={() => registrarEnvio(s, false)}
                  onCopiar={() => copiarMensaje(s)} />
              ))}</div>
        ) : (
          pipeline.length === 0
            ? <Empty icon={Film} texto={data.servicios.length === 0
                ? 'Aún no hay servicios con piezas digitales.'
                : 'Nada coincide con la búsqueda o los filtros.'} />
            : <PipelineTable servicios={pipeline} onOpen={setDetalleId} />
        )}
      </div>

      {servicioDetalle && (
        <Modal
          open={!!servicioDetalle}
          onClose={() => setDetalleId(null)}
          title={`Digitales — ${servicioDetalle.mascota || 'servicio'}`}
          maxWidth="max-w-5xl"
        >
          <ServicioCard
            s={servicioDetalle}
            busy={busy}
            videoUrl={videoUrl}
            igConfigurado={data.ig_configurado}
            enlaces={enlaces}
            setEnlaces={setEnlaces}
            manual={manual}
            setManual={setManual}
            onGenerar={() => generar(servicioDetalle.servicio_id)}
            onEncuadrar={(pieza) => setEncuadre({
              servicioId: servicioDetalle.servicio_id,
              fotoUrl: servicioDetalle.foto_url,
              mascota: servicioDetalle.mascota,
              ajuste: pieza?.ajuste_foto || null,
            })}
            onAprobar={aprobar}
            onDescartar={descartar}
            onPublicarIG={publicarIG}
            onPublicarManual={publicarManual}
            onGuardarEnlace={guardarEnlace}
            onIrAEnviar={() => { setDetalleId(null); setTab('enviar') }}
          />
        </Modal>
      )}

      <EncuadreModal
        data={encuadre}
        busy={encuadre ? busy[encuadre.servicioId] : false}
        onClose={() => setEncuadre(null)}
        onGenerar={(ajuste) => generar(encuadre.servicioId, ajuste)}
      />
    </>
  )
}

// Tabla principal del pipeline
function PipelineTable({ servicios, onOpen }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <TableWrap>
        <Table className="min-w-[920px]">
          <thead>
            <tr>
              <Th>Mascota</Th>
              <Th>Plan</Th>
              <Th>Imágenes</Th>
              <Th>Piezas</Th>
              <Th>Progreso</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acción</Th>
            </tr>
          </thead>
          <tbody>
            {servicios.map(s => {
              const estado = estadoServicio(s)
              const progreso = progresoServicio(s)
              const pct = progreso.total ? Math.round((progreso.hechas / progreso.total) * 100) : 0
              return (
                <tr
                  key={s.servicio_id}
                  tabIndex={0}
                  role="button"
                  onClick={() => onOpen(s.servicio_id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpen(s.servicio_id)
                    }
                  }}
                  className="group cursor-pointer transition-colors hover:bg-[#F8FAF5] focus:outline-none focus-visible:bg-[#F8FAF5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3D5A27]/25"
                >
                  <Td>
                    <div className="flex items-center gap-3 min-w-0">
                      {s.foto_url ? (
                        <img
                          src={s.foto_url}
                          alt={s.mascota ? 'Foto de ' + s.mascota : 'Foto de mascota'}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0">
                          <PawPrint size={17} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-[#263218] truncate">{s.mascota || 'Sin nombre'}</div>
                        <div className="text-[12px] text-gray-400 truncate">{s.propietario || 'Sin propietario'}</div>
                        {s.telefono && (
                          <div className="text-[11px] text-gray-400 truncate flex items-center gap-1">
                            <Phone size={10} className="shrink-0" /> {s.telefono}
                          </div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td className="max-w-[180px]">
                    <div className="font-medium text-gray-700 truncate">{s.plan_nombre || s.plan_codigo || 'Sin plan'}</div>
                    {s.plan_nombre && s.plan_codigo && (
                      <div className="text-[11px] text-gray-400 truncate">{s.plan_codigo}</div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">{s.fecha_imagenes || '-'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {tiposDe(s).map(t => {
                        const p = piezaDe(s, t)
                        const est = ESTADO[p?.estado || 'PENDIENTE'] || ESTADO.PENDIENTE
                        return (
                          <Badge key={t} variant={est.variant} className="whitespace-nowrap">
                            {TIPO_CORTO[t]}: {est.label}
                          </Badge>
                        )
                      })}
                      {declinadasDe(s).map(t => (
                        <Badge key={t} variant="gray" className="whitespace-nowrap opacity-70">
                          <Ban size={11} className="mr-1" /> {TIPO_CORTO[t]}: no lo desea
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {progreso.total === 0 ? (
                      <span className="text-[12px] text-gray-400">—</span>
                    ) : (
                      <div className="w-28">
                        <div className="flex items-center justify-between text-[12px] font-medium text-gray-500 mb-1">
                          <span>{progreso.hechas}/{progreso.total}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={'h-full rounded-full ' + (pct === 100 ? 'bg-green-500' : 'bg-[#3D5A27]')}
                            style={{ width: pct + '%' }}
                          />
                        </div>
                      </div>
                    )}
                  </Td>
                  <Td><Badge variant={estado.variant}>{estado.label}</Badge></Td>
                  <Td className="text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={e => { e.stopPropagation(); onOpen(s.servicio_id) }}
                    >
                      <Eye size={14} /> Ver
                    </Button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  )
}

// Tarjeta de un servicio con sus piezas
function ServicioCard({
  s, busy, videoUrl, igConfigurado, enlaces, setEnlaces, manual, setManual,
  onGenerar, onEncuadrar, onAprobar, onDescartar, onPublicarIG, onPublicarManual,
  onGuardarEnlace, onIrAEnviar,
}) {
  const tipos = tiposDe(s)
  const declinadas = declinadasDe(s)
  const mem = piezaDe(s, 'MEMORIAL')
  const url = videoUrl(mem)
  const nPub = publicadas(s).length
  const enviado = fueEnviado(s)

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        {/* Cabecera del servicio */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {s.foto_url
              ? <img src={s.foto_url} alt={s.mascota ? 'Foto de ' + s.mascota : 'Foto de mascota'} className="w-11 h-11 rounded-xl object-cover shrink-0" />
              : <div className="w-11 h-11 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"><PawPrint size={18} /></div>}
            <div className="min-w-0">
              <div className="font-semibold text-[#263218] truncate flex items-center gap-1">{s.mascota}{esAliadoVip(s) && <VipStar size={12} />}</div>
              <div className="text-[12px] text-gray-400 truncate">
                {s.propietario || 'Sin propietario'}{s.telefono ? ` · ${s.telefono}` : ''} · {s.plan_nombre || s.plan_codigo || 'Sin plan'} · imágenes {s.fecha_imagenes}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {tipos.map(t => {
              const p = piezaDe(s, t)
              const est = ESTADO[p?.estado || 'PENDIENTE'] || ESTADO.PENDIENTE
              return <Badge key={t} variant={est.variant}>{TIPO_LABEL[t]}: {est.label}</Badge>
            })}
            {declinadas.map(t => (
              <Badge key={t} variant="gray" className="opacity-70"><Ban size={10} className="mr-1" /> {TIPO_LABEL[t]}: no lo desea</Badge>
            ))}
            {enviado && <Badge variant="green"><Send size={10} className="mr-1" /> Enviado</Badge>}
          </div>
        </div>

        {/* Lo que el cliente rechazó en su formulario de carga de imágenes */}
        {declinadas.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-gray-50 text-gray-500 text-[13px] px-3 py-2.5">
            <Ban size={15} className="shrink-0 mt-0.5" />
            <span>
              El cliente indicó en el portal de imágenes que <b className="font-semibold">no desea {declinadas.map(t => TIPO_LABEL[t]).join(', ')}</b>.
              No se genera ni se envía.
            </span>
          </div>
        )}

        {/* MEMORIAL — pipeline propio (render Remotion) */}
        {tipos.includes('MEMORIAL') && (
          <div className="rounded-xl border border-gray-100 p-3 space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-600">
              <Film size={15} /> Memorial {mem?.formato ? <span className="text-gray-300 font-normal">· {mem.formato === '1080x1920' ? '9:16' : '4:5'}</span> : null}
            </div>

            {!mem ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onEncuadrar(null)} disabled={busy[s.servicio_id] || !s.foto_url}>
                  <Crop size={15} /> Encuadrar
                </Button>
                <Button size="sm" onClick={onGenerar} disabled={busy[s.servicio_id]}>
                  {busy[s.servicio_id] ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />} Generar
                </Button>
              </div>
            ) : mem.estado === 'GENERANDO' ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                <Loader2 className="animate-spin" size={16} /> Generando el video…
              </div>
            ) : mem.estado === 'ERROR' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-500 text-[13px]"><AlertTriangle size={15} /> {mem.error || 'Error al generar'}</div>
                <Button variant="secondary" size="sm" onClick={onGenerar} disabled={busy[s.servicio_id]}>
                  <RefreshCw size={15} /> Regenerar
                </Button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3">
                {url && (
                  <video src={url} controls playsInline preload="metadata"
                    className={`rounded-lg bg-[#0B1D2A] h-52 ${mem.formato === '1080x1920' ? 'aspect-[9/16]' : 'aspect-[4/5]'}`} />
                )}
                <div className="flex-1 space-y-2.5 min-w-0">
                  {mem.error && (
                    <div className="flex items-start gap-2 text-amber-600 text-[12px] bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {mem.error}
                    </div>
                  )}
                  {mem.url_publica && (
                    <a href={mem.url_publica} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[13px] text-pink-600 font-medium hover:underline">
                      <Instagram size={14} /> Ver publicación {mem.publicado_auto ? '· automática' : ''}
                    </a>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {url && (
                      <a href={`${url}&dl=1`} download>
                        <Button variant="secondary" size="sm"><Download size={15} /> Descargar</Button>
                      </a>
                    )}
                    {mem.estado === 'GENERADO' && (
                      <Button size="sm" onClick={() => onAprobar(mem.id)} disabled={busy[mem.id]}>
                        <CheckCircle2 size={15} /> Aprobar
                      </Button>
                    )}
                    {mem.estado === 'APROBADO' && igConfigurado && (
                      <Button size="sm" onClick={() => onPublicarIG(mem.id)} disabled={busy[mem.id]}>
                        {busy[mem.id] ? <Loader2 className="animate-spin" size={15} /> : <Instagram size={15} />} Publicar en Instagram
                      </Button>
                    )}
                    {mem.estado === 'PUBLICANDO' && (
                      <span className="inline-flex items-center gap-2 text-[13px] text-amber-600 font-medium px-2">
                        <Loader2 className="animate-spin" size={15} /> Publicando en Instagram…
                      </span>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => onEncuadrar(mem)} disabled={busy[s.servicio_id] || !s.foto_url}>
                      <Crop size={15} /> Encuadrar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onGenerar} disabled={busy[s.servicio_id]}>
                      <RefreshCw size={15} /> Regenerar
                    </Button>
                    {mem.estado !== 'PUBLICADO' && (
                      <Button variant="ghost" size="sm" onClick={() => onDescartar(mem.id)} disabled={busy[mem.id]}>
                        <X size={15} /> Descartar
                      </Button>
                    )}
                  </div>
                  {['APROBADO', 'PUBLICADO'].includes(mem.estado) && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enlace de la publicación de Instagram (manual)"
                        value={manual[mem.id] ?? (mem.url_publica || '')}
                        onChange={e => setManual(v => ({ ...v, [mem.id]: e.target.value }))}
                        className="text-[13px]"
                      />
                      <Button size="sm" variant="secondary" onClick={() => onPublicarManual(mem.id)} disabled={busy[mem.id]}>
                        {mem.estado === 'PUBLICADO' ? 'Actualizar' : 'Registrar'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIDEO y SHORT — hechos en Canva, publicados a mano en YouTube */}
        {['VIDEO', 'SHORT'].filter(t => tipos.includes(t)).map(t => {
          const p = piezaDe(s, t)
          const k = `${s.servicio_id}:${t}`
          return (
            <div key={t} className="rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-600">
                <Youtube size={15} className="text-red-500" /> {TIPO_LABEL[t]}
                {p?.url_publica && (
                  <a href={p.url_publica} target="_blank" rel="noreferrer"
                    className="text-red-600 font-medium hover:underline ml-1 inline-flex items-center gap-1">
                    <Link2 size={13} /> Ver en YouTube
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={`Pega el enlace de YouTube del ${TIPO_LABEL[t].toLowerCase()}`}
                  value={enlaces[k] ?? (p?.url_publica || '')}
                  onChange={e => setEnlaces(v => ({ ...v, [k]: e.target.value }))}
                  className="text-[13px]"
                />
                <Button size="sm" variant={p?.url_publica ? 'secondary' : 'default'}
                  onClick={() => onGuardarEnlace(s.servicio_id, t)} disabled={busy[k]}>
                  {busy[k] ? <Loader2 className="animate-spin" size={15} /> : (p?.url_publica ? 'Actualizar' : 'Guardar')}
                </Button>
              </div>
            </div>
          )
        })}

        {/* Estado de envío */}
        {nPub > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[12px] text-gray-400">
              {enviado
                ? <>Enviado al cliente el {new Date(envioExitoso(s).enviado_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
                : listoParaEnviar(s)
                  ? 'Todas las piezas publicadas — listo para enviar al cliente.'
                  : `${nPub} de ${tipos.length} pieza${tipos.length > 1 ? 's' : ''} publicada${nPub > 1 ? 's' : ''}.`}
            </div>
            {listoParaEnviar(s) && !enviado && (
              <Button size="sm" onClick={onIrAEnviar}><Send size={14} /> Ir a enviar</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Tarjeta de envío al cliente ─────────────────────────────────────────────
function EnvioCard({ s, busy, tels, setTels, mensajes, setMensajes, plantilla, zolutium, onEnviarAuto, onEnviar, onMarcar, onCopiar }) {
  const texto = mensajes[s.servicio_id] ?? buildMensaje(plantilla, s)
  const noPedidas = (s.declinadas || []).filter(t => !tiposDe(s).includes(t))
  const tel = tels[s.servicio_id] ?? (s.telefono || '')
  const k = `envio:${s.servicio_id}`
  const plantillaZol = plantillaAplicable(s, zolutium)
  const errorPrevio = ultimoError(s)
  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-[#263218] truncate flex items-center gap-1.5"><PawPrint size={14} className="text-gray-400 shrink-0" /> {s.mascota}{esAliadoVip(s) && <VipStar size={12} />}</div>
            <div className="text-[12px] text-gray-400 truncate">{s.propietario || 'Sin propietario'} · {s.plan_nombre || s.plan_codigo || ''}</div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {publicadas(s).map(p => <Badge key={p.tipo} variant="green">{TIPO_LABEL[p.tipo]}</Badge>)}
          </div>
        </div>

        {errorPrevio && (
          <div className="flex items-start gap-2 text-red-600 text-[12px] bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            El último envío automático falló: {errorPrevio.error || 'error desconocido'}. Puedes reintentar o enviar manual.
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-400 font-medium shrink-0">WhatsApp:</span>
          <Input value={tel} placeholder="Teléfono del cliente"
            onChange={e => setTels(v => ({ ...v, [s.servicio_id]: e.target.value }))}
            className="text-[13px] max-w-[220px]" />
        </div>

        {plantillaZol ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onEnviarAuto} disabled={busy[k]}>
                {busy[k] ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />} Enviar
              </Button>
              <span className="text-[12px] text-gray-400">
                Automático por Zolutium · plantilla «{plantillaZol}»
              </span>
            </div>
            {noPedidas.length > 0 && (
              <p className="text-[11px] text-gray-400">
                {noPedidas.map(t => TIPO_CORTO[t]).join(' y ')} no lo pidió el cliente: la plantilla
                va igual, con una nota en lugar de ese enlace.
              </p>
            )}
          </div>
        ) : zolutium?.activo ? (
          <div className="flex items-start gap-2 text-amber-700 text-[12px] bg-amber-50 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            Las piezas de este servicio ({tiposDelPlan(s).map(t => TIPO_CORTO[t]).join(' + ')}) no coinciden
            con ninguna plantilla aprobada — envíalo manual con el mensaje de abajo.
          </div>
        ) : null}

        <textarea
          value={texto}
          onChange={e => setMensajes(v => ({ ...v, [s.servicio_id]: e.target.value }))}
          rows={Math.min(10, texto.split('\n').length + 1)}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3D5A27]/30"
        />
        {plantillaZol && (
          <p className="text-[11px] text-gray-400 -mt-2">
            Este texto solo aplica al envío manual — el automático usa la plantilla aprobada en Meta.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant={plantillaZol ? 'secondary' : 'default'} onClick={onEnviar} disabled={busy[k]}>
            {busy[k] ? <Loader2 className="animate-spin" size={16} /> : <MessageCircle size={16} />}
            {plantillaZol ? 'Enviar manual (wa.me)' : 'Enviar por WhatsApp'}
          </Button>
          <Button variant="secondary" onClick={onCopiar}><Copy size={15} /> Copiar mensaje</Button>
          <Button variant="ghost" onClick={onMarcar} disabled={busy[k]}>
            <CheckCircle2 size={15} /> Marcar enviado (sin abrir WhatsApp)
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Historial de envíos ─────────────────────────────────────────────────────
function EnviadosList({ enviados, q }) {
  if (!enviados.length) return <Empty icon={History} texto={q ? 'Nada coincide con la búsqueda.' : 'Aún no se ha registrado ningún envío.'} />
  return (
    <div className="grid gap-2">
      {enviados.map(e => (
        <Card key={e.id}>
          <CardContent className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-[#263218] text-sm truncate flex items-center gap-1.5"><PawPrint size={14} className="text-gray-400 shrink-0" /> {e.mascota} <span className="text-gray-400 font-normal">· {e.propietario || ''}</span></div>
              {e.telefono && (
                <div className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Phone size={10} className="shrink-0" /> {e.telefono}
                </div>
              )}
              <div className="text-[12px] text-gray-400 flex flex-wrap gap-x-2">
                {(e.enlaces || []).map(l => (
                  <a key={l.tipo} href={l.url} target="_blank" rel="noreferrer" className="hover:underline text-gray-500">
                    {TIPO_LABEL[l.tipo] || l.tipo}
                  </a>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[12px] text-gray-500 font-medium flex items-center justify-end gap-1.5">
                {e.estado === 'ERROR' && <Badge variant="red">Falló</Badge>}
                {new Date(e.enviado_en).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-[11px] text-gray-400">
                {e.enviado_por_nombre || ''} · {e.canal === 'ZOLUTIUM' ? `Automático${e.plantilla ? ` («${e.plantilla}»)` : ''}` : 'WhatsApp'}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Modal de encuadre: vista previa del arco + zoom y posición de la foto ──
function EncuadreModal({ data, busy, onClose, onGenerar }) {
  const [zoom, setZoom] = useState(1)
  const [posX, setPosX] = useState(50)
  const [posY, setPosY] = useState(50)

  useEffect(() => {
    if (data) {
      setZoom(data.ajuste?.zoom || 1)
      setPosX(data.ajuste?.posX ?? 50)
      setPosY(data.ajuste?.posY ?? 50)
    }
  }, [data])

  if (!data) return null
  const sinFoto = !data.fotoUrl

  return (
    <Modal open={!!data} onClose={onClose} title={`Encuadrar foto — ${data.mascota || ''}`} maxWidth="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onGenerar({ zoom, posX, posY })} disabled={busy || sinFoto}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            Generar con este encuadre
          </Button>
        </>
      }>
      {sinFoto ? (
        <div className="text-sm text-gray-500 py-6 text-center">Este servicio no tiene foto disponible.</div>
      ) : (
        <div className="space-y-4">
          {/* Vista previa con la misma máscara de arco del video */}
          <div className="flex justify-center">
            <div className="p-[4px] rounded-[148px_148px_25px_25px]"
              style={{ background: 'linear-gradient(160deg,#D8C39B,#C4A87A 55%,#A98B58)' }}>
              <div className="w-[262px] h-[293px] overflow-hidden bg-[#22331f]"
                style={{ borderRadius: '145px 145px 21px 21px' }}>
                <img
                  src={data.fotoUrl} alt=""
                  className="w-full h-full"
                  style={{
                    objectFit: 'cover',
                    objectPosition: `${posX}% ${posY}%`,
                    transform: `scale(${1.1 * zoom})`,
                    transformOrigin: `${posX}% ${posY}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-center -mt-1">
            Vista aproximada — en el video la foto hace un zoom suave adicional.
          </p>

          {[
            ['Acercar / alejar', zoom, setZoom, 1, 2.5, 0.05],
            ['Posición horizontal', posX, setPosX, 0, 100, 1],
            ['Posición vertical', posY, setPosY, 0, 100, 1],
          ].map(([label, val, setter, min, max, step]) => (
            <div key={label}>
              <div className="flex justify-between text-[12px] font-medium text-gray-600 mb-1">
                <span>{label}</span>
                <span className="text-gray-400">{label.startsWith('Acercar') ? `${val.toFixed(2)}×` : `${Math.round(val)}%`}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={e => setter(parseFloat(e.target.value))}
                className="w-full accent-[#3D5A27]" />
            </div>
          ))}

          <button onClick={() => { setZoom(1); setPosX(50); setPosY(50) }}
            className="text-[12px] text-gray-400 hover:text-gray-600 underline">
            Restablecer encuadre
          </button>
        </div>
      )}
    </Modal>
  )
}

function CandidatosList({ candidatos, declinados = [], busy, onGenerar, onEncuadrar }) {
  if (!candidatos.length && !declinados.length) {
    return <Empty icon={Sparkles} texto="No hay servicios pendientes de memorial." />
  }
  return (
    <div className="space-y-5">
      {candidatos.length === 0 ? (
        <Empty icon={Sparkles} texto="No hay servicios pendientes de memorial." />
      ) : (
        <div className="grid gap-3">
          {candidatos.map(c => (
            <Card key={c.servicio_id}>
              <CardContent className="flex items-center justify-between gap-4 py-3">
                <CandidatoDatos c={c} />
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" onClick={() => onEncuadrar(c)} disabled={busy[c.servicio_id] || !c.foto_url}>
                    <Crop size={16} /> Encuadrar
                  </Button>
                  <Button onClick={() => onGenerar(c.servicio_id)} disabled={busy[c.servicio_id]}>
                    {busy[c.servicio_id] ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    Generar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* El cliente marcó "no deseo este recordatorio" en el portal de imágenes:
          quedan a la vista para que no parezca que se olvidaron, pero sin generar. */}
      {declinados.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
            <Ban size={13} className="shrink-0" />
            El cliente no desea el memorial ({declinados.length})
          </div>
          <div className="grid gap-3">
            {declinados.map(c => (
              <Card key={c.servicio_id} className="bg-gray-50/70 border-dashed">
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <CandidatoDatos c={c} apagado />
                  <Badge variant="gray" className="shrink-0 whitespace-nowrap">
                    <Ban size={12} className="mr-1" /> No lo desea
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CandidatoDatos({ c, apagado = false }) {
  return (
    <div className="min-w-0">
      <div className={`font-semibold truncate ${apagado ? 'text-gray-500' : 'text-[#263218]'}`}>
        <span className="inline-flex items-center gap-1.5"><PawPrint size={14} className="text-gray-400 shrink-0" /> {c.mascota}{esAliadoVip(c) && <VipStar size={12} />}</span>
      </div>
      <div className={`text-[13px] truncate ${apagado ? 'text-gray-400' : 'text-gray-500'}`}>
        {c.propietario || 'Sin propietario'} · {c.plan_nombre || c.plan_codigo} · imágenes {c.fecha_imagenes}
        {c.telefono ? ` · ${c.telefono}` : ''}
      </div>
    </div>
  )
}

function Empty({ icon: Icon, texto }) {
  return (
    <div className="flex flex-col items-center gap-3 text-gray-400 py-20">
      <Icon size={34} strokeWidth={1.5} />
      <span className="text-sm">{texto}</span>
    </div>
  )
}
