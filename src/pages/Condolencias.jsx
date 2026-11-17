// CONDOLENCIAS — la vista diaria de los mensajes al mes del fallecimiento (migr. 209).
//
// REPORTE ORBIT 2026-11-17: «que el equipo pueda verificar diariamente qué
// mensajes están programados». Una fila por mascota con su estado:
// Programada · Enviada · Excluida · Con error.
//
// Las reglas viven en el backend (orbit-backend/src/condolencias.js): aquí no se
// calcula ninguna fecha de envío. Al abrir la pantalla el backend además PREPARA
// lo que falte, así que lo programado está al día aunque el job no haya corrido.
import { useState, useEffect, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/card'
import { orbitApi } from '@/lib/orbitApi'
import { useConfirm } from '@/contexts/ConfirmContext'
import { parseDate, fmtDateTime, waLink } from '@/lib/utils'
import { RefreshCw, ChevronLeft, ChevronRight, EyeOff, RotateCcw, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react'

const ESTADO = {
  PENDIENTE: { label: 'Programada', bg: '#EEF3FB', fg: '#3B6FBF' },
  ENVIANDO:  { label: 'Enviando',   bg: '#EEF3FB', fg: '#3B6FBF' },
  ENVIADO:   { label: 'Enviada',    bg: '#DCFCE7', fg: '#166534' },
  ERROR:     { label: 'Con error',  bg: '#FEE2E2', fg: '#B91C1C' },
  EXCLUIDO:  { label: 'Excluida',   bg: '#F3F4F6', fg: '#6B7280' },
  NO_SALIO:  { label: 'No salió',   bg: '#FFF8E6', fg: '#9A5500' },
}
const ACUSE = { sent: 'Enviado', delivered: 'Le llegó', read: 'Leído', failed: 'No llegó' }

const fmtDia = iso => parseDate(iso)?.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
const fmtCorto = iso => parseDate(iso)?.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
const sumarDias = (iso, n) => {
  const d = parseDate(iso); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const diasEntre = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)

/** Igual que `nombreMascota` del backend: "GATURRIS" → "Gaturris" en la vista previa. */
const nombreBonito = s => (s && s === s.toUpperCase())
  ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  : (s || 'Luna')

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

export default function Condolencias() {
  const { alert: showAlert } = useConfirm()
  const [datos, setDatos]       = useState(null)
  const [dia, setDia]           = useState(null)      // null = hoy (lo decide el backend)
  const [cargando, setCargando] = useState(true)
  const [error, setError]       = useState('')
  const [excluyendo, setExcluyendo] = useState(null)  // id de la fila con el formulario abierto
  const [motivo, setMotivo]     = useState('')
  const [ocupado, setOcupado]   = useState('')
  const [verEsperando, setVerEsperando] = useState(false)
  const [verMensaje, setVerMensaje]     = useState(false)

  const cargar = useCallback(async (fecha = dia) => {
    setCargando(true)
    try {
      const r = await orbitApi(`/condolencias${fecha ? `?fecha=${fecha}` : ''}`)
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
      await orbitApi(`/condolencias/${f.id}/excluir`, { method: 'POST', body: { motivo } })
      setExcluyendo(null); setMotivo('')
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo excluir' })
    } finally { setOcupado('') }
  }

  async function reincluir(f) {
    setOcupado(f.id)
    try {
      await orbitApi(`/condolencias/${f.id}/reincluir`, { method: 'POST' })
      await cargar()
    } catch (e) {
      showAlert(e.message, { title: 'No se pudo reincluir' })
    } finally { setOcupado('') }
  }

  const hoy = datos?.hoy
  const actual = datos?.dia
  const filas = datos?.filas || []
  const cfg = datos?.config
  const vis = f => estadoVisible(f, datos)
  const cuenta = filas.reduce((a, f) => {
    const e = vis(f) === 'ENVIANDO' ? 'PENDIENTE' : vis(f)
    a[e] = (a[e] || 0) + 1
    return a
  }, {})

  return (
    <>
      <Topbar actions={
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          onClick={() => cargar()} title="Actualizar">
          <RefreshCw size={14} />
        </button>
      } />

      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <p className="text-[13px] text-gray-500 leading-snug max-w-2xl">
          Un mensaje de cariño recordando a la mascotica al cumplirse <strong>{cfg?.dias ?? 30} días</strong> de su fallecimiento.
          Solo a las familias a las que <strong>ya se les entregó</strong>, y nunca antes de {cfg?.tras ?? 3} días después de la entrega
          (para no pisar la encuesta). Sale a las 11:00, de lunes a viernes; lo del fin de semana y los festivos sale el siguiente día hábil.
        </p>

        {cfg && (!cfg.activo || !cfg.plantilla) && (
          <div className="rounded-lg border border-[#FFD980] bg-[#FFF8E6] text-[#9A5500] p-3 text-[12px]">
            {!cfg.plantilla
              ? 'Todavía no hay plantilla aprobada por Meta: lo programado se ve aquí, pero no sale nada.'
              : 'Las condolencias están APAGADAS en /automatizaciones: lo programado se ve aquí, pero no sale nada. Al encenderlas, arrancan desde ese día (nada de atrasadas).'}
          </div>
        )}

        {/* Navegación por día */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!actual} onClick={() => setDia(sumarDias(actual, -1))}>
            <ChevronLeft size={14} />
          </Button>
          <div className="text-[15px] font-semibold text-gray-900 min-w-[14rem] text-center">
            {actual === hoy ? 'Condolencias de hoy' : actual ? <span className="capitalize">{fmtDia(actual)}</span> : '…'}
            {actual && actual === hoy && <span className="block text-[11px] font-normal text-gray-500 capitalize">{fmtDia(actual)}</span>}
          </div>
          <Button size="sm" variant="secondary" disabled={!actual} onClick={() => setDia(sumarDias(actual, 1))}>
            <ChevronRight size={14} />
          </Button>
          {actual && actual !== hoy && (
            <Button size="sm" variant="gold" onClick={() => setDia(null)}>Hoy</Button>
          )}
          <input type="date" className="ml-auto text-[12px] border rounded-lg px-2 py-1.5"
            value={actual || ''} onChange={e => e.target.value && setDia(e.target.value)} />
        </div>

        {/* Próximos días: lo ya programado (servicios entregados) */}
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
            No hay condolencias para este día.
            {actual > hoy && <span className="block text-[11px] mt-1">Solo aparecen las de servicios ya entregados: las demás se programan al entregarse.</span>}
          </div>
        )}

        {filas.length > 0 && (
          <div className="rounded-xl border bg-white divide-y" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {filas.map(f => {
              const e = vis(f)
              const est = ESTADO[e] || ESTADO.PENDIENTE
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
                      </div>
                      <div className="text-[12px] text-gray-600 mt-0.5">
                        {f.propietario || 'Sin propietario'} · {f.plan}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
                        <span>Falleció el {fmtCorto(f.fecha_fallecimiento)}</span>
                        <span>Entregado el {fmtCorto(f.fecha_entrega)}</span>
                        {f.fecha_programada !== actual && <span>Programada para el {fmtCorto(f.fecha_programada)}</span>}
                        {f.fecha_envio && <span>Enviada {fmtDateTime(f.fecha_envio)}</span>}
                      </div>
                      {e === 'EXCLUIDO' && f.motivo_exclusion && (
                        <div className="text-[11px] mt-1 text-gray-500">
                          Motivo: <strong className="text-gray-700">{f.motivo_exclusion}</strong>
                          {f.excluido_por_nombre && <> · por {f.excluido_por_nombre}</>}
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
                      {tel && (
                        <a href={waLink(tel)} target="_blank" rel="noreferrer"
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-green-700 hover:bg-green-50" title={tel}>
                          <MessageCircle size={14} />
                        </a>
                      )}
                      {['PENDIENTE', 'ERROR', 'NO_SALIO'].includes(e) && excluyendo !== f.id && (
                        <Button size="sm" variant="secondary" onClick={() => { setExcluyendo(f.id); setMotivo('') }}>
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
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <input autoFocus value={motivo} onChange={ev => setMotivo(ev.target.value)} maxLength={300}
                        onKeyDown={ev => ev.key === 'Enter' && excluir(f)}
                        placeholder="¿Por qué no se le envía? (ej.: la familia pidió no ser contactada)"
                        className="flex-1 min-w-[14rem] text-[12px] border rounded-lg px-2.5 py-1.5" />
                      <Button size="sm" variant="gold" disabled={!motivo.trim() || ocupado === f.id} onClick={() => excluir(f)}>
                        {ocupado === f.id ? '…' : 'Excluir'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setExcluyendo(null)}>Cancelar</Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Cumplieron el mes y siguen sin entregar */}
        {datos?.esperando?.length > 0 && (
          <section className="rounded-xl border bg-white p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <button className="w-full flex items-center justify-between text-left" onClick={() => setVerEsperando(v => !v)}>
              <span className="text-[13px] font-semibold text-gray-800">
                {datos.esperando.length} cumplieron el mes y aún no se entregan
                <span className="block text-[11px] font-normal text-gray-500">
                  {cfg?.tardia
                    ? `Su condolencia se programa sola ${cfg.tras} días después de entregar.`
                    : 'Con la configuración actual NO recibirán condolencia (se entregaron tarde).'}
                </span>
              </span>
              {verEsperando ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {verEsperando && (
              <div className="mt-3 divide-y text-[12px]">
                {datos.esperando.map(s => (
                  <div key={s.servicio_id} className="py-1.5 flex flex-wrap gap-x-3">
                    <span className="font-semibold text-gray-800">🐾 {s.mascota}</span>
                    <span className="text-gray-500">{s.plan}</span>
                    <span className="text-gray-500">{s.estado}</span>
                    <span className="text-gray-500">hace {s.dias} días</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* El texto que recibe la familia */}
        {datos?.cuerpo && (
          <section className="rounded-xl border bg-white p-4" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <button className="w-full flex items-center justify-between text-left" onClick={() => setVerMensaje(v => !v)}>
              <span className="text-[13px] font-semibold text-gray-800">
                El mensaje que recibe la familia
                {cfg?.plantilla && <span className="ml-2 text-[11px] font-normal text-gray-500">plantilla {cfg.plantilla}</span>}
              </span>
              {verMensaje ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {verMensaje && (
              <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-gray-700 rounded-lg p-3" style={{ background: '#F0FDF4' }}>
                {datos.cuerpo.replace('{{1}}', nombreBonito(filas[0]?.mascota))}
              </p>
            )}
          </section>
        )}
      </div>
    </>
  )
}
