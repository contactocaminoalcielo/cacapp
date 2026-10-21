import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CheckCircle2, RotateCcw, XCircle, CalendarPlus } from 'lucide-react'
import { crm, TIPOS_GESTION, fechaHora, relativo } from '@/lib/crmApi'
import { hoyLocalISO } from '@/lib/utils'
import { Cabecera, Cargando, ErrorCaja, Vacio, ACENTO } from '@/components/crm/ui'
import { RegistrarGestion, SeguimientoModal } from '@/components/crm/Modales'
import { useCrm } from '@/components/crm/CrmContext'
import NuevaVisitaModal from '@/components/crm/NuevaVisitaModal'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
const TIPOS_VISITA = ['VISITA', 'REUNION']

const COLORES_ESTADO = {
  PENDIENTE: ACENTO,
  HECHO:     '#059669',
  CANCELADO: '#9CA3AF',
}

/** Fecha ISO YYYY-MM-DD en zona Bogotá. */
function enBogota(ts) {
  if (!ts) return null
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

export default function Visitas() {
  const { refrescarAlertas } = useCrm()
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth())
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [tiposFiltro, setTiposFiltro] = useState(TIPOS_VISITA)
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [diaSeleccionado, setDiaSeleccionado] = useState(hoyLocalISO())
  const [modal, setModal] = useState(null)   // 'nueva' | 'gestion' | 'seguimiento'
  const [sel, setSel] = useState(null)

  const primerDia = new Date(anio, mes, 1)
  const ultimoDia = new Date(anio, mes + 1, 0)
  const desde = hoyLocalISO(primerDia)
  const hasta = hoyLocalISO(ultimoDia)

  const cargar = useCallback(() => {
    setError(null)
    setLista(null)
    crm.seguimientos('pendientes', false, { desde, hasta, tipos: tiposFiltro.join(',') })
      .then(r => setLista(r.seguimientos || []))
      .catch(e => setError(e.message))
  }, [desde, hasta, tiposFiltro])

  useEffect(() => { cargar() }, [cargar])

  const porDia = useMemo(() => {
    if (!lista) return {}
    const m = {}
    for (const s of lista) {
      const d = enBogota(s.programado_para)
      if (!d) continue
      if (!m[d]) m[d] = []
      m[d].push(s)
    }
    return m
  }, [lista])

  const diasDelDia = useMemo(() => (porDia[diaSeleccionado] || []).slice().sort((a, b) =>
    new Date(a.programado_para) - new Date(b.programado_para)
  ), [porDia, diaSeleccionado])

  function prevMes() {
    if (mes === 0) { setMes(11); setAnio(a => a - 1) } else setMes(m => m - 1)
  }
  function nextMes() {
    if (mes === 11) { setMes(0); setAnio(a => a + 1) } else setMes(m => m + 1)
  }

  function toggleTipo(t) {
    setTiposFiltro(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function accion(s, a) {
    if (a === 'gestion')     { setSel(s); setModal('gestion');     return }
    if (a === 'reprogramar') { setSel(s); setModal('seguimiento'); return }
    await crm.cambiarSeguimiento(s.id, { accion: a }).catch(e => setError(e.message))
    refrescarAlertas(); cargar()
  }

  const inicio = primerDia.getDay()
  const totalDias = ultimoDia.getDate()
  const filas = Math.ceil((inicio + totalDias) / 7)
  const celdas = Array.from({ length: filas * 7 }, (_, i) => {
    const dia = i - inicio + 1
    if (dia < 1 || dia > totalDias) return null
    return hoyLocalISO(new Date(anio, mes, dia))
  })

  const todaySql = hoyLocalISO()

  const resumen = {
    total:      lista?.length ?? 0,
    hechas:     lista?.filter(s => s.estado === 'HECHO').length ?? 0,
    pendientes: lista?.filter(s => s.estado === 'PENDIENTE').length ?? 0,
    vencidas:   lista?.filter(s => s.estado === 'PENDIENTE' && new Date(s.programado_para) < new Date()).length ?? 0,
  }

  const destioDe = s => s.aliado_id ? { aliado_id: s.aliado_id } : s.prospecto_id ? { prospecto_id: s.prospecto_id } : null

  return (
    <div className="max-w-6xl mx-auto">
      <Cabecera titulo="Visitas presenciales" sub="Calendario de visitas y reuniones con veterinarias aliadas y prospectos.">
        <button
          onClick={() => setModal('nueva')}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white"
          style={{ background: ACENTO }}>
          <CalendarPlus size={14} /> Programar visita
        </button>
      </Cabecera>

      <ErrorCaja error={error} onReintentar={cargar} />

      {/* Filtros de tipo */}
      <div className="flex flex-wrap gap-2 mt-3 mb-4">
        {TIPOS_VISITA.map(t => (
          <button key={t} onClick={() => toggleTipo(t)}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold border transition ${
              tiposFiltro.includes(t) ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 bg-white'
            }`}
            style={tiposFiltro.includes(t) ? { background: ACENTO } : undefined}>
            {TIPOS_GESTION[t]?.emoji} {TIPOS_GESTION[t]?.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calendario */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <button onClick={prevMes} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500">
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-[15px] font-bold text-gray-900">{MESES[mes]} {anio}</h2>
            <button onClick={nextMes} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-gray-50">
            {DIAS.map(d => (
              <div key={d} className="py-2 text-center text-[11px] font-bold uppercase tracking-wider text-gray-400">{d}</div>
            ))}
          </div>

          {!lista ? (
            <div className="p-8"><Cargando /></div>
          ) : (
            <div className="grid grid-cols-7">
              {celdas.map((fecha, i) => {
                if (!fecha) return <div key={i} className="min-h-[72px] border-b border-r border-gray-50 bg-gray-50/30" />
                const eventos = porDia[fecha] || []
                const esHoy = fecha === todaySql
                const esSel = fecha === diaSeleccionado
                const pendientes = eventos.filter(e => e.estado === 'PENDIENTE')
                const hechos     = eventos.filter(e => e.estado === 'HECHO')
                return (
                  <button key={fecha} onClick={() => setDiaSeleccionado(fecha)}
                    className={`min-h-[72px] p-1.5 text-left border-b border-r border-gray-50 transition ${
                      esSel ? 'bg-teal-50' : 'hover:bg-gray-50'
                    }`}>
                    <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[12px] font-semibold mb-0.5 ${
                      esHoy ? 'text-white' : esSel ? 'text-teal-700' : 'text-gray-700'
                    }`} style={esHoy ? { background: ACENTO } : undefined}>
                      {new Date(fecha + 'T12:00:00').getDate()}
                    </span>
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {pendientes.slice(0, 4).map(e => (
                        <span key={e.id}
                          title={`${TIPOS_GESTION[e.tipo]?.emoji} ${e.aliado_nombre || e.prospecto_nombre || ''}`}
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: ACENTO }} />
                      ))}
                      {hechos.slice(0, 2).map(e => (
                        <span key={e.id} className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
                      ))}
                      {eventos.length > 6 && (
                        <span className="text-[9px] text-gray-400 font-semibold leading-none self-center">+{eventos.length - 6}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <div className="px-4 py-2 flex gap-4 text-[11px] text-gray-400 border-t border-gray-50">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: ACENTO }} /> Pendiente
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block bg-green-400" /> Realizada
            </span>
          </div>
        </div>

        {/* Panel lateral */}
        <div className="space-y-3">
          {/* Día seleccionado */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-gray-900">
                {diaSeleccionado
                  ? new Date(diaSeleccionado + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
                  : 'Selecciona un día'}
              </h3>
              <button onClick={() => setModal('nueva')} className="text-[12px] font-semibold" style={{ color: ACENTO }}>
                + Visita
              </button>
            </div>

            {!lista ? <Cargando /> : !diasDelDia.length ? (
              <Vacio>Sin visitas este día.</Vacio>
            ) : (
              <div className="space-y-2.5">
                {diasDelDia.map(s => {
                  const nombre = s.aliado_nombre || s.prospecto_nombre || '—'
                  const ruta   = s.aliado_id ? `/crm/veterinarias/${s.aliado_id}` : s.prospecto_id ? `/crm/prospectos/${s.prospecto_id}` : null
                  const vencido = s.estado === 'PENDIENTE' && new Date(s.programado_para) < new Date()
                  return (
                    <div key={s.id} className={`rounded-xl border p-2.5 ${vencido ? 'border-red-200 bg-red-50/40' : 'border-gray-100'}`}>
                      <div className="flex items-start gap-2">
                        <span className="text-[18px] leading-none mt-0.5 flex-shrink-0">{TIPOS_GESTION[s.tipo]?.emoji}</span>
                        <div className="flex-1 min-w-0">
                          {ruta
                            ? <Link to={ruta} className="text-[12.5px] font-semibold text-gray-900 no-underline hover:underline block truncate">{nombre}</Link>
                            : <div className="text-[12.5px] font-semibold text-gray-900 truncate">{nombre}</div>}
                          <div className="text-[12px] text-gray-700">{s.titulo}</div>
                          {s.notas && <div className="text-[11px] text-gray-500 whitespace-pre-wrap line-clamp-2">{s.notas}</div>}
                          <div className={`text-[11px] mt-0.5 ${vencido ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                            {fechaHora(s.programado_para)} · {relativo(s.programado_para)}
                            {s.responsable ? ` · ${s.responsable}` : ''}
                          </div>
                          {s.estado !== 'PENDIENTE' && (
                            <div className="text-[11px] font-semibold mt-0.5" style={{ color: COLORES_ESTADO[s.estado] }}>
                              ✓ {s.estado.toLowerCase()}
                            </div>
                          )}
                        </div>
                      </div>
                      {s.estado === 'PENDIENTE' && (
                        <div className="flex gap-2 mt-1.5 ml-7">
                          {destioDe(s) && (
                            <button onClick={() => accion(s, 'gestion')}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: ACENTO }}>
                              <CheckCircle2 size={11} /> Registrar
                            </button>
                          )}
                          <button onClick={() => accion(s, 'reprogramar')} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                            <RotateCcw size={10} /> Mover
                          </button>
                          <button onClick={() => accion(s, 'cancelar')} className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                            <XCircle size={10} /> Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Resumen del mes */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
              Resumen · {MESES[mes]}
            </h3>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Stat label="Total"      valor={resumen.total}      />
              <Stat label="Hechas"     valor={resumen.hechas}     color="#059669" />
              <Stat label="Pendientes" valor={resumen.pendientes} color={ACENTO} />
            </div>
            {resumen.vencidas > 0 && (
              <div className="text-[11.5px] text-red-600 font-semibold">
                ⚠️ {resumen.vencidas} visita(s) vencida(s)
              </div>
            )}
          </div>
        </div>
      </div>

      <NuevaVisitaModal
        abierto={modal === 'nueva'}
        onCerrar={() => setModal(null)}
        fechaInicial={diaSeleccionado}
        onGuardado={() => { refrescarAlertas(); cargar() }}
      />
      <RegistrarGestion
        abierto={modal === 'gestion'}
        onCerrar={() => setModal(null)}
        destino={sel ? destioDe(sel) : null}
        seguimiento={sel}
        tipoInicial="VISITA"
        onGuardado={() => { refrescarAlertas(); cargar() }}
      />
      <SeguimientoModal
        abierto={modal === 'seguimiento'}
        onCerrar={() => setModal(null)}
        destino={sel ? destioDe(sel) : null}
        existente={sel}
        onGuardado={() => { refrescarAlertas(); cargar() }}
      />
    </div>
  )
}

function Stat({ label, valor, color }) {
  return (
    <div className="rounded-xl bg-gray-50 p-2.5 text-center">
      <div className="text-[18px] font-bold tabular-nums" style={{ color: color || '#374151' }}>{valor}</div>
      <div className="text-[10.5px] text-gray-400">{label}</div>
    </div>
  )
}
