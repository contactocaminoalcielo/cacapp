import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db } from '@/lib/supabase'
import { fmt } from '@/lib/utils'
import { Plus, RefreshCw, Rocket } from 'lucide-react'

const FILTROS = [
  { key: 'todos', label: 'Todos' },
  { key: 'ACTIVO', label: 'Activos' },
  { key: 'COMPLETADO', label: 'Completados' },
  { key: 'ACTIVADO', label: 'Activados' },
  { key: 'CANCELADO', label: 'Cancelados' },
]

const NIVEL_COLORS = {
  BRONCE: { bg: '#FFF3DC', text: '#9A5500', border: '#FFD980' },
  PLATA: { bg: '#F0F0F0', text: '#555', border: '#DDD' },
  ORO: { bg: '#FFF3DC', text: '#9A5500', border: '#C4A87A' },
  DIAMANTE: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  VITALICIO: { bg: '#E8F3EB', text: '#1D8A55', border: '#A0D4B0' },
}

export default function Presequiales() {
  const navigate = useNavigate()
  const [data, setData] = useState([])
  const [planes, setPlanes] = useState([])
  const [planesServicio, setPlanesServicio] = useState([])
  const [clientes, setClientes] = useState([])
  const [mascotas, setMascotas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('ACTIVO')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [modalOroItem, setModalOroItem] = useState(null) // item ORO pendiente de elegir tipo

  useEffect(() => { cargar() }, [])

  async function cargar() {
    try {
      setLoading(true)
      const [{ data: d }, { data: pls }, { data: pls2 }, { data: cls }, { data: msc }] = await Promise.all([
        db.from('planes_presequiales')
          .select('*, clientes(nombre,apellido,whatsapp,cedula_nit), mascotas(nombre,especie_id,especies(nombre)), planes(nombre,codigo)')
          .order('created_at', { ascending: false }),
        db.from('planes').select('*').in('codigo', ['BRONCE','PLATA','ORO_EXCLUSIVO','DIAMANTE','VITALICIO']),
        db.from('planes').select('id,nombre,codigo').in('codigo', ['EXCLUSIVO_PRESENCIAL','EXCLUSIVO_VIDEOLLAMADA','COMPETS_EVIDENCIA','COMPETS_PRESENCIAL']),
        db.from('clientes').select('id_cliente,nombre,apellido').order('nombre'),
        db.from('mascotas').select('id_mascota,nombre,cliente_id,especies(nombre)').order('nombre'),
      ])
      setData(d || [])
      setPlanes(pls || [])
      setPlanesServicio(pls2 || [])
      setClientes(cls || [])
      setMascotas(msc || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function activar(item, planIdOverride) {
    // ORO necesita elegir tipo antes de continuar
    if (item.nivel === 'ORO' && !planIdOverride) {
      setModalOroItem(item)
      return
    }
    if (!confirm(`¿Activar el plan ${item.nivel} de ${item.clientes?.nombre} ${item.clientes?.apellido || ''}?\n\nSe abrirá el formulario de registro preconfigurado con sus datos.`)) return
    await db.from('planes_presequiales').update({ estado: 'ACTIVADO' }).eq('id', item.id)
    navigate('/registro', {
      state: {
        presequial: {
          id:         item.id,
          cliente_id: item.cliente_id,
          mascota_id: item.mascota_id,
          plan_id:    planIdOverride || item.plan_id,
          nivel:      item.nivel,
        }
      }
    })
  }

  async function activarOro(tipo) {
    // tipo: 'exclusivo' | 'compostaje'
    const codigos = tipo === 'exclusivo'
      ? ['EXCLUSIVO_PRESENCIAL','EXCLUSIVO_VIDEOLLAMADA']
      : ['COMPETS_EVIDENCIA','COMPETS_PRESENCIAL']
    const plan = planesServicio.find(p => codigos.includes(p.codigo))
    setModalOroItem(null)
    activar(modalOroItem, plan?.id || null)
  }

  async function guardar() {
    setSaving(true)
    try {
      const body = {
        ...form,
        valor_total: parseFloat(form.valor_total) || 0,
        valor_pagado: parseFloat(form.valor_pagado) || 0,
        numero_cuotas: parseInt(form.numero_cuotas) || 1,
        cuotas_pagadas: parseInt(form.cuotas_pagadas) || 0,
      }
      if (selected?.id) {
        await db.from('planes_presequiales').update(body).eq('id', selected.id)
      } else {
        await db.from('planes_presequiales').insert({ ...body, estado: 'ACTIVO' })
      }
      await cargar()
      setSelected(null)
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const filtrados = filtro === 'todos' ? data : data.filter(d => d.estado === filtro)

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const activos = data.filter(d => d.estado === 'ACTIVO').length
  const totalRecaudado = data.reduce((acc, d) => acc + (d.valor_pagado || 0), 0)
  const activados = data.filter(d => d.estado === 'ACTIVADO').length

  return (
    <div>
      <Topbar actions={
        <>
          <Button size="sm" onClick={() => { setSelected({ nuevo: true }); setForm({ nivel:'BRONCE',modalidad_pago:'MENSUAL',valor_total:0,valor_pagado:0,numero_cuotas:1,cuotas_pagadas:0,notas:'' }) }}>
            <Plus size={14} /> Nuevo
          </Button>
          <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
            <RefreshCw size={15} />
          </button>
        </>
      } />
      <div className="p-7">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Afiliados activos" value={activos} valueColor="#1D8A55" />
          <StatCard label="Total recaudado" value={fmt(totalRecaudado)} valueColor="#9A5500" />
          <StatCard label="Activados" value={activados} valueColor="#5B21B6" />
          <StatCard label="Total afiliaciones" value={data.length} />
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
                <Th>Cliente</Th>
                <Th>Mascota</Th>
                <Th>Nivel</Th>
                <Th>Plan equiv.</Th>
                <Th>Valor total</Th>
                <Th>Pagado</Th>
                <Th>Cuotas</Th>
                <Th>Estado</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(d => {
                const c = d.clientes
                const m = d.mascotas
                const p = d.planes
                const nColor = NIVEL_COLORS[d.nivel] || {}
                const pct = d.valor_total > 0 ? Math.min(100, Math.round((d.valor_pagado / d.valor_total) * 100)) : 0
                return (
                  <Tr key={d.id}>
                    <Td>
                      <div className="font-semibold text-ink">{c?.nombre} {c?.apellido}</div>
                      <div className="text-[10px] text-ink3">{c?.cedula_nit}</div>
                    </Td>
                    <Td className="text-ink2">{m?.nombre} <span className="text-ink3">({m?.especies?.nombre})</span></Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: nColor.bg, color: nColor.text, borderColor: nColor.border }}>
                        {d.nivel}
                      </span>
                    </Td>
                    <Td className="text-ink3">{p?.nombre || '-'}</Td>
                    <Td className="font-semibold text-ink">{fmt(d.valor_total)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="k-progress-bar w-16"><div className="k-progress-fill" style={{ width: `${pct}%` }} /></div>
                        <span className="text-[11px] text-ink3">{fmt(d.valor_pagado)}</span>
                      </div>
                    </Td>
                    <Td className="text-ink3">{d.cuotas_pagadas}/{d.numero_cuotas}</Td>
                    <Td>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        d.estado === 'ACTIVO' ? 'bg-green-light text-primary-dark' :
                        d.estado === 'ACTIVADO' ? 'bg-[#EDE9FE] text-[#5B21B6]' :
                        d.estado === 'COMPLETADO' ? 'bg-[#EEF3FB] text-[#3B6FBF]' :
                        'bg-danger-light text-danger'
                      }`}>{d.estado}</span>
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        {d.estado === 'ACTIVO' && (
                          <Button size="sm" variant="gold" onClick={() => activar(d)}>
                            <Rocket size={11} /> Activar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setSelected(d); setForm({ nivel:d.nivel,plan_id:d.plan_id,modalidad_pago:d.modalidad_pago||'MENSUAL',valor_total:d.valor_total,valor_pagado:d.valor_pagado,numero_cuotas:d.numero_cuotas,cuotas_pagadas:d.cuotas_pagadas,notas:d.notas||'' }) }}>
                          Editar
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-ink3 text-sm">Sin planes presequiales</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {/* Modal selección tipo ORO */}
      {modalOroItem && (
        <Modal open={!!modalOroItem} onClose={() => setModalOroItem(null)}
          title="Activar plan ORO — elige el tipo de servicio"
          maxWidth="max-w-sm"
          footer={<Button variant="secondary" onClick={() => setModalOroItem(null)}>Cancelar</Button>}>
          <p className="text-[13px] text-ink2 mb-4">
            El plan ORO puede convertirse en <strong>Exclusivo (cremación individual)</strong> o en <strong>Compostaje (Compets)</strong>. Elige según lo que el cliente prefiera:
          </p>
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => activarOro('exclusivo')}
              className="flex items-start gap-3 p-4 rounded-xl border-2 hover:bg-surface2 transition-all text-left"
              style={{ borderColor: '#5B21B6' }}>
              <div className="text-2xl">🕊️</div>
              <div>
                <div className="font-bold text-ink">Exclusivo (cremación individual)</div>
                <div className="text-[11px] text-ink3 mt-0.5">Cremación en Tenjo, entrega en 8 días hábiles</div>
              </div>
            </button>
            <button
              onClick={() => activarOro('compostaje')}
              className="flex items-start gap-3 p-4 rounded-xl border-2 hover:bg-surface2 transition-all text-left"
              style={{ borderColor: '#1D8A55' }}>
              <div className="text-2xl">🌱</div>
              <div>
                <div className="font-bold text-ink">Compostaje (Compets)</div>
                <div className="text-[11px] text-ink3 mt-0.5">Compostaje individual, proceso de ~2 meses</div>
              </div>
            </button>
          </div>
        </Modal>
      )}

      {/* Modal editar/nuevo */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)}
          title={selected?.id ? 'Editar presequial' : 'Nuevo presequial'}
          maxWidth="max-w-lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }>
          <div className="space-y-3">
            {!selected?.id && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Cliente</label>
                  <Select value={form.cliente_id||''} onChange={e => setForm(p=>({...p,cliente_id:e.target.value}))}>
                    <option value="">Seleccionar...</option>
                    {clientes.map(c => <option key={c.id_cliente} value={c.id_cliente}>{c.nombre} {c.apellido}</option>)}
                  </Select></div>
                <div><label className="text-[11px] font-bold text-ink3 block mb-1">Mascota</label>
                  <Select value={form.mascota_id||''} onChange={e => setForm(p=>({...p,mascota_id:e.target.value}))}>
                    <option value="">Seleccionar...</option>
                    {mascotas.filter(m => !form.cliente_id || m.cliente_id === form.cliente_id).map(m => <option key={m.id_mascota} value={m.id_mascota}>{m.nombre} ({m.especies?.nombre})</option>)}
                  </Select></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nivel</label>
                <Select value={form.nivel||'BRONCE'} onChange={e => setForm(p=>({...p,nivel:e.target.value}))}>
                  <option value="BRONCE">Bronce</option>
                  <option value="PLATA">Plata</option>
                  <option value="ORO">Oro</option>
                  <option value="DIAMANTE">Diamante</option>
                  <option value="VITALICIO">Vitalicio</option>
                </Select></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Plan equivalente</label>
                <Select value={form.plan_id||''} onChange={e => setForm(p=>({...p,plan_id:e.target.value}))}>
                  <option value="">Sin plan</option>
                  {planes.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Select></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Modalidad pago</label>
                <Select value={form.modalidad_pago||'MENSUAL'} onChange={e => setForm(p=>({...p,modalidad_pago:e.target.value}))}>
                  <option value="MENSUAL">Mensual</option>
                  <option value="TRIMESTRAL">Trimestral</option>
                  <option value="SEMESTRAL">Semestral</option>
                  <option value="ANUAL">Anual</option>
                  <option value="CONTADO">Contado</option>
                </Select></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Valor total</label>
                <Input type="number" value={form.valor_total||''} onChange={e => setForm(p=>({...p,valor_total:e.target.value}))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Valor pagado</label>
                <Input type="number" value={form.valor_pagado||''} onChange={e => setForm(p=>({...p,valor_pagado:e.target.value}))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Nº cuotas</label>
                <Input type="number" value={form.numero_cuotas||''} onChange={e => setForm(p=>({...p,numero_cuotas:e.target.value}))} /></div>
              <div><label className="text-[11px] font-bold text-ink3 block mb-1">Cuotas pagadas</label>
                <Input type="number" value={form.cuotas_pagadas||''} onChange={e => setForm(p=>({...p,cuotas_pagadas:e.target.value}))} /></div>
            </div>
            <div><label className="text-[11px] font-bold text-ink3 block mb-1">Notas</label>
              <Textarea value={form.notas||''} onChange={e => setForm(p=>({...p,notas:e.target.value}))} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
