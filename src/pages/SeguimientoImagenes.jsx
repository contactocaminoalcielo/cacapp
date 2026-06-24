import { useState, useEffect, useMemo } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { petEmoji, parseDate } from '@/lib/utils'
import { LINEAS_WHATSAPP } from '@/lib/whatsapp'
import {
  ESTADO_SOLICITUD, obtenerSolicitudes, enviarSolicitud, reintentarSolicitud,
  cancelarSolicitud, prepararContactos,
} from '@/lib/imagenes'
import {
  MessageCircle, RefreshCw, Send, Copy, Check, X, RotateCw, AlertTriangle, Link2,
} from 'lucide-react'

const FILTROS = [
  { key: 'todos',       label: 'Todos' },
  { key: 'POR_VALIDAR', label: 'Por validar' },
  { key: 'ENVIADO',     label: 'Enviados' },
  { key: 'RECIBIDO',    label: 'Recibidos' },
  { key: 'ERROR',       label: 'Error' },
]

const ENVIABLE = new Set(['POR_VALIDAR', 'ERROR'])

function fechaCorta(v) {
  // fecha_ingreso es DATE ("YYYY-MM-DD"): parseDate lo interpreta como mediodía
  // LOCAL, no medianoche UTC, para no restar un día en Colombia (UTC-5).
  const d = parseDate(v)
  return d ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '-'
}

export default function SeguimientoImagenes() {
  const { confirm, alert: showAlert } = useConfirm()
  const [solicitudes, setSolicitudes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [filtro,   setFiltro]   = useState('POR_VALIDAR')
  const [busy,     setBusy]     = useState(null)   // id de solicitud o 'bulk' o 'preparar'
  const [sel,      setSel]      = useState(() => new Set())
  const [copiado,  setCopiado]  = useState(null)
  const [info,     setInfo]     = useState(null)   // banner informativo (p.ej. plantilla pendiente)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      setSolicitudes(await obtenerSolicitudes())
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const conteo = useMemo(() => {
    const c = { POR_VALIDAR: 0, ENVIADO: 0, RECIBIDO: 0, ERROR: 0 }
    solicitudes.forEach(s => { if (c[s.estado] !== undefined) c[s.estado]++ })
    return c
  }, [solicitudes])

  const filtradas = filtro === 'todos' ? solicitudes : solicitudes.filter(s => s.estado === filtro)
  const seleccionables = filtradas.filter(s => ENVIABLE.has(s.estado))

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

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Por validar" value={conteo.POR_VALIDAR} valueColor="#9A5500" />
          <StatCard label="Enviados"    value={conteo.ENVIADO}     valueColor="#3B6FBF" />
          <StatCard label="Recibidos"   value={conteo.RECIBIDO}    valueColor="#1D8A55" />
          <StatCard label="Con error"   value={conteo.ERROR}       valueColor="#C03030" />
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

        {/* Tabla */}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  {seleccionables.length > 0 && (
                    <input type="checkbox" checked={todosSelMarcado} onChange={toggleTodos} className="cursor-pointer" />
                  )}
                </Th>
                <Th>Cliente / Mascota</Th>
                <Th>Plan</Th>
                <Th>WhatsApp</Th>
                <Th>Ingreso</Th>
                <Th>Recordatorios con imagen</Th>
                <Th>Código / Enlace</Th>
                <Th>Estado</Th>
                <Th>Acciones</Th>
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
                return (
                  <Tr key={s.id}>
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
                        {(s.recordatorios_img || []).length === 0 && <span className="text-ink3 text-[11px]">-</span>}
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
                <tr><td colSpan={9} className="text-center py-8 text-ink3 text-sm">Sin solicitudes</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </div>
  )
}
