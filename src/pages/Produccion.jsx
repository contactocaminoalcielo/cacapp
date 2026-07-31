import { useState, useEffect, useRef } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useAuth } from '@/contexts/AuthContext'
import Topbar from '@/components/layout/Topbar'
import { StatCard } from '@/components/ui/card'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableWrap, Th, Td, Tr } from '@/components/ui/table'
import { db, dbIn } from '@/lib/supabase'
import { agruparRefresco } from '@/lib/realtime'
import { FECHA_CORTE } from '@/lib/constants'
import { cargarEtapasContacto } from '@/lib/imagenes'
import { petEmoji, parsearErrorDB, today, parseDate } from '@/lib/utils'
import { RefreshCw, User, Cpu, Lock, Zap, CheckCircle2, Clock, Package, AlertCircle, Truck, ArrowRight, Search, MessageCircle } from 'lucide-react'
import ModalPreparaEntrega from '@/components/delivery/ModalPreparaEntrega'
import FotosDelCliente from '@/components/imagenes/FotosDelCliente'

const ESTADO_LABEL  = { PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo', NA: 'N/A', ENTREGADO: 'Entregado' }
const ESTADO_COLOR  = {
  PENDIENTE:  { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  EN_PROCESO: { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE' },
  LISTO:      { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  NA:         { bg: '#F3F4F6', text: '#9CA3AF', border: '#E5E7EB' },
  ENTREGADO:  { bg: '#EDE9FE', text: '#5B21B6', border: '#DDD6FE' },
}
const ESTADOS_PROD = ['PENDIENTE', 'EN_PROCESO', 'LISTO']

function initials(p) {
  if (!p) return '?'
  return `${(p.nombre || '')[0] || ''}${(p.apellido || '')[0] || ''}`.toUpperCase()
}

// ── PILL DE ÍTEM ──────────────────────────────────────────────────────────────
function ItemPill({ item, personal, maquinas, fotos_ok, onClick }) {
  const col   = ESTADO_COLOR[item.estado] || ESTADO_COLOR.PENDIENTE
  const rec   = item.recordatorios
  const soloN = rec?.solo_nombre
  const reqImg = rec?.requiere_imagen && !soloN
  const bloqueado = reqImg && !fotos_ok && item.estado === 'PENDIENTE'
  const asig  = personal.find(p => p.id === item.asignado_a)
  const maq   = maquinas.find(m => m.id === item.maquina_id) || maquinas.find(m => m.id === rec?.maquina_id)

  return (
    <button
      onClick={() => onClick(item)}
      title={bloqueado ? 'Esperando fotos del cliente' : `Click para gestionar`}
      style={{
        background: bloqueado ? '#F9FAFB' : col.bg,
        color: bloqueado ? '#9CA3AF' : col.text,
        border: `1.5px solid ${bloqueado ? '#E5E7EB' : col.border}`,
        borderRadius: '20px',
        padding: '5px 10px',
        fontSize: '11px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        transition: 'all 0.15s',
        opacity: bloqueado ? 0.7 : 1,
        position: 'relative',
      }}
    >
      {bloqueado
        ? <Lock size={10} />
        : soloN
          ? <Zap size={10} style={{ color: '#059669' }} />
          : null}
      <span>{rec?.nombre || 'Ítem'}</span>
      {asig && (
        <span style={{
          background: 'rgba(0,0,0,0.12)', borderRadius: '50%',
          width: '16px', height: '16px', fontSize: '8px', fontWeight: '800',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{initials(asig)}</span>
      )}
      {maq && (
        <Cpu size={9} style={{ opacity: 0.7 }} />
      )}
    </button>
  )
}

// ── MODAL GESTIÓN ÍTEM ────────────────────────────────────────────────────────
function ModalItem({ item, personal, maquinas, fotos_ok, onClose, onSaved }) {
  const { alert: showAlert } = useConfirm()
  const rec = item.recordatorios
  const soloN = rec?.solo_nombre
  const reqImg = rec?.requiere_imagen && !soloN
  const bloqueado = reqImg && !fotos_ok

  const [estado,   setEstado]   = useState(item.estado)
  const [asignado, setAsignado] = useState(item.asignado_a || '')
  const [maquina,  setMaquina]  = useState(item.maquina_id || rec?.maquina_id || '')
  const [notas,    setNotas]    = useState(item.notas || '')
  const [saving,   setSaving]   = useState(false)
  // Copia local de las fotos: al reemplazar una, el modal debe mostrarla ya, sin
  // esperar a que se recargue la página.
  const [fotos, setFotos] = useState({
    imagen_cliente_url:    item.imagen_cliente_url,
    imagenes_cliente_urls: item.imagenes_cliente_urls,
  })

  // Espeja la regla de la DB (migración 058): la columna singular se recalcula
  // desde el array. Si aquí se desviara, la pantalla mostraría una foto y
  // Digitales usaría otra.
  function handleFotoCambiada(_srId, posicion, url) {
    const base = fotos.imagenes_cliente_urls?.length ? fotos.imagenes_cliente_urls
               : fotos.imagen_cliente_url ? [fotos.imagen_cliente_url] : []
    const urls = [...base]
    urls[posicion - 1] = url
    const next = { imagenes_cliente_urls: urls, imagen_cliente_url: urls[0] }
    setFotos(next)
    onSaved({ ...item, ...next })
  }

  async function guardar() {
    setSaving(true)
    const patch = {
      estado,
      asignado_a: asignado || null,
      maquina_id: maquina  || null,
      notas:      notas    || null,
      fecha_inicio_prod: estado !== 'PENDIENTE' && !item.fecha_inicio_prod
        ? today() : item.fecha_inicio_prod,
      fecha_fin_prod: estado === 'LISTO'
        ? (item.fecha_fin_prod || today()) : null,
    }
    const { error } = await db.from('servicio_recordatorios').update(patch).eq('id', item.id)
    if (error) { setSaving(false); await showAlert(parsearErrorDB(error), { title: 'Error' }); return }

    // ── Recalcular estado del servicio dinámicamente ─────────────────────────
    const svcId = item.servicio_id
    try {
      const [{ data: todosItems }, { data: svc }] = await Promise.all([
        db.from('servicio_recordatorios')
          .select('id, estado')
          .eq('servicio_id', svcId)
          .neq('origen', 'REMOVIDO')
          .neq('estado', 'NA'),
        db.from('servicios').select('estado').eq('id', svcId).maybeSingle(),
      ])
      const todos = todosItems || []
      const estadoActual = svc?.estado
      if (!todos.length || ['EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estadoActual)) return
      const esTerminado = e => e === 'LISTO' || e === 'ENTREGADO'
      const todosTerminados = todos.every(i => esTerminado(i.estado))
      const algunoEnProceso = todos.some(i => i.estado === 'EN_PROCESO')
      if (todosTerminados && estadoActual !== 'LISTO') {
        await db.from('servicios').update({ estado: 'LISTO' }).eq('id', svcId)
      } else if (!todosTerminados && estadoActual === 'LISTO') {
        await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', svcId)
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estadoActual)) {
        await db.from('servicios').update({ estado: 'EN_PRODUCCION' }).eq('id', svcId)
      }
    } catch (_) { /* silencioso — no bloquear el flujo de ítems */ }

    setSaving(false)
    onSaved({ ...item, ...patch })
    onClose()
  }

  const col = ESTADO_COLOR[estado] || ESTADO_COLOR.PENDIENTE

  return (
    <Modal open onClose={onClose} title={rec?.nombre || 'Ítem'}>
      <div className="space-y-4">

        {/* Indicadores */}
        <div className="flex flex-wrap gap-2">
          {soloN && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#D1FAE5', color: '#065F46' }}>
              <Zap size={11} /> Sin fotos — puede producirse ya
            </span>
          )}
          {reqImg && !fotos_ok && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#FEF3C7', color: '#92400E' }}>
              <Lock size={11} /> Requiere fotos del cliente
            </span>
          )}
          {reqImg && fotos_ok && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: '#D1FAE5', color: '#065F46' }}>
              <CheckCircle2 size={11} /> Fotos recibidas ✓
            </span>
          )}
        </div>

        {/* Fotos del cliente + reemplazo por una de mejor calidad */}
        {reqImg && fotos_ok && (
          <div className="rounded-xl border border-gray-200 p-3">
            <FotosDelCliente
              recordatorios={[{ ...item, ...fotos }]}
              servicioId={item.servicio_id}
              onCambiada={handleFotoCambiada}
            />
          </div>
        )}

        {/* Estado */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-2 uppercase tracking-wide">Estado</label>
          <div className="flex gap-1.5 flex-wrap">
            {ESTADOS_PROD.map(e => {
              const c = ESTADO_COLOR[e]
              const sel = estado === e
              return (
                <button key={e} onClick={() => setEstado(e)}
                  style={{
                    background: sel ? c.bg : 'transparent',
                    color: sel ? c.text : '#6B7280',
                    border: `1.5px solid ${sel ? c.border : '#E5E7EB'}`,
                    borderRadius: '20px', padding: '5px 12px',
                    fontSize: '11px', fontWeight: sel ? '700' : '500', cursor: 'pointer',
                  }}>
                  {ESTADO_LABEL[e]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Asignar persona */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
            <User size={11} className="inline mr-1" />Asignar a
          </label>
          <Select value={asignado} onChange={e => setAsignado(e.target.value)}>
            <option value="">Sin asignar</option>
            {personal.map(p => (
              <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>
            ))}
          </Select>
        </div>

        {/* Máquina */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
            <Cpu size={11} className="inline mr-1" />Máquina
          </label>
          <Select value={maquina} onChange={e => setMaquina(e.target.value)}>
            <option value="">Sin asignar</option>
            {maquinas.map(m => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </Select>
          {rec?.maquina_id && !maquina && (
            <p className="text-[11px] text-ink3 mt-1">
              Máquina sugerida: {maquinas.find(m => m.id === rec.maquina_id)?.nombre}
            </p>
          )}
        </div>

        {/* Notas */}
        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">Notas</label>
          <Textarea value={notas} onChange={e => setNotas(e.target.value)}
            placeholder="Observaciones de producción…" rows={2} />
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={guardar} disabled={saving} className="flex-1">
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Estado de la entrega por servicio: { servicio_id → entrega }. PENDIENTE es el
// cascarón que crea el trigger al nacer el servicio, no una entrega preparada:
// se descarta para que la tarjeta no diga nada hasta que alguien la publique.
// `dbIn` trocea: `.in()` con cientos de ids revienta la URL (414) en silencio.
async function cargarEntregas(servicioIds = []) {
  const filas = await dbIn(
    'entregas',
    'id, servicio_id, estado, mensajero_id, publicada_en, tomada_en, ' +
    'personal:mensajero_id ( nombre, apellido )',
    'servicio_id',
    servicioIds,
    q => q.neq('estado', 'PENDIENTE')
  )
  return Object.fromEntries(filas.map(e => [e.servicio_id, e]))
}

// Línea de estado bajo el botón de entrega: dónde está parada la entrega y con quién.
function EstadoEntrega({ ent }) {
  if (!ent) return null
  const quien = ent.personal ? `${ent.personal.nombre} ${ent.personal.apellido}`.trim() : null
  const CFG = {
    DISPONIBLE:  { color: '#3730A3', texto: 'Publicada — esperando que alguien la tome' },
    ASIGNADA:    { color: '#5B21B6', texto: quien ? `${ent.tomada_en ? 'La tomó' : 'Asignada a'} ${quien}` : 'Asignada' },
    EN_CAMINO:   { color: '#1E40AF', texto: quien ? `${quien} va en camino` : 'En camino' },
    ENTREGADA:   { color: '#065F46', texto: quien ? `Entregada por ${quien}` : 'Entregada' },
    FALLIDA:     { color: '#991B1B', texto: 'Entrega fallida' },
    REPROGRAMADA:{ color: '#92400E', texto: 'Reprogramada' },
  }[ent.estado]
  if (!CFG) return null
  return (
    <div className="mt-1.5 text-[11px] font-semibold text-center" style={{ color: CFG.color }}>
      {CFG.texto}
    </div>
  )
}

// ── VISTA POR SERVICIO ────────────────────────────────────────────────────────
function VistaPorServicio({ recordatorios, personal, maquinas, etapas = {}, entregas = {}, filtroEstado, filtroPersona, filtroRec, onClickItem, onPrepararEntrega }) {
  const filtrados = recordatorios.filter(r => {
    if (r.estado === 'NA') return false
    if (filtroPersona && r.asignado_a !== filtroPersona) return false
    if (filtroRec && String(r.recordatorio_id) !== String(filtroRec)) return false
    // Servicios en LISTO siempre visibles en cualquier filtro (botón de entrega).
    // Con filtro por recordatorio NO aplica: ahí se cuenta exactamente qué falta.
    if (!filtroRec && r.servicios?.estado === 'LISTO') return true
    if (filtroEstado === 'pendientes') return r.estado === 'PENDIENTE'
    if (filtroEstado === 'en_proceso') return r.estado === 'EN_PROCESO'
    if (filtroEstado === 'listos')     return r.estado === 'LISTO'
    return true
  })

  const porServicio = {}
  filtrados.forEach(r => {
    if (!porServicio[r.servicio_id]) porServicio[r.servicio_id] = {
      servicio: r.servicios, items: [], fotos_ok: !!r.servicios?.fecha_imagenes_recibidas,
    }
    porServicio[r.servicio_id].items.push(r)
  })

  // Servicios LISTO primero, ordenados por fecha límite de entrega (el más
  // próximo a vencer arriba; sin límite al final). El resto conserva su orden.
  const tarjetas = Object.entries(porServicio).sort(([, a], [, b]) => {
    const la = a.servicio?.estado === 'LISTO'
    const lb = b.servicio?.estado === 'LISTO'
    if (la !== lb) return la ? -1 : 1
    if (!la) return 0
    const ta = parseDate(a.servicio?.fecha_limite_entrega)?.getTime() ?? Infinity
    const tb = parseDate(b.servicio?.fecha_limite_entrega)?.getTime() ?? Infinity
    return ta - tb
  })

  if (tarjetas.length === 0) return (
    <div className="col-span-3 text-center py-16 text-ink3">
      <div className="text-4xl mb-3">⚙️</div>
      <div className="text-sm font-medium">Sin ítems para este filtro</div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {tarjetas.map(([sId, { servicio, items, fotos_ok }]) => {
        const mascota = servicio?.mascotas
        const plan    = servicio?.planes
        const etapa   = etapas[sId]
        const fmtCorta    = d => d?.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
        const limite      = parseDate(servicio?.fecha_limite_entrega)
        const diasAlLimite = limite ? Math.round((limite - parseDate(today())) / 86400000) : null
        const fechaFotos  = fotos_ok ? fmtCorta(parseDate(servicio.fecha_imagenes_recibidas)) : null
        const listosCnt = items.filter(i => ['LISTO', 'ENTREGADO'].includes(i.estado)).length
        const pct = items.length > 0 ? Math.round((listosCnt / items.length) * 100) : 0
        const bloqueados = items.filter(i =>
          i.recordatorios?.requiere_imagen && !i.recordatorios?.solo_nombre && !fotos_ok && i.estado === 'PENDIENTE'
        ).length
        const listosProd = items.filter(i =>
          i.recordatorios?.solo_nombre && i.estado === 'PENDIENTE'
        ).length

        const svcEstado = servicio?.estado
        const todoListo = svcEstado === 'LISTO'

        return (
          <div key={sId} className="bg-surface border rounded-2xl p-4 shadow-sm"
            style={{ borderColor: todoListo ? '#6EE7B7' : 'rgba(30,80,40,0.1)', borderWidth: todoListo ? 2 : 1 }}>
            {/* Header */}
            <div className="flex items-start gap-2 mb-2.5">
              <span className="text-xl mt-0.5">{petEmoji(mascota?.especies?.nombre)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink text-[13px] truncate">{mascota?.nombre || 'Sin nombre'}</div>
                <div className="text-[11px] text-ink3 truncate">{plan?.nombre}</div>
              </div>
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                {todoListo && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: '#D1FAE5', color: '#065F46' }}>
                    ✓ LISTO
                  </span>
                )}
                <div className="text-[11px] font-bold text-ink3">{listosCnt}/{items.length}</div>
              </div>
            </div>

            {/* Indicadores fotos + fecha límite de entrega */}
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {limite && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  title="Fecha máxima de entrega prometida al cliente"
                  style={diasAlLimite < 0
                    ? { background: '#FEE2E2', color: '#B91C1C' }
                    : diasAlLimite <= 2
                      ? { background: '#FEF3C7', color: '#92400E' }
                      : { background: '#E0E7FF', color: '#3730A3' }}>
                  <Clock size={9} />
                  {diasAlLimite < 0
                    ? `Venció ${fmtCorta(limite)}`
                    : diasAlLimite === 0
                      ? 'Entrega máx HOY'
                      : `Entrega máx ${fmtCorta(limite)}`}
                </span>
              )}
              {fotos_ok
                ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    title="Fecha en que el cliente subió las imágenes"
                    style={{ background: '#D1FAE5', color: '#065F46' }}>
                    <CheckCircle2 size={9} /> Fotos {fechaFotos || 'OK'}
                  </span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: '#FEF9C3', color: '#713F12' }}>
                    <Clock size={9} /> Sin fotos
                  </span>
              }
              {/* "Sin fotos" deja la pregunta obvia en el aire: ¿ya le insistimos?
                  Se responde AQUÍ, sin ir a otro módulo.
                  Se pinta siempre que las fotos estén frenando producción, incluso
                  sin contactos: "sin contactar" ES la respuesta, y su ausencia no
                  se distinguiría de una etiqueta que no cargó. */}
              {!fotos_ok && bloqueados > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  title={etapa?.numero
                    ? `Ya se le enviaron ${etapa.numero} contacto(s) por WhatsApp pidiendo las fotos`
                    : 'Todavía no se le ha escrito pidiendo las fotos'}
                  style={{ background: '#F3F4F6', color: etapa?.color || '#9CA3AF' }}>
                  <MessageCircle size={9} /> {etapa?.texto || 'sin contactar'}
                </span>
              )}
              {!fotos_ok && listosProd > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#ECFDF5', color: '#065F46' }}>
                  <Zap size={9} /> {listosProd} listas ya
                </span>
              )}
              {bloqueados > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <Lock size={9} /> {bloqueados} bloqueadas
                </span>
              )}
            </div>

            {/* Barra progreso */}
            <div className="k-progress-bar mb-3">
              <div className="k-progress-fill" style={{ width: `${pct}%` }} />
            </div>

            {/* Pills */}
            <div className="flex flex-wrap gap-1.5">
              {items.map(item => (
                <ItemPill key={item.id} item={item} personal={personal}
                  maquinas={maquinas} fotos_ok={fotos_ok} onClick={onClickItem} />
              ))}
            </div>

            {/* Traza: cuándo quedó listo el servicio */}
            {todoListo && servicio?.fecha_listo && (
              <div className="flex items-center gap-1.5 mt-2 text-[10px] font-semibold" style={{ color: '#059669' }}>
                <CheckCircle2 size={11} />
                Listo {new Date(servicio.fecha_listo).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}

            {/* Botón preparar entrega cuando está LISTO + en qué va */}
            {todoListo && onPrepararEntrega && (
              <>
                <button
                  onClick={() => onPrepararEntrega(sId)}
                  className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90"
                  style={{ background: '#4F46E5' }}>
                  <Truck size={13} /> {entregas[sId] ? 'Ver entrega' : 'Preparar entrega'}
                </button>
                <EstadoEntrega ent={entregas[sId]} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── VISTA POR MÁQUINA ─────────────────────────────────────────────────────────
function VistaPorMaquina({ recordatorios, personal, maquinas, onClickItem }) {
  const enProceso = recordatorios.filter(r => r.estado === 'EN_PROCESO' && r.estado !== 'NA')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {maquinas.map(maq => {
        const items = enProceso.filter(r =>
          r.maquina_id === maq.id ||
          (!r.maquina_id && r.recordatorios?.maquina_id === maq.id)
        )
        return (
          <div key={maq.id} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: items.length > 0 ? '#DBEAFE' : '#F3F4F6' }}>
                <Cpu size={16} style={{ color: items.length > 0 ? '#1E40AF' : '#9CA3AF' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">{maq.nombre}</div>
                <div className="text-[11px] text-ink3">{items.length} ítems en proceso</div>
              </div>
              {items.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              )}
            </div>
            {items.length === 0
              ? <div className="text-center py-6 text-ink3 text-[12px]">Máquina disponible</div>
              : (
                <div className="space-y-2">
                  {items.map(item => {
                    const mascota = item.servicios?.mascotas
                    const asig = personal.find(p => p.id === item.asignado_a)
                    return (
                      <button key={item.id} onClick={() => onClickItem(item)}
                        className="w-full text-left p-2.5 rounded-xl transition-colors hover:bg-surface2"
                        style={{ border: '1px solid rgba(30,80,40,0.08)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{petEmoji(mascota?.especies?.nombre)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-bold text-ink truncate">{item.recordatorios?.nombre}</div>
                            <div className="text-[11px] text-ink3 truncate">{mascota?.nombre}</div>
                          </div>
                          {asig && (
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                              style={{ background: '#1A5CD8' }}>
                              {initials(asig)}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            }
          </div>
        )
      })}

      {/* Sin máquina */}
      {(() => {
        const sinMaq = enProceso.filter(r => !r.maquina_id && !r.recordatorios?.maquina_id)
        if (!sinMaq.length) return null
        return (
          <div className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#FEF3C7' }}>
                <AlertCircle size={16} style={{ color: '#92400E' }} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">Sin máquina asignada</div>
                <div className="text-[11px] text-ink3">{sinMaq.length} ítems</div>
              </div>
            </div>
            <div className="space-y-2">
              {sinMaq.map(item => {
                const mascota = item.servicios?.mascotas
                return (
                  <button key={item.id} onClick={() => onClickItem(item)}
                    className="w-full text-left p-2.5 rounded-xl transition-colors hover:bg-surface2"
                    style={{ border: '1px solid rgba(30,80,40,0.08)' }}>
                    <div className="text-[12px] font-bold text-ink">{item.recordatorios?.nombre}</div>
                    <div className="text-[11px] text-ink3">{mascota?.nombre}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── VISTA POR PERSONA ─────────────────────────────────────────────────────────
function VistaPorPersona({ recordatorios, personal, maquinas, onClickItem }) {
  const asignados = recordatorios.filter(r => r.asignado_a && r.estado !== 'NA' && r.estado !== 'ENTREGADO')

  const porPersona = {}
  personal.forEach(p => { porPersona[p.id] = { persona: p, items: [] } })
  asignados.forEach(r => {
    if (porPersona[r.asignado_a]) porPersona[r.asignado_a].items.push(r)
  })

  const conItems = Object.values(porPersona).filter(p => p.items.length > 0)

  if (!conItems.length) return (
    <div className="text-center py-16 text-ink3">
      <User size={36} className="mx-auto mb-3 opacity-30" />
      <div className="text-sm font-medium">Ningún ítem asignado aún</div>
      <div className="text-xs mt-1">Haz click en un ítem para asignarlo a una persona</div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {conItems.map(({ persona, items }) => {
        const enProc = items.filter(i => i.estado === 'EN_PROCESO').length
        const listos = items.filter(i => i.estado === 'LISTO').length
        const pend   = items.filter(i => i.estado === 'PENDIENTE').length
        return (
          <div key={persona.id} className="bg-surface border rounded-2xl p-4 shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white"
                style={{ background: '#1A5CD8' }}>
                {initials(persona)}
              </div>
              <div className="flex-1">
                <div className="font-bold text-ink text-[13px]">{persona.nombre} {persona.apellido}</div>
                <div className="flex gap-2 mt-0.5">
                  {pend > 0 && <span className="text-[10px] font-bold" style={{ color: '#92400E' }}>{pend} pend.</span>}
                  {enProc > 0 && <span className="text-[10px] font-bold" style={{ color: '#1E40AF' }}>{enProc} en proc.</span>}
                  {listos > 0 && <span className="text-[10px] font-bold" style={{ color: '#065F46' }}>{listos} listos</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map(item => (
                <ItemPill key={item.id} item={item} personal={personal}
                  maquinas={maquinas} fotos_ok={!!item.servicios?.fecha_imagenes_recibidas} onClick={onClickItem} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── VISTA TABLA ───────────────────────────────────────────────────────────────
function VistaTabla({ recordatorios, personal, maquinas, filtroEstado, filtroPersona, filtroRec, onClickItem }) {
  const filtrados = recordatorios.filter(r => {
    if (r.estado === 'NA') return false
    if (filtroPersona && r.asignado_a !== filtroPersona) return false
    if (filtroRec && String(r.recordatorio_id) !== String(filtroRec)) return false
    if (filtroEstado === 'pendientes') return r.estado === 'PENDIENTE'
    if (filtroEstado === 'en_proceso') return r.estado === 'EN_PROCESO'
    if (filtroEstado === 'listos')     return r.estado === 'LISTO'
    return true
  })

  const sorted = [...filtrados].sort((a, b) =>
    (a.servicios?.mascotas?.nombre || '').localeCompare(b.servicios?.mascotas?.nombre || '', 'es') ||
    (a.recordatorios?.nombre || '').localeCompare(b.recordatorios?.nombre || '', 'es')
  )

  return (
    <div className="bg-surface border rounded-2xl shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Mascota</Th>
              <Th>Plan</Th>
              <Th>Recordatorio</Th>
              <Th>Estado</Th>
              <Th>Asignado</Th>
              <Th>Máquina</Th>
              <Th>Fotos</Th>
              <Th>Notas</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <Td colSpan={8} className="text-center py-12 text-ink3">Sin ítems para este filtro</Td>
              </tr>
            )}
            {sorted.map(r => {
              const rec      = r.recordatorios
              const mascota  = r.servicios?.mascotas
              const col      = ESTADO_COLOR[r.estado] || ESTADO_COLOR.PENDIENTE
              const asig     = personal.find(p => p.id === r.asignado_a)
              const maq      = maquinas.find(m => m.id === r.maquina_id) || maquinas.find(m => m.id === rec?.maquina_id)
              const fotosOk  = !!r.servicios?.fecha_imagenes_recibidas
              const soloN    = rec?.solo_nombre
              const reqImg   = rec?.requiere_imagen && !soloN
              const bloqueado = reqImg && !fotosOk && r.estado === 'PENDIENTE'
              return (
                <Tr key={r.id} onClick={() => onClickItem(r)}>
                  <Td className="font-semibold whitespace-nowrap">
                    {petEmoji(mascota?.especies?.nombre)} {mascota?.nombre || 'Sin nombre'}
                  </Td>
                  <Td className="whitespace-nowrap">{r.servicios?.planes?.nombre || '—'}</Td>
                  <Td className="whitespace-nowrap font-semibold">{rec?.nombre || 'Ítem'}</Td>
                  <Td>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }}>
                      {ESTADO_LABEL[r.estado]}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{asig ? `${asig.nombre} ${asig.apellido || ''}`.trim() : '—'}</Td>
                  <Td className="whitespace-nowrap">{maq?.nombre || '—'}</Td>
                  <Td className="whitespace-nowrap">
                    {!reqImg
                      ? <span className="text-[11px] text-ink3">No requiere</span>
                      : bloqueado
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#92400E' }}><Lock size={10} /> Bloqueado</span>
                        : fotosOk
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#065F46' }}><CheckCircle2 size={10} /> OK</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: '#713F12' }}><Clock size={10} /> Sin fotos</span>}
                  </Td>
                  <Td className="max-w-[16rem] truncate text-ink3" title={r.notas || ''}>{r.notas || ''}</Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      </TableWrap>
      {sorted.length > 0 && (
        <div className="px-4 py-2.5 text-[11px] font-semibold text-ink3 border-t" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
          {sorted.length} ítem{sorted.length !== 1 ? 's' : ''} · {new Set(sorted.map(r => r.servicio_id)).size} mascota{new Set(sorted.map(r => r.servicio_id)).size !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

// ── VISTA BITÁCORA (solo ADMIN/COORDINADOR) ───────────────────────────────────
// Histórico de quién marcó cada recordatorio en cada estado y a quién quedó
// asignado. Se alimenta de la tabla produccion_recordatorio_log (trigger en DB).
function EstadoBadge({ estado }) {
  const c = ESTADO_COLOR[estado] || ESTADO_COLOR.NA
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {ESTADO_LABEL[estado] || estado || '—'}
    </span>
  )
}

// Normaliza texto para la búsqueda inteligente: minúsculas + sin tildes.
const normalizar = s => (s ?? '').toString().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')

function VistaBitacora({ rows, loading }) {
  const [q,        setQ]        = useState('')
  const [fPersona, setFPersona] = useState('')
  const [fEstado,  setFEstado]  = useState('')
  const [fRec,     setFRec]     = useState('')
  const [fRango,   setFRango]   = useState('')   // '', 'hoy', '7d', '30d'

  // Opciones de "marcado por" a partir del propio log (incluye técnicos que no
  // están en la lista de operarios activos de producción).
  const personas = [...new Map(
    rows.filter(r => r.cambiado_por).map(r => [r.cambiado_por, r.cambiado_por_nombre || 'Sin nombre'])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))

  // Tipos de recordatorio presentes en el log (para el filtro por recordatorio).
  const recOpciones = [...new Set(rows.map(r => r.recordatorio_nombre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))

  // Umbral de fecha según el rango elegido.
  const desde = (() => {
    if (!fRango) return null
    const d = new Date()
    if (fRango === 'hoy') { d.setHours(0, 0, 0, 0); return d }
    if (fRango === '7d')  { d.setDate(d.getDate() - 7);  return d }
    if (fRango === '30d') { d.setDate(d.getDate() - 30); return d }
    return null
  })()

  // Búsqueda inteligente: cada palabra debe aparecer en algún campo (sin tildes),
  // así "max listo" encuentra a la mascota Max marcada como Listo, en cualquier orden.
  const tokens = normalizar(q).split(/\s+/).filter(Boolean)

  const hayFiltros = q.trim() || fPersona || fEstado || fRec || fRango
  const limpiar = () => { setQ(''); setFPersona(''); setFEstado(''); setFRec(''); setFRango('') }

  const filtrados = rows.filter(r => {
    if (fPersona) {
      if (fPersona === '__auto__') { if (r.cambiado_por) return false }
      else if (String(r.cambiado_por) !== String(fPersona)) return false
    }
    if (fEstado && r.estado_nuevo !== fEstado) return false
    if (fRec && r.recordatorio_nombre !== fRec) return false
    if (desde && new Date(r.created_at) < desde) return false
    if (tokens.length) {
      const heno = normalizar([
        r.mascota_nombre, r.recordatorio_nombre, r.cambiado_por_nombre, r.asignado_nombre,
        ESTADO_LABEL[r.estado_anterior] || r.estado_anterior,
        ESTADO_LABEL[r.estado_nuevo] || r.estado_nuevo,
        r.cambiado_por ? '' : 'automatico sistema',
      ].filter(Boolean).join(' '))
      if (!tokens.every(t => heno.includes(t))) return false
    }
    return true
  })

  const fmtFecha = iso => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }

  return (
    <div>
      {/* Filtros de la bitácora */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Búsqueda inteligente: mascota, persona, estado…" className="pl-8 w-72" />
        </div>
        <Select value={fRec} onChange={e => setFRec(e.target.value)} className="w-48">
          <option value="">Todos los recordatorios</option>
          {recOpciones.map(nombre => <option key={nombre} value={nombre}>{nombre}</option>)}
        </Select>
        <Select value={fPersona} onChange={e => setFPersona(e.target.value)} className="w-52">
          <option value="">Todos los que marcaron</option>
          {personas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          <option value="__auto__">Automático / sistema</option>
        </Select>
        <Select value={fEstado} onChange={e => setFEstado(e.target.value)} className="w-40">
          <option value="">Cualquier estado</option>
          {['PENDIENTE', 'EN_PROCESO', 'LISTO', 'ENTREGADO'].map(e =>
            <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
        </Select>
        <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          {[
            { key: '',    label: 'Todo'    },
            { key: 'hoy', label: 'Hoy'     },
            { key: '7d',  label: '7 días'   },
            { key: '30d', label: '30 días'  },
          ].map(f => (
            <button key={f.key || 'todo'}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${fRango === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
              onClick={() => setFRango(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {hayFiltros && (
          <button onClick={limpiar}
            className="text-[12px] font-semibold text-ink3 hover:text-primary-dark px-2 py-1.5 rounded-lg hover:bg-surface2">
            Limpiar
          </button>
        )}
        <span className="text-[11px] text-ink3 ml-auto">
          {filtrados.length} movimiento{filtrados.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="bg-surface border rounded-2xl shadow-sm overflow-hidden" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Cuándo</Th>
                <Th>Mascota</Th>
                <Th>Recordatorio</Th>
                <Th>Cambio de estado</Th>
                <Th>Asignado a</Th>
                <Th>Marcado por</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><Td colSpan={6} className="text-center py-12 text-ink3">Cargando bitácora…</Td></tr>
              )}
              {!loading && filtrados.length === 0 && (
                <tr><Td colSpan={6} className="text-center py-12 text-ink3">Sin movimientos para este filtro</Td></tr>
              )}
              {!loading && filtrados.map(r => (
                <tr key={r.id} className="border-t" style={{ borderColor: 'rgba(30,80,40,0.06)' }}>
                  <Td className="whitespace-nowrap text-ink3 text-[12px]">{fmtFecha(r.created_at)}</Td>
                  <Td className="font-semibold whitespace-nowrap">{r.mascota_nombre || '—'}</Td>
                  <Td className="whitespace-nowrap">{r.recordatorio_nombre || '—'}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {r.estado_anterior
                        ? <><EstadoBadge estado={r.estado_anterior} /><ArrowRight size={12} className="text-ink3" /></>
                        : <span className="text-[10px] font-bold text-ink3 uppercase">alta</span>}
                      <EstadoBadge estado={r.estado_nuevo} />
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-ink2">{r.asignado_nombre || <span className="text-ink3">Sin asignar</span>}</Td>
                  <Td className="whitespace-nowrap font-semibold">
                    {r.cambiado_por_nombre || <span className="text-ink3 font-normal italic">Automático</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </div>
  )
}

// ── MÓDULO PRINCIPAL ──────────────────────────────────────────────────────────
export default function Produccion() {
  const { alert: showAlert } = useConfirm()
  const { personalData } = useAuth()
  const esAdmin = personalData?.rol === 'ADMIN' || personalData?.rol === 'COORDINADOR'
  const [recordatorios, setRecordatorios] = useState([])
  const [etapas,        setEtapas]        = useState({})   // servicio_id → etapa de contacto
  const [entregas,      setEntregas]      = useState({})   // servicio_id → entrega (pool / asignada)
  const [personal,      setPersonal]      = useState([])
  const [maquinas,      setMaquinas]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const primeraCarga                      = useRef(true)
  const [error,         setError]         = useState(null)
  const [vista,         setVista]         = useState('servicio')
  const [filtroEstado,  setFiltroEstado]  = useState('pendientes')
  const [filtroPersona, setFiltroPersona] = useState('')
  const [filtroRec,     setFiltroRec]     = useState('')   // id de recordatorio; '' = todos
  const [modalItem,     setModalItem]     = useState(null)
  const [modalEntrega,  setModalEntrega]  = useState(null) // servicioId string
  const [logRows,       setLogRows]       = useState([])   // bitácora (solo admin)
  const [logLoading,    setLogLoading]    = useState(false)

  useEffect(() => {
    cargar()
    const refrescar = agruparRefresco(() => {
      cargar()
      if (esAdmin) cargarLog()
    })
    const canal = db
      .channel('produccion-cambios')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicio_recordatorios' }, refrescar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servicios' }, refrescar)
      .subscribe()
    return () => { refrescar.cancelar(); db.removeChannel(canal) }
  }, [esAdmin])

  // Cargar la bitácora al abrir la pestaña (solo admin/coordinador)
  useEffect(() => {
    if (esAdmin && vista === 'bitacora') cargarLog()
  }, [esAdmin, vista])

  async function cargarLog() {
    setLogLoading(true)
    // .order() obligatorio con límite: sin él las filas nuevas quedan por fuera
    // al superar el tope (bug silencioso ya visto en Comprobantes).
    const { data } = await db.from('produccion_recordatorio_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setLogRows(data || [])
    setLogLoading(false)
  }

  // El spinner de pantalla completa solo se pinta en la PRIMERA carga: las
  // recargas posteriores (realtime de otro usuario, o tras guardar) pasan en
  // segundo plano. Si volviera a `loading`, el `if (loading) return` desmontaria
  // la pagina entera y con ella cualquier modal abierto.
  async function cargar() {
    try {
      if (primeraCarga.current) setLoading(true)
      const [{ data: recs }, { data: per }, { data: maq }] = await Promise.all([
        db.from('servicio_recordatorios')
          .select(`
            *,
            recordatorios ( id, nombre, categoria, requiere_imagen, solo_nombre,
                            recolecta_tecnico, tiempo_produccion_dias, maquina_id,
                            maquinas_produccion ( id, nombre ) ),
            servicios!inner ( id, fecha_imagenes_recibidas, fecha_limite_entrega, fecha_listo, estado,
                        mascotas ( nombre, especie_id, especies ( nombre ) ),
                        planes ( nombre, codigo ) )
          `)
          .neq('origen', 'REMOVIDO')
          .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
          .gte('servicios.fecha_ingreso', FECHA_CORTE)
          .order('created_at', { ascending: false }),
        db.from('personal').select('id, nombre, apellido, activo').eq('activo', true).order('nombre'),
        db.from('maquinas_produccion').select('*').eq('activo', true).order('nombre'),
      ])
      setRecordatorios(recs || [])
      setPersonal(per || [])
      setMaquinas(maq || [])
      // Estado de la entrega de los servicios ya LISTO: si está publicada al pool,
      // si alguien la tomó y quién. Es el control de entregas del coordinador.
      cargarEntregas((recs || [])
        .filter(r => ['LISTO', 'EN_ENTREGA'].includes(r.servicios?.estado))
        .map(r => r.servicios?.id))
        .then(setEntregas).catch(() => {})   // informativo: si falla, el tablero sigue
      // En qué contacto va cada servicio que AÚN espera fotos. Solo se piden los
      // que no han cargado: para el resto la etiqueta no aplica y seria ruido.
      // Va aparte (no en el join) porque los contactos cuelgan del servicio, no
      // del recordatorio, y el join los duplicaría por cada ítem de la tarjeta.
      cargarEtapasContacto(
        (recs || [])
          .filter(r => !r.servicios?.fecha_imagenes_recibidas)
          .map(r => r.servicios?.id)
      ).then(setEtapas).catch(() => {})   // la etiqueta es informativa: si falla, el tablero sigue
      // Sincronizar servicios cuyo estado no refleja el estado real de sus ítems
      await autoCorregirEstados(recs || [])
    } catch (e) {
      // Un fallo en un refresco de fondo NO debe tumbar la pantalla (el
      // `if (error) return` borraria la pagina y el modal abierto): solo la
      // primera carga, que no tiene nada que mostrar, muestra el error.
      if (primeraCarga.current) setError(e.message)
      else console.error('Refresco en segundo plano falló:', e)
    } finally {
      primeraCarga.current = false
      setLoading(false)
    }
  }

  async function autoCorregirEstados(recs) {
    const porServicio = {}
    recs.forEach(r => {
      if (!porServicio[r.servicio_id]) porServicio[r.servicio_id] = { svc: r.servicios, items: [] }
      porServicio[r.servicio_id].items.push(r)
    })
    const fijarListo = []
    const fijarEnProduccion = []
    for (const [svcId, { svc, items }] of Object.entries(porServicio)) {
      if (!items.length) continue
      const estado = svc?.estado
      if (['LISTO', 'EN_ENTREGA', 'ENTREGADO', 'CANCELADO'].includes(estado)) continue
      const todosListos = items.every(i => i.estado === 'LISTO')
      // Los ítems que recolecta el técnico entran a EN_PROCESO ya en la recogida;
      // NO deben adelantar el servicio a EN_PRODUCCION (eso lo dispara producción
      // real). Solo cuentan los ítems no-técnico para el avance automático.
      const algunoEnProceso = items.some(i => i.estado === 'EN_PROCESO' && !i.recordatorios?.recolecta_tecnico)
      if (todosListos) {
        fijarListo.push(svcId)
      } else if (algunoEnProceso && ['INGRESADO', 'EN_CUARTO_FRIO', 'EN_PROCESO'].includes(estado)) {
        fijarEnProduccion.push(svcId)
      }
    }
    if (!fijarListo.length && !fijarEnProduccion.length) return
    const ops = []
    if (fijarListo.length)        ops.push(db.from('servicios').update({ estado: 'LISTO'          }).in('id', fijarListo))
    if (fijarEnProduccion.length) ops.push(db.from('servicios').update({ estado: 'EN_PRODUCCION' }).in('id', fijarEnProduccion))
    await Promise.all(ops)
    // Recargar para que las tarjetas reflejen el nuevo estado del servicio
    const { data: recsNuevos } = await db.from('servicio_recordatorios')
      .select(`
        *,
        recordatorios ( id, nombre, categoria, requiere_imagen, solo_nombre,
                        recolecta_tecnico, tiempo_produccion_dias, maquina_id,
                        maquinas_produccion ( id, nombre ) ),
        servicios!inner ( id, fecha_imagenes_recibidas, fecha_limite_entrega, fecha_listo, estado,
                    mascotas ( nombre, especie_id, especies ( nombre ) ),
                    planes ( nombre, codigo ) )
      `)
      .neq('origen', 'REMOVIDO')
      .in('estado', ['PENDIENTE', 'EN_PROCESO', 'LISTO'])
      .gte('servicios.fecha_ingreso', FECHA_CORTE)
      .order('created_at', { ascending: false })
    setRecordatorios(recsNuevos || [])
  }

  function handleSaved(updatedItem) {
    setRecordatorios(prev => prev.map(r => r.id === updatedItem.id ? { ...r, ...updatedItem } : r))
  }

  const stats = {
    pendientes: recordatorios.filter(r => r.estado === 'PENDIENTE').length,
    enProceso:  recordatorios.filter(r => r.estado === 'EN_PROCESO').length,
    listos:     recordatorios.filter(r => r.estado === 'LISTO').length,
    sinFotos:   recordatorios.filter(r =>
      r.recordatorios?.requiere_imagen && !r.recordatorios?.solo_nombre &&
      !r.servicios?.fecha_imagenes_recibidas && r.estado === 'PENDIENTE'
    ).length,
  }

  const VISTAS = [
    { key: 'servicio', label: 'Por servicio' },
    { key: 'tabla',    label: 'Tabla'        },
    { key: 'maquina',  label: 'Por máquina'  },
    { key: 'persona',  label: 'Por persona'  },
    // Bitácora de auditoría: solo para roles con acceso total (ADMIN/COORDINADOR)
    ...(esAdmin ? [{ key: 'bitacora', label: 'Bitácora' }] : []),
  ]
  const vistaConFiltros = vista === 'servicio' || vista === 'tabla'

  // Tipos de recordatorio presentes en los ítems cargados (para el filtro)
  const recOpciones = [...new Map(
    recordatorios
      .filter(r => r.recordatorios && r.estado !== 'NA')
      .map(r => [r.recordatorios.id, r.recordatorios.nombre])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))

  // Resumen del recordatorio filtrado: cuántos hay por estado y en cuántas mascotas
  const itemsRecSel = filtroRec
    ? recordatorios.filter(r => String(r.recordatorio_id) === String(filtroRec) && r.estado !== 'NA')
    : []
  const recSelResumen = filtroRec ? {
    nombre:     recOpciones.find(([id]) => String(id) === String(filtroRec))?.[1] || 'Recordatorio',
    pendientes: itemsRecSel.filter(r => r.estado === 'PENDIENTE').length,
    enProceso:  itemsRecSel.filter(r => r.estado === 'EN_PROCESO').length,
    listos:     itemsRecSel.filter(r => r.estado === 'LISTO').length,
    mascotas:   new Set(itemsRecSel.map(r => r.servicio_id)).size,
  } : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-3">
      <div className="spinner" /><span className="text-sm text-ink3">Cargando producción…</span>
    </div>
  )
  if (error) return (
    <div className="p-7"><div className="bg-danger-light text-danger border border-danger/30 rounded-lg p-3 text-sm">Error: {error}</div></div>
  )

  return (
    <div>
      <Topbar actions={
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2"
          onClick={() => { cargar(); if (esAdmin && vista === 'bitacora') cargarLog() }}>
          <RefreshCw size={15} />
        </button>
      } />
      <div className="p-7">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <StatCard label="Pendientes"    value={stats.pendientes} valueColor="#C03030" />
          <StatCard label="En proceso"   value={stats.enProceso}  valueColor="#1E40AF" />
          <StatCard label="Listos"        value={stats.listos}     valueColor="#065F46" />
          <StatCard label="Bloqueados (sin fotos)" value={stats.sinFotos} valueColor="#92400E"
            sub={stats.sinFotos > 0 ? 'Esperan imágenes del cliente' : 'Todo al día'} />
        </div>

        {/* Tabs de vista */}
        <div className="flex flex-wrap gap-3 mb-5 items-center">
          <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            {VISTAS.map(v => (
              <button key={v.key}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${vista === v.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                onClick={() => setVista(v.key)}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Filtros en vistas por servicio y tabla */}
          {vistaConFiltros && (
            <>
              <Select value={filtroPersona} onChange={e => setFiltroPersona(e.target.value)} className="w-44">
                <option value="">Todos los operarios</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select>
              <Select value={filtroRec} onChange={e => setFiltroRec(e.target.value)} className="w-48">
                <option value="">Todos los recordatorios</option>
                {recOpciones.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </Select>
              <div className="flex gap-1 bg-surface2 rounded-[10px] p-1 border" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                {[
                  { key: 'pendientes', label: 'Pendientes' },
                  { key: 'en_proceso', label: 'En proceso' },
                  { key: 'listos',     label: 'Listos'     },
                  { key: 'todos',      label: 'Todos'      },
                ].map(f => (
                  <button key={f.key}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filtroEstado === f.key ? 'bg-primary-dark text-white' : 'text-ink2 hover:bg-surface3'}`}
                    onClick={() => setFiltroEstado(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3 text-[11px] text-ink3">
            <span className="inline-flex items-center gap-1"><Zap size={10} style={{ color: '#059669' }} /> Sin fotos OK</span>
            <span className="inline-flex items-center gap-1"><Lock size={10} style={{ color: '#92400E' }} /> Bloqueado</span>
            <span className="inline-flex items-center gap-1"><Cpu size={10} /> Máquina</span>
          </div>
        </div>

        {/* Resumen del recordatorio filtrado (¿cuántos altares faltan y de qué mascotas?) */}
        {vistaConFiltros && recSelResumen && (
          <div className="flex flex-wrap items-center gap-2 mb-4 px-4 py-2.5 rounded-xl border text-[12px]"
            style={{ background: '#EEF3FB', borderColor: '#C5D8F5' }}>
            <Package size={13} style={{ color: '#1A5CD8' }} />
            <span className="font-bold text-ink">{recSelResumen.nombre}:</span>
            <span className="font-bold" style={{ color: '#C03030' }}>{recSelResumen.pendientes} pendiente{recSelResumen.pendientes !== 1 ? 's' : ''}</span>
            <span className="text-ink3">·</span>
            <span className="font-bold" style={{ color: '#1E40AF' }}>{recSelResumen.enProceso} en proceso</span>
            <span className="text-ink3">·</span>
            <span className="font-bold" style={{ color: '#065F46' }}>{recSelResumen.listos} listo{recSelResumen.listos !== 1 ? 's' : ''}</span>
            <span className="text-ink3">— en {recSelResumen.mascotas} mascota{recSelResumen.mascotas !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* Contenido según vista */}
        {vista === 'servicio' && (
          <VistaPorServicio
            recordatorios={recordatorios} personal={personal} maquinas={maquinas} etapas={etapas}
            entregas={entregas}
            filtroEstado={filtroEstado} filtroPersona={filtroPersona} filtroRec={filtroRec}
            onClickItem={setModalItem}
            onPrepararEntrega={id => setModalEntrega(id)}
          />
        )}
        {vista === 'tabla' && (
          <VistaTabla
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            filtroEstado={filtroEstado} filtroPersona={filtroPersona} filtroRec={filtroRec}
            onClickItem={setModalItem}
          />
        )}
        {vista === 'maquina' && (
          <VistaPorMaquina
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            onClickItem={setModalItem}
          />
        )}
        {vista === 'persona' && (
          <VistaPorPersona
            recordatorios={recordatorios} personal={personal} maquinas={maquinas}
            onClickItem={setModalItem}
          />
        )}
        {vista === 'bitacora' && esAdmin && (
          <VistaBitacora rows={logRows} loading={logLoading} />
        )}

      </div>

      {/* Modal gestión ítem */}
      {modalItem && (
        <ModalItem
          item={modalItem}
          personal={personal}
          maquinas={maquinas}
          fotos_ok={!!modalItem.servicios?.fecha_imagenes_recibidas}
          onClose={() => setModalItem(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Modal preparar entrega */}
      {modalEntrega && (
        <ModalPreparaEntrega
          servicioId={modalEntrega}
          onClose={() => setModalEntrega(null)}
          onGuardado={() => { setModalEntrega(null); cargar() }}
        />
      )}
    </div>
  )
}
