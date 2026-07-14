import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { Clock } from 'lucide-react'

// ── Línea de tiempo de la recogida ────────────────────────────────────────────
// Todas las horas del servicio en un solo lugar, en el orden en que ocurren.
// La usan la ficha del servicio (Gestión › Historial) y el modal del Kanban.
//
// De dónde sale cada hora (son fuentes distintas, no una sola tabla):
//   asignación del técnico  → servicios.tecnico_asignado_en   (trigger, migración 047)
//   estimada por el técnico → recogidas.hora_programada       (la promete al iniciar ruta;
//                                                              NO es una cita agendada:
//                                                              nadie programa hora en Orbit)
//   salió a ruta            → novedades_servicio 'INGRESADO → EN_RECOGIDA'
//   llegada real            → recogidas.hora_llegada          (migración 045)
//   cierre de la recogida   → recogidas.hora_realizada
//   ingreso a la nevera     → cuarto_frio.fecha_ingreso_real  (migración 046)
//
// Los servicios anteriores a estas migraciones no tienen las horas nuevas: se
// muestran como "sin registro" en gris, nunca se rellenan con datos inventados.

const fmtHora = ts => ts
  ? new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  : null
const fmtFecha = ts => ts
  ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
  : null

// Combina columnas DATE + TIME (hora local de Bogotá) en un Date real
function unir(fecha, hora) {
  if (!fecha || !hora) return null
  const d = new Date(`${fecha}T${String(hora).slice(0, 8)}`)
  return isNaN(d) ? null : d
}

function fmtDur(mins) {
  if (mins == null) return null
  const abs = Math.abs(mins)
  const txt = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h ${abs % 60} min`
  return { txt, mins }
}

function diffMin(desde, hasta) {
  if (!desde || !hasta) return null
  return Math.round((hasta - desde) / 60000)
}

export default function LineaTiempoServicio({ servicioId, compacto = false }) {
  const [datos,   setDatos]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!servicioId) return
    let vivo = true
    ;(async () => {
      setLoading(true)
      const [svc, rec, cf, nov] = await Promise.all([
        db.from('servicios')
          .select('tecnico_asignado_en, tecnico:tecnico_id(nombre, apellido)')
          .eq('id', servicioId).maybeSingle(),
        // limit(1) y no maybeSingle() a secas: si un servicio llegara a tener dos
        // filas (pasó con recogidas), maybeSingle() reventaría y se caería la ficha.
        db.from('recogidas')
          .select('hora_programada, fecha_llegada, hora_llegada, fecha_realizada, hora_realizada, quien_llegada:llegada_registrada_por(nombre, apellido)')
          .eq('servicio_id', servicioId)
          .order('created_at', { ascending: true }).limit(1).maybeSingle(),
        db.from('cuarto_frio')
          .select('fecha_ingreso_real, registrador:registrado_por(nombre, apellido)')
          .eq('servicio_id', servicioId)
          .order('created_at', { ascending: true }).limit(1).maybeSingle(),
        db.from('novedades_servicio')
          .select('descripcion, created_at')
          .eq('servicio_id', servicioId)
          .eq('tipo_novedad', 'CAMBIO_ESTADO')
          .order('created_at', { ascending: true }),
      ])
      if (!vivo) return
      setDatos({
        svc: svc.data || null,
        rec: rec.data || null,
        cf:  cf.data  || null,
        // Primera vez que el servicio pasó a EN_RECOGIDA = cuando salió a ruta
        salidaRuta: (nov.data || []).find(n => (n.descripcion || '').includes('→ EN_RECOGIDA'))?.created_at || null,
      })
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [servicioId])

  if (loading) return <div className="text-[11px] text-gray-400 py-2">Cargando horas…</div>
  if (!datos)  return null

  const { svc, rec, cf, salidaRuta } = datos

  const llegada  = unir(rec?.fecha_llegada,   rec?.hora_llegada)
  const cierre   = unir(rec?.fecha_realizada, rec?.hora_realizada)
  const estimada = rec?.hora_programada && rec?.fecha_llegada
    ? unir(rec.fecha_llegada, rec.hora_programada)
    : null
  const nevera   = cf?.fecha_ingreso_real ? new Date(cf.fecha_ingreso_real) : null

  const tecnico = svc?.tecnico ? `${svc.tecnico.nombre} ${svc.tecnico.apellido}` : null

  const hitos = [
    {
      label: 'Asignación del técnico',
      hora:  fmtHora(svc?.tecnico_asignado_en),
      fecha: fmtFecha(svc?.tecnico_asignado_en),
      sub:   tecnico,
      color: '#6B7280',
    },
    {
      label: 'Estimada por el técnico',
      hora:  rec?.hora_programada ? String(rec.hora_programada).slice(0, 5) : null,
      sub:   'La que prometió al iniciar ruta',
      color: '#0E7490',
    },
    {
      label: 'Salió a ruta',
      hora:  fmtHora(salidaRuta),
      fecha: fmtFecha(salidaRuta),
      color: '#1A5CD8',
    },
    {
      label: 'Llegada al sitio',
      hora:  rec?.hora_llegada ? String(rec.hora_llegada).slice(0, 5) : null,
      fecha: fmtFecha(llegada),
      sub:   rec?.quien_llegada ? `Confirmada por ${rec.quien_llegada.nombre}` : null,
      color: '#7C3AED',
      fuerte: true,
    },
    {
      label: 'Cierre de la recogida',
      hora:  rec?.hora_realizada ? String(rec.hora_realizada).slice(0, 5) : null,
      fecha: fmtFecha(cierre),
      color: '#22C55E',
    },
    {
      label: 'Ingreso a la nevera',
      hora:  fmtHora(cf?.fecha_ingreso_real),
      fecha: fmtFecha(cf?.fecha_ingreso_real),
      sub:   cf?.registrador ? `Registrado por ${cf.registrador.nombre}` : null,
      color: '#0891B2',
    },
  ]

  // Métricas derivadas — solo se muestran cuando existen las dos puntas
  const enSitio  = fmtDur(diffMin(llegada, cierre))
  const vsEstim  = fmtDur(diffMin(estimada, llegada))
  const aNevera  = fmtDur(diffMin(cierre, nevera))

  return (
    <div className={compacto ? '' : 'bg-gray-50 rounded-xl p-3'}>
      {!compacto && (
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
          <Clock size={12} /> Línea de tiempo
        </div>
      )}

      <div className="space-y-0">
        {hitos.map((h, i) => {
          const registrado = !!h.hora
          return (
            <div key={h.label} className="flex gap-2.5">
              {/* Riel: punto + línea */}
              <div className="flex flex-col items-center pt-1">
                <div className="rounded-full flex-shrink-0" style={{
                  width: h.fuerte && registrado ? 10 : 8,
                  height: h.fuerte && registrado ? 10 : 8,
                  background: registrado ? h.color : '#E5E7EB',
                  boxShadow: h.fuerte && registrado ? `0 0 0 3px ${h.color}22` : 'none',
                }} />
                {i < hitos.length - 1 && (
                  <div className="flex-1 w-px my-0.5" style={{ background: registrado ? '#E5E7EB' : '#F3F4F6', minHeight: 14 }} />
                )}
              </div>

              <div className="flex-1 min-w-0 pb-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[11px] ${registrado ? 'font-semibold text-gray-800' : 'font-medium text-gray-400'}`}>
                    {h.label}
                  </span>
                  {registrado ? (
                    <span className="text-[12px] font-bold tabular-nums flex-shrink-0" style={{ color: h.color }}>
                      {h.hora}
                      {h.fecha && <span className="text-[10px] font-medium text-gray-400 ml-1">{h.fecha}</span>}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300 flex-shrink-0">sin registro</span>
                  )}
                </div>
                {registrado && h.sub && (
                  <div className="text-[10px] text-gray-400 mt-0.5 truncate">{h.sub}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(enSitio || vsEstim || aNevera) && (
        <div className="flex flex-wrap gap-1.5 mt-1 pt-2.5 border-t border-gray-200">
          {vsEstim && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={vsEstim.mins > 15
                ? { background: '#FEE2E2', color: '#991B1B' }
                : { background: '#DCFCE7', color: '#166534' }}
              title="Diferencia entre la hora que prometió el técnico y su llegada real">
              {vsEstim.mins > 0 ? `Llegó ${vsEstim.txt} tarde` : vsEstim.mins < 0 ? `Llegó ${vsEstim.txt} antes` : 'Llegó a la hora'}
            </span>
          )}
          {enSitio && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#5B21B6' }}
              title="Desde que confirmó la llegada hasta que cerró la recogida">
              {enSitio.txt} en sitio
            </span>
          )}
          {aNevera && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#ECFEFF', color: '#155E75' }}
              title="Desde el cierre de la recogida hasta el ingreso a la nevera">
              {aNevera.txt} hasta la nevera
            </span>
          )}
        </div>
      )}
    </div>
  )
}
