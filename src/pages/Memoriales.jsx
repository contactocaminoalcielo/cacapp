import { useState, useEffect, useCallback, useRef } from 'react'
import Topbar from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { orbitApi } from '@/lib/orbitApi'
import {
  Film, Sparkles, CheckCircle2, RefreshCw, Download, Instagram,
  Loader2, AlertTriangle, X,
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

  const generar = async (servicioId) => {
    setBusyKey(servicioId, true)
    try {
      await orbitApi('/memoriales/generar', { method: 'POST', body: { servicio_id: servicioId, formato } })
      flash('ok', 'Generando el memorial… tarda unos segundos.')
      setTab('generados')
      await cargar()
    } catch (e) { flash('err', e.message) }
    finally { setBusyKey(servicioId, false) }
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
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
            <Loader2 className="animate-spin" size={18} /> Cargando…
          </div>
        ) : tab === 'candidatos' ? (
          <CandidatosList candidatos={candidatos} busy={busy} onGenerar={generar} />
        ) : (
          <GeneradosList
            memoriales={memoriales} busy={busy} videoUrl={videoUrl}
            instagram={instagram} setInstagram={setInstagram}
            onAprobar={(id) => accion(id, 'aprobar')}
            onDescartar={(id) => accion(id, 'descartar')}
            onRegenerar={(servicioId) => generar(servicioId)}
            onPublicar={publicar}
          />
        )}
      </div>
    </>
  )
}

function CandidatosList({ candidatos, busy, onGenerar }) {
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
            <Button onClick={() => onGenerar(c.servicio_id)} disabled={busy[c.servicio_id]}>
              {busy[c.servicio_id] ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              Generar
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function GeneradosList({ memoriales, busy, videoUrl, instagram, setInstagram, onAprobar, onDescartar, onRegenerar, onPublicar }) {
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
