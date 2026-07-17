// Visor de las fotos que mandó el cliente + reemplazo por una de mejor calidad.
// Compartido por Producción (modal del ítem) y Kanban (modal del servicio) para
// que las dos pantallas muestren exactamente lo mismo y registren igual: si esta
// UI se duplicara, una acabaría contradiciendo a la otra sobre la misma foto.
//
// La original nunca se pierde: queda en produccion_imagen_log y su archivo sigue
// vivo en el bucket. Ver migración 058.
import { useState, useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  subirImagenReemplazo, reemplazarImagen, historialImagenes, MAX_MB_REEMPLAZO,
} from '@/lib/imagenes'
import { fmtDateTime } from '@/lib/utils'
import { ImageUp, History, Loader2, AlertTriangle, ArrowRight } from 'lucide-react'

/** URLs de un recordatorio, normalizadas: el array manda; la singular es respaldo. */
export function urlsDeRecordatorio(sr) {
  if (sr?.imagenes_cliente_urls?.length) return sr.imagenes_cliente_urls
  return sr?.imagen_cliente_url ? [sr.imagen_cliente_url] : []
}

// ── Confirmación del reemplazo ───────────────────────────────────────────────
// Exportado: Kanban ya tiene su propia galería (con descarga individual y masiva)
// y solo necesita este paso, no el visor completo.
export function ModalReemplazarFoto({ ctx, onClose, onHecho }) {
  const { alert: showAlert } = useConfirm()
  const [file,   setFile]   = useState(null)
  const [motivo, setMotivo] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [previo, setPrevio] = useState(null)
  const inputRef = useRef(null)

  // El object URL de la vista previa se libera al cambiar de archivo o cerrar:
  // sin esto el blob queda retenido en memoria mientras viva la pestaña.
  useEffect(() => {
    if (!file) { setPrevio(null); return }
    const url = URL.createObjectURL(file)
    setPrevio(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function confirmar() {
    if (!file || busy) return
    setBusy(true)
    try {
      const url = await subirImagenReemplazo(ctx.servicioId, ctx.srId, file)
      await reemplazarImagen({ srId: ctx.srId, posicion: ctx.posicion, urlNueva: url, motivo })
      onHecho(ctx.posicion, url)
      onClose()
    } catch (e) {
      await showAlert(e.message, { title: 'No se pudo reemplazar' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Cambiar esta foto">
      <div className="space-y-4">
        <div className="rounded-xl p-3 border flex gap-2.5 items-start text-[12px]"
          style={{ background: '#FFF7E6', borderColor: '#FFD980', color: '#7A4A00' }}>
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            La foto del cliente <b>no se borra</b>: queda guardada en el historial y se puede
            recuperar. El cambio queda registrado con tu nombre.
          </span>
        </div>

        {/* Antes → después */}
        <div className="flex items-center gap-3">
          <figure className="flex-1 min-w-0">
            <figcaption className="text-[10px] font-bold uppercase tracking-wide text-ink2 mb-1.5">Actual</figcaption>
            <img src={ctx.urlActual} alt="Foto actual"
              className="w-full h-36 object-cover rounded-lg border border-gray-200 bg-gray-50" />
          </figure>
          <ArrowRight size={18} className="text-gray-300 shrink-0" />
          <figure className="flex-1 min-w-0">
            <figcaption className="text-[10px] font-bold uppercase tracking-wide text-ink2 mb-1.5">Nueva</figcaption>
            {previo
              ? <img src={previo} alt="Foto nueva"
                  className="w-full h-36 object-cover rounded-lg border-2" style={{ borderColor: '#1A5CD8' }} />
              : <div className="w-full h-36 rounded-lg border-2 border-dashed border-gray-200 grid place-items-center text-[11px] text-gray-400">
                  Sin elegir
                </div>}
          </figure>
        </div>

        <div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <Button variant="secondary" className="w-full" disabled={busy}
            onClick={() => inputRef.current?.click()}>
            <ImageUp size={14} className="mr-1.5" />
            {file ? 'Elegir otra foto' : 'Elegir la foto nueva'}
          </Button>
          {file && (
            <p className="text-[11px] text-ink2 mt-1.5 truncate">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
          <p className="text-[11px] text-gray-400 mt-1.5">
            Se sube tal cual, sin comprimir, para no perder calidad. Máximo {MAX_MB_REEMPLAZO} MB.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
            Motivo <span className="font-medium normal-case text-gray-400">(opcional)</span>
          </label>
          <Textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: la foto del cliente salía borrosa; la reenvió por WhatsApp en mejor calidad." />
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!file || busy}>
            {busy ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Cambiando…</> : 'Confirmar cambio'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Historial de reemplazos ──────────────────────────────────────────────────
export function ModalHistorialFotos({ servicioId, onClose }) {
  const [filas,   setFilas]   = useState(null)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    historialImagenes(servicioId).then(setFilas).catch(e => setError(e.message))
  }, [servicioId])

  return (
    <Modal open onClose={onClose} title="Historial de fotos cambiadas">
      {error && <div className="text-danger text-sm">{error}</div>}
      {!filas && !error && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}
      {filas?.length === 0 && (
        <p className="text-sm text-ink2 py-6 text-center">
          Ninguna foto de este servicio se ha cambiado.
        </p>
      )}
      <div className="space-y-3">
        {filas?.map(f => (
          <div key={f.id} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12px] font-bold text-ink">
                {f.recordatorio_nombre || 'Recordatorio'} · foto {f.posicion}
              </span>
              <span className="text-[11px] text-gray-400">{fmtDateTime(f.created_at)}</span>
            </div>
            <div className="flex items-center gap-2.5">
              {f.url_anterior
                ? <a href={f.url_anterior} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                    <span className="block text-[10px] font-bold uppercase text-ink2 mb-1">Original del cliente</span>
                    <img src={f.url_anterior} alt="Original"
                      className="w-full h-24 object-cover rounded-lg border border-gray-200" />
                  </a>
                : <div className="flex-1 text-[11px] text-gray-400">(estaba vacía)</div>}
              <ArrowRight size={14} className="text-gray-300 shrink-0" />
              <a href={f.url_nueva} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                <span className="block text-[10px] font-bold uppercase text-ink2 mb-1">Quedó</span>
                <img src={f.url_nueva} alt="Nueva"
                  className="w-full h-24 object-cover rounded-lg border border-gray-200" />
              </a>
            </div>
            <p className="text-[11px] text-ink2 mt-2">
              Cambiada por <b>{f.cambiado_por_nombre || 'usuario desconocido'}</b>
              {f.motivo && <> — «{f.motivo}»</>}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/**
 * @param {object[]} recordatorios  filas de servicio_recordatorios con las urls
 * @param {string}   servicioId
 * @param {boolean}  puedeCambiar   false → solo lectura
 * @param {function} onCambiada     (srId, posicion, url) → refrescar al padre
 */
export default function FotosDelCliente({ recordatorios, servicioId, puedeCambiar = true, onCambiada }) {
  const [ctx,  setCtx]  = useState(null)   // reemplazo en curso
  const [hist, setHist] = useState(false)

  const conFotos = (recordatorios || [])
    .filter(sr => sr.origen !== 'REMOVIDO' && urlsDeRecordatorio(sr).length)

  if (!conFotos.length) {
    return <p className="text-[12px] text-ink2">El cliente todavía no ha enviado fotos.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-ink2 uppercase tracking-wide">Fotos del cliente</span>
        <button onClick={() => setHist(true)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink2 hover:text-ink transition-colors">
          <History size={12} /> Historial
        </button>
      </div>

      {conFotos.map(sr => {
        const urls = urlsDeRecordatorio(sr)
        return (
          <div key={sr.id}>
            <p className="text-[11px] font-semibold text-ink2 mb-1.5">{sr.recordatorios?.nombre || 'Recordatorio'}</p>
            <div className="flex flex-wrap gap-2">
              {urls.map((url, i) => (
                <figure key={`${url}-${i}`} className="relative group">
                  <a href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`Foto ${i + 1}`}
                      className="w-24 h-24 object-cover rounded-lg border border-gray-200 bg-gray-50" />
                  </a>
                  {puedeCambiar && (
                    <button
                      onClick={() => setCtx({ srId: sr.id, servicioId, posicion: i + 1, urlActual: url })}
                      title="Cambiar por una de mejor calidad"
                      className="absolute inset-x-0 bottom-0 py-1 text-[10px] font-bold text-white rounded-b-lg
                                 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      style={{ background: 'rgba(17,24,39,0.78)' }}>
                      Cambiar
                    </button>
                  )}
                </figure>
              ))}
            </div>
          </div>
        )
      })}

      {ctx && (
        <ModalReemplazarFoto ctx={ctx} onClose={() => setCtx(null)}
          onHecho={(posicion, url) => onCambiada?.(ctx.srId, posicion, url)} />
      )}
      {hist && <ModalHistorialFotos servicioId={servicioId} onClose={() => setHist(false)} />}
    </div>
  )
}
