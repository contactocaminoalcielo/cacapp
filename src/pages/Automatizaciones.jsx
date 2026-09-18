// Tablero de lo que Orbit manda SOLO.
//
// Pedido de David el 2026-09-16. Hasta hoy, para saber si el seguimiento de
// imágenes seguía vivo había que abrir Seguimiento; para el aviso a las clínicas,
// no había dónde mirar; y los interruptores viven en `config_operativa`, donde
// solo se ven por psql. Esta pantalla contesta de un vistazo la única pregunta
// que importa: ¿qué está saliendo hoy sin que nadie lo toque, y qué se calló?
//
// Los números NO se calculan aquí: vienen agregados del backend. Las tablas de
// envío pasan de mil filas y contarlas en el navegador daría un número más
// bonito que el real (ver el tope de PostgREST).
import { useState, useEffect, useCallback } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/contexts/ConfirmContext'
import { orbitApi } from '@/lib/orbitApi'
import { fmtDateTime } from '@/lib/utils'
import { RefreshCw, Power, AlertTriangle, Clock, Users, Send, ListChecks, ChevronUp } from 'lucide-react'
import PanelEnvios from '@/components/automatizaciones/PanelEnvios'

/** "hace 2 horas" / "hace 3 días" — lo que se quiere saber es si está vivo. */
function haceCuanto(ts) {
  if (!ts) return null
  const ms = Date.now() - new Date(ts).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1)  return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24)   return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} día${d !== 1 ? 's' : ''}`
}

/**
 * Días sin mandar nada, para el aviso de "mudo".
 * Un flujo diario que lleva 3 días callado casi siempre está roto, no ocioso.
 */
const diasMudo = ts => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null

function Dato({ n, label, color = '#374151' }) {
  return (
    <div className="text-center px-2">
      <div className="text-[19px] font-bold leading-none" style={{ color }}>{n ?? '—'}</div>
      <div className="text-[10px] text-gray-500 mt-1">{label}</div>
    </div>
  )
}

export default function Automatizaciones() {
  const { confirm, alert: showAlert } = useConfirm()
  const [datos,    setDatos]    = useState(null)
  const [error,    setError]    = useState('')
  const [cargando, setCargando] = useState(true)
  const [tocando,  setTocando]  = useState('')   // clave del flujo que se está cambiando
  const [abierto,  setAbierto]  = useState('')   // clave del flujo con la lista de contactos desplegada

  const cargar = useCallback(async () => {
    try {
      setDatos(await orbitApi('/automatizaciones/resumen'))
      setError('')
    } catch (e) {
      setError(e.message || 'No se pudo cargar')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function alternar(f) {
    const encender = !f.activo
    const ok = await confirm(
      encender
        ? `Se va a ENCENDER «${f.nombre}». A partir de la próxima corrida, Orbit le empezará a escribir solo a las familias que cumplan la condición.`
        : `Se va a APAGAR «${f.nombre}». Orbit dejará de enviarlo hasta que lo vuelvas a encender; nadie más recibe aviso de que se apagó.`,
      { title: encender ? '¿Encender el envío?' : '¿Apagar el envío?',
        variant: encender ? 'default' : 'danger',
        confirmLabel: encender ? 'Encender' : 'Apagar' }
    )
    if (!ok) return
    setTocando(f.clave)
    try {
      await orbitApi(`/automatizaciones/${f.clave}/activo`, { method: 'POST', body: { activo: encender } })
      await cargar()
    } catch (e) {
      await showAlert(e.message || 'No se pudo cambiar', { title: 'Error', variant: 'danger' })
    } finally {
      setTocando('')
    }
  }

  const flujos = datos?.flujos || []
  const encendidos = flujos.filter(f => f.activo === true).length
  const conErrores = flujos.filter(f => (f.errores || 0) > 0).length
  const hoyTotal   = flujos.reduce((s, f) => s + (f.hoy || 0), 0)

  return (
    <>
      <Topbar actions={
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          onClick={cargar} title="Actualizar">
          <RefreshCw size={14} />
        </button>
      } />

      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div>
          <p className="text-[13px] text-gray-500 leading-snug max-w-2xl">
            Todo lo que Orbit le manda solo a una familia o a una clínica, en un solo lugar:
            si está encendido, cuánto salió hoy, cuándo fue lo último y qué falló. Con «Ver contactos» se ve a quién le llegó, a quién no, y se relanza lo que falló.
            Los interruptores de aquí son los de verdad — los mismos que leen los jobs.
          </p>
          {datos && (
            <div className="flex flex-wrap gap-4 mt-3 text-[12px] text-gray-600">
              <span><strong>{encendidos}</strong> de {flujos.length} encendidos</span>
              <span><strong>{hoyTotal}</strong> mensajes hoy</span>
              {conErrores > 0 && (
                <span className="font-semibold" style={{ color: '#B91C1C' }}>
                  {conErrores} flujo{conErrores !== 1 ? 's' : ''} con errores
                </span>
              )}
            </div>
          )}
        </div>

        {cargando && (
          <div className="flex items-center justify-center h-40 gap-3">
            <div className="spinner" /><span className="text-sm text-gray-500">Cargando…</span>
          </div>
        )}

        {error && !cargando && (
          <div className="rounded-xl border-2 p-4 text-[13px]" style={{ borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>
            {error}
          </div>
        )}

        {flujos.map(f => {
          const mudo = f.activo === true && f.disponible && diasMudo(f.ultimo_envio) >= 3
          return (
            <section key={f.clave} className="rounded-xl border bg-white p-5 shadow-sm"
              style={{ borderColor: f.activo === false ? '#E5E7EB' : 'rgba(30,80,40,0.12)', opacity: f.activo === false ? 0.85 : 1 }}>

              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[15rem]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-[15px] text-gray-900">{f.nombre}</h2>
                    {f.activo === true && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#166534' }}>ENCENDIDO</span>
                    )}
                    {f.activo === false && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#F3F4F6', color: '#6B7280' }}>APAGADO</span>
                    )}
                    {f.activo === null && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EEF3FB', color: '#3B6FBF' }}>SIN INTERRUPTOR</span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-500 mt-1 leading-snug">{f.descripcion}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-1"><Users size={11} /> {f.quien}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> {f.cron}</span>
                    {f.plantilla && <span className="inline-flex items-center gap-1"><Send size={11} /> {f.plantilla}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {f.disponible && (
                    <Button size="sm" variant="secondary" onClick={() => setAbierto(abierto === f.clave ? '' : f.clave)}>
                      {abierto === f.clave ? <ChevronUp size={12} /> : <ListChecks size={12} />}
                      {abierto === f.clave ? 'Ocultar' : 'Ver contactos'}
                    </Button>
                  )}
                  {f.interruptor && (
                    <Button size="sm" variant={f.activo ? 'secondary' : 'gold'} disabled={tocando === f.clave}
                      onClick={() => alternar(f)}>
                      <Power size={12} /> {tocando === f.clave ? '…' : (f.activo ? 'Apagar' : 'Encender')}
                    </Button>
                  )}
                </div>
              </div>

              {!f.disponible ? (
                <div className="mt-4 rounded-lg px-3.5 py-2.5 text-[12px]" style={{ background: '#FFFBEB', color: '#92400E' }}>
                  Todavía no hay datos de este flujo — falta aplicar su migración en la base.
                </div>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3" style={{ background: '#FAFAF9' }}>
                    <div className="flex items-center gap-1">
                      <Dato n={f.hoy} label="hoy" color="#166534" />
                      <Dato n={f.semana} label="7 días" />
                      <Dato n={f.mes} label="30 días" />
                      <Dato n={f.total} label="histórico" />
                      {f.pendientes > 0 && <Dato n={f.pendientes} label="por enviar" color="#9A5500" />}
                      {f.errores > 0 && <Dato n={f.errores} label="con error" color="#B91C1C" />}
                    </div>
                    <div className="text-[11px] text-gray-500 text-right">
                      {f.ultimo_envio ? (
                        <>Último: <strong className="text-gray-700">{haceCuanto(f.ultimo_envio)}</strong>
                          <div className="text-[10px]">{fmtDateTime(f.ultimo_envio)}</div></>
                      ) : 'Nunca ha enviado'}
                    </div>
                  </div>

                  {/* Un flujo diario que lleva días callado casi nunca es que no
                      hubo casos: es que algo se rompió y nadie se enteró. */}
                  {mudo && (
                    <div className="mt-2 rounded-lg px-3.5 py-2.5 text-[12px] flex items-start gap-2"
                      style={{ background: '#FEF2F2', color: '#991B1B' }}>
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>
                        Está encendido pero no manda nada desde hace {diasMudo(f.ultimo_envio)} días.
                        Puede que no haya casos, o puede que se haya roto: vale la pena mirarlo.
                      </span>
                    </div>
                  )}

                  {f.activo === true && !f.plantilla && f.interruptor && (
                    <div className="mt-2 rounded-lg px-3.5 py-2.5 text-[12px]" style={{ background: '#FFFBEB', color: '#92400E' }}>
                      Encendido pero <strong>sin plantilla aprobada</strong>: los avisos se acumulan sin salir.
                    </div>
                  )}

                  {/* La lista contacto por contacto: a quién le llegó, a quién no, y relanzar. */}
                  {abierto === f.clave && <PanelEnvios flujo={f} onCambio={cargar} />}
                </>
              )}
            </section>
          )
        })}

        {datos && (
          <p className="text-[11px] text-gray-400 text-center pb-4">
            Actualizado {fmtDateTime(datos.generado_en)}
          </p>
        )}
      </div>
    </>
  )
}
