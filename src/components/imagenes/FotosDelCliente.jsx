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
  agregarImagen, fotosDelServicio, topeFotos,
} from '@/lib/imagenes'
import { fmtDateTime } from '@/lib/utils'
import { ImageUp, ImagePlus, History, Loader2, AlertTriangle, ArrowRight, Check, X } from 'lucide-react'

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

// ── Foto para un ítem que no la tiene (migración 220) ───────────────────────
// La familia ya subió sus fotos, el portal se cerró y después compró un
// adicional: Diseño le pone la foto aquí. Dos fuentes, combinables:
//   · una foto que la familia YA mandó para otro ítem del servicio (no se sube
//     de nuevo: se reutiliza la misma URL, el archivo nunca se borra);
//   · una foto nueva (la que mandó por WhatsApp), sin comprimir.
// Cada foto entra por la función de DB: queda en el historial con quién y cuándo.
//
// ctx = { srId, servicioId, nombre, actuales: string[], tope }
export function ModalAgregarFoto({ ctx, onClose, onHecho }) {
  const { alert: showAlert } = useConfirm()
  const [existentes, setExistentes] = useState(null)   // null = cargando
  const [elegidas,   setElegidas]   = useState([])     // urls reutilizadas
  const [files,      setFiles]      = useState([])     // fotos nuevas
  const [previos,    setPrevios]    = useState([])
  const [motivo,     setMotivo]     = useState('')
  const [busy,       setBusy]       = useState(false)
  const inputRef = useRef(null)

  const actuales = ctx.actuales || []
  const cupo     = Math.max(0, (ctx.tope || 1) - actuales.length)
  const total    = elegidas.length + files.length
  const lleno    = total >= cupo

  useEffect(() => {
    let vivo = true
    fotosDelServicio(ctx.servicioId)
      .then(fs => { if (vivo) setExistentes(fs.filter(f => !actuales.includes(f.url))) })
      .catch(() => { if (vivo) setExistentes([]) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.servicioId, ctx.srId])

  // Vistas previas de las fotos nuevas; se liberan al cambiar o cerrar.
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPrevios(urls)
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [files])

  function alternar(url) {
    setElegidas(prev => prev.includes(url) ? prev.filter(u => u !== url)
                      : (total < cupo ? [...prev, url] : prev))
  }

  function elegirArchivos(e) {
    const nuevos = Array.from(e.target.files || [])
    e.target.value = ''
    if (!nuevos.length) return
    setFiles(prev => [...prev, ...nuevos].slice(0, Math.max(0, cupo - elegidas.length)))
  }

  async function confirmar() {
    if (!total || busy) return
    setBusy(true)
    let urls = null
    let hechas = 0
    try {
      for (const url of elegidas) {
        urls = (await agregarImagen({ srId: ctx.srId, urlNueva: url, motivo }))?.urls || urls
        hechas++
      }
      for (const f of files) {
        const url = await subirImagenReemplazo(ctx.servicioId, ctx.srId, f, 'diseno')
        urls = (await agregarImagen({ srId: ctx.srId, urlNueva: url, motivo }))?.urls || urls
        hechas++
      }
      onHecho(urls)
      onClose()
    } catch (e) {
      // Las que alcanzaron a entrar ya quedaron guardadas: se reflejan igual.
      if (urls) onHecho(urls)
      await showAlert(
        (hechas ? `Se agregaron ${hechas} de ${total}. ` : '') + e.message,
        { title: 'No se pudo agregar la foto' })
      if (hechas) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Foto para «${(ctx.nombre || 'el recordatorio').trim()}»`}>
      <div className="space-y-4">
        <div className="rounded-xl p-3 border text-[12px]"
          style={{ background: '#F5F3FF', borderColor: '#DDD6FE', color: '#5B21B6' }}>
          {cupo > 0
            ? <>Este ítem lleva <b>{ctx.tope} foto{ctx.tope > 1 ? 's' : ''}</b>
                {actuales.length > 0 && <> y ya tiene {actuales.length}</>}. Puedes usar una que la
                familia ya mandó o subir la que llegó por WhatsApp. Queda registrado con tu nombre.</>
            : <>Este ítem ya tiene todas sus fotos. Para cambiar una, usa «Cambiar» sobre la foto.</>}
        </div>

        {/* 1. Reutilizar una foto del mismo servicio */}
        {cupo > 0 && (
          <div>
            <div className="text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
              Fotos que ya mandó la familia
            </div>
            {existentes === null
              ? <div className="flex items-center gap-2 text-gray-400 text-[12px] py-3">
                  <Loader2 size={14} className="animate-spin" /> Cargando…
                </div>
              : existentes.length === 0
                ? <p className="text-[12px] text-gray-400">Este servicio no tiene otras fotos.</p>
                : <div className="grid grid-cols-4 gap-2">
                    {existentes.map(f => {
                      const sel = elegidas.includes(f.url)
                      const bloqueada = !sel && lleno
                      return (
                        <button key={f.url} type="button" onClick={() => alternar(f.url)} disabled={busy || bloqueada}
                          title={f.nombre}
                          className="relative rounded-lg overflow-hidden bg-gray-50 border-2 transition-all disabled:opacity-40"
                          style={{ aspectRatio: '1/1', borderColor: sel ? '#7C3AED' : 'transparent' }}>
                          <img src={f.url} alt={f.nombre} className="w-full h-full object-cover" />
                          {sel && (
                            <span className="absolute top-1 right-1 w-5 h-5 rounded-full grid place-items-center text-white"
                              style={{ background: '#7C3AED' }}>
                              <Check size={12} />
                            </span>
                          )}
                          <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[8px] font-semibold text-white truncate text-left"
                            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
                            {f.nombre}
                          </span>
                        </button>
                      )
                    })}
                  </div>}
          </div>
        )}

        {/* 2. Subir una foto nueva */}
        {cupo > 0 && (
          <div>
            <div className="text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">O subir una nueva</div>
            {files.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative rounded-lg overflow-hidden border-2"
                    style={{ aspectRatio: '1/1', borderColor: '#1A5CD8' }} title={f.name}>
                    {previos[i] && <img src={previos[i]} alt={f.name} className="w-full h-full object-cover" />}
                    <button type="button" disabled={busy}
                      onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full grid place-items-center bg-white/90 hover:bg-white shadow"
                      title="Quitar">
                      <X size={11} className="text-gray-700" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={elegirArchivos} />
            <Button variant="secondary" className="w-full" disabled={busy || lleno}
              onClick={() => inputRef.current?.click()}>
              <ImagePlus size={14} className="mr-1.5" />
              {files.length ? 'Agregar otra foto' : 'Elegir foto del computador'}
            </Button>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Se sube tal cual, sin comprimir. Máximo {MAX_MB_REEMPLAZO} MB por foto.
            </p>
          </div>
        )}

        {cupo > 0 && (
          <div>
            <label className="block text-xs font-bold text-ink2 mb-1.5 uppercase tracking-wide">
              Nota <span className="font-medium normal-case text-gray-400">(opcional)</span>
            </label>
            <Textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: la familia compró el portarretrato después y mandó la foto por WhatsApp." />
          </div>
        )}

        <div className="flex gap-2 justify-end items-center pt-1">
          {cupo > 0 && (
            <span className="text-[11px] text-ink2 mr-auto">{total} de {cupo} elegida{cupo > 1 ? 's' : ''}</span>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          {cupo > 0 && (
            <Button onClick={confirmar} disabled={!total || busy}>
              {busy ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Guardando…</> : 'Guardar foto'}
            </Button>
          )}
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
    <Modal open onClose={onClose} title="Historial de fotos cambiadas o agregadas">
      {error && <div className="text-danger text-sm">{error}</div>}
      {!filas && !error && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}
      {filas?.length === 0 && (
        <p className="text-sm text-ink2 py-6 text-center">
          Ninguna foto de este servicio se ha cambiado ni agregado desde Orbit.
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
                : <div className="flex-1 text-[11px] text-gray-400">(no tenía foto)</div>}
              <ArrowRight size={14} className="text-gray-300 shrink-0" />
              <a href={f.url_nueva} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                <span className="block text-[10px] font-bold uppercase text-ink2 mb-1">Quedó</span>
                <img src={f.url_nueva} alt="Nueva"
                  className="w-full h-24 object-cover rounded-lg border border-gray-200" />
              </a>
            </div>
            <p className="text-[11px] text-ink2 mt-2">
              {f.url_anterior ? 'Cambiada' : 'Agregada'} por <b>{f.cambiado_por_nombre || 'usuario desconocido'}</b>
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
 * @param {function} onAgregadas    (srId, urls) → refrescar al padre tras agregar (migr. 220)
 */
export default function FotosDelCliente({ recordatorios, servicioId, puedeCambiar = true, onCambiada, onAgregadas }) {
  const [ctx,  setCtx]  = useState(null)   // reemplazo en curso
  const [add,  setAdd]  = useState(null)   // foto agregada en curso
  const [hist, setHist] = useState(false)

  // Un ítem que lleva foto y no completa su cupo también se muestra, para poder
  // ponérsela (el adicional comprado después de cerrar el portal).
  const conFotos = (recordatorios || [])
    .filter(sr => sr.origen !== 'REMOVIDO' && sr.estado !== 'NA')
    .filter(sr => urlsDeRecordatorio(sr).length || (puedeCambiar && onAgregadas && topeFotos(sr) > 0))

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
        const tope = topeFotos(sr)
        const puedeAgregar = puedeCambiar && onAgregadas && tope > urls.length
        return (
          <div key={sr.id}>
            <p className="text-[11px] font-semibold text-ink2 mb-1.5">
              {sr.recordatorios?.nombre || 'Recordatorio'}
              {!urls.length && <span className="ml-1.5 font-bold" style={{ color: '#B45309' }}>· sin foto</span>}
            </p>
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
              {puedeAgregar && (
                <button type="button"
                  onClick={() => setAdd({
                    srId: sr.id, servicioId, nombre: sr.recordatorios?.nombre,
                    actuales: urls, tope,
                  })}
                  title="Ponerle foto a este ítem"
                  className="w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors hover:bg-purple-50"
                  style={{ borderColor: '#C4B5FD', color: '#7C3AED' }}>
                  <ImagePlus size={18} />
                  {urls.length ? 'Agregar' : 'Cargar foto'}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {ctx && (
        <ModalReemplazarFoto ctx={ctx} onClose={() => setCtx(null)}
          onHecho={(posicion, url) => onCambiada?.(ctx.srId, posicion, url)} />
      )}
      {add && (
        <ModalAgregarFoto ctx={add} onClose={() => setAdd(null)}
          onHecho={urls => onAgregadas?.(add.srId, urls)} />
      )}
      {hist && <ModalHistorialFotos servicioId={servicioId} onClose={() => setHist(false)} />}
    </div>
  )
}
