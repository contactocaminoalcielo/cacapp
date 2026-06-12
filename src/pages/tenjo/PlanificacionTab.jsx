// Pestaña "Planificación" — propuesta de lote para la próxima jornada Tenjo.
// El sistema propone; el coordinador aprueba, quita, reprograma o contacta.
// Confirmar el lote = autorización de salida + traslados programados.
// La salida FÍSICA del cuarto frío se registra después, al iniciar el traslado.
import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { orbitApi } from '@/lib/orbitApi'
import { petEmoji, waLink, parsearErrorDB } from '@/lib/utils'
import {
  generarPropuestaLote, evaluarCandidato, mensajeSugerido,
  proximaJornada, esDiaPlanificacion, nombreDia,
  CLASIF_CFG, ITEM_ESTADO_CFG, LOTE_ESTADO_CFG,
} from '@/lib/tenjo'
import {
  CalendarCheck, Sparkles, RefreshCw, CheckCircle2, Undo2,
  MessageCircle, Plus, Trash2, ShieldCheck,
} from 'lucide-react'
import SetupNotice from './SetupNotice'

const fmtFechaLarga = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  : '—'

const ITEMS_ACTIVOS = ['PROPUESTO', 'APROBADO', 'AUTORIZADA_SALIDA', 'EN_TRASLADO', 'RECIBIDA', 'EN_PROCESO']

function Chip({ cfg, fallback }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg?.bg || '#F3F4F6', color: cfg?.text || '#374151' }}>
      {cfg?.label || fallback}
    </span>
  )
}

export default function PlanificacionTab({ config, candidatas, personalData, canPlan, onChanged }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [lote,    setLote]    = useState(undefined) // undefined=cargando, null=no hay
  const [items,   setItems]   = useState([])
  const [saving,  setSaving]  = useState(false)
  const [sinTabla, setSinTabla] = useState(false)
  const [modalReprogramar, setModalReprogramar] = useState(null) // item
  const [motivoText,       setMotivoText]       = useState('')
  const [modalContacto,    setModalContacto]    = useState(null) // item
  const [mensajeText,      setMensajeText]      = useState('')
  const [modalAgregar,     setModalAgregar]     = useState(false)

  const fechaJornada = proximaJornada(config)
  const porServicio  = Object.fromEntries((candidatas || []).map(c => [c.servicio_id, c]))

  const cargarLote = useCallback(async () => {
    if (!fechaJornada) { setLote(null); return }
    const { data: l, error } = await db.from('lotes_tenjo')
      .select('*').eq('fecha_jornada', fechaJornada).neq('estado', 'CANCELADO').maybeSingle()
    if (error) { setSinTabla(true); setLote(null); return }
    setLote(l || null)
    if (l) {
      const { data: its } = await db.from('lotes_tenjo_items')
        .select('*, servicios(estado, mascotas(nombre, especies(nombre), clientes(nombre, apellido, whatsapp)), planes(nombre, codigo))')
        .eq('lote_id', l.id)
        .order('created_at', { ascending: true })
      setItems(its || [])
    } else setItems([])
  }, [fechaJornada])

  useEffect(() => { cargarLote() }, [cargarLote])

  if (candidatas === null || sinTabla) return <SetupNotice />
  if (lote === undefined) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando planificación…</span></div>

  const editable = lote && ['PROPUESTO', 'EN_REVISION'].includes(lote.estado)
  const activos  = items.filter(i => ITEMS_ACTIVOS.includes(i.estado))
  const fuera    = items.filter(i => !ITEMS_ACTIVOS.includes(i.estado))

  // Candidatas que aún no están en el lote (para agregar manualmente)
  const agregables = (candidatas || []).filter(c => !c.item_activo_id && !c.traslado_activo
    && !items.some(i => i.servicio_id === c.servicio_id && ITEMS_ACTIVOS.includes(i.estado)))

  // ── Resumen del asistente ──
  const nAptas      = activos.filter(i => i.clasificacion === 'APTA').length
  const nValidar    = activos.filter(i => i.clasificacion === 'REQUIERE_VALIDACION').length
  const nBloq       = activos.filter(i => i.clasificacion === 'BLOQUEADA').length
  const nPresencial = activos.filter(i => i.clasificacion === 'PRESENCIAL_PENDIENTE' && i.confirmacion_cliente !== true).length
  const nEvidencia  = activos.filter(i => i.clasificacion === 'EVIDENCIA_REQUERIDA').length
  const nAprobados  = activos.filter(i => ['APROBADO', 'AUTORIZADA_SALIDA'].includes(i.estado)).length
  const minJornada  = config.min_procesos_jornada ?? 4

  // ── Acciones ──
  async function generar() {
    setSaving(true)
    try {
      const { lote: l, agregadas } = await generarPropuestaLote({
        config, candidatas, personalId: personalData?.id, generadoPor: 'MANUAL',
      })
      await cargarLote(); onChanged?.()
      if (l && agregadas === 0 && !lote) {
        await showAlert('Lote creado sin candidatas nuevas para proponer.', { title: 'Propuesta generada' })
      }
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error generando propuesta', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function actualizarItem(item, cambios) {
    setSaving(true)
    try {
      const { error } = await db.from('lotes_tenjo_items')
        .update({ ...cambios, decidido_por: personalData?.id || null }).eq('id', item.id)
      if (error) throw error
      await cargarLote(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function reprogramar() {
    if (!modalReprogramar) return
    if (!motivoText.trim()) { await showAlert('Registra el motivo de la reprogramación (queda en la trazabilidad).', { title: 'Motivo requerido' }); return }
    await actualizarItem(modalReprogramar, {
      estado: 'REPROGRAMADO',
      motivo_reprogramacion: motivoText.trim(),
      veces_reprogramada: (modalReprogramar.veces_reprogramada || 0) + 1,
    })
    setModalReprogramar(null); setMotivoText('')
  }

  async function registrarContacto(resultado) {
    const item = modalContacto
    if (!item) return
    setSaving(true)
    try {
      const c = porServicio[item.servicio_id]
      const sugerido = mensajeSugerido('CONFIRMAR_PRESENCIAL', { mascota: c?.mascota || item.servicios?.mascotas?.nombre })
      await db.from('contactos_cliente').insert({
        servicio_id:      item.servicio_id,
        lote_item_id:     item.id,
        cliente_id:       c?.cliente_id || null,
        canal:            'WHATSAPP_MANUAL',
        proposito:        'CONFIRMAR_PRESENCIAL',
        mensaje_sugerido: sugerido,
        mensaje_enviado:  mensajeText || sugerido,
        estado:           resultado,
        enviado_por:      personalData?.id || null,
      })
      await db.from('lotes_tenjo_items').update({
        contacto_estado:      resultado,
        confirmacion_cliente: resultado === 'CONFIRMADO' ? true : null,
        ...(resultado === 'CONFIRMADO' && { clasificacion: 'APTA' }),
      }).eq('id', item.id)
      setModalContacto(null); setMensajeText('')
      await cargarLote(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error registrando contacto', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function agregarManual(c) {
    setSaving(true)
    try {
      const ev = evaluarCandidato(c, config)
      const { error } = await db.from('lotes_tenjo_items').insert({
        lote_id:         lote.id,
        servicio_id:     c.servicio_id,
        clasificacion:   ev.clasificacion,
        estado:          'PROPUESTO',
        bloqueos:        ev.bloqueos,
        validaciones:    ev.validaciones,
        contacto_estado: ev.reqConfirma ? 'PENDIENTE' : 'NO_REQUERIDO',
        veces_reprogramada: c.veces_reprogramada || 0,
        notas:           'Agregada manualmente',
      })
      if (error) throw error
      await cargarLote(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function confirmar() {
    const pendientes = activos.filter(i => i.estado === 'PROPUESTO').length
    const msg = `${nAprobados} mascota${nAprobados !== 1 ? 's' : ''} quedará${nAprobados !== 1 ? 'n' : ''} autorizada${nAprobados !== 1 ? 's' : ''} para salida con traslado programado.`
      + (pendientes ? ` ${pendientes} sin decisión pasarán a REPROGRAMADAS.` : '')
      + ' La salida física se registra al iniciar el traslado.'
    if (!await confirm(msg, { title: `¿Confirmar lote del ${nombreDia(fechaJornada)}?`, variant: 'warning', confirmLabel: 'Confirmar lote' })) return
    setSaving(true)
    try {
      // Escritura crítica → backend propio (transacción + revalidación + lock)
      const r = await orbitApi(`/tenjo/lotes/${lote.id}/confirmar`, { method: 'POST' })
      await cargarLote(); onChanged?.()
      let detalle = `✅ ${r.autorizadas} autorizadas para salida.`
      if (r.reprogramadas) detalle += ` ↻ ${r.reprogramadas} reprogramadas sin decisión.`
      if (r.rechazadas?.length) detalle += ` ⚠ ${r.rechazadas.length} rechazadas en revalidación: ${r.rechazadas.map(x => `${x.mascota} (${x.motivo})`).join(', ')}.`
      await showAlert(detalle, { title: 'Lote confirmado' })
    } catch (e) {
      await showAlert(e.message, { title: 'Error confirmando lote', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // ── Render de un item ──
  function ItemRow({ item }) {
    const m  = item.servicios?.mascotas
    const cl = m?.clientes
    const c  = porServicio[item.servicio_id]
    const puedeAprobar = editable && item.estado === 'PROPUESTO'
      && item.clasificacion !== 'BLOQUEADA'
      && !(item.clasificacion === 'PRESENCIAL_PENDIENTE' && item.confirmacion_cliente !== true)
    const necesitaContacto = item.contacto_estado === 'PENDIENTE' || item.contacto_estado === 'CONTACTADO' || item.contacto_estado === 'SIN_RESPUESTA'
    const detalles = [...(item.bloqueos || []), ...(item.validaciones || [])]

    return (
      <div className="flex items-start gap-3 p-3.5 rounded-xl border hover:bg-surface2 transition-all"
        style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink">{m?.nombre || '—'}</span>
            <Chip cfg={CLASIF_CFG[item.clasificacion]} fallback={item.clasificacion} />
            <Chip cfg={ITEM_ESTADO_CFG[item.estado]} fallback={item.estado} />
            {item.confirmacion_cliente === true && (
              <span className="text-[10px] font-bold text-green-700">✓ cliente confirmó</span>
            )}
          </div>
          <div className="text-[11px] text-ink3 mt-0.5">
            {cl?.nombre} {cl?.apellido} · {item.servicios?.planes?.nombre}
            {c && ` · ${c.dias_custodia} días en custodia · Nevera ${c.nevera_codigo || '—'}`}
          </div>
          {detalles.slice(0, 3).map((d, i) => (
            <div key={i} className="text-[10px] text-amber-700 mt-0.5">• {d}</div>
          ))}
          {item.motivo_reprogramacion && (
            <div className="text-[10px] text-ink3 italic mt-0.5">Motivo: {item.motivo_reprogramacion}</div>
          )}
        </div>
        {editable && ITEMS_ACTIVOS.includes(item.estado) && (
          <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
            {necesitaContacto && (
              <Button size="sm" variant="secondary" disabled={saving}
                onClick={() => {
                  setModalContacto(item)
                  setMensajeText(mensajeSugerido('CONFIRMAR_PRESENCIAL', { mascota: m?.nombre }))
                }}>
                <MessageCircle size={12} /> Contactar
              </Button>
            )}
            {puedeAprobar && (
              <Button size="sm" disabled={saving} onClick={() => actualizarItem(item, { estado: 'APROBADO' })}>
                <CheckCircle2 size={12} /> Aprobar
              </Button>
            )}
            {item.estado === 'APROBADO' && (
              <Button size="sm" variant="secondary" disabled={saving}
                onClick={() => actualizarItem(item, { estado: 'PROPUESTO' })}>
                <Undo2 size={12} /> Deshacer
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={saving}
              onClick={() => { setModalReprogramar(item); setMotivoText('') }}>
              ↻ Reprogramar
            </Button>
            <Button size="sm" variant="secondary" disabled={saving}
              onClick={async () => {
                if (await confirm('Saldrá de este lote sin contar como reprogramación.', { title: '¿Retirar del lote?', confirmLabel: 'Retirar' }))
                  actualizarItem(item, { estado: 'RETIRADO_DEL_LOTE' })
              }}>
              <Trash2 size={12} />
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Banner asistente ── */}
      <div className="rounded-2xl border-2 p-5" style={{ borderColor: '#C4A87A', background: '#FDFBF7' }}>
        <div className="flex items-start gap-3">
          <Sparkles size={18} style={{ color: '#C4A87A' }} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-[15px] text-ink">
              {fechaJornada
                ? <>Próxima jornada: <strong>{fmtFechaLarga(fechaJornada)}</strong></>
                : 'Sin días de operación configurados'}
              {lote && <span className="ml-2 align-middle"><Chip cfg={LOTE_ESTADO_CFG[lote.estado]} fallback={lote.estado} /></span>}
            </div>
            <p className="text-[12px] text-ink2 mt-1 leading-relaxed">
              {!lote && (esDiaPlanificacion(config)
                ? `Hoy es día de planificación. Hay ${agregables.length} candidata${agregables.length !== 1 ? 's' : ''} en custodia para proponer.`
                : `Aún no hay lote para esta jornada. Hay ${agregables.length} candidata${agregables.length !== 1 ? 's' : ''} en custodia.`)}
              {lote && activos.length > 0 && (
                <>Hay <strong>{activos.length}</strong> mascotica{activos.length !== 1 ? 's' : ''} en el lote: {' '}
                <strong>{nAptas}</strong> apta{nAptas !== 1 ? 's' : ''},{' '}
                <strong>{nValidar}</strong> por validar,{' '}
                <strong>{nPresencial}</strong> presencial{nPresencial !== 1 ? 'es' : ''} sin confirmar,{' '}
                <strong>{nEvidencia}</strong> con evidencia obligatoria y{' '}
                <strong>{nBloq}</strong> bloqueada{nBloq !== 1 ? 's' : ''}.{' '}
                {nAprobados} aprobada{nAprobados !== 1 ? 's' : ''} hasta ahora.</>
              )}
              {lote && activos.length === 0 && 'El lote no tiene mascoticas activas.'}
              {lote && activos.length > 0 && nAprobados < minJornada && (
                <span className="text-amber-700"> ⚠ Por debajo del mínimo sugerido de {minJornada} procesos por jornada.</span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {canPlan && editable !== false && (!lote || editable) && (
              <Button variant="secondary" disabled={saving} onClick={generar}>
                <RefreshCw size={13} /> {lote ? 'Actualizar propuesta' : 'Generar propuesta'}
              </Button>
            )}
            {canPlan && lote && editable && nAprobados > 0 && (
              <Button variant="gold" disabled={saving} onClick={confirmar}>
                <ShieldCheck size={13} /> Confirmar lote ({nAprobados})
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Items del lote ── */}
      {lote && (
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <CalendarCheck size={16} className="text-ink3" />
            <div className="font-semibold text-[15px] text-ink flex-1">Lote {lote.numero_lote}</div>
            {canPlan && editable && agregables.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setModalAgregar(true)}>
                <Plus size={12} /> Agregar mascota
              </Button>
            )}
          </div>
          {activos.length === 0 ? (
            <div className="py-10 text-center text-ink3 text-sm">Sin mascoticas en el lote. Genera o actualiza la propuesta.</div>
          ) : (
            <div className="p-4 space-y-2.5">
              {activos.map(i => <ItemRow key={i.id} item={i} />)}
            </div>
          )}
          {fuera.length > 0 && (
            <div className="px-4 pb-4">
              <div className="text-[11px] font-bold text-ink3 uppercase tracking-wide mb-2">Fuera del lote ({fuera.length})</div>
              <div className="space-y-2 opacity-70">
                {fuera.map(i => <ItemRow key={i.id} item={i} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modal reprogramar ── */}
      {modalReprogramar && (
        <Modal open onClose={() => setModalReprogramar(null)}
          title={`Reprogramar — ${modalReprogramar.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setModalReprogramar(null)}>Cancelar</Button>
            <Button onClick={reprogramar} disabled={saving}>{saving ? 'Guardando…' : 'Reprogramar'}</Button>
          </>}>
          <div className="space-y-3">
            <p className="text-[12px] text-ink2">Quedará disponible para el siguiente ciclo de planificación. El motivo queda en la trazabilidad.</p>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Motivo de reprogramación *</label>
              <Textarea value={motivoText} onChange={e => setMotivoText(e.target.value)}
                placeholder="Ej: cliente pidió esperar, falta de pago, sin confirmación…" />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal contacto asistido ── */}
      {modalContacto && (() => {
        const m  = modalContacto.servicios?.mascotas
        const wa = m?.clientes?.whatsapp
        return (
          <Modal open onClose={() => setModalContacto(null)}
            title={`Contactar cliente — ${m?.nombre || ''}`}
            maxWidth="max-w-lg"
            footer={<Button variant="secondary" onClick={() => setModalContacto(null)}>Cerrar</Button>}>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Mensaje sugerido (editable)</label>
                <Textarea rows={5} value={mensajeText} onChange={e => setMensajeText(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {wa ? (
                  <a href={waLink(wa, mensajeText)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white"
                    style={{ background: '#25D366' }}>
                    <MessageCircle size={13} /> Abrir WhatsApp
                  </a>
                ) : (
                  <span className="text-[12px] text-amber-700">⚠ El cliente no tiene WhatsApp registrado.</span>
                )}
              </div>
              <div className="border-t pt-3" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                <p className="text-[11px] font-bold text-ink3 mb-2">Registrar resultado del contacto:</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={saving} onClick={() => registrarContacto('CONFIRMADO')}>
                    ✓ Cliente confirmó
                  </Button>
                  <Button size="sm" variant="secondary" disabled={saving} onClick={() => registrarContacto('CONTACTADO')}>
                    Contactado — esperando respuesta
                  </Button>
                  <Button size="sm" variant="secondary" disabled={saving} onClick={() => registrarContacto('SIN_RESPUESTA')}>
                    Sin respuesta
                  </Button>
                </div>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal agregar manual ── */}
      {modalAgregar && (
        <Modal open onClose={() => setModalAgregar(false)}
          title="Agregar mascota al lote" maxWidth="max-w-lg"
          footer={<Button variant="secondary" onClick={() => setModalAgregar(false)}>Cerrar</Button>}>
          {agregables.length === 0 ? (
            <p className="text-[13px] text-ink3 text-center py-4">No hay más candidatas disponibles.</p>
          ) : (
            <div className="space-y-2">
              {agregables.map(c => (
                <div key={c.servicio_id} className="flex items-center gap-3 p-3 rounded-xl border"
                  style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <span className="text-xl">{petEmoji(c.especie)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink text-[13px]">{c.mascota}</div>
                    <div className="text-[11px] text-ink3">{c.cliente} · {c.plan} · {c.dias_custodia} días</div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={saving}
                    onClick={async () => { await agregarManual(c) }}>
                    <Plus size={12} /> Agregar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
