import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { fmt, parseDate, parsearErrorDB } from '@/lib/utils'
import { cargarComprobantesServicio, subirComprobantePago } from '@/lib/comprobantes'
import { useConfirm } from '@/contexts/ConfirmContext'
import { FileText, Camera, ChevronUp, ChevronDown, Paperclip, AlertCircle, RotateCcw, X } from 'lucide-react'

// ── Recibos guardados del servicio ────────────────────────────────────────────
// Muestra los recibos del técnico y distingue cuál lleva el valor real que
// suma en Finanzas: tipo CLIENTE con la regla de migración 027 (si hay varios,
// vale el más reciente CON dinero; si ninguno cobró, el más reciente). El
// recibo VETERINARIA es el documento informativo del mismo cobro para la vet,
// y los CLIENTE viejos son versiones regeneradas que no suman.
// Usado en el modal del Kanban y en la ficha del Historial (Gestión).
export default function RecibosServicio({ servicioId, onCambio }) {
  const [recibos, setRecibos]           = useState(null)   // null = cargando
  const [pdfFiles, setPdfFiles]         = useState([])     // PDFs del recibo en storage
  const [comps, setComps]               = useState(null)   // null = aún no cargados (lazy)
  const [compsOpen, setCompsOpen]       = useState(false)
  const [compsLoading, setCompsLoading] = useState(false)
  const [compsError, setCompsError]     = useState('')
  const [subiendo, setSubiendo]         = useState(false)
  const [subirError, setSubirError]     = useState('')
  const [corrigiendo, setCorrigiendo] = useState(null)   // recibo_id con el panel abierto
  const [motivo, setMotivo]            = useState('')
  const [corrError, setCorrError]      = useState('')
  const [corrSaving, setCorrSaving]    = useState(false)
  const [corrOk, setCorrOk]            = useState('')
  const { personalData } = useAuth()
  const { confirm } = useConfirm()
  const puedeSubir = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)
  // Corregir un cobro mueve dinero en el cuadre que el técnico firma: es de
  // coordinación, no del técnico.
  const puedeCorregir = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)

  useEffect(() => {
    let activo = true
    setRecibos(null); setPdfFiles([]); setComps(null); setCompsOpen(false); setCompsError('')
    db.from('recibos_tecnico')
      .select('id, numero_recibo, tipo, fecha_emision, hora_emision, valor_total, valor_cobrado, medios_pago, datos_form, created_at, personal:tecnico_id(nombre, apellido)')
      .eq('servicio_id', servicioId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (activo) setRecibos(data || []) })
    // PDFs del recibo: el técnico los sube a evidencias/recibos/{servicioId}/
    // con nombre {numero}_{CLI|VET}_{timestamp}.pdf al enviarlos por WhatsApp
    db.storage.from('evidencias').list(`recibos/${servicioId}`, { limit: 100 })
      .then(({ data }) => { if (activo) setPdfFiles((data || []).map(f => f.name).filter(n => /\.pdf$/i.test(n))) })
      .catch(() => {})
    return () => { activo = false }
  }, [servicioId])

  // El más reciente que corresponde a este recibo (timestamp al final del nombre)
  function pdfDeRecibo(r) {
    const pref = `${r.numero_recibo}_${r.tipo === 'VETERINARIA' ? 'VET' : 'CLI'}_`
    const matches = pdfFiles.filter(n => n.startsWith(pref))
    return matches.length ? matches.sort().at(-1) : null
  }

  // Abre el PDF con URL firmada (bucket puede ser privado). La ventana se abre
  // ANTES del await para que el navegador no la bloquee como popup.
  async function abrirPdf(name) {
    const w = window.open('', '_blank')
    const { data } = await db.storage.from('evidencias')
      .createSignedUrl(`recibos/${servicioId}/${name}`, 600)
    if (data?.signedUrl) {
      if (w) w.location = data.signedUrl
      else window.open(data.signedUrl, '_blank', 'noopener')
    } else if (w) w.close()
  }

  async function toggleComprobantes() {
    if (compsOpen) { setCompsOpen(false); return }
    setCompsOpen(true)
    if (comps !== null || compsLoading) return
    setCompsLoading(true)
    try { setComps(await cargarComprobantesServicio(servicioId)) }
    catch (e) { setCompsError(parsearErrorDB(e)) }
    finally { setCompsLoading(false) }
  }

  // Adjuntar un comprobante a un pago YA registrado. Es la unica ruta cuando el
  // pago se guardo sin comprobante: la cartera de Finanzas deja de listar el
  // servicio en cuanto el saldo llega a 0, y el detalle del cuadre solo alcanza
  // los recibos del tecnico. `recibo_id` queda NULL a proposito (migracion 018):
  // el comprobante se ata al servicio y no interfiere con el "comprobante
  // activo" del recibo del tecnico.
  async function subirComprobante(file) {
    setSubiendo(true); setSubirError('')
    try {
      const subido = await subirComprobantePago(servicioId, file)
      const { data: creado, error } = await db.from('recibo_comprobantes').insert({
        servicio_id:  servicioId,
        bucket:       subido.bucket,
        storage_path: subido.storage_path,
        mime_type:    subido.mime_type,
        estado:       'APROBADO',
        uploaded_by:  personalData?.id || null,
      }).select('id, bucket, storage_path, mime_type, estado').single()
      // Si la fila no queda, el archivo huerfano no le sirve a nadie: se borra.
      if (error) {
        await db.storage.from(subido.bucket).remove([subido.storage_path])
        throw error
      }
      const { data: signed } = await db.storage.from(creado.bucket || 'evidencias')
        .createSignedUrl(creado.storage_path, 300)
      setComps(prev => [...(prev || []), { ...creado, url: signed?.signedUrl || '' }])
      // Rastro para la trazabilidad del servicio (best-effort, no bloquea).
      await db.from('novedades_servicio').insert({
        servicio_id:    servicioId,
        tipo_novedad:   'NOTA',
        descripcion:    'Comprobante de pago adjuntado desde la ficha del servicio.',
        registrado_por: personalData?.id || null,
      })
    } catch (e) {
      setSubirError(parsearErrorDB(e))
    } finally {
      setSubiendo(false)
    }
  }

  // ── "El técnico marcó cobrado y no cobró" ───────────────────────────────────
  // Hasta la migración 114 esto solo se podía arreglar por SQL. Lo único que
  // Orbit dejaba tocar era el desplegable de estado_pago del Kanban, que cambia
  // ESA columna y nada más: el servicio quedaba "pendiente" mientras el recibo y
  // el cuadre seguían cobrándole el efectivo al técnico. La RPC lo deja como si
  // el recibo se hubiera emitido bien, marcado "pago pendiente".
  async function corregirCobro(r) {
    const texto = motivo.trim()
    if (!texto) { setCorrError('Escribe por qué se corrige (queda en la bitácora del servicio).'); return }
    const ok = await confirm(
      `Se anulará el cobro de ${fmt(r.valor_cobrado || 0)} del recibo No. ${r.numero_recibo}: el recibo queda como PAGO PENDIENTE, ` +
      'sus medios de pago se borran y el cobro vuelve a quedar abierto en Cartera. El recibo y la bitácora NO se borran.',
      { title: '¿El técnico no recibió este dinero?', variant: 'danger', confirmLabel: 'Sí, corregir el cobro' }
    )
    if (!ok) return
    setCorrSaving(true); setCorrError(''); setCorrOk('')
    try {
      const { data, error } = await db.rpc('revertir_cobro_recibo', {
        p_recibo_id: r.id,
        p_actor_id:  personalData?.id || null,
        p_actor_rol: personalData?.rol || null,
        p_motivo:    texto,
      })
      if (error) throw error
      setCorrigiendo(null); setMotivo('')
      setCorrOk(data?.ya_revertido
        ? 'Este recibo ya estaba sin cobro; no había nada que corregir.'
        : `Cobro corregido: ${fmt(data?.valor_revertido || 0)} dejaron de contar. El servicio quedó en ${data?.estado_pago}.`)
      const { data: frescos } = await db.from('recibos_tecnico')
        .select('id, numero_recibo, tipo, fecha_emision, hora_emision, valor_total, valor_cobrado, medios_pago, datos_form, created_at, personal:tecnico_id(nombre, apellido)')
        .eq('servicio_id', servicioId).order('created_at', { ascending: false })
      setRecibos(frescos || [])
      onCambio?.()
    } catch (e) {
      setCorrError(parsearErrorDB(e))
    } finally { setCorrSaving(false) }
  }

  if (recibos === null) return (
    <div className="bg-gray-50 rounded-xl p-3 text-[11px] text-gray-400">Cargando recibos…</div>
  )
  if (recibos.length === 0) return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-1">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><FileText size={10} /> Recibos</div>
      <div className="text-[11px] text-gray-400">Aún no se ha generado ningún recibo para este servicio.</div>
    </div>
  )

  // El recibo que cuenta: CLIENTE más reciente con dinero, o el más reciente
  const clientes = recibos.filter(r => r.tipo === 'CLIENTE')
  const realId   = (clientes.find(r => (r.valor_cobrado || 0) > 0) || clientes[0])?.id || null

  const ESTADO_COMP = {
    APROBADO:           { label: 'Aprobado',   bg: '#DCFCE7', color: '#166534' },
    RECHAZADO:          { label: 'Rechazado',  bg: '#FEE2E2', color: '#991B1B' },
    PENDIENTE_REVISION: { label: 'En revisión', bg: '#FEF3C7', color: '#92400E' },
  }

  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        <FileText size={10} /> Recibos guardados ({recibos.length})
      </div>
      {recibos.map(r => {
        const esReal    = r.id === realId
        const esVet     = r.tipo === 'VETERINARIA'
        const pagoPend  = String(r.datos_form?.pago_pendiente) === 'true'
        const medios    = (Array.isArray(r.medios_pago) ? r.medios_pago : []).filter(mp => Number(mp.monto) > 0)
        const tecNombre = r.personal ? `${r.personal.nombre || ''} ${r.personal.apellido || ''}`.trim() : ''
        const pdfName   = pdfDeRecibo(r)
        return (
          <div key={r.id} className="rounded-lg border bg-white px-3 py-2.5 space-y-1.5"
            style={{ borderColor: esReal ? '#86EFAC' : '#E5E7EB' }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-bold text-gray-900 inline-flex items-center gap-2">
                No. {r.numero_recibo}{esVet ? '-VET' : ''}
                {pdfName ? (
                  <button onClick={() => abrirPdf(pdfName)}
                    className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full transition-opacity hover:opacity-80"
                    style={{ background: '#0B1D4F', color: '#fff' }}
                    title="Abrir el PDF del recibo tal como se envió">
                    <FileText size={9} /> Ver PDF
                  </button>
                ) : (
                  <span className="text-[9px] font-semibold text-gray-300"
                    title="El PDF se genera cuando el técnico envía el recibo por WhatsApp desde su app">
                    Sin PDF
                  </span>
                )}
              </span>
              {esReal ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#166534' }}>
                  ✓ Valor real · afecta Finanzas
                </span>
              ) : esVet ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#DBEAFE', color: '#1E40AF' }}
                  title="Documento para la veterinaria del mismo cobro — no suma otra vez">
                  Informativo · doc. veterinaria
                </span>
              ) : (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                  title="Recibo regenerado después — esta versión no suma en Finanzas">
                  Versión anterior · no suma
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="font-bold" style={{ color: esReal ? '#15803D' : '#6B7280' }}>
                Cobrado: {fmt(r.valor_cobrado || 0)}
              </span>
              {r.valor_total != null && <span className="text-gray-400">Valor recibo: {fmt(r.valor_total)}</span>}
              {pagoPend && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  Generado sin cobro (pago pendiente)
                </span>
              )}
              {r.datos_form?.sobrepago_motivo && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full max-w-full truncate" style={{ background: '#FFEDD5', color: '#9A3412' }}
                  title={`Cobró más que el valor del recibo. Motivo: ${r.datos_form.sobrepago_motivo}`}>
                  +{fmt(Number(r.datos_form.sobrepago_valor) || Math.max(0, (r.valor_cobrado || 0) - (r.valor_total || 0)))} de más · {r.datos_form.sobrepago_motivo}
                </span>
              )}
            </div>
            {medios.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {medios.map((mp, i) => (
                  <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
                    {String(mp.metodo || '').toUpperCase()} · {fmt(Number(mp.monto) || 0)}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] text-gray-400">
                {r.fecha_emision ? parseDate(r.fecha_emision)?.toLocaleDateString('es-CO') : '—'}
                {r.hora_emision ? ` · ${String(r.hora_emision).slice(0, 5)}` : ''}
                {tecNombre ? ` · ${tecNombre}` : ''}
              </div>
              {/* Solo tiene sentido donde hay dinero registrado */}
              {puedeCorregir && (r.valor_cobrado || 0) > 0 && corrigiendo !== r.id && (
                <button onClick={() => { setCorrigiendo(r.id); setMotivo(''); setCorrError(''); setCorrOk('') }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-colors hover:bg-red-100"
                  style={{ background: '#FEE2E2', color: '#991B1B' }}
                  title="El técnico marcó este cobro por error y no recibió el dinero">
                  <RotateCcw size={10} /> No se cobró — corregir
                </button>
              )}
            </div>

            {corrigiendo === r.id && (
              <div className="rounded-lg p-2.5 space-y-2" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[11px] text-red-800">
                    Se anula el cobro de <b>{fmt(r.valor_cobrado || 0)}</b>: el recibo queda como <b>pago pendiente</b>,
                    el servicio vuelve a quedar por cobrar y el cuadro del técnico deja de cobrárselo.
                    El recibo y la bitácora se conservan.
                  </div>
                  <button onClick={() => { setCorrigiendo(null); setCorrError('') }} className="text-red-300 hover:text-red-500 shrink-0">
                    <X size={13} />
                  </button>
                </div>
                <textarea
                  value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                  placeholder="¿Por qué se corrige? Queda en la bitácora del servicio."
                  className="w-full text-[11px] rounded-lg border border-red-200 px-2 py-1.5 outline-none focus:border-red-400 resize-none"
                />
                {corrError && <div className="text-[10px] text-red-600 flex items-center gap-1"><AlertCircle size={10} /> {corrError}</div>}
                <button onClick={() => corregirCobro(r)} disabled={corrSaving || !motivo.trim()}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                  style={{ background: '#B91C1C' }}>
                  {corrSaving ? 'Corrigiendo…' : 'Confirmar la corrección'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {corrOk && (
        <div className="text-[11px] rounded-lg px-3 py-2" style={{ background: '#DCFCE7', color: '#166534' }}>
          {corrOk}
        </div>
      )}

      {/* PDFs en storage que no calzan con ningún recibo listado (números viejos) */}
      {(() => {
        const huerfanos = pdfFiles.filter(n => !recibos.some(r => n.startsWith(`${r.numero_recibo}_`)))
        if (!huerfanos.length) return null
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-400">Otros PDF:</span>
            {huerfanos.map(n => (
              <button key={n} onClick={() => abrirPdf(n)}
                className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                title={n}>
                <FileText size={9} /> {n.replace(/_\d+\.pdf$/i, '')}
              </button>
            ))}
          </div>
        )
      })()}

      {/* Comprobantes de pago (firma URLs solo al abrir) */}
      <button onClick={toggleComprobantes}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-white text-left transition-colors hover:bg-blue-50"
        style={{ borderColor: '#BFDBFE' }}>
        <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: '#1E40AF' }}>
          <Camera size={12} /> Comprobantes de pago{comps !== null ? ` (${comps.length})` : ''}
        </span>
        {compsOpen ? <ChevronUp size={13} style={{ color: '#1E40AF' }} /> : <ChevronDown size={13} style={{ color: '#1E40AF' }} />}
      </button>
      {compsOpen && (
        <div className="space-y-2">
          {compsLoading ? (
            <div className="text-[11px] text-gray-400 px-1 py-2">Cargando comprobantes…</div>
          ) : compsError ? (
            <div className="text-[11px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{compsError}</div>
          ) : !comps?.length ? (
            <div className="text-[11px] text-gray-400 px-1 py-2">No hay comprobantes subidos para este servicio.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {comps.map(c => {
                const esPdf = (c.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf($|\?)/i.test(c.storage_path || '')
                const est = ESTADO_COMP[c.estado]
                return (
                  <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer"
                    className="group relative rounded-lg overflow-hidden bg-blue-50 border block"
                    style={{ aspectRatio: '1/1', borderColor: '#BFDBFE' }}
                    title={c.estado ? `Comprobante · ${c.estado}` : 'Comprobante'}>
                    {esPdf ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[10px] font-bold" style={{ color: '#1E40AF' }}>
                        <FileText size={20} /> PDF
                      </div>
                    ) : (
                      <img src={c.url} alt="Comprobante" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    )}
                    {est && (
                      <span className="absolute top-1 left-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: est.bg, color: est.color }}>
                        {est.label}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          )}
          {/* El pago pudo registrarse sin comprobante: esta es la ruta para adjuntarlo despues */}
          {puedeSubir && !compsLoading && (
            <>
              <label
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11px] font-bold transition-colors ${subiendo ? 'cursor-wait bg-gray-100 text-gray-400' : 'cursor-pointer bg-white hover:bg-blue-50'}`}
                style={{ borderColor: '#BFDBFE', color: subiendo ? undefined : '#1E40AF' }}
                title="Subir el comprobante de un pago ya registrado">
                <Paperclip size={12} /> {subiendo ? 'Subiendo comprobante…' : 'Adjuntar comprobante'}
                <input type="file" accept="image/*,application/pdf" disabled={subiendo} className="sr-only"
                  onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await subirComprobante(f) }} />
              </label>
              {subirError
                ? <div className="flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[10px] text-red-700"><AlertCircle size={11} className="mt-0.5 shrink-0" /> {subirError}</div>
                : <p className="text-[9px] text-gray-400 text-center">Imagen o PDF · máximo 8 MB.</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
