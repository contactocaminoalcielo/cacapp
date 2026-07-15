// Pestaña "Jornada" — ejecución del lote Tenjo del día:
// recepción → proceso → evidencias/checklist por variante → cierre de lote.
// El cierre es la compuerta dura: lo valida el backend (orbit-backend) en una
// transacción; aquí solo se muestra feedback inmediato con las mismas reglas.
import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { orbitApi } from '@/lib/orbitApi'
import { subirEvidencia } from '@/lib/evidencias'
import { petEmoji, parsearErrorDB, today, hoyLocalISO, waLink } from '@/lib/utils'
import {
  varianteProceso, VARIANTE_LABEL, validarItemCierre, nombreDia,
  ITEM_ESTADO_CFG, LOTE_ESTADO_CFG, CONFIG_DEFAULTS, reconciliarServicioTenjo,
  recibirItemLoteTenjo, RECEPCION_CFG, TIPO_PROCESO_LABEL,
} from '@/lib/tenjo'
import { registrarSalidaCuartoFrio } from '@/lib/cuartoFrio'
import { Play, Square, ClipboardCheck, Lock, Camera, AlertTriangle, CheckCircle2, PackageCheck, PackageX, Inbox, Phone, MessageCircle, Info, Check } from 'lucide-react'
import SetupNotice from './SetupNotice'

const fmtFechaLarga = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  : '—'
const ahoraISO = () => new Date().toISOString()
// Fin estimado del compostaje = inicio + N meses calendario (2 o 3)
const finCompostaje = (fechaStr, meses = 2) => {
  if (!fechaStr) return null
  const d = new Date(fechaStr + 'T12:00:00'); d.setMonth(d.getMonth() + meses)
  return hoyLocalISO(d)
}
const fmtFechaCorta = f => f
  ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'
const fmtHora = ts => ts
  ? new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  : '—'
// Un item sigue "por recibir" mientras no haya llegado a la planta
const POR_RECIBIR = ['AUTORIZADA_SALIDA', 'EN_TRASLADO']

// Evidencias obligatorias para iniciar el proceso, según el tipo de proceso.
// Compostaje: 2 fotos del cubículo. Cremación (u otro individual): altar + horno.
function slotsEvidenciaInicio(tipoProceso) {
  if (tipoProceso === 'COMPOSTAJE_INDIVIDUAL')
    return [
      { key: 'cubiculo_1', label: 'Cubículo — foto 1' },
      { key: 'cubiculo_2', label: 'Cubículo — foto 2' },
    ]
  return [
    { key: 'altar', label: 'Evidencia del altar' },
    { key: 'horno', label: 'Ingreso al horno' },
  ]
}

function Chip({ cfg, fallback }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg?.bg || '#F3F4F6', color: cfg?.text || '#374151' }}>
      {cfg?.label || fallback}
    </span>
  )
}

export default function JornadaTab({ config, personalData, canPlan, personal, onChanged }) {
  const { confirm, alert: showAlert } = useConfirm()
  const [lotes,    setLotes]    = useState(undefined)
  const [items,    setItems]    = useState({}) // { lote_id: [...] }
  const [sinTabla, setSinTabla] = useState(false)
  const [saving,   setSaving]   = useState(false)

  const [modalIniciar,   setModalIniciar]   = useState(null) // item
  const [respId,         setRespId]         = useState('')
  const [iniEvid,        setIniEvid]        = useState({})    // { slotKey: url } evidencias de inicio
  const [iniSubiendo,    setIniSubiendo]    = useState(null)  // slotKey en subida
  const [modalDetalle,   setModalDetalle]   = useState(null)  // item (ficha + contacto)
  const [modalChecklist, setModalChecklist] = useState(null) // item
  const [chkForm,        setChkForm]        = useState({})
  const [subiendo,       setSubiendo]       = useState(false)
  const [modalCerrar,    setModalCerrar]    = useState(null) // lote
  const [motivos,        setMotivos]        = useState({})
  const [obsCierre,      setObsCierre]      = useState('')
  const [novCierre,      setNovCierre]      = useState('')
  const [modalCubiculo,  setModalCubiculo]  = useState(null) // item (compostaje a finalizar)
  const [cubForm,        setCubForm]        = useState({ cubiculo_codigo: '', fecha_compostaje_inicio: '', meses: 2 })
  const [modalNovedad,   setModalNovedad]   = useState(null) // item (reportar novedad / no llegó)
  const [novForm,        setNovForm]        = useState({ estado: 'NOVEDAD', novedad: '', recibidoPor: '' })

  const cargar = useCallback(async () => {
    const { data: ls, error } = await db.from('lotes_tenjo')
      .select('*')
      .in('estado', ['CONFIRMADO', 'EN_EJECUCION'])
      .order('fecha_jornada', { ascending: true })
    if (error) { setSinTabla(true); setLotes(null); return }
    setLotes(ls || [])
    const map = {}
    for (const l of (ls || [])) {
      const { data: its } = await db.from('lotes_tenjo_items')
        .select('*, servicios!inner(tipo_acompanamiento, notas, recogidas(notas, contacto_telefono), planes(nombre, codigo, tipo_proceso), mascotas(nombre, peso_kg, especies(nombre), clientes(nombre, apellido, whatsapp)))')
        .gte('servicios.fecha_ingreso', FECHA_CORTE)
        .eq('lote_id', l.id)
        .order('created_at', { ascending: true })
      map[l.id] = its || []
    }
    setItems(map)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (sinTabla) return <SetupNotice />
  if (lotes === undefined) return <div className="flex items-center justify-center h-40 gap-3"><div className="spinner" /><span className="text-sm text-ink3">Cargando jornada…</span></div>

  async function updateItem(item, cambios, recargar = true) {
    setSaving(true)
    try {
      const { error } = await db.from('lotes_tenjo_items')
        .update({ ...cambios, decidido_por: personalData?.id || null }).eq('id', item.id)
      if (error) throw error
      if (recargar) { await cargar(); onChanged?.() }
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Subir una evidencia de inicio a un slot concreto (altar/horno/cubículo)
  async function subirEvidenciaInicio(item, slotKey, file) {
    if (!file) return
    setIniSubiendo(slotKey)
    try {
      const url = await subirEvidencia(file, item.id)
      setIniEvid(prev => ({ ...prev, [slotKey]: url }))
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error subiendo evidencia', variant: 'danger' })
    } finally { setIniSubiendo(null) }
  }

  async function iniciarProceso() {
    const item = modalIniciar
    if (!item) return
    if (!respId) { await showAlert('Selecciona el responsable del proceso.', { title: 'Responsable requerido' }); return }
    const slots = slotsEvidenciaInicio(item.servicios?.planes?.tipo_proceso)
    const faltan = slots.filter(s => !iniEvid[s.key])
    if (faltan.length) {
      await showAlert(`Carga las evidencias requeridas antes de iniciar: ${faltan.map(s => s.label).join(', ')}.`, { title: 'Evidencias requeridas' }); return
    }
    const urlsNuevas = slots.map(s => iniEvid[s.key])
    await updateItem(item, {
      estado: 'EN_PROCESO',
      responsable_proceso_id: respId,
      fecha_inicio_proceso: ahoraISO(),
      evidencia_inicio: iniEvid,
      evidencia_urls: [...(item.evidencia_urls || []), ...urlsNuevas],
    }, false)
    // Respaldo idempotente: si el proceso arranca en Tenjo, la mascota ya no
    // está en el cuarto frío — cierra la custodia si el traslado no la registró
    // (fuga real: 34 custodias fantasma detectadas el 2026-07-10).
    try {
      await registrarSalidaCuartoFrio(item.servicio_id, {
        personalId: personalData?.id,
        tipo: 'SALIDA_TENJO',
        motivo: 'Proceso iniciado en jornada Tenjo — salida no registrada en el traslado',
      })
    } catch (e) { console.error('[salida cuarto frío]', e?.message) }
    // Primer proceso iniciado → el lote pasa a EN_EJECUCION (best-effort)
    await db.from('lotes_tenjo').update({ estado: 'EN_EJECUCION' })
      .eq('id', item.lote_id).eq('estado', 'CONFIRMADO')
    setModalIniciar(null); setRespId(''); setIniEvid({})
    await cargar(); onChanged?.()
  }

  async function finalizarCompostaje() {
    const item = modalCubiculo
    if (!item) return
    if (!cubForm.cubiculo_codigo.trim()) {
      await showAlert('Indica el código del cubículo donde quedó la mascota.', { title: 'Cubículo requerido' }); return
    }
    const inicioComp = cubForm.fecha_compostaje_inicio || today()
    await updateItem(item, {
      estado: 'PROCESADO',
      fecha_fin_proceso: ahoraISO(),
      cubiculo_codigo: cubForm.cubiculo_codigo.trim(),
      fecha_compostaje_inicio: inicioComp,
      meses_compostaje: cubForm.meses === 3 ? 3 : 2,
    }, false)
    // Conectar los flujos: salida del cuarto frío + traslado completado + avanzar servicio
    try {
      await reconciliarServicioTenjo(item.servicio_id, {
        tipoProceso: item.servicios?.planes?.tipo_proceso,
        fechaCompostajeInicio: inicioComp,
        personalId: personalData?.id,
      })
    } catch (e) { console.error('[reconciliar compostaje]', e?.message) }
    setModalCubiculo(null)
    setCubForm({ cubiculo_codigo: '', fecha_compostaje_inicio: '', meses: 2 })
    await cargar(); onChanged?.()
  }

  // ── Recepción en planta ──
  // Recibir una mascota (llegó bien). Sella hora + responsable, cierra custodia
  // y completa el traslado; el item queda RECIBIDA (habilita "Iniciar proceso").
  async function recibirItem(item) {
    setSaving(true)
    try {
      await recibirItemLoteTenjo(item, { estado: 'RECIBIDA', personalId: personalData?.id })
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al recibir', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Recibir todas las mascotas pendientes de un lote de una sola vez
  async function recibirTodas(lote) {
    const porRecibir = (items[lote.id] || []).filter(
      i => POR_RECIBIR.includes(i.estado) && i.recepcion_estado !== 'NO_LLEGO'
    )
    if (!porRecibir.length) return
    if (!await confirm(
      `Se recibirán ${porRecibir.length} mascotica${porRecibir.length !== 1 ? 's' : ''} en la planta. Se sellará la hora de llegada y saldrán del cuarto frío.`,
      { title: '¿Recibir todas?', confirmLabel: 'Recibir todas', variant: 'warning' }
    )) return
    setSaving(true)
    try {
      for (const i of porRecibir) {
        await recibirItemLoteTenjo(i, { estado: 'RECIBIDA', personalId: personalData?.id })
      }
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al recibir', variant: 'danger' })
    } finally { setSaving(false) }
  }

  // Reportar novedad / no llegó (desde el modal)
  async function guardarNovedadRecepcion() {
    const item = modalNovedad
    if (!item) return
    if (novForm.estado === 'NO_LLEGO' && !novForm.novedad.trim()) {
      await showAlert('Indica por qué no llegó a la planta.', { title: 'Motivo requerido' }); return
    }
    setSaving(true)
    try {
      await recibirItemLoteTenjo(item, {
        estado:      novForm.estado,
        novedad:     novForm.novedad,
        recibidoPor: novForm.recibidoPor || personalData?.id,
        personalId:  personalData?.id,
      })
      setModalNovedad(null)
      setNovForm({ estado: 'NOVEDAD', novedad: '', recibidoPor: '' })
      await cargar(); onChanged?.()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error al registrar novedad', variant: 'danger' })
    } finally { setSaving(false) }
  }

  function abrirChecklist(item) {
    setModalChecklist(item)
    setChkForm(item.checklist || {})
  }

  async function guardarChecklist() {
    if (!modalChecklist) return
    await updateItem(modalChecklist, { checklist: chkForm })
    setModalChecklist(null)
  }

  async function agregarEvidencias(item, files) {
    if (!files?.length) return
    setSubiendo(true)
    try {
      const urls = [...(item.evidencia_urls || [])]
      for (const f of files) urls.push(await subirEvidencia(f, item.id))
      const { error } = await db.from('lotes_tenjo_items')
        .update({ evidencia_urls: urls }).eq('id', item.id)
      if (error) throw error
      setModalChecklist(m => m && { ...m, evidencia_urls: urls })
      await cargar()
    } catch (e) {
      await showAlert(parsearErrorDB(e), { title: 'Error subiendo evidencia', variant: 'danger' })
    } finally { setSubiendo(false) }
  }

  async function cerrarLote() {
    const lote = modalCerrar
    if (!lote) return
    setSaving(true)
    try {
      const r = await orbitApi(`/tenjo/lotes/${lote.id}/cerrar`, {
        method: 'POST',
        body: { no_ejecutados: motivos, observaciones: obsCierre || null, novedades: novCierre || null },
      })
      setModalCerrar(null); setMotivos({}); setObsCierre(''); setNovCierre('')
      await cargar(); onChanged?.()
      await showAlert(
        `Lote ${r.numero_lote} cerrado: ${r.ejecutados} ejecutado${r.ejecutados !== 1 ? 's' : ''} de ${r.programados}.`
        + (r.no_ejecutados?.length ? ` No ejecutados: ${r.no_ejecutados.map(n => n.mascota).join(', ')}.` : ''),
        { title: '✅ Lote cerrado' }
      )
    } catch (e) {
      if (e.status === 422 && e.detalle?.bloqueos) {
        const lineas = e.detalle.bloqueos.map(b => `• ${b.mascota}: ${b.faltantes.join('; ')}`).join('\n')
        await showAlert(`El backend bloqueó el cierre:\n${lineas}`, { title: 'No se puede cerrar el lote', variant: 'danger' })
      } else {
        await showAlert(e.message, { title: 'Error cerrando lote', variant: 'danger' })
      }
    } finally { setSaving(false) }
  }

  // ── Render por item ──
  function ItemRow({ item, lote }) {
    const m = item.servicios?.mascotas
    const plan = item.servicios?.planes
    const variante = varianteProceso(plan?.codigo, item.servicios?.tipo_acompanamiento)
    const faltantes = item.estado === 'PROCESADO'
      ? validarItemCierre(item, plan?.codigo, item.servicios?.tipo_acompanamiento, config)
      : []
    const resp = personal?.find(p => p.id === item.responsable_proceso_id)
    const recibidor = personal?.find(p => p.id === item.recibido_por)
    const porRecibir = POR_RECIBIR.includes(item.estado)
    const noLlego = item.recepcion_estado === 'NO_LLEGO'
    const recepCfg = item.recepcion_estado ? RECEPCION_CFG[item.recepcion_estado] : null
    const nEvid = (item.evidencia_urls || []).length
    const esCompostaje = plan?.tipo_proceso === 'COMPOSTAJE_INDIVIDUAL'
    const rec = Array.isArray(item.servicios?.recogidas) ? item.servicios.recogidas[0] : item.servicios?.recogidas
    const contacto = m?.clientes?.whatsapp || rec?.contacto_telefono || null
    const observaciones = item.servicios?.notas || rec?.notas || null

    return (
      <div className="flex items-start gap-3 p-3.5 rounded-xl border hover:bg-surface2 transition-all"
        style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
        <span className="text-2xl">{petEmoji(m?.especies?.nombre)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setModalDetalle(item)}
              className="font-semibold text-ink hover:text-primary-dark hover:underline inline-flex items-center gap-1">
              {m?.nombre || '—'} <Info size={12} className="text-ink3" />
            </button>
            <Chip cfg={ITEM_ESTADO_CFG[item.estado]} fallback={item.estado} />
            {recepCfg && item.recepcion_estado !== 'RECIBIDA' && <Chip cfg={recepCfg} fallback={item.recepcion_estado} />}
            <span className="text-[10px] text-ink3">{VARIANTE_LABEL[variante]}</span>
          </div>
          <div className="text-[11px] text-ink3 mt-0.5">
            {m?.clientes?.nombre} {m?.clientes?.apellido} · {plan?.nombre}
            {resp && ` · Responsable: ${resp.nombre} ${resp.apellido}`}
            {nEvid > 0 && ` · 📷 ${nEvid} evidencia${nEvid !== 1 ? 's' : ''}`}
          </div>
          {contacto && (
            <div className="text-[11px] text-ink2 mt-0.5">📞 {contacto}</div>
          )}
          {observaciones && (
            <div className="text-[11px] text-ink2 mt-0.5 italic">📝 {observaciones}</div>
          )}
          {item.estado === 'PROCESADO' && esCompostaje && item.cubiculo_codigo && (
            <div className="text-[11px] mt-0.5 font-medium" style={{ color: '#065F46' }}>
              🌿 Cubículo {item.cubiculo_codigo} · {item.meses_compostaje || 2} meses
            </div>
          )}
          {porRecibir && !noLlego && (
            <div className="text-[10px] text-ink3 mt-0.5">Autorizada para Tenjo — recíbela al llegar a la planta para poder iniciar el proceso.</div>
          )}
          {noLlego && (
            <div className="text-[10px] mt-0.5 font-medium" style={{ color: '#991B1B' }}>
              🚫 No llegó a la planta{item.recepcion_novedad ? ` — ${item.recepcion_novedad}` : ''}
            </div>
          )}
          {item.fecha_recepcion && !noLlego && (
            <div className="text-[10px] text-ink3 mt-0.5">
              📦 Recibida {fmtHora(item.fecha_recepcion)}{recibidor ? ` · ${recibidor.nombre} ${recibidor.apellido}` : ''}
              {item.recepcion_estado === 'NOVEDAD' && item.recepcion_novedad && (
                <span className="text-amber-700"> · ⚠ {item.recepcion_novedad}</span>
              )}
            </div>
          )}
          {item.estado === 'PROCESADO' && faltantes.length > 0 && (
            <div className="mt-1">
              {faltantes.map((f, i) => (
                <div key={i} className="text-[10px] text-amber-700">⚠ {f}</div>
              ))}
            </div>
          )}
          {item.estado === 'PROCESADO' && faltantes.length === 0 && (
            <div className="text-[10px] text-green-700 mt-0.5 font-semibold">✓ Listo para cierre</div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0">
          {porRecibir && (
            <>
              <Button size="sm" disabled={saving} onClick={() => recibirItem(item)}>
                <PackageCheck size={12} /> Recibir
              </Button>
              <Button size="sm" variant="secondary" disabled={saving}
                onClick={() => { setModalNovedad(item); setNovForm({ estado: noLlego ? 'NO_LLEGO' : 'NOVEDAD', novedad: item.recepcion_novedad || '', recibidoPor: personalData?.id || '' }) }}>
                <PackageX size={12} /> Novedad
              </Button>
            </>
          )}
          {item.estado === 'RECIBIDA' && (
            <Button size="sm" disabled={saving}
              onClick={() => { setModalIniciar(item); setRespId(item.responsable_proceso_id || personalData?.id || ''); setIniEvid(item.evidencia_inicio || {}) }}>
              <Play size={12} /> Iniciar proceso
            </Button>
          )}
          {item.estado === 'EN_PROCESO' && (
            <Button size="sm" disabled={saving}
              onClick={async () => {
                if (esCompostaje) {
                  // Compostaje: capturar el cubículo donde quedó la mascota
                  setCubForm({ cubiculo_codigo: item.cubiculo_codigo || '', fecha_compostaje_inicio: today(), meses: item.meses_compostaje || 2 })
                  setModalCubiculo(item)
                  return
                }
                // Cremación (u otros): la finalización registra la fecha de cremación
                if (!await confirm(`Se registrará la cremación de ${m?.nombre} con la fecha de hoy.`, { title: '¿Finalizar cremación?', confirmLabel: 'Finalizar' })) return
                await updateItem(item, { estado: 'PROCESADO', fecha_fin_proceso: ahoraISO() }, false)
                // Conectar los flujos: salida del cuarto frío + traslado completado + avanzar servicio
                try {
                  await reconciliarServicioTenjo(item.servicio_id, {
                    tipoProceso: plan?.tipo_proceso,
                    personalId: personalData?.id,
                  })
                } catch (e) { console.error('[reconciliar cremación]', e?.message) }
                await cargar(); onChanged?.()
              }}>
              <Square size={12} /> {esCompostaje ? 'Finalizar · cubículo' : 'Finalizar'}
            </Button>
          )}
          {['EN_PROCESO', 'PROCESADO'].includes(item.estado) && (
            <Button size="sm" variant={faltantes.length ? 'primary' : 'secondary'} disabled={saving}
              onClick={() => abrirChecklist(item)}>
              <ClipboardCheck size={12} /> Checklist{item.estado === 'PROCESADO' && faltantes.length > 0 ? ` (${faltantes.length})` : ''}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {lotes.length === 0 ? (
        <div className="bg-surface border rounded-2xl py-12 text-center" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
          <div className="text-3xl mb-2">🗓️</div>
          <p className="text-[14px] font-semibold text-ink2">No hay lotes confirmados en ejecución</p>
          <p className="text-[12px] text-ink3 mt-1">Confirma un lote en la pestaña Planificación para verlo aquí el día de la jornada.</p>
        </div>
      ) : lotes.map(lote => {
        const its = items[lote.id] || []
        const activos = its.filter(i => !['REPROGRAMADO', 'RETIRADO_DEL_LOTE', 'NO_EJECUTADO'].includes(i.estado))
        const porRecibirLote = activos.filter(i => POR_RECIBIR.includes(i.estado) && i.recepcion_estado !== 'NO_LLEGO')
        const procesados = activos.filter(i => i.estado === 'PROCESADO')
        const listos = procesados.filter(i =>
          validarItemCierre(i, i.servicios?.planes?.codigo, i.servicios?.tipo_acompanamiento, config).length === 0
        ).length
        return (
          <div key={lote.id} className="bg-surface border rounded-2xl shadow-sm" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
            <div className="px-5 py-4 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'rgba(30,80,40,0.1)' }}>
              <div className="font-semibold text-[15px] text-ink flex-1">
                Lote {lote.numero_lote} — {fmtFechaLarga(lote.fecha_jornada)}
              </div>
              <Chip cfg={LOTE_ESTADO_CFG[lote.estado]} fallback={lote.estado} />
              <span className="text-[11px] text-ink3">
                {porRecibirLote.length > 0 && <span className="text-cyan-700 font-semibold">{porRecibirLote.length} por recibir · </span>}
                {procesados.length}/{activos.length} procesados · {listos} listos para cierre
              </span>
              {porRecibirLote.length > 0 && (
                <Button size="sm" disabled={saving} onClick={() => recibirTodas(lote)}>
                  <Inbox size={12} /> Recibir todas ({porRecibirLote.length})
                </Button>
              )}
              {canPlan && (
                <Button size="sm" variant="gold" disabled={saving}
                  onClick={() => { setModalCerrar(lote); setMotivos({}); setObsCierre(''); setNovCierre('') }}>
                  <Lock size={12} /> Cerrar lote
                </Button>
              )}
            </div>
            {activos.length === 0 ? (
              <div className="py-8 text-center text-ink3 text-sm">Sin mascoticas activas en este lote.</div>
            ) : (
              <div className="p-4 space-y-2.5">
                {activos.map(i => <ItemRow key={i.id} item={i} lote={lote} />)}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Modal iniciar proceso ── */}
      {modalIniciar && (() => {
        const slots = slotsEvidenciaInicio(modalIniciar.servicios?.planes?.tipo_proceso)
        const faltanEvid = slots.filter(s => !iniEvid[s.key]).length
        const puedeIniciar = !!respId && faltanEvid === 0 && !iniSubiendo
        return (
        <Modal open onClose={() => setModalIniciar(null)}
          title={`Iniciar proceso — ${modalIniciar.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setModalIniciar(null)}>Cancelar</Button>
            <Button onClick={iniciarProceso} disabled={saving || !puedeIniciar}>{saving ? 'Guardando…' : 'Iniciar'}</Button>
          </>}>
          <div className="space-y-4">
            <p className="text-[12px] text-ink2">Se registrará la fecha y hora de inicio. El lote pasará a EN EJECUCIÓN.</p>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Responsable del proceso *</label>
              <Select value={respId} onChange={e => setRespId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {(personal || []).map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
              </Select>
            </div>
            {/* Evidencias obligatorias para iniciar */}
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1.5">
                <Camera size={11} className="inline mr-1" />Evidencias obligatorias ({slots.length - faltanEvid}/{slots.length})
              </label>
              <div className="grid grid-cols-2 gap-2">
                {slots.map(s => {
                  const url = iniEvid[s.key]
                  const subiendo = iniSubiendo === s.key
                  return (
                    <label key={s.key}
                      className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-2 cursor-pointer text-center min-h-[92px] transition-all ${url ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      {url ? (
                        <>
                          <img src={url} alt={s.label} className="w-full h-12 object-cover rounded-lg" />
                          <span className="text-[10px] font-semibold text-green-700 inline-flex items-center gap-0.5">
                            <Check size={10} /> {s.label}
                          </span>
                        </>
                      ) : subiendo ? (
                        <span className="text-[11px] text-ink3">Subiendo…</span>
                      ) : (
                        <>
                          <Camera size={18} className="text-ink3" />
                          <span className="text-[10px] font-semibold text-ink2 leading-tight">{s.label}</span>
                          <span className="text-[9px] text-ink3">Cámara o galería</span>
                        </>
                      )}
                      <input type="file" accept="image/*" className="hidden" disabled={subiendo}
                        onChange={e => { subirEvidenciaInicio(modalIniciar, s.key, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  )
                })}
              </div>
              {faltanEvid > 0 && (
                <p className="text-[10px] text-amber-700 mt-1.5">Carga las {slots.length} fotos para poder iniciar el proceso.</p>
              )}
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* ── Modal checklist / evidencias ── */}
      {modalChecklist && (() => {
        const item = modalChecklist
        const plan = item.servicios?.planes
        const variante = varianteProceso(plan?.codigo, item.servicios?.tipo_acompanamiento)
        const plantillas = config.checklist_plantillas || CONFIG_DEFAULTS.checklist_plantillas
        const campos = plantillas[variante] || []
        const evidencias = item.evidencia_urls || []
        return (
          <Modal open onClose={() => setModalChecklist(null)}
            title={`Checklist — ${item.servicios?.mascotas?.nombre || ''} (${VARIANTE_LABEL[variante]})`}
            maxWidth="max-w-lg"
            footer={<>
              <Button variant="secondary" onClick={() => setModalChecklist(null)}>Cerrar</Button>
              <Button onClick={guardarChecklist} disabled={saving}>{saving ? 'Guardando…' : 'Guardar checklist'}</Button>
            </>}>
            <div className="space-y-4">
              {/* Evidencias */}
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1.5">
                  <Camera size={11} className="inline mr-1" />Evidencias ({evidencias.length}) — mínimo 1 para cerrar
                </label>
                {evidencias.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {evidencias.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="" className="w-full h-16 object-cover rounded-lg border border-gray-100" />
                      </a>
                    ))}
                  </div>
                )}
                <input type="file" accept="image/*" multiple disabled={subiendo}
                  className="text-[12px]"
                  onChange={e => { agregarEvidencias(item, Array.from(e.target.files || [])); e.target.value = '' }} />
                {subiendo && <p className="text-[11px] text-ink3 mt-1">Subiendo…</p>}
              </div>

              {/* Campos por variante */}
              {campos.map(c => (
                <div key={c.campo}>
                  {c.tipo === 'bool' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-[#3D5A27]"
                        checked={chkForm[c.campo] === true}
                        onChange={e => setChkForm(f => ({ ...f, [c.campo]: e.target.checked }))} />
                      <span className="text-[12px] font-semibold text-ink2">{c.label}{c.obligatorio && ' *'}</span>
                    </label>
                  ) : (
                    <>
                      <label className="text-[11px] font-bold text-ink3 block mb-1">{c.label}{c.obligatorio && ' *'}</label>
                      <Input value={chkForm[c.campo] || ''}
                        onChange={e => setChkForm(f => ({ ...f, [c.campo]: e.target.value }))} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal cerrar lote ── */}
      {modalCerrar && (() => {
        const its = (items[modalCerrar.id] || []).filter(i => !['REPROGRAMADO', 'RETIRADO_DEL_LOTE', 'NO_EJECUTADO', 'PROPUESTO'].includes(i.estado))
        const procesados = its.filter(i => i.estado === 'PROCESADO')
        const pendientes = its.filter(i => i.estado !== 'PROCESADO')
        const conFaltantes = procesados
          .map(i => ({ i, f: validarItemCierre(i, i.servicios?.planes?.codigo, i.servicios?.tipo_acompanamiento, config) }))
          .filter(x => x.f.length)
        return (
          <Modal open onClose={() => setModalCerrar(null)}
            title={`Cerrar lote ${modalCerrar.numero_lote}`}
            maxWidth="max-w-lg"
            footer={<>
              <Button variant="secondary" onClick={() => setModalCerrar(null)}>Cancelar</Button>
              <Button variant="gold" onClick={cerrarLote} disabled={saving}>
                {saving ? 'Cerrando…' : 'Cerrar lote'}
              </Button>
            </>}>
            <div className="space-y-4">
              <p className="text-[12px] text-ink2">
                {procesados.length} procesado{procesados.length !== 1 ? 's' : ''} · {pendientes.length} sin ejecutar.
                El backend valida responsable, fechas y checklists antes de cerrar (la evidencia es recomendada, no obligatoria).
              </p>
              {conFaltantes.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[11px] font-bold text-amber-800 mb-1"><AlertTriangle size={11} className="inline mr-1" />Faltantes que bloquearán el cierre:</p>
                  {conFaltantes.map(({ i, f }) => (
                    <div key={i.id} className="text-[11px] text-amber-700">• {i.servicios?.mascotas?.nombre}: {f.join('; ')}</div>
                  ))}
                </div>
              )}
              {pendientes.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-ink3 mb-2">Motivo por cada proceso no ejecutado * (quedarán NO EJECUTADOS y volverán al ciclo de candidatas)</p>
                  <div className="space-y-2">
                    {pendientes.map(i => (
                      <div key={i.id}>
                        <label className="text-[11px] font-semibold text-ink2 block mb-0.5">
                          {i.servicios?.mascotas?.nombre} ({ITEM_ESTADO_CFG[i.estado]?.label || i.estado})
                        </label>
                        <Input placeholder="Motivo de no ejecución…"
                          value={motivos[i.id] || ''}
                          onChange={e => setMotivos(m => ({ ...m, [i.id]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Novedades de la jornada</label>
                <Textarea value={novCierre} onChange={e => setNovCierre(e.target.value)} placeholder="Novedades, incidencias…" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Observaciones de cierre</label>
                <Textarea value={obsCierre} onChange={e => setObsCierre(e.target.value)} />
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal registrar cubículo (finalizar compostaje) ── */}
      {modalCubiculo && (
        <Modal open onClose={() => setModalCubiculo(null)}
          title={`Finalizar compostaje — ${modalCubiculo.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setModalCubiculo(null)}>Cancelar</Button>
            <Button onClick={finalizarCompostaje} disabled={saving}>{saving ? 'Guardando…' : 'Finalizar y registrar cubículo'}</Button>
          </>}>
          <div className="space-y-4">
            <div className="rounded-xl p-3 text-[12px]" style={{ background: '#F0FDF4', borderColor: '#86EFAC', border: '1px solid' }}>
              Registra en qué cubículo quedó la mascota y cuánto durará el compostaje. El sistema calculará la fecha estimada de finalización sumando <strong>{cubForm.meses} meses</strong> a la fecha de ingreso.
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Código del cubículo *</label>
              <Input placeholder="Ej: C-03" value={cubForm.cubiculo_codigo}
                onChange={e => setCubForm(p => ({ ...p, cubiculo_codigo: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1.5">Duración del compostaje</label>
              <div className="grid grid-cols-2 gap-2">
                {[2, 3].map(n => (
                  <button key={n} type="button"
                    onClick={() => setCubForm(p => ({ ...p, meses: n }))}
                    className={`p-2.5 rounded-xl border text-[13px] font-semibold transition-all ${cubForm.meses === n ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 text-ink3'}`}>
                    {n} meses
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">Fecha de ingreso al cubículo</label>
              <Input type="date" max={today()} value={cubForm.fecha_compostaje_inicio}
                onChange={e => setCubForm(p => ({ ...p, fecha_compostaje_inicio: e.target.value }))} />
              {cubForm.fecha_compostaje_inicio && (
                <p className="text-[11px] text-ink3 mt-1">→ Compostaje listo estimado: <strong>{fmtFechaCorta(finCompostaje(cubForm.fecha_compostaje_inicio, cubForm.meses))}</strong></p>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal reportar novedad / no llegó ── */}
      {modalNovedad && (
        <Modal open onClose={() => setModalNovedad(null)}
          title={`Novedad de recepción — ${modalNovedad.servicios?.mascotas?.nombre || ''}`}
          maxWidth="max-w-md"
          footer={<>
            <Button variant="secondary" onClick={() => setModalNovedad(null)}>Cancelar</Button>
            <Button onClick={guardarNovedadRecepcion} disabled={saving}
              variant={novForm.estado === 'NO_LLEGO' ? 'danger' : 'primary'}>
              {saving ? 'Guardando…' : novForm.estado === 'NO_LLEGO' ? 'Registrar que no llegó' : 'Recibir con novedad'}
            </Button>
          </>}>
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1.5">¿Qué pasó?</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                  onClick={() => setNovForm(f => ({ ...f, estado: 'NOVEDAD' }))}
                  className={`p-2.5 rounded-xl border text-[12px] font-semibold text-left transition-all ${novForm.estado === 'NOVEDAD' ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-ink3'}`}>
                  ⚠ Llegó con novedad
                  <div className="text-[10px] font-normal text-ink3 mt-0.5">Se recibe igual y avanza</div>
                </button>
                <button type="button"
                  onClick={() => setNovForm(f => ({ ...f, estado: 'NO_LLEGO' }))}
                  className={`p-2.5 rounded-xl border text-[12px] font-semibold text-left transition-all ${novForm.estado === 'NO_LLEGO' ? 'border-red-400 bg-red-50 text-red-800' : 'border-gray-200 text-ink3'}`}>
                  🚫 No llegó
                  <div className="text-[10px] font-normal text-ink3 mt-0.5">No avanza; queda pendiente</div>
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink3 block mb-1">
                {novForm.estado === 'NO_LLEGO' ? 'Motivo por el que no llegó *' : 'Detalle de la novedad'}
              </label>
              <Textarea value={novForm.novedad}
                onChange={e => setNovForm(f => ({ ...f, novedad: e.target.value }))}
                placeholder={novForm.estado === 'NO_LLEGO' ? 'Ej: no venía en el camión, se reprograma…' : 'Ej: llegó con la caja húmeda…'} />
            </div>
            {novForm.estado !== 'NO_LLEGO' && (
              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">Quién recibe</label>
                <Select value={novForm.recibidoPor} onChange={e => setNovForm(f => ({ ...f, recibidoPor: e.target.value }))}>
                  <option value="">Yo ({personalData?.nombre || 'operario'})</option>
                  {(personal || []).map(p => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
                </Select>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Modal detalles de la mascota (ficha + contacto) ── */}
      {modalDetalle && (() => {
        const item = modalDetalle
        const m   = item.servicios?.mascotas
        const cl  = m?.clientes
        const plan = item.servicios?.planes
        const rec = Array.isArray(item.servicios?.recogidas) ? item.servicios.recogidas[0] : item.servicios?.recogidas
        const contacto = cl?.whatsapp || rec?.contacto_telefono || null
        const observaciones = item.servicios?.notas || rec?.notas || null
        const recibidor = personal?.find(p => p.id === item.recibido_por)
        const msgWa = `Hola, te saludamos con mucho respeto de Camino al Cielo 🕊️ sobre el proceso de ${m?.nombre || 'tu mascotica'}.`
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
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{petEmoji(m?.especies?.nombre)}</span>
                <div>
                  <div className="font-bold text-ink text-[15px]">{m?.nombre || '—'}</div>
                  <div className="text-[11px] text-ink3">{cl?.nombre} {cl?.apellido}</div>
                </div>
              </div>

              {/* Contacto: WhatsApp + llamar */}
              <div className="flex flex-wrap gap-2">
                {contacto ? (
                  <>
                    <a href={waLink(contacto, msgWa)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white flex-1 justify-center"
                      style={{ background: '#25D366' }}>
                      <MessageCircle size={14} /> WhatsApp
                    </a>
                    <a href={`tel:${contacto}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold flex-1 justify-center border"
                      style={{ borderColor: '#1A5CD8', color: '#1A5CD8' }}>
                      <Phone size={14} /> Llamar
                    </a>
                  </>
                ) : (
                  <span className="text-[12px] text-amber-700">⚠ Sin teléfono de contacto registrado.</span>
                )}
              </div>

              <div className="space-y-0">
                <Fila label="Especie" value={m?.especies?.nombre} />
                <Fila label="Peso" value={m?.peso_kg ? `${m.peso_kg} kg` : null} />
                <Fila label="Teléfono" value={contacto} />
                <Fila label="Plan" value={plan?.nombre} />
                <Fila label="Tipo de proceso" value={TIPO_PROCESO_LABEL[plan?.tipo_proceso] || plan?.tipo_proceso} />
                <Fila label="Acompañamiento" value={VARIANTE_LABEL[varianteProceso(plan?.codigo, item.servicios?.tipo_acompanamiento)]} />
                <Fila label="Estado en el lote" value={ITEM_ESTADO_CFG[item.estado]?.label || item.estado} />
                {item.cubiculo_codigo && <Fila label="Cubículo" value={`${item.cubiculo_codigo} · ${item.meses_compostaje || 2} meses`} />}
                {item.fecha_recepcion && (
                  <Fila label="Recibida" value={`${fmtHora(item.fecha_recepcion)}${recibidor ? ` · ${recibidor.nombre}` : ''}`} />
                )}
              </div>

              {observaciones && (
                <div className="rounded-xl p-3 text-[12px] bg-surface2">
                  <div className="text-[10px] font-bold text-ink3 mb-1">📝 Observaciones</div>
                  <div className="text-ink2 italic">{observaciones}</div>
                </div>
              )}
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
