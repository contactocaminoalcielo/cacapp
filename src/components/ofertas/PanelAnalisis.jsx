// Respuestas y análisis de las ofertas del portal.
//
// 🔑 Una fila por (servicio, oferta) que LLEGÓ al cliente, no por respuesta.
// Quien vio el anuncio y no contestó es un estado propio (SIN_RESPONDER): es el
// grupo que más dice y el que antes era invisible, porque la pantalla solo
// listaba a los que habían respondido y parecía que contestaban todos.
//
// Todo se filtra en memoria y es correcto: `analisisOfertas` trae el conjunto
// completo con `dbTodo` (ya pasa de 1.000 filas y el servidor corta ahí sin
// avisar), así que los totales de arriba son los de verdad y no los de la
// primera página.
import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, StatCard } from '@/components/ui/card'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { FiltroChecklist, valoresParaConsulta } from '@/components/ui/filtro-checklist'
import { analisisOfertas } from '@/lib/ofertas'
import { fmt } from '@/lib/utils'
import {
  Search, Eye, CheckCircle2, XCircle, HelpCircle, TrendingUp,
  FileDown, MessageSquare, X,
} from 'lucide-react'

const ESTADOS = [
  { v: 'ACEPTADA',     label: 'Aceptada',      color: '#1D8A55', bg: '#F0FDF4' },
  { v: 'RECHAZADA',    label: 'Rechazada',     color: '#DC2626', bg: '#FEF2F2' },
  { v: 'SIN_RESPONDER', label: 'Sin responder', color: '#92400E', bg: '#FFFBEB' },
]

const TOPE_FILAS = 500

// Sin tildes y en minúscula: aquí los nombres se escriben de las dos formas.
const norm = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export default function PanelAnalisis({ ofertas, planes }) {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [fEstado, setFEstado] = useState(() => new Set())
  const [fOferta, setFOferta] = useState(() => new Set())
  const [fPlan,   setFPlan]   = useState(() => new Set())
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  useEffect(() => {
    let vivo = true
    analisisOfertas()
      .then(r => { if (vivo) setFilas(r) })
      .catch(e => { if (vivo) { setError(e.message || 'No se pudo cargar'); setFilas([]) } })
    return () => { vivo = false }
  }, [])

  const nombreOferta = useMemo(() => Object.fromEntries((ofertas || []).map(o => [o.id, o.titulo])), [ofertas])
  const nombrePlan   = useMemo(() => Object.fromEntries((planes  || []).map(p => [p.id, p.nombre])), [planes])

  const opcsOferta = useMemo(() => (ofertas || []).map(o => ({ v: o.id, label: o.titulo })), [ofertas])
  // Solo los planes que de verdad aparecen: ofrecer uno al que nunca le llegó
  // un anuncio solo estorba.
  const opcsPlan = useMemo(() => {
    const ids = [...new Set((filas || []).map(f => f.plan_id).filter(Boolean))]
    return ids.map(id => ({ v: id, label: nombrePlan[id] || '—' }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [filas, nombrePlan])

  const hayFiltros = !!q.trim() || fEstado.size > 0 || fOferta.size > 0 || fPlan.size > 0 || !!desde || !!hasta
  const limpiar = () => {
    setQ(''); setFEstado(new Set()); setFOferta(new Set()); setFPlan(new Set()); setDesde(''); setHasta('')
  }

  const visibles = useMemo(() => {
    let base = filas || []
    const t = norm(q)
    if (t) base = base.filter(f => norm(f.mascota + ' ' + f.cliente).includes(t))
    const vE = valoresParaConsulta(fEstado, ESTADOS.length)
    if (vE) base = base.filter(f => vE.includes(f.estado))
    const vO = valoresParaConsulta(fOferta, opcsOferta.length)
    if (vO) base = base.filter(f => vO.includes(f.oferta_id))
    const vP = valoresParaConsulta(fPlan, opcsPlan.length)
    if (vP) base = base.filter(f => vP.includes(f.plan_id))
    if (desde) base = base.filter(f => (f.fecha_ingreso || '') >= desde)
    if (hasta) base = base.filter(f => (f.fecha_ingreso || '') <= hasta)
    return base
  }, [filas, q, fEstado, fOferta, fPlan, desde, hasta, opcsOferta, opcsPlan])

  // Los totales se recalculan sobre lo FILTRADO: elegir una oferta y leer su
  // conversión real es justo para lo que existe esta pantalla.
  const tot = useMemo(() => {
    const t = { alcanzados: visibles.length, aceptadas: 0, rechazadas: 0, sinResponder: 0, vendido: 0 }
    for (const f of visibles) {
      if (f.estado === 'ACEPTADA') { t.aceptadas++; t.vendido += Number(f.precio) || 0 }
      else if (f.estado === 'RECHAZADA') t.rechazadas++
      else t.sinResponder++
    }
    t.conversion = t.alcanzados ? Math.round((t.aceptadas / t.alcanzados) * 1000) / 10 : null
    return t
  }, [visibles])

  function exportarCSV() {
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const cab = ['Mascota', 'Cliente', 'Telefono', 'Oferta', 'Plan', 'Estado', 'Precio', 'Fecha servicio', 'Respondio', 'Aperturas']
    const cuerpo = visibles.map(f => [
      f.mascota, f.cliente, f.telefono || '',
      nombreOferta[f.oferta_id] || '', nombrePlan[f.plan_id] || '',
      (ESTADOS.find(e => e.v === f.estado) || {}).label || f.estado,
      f.estado === 'ACEPTADA' ? (f.precio || '') : '',
      f.fecha_ingreso || '',
      f.respondido_en ? String(f.respondido_en).slice(0, 10) : '',
      f.aperturas,
    ].map(esc).join(','))
    // BOM: sin él Excel en Windows destroza las tildes.
    const blob = new Blob(['﻿' + [cab.map(esc).join(','), ...cuerpo].join('\n')],
      { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ofertas_respuestas_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (filas === null) return <div className="text-center py-16 text-gray-400 text-sm">Cargando respuestas…</div>
  if (error) return <div className="text-center py-16 text-red-600 text-sm">{error}</div>

  const inputDate = 'rounded-lg border px-2 py-1.5 text-[12px] bg-white outline-none focus:ring-2 focus:ring-[#1A5CD8]/20'
  const borde = { borderColor: 'rgba(30,80,40,0.15)' }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Les llegó"      value={tot.alcanzados}   icon={Eye} />
        <StatCard label="Aceptaron"      value={tot.aceptadas}    icon={CheckCircle2} valueColor="#1D8A55" />
        <StatCard label="Dijeron que no" value={tot.rechazadas}   icon={XCircle}      valueColor="#DC2626" />
        <StatCard label="Sin responder"  value={tot.sinResponder} icon={HelpCircle}   valueColor="#92400E" />
        <StatCard label="Conversión"     value={tot.conversion == null ? '—' : tot.conversion + '%'}
                  sub={fmt(tot.vendido)} icon={TrendingUp} valueColor="#1A5CD8" />
      </div>

      <div className="rounded-2xl border p-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar mascota o cliente…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-[12px] outline-none focus:ring-2 focus:ring-[#1A5CD8]/20"
              style={borde} />
          </div>
          <FiltroChecklist label="Estado: todos" opciones={ESTADOS.map(e => ({ v: e.v, label: e.label }))}
            seleccion={fEstado} onChange={setFEstado} className="w-[170px]" />
          <FiltroChecklist label="Oferta: todas" opciones={opcsOferta}
            seleccion={fOferta} onChange={setFOferta} className="w-[200px]" />
          <FiltroChecklist label="Plan: todos" opciones={opcsPlan}
            seleccion={fPlan} onChange={setFPlan} className="w-[180px]" />
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Del</span>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputDate} style={borde} />
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">al</span>
            <input type="date" value={hasta} min={desde || undefined} onChange={e => setHasta(e.target.value)} className={inputDate} style={borde} />
          </span>
          {hayFiltros && (
            <button type="button" onClick={limpiar}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
              <X size={12} /> Limpiar
            </button>
          )}
          <Button size="sm" variant="secondary" onClick={exportarCSV} disabled={visibles.length === 0}>
            <FileDown size={14} /> CSV
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-gray-500">
          <strong className="text-gray-700">{visibles.length}</strong>
          {hayFiltros ? ' de ' + filas.length : ''} servicios alcanzados
        </div>
      </div>

      {visibles.length === 0 ? (
        <Card><CardContent className="py-14 text-center">
          <p className="text-[14px] font-semibold text-gray-600">
            {filas.length === 0 ? 'Todavía ningún anuncio le ha llegado a un cliente' : 'Nada con estos filtros'}
          </p>
          {hayFiltros && (
            <button onClick={limpiar} className="mt-3 text-[12px] font-semibold text-[#1A5CD8] hover:underline">
              Quitar los filtros
            </button>
          )}
        </CardContent></Card>
      ) : (
        <>
          <TableWrap><Table>
            <thead><tr>
              <Th>Mascota</Th><Th>Cliente</Th><Th>Oferta</Th><Th>Plan</Th>
              <Th>Estado</Th><Th>Precio</Th><Th>Servicio</Th><Th>Respondió</Th><Th></Th>
            </tr></thead>
            <tbody>
              {visibles.slice(0, TOPE_FILAS).map(f => {
                const e = ESTADOS.find(x => x.v === f.estado) || ESTADOS[2]
                const tel = f.telefono ? String(f.telefono).replace(/\D/g, '').slice(-10) : ''
                return (
                  <Tr key={f.clave}>
                    <Td className="font-semibold text-gray-900">{f.mascota}</Td>
                    <Td className="text-gray-600 text-[12px]">{f.cliente}</Td>
                    <Td className="text-gray-600 text-[12px]">{nombreOferta[f.oferta_id] || '—'}</Td>
                    <Td className="text-gray-500 text-[12px]">{nombrePlan[f.plan_id] || '—'}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: e.bg, color: e.color }}>{e.label}</span>
                    </Td>
                    <Td className="text-gray-600 text-[12px] tabular-nums">
                      {f.estado === 'ACEPTADA' ? fmt(f.precio) : '—'}
                    </Td>
                    <Td className="text-gray-400 text-[12px] whitespace-nowrap">{f.fecha_ingreso || '—'}</Td>
                    <Td className="text-gray-400 text-[12px] whitespace-nowrap">
                      {f.respondido_en ? String(f.respondido_en).slice(0, 10) : '—'}
                    </Td>
                    <Td>
                      {/* wa.me, no envío automático: lo que se le dice a alguien
                          que acaba de decir que no lo escribe una persona. */}
                      {tel.length === 10 && (
                        <a href={'https://wa.me/57' + tel} target="_blank" rel="noopener noreferrer"
                          title={'Escribir a ' + f.cliente}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap"
                          style={{ background: '#F0FDF4', color: '#1D8A55' }}>
                          <MessageSquare size={11} /> WhatsApp
                        </a>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table></TableWrap>
          {visibles.length > TOPE_FILAS && (
            <p className="text-[11px] text-gray-400 text-center">
              Se muestran las primeras {TOPE_FILAS} de {visibles.length}. Los totales de arriba y el CSV incluyen todas.
            </p>
          )}
        </>
      )}
    </div>
  )
}
