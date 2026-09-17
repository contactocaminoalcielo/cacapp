import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import FichaServicio from '@/components/servicio/FichaServicio'
import { PQR_TIPOS, PQR_CANALES, metaTipoPqr } from '@/components/servicio/PqrServicio'
import { db, dbTodo } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { Search, RefreshCw, MessageSquare } from 'lucide-react'

// ── Bandeja de PQR ────────────────────────────────────────────────────────────
// Todo lo que la familia ha dicho sobre un servicio, en un solo sitio: es la
// única forma de ver un patrón —tres quejas por demora en la misma semana— que
// desde la tarjeta de una mascota no se puede ver.
//
// Esto NO gestiona: no hay estado ni cierre (migración 167). La bandeja lee y
// ordena; registrar se hace desde la tarjeta de la mascota, que es donde el
// coordinador está cuando le dicen las cosas.
//
// A propósito NO se filtra por FECHA_CORTE: una PQR puede caer sobre un
// servicio viejo y esconderla sería perderla.
export default function Pqr() {
  const [filas, setFilas]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tipo, setTipo]       = useState('')
  const [canal, setCanal]     = useState('')
  const [desde, setDesde]     = useState('')
  const [hasta, setHasta]     = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [fichaServId, setFichaServId] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true); setError(null)
      // `dbTodo` pagina: el tope mudo de 1000 filas recortaría la bandeja el día
      // que haya más, y nadie cuenta las filas de una lista antes de fiarse.
      const data = await dbTodo(() => db.from('pqrs')
        .select('id, servicio_id, tipo, canal, descripcion, created_at, ' +
                'personal:registrado_por(nombre, apellido), ' +
                'servicios!inner(fecha_ingreso, planes(nombre), mascotas(nombre, especies(nombre), clientes(nombre, apellido)))')
        .order('created_at', { ascending: false })
        .order('id'))
      setFilas(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // El día local de la PQR, para comparar contra los inputs de fecha sin que el
  // huso mueva una PQR de la noche al día siguiente.
  const diaLocal = ts => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const filtradas = filas.filter(p => {
    if (tipo && p.tipo !== tipo) return false
    if (canal && (p.canal || '') !== canal) return false
    const dia = diaLocal(p.created_at)
    if (desde && dia < desde) return false
    if (hasta && dia > hasta) return false
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase()
      const m = p.servicios?.mascotas
      const c = m?.clientes
      return [m?.nombre, `${c?.nombre || ''} ${c?.apellido || ''}`, p.descripcion]
        .some(v => (v || '').toLowerCase().includes(q))
    }
    return true
  })

  const cuenta = k => filas.filter(p => p.tipo === k).length
  const fmtFecha = ts => new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })
  const bonito = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '—'
  const hayFiltros = tipo || canal || desde || hasta || busqueda

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando PQR...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar} title="Recargar">
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Quejas" value={cuenta('QUEJA')} valueColor="#92400E" />
          <StatCard label="Reclamos" value={cuenta('RECLAMO')} valueColor="#9F1239" />
          <StatCard label="Felicitaciones" value={cuenta('FELICITACION')} valueColor="#15803D" />
          <StatCard label="Total registradas" value={filas.length} />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <Input className="pl-8 w-56" placeholder="Mascota, cliente o texto…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
          <Select value={tipo} onChange={e => setTipo(e.target.value)} className="w-44">
            <option value="">Todos los tipos</option>
            {PQR_TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
          <Select value={canal} onChange={e => setCanal(e.target.value)} className="w-40">
            <option value="">Todos los canales</option>
            {PQR_CANALES.map(c => <option key={c} value={c}>{bonito(c)}</option>)}
          </Select>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-ink3">Desde</span>
            <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="w-36" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-ink3">Hasta</span>
            <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="w-36" />
          </div>
          {hayFiltros && (
            <button onClick={() => { setTipo(''); setCanal(''); setDesde(''); setHasta(''); setBusqueda('') }}
              className="text-[11px] font-semibold text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors">
              × Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-[12px] text-ink3 font-medium">
            {filtradas.length} PQR{filtradas.length !== 1 ? 's' : ''}
          </span>
        </div>

        {filtradas.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare size={26} className="mx-auto text-ink3 mb-2" />
            <p className="text-[13px] text-ink3">
              {filas.length === 0
                ? 'Todavía no hay ninguna PQR registrada. Se registran desde la tarjeta de la mascota, en el tablero.'
                : 'Ninguna PQR coincide con estos filtros.'}
            </p>
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Mascota / Cliente</Th>
                  <Th>Tipo</Th>
                  <Th>Canal</Th>
                  <Th>Qué dijeron</Th>
                  <Th>Registró</Th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(p => {
                  const m = p.servicios?.mascotas
                  const c = m?.clientes
                  const meta = metaTipoPqr(p.tipo)
                  return (
                    // Clic en la fila: abre la ficha del servicio, que es donde
                    // está el contexto (plan, estado, recibos y las demás PQR).
                    <Tr key={p.id} className="cursor-pointer" onClick={() => setFichaServId(p.servicio_id)}>
                      <Td className="text-ink3 whitespace-nowrap">{fmtFecha(p.created_at)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="text-base leading-none">{petEmoji(m?.especies?.nombre)}</span>
                          <div>
                            <div className="font-semibold text-ink">{m?.nombre || '—'}</div>
                            <div className="text-[10px] text-ink3">{`${c?.nombre || ''} ${c?.apellido || ''}`.trim() || '—'}</div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                      </Td>
                      <Td className="text-ink3">{bonito(p.canal)}</Td>
                      <Td>
                        <div className="text-[12px] text-ink max-w-md whitespace-pre-wrap break-words line-clamp-3">{p.descripcion}</div>
                      </Td>
                      <Td className="text-ink3 whitespace-nowrap">
                        {p.personal ? `${p.personal.nombre || ''} ${p.personal.apellido || ''}`.trim() : '—'}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>

      {fichaServId && (
        <FichaServicio servicioId={fichaServId} onClose={() => setFichaServId(null)} />
      )}
    </div>
  )
}
