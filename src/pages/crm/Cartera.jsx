import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, LayoutGrid, List, Phone, Download } from 'lucide-react'
import { crm, SEGMENTOS, ORDEN_SEGMENTOS, haceDias, fechaCorta, telHref } from '@/lib/crmApi'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Cabecera, Cargando, ErrorCaja, SegmentoChip, TendenciaChip, Probabilidad, ClaseChip, RiesgoChip, Vacio, Chip, ACENTO,
} from '@/components/crm/ui'
import { FotoCrm } from '@/components/crm/Fotos'
import { useCrm } from '@/components/crm/CrmContext'

const ORDENES = {
  prioridad: { label: 'Prioridad de gestión', fn: (a, b) => puntaje(b) - puntaje(a) },
  volumen:   { label: 'Más servicios (90 días)', fn: (a, b) => b.s90 - a.s90 },
  sin:       { label: 'Más días sin mandar', fn: (a, b) => (b.dias_sin ?? -1) - (a.dias_sin ?? -1) },
  prob:      { label: 'Mayor probabilidad', fn: (a, b) => b.probabilidad - a.probabilidad },
  nombre:    { label: 'Nombre', fn: (a, b) => a.nombre.localeCompare(b.nombre) },
}

// A quién llamar primero: las que valen (volumen previo) y se están yendo.
function puntaje(v) {
  const vol = (Number(v.s90) || 0) + (Number(v.s90_180) || 0)
  const r = { ALTO: 3, MEDIO: 2, BAJO: 1 }[v.riesgo] || 0
  return vol * r + (v.sin_contacto ? 5 : 0) + (v.tickets_abiertos ? 8 : 0)
}

export default function Cartera() {
  const [params, setParams] = useSearchParams()
  const { equipo } = useCrm()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [vista, setVista] = useState(() => localStorage.getItem('crm.cartera.vista') || 'lista')
  const [q, setQ] = useState('')
  const [localidad, setLocalidad] = useState('')
  const [responsable, setResponsable] = useState('')
  const [orden, setOrden] = useState('prioridad')
  const [soloSinContacto, setSoloSinContacto] = useState(false)
  const segmento = params.get('segmento') || ''

  const cargar = () => { setError(null); crm.cartera().then(r => setDatos(r.aliados || [])).catch(e => setError(e.message)) }
  useEffect(cargar, [])
  useEffect(() => { try { localStorage.setItem('crm.cartera.vista', vista) } catch { /* sin almacenamiento */ } }, [vista])

  const localidades = useMemo(() => [...new Set((datos || []).map(v => v.localidad).filter(Boolean))].sort(), [datos])

  const filtradas = useMemo(() => {
    if (!datos) return []
    const t = q.trim().toLowerCase()
    return datos.filter(v => {
      const inactiva = v.estado === 'inactivo' || (v.estado === 'activo' && v.activo === false)
      if (segmento === 'INACTIVAS') { if (!inactiva) return false }
      else if (inactiva) return false
      if (segmento && segmento !== 'INACTIVAS' && v.segmento !== segmento) return false
      if (localidad && v.localidad !== localidad) return false
      if (responsable === 'SIN' && v.comercial_id) return false
      if (responsable && responsable !== 'SIN' && v.comercial_id !== responsable) return false
      if (soloSinContacto && !(v.sin_contacto && v.total > 0)) return false
      if (t && ![v.nombre, v.localidad, v.barrio, v.contacto_nombre, v.telefono, v.whatsapp].some(x => (x || '').toLowerCase().includes(t))) return false
      return true
    }).sort(ORDENES[orden].fn)
  }, [datos, q, segmento, localidad, responsable, orden, soloSinContacto])

  const conteo = useMemo(() => {
    const n = {}
    for (const v of datos || []) {
      if (v.estado === 'inactivo' || (v.estado === 'activo' && v.activo === false)) continue
      n[v.segmento] = (n[v.segmento] || 0) + 1
    }
    return n
  }, [datos])

  function exportar() {
    const cols = ['nombre', 'localidad', 'telefono', 'whatsapp', 'contacto_nombre', 'segmento', 'clase', 'total', 's30', 's90', 'mes_actual', 'dias_sin', 'probabilidad', 'tendencia', 'riesgo', 'comercial_nombre']
    const csv = [cols.join(';'), ...filtradas.map(v => cols.map(c => `"${String(v[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `veterinarias-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  if (error) return <ErrorCaja error={error} onReintentar={cargar} />
  if (!datos) return <Cargando texto="Calculando métricas de cada veterinaria…" />

  return (
    <div className="max-w-7xl mx-auto">
      <Cabecera titulo="Veterinarias" sub="Toda la cartera con su ritmo, tendencia y probabilidad. Ordenada por a quién conviene llamar primero.">
        <button onClick={exportar} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12.5px] font-semibold text-gray-600 hover:bg-gray-50">
          <Download size={14} /> Exportar
        </button>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          {[['lista', List, 'Lista'], ['kanban', LayoutGrid, 'Tablero']].map(([v, I, t]) => (
            <button key={v} onClick={() => setVista(v)} className={`h-9 px-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold ${vista === v ? 'text-white' : 'text-gray-500'}`}
              style={vista === v ? { background: ACENTO } : undefined}><I size={15} /> {t}</button>
          ))}
        </div>
      </Cabecera>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button onClick={() => setParams({})}
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${!segmento ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-600'}`}
          style={!segmento ? { background: ACENTO } : undefined}>Todas · {Object.values(conteo).reduce((a, b) => a + b, 0)}</button>
        {ORDEN_SEGMENTOS.filter(s => conteo[s]).map(s => (
          <button key={s} onClick={() => setParams({ segmento: s })}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold border transition"
            style={segmento === s ? { background: SEGMENTOS[s].color, color: '#fff', borderColor: 'transparent' } : { background: '#fff', color: SEGMENTOS[s].color, borderColor: `${SEGMENTOS[s].color}44` }}>
            {SEGMENTOS[s].label} · {conteo[s]}
          </button>
        ))}
        <button onClick={() => setParams({ segmento: 'INACTIVAS' })}
          className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border ${segmento === 'INACTIVAS' ? 'bg-gray-700 text-white' : 'bg-white border-gray-200 text-gray-400'}`}>
          Desactivadas
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, barrio, contacto o teléfono…" />
        </div>
        <Select value={localidad} onChange={e => setLocalidad(e.target.value)} className="w-auto">
          <option value="">Todas las localidades</option>
          {localidades.map(l => <option key={l} value={l}>{l}</option>)}
        </Select>
        <Select value={responsable} onChange={e => setResponsable(e.target.value)} className="w-auto">
          <option value="">Cualquier responsable</option>
          <option value="SIN">Sin responsable</option>
          {equipo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <Select value={orden} onChange={e => setOrden(e.target.value)} className="w-auto">
          {Object.entries(ORDENES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
        </Select>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-600 px-2">
          <input type="checkbox" checked={soloSinContacto} onChange={e => setSoloSinContacto(e.target.checked)} /> Sin gestión reciente
        </label>
      </div>

      {vista === 'lista' ? <Lista filas={filtradas} /> : <Kanban filas={filtradas} />}
    </div>
  )
}

function Lista({ filas }) {
  if (!filas.length) return <Vacio>Ninguna veterinaria con esos filtros.</Vacio>
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2.5 font-bold">Veterinaria</th>
            <th className="px-3 py-2.5 font-bold">Estado</th>
            <th className="px-3 py-2.5 font-bold text-right">Mes</th>
            <th className="px-3 py-2.5 font-bold text-right">90 d</th>
            <th className="px-3 py-2.5 font-bold">Tendencia</th>
            <th className="px-3 py-2.5 font-bold">Último</th>
            <th className="px-3 py-2.5 font-bold">Prob. 30 d</th>
            <th className="px-3 py-2.5 font-bold">Gestión</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {filas.slice(0, 400).map(v => (
            <tr key={v.id_aliado} className="border-b border-gray-50 hover:bg-teal-50/30">
              <td className="px-4 py-2">
                <Link to={`/crm/veterinarias/${v.id_aliado}`} className="no-underline flex items-center gap-2.5">
                  {v.foto_id ? <FotoCrm id={v.foto_id} className="w-9 h-9 rounded-lg flex-shrink-0" />
                    : <span className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-[13px] flex-shrink-0">{v.nombre[0]}</span>}
                  <span className="min-w-0">
                    <span className="font-semibold text-gray-900 flex items-center gap-1.5">{v.nombre} {v.vip && <Chip color="#B45309">VIP</Chip>} <ClaseChip clase={v.clase} /></span>
                    <span className="block text-[11px] text-gray-400 truncate">{[v.localidad, v.barrio].filter(Boolean).join(' · ') || v.ciudad || '—'}{v.comercial_nombre ? ` · ${v.comercial_nombre}` : ''}</span>
                  </span>
                </Link>
              </td>
              <td className="px-3 py-2"><div className="flex flex-col gap-1 items-start"><SegmentoChip segmento={v.segmento} /><RiesgoChip riesgo={v.riesgo === 'BAJO' ? null : v.riesgo} /></div></td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{v.mes_actual}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{v.s90}</td>
              <td className="px-3 py-2"><TendenciaChip tendencia={v.tendencia} variacion={v.variacion} /></td>
              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{v.ultimo ? haceDias(v.dias_sin) : '—'}</td>
              <td className="px-3 py-2">{v.total > 0 ? <Probabilidad valor={v.probabilidad} ancho={48} /> : '—'}</td>
              <td className="px-3 py-2 text-[11.5px] whitespace-nowrap">
                {v.proximo_seguimiento
                  ? <span className="text-teal-700 font-semibold">📅 {fechaCorta(v.proximo_seguimiento)}</span>
                  : <span className={v.sin_contacto && v.total ? 'text-red-500' : 'text-gray-400'}>{v.ultima_gestion ? `Última ${fechaCorta(v.ultima_gestion)}` : 'Nunca'}</span>}
                {v.tickets_abiertos > 0 && <div className="text-red-600 font-semibold">🎫 {v.tickets_abiertos} ticket(s)</div>}
              </td>
              <td className="px-3 py-2">
                {telHref(v.telefono || v.whatsapp) && (
                  <a href={telHref(v.telefono || v.whatsapp)} title="Llamar" className="w-8 h-8 rounded-lg hover:bg-teal-50 text-teal-700 inline-flex items-center justify-center">
                    <Phone size={14} />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filas.length > 400 && <div className="text-center text-[12px] text-gray-400 py-3">Mostrando 400 de {filas.length}. Afina la búsqueda.</div>}
    </div>
  )
}

function Kanban({ filas }) {
  const columnas = ORDEN_SEGMENTOS.filter(s => filas.some(v => v.segmento === s))
  if (!columnas.length) return <Vacio>Ninguna veterinaria con esos filtros.</Vacio>
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columnas.map(s => {
        const de = filas.filter(v => v.segmento === s)
        return (
          <div key={s} className="w-[270px] flex-shrink-0 bg-white/60 rounded-2xl border border-gray-100">
            <div className="px-3 py-2.5 flex items-center justify-between border-b-2" style={{ borderColor: SEGMENTOS[s].color }}>
              <span className="text-[12.5px] font-bold" style={{ color: SEGMENTOS[s].color }}>{SEGMENTOS[s].label}</span>
              <span className="text-[11px] font-bold text-gray-400">{de.length}</span>
            </div>
            <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
              {de.slice(0, 120).map(v => (
                <Link key={v.id_aliado} to={`/crm/veterinarias/${v.id_aliado}`}
                  className="block bg-white rounded-xl border border-gray-100 p-2.5 shadow-sm hover:shadow-md transition no-underline">
                  <div className="text-[12.5px] font-semibold text-gray-900 truncate">{v.nombre}</div>
                  <div className="text-[11px] text-gray-400 truncate">{v.localidad || v.ciudad || '—'}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-gray-500">{v.s90} en 90 d · {v.ultimo ? haceDias(v.dias_sin) : 'nunca'}</span>
                    <TendenciaChip tendencia={v.tendencia} variacion={v.variacion} />
                  </div>
                  {v.total > 0 && <div className="mt-1.5"><Probabilidad valor={v.probabilidad} ancho={120} /></div>}
                  {(v.proximo_seguimiento || v.tickets_abiertos > 0) && (
                    <div className="mt-1.5 flex gap-2 text-[10.5px] font-semibold">
                      {v.proximo_seguimiento && <span className="text-teal-700">📅 {fechaCorta(v.proximo_seguimiento)}</span>}
                      {v.tickets_abiertos > 0 && <span className="text-red-600">🎫 {v.tickets_abiertos}</span>}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
