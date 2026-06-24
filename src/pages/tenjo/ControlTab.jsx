// Pestaña "Control" — tabla de control de procesos individuales de Tenjo.
// Vista consolidada de solo lectura: por cada mascota en proceso o ya procesada
// muestra cuándo inició el proceso, cuándo finalizó (cremación / entrada al
// cubículo) y el cálculo de cuándo estará lista:
//   - Cremación:  cenizas listas = fecha de cremación + 5 días calendario.
//   - Compostaje: compostaje listo = fecha de ingreso al cubículo + 2 meses.
// La regla vive en lib/tenjo.js (calcularListoProceso); aquí solo se presenta.
import { useState, useEffect, useCallback } from 'react'
import { StatCard } from '@/components/ui/card'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { calcularListoProceso } from '@/lib/tenjo'
import { petEmoji } from '@/lib/utils'
import { Flame, Leaf } from 'lucide-react'
import SetupNotice from './SetupNotice'

const fmtFecha = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

const fmtFechaHora = v => v
  ? new Date(v).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—'

function EstadoBadge({ calc }) {
  const { estado, esCompostaje, diasRestantes } = calc
  let bg = '#FEF3C7', text = '#92400E', label = 'En proceso'
  if (estado === 'EN_PROCESO') {
    bg = '#FEF3C7'; text = '#92400E'; label = esCompostaje ? 'En compostaje' : 'En proceso'
  } else if (estado === 'EN_ESPERA') {
    bg = '#DBEAFE'; text = '#1E40AF'
    label = esCompostaje
      ? `Listo en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`
      : `Cenizas en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`
  } else if (estado === 'LISTO') {
    bg = '#D1FAE5'; text = '#065F46'
    label = esCompostaje ? 'Compostaje listo' : 'Cenizas listas'
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color: text }}>{label}</span>
  )
}

export default function ControlTab() {
  const [rows,     setRows]     = useState(undefined) // undefined=cargando, null=sin tabla, array
  const [sinTabla, setSinTabla] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error } = await db.from('lotes_tenjo_items')
      .select('id, estado, cubiculo_codigo, fecha_inicio_proceso, fecha_fin_proceso, fecha_compostaje_inicio, '
        + 'lotes_tenjo!lote_id(numero_lote, fecha_jornada), '
        + 'servicios(planes(nombre, tipo_proceso), mascotas(nombre, especies(nombre), clientes(nombre, apellido)))')
      .in('estado', ['EN_PROCESO', 'PROCESADO'])
      .order('fecha_fin_proceso', { ascending: true, nullsFirst: true })
    if (error) { setSinTabla(true); setRows(null); return }
    setRows(data || [])
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (sinTabla) return <SetupNotice />
  if (rows === undefined) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando control…</span></div>

  // Enriquecer con el cálculo de timeline y ordenar por urgencia (fechaListo asc)
  const items = rows.map(r => ({ r, calc: calcularListoProceso(r) }))
    .sort((a, b) => {
      const fa = a.calc.fechaListo || '9999'
      const fb = b.calc.fechaListo || '9999'
      return fa < fb ? -1 : fa > fb ? 1 : 0
    })

  const enProceso     = items.filter(x => x.calc.estado === 'EN_PROCESO').length
  const cenizasListas = items.filter(x => !x.calc.esCompostaje && x.calc.estado === 'LISTO').length
  const cenizasEspera = items.filter(x => !x.calc.esCompostaje && x.calc.estado === 'EN_ESPERA').length
  const compostListos = items.filter(x => x.calc.esCompostaje && x.calc.estado === 'LISTO').length
  const compostCurso  = items.filter(x => x.calc.esCompostaje && x.calc.estado === 'EN_ESPERA').length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="En proceso" value={enProceso} valueColor="#9A5500" />
        <StatCard label="Cenizas en espera" value={cenizasEspera} valueColor="#1D4ED8" />
        <StatCard label="Cenizas listas" value={cenizasListas} valueColor={cenizasListas > 0 ? '#C03030' : '#9CA3AF'} />
        <StatCard label="Compostajes en curso" value={compostCurso} valueColor="#1D8A55" />
        <StatCard label="Compostajes listos" value={compostListos} valueColor={compostListos > 0 ? '#059669' : '#9CA3AF'} />
      </div>

      <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="font-semibold text-[15px] text-ink">Control de procesos</div>
          <div className="text-[11px] text-ink3 mt-0.5">Cenizas listas a los 5 días de la cremación · compostaje listo a los 2 meses de ingresar al cubículo</div>
        </div>
        {items.length === 0 ? (
          <div className="py-12 text-center text-ink3 text-sm">Sin procesos en curso ni en espera.</div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Tipo</Th>
                  <Th>Cubículo</Th>
                  <Th>Inicio proceso</Th>
                  <Th>Cremación / ingreso</Th>
                  <Th>Listo estimado</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ r, calc }) => {
                  const m = r.servicios?.mascotas
                  const c = m?.clientes
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{petEmoji(m?.especies?.nombre)}</span>
                          <div>
                            <div className="font-semibold text-ink">{m?.nombre || '—'}</div>
                            <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium"
                          style={{ color: calc.esCompostaje ? '#065F46' : '#9A5500' }}>
                          {calc.esCompostaje ? <Leaf size={12} /> : <Flame size={12} />}
                          {calc.esCompostaje ? 'Compostaje' : 'Cremación'}
                        </span>
                      </Td>
                      <Td className="font-mono text-[11px]">{r.cubiculo_codigo || '—'}</Td>
                      <Td className="text-ink3 text-[11px]">{fmtFechaHora(r.fecha_inicio_proceso)}</Td>
                      <Td className="text-ink3 text-[11px]">{fmtFechaHora(r.fecha_fin_proceso)}</Td>
                      <Td className="text-ink2 text-[11px] font-medium">{fmtFecha(calc.fechaListo)}</Td>
                      <Td><EstadoBadge calc={calc} /></Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  )
}
