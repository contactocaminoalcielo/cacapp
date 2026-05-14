import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { petEmoji } from '@/lib/utils'
import { Snowflake, RefreshCw } from 'lucide-react'

export default function CuartoFrio() {
  const [registros, setRegistros] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const { data, error: err } = await db.from('cuarto_frio')
        .select('*, servicios(mascotas(nombre,peso_kg,especie_id,especies(nombre),clientes(nombre,apellido,whatsapp)),planes(nombre,codigo,tipo_proceso))')
        .order('fecha_ingreso', { ascending: false })
      if (err) throw err
      setRegistros(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function abrirEdicion(r) {
    setSelected(r)
    setForm({
      nevera_codigo: r.nevera_codigo || '',
      posicion: r.posicion || '',
      peso_registrado_kg: r.peso_registrado_kg || '',
      estado: r.estado || 'REFRIGERADO',
      notas: r.notas || '',
    })
  }

  async function guardar() {
    setSaving(true)
    try {
      await db.from('cuarto_frio').update({
        nevera_codigo: form.nevera_codigo,
        posicion: form.posicion,
        peso_registrado_kg: parseFloat(form.peso_registrado_kg) || null,
        estado: form.estado,
        notas: form.notas,
      }).eq('id', selected.id)
      await cargar()
      setSelected(null)
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const refrigerados = registros.filter(r => r.estado === 'REFRIGERADO')
  const enEspera = registros.filter(r => r.estado === 'EN_ESPERA_PROCESO')
  const activos = registros.filter(r => ['REFRIGERADO','EN_ESPERA_PROCESO'].includes(r.estado))

  // Agrupar por nevera
  const porNevera = {}
  activos.forEach(r => {
    const k = r.nevera_codigo || 'Sin nevera'
    if (!porNevera[k]) porNevera[k] = []
    porNevera[k].push(r)
  })

  const estadoColor = {
    REFRIGERADO: { bg: '#EEF3FB', text: '#3B6FBF', border: '#C5D8F5' },
    EN_ESPERA_PROCESO: { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
    TRASLADADO: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
    RETIRADO: { bg: '#F0F0F0', text: '#555', border: '#DDD' },
  }

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
          <StatCard label="En refrigeración" value={refrigerados.length} valueColor="#3B6FBF" />
          <StatCard label="En espera proceso" value={enEspera.length} valueColor="#9A5500" />
          <StatCard label="Total activos" value={activos.length} />
          <StatCard label="Total registros" value={registros.length} />
        </div>

        {/* Grid neveras */}
        {Object.keys(porNevera).length > 0 && (
          <div className="mb-7">
            <div className="font-serif text-lg text-ink mb-4">Neveras activas</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(porNevera).map(([nevera, items]) => (
                <div key={nevera} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Snowflake size={16} className="text-[#3B6FBF]" />
                    <div className="font-bold text-ink">{nevera}</div>
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEF3FB] text-[#3B6FBF]">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(r => {
                      const m = r.servicios?.mascotas
                      const c = m?.clientes
                      const e = estadoColor[r.estado] || {}
                      return (
                        <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-surface2"
                          onClick={() => abrirEdicion(r)}>
                          <span className="text-lg">{petEmoji(m?.especies?.nombre)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-ink truncate">{m?.nombre || 'Sin nombre'}</div>
                            <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido} · Pos {r.posicion || '-'}</div>
                          </div>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                            style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                            {r.estado?.replace(/_/g, ' ')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabla completa */}
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b font-serif text-lg text-ink" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            Todos los registros
          </div>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Mascota</Th>
                  <Th>Cliente</Th>
                  <Th>Plan</Th>
                  <Th>Nevera</Th>
                  <Th>Posición</Th>
                  <Th>Peso (kg)</Th>
                  <Th>Estado</Th>
                  <Th>Ingreso</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {registros.map(r => {
                  const m = r.servicios?.mascotas
                  const c = m?.clientes
                  const p = r.servicios?.planes
                  const e = estadoColor[r.estado] || {}
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span>{petEmoji(m?.especies?.nombre)}</span>
                          <span className="font-semibold text-ink">{m?.nombre || '-'}</span>
                        </div>
                      </Td>
                      <Td className="text-ink2">{c?.nombre} {c?.apellido}</Td>
                      <Td className="text-ink3">{p?.nombre}</Td>
                      <Td className="font-mono text-[11px]">{r.nevera_codigo || '-'}</Td>
                      <Td>{r.posicion || '-'}</Td>
                      <Td>{r.peso_registrado_kg || m?.peso_kg || '-'}</Td>
                      <Td>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                          style={{ background: e.bg, color: e.text, borderColor: e.border }}>
                          {r.estado?.replace(/_/g, ' ')}
                        </span>
                      </Td>
                      <Td className="text-ink3">{r.fecha_ingreso ? new Date(r.fecha_ingreso).toLocaleDateString('es-CO') : '-'}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" onClick={() => abrirEdicion(r)}>Editar</Button>
                      </Td>
                    </Tr>
                  )
                })}
                {registros.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-ink3 text-sm">Sin registros</td></tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </div>

      {/* Modal edición */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Editar registro cuarto frío"
          maxWidth="max-w-lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nevera</label>
                <Input value={form.nevera_codigo} onChange={e => setForm(p => ({ ...p, nevera_codigo: e.target.value }))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Posición</label>
                <Input value={form.posicion} onChange={e => setForm(p => ({ ...p, posicion: e.target.value }))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Peso registrado (kg)</label>
                <Input type="number" step="0.1" value={form.peso_registrado_kg} onChange={e => setForm(p => ({ ...p, peso_registrado_kg: e.target.value }))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Estado</label>
                <Select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))}>
                  <option value="REFRIGERADO">Refrigerado</option>
                  <option value="EN_ESPERA_PROCESO">En espera proceso</option>
                  <option value="TRASLADADO">Trasladado</option>
                  <option value="RETIRADO">Retirado</option>
                </Select></div>
            </div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
              <Textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
