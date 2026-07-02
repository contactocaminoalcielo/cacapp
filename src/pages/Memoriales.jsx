import { useState, useEffect, useCallback, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { orbitApi } from '@/lib/orbitApi'
import {
  Film, Sparkles, CheckCircle2, RefreshCw, Download, Instagram,
  Loader2, AlertTriangle, X, Crop, Link2,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

const ESTADO = {
  GENERANDO: { label: 'Generando…', variant: 'gray' },
  GENERADO:  { label: 'Generado',   variant: 'blue' },
  APROBADO:  { label: 'Aprobado',   variant: 'green' },
  PUBLICADO: { label: 'Publicado',  variant: 'green' },
  ERROR:     { label: 'Error',      variant: 'red' },
  DESCARTADO:{ label: 'Descartado', variant: 'gray' },
}

export default function Memoriales() {
  const [tab, setTab] = useState('generados')
  const [formato, setFormato] = useState('1080x1350')
  const [candidatos, setCandidatos] = useState([])
  const [memoriales, setMemoriales] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({})           // id/servicio → true mientras hace una acción
  const [msg, setMsg] = useState(null)            // {tipo:'ok'|'err', texto}
  const [instagram, setInstagram] = useState({})  // memorialId → url en edición
  const [encuadre, setEncuadre] = useState(null)  // {servicioId, fotoUrl, mascota, ajuste} → modal
  const pollRef = useRef(null)

  const flash = (tipo, texto) => { setMsg({ tipo, texto }); setTimeout(() => setMsg(null), 4000) }

  const cargar = useCallback(async () => {
    try {
      const [cand, mem] = await Promise.all([
        orbitApi('/memoriales/candidatos'),
        orbitApi('/memoriales'),
      ])
      setCandidatos(cand || [])
      setMemoriales(mem || [])
    } catch (e) {
      flash('err', e.message || 'No se pudo cargar')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Poll mientras haya alguno generando
  useEffect(() => {
    const generando = memoriales.some(m => m.estado === 'GENERANDO')
    clearInterval(pollRef.current)
    if (generando) pollRef.current = setInterval(cargar, 4000)
    return () => clearInterval(pollRef.current)
  }, [memoriales, cargar])

  const setBusyKey = (k, v) => setBusy(b => ({ ...b, [k]: v }))

  const generar = async (servicioId, ajuste) => {
    setBusyKey(servicioId, true)
    try {
      await orbitApi('/memoriales/generar', { method: 'POST', body: { servicio_id: servicioId, formato, ajuste } })
      flash('ok', 'Generando el memorial… tarda unos segundos.')
      setEncuadre(null)
      setTab('generados')
      await cargar()
    } catch (e) { flash('err', e.message) }
    finally { setBusyKey(servicioId, false) }
  }

  const copiarEnlaces = async () => {
    const pub = memoriales.filter(m => m.estado === 'PUBLICADO' && m.instagram_url)
    if (!pub.length) return flash('err', 'No hay memoriales publicados con enlace.')
    const texto = pub.map(m => `${m.mascota_nombre}: ${m.instagram_url}`).join('\n')
    try {
      await navigator.clipboard.writeText(texto)
      flash('ok', `${pub.length} enlace${pub.length > 1 ? 's' : ''} copiado${pub.length > 1 ? 's' : ''} al portapapeles.`)
    } catch { flash('err', 'No se pudo copiar al portapapeles.') }
  }

  const accion = async (id, path, body) => {
    setBusyKey(id, true)
    try {
      await orbitApi(`/memoriales/${id}/${path}`, { method: 'POST', body })
      await cargar()
    } catch (e) { flash('err', e.message) }
    finally { setBusyKey(id, false) }
  }

  const publicar = async (id) => {
    const url = (instagram[id] || '').trim()
    if (!/^https?:\/\//i.test(url)) return flash('err', 'Pega un enlace de Instagram válido (https://…)')
    await accion(id, 'publicar', { instagram_url: url })
    flash('ok', 'Publicación registrada.')
  }

  const videoUrl = (m) => m.archivo_url ? `${API_BASE}${m.archivo_url}` : null

  return (
    <>
      <Topbar />

      <div className="p-4 sm:p-6 max-w-6xl mx-auto w-full">
        {msg && (
          <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
            msg.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {msg.tipo === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {msg.texto}
          </div>
        )}

        {/* Tabs + selector de formato */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {[['generados', `Generados (${memoriales.length})`], ['candidatos', `Por generar (${candidatos.length})`]].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                  tab === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-400 font-medium">Formato al generar:</span>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {[['1080x1350', 'Feed 4:5'], ['1080x1920', 'Reels 9:16']].map(([k, label]) => (
                <button key={k} onClick={() => setFormato(k)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition ${
                    formato === k ? 'bg-white text-[#263218] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'generados' && (
              <Button variant="secondary" size="sm" onClick={copiarEnlaces}>
                <Link2 size={14} /> Copiar enlaces
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
            <Loader2 className="animate-spin" size={18} /> Cargando…
          </div>
        ) : tab === 'candidatos' ? (
          <CandidatosList candidatos={candidatos} busy={busy} onGenerar={generar}
            onEncuadrar={(c) => setEncuadre({ servicioId: c.servicio_id, fotoUrl: c.foto_url, mascota: c.mascota, ajuste: null })} />
        ) : (
          <GeneradosList
            memoriales={memoriales} busy={busy} videoUrl={videoUrl}
            instagram={instagram} setInstagram={setInstagram}
            onAprobar={(id) => accion(id, 'aprobar')}
            onDescartar={(id) => accion(id, 'descartar')}
            onRegenerar={(servicioId) => generar(servicioId)}
            onEncuadrar={(m) => setEncuadre({ servicioId: m.servicio_id, fotoUrl: m.foto_url, mascota: m.mascota_nombre, ajuste: m.ajuste_foto })}
            onPublicar={publicar}
          />
        )}
      </div>

      <EncuadreModal
        data={encuadre}
        busy={encuadre ? busy[encuadre.servicioId] : false}
        onClose={() => setEncuadre(null)}
        onGenerar={(ajuste) => generar(encuadre.servicioId, ajuste)}
      />
    </>
  )
}

// ── Modal de encuadre: vista previa del arco + zoom y posición de la foto ──
function EncuadreModal({ data, busy, onClose, onGenerar }) {
  const [zoom, setZoom] = useState(1)
  const [posX, setPosX] = useState(50)
  const [posY, setPosY] = useState(50)

  useEffect(() => {
    if (data) {
      setZoom(data.ajuste?.zoom || 1)
      setPosX(data.ajuste?.posX ?? 50)
      setPosY(data.ajuste?.posY ?? 50)
    }
  }, [data])

  if (!data) return null
  const sinFoto = !data.fotoUrl

  return (
    <Modal open={!!data} onClose={onClose} title={`Encuadrar foto — ${data.mascota || ''}`} maxWidth="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onGenerar({ zoom, posX, posY })} disabled={busy || sinFoto}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            Generar con este encuadre
          </Button>
        </>
      }>
      {sinFoto ? (
        <div className="text-sm text-gray-500 py-6 text-center">Este servicio no tiene foto disponible.</div>
      ) : (
        <div className="space-y-4">
          {/* Vista previa con la misma máscara de arco del video */}
          <div className="flex justify-center">
            <div className="p-[4px] rounded-[148px_148px_25px_25px]"
              style={{ background: 'linear-gradient(160deg,#D8C39B,#C4A87A 55%,#A98B58)' }}>
              <div className="w-[262px] h-[293px] overflow-hidden bg-[#22331f]"
                style={{ borderRadius: '145px 145px 21px 21px' }}>
                <img
                  src={data.fotoUrl} alt=""
                  className="w-full h-full"
                  style={{
                    objectFit: 'cover',
                    objectPosition: `${posX}% ${posY}%`,
                    transform: `scale(${1.1 * zoom})`,
                    transformOrigin: `${posX}% ${posY}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-center -mt-1">
            Vista aproximada — en el video la foto hace un zoom suave adicional.
          </p>

          {[
            ['Acercar / alejar', zoom, setZoom, 1, 2.5, 0.05],
            ['Posición horizontal', posX, setPosX, 0, 100, 1],
            ['Posición vertical', posY, setPosY, 0, 100, 1],
          ].map(([label, val, setter, min, max, step]) => (
            <div key={label}>
              <div className="flex justify-between text-[12px] font-medium text-gray-600 mb-1">
                <span>{label}</span>
                <span className="text-gray-400">{label.startsWith('Acercar') ? `${val.toFixed(2)}×` : `${Math.round(val)}%`}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={e => setter(parseFloat(e.target.value))}
                className="w-full accent-[#3D5A27]" />
            </div>
          ))}

          <button onClick={() => { setZoom(1); setPosX(50); setPosY(50) }}
            className="text-[12px] text-gray-400 hover:text-gray-600 underline">
            Restablecer encuadre
          </button>
        </div>
      )}
    </Modal>
  )
}

function CandidatosList({ candidatos, busy, onGenerar, onEncuadrar }) {
  if (!candidatos.length) return <Empty icon={Sparkles} texto="No hay servicios pendientes de memorial." />
  return (
    <div className="grid gap-3">
      {candidatos.map(c => (
        <Card key={c.servicio_id}>
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold text-[#263218] truncate">
                🐾 {c.mascota}
              </div>
              <div className="text-[13px] text-gray-500 truncate">
                {c.propietario || 'Sin propietario'} · {c.plan_nombre || c.plan_codigo} · imágenes {c.fecha_imagenes}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" onClick={() => onEncuadrar(c)} disabled={busy[c.servicio_id] || !c.foto_url}>
                <Crop size={16} /> Encuadrar
              </Button>
              <Button onClick={() => onGenerar(c.servicio_id)} disabled={busy[c.servicio_id]}>
                {busy[c.servicio_id] ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Generar
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function GeneradosList({ memoriales, busy, videoUrl, instagram, setInstagram, onAprobar, onDescartar, onRegenerar, onEncuadrar, onPublicar }) {
  if (!memoriales.length) return <Empty icon={Film} texto="Aún no se ha generado ningún memorial." />
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {memoriales.map(m => {
        const est = ESTADO[m.estado] || { label: m.estado, variant: 'gray' }
        const url = videoUrl(m)
        return (
          <Card key={m.id} className="overflow-hidden">
            <div className={`bg-[#0B1D2A] flex items-center justify-center relative ${
              m.formato === '1080x1920' ? 'aspect-[9/16]' : 'aspect-[4/5]'}`}>
              {m.estado === 'GENERANDO' ? (
                <div className="flex flex-col items-center gap-2 text-gray-300 text-sm">
                  <Loader2 className="animate-spin" size={26} /> Generando…
                </div>
              ) : m.estado === 'ERROR' ? (
                <div className="flex flex-col items-center gap-2 text-red-300 text-sm px-6 text-center">
                  <AlertTriangle size={26} /> {m.error || 'Error al generar'}
                </div>
              ) : url ? (
                <video src={url} controls playsInline className="w-full h-full object-contain" />
              ) : (
                <Film size={30} className="text-gray-500" />
              )}
            </div>

            <CardContent className="py-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#263218] truncate">{m.mascota_nombre}</div>
                  <div className="text-[12px] text-gray-400 truncate">{m.fecha_texto} · {m.plan_codigo || ''}</div>
                </div>
                <Badge variant={est.variant}>{est.label}</Badge>
              </div>

              {m.instagram_url && (
                <a href={m.instagram_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-pink-600 font-medium hover:underline">
                  <Instagram size={14} /> Ver publicación
                </a>
              )}

              {['GENERADO', 'APROBADO', 'PUBLICADO', 'ERROR'].includes(m.estado) && (
                <div className="flex flex-wrap gap-2">
                  {url && (
                    <a href={`${url}&dl=1`} download>
                      <Button variant="secondary" size="sm"><Download size={15} /> Descargar</Button>
                    </a>
                  )}
                  {m.estado === 'GENERADO' && (
                    <Button size="sm" onClick={() => onAprobar(m.id)} disabled={busy[m.id]}>
                      <CheckCircle2 size={15} /> Aprobar
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => onEncuadrar(m)} disabled={busy[m.servicio_id] || !m.foto_url}>
                    <Crop size={15} /> Encuadrar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onRegenerar(m.servicio_id)} disabled={busy[m.servicio_id]}>
                    <RefreshCw size={15} /> Regenerar
                  </Button>
                  {m.estado !== 'PUBLICADO' && (
                    <Button variant="ghost" size="sm" onClick={() => onDescartar(m.id)} disabled={busy[m.id]}>
                      <X size={15} /> Descartar
                    </Button>
                  )}
                </div>
              )}

              {['APROBADO', 'PUBLICADO'].includes(m.estado) && (
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Enlace de la publicación de Instagram"
                    value={instagram[m.id] ?? (m.instagram_url || '')}
                    onChange={e => setInstagram(s => ({ ...s, [m.id]: e.target.value }))}
                    className="text-[13px]"
                  />
                  <Button size="sm" onClick={() => onPublicar(m.id)} disabled={busy[m.id]}>
                    <Instagram size={15} /> {m.estado === 'PUBLICADO' ? 'Actualizar' : 'Registrar'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Empty({ icon: Icon, texto }) {
  return (
    <div className="flex flex-col items-center gap-3 text-gray-400 py-20">
      <Icon size={34} strokeWidth={1.5} />
      <span className="text-sm">{texto}</span>
    </div>
  )
}
