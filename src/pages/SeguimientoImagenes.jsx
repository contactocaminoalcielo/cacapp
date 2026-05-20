import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { petEmoji, today } from '@/lib/utils'
import { MessageCircle, RefreshCw } from 'lucide-react'

const FILTROS = [
  { key: 'todos', label: 'Todos' },
  { key: 'PENDIENTE', label: 'Pendientes' },
  { key: 'ENVIADA', label: 'Enviadas' },
  { key: 'RECIBIDA', label: 'Recibidas' },
  { key: 'SIN_RESPUESTA', label: 'Sin respuesta' },
]

const ESTADO_COLORS = {
  PENDIENTE: { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
  ENVIADA: { bg: '#EEF3FB', text: '#3B6FBF', border: '#C5D8F5' },
  RECIBIDA: { bg: '#E8F3EB', text: '#1D8A55', border: '#A0D4B0' },
  SIN_RESPUESTA: { bg: '#FEE8E8', text: '#C03030', border: '#FCA5A5' },
}

export default function SeguimientoImagenes() {
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('PENDIENTE')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const { data, error: err } = await db.from('solicitudes_imagenes')
        .select('*, servicios(mascotas(nombre,especies(nombre),clientes(nombre,apellido,whatsapp)),planes(nombre,codigo)), recordatorios(nombre)')
        .order('fecha_solicitud', { ascending: false })
      if (err) throw err
      setSolicitudes(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function actualizarEstado(id, nuevoEstado) {
    const update = { estado: nuevoEstado }
    if (nuevoEstado === 'RECIBIDA') update.fecha_recepcion = today()
    await db.from('solicitudes_imagenes').update(update).eq('id', id)
    setSolicitudes(prev => prev.map(s => s.id === id ? { ...s, ...update } : s))
  }

  const filtradas = filtro === 'todos' ? solicitudes : solicitudes.filter(s => s.estado === filtro)

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Pendientes" value={solicitudes.filter(s => s.estado === 'PENDIENTE').length} valueColor="#9A5500" />
          <StatCard label="Enviadas" value={solicitudes.filter(s => s.estado === 'ENVIADA').length} valueColor="#3B6FBF" />
          <StatCard label="Recibidas" value={solicitudes.filter(s => s.estado === 'RECIBIDA').length} valueColor="#1D8A55" />
          <StatCard label="Sin respuesta" value={solicitudes.filter(s => s.estado === 'SIN_RESPUESTA').length} valueColor="#C03030" />
        </div>

        {/* Filtros */}
        <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border mb-6 w-fit" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {FILTROS.map(f => (
            <button key={f.key}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
              onClick={() => setFiltro(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Mascota / Cliente</Th>
                <Th>Plan</Th>
                <Th>Ítem</Th>
                <Th>Solicitud #</Th>
                <Th>Fecha</Th>
                <Th>Estado</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(s => {
                const m = s.servicios?.mascotas
                const c = m?.clientes
                const e = ESTADO_COLORS[s.estado] || {}
                return (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{petEmoji(m?.especies?.nombre)}</span>
                        <div>
                          <div className="font-semibold text-ink">{m?.nombre || '-'}</div>
                          <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink3">{s.servicios?.planes?.nombre}</Td>
                    <Td className="text-ink2">{s.recordatorios?.nombre || '-'}</Td>
                    <Td className="font-mono text-[11px]">#{s.numero_solicitud || s.id}</Td>
                    <Td className="text-ink3">{s.fecha_solicitud ? new Date(s.fecha_solicitud).toLocaleDateString('es-CO') : '-'}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                        {s.estado}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex gap-1.5">
                        {s.estado === 'PENDIENTE' && (
                          <Button size="sm" variant="secondary" onClick={() => actualizarEstado(s.id, 'ENVIADA')}>Enviada</Button>
                        )}
                        {s.estado === 'ENVIADA' && (
                          <Button size="sm" onClick={() => actualizarEstado(s.id, 'RECIBIDA')}>✓ Recibida</Button>
                        )}
                        {c?.whatsapp && (() => {
                          const nombre = m?.nombre || 'su mascota'
                          const item = s.recordatorios?.nombre ? ` (${s.recordatorios.nombre})` : ''
                          const msg = `Hola ${c.nombre}, le escribe el equipo de *Camino al Cielo* 🐾\n\nEstamos preparando con amor el servicio de *${nombre}*${item}. Para continuar necesitamos que nos comparta algunas fotos de ${nombre} que más atesore.\n\nPuede enviárnoslas aquí mismo por WhatsApp. ¡Gracias por confiar en nosotros! 💚`
                          return (
                            <a href={`https://wa.me/57${c.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`}
                              target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                              style={{ background: '#25D366', color: 'white' }}>
                              <MessageCircle size={11} />WA
                            </a>
                          )
                        })()}
                        {s.estado === 'ENVIADA' && (
                          <button onClick={() => actualizarEstado(s.id, 'SIN_RESPUESTA')}
                            className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                            style={{ color: '#C03030' }}>Sin resp.</button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtradas.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-ink3 text-sm">Sin solicitudes</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </div>
  )
}
