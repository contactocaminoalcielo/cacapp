import { useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { fmt, parseDate, parsearErrorDB } from '@/lib/utils'
import { cargarComprobantesServicio } from '@/lib/comprobantes'
import { FileText, Camera, ChevronUp, ChevronDown } from 'lucide-react'

// ── Recibos guardados del servicio ────────────────────────────────────────────
// Muestra los recibos del técnico y distingue cuál lleva el valor real que
// suma en Finanzas: tipo CLIENTE con la regla de migración 027 (si hay varios,
// vale el más reciente CON dinero; si ninguno cobró, el más reciente). El
// recibo VETERINARIA es el documento informativo del mismo cobro para la vet,
// y los CLIENTE viejos son versiones regeneradas que no suman.
// Usado en el modal del Kanban y en la ficha del Historial (Gestión).
export default function RecibosServicio({ servicioId }) {
  const [recibos, setRecibos]           = useState(null)   // null = cargando
  const [pdfFiles, setPdfFiles]         = useState([])     // PDFs del recibo en storage
  const [comps, setComps]               = useState(null)   // null = aún no cargados (lazy)
  const [compsOpen, setCompsOpen]       = useState(false)
  const [compsLoading, setCompsLoading] = useState(false)
  const [compsError, setCompsError]     = useState('')

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
            <div className="text-[10px] text-gray-400">
              {r.fecha_emision ? parseDate(r.fecha_emision)?.toLocaleDateString('es-CO') : '—'}
              {r.hora_emision ? ` · ${String(r.hora_emision).slice(0, 5)}` : ''}
              {tecNombre ? ` · ${tecNombre}` : ''}
            </div>
          </div>
        )
      })}

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
        compsLoading ? (
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
        )
      )}
    </div>
  )
}
