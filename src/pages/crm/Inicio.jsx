import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TrendingUp, PhoneCall, LifeBuoy, Award, Target, Wallet, Building2, AlertTriangle } from 'lucide-react'
import { crm, SEGMENTOS, ORDEN_SEGMENTOS, ETAPAS, FUENTES, TIPOS_GESTION, RESULTADOS, pesos, haceDias, fechaHora } from '@/lib/crmApi'
import { Kpi, Seccion, Cargando, ErrorCaja, Cabecera, SegmentoChip, TendenciaChip, Probabilidad, ClaseChip, Vacio, ACENTO } from '@/components/crm/ui'

export default function Inicio() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const navegar = useNavigate()

  const cargar = () => { setError(null); crm.resumen().then(setD).catch(e => setError(e.message)) }
  useEffect(cargar, [])

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!d) return <Cargando />

  const c = d.cartera
  const delta = c.servicios_mes - c.servicios_mes_anterior
  const activas = (c.por_segmento.ACTIVA || 0) + (c.por_segmento.NUEVA || 0)
  const alerta = (c.por_segmento.EN_RIESGO || 0) + (c.por_segmento.ENFRIANDOSE || 0)
  const embudoAbierto = d.embudo.filter(e => !['GANADO', 'PERDIDO'].includes(e.etapa))
  const abiertos = embudoAbierto.reduce((a, e) => a + e.n, 0)
  const ponderado = Math.round(embudoAbierto.reduce((a, e) => a + Number(e.ponderado || 0), 0))
  const maxSeg = Math.max(1, ...ORDEN_SEGMENTOS.map(s => c.por_segmento[s] || 0))
  const maxEtapa = Math.max(1, ...d.embudo.map(e => e.n))
  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <Cabecera titulo="Panorama comercial" sub={`Hoy es ${hoy}. ${d.seguimientos.vencidos + d.seguimientos.hoy ? `Tienes ${d.seguimientos.vencidos + d.seguimientos.hoy} seguimiento(s) para hoy.` : 'No hay seguimientos pendientes para hoy.'}`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Servicios de aliados (mes)" valor={c.servicios_mes} icono={TrendingUp}
          sub={<span style={{ color: delta >= 0 ? '#059669' : '#DC2626' }}>{delta >= 0 ? '+' : ''}{delta} vs. todo el mes pasado ({c.servicios_mes_anterior})</span>} />
        <Kpi label="Veterinarias activas" valor={activas} icono={Building2} color={ACENTO}
          sub={`de ${c.con_servicios} que alguna vez mandaron · ~${c.activas_esperadas_30} esperadas en 30 días`}
          onClick={() => navegar('/crm/veterinarias?segmento=ACTIVA')} />
        <Kpi label="Por recuperar" valor={alerta + (c.por_segmento.DORMIDA || 0)} icono={AlertTriangle} color="#DC2626"
          sub={`${alerta} enfriándose o en riesgo · ${c.por_segmento.DORMIDA || 0} dormidas`} destacado={alerta > 0}
          onClick={() => navegar('/crm/veterinarias?segmento=EN_RIESGO')} />
        <Kpi label="Para hoy" valor={d.seguimientos.vencidos + d.seguimientos.hoy} icono={PhoneCall}
          color={d.seguimientos.vencidos ? '#DC2626' : '#0F172A'}
          sub={`${d.seguimientos.vencidos} vencidos · ${d.seguimientos.semana} en los próximos 7 días`}
          destacado={d.seguimientos.vencidos > 0} onClick={() => navegar('/crm/agenda')} />
        <Kpi label="Tickets abiertos" valor={d.tickets.abiertos} icono={LifeBuoy}
          sub={`${d.tickets.vencidos} fuera de plazo · ${d.tickets.ultimos_30} en 30 días`}
          destacado={d.tickets.vencidos > 0} onClick={() => navegar('/crm/tickets')} />
        <Kpi label="Prospectos en curso" valor={abiertos} icono={Target}
          sub={`≈ ${ponderado} servicios/mes ponderados por probabilidad`} onClick={() => navegar('/crm/prospectos')} />
        <Kpi label="Hitos por celebrar" valor={d.hitos_por_enviar} icono={Award}
          sub="Mensajes de gracias esperando tu aprobación" onClick={() => navegar('/crm/hitos')} />
        <Kpi label="Comisión por pagar" valor={pesos(c.comision_pendiente)} icono={Wallet}
          sub="A domicilio, sin descontar (lo que se les debe)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Seccion titulo="Salud de la cartera" accion={<Link to="/crm/veterinarias" className="text-[12px] font-semibold" style={{ color: ACENTO }}>Ver todas</Link>}>
          <div className="space-y-2">
            {ORDEN_SEGMENTOS.filter(s => c.por_segmento[s]).map(s => (
              <button key={s} onClick={() => navegar(`/crm/veterinarias?segmento=${s}`)} className="w-full flex items-center gap-3 group">
                <span className="w-28 text-left text-[12.5px] font-medium text-gray-600 group-hover:text-gray-900">{SEGMENTOS[s].label}</span>
                <span className="flex-1 h-6 rounded-lg bg-gray-50 overflow-hidden">
                  <span className="block h-full rounded-lg transition-all" style={{ width: `${(c.por_segmento[s] / maxSeg) * 100}%`, background: SEGMENTOS[s].color, opacity: 0.85 }} />
                </span>
                <span className="w-10 text-right text-[13px] font-bold tabular-nums">{c.por_segmento[s]}</span>
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-gray-400 mt-3">{c.sin_contacto} veterinarias con servicios llevan demasiado tiempo sin una gestión comercial.</p>
        </Seccion>

        <Seccion titulo="Embudo de prospectos" accion={<Link to="/crm/prospectos" className="text-[12px] font-semibold" style={{ color: ACENTO }}>Abrir tablero</Link>}>
          {!d.embudo.length ? <Vacio>Aún no hay prospectos. Impórtalos desde Prospectos.</Vacio> : (
            <div className="space-y-2">
              {ETAPAS.map(e => {
                const fila = d.embudo.find(x => x.etapa === e.clave)
                if (!fila) return null
                return (
                  <div key={e.clave} className="flex items-center gap-3">
                    <span className="w-28 text-[12.5px] font-medium text-gray-600">{e.label}</span>
                    <span className="flex-1 h-6 rounded-lg bg-gray-50 overflow-hidden">
                      <span className="block h-full rounded-lg" style={{ width: `${(fila.n / maxEtapa) * 100}%`, background: e.color, opacity: 0.85 }} />
                    </span>
                    <span className="w-10 text-right text-[13px] font-bold tabular-nums">{fila.n}</span>
                  </div>
                )
              })}
              <div className="flex flex-wrap gap-1.5 pt-2">
                {d.fuentes.map(f => <span key={f.fuente} className="text-[11px] text-gray-500 bg-gray-50 rounded-full px-2 py-0.5">{FUENTES[f.fuente] || f.fuente}: <b>{f.n}</b></span>)}
              </div>
            </div>
          )}
        </Seccion>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ListaVets titulo="Se están cayendo" vacio="Ninguna aliada importante va a la baja." filas={d.caidas} />
        <ListaVets titulo="En riesgo de perderse" vacio="Ninguna en riesgo alto." filas={d.en_riesgo} />
        <ListaVets titulo="Las que más mandan este mes" vacio="Sin servicios este mes." filas={d.top} mostrarMes />
      </div>

      <Seccion titulo="Última actividad comercial">
        {!d.actividad_reciente.length ? <Vacio>Todavía no hay gestiones registradas.</Vacio> : (
          <div className="divide-y divide-gray-50">
            {d.actividad_reciente.map(a => (
              <Link key={a.id} to={a.aliado_id ? `/crm/veterinarias/${a.aliado_id}` : `/crm/prospectos/${a.prospecto_id}`}
                className="flex items-start gap-3 py-2 no-underline hover:bg-gray-50 rounded-lg px-2 -mx-2">
                <span className="text-[16px]">{TIPOS_GESTION[a.tipo]?.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-gray-800"><b>{a.nombre}</b>{a.resultado && <span className="text-gray-500"> · {RESULTADOS[a.resultado]}</span>}</div>
                  <div className="text-[12px] text-gray-500 truncate">{a.resumen}</div>
                </div>
                <div className="text-[11px] text-gray-400 text-right whitespace-nowrap">{fechaHora(a.realizado_en)}<br />{a.autor || 'Sistema'}</div>
              </Link>
            ))}
          </div>
        )}
      </Seccion>
    </div>
  )
}

function ListaVets({ titulo, filas, vacio, mostrarMes = false }) {
  return (
    <Seccion titulo={titulo}>
      {!filas.length ? <Vacio>{vacio}</Vacio> : (
        <div className="space-y-1">
          {filas.map(f => (
            <Link key={f.id_aliado} to={`/crm/veterinarias/${f.id_aliado}`}
              className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 no-underline">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-gray-800 truncate flex items-center gap-1.5">{f.nombre} <ClaseChip clase={f.clase} /></div>
                <div className="text-[11px] text-gray-400">
                  {mostrarMes ? `${f.mes_actual} este mes` : `${f.s90} vs ${f.s90_180} (trimestre)`} · último {haceDias(f.dias_sin)}
                </div>
              </div>
              {mostrarMes ? <Probabilidad valor={f.probabilidad} ancho={40} /> : <TendenciaChip tendencia={f.tendencia} variacion={f.variacion} />}
              {!mostrarMes && <SegmentoChip segmento={f.segmento} />}
            </Link>
          ))}
        </div>
      )}
    </Seccion>
  )
}
