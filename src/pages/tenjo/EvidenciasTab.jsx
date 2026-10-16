// Tenjo → Evidencias (migración 178).
//
// Las fotos del cubículo que sube el operario al iniciar el compostaje, ya
// enmarcadas, esperando que coordinación las revise y se las mande a la
// familia. Regla de David: nada sale sin revisión.
//
// El editor funciona como el encuadre del memorial: se acerca y mueve cada
// foto, se cambia la frase y el formato, y la vista previa es la imagen REAL
// que dibuja el backend — la misma que recibe la familia, no una imitación.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { db } from '@/lib/supabase'
import { parsearErrorDB } from '@/lib/utils'
import {
  ESTADO_EVIDENCIA, listarEvidencias, imagenEvidencia, guardarAjustesEvidencia,
  enviarEvidencia, marcarEvidenciaManual, descartarEvidencia,
} from '@/lib/evidenciaInicio'
import { Loader2, Send, Download, CheckCircle, Trash2, RefreshCw, ImageIcon, AlertCircle } from 'lucide-react'

const FILTROS = [
  ['PENDIENTES', 'Por enviar'],
  ['ENVIADO', 'Enviadas'],
  ['DESCARTADA', 'Descartadas'],
]

const fmtFecha = v => v
  ? new Date(v).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })
  : '—'

export default function EvidenciasTab({ onChanged }) {
  const [filtro, setFiltro]   = useState('PENDIENTES')
  const [datos, setDatos]     = useState(null)
  const [error, setError]     = useState('')
  const [abierta, setAbierta] = useState(null)

  const cargar = useCallback(async () => {
    setError('')
    try { setDatos(await listarEvidencias(filtro)) }
    catch (e) {
      setDatos({ evidencias: [] })
      setError(/evidencias_familia|does not exist/i.test(e?.message || '')
        ? 'Falta aplicar la migración 178 en la base de datos.'
        : (e?.message || 'No se pudo cargar'))
    }
  }, [filtro])

  useEffect(() => { cargar() }, [cargar])

  const lista = datos?.evidencias || []
  const sinPlantilla = datos && !datos.plantilla

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-ink">Evidencias del inicio del compostaje</h3>
          <p className="text-[12px] text-ink3">
            Compets con evidencia. Revisa el marco, ajústalo si hace falta y envíalo a la familia — no sale solo.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {FILTROS.map(([k, label]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                filtro === k ? 'bg-primary text-white border-primary' : 'bg-white text-ink2 border-gray-200 hover:bg-surface2'}`}>
              {label}
            </button>
          ))}
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-surface2 text-ink3" aria-label="Actualizar">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {sinPlantilla && (
        <div className="px-3 py-2.5 rounded-lg flex items-start gap-2 text-[12px]"
          style={{ background: '#FFF3DC', border: '1px solid #FFD980', color: '#9A5500' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Todavía no hay plantilla de WhatsApp aprobada. Mientras tanto puedes <strong>descargar el marco</strong>,
            mandarlo desde la bandeja y marcarlo como enviado. Configúrala abajo cuando Meta la apruebe.
          </span>
        </div>
      )}
      {error && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px]">{error}</div>}

      {!datos ? (
        <div className="text-center py-10 text-ink3"><Loader2 className="animate-spin inline" size={18} /></div>
      ) : !lista.length ? (
        <div className="text-center py-10 text-[13px] text-ink3">
          {filtro === 'PENDIENTES' ? 'No hay evidencias por enviar.' : 'Nada por aquí.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {lista.map(e => {
            const st = ESTADO_EVIDENCIA[e.estado] || {}
            const fotos = (e.fotos || []).filter(f => f.incluir !== false)
            return (
              <button key={e.id} onClick={() => setAbierta(e)}
                className="text-left rounded-xl border bg-white hover:shadow-md transition-shadow overflow-hidden"
                style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
                <div className="flex h-28 bg-surface2">
                  {fotos.slice(0, 2).map(f => (
                    <img key={f.clave} src={f.url} alt={f.label} loading="lazy" className="flex-1 min-w-0 object-cover" />
                  ))}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink truncate">{e.mascota}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: st.bg, color: st.color }}>{st.label || e.estado}</span>
                  </div>
                  <div className="text-[11px] text-ink3 truncate">{e.propietario} · {e.whatsapp || 'sin WhatsApp'}</div>
                  <div className="text-[11px] text-ink3">
                    Inició {fmtFecha(e.fecha_inicio)}{e.cubiculo ? ` · ${e.cubiculo}` : ''}
                    {e.estado === 'ENVIADO' && ` · ${e.medio_envio === 'MANUAL' ? 'a mano' : 'por WhatsApp'} ${fmtFecha(e.fecha_envio)}`}
                  </div>
                  {e.error && <div className="text-[11px] text-red-600 mt-1 line-clamp-2">{e.error}</div>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <ConfigPlantilla onGuardado={cargar} />

      {abierta && (
        <EditorEvidencia evidencia={abierta} hayPlantilla={!!datos?.plantilla}
          onClose={() => setAbierta(null)}
          onListo={() => { setAbierta(null); cargar(); onChanged?.() }} />
      )}
    </div>
  )
}

// ─── Editor del marco ────────────────────────────────────────────────────────
function EditorEvidencia({ evidencia, hayPlantilla, onClose, onListo }) {
  const { confirm, alert: showAlert } = useConfirm()
  const editable = ['POR_REVISAR', 'ERROR'].includes(evidencia.estado)
  const [fotos, setFotos]     = useState(() => (evidencia.fotos || []).map(f => ({ ...f })))
  const [frase, setFrase]     = useState(evidencia.frase || 'Siempre en nuestro recuerdo')
  const [formato, setFormato] = useState(evidencia.formato || 'horizontal')
  const [vista, setVista]     = useState(null)   // object URL
  const [cargando, setCargando] = useState(true)
  const [errVista, setErrVista] = useState('')
  const [ocupado, setOcupado] = useState('')
  const urlRef = useRef(null)
  const pedido = useRef(0)

  const ajustes = { fotos, frase, formato }
  const algunaFoto = fotos.some(f => f.incluir !== false)

  // La vista previa es la imagen real del backend. Se pide 450 ms después del
  // último cambio: mover un control no debe disparar veinte renders.
  useEffect(() => {
    if (!algunaFoto) { setErrVista('Deja al menos una foto en el marco.'); setCargando(false); return }
    setCargando(true)
    const n = ++pedido.current
    const t = setTimeout(async () => {
      try {
        const blob = await imagenEvidencia(evidencia.id, ajustes)
        if (n !== pedido.current) return
        const url = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setVista(url); setErrVista('')
      } catch (e) {
        if (n === pedido.current) setErrVista(e?.message || 'No se pudo dibujar el marco')
      } finally {
        if (n === pedido.current) setCargando(false)
      }
    }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ajustes)])

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  const setFoto = (clave, patch) => setFotos(p => p.map(f => f.clave === clave ? { ...f, ...patch } : f))

  async function accion(nombre, fn) {
    setOcupado(nombre)
    try { await fn() }
    catch (e) { await showAlert(e?.message || parsearErrorDB(e), { title: 'No se pudo', variant: 'danger' }) }
    finally { setOcupado('') }
  }

  const descargar = () => accion('descargar', async () => {
    if (editable) await guardarAjustesEvidencia(evidencia.id, ajustes)
    const blob = await imagenEvidencia(evidencia.id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Evidencia ${evidencia.mascota || ''}.jpg`.trim()
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  })

  const enviar = () => accion('enviar', async () => {
    if (!await confirm(
      `Se enviará este marco por WhatsApp a ${evidencia.propietario || 'la familia'} (${evidencia.whatsapp || 'sin número'}).`,
      { title: `¿Enviar la evidencia de ${evidencia.mascota}?`, variant: 'info', confirmLabel: 'Enviar' })) return
    await enviarEvidencia(evidencia.id, ajustes)
    onListo()
  })

  const manual = () => accion('manual', async () => {
    if (!await confirm('Úsalo si ya se la mandaste a la familia por tu cuenta (por ejemplo, desde la bandeja).',
      { title: '¿Marcar como enviada a mano?', variant: 'warning', confirmLabel: 'Sí, ya se envió' })) return
    if (editable) await guardarAjustesEvidencia(evidencia.id, ajustes)
    await marcarEvidenciaManual(evidencia.id)
    onListo()
  })

  const descartar = () => accion('descartar', async () => {
    if (!await confirm('No se le enviará nada a la familia.', { title: '¿Descartar esta evidencia?', variant: 'danger', confirmLabel: 'Descartar' })) return
    await descartarEvidencia(evidencia.id)
    onListo()
  })

  return (
    <Modal open onClose={onClose} maxWidth="max-w-5xl"
      title={`Evidencia de ${evidencia.mascota} — ${evidencia.propietario || ''}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <div className="flex gap-2">
            {editable && (
              <Button variant="ghost" onClick={descartar} disabled={!!ocupado}>
                <Trash2 size={14} className="mr-1" /> Descartar
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={descargar} disabled={!!ocupado || !algunaFoto}>
              {ocupado === 'descargar' ? <Loader2 size={14} className="animate-spin mr-1" /> : <Download size={14} className="mr-1" />}
              Descargar
            </Button>
            {editable && (
              <Button variant="secondary" onClick={manual} disabled={!!ocupado || !algunaFoto}>
                <CheckCircle size={14} className="mr-1" /> Ya la envié a mano
              </Button>
            )}
            {editable && (
              <Button onClick={enviar} disabled={!!ocupado || !algunaFoto || !hayPlantilla}
                title={hayPlantilla ? '' : 'Falta la plantilla aprobada en Meta'}>
                {ocupado === 'enviar' ? <Loader2 size={14} className="animate-spin mr-1" /> : <Send size={14} className="mr-1" />}
                Enviar por WhatsApp
              </Button>
            )}
          </div>
        </div>
      }>
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        {/* Vista previa real */}
        <div className="relative rounded-xl overflow-hidden bg-surface2 flex items-center justify-center"
          style={{ aspectRatio: formato === 'vertical' ? '1080/1350' : '1350/1080' }}>
          {vista && <img src={vista} alt="Vista previa del marco" className="w-full h-full object-contain" />}
          {!vista && !errVista && <ImageIcon className="text-ink3" size={28} />}
          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40">
              <Loader2 className="animate-spin text-ink2" size={22} />
            </div>
          )}
          {errVista && !cargando && (
            <div className="absolute bottom-2 left-2 right-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[12px]">{errVista}</div>
          )}
        </div>

        {/* Controles */}
        <div className="space-y-4">
          {!editable && (
            <div className="px-3 py-2 rounded-lg bg-surface2 text-[12px] text-ink2">
              {evidencia.estado === 'ENVIADO' ? 'Ya se envió: aquí solo se ve y se descarga.' : 'Está descartada.'}
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Frase</label>
            <Input value={frase} maxLength={60} disabled={!editable}
              onChange={e => setFrase(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Formato</label>
            <div className="flex gap-2">
              {[['horizontal', 'Horizontal'], ['vertical', 'Vertical']].map(([k, l]) => (
                <button key={k} disabled={!editable} onClick={() => setFormato(k)}
                  className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold border ${
                    formato === k ? 'bg-primary text-white border-primary' : 'bg-white text-ink2 border-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {fotos.map(f => (
            <div key={f.clave} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'rgba(30,80,40,0.12)' }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={f.incluir !== false} disabled={!editable}
                  onChange={e => setFoto(f.clave, { incluir: e.target.checked })} className="w-4 h-4 accent-[#3D5A27]" />
                <img src={f.url} alt="" className="w-10 h-10 rounded object-cover" />
                <span className="text-[13px] font-semibold text-ink">{f.label}</span>
              </label>
              {f.incluir !== false && editable && (
                <>
                  {[
                    ['Acercar / alejar', 'zoom', 1, 3, 0.05],
                    ['Posición horizontal', 'posX', 0, 100, 1],
                    ['Posición vertical', 'posY', 0, 100, 1],
                  ].map(([label, k, min, max, step]) => (
                    <div key={k}>
                      <div className="flex justify-between text-[11px] font-medium text-gray-600">
                        <span>{label}</span>
                        <span className="text-gray-400">{k === 'zoom' ? `${Number(f[k] ?? 1).toFixed(2)}×` : `${Math.round(f[k] ?? 50)}%`}</span>
                      </div>
                      <input type="range" min={min} max={max} step={step} value={f[k] ?? (k === 'zoom' ? 1 : 50)}
                        onChange={e => setFoto(f.clave, { [k]: parseFloat(e.target.value) })}
                        className="w-full accent-[#3D5A27]" />
                    </div>
                  ))}
                  <button onClick={() => setFoto(f.clave, { zoom: 1, posX: 50, posY: 50 })}
                    className="text-[11px] text-gray-400 hover:text-gray-600 underline">Restablecer encuadre</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Plantilla de Meta ───────────────────────────────────────────────────────
// Debe tener cabecera de IMAGEN. Cuerpo con {{1}} nombre de quien recibe y
// {{2}} nombre de la mascota.
function ConfigPlantilla({ onGuardado }) {
  const [nombre, setNombre] = useState('')
  const [idioma, setIdioma] = useState('es_MX')
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    db.from('config_operativa').select('valor').eq('modulo', 'EVIDENCIA_INICIO').eq('clave', 'plantilla').maybeSingle()
      .then(({ data }) => {
        const p = data?.valor && typeof data.valor === 'object' ? data.valor : null
        setNombre(p?.nombre || ''); setIdioma(p?.idioma || 'es_MX')
      })
  }, [])

  async function guardar() {
    setErr(''); setOk(false)
    const valor = nombre.trim() ? { nombre: nombre.trim(), idioma, categoria: 'UTILITY', vars: ['nombre', 'mascota'] } : null
    const { error } = await db.from('config_operativa')
      .upsert({ modulo: 'EVIDENCIA_INICIO', clave: 'plantilla', valor }, { onConflict: 'modulo,clave' })
    if (error) { setErr(parsearErrorDB(error)); return }
    setOk(true); setTimeout(() => setOk(false), 2500); onGuardado?.()
  }

  return (
    <div className="pt-4 border-t" style={{ borderColor: '#E5E7EB' }}>
      <div className="text-[12px] font-bold text-ink mb-1">Plantilla de WhatsApp</div>
      <p className="text-[11px] text-ink3 mb-2">
        Con cabecera de <strong>imagen</strong> y dos variables en el cuerpo: <strong>{'{{1}}'}</strong> nombre de quien
        recibe, <strong>{'{{2}}'}</strong> nombre de la mascota.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="evidencia_inicio_compostaje" />
        <Input className="w-24" value={idioma} onChange={e => setIdioma(e.target.value)} />
        <Button size="sm" onClick={guardar}>Guardar</Button>
        {ok && <span className="text-[12px] font-semibold text-green-700 flex items-center gap-1"><CheckCircle size={13} /> Guardado</span>}
        {err && <span className="text-[12px] text-red-600">{err}</span>}
      </div>
    </div>
  )
}
