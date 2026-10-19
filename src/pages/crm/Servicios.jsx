// Consulta de los servicios que mandan las veterinarias. Solo lectura: operar
// un servicio es del Tablero de coordinación.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { crm, pesos, fechaCorta } from '@/lib/crmApi'
import { hoyLocalISO } from '@/lib/utils'
import { EstadoBadge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Cabecera, Cargando, ErrorCaja, Vacio, Kpi } from '@/components/crm/ui'

const ESTADOS = ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO', 'CANCELADO']

export default function Servicios() {
  const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
  const [desde, setDesde] = useState(hoyLocalISO(hace30))
  const [hasta, setHasta] = useState(hoyLocalISO())
  const [estado, setEstado] = useState('')
  const [q, setQ] = useState('')
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)

  const cargar = useCallback(() => {
    setError(null); setLista(null)
    crm.servicios({ desde, hasta, estado }).then(r => setLista(r.servicios || [])).catch(e => setError(e.message))
  }, [desde, hasta, estado])
  useEffect(cargar, [cargar])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (lista || []).filter(s => !t || [s.aliado_nombre, s.mascota, s.cliente, s.plan].some(x => (x || '').toLowerCase().includes(t)))
  }, [lista, q])

  const vivos = filtrados.filter(s => s.estado !== 'CANCELADO')
  const vets = new Set(vivos.map(s => s.id_aliado)).size

  return (
    <div className="max-w-7xl mx-auto">
      <Cabecera titulo="Servicios de veterinarias" sub="Consulta de lo que han enviado las aliadas: estado, plan, valor y comisión. Para operar un servicio, coordinación usa el Tablero." />
      <div className="flex flex-wrap gap-2 mb-4">
        <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="w-auto" />
        <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="w-auto" />
        <Select value={estado} onChange={e => setEstado(e.target.value)} className="w-auto">
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{e.replace(/_/g, ' ').toLowerCase()}</option>)}
        </Select>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" value={q} onChange={e => setQ(e.target.value)} placeholder="Veterinaria, mascota, familia o plan…" />
        </div>
      </div>
      <ErrorCaja error={error} onReintentar={cargar} />
      {!lista ? <Cargando /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Kpi label="Servicios" valor={vivos.length} sub={`${filtrados.length - vivos.length} cancelados`} />
            <Kpi label="Veterinarias" valor={vets} sub="distintas en el periodo" />
            <Kpi label="Valor" valor={pesos(vivos.reduce((a, s) => a + Number(s.valor_total || 0), 0))} />
            <Kpi label="Comisiones" valor={pesos(vivos.reduce((a, s) => a + Number(s.comision_aliado || 0), 0))} />
          </div>
          {!filtrados.length ? <Vacio>Sin servicios en ese rango.</Vacio> : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2.5">Fecha</th><th className="px-3">Veterinaria</th><th className="px-3">Mascota</th>
                    <th className="px-3">Familia</th><th className="px-3">Plan</th><th className="px-3">Estado</th>
                    <th className="px-3 text-right">Valor</th><th className="px-3 text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.slice(0, 1000).map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-4 py-2 whitespace-nowrap">{fechaCorta(s.fecha_ingreso)}</td>
                      <td className="px-3"><Link to={`/crm/veterinarias/${s.id_aliado}`} className="font-semibold text-gray-800 no-underline hover:underline">{s.aliado_nombre}</Link></td>
                      <td className="px-3">{s.mascota}<span className="text-gray-400"> · {s.especie}</span></td>
                      <td className="px-3 text-gray-600">{s.cliente}</td>
                      <td className="px-3 text-gray-600">{s.plan}</td>
                      <td className="px-3"><EstadoBadge estado={s.estado} /></td>
                      <td className="px-3 text-right tabular-nums">{pesos(s.valor_total)}</td>
                      <td className="px-3 text-right tabular-nums text-gray-600">{Number(s.comision_aliado) > 0 ? pesos(s.comision_aliado) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtrados.length > 1000 && <div className="text-center text-[12px] text-gray-400 py-3">Mostrando 1.000 de {filtrados.length}. Acorta el rango.</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
