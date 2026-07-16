import { useState, useEffect, useMemo } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import FichaServicio from '@/components/servicio/FichaServicio'
import { useConfirm } from '@/contexts/ConfirmContext'
import { petEmoji, parseDate } from '@/lib/utils'
import { LINEAS_WHATSAPP } from '@/lib/whatsapp'
import {
  ESTADO_SOLICITUD, obtenerSolicitudes, enviarSolicitud, reintentarSolicitud,
  cancelarSolicitud, prepararContactos, obtenerSeguimiento, forzarContacto, pausarSeguimiento,
  etapaContacto,
} from '@/lib/imagenes'
import {
  MessageCircle, RefreshCw, Send, Copy, Check, X, RotateCw, AlertTriangle, Link2,
  Pause, Play, PhoneCall, Clock, Filter,
} from 'lucide-react'

const FILTROS = [
  { key: 'todos',         label: 'Todos' },
  { key: 'POR_VALIDAR',   label: 'Por validar' },
  { key: 'ENVIADO',       label: 'Enviados' },
  { key: 'RECIBIDO',      label: 'Recibidos' },
  { key: 'SIN_RESPUESTA', label: 'Sin respuesta' },
  { key: 'ERROR',         label: 'Error' },
]

const ENVIABLE = new Set(['POR_VALIDAR', 'ERROR'])

const FILTROS_COLUMNA_INICIALES = {
  cliente: '', plan: '', whatsapp: '', ingreso: '', recordatorio: '', codigo: '', estado: '', contacto: '',
}

function normalizar(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function FiltroColumna({ label, value, onChange, placeholder = 'Filtrar…', type = 'text', options = [] }) {
  const base = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-[12px] font-medium normal-case tracking-normal text-gray-700 outline-none transition-colors focus:border-[#1A5CD8] focus:ring-2 focus:ring-[#1A5CD8]/15'
  if (type === 'select') return (
    <select aria-label={'Filtrar por ' + label} value={value} onChange={e => onChange(e.target.value)} className={base + ' cursor-pointer'}>
      <option value="">Todos</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
  return <input aria-label={'Filtrar por ' + label} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} />
}

function EncabezadoFiltrable({ label, filterKey, value, onChange, placeholder, type, options }) {
  return (
    <details name="filtros-imagenes" className="group relative">
      <summary aria-label={'Filtrar por ' + label}
        className={'flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#1A5CD8]/30 [&::-webkit-details-marker]:hidden ' + (value ? 'bg-blue-50 text-[#1A5CD8]' : 'hover:bg-white')}>
        <span>{label}</span>
        <span className={'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ' + (value ? 'text-[#1A5CD8]' : 'text-gray-400 group-hover:text-gray-700')}>
          <Filter size={14} />
          {value && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[#1A5CD8]" />}
        </span>
      </summary>
      <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-60 rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2 normal-case tracking-normal">
          <span className="text-[11px] font-bold text-gray-700">Filtrar por {label.toLowerCase()}</span>
          {value && <button type="button" onClick={() => onChange(filterKey, '')} className="text-[10px] font-semibold text-[#1A5CD8] hover:underline">Limpiar</button>}
        </div>
        <FiltroColumna label={label} value={value} onChange={v => onChange(filterKey, v)} placeholder={placeholder} type={type} options={options} />
      </div>
    </details>
  )
}
function fechaCorta(v) {
  // fecha_ingreso es DATE ("YYYY-MM-DD"): parseDate lo interpreta como mediodía
  // LOCAL, no medianoche UTC, para no restar un día en Colombia (UTC-5).
  const d = parseDate(v)
  return d ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '-'
}

// Un punto por contacto (1 manual · 2 y 3 automáticos). El color dice qué pasó:
// verde = salió y Meta lo aceptó · rojo = falló · azul = en curso · gris = aún no.
const PUNTO = {
  ENVIADO:  { bg: '#E8F3EB', color: '#1D8A55', border: '#A0D4B0' },
  ERROR:    { bg: '#FEE8E8', color: '#C03030', border: '#FCA5A5' },
  ENVIANDO: { bg: '#EEF3FB', color: '#3B6FBF', border: '#C5D8F5' },
  PENDIENTE:{ bg: '#F3F4F6', color: '#9CA3AF', border: '#E5E7EB' },
}

function tituloContacto(c, numero) {
  if (!c) return `Contacto ${numero}: aún no enviado`
  const cuando = c.enviado_en ? new Date(c.enviado_en).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'
  const como   = c.automatico ? 'automático' : 'manual'
  if (c.estado === 'ERROR') return `Contacto ${numero} (${como}): ERROR — ${c.ultimo_error || 'sin detalle'}`
  if (c.estado === 'ENVIANDO') return `Contacto ${numero}: envío en curso`
  const meta = c.estado_meta ? ` · Meta: ${c.estado_meta}` : ''
  return `Contacto ${numero} (${como}): enviado ${cuando}${meta}`
}

export default function SeguimientoImagenes() {
  const { confirm, alert: showAlert } = useConfirm()
  const [solicitudes, setSolicitudes] = useState([])
  const [seguimiento, setSeguimiento] = useState({})   // { solicitud_id: { contactos[], proximo } }
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [filtro,   setFiltro]   = useState('POR_VALIDAR')
  const [busy,     setBusy]     = useState(null)   // id de solicitud o 'bulk' o 'preparar'
  const [sel,      setSel]      = useState(() => new Set())
  const [copiado,  setCopiado]  = useState(null)
  const [info,     setInfo]     = useState(null)   // banner informativo (p.ej. plantilla pendiente)
  const [filtrosColumna, setFiltrosColumna] = useState(FILTROS_COLUMNA_INICIALES)
  const [detalleServicioId, setDetalleServicioId] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [sols, seg] = await Promise.all([
        obtenerSolicitudes(),
        // El seguimiento es accesorio: si el backend no responde, la bandeja
        // sigue funcionando (solo se queda sin la columna de contactos).
        obtenerSeguimiento().catch(() => ({})),
      ])
      setSolicitudes(sols)
      setSeguimiento(seg)
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const conteo = useMemo(() => {
    const c = { POR_VALIDAR: 0, ENVIADO: 0, RECIBIDO: 0, ERROR: 0, SIN_RESPUESTA: 0 }
    solicitudes.forEach(s => { if (c[s.estado] !== undefined) c[s.estado]++ })
    return c
  }, [solicitudes])

  const filtradasPorEstado = filtro === 'todos' ? solicitudes : solicitudes.filter(s => s.estado === filtro)
  const filtradas = useMemo(() => filtradasPorEstado.filter(s => {
    const svc = s.servicios || {}
    const m = svc.mascotas || {}
    const c = m.clientes || {}
    const seg = seguimiento[s.id] || {}
    const contacto = s.seguimiento_pausado
      ? 'pausado'
      : s.estado === 'SIN_RESPUESTA'
        ? 'llamar'
        : etapaContacto(seg.contactos).texto
    const campos = {
      cliente: [c.nombre, c.apellido, m.nombre].filter(Boolean).join(' '),
      plan: [svc.planes?.nombre, svc.planes?.codigo].filter(Boolean).join(' '),
      whatsapp: s.whatsapp_destino || c.whatsapp || '',
      ingreso: fechaCorta(svc.fecha_ingreso),
      recordatorio: (s.recordatorios_img || []).length
        ? (s.recordatorios_img || []).map(r => r.nombre + ' ' + r.cantidad).join(' ')
        : 'solo datos de entrega',
      codigo: [s.codigo, s.enlace].filter(Boolean).join(' '),
      estado: s.estado,
      contacto,
    }
    return Object.entries(filtrosColumna).every(([key, value]) => !value || normalizar(campos[key]).includes(normalizar(value)))
  }), [filtradasPorEstado, filtrosColumna, seguimiento])
  const seleccionables = filtradas.filter(s => ENVIABLE.has(s.estado))

  const hayFiltrosColumna = Object.values(filtrosColumna).some(Boolean)
  function cambiarFiltroColumna(key, value) {
    setFiltrosColumna(prev => ({ ...prev, [key]: value }))
    setSel(new Set())
  }

  function abrirDetalleFila(event, servicioId) {
    if (event.target.closest('button, input, select, a')) return
    setDetalleServicioId(servicioId)
  }

  function toggleSel(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleTodos() {
    const ids = seleccionables.map(s => s.id)
    const todosSel = ids.length > 0 && ids.every(id => sel.has(id))
    setSel(todosSel ? new Set() : new Set(ids))
  }

  async function copiar(texto, key) {
    try { await navigator.clipboard.writeText(texto); setCopiado(key); setTimeout(() => setCopiado(null), 1500) }
    catch { /* noop */ }
  }

  // Devuelve { ok, sinPlantilla, error } interpretando el backend
  async function ejecutarEnvio(s) {
    const fn = s.estado === 'ERROR' ? reintentarSolicitud : enviarSolicitud
    try {
      const r = await fn(s.id)
      if (r?.ok) return { ok: true }
      // status 200 con ok:false → fallo de envío (estado ERROR)
      return { ok: false, error: r?.error || 'Error al enviar' }
    } catch (e) {
      if (e.detalle?.sin_plantilla) return { ok: false, sinPlantilla: true }
      return { ok: false, error: e.message }
    }
  }

  async function enviarUno(s) {
    if (busy) return
    setBusy(s.id); setInfo(null)
    const res = await ejecutarEnvio(s)
    setBusy(null)
    if (res.sinPlantilla) {
      setInfo('La plantilla de WhatsApp aún no está aprobada en Meta/Zolutium. La solicitud quedó lista (código y enlace generados); el envío se activará al aprobar la plantilla.')
    } else if (!res.ok) {
      await showAlert(res.error, { title: 'No se pudo enviar' })
    }
    await cargar()
  }

  async function enviarSeleccionados() {
    if (busy || sel.size === 0) return
    setBusy('bulk'); setInfo(null)
    const objetivos = solicitudes.filter(s => sel.has(s.id) && ENVIABLE.has(s.estado))
    let ok = 0, err = 0, sinPlantilla = 0
    for (const s of objetivos) {
      const r = await ejecutarEnvio(s)
      if (r.ok) ok++
      else if (r.sinPlantilla) sinPlantilla++
      else err++
    }
    setBusy(null); setSel(new Set())
    if (sinPlantilla > 0)
      setInfo(`${sinPlantilla} solicitud(es) quedaron listas pero NO se enviaron: la plantilla de WhatsApp aún no está aprobada. Se enviarán al activarla.`)
    if (ok > 0 || err > 0)
      await showAlert(`Enviadas: ${ok}${err ? ` · Con error: ${err}` : ''}`, { title: 'Envío de seleccionados', variant: err ? 'danger' : 'success' })
    await cargar()
  }

  async function cancelar(s) {
    const m = s.servicios?.mascotas
    const okc = await confirm(`¿Cancelar la solicitud de imágenes de ${m?.nombre || 'esta mascota'}?`, {
      title: 'Cancelar solicitud', confirmLabel: 'Sí, cancelar',
    })
    if (!okc) return
    setBusy(s.id)
    try { await cancelarSolicitud(s.id) }
    catch (e) { await showAlert(e.message, { title: 'No se pudo cancelar' }) }
    finally { setBusy(null); await cargar() }
  }

  async function preparar() {
    if (busy) return
    setBusy('preparar'); setInfo(null)
    try {
      const r = await prepararContactos()
      setInfo(`Preparación lista: ${r.creados || 0} contacto(s) nuevo(s) por validar (de ${r.candidatos || 0} candidatos).`)
    } catch (e) { await showAlert(e.message, { title: 'No se pudo preparar' }) }
    finally { setBusy(null); await cargar() }
  }

  // Adelantar el 2º/3er contacto sin esperar al cron (el cron lo haría solo).
  async function adelantar(s, numero) {
    if (busy) return
    const m = s.servicios?.mascotas
    const okc = await confirm(
      `¿Enviar ahora el contacto ${numero} a ${m?.clientes?.nombre || 'el cliente'} por el recordatorio de imágenes de ${m?.nombre || 'su mascota'}?`,
      { title: `Adelantar contacto ${numero}`, confirmLabel: 'Sí, enviar ahora' }
    )
    if (!okc) return
    setBusy(s.id); setInfo(null)
    try {
      const r = await forzarContacto(s.id, numero)
      if (!r?.ok) await showAlert(r?.error || 'No se pudo enviar', { title: 'Contacto no enviado' })
    } catch (e) {
      await showAlert(e.message, { title: 'Contacto no enviado' })
    } finally { setBusy(null); await cargar() }
  }

  // Sacar el caso de la cadencia (p.ej. ya se habló por teléfono con el cliente).
  async function togglePausa(s) {
    if (busy) return
    setBusy(s.id)
    try { await pausarSeguimiento(s.id, !s.seguimiento_pausado) }
    catch (e) { await showAlert(e.message, { title: 'No se pudo cambiar el seguimiento' }) }
    finally { setBusy(null); await cargar() }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="spinner" /><span className="text-sm text-ink3">Cargando...</span>
    </div>
  )
  if (error) return (
    <div className="p-7">
      <div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div>
    </div>
  )

  const todosSelMarcado = seleccionables.length > 0 && seleccionables.every(s => sel.has(s.id))

  return (
    <div>
      <Topbar actions={
        <div className="flex items-center gap-2">
          <button onClick={preparar} disabled={!!busy}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-surface2 disabled:opacity-50"
            style={{ borderColor: 'rgba(30,80,40,0.2)', color: '#3D5A27' }}
            title="Buscar servicios del día que requieren imágenes y dejarlos por validar">
            {busy === 'preparar' ? 'Preparando…' : 'Preparar contactos'}
          </button>
          <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
            <RefreshCw size={15} />
          </button>
        </div>
      } />
      <div className="p-7 space-y-6">

        {/* Alerta de pendientes por validar */}
        {conteo.POR_VALIDAR > 0 && (
          <div className="rounded-xl p-3.5 border flex items-center gap-3"
            style={{ background: '#FFF7E6', borderColor: '#FFD980' }}>
            <AlertTriangle size={16} style={{ color: '#9A5500' }} />
            <span className="text-[13px] font-semibold" style={{ color: '#9A5500' }}>
              Tienes {conteo.POR_VALIDAR} contacto{conteo.POR_VALIDAR > 1 ? 's' : ''} pendiente{conteo.POR_VALIDAR > 1 ? 's' : ''} de validar y autorizar el envío.
            </span>
          </div>
        )}

        {/* Banner informativo (plantilla pendiente / resultado de preparar) */}
        {info && (
          <div className="rounded-xl p-3.5 border flex items-start gap-3"
            style={{ background: '#EEF3FB', borderColor: '#C5D8F5' }}>
            <MessageCircle size={16} style={{ color: '#3B6FBF', marginTop: 1 }} />
            <span className="text-[13px] text-[#2C5AA0] flex-1">{info}</span>
            <button onClick={() => setInfo(null)} className="text-[#3B6FBF]"><X size={15} /></button>
          </div>
        )}

        {/* Línea de envío WhatsApp — fijada en la configuración de Zolutium */}
        <div className="rounded-xl p-4 border flex items-center gap-2 flex-wrap"
          style={{ background: '#F0FDF4', borderColor: '#86EFAC' }}>
          <MessageCircle size={15} className="text-green-600 flex-shrink-0" />
          <span className="text-[12px] font-semibold text-green-800">Línea de envío Zolutium:</span>
          <span className="text-[12px] font-bold text-green-900">{LINEAS_WHATSAPP[0].label}</span>
          <span className="text-[11px] text-green-700">— configurada como línea por defecto en Zolutium</span>
        </div>

        {/* Sin respuesta tras los 3 contactos → requiere llamada humana */}
        {conteo.SIN_RESPUESTA > 0 && (
          <div className="rounded-xl p-3.5 border flex items-center gap-3"
            style={{ background: '#FEF3C7', borderColor: '#FCD34D' }}>
            <PhoneCall size={16} style={{ color: '#B45309' }} />
            <span className="text-[13px] font-semibold" style={{ color: '#B45309' }}>
              {conteo.SIN_RESPUESTA} cliente{conteo.SIN_RESPUESTA > 1 ? 's' : ''} no respondió a los 3 contactos por WhatsApp — requiere{conteo.SIN_RESPUESTA > 1 ? 'n' : ''} llamada. El enlace sigue activo: si cargan, se cierra solo.
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Por validar"   value={conteo.POR_VALIDAR}   valueColor="#9A5500" />
          <StatCard label="Enviados"      value={conteo.ENVIADO}       valueColor="#3B6FBF" />
          <StatCard label="Recibidos"     value={conteo.RECIBIDO}      valueColor="#1D8A55" />
          <StatCard label="Sin respuesta" value={conteo.SIN_RESPUESTA} valueColor="#B45309" />
          <StatCard label="Con error"     value={conteo.ERROR}         valueColor="#C03030" />
        </div>

        {/* Filtros + acción masiva */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {FILTROS.map(f => (
              <button key={f.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => { setFiltro(f.key); setSel(new Set()) }}>
                {f.label}
              </button>
            ))}
          </div>
          {sel.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-semibold text-ink2">{sel.size} seleccionado{sel.size > 1 ? 's' : ''}</span>
              <Button size="sm" onClick={enviarSeleccionados} disabled={busy === 'bulk'}>
                {busy === 'bulk'
                  ? <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando…</span>
                  : <span className="flex items-center gap-1.5"><Send size={13} /> Enviar seleccionados</span>}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 -mt-3 text-[11px] text-ink3">
          <span>{filtradas.length} de {filtradasPorEstado.length} solicitudes visibles</span>
          <div className="flex items-center gap-3">
            {hayFiltrosColumna && (
              <button onClick={() => setFiltrosColumna(FILTROS_COLUMNA_INICIALES)}
                className="h-9 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold text-ink2 hover:bg-surface2 transition-colors">
                Limpiar filtros
              </button>
            )}
            <span className="hidden sm:inline">Haz clic en una fila para abrir la ficha completa</span>
          </div>
        </div>

        {/* Tabla */}
        <TableWrap className="max-h-[calc(100vh-11rem)] min-h-[320px] overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm [scrollbar-gutter:stable_both-edges]">
          <Table className="min-w-[1520px]">
            <thead className="sticky top-0 z-20 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
              <tr>
                <Th className="w-8">
                  {seleccionables.length > 0 && (
                    <input type="checkbox" checked={todosSelMarcado} onChange={toggleTodos} className="cursor-pointer" />
                  )}
                </Th>
                {[
                  { key: 'cliente', label: 'Cliente / Mascota', width: 'min-w-[210px]', placeholder: 'Cliente o mascota' },
                  { key: 'plan', label: 'Plan', width: 'min-w-[160px]', placeholder: 'Plan' },
                  { key: 'whatsapp', label: 'WhatsApp', width: 'min-w-[155px]', placeholder: 'Número' },
                  { key: 'ingreso', label: 'Ingreso', width: 'min-w-[135px]', placeholder: 'Fecha' },
                  { key: 'recordatorio', label: 'Recordatorios con imagen', width: 'min-w-[210px]', placeholder: 'Recordatorio' },
                  { key: 'codigo', label: 'Código / Enlace', width: 'min-w-[160px]', placeholder: 'Código' },
                  { key: 'estado', label: 'Estado', width: 'min-w-[150px]', type: 'select', options: FILTROS.filter(f => f.key !== 'todos').map(f => ({ value: f.key, label: f.label })) },
                  { key: 'contacto', label: 'Contactos', width: 'min-w-[150px]', placeholder: 'Ej. pausado' },
                ].map(col => (
                  <Th key={col.key} className={col.width + ' overflow-visible'}>
                    <EncabezadoFiltrable {...col} filterKey={col.key} value={filtrosColumna[col.key]} onChange={cambiarFiltroColumna} />
                  </Th>
                ))}
                <Th className="min-w-[190px]">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(s => {
                const svc = s.servicios || {}
                const m   = svc.mascotas
                const c   = m?.clientes
                const wa  = s.whatsapp_destino || c?.whatsapp
                const est = ESTADO_SOLICITUD[s.estado] || {}
                const enviable = ENVIABLE.has(s.estado)
                const trabajando = busy === s.id
                const seg = seguimiento[s.id] || {}
                // Se puede adelantar el siguiente contacto mientras la solicitud siga
                // viva (enviada, sin carga del cliente) y no esté pausada.
                const puedeAdelantar = s.estado === 'ENVIADO' && !s.seguimiento_pausado && seg.proximo && wa
                return (
                  <Tr key={s.id}
                    onClick={e => abrirDetalleFila(e, svc.id)}
                    onKeyDown={e => {
                      if (e.currentTarget === e.target && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault(); setDetalleServicioId(svc.id)
                      }
                    }}
                    tabIndex={0} role="button"
                    aria-label={'Abrir ficha completa de ' + (m?.nombre || 'la mascota')}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A5CD8]">
                    <Td>
                      {enviable && (
                        <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleSel(s.id)} className="cursor-pointer" />
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{petEmoji(m?.especies?.nombre)}</span>
                        <div>
                          <div className="font-semibold text-ink">{c?.nombre} {c?.apellido}</div>
                          <div className="text-[10px] text-ink3">{m?.nombre || '-'}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink3">
                      {svc.planes?.nombre}
                      {s.solo_adicional && <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>solo adicional</span>}
                    </Td>
                    <Td className="text-ink2 font-mono text-[11px]">{wa || <span className="text-danger">sin WhatsApp</span>}</Td>
                    <Td className="text-ink3 text-[11px]">{fechaCorta(svc.fecha_ingreso)}</Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        {(s.recordatorios_img || []).length === 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit"
                            style={{ background: '#E8F3EB', color: '#1D6B3F' }}>Solo datos de entrega</span>
                        )}
                        {(s.recordatorios_img || []).map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full w-fit"
                            style={{ background: '#EEF3FB', color: '#2C5AA0' }}>
                            {r.nombre}<span className="font-bold">×{r.cantidad}</span>
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {s.codigo ? (
                        <div className="flex flex-col gap-1">
                          <button onClick={() => copiar(s.codigo, `c${s.id}`)}
                            className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-ink hover:text-primary-dark w-fit"
                            title="Copiar código">
                            {copiado === `c${s.id}` ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}{s.codigo}
                          </button>
                          {s.enlace && (
                            <button onClick={() => copiar(s.enlace, `e${s.id}`)}
                              className="inline-flex items-center gap-1 text-[10px] text-ink3 hover:text-primary-dark w-fit"
                              title="Copiar enlace">
                              {copiado === `e${s.id}` ? <Check size={10} className="text-green-600" /> : <Link2 size={10} />}enlace
                            </button>
                          )}
                        </div>
                      ) : <span className="text-ink3 text-[11px]">—</span>}
                    </Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: est.bg, color: est.color, borderColor: est.border }}>
                        {est.label || s.estado}
                      </span>
                      {s.estado === 'ERROR' && s.ultimo_error && (
                        <div className="text-[9px] text-danger mt-1 max-w-[180px] truncate" title={s.ultimo_error}>
                          {s.ultimo_error}
                        </div>
                      )}
                      {s.estado === 'ENVIADO' && s.intentos > 0 && (
                        <div className="text-[9px] text-ink3 mt-1">intento{s.intentos > 1 ? `s ×${s.intentos}` : ''}</div>
                      )}
                      {s.estado === 'SIN_RESPUESTA' && s.motivo_cierre === 'FUERA_DE_VENTANA' && (
                        <div className="text-[9px] text-ink3 mt-1">el servicio ya no admite carga</div>
                      )}
                    </Td>

                    {/* Seguimiento: 1 (manual) · 2 (+3 hábiles) · 3 (+15 hábiles) */}
                    <Td>
                      {s.estado === 'POR_VALIDAR' ? (
                        <span className="text-ink3 text-[11px]">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            {[1, 2, 3].map(n => {
                              const c  = (seg.contactos || []).find(x => x.numero === n)
                              const st = PUNTO[c?.estado || 'PENDIENTE'] || PUNTO.PENDIENTE
                              return (
                                <span key={n} title={tituloContacto(c, n)}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border text-[9px] font-bold cursor-default"
                                  style={{ background: st.bg, color: st.color, borderColor: st.border }}>
                                  {n}
                                </span>
                              )
                            })}
                            {(() => {
                              const et = etapaContacto(seg.contactos)
                              return (
                                <span className="text-[9px] font-bold whitespace-nowrap ml-0.5"
                                  style={{ color: et.color }}>
                                  {et.texto}
                                </span>
                              )
                            })()}
                          </div>
                          {s.seguimiento_pausado ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-ink3">
                              <Pause size={9} /> pausado
                            </span>
                          ) : s.estado === 'SIN_RESPUESTA' ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold" style={{ color: '#B45309' }}>
                              <PhoneCall size={9} /> llamar
                            </span>
                          ) : seg.proximo ? (
                            <span className="inline-flex items-center gap-1 text-[9px] text-ink3"
                              title={`El contacto ${seg.proximo.numero} sale solo ese día (día hábil)`}>
                              <Clock size={9} /> {seg.proximo.numero}º: {fechaCorta(seg.proximo.fecha)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </Td>

                    <Td>
                      <div className="flex gap-1.5 flex-wrap">
                        {s.estado === 'POR_VALIDAR' && wa && (
                          <button onClick={() => enviarUno(s)} disabled={trabajando}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-opacity disabled:opacity-50"
                            style={{ background: '#25D366', color: 'white' }} title="Enviar por WhatsApp">
                            {trabajando ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={11} />}
                            Enviar
                          </button>
                        )}
                        {s.estado === 'ERROR' && (
                          <button onClick={() => enviarUno(s)} disabled={trabajando}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-opacity disabled:opacity-50"
                            style={{ background: '#3B6FBF', color: 'white' }} title="Reintentar envío">
                            {trabajando ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <RotateCw size={11} />}
                            Reintentar
                          </button>
                        )}
                        {puedeAdelantar && (
                          <button onClick={() => adelantar(s, seg.proximo.numero)} disabled={trabajando}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-opacity disabled:opacity-50"
                            style={{ background: '#F5F0E6', color: '#8A6D2F', border: '1px solid #E3D5B8' }}
                            title={`El contacto ${seg.proximo.numero} saldría solo el ${fechaCorta(seg.proximo.fecha)}. Enviarlo ahora.`}>
                            {trabajando ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Send size={11} />}
                            Adelantar {seg.proximo.numero}º
                          </button>
                        )}
                        {['ENVIADO', 'SIN_RESPUESTA'].includes(s.estado) && (
                          <button onClick={() => togglePausa(s)} disabled={trabajando}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors hover:bg-surface2 disabled:opacity-50"
                            style={{ color: '#6B7280' }}
                            title={s.seguimiento_pausado
                              ? 'Reanudar los recordatorios automáticos'
                              : 'No enviar más recordatorios automáticos a este cliente'}>
                            {s.seguimiento_pausado ? <><Play size={11} /> Reanudar</> : <><Pause size={11} /> Pausar</>}
                          </button>
                        )}
                        {ENVIABLE.has(s.estado) && (
                          <button onClick={() => cancelar(s)} disabled={trabajando}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors hover:bg-red-50 disabled:opacity-50"
                            style={{ color: '#C03030' }} title="Cancelar solicitud">
                            <X size={11} /> Cancelar
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtradas.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-ink3 text-sm">Sin solicitudes</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
      {detalleServicioId && (
        <FichaServicio servicioId={detalleServicioId} onClose={() => setDetalleServicioId(null)} />
      )}
    </div>
  )
}
