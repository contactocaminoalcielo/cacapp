import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { EstadoBadge } from '@/components/ui/badge'
import { db } from '@/lib/supabase'
import { petEmoji, today } from '@/lib/utils'
import { Truck, RefreshCw, Plus, CheckCircle2, Flame } from 'lucide-react'

export default function Tenjo() {
  const [traslados, setTraslados] = useState([])
  const [aptosTraslado, setAptosTraslado] = useState([])
  const [cenizasPendientes, setCenizasPendientes] = useState([])
  const [compostajes, setCompostajes] = useState([])
  const [personal, setPersonal] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalNuevo, setModalNuevo] = useState(false)
  const [mascotaParaTraslado, setMascotaParaTraslado] = useState(null)
  const [formTraslado, setFormTraslado] = useState({ fecha_programada: today(), tecnico_id: '', notas: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data: tras }, { data: cenizas }, { data: cuarto }, { data: comp }, { data: per }] = await Promise.all([
        db.from('traslados_tenjo')
          .select('*, servicios(mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo)), personal(nombre,apellido)')
          .in('estado', ['PROGRAMADO','EN_CAMINO'])
          .order('fecha_programada', { ascending: true }),
        // Traslados completados donde servicio aún está EN_PROCESO → cenizas pendientes de confirmar
        db.from('traslados_tenjo')
          .select('*, servicios!inner(id,estado,mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo,tipo_proceso)), personal(nombre,apellido)')
          .eq('estado', 'COMPLETADO')
          .eq('servicios.estado', 'EN_PROCESO')
          .order('fecha_completado', { ascending: true }),
        db.from('cuarto_frio')
          .select('*, servicios(mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido)),planes(nombre,codigo,tipo_proceso))')
          .eq('estado', 'REFRIGERADO'),
        db.from('v_compostaje_activo').select('*').order('fecha_inicio', { ascending: true }),
        db.from('personal').select('*').eq('activo', true).order('nombre'),
      ])
      setTraslados(tras || [])
      // filtro extra client-side: solo cremaciones donde el servicio aún está EN_PROCESO
      setCenizasPendientes((cenizas || []).filter(t => t.servicios?.estado === 'EN_PROCESO'))
      setAptosTraslado((cuarto || []).filter(r => {
        const tipo = r.servicios?.planes?.tipo_proceso
        return tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL'
      }))
      setCompostajes(comp || [])
      setPersonal(per || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function actualizarTraslado(id, estado, servicioId) {
    try {
      await db.from('traslados_tenjo').update({ estado, fecha_completado: estado === 'COMPLETADO' ? today() : null }).eq('id', id)
      if (estado === 'COMPLETADO' && servicioId) {
        await db.from('servicios').update({ estado: 'EN_PROCESO' }).eq('id', servicioId)
      }
      await cargar()
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  async function confirmarCenizas(servicioId) {
    if (!confirm('¿Confirmar que las cenizas están listas? El servicio pasará a EN_PRODUCCION.')) return
    try {
      await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', servicioId)
      await cargar()
    } catch (e) {
      alert('Error: ' + e.message)
    }
  }

  async function crearTraslado() {
    if (!mascotaParaTraslado) return
    setSaving(true)
    try {
      await db.from('traslados_tenjo').insert({
        servicio_id: mascotaParaTraslado.servicio_id,
        estado: 'PROGRAMADO',
        fecha_programada: formTraslado.fecha_programada,
        tecnico_id: formTraslado.tecnico_id || null,
        notas: formTraslado.notas,
      })
      setModalNuevo(false)
      setMascotaParaTraslado(null)
      await cargar()
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7 space-y-7">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Traslados programados" value={traslados.filter(t => t.estado === 'PROGRAMADO').length} valueColor="#3B6FBF" />
          <StatCard label="En camino" value={traslados.filter(t => t.estado === 'EN_CAMINO').length} valueColor="#9A5500" />
          <StatCard label="Cenizas por confirmar" value={cenizasPendientes.length} valueColor={cenizasPendientes.length > 0 ? '#C03030' : '#9CA3AF'} />
          <StatCard label="Compostajes activos" value={compostajes.length} valueColor="#1D8A55" />
        </div>

        {/* Traslados activos */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <Truck size={16} className="text-ink3 mr-2" />
            <div className="font-serif text-lg text-ink">Traslados activos</div>
          </div>
          {traslados.length === 0 ? (
            <div className="py-12 text-center text-ink3 text-sm">Sin traslados activos</div>
          ) : (
            <div className="p-5 space-y-3">
              {traslados.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                const tec = t.personal
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border hover:bg-surface2 transition-all"
                    style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                    <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">{m?.nombre}</div>
                      <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      <div className="text-[11px] text-ink2 mt-0.5">
                        {t.fecha_programada && `Programado: ${new Date(t.fecha_programada).toLocaleDateString('es-CO')}`}
                        {tec && ` · ${tec.nombre} ${tec.apellido}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {t.estado === 'PROGRAMADO' && (
                        <Button size="sm" variant="secondary" onClick={() => actualizarTraslado(t.id, 'EN_CAMINO', t.servicio_id)}>
                          En camino
                        </Button>
                      )}
                      {t.estado === 'EN_CAMINO' && (
                        <Button size="sm" onClick={() => actualizarTraslado(t.id, 'COMPLETADO', t.servicio_id)}>
                          Completado
                        </Button>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${t.estado === 'EN_CAMINO' ? 'bg-[#FFF3DC] text-[#9A5500]' : 'bg-[#EEF3FB] text-[#3B6FBF]'}`}>
                      {t.estado.replace('_', ' ')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Cenizas por confirmar */}
        {cenizasPendientes.length > 0 && (
          <div className="bg-surface border-2 rounded-2xl shadow-sm" style={{ borderColor: '#C03030' }}>
            <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(192,48,48,0.2)' }}>
              <Flame size={16} className="text-danger" />
              <div className="font-serif text-lg text-ink flex-1">Cenizas por confirmar</div>
              <span className="text-[11px] font-bold text-danger bg-danger-light px-2 py-0.5 rounded-full">
                {cenizasPendientes.length} pendiente{cenizasPendientes.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="p-5 space-y-3">
              {cenizasPendientes.map(t => {
                const m = t.servicios?.mascotas
                const c = m?.clientes
                const p = t.servicios?.planes
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 rounded-xl border hover:bg-surface2 transition-all"
                    style={{ borderColor: 'rgba(192,48,48,0.15)', background: '#FFF8F8' }}>
                    <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-ink">{m?.nombre}</div>
                      <div className="text-[11px] text-ink3">{c?.nombre} {c?.apellido} · {p?.nombre}</div>
                      <div className="text-[11px] text-ink2 mt-0.5">
                        Completado: {t.fecha_completado ? new Date(t.fecha_completado).toLocaleDateString('es-CO') : '-'}
                      </div>
                    </div>
                    <Button size="sm" variant="primary"
                      onClick={() => confirmarCenizas(t.servicios?.id)}>
                      <CheckCircle2 size={13} /> Confirmar cenizas
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Aptos para traslado */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="font-serif text-lg text-ink flex-1">Mascotas listas para traslado individual</div>
          </div>
          {aptosTraslado.length === 0 ? (
            <div className="py-8 text-center text-ink3 text-sm">Sin mascotas listas para traslado</div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Mascota</Th>
                    <Th>Cliente</Th>
                    <Th>Plan</Th>
                    <Th>Nevera</Th>
                    <Th>Peso (kg)</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {aptosTraslado.map(r => {
                    const m = r.servicios?.mascotas
                    const c = m?.clientes
                    const p = r.servicios?.planes
                    return (
                      <Tr key={r.id}>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span>{petEmoji(m?.especies?.nombre)}</span>
                            <span className="font-semibold text-ink">{m?.nombre}</span>
                          </div>
                        </Td>
                        <Td className="text-ink2">{c?.nombre} {c?.apellido}</Td>
                        <Td className="text-ink3">{p?.nombre}</Td>
                        <Td className="font-mono text-[11px]">{r.nevera_codigo || '-'}</Td>
                        <Td>{m?.peso_kg || '-'}</Td>
                        <Td>
                          <Button size="sm" variant="secondary"
                            onClick={() => { setMascotaParaTraslado({ ...r, servicio_id: r.servicio_id }); setModalNuevo(true) }}>
                            <Plus size={12} /> Agregar traslado
                          </Button>
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>

        {/* Compostajes activos */}
        {compostajes.length > 0 && (
          <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              <div className="font-serif text-lg text-ink">Compostajes activos</div>
            </div>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Mascota</Th>
                    <Th>Cliente</Th>
                    <Th>Inicio</Th>
                    <Th>Días restantes</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {compostajes.map((c, i) => (
                    <Tr key={i}>
                      <Td><div className="flex items-center gap-2"><span>{petEmoji(c.especie)}</span><span className="font-semibold text-ink">{c.mascota}</span></div></Td>
                      <Td className="text-ink2">{c.cliente}</Td>
                      <Td className="text-ink3">{c.fecha_inicio ? new Date(c.fecha_inicio).toLocaleDateString('es-CO') : '-'}</Td>
                      <Td>
                        <span className={`text-[11px] font-bold ${(c.dias_restantes || 0) < 7 ? 'text-[#9A5500]' : 'text-ink2'}`}>
                          {c.dias_restantes || '-'} días
                        </span>
                      </Td>
                      <Td><EstadoBadge estado={c.estado} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        )}
      </div>

      {/* Modal nuevo traslado */}
      {modalNuevo && (
        <Modal open={modalNuevo} onClose={() => { setModalNuevo(false); setMascotaParaTraslado(null) }}
          title="Programar traslado" maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalNuevo(false)}>Cancelar</Button>
              <Button onClick={crearTraslado} disabled={saving}>{saving ? 'Guardando...' : 'Programar'}</Button>
            </>
          }>
          <div className="space-y-3">
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Fecha programada</label>
              <Input type="date" value={formTraslado.fecha_programada} onChange={e => setFormTraslado(p => ({ ...p, fecha_programada: e.target.value }))} /></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Técnico</label>
              <Select value={formTraslado.tecnico_id} onChange={e => setFormTraslado(p => ({ ...p, tecnico_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select></div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
              <Textarea value={formTraslado.notas} onChange={e => setFormTraslado(p => ({ ...p, notas: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
