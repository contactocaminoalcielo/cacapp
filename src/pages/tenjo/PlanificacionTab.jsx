// Pestaña "Planificación" — propuesta de lote para la próxima jornada Tenjo.
// El sistema propone; el coordinador aprueba, quita, reprograma o contacta.
// Confirmar el lote = autorización de salida + traslados programados.
// La salida FÍSICA del cuarto frío se registra después, al iniciar el traslado.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { orbitApi } from '@/lib/orbitApi'
import { petEmoji, waLink, parsearErrorDB } from '@/lib/utils'
import {
  generarPropuestaLote, evaluarCandidato, mensajeSugerido,
  mensajeConfirmacionCliente, mensajeGrupoProceso, mensajeGrupoVisitas, cargarVisitasTenjo,
  varianteProceso, VARIANTE_LABEL, TIPO_PROCESO_LABEL,
  proximaJornada, proximasJornadas, esDiaPlanificacion,
  CLASIF_CFG, ITEM_ESTADO_CFG, LOTE_ESTADO_CFG,
} from '@/lib/tenjo'
import {
  CalendarCheck, Sparkles, RefreshCw, CheckCircle2, Undo2,
  MessageCircle, Plus, Trash2, ShieldCheck, Send, Users, Copy, Clock, Check, Info, Ban,
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
  const [lotesList, setLotesList] = useState(undefined) // undefined=cargando, null=sin tabla, array
  const [loteSel,   setLoteSel]   = useState(null)       // id del lote seleccionado
  const [lote,    setLote]    = useState(undefined) // undefined=cargando, null=no hay
  const [items,   setItems]   = useState([])
  const [saving,  setSaving]  = useState(false)
  const [sinTabla, setSinTabla] = useState(false)
  const [modalReprogramar, setModalReprogramar] = useState(null) // item
  const [motivoText,       setMotivoText]       = useState('')
  const [fechaReprog,      setFechaReprog]      = useState('')
  const [modalDetalle,     setModalDetalle]     = useState(null) // item
  const [modalContacto,    setModalContacto]    = useState(null) // item
  const [mensajeText,      setMensajeText]      = useState('')
  const [modalAgregar,     setModalAgregar]     = useState(false)
  const [modalAviso,       setModalAviso]       = useState(null) // item (aviso post-confirmación)
  const [avisoText,        setAvisoText]        = useState('')
  const [horaAsist,        setHoraAsist]        = useState('')
  const [modalGrupo,       setModalGrupo]        = useState(false)
  const [copiado,          setCopiado]           = useState(false)
  const [visitasJornada,   setVisitasJornada]    = useState([]) // visitas programadas el día de la jornada

  const fechaJornada = proximaJornada(config)
  const porServicio  = Object.fromEntries((candidatas || []).map(c => [c.servicio_id, c]))
  const loteSelRef   = useRef(null)
  useEffect(() => { loteSelRef.current = loteSel }, [loteSel])

  // Lista de lotes navegables (todos menos cancelados)
  const cargarLista = useCallback(async () => {
    const { data, error } = await db.from('lotes_tenjo')
      .select('*').neq('estado', 'CANCELADO')
      .order('fecha_jornada', { ascending: false })
    if (error) { setSinTabla(true); setLotesList(null); setLote(null); return }
    const list = data || []
    setLotesList(list)
    setLoteSel(prev => {
      if (prev && list.some(l => l.id === prev)) return prev
      const prox      = list.find(l => l.fecha_jornada === fechaJornada)
      const editLote  = list.find(l => ['PROPUESTO', 'EN_REVISION'].includes(l.estado))
      return prox?.id || editLote?.id || list[0]?.id || null
    })
  }, [fechaJornada])

  const cargarItems = useCallback(async (loteId) => {
    if (!loteId) { setLote(null); setItems([]); return }
    const { data: l } = await db.from('lotes_tenjo').select('*').eq('id', loteId).maybeSingle()
    setLote(l || null)
    if (l) {
      const { data: its } = await db.from('lotes_tenjo_items')
        .select('*, servicios!inner(estado, notas, tipo_acompanamiento, recogidas(notas, contacto_telefono), mascotas(nombre, peso_kg, especies(nombre), clientes(nombre, apellido, whatsapp)), planes(nombre, codigo, tipo_proceso))')
        .gte('servicios.fecha_ingreso', FECHA_CORTE)
        .eq('lote_id', l.id)
        .order('created_at', { ascending: true })
      setItems(its || [])
    } else setItems([])
  }, [])

  // Recarga usada por los handlers (refresca lista + items del lote actual)
  async function cargarLote() {
    await cargarLista()
    await cargarItems(loteSelRef.current)
  }

  useEffect(() => { cargarLista() }, [cargarLista])
  useEffect(() => { cargarItems(loteSel) }, [loteSel, cargarItems])

  // Visitas programadas para el día de la jornada: se anexan al mensaje del
  // grupo para que salgan junto con los procesos (migración 059; si la tabla
  // aún no existe, el mensaje sale sin visitas).
  useEffect(() => {
    let vivo = true
    if (!lote?.fecha_jornada) { setVisitasJornada([]); return }
    cargarVisitasTenjo({ fecha: lote.fecha_jornada })
      .then(v => { if (vivo) setVisitasJornada(v) })
      .catch(() => { if (vivo) setVisitasJornada([]) })
    return () => { vivo = false }
  }, [lote?.fecha_jornada])

  if (candidatas === null || sinTabla) return <SetupNotice />
  if (lotesList === undefined) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando planificación…</span></div>

  const editable    = lote && ['PROPUESTO', 'EN_REVISION'].includes(lote.estado)
  const gestionable = canPlan && lote && !['CERRADO', 'CANCELADO'].includes(lote.estado)
  const activos  = items.filter(i => ITEMS_ACTIVOS.includes(i.estado))
  const fuera    = items.filter(i => !ITEMS_ACTIVOS.includes(i.estado))

  // ── Post-confirmación: avisos al cliente (wa.me) + mensaje al grupo ──
  const confirmado  = lote && ['CONFIRMADO', 'EN_EJECUCION', 'CERRADO'].includes(lote.estado)
  const autorizadas = items.filter(i => ['AUTORIZADA_SALIDA', 'EN_TRASLADO', 'RECIBIDA', 'EN_PROCESO'].includes(i.estado))

  function datosMascota(item) {
    const m  = item.servicios?.mascotas
    const cl = m?.clientes
    const rec = Array.isArray(item.servicios?.recogidas) ? item.servicios.recogidas[0] : item.servicios?.recogidas
    const codigoPlan = item.servicios?.planes?.codigo
    const presencial = varianteProceso(codigoPlan, item.servicios?.tipo_acompanamiento) === 'EXCLUSIVO_PRESENCIAL'
    // Obs para el grupo Tenjo: solo la instrucción de huella en Compets con
    // recordatorios; en el resto queda vacía para que el coordinador la llene.
    const huella3d = codigoPlan?.startsWith('COMPETS') && codigoPlan !== 'COMPETS_SIN_REC'
    return {
      emoji:        petEmoji(m?.especies?.nombre),
      nombre:       m?.nombre || '—',
      especie:      m?.especies?.nombre,
      plan:         item.servicios?.planes?.nombre,
      tipoProceso:  TIPO_PROCESO_LABEL[item.servicios?.planes?.tipo_proceso] || null,
      cliente:      cl ? `${cl.nombre || ''} ${cl.apellido || ''}`.trim() : null,
      peso:         m?.peso_kg || porServicio[item.servicio_id]?.peso_kg || null,
      presencial,
      hora:         item.checklist?.fecha_hora_acordada || null,
      wa:           cl?.whatsapp,
      contacto:     cl?.whatsapp || rec?.contacto_telefono || porServicio[item.servicio_id]?.cliente_whatsapp || null,
      observaciones: huella3d ? 'TOMAR HUELLA 3D' : null,
    }
  }

  const grupoText = mensajeGrupoProceso({
    fechaLarga: fmtFechaLarga(lote?.fecha_jornada),
    mascotas:   autorizadas.map(datosMascota),
  }) + (visitasJornada.length
    ? '\n\n' + mensajeGrupoVisitas({ fechaLarga: fmtFechaLarga(lote?.fecha_jornada), visitas: visitasJornada })
    : '')

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

  // Si el item ya tenía traslado programado (lote confirmado), se cancela para
  // liberar la mascota antes de sacarla del lote.
  async function cancelarTrasladoDe(item) {
    if (!item.traslado_id) return
    await db.from('traslados_tenjo').update({ estado: 'CANCELADO' })
      .eq('id', item.traslado_id).in('estado', ['PROGRAMADO', 'EN_CAMINO'])
  }

  async function reprogramar() {
    if (!modalReprogramar) return
    if (!motivoText.trim()) { await showAlert('Registra el motivo de la reprogramación (queda en la trazabilidad).', { title: 'Motivo requerido' }); return }
    await cancelarTrasladoDe(modalReprogramar)
    await actualizarItem(modalReprogramar, {
      estado: 'REPROGRAMADO',
      motivo_reprogramacion: motivoText.trim(),
      veces_reprogramada: (modalReprogramar.veces_reprogramada || 0) + 1,
      fecha_reprogramacion_objetivo: fechaReprog || null,
      traslado_id: null,
    })
    setModalReprogramar(null); setMotivoText(''); setFechaReprog('')
  }

  async function retirarItem(item) {
    if (!await confirm('Saldrá de este lote sin contar como reprogramación.', { title: '¿Retirar del lote?', confirmLabel: 'Retirar' })) return
    await cancelarTrasladoDe(item)
    await actualizarItem(item, { estado: 'RETIRADO_DEL_LOTE', traslado_id: null })
  }

  // Cancela el lote completo: saca todas las mascoticas activas (cancelando sus
  // traslados) y marca el lote CANCELADO. Pensado para limpiar lotes viejos.
  async function cancelarLote() {
    if (!lote) return
    const activosCancelar = items.filter(i => ITEMS_ACTIVOS.includes(i.estado))
    if (!await confirm(
      `Se cancelará el lote ${lote.numero_lote}. ${activosCancelar.length} mascotica${activosCancelar.length !== 1 ? 's' : ''} saldrá${activosCancelar.length !== 1 ? 'n' : ''} del lote, sus traslados programados se cancelan y vuelven al pool de candidatas. Esta acción no se puede deshacer.`,
      { title: '¿Cancelar lote completo?', variant: 'danger', confirmLabel: 'Cancelar lote' }
    )) return
    setSaving(true)
    try {
      const trasladoIds = activosCancelar.map(i => i.traslado_id).filter(Boolean)
      if (trasladoIds.length) {
        await db.from('traslados_tenjo').update({ estado: 'CANCELADO' })
          .in('id', trasladoIds).in('estado', ['PROGRAMADO', 'EN_CAMINO'])
      }
      if (activosCancelar.length) {
        const { error: errItems } = await db.from('lotes_tenjo_items')
          .update({ estado: 'RETIRADO_DEL_LOTE', traslado_id: null, decidido_por: personalData?.id || null })
          .in('id', activosCancelar.map(i => i.id))
        if (errItems) throw errItems
      }
      const { error } = await db.from('lotes_tenjo').update({ estado: 'CANCELADO' }).eq('id', lote.id)
      if (error) throw error
      await cargarLote(); onChanged?.()
      await showAlert(`Lote ${lote.numero_lote} cancelado.`, { title: 'Lote cancelado' })
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error cancelando lote', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Reabre un lote CONFIRMADO → EN_REVISION para volver a gestionarlo (agregar
  // mascotas que llegaron tarde, etc.). Las ya autorizadas y sus traslados se
  // conservan; al reconfirmar solo se autorizan las nuevas aprobadas.
  async function reabrirLote() {
    if (!lote) return
    if (!await confirm(
      `El lote ${lote.numero_lote} volverá a EN REVISIÓN para que puedas agregar o gestionar mascoticas. `
      + `Las que ya estaban autorizadas y sus traslados programados se conservan. Cuando termines, vuelve a confirmar el lote.`,
      { title: '¿Reabrir lote confirmado?', variant: 'warning', confirmLabel: 'Reabrir lote' }
    )) return
    setSaving(true)
    try {
      const { data: rows, error } = await db.from('lotes_tenjo')
        .update({ estado: 'EN_REVISION' })
        .eq('id', lote.id).eq('estado', 'CONFIRMADO')
        .select('id')
      if (error) throw error
      if (!rows?.length) throw new Error('El lote ya no está confirmado (¿cambió de estado?). Recarga la página.')
      await cargarLote(); onChanged?.()
      await showAlert(`Lote ${lote.numero_lote} reabierto. Agrega o gestiona las mascoticas y vuelve a confirmar.`, { title: 'Lote reabierto' })
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error reabriendo lote', variant: 'danger' })
    } finally { setSaving(false) }
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
    if (!await confirm(msg, { title: `¿Confirmar lote del ${fmtFechaLarga(lote.fecha_jornada)}?`, variant: 'warning', confirmLabel: 'Confirmar lote' })) return
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

  function abrirAviso(item) {
    const d = datosMascota(item)
    setModalAviso(item)
    setHoraAsist(d.hora || '')
    setAvisoText(mensajeConfirmacionCliente({
      mascota: d.nombre, fechaLarga: fmtFechaLarga(lote?.fecha_jornada),
      presencial: d.presencial, hora: d.hora,
    }))
  }

  function regenerarAviso() {
    const d = datosMascota(modalAviso)
    setAvisoText(mensajeConfirmacionCliente({
      mascota: d.nombre, fechaLarga: fmtFechaLarga(lote?.fecha_jornada),
      presencial: d.presencial, hora: horaAsist.trim(),
    }))
  }

  async function marcarAvisado() {
    const item = modalAviso
    if (!item) return
    setSaving(true)
    try {
      const merged = {
        ...(item.checklist || {}),
        aviso_cliente_enviado: true,
        ...(horaAsist.trim() && { fecha_hora_acordada: horaAsist.trim() }),
      }
      await db.from('lotes_tenjo_items').update({ checklist: merged }).eq('id', item.id)
      await db.from('contactos_cliente').insert({
        servicio_id:     item.servicio_id,
        lote_item_id:    item.id,
        cliente_id:      porServicio[item.servicio_id]?.cliente_id || null,
        canal:           'WHATSAPP_MANUAL',
        proposito:       'OTRO',
        mensaje_enviado: avisoText,
        estado:          'CONTACTADO',
        enviado_por:     personalData?.id || null,
      })
      setModalAviso(null); setHoraAsist(''); setAvisoText('')
      await cargarLote(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  async function copiarGrupo() {
    try {
      await navigator.clipboard.writeText(grupoText)
      setCopiado(true); setTimeout(() => setCopiado(false), 2000)
    } catch {
      await showAlert('No se pudo copiar automáticamente. Selecciona y copia el texto manualmente.', { title: 'Copiar mensaje' })
    }
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
          {item.fecha_reprogramacion_objetivo && (
            <div className="text-[10px] font-semibold mt-0.5" style={{ color: '#92400E' }}>
              ↻ Reprogramada para {fmtFechaLarga(item.fecha_reprogramacion_objetivo)}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
          <Button size="sm" variant="secondary" onClick={() => setModalDetalle(item)}>
            <Info size={12} /> Detalles
          </Button>
        {editable && ITEMS_ACTIVOS.includes(item.estado) && (
          <>
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
          </>
        )}
        {gestionable && ['PROPUESTO', 'APROBADO', 'AUTORIZADA_SALIDA'].includes(item.estado) && (
          <>
            <Button size="sm" variant="secondary" disabled={saving}
              onClick={() => { setModalReprogramar(item); setMotivoText(''); setFechaReprog(item.fecha_reprogramacion_objetivo || proximaJornada(config) || '') }}>
              ↻ Reprogramar
            </Button>
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => retirarItem(item)}>
              <Trash2 size={12} />
            </Button>
          </>
        )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Selector de lote (navegar entre jornadas) ── */}
      {Array.isArray(lotesList) && lotesList.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarCheck size={15} className="text-ink3" />
          <span className="text-[12px] font-semibold text-ink2">Lote:</span>
          <select value={loteSel || ''} onChange={e => setLoteSel(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-gray-200 text-[12px] outline-none focus:border-[#3D5A27] min-w-[260px]">
            {lotesList.map(l => (
              <option key={l.id} value={l.id}>
                {l.numero_lote} · {fmtFechaLarga(l.fecha_jornada)} · {LOTE_ESTADO_CFG[l.estado]?.label || l.estado}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Banner asistente ── */}
      <div className="rounded-2xl border-2 p-5" style={{ borderColor: '#C4A87A', background: '#FDFBF7' }}>
        <div className="flex items-start gap-3">
          <Sparkles size={18} style={{ color: '#C4A87A' }} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-[15px] text-ink">
              {lote
                ? <>Jornada: <strong>{fmtFechaLarga(lote.fecha_jornada)}</strong></>
                : fechaJornada
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
            {canPlan && lote.estado === 'CONFIRMADO' && (
              <Button size="sm" variant="secondary" disabled={saving} onClick={reabrirLote}>
                <Undo2 size={12} /> Reabrir lote
              </Button>
            )}
            {gestionable && ['PROPUESTO', 'EN_REVISION', 'CONFIRMADO'].includes(lote.estado) && (
              <Button size="sm" variant="danger" disabled={saving} onClick={cancelarLote}>
                <Ban size={12} /> Cancelar lote
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

      {/* ── Panel post-confirmación: avisos al cliente + mensaje al grupo ── */}
      {confirmado && autorizadas.length > 0 && (
        <div className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="px-5 py-4 border-b flex items-center gap-2" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <Send size={15} className="text-ink3" />
            <div className="font-semibold text-[15px] text-ink flex-1">
              Avisos del lote confirmado
              <span className="text-[11px] font-normal text-ink3 ml-2">
                {autorizadas.filter(i => i.checklist?.aviso_cliente_enviado).length}/{autorizadas.length} clientes avisados
              </span>
            </div>
            <Button size="sm" variant="gold" onClick={() => setModalGrupo(true)}>
              <Users size={12} /> Mensaje al grupo
            </Button>
          </div>
          <div className="p-4 space-y-2.5">
            {autorizadas.map(item => {
              const d = datosMascota(item)
              const avisado = item.checklist?.aviso_cliente_enviado === true
              return (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border"
                  style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
                  <span className="text-xl">{d.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink text-[13px]">{d.nombre}</span>
                      {d.presencial && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#5B21B6' }}>
                          Presencial{d.hora ? ` · ${d.hora}` : ''}
                        </span>
                      )}
                      {avisado && (
                        <span className="text-[10px] font-bold text-green-700 inline-flex items-center gap-0.5">
                          <Check size={11} /> avisado
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink3">{d.cliente || 'Sin cliente'} · {d.plan}</div>
                  </div>
                  {d.wa ? (
                    <Button size="sm" variant={avisado ? 'secondary' : 'primary'} disabled={saving}
                      onClick={() => abrirAviso(item)}>
                      <MessageCircle size={12} /> {avisado ? 'Reenviar' : 'Avisar al cliente'}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-amber-700">sin WhatsApp</span>
                  )}
                </div>
              )
            })}
          </div>
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
            <p className="text-[12px] text-ink2">Quedará disponible para el siguiente ciclo de planificación. El motivo y la fecha objetivo quedan en la trazabilidad.</p>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Reprogramar para la jornada del</label>
              <select value={fechaReprog} onChange={e => setFechaReprog(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-[13px] outline-none focus:border-[#3D5A27]">
                <option value="">Sin fecha definida</option>
                {proximasJornadas(config, 8).map(f => (
                  <option key={f} value={f}>{fmtFechaLarga(f)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Motivo de reprogramación *</label>
              <Textarea value={motivoText} onChange={e => setMotivoText(e.target.value)}
                placeholder="Ej: cliente pidió esperar, falta de pago, sin confirmación…" />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal detalles de la mascota ── */}
      {modalDetalle && (() => {
        const item = modalDetalle
        const m  = item.servicios?.mascotas
        const cl = m?.clientes
        const c  = porServicio[item.servicio_id]
        const variante = varianteProceso(item.servicios?.planes?.codigo, item.servicios?.tipo_acompanamiento)
        const Fila = ({ label, value }) => (
          <div className="flex justify-between gap-3 py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(30,80,40,0.08)' }}>
            <span className="text-[11px] text-ink3">{label}</span>
            <span className="text-[12px] font-semibold text-ink text-right">{value ?? '—'}</span>
          </div>
        )
        return (
          <Modal open onClose={() => setModalDetalle(null)}
            title={`${m?.nombre || 'Mascota'} — detalles`}
            maxWidth="max-w-md"
            footer={<Button variant="secondary" onClick={() => setModalDetalle(null)}>Cerrar</Button>}>
            <div className="space-y-1">
              <Fila label="Mascota" value={m?.nombre} />
              <Fila label="Especie" value={m?.especies?.nombre} />
              <Fila label="Peso" value={(m?.peso_kg || c?.peso_kg) ? `${m?.peso_kg || c?.peso_kg} kg` : null} />
              <Fila label="Cliente" value={cl ? `${cl.nombre || ''} ${cl.apellido || ''}`.trim() : null} />
              <Fila label="WhatsApp" value={cl?.whatsapp} />
              <Fila label="Plan" value={item.servicios?.planes?.nombre} />
              <Fila label="Tipo de proceso" value={TIPO_PROCESO_LABEL[item.servicios?.planes?.tipo_proceso]} />
              <Fila label="Variante" value={VARIANTE_LABEL?.[variante] || variante} />
              <Fila label="Nevera" value={c?.nevera_codigo} />
              <Fila label="Días en custodia" value={c?.dias_custodia != null ? `${c.dias_custodia} días` : null} />
              <Fila label="Ingreso a custodia" value={c?.fecha_ingreso ? fmtFechaLarga(c.fecha_ingreso.split('T')[0]) : null} />
              <Fila label="Estado en lote" value={ITEM_ESTADO_CFG[item.estado]?.label || item.estado} />
              <Fila label="Clasificación" value={CLASIF_CFG[item.clasificacion]?.label || item.clasificacion} />
              <Fila label="Veces reprogramada" value={item.veces_reprogramada || 0} />
              {item.fecha_reprogramacion_objetivo && (
                <Fila label="Reprogramada para" value={fmtFechaLarga(item.fecha_reprogramacion_objetivo)} />
              )}
              {item.confirmacion_cliente === true && <Fila label="Cliente confirmó" value="Sí" />}
              {item.checklist?.fecha_hora_acordada && <Fila label="Hora acordada" value={item.checklist.fecha_hora_acordada} />}
              {item.motivo_reprogramacion && <Fila label="Motivo reprog." value={item.motivo_reprogramacion} />}
              {[...(item.bloqueos || []), ...(item.validaciones || [])].length > 0 && (
                <div className="pt-2">
                  <div className="text-[11px] font-bold text-ink3 mb-1">Pendientes / bloqueos</div>
                  {[...(item.bloqueos || []), ...(item.validaciones || [])].map((d, i) => (
                    <div key={i} className="text-[11px] text-amber-700">• {d}</div>
                  ))}
                </div>
              )}
            </div>
          </Modal>
        )
      })()}

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

      {/* ── Modal aviso al cliente (post-confirmación, wa.me) ── */}
      {modalAviso && (() => {
        const d = datosMascota(modalAviso)
        return (
          <Modal open onClose={() => setModalAviso(null)}
            title={`Avisar al cliente — ${d.nombre}`}
            maxWidth="max-w-lg"
            footer={<Button variant="secondary" onClick={() => setModalAviso(null)}>Cerrar</Button>}>
            <div className="space-y-4">
              {d.presencial && (
                <div>
                  <label className="text-[11px] font-bold text-ink3 mb-1 flex items-center gap-1">
                    <Clock size={12} /> Hora de asistencia (presencial)
                  </label>
                  <div className="flex gap-2">
                    <input value={horaAsist} onChange={e => setHoraAsist(e.target.value)}
                      placeholder="Ej: 10:00 a.m."
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-[13px] outline-none focus:border-[#3D5A27]" />
                    <Button size="sm" variant="secondary" onClick={regenerarAviso}>
                      <RefreshCw size={12} /> Actualizar mensaje
                    </Button>
                  </div>
                  <p className="text-[10px] text-ink3 mt-1">Se guarda en la mascota y aparece en el mensaje del grupo.</p>
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Mensaje (editable)</label>
                <Textarea rows={6} value={avisoText} onChange={e => setAvisoText(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {d.wa ? (
                  <a href={waLink(d.wa, avisoText)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white"
                    style={{ background: '#25D366' }}>
                    <MessageCircle size={13} /> Abrir WhatsApp
                  </a>
                ) : (
                  <span className="text-[12px] text-amber-700">⚠ El cliente no tiene WhatsApp registrado.</span>
                )}
                <Button size="sm" disabled={saving} onClick={marcarAvisado}>
                  <Check size={12} /> Marcar como avisado
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal mensaje al grupo ── */}
      {modalGrupo && (
        <Modal open onClose={() => setModalGrupo(false)}
          title="Mensaje para el grupo operativo" maxWidth="max-w-lg"
          footer={<Button variant="secondary" onClick={() => setModalGrupo(false)}>Cerrar</Button>}>
          <div className="space-y-4">
            <p className="text-[12px] text-ink2">
              Mensaje con las mascoticas a procesar en la jornada
              {visitasJornada.length > 0 && (
                <> — incluye <strong>{visitasJornada.length} visita{visitasJornada.length !== 1 ? 's' : ''} programada{visitasJornada.length !== 1 ? 's' : ''}</strong> ese día</>
              )}. Usa <strong>Reenviar</strong> para
              abrir WhatsApp y elegir el grupo, o <strong>Copiar</strong> para pegarlo donde quieras.
            </p>
            <Textarea rows={12} value={grupoText} readOnly className="font-mono text-[12px]" />
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(grupoText)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white"
                style={{ background: '#25D366' }}>
                <Send size={13} /> Reenviar a un grupo
              </a>
              <Button size="sm" variant="secondary" onClick={copiarGrupo}>
                {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar mensaje</>}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
