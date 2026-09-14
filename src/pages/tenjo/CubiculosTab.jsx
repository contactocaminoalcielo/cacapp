// Pestaña "Cubículos" — mapa de la planta de Tenjo + CRUD del catálogo.
//
// El mapa es la vista operativa: de un vistazo se ve qué cubículo está libre,
// cuál está ocupado y por quién. El CRUD (crear / fuera de servicio / borrar)
// queda restringido a ADMIN y COORDINADOR: el operario usa el mapa y libera.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { StatCard } from '@/components/ui/card'
import { db } from '@/lib/supabase'
import {
  cargarCubiculos, cargarCodigosHuerfanos, liberarCubiculo, asignarCubiculo,
  mensajeErrorCubiculo, etiquetaCubiculo, zonaCfg, tallaLbl, cuposLibres, finCompostaje,
  ZONA_KEYS, TALLA_KEYS, ZONAS,
} from '@/lib/cubiculos'
import MapaCubiculos, { LeyendaCubiculos } from '@/pages/tenjo/MapaCubiculos'
import { petEmoji, parsearErrorDB, hoyLocalISO } from '@/lib/utils'
import { Plus, RefreshCw, AlertTriangle, Unlock, Ban, CheckCircle2, Trash2, Search } from 'lucide-react'

const fmtFecha = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

export default function CubiculosTab({ canPlan, personalData, onChanged }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [cubiculos, setCubiculos] = useState([])
  const [ocupacion, setOcupacion] = useState({})
  const [huerfanos, setHuerfanos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [sinTabla,  setSinTabla]  = useState(false)
  const [saving,    setSaving]    = useState(false)

  // Filtros
  const [fZona,   setFZona]   = useState('')
  const [fEstado, setFEstado] = useState('')   // '' | 'LIBRE' | 'CON_CUPO' | 'OCUPADO' | 'INACTIVO'
  const [fBusca,  setFBusca]  = useState('')   // nombre de mascota

  const [modalDetalle, setModalDetalle] = useState(null) // cubículo
  const [modalNuevo,   setModalNuevo]   = useState(false)
  const [nuevoForm,    setNuevoForm]    = useState({ zona: 'AZUL', talla: 'P', numero: '', notas: '' })
  const [modalHuerfano, setModalHuerfano] = useState(null) // item con código viejo
  const [huerfanoCub,   setHuerfanoCub]   = useState(null) // cubículo elegido para el huérfano

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const { cubiculos: cubs, ocupacion: ocu } = await cargarCubiculos()
      setCubiculos(cubs); setOcupacion(ocu)
      setHuerfanos(await cargarCodigosHuerfanos())
      setSinTabla(false)
    } catch (e) {
      const msg = e?.message || ''
      // La migración 055 aún no está aplicada en este entorno
      if (/relation .*cubiculos.* does not exist|schema cache/i.test(msg)) setSinTabla(true)
      // La 155 (cupo por cubículo + fecha de salida) tampoco
      else if (/capacidad|cubiculo_salida/i.test(msg)) {
        await showAlert(
          'Falta aplicar migrations/155_tenjo_salida_cubiculo_cupo.sql en esta base de datos: sin ella no existen el cupo del cubículo ni la fecha de salida.',
          { title: 'Falta la migración 155', variant: 'danger' })
      }
      else await showAlert(parsearErrorDB(e), { title: 'Error al cargar cubículos', variant: 'danger' })
    } finally { setLoading(false) }
  }, [showAlert])

  useEffect(() => { cargar() }, [cargar])

  // ─── Filtrado ──────────────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const busca = fBusca.trim().toLowerCase()
    return cubiculos.filter(c => {
      if (fZona && c.zona !== fZona) return false
      const ocupantes = ocupacion[c.id] || []
      if (fEstado === 'LIBRE'    && (ocupantes.length > 0 || !c.activo)) return false
      if (fEstado === 'CON_CUPO' && (cuposLibres(c, ocupantes) === 0 || ocupantes.length === 0)) return false
      if (fEstado === 'OCUPADO'  && ocupantes.length === 0) return false
      if (fEstado === 'INACTIVO' && c.activo) return false
      if (busca) {
        const hayMascota = ocupantes.some(o => (o.servicios?.mascotas?.nombre || '').toLowerCase().includes(busca))
        if (!hayMascota && !c.codigo.toLowerCase().includes(busca)) return false
      }
      return true
    })
  }, [cubiculos, ocupacion, fZona, fEstado, fBusca])

  // Se cuenta por CUPOS: con capacidad > 1 "ocupados" por cubículo miente sobre
  // cuánto espacio queda de verdad en la planta.
  const stats = useMemo(() => {
    const cupos     = cubiculos.reduce((n, c) => n + (c.activo ? (c.capacidad ?? 1) : 0), 0)
    const ocupados  = cubiculos.reduce((n, c) => n + (ocupacion[c.id]?.length || 0), 0)
    const inactivos = cubiculos.filter(c => !c.activo).length
    return { total: cubiculos.length, cupos, ocupados, inactivos, libres: cupos - ocupados }
  }, [cubiculos, ocupacion])

  // ─── Acciones ──────────────────────────────────────────────────────────────
  async function crearCubiculo() {
    const numero = parseInt(nuevoForm.numero)
    if (!numero || numero < 1) {
      await showAlert('Indica un número de cubículo válido.', { title: 'Número requerido' }); return
    }
    setSaving(true)
    try {
      const { error } = await db.from('cubiculos').insert({
        zona: nuevoForm.zona, talla: nuevoForm.talla, numero,
        notas: nuevoForm.notas.trim() || null,
      })
      if (error) throw error
      setModalNuevo(false)
      setNuevoForm({ zona: 'AZUL', talla: 'P', numero: '', notas: '' })
      await cargar(); onChanged?.()
    } catch (e) {
      const dup = /uq_cubiculo_zona_talla_numero|duplicate key/i.test(e?.message || '')
      await showAlert(dup ? 'Ese cubículo ya existe en el catálogo.' : parsearErrorDB(e),
        { title: 'No se pudo crear', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function guardarDetalle(cambios) {
    if (!modalDetalle) return
    setSaving(true)
    try {
      const { error } = await db.from('cubiculos').update(cambios).eq('id', modalDetalle.id)
      if (error) throw error
      setModalDetalle(null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo guardar', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function borrarCubiculo() {
    if (!modalDetalle) return
    const ok = await confirm({
      title: `Borrar ${etiquetaCubiculo(modalDetalle)}`,
      message: 'Se elimina del catálogo. Si alguna vez tuvo una mascota, no se podrá borrar: márcalo como fuera de servicio.',
      variant: 'danger', confirmText: 'Borrar',
    })
    if (!ok) return
    setSaving(true)
    try {
      const { error } = await db.from('cubiculos').delete().eq('id', modalDetalle.id)
      if (error) throw error
      setModalDetalle(null)
      await cargar(); onChanged?.()
    } catch (e) {
      const fk = /violates foreign key|still referenced/i.test(e?.message || '')
      await showAlert(
        fk ? 'Este cubículo tiene historia (ya alojó una mascota), así que no se puede borrar. Márcalo como "fuera de servicio".'
           : parsearErrorDB(e),
        { title: 'No se pudo borrar', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Saca UNA mascota del cubículo. Para varias a la vez, y para poner la fecha
  // real de salida (de la que cuelga la entrega de los recordatorios), está la
  // pestaña Salidas; aquí se resuelve el caso suelto con la fecha de hoy.
  async function liberar(cub, item) {
    if (!item) return
    const mascota = item.servicios?.mascotas?.nombre || 'la mascota'
    const ok = await confirm({
      title: `Sacar de ${etiquetaCubiculo(cub)}`,
      message: `Confirma que ${mascota} salió HOY del cubículo. Si salió otro día, regístralo desde la pestaña Salidas: esa fecha abre el plazo de entrega de los recordatorios.`,
      confirmText: 'Registrar salida',
    })
    if (!ok) return
    setSaving(true)
    try {
      await liberarCubiculo(item.id, personalData?.id, hoyLocalISO())
      setModalDetalle(null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'No se pudo registrar la salida', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Enlazar un código viejo ("N-2") a un cubículo real del catálogo
  async function resolverHuerfano() {
    if (!modalHuerfano || !huerfanoCub) return
    setSaving(true)
    try {
      await asignarCubiculo(modalHuerfano.id, huerfanoCub)
      setModalHuerfano(null); setHuerfanoCub(null)
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(mensajeErrorCubiculo(e), { title: 'No se pudo enlazar', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (sinTabla) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
        <div className="font-bold mb-1 flex items-center gap-2"><AlertTriangle size={15} /> Falta aplicar la migración 055</div>
        El catálogo de cubículos aún no existe en esta base de datos. Aplica
        <code className="mx-1 px-1 rounded bg-amber-100">migrations/055_tenjo_cubiculos_catalogo.sql</code>
        y recarga.
      </div>
    )
  }
  if (loading) {
    return <div className="flex items-center justify-center h-64 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando cubículos…</span></div>
  }

  const detOcupantes = modalDetalle ? (ocupacion[modalDetalle.id] || []) : []

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Cubículos" value={stats.total} sub={`${stats.cupos} cupos`} valueColor="#3B6FBF" />
        <StatCard label="Cupos libres" value={stats.libres} valueColor={stats.libres > 0 ? '#16A34A' : '#C03030'} />
        <StatCard label="Mascotas dentro" value={stats.ocupados} valueColor="#9A5500" />
        <StatCard label="Fuera de servicio" value={stats.inactivos} valueColor={stats.inactivos > 0 ? '#6B7280' : '#9CA3AF'} />
      </div>

      {/* Códigos viejos sin enlazar (migración 055) */}
      {huerfanos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <div className="text-[12px] font-bold text-amber-900 mb-2 flex items-center gap-2">
            <AlertTriangle size={14} />
            {huerfanos.length} código{huerfanos.length !== 1 ? 's' : ''} viejo{huerfanos.length !== 1 ? 's' : ''} sin enlazar al catálogo
          </div>
          <p className="text-[11px] text-amber-800 mb-2.5">
            Se escribieron a mano antes del catálogo y no calzan con la nomenclatura. Elige a qué cubículo real corresponden.
          </p>
          <div className="flex flex-wrap gap-2">
            {huerfanos.map(h => (
              <button key={h.id} type="button"
                onClick={() => { setModalHuerfano(h); setHuerfanoCub(null) }}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-[11px] font-semibold text-amber-900 hover:border-amber-500 transition-colors">
                <span className="font-mono">{h.cubiculo_codigo}</span>
                <span className="text-amber-700 font-normal"> · {h.servicios?.mascotas?.nombre || 'sin mascota'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros + acciones */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
          <Input className="pl-8 w-52" placeholder="Mascota o código…"
            value={fBusca} onChange={e => setFBusca(e.target.value)} />
        </div>
        <Select className="w-40" value={fZona} onChange={e => setFZona(e.target.value)}>
          <option value="">Todas las zonas</option>
          {ZONA_KEYS.map(z => <option key={z} value={z}>{ZONAS[z].label}</option>)}
        </Select>
        <Select className="w-44" value={fEstado} onChange={e => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="LIBRE">Solo vacíos</option>
          <option value="CON_CUPO">Con mascota y con cupo</option>
          <option value="OCUPADO">Con alguna mascota</option>
          <option value="INACTIVO">Fuera de servicio</option>
        </Select>
        {(fZona || fEstado || fBusca) && (
          <button className="text-[11px] font-semibold text-ink3 hover:text-primary-dark px-2"
            onClick={() => { setFZona(''); setFEstado(''); setFBusca('') }}>
            Limpiar
          </button>
        )}
        <div className="flex-1" />
        <LeyendaCubiculos />
        <button className="text-ink3 hover:text-primary-dark p-1.5 rounded-lg hover:bg-surface2" onClick={cargar} title="Actualizar">
          <RefreshCw size={15} />
        </button>
        {canPlan && (
          <Button onClick={() => setModalNuevo(true)}><Plus size={14} className="mr-1" /> Nuevo cubículo</Button>
        )}
      </div>

      {/* Mapa */}
      {visibles.length === 0 ? (
        <div className="text-center py-16 text-[13px] text-ink3">Ningún cubículo coincide con el filtro.</div>
      ) : (
        <MapaCubiculos cubiculos={visibles} ocupacion={ocupacion} onSelect={setModalDetalle} />
      )}

      {/* ── Modal detalle de cubículo ── */}
      {modalDetalle && (() => {
        const cfg = zonaCfg(modalDetalle.zona)
        const dentro = detOcupantes
        const cap    = modalDetalle.capacidad ?? 1
        const libres = cuposLibres(modalDetalle, dentro)
        return (
          <Modal open onClose={() => setModalDetalle(null)} maxWidth="max-w-md"
            title={
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: cfg.color }} />
                {etiquetaCubiculo(modalDetalle)}
                <span className="font-mono text-[11px] text-ink3 font-normal">{modalDetalle.codigo}</span>
              </span>
            }
            footer={<Button variant="secondary" onClick={() => setModalDetalle(null)}>Cerrar</Button>}>
            <div className="space-y-4">
              <div className="flex gap-2 text-[11px] flex-wrap">
                <span className="px-2 py-1 rounded-full font-bold" style={{ background: cfg.bg, color: cfg.color }}>
                  Zona {cfg.label}
                </span>
                <span className="px-2 py-1 rounded-full font-bold bg-gray-100 text-gray-700">
                  {tallaLbl(modalDetalle.talla)}
                </span>
                <span className="px-2 py-1 rounded-full font-bold"
                  style={libres === 0
                    ? { background: '#FEF3C7', color: '#92400E' }
                    : { background: '#DCFCE7', color: '#166534' }}>
                  {dentro.length}/{cap} {libres === 0 ? '· lleno' : `· ${libres} cupo${libres !== 1 ? 's' : ''}`}
                </span>
              </div>

              {dentro.length > 0 ? (
                <div className="space-y-2">
                  {dentro.map(item => {
                    const listo = finCompostaje(item.fecha_compostaje_inicio, item.meses_compostaje)
                    return (
                      <div key={item.id} className="rounded-xl border border-gray-200 p-3 space-y-1.5">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold text-ink1">
                              {petEmoji(item.servicios?.mascotas?.especies?.nombre)} {item.servicios?.mascotas?.nombre || '—'}
                            </div>
                            <div className="text-[11px] text-ink3">{item.servicios?.planes?.nombre || '—'}</div>
                          </div>
                          <Button size="sm" variant="secondary" disabled={saving}
                            onClick={() => liberar(modalDetalle, item)}>
                            <Unlock size={12} className="mr-1" /> Sacar
                          </Button>
                        </div>
                        <div className="text-[11px] text-ink3">
                          Ingresó al cubículo: <strong>{fmtFecha(item.fecha_compostaje_inicio)}</strong>
                        </div>
                        <div className="text-[11px] text-ink3">
                          Compostaje listo ({item.meses_compostaje || 2} meses): <strong>{fmtFecha(listo)}</strong>
                        </div>
                        {item.cubiculo_codigo && (
                          <div className="text-[10px] text-ink3 pt-1 border-t border-gray-100 mt-1.5">
                            Código histórico: <span className="font-mono">{item.cubiculo_codigo}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[12px] text-ink3">
                  Este cubículo está disponible. Se asigna desde <strong>Jornada</strong>, al finalizar el compostaje de una mascota.
                </p>
              )}

              {canPlan && (
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  <div>
                    <label className="text-[11px] font-bold text-ink3 block mb-1">
                      Cuántas mascotas caben aquí
                    </label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={Math.max(1, dentro.length)} max="20" className="w-24"
                        defaultValue={cap}
                        onBlur={e => {
                          const v = parseInt(e.target.value)
                          if (!v || v === cap) { e.target.value = cap; return }
                          if (v < dentro.length) {
                            e.target.value = cap
                            showAlert(`Ya hay ${dentro.length} mascota${dentro.length !== 1 ? 's' : ''} adentro: el cupo no puede quedar por debajo.`,
                              { title: 'Cupo demasiado bajo' })
                            return
                          }
                          guardarDetalle({ capacidad: Math.min(20, v) })
                        }} />
                      <p className="text-[11px] text-ink3 flex-1">
                        Por defecto 1. Súbelo solo en los cubículos que de verdad aguantan más de una mascota a la vez.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-ink3 block mb-1">Notas del cubículo</label>
                    <Textarea rows={2} defaultValue={modalDetalle.notas || ''}
                      placeholder="Ej: tapa dañada, se repara en agosto"
                      onBlur={e => {
                        const v = e.target.value.trim() || null
                        if (v !== (modalDetalle.notas || null)) guardarDetalle({ notas: v })
                      }} />
                  </div>
                  <div className="flex gap-2">
                    {modalDetalle.activo ? (
                      <Button variant="secondary" className="flex-1" disabled={saving || dentro.length > 0}
                        title={dentro.length > 0 ? 'No se puede sacar de servicio con mascotas dentro' : ''}
                        onClick={() => guardarDetalle({ activo: false })}>
                        <Ban size={14} className="mr-1" /> Fuera de servicio
                      </Button>
                    ) : (
                      <Button variant="secondary" className="flex-1" disabled={saving}
                        onClick={() => guardarDetalle({ activo: true })}>
                        <CheckCircle2 size={14} className="mr-1" /> Reactivar
                      </Button>
                    )}
                    <Button variant="secondary" disabled={saving || dentro.length > 0} onClick={borrarCubiculo}
                      title={dentro.length > 0 ? 'No se puede borrar con mascotas dentro' : 'Borrar del catálogo'}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  {!modalDetalle.activo && (
                    <p className="text-[11px] text-ink3">
                      Fuera de servicio: no aparece como opción al asignar, pero conserva su historia.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal nuevo cubículo ── */}
      {modalNuevo && (
        <Modal open onClose={() => setModalNuevo(false)} maxWidth="max-w-sm"
          title="Nuevo cubículo"
          footer={<>
            <Button variant="secondary" onClick={() => setModalNuevo(false)}>Cancelar</Button>
            <Button onClick={crearCubiculo} disabled={saving}>{saving ? 'Creando…' : 'Crear cubículo'}</Button>
          </>}>
          <div className="space-y-4">
            <p className="text-[12px] text-ink3">
              Solo si se habilita un cubículo nuevo en la planta. El código se arma solo: <strong>zona · talla · número</strong>.
            </p>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1.5">Zona</label>
              <div className="grid grid-cols-4 gap-1.5">
                {ZONA_KEYS.map(z => {
                  const cfg = zonaCfg(z); const sel = nuevoForm.zona === z
                  return (
                    <button key={z} type="button" onClick={() => setNuevoForm(p => ({ ...p, zona: z }))}
                      className="p-1.5 rounded-lg border text-[10px] font-bold transition-all"
                      style={sel
                        ? { background: cfg.color, color: '#FFF', borderColor: cfg.color }
                        : { background: cfg.bg, color: cfg.color, borderColor: cfg.borde }}>
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1.5">Talla</label>
              <div className="grid grid-cols-3 gap-1.5">
                {TALLA_KEYS.map(t => (
                  <button key={t} type="button" onClick={() => setNuevoForm(p => ({ ...p, talla: t }))}
                    className={`p-2 rounded-lg border text-[12px] font-semibold transition-all ${
                      nuevoForm.talla === t ? 'border-primary bg-primary/5 text-primary-dark' : 'border-gray-200 text-ink3'}`}>
                    {tallaLbl(t)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Número</label>
              <Input type="number" min="1" placeholder="Ej: 16" value={nuevoForm.numero}
                onChange={e => setNuevoForm(p => ({ ...p, numero: e.target.value }))} />
              {nuevoForm.numero && (
                <p className="text-[11px] text-ink3 mt-1">
                  → Código: <strong className="font-mono">
                    {nuevoForm.zona}-{nuevoForm.talla}-{String(parseInt(nuevoForm.numero) || 0).padStart(2, '0')}
                  </strong>
                </p>
              )}
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Notas (opcional)</label>
              <Input value={nuevoForm.notas} onChange={e => setNuevoForm(p => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal resolver código huérfano ── */}
      {modalHuerfano && (
        <Modal open onClose={() => { setModalHuerfano(null); setHuerfanoCub(null) }} maxWidth="max-w-3xl"
          title={`Enlazar código "${modalHuerfano.cubiculo_codigo}"`}
          footer={<>
            <Button variant="secondary" onClick={() => { setModalHuerfano(null); setHuerfanoCub(null) }}>Cancelar</Button>
            <Button onClick={resolverHuerfano} disabled={saving || !huerfanoCub}>
              {saving ? 'Enlazando…' : 'Enlazar cubículo'}
            </Button>
          </>}>
          <div className="space-y-4">
            <div className="rounded-xl p-3 text-[12px]" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <strong>{modalHuerfano.servicios?.mascotas?.nombre || 'Una mascota'}</strong> quedó registrada en
              el cubículo <span className="font-mono font-bold">{modalHuerfano.cubiculo_codigo}</span>, escrito a mano antes
              del catálogo. Selecciona en el mapa a qué cubículo real corresponde.
            </div>
            <LeyendaCubiculos />
            <div className="max-h-[52vh] overflow-y-auto pr-1">
              <MapaCubiculos cubiculos={cubiculos} ocupacion={ocupacion} soloLibres
                seleccionado={huerfanoCub} onSelect={c => setHuerfanoCub(c.id)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
