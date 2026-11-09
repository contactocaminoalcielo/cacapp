import { useState, useEffect } from 'react'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { db, dbTodo } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, today, waLink, parseDate } from '@/lib/utils'
import { Star, MessageCircle, RefreshCw } from 'lucide-react'
import { esAliadoVip, VipStar } from '@/components/servicio/VipAliado'

const FILTROS = [
  { key: 'todos', label: 'Todos' },
  { key: 'PENDIENTE', label: 'Pendientes' },
  // Regular / Malo de la encuesta automática que nadie ha cerrado (migr. 206).
  { key: 'POR_ATENDER', label: 'Por atender' },
  { key: 'REALIZADO', label: 'Realizados' },
  { key: 'POST_ENTREGA', label: 'Post-entrega' },
  { key: 'RECORDATORIO_3M', label: '3 meses' },
  { key: 'RECORDATORIO_6M', label: '6 meses' },
]

// Respuesta de la encuesta automática post-entrega (migr. 206).
const SATISFACCION = {
  BUENA:   { label: '😊 Bueno',   cls: 'bg-green-light text-primary-dark border-green-mid' },
  REGULAR: { label: '😐 Regular', cls: 'bg-[#FFF3DC] text-[#9A5500] border-[#FFD980]' },
  MALA:    { label: '☹️ Malo',    cls: 'bg-[#FDECEC] text-[#C03030] border-[#F3B7B7]' },
}

export default function Nps() {
  const [seguimientos, setSeguimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('PENDIENTE')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ nps: 5, canal: 'WHATSAPP', comentario: '', oferta_presequial_aceptada: false })
  const [saving, setSaving] = useState(false)
  const [atender, setAtender] = useState(null)      // fila Regular/Malo que se está cerrando
  const [nota, setNota] = useState('')

  useEffect(() => { cargar() }, [])

  async function cerrarSeguimiento() {
    setSaving(true)
    try {
      await orbitApi(`/nps/${atender.id}/atender`, { method: 'POST', body: { nota } })
      setAtender(null); setNota('')
      await cargar()
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function cargar() {
    try {
      setLoading(true)
      // dbTodo y no un select suelto: son ~4.000 filas (3 por servicio entregado)
      // y PostgREST corta en 1000 SIN avisar. Ordenado de la más vieja a la más
      // nueva, el corte se comía justo las encuestas recientes. `id` desempata
      // para que las páginas no se pisen.
      const data = await dbTodo(() => db.from('nps_seguimiento')
        .select('*, servicios!inner(aliados:aliado_origen_id(vip),mascotas(nombre,clientes(nombre,apellido,whatsapp)),planes(nombre))')
        .gte('servicios.fecha_ingreso', FECHA_CORTE)
        .order('fecha_programada', { ascending: true })
        .order('id', { ascending: true }))
      setSeguimientos(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function registrar() {
    setSaving(true)
    try {
      await db.from('nps_seguimiento').update({
        estado: 'REALIZADO',
        fecha_realizada: today(),
        nps: form.nps,
        canal: form.canal,
        comentario: form.comentario,
        oferta_presequial_aceptada: form.oferta_presequial_aceptada,
      }).eq('id', selected.id)
      await cargar()
      setSelected(null)
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const filtrados = filtro === 'todos' ? seguimientos
    : filtro === 'POR_ATENDER' ? seguimientos.filter(s => s.seguimiento === 'PENDIENTE')
    : seguimientos.filter(s => s.estado === filtro || s.tipo === filtro)
  const porAtender = seguimientos.filter(s => s.seguimiento === 'PENDIENTE').length

  if (loading) return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando...</span></div>
  if (error) return <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>

  const npsPromedio = seguimientos.filter(s => s.nps).length > 0
    ? (seguimientos.filter(s => s.nps).reduce((acc, s) => acc + s.nps, 0) / seguimientos.filter(s => s.nps).length).toFixed(1)
    : '-'
  const presequialesAceptados = seguimientos.filter(s => s.oferta_presequial_aceptada).length
  const pendientesHoy = seguimientos.filter(s => s.estado === 'PENDIENTE' && s.fecha_programada <= today()).length

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-7">
          <StatCard label="Pendientes hoy" value={pendientesHoy} valueColor="#C03030" />
          <StatCard label="Por atender" value={porAtender} sub="Regular o Malo de la encuesta" valueColor="#9A5500" />
          <StatCard label="NPS promedio" value={npsPromedio} sub="Escala 1-5" valueColor="#1D8A55" />
          <StatCard label="Pre-Exequiales aceptados" value={presequialesAceptados} valueColor="#9A5500" />
          <StatCard label="Total contactos" value={seguimientos.length} />
        </div>

        {/* Filtros */}
        <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border mb-6 w-fit overflow-x-auto" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {FILTROS.map(f => (
            <button key={f.key}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all whitespace-nowrap ${filtro === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
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
                <Th>Tipo</Th>
                <Th>Programado</Th>
                <Th>Estado</Th>
                <Th>NPS</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(s => {
                const m = s.servicios?.mascotas
                const c = m?.clientes
                const isPendiente = s.estado === 'PENDIENTE'
                return (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-ink">{m?.nombre || '-'}</span>
                            {esAliadoVip(s.servicios) && <VipStar size={12} />}
                          </div>
                          <div className="text-[10px] text-ink3">{c?.nombre} {c?.apellido}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink3">{s.servicios?.planes?.nombre}</Td>
                    <Td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEF3FB] text-[#3B6FBF] border border-[#C5D8F5]">
                        {s.tipo?.replace(/_/g,' ')}
                      </span>
                    </Td>
                    <Td className="text-ink3">{s.fecha_programada ? parseDate(s.fecha_programada).toLocaleDateString('es-CO') : '-'}</Td>
                    <Td>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPendiente ? 'bg-[#FFF3DC] text-[#9A5500] border border-[#FFD980]' : 'bg-green-light text-primary-dark border border-green-mid'}`}>
                        {s.estado}
                      </span>
                    </Td>
                    <Td>
                      {s.satisfaccion ? (
                        <div className="max-w-[260px]">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SATISFACCION[s.satisfaccion].cls}`}>
                            {SATISFACCION[s.satisfaccion].label}
                          </span>
                          {s.seguimiento === 'PENDIENTE' && (
                            <span className="ml-1 text-[10px] font-bold text-[#9A5500]">· por atender</span>
                          )}
                          {s.seguimiento === 'ATENDIDO' && (
                            <span className="ml-1 text-[10px] text-ink3">· atendido</span>
                          )}
                          {s.pqr_id && <span className="ml-1 text-[10px] font-bold text-[#C03030]">· PQR</span>}
                          {s.comentario && (
                            <p className="text-[11px] text-ink2 mt-1 line-clamp-2" title={s.comentario}>«{s.comentario}»</p>
                          )}
                        </div>
                      ) : s.envio_estado === 'ENVIADO' ? (
                        <span className="text-[10px] text-ink3">Encuesta enviada · sin respuesta</span>
                      ) : s.nps ? (
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map(n => (
                            <Star key={n} size={12} className={n <= s.nps ? 'fill-[#C4A87A] text-[#C4A87A]' : 'text-[#DDD]'} />
                          ))}
                        </div>
                      ) : '-'}
                    </Td>
                    <Td>
                      <div className="flex gap-1.5">
                        {s.seguimiento === 'PENDIENTE' && (
                          <Button size="sm" onClick={() => { setAtender(s); setNota('') }}>
                            Atender
                          </Button>
                        )}
                        {isPendiente && (
                          <Button size="sm" onClick={() => { setSelected(s); setForm({ nps: 5, canal: 'WHATSAPP', comentario: '', oferta_presequial_aceptada: false }) }}>
                            Registrar
                          </Button>
                        )}
                        {c?.whatsapp && (
                          <a href={waLink(c.whatsapp, `Hola, queremos saber cómo estuvo el servicio de ${m?.nombre}`)}
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
                            style={{ background: '#25D366', color: 'white' }}>
                            <MessageCircle size={11} />WA
                          </a>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-ink3 text-sm">Sin registros</td></tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      {/* Modal cerrar seguimiento de un Regular / Malo (migr. 206) */}
      {atender && (
        <Modal open={!!atender} onClose={() => setAtender(null)} title="Cerrar seguimiento"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAtender(null)}>Cancelar</Button>
              <Button onClick={cerrarSeguimiento} disabled={saving}>{saving ? 'Guardando...' : 'Marcar atendido'}</Button>
            </>
          }>
          <div className="space-y-4">
            <div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SATISFACCION[atender.satisfaccion]?.cls || ''}`}>
                {SATISFACCION[atender.satisfaccion]?.label || atender.satisfaccion}
              </span>
              <span className="ml-2 text-[12px] font-semibold text-ink">{atender.servicios?.mascotas?.nombre}</span>
              {atender.pqr_id && <span className="ml-2 text-[11px] text-[#C03030] font-bold">PQR (queja) abierta en la ficha del servicio</span>}
            </div>
            <div className="text-[13px] text-ink2 bg-surface2 rounded-lg p-3 whitespace-pre-wrap">
              {atender.comentario ? `«${atender.comentario}»` : 'La familia todavía no ha escrito qué pasó.'}
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">¿Qué se hizo? (opcional)</label>
              <Textarea value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej.: se llamó a la familia, se repuso el recordatorio…" />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal registrar NPS */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Registrar contacto NPS"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
              <Button onClick={registrar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
            </>
          }>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-2">NPS (1-5 estrellas)</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setForm(p => ({ ...p, nps: n }))}>
                    <Star size={28} className={`transition-all ${n <= form.nps ? 'fill-[#C4A87A] text-[#C4A87A]' : 'text-[#DDD] hover:text-[#C4A87A]'}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Canal</label>
              <Select value={form.canal} onChange={e => setForm(p => ({ ...p, canal: e.target.value }))}>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="LLAMADA">Llamada</option>
                <option value="EMAIL">Email</option>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Comentario del cliente</label>
              <Textarea value={form.comentario} onChange={e => setForm(p => ({ ...p, comentario: e.target.value }))} placeholder="¿Qué dijo el cliente?" />
            </div>
            {selected.tipo !== 'POST_ENTREGA' && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="presec" checked={form.oferta_presequial_aceptada}
                  onChange={e => setForm(p => ({ ...p, oferta_presequial_aceptada: e.target.checked }))} className="w-4 h-4 accent-primary-dark" />
                <label htmlFor="presec" className="text-[12px] font-medium text-ink2">¿Aceptó oferta pre-exequial?</label>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
