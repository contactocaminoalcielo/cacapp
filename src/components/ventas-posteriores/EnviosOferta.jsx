// Ventas posteriores › Envíos — la vista diaria de la OFERTA POSTERIOR (migr. 210).
//
// Una fila por mascotica con su estado (Programada · Enviada · Excluida · Con
// error) y, si ya salió, qué respondió la familia. Mismo diseño que
// /condolencias, a propósito: quien revisa una revisa la otra.
//
// Las reglas viven en el backend (orbit-backend/src/oferta-posterior.js): aquí
// no se calcula ninguna fecha ni se decide a quién no se le envía. Al abrir la
// pestaña el backend PREPARA lo que falte y REVISA las exclusiones.
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/card'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { parseDate, fmtDateTime, waLink } from '@/lib/utils'
import { RefreshCw, ChevronLeft, ChevronRight, EyeOff, RotateCcw, MessageCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

const ESTADO = {
  PENDIENTE: { label: 'Programada', bg: '#EEF3FB', fg: '#3B6FBF' },
  ENVIANDO:  { label: 'Enviando',   bg: '#EEF3FB', fg: '#3B6FBF' },
  ENVIADO:   { label: 'Enviada',    bg: '#DCFCE7', fg: '#166534' },
  ERROR:     { label: 'Con error',  bg: '#FEE2E2', fg: '#B91C1C' },
  EXCLUIDO:  { label: 'Excluida',   bg: '#F3F4F6', fg: '#6B7280' },
  NO_SALIO:  { label: 'No salió',   bg: '#FFF8E6', fg: '#9A5500' },
}
const ACUSE = { sent: 'Enviado', delivered: 'Le llegó', read: 'Leído', failed: 'No llegó' }
const RESPUESTA = {
  RECORDATORIOS: { label: 'Le interesan recordatorios', bg: '#DCFCE7', fg: '#166534' },
  PREEXEQUIALES: { label: 'Le interesa un plan',        bg: '#DCFCE7', fg: '#166534' },
  CEDULAS:       { label: 'Le interesa una cédula',     bg: '#DCFCE7', fg: '#166534' },
  NO_DESEA:      { label: 'No desea información',       bg: '#F3F4F6', fg: '#6B7280' },
}

const fmtDia = iso => parseDate(iso)?.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
const fmtCorto = iso => parseDate(iso)?.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
const sumarDias = (iso, n) => {
  const d = parseDate(iso); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const diasEntre = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

/**
 * Una PENDIENTE cuya fecha ya quedó fuera de lo que el job todavía envía
 * (antes del arranque, o más vieja que el atraso permitido) no va a salir:
 * se dice así en vez de seguir llamándola «Programada».
 */
function estadoVisible(f, datos) {
  if (f.estado !== 'PENDIENTE' && f.estado !== 'ERROR') return f.estado
  const { hoy, config } = datos
  const tarde = f.fecha_programada < hoy && diasEntre(f.fecha_programada, hoy) > config.atraso
  const antes = config.activo && config.arranque_desde && f.fecha_programada < config.arranque_desde
  return (tarde || antes) ? 'NO_SALIO' : f.estado
}

export default function EnviosOferta() {
  const { alert: showAlert } = useConfirm()
  const [datos, setDatos]       = useState(null)
  const [dia, setDia]           = useState(null)      // null = hoy (lo decide el backend)
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState('')
  const [excluyendo, setExcluyendo] = useState(null)  // id de la fila con el formulario abierto
  const [motivo, setMotivo]     = useState('')
  const [noVolver, setNoVolver] = useState(false)
  const [ocupado, setOcupado]   = useState('')
  const [verMensaje, setVerMensaje] = useState(false)
  const [copiado, setCopiado]   = useState('')

  const cargar = useCallback(async (fecha = dia) => {
    setCargando(true)
    try {
      const r = await orbitApi(`/oferta-posterior${fecha ? `?fecha=${fecha}` : ''}`)
      setDatos(r); setError('')
    } catch (e) {
      setError(e.message || 'No se pudo cargar')
    } finally {
      setCargando(false)
    }
  }, [dia])

  useEffect(() => { cargar(dia) }, [dia])   // eslint-disable-line react-hooks/exhaustive-deps

  async function excluir(f) {
    if (!motivo.trim()) return
    setOcupado(f.id)
    try {
      await orbitApi(`/oferta-posterior/${f.id}/excluir`, { method: 'POST', body: { motivo, no_volver: noVolver } })
      setExcluyendo(null); setMotivo(''); setNoVolver(false)
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo excluir' })
    } finally { setOcupado('') }
  }

  async function reincluir(f) {
    setOcupado(f.id)
    try {
      await orbitApi(`/oferta-posterior/${f.id}/reincluir`, { method: 'POST' })
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo reincluir' })
    } finally { setOcupado('') }
  }

  async function copiarEnlace(f) {
    try { await navigator.clipboard.writeText(f.enlace); setCopiado(f.id); setTimeout(() => setCopiado(''), 2000) } catch { /* sin portapapeles */ }
  }

  const hoy = datos?.hoy
  const actual = datos?.dia
  const filas = datos?.filas || []
  const cfg = datos?.config
  const emb = datos?.embudo
  const vis = f => estadoVisible(f, datos)
  const cuenta = filas.reduce((a, f) => {
    const e = vis(f) === 'ENVIANDO' ? 'PENDIENTE' : vis(f)
    a[e] = (a[e] || 0) + 1
    return a
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[13px] text-gray-500 leading-snug max-w-3xl">
          Un mensaje con cuatro botones a los <strong>{cfg?.dias ?? 60} días</strong> del fallecimiento, y nunca antes
          de {cfg?.tras_condolencia ?? 30} días después de las condolencias ni de {cfg?.tras_entrega ?? 15} días después de la entrega.
          Solo a familias <strong>ya entregadas</strong>. No sale a quien pidió no recibir información, calificó mal la
          encuesta o tiene una queja. Sale a las 14:00, de lunes a viernes.
        </p>
        <button className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          onClick={() => cargar()} title="Actualizar" aria-label="Actualizar">
          <RefreshCw size={14} />
        </button>
      </div>

      {cfg && (!cfg.activo || !cfg.plantilla) && (
        <div className="rounded-lg border border-[#FFD980] bg-[#FFF8E6] text-[#9A5500] p-3 text-[12px]">
          {!cfg.plantilla
            ? 'Todavía no hay plantilla aprobada por Meta: lo programado se ve aquí, pero no sale nada.'
            : 'La oferta posterior está APAGADA en /automatizaciones: lo programado se ve aquí, pero no sale nada. Al encenderla, arranca desde ese día (nada de atrasadas).'}
        </div>
      )}

      {/* El embudo, sobre todo lo enviado hasta hoy */}
      {emb && emb.enviadas > 0 && (
        <div className="rounded-xl border bg-white px-4 py-3 text-[12.5px] text-gray-600 flex flex-wrap gap-x-5 gap-y-1" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <span><strong className="text-gray-900">{emb.enviadas}</strong> enviadas en total</span>
          <span><strong className="text-gray-900">{emb.abrieron}</strong> abrieron el portal</span>
          <span><strong className="text-green-700">{emb.interesadas}</strong> mostraron interés</span>
          <span><strong className="text-gray-900">{emb.no_desean}</strong> pidieron no recibir más</span>
        </div>
      )}

      {/* Navegación por día */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!actual} onClick={() => setDia(sumarDias(actual, -1))} aria-label="Día anterior">
          <ChevronLeft size={14} />
        </Button>
        <div className="text-[15px] font-semibold text-gray-900 min-w-[14rem] text-center">
          {actual === hoy ? 'Ofertas de hoy' : actual ? <span className="capitalize">{fmtDia(actual)}</span> : '…'}
          {actual && actual === hoy && <span className="block text-[11px] font-normal text-gray-500 capitalize">{fmtDia(actual)}</span>}
        </div>
        <Button size="sm" variant="secondary" disabled={!actual} onClick={() => setDia(sumarDias(actual, 1))} aria-label="Día siguiente">
          <ChevronRight size={14} />
        </Button>
        {actual && actual !== hoy && (
          <Button size="sm" variant="gold" onClick={() => setDia(null)}>Hoy</Button>
        )}
        <input type="date" className="ml-auto text-[12px] border rounded-lg px-2 py-1.5" aria-label="Ir a una fecha"
          value={actual || ''} onChange={e => e.target.value && setDia(e.target.value)} />
      </div>

      {datos?.proximos?.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {datos.proximos.map(p => (
            <button key={p.fecha} onClick={() => setDia(p.fecha)}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${p.fecha === actual ? 'bg-primary-dark text-white border-transparent' : 'bg-white hover:bg-gray-50'}`}
              style={p.fecha === actual ? undefined : { borderColor: 'rgba(30,80,40,0.12)' }}
              title={`${p.programadas} programadas · ${p.enviadas} enviadas · ${p.excluidas} excluidas`}>
              <div className="text-[10px] uppercase opacity-70">{fmtCorto(p.fecha)}</div>
              <div className="text-[13px] font-bold">{p.programadas + p.enviadas}</div>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border-2 p-4 text-[13px]" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Programadas" value={cuenta.PENDIENTE || 0} valueColor="#3B6FBF" />
        <StatCard label="Enviadas" value={cuenta.ENVIADO || 0} valueColor="#166534" />
        <StatCard label="Excluidas" value={cuenta.EXCLUIDO || 0} />
        <StatCard label="Con error / no salió" value={(cuenta.ERROR || 0) + (cuenta.NO_SALIO || 0)} valueColor="#B91C1C" />
      </div>

      {cargando && !datos && (
        <div className="flex items-center justify-center h-32 gap-3">
          <div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span>
        </div>
      )}

      {datos && filas.length === 0 && (
        <div className="rounded-xl border bg-white p-6 text-center text-[13px] text-gray-500" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          No hay ofertas para este día.
          {actual > hoy && <span className="block text-[11px] mt-1">Solo aparecen las de servicios ya entregados: las demás se programan al entregarse.</span>}
        </div>
      )}

      {filas.length > 0 && (
        <div className="rounded-xl border bg-white divide-y" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {filas.map(f => {
            const e = vis(f)
            const est = ESTADO[e] || ESTADO.PENDIENTE
            const resp = RESPUESTA[f.respuesta]
            const tel = f.whatsapp_destino || f.whatsapp
            return (
              <div key={f.id} className="p-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[14rem]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[14px] text-gray-900">🐾 {f.mascota}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: est.bg, color: est.fg }}>{est.label}</span>
                      {f.estado === 'ENVIADO' && f.acuse && (
                        <span className="text-[10px] font-semibold text-gray-500">· {ACUSE[f.acuse] || f.acuse}</span>
                      )}
                      {resp && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: resp.bg, color: resp.fg }}>{resp.label}</span>}
                      {f.forzada && e !== 'EXCLUIDO' && <span className="text-[10px] font-semibold text-gray-500" title="Coordinación la volvió a incluir a mano">· incluida a mano</span>}
                    </div>
                    <div className="text-[12px] text-gray-600 mt-0.5">
                      {f.propietario || 'Sin propietario'} · {f.plan}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
                      <span>Falleció el {fmtCorto(f.fecha_fallecimiento)}</span>
                      <span>Entregado el {fmtCorto(f.fecha_entrega)}</span>
                      {f.fecha_programada !== actual && <span>Programada para el {fmtCorto(f.fecha_programada)}</span>}
                      {f.fecha_envio && <span>Enviada {fmtDateTime(f.fecha_envio)}</span>}
                      {f.abierta_en && <span>Abrió el portal {fmtDateTime(f.abierta_en)}</span>}
                    </div>
                    {e === 'EXCLUIDO' && f.motivo_exclusion && (
                      <div className="text-[11px] mt-1 text-gray-500">
                        Motivo: <strong className="text-gray-700">{f.motivo_exclusion}</strong>
                        {f.excluido_por_nombre ? <> · por {f.excluido_por_nombre}</> : <> · automática</>}
                      </div>
                    )}
                    {e === 'ERROR' && f.error && <div className="text-[11px] mt-1" style={{ color: '#B91C1C' }}>{f.error}</div>}
                    {e === 'NO_SALIO' && (
                      <div className="text-[11px] mt-1" style={{ color: '#9A5500' }}>
                        Su fecha pasó con el envío apagado o fuera de plazo: ya no sale sola. Si quieres que salga, exclúyela y vuelve a incluirla.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {e !== 'EXCLUIDO' && (
                      <button onClick={() => copiarEnlace(f)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        title="Copiar el enlace del portal de esta familia" aria-label="Copiar el enlace del portal">
                        {copiado === f.id ? <Check size={14} className="text-green-700" /> : <Copy size={14} />}
                      </button>
                    )}
                    {tel && (
                      <a href={waLink(tel)} target="_blank" rel="noreferrer"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-green-700 hover:bg-green-50" title={tel} aria-label="Abrir WhatsApp">
                        <MessageCircle size={14} />
                      </a>
                    )}
                    {['PENDIENTE', 'ERROR', 'NO_SALIO'].includes(e) && excluyendo !== f.id && (
                      <Button size="sm" variant="secondary" onClick={() => { setExcluyendo(f.id); setMotivo(''); setNoVolver(false) }}>
                        <EyeOff size={12} /> Excluir
                      </Button>
                    )}
                    {e === 'EXCLUIDO' && (
                      <Button size="sm" variant="secondary" disabled={ocupado === f.id} onClick={() => reincluir(f)}>
                        <RotateCcw size={12} /> {ocupado === f.id ? '…' : 'Volver a incluir'}
                      </Button>
                    )}
                  </div>
                </div>

                {excluyendo === f.id && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2 items-center">
                      <input autoFocus value={motivo} onChange={ev => setMotivo(ev.target.value)} maxLength={300}
                        onKeyDown={ev => ev.key === 'Enter' && excluir(f)}
                        placeholder="¿Por qué no se le envía? (ej.: la familia sigue muy afectada)"
                        className="flex-1 min-w-[14rem] text-[12px] border rounded-lg px-2.5 py-1.5" />
                      <Button size="sm" variant="gold" disabled={!motivo.trim() || ocupado === f.id} onClick={() => excluir(f)}>
                        {ocupado === f.id ? '…' : 'Excluir'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setExcluyendo(null)}>Cancelar</Button>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-[12px] text-gray-600">
                      <input type="checkbox" checked={noVolver} onChange={ev => setNoVolver(ev.target.checked)} className="w-4 h-4 accent-[#1A5CD8]" />
                      Excluir a esta familia de <strong>todas</strong> las ofertas posteriores (queda en «No contactar»)
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* El texto que recibe la familia */}
      {datos?.cuerpo && (
        <section className="rounded-xl border bg-white p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <button className="w-full flex items-center justify-between text-left" onClick={() => setVerMensaje(v => !v)} aria-expanded={verMensaje}>
            <span className="text-[13px] font-semibold text-gray-800">
              El mensaje que recibe la familia
              {cfg?.plantilla && <span className="ml-2 text-[11px] font-normal text-gray-500">plantilla {cfg.plantilla}</span>}
            </span>
            {verMensaje ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {verMensaje && (
            <div className="mt-3 rounded-lg p-3" style={{ background: '#F0FDF4' }}>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-gray-700">
                {datos.cuerpo.replace('{{1}}', filas[0]?.mascota || 'Luna')}
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {(datos.botones || []).map(b => (
                  <span key={b} className="text-center text-[12.5px] font-semibold rounded-lg bg-white border px-3 py-1.5 text-[#1A5CD8]">{b}</span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
