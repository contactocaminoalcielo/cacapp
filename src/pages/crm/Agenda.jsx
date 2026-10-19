import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, MessageCircle, CheckCircle2, RotateCcw, XCircle, Sparkles, CalendarPlus } from 'lucide-react'
import { crm, TIPOS_GESTION, fechaHora, relativo, telHref, waHref, haceDias, atajoFecha } from '@/lib/crmApi'
import { Cabecera, Cargando, ErrorCaja, Pestanas, Vacio, Seccion, SegmentoChip, TendenciaChip, ACENTO } from '@/components/crm/ui'
import { RegistrarGestion, SeguimientoModal } from '@/components/crm/Modales'
import { useCrm } from '@/components/crm/CrmContext'

export default function Agenda() {
  const { refrescarAlertas } = useCrm()
  const [rango, setRango] = useState('hoy')
  const [mios, setMios] = useState(false)
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)
  const [modal, setModal] = useState(null)
  const [sugeridas, setSugeridas] = useState([])

  const cargar = useCallback(() => {
    setError(null)
    crm.seguimientos(rango, mios).then(r => setLista(r.seguimientos || [])).catch(e => setError(e.message))
  }, [rango, mios])
  useEffect(() => { setLista(null); cargar() }, [cargar])

  const cargarSugeridas = useCallback(() => {
    crm.cartera().then(r => {
      const peso = v => ((Number(v.s90) || 0) + (Number(v.s90_180) || 0)) * ({ ALTO: 3, MEDIO: 2 }[v.riesgo] || 0)
      setSugeridas((r.aliados || [])
        .filter(v => v.estado === 'activo' && !v.no_contactar && Number(v.total) > 0 && ['ALTO', 'MEDIO'].includes(v.riesgo) && !v.proximo_seguimiento && v.sin_contacto)
        .sort((a, b) => peso(b) - peso(a)).slice(0, 12))
    }).catch(() => {})
  }, [])
  useEffect(cargarSugeridas, [cargarSugeridas])

  const grupos = useMemo(() => {
    if (!lista) return []
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999)
    const g = { vencidos: [], hoy: [], luego: [] }
    for (const s of lista) {
      const t = new Date(s.programado_para)
      if (s.estado !== 'PENDIENTE') g.luego.push(s)
      else if (t < new Date()) g.vencidos.push(s)
      else if (t <= hoy) g.hoy.push(s)
      else g.luego.push(s)
    }
    return [['Vencidos', g.vencidos, '#DC2626'], ['Hoy', g.hoy, ACENTO], [rango === 'hechos' ? 'Hechos' : 'Más adelante', g.luego, '#64748B']].filter(([, l]) => l.length)
  }, [lista, rango])

  async function accion(s, a) {
    if (a === 'hacer') { setSel(s); setModal('gestion'); return }
    if (a === 'mover') { setSel(s); setModal('seguimiento'); return }
    await crm.cambiarSeguimiento(s.id, { accion: a }).catch(e => setError(e.message))
    refrescarAlertas(); cargar()
  }

  async function programarSugerida(v) {
    await crm.crearSeguimiento({
      aliado_id: v.id_aliado, tipo: 'LLAMADA', programado_para: atajoFecha('manana').toISOString(),
      titulo: `Llamada de retención: ${v.dias_sin} días sin mandar`, notas: `Ritmo previo: ${v.s90_180} servicios en el trimestre anterior, ${v.s90} en el último.`,
    }).catch(e => setError(e.message))
    refrescarAlertas(); cargarSugeridas(); cargar()
  }

  const destinoDe = s => (s.aliado_id ? { aliado_id: s.aliado_id } : s.prospecto_id ? { prospecto_id: s.prospecto_id } : null)

  return (
    <div className="max-w-6xl mx-auto">
      <Cabecera titulo="Agenda comercial" sub="Llamadas, visitas y tareas programadas. Te aviso cuando a cada una le llega la hora.">
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-600">
          <input type="checkbox" checked={mios} onChange={e => setMios(e.target.checked)} /> Solo las mías
        </label>
      </Cabecera>
      <Pestanas valor={rango} onCambio={setRango} opciones={[
        { valor: 'hoy', label: 'Para hoy' }, { valor: 'semana', label: 'Próximos 7 días' },
        { valor: 'pendientes', label: 'Todos los pendientes' }, { valor: 'hechos', label: 'Hechos (30 días)' },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 space-y-4">
          <ErrorCaja error={error} onReintentar={cargar} />
          {!lista ? <Cargando /> : !grupos.length ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-[13px] text-gray-500">
              🎉 Nada pendiente aquí. Mira las llamadas sugeridas a la derecha.
            </div>
          ) : grupos.map(([titulo, items, color]) => (
            <div key={titulo}>
              <h3 className="text-[12px] font-bold uppercase tracking-wider mb-2" style={{ color }}>{titulo} · {items.length}</h3>
              <div className="space-y-2">
                {items.map(s => {
                  const nombre = s.aliado_nombre || s.prospecto_nombre || (s.ticket_numero ? `Ticket #${s.ticket_numero}` : '—')
                  const ruta = s.aliado_id ? `/crm/veterinarias/${s.aliado_id}` : s.prospecto_id ? `/crm/prospectos/${s.prospecto_id}` : `/crm/tickets/${s.ticket_id}`
                  const tel = s.aliado_telefono || s.aliado_whatsapp || s.prospecto_telefono || s.prospecto_whatsapp
                  const wa = s.aliado_whatsapp || s.prospecto_whatsapp
                  const vencido = s.estado === 'PENDIENTE' && new Date(s.programado_para) < new Date()
                  return (
                    <div key={s.id} className={`bg-white rounded-2xl border p-3.5 flex flex-wrap gap-3 items-start ${vencido ? 'border-red-200' : 'border-gray-100'} shadow-sm`}>
                      <div className="text-[22px] leading-none">{TIPOS_GESTION[s.tipo]?.emoji || '✅'}</div>
                      <div className="flex-1 min-w-[180px]">
                        <Link to={ruta} className="text-[13.5px] font-bold text-gray-900 no-underline hover:underline">{nombre}</Link>
                        {s.prospecto_id && <span className="ml-1.5 text-[10.5px] font-semibold text-purple-600">prospecto</span>}
                        <div className="text-[12.5px] text-gray-700">{s.titulo}</div>
                        {s.notas && <div className="text-[11.5px] text-gray-500 whitespace-pre-wrap">{s.notas}</div>}
                        <div className={`text-[11.5px] mt-0.5 ${vencido ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                          {fechaHora(s.programado_para)} · {relativo(s.programado_para)}{s.responsable ? ` · ${s.responsable}` : ''}
                          {s.origen === 'AGENTE' ? ' · 🤖 agendada por el agente' : ''}
                          {s.estado !== 'PENDIENTE' ? ` · ${s.estado.toLowerCase()}` : ''}
                        </div>
                      </div>
                      {s.estado === 'PENDIENTE' && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {telHref(tel) && <a href={telHref(tel)} title="Llamar" className="w-9 h-9 rounded-lg text-white flex items-center justify-center" style={{ background: ACENTO }}><Phone size={15} /></a>}
                          {wa && <a href={waHref(wa)} target="_blank" rel="noreferrer" title="WhatsApp (desde tu celular)" className="w-9 h-9 rounded-lg border border-gray-200 text-green-600 flex items-center justify-center"><MessageCircle size={15} /></a>}
                          {destinoDe(s) && <button onClick={() => accion(s, 'hacer')} className="h-9 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: ACENTO }}><CheckCircle2 size={13} /> Registrar</button>}
                          {!destinoDe(s) && <button onClick={() => accion(s, 'hecho')} className="h-9 px-3 rounded-lg border border-gray-200 text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: ACENTO }}><CheckCircle2 size={13} /> Hecho</button>}
                          <button onClick={() => accion(s, 'mover')} title="Reprogramar" className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 flex items-center justify-center"><RotateCcw size={14} /></button>
                          <button onClick={() => accion(s, 'cancelar')} title="Cancelar" className="w-9 h-9 rounded-lg border border-gray-200 text-gray-400 flex items-center justify-center"><XCircle size={14} /></button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <Seccion titulo={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} style={{ color: ACENTO }} /> Llamadas sugeridas</span>}>
          <p className="text-[11.5px] text-gray-500 mb-2">Aliadas que valen y se están saliendo de su ritmo, sin nada programado ni gestión reciente.</p>
          {!sugeridas.length ? <Vacio>Ninguna por ahora.</Vacio> : (
            <div className="space-y-2">
              {sugeridas.map(v => (
                <div key={v.id_aliado} className="rounded-xl border border-gray-100 p-2.5">
                  <Link to={`/crm/veterinarias/${v.id_aliado}`} className="text-[12.5px] font-semibold text-gray-900 no-underline">{v.nombre}</Link>
                  <div className="flex items-center gap-2 mt-0.5"><SegmentoChip segmento={v.segmento} /><TendenciaChip tendencia={v.tendencia} variacion={v.variacion} /></div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Último servicio {haceDias(v.dias_sin)} · {v.s90_180} → {v.s90} por trimestre</div>
                  <button onClick={() => programarSugerida(v)} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: ACENTO }}>
                    <CalendarPlus size={12} /> Programar para mañana 9 a. m.
                  </button>
                </div>
              ))}
            </div>
          )}
        </Seccion>
      </div>

      <RegistrarGestion abierto={modal === 'gestion'} onCerrar={() => setModal(null)} destino={sel ? destinoDe(sel) : null} seguimiento={sel} onGuardado={cargar} />
      <SeguimientoModal abierto={modal === 'seguimiento'} onCerrar={() => setModal(null)} destino={sel ? destinoDe(sel) : null} existente={sel} onGuardado={cargar} />
    </div>
  )
}
