// Módulo de Ofertas — inventario de anuncios que ve el cliente en el portal de
// fotos (/#/fotos/CODIGO) mientras carga las imágenes de su mascota.
//
// Cada oferta ata un recordatorio del catálogo a un precio especial y a los
// planes en los que debe aparecer. Si el cliente acepta, el backend agrega ese
// recordatorio como adicional al servicio y lo suma al total — el precio SIEMPRE
// sale de la DB, nunca del navegador. Ver lib/ofertas.js y migración 078.
import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/dialog'
import { Card, CardContent, StatCard } from '@/components/ui/card'
import { TableWrap, Table, Th, Td, Tr } from '@/components/ui/table'
import { useConfirm } from '@/contexts/ConfirmContext'
import { db } from '@/lib/supabase'
import { fmt, parsearErrorDB } from '@/lib/utils'
import {
  listarOfertas, guardarOferta, eliminarOferta, desactivarOferta,
  subirImagenOferta, respuestasDeOferta, MAX_MB_OFERTA,
} from '@/lib/ofertas'
import {
  Plus, Search, Trash2, ImageIcon, Tag, TrendingUp, CheckCircle2, XCircle,
  Loader2, Eye, Percent,
} from 'lucide-react'

const LABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1'

const FORM_VACIO = {
  titulo: '', descripcion: '', imagen_url: '', recordatorio_id: '',
  precio_oferta: '', precio_lista: '', orden: 100,
  aplica_todos_planes: false, vigencia_desde: '', vigencia_hasta: '', activo: true,
}

// Porcentaje de descuento respecto al precio tachado (solo display).
function descuentoPct(precioLista, precioOferta) {
  const lista = Number(precioLista) || 0
  const of    = Number(precioOferta) || 0
  if (lista <= 0 || of >= lista) return null
  return Math.round((1 - of / lista) * 100)
}

export default function Ofertas() {
  const { confirm, alert: showAlert } = useConfirm()
  const [ofertas, setOfertas]           = useState([])
  const [recordatorios, setRecords]     = useState([])
  const [planes, setPlanes]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [q, setQ]                       = useState('')
  const [editando, setEditando]         = useState(null)  // oferta | { _nueva: true }
  const [verRespuestas, setVerRespuestas] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    try {
      const [ofs, { data: recs }, { data: pls }] = await Promise.all([
        listarOfertas(),
        db.from('recordatorios').select('id, nombre, categoria, precio_base, requiere_imagen, solo_nombre, max_fotos, campos_texto')
          .eq('activo', true).order('nombre'),
        db.from('planes').select('id, nombre, codigo').eq('activo', true).order('nombre'),
      ])
      setOfertas(ofs); setRecords(recs || []); setPlanes(pls || [])
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudieron cargar las ofertas' })
    } finally { setLoading(false) }
  }

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return ofertas
    return ofertas.filter(o =>
      (o.titulo || '').toLowerCase().includes(t) ||
      (o.recordatorios?.nombre || '').toLowerCase().includes(t) ||
      (o.planes || []).some(p => (p.nombre || '').toLowerCase().includes(t))
    )
  }, [ofertas, q])

  const totales = useMemo(() => {
    const activas    = ofertas.filter(o => o.activo).length
    const aceptadas  = ofertas.reduce((a, o) => a + o.stats.aceptadas, 0)
    const rechazadas = ofertas.reduce((a, o) => a + o.stats.rechazadas, 0)
    const vendido    = ofertas.reduce((a, o) => a + o.stats.aceptadas * (Number(o.precio_oferta) || 0), 0)
    // La conversión se mide sobre quienes VIERON el anuncio (migración 081), no
    // sobre quienes respondieron: el que abre el link y abandona también cuenta,
    // y es justo el que explica una oferta que no vende.
    const vistas     = ofertas.reduce((a, o) => a + o.stats.vistas, 0)
    const base       = vistas || (aceptadas + rechazadas)
    return { activas, aceptadas, rechazadas, vendido, vistas,
             sinResponder: Math.max(0, vistas - aceptadas - rechazadas),
             conversion: base ? Math.round(aceptadas / base * 100) : null }
  }, [ofertas])

  async function borrar(o) {
    const ok = await confirm(`Se quitará del portal y del catálogo.`, {
      title: `¿Eliminar "${o.titulo}"?`, variant: 'danger', confirmLabel: 'Eliminar',
    })
    if (!ok) return
    try {
      await eliminarOferta(o.id)
    } catch (e) {
      // Con respuestas de clientes la FK protege el histórico: se desactiva.
      if (e?.code === '23503') {
        const alt = await confirm(
          'Esta oferta ya tiene respuestas de clientes y su histórico no se puede borrar.\n¿Desactivarla para que deje de mostrarse?',
          { title: 'No se puede eliminar', variant: 'warning', confirmLabel: 'Desactivar' })
        if (alt) await desactivarOferta(o.id)
      } else {
        await showAlert(parsearErrorDB(e), { title: 'Error' })
      }
    }
    await cargar()
  }

  return (
    <div>
      <Topbar />
      <div className="p-4 sm:p-7 space-y-6">

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Ofertas activas"   value={totales.activas}    icon={Tag} />
          <StatCard label="La vieron"          value={totales.vistas} icon={Eye}
                    sub={totales.sinResponder > 0 ? `${totales.sinResponder} sin responder` : null} />
          <StatCard label="Aceptadas"          value={totales.aceptadas}  icon={CheckCircle2} valueColor="#1D8A55" />
          <StatCard label="Conversión"         value={totales.conversion == null ? '—' : `${totales.conversion}%`}
                    sub={`${totales.rechazadas} rechazos`} icon={TrendingUp} />
          <StatCard label="Vendido por ofertas" value={fmt(totales.vendido)} icon={Percent} valueColor="#1A5CD8" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="pl-8" placeholder="Buscar por título, ítem o plan..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setEditando({ _nueva: true })}><Plus size={14} /> Nueva oferta</Button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Cargando ofertas…</div>
        ) : filtradas.length === 0 ? (
          <Card><CardContent className="py-16 text-center">
            <Tag size={30} className="mx-auto mb-3 text-gray-300" />
            <p className="text-[14px] font-semibold text-gray-600">
              {ofertas.length === 0 ? 'Todavía no hay ofertas' : 'Ninguna oferta coincide con la búsqueda'}
            </p>
            <p className="text-[12px] text-gray-400 mt-1">
              Una oferta es el anuncio que ve el cliente mientras carga las fotos de su mascota.
            </p>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtradas.map((o, i) => (
              <TarjetaOferta key={o.id} oferta={o} delay={i * 0.03}
                onEditar={() => setEditando(o)}
                onBorrar={() => borrar(o)}
                onVerRespuestas={() => setVerRespuestas(o)} />
            ))}
          </div>
        )}
      </div>

      {editando && (
        <ModalOferta
          oferta={editando._nueva ? null : editando}
          recordatorios={recordatorios}
          planes={planes}
          onClose={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar() }}
        />
      )}

      {verRespuestas && (
        <ModalRespuestas oferta={verRespuestas} onClose={() => setVerRespuestas(null)} />
      )}
    </div>
  )
}

// ─── Tarjeta ─────────────────────────────────────────────────────────────────
function TarjetaOferta({ oferta, delay, onEditar, onBorrar, onVerRespuestas }) {
  const rec    = oferta.recordatorios
  const lista  = oferta.precio_lista ?? rec?.precio_base
  const pct    = descuentoPct(lista, oferta.precio_oferta)
  // La conversión va sobre quienes VIERON el anuncio; si todavía no hay vistas
  // registradas (oferta anterior a la migración 081) cae a las respuestas.
  const vistas = oferta.stats.vistas
  const base   = vistas || (oferta.stats.aceptadas + oferta.stats.rechazadas)
  const conv   = base ? Math.round(oferta.stats.aceptadas / base * 100) : null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="overflow-hidden h-full flex flex-col">
        <div className="relative bg-gray-50 flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          {oferta.imagen_url
            ? <img src={oferta.imagen_url} alt={oferta.titulo} className="w-full h-full object-cover" />
            : <ImageIcon size={28} className="text-gray-300" />}
          {!oferta.activo && (
            <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-800/80 text-white">
              Inactiva
            </span>
          )}
          {pct != null && (
            <span className="absolute top-2 right-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#1A5CD8] text-white">
              -{pct}%
            </span>
          )}
        </div>

        <CardContent className="flex-1 flex flex-col gap-3 pt-4">
          <div>
            <p className="text-[15px] font-bold text-gray-900 leading-tight">{oferta.titulo}</p>
            <p className="text-[12px] text-gray-500 mt-0.5">{rec?.nombre || '— sin ítem —'}</p>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-[19px] font-bold text-gray-900">{fmt(oferta.precio_oferta)}</span>
            {pct != null && <span className="text-[13px] text-gray-400 line-through">{fmt(lista)}</span>}
          </div>

          <div className="flex flex-wrap gap-1">
            {oferta.aplica_todos_planes ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Todos los planes</span>
            ) : oferta.planes.length === 0 ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                Sin planes — no se muestra
              </span>
            ) : oferta.planes.map(p => (
              <span key={p.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.nombre}</span>
            ))}
          </div>

          <div className="mt-auto pt-3 border-t flex items-center justify-between" style={{ borderColor: '#F3F4F6' }}>
            <button onClick={onVerRespuestas} className="flex items-center gap-2 text-[12px] text-gray-500 hover:text-gray-800 transition-colors"
              title={`${vistas} la vieron · ${oferta.stats.aceptadas} aceptaron · ${oferta.stats.rechazadas} rechazaron`
                     + (oferta.stats.aperturas > vistas ? ` · ${oferta.stats.aperturas} aperturas del portal` : '')}>
              <Eye size={13} className="text-gray-400" /> <span className="font-bold">{vistas}</span>
              <CheckCircle2 size={13} className="text-[#1D8A55] ml-1" /> <span className="font-bold">{oferta.stats.aceptadas}</span>
              <XCircle size={13} className="text-gray-300 ml-1" /> <span>{oferta.stats.rechazadas}</span>
              {conv != null && <span className="ml-1 text-[11px] text-gray-400">· {conv}%</span>}
            </button>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={onEditar}>Editar</Button>
              <button onClick={onBorrar} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Modal de edición ────────────────────────────────────────────────────────
function ModalOferta({ oferta, recordatorios, planes, onClose, onGuardado }) {
  const [form, setForm]       = useState(FORM_VACIO)
  const [planIds, setPlanIds] = useState([])
  const [saving, setSaving]   = useState(false)
  const [subiendo, setSub]    = useState(false)
  const [error, setError]     = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (oferta) {
      setForm({
        titulo: oferta.titulo || '', descripcion: oferta.descripcion || '',
        imagen_url: oferta.imagen_url || '', recordatorio_id: oferta.recordatorio_id || '',
        precio_oferta: oferta.precio_oferta ?? '', precio_lista: oferta.precio_lista ?? '',
        orden: oferta.orden ?? 100, aplica_todos_planes: !!oferta.aplica_todos_planes,
        vigencia_desde: oferta.vigencia_desde || '', vigencia_hasta: oferta.vigencia_hasta || '',
        activo: oferta.activo !== false,
      })
      setPlanIds(oferta.plan_ids || [])
    } else {
      setForm(FORM_VACIO); setPlanIds([])
    }
  }, [oferta])

  const rec = recordatorios.find(r => r.id === form.recordatorio_id)
  // Lo que el portal le pedirá al cliente si acepta — se muestra para que quien
  // arma la oferta sepa qué va a tener que subir el cliente.
  const pideFotos  = rec && rec.requiere_imagen && !rec.solo_nombre && (rec.max_fotos || 0) > 0
  const camposTxt  = (rec?.campos_texto || []).filter(c => c.label)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function subir(file) {
    if (!file) return
    setSub(true); setError('')
    try { set('imagen_url', await subirImagenOferta(file)) }
    catch (e) { setError(e.message) }
    finally { setSub(false) }
  }

  async function guardar() {
    if (!form.titulo.trim())       return setError('El título del anuncio es obligatorio.')
    if (!form.recordatorio_id)     return setError('Elige el recordatorio que se ofrece.')
    if (form.precio_oferta === '' || Number(form.precio_oferta) < 0)
      return setError('Pon el precio de oferta (puede ser 0 si es un regalo).')
    if (!form.aplica_todos_planes && planIds.length === 0)
      return setError('Elige al menos un plan, o marca "Aplica a todos los planes".')
    if (form.vigencia_desde && form.vigencia_hasta && form.vigencia_hasta < form.vigencia_desde)
      return setError('La vigencia termina antes de empezar.')

    setError(''); setSaving(true)
    try {
      await guardarOferta({ id: oferta?.id, campos: form, planIds })
      await onGuardado()
    } catch (e) {
      setError(parsearErrorDB(e))
    } finally { setSaving(false) }
  }

  function togglePlan(id) {
    setPlanIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl"
      title={oferta ? `Editar oferta — ${oferta.titulo}` : 'Nueva oferta'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={guardar} disabled={saving || subiendo}>{saving ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
      {error && <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px] font-medium">{error}</div>}

      <div className="space-y-5">
        {/* Anuncio */}
        <div className="grid sm:grid-cols-[180px_1fr] gap-4">
          <div>
            <label className={LABEL}>Foto del anuncio</label>
            <div onClick={() => !subiendo && fileRef.current?.click()}
              className="relative rounded-xl border-2 border-dashed overflow-hidden cursor-pointer bg-gray-50 flex items-center justify-center"
              style={{ aspectRatio: '4/3', borderColor: form.imagen_url ? '#1A5CD8' : '#E5E7EB' }}>
              {subiendo ? <Loader2 size={22} className="animate-spin text-gray-400" />
                : form.imagen_url ? <img src={form.imagen_url} alt="" className="w-full h-full object-cover" />
                : <div className="text-center px-3">
                    <ImageIcon size={22} className="mx-auto text-gray-300" />
                    <p className="text-[11px] text-gray-400 mt-1.5">Subir imagen<br />(máx. {MAX_MB_OFERTA} MB)</p>
                  </div>}
            </div>
            {form.imagen_url && (
              <button onClick={() => set('imagen_url', '')} className="text-[11px] font-semibold text-red-500 mt-1.5">Quitar imagen</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { subir(e.target.files?.[0]); e.target.value = '' }} />
          </div>

          <div className="space-y-3">
            <div>
              <label className={LABEL}>Título del anuncio *</label>
              <Input value={form.titulo} onChange={e => set('titulo', e.target.value)}
                placeholder="Ej: Llévate su huella en cerámica" />
            </div>
            <div>
              <label className={LABEL}>Descripción</label>
              <Textarea rows={3} value={form.descripcion} onChange={e => set('descripcion', e.target.value)}
                placeholder="El texto que lee el cliente en el portal, con cariño y sin presionar." />
            </div>
          </div>
        </div>

        {/* Qué se vende y a qué precio */}
        <div className="border-t pt-4 grid sm:grid-cols-3 gap-3" style={{ borderColor: '#F3F4F6' }}>
          <div className="sm:col-span-3">
            <label className={LABEL}>Recordatorio que se ofrece *</label>
            <Select value={form.recordatorio_id} onChange={e => set('recordatorio_id', e.target.value)}>
              <option value="">Selecciona un ítem del catálogo…</option>
              {recordatorios.map(r => (
                <option key={r.id} value={r.id}>
                  {r.nombre}{r.precio_base > 0 ? ` — ${fmt(r.precio_base)}` : ''}
                </option>
              ))}
            </Select>
            {rec && (
              <p className="text-[11px] text-gray-500 mt-1.5">
                Si el cliente acepta, el portal le pedirá{' '}
                {pideFotos ? <strong>{rec.max_fotos} foto{rec.max_fotos > 1 ? 's' : ''}</strong> : 'ninguna foto'}
                {camposTxt.length > 0 && <> y {camposTxt.map(c => c.label).join(', ').toLowerCase()}</>}.
                {' '}Se agregará al servicio como adicional y se sumará al total a cobrar.
              </p>
            )}
          </div>
          <div>
            <label className={LABEL}>Precio de oferta *</label>
            <Input type="number" min="0" value={form.precio_oferta} onChange={e => set('precio_oferta', e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">Es lo que se cobra.</p>
          </div>
          <div>
            <label className={LABEL}>Precio tachado</label>
            <Input type="number" min="0" value={form.precio_lista} onChange={e => set('precio_lista', e.target.value)}
              placeholder={rec?.precio_base ? String(rec.precio_base) : 'Precio del catálogo'} />
            <p className="text-[11px] text-gray-400 mt-1">Vacío → usa el del catálogo.</p>
          </div>
          <div>
            <label className={LABEL}>Prioridad</label>
            <Input type="number" min="0" value={form.orden} onChange={e => set('orden', e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">Menor = se muestra primero.</p>
          </div>
        </div>

        {/* Dónde se muestra */}
        <div className="border-t pt-4" style={{ borderColor: '#F3F4F6' }}>
          <label className={LABEL}>¿En qué planes se muestra? *</label>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={form.aplica_todos_planes}
              onChange={e => set('aplica_todos_planes', e.target.checked)} className="w-4 h-4 accent-[#1A5CD8]" />
            <span className="text-[13px] font-semibold text-gray-700">Aplica a todos los planes</span>
          </label>
          {!form.aplica_todos_planes && (
            <div className="grid sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
              {planes.map(p => (
                <label key={p.id} className="flex items-center gap-2 cursor-pointer px-2.5 py-1.5 rounded-lg hover:bg-gray-50">
                  <input type="checkbox" checked={planIds.includes(p.id)} onChange={() => togglePlan(p.id)}
                    className="w-4 h-4 accent-[#1A5CD8] flex-shrink-0" />
                  <span className="text-[12px] text-gray-700 truncate">{p.nombre}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Vigencia y estado */}
        <div className="border-t pt-4 grid sm:grid-cols-3 gap-3 items-end" style={{ borderColor: '#F3F4F6' }}>
          <div>
            <label className={LABEL}>Vigente desde</label>
            <Input type="date" value={form.vigencia_desde} onChange={e => set('vigencia_desde', e.target.value)} />
          </div>
          <div>
            <label className={LABEL}>Vigente hasta</label>
            <Input type="date" value={form.vigencia_hasta} onChange={e => set('vigencia_hasta', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input type="checkbox" checked={form.activo !== false} onChange={e => set('activo', e.target.checked)}
              className="w-4 h-4 accent-[#1A5CD8]" />
            <span className="text-[13px] font-semibold text-gray-700">Activa</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal de respuestas ─────────────────────────────────────────────────────
function ModalRespuestas({ oferta, onClose }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    respuestasDeOferta(oferta.id)
      .then(r => { if (vivo) setRows(r) })
      .catch(() => { if (vivo) setRows([]) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [oferta.id])

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl"
      title={`Respuestas — ${oferta.titulo}`}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10">
          <Eye size={26} className="mx-auto mb-2 text-gray-300" />
          <p className="text-[13px] text-gray-500">Todavía ningún cliente ha respondido esta oferta.</p>
        </div>
      ) : (
        <TableWrap><Table>
          <thead><tr><Th>Mascota</Th><Th>Cliente</Th><Th>Respuesta</Th><Th>Precio</Th><Th>Cuándo</Th></tr></thead>
          <tbody>
            {rows.map(r => {
              const m = r.servicios?.mascotas
              const c = m?.clientes
              const ok = r.respuesta === 'ACEPTADA'
              return (
                <Tr key={r.id}>
                  <Td className="font-semibold text-gray-900">{m?.nombre || '—'}</Td>
                  <Td className="text-gray-600 text-[12px]">{[c?.nombre, c?.apellido].filter(Boolean).join(' ') || '—'}</Td>
                  <Td>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {ok ? 'Aceptada' : 'Rechazada'}
                    </span>
                  </Td>
                  <Td className="text-gray-600 text-[12px]">{ok ? fmt(r.precio_ofrecido) : '—'}</Td>
                  <Td className="text-gray-400 text-[12px]">
                    {r.respondido_en ? new Date(r.respondido_en).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table></TableWrap>
      )}
    </Modal>
  )
}
