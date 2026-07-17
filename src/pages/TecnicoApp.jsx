import { useState, useEffect, useRef, useCallback, Component } from 'react'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'
import { petEmoji, fmt, waLink, calcularEstadoVet, hoyLocalISO } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { crearNotificacion } from '@/lib/notificaciones'
import {
  Phone, MapPin, Clock, CheckCircle, LogOut, Bell,
  Truck, Package, RefreshCw, CreditCard, Camera, Check,
  AlertCircle, X, Snowflake, Weight, MessageSquare, Send,
  FileText, ChevronDown, ChevronUp, History, Download, Pen,
  Plus, Trash2, Upload as UploadIcon, Receipt, Wallet, Search,
} from 'lucide-react'
import { enviarWhatsApp, LINEAS_WHATSAPP } from '@/lib/whatsapp'
import { stashPut, stashDelete, stashGetByPrefix } from '@/lib/pendingUploads'
import { compressImage } from '@/lib/imageUtils'
import { aplicarRecalculoPorPeso } from '@/lib/precios'
import { registrarIngresoCuartoFrio } from '@/lib/cuartoFrio'

const POLL = 30_000

// ─── ERROR BOUNDARY — evita pantalla en blanco si ReciboForm lanza ─────
class ReciboErrorBoundary extends Component {
  state = { hasError: false, message: '' }
  static getDerivedStateFromError(e) { return { hasError: true, message: e?.message || '' } }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, background: '#FEF2F2', borderRadius: 12, border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
          <strong>Error al mostrar el recibo.</strong> Recarga la página o contacta soporte.
          {this.state.message ? <div style={{ fontSize: 11, marginTop: 4, color: '#DC2626' }}>{this.state.message}</div> : null}
        </div>
      )
    }
    return this.props.children
  }
}

// ─── DIRECCIÓN NAVEGABLE ───────────────────────────────────────────────
function DireccionLink({ direccion, barrio, ciudad }) {
  const [open, setOpen] = useState(false)
  if (!direccion) return null

  const texto = [direccion, barrio, ciudad].filter(Boolean).join(', ')
  const query = encodeURIComponent(texto + ', Colombia')
  const gmUrl   = `https://www.google.com/maps/search/?api=1&query=${query}`
  const wazeUrl = `https://waze.com/ul?q=${query}&navigate=yes`

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-start gap-2 w-full text-left active:opacity-70 transition-opacity">
        <MapPin size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs leading-tight" style={{ color: '#2563EB', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {direccion}{barrio ? `, ${barrio}` : ''}
          {ciudad ? <span className="font-semibold"> · {ciudad}</span> : ''}
        </p>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setOpen(false)}>
          <div className="bg-white rounded-t-3xl px-5 pt-4 pb-10"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <p className="text-xs text-gray-500 mb-1 font-medium">Navegar a</p>
            <p className="text-sm font-semibold text-gray-800 mb-5 leading-tight">{texto}</p>

            <div className="grid grid-cols-2 gap-3">
              <a href={gmUrl} target="_blank" rel="noreferrer"
                onClick={() => setOpen(false)}
                className="flex flex-col items-center gap-2 py-5 rounded-2xl transition-all active:scale-95"
                style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
                <span className="text-3xl">🗺</span>
                <span className="text-sm font-bold" style={{ color: '#1D4ED8' }}>Google Maps</span>
              </a>
              <a href={wazeUrl} target="_blank" rel="noreferrer"
                onClick={() => setOpen(false)}
                className="flex flex-col items-center gap-2 py-5 rounded-2xl transition-all active:scale-95"
                style={{ background: '#F0FDF4', border: '1.5px solid #86EFAC' }}>
                <span className="text-3xl">🚗</span>
                <span className="text-sm font-bold" style={{ color: '#15803D' }}>Waze</span>
              </a>
            </div>

            <button onClick={() => setOpen(false)}
              className="w-full mt-3 py-3 rounded-2xl text-sm font-medium text-gray-500"
              style={{ background: '#F3F4F6' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── SONIDO ────────────────────────────────────────────────────────────
function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[880, 1100, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.15
      gain.gain.setValueAtTime(0.25, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      osc.start(t); osc.stop(t + 0.12)
    })
  } catch {}
}

// ─── PIN SCREEN ────────────────────────────────────────────────────────
function PINScreen({ onAuth }) {
  const [pin, setPin]   = useState('')
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  async function verificar(p) {
    setBusy(true); setErr('')
    try {
      const { data, error } = await db.from('personal')
        .select('id, nombre, apellido, cedula, tipo_vehiculo').eq('activo', true)
      if (error) throw error
      const found = (data || []).find(x =>
        String(x.cedula || '').replace(/\D/g, '').slice(-4).padStart(4, '0') === p
      )
      if (found) onAuth(found)
      else { setErr('PIN incorrecto. Intenta de nuevo.'); setPin('') }
    } catch { setErr('Error de conexión'); setPin('') }
    finally { setBusy(false) }
  }

  function tap(d) {
    if (busy) return
    if (d === '⌫') { setPin(p => p.slice(0, -1)); setErr(''); return }
    if (pin.length >= 4) return
    const next = pin + d; setPin(next); setErr('')
    if (next.length === 4) verificar(next)
  }

  const PAD = ['1','2','3','4','5','6','7','8','9',null,'0','⌫']

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #0B1D4F 0%, #111a0b 100%)' }}>
      <div className="mb-10 text-center select-none">
        <div className="text-5xl mb-3">🐾</div>
        <div className="text-white font-bold text-2xl tracking-tight">Camino al Cielo</div>
        <div className="text-sm font-semibold mt-1 opacity-90" style={{ color: '#C4A87A' }}>Portal del técnico</div>
      </div>
      <div className="bg-white rounded-3xl p-8 w-full max-w-xs shadow-2xl">
        <div className="flex justify-center gap-5 mb-7">
          {[0,1,2,3].map(i => (
            <div key={i} className="transition-all duration-150" style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < pin.length ? '#1A5CD8' : 'transparent',
              border: `2px solid ${i < pin.length ? '#1A5CD8' : '#D1D5DB'}`,
              transform: i < pin.length ? 'scale(1.25)' : 'scale(1)',
            }} />
          ))}
        </div>
        {err  && <p className="text-center text-red-500 text-sm font-medium mb-3">{err}</p>}
        {busy && <p className="text-center text-sm mb-3" style={{ color: '#1A5CD8' }}>Verificando…</p>}
        <div className="grid grid-cols-3 gap-3">
          {PAD.map((d, i) => d === null ? <div key={i} /> : (
            <button key={i} onClick={() => tap(d)} disabled={busy}
              className="select-none transition-all duration-100 active:scale-90 rounded-2xl font-bold"
              style={{ height: 56, background: d === '⌫' ? '#F3F4F6' : '#F9FAFB',
                color: d === '⌫' ? '#6B7280' : '#111827', fontSize: d === '⌫' ? 18 : 22 }}>
              {d}
            </button>
          ))}
        </div>
        <p className="text-center text-[11px] text-gray-400 mt-6 leading-tight">
          Ingresa los últimos 4 dígitos<br />de tu número de cédula
        </p>
      </div>
    </div>
  )
}

// ─── BOTTOM SHEET: CONFIRMAR HORA ──────────────────────────────────────
function ConfirmarHoraSheet({ svc, onConfirm, onClose }) {
  const now = new Date()
  const defaultHora = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const [hora, setHora]     = useState(defaultHora)
  const [saving, setSaving] = useState(false)

  async function confirmar() {
    setSaving(true)
    try { await onConfirm(svc, hora) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="bg-white rounded-t-3xl px-6 pt-4 pb-10 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900">Confirmar hora de llegada</h3>
          <button onClick={onClose} className="p-1 text-gray-400"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          ¿A qué hora llegarás a recoger a <span className="font-semibold text-gray-700">{svc.mascotas?.nombre}</span>?
        </p>
        <div className="flex justify-center mb-6">
          <input type="time" value={hora} onChange={e => setHora(e.target.value)}
            className="text-5xl font-extrabold text-center border-0 outline-none bg-transparent"
            style={{ color: '#1A5CD8', width: 180 }} />
        </div>
        {svc.direccion_recogida && (
          <div className="flex items-center gap-2 mb-6 px-4 py-3 rounded-xl" style={{ background: '#F0FDF4' }}>
            <MapPin size={14} style={{ color: '#1A5CD8', flexShrink: 0 }} />
            <span className="text-sm text-gray-700">{svc.direccion_recogida}{svc.ciudad_recogida ? `, ${svc.ciudad_recogida}` : ''}</span>
          </div>
        )}
        <button onClick={confirmar} disabled={saving}
          className="w-full py-4 rounded-2xl text-base font-bold disabled:opacity-60 transition-all active:scale-98"
          style={{ background: '#1A5CD8', color: '#fff' }}>
          {saving ? 'Iniciando ruta…' : '🚐 Iniciar ruta'}
        </button>
      </div>
    </div>
  )
}

// ─── FOTO EVIDENCIA (reutilizable) ─────────────────────────────────────
// Comprime una imagen antes de subirla (máx 1200px, calidad 0.82)
// Lee ancho/alto sin decodificar la imagen completa (solo parsea cabeceras)


// En red móvil un fetch puede colgarse sin error: sin timeout el spinner
// "Subiendo…" queda infinito y el técnico no sabe si guardó. Al vencerse,
// se muestra error y el archivo sigue en el stash para reintentar.
const SUBIDA_TIMEOUT_MS = 60000
function conTimeout(promise, msg) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), SUBIDA_TIMEOUT_MS)),
  ])
}

// La señal móvil falla y se recupera: reintentamos unas pocas veces con espera
// creciente para que el técnico NO tenga que tocar 3 veces hasta que "quede".
async function conReintentos(fn, intentos = 3) {
  let ultimoErr
  for (let i = 0; i < intentos; i++) {
    try { return await fn() }
    catch (e) {
      ultimoErr = e
      if (i < intentos - 1) await new Promise(r => setTimeout(r, 700 * (i + 1)))
    }
  }
  throw ultimoErr
}

// Detector de reinicio por galería: Android puede matar la PWA mientras el
// picker está abierto (falta de RAM del teléfono — ningún código JS lo evita).
// Se marca antes de abrir el picker y se limpia cuando el archivo llega; si al
// montar la app la marca sigue ahí y es reciente, la app se reinició en medio.
const PICKER_FLAG = 'orbit_picker_abierto'
function marcarPickerAbierto()  { try { localStorage.setItem(PICKER_FLAG, String(Date.now())) } catch (_) {} }
function limpiarPickerAbierto() { try { localStorage.removeItem(PICKER_FLAG) } catch (_) {} }

// Validación de archivos a subir SIN decodificar la imagen (cero riesgo de RAM).
// HEIC/HEIF se rechaza con mensaje claro: Chrome Android no lo decodifica y
// el fallo sería silencioso.
const MAX_SUBIDA_MB = 25
const MIME_POR_EXT  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
const EXT_POR_MIME  = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }

function validarArchivo(file, { permitirPdf = false } = {}) {
  const nombre    = (file.name || '').toLowerCase()
  const extNombre = nombre.includes('.') ? nombre.split('.').pop() : ''
  const mime      = file.type || MIME_POR_EXT[extNombre] || ''
  if (/hei[cf]/.test(mime) || ['heic', 'heif'].includes(extNombre)) {
    return { error: 'Formato HEIC no soportado. Configura la cámara en modo "Más compatible" (JPG) o reenvía la foto por WhatsApp y sube esa copia.' }
  }
  const esPdf = mime === 'application/pdf'
  if (esPdf && !permitirPdf) return { error: 'Aquí solo se permiten imágenes (JPG, PNG o WEBP).' }
  if (!esPdf && !mime.startsWith('image/')) {
    return { error: `Formato no permitido. Usa JPG, PNG, WEBP${permitirPdf ? ' o PDF' : ''}.` }
  }
  if (file.size > MAX_SUBIDA_MB * 1024 * 1024) {
    return { error: `El archivo supera los ${MAX_SUBIDA_MB} MB permitidos.` }
  }
  const ext = EXT_POR_MIME[mime] || extNombre || mime.split('/')[1] || 'bin'
  return { mime, ext, esPdf }
}

function FotoEvidencia({ storagePath, dbSave, fotoUrl, onFotoUploaded, comprimir = true, label = 'Foto de la mascota', sublabel = 'Evidencia de recogida' }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr]             = useState('')
  const cameraRef                 = useRef()
  const galeriaRef                = useRef()
  const stashKey                  = `foto_${storagePath}`

  // Recovery: si Chrome mató el renderer durante la subida, reanudar al montar
  useEffect(() => {
    if (fotoUrl) return
    ;(async () => {
      const pendientes = await stashGetByPrefix(stashKey)
      if (pendientes.length > 0 && pendientes[0].blob) {
        subirFoto(pendientes[0].blob, { recuperado: true })
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function subirFoto(file, { recuperado = false } = {}) {
    const val = validarArchivo(file)
    if (val.error) {
      setErr(val.error)
      if (cameraRef.current)  cameraRef.current.value  = ''
      if (galeriaRef.current) galeriaRef.current.value = ''
      return
    }
    if (!recuperado) await stashPut(stashKey, file)
    setUploading(true); setErr('')
    try {
      // Asegura un token vigente antes de subir: si expiró por inactividad,
      // supabase lo refresca aquí y evita que la 1ª subida falle por token vencido.
      await db.auth.getSession()
      // comprimir=false (cuarto frío): subir el original sin decodificar —
      // la rama createImageBitmap/canvas es la que falla desde galería Android
      const body = comprimir ? await compressImage(file) : file
      // Subida con reintentos: cada intento usa una ruta única (no choca si una
      // subida previa quedó a medias) y un timeout para no colgarse.
      const publicUrl = await conReintentos(async () => {
        const path = `${storagePath}/${crypto.randomUUID()}.${comprimir ? 'jpg' : val.ext}`
        const { data, error: upErr } = await conTimeout(
          db.storage.from('evidencias').upload(path, body, { upsert: false, contentType: comprimir ? 'image/jpeg' : val.mime }),
          'La subida tardó demasiado — revisa la señal y reintenta'
        )
        if (upErr) throw upErr
        return db.storage.from('evidencias').getPublicUrl(data.path).data.publicUrl
      })
      if (dbSave) {
        await conReintentos(async () => {
          const { error: dbErr } = await db.from(dbSave.table)
            .update({ [dbSave.column]: publicUrl }).eq('id', dbSave.id)
          if (dbErr) throw dbErr
        })
      }
      onFotoUploaded(publicUrl)
      await stashDelete(stashKey)
    } catch (e) {
      setErr(e.message || 'Error al subir foto')
    } finally {
      setUploading(false)
      if (cameraRef.current)  cameraRef.current.value  = ''
      if (galeriaRef.current) galeriaRef.current.value = ''
    }
  }

  async function handleFile(e) {
    limpiarPickerAbierto()
    const file = e.target.files?.[0]
    if (!file) return
    await subirFoto(file)
  }

  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Foto de evidencia</div>

      {/* Input cámara */}
      <input type="file" accept="image/*" capture="environment"
        ref={cameraRef} onChange={handleFile} className="hidden" />
      {/* Input galería / archivos */}
      <input type="file" accept="image/*"
        ref={galeriaRef} onChange={handleFile} className="hidden" />

      {fotoUrl ? (
        <div className="relative rounded-2xl overflow-hidden">
          <img src={fotoUrl} alt="Evidencia" className="w-full h-44 object-cover" />
          <div className="absolute inset-0 flex flex-col justify-end p-3"
            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.5))' }}>
            <div className="flex items-center justify-between">
              <span className="text-white text-xs font-semibold flex items-center gap-1">
                <CheckCircle size={12} /> Foto guardada
              </span>
              <div className="flex gap-2">
                <button onClick={() => { marcarPickerAbierto(); cameraRef.current?.click() }}
                  className="text-white text-xs font-medium px-2 py-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.25)' }}>
                  📷 Cámara
                </button>
                <button onClick={() => { marcarPickerAbierto(); galeriaRef.current?.click() }}
                  className="text-white text-xs font-medium px-2 py-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.25)' }}>
                  🖼 Galería
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : uploading ? (
        <div className="w-full py-8 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2"
          style={{ borderColor: '#D1D5DB', background: '#FAFAFA' }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
          <span className="text-sm text-gray-500">Subiendo foto…</span>
        </div>
      ) : (
        <div>
          <p className="text-xs text-gray-500 mb-2 text-center">{label} · <span className="text-gray-400">{sublabel}</span></p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { marcarPickerAbierto(); cameraRef.current?.click() }}
              className="py-5 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 transition-all active:scale-95"
              style={{ borderColor: '#D1D5DB', background: '#FAFAFA' }}>
              <Camera size={28} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Cámara</span>
            </button>
            <button onClick={() => { marcarPickerAbierto(); galeriaRef.current?.click() }}
              className="py-5 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 transition-all active:scale-95"
              style={{ borderColor: '#D1D5DB', background: '#FAFAFA' }}>
              <span className="text-2xl">🖼</span>
              <span className="text-sm font-semibold text-gray-600">Galería</span>
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertCircle size={11} /> {err}</p>}
    </div>
  )
}

// ─── COMENTARIOS DEL PROCESO ───────────────────────────────────────────
function ComentariosSection({ servicioId, personalId }) {
  const [lista, setLista]     = useState([])
  const [texto, setTexto]     = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { if (servicioId) cargar() }, [servicioId])

  async function cargar() {
    setLoading(true)
    const { data } = await db.from('novedades_servicio')
      .select('id, tipo_novedad, descripcion, valor_ajuste, created_at, personal:registrado_por(nombre, apellido)')
      .eq('servicio_id', servicioId)
      .in('tipo_novedad', ['NOTA', 'PAGO_RECIBIDO'])
      .order('created_at', { ascending: true })
    setLista(data || [])
    setLoading(false)
  }

  async function enviar() {
    if (!texto.trim()) return
    setSaving(true)
    try {
      await db.from('novedades_servicio').insert({
        servicio_id: servicioId,
        tipo_novedad: 'NOTA',
        descripcion: texto.trim(),
        registrado_por: personalId || null,
      })
      setTexto('')
      await cargar()
    } finally { setSaving(false) }
  }

  function fmtFecha(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className="mt-4 pt-3" style={{ borderTop: '1px solid #F0F0F0' }}>
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <MessageSquare size={11} /> Comentarios del proceso
      </div>
      {loading ? (
        <p className="text-xs text-gray-400 py-2 text-center">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-gray-400 py-2 text-center">Sin comentarios aún</p>
      ) : (
        <div className="space-y-2 mb-3">
          {lista.map(c => (
            <div key={c.id} className="rounded-xl px-3 py-2"
              style={{
                background: c.tipo_novedad === 'PAGO_RECIBIDO' ? '#F0FDF4' : '#F9FAFB',
                border: `1px solid ${c.tipo_novedad === 'PAGO_RECIBIDO' ? '#86EFAC' : '#E5E7EB'}`,
              }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] font-semibold text-gray-700">
                  {c.personal ? `${c.personal.nombre} ${c.personal.apellido}` : 'Sistema'}
                </span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtFecha(c.created_at)}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{c.descripcion}</p>
              {c.valor_ajuste != null && (
                <p className="text-xs font-bold mt-0.5" style={{ color: '#15803D' }}>💰 {fmt(c.valor_ajuste)}</p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          placeholder="Escribe un comentario…"
          className="flex-1 px-3 py-2 rounded-xl border text-sm outline-none"
          style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }} />
        <button onClick={enviar} disabled={saving || !texto.trim()}
          className="px-3 py-2 rounded-xl font-bold text-sm flex items-center gap-1.5 disabled:opacity-40 transition-all active:scale-95"
          style={{ background: '#1A5CD8', color: '#fff' }}>
          <Send size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── CHECKLIST RECOGIDA ────────────────────────────────────────────────
function Checklist({ svc, fotoUrl, checked, onChange }) {
  const items = [
    { id: 'id_ok',  emoji: '🪪', label: 'Identidad de la mascota verificada' },
    { id: 'foto_ok',emoji: '📸', label: 'Foto de evidencia tomada', auto: !!fotoUrl },
    { id: 'rec_ok', emoji: '📦', label: 'Recordatorio básico entregado al cliente' },
  ]
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Checklist antes de completar</div>
      <div className="space-y-2">
        {items.map(item => {
          const done = item.auto || checked.includes(item.id)
          return (
            <button key={item.id} onClick={() => !item.auto && onChange(item.id)}
              disabled={item.auto}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-98 text-left"
              style={{
                background: done ? '#F0FDF4' : '#F9FAFB',
                border: `1.5px solid ${done ? '#86EFAC' : '#E5E7EB'}`,
              }}>
              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ background: done ? '#22C55E' : '#E5E7EB' }}>
                {done && <Check size={13} className="text-white" />}
              </div>
              <span className="text-sm font-medium" style={{ color: done ? '#166534' : '#374151' }}>
                {item.emoji} {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── REGISTRO CUARTO FRÍO ──────────────────────────────────────────────
const NEVERAS_DEFAULT = ['N1','N2','N3','N4','N5','N6']

function RegistroCuartoFrio({ svc, onCompletar, neverasList = NEVERAS_DEFAULT }) {
  const cf = svc.cuarto_frio_data || null
  // La foto ya subida debe sobrevivir reinicios de la PWA (Android mata el
  // renderer al abrir la galería) y cambios de tab: se resiembra desde la DB
  // (cuarto_frio.foto_pesaje_url, vía dbSave) o desde localStorage si aún no
  // existe la fila de cuarto_frio.
  const FOTO_LS_KEY = `cf_foto_${svc.id}`
  const [peso, setPeso]               = useState(String(svc.mascotas?.peso_kg || ''))
  const [nevera, setNevera]           = useState('')
  const [neveraCustom, setNeveraCustom] = useState(false)
  const [fotoUrl, setFotoUrl]         = useState(() => {
    if (cf?.foto_pesaje_url) return cf.foto_pesaje_url
    try { return localStorage.getItem(FOTO_LS_KEY) || null } catch (_) { return null }
  })
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')

  const canConfirm = !!fotoUrl && !!nevera.trim() && !!peso

  function fotoSubida(url) {
    setFotoUrl(url)
    try { localStorage.setItem(FOTO_LS_KEY, url) } catch (_) {}
  }

  async function confirmar() {
    setSaving(true); setErr('')
    try {
      await onCompletar(svc, { cfId: cf?.id, peso, nevera: nevera.trim(), fotoUrl })
      try { localStorage.removeItem(FOTO_LS_KEY) } catch (_) {}
    }
    catch (e) { setErr(e.message || 'Error al guardar') }
    finally { setSaving(false) }
  }

  return (
    <div className="mt-2">
      {/* Banner */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 text-sm font-semibold"
        style={{ background: '#EEF3FB', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
        <Snowflake size={15} style={{ flexShrink: 0 }} /> Registrar ingreso al cuarto frío
      </div>

      {/* Foto pesaje — comprimida con el camino seguro para OOM (createImageBitmap
          + resizeWidth, igual que la foto de la mascota que "nunca falla"). Subir
          el original colgaba la subida en la señal débil del cuarto frío. */}
      <FotoEvidencia
        storagePath={cf?.id ? `cuarto_frio/${cf.id}` : `cuarto_frio/temp_${svc.id}`}
        dbSave={cf?.id ? { table: 'cuarto_frio', column: 'foto_pesaje_url', id: cf.id } : null}
        fotoUrl={fotoUrl}
        onFotoUploaded={fotoSubida}
        label="Foto de la báscula / pesaje"
        sublabel="Toma una foto del peso en báscula"
      />

      {/* Peso real */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Weight size={11} /> Peso real en báscula (kg)
        </div>
        <input type="text" inputMode="decimal"
          value={peso} onChange={e => setPeso(e.target.value.replace(',', '.'))}
          placeholder={svc.mascotas?.peso_kg ? `Registrado: ${svc.mascotas.peso_kg} kg` : 'Ej: 28.5'}
          className="w-full text-2xl font-extrabold px-4 py-3 rounded-xl border-2 outline-none"
          style={{ borderColor: peso ? '#1A5CD8' : '#E5E7EB', color: '#111827' }} />
        {svc.mascotas?.peso_kg && (
          <p className="text-[11px] text-gray-400 mt-1 ml-1">Peso al registro: {svc.mascotas.peso_kg} kg</p>
        )}
      </div>

      {/* Nevera */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Nevera</div>
        {!neveraCustom ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {neverasList.map(n => (
                <button key={n} onClick={() => setNevera(n)}
                  className="py-3.5 rounded-xl text-base font-bold transition-all active:scale-95"
                  style={{
                    background: nevera === n ? '#1D4ED8' : '#F9FAFB',
                    color: nevera === n ? '#fff' : '#374151',
                    border: `1.5px solid ${nevera === n ? '#1D4ED8' : '#E5E7EB'}`,
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={() => setNeveraCustom(true)}
              className="text-xs font-medium underline" style={{ color: '#6B7280' }}>
              Otra nevera…
            </button>
          </>
        ) : (
          <div className="flex gap-2">
            <input type="text" value={nevera} onChange={e => setNevera(e.target.value)}
              placeholder="Código de nevera" autoFocus
              className="flex-1 px-4 py-3 rounded-xl border-2 outline-none font-semibold"
              style={{ borderColor: nevera ? '#1D4ED8' : '#E5E7EB' }} />
            <button onClick={() => { setNeveraCustom(false); setNevera('') }}
              className="px-3 rounded-xl border-2 border-gray-200 text-gray-400">
              <X size={16} />
            </button>
          </div>
        )}
      </div>


{err && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={13} /> {err}
        </div>
      )}

      <button onClick={confirmar} disabled={!canConfirm || saving}
        className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-50"
        style={{ background: canConfirm ? '#1D4ED8' : '#9CA3AF', color: '#fff' }}>
        {saving ? 'Guardando…' : canConfirm ? '❄️ Confirmar ingreso al cuarto frío' : 'Completa foto, nevera y posición'}
      </button>
    </div>
  )
}

// ─── CONTACTO SHEET ─────────────────────────────────────────────────────
// modal = { nombre, numero } | null
function ContactoSheet({ modal, onClose }) {
  if (!modal) return null
  const numero = String(modal.numero || '').replace(/\D/g, '')
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}>
      <div className="rounded-t-3xl bg-white px-5 pt-5 pb-8 safe-area-bottom"
        onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
        {/* Encabezado */}
        <p className="text-[13px] text-gray-400 text-center mb-0.5">Contactar</p>
        <p className="text-[16px] font-bold text-gray-900 text-center mb-1">{modal.nombre}</p>
        <p className="text-[13px] text-gray-500 text-center mb-5">{modal.numero}</p>
        {/* Opciones */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <a href={`tel:${numero}`} onClick={onClose}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl font-bold text-white active:opacity-80 transition-opacity"
            style={{ background: '#1A5CD8' }}>
            <Phone size={22} />
            <span className="text-[13px]">Llamar</span>
          </a>
          <a href={waLink(numero)} target="_blank" rel="noreferrer" onClick={onClose}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl font-bold text-white active:opacity-80 transition-opacity"
            style={{ background: '#25D366' }}>
            <MessageSquare size={22} />
            <span className="text-[13px]">WhatsApp</span>
          </a>
        </div>
        <button onClick={onClose}
          className="w-full py-3.5 rounded-2xl text-[14px] font-semibold text-gray-500"
          style={{ background: '#F3F4F6' }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ─── CARD RECOGIDA ──────────────────────────────────────────────────────
// Gate del paso "Confirmar llegada", leído de DB (nunca de useState): mientras
// no haya hora_llegada, el técnico no ve la foto ni el botón de completar.
// Un servicio sin fila en `recogidas` no puede sellar la hora, así que el paso
// no aplica y el flujo sigue exactamente como antes (no se bloquea al técnico).
function yaLlegoAlSitio(svc) {
  const r = svc?.recogidas?.[0]
  return !r?.id || !!r?.hora_llegada
}

// Minutos en sitio desde la llegada (solo informativo, para la card del técnico)
function minutosEnSitio(recogida) {
  if (!recogida?.fecha_llegada || !recogida?.hora_llegada) return null
  const inicio = new Date(`${recogida.fecha_llegada}T${String(recogida.hora_llegada).slice(0, 8)}`)
  if (isNaN(inicio)) return null
  const mins = Math.floor((Date.now() - inicio.getTime()) / 60000)
  return mins >= 0 ? mins : null
}

function CardRecogida({ svc, tecnico, neverasList = NEVERAS_DEFAULT, onIniciar, onConfirmarLlegada, onCompletar, onCuartoFrio, onDeclinar, onReportarProblema }) {
  const [contactoModal, setContactoModal] = useState(null)
  const [sheetOpen, setSheetOpen]         = useState(false)
  const [declinarOpen, setDeclinarOpen]   = useState(false)
  const [motivoDeclina, setMotivoDeclina] = useState('')
  const [problemaOpen, setProblemaOpen]   = useState(false)
  const [motivoProblema, setMotivoProblema] = useState('')
  const [enviandoProblema, setEnviandoProblema] = useState(false)
  const [fotoUrl, setFotoUrl]         = useState(
    svc.recogidas?.[0]?.foto_recogida_url || null
  )
  const [checked, setChecked]         = useState([])
  const [valorCobrado, setValorCobrado] = useState('')
  const [completing, setCompleting]   = useState(false)
  const [confirmandoLlegada, setConfirmandoLlegada] = useState(false)
  const [actErr, setActErr]           = useState('')

  const mascota  = svc.mascotas
  const especie  = mascota?.especies?.nombre || ''
  const emoji    = petEmoji(especie)
  const cliente  = mascota?.clientes
  const recogida = svc.recogidas?.[0]
  const cf       = svc.cuarto_frio_data || null

  const pendiente    = svc.estado === 'INGRESADO'
  const llego        = yaLlegoAlSitio(svc)
  const enCamino     = svc.estado === 'EN_RECOGIDA' && !llego
  const enSitio      = svc.estado === 'EN_RECOGIDA' &&  llego
  const enCuartoFrio = svc.estado === 'EN_CUARTO_FRIO' && !cf?.nevera_codigo

  const horaLlegada = recogida?.hora_llegada ? String(recogida.hora_llegada).slice(0, 5) : null
  const minsSitio   = minutosEnSitio(recogida)

  const itemsReq = ['id_ok']
  const checklistListo = checked.includes('id_ok') && !!fotoUrl
  // El recibo ya NO bloquea la recogida: se gestiona aparte en el tab Recibos
  const puedeCompletar = checklistListo

  function toggleCheck(id) {
    setChecked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function completar() {
    setCompleting(true); setActErr('')
    try { await onCompletar(svc, recogida?.id, 0) }
    catch (e) { setActErr(e.message || 'Error al completar') }
    finally { setCompleting(false) }
  }

  async function confirmarLlegada() {
    setConfirmandoLlegada(true); setActErr('')
    try { await onConfirmarLlegada(svc, recogida?.id) }
    catch (e) { setActErr(e.message || 'Error al confirmar la llegada') }
    finally { setConfirmandoLlegada(false) }
  }

  const BADGE = {
    INGRESADO:    { bg: '#FEF3C7', color: '#92400E', label: 'Pendiente' },
    EN_RECOGIDA:  { bg: '#DBEAFE', color: '#1E40AF', label: 'En camino' },
    EN_CUARTO_FRIO:{ bg: '#EEF3FB', color: '#1D4ED8', label: 'En cuarto frío' },
  }
  const badge = enSitio
    ? { bg: '#EDE9FE', color: '#5B21B6', label: 'En sitio' }
    : (BADGE[svc.estado] || { bg: '#F3F4F6', color: '#374151', label: svc.estado })

  const borderColor = enSitio ? '#C4B5FD' : enCamino ? '#93C5FD' : enCuartoFrio ? '#BFDBFE' : '#F0F0F0'
  const borderWidth = (enCamino || enSitio || enCuartoFrio) ? 2 : 1

  return (
    <>
      {sheetOpen && (
        <ConfirmarHoraSheet svc={svc} onClose={() => setSheetOpen(false)}
          onConfirm={async (s, hora) => { await onIniciar(s, hora); setSheetOpen(false) }} />
      )}

      <div className="bg-white rounded-2xl border p-4 mb-3 shadow-sm"
        style={{ borderColor, borderWidth }}>

        {/* Header mascota */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 30 }}>{emoji}</span>
            <div>
              <div className="font-bold text-gray-900 text-base leading-tight">{mascota?.nombre || '—'}</div>
              <div className="text-xs text-gray-500">
                {especie}{mascota?.tamano ? ` · ${mascota.tamano}` : ''}{mascota?.peso_kg ? ` · ${mascota.peso_kg} kg` : ''}
              </div>
              {svc.planes?.nombre && (
                <div className="text-[11px] font-semibold mt-0.5" style={{ color: '#3D5A27' }}>
                  📦 {svc.planes.nombre}
                </div>
              )}
              {svc.fecha_ingreso && (
                <div className="text-[10px] text-gray-400 mt-0.5">
                  📅 Ingreso: {new Date(svc.fecha_ingreso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
            style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
        </div>

        {/* Alerta horario veterinaria */}
        {recogida?.tipo_lugar === 'CLINICA_ALIADA' && svc.aliados && (() => {
          const est = calcularEstadoVet(svc.aliados.horario)
          if (!est.tieneHorario) return null
          const COLOR = { verde: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' }, naranja: { bg: '#FFF7ED', border: '#FED7AA', text: '#92400E' }, rojo: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' } }
          const c = COLOR[est.nivel] || COLOR.rojo
          return (
            <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold"
              style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
              <span className="shrink-0">🏥</span>
              <div className="min-w-0">
                <span className="block font-bold truncate">{svc.aliados.nombre}</span>
                <span className="font-medium">{est.textoEstado}</span>
              </div>
            </div>
          )
        })()}

        {/* Monto */}

        {/* Cliente */}
        {cliente && (
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
              style={{ background: '#1A5CD8' }}>
              {(cliente.nombre?.[0] || '').toUpperCase()}{(cliente.apellido?.[0] || '').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-800 leading-tight">{cliente.nombre} {cliente.apellido}</div>
              {cliente.whatsapp && (
                <button
                  onClick={() => setContactoModal({ nombre: `${cliente.nombre} ${cliente.apellido}`.trim(), numero: cliente.whatsapp })}
                  className="text-xs font-medium flex items-center gap-1" style={{ color: '#25D366' }}>
                  <Phone size={10} /> {cliente.whatsapp}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Dirección navegable */}
        <div className="mb-2">
          <DireccionLink
            direccion={svc.direccion_recogida}
            barrio={svc.barrio_recogida}
            ciudad={svc.ciudad_recogida}
          />
        </div>

        {/* Contacto */}
        {recogida?.contacto_nombre && (
          <div className="flex items-center gap-2 mb-2">
            <Phone size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600">{recogida.contacto_nombre}</span>
            {recogida.contacto_telefono && (
              <button
                onClick={() => setContactoModal({ nombre: recogida.contacto_nombre, numero: recogida.contacto_telefono })}
                className="text-xs font-semibold ml-1" style={{ color: '#1A5CD8' }}>
                {recogida.contacto_telefono}
              </button>
            )}
          </div>
        )}

        {/* Hora */}
        {(recogida?.fecha_programada || recogida?.hora_programada) && (
          <div className="flex items-center gap-2 mb-3">
            <Clock size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600">
              {recogida.fecha_programada}{recogida.hora_programada ? ` · Llegada ${recogida.hora_programada}` : ''}
            </span>
          </div>
        )}

        {/* Indicaciones */}
        {svc.indicaciones_recogida && (
          <div className="rounded-xl px-3 py-2 text-xs mb-3"
            style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
            📋 {svc.indicaciones_recogida}
          </div>
        )}

        {/* ── FASE 1: INICIAR RUTA ── */}
        {pendiente && (
          <div className="space-y-2">
            <button onClick={() => setSheetOpen(true)}
              className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98"
              style={{ background: '#1A5CD8', color: '#fff' }}>
              🚐 Iniciar ruta
            </button>
            <button onClick={() => setDeclinarOpen(true)}
              className="w-full py-3 rounded-2xl text-sm font-semibold transition-all active:scale-98 border"
              style={{ background: '#FEF2F2', color: '#DC2626', borderColor: '#FECACA' }}>
              ❌ No puedo aceptar este servicio
            </button>
          </div>
        )}

        {/* Modal declinar */}
        {declinarOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setDeclinarOpen(false)}>
            <div className="bg-white rounded-t-3xl px-6 pt-4 pb-10" onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
              <h3 className="text-base font-bold text-gray-900 mb-1">¿Por qué no puedes aceptar?</h3>
              <p className="text-xs text-gray-500 mb-4">El coordinador recibirá una alerta para reasignar.</p>
              <textarea
                value={motivoDeclina}
                onChange={e => setMotivoDeclina(e.target.value)}
                placeholder="Ej: No tengo disponibilidad, problema con el vehículo..."
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none mb-4 resize-none"
                rows={3}
                style={{ borderColor: '#E5E7EB' }}
              />
              <button
                onClick={async () => {
                  await onDeclinar(svc, motivoDeclina)
                  setDeclinarOpen(false)
                  setMotivoDeclina('')
                }}
                className="w-full py-4 rounded-2xl text-base font-bold"
                style={{ background: '#DC2626', color: '#fff' }}>
                Enviar aviso al coordinador
              </button>
            </div>
          </div>
        )}

        {/* Modal problema en ruta */}
        {problemaOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => { if (!enviandoProblema) setProblemaOpen(false) }}>
            <div className="bg-white rounded-t-3xl px-6 pt-4 pb-10" onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">⚠️</span>
                <h3 className="text-base font-bold text-gray-900">Reportar problema en ruta</h3>
              </div>
              <p className="text-xs text-gray-500 mb-1">El servicio volverá a <strong>pendiente</strong> y el coordinador recibirá una alerta urgente para reasignar.</p>
              <p className="text-xs text-amber-600 mb-4 font-medium">Tu asignación será liberada.</p>
              <textarea
                value={motivoProblema}
                onChange={e => setMotivoProblema(e.target.value)}
                placeholder="Ej: Problema mecánico, accidente, emergencia personal..."
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none mb-4 resize-none"
                rows={3}
                style={{ borderColor: '#FCA5A5' }}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => { setProblemaOpen(false); setMotivoProblema('') }}
                  disabled={enviandoProblema}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold border"
                  style={{ borderColor: '#E5E7EB', color: '#374151' }}>
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setEnviandoProblema(true)
                    try {
                      await onReportarProblema(svc, motivoProblema)
                      setProblemaOpen(false)
                      setMotivoProblema('')
                    } finally {
                      setEnviandoProblema(false)
                    }
                  }}
                  disabled={enviandoProblema}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold disabled:opacity-60"
                  style={{ background: '#DC2626', color: '#fff' }}>
                  {enviandoProblema ? 'Enviando…' : 'Reportar problema'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FASE 2: EN CAMINO — solo se puede confirmar la llegada ── */}
        {enCamino && (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-4"
              style={{ background: '#DBEAFE' }}>
              <span className="text-sm font-semibold" style={{ color: '#1E40AF' }}>🚐 En camino a la recogida</span>
              <button
                onClick={() => setProblemaOpen(true)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all active:scale-95"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                ⚠️ Reportar problema
              </button>
            </div>

            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-4"
              style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
              <MapPin size={14} style={{ color: '#7C3AED', flexShrink: 0, marginTop: 1 }} />
              <span className="text-[11px] font-medium" style={{ color: '#5B21B6' }}>
                Apenas llegues al sitio, toca <strong>Confirmar llegada</strong>. Queda registrada la hora exacta —
                luego tomas la foto y generas el recibo con calma.
              </span>
            </div>

            {actErr && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
                style={{ background: '#FEE2E2', color: '#991B1B' }}>
                <AlertCircle size={13} /> {actErr}
              </div>
            )}

            <button onClick={confirmarLlegada} disabled={confirmandoLlegada}
              className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-60"
              style={{ background: '#7C3AED', color: '#fff' }}>
              {confirmandoLlegada ? 'Registrando llegada…' : '📍 Confirmar llegada'}
            </button>
          </div>
        )}

        {/* ── FASE 3: EN SITIO — foto, checklist y cierre de la recogida ── */}
        {enSitio && (
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-4"
              style={{ background: '#EDE9FE' }}>
              <span className="text-sm font-semibold" style={{ color: '#5B21B6' }}>
                📍 En sitio{horaLlegada ? ` desde las ${horaLlegada}` : ''}
                {minsSitio !== null && (
                  <span className="block text-[11px] font-medium mt-0.5" style={{ color: '#7C3AED' }}>
                    Llevas {minsSitio < 60 ? `${minsSitio} min` : `${Math.floor(minsSitio / 60)} h ${minsSitio % 60} min`} aquí
                  </span>
                )}
              </span>
              <button
                onClick={() => setProblemaOpen(true)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all active:scale-95 flex-shrink-0"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                ⚠️ Reportar problema
              </button>
            </div>
            <FotoEvidencia
              storagePath={recogida?.id ? `recogidas/${recogida.id}` : `recogidas/temp_${svc.id}`}
              dbSave={recogida?.id ? { table: 'recogidas', column: 'foto_recogida_url', id: recogida.id } : null}
              fotoUrl={fotoUrl}
              onFotoUploaded={setFotoUrl}
              label="Tomar foto de la mascota"
              sublabel="Evidencia de recogida"
            />
            <Checklist svc={svc} fotoUrl={fotoUrl} checked={checked} onChange={toggleCheck} />

            {/* Al completar, el técnico va directo al recibo. La mascota no
                entra al cuarto frío sin recibo generado (gate por DB). */}
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-4"
              style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
              <Receipt size={14} style={{ color: '#7C3AED', flexShrink: 0, marginTop: 1 }} />
              <span className="text-[11px] font-medium" style={{ color: '#5B21B6' }}>
                Al completar irás directo a generar el <strong>recibo</strong>. La mascota no entra al cuarto frío sin recibo.
              </span>
            </div>

            {actErr && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
                style={{ background: '#FEE2E2', color: '#991B1B' }}>
                <AlertCircle size={13} /> {actErr}
              </div>
            )}
            <button onClick={completar} disabled={!puedeCompletar || completing}
              className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-50"
              style={{ background: puedeCompletar ? '#22C55E' : '#9CA3AF', color: '#fff' }}>
              {completing ? 'Completando…'
                : !fotoUrl ? 'Falta: foto de la mascota'
                : !checked.includes('id_ok') ? 'Falta: verificar identidad'
                : '✅ Completar recogida'}
            </button>
          </div>
        )}

        {/* EN_CUARTO_FRIO: ahora se gestiona en el tab C. Frío */}

        {/* ── COMENTARIOS ── siempre visibles */}
        <ComentariosSection servicioId={svc.id} personalId={tecnico?.id} />
      </div>

      <ContactoSheet modal={contactoModal} onClose={() => setContactoModal(null)} />
    </>
  )
}

// ─── CARD ENTREGA ───────────────────────────────────────────────────────
function CardEntrega({ ent, tecnico, onAceptar, onCompletar }) {
  const [contactoModal,  setContactoModal]  = useState(null)
  const [actErr,         setActErr]         = useState('')
  const [aceptando,      setAceptando]      = useState(false)
  const [completando,    setCompletando]    = useState(false)
  const [fotoUrl,        setFotoUrl]        = useState(ent.foto_entrega_url || null)
  const [firmaDataUrl,   setFirmaDataUrl]   = useState(null)
  const [nombreCliente,  setNombreCliente]  = useState('')
  const [genCert,        setGenCert]        = useState(false)

  const mascota = ent.servicios?.mascotas
  const especie = mascota?.especies?.nombre || ''
  const emoji   = petEmoji(especie)
  const cliente = mascota?.clientes
  const saldo   = Math.max(0, (ent.servicios?.valor_total || 0) - (ent.servicios?.valor_pagado || 0))

  const BADGE = {
    ASIGNADA:   { bg: '#EDE9FE', color: '#5B21B6', label: 'Asignada' },
    EN_CAMINO:  { bg: '#DBEAFE', color: '#1E40AF', label: 'En camino' },
    ENTREGADA:  { bg: '#D1FAE5', color: '#065F46', label: 'Entregada' },
  }
  const badge = BADGE[ent.estado] || { bg: '#F3F4F6', color: '#374151', label: ent.estado }

  const puedeCompletar = !!fotoUrl && (!!firmaDataUrl || !!nombreCliente.trim())

  async function aceptar() {
    setAceptando(true); setActErr('')
    try { await onAceptar(ent) }
    catch (e) { setActErr(e.message || 'Error al aceptar') }
    finally { setAceptando(false) }
  }

  async function completar() {
    setCompletando(true); setActErr('')
    try { await onCompletar(ent, { fotoUrl, firmaDataUrl, nombreCliente }) }
    catch (e) { setActErr(e.message || 'Error al completar') }
    finally { setCompletando(false) }
  }

  async function descargarCertificado() {
    setGenCert(true)
    try {
      const { generarCertificadoEntrega } = await import('@/lib/certificadoEntrega')
      const { data: itemsData } = await db.from('servicio_recordatorios')
        .select('id, estado, origen, recordatorios(nombre)')
        .eq('servicio_id', ent.servicio_id).neq('origen', 'REMOVIDO')
      const mensajero = { nombre: tecnico?.nombre || '', apellido: tecnico?.apellido || '' }
      await generarCertificadoEntrega({
        svc: { ...ent.servicios, id: ent.servicio_id },
        entrega: ent, mensajero, items: itemsData || [],
        firmaDataUrl,
      })
    } catch (e) { alert('Error al generar certificado: ' + e.message) }
    finally { setGenCert(false) }
  }

  return (
    <div className="bg-white rounded-2xl border p-4 mb-3 shadow-sm"
      style={{ borderColor: ent.estado === 'EN_CAMINO' ? '#93C5FD' : '#F0F0F0', borderWidth: ent.estado === 'EN_CAMINO' ? 2 : 1 }}>

      {/* Header mascota */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 30 }}>{emoji}</span>
          <div>
            <div className="font-bold text-gray-900 text-base leading-tight">{mascota?.nombre || '—'}</div>
            <div className="text-xs text-gray-500">{especie} · {ent.servicios?.planes?.nombre || ''}</div>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>

      {/* Cliente */}
      {cliente && (
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: '#C4A87A' }}>
            {(cliente.nombre?.[0] || '').toUpperCase()}{(cliente.apellido?.[0] || '').toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800 leading-tight">{cliente.nombre} {cliente.apellido}</div>
            {cliente.whatsapp && (
              <button
                onClick={() => setContactoModal({ nombre: `${cliente.nombre} ${cliente.apellido}`.trim(), numero: cliente.whatsapp })}
                className="text-xs font-medium flex items-center gap-1" style={{ color: '#25D366' }}>
                <Phone size={10} /> {cliente.whatsapp}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dirección */}
      <div className="mb-2.5">
        <DireccionLink direccion={ent.direccion_entrega} barrio={ent.barrio} ciudad={ent.ciudad} />
      </div>

      {/* Indicaciones */}
      {ent.indicaciones && (
        <div className="rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
          📋 {ent.indicaciones}
        </div>
      )}

      {/* Notas del coordinador */}
      {ent.notas && (
        <div className="rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE' }}>
          💬 {ent.notas}
        </div>
      )}


      {/* Botón certificado */}
      <button onClick={descargarCertificado} disabled={genCert}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-bold mb-3 transition-all active:scale-98 disabled:opacity-60"
        style={{ background: '#EDE9FE', color: '#5B21B6' }}>
        {genCert ? <div className="w-3.5 h-3.5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" /> : <FileText size={13} />}
        Descargar certificado de entrega
      </button>

      {actErr && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={13} /> {actErr}
        </div>
      )}

      {/* ── FASE 1: ASIGNADA → aceptar ── */}
      {ent.estado === 'ASIGNADA' && (
        <button onClick={aceptar} disabled={aceptando}
          className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-60"
          style={{ background: '#4F46E5', color: '#fff' }}>
          {aceptando ? 'Aceptando…' : '🛵 Acepto y salgo a entregar'}
        </button>
      )}

      {/* ── FASE 2: EN_CAMINO → completar entrega ── */}
      {ent.estado === 'EN_CAMINO' && (
        <div className="space-y-4 mt-2">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold"
            style={{ background: '#DBEAFE', color: '#1E40AF' }}>
            🛵 En camino — completa la entrega al llegar
          </div>

          {/* Foto evidencia entrega */}
          <FotoEvidencia
            storagePath={`entregas/${ent.id}`}
            dbSave={{ table: 'entregas', column: 'foto_entrega_url', id: ent.id }}
            fotoUrl={fotoUrl}
            onFotoUploaded={url => setFotoUrl(url)}
            label="Foto de la entrega"
            sublabel="Evidencia de que el cliente recibió los recordatorios"
          />

          {/* Firma del cliente */}
          <SignaturePad onSigned={setFirmaDataUrl} firmaDataUrl={firmaDataUrl} />

          {/* Nombre del cliente */}
          <div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Pen size={11} /> Nombre del cliente (confirmar recibido)
            </div>
            <input type="text" value={nombreCliente} onChange={e => setNombreCliente(e.target.value)}
              placeholder={cliente ? `${cliente.nombre} ${cliente.apellido}` : 'Nombre completo'}
              className="w-full px-4 py-3 rounded-xl border-2 outline-none font-semibold text-sm"
              style={{ borderColor: nombreCliente ? '#1A5CD8' : '#E5E7EB' }} />
          </div>

          <button onClick={completar} disabled={!puedeCompletar || completando}
            className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-50"
            style={{ background: puedeCompletar ? '#22C55E' : '#9CA3AF', color: '#fff' }}>
            {completando ? 'Guardando…'
              : puedeCompletar ? '✅ Confirmar entrega completada'
              : `Falta: ${!fotoUrl ? 'foto' : ''}${!fotoUrl && !firmaDataUrl && !nombreCliente ? ' + ' : ''}${!firmaDataUrl && !nombreCliente ? 'firma o nombre del cliente' : ''}`}
          </button>
        </div>
      )}

      <ComentariosSection servicioId={ent.servicio_id} personalId={tecnico?.id} />

      <ContactoSheet modal={contactoModal} onClose={() => setContactoModal(null)} />
    </div>
  )
}

// ─── REPORTE CUARTO FRÍO ────────────────────────────────────────────────
const FUNCIONAMIENTO_OPTS = [
  { value: 'SIN_FUNCIONAR', label: '🔴 Sin funcionar'    },
  { value: 'MANTENIMIENTO', label: '🟡 En mantenimiento' },
  { value: 'REFRIGERANDO',  label: '🔵 Refrigerando'     },
  { value: 'CONGELANDO',    label: '🟦 Congelando'       },
  { value: 'CAVA',          label: '🟢 Cava'             },
]
const CAPACIDAD_OPTS = [20, 40, 60, 80, 100]

function ReporteCuartoFrio({ tecnico, neverasActivas, reporteHoy, onGuardado }) {
  const [neveraData, setNeveraData] = useState(() => {
    const map = {}
    ;(reporteHoy?.estado_nevera_reporte || []).forEach(n => {
      map[n.nevera_codigo] = { capacidad_pct: n.capacidad_pct, funcionamiento: n.funcionamiento }
    })
    return map
  })
  const [checklist, setChecklist] = useState({
    ozonizadores_ok:   reporteHoy?.ozonizadores_ok   ?? false,
    control_olores_ok: reporteHoy?.control_olores_ok ?? false,
    sin_olor_novedad:  reporteHoy?.sin_olor_novedad  ?? false,
  })
  const [comentario, setComentario] = useState(reporteHoy?.comentario || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const [ok, setOk]         = useState(false)

  const today = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })

  function setNeveraField(codigo, field, value) {
    setNeveraData(prev => ({ ...prev, [codigo]: { ...prev[codigo], [field]: value } }))
  }

  async function guardar() {
    setSaving(true); setErr('')
    try {
      let reporteId
      if (reporteHoy) {
        await db.from('estado_cuarto_frio').update({
          ...checklist, comentario: comentario || null,
        }).eq('id', reporteHoy.id)
        reporteId = reporteHoy.id
        await db.from('estado_nevera_reporte').delete().eq('reporte_id', reporteId)
      } else {
        const { data, error } = await db.from('estado_cuarto_frio').insert({
          registrado_por: tecnico?.id || null,
          ...checklist,
          comentario: comentario || null,
        }).select('id').single()
        if (error) throw error
        reporteId = data.id
      }
      const neveras = Object.entries(neveraData).filter(([, v]) => v.capacidad_pct || v.funcionamiento)
      if (neveras.length > 0) {
        const { error: nErr } = await db.from('estado_nevera_reporte').insert(
          neveras.map(([codigo, v]) => ({
            reporte_id:    reporteId,
            nevera_codigo: codigo,
            capacidad_pct: v.capacidad_pct ? parseInt(v.capacidad_pct) : null,
            funcionamiento: v.funcionamiento || null,
          }))
        )
        if (nErr) throw nErr
      }
      setOk(true)
      onGuardado()
    } catch (e) {
      setErr(e.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const checkItems = [
    { key: 'ozonizadores_ok',   emoji: '💨', label: 'Ozonizadores en funcionamiento' },
    { key: 'control_olores_ok', emoji: '🌿', label: 'Control de olores activo'       },
    { key: 'sin_olor_novedad',  emoji: '✅', label: 'Cuarto frío sin olor ni novedad' },
  ]

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Snowflake size={17} style={{ color: '#0E7490', flexShrink: 0 }} />
        <div>
          <div className="font-bold text-gray-800 text-sm">Estado del cuarto frío</div>
          <div className="text-[11px] text-gray-400 capitalize">{today}</div>
        </div>
        {reporteHoy && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: '#D1FAE5', color: '#065F46' }}>
            ✓ Reportado hoy
          </span>
        )}
      </div>

      {/* Neveras activas */}
      {neverasActivas.length > 0 ? (
        <div className="space-y-3 mb-4">
          {neverasActivas.map(nevera => {
            const d = neveraData[nevera] || {}
            return (
              <div key={nevera} className="bg-white rounded-2xl border p-3"
                style={{ borderColor: '#BAE6FD' }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <Snowflake size={13} style={{ color: '#0E7490' }} />
                  <span className="font-bold text-gray-800">{nevera}</span>
                </div>
                {/* Capacidad */}
                <div className="mb-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Capacidad</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {CAPACIDAD_OPTS.map(pct => (
                      <button key={pct} onClick={() => setNeveraField(nevera, 'capacidad_pct', pct)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                        style={{
                          background: d.capacidad_pct === pct ? '#0E7490' : '#F0F9FF',
                          color:      d.capacidad_pct === pct ? '#fff'     : '#0E7490',
                          border:     `1.5px solid ${d.capacidad_pct === pct ? '#0E7490' : '#BAE6FD'}`,
                        }}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                  {d.capacidad_pct > 0 && (
                    <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${d.capacidad_pct}%`,
                          background: d.capacidad_pct >= 80 ? '#DC2626' : d.capacidad_pct >= 60 ? '#D97706' : '#0E7490',
                        }} />
                    </div>
                  )}
                </div>
                {/* Funcionamiento */}
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Funcionamiento</div>
                  <select value={d.funcionamiento || ''}
                    onChange={e => setNeveraField(nevera, 'funcionamiento', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm font-medium outline-none"
                    style={{ borderColor: '#BAE6FD', background: '#F0F9FF', color: '#0E7490' }}>
                    <option value="">— Selecciona estado —</option>
                    {FUNCIONAMIENTO_OPTS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 text-center">
          <p className="text-sm text-gray-500">No hay mascotas en neveras activas</p>
        </div>
      )}

      {/* Checklist */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Checklist del cuarto frío</div>
        <div className="space-y-2">
          {checkItems.map(item => (
            <button key={item.key}
              onClick={() => setChecklist(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-98 text-left"
              style={{
                background: checklist[item.key] ? '#F0FDF4' : '#FAFAFA',
                border: `1.5px solid ${checklist[item.key] ? '#86EFAC' : '#E5E7EB'}`,
              }}>
              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ background: checklist[item.key] ? '#22C55E' : '#E5E7EB' }}>
                {checklist[item.key] && <Check size={13} className="text-white" />}
              </div>
              <span className="text-sm font-medium" style={{ color: checklist[item.key] ? '#166534' : '#374151' }}>
                {item.emoji} {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Comentario general */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Observaciones generales</div>
        <textarea value={comentario} onChange={e => setComentario(e.target.value)}
          rows={3}
          placeholder="Ej: Se encontró manguera rota en N3, se reportó a coordinación…"
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-none"
          style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }} />
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={13} /> {err}
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
          style={{ background: '#D1FAE5', color: '#065F46', border: '1px solid #86EFAC' }}>
          <CheckCircle size={13} /> Reporte guardado correctamente
        </div>
      )}

      <button onClick={guardar} disabled={saving}
        className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-50 mb-6"
        style={{ background: '#0E7490', color: '#fff' }}>
        {saving ? 'Guardando…' : reporteHoy ? '🔄 Actualizar reporte' : '❄️ Enviar reporte del cuarto frío'}
      </button>
    </div>
  )
}

// ─── MAIN ───────────────────────────────────────────────────────────────
export default function TecnicoApp() {
  const { personalData: tecnico, logout } = useAuth()
  // La pestaña activa sobrevive reinicios de la PWA (Android mata la pestaña
  // al abrir cámara/galería): el técnico vuelve exactamente donde estaba.
  const TABS_VALIDOS = ['recogidas', 'entregas', 'cuarto_frio', 'recibo', 'comprobantes', 'mis_cuadres']
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem('tecnico_ui_tab')
      return TABS_VALIDOS.includes(t) ? t : 'recogidas'
    } catch (_) { return 'recogidas' }
  })
  useEffect(() => {
    try { localStorage.setItem('tecnico_ui_tab', tab) } catch (_) {}
  }, [tab])
  const [recogidas, setRecogidas] = useState([])
  const [entregas, setEntregas]   = useState([])
  const [compPend, setCompPend]   = useState(0)   // comprobantes pendientes (badge)
  const [cuadresPend, setCuadresPend] = useState(0) // cuadres BORRADOR sin firmar (badge + aviso)
  const [loading, setLoading]     = useState(false)
  const [queryErr, setQueryErr]   = useState('')
  const [notif, setNotif]         = useState(null)
  const prevCountRef               = useRef(null)
  // Si la app se reinició con el picker de galería/cámara abierto (Android
  // mata la PWA por RAM), avisar al técnico: la imagen NO llegó
  const [avisoGaleria, setAvisoGaleria] = useState(false)
  useEffect(() => {
    try {
      const ts = parseInt(localStorage.getItem(PICKER_FLAG) || '0', 10)
      if (ts && Date.now() - ts < 3 * 60 * 1000) setAvisoGaleria(true)
      localStorage.removeItem(PICKER_FLAG)
    } catch (_) {}
  }, [])

  // Auto-test de almacenamiento: en teléfonos llenos Chrome rechaza escrituras
  // a localStorage/IndexedDB EN SILENCIO — toda la persistencia de Orbit
  // (borradores, fotos pendientes, pestaña, detector) muere sin síntoma. Si
  // pasa, mostrarlo en pantalla con los MB libres del sitio.
  const [storageRoto, setStorageRoto] = useState(null)
  useEffect(() => {
    ;(async () => {
      let detalle = ''
      try {
        localStorage.setItem('orbit_storage_test', '1')
        const ok = localStorage.getItem('orbit_storage_test') === '1'
        localStorage.removeItem('orbit_storage_test')
        if (!ok) detalle = 'localStorage no escribe'
      } catch (_) { detalle = 'localStorage bloqueado' }
      if (!detalle) {
        try {
          await stashPut('storage_test', new Blob(['x']))
          const r = await stashGetByPrefix('storage_test')
          await stashDelete('storage_test')
          if (!r.length) detalle = 'IndexedDB no escribe'
        } catch (_) { detalle = 'IndexedDB bloqueado' }
      }
      let libresMB = null
      if (navigator.storage?.estimate) {
        try {
          const { quota = 0, usage = 0 } = await navigator.storage.estimate()
          libresMB = Math.round((quota - usage) / 1048576)
        } catch (_) {}
      }
      if (!detalle && libresMB !== null && libresMB < 50) detalle = 'queda muy poco espacio'
      if (detalle) setStorageRoto(detalle + (libresMB !== null ? ` · libres ${libresMB} MB` : ''))
    })()
  }, [])
  const [reporteHoy,     setReporteHoy]     = useState(null)
  const [neverasActivas, setNeverasActivas] = useState([])
  const [misCF,          setMisCF]          = useState([])
  const [pendientesCF,   setPendientesCF]   = useState([])

  const cargar = useCallback(async (silent = false) => {
    if (!tecnico) return
    if (!silent) setLoading(true)
    setQueryErr('')
    try {
      // ── 1. Servicios asignados (sin join cuarto_frio para evitar errores) ──
      const SELECT_SVC = `
          id, estado, estado_pago, metodo_pago, valor_total, valor_pagado,
          mascota_id, fecha_ingreso,
          direccion_recogida, ciudad_recogida, barrio_recogida, indicaciones_recogida,
          mascotas:mascota_id (
            id_mascota, nombre, tamano, especie_id, peso_kg,
            especies ( nombre ),
            clientes:cliente_id ( nombre, apellido, whatsapp, email, telefono, telefono2 )
          ),
          recogidas ( id, contacto_nombre, contacto_telefono, tipo_lugar, fecha_programada, hora_programada, fecha_llegada, hora_llegada, notas, foto_recogida_url ),
          planes:plan_id ( nombre, codigo ),
          aliados:aliado_origen_id ( nombre, horario, telefono, whatsapp )
        `
      const { data: svcData, error: svcErr } = await db.from('servicios')
        .select(SELECT_SVC)
        .eq('tecnico_id', tecnico.id)
        .in('estado', ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO'])
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('fecha_ingreso', { ascending: false })

      if (svcErr) { setQueryErr(svcErr.message); return }
      const servicios = svcData || []

      // ── 1b. Rezagados de cuarto frío: mascotas FÍSICAMENTE en la nevera sin
      // registro (sin nevera_codigo) cuyo servicio ya avanzó de estado por otro
      // flujo (lote grupal completado, fotos del cliente, avance manual). El
      // estado del servicio NO indica que la mascota salió de la nevera: el gate
      // físico es cuarto_frio.fecha_salida (mismo principio que v_candidatos_tenjo).
      // Sin esto, el técnico no puede registrar nevera/evidencia de esas mascotas.
      const { data: cfRezag } = await db.from('cuarto_frio')
        .select('id, servicio_id, nevera_codigo, posicion, peso_kg, foto_pesaje_url')
        .is('fecha_salida', null)
        .is('nevera_codigo', null)
      const idsRezag = (cfRezag || [])
        .map(cf => cf.servicio_id)
        .filter(id => !servicios.some(s => s.id === id))
      let rezagados = []
      if (idsRezag.length > 0) {
        const { data: rezData } = await db.from('servicios')
          .select(SELECT_SVC)
          .eq('tecnico_id', tecnico.id)
          .in('id', idsRezag)
          .in('estado', ['EN_PROCESO', 'EN_PRODUCCION'])
          .gte('fecha_ingreso', FECHA_CORTE)
        const cfBySvc = Object.fromEntries((cfRezag || []).map(cf => [cf.servicio_id, cf]))
        rezagados = (rezData || []).map(s => ({ ...s, cuarto_frio_data: cfBySvc[s.id] || null }))
      }

      // ── 2. Cuarto frío para servicios EN_CUARTO_FRIO (query separado) ──
      const idsCF = servicios.filter(s => s.estado === 'EN_CUARTO_FRIO').map(s => s.id)
      let cfMap = {}
      if (idsCF.length > 0) {
        const { data: cfData } = await db.from('cuarto_frio')
          .select('id, servicio_id, nevera_codigo, posicion, peso_kg, foto_pesaje_url')
          .in('servicio_id', idsCF)
        ;(cfData || []).forEach(cf => { cfMap[cf.servicio_id] = cf })
      }

      // ── 3. Fusionar cuarto_frio en cada servicio ──
      const serviciosConCF = servicios.map(s => ({
        ...s,
        cuarto_frio_data: cfMap[s.id] || null,
      }))

      // ── 4. Entregas ──
      const { data: entData } = await db.from('entregas')
        .select(`
          *,
          servicios:servicio_id (
            id, estado, valor_total, valor_pagado, estado_pago,
            mascotas:mascota_id (
              nombre, especie_id,
              especies ( nombre ),
              clientes:cliente_id ( nombre, apellido, whatsapp )
            ),
            planes:plan_id ( nombre )
          )
        `)
        .eq('mensajero_id', tecnico.id)
        .in('estado', ['ASIGNADA', 'EN_CAMINO'])
        .order('fecha_programada', { ascending: true, nullsFirst: true })

      // Recogidas activas: solo INGRESADO y EN_RECOGIDA
      // EN_CUARTO_FRIO va exclusivamente al tab C. Frío
      const nuevasR = serviciosConCF.filter(s =>
        ['INGRESADO', 'EN_RECOGIDA'].includes(s.estado)
      )
      // Entregas de servicios cancelados no son tareas activas
      const nuevasE = (entData || []).filter(e => e.servicios?.estado !== 'CANCELADO')

      const total = nuevasR.length
      if (silent && prevCountRef.current !== null && total > prevCountRef.current) {
        const diff = total - prevCountRef.current
        setNotif(`¡Nueva recogida asignada! (${diff} nueva${diff > 1 ? 's' : ''})`)
        playNotifSound()
        setTimeout(() => setNotif(null), 8000)
      }
      prevCountRef.current = total

      // ── 5. Reporte del día y neveras activas (desde tabla neveras) ──
      const todayStr = hoyLocalISO()
      const [{ data: reporteData }, { data: neverasData }] = await Promise.all([
        db.from('estado_cuarto_frio')
          .select('*, estado_nevera_reporte(*)')
          .eq('fecha', todayStr)
          .order('created_at', { ascending: false })
          .limit(1),
        db.from('neveras')
          .select('codigo, capacidad_kg')
          .eq('activa', true)
          .order('codigo'),
      ])
      setReporteHoy(reporteData?.[0] || null)
      // Usar neveras de la tabla; fallback a defaults si la tabla está vacía
      const codigosNeveras = (neverasData || [])
        .map(n => n.codigo)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      setNeverasActivas(codigosNeveras.length > 0 ? codigosNeveras : NEVERAS_DEFAULT)

      // Pendientes de registro en C. Frío (seleccionaron nevera aún no) +
      // rezagados: en nevera sin registro aunque el servicio ya avanzó de estado.
      const pendientesCFArr = [
        ...serviciosConCF.filter(s =>
          s.estado === 'EN_CUARTO_FRIO' && !s.cuarto_frio_data?.nevera_codigo
        ),
        ...rezagados,
      ]
      // Gate por DB (NUNCA useState): la mascota no entra al cuarto frío sin
      // recibo generado. Basta con que exista la fila en recibos_tecnico — un
      // recibo en PAGO PENDIENTE también cuenta (el gate es "recibo generado",
      // no "pago cobrado").
      const idsPend = pendientesCFArr.map(s => s.id)
      let conRecibo = new Set()
      if (idsPend.length) {
        const { data: recsPend } = await db.from('recibos_tecnico')
          .select('servicio_id').in('servicio_id', idsPend)
        conRecibo = new Set((recsPend || []).map(r => r.servicio_id))
      }
      setPendientesCF(pendientesCFArr.map(s => ({ ...s, tiene_recibo: conRecibo.has(s.id) })))

      // Mis registros en cuarto frío (ya registrados con nevera)
      const misCFArr = serviciosConCF.filter(s =>
        s.estado === 'EN_CUARTO_FRIO' && s.cuarto_frio_data?.nevera_codigo
      )
      setMisCF(misCFArr)

      setRecogidas(nuevasR)
      setEntregas(nuevasE)

      // ── 6. Badge de comprobantes pendientes (recibos con pago digital sin comprobante) ──
      try {
        const { data: recs } = await db.from('recibos_tecnico')
          .select('medios_pago').eq('tecnico_id', tecnico.id)
          .order('created_at', { ascending: false }).limit(300)
        const n = (recs || []).filter(r =>
          Array.isArray(r.medios_pago) && r.medios_pago.some(m =>
            METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0 && !m.comprobanteUrl)
        ).length
        setCompPend(n)
      } catch (_) { /* badge best-effort */ }

      // ── 7. Cuadres BORRADOR pendientes de la firma del técnico ──
      // Pendiente = nunca confirmó, o confirmó otra versión (el monto cambió
      // después — misma regla del chip en Finanzas). Alimenta el badge de
      // "Mis pagos" y el aviso al abrir la app; sin su firma, gerencia no
      // puede cerrar el cuadre (migración 038).
      try {
        const { data: cuadresBor } = await db.from('cuadres_tecnico')
          .select('id, tecnico_confirmado_en, tecnico_confirmado_monto, dinero_a_entregar')
          .eq('tecnico_id', tecnico.id).eq('estado', 'BORRADOR')
        setCuadresPend((cuadresBor || []).filter(c =>
          !c.tecnico_confirmado_en ||
          Number(c.tecnico_confirmado_monto) !== Number(c.dinero_a_entregar)
        ).length)
      } catch (_) { /* badge best-effort */ }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [tecnico])

  useEffect(() => {
    if (!tecnico) return
    cargar()
    const id = setInterval(() => cargar(true), POLL)
    const canal = db
      .channel(`tecnico-servicios-${tecnico.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'servicios',
        filter: `tecnico_id=eq.${tecnico.id}`,
      }, () => { cargar(true) })
      .subscribe()
    return () => {
      clearInterval(id)
      db.removeChannel(canal)
    }
  }, [tecnico, cargar])

  // Al volver a C. Frío, refrescar el estado del recibo (el gate "no entra sin
  // recibo" es por DB): un recibo en PAGO PENDIENTE no toca `servicios`, así que
  // el realtime no lo detecta — esta recarga garantiza `tiene_recibo` al día.
  useEffect(() => {
    if (tab === 'cuarto_frio') cargar(true)
  }, [tab, cargar])

  // Obtener IDs de coordinadores/admins para notificarlos
  async function getCoordinadores() {
    const { data } = await db.from('personal')
      .select('id, nombre, apellido')
      .in('rol_principal_id', [1, 6]) // COORDINADOR=1, ADMIN=6
      .eq('activo', true)
    return data || []
  }

  // La UI del técnico puede estar desactualizada cuando coordinación cancela:
  // verificar contra DB antes de cualquier acción operativa sobre el servicio
  async function estaCancelado(svcId) {
    const { data } = await db.from('servicios').select('estado').eq('id', svcId).maybeSingle()
    return data?.estado === 'CANCELADO'
  }

  async function iniciarRecogida(svc, hora) {
    if (await estaCancelado(svc.id)) {
      alert('⚠️ Este servicio fue cancelado por coordinación. No realices la recogida.')
      await cargar()
      return
    }
    const { error } = await db.from('servicios').update({ estado: 'EN_RECOGIDA' }).eq('id', svc.id)
    if (error) throw new Error(error.message)
    const recogidaId = svc.recogidas?.[0]?.id
    if (recogidaId && hora) {
      await db.from('recogidas').update({ hora_programada: hora }).eq('id', recogidaId)
    }
    // Notificar a todos los coordinadores
    const coords = await getCoordinadores()
    const mascotaNombre = svc.mascotas?.nombre || 'la mascota'
    const recogida = svc.recogidas?.[0]
    const tipoLugar = recogida?.tipo_lugar
    const lugar = recogida?.contacto_nombre || svc.direccion_recogida || 'destino'
    const waCliente = svc.mascotas?.clientes?.whatsapp
    const waTelContacto = recogida?.contacto_telefono
    await Promise.all(coords.map(c => crearNotificacion({
      para_personal_id: c.id,
      de_personal_id:   tecnico?.id,
      tipo:             'TECNICO_INICIO_RUTA',
      titulo:           `${tecnico?.nombre} inició ruta`,
      mensaje:          `Sale a recoger a ${mascotaNombre}. Hora estimada: ${hora}. Destino: ${lugar}`,
      servicio_id:      svc.id,
      datos: {
        hora_llegada:   hora,
        mascota:        mascotaNombre,
        lugar,
        direccion:      svc.direccion_recogida || lugar,
        tipo_lugar:     tipoLugar,
        tecnico_nombre: `${tecnico?.nombre || ''} ${tecnico?.apellido || ''}`.trim(),
        wa_cliente:     tipoLugar !== 'CLINICA_ALIADA' ? waCliente : null,
        wa_aliado:      tipoLugar === 'CLINICA_ALIADA'  ? (waTelContacto || waCliente) : null,
      },
    })))
    await cargar()
  }

  // Sella la hora REAL de llegada al sitio. Entre llegar y completar la recogida
  // (foto + recibo) pueden pasar 30 minutos, así que hora_realizada no sirve para
  // medir cumplimiento de la cita ni tiempo en sitio.
  async function confirmarLlegadaRecogida(svc, recogidaId) {
    if (await estaCancelado(svc.id)) {
      await cargar()
      throw new Error('Este servicio fue cancelado por coordinación. No realices la recogida — comunícate con el coordinador.')
    }
    if (!recogidaId) throw new Error('Esta recogida no tiene registro asociado. Avisa al coordinador.')

    // Idempotente: doble toque o reintento con señal mala NO debe pisar la hora
    // original de llegada. Se verifica contra DB, no contra el estado en memoria.
    const { data: rec } = await db.from('recogidas')
      .select('hora_llegada').eq('id', recogidaId).maybeSingle()
    if (rec?.hora_llegada) { await cargar(); return }

    const now   = new Date()
    const fecha = hoyLocalISO(now)
    const hora  = now.toTimeString().slice(0, 5)

    const { error } = await db.from('recogidas').update({
      fecha_llegada:          fecha,
      hora_llegada:           hora,
      llegada_registrada_por: tecnico?.id || null,
    }).eq('id', recogidaId)
    if (error) throw new Error(error.message)

    // La hora ya quedó sellada: si falla la bitácora o el aviso, no se bloquea
    // al técnico ni se le pide repetir el paso.
    try {
      const mascotaNombre = svc.mascotas?.nombre || 'la mascota'
      const recogida = svc.recogidas?.[0]
      const lugar    = recogida?.contacto_nombre || svc.direccion_recogida || 'destino'
      const estimada = recogida?.hora_programada ? String(recogida.hora_programada).slice(0, 5) : null

      await db.from('novedades_servicio').insert({
        servicio_id:    svc.id,
        tipo_novedad:   'NOTA',
        descripcion:    `📍 ${tecnico?.nombre || 'El técnico'} confirmó llegada al sitio a las ${hora}.${estimada ? ` Hora estimada al iniciar ruta: ${estimada}.` : ''}`,
        registrado_por: tecnico?.id || null,
      })

      const coords = await getCoordinadores()
      await Promise.all(coords.map(c => crearNotificacion({
        para_personal_id: c.id,
        de_personal_id:   tecnico?.id,
        tipo:             'TECNICO_LLEGADA',
        titulo:           `${tecnico?.nombre} llegó al sitio`,
        mensaje:          `Llegó a recoger a ${mascotaNombre} a las ${hora}. Lugar: ${lugar}`,
        servicio_id:      svc.id,
        datos: {
          hora_llegada:   hora,
          fecha_llegada:  fecha,
          hora_estimada:  estimada,
          mascota:        mascotaNombre,
          lugar,
          tecnico_nombre: `${tecnico?.nombre || ''} ${tecnico?.apellido || ''}`.trim(),
        },
      })))
    } catch (e) {
      console.error('[llegada] hora registrada, falló el aviso:', e?.message)
    }

    setNotif(`📍 Llegada registrada a las ${hora}.`)
    setTimeout(() => setNotif(null), 5000)
    await cargar()
  }

  async function declinarRecogida(svc, motivo) {
    const coords = await getCoordinadores()
    const mascotaNombre = svc.mascotas?.nombre || 'la mascota'
    await Promise.all(coords.map(c => crearNotificacion({
      para_personal_id: c.id,
      de_personal_id:   tecnico?.id,
      tipo:             'TECNICO_DECLINA',
      titulo:           `${tecnico?.nombre} no puede aceptar`,
      mensaje:          `No puede recoger a ${mascotaNombre}. ${motivo ? `Motivo: ${motivo}` : ''} Reasignar técnico.`,
      servicio_id:      svc.id,
      datos:            { motivo },
    })))
  }

  async function reportarProblemaRuta(svc, motivo) {
    const mascotaNombre = svc.mascotas?.nombre || 'la mascota'

    // 1. Revertir a INGRESADO y limpiar técnico asignado
    await db.from('servicios').update({
      estado:     'INGRESADO',
      tecnico_id: null,
    }).eq('id', svc.id)
    await db.from('recogidas').update({ tecnico_id: null }).eq('servicio_id', svc.id)

    // 2. Registrar novedad en el servicio
    await db.from('novedades_servicio').insert({
      servicio_id:    svc.id,
      tipo_novedad:   'NOTA',
      descripcion:    `⚠️ Problema en ruta reportado por ${tecnico?.nombre || 'el técnico'}. ${motivo ? `Motivo: ${motivo}` : ''} Servicio devuelto a INGRESADO para reasignación.`,
      registrado_por: tecnico?.id || null,
    })

    // 3. Notificar coordinadores con alerta urgente
    const coords = await getCoordinadores()
    await Promise.all(coords.map(c => crearNotificacion({
      para_personal_id: c.id,
      de_personal_id:   tecnico?.id,
      tipo:             'TECNICO_PROBLEMA_RUTA',
      titulo:           `⚠️ Problema en ruta — ${tecnico?.nombre}`,
      mensaje:          `No puede completar la recogida de ${mascotaNombre}. ${motivo ? `Motivo: ${motivo}` : ''} Reasignar urgente.`,
      servicio_id:      svc.id,
      datos:            { motivo, mascota: mascotaNombre },
    })))

    await cargar()
  }

  async function completarRecogida(svc, recogidaId, valorCobrado = 0) {
    if (await estaCancelado(svc.id)) {
      await cargar()
      throw new Error('Este servicio fue cancelado por coordinación. No completes la recogida — comunícate con el coordinador.')
    }
    const { error } = await db.from('servicios').update({ estado: 'EN_CUARTO_FRIO' }).eq('id', svc.id)
    if (error) throw new Error(error.message)

    if (valorCobrado > 0) {
      const nuevoPagado = (svc.valor_pagado || 0) + valorCobrado
      const total = svc.valor_total || 0
      const nuevoEstado = nuevoPagado >= total ? 'COMPLETO' : 'PARCIAL'
      await db.from('servicios').update({
        valor_pagado: nuevoPagado,
        estado_pago:  nuevoEstado,
      }).eq('id', svc.id)
      const pendienteRestante = total - nuevoPagado
      await db.from('novedades_servicio').insert({
        servicio_id:    svc.id,
        tipo_novedad:   'PAGO_RECIBIDO',
        descripcion:    nuevoEstado === 'COMPLETO'
          ? `Técnico recogió ${fmt(valorCobrado)} — pago completo`
          : `Técnico recogió ${fmt(valorCobrado)}. Queda pendiente: ${fmt(pendienteRestante)}`,
        valor_ajuste:   valorCobrado,
        registrado_por: tecnico?.id || null,
      })
    }

    if (recogidaId) {
      const now = new Date()
      await db.from('recogidas').update({
        fecha_realizada: hoyLocalISO(now),
        hora_realizada:  now.toTimeString().slice(0, 5),
      }).eq('id', recogidaId)
    }

    // Ítems que el técnico entrega/recoge en la recogida (huella mechón, cápsula,
    // amuleto, evidencias…) pasan solos a EN_PROCESO: ya no exigen el paso de
    // "iniciar" en Producción, solo el cierre. No bloquea la recogida si falla.
    try {
      const { data: itemsTec } = await db.from('servicio_recordatorios')
        .select('id, estado, recordatorios(recolecta_tecnico)')
        .eq('servicio_id', svc.id)
        .neq('origen', 'REMOVIDO')
      const idsTec = (itemsTec || [])
        .filter(i => i.estado === 'PENDIENTE' && i.recordatorios?.recolecta_tecnico)
        .map(i => i.id)
      if (idsTec.length) {
        await db.from('servicio_recordatorios')
          .update({ estado: 'EN_PROCESO' })
          .in('id', idsTec)
      }
    } catch (_) { /* no bloquea la recogida */ }

    setNotif('✅ Recogida completada. Genera el recibo para poder ingresar la mascota al cuarto frío.')
    setTimeout(() => setNotif(null), 8000)
    await cargar()
    // Flujo guiado: ir directo al recibo de ESTA mascota (ReciboTab lo auto-abre
    // vía tecnico_recibo_sel). La mascota no entra al cuarto frío sin recibo.
    try { localStorage.setItem('tecnico_recibo_sel', svc.id) } catch (_) {}
    setTab('recibo')
  }

  async function confirmarCuartoFrio(svc, { cfId, peso, nevera, fotoUrl }) {
    // Gate por DB (defensa en profundidad ante UI desactualizada): la mascota
    // no entra al cuarto frío sin recibo generado. No confía en el estado en
    // memoria — verifica contra recibos_tecnico igual que estaCancelado().
    const { data: reciboExiste } = await db.from('recibos_tecnico')
      .select('id').eq('servicio_id', svc.id).limit(1).maybeSingle()
    if (!reciboExiste) {
      await cargar()
      throw new Error('Genera el recibo antes de ingresar la mascota al cuarto frío.')
    }
    const pesoNum = parseFloat(peso) || null
    const datosCF = {
      nevera_codigo:   nevera,
      peso_kg:         pesoNum,
      estado:          'REFRIGERADO',
      foto_pesaje_url: fotoUrl || null,
    }
    let cuartoFrioId = cfId
    if (cfId) {
      const { error } = await db.from('cuarto_frio').update(datosCF).eq('id', cfId)
      if (error) throw new Error(error.message)
    } else {
      // El trigger de DB debió crear la fila al crear el servicio; si no existe
      // (servicio antiguo), crearla aquí — antes nevera/peso/foto se perdían en silencio
      const { data, error } = await db.from('cuarto_frio')
        .insert({ servicio_id: svc.id, ...datosCF }).select('id').single()
      if (error) throw new Error(error.message)
      cuartoFrioId = data?.id
    }

    // Hora REAL de ingreso a la nevera + bitácora. La nevera ya quedó guardada:
    // si esto falla no se bloquea al técnico ni se le pide repetir el paso.
    try {
      await registrarIngresoCuartoFrio(cuartoFrioId, {
        personalId:  tecnico?.id || null,
        neveraNueva: nevera,
        notas:       `Ingreso registrado por ${tecnico?.nombre || 'el técnico'}${pesoNum ? ` · ${pesoNum} kg` : ''}`,
      })
    } catch (e) {
      console.error('[cuarto frío] nevera guardada, falló el sello de hora:', e?.message)
    }
    // El peso de báscula pasa a ser el oficial para la mascota
    if (pesoNum && svc.mascotas?.id_mascota) {
      const pesoPrevio = parseFloat(svc.mascotas?.peso_kg) || 0
      await db.from('mascotas').update({ peso_kg: pesoNum }).eq('id_mascota', svc.mascotas.id_mascota)
      // Si el peso de báscula cambió de rango, el precio del servicio se actualiza
      // automáticamente (en silencio: el técnico no gestiona precios). Centralizado
      // en lib/precios.js para que el valor siga al peso oficial.
      if (Math.abs(pesoNum - pesoPrevio) > 0.01) {
        try { await aplicarRecalculoPorPeso(svc.mascotas.id_mascota, pesoNum, svc.mascotas?.especie_id) } catch (_) {}
      }
    }
    await cargar()
  }

  async function aceptarEntrega(ent) {
    const { error } = await db.from('entregas').update({ estado: 'EN_CAMINO' }).eq('id', ent.id)
    if (error) throw new Error(error.message)
    await db.from('servicios').update({ estado: 'EN_ENTREGA' }).eq('id', ent.servicio_id)
    // Notificar coordinadores
    const coords = await getCoordinadores()
    const mascota = ent.servicios?.mascotas?.nombre || 'mascota'
    await Promise.all(coords.map(c => crearNotificacion({
      para_personal_id: c.id,
      de_personal_id:   tecnico?.id,
      tipo:             'ENTREGA_EN_CAMINO',
      titulo:           `${tecnico?.nombre} salió a entregar`,
      mensaje:          `Entrega de ${mascota} en camino. Dir: ${ent.direccion_entrega || '—'}`,
      servicio_id:      ent.servicio_id,
    })))
    await cargar()
  }

  async function completarEntrega(ent, { fotoUrl, firmaDataUrl, nombreCliente }) {
    const now = new Date()
    const patch = {
      estado:           'ENTREGADA',
      fecha_realizada:  hoyLocalISO(now),
      hora_realizada:   now.toTimeString().slice(0, 5),
      foto_entrega_url: fotoUrl || null,
    }

    // Subir firma si existe
    if (firmaDataUrl) {
      try {
        const blob  = await (await fetch(firmaDataUrl)).blob()
        const path  = `entregas/firmas/${ent.id}_${Date.now()}.png`
        const { data: up } = await db.storage.from('evidencias').upload(path, blob, { upsert: true, contentType: 'image/png' })
        if (up) {
          const { data: { publicUrl } } = db.storage.from('evidencias').getPublicUrl(up.path)
          patch.foto_firma_url = publicUrl
        }
      } catch (_) { /* no bloquear si falla subida firma */ }
    }

    const { error } = await db.from('entregas').update(patch).eq('id', ent.id)
    if (error) throw new Error(error.message)

    await db.from('servicios').update({ estado: 'ENTREGADO' }).eq('id', ent.servicio_id)

    // Notificar coordinadores
    const coords = await getCoordinadores()
    const mascota = ent.servicios?.mascotas?.nombre || 'mascota'
    await Promise.all(coords.map(c => crearNotificacion({
      para_personal_id: c.id,
      de_personal_id:   tecnico?.id,
      tipo:             'ENTREGA_COMPLETADA',
      titulo:           'Entrega completada',
      mensaje:          `${mascota} entregada a ${nombreCliente || ent.contacto_nombre || 'el cliente'}.`,
      servicio_id:      ent.servicio_id,
    })))

    await cargar()
  }

  const sinReporteHoy = !reporteHoy
  // Orden = flujo real del técnico: recoger → recibo → comprobante → cuarto frío → entregar
  const TABS = [
    { key: 'recogidas',   label: 'Recogidas', Icon: Truck,     count: recogidas.length,      color: '#1A5CD8' },
    { key: 'recibo',      label: 'Recibos',   Icon: CreditCard, count: 0,                    color: '#7C3AED' },
    { key: 'comprobantes', label: 'Comprob.',  Icon: Receipt,   count: compPend,             color: '#EA580C' },
    { key: 'cuarto_frio', label: 'C. Frío',   Icon: Snowflake, count: pendientesCF.length + (sinReporteHoy ? 1 : 0), color: '#0E7490' },
    { key: 'entregas',    label: 'Entregas',  Icon: Package,   count: entregas.length,       color: '#1A5CD8' },
    { key: 'mis_cuadres', label: 'Mis pagos', Icon: Wallet,    count: cuadresPend,           color: '#16a34a' },
  ]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F3F4F6', maxWidth: 520, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ background: '#0B1D4F' }} className="px-5 pb-4 pt-safe pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-black"
              style={{ background: '#C4A87A', color: '#0B1D4F' }}>
              🐾
            </div>
            <div>
              <div className="text-white font-bold text-[15px] leading-tight">{tecnico.nombre} {tecnico.apellido}</div>
              <div className="text-[11px]" style={{ color: '#C4A87A' }}>
                Técnico · Camino al Cielo{tecnico.tipo_vehiculo ? ` · ${tecnico.tipo_vehiculo}` : ''}
                <span style={{ opacity: 0.55 }}> · v{typeof __ORBIT_BUILD__ !== 'undefined' ? __ORBIT_BUILD__ : 'dev'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => cargar()} className="p-2 rounded-full active:opacity-70" style={{ color: '#9CA3AF' }}>
              <RefreshCw size={16} />
            </button>
            <button onClick={logout} className="p-2 rounded-full active:opacity-70" style={{ color: '#9CA3AF' }}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {queryErr && (
        <div className="mx-4 mt-3 flex items-start gap-2.5 px-4 py-3 rounded-xl"
          style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#991B1B' }}>Error al cargar</p>
            <p className="text-xs mt-0.5" style={{ color: '#B91C1C' }}>{queryErr}</p>
          </div>
        </div>
      )}

      {storageRoto && (
        <div className="mx-4 mt-3 flex items-start gap-2.5 px-4 py-3 rounded-xl"
          style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#991B1B' }}>Almacenamiento del teléfono casi lleno</p>
            <p className="text-xs mt-0.5" style={{ color: '#B91C1C' }}>
              Orbit no puede guardar datos en este teléfono ({storageRoto}). Por eso se
              pierden fotos y borradores al reiniciarse. <b>Libera espacio en el teléfono</b>
              (borra videos/apps que no uses) y vuelve a intentar.
            </p>
          </div>
        </div>
      )}

      {avisoGaleria && (
        <div className="mx-4 mt-3 flex items-start gap-2.5 px-4 py-3 rounded-xl"
          style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#991B1B' }}>El teléfono reinició Orbit al abrir la galería</p>
            <p className="text-xs mt-0.5" style={{ color: '#B91C1C' }}>
              La imagen no alcanzó a llegar — vuelve a seleccionarla. Si pasa seguido:
              cierra las demás apps abiertas y reintenta, o usa el botón <b>Cámara</b>.
            </p>
          </div>
          <button onClick={() => setAvisoGaleria(false)} className="p-1" style={{ color: '#DC2626' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {notif && (
        <div className="mx-4 mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
          <Bell size={16} className="flex-shrink-0" style={{ color: '#D97706' }} />
          <span className="text-sm font-semibold" style={{ color: '#92400E' }}>{notif}</span>
        </div>
      )}

      {/* Aviso: hay cuadre(s) esperando la firma del técnico. Sin su confirmación
          gerencia no puede cerrar el cuadre (migración 038), así que este aviso
          es la "notificación" — aparece apenas abre la app, en cualquier pestaña. */}
      {cuadresPend > 0 && tab !== 'mis_cuadres' && (
        <button
          onClick={() => {
            try { localStorage.setItem('tecnico_pagos_vista', 'cuadres') } catch (_) {}
            setTab('mis_cuadres')
          }}
          className="mx-4 mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl text-left active:scale-[0.99] transition-transform"
          style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
          <Wallet size={16} className="flex-shrink-0" style={{ color: '#16a34a' }} />
          <span className="text-sm font-semibold flex-1" style={{ color: '#166534' }}>
            {cuadresPend === 1 ? 'Tu cuadre está listo para que lo revises y firmes' : `Tienes ${cuadresPend} cuadres por revisar y firmar`}
            <span className="block text-[11px] font-normal mt-0.5" style={{ color: '#15803D' }}>
              Gerencia no puede cerrarlo sin tu confirmación — toca aquí para verlo.
            </span>
          </span>
          <span className="text-[18px]" style={{ color: '#16a34a' }}>›</span>
        </button>
      )}

      {/* ── Contenido — padding-bottom para no quedar tapado por la nav ── */}
      <div className="flex-1 p-4 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <div className="spinner" /><span className="text-sm">Cargando…</span>
          </div>
        ) : tab === 'recogidas' ? (
          recogidas.length === 0
            ? <EmptyState icon="🚐" texto="Sin recogidas asignadas" sub="Cuando el coordinador te asigne una recogida, aparecerá aquí." />
            : <RecogidaList
                recogidas={recogidas} tecnico={tecnico}
                neverasList={neverasActivas}
                onIniciar={iniciarRecogida}
                onConfirmarLlegada={confirmarLlegadaRecogida}
                onCompletar={completarRecogida}
                onCuartoFrio={confirmarCuartoFrio}
                onDeclinar={declinarRecogida}
                onReportarProblema={reportarProblemaRuta}
              />
        ) : tab === 'entregas' ? (
          entregas.length === 0
            ? <EmptyState icon="📦" texto="Sin entregas asignadas" sub="Cuando te asignen una entrega, aparecerá aquí." />
            : entregas.map(e => (
                <CardEntrega key={e.id} ent={e} tecnico={tecnico}
                  onAceptar={aceptarEntrega} onCompletar={completarEntrega} />
              ))
        ) : tab === 'cuarto_frio' ? (
          <div className="space-y-4">

            {/* ── Pendientes de registro en C. Frío ── */}
            {pendientesCF.length > 0 && (
              <div>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3 text-sm font-semibold"
                  style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  {pendientesCF.length} mascota{pendientesCF.length > 1 ? 's' : ''} pendiente{pendientesCF.length > 1 ? 's' : ''} de ingreso al cuarto frío
                </div>
                {pendientesCF.map(svc => {
                  const mascota = svc.mascotas
                  const emoji   = petEmoji(mascota?.especies?.nombre)
                  return (
                    <div key={svc.id} className="bg-white rounded-2xl border p-4 mb-3 shadow-sm"
                      style={{ borderColor: '#FDE68A', borderWidth: 2 }}>
                      <div className="flex items-center gap-3 mb-3">
                        <span style={{ fontSize: 28 }}>{emoji}</span>
                        <div>
                          <div className="font-bold text-gray-900 text-base">{mascota?.nombre || '—'}</div>
                          <div className="text-[11px] text-gray-500">
                            {mascota?.clientes?.nombre} {mascota?.clientes?.apellido}
                            {mascota?.peso_kg ? ` · ${mascota.peso_kg} kg` : ''}
                          </div>
                        </div>
                      </div>
                      {svc.tiene_recibo ? (
                        <RegistroCuartoFrio
                          svc={svc}
                          onCompletar={confirmarCuartoFrio}
                          neverasList={neverasActivas}
                        />
                      ) : (
                        <div className="mt-1">
                          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-3"
                            style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
                            <Receipt size={15} style={{ color: '#7C3AED', flexShrink: 0, marginTop: 1 }} />
                            <span className="text-[12px] font-semibold" style={{ color: '#5B21B6' }}>
                              Genera el recibo antes de ingresar la mascota al cuarto frío.
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              try { localStorage.setItem('tecnico_recibo_sel', svc.id) } catch (_) {}
                              setTab('recibo')
                            }}
                            className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98"
                            style={{ background: '#7C3AED', color: '#fff' }}>
                            Generar recibo →
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Reporte del cuarto frío ── */}
            <ReporteCuartoFrio
              tecnico={tecnico}
              neverasActivas={neverasActivas}
              reporteHoy={reporteHoy}
              onGuardado={() => cargar(true)}
            />

            {/* ── Mascotas ya registradas con nevera ── */}
            <MisCuartoFrioSection
              misCF={misCF}
              tecnico={tecnico}
              neverasList={neverasActivas}
              onRefresh={() => cargar(true)}
            />
          </div>
        ) : tab === 'recibo' ? (
          <ReciboTab tecnico={tecnico} />
        ) : tab === 'comprobantes' ? (
          <ComprobanteTab tecnico={tecnico} onCount={setCompPend} />
        ) : tab === 'mis_cuadres' ? (
          <MisCuadresTab tecnico={tecnico} />
        ) : null}
      </div>

      {/* ── Nav inferior fija ── */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full"
        style={{ maxWidth: 520, background: '#fff', borderTop: '1px solid #E5E7EB', paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
        <div className="flex">
          {TABS.map(({ key, Icon, count, color }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex-1 py-3 flex flex-col items-center justify-center gap-0.5 relative transition-colors"
              style={{ color: tab === key ? color : '#9CA3AF' }}>
              <div className="relative">
                <Icon size={22} />
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-2 text-[9px] font-bold min-w-[16px] h-[16px] rounded-full inline-flex items-center justify-center px-0.5"
                    style={{ background: color, color: '#fff' }}>
                    {count}
                  </span>
                )}
              </div>
              {tab === key && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                  style={{ background: color }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── SECCIONES ORDENADAS POR FASE ─────────────────────────────────────
function SeccionHeader({ color, dot, emoji, titulo, count }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>
        {emoji} {titulo}
      </span>
      <span className="text-[10px] font-bold min-w-[18px] h-[18px] rounded-full inline-flex items-center justify-center px-1"
        style={{ background: color, color: '#fff' }}>
        {count}
      </span>
    </div>
  )
}

function RecogidaList({ recogidas, tecnico, neverasList = NEVERAS_DEFAULT, onIniciar, onConfirmarLlegada, onCompletar, onCuartoFrio, onDeclinar, onReportarProblema }) {
  const [busqueda,    setBusqueda]    = useState('')
  const [filtroFecha, setFiltroFecha] = useState('')

  const filtradas = recogidas.filter(s => {
    if (filtroFecha && s.fecha_ingreso?.slice(0, 10) !== filtroFecha) return false
    if (busqueda) {
      const q = busqueda.toLowerCase()
      const nombre   = s.mascotas?.nombre?.toLowerCase() || ''
      const cliente  = `${s.mascotas?.clientes?.nombre || ''} ${s.mascotas?.clientes?.apellido || ''}`.toLowerCase()
      const plan     = s.planes?.nombre?.toLowerCase() || ''
      if (!nombre.includes(q) && !cliente.includes(q) && !plan.includes(q)) return false
    }
    return true
  })

  const porRecoger = filtradas.filter(s => s.estado === 'INGRESADO')
  const enCamino   = filtradas.filter(s => s.estado === 'EN_RECOGIDA' && !yaLlegoAlSitio(s))
  const enSitio    = filtradas.filter(s => s.estado === 'EN_RECOGIDA' &&  yaLlegoAlSitio(s))
  const cuartoFrio = filtradas.filter(s => s.estado === 'EN_CUARTO_FRIO')

  const cardProps = { tecnico, neverasList, onIniciar, onConfirmarLlegada, onCompletar, onCuartoFrio, onDeclinar, onReportarProblema }

  return (
    <div>
      {/* Barra de filtros */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[13px]">🔍</span>
          <input
            type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Mascota, cliente o plan…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border text-[12px] outline-none"
            style={{ borderColor: busqueda ? '#1A5CD8' : '#E5E7EB', background: '#fff' }}
          />
        </div>
        <input
          type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          className="px-2 py-2 rounded-xl border text-[12px] outline-none"
          style={{ borderColor: filtroFecha ? '#1A5CD8' : '#E5E7EB', background: '#fff', width: 130 }}
        />
        {(busqueda || filtroFecha) && (
          <button onClick={() => { setBusqueda(''); setFiltroFecha('') }}
            className="px-2 py-2 rounded-xl text-gray-400 hover:text-gray-600 text-[13px]">✕</button>
        )}
      </div>

      {filtradas.length === 0 && (busqueda || filtroFecha) && (
        <div className="text-center py-8 text-gray-400 text-sm">Sin resultados para el filtro aplicado</div>
      )}

      {porRecoger.length > 0 && (
        <div>
          <SeccionHeader color="#D97706" dot="#FEF3C7" emoji="🕐" titulo="Por recoger" count={porRecoger.length} />
          {porRecoger.map(r => <CardRecogida key={r.id} svc={r} {...cardProps} />)}
        </div>
      )}
      {enCamino.length > 0 && (
        <div>
          <SeccionHeader color="#1E40AF" dot="#DBEAFE" emoji="🚐" titulo="En camino" count={enCamino.length} />
          {enCamino.map(r => <CardRecogida key={r.id} svc={r} {...cardProps} />)}
        </div>
      )}
      {enSitio.length > 0 && (
        <div>
          <SeccionHeader color="#7C3AED" dot="#EDE9FE" emoji="📍" titulo="En sitio" count={enSitio.length} />
          {enSitio.map(r => <CardRecogida key={r.id} svc={r} {...cardProps} />)}
        </div>
      )}
      {cuartoFrio.length > 0 && (
        <div>
          <SeccionHeader color="#0E7490" dot="#CFFAFE" emoji="❄️" titulo="Ingresar al cuarto frío" count={cuartoFrio.length} />
          {cuartoFrio.map(r => <CardRecogida key={r.id} svc={r} {...cardProps} />)}
        </div>
      )}
    </div>
  )
}

// ─── MIS CUADRES (técnico ve sus pagos de cuadres CERRADOS) ────────────
function MisCuadresTab({ tecnico }) {
  // 'bitacora' | 'cuadres' — el aviso de cuadre pendiente abre directo en Cuadres
  // (deja la vista en localStorage antes de cambiar de pestaña; se lee y se limpia)
  const [vista, setVista] = useState(() => {
    try {
      const v = localStorage.getItem('tecnico_pagos_vista')
      if (v) {
        localStorage.removeItem('tecnico_pagos_vista')
        if (v === 'cuadres' || v === 'bitacora') return v
      }
    } catch (_) { /* privado/incógnito */ }
    return 'bitacora'
  })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-gray-100">
        {[['bitacora', '📒 Bitácora'], ['cuadres', '💵 Cuadres']].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`py-2 rounded-xl text-[13px] font-bold transition-all ${vista === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}>
            {l}
          </button>
        ))}
      </div>
      {vista === 'bitacora' ? <BitacoraTab tecnico={tecnico} /> : <CuadresList tecnico={tecnico} />}
    </div>
  )
}

// ─── MIS CUADRES (cerrados + borradores en revisión con confirmación) ───────
function CuadresList({ tecnico }) {
  const [cuadres, setCuadres]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [items, setItems]       = useState({})
  const [confirmando, setConfirmando] = useState(null)  // cuadre_id en proceso
  const [obsAbierta, setObsAbierta]   = useState(null)  // cuadre_id con textarea abierta
  const [obsTexto, setObsTexto]       = useState('')

  useEffect(() => { cargar() }, [tecnico?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    if (!tecnico?.id) { setLoading(false); return }
    setLoading(true)
    const { data } = await db.from('cuadres_tecnico')
      .select('*')
      .eq('tecnico_id', tecnico.id)
      .order('fecha_hasta', { ascending: false })
    setCuadres(data || [])
    setLoading(false)
  }

  async function toggle(c) {
    if (expandido === c.id) { setExpandido(null); return }
    setExpandido(c.id)
    if (!items[c.id]) {
      const { data } = await db.from('cuadre_items').select('*').eq('cuadre_id', c.id).order('fecha')
      setItems(prev => ({ ...prev, [c.id]: data || [] }))
    }
  }

  // Confirmación del borrador: guarda quién/cuándo + snapshot del monto. Si el
  // coordinador regenera y el monto cambia, la confirmación queda desactualizada.
  async function confirmar(c, observacion) {
    setConfirmando(c.id)
    try {
      const { data, error } = await db.rpc('confirmar_cuadre_por_tecnico', {
        p_cuadre_id:   c.id,
        p_tecnico_id:  tecnico.id,
        p_observacion: observacion || null,
      })
      if (error) throw error
      setCuadres(prev => prev.map(x => x.id === c.id ? {
        ...x,
        tecnico_confirmado_en:    data.tecnico_confirmado_en,
        tecnico_confirmado_monto: data.tecnico_confirmado_monto,
        tecnico_observacion:      data.tecnico_observacion,
      } : x))
      setObsAbierta(null); setObsTexto('')
    } catch (e) {
      alert('Error al confirmar: ' + (e.message || e))
    } finally {
      setConfirmando(null)
    }
  }

  const cerrados    = cuadres.filter(c => c.estado === 'CERRADO')
  const totalGanado = cerrados.reduce((a, c) => a + (Number(c.total_reconocido) || 0), 0)
  const fechaCorta  = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
  const fechaHora   = ts => ts ? new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Cargando…</div>
  if (!cuadres.length) return <EmptyState icon="💵" texto="Aún no tienes cuadres" sub="Cuando el coordinador arme tu cuadre de cuentas, aquí lo revisas y confirmas." />

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#15803d,#16a34a)' }}>
        <div className="text-[11px] font-semibold text-white/70 uppercase tracking-wide">Total ganado (cuadres cerrados)</div>
        <div className="text-[28px] font-extrabold tabular-nums leading-tight mt-0.5">{fmt(totalGanado)}</div>
        <div className="text-[11px] text-white/60">{cerrados.length} cuadre{cerrados.length !== 1 ? 's' : ''} cerrado{cerrados.length !== 1 ? 's' : ''}</div>
      </div>

      {cuadres.map(c => {
        const abierto  = expandido === c.id
        const borrador = c.estado === 'BORRADOR'
        const confirmado     = !!c.tecnico_confirmado_en
        const desactualizada = confirmado && Number(c.tecnico_confirmado_monto) !== Number(c.dinero_a_entregar)
        const confirmVigente = confirmado && !desactualizada
        return (
          <div key={c.id} className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: borrador ? '#FCD34D' : '#E5E7EB' }}>
            <button onClick={() => toggle(c)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
              <div className="flex-1">
                <div className="font-bold text-gray-900 text-[13px] flex items-center gap-1.5 flex-wrap">
                  {fechaCorta(c.fecha_desde)} → {fechaCorta(c.fecha_hasta)}
                  {borrador && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">EN REVISIÓN</span>}
                </div>
                <div className="text-[11px] text-gray-400">{c.total_servicios} servicio{c.total_servicios !== 1 ? 's' : ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-extrabold tabular-nums text-[#16a34a]">{fmt(c.total_reconocido)}</div>
                <div className="text-[10px] text-gray-400">ganado</div>
              </div>
              {abierto ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            {abierto && (
              <div className="border-t px-4 py-3" style={{ borderColor: '#F3F4F6' }}>
                {borrador && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2 pb-2 border-b" style={{ borderColor: '#F3F4F6' }}>
                    <MiLinea label="Recogido (clientes)" val={c.total_cobrado} />
                    <MiLinea label="Digital → empresa" val={c.digital_empresa} />
                    <MiLinea label="Efectivo en tu poder" val={c.efectivo_recibido} />
                    <div className="flex justify-between text-[12px]">
                      <span className="font-bold text-gray-700">Efectivo a entregar</span>
                      <span className="font-extrabold text-gray-900 tabular-nums">{fmt(c.dinero_a_entregar)}</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                  <MiLinea label="Transporte" val={c.total_transporte} />
                  <MiLinea label="Pago servicios" val={c.total_pago_servicio} />
                  <MiLinea label="Recargos" val={c.total_recargos} />
                  <MiLinea label="Cancelados" val={c.total_cancelados} />
                </div>
                <div className="space-y-0.5">
                  {(items[c.id] || []).map(it => {
                    const ganado = (Number(it.transporte_reconocido) || 0) + (Number(it.recargo_aplicado) || 0) + (Number(it.pago_servicio) || 0)
                    return (
                      <div key={it.id} className="flex items-center justify-between text-[12px] py-1 border-b" style={{ borderColor: '#F3F4F6' }}>
                        <span className="text-gray-600">
                          {it.mascota_nombre || '—'}
                          {it.es_cancelado && <span className="ml-1 text-[9px] font-bold text-red-500">CANC</span>}
                          {it.sin_recibo && <span className="ml-1 text-[9px] font-bold text-rose-500">SIN RECIBO</span>}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-800">{fmt(ganado)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Confirmación del técnico (solo borradores) */}
            {borrador && (
              <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
                {confirmVigente ? (
                  <div className="text-[12px] text-green-700 font-semibold flex items-start gap-1.5">
                    <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>
                      Confirmaste este cuadre el {fechaHora(c.tecnico_confirmado_en)}.
                      {c.tecnico_observacion && <span className="block font-normal text-gray-600 mt-0.5">Tu observación: “{c.tecnico_observacion}”</span>}
                    </span>
                  </div>
                ) : (
                  <>
                    <p className="text-[12px] text-amber-800">
                      {desactualizada
                        ? 'El cuadre cambió después de tu confirmación — revísalo y confirma de nuevo.'
                        : 'Revisa tu cuadre y confírmalo antes de que el coordinador lo cierre.'}
                    </p>
                    {obsAbierta === c.id ? (
                      <div className="space-y-2">
                        <textarea rows={3} value={obsTexto} onChange={e => setObsTexto(e.target.value)} autoFocus
                          placeholder="Ej: la recogida de LUNA fue en Chía, falta el transporte…"
                          className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none resize-none bg-white"
                          style={{ borderColor: '#FCD34D' }} />
                        <div className="flex gap-2">
                          <button onClick={() => confirmar(c, obsTexto.trim())} disabled={confirmando === c.id || !obsTexto.trim()}
                            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                            style={{ background: '#D97706' }}>
                            {confirmando === c.id ? 'Enviando…' : 'Enviar observación'}
                          </button>
                          <button onClick={() => { setObsAbierta(null); setObsTexto('') }}
                            className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border" style={{ borderColor: '#E5E7EB' }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => confirmar(c, null)} disabled={confirmando === c.id}
                          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                          style={{ background: '#16a34a' }}>
                          {confirmando === c.id ? 'Confirmando…' : '✓ Estoy de acuerdo'}
                        </button>
                        <button onClick={() => setObsAbierta(c.id)} disabled={confirmando === c.id}
                          className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-amber-700 bg-white border transition-all active:scale-95"
                          style={{ borderColor: '#FCD34D' }}>
                          Tengo una observación
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── MI BITÁCORA — la planilla del técnico, automática (solo lectura) ────────
// Igual a la planilla de papel: día a día qué recogió, a qué hora, cuánto
// cobró y por qué medio, qué quedó sin cobrar y qué le reconoce el cuadre.
function BitacoraTab({ tecnico }) {
  const hoyMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  const [mes, setMes]   = useState(hoyMes)
  const [dias, setDias] = useState(null)   // null = cargando; [] = sin datos
  const [error, setError] = useState('')
  const [ajusteFila, setAjusteFila] = useState(null)   // fila abierta en el modal de ajuste
  const [modo, setModo] = useState(() => {
    try { return localStorage.getItem('orbit_bitacora_modo') || 'dias' } catch { return 'dias' }
  })
  function cambiarModo(m) {
    setModo(m)
    try { localStorage.setItem('orbit_bitacora_modo', m) } catch { /* privado/incógnito */ }
  }
  const cargaRef = useRef(0)               // descarta respuestas de un mes ya abandonado

  useEffect(() => { cargar() }, [tecnico?.id, mes]) // eslint-disable-line react-hooks/exhaustive-deps

  // PostgREST revienta con cientos de ids en la URL (414) → lotes de 80.
  async function enLotes(ids, fetchLote) {
    const out = []
    for (let i = 0; i < ids.length; i += 80) {
      const r = await fetchLote(ids.slice(i, i + 80))
      out.push(...(r || []))
    }
    return out
  }

  async function cargar() {
    if (!tecnico?.id) { setDias([]); return }
    const miCarga = ++cargaRef.current
    setDias(null); setError('')
    try {
      const [y, m] = mes.split('-').map(Number)
      const desde = `${mes}-01`
      const hasta = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

      // 1. Servicios del técnico en el mes (por servicio o por recogida suya)
      const [{ data: porServicio }, { data: porRecogida }] = await Promise.all([
        db.from('servicios').select('id').eq('tecnico_id', tecnico.id).gte('fecha_ingreso', desde).lte('fecha_ingreso', hasta).gte('fecha_ingreso', FECHA_CORTE),
        db.from('recogidas').select('servicio_id').eq('tecnico_id', tecnico.id).gte('fecha_programada', desde).lte('fecha_programada', hasta),
      ])
      const ids = [...new Set([...(porServicio || []).map(s => s.id), ...(porRecogida || []).map(r => r.servicio_id)])].filter(Boolean)
      if (miCarga !== cargaRef.current) return   // el usuario ya cambió de mes
      if (!ids.length) { setDias([]); return }

      // 2. Detalle de servicios + recibos + reconocimientos del cuadre +
      //    ajustes sugeridos por el técnico (capa sombra) + candado por cierre
      const sinError = r => { if (r.error) throw r.error; return r.data }
      const [svcs, recibos, cItems, ajustes, lockRows] = await Promise.all([
        // El corte también recorta los ids que entraron por `recogidas` (arriba):
        // un servicio previo al corte no aparece en el cuadre aunque su recogida sí caiga en el mes.
        enLotes(ids, lote => db.from('servicios')
          .select('id, fecha_ingreso, ciudad_recogida, estado, estado_pago, mascotas(nombre), planes(nombre)')
          .in('id', lote).gte('fecha_ingreso', FECHA_CORTE).then(sinError)),
        enLotes(ids, lote => db.from('recibos_tecnico')
          .select('servicio_id, fecha_emision, hora_emision, valor_cobrado, medios_pago, created_at')
          .in('servicio_id', lote).then(sinError)),
        enLotes(ids, lote => db.from('cuadre_items')
          .select('servicio_id, transporte_reconocido, recargo_aplicado, pago_servicio, sin_recibo, es_cancelado')
          .in('servicio_id', lote).then(sinError)),
        enLotes(ids, lote => db.from('bitacora_ajustes_tecnico')
          .select('servicio_id, cobrado_sugerido, medios_sugeridos, reconocido_sugerido, nota')
          .eq('tecnico_id', tecnico.id).in('servicio_id', lote).then(sinError)),
        // Servicios ya cuadrados y CERRADOS → su ajuste queda congelado (ventana BORRADOR).
        enLotes(ids, lote => db.from('cuadre_items')
          .select('servicio_id, cuadre:cuadre_id(estado, tecnico_id)')
          .in('servicio_id', lote).then(sinError)),
      ])
      if (miCarga !== cargaRef.current) return   // el usuario ya cambió de mes

      const ajusteMap = {}
      for (const a of (ajustes || [])) ajusteMap[a.servicio_id] = a
      const lockedSet = new Set(
        (lockRows || [])
          .filter(r => r.cuadre?.estado === 'CERRADO' && r.cuadre?.tecnico_id === tecnico.id)
          .map(r => r.servicio_id)
      )

      // Conteo único por servicio (regla del cuadre): el recibo más reciente
      // CON dinero; si ninguno cobró, el más reciente.
      const reciboMap = {}
      const ordenados = [...(recibos || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      for (const r of ordenados) {
        const prev = reciboMap[r.servicio_id]
        if (!prev) { reciboMap[r.servicio_id] = r; continue }
        if ((prev.valor_cobrado || 0) === 0 && (r.valor_cobrado || 0) > 0) reciboMap[r.servicio_id] = r
      }
      // Reconocimiento por servicio: preferir la fila con recibo (no sin_recibo)
      const ganadoMap = {}
      for (const it of (cItems || [])) {
        if (!ganadoMap[it.servicio_id] || (ganadoMap[it.servicio_id].sin_recibo && !it.sin_recibo)) ganadoMap[it.servicio_id] = it
      }

      // 3. Armar filas y agrupar por día (fecha del cobro; si no cobró, la del ingreso)
      const filas = (svcs || []).map(s => {
        const rec = reciboMap[s.id] || null
        const gi  = ganadoMap[s.id] || null
        const medios = Array.isArray(rec?.medios_pago) ? rec.medios_pago : []
        const efectivo = medios.filter(mp => String(mp.metodo).toUpperCase() === 'EFECTIVO').reduce((a, mp) => a + (Number(mp.monto) || 0), 0)
        return {
          servicioId: s.id,
          dia:      rec?.fecha_emision || s.fecha_ingreso,
          hora:     rec?.hora_emision ? String(rec.hora_emision).slice(0, 5) : null,
          mascota:  s.mascotas?.nombre || '—',
          ciudad:   s.ciudad_recogida || null,
          plan:     s.planes?.nombre || null,
          cancelado: s.estado === 'CANCELADO',
          cobrado:  Number(rec?.valor_cobrado) || 0,
          efectivo,
          medios,
          ganado:   gi ? (Number(gi.transporte_reconocido) || 0) + (Number(gi.recargo_aplicado) || 0) + (Number(gi.pago_servicio) || 0) : null,
          ajuste:   ajusteMap[s.id] || null,   // sugerencia del técnico (capa sombra)
          locked:   lockedSet.has(s.id),        // ya cerrado → no editable
        }
      })
      const porDia = {}
      for (const f of filas) {
        if (!porDia[f.dia]) porDia[f.dia] = []
        porDia[f.dia].push(f)
      }
      const listaDias = Object.keys(porDia).sort().reverse().map(d => ({
        dia: d,
        filas: porDia[d].sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99')),
      }))
      setDias(listaDias)
    } catch (e) {
      if (miCarga !== cargaRef.current) return
      setError(e.message || 'Error cargando la bitácora')
      setDias([])
    }
  }

  function moverMes(delta) {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [yy, mm] = mes.split('-').map(Number)
  const nombreMes = new Date(yy, mm - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  const fechaDia = d => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'short' })
  const todas = (dias || []).flatMap(d => d.filas)
  // Valores efectivos "según el técnico": la sugerencia si existe, si no lo automático.
  const efCobrado = f => f.ajuste?.cobrado_sugerido != null ? Number(f.ajuste.cobrado_sugerido) : f.cobrado
  const efGanado  = f => f.ajuste?.reconocido_sugerido != null ? Number(f.ajuste.reconocido_sugerido) : (f.ganado || 0)
  const totMes = {
    cobrado:  todas.reduce((a, f) => a + f.cobrado, 0),
    efectivo: todas.reduce((a, f) => a + f.efectivo, 0),
    ganado:   todas.reduce((a, f) => a + (f.ganado || 0), 0),
  }
  const hayAjustes = todas.some(f => f.ajuste)
  const totSegunTecnico = {
    cobrado: todas.reduce((a, f) => a + efCobrado(f), 0),
    ganado:  todas.reduce((a, f) => a + efGanado(f), 0),
  }

  return (
    <div className="space-y-3">
      {/* Selector de mes + modo de vista */}
      <div className="flex items-center justify-between bg-white rounded-2xl border px-2 py-1.5" style={{ borderColor: '#E5E7EB' }}>
        <button onClick={() => moverMes(-1)} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 active:scale-95" style={{ background: '#F3F4F6' }}>‹</button>
        <span className="text-[13px] font-bold text-gray-800 capitalize">{nombreMes}</span>
        <button onClick={() => moverMes(1)} disabled={mes >= hoyMes()}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 active:scale-95 disabled:opacity-30" style={{ background: '#F3F4F6' }}>›</button>
      </div>
      <div className="flex justify-end gap-1">
        {[['dias', 'Por días'], ['tabla', 'Tabla']].map(([k, l]) => (
          <button key={k} onClick={() => cambiarModo(k)}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${modo === k ? 'text-white' : 'text-gray-500 bg-white border'}`}
            style={modo === k ? { background: '#1A5CD8' } : { borderColor: '#E5E7EB' }}>
            {l}
          </button>
        ))}
      </div>

      {dias === null ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando bitácora…</div>
      ) : error ? (
        <div className="text-center py-10 text-red-500 text-sm px-4">{error}</div>
      ) : !dias.length ? (
        <EmptyState icon="📒" texto="Sin servicios este mes" sub="Aquí verás día a día lo que recoges, lo que cobras y lo que te reconoce el cuadre — como tu planilla, pero automática." />
      ) : (
        <>
          {/* Totales del mes */}
          <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#0B1D4F,#1A5CD8)' }}>
            <div className="text-[11px] font-semibold text-white/70 uppercase tracking-wide">Recogido en {nombreMes}</div>
            <div className="text-[26px] font-extrabold tabular-nums leading-tight mt-0.5">{fmt(totMes.cobrado)}</div>
            <div className="text-[11px] text-white/70 mt-1">
              Efectivo {fmt(totMes.efectivo)} · Digital {fmt(totMes.cobrado - totMes.efectivo)}
              {totMes.ganado > 0 && <> · Transporte {fmt(totMes.ganado)}</>}
            </div>
            <div className="text-[10px] text-white/50 mt-0.5">{todas.length} servicio{todas.length !== 1 ? 's' : ''}</div>
            {hayAjustes && (
              <div className="mt-2 pt-2 border-t border-white/15 text-[11px] text-white/80 flex items-center justify-between">
                <span>Según tú</span>
                <span className="tabular-nums font-bold">
                  {fmt(totSegunTecnico.cobrado)}
                  {totSegunTecnico.ganado > 0 && <span className="text-white/60 font-normal"> · reconoc. {fmt(totSegunTecnico.ganado)}</span>}
                </span>
              </div>
            )}
          </div>
          {hayAjustes && (
            <p className="text-[10px] text-gray-400 px-1 -mt-1">
              Tus ajustes son solo sugerencias para revisar con gerencia — no cambian el cuadre.
            </p>
          )}

          {/* Modo tabla: la planilla clásica, una fila por servicio en orden cronológico */}
          {modo === 'tabla' && (
            <div className="rounded-2xl border bg-white overflow-x-auto" style={{ borderColor: '#E5E7EB' }}>
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    {['Fecha', 'Hora', 'Mascota', 'Ciudad', 'Total recibido', 'Medio', 'Ganado', ''].map((h, i) => (
                      <th key={i} className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-2.5 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...todas].sort((a, b) => a.dia.localeCompare(b.dia) || (a.hora || '99').localeCompare(b.hora || '99')).map(f => (
                    <tr key={f.servicioId} className="border-t text-[12px]" style={{ borderColor: '#F3F4F6' }}>
                      <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{new Date(f.dia + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })}</td>
                      <td className="px-2.5 py-2 font-mono text-[11px] text-gray-400">{f.hora || '—'}</td>
                      <td className="px-2.5 py-2 font-bold text-gray-900 whitespace-nowrap">
                        {f.mascota}
                        {f.cancelado && <span className="ml-1 text-[9px] font-bold text-red-500">CANC</span>}
                      </td>
                      <td className="px-2.5 py-2 text-gray-500 whitespace-nowrap">{f.ciudad || '—'}</td>
                      <td className={`px-2.5 py-2 font-extrabold tabular-nums whitespace-nowrap ${f.cobrado > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {f.cobrado > 0 ? fmt(f.cobrado) : '—'}
                        {f.ajuste?.cobrado_sugerido != null && Number(f.ajuste.cobrado_sugerido) !== f.cobrado && (
                          <div className="text-[10px] font-bold text-amber-600">tú: {fmt(Number(f.ajuste.cobrado_sugerido))}</div>
                        )}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {f.cobrado > 0
                          ? <span className="text-[11px] text-gray-600">{f.medios.filter(mp => Number(mp.monto) > 0).map(mp => mp.metodo).join(' + ') || '—'}</span>
                          : !f.cancelado ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">NO COBRADO</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2.5 py-2 font-bold tabular-nums text-[#16a34a] whitespace-nowrap">
                        {f.ganado != null && f.ganado > 0 ? `+${fmt(f.ganado)}` : <span className="text-gray-300 font-normal">—</span>}
                        {f.ajuste?.reconocido_sugerido != null && Number(f.ajuste.reconocido_sugerido) !== (f.ganado || 0) && (
                          <div className="text-[10px] font-bold text-amber-600">tú: {fmt(Number(f.ajuste.reconocido_sugerido))}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-right">
                        <BtnAjuste f={f} onClick={() => setAjusteFila(f)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2" style={{ borderColor: '#E5E7EB', background: '#F9FAFB' }}>
                    <td colSpan={4} className="px-2.5 py-2.5 text-[11px] font-bold text-gray-700 uppercase whitespace-nowrap">
                      Total · {todas.length} servicio{todas.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-2.5 py-2.5 text-[13px] font-extrabold tabular-nums text-gray-900 whitespace-nowrap">{fmt(totMes.cobrado)}</td>
                    <td className="px-2.5 py-2.5 text-[10px] text-gray-500 whitespace-nowrap">
                      Efectivo {fmt(totMes.efectivo)}<br />Digital {fmt(totMes.cobrado - totMes.efectivo)}
                    </td>
                    <td className="px-2.5 py-2.5 text-[13px] font-extrabold tabular-nums text-[#16a34a] whitespace-nowrap">
                      {totMes.ganado > 0 ? `+${fmt(totMes.ganado)}` : '—'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Día a día */}
          {modo === 'dias' && dias.map(({ dia, filas }) => {
            const totDia = filas.reduce((a, f) => a + f.cobrado, 0)
            return (
              <div key={dia} className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: '#E5E7EB' }}>
                <div className="px-4 py-2 flex items-center justify-between" style={{ background: '#F9FAFB' }}>
                  <span className="text-[12px] font-bold text-gray-700 capitalize">{fechaDia(dia)}</span>
                  <span className="text-[12px] font-extrabold tabular-nums text-gray-800">{fmt(totDia)}</span>
                </div>
                <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
                  {filas.map(f => (
                    <div key={f.servicioId} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {f.hora && <span className="text-[11px] font-mono text-gray-400 flex-shrink-0">{f.hora}</span>}
                          <span className="text-[13px] font-bold text-gray-900 truncate">{f.mascota}</span>
                          {f.cancelado && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 flex-shrink-0">CANC</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-[13px] font-extrabold tabular-nums ${f.cobrado > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                            {f.cobrado > 0 ? fmt(f.cobrado) : '—'}
                          </span>
                          <BtnAjuste f={f} onClick={() => setAjusteFila(f)} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-400 truncate">
                          {[f.ciudad, f.plan].filter(Boolean).join(' · ') || '—'}
                        </span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          {f.cobrado > 0
                            ? f.medios.filter(mp => Number(mp.monto) > 0).map((mp, i) => (
                                <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${String(mp.metodo).toUpperCase() === 'EFECTIVO' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {mp.metodo}
                                </span>
                              ))
                            : !f.cancelado && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">NO COBRADO</span>}
                          {f.ganado != null && f.ganado > 0 && (
                            <span className="text-[10px] font-bold text-[#16a34a] tabular-nums" title="Lo que te reconoce el cuadre">+{fmt(f.ganado)}</span>
                          )}
                        </span>
                      </div>
                      {f.ajuste && (
                        <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700">
                            <span>✎ Tu ajuste</span>
                            {f.ajuste.cobrado_sugerido != null && Number(f.ajuste.cobrado_sugerido) !== f.cobrado && (
                              <span className="tabular-nums">cobrado {fmt(Number(f.ajuste.cobrado_sugerido))}</span>
                            )}
                            {f.ajuste.reconocido_sugerido != null && Number(f.ajuste.reconocido_sugerido) !== (f.ganado || 0) && (
                              <span className="tabular-nums">reconoc. {fmt(Number(f.ajuste.reconocido_sugerido))}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-amber-800/80 mt-0.5 leading-snug">{f.ajuste.nota}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {ajusteFila && (
        <AjusteModal
          fila={ajusteFila}
          tecnico={tecnico}
          onClose={() => setAjusteFila(null)}
          onSaved={() => { setAjusteFila(null); cargar() }}
        />
      )}
    </div>
  )
}

// Botón/lápiz para abrir el ajuste de una fila. Candado si el periodo ya cerró.
function BtnAjuste({ f, onClick }) {
  if (f.locked) {
    return (
      <span className="text-gray-300 text-[13px] flex-shrink-0" title="Ya cuadrado y cerrado — no editable">🔒</span>
    )
  }
  return (
    <button onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform ${f.ajuste ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}
      title="Ajustar / anotar">
      ✎
    </button>
  )
}

// ─── AJUSTE DE BITÁCORA — sugerencia del técnico (capa sombra, NO toca el cuadre)
function AjusteModal({ fila, tecnico, onClose, onSaved }) {
  const aj = fila.ajuste
  // "" = no lo discuto (queda NULL). Precargar con el ajuste previo si existe.
  const [cobrado,    setCobrado]    = useState(aj?.cobrado_sugerido    != null ? String(aj.cobrado_sugerido)    : '')
  const [efectivo,   setEfectivo]   = useState(() => {
    const m = Array.isArray(aj?.medios_sugeridos) ? aj.medios_sugeridos.find(x => String(x.metodo).toUpperCase() === 'EFECTIVO') : null
    return m ? String(m.monto) : ''
  })
  const [digital,    setDigital]    = useState(() => {
    const m = Array.isArray(aj?.medios_sugeridos) ? aj.medios_sugeridos.find(x => String(x.metodo).toUpperCase() !== 'EFECTIVO') : null
    return m ? String(m.monto) : ''
  })
  const [reconocido, setReconocido] = useState(aj?.reconocido_sugerido != null ? String(aj.reconocido_sugerido) : '')
  const [nota,       setNota]       = useState(aj?.nota || '')
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState('')

  const num = v => { const n = Number(String(v).replace(/[^\d.-]/g, '')); return v === '' || Number.isNaN(n) ? null : n }
  const cambio =
    num(cobrado)    !== null ||
    num(efectivo)   !== null ||
    num(digital)    !== null ||
    num(reconocido) !== null

  async function guardar() {
    setErr('')
    if (!nota.trim()) { setErr('Escribe por qué anotas un valor distinto.'); return }
    setSaving(true)
    try {
      // Reparto de medios sugerido: solo si el técnico tocó efectivo o digital.
      let medios = null
      if (num(efectivo) !== null || num(digital) !== null) {
        medios = []
        if (num(efectivo) !== null) medios.push({ metodo: 'EFECTIVO', monto: num(efectivo) })
        if (num(digital)  !== null) medios.push({ metodo: 'DIGITAL',  monto: num(digital) })
      }
      const { error } = await db.rpc('upsert_bitacora_ajuste', {
        p_servicio_id: fila.servicioId,
        p_tecnico_id:  tecnico.id,
        p_nota:        nota.trim(),
        p_cobrado:     num(cobrado),
        p_medios:      medios,
        p_reconocido:  num(reconocido),
      })
      if (error) throw error
      onSaved()
    } catch (e) {
      setErr(e.message || 'No se pudo guardar el ajuste.')
      setSaving(false)
    }
  }

  async function quitar() {
    setSaving(true); setErr('')
    try {
      const { error } = await db.rpc('borrar_bitacora_ajuste', {
        p_servicio_id: fila.servicioId,
        p_tecnico_id:  tecnico.id,
      })
      if (error) throw error
      onSaved()
    } catch (e) {
      setErr(e.message || 'No se pudo quitar el ajuste.')
      setSaving(false)
    }
  }

  const Real = ({ label, val }) => (
    <div className="flex justify-between text-[12px]">
      <span className="text-gray-400">{label}</span>
      <span className="font-semibold text-gray-700 tabular-nums">{val}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="bg-white rounded-t-3xl px-6 pt-4 pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
        <div className="mb-1">
          <p className="font-bold text-gray-900 text-base">{fila.mascota}</p>
          <p className="text-[11px] text-gray-500">{[fila.ciudad, fila.plan].filter(Boolean).join(' · ') || '—'}</p>
        </div>

        {/* Lo automático (referencia, no editable) */}
        <div className="rounded-xl bg-gray-50 border px-3 py-2.5 my-3 space-y-1" style={{ borderColor: '#E5E7EB' }}>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Lo que dice el sistema</div>
          <Real label="Cobrado" val={fila.cobrado > 0 ? fmt(fila.cobrado) : '—'} />
          <Real label="Efectivo" val={fmt(fila.efectivo)} />
          <Real label="Digital"  val={fmt(fila.cobrado - fila.efectivo)} />
          <Real label="Reconocido a ti" val={fila.ganado != null ? fmt(fila.ganado) : '—'} />
        </div>

        {/* Lo que dice el técnico (deja en blanco lo que no discutes) */}
        <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">
          ¿Tú qué dices? · deja en blanco lo que esté bien
        </div>
        <div className="space-y-2.5">
          <CampoNum label="Cobrado"          value={cobrado}    onChange={setCobrado} />
          <CampoNum label="De eso, efectivo" value={efectivo}   onChange={setEfectivo} />
          <CampoNum label="De eso, digital"  value={digital}    onChange={setDigital} />
          <CampoNum label="Reconocido a ti"  value={reconocido} onChange={setReconocido} />
          <div>
            <label className="text-[11px] font-bold text-gray-500">Nota — por qué {cambio ? '(obligatoria)' : ''}</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Ej: cobré $20.000 más que lo registrado; el cliente pagó todo en efectivo."
              className="w-full mt-1 rounded-xl border px-3 py-2 text-[13px] resize-none" style={{ borderColor: '#E5E7EB' }} />
          </div>
        </div>

        {err && <p className="text-[12px] text-red-500 mt-2">{err}</p>}

        <button onClick={guardar} disabled={saving || !nota.trim()}
          className="w-full mt-4 py-3.5 rounded-2xl text-base font-bold disabled:opacity-50" style={{ background: '#D97706', color: '#fff' }}>
          {saving ? 'Guardando…' : aj ? 'Actualizar mi ajuste' : 'Guardar mi ajuste'}
        </button>
        {aj && (
          <button onClick={quitar} disabled={saving}
            className="w-full mt-2 py-2.5 rounded-2xl text-[13px] font-bold text-gray-500 disabled:opacity-50" style={{ background: '#F3F4F6' }}>
            Quitar ajuste (volver a lo automático)
          </button>
        )}
        <p className="text-[10px] text-gray-400 text-center mt-3 leading-snug">
          Esto es solo una sugerencia tuya para revisar con gerencia. No cambia el cuadre ni el servicio.
        </p>
      </div>
    </div>
  )
}

function CampoNum({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-[13px] text-gray-600 flex-shrink-0">{label}</label>
      <input inputMode="numeric" value={value} onChange={e => onChange(e.target.value)} placeholder="—"
        className="w-32 rounded-xl border px-3 py-2 text-[13px] text-right tabular-nums" style={{ borderColor: '#E5E7EB' }} />
    </div>
  )
}

function MiLinea({ label, val }) {
  if (!Number(val)) return null
  return (
    <div className="flex justify-between text-[12px]">
      <span className="text-gray-400">{label}</span>
      <span className="font-semibold text-gray-700 tabular-nums">{fmt(val)}</span>
    </div>
  )
}

function EmptyState({ icon, texto, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div style={{ fontSize: 52 }} className="mb-4">{icon}</div>
      <p className="font-semibold text-gray-700 text-base mb-1">{texto}</p>
      <p className="text-gray-400 text-xs leading-relaxed">{sub}</p>
    </div>
  )
}

// ─── MIS MASCOTAS EN CUARTO FRÍO ───────────────────────────────────────────
function MisCuartoFrioSection({ misCF, tecnico, neverasList = NEVERAS_DEFAULT, onRefresh }) {
  const [editando,    setEditando]    = useState(null)
  const [nuevaNevera, setNuevaNevera] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [movLog,      setMovLog]      = useState([])
  const [logOpenId,   setLogOpenId]   = useState(null)

  if (!misCF.length) return null

  async function abrirLog(cfId) {
    if (logOpenId === cfId) { setLogOpenId(null); return }
    const { data } = await db.from('cuarto_frio_movimientos')
      .select('*, personal:personal_id(nombre,apellido)')
      .eq('cuarto_frio_id', cfId)
      .order('created_at', { ascending: false })
    setMovLog(data || [])
    setLogOpenId(cfId)
  }

  async function guardarCambioNevera() {
    if (!editando || !nuevaNevera.trim()) return
    setSaving(true)
    try {
      const cf = editando.cuarto_frio_data
      await db.from('cuarto_frio').update({ nevera_codigo: nuevaNevera.trim() }).eq('id', cf.id)
      await db.from('cuarto_frio_movimientos').insert({
        cuarto_frio_id: cf.id,
        personal_id:    tecnico?.id || null,
        tipo:           'CAMBIO_NEVERA',
        nevera_anterior: cf.nevera_codigo || null,
        nevera_nueva:    nuevaNevera.trim(),
        notas:          'Movimiento registrado por técnico',
      })
      setEditando(null)
      setNuevaNevera('')
      onRefresh()
    } catch (e) { alert('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
        <Snowflake size={13} className="text-[#0E7490]" />
        Mis mascotas registradas en C. Frío ({misCF.length})
      </div>
      <div className="space-y-2">
        {misCF.map(svc => {
          const cf      = svc.cuarto_frio_data
          const mascota = svc.mascotas
          const emoji   = petEmoji(mascota?.especies?.nombre)
          const logOpen = logOpenId === cf?.id
          return (
            <div key={svc.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <span style={{ fontSize: 26 }}>{emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 text-sm">{mascota?.nombre || '—'}</div>
                    <div className="text-[11px] text-gray-500">
                      {cf?.nevera_codigo
                        ? <span className="font-mono font-bold text-[#0E7490]">Nevera {cf.nevera_codigo}</span>
                        : <span className="text-gray-400">Sin nevera asignada</span>
                      }
                      {cf?.peso_kg ? ` · ${cf.peso_kg} kg` : ''}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { setEditando(svc); setNuevaNevera(cf?.nevera_codigo || '') }}
                      className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                      style={{ background: '#EEF3FB', color: '#1D4ED8' }}>
                      🔄 Mover
                    </button>
                    <button
                      onClick={() => abrirLog(cf?.id)}
                      className="px-2 py-2 rounded-xl text-xs transition-all active:scale-95"
                      style={{ background: '#F3F4F6', color: '#6B7280' }}>
                      <History size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Log de movimientos */}
              {logOpen && (
                <div className="border-t border-gray-100 px-3 pb-3 pt-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Historial de movimientos</div>
                  {movLog.length === 0 ? (
                    <p className="text-[11px] text-gray-400">Sin movimientos registrados</p>
                  ) : (
                    <div className="space-y-1.5">
                      {movLog.map(m => {
                        const quien = m.personal ? `${m.personal.nombre}` : 'Sistema'
                        const fecha = new Date(m.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        return (
                          <div key={m.id} className="text-[11px] bg-gray-50 rounded-lg px-2.5 py-2">
                            <div className="flex justify-between mb-0.5">
                              <span className="font-semibold text-gray-700">
                                {m.tipo === 'CAMBIO_NEVERA' ? '❄️ Cambio nevera' : '📋 Cambio estado'}
                              </span>
                              <span className="text-gray-400">{fecha}</span>
                            </div>
                            {m.nevera_nueva && (
                              <span className="text-gray-600">
                                <span className="font-mono">{m.nevera_anterior || '—'}</span>
                                {' → '}
                                <span className="font-mono font-bold text-[#0E7490]">{m.nevera_nueva}</span>
                              </span>
                            )}
                            <div className="text-gray-400 mt-0.5">Por: {quien}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Bottom sheet cambiar nevera */}
      {editando && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setEditando(null)}>
          <div className="bg-white rounded-t-3xl px-6 pt-4 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-2 mb-4">
              <span style={{ fontSize: 24 }}>{petEmoji(editando.mascotas?.especies?.nombre)}</span>
              <div>
                <p className="font-bold text-gray-900 text-base">{editando.mascotas?.nombre}</p>
                <p className="text-xs text-gray-500">
                  Nevera actual: <span className="font-mono font-bold text-[#0E7490]">{editando.cuarto_frio_data?.nevera_codigo || 'Sin asignar'}</span>
                </p>
              </div>
            </div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Nueva nevera</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {neverasList.map(n => (
                <button key={n} onClick={() => setNuevaNevera(n)}
                  className="py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                  style={{
                    background: nuevaNevera === n ? '#1D4ED8' : '#F9FAFB',
                    color: nuevaNevera === n ? '#fff' : '#374151',
                    border: `1.5px solid ${nuevaNevera === n ? '#1D4ED8' : '#E5E7EB'}`,
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={guardarCambioNevera} disabled={!nuevaNevera.trim() || saving}
              className="w-full py-4 rounded-2xl text-base font-bold disabled:opacity-50"
              style={{ background: '#1D4ED8', color: '#fff' }}>
              {saving ? 'Guardando…' : '❄️ Confirmar cambio de nevera'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FIRMA DIGITAL ─────────────────────────────────────────────────────────
function SignaturePad({ onSigned, firmaDataUrl }) {
  const canvasRef  = useRef(null)
  const drawing    = useRef(false)
  const lastPos    = useRef(null)

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const src  = e.touches?.[0] || e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    const pos = getPos(e, canvasRef.current)
    lastPos.current = pos
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function move(e) {
    e.preventDefault()
    if (!drawing.current) return
    const pos = getPos(e, canvasRef.current)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
  }

  function end(e) {
    e.preventDefault()
    drawing.current = false
    onSigned(canvasRef.current.toDataURL('image/png'))
  }

  function limpiar() {
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    onSigned(null)
  }

  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Pen size={11} />Firma del cliente</span>
        {firmaDataUrl && (
          <button onClick={limpiar} style={{ fontSize: '10px', color: '#EF4444', fontWeight: '600', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Borrar y firmar de nuevo</button>
        )}
      </div>
      <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', border: '2px dashed #E5E7EB', background: '#FAFAFA' }}>
        <canvas
          ref={canvasRef}
          width={340} height={130}
          style={{ width: '100%', display: 'block', touchAction: 'none' }}
          onMouseDown={start}  onMouseMove={move}  onMouseUp={end}
          onTouchStart={start} onTouchMove={move}  onTouchEnd={end}
        />
        {!firmaDataUrl && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <p style={{ color: '#D1D5DB', fontSize: '14px' }}>Firmar aquí</p>
          </div>
        )}
      </div>
      <p style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>Dibuja la firma con el dedo o el mouse</p>
    </div>
  )
}

// ─── RECIBO TAB ────────────────────────────────────────────────────────────
// Estados de servicio donde la recogida ya quedó guardada (recogido o posterior)
const ESTADOS_RECOGIDO = ['EN_CUARTO_FRIO', 'EN_PROCESO', 'EN_PRODUCCION', 'LISTO', 'EN_ENTREGA', 'ENTREGADO']

// Deriva el estado del recibo de un servicio desde sus filas en recibos_tecnico.
// La fuente de verdad es SIEMPRE la DB — nunca el estado en memoria de la recogida.
function estadoReciboDe(recibos) {
  if (!recibos || recibos.length === 0) return 'PENDIENTE_RECIBO'
  const comprobantePendiente = recibos.some(r =>
    (Array.isArray(r.medios_pago) ? r.medios_pago : []).some(m =>
      METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0 && !m.comprobanteUrl
    )
  )
  if (comprobantePendiente) return 'PENDIENTE_COMPROBANTE'
  if (recibos.some(r => r.datos_form?.pago_pendiente)) return 'PAGO_PENDIENTE'
  return 'COMPLETO'
}

const BADGE_RECIBO = {
  PENDIENTE_RECIBO:      { bg: '#FEF3C7', color: '#92400E', label: 'Por generar recibo' },
  PENDIENTE_COMPROBANTE: { bg: '#FFEDD5', color: '#9A3412', label: 'Comprobante pendiente' },
  PAGO_PENDIENTE:        { bg: '#FEF9C3', color: '#854D0E', label: 'Pago pendiente' },
  COMPLETO:              { bg: '#D1FAE5', color: '#065F46', label: 'Recibo completo' },
}

function CardServicioRecibo({ item, onSeleccionar, disabled }) {
  const { svc, estadoRecibo } = item
  const m     = svc.mascotas
  const rec   = svc.recogidas?.[0]
  const badge = BADGE_RECIBO[estadoRecibo]
  const saldo = Math.max(0, (svc.valor_total || 0) - (svc.valor_pagado || 0))
  return (
    <button onClick={() => onSeleccionar(item)} disabled={disabled}
      className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 text-left transition-all active:scale-98 shadow-sm disabled:opacity-60">
      <span style={{ fontSize: 28 }}>{petEmoji(m?.especies?.nombre)}</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-gray-900 leading-tight">{m?.nombre || '—'}</div>
        <div className="text-[11px] text-gray-500 truncate">
          {svc.planes?.nombre ? `${svc.planes.nombre} · ` : ''}{m?.clientes?.nombre} {m?.clientes?.apellido}
        </div>
        {rec?.fecha_realizada && (
          <div className="text-[10px] text-gray-400 mt-0.5">
            🚐 Recogido: {rec.fecha_realizada}{rec.hora_realizada ? ` · ${rec.hora_realizada}` : ''}
            {rec.hora_llegada ? ` · 📍 Llegada ${String(rec.hora_llegada).slice(0, 5)}` : ''}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
          {svc.valor_total > 0 && (
            <span className="text-[10px] font-semibold text-gray-500">
              {saldo > 0 ? `Por cobrar: ${fmt(saldo)}` : `Cobrado: ${fmt(svc.valor_total)}`}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs font-semibold flex-shrink-0 text-[#7C3AED]">
        {estadoRecibo === 'PENDIENTE_RECIBO' ? 'Generar →' : 'Abrir →'}
      </span>
    </button>
  )
}

// Búsqueda sin tildes ni mayúsculas (ej: "muñeca" encuentra "MUNECA" y viceversa)
const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function coincideRecibo(item, q) {
  if (!q) return true
  const m = item.svc.mascotas
  const campos = [
    m?.nombre,
    `${m?.clientes?.nombre || ''} ${m?.clientes?.apellido || ''}`,
    item.svc.planes?.nombre,
    ...item.recibos.map(r => r.numero_recibo),
  ]
  return campos.some(c => normalizar(c).includes(q))
}

// Sección colapsable por estado de recibo: header con contador + flechita
function SeccionRecibos({ color, emoji, titulo, lista, abierta, onToggle, onSeleccionar, disabled }) {
  if (lista.length === 0) return null
  return (
    <div className="mb-2">
      <button onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-3 rounded-2xl bg-white border shadow-sm transition-all active:scale-98"
        style={{ borderColor: abierta ? color : '#F0F0F0', borderWidth: abierta ? 1.5 : 1 }}>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>
          {emoji} {titulo}
        </span>
        <span className="text-[10px] font-bold min-w-[18px] h-[18px] rounded-full inline-flex items-center justify-center px-1"
          style={{ background: color, color: '#fff' }}>
          {lista.length}
        </span>
        <ChevronDown size={16} className="ml-auto flex-shrink-0 transition-transform"
          style={{ color: '#9CA3AF', transform: abierta ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      {abierta && (
        <div className="space-y-2 mt-2">
          {lista.map(i => (
            <CardServicioRecibo key={i.svc.id} item={i} onSeleccionar={onSeleccionar} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReciboTab({ tecnico }) {
  // El módulo Recibos es independiente del flujo de recogida: consulta la DB
  // directamente (servicios ya recogidos del técnico + sus recibos guardados)
  const [items, setItems]             = useState([])
  const [cargando, setCargando]       = useState(true)
  const [listErr, setListErr]         = useState('')
  const [busqueda, setBusqueda]       = useState('')
  const [abiertas, setAbiertas]       = useState({}) // secciones desplegadas, por estado
  const [servicioSel, setServicioSel] = useState(null)
  const [svcData,     setSvcData]     = useState(null)
  const [reciboExistente, setReciboExistente] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const restauradoRef                 = useRef(false)

  const cargarLista = useCallback(async () => {
    if (!tecnico?.id) return
    setCargando(true); setListErr('')
    try {
      const { data: svcs, error } = await db.from('servicios')
        .select(`
          id, estado, estado_pago, valor_total, valor_pagado, fecha_ingreso,
          mascotas:mascota_id ( nombre, especies(nombre), clientes:cliente_id(nombre, apellido) ),
          planes:plan_id ( nombre ),
          recogidas ( fecha_realizada, hora_realizada, hora_llegada )
        `)
        .eq('tecnico_id', tecnico.id)
        .in('estado', ESTADOS_RECOGIDO)
        .gte('fecha_ingreso', FECHA_CORTE)
        .order('fecha_ingreso', { ascending: false })
        .limit(60)
      if (error) throw error
      const ids = (svcs || []).map(s => s.id)
      const porSvc = {}
      if (ids.length) {
        // Query separado + merge client-side (el join inverso falla en silencio)
        const { data: recs } = await db.from('recibos_tecnico')
          .select('id, servicio_id, tipo, numero_recibo, valor_cobrado, medios_pago, datos_form, created_at')
          .in('servicio_id', ids)
          .order('created_at', { ascending: true })
        ;(recs || []).forEach(r => {
          (porSvc[r.servicio_id] = porSvc[r.servicio_id] || []).push(r)
        })
      }
      setItems((svcs || []).map(svc => ({
        svc,
        recibos: porSvc[svc.id] || [],
        estadoRecibo: estadoReciboDe(porSvc[svc.id]),
      })))
    } catch (e) {
      setListErr(e.message || 'Error al cargar la lista de recibos')
    } finally { setCargando(false) }
  }, [tecnico?.id])

  useEffect(() => { cargarLista() }, [cargarLista])

  async function seleccionar(item) {
    const svc = item.svc
    try { localStorage.setItem('tecnico_recibo_sel', svc.id) } catch (_) {}
    setServicioSel(svc)
    setLoading(true)
    try {
      const { data, error } = await db.from('servicios')
        .select(`
          id, plan_id, valor_total, valor_pagado, estado_pago, comision_aliado, comision_descontada, tipo_acompanamiento,
          mascotas:mascota_id (
            nombre, peso_kg, especie_id, sexo,
            especies(nombre),
            clientes:cliente_id(nombre,apellido,email,telefono,telefono2,whatsapp,direccion,ciudad)
          ),
          planes:plan_id(nombre,codigo,tipo_proceso),
          aliados:aliado_origen_id(nombre,vip,modalidad_comision,whatsapp,telefono,contacto_nombre)
        `)
        .eq('id', svc.id)
        .single()
      if (error) throw new Error(error.message || 'Error al cargar servicio')
      const { data: cf } = await db.from('cuarto_frio')
        .select('peso_kg').eq('servicio_id', svc.id).maybeSingle()
      // Reabrir el recibo con comprobante pendiente si lo hay; si no, el último guardado
      const conPendiente = item.recibos.filter(r =>
        (Array.isArray(r.medios_pago) ? r.medios_pago : []).some(m =>
          METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0 && !m.comprobanteUrl))
      setReciboExistente(conPendiente[conPendiente.length - 1] || item.recibos[item.recibos.length - 1] || null)
      setSvcData({ ...data, peso_confirmado: cf?.peso_kg || null })
    } catch (e) {
      setServicioSel(null); setSvcData(null)
      setListErr('No se pudo cargar el servicio: ' + (e.message || 'error de conexión'))
    } finally { setLoading(false) }
  }

  function volver() {
    try { localStorage.removeItem('tecnico_recibo_sel') } catch (_) {}
    setServicioSel(null); setSvcData(null); setReciboExistente(null)
    cargarLista()
  }

  // Si la PWA se reinició con un recibo abierto, volver a abrirlo solo:
  // junto con el draft (datos) y el stash (comprobante), el técnico retoma
  // exactamente donde iba sin navegar de nuevo.
  useEffect(() => {
    if (restauradoRef.current || servicioSel || cargando) return
    restauradoRef.current = true
    try {
      const id = localStorage.getItem('tecnico_recibo_sel')
      if (!id) return
      const item = items.find(i => i.svc.id === id)
      if (item) seleccionar(item)
      else localStorage.removeItem('tecnico_recibo_sel')
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cargando])

  if (!servicioSel || !svcData) {
    const q         = normalizar(busqueda.trim())
    const filtrados = items.filter(i => coincideRecibo(i, q))
    const GRUPOS = [
      { key: 'PENDIENTE_COMPROBANTE', color: '#EA580C', emoji: '⏳', titulo: 'Comprobante pendiente' },
      { key: 'PENDIENTE_RECIBO',      color: '#D97706', emoji: '📄', titulo: 'Por generar recibo' },
      { key: 'PAGO_PENDIENTE',        color: '#854D0E', emoji: '💤', titulo: 'Pago pendiente' },
      { key: 'COMPLETO',              color: '#16A34A', emoji: '✅', titulo: 'Recibo completo' },
    ]
    const hayPendientes = items.some(i =>
      ['PENDIENTE_RECIBO', 'PENDIENTE_COMPROBANTE'].includes(i.estadoRecibo))
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
            📄 Recibos de tus servicios recogidos
          </div>
          <button onClick={cargarLista} disabled={cargando}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg disabled:opacity-50"
            style={{ background: '#F3E8FF', color: '#7C3AED' }}>
            {cargando ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </div>

        {/* Buscador inteligente: mascota, cliente, plan o No. de recibo (sin tildes) */}
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[13px]">🔍</span>
          <input
            type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Mascota, cliente, plan o No. de recibo…"
            className="w-full pl-8 pr-8 py-2 rounded-xl border text-[12px] outline-none"
            style={{ borderColor: busqueda ? '#7C3AED' : '#E5E7EB', background: '#fff' }}
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 text-gray-400 hover:text-gray-600 text-[13px]">✕</button>
          )}
        </div>

        {listErr && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
            style={{ background: '#FEE2E2', color: '#991B1B' }}>
            <AlertCircle size={13} /> {listErr}
          </div>
        )}

        {cargando && items.length === 0 ? (
          <div className="flex justify-center py-10"><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon="📄" texto="Sin servicios recogidos"
            sub="Cuando completes una recogida, el servicio aparecerá aquí para generar su recibo." />
        ) : (
          <>
            {!hayPendientes && !q && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl mb-3"
                style={{ background: '#D1FAE5', border: '1.5px solid #86EFAC' }}>
                <CheckCircle size={15} style={{ color: '#16A34A' }} />
                <span className="text-[12px] font-bold text-green-800">Al día — sin recibos pendientes</span>
              </div>
            )}
            {q && filtrados.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">Sin resultados para "{busqueda.trim()}"</div>
            )}
            {/* Secciones colapsables por estado; con búsqueda activa se despliegan solas */}
            {GRUPOS.map(g => (
              <SeccionRecibos key={g.key} color={g.color} emoji={g.emoji} titulo={g.titulo}
                lista={filtrados.filter(i => i.estadoRecibo === g.key)}
                abierta={q ? true : !!abiertas[g.key]}
                onToggle={() => setAbiertas(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
                onSeleccionar={seleccionar}
                disabled={loading}
              />
            ))}
          </>
        )}
      </div>
    )
  }

  return (
    <ReciboErrorBoundary>
      <ReciboForm
        svcData={svcData}
        servicioSel={servicioSel}
        tecnico={tecnico}
        reciboExistente={reciboExistente}
        onVolver={volver}
        onGuardado={() => {}}
      />
    </ReciboErrorBoundary>
  )
}

// ─── MEDIOS DE PAGO DISPONIBLES ────────────────────────────────────────────
const METODOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO']
// Métodos que requieren comprobante/referencia
const METODOS_CON_COMPROBANTE = ['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA']

// ─── COMPROBANTES (pestaña independiente) ───────────────────────────────────
// Por qué existe separado del recibo: en celulares con poca RAM, abrir el
// selector de archivos desde la pantalla PESADA del recibo (preview + firma +
// datos) hacía que Android matara la PWA al volver del selector. La foto de
// evidencia de la mascota NUNCA falla porque es un cargador simple en pantalla
// liviana que NO cambia de pantalla al elegir el archivo. Acá replicamos ESE
// patrón: lista liviana + cargador inline (sin desmontar/montar pantallas
// pesadas, sin <img> de la imagen completa). El ReciboForm pesado ni se monta.

// Cargador inline de un comprobante — copia las mecánicas probadas de FotoEvidencia
// (stash antes de subir, original sin comprimir, sin decodificar, reset de inputs).
function ComprobanteUploader({ servicioId, onSubido, actualUrl = '', reemplazo = false, stashId = '' }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr]             = useState('')
  const [okUrl, setOkUrl]         = useState('')
  const [cambiando, setCambiando] = useState(!actualUrl)
  const galeriaRef                = useRef()
  const cameraRef                 = useRef()
  const stashKey                  = `comprobante_${servicioId}_${stashId || 'nuevo'}`

  // Recovery: si la app se reinició a mitad de subida, reanudar al montar
  useEffect(() => {
    ;(async () => {
      const p = await stashGetByPrefix(stashKey)
      if (p.length > 0 && p[0].blob) {
        setCambiando(true)
        subir(p[0].blob, { recuperado: true })
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function limpiar() {
    if (galeriaRef.current) galeriaRef.current.value = ''
    if (cameraRef.current)  cameraRef.current.value  = ''
  }

  async function subir(file, { recuperado = false } = {}) {
    const val = validarArchivo(file, { permitirPdf: true })
    if (val.error) { setErr(val.error); limpiar(); return }
    // Respaldar ANTES de subir (sobrevive a un reinicio del teléfono)
    if (!recuperado) await stashPut(stashKey, file)
    setUploading(true); setErr('')
    try {
      // Original sin comprimir ni decodificar (igual que el comprobante de hoy)
      const path = `comprobantes/${servicioId}/${Date.now()}.${val.ext}`
      const { data, error: upErr } = await conTimeout(
        db.storage.from('evidencias').upload(path, file, { upsert: false, contentType: val.mime }),
        'La subida tardó demasiado — revisa la señal'
      )
      if (upErr) throw upErr
      const { data: { publicUrl } } = db.storage.from('evidencias').getPublicUrl(data.path)
      await onSubido(publicUrl, data.path, { ...val, size: file.size || null })   // persistencia (recibo_comprobantes + jsonb)
      await stashDelete(stashKey)
      setOkUrl(publicUrl)
      setCambiando(false)
    } catch (e) {
      setErr(String(e.message || e).slice(0, 120))
    } finally {
      setUploading(false)
      limpiar()
    }
  }

  function handleFile(e) {
    limpiarPickerAbierto()
    const f = e.target.files?.[0]
    if (f) subir(f)
  }

  // Inputs file SIEMPRE montados (livianos). No se renderiza <img> del comprobante.
  return (
    <div className="mt-2">
      <input type="file" accept="image/*,application/pdf" ref={galeriaRef} onChange={handleFile} className="hidden" />
      <input type="file" accept="image/*" capture="environment" ref={cameraRef} onChange={handleFile} className="hidden" />

      {okUrl ? (
        <a href={okUrl} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-3">
          <Check size={16} style={{ color: '#059669' }} className="flex-shrink-0" />
          <span className="text-[12px] font-bold text-green-700">{reemplazo ? 'Comprobante cambiado' : 'Comprobante subido'} - toca para ver</span>
        </a>
      ) : uploading ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <div className="spinner flex-shrink-0" style={{ width: 18, height: 18 }} />
          <span className="text-[12px] font-bold text-blue-800">Subiendo comprobante…</span>
        </div>
      ) : actualUrl && !cambiando ? (
        <div className="rounded-xl border border-green-100 bg-green-50 p-3">
          <div className="flex items-center gap-2">
            <a href={actualUrl} target="_blank" rel="noreferrer"
              className="flex-1 min-w-0 flex items-center gap-2 text-[12px] font-bold text-green-700">
              <Check size={14} className="flex-shrink-0" />
              <span className="truncate">Comprobante actual</span>
            </a>
            <button type="button" onClick={() => { setErr(''); setCambiando(true) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold active:scale-98"
              style={{ background: '#FFFFFF', color: '#EA580C', border: '1px solid #FED7AA' }}>
              <RefreshCw size={12} /> Cambiar
            </button>
          </div>
        </div>
      ) : (
        <>
          {reemplazo && actualUrl && (
            <div className="flex items-start gap-2 mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: '#FFF7ED', color: '#9A3412' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>El nuevo archivo reemplazara el comprobante anterior para revision.</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { marcarPickerAbierto(); galeriaRef.current?.click() }}
              className="py-4 rounded-xl border-2 border-dashed flex flex-col items-center gap-1 active:scale-98"
              style={{ borderColor: '#FDBA74', background: '#FFF7ED' }}>
              <UploadIcon size={18} style={{ color: '#EA580C' }} />
              <span className="text-[12px] font-semibold" style={{ color: '#9A3412' }}>Galería / PDF</span>
            </button>
            <button type="button" onClick={() => { marcarPickerAbierto(); cameraRef.current?.click() }}
              className="py-4 rounded-xl border-2 border-dashed flex flex-col items-center gap-1 active:scale-98"
              style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }}>
              <Camera size={18} className="text-gray-400" />
              <span className="text-[12px] font-semibold text-gray-600">Cámara</span>
            </button>
          </div>
          {actualUrl && (
            <button type="button" onClick={() => { setErr(''); setCambiando(false); limpiar() }}
              className="w-full mt-2 rounded-lg px-3 py-2 text-[11px] font-bold text-gray-500"
              style={{ background: '#F3F4F6' }}>
              Cancelar cambio
            </button>
          )}
          {err && (
            <div className="flex items-center gap-2 mt-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: '#FEF2F2', color: '#B91C1C' }}>
              <AlertCircle size={12} /> {err}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ComprobanteTab({ tecnico, onCount }) {
  const [items, setItems]       = useState([])
  const [cargando, setCargando] = useState(true)
  const [listErr, setListErr]   = useState('')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    if (!tecnico?.id) return
    setCargando(true); setListErr('')
    try {
      // Los recibos son la fuente: partir de la lista de servicios (que crece sin
      // tope) con .limit() y sin .order() dejaba los servicios nuevos por fuera
      // cuando el técnico pasaba de 80 acumulados, y la pestaña decía "Al día".
      // El corte se aplica en la FUENTE (no al hidratar mascota/plan más abajo):
      // si se filtrara allí, el recibo previo al corte igual entraría a la lista
      // pero sin mascota ni plan.
      const { data: recs, error } = await db.from('recibos_tecnico')
        .select('id, servicio_id, numero_recibo, medios_pago, created_at, servicios!inner(fecha_ingreso)')
        .eq('tecnico_id', tecnico.id)
        .gte('servicios.fecha_ingreso', FECHA_CORTE)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      // Un item por recibo que tenga al menos un medio DIGITAL con monto > 0
      const recibos = (recs || []).filter(r =>
        Array.isArray(r.medios_pago) && r.medios_pago.some(m =>
          METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0))
      // Mascota/plan de esos servicios, en lotes (cientos de ids en .in() dan 414)
      const ids = [...new Set(recibos.map(r => r.servicio_id).filter(Boolean))]
      const svcById = {}
      for (let i = 0; i < ids.length; i += 80) {
        const { data: svcs } = await db.from('servicios')
          .select(`
            id, estado,
            mascotas:mascota_id ( nombre, especies(nombre), clientes:cliente_id(nombre, apellido) ),
            planes:plan_id ( nombre )
          `)
          .in('id', ids.slice(i, i + 80))
        for (const s of (svcs || [])) svcById[s.id] = s
      }
      const lista = []
      for (const r of recibos) {
        const medios  = Array.isArray(r.medios_pago) ? r.medios_pago : []
        const digital = medios.filter(m => METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0)
        const pendientes = digital.filter(m => !m.comprobanteUrl)
        const yaUrl      = digital.find(m => m.comprobanteUrl)?.comprobanteUrl || ''
        const svc        = svcById[r.servicio_id]
        if (svc?.estado === 'CANCELADO') continue
        lista.push({
          reciboId: r.id,
          svcId:    r.servicio_id,
          numero:   r.numero_recibo,
          mascota:  svc?.mascotas,
          plan:     svc?.planes?.nombre || '',
          metodos:  pendientes.length > 0 ? pendientes.map(m => m.metodo) : digital.map(m => m.metodo),
          monto:    digital.reduce((s, m) => s + (parseFloat(m.monto) || 0), 0),
          estado:   pendientes.length > 0 ? 'PENDIENTE' : 'SUBIDO',
          yaUrl,
        })
      }
      setItems(lista)
      if (onCount) onCount(lista.filter(i => i.estado === 'PENDIENTE').length)
    } catch (e) {
      setListErr(e.message || 'Error al cargar comprobantes')
    } finally { setCargando(false) }
  }, [tecnico?.id, onCount])

  useEffect(() => { cargar() }, [cargar])

  // Persistencia tras subir: jsonb (compat) + tabla formal recibo_comprobantes + novedad
  async function persistir(item, publicUrl, storagePath, val, { reemplazar = false } = {}) {
    // 1. Compat: actualizar el medio digital en el jsonb.
    let idx = -1
    try {
      const { data: row } = await db.from('recibos_tecnico').select('medios_pago').eq('id', item.reciboId).single()
      const arr = Array.isArray(row?.medios_pago) ? [...row.medios_pago] : []
      const esDigital = m => METODOS_CON_COMPROBANTE.includes(m.metodo) && parseFloat(m.monto) > 0
      idx = reemplazar
        ? arr.findIndex(m => esDigital(m) && m.comprobanteUrl)
        : arr.findIndex(m => esDigital(m) && !m.comprobanteUrl)
      if (idx < 0 && reemplazar) idx = arr.findIndex(esDigital)
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], comprobanteUrl: publicUrl }
        await db.from('recibos_tecnico').update({ medios_pago: arr }).eq('id', item.reciboId)
      }
    } catch (_) {}

    // 2. Fuente formal (asociacion por medio_pago_id; best-effort si la tabla existe).
    try {
      let medioPagoId = null
      const { data: rows } = await db.from('recibo_medios_pago')
        .select('id, metodo, created_at').eq('recibo_id', item.reciboId)
        .order('created_at', { ascending: true })
      if (rows?.length) {
        medioPagoId = (idx >= 0 && rows[idx]?.id) ||
          rows.find(r => METODOS_CON_COMPROBANTE.includes(r.metodo))?.id || null
      }
      if (reemplazar) {
        const marcarReemplazado = () => db.from('recibo_comprobantes')
          .update({ estado: 'RECHAZADO', error: 'Reemplazado por el tecnico' })
          .in('estado', ['PENDIENTE', 'SUBIDO', 'PENDIENTE_REVISION', 'APROBADO'])
        if (medioPagoId) await marcarReemplazado().eq('medio_pago_id', medioPagoId)
        await marcarReemplazado()
          .eq('recibo_id', item.reciboId)
          .eq('servicio_id', item.svcId)
          .is('medio_pago_id', null)
      }
      await db.from('recibo_comprobantes').insert({
        recibo_id:     item.reciboId,
        medio_pago_id: medioPagoId,
        servicio_id:   item.svcId,
        bucket:        'evidencias',
        storage_path:  storagePath,
        mime_type:     val.mime,
        size_bytes:    val.size || null,
        estado:        'PENDIENTE_REVISION',
        uploaded_by:   tecnico?.id || null,
      })
    } catch (_) {}

    // 3. Rastro para el coordinador.
    try {
      await db.from('novedades_servicio').insert({
        servicio_id:    item.svcId,
        tipo_novedad:   'NOTA',
        descripcion:    `Comprobante de pago ${reemplazar ? 'reemplazado' : 'subido'} (recibo ${item.numero}). Pendiente de revision.`,
        registrado_por: tecnico?.id || null,
      })
    } catch (_) {}
    await cargar()
  }

  const normalizarBusqueda = v => String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const termino = normalizarBusqueda(busqueda.trim())
  const itemsFiltrados = termino
    ? items.filter(item => {
        const mascota = item.mascota || {}
        const cliente = mascota.clientes || {}
        const texto = [
          mascota.nombre,
          cliente.nombre,
          cliente.apellido,
          item.numero,
          item.plan,
          ...(item.metodos || []),
        ].join(' ')
        return normalizarBusqueda(texto).includes(termino)
      })
    : items
  const hayBusqueda = termino.length > 0
  const pendientes = itemsFiltrados.filter(i => i.estado === 'PENDIENTE')
  const subidos    = itemsFiltrados.filter(i => i.estado === 'SUBIDO')

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
          🧾 Comprobantes de pago
        </div>
        <button onClick={cargar} disabled={cargando}
          className="text-[11px] font-bold px-2.5 py-1 rounded-lg disabled:opacity-50"
          style={{ background: '#FFEDD5', color: '#EA580C' }}>
          {cargando ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-[11px]"
        style={{ background: '#FFF7ED', color: '#9A3412' }}>
        <span className="text-base">💡</span>
        <span>Subí acá el comprobante de cada pago digital. Es una pantalla simple — no se reinicia como el recibo.</span>
      </div>

      {listErr && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3" style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={13} /> {listErr}
        </div>
      )}

      {items.length > 0 && (
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-400 pointer-events-none" />
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar mascota, cliente o recibo"
            aria-label="Buscar mascota en comprobantes"
            className="w-full h-11 rounded-xl border bg-white pl-9 pr-10 text-[16px] sm:text-[13px] font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-orange-200 placeholder:text-gray-400"
            style={{ borderColor: '#FED7AA', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}
          />
          {busqueda && (
            <button type="button" onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 active:scale-95"
              style={{ background: '#F3F4F6' }}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {cargando && items.length === 0 ? (
        <div className="flex justify-center py-10"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon="🧾" texto="Sin comprobantes por subir"
          sub="Cuando registres un pago por transferencia, Nequi, Daviplata o tarjeta, aparecerá aquí para subir el comprobante." />
      ) : (
        <>
          {itemsFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-8 text-center" style={{ borderColor: '#FED7AA', background: '#FFFBF7' }}>
              <Search size={22} className="mx-auto mb-2 text-orange-300" />
              <div className="text-[13px] font-bold text-gray-800">Sin resultados</div>
              <div className="text-[11px] text-gray-500 mt-1">Prueba con nombre de mascota, cliente o recibo.</div>
            </div>
          ) : (
            <>
              {pendientes.length === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl mb-3" style={{ background: '#D1FAE5', border: '1.5px solid #86EFAC' }}>
                  <CheckCircle size={15} style={{ color: '#16A34A' }} />
                  <span className="text-[12px] font-bold text-green-800">Al día - todos los comprobantes subidos</span>
                </div>
              )}

              {hayBusqueda && (
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                  {itemsFiltrados.length} resultado{itemsFiltrados.length !== 1 ? 's' : ''}
                </div>
              )}

              {pendientes.map(item => (
                <div key={item.reciboId} className="bg-white rounded-2xl p-4 border mb-2 shadow-sm" style={{ borderColor: '#FED7AA' }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 26 }}>{petEmoji(item.mascota?.especies?.nombre)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 leading-tight">{item.mascota?.nombre || '-'}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {item.plan ? `${item.plan} - ` : ''}{item.mascota?.clientes?.nombre} {item.mascota?.clientes?.apellido}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FFEDD5', color: '#9A3412' }}>
                          {item.metodos.join(', ')} - {fmt(item.monto)}
                        </span>
                        <span className="text-[10px] text-gray-400">No. {item.numero}</span>
                      </div>
                    </div>
                  </div>
                  <ComprobanteUploader
                    servicioId={item.svcId}
                    stashId={item.reciboId}
                    onSubido={(url, path, val) => persistir(item, url, path, val)}
                  />
                </div>
              ))}

              {subidos.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Subidos</div>
                  {subidos.map(item => (
                    <div key={`${item.reciboId}_${item.yaUrl || 'subido'}`}
                      className="bg-white rounded-2xl p-3 border border-gray-100 mb-2 shadow-sm">
                      <div className="flex items-center gap-3">
                        <span style={{ fontSize: 22 }}>{petEmoji(item.mascota?.especies?.nombre)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-800 text-[13px] leading-tight">{item.mascota?.nombre || '-'}</div>
                          <div className="text-[10px] text-gray-400">No. {item.numero}</div>
                          <div className="text-[10px] text-gray-500 truncate">{item.metodos.join(', ')} - {fmt(item.monto)}</div>
                        </div>
                        <span className="text-[11px] font-bold text-green-700 flex items-center gap-1 flex-shrink-0">
                          <Check size={12} /> Subido
                        </span>
                      </div>
                      <ComprobanteUploader
                        servicioId={item.svcId}
                        stashId={`${item.reciboId}_reemplazo`}
                        actualUrl={item.yaUrl}
                        reemplazo
                        onSubido={(url, path, val) => persistir(item, url, path, val, { reemplazar: true })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── RECIBO FORM ────────────────────────────────────────────────────────────
function ReciboForm({ svcData, servicioSel, tecnico, reciboExistente = null, onVolver, onGuardado }) {
  const mascota = svcData.mascotas
  const cliente = mascota?.clientes
  const plan    = svcData.planes
  const aliado  = svcData.aliados

  const now          = new Date()
  const numeroRecibo = `CAC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${servicioSel.id.slice(0,6).toUpperCase()}`
  const fechaHoy     = now.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' })
  const horaActual   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

  const saldoPendiente = Math.max(0, (svcData.valor_total || 0) - (svcData.valor_pagado || 0))

  // ── Lógica recibo veterinaria ────────────────────────────────────────────
  // Usamos `comision_descontada` como fuente de verdad:
  //   true  → la comisión YA fue restada de valor_total al registrar el servicio
  //           → precioOriginal = valor_total + comision_aliado (reconstruimos el bruto)
  //           → valorVet = precioOriginal - comision (lo que el aliado paga a Camino)
  //   false → valor_total ya es el precio completo; comisión se gestiona por separado
  //           → precioOriginal = valor_total
  //           → valorVet = precioOriginal (sin deducción en este recibo)
  const modalidad           = aliado?.modalidad_comision || ''
  const comisionGuardada    = svcData.comision_aliado || 0
  const comisionFueDescontada = svcData.comision_descontada === true

  const precioOriginal = comisionFueDescontada
    ? (svcData.valor_total || 0) + comisionGuardada  // reconstruimos bruto
    : (svcData.valor_total || 0)                      // ya es el precio completo

  // ── Estado: declarados ANTES de useEffects para evitar TDZ en sus dependency arrays ──
  const montoClienteDefault = comisionFueDescontada ? precioOriginal : saldoPendiente
  const [tipoRecibo, setTipoRecibo]   = useState(reciboExistente?.tipo || 'CLIENTE')
  const [form, setForm] = useState(() => {
    const base = {
      fecha:              fechaHoy,
      hora:               horaActual,
      numero_recibo:      numeroRecibo,
      mascota_nombre:     mascota?.nombre || '',
      peso:               svcData.peso_confirmado || mascota?.peso_kg || '',
      especie:            mascota?.especies?.nombre || '',
      veterinaria:        aliado?.nombre || '',
      propietario:        `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim(),
      email:              cliente?.email || '',
      telefono:           cliente?.telefono || cliente?.telefono2 || cliente?.whatsapp || '',
      casa:               servicioSel.direccion_recogida || '',
      servicio:           plan?.nombre || '',
      valor_servicio:     precioOriginal,
      total_recibido:     saldoPendiente,
      toma_huella:        false,
      toma_mechon:        false,
      entrega_rec_basicos: false,
      nombre_recibe:      '',
      confirmacion_foto:  false,
      observaciones:      '',
    }
    // Recibo ya guardado en DB (reabierto desde Recibos): restaurar sus datos
    if (reciboExistente?.datos_form) {
      const { pago_pendiente: _pp, ...datos } = reciboExistente.datos_form
      return { ...base, ...datos }
    }
    return base
  })
  const [mediosPago, setMediosPago] = useState(() =>
    Array.isArray(reciboExistente?.medios_pago) && reciboExistente.medios_pago.length > 0
      ? reciboExistente.medios_pago.map(m => ({ referencia: '', comprobanteUrl: '', ...m, subiendoComprobante: false }))
      : [{ metodo: 'EFECTIVO', monto: montoClienteDefault, referencia: '', comprobanteUrl: '', subiendoComprobante: false }]
  )
  const [guardado, setGuardado]         = useState(!!reciboExistente)
  const [pagoPendiente, setPagoPendiente] = useState(reciboExistente?.datos_form?.pago_pendiente || false)
  // Motivo cuando el técnico cobra MÁS que el valor del recibo (obligatorio
  // para guardar en ese caso; la RPC lo exige — migración 041)
  const [sobrepagoMotivo, setSobrepagoMotivo] = useState(reciboExistente?.datos_form?.sobrepago_motivo || '')

  // ── Auto-guardado en localStorage para sobrevivir cambios de pestaña / app ──
  const DRAFT_KEY = `recibo_draft_${servicioSel.id}`
  useEffect(() => {
    if (reciboExistente) return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft.form)                         setForm(f => ({ ...f, ...draft.form }))
      if (draft.mediosPago)                   setMediosPago(draft.mediosPago.map(m => ({ ...m, subiendoComprobante: false })))
      if (draft.tipoRecibo)                   setTipoRecibo(draft.tipoRecibo)
      if (draft.pagoPendiente !== undefined)  setPagoPendiente(draft.pagoPendiente)
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (guardado) { localStorage.removeItem(DRAFT_KEY); return }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, mediosPago, tipoRecibo, pagoPendiente }))
    } catch (_) {}
  }, [form, mediosPago, tipoRecibo, guardado, pagoPendiente])

  // ── Reanudar comprobantes que quedaron a medias si la app se reinició ──
  // El archivo quedó en IndexedDB (stashPut antes de subir); aquí se retoma
  // la subida sin que el técnico tenga que volver a buscarlo. Aplica también
  // a recibos ya guardados: el comprobante pendiente se completa sobre la fila.
  useEffect(() => {
    ;(async () => {
      const pendientes = await stashGetByPrefix(`recibo_${servicioSel.id}_`)
      if (pendientes.some(p => p.blob)) setReanudando(true)
      for (const p of pendientes) {
        const idx = parseInt(p.key.split('_').pop(), 10)
        if (Number.isNaN(idx) || !p.blob) { stashDelete(p.key); continue }
        // Garantizar que el medio exista en la lista restaurada del draft
        setMediosPago(prev => prev.length > idx ? prev
          : [...prev, ...Array.from({ length: idx + 1 - prev.length },
              () => ({ metodo: 'TRANSFERENCIA', monto: '', referencia: '', comprobanteUrl: '', subiendoComprobante: false }))])
        subirComprobante(idx, p.blob, { recuperado: true })
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Porcentaje real: se consulta de config_comisiones para evitar distorsión por recargos
  const [comisionPct, setComisionPct] = useState(
    comisionFueDescontada && precioOriginal > 0
      ? parseFloat((comisionGuardada / precioOriginal * 100).toFixed(1))
      : 0
  )
  // BASE de la comisión = VALOR DEL PLAN (no el total). El coordinador guarda
  // comision_aliado = valor_plan × %; el total puede incluir transporte,
  // adicionales y recargos que NO son comisionables. Como el servicio no guarda
  // el valor del plan por separado, lo reconstruimos: valor_plan = comision /(%/100).
  // Init = precioOriginal: con el % diluido inicial (comision/precioOriginal) da
  // exactamente comision_aliado hasta que carga el % real de config y lo corrige.
  const [valorPlanBase, setValorPlanBase] = useState(precioOriginal)
  // Estados para FACTURACION_MENSUAL — permiten corregir monto/% cuando comision_aliado=0 en DB
  const [comisionManual,    setComisionManual]    = useState(comisionGuardada)
  const [comisionManualPct, setComisionManualPct] = useState(
    precioOriginal > 0 ? Math.round(comisionGuardada / precioOriginal * 100) : 0
  )
  useEffect(() => {
    if (!svcData.plan_id) return
    if (comisionFueDescontada) {
      // DESCUENTO_INMEDIATO: consultar config para % exacto sin distorsión por recargos
      if (comisionGuardada <= 0) return
      db.from('config_comisiones')
        .select('porcentaje, rango_min, rango_max')
        .eq('plan_id', svcData.plan_id)
        .eq('es_vip', aliado?.vip ?? false)
        .then(({ data: rows }) => {
          if (!rows?.length) return
          const best = rows.reduce((acc, r) => {
            const base = precioOriginal > 0 ? precioOriginal : 1
            const diffAcc = Math.abs(base * parseFloat(acc.porcentaje) / 100 - comisionGuardada)
            const diffR   = Math.abs(base * parseFloat(r.porcentaje)   / 100 - comisionGuardada)
            return diffR < diffAcc ? r : acc
          })
          const pct = parseFloat(best.porcentaje)
          setComisionPct(pct)
          // Reconstruir el valor del plan (base comisionable) desde la comisión guardada
          if (pct > 0) setValorPlanBase(Math.round(comisionGuardada * 100 / pct))
        })
    } else if (aliado?.vip) {
      // FACTURACION_MENSUAL + VIP: tasas fijas por tipo de proceso (igual que Registro.jsx)
      const tipo = plan?.tipo_proceso || ''
      let pct = 32 // CREMACION_GRUPAL
      if (tipo === 'COMPOSTAJE_GRUPAL') pct = 10
      else if (tipo === 'CREMACION_INDIVIDUAL' || tipo === 'COMPOSTAJE_INDIVIDUAL') pct = 27
      setComisionManualPct(pct)
      if (comisionGuardada <= 0) {
        // comision_aliado=0 en DB (servicio previo al fix) — calcularlo para mostrar y corregir al guardar
        setComisionManual(Math.round(precioOriginal * pct / 100))
      }
    }
  }, [])
  // Comisión SOLO sobre el valor del plan, no sobre el total (transporte/adicionales/recargos)
  const comisionMonto = comisionFueDescontada ? Math.round(valorPlanBase * comisionPct / 100) : 0
  // Solo se deduce en recibo cuando la comisión fue aplicada inmediatamente
  const valorVet = comisionFueDescontada
    ? Math.max(0, precioOriginal - comisionMonto)
    : precioOriginal

  const [tipoFijado, setTipoFijado]   = useState(!!reciboExistente)

  const totalMedios = mediosPago.reduce((s, m) => s + (parseFloat(m.monto) || 0), 0)

  const [firma, setFirma]           = useState(null)
  const [generando, setGenerando]   = useState(false)
  const [guardando, setGuardando]   = useState(false)
  // Con recibo existente, el pago ya quedó registrado al guardarlo la primera vez
  const [pagoRegistrado,  setPagoRegistrado]  = useState(!!reciboExistente)
  const [reciboId,        setReciboId]        = useState(reciboExistente?.id || null)
  const [err, setErr]               = useState('')
  // Si la subida se reanuda sola tras un reinicio del teléfono, mostramos aviso
  const [reanudando, setReanudando] = useState(false)
  // Aviso flotante FIJO arriba (visible sin importar el scroll) del estado del
  // comprobante: { tipo: 'subiendo' | 'ok' | 'err', msg }
  const [comproFlash, setComproFlash] = useState(null)

  const uploadRefs    = useRef({})   // input galería / archivo (incluye PDF)
  const comproCamRefs = useRef({})   // input cámara directa
  const topRef        = useRef(null)
  // reciboId puede cambiar (al guardar) MIENTRAS un comprobante sube en segundo
  // plano; usamos un ref para anclar a la fila correcta aunque el closure sea viejo.
  const reciboIdRef = useRef(reciboId)
  useEffect(() => { reciboIdRef.current = reciboId }, [reciboId])
  // idx del medio que está abriendo el selector: mientras no sea null se muestra
  // SOLO la pantalla liviana (early-return) para que el selector no mate la PWA.
  const [comproOverlay, setComproOverlay] = useState(null)

  // Limpia el value de ambos inputs del medio idx para permitir reseleccionar
  // el MISMO archivo tras un intento (si no, onChange no vuelve a dispararse).
  const limpiarInputsComprobante = idx => {
    if (uploadRefs.current[idx])    uploadRefs.current[idx].value    = ''
    if (comproCamRefs.current[idx]) comproCamRefs.current[idx].value = ''
  }

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function addMedio() {
    setMediosPago(prev => [...prev, { metodo: 'EFECTIVO', monto: '', referencia: '', comprobanteUrl: '', subiendoComprobante: false }])
  }

  function removeMedio(idx) {
    setMediosPago(prev => prev.filter((_, i) => i !== idx))
  }

  function updateMedio(idx, field, value) {
    setMediosPago(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  // Al cambiar el tipo de recibo el monto por defecto es distinto: el CLIENTE paga
  // el precio del servicio; la VETERINARIA paga el neto (precio − comisión). Sin
  // esto, al pasar de cliente a veterinaria quedaba el valor del cliente en el
  // recibo de la vet. Reseteamos a un único medio con el monto correcto del tipo.
  function cambiarTipo(nuevoTipo) {
    if (nuevoTipo === tipoRecibo) return
    setTipoRecibo(nuevoTipo)
    const monto = nuevoTipo === 'VETERINARIA' ? valorVet : montoClienteDefault
    setMediosPago([{ metodo: 'EFECTIVO', monto, referencia: '', comprobanteUrl: '', subiendoComprobante: false }])
  }

  // En recibo de veterinaria el monto a cobrar es el neto (valorVet); si el técnico
  // ajusta la comisión %, el medio único sigue ese valor. No toca recibos ya
  // guardados ni pagos divididos (más de un medio).
  useEffect(() => {
    if (guardado || reciboExistente || tipoRecibo !== 'VETERINARIA') return
    setMediosPago(prev => prev.length === 1 ? [{ ...prev[0], monto: valorVet }] : prev)
  }, [valorVet, tipoRecibo, guardado]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clave de idempotencia estable por borrador: sobrevive a reinicios
  // (localStorage) y a doble-click (mismo valor) → la RPC no duplica el recibo
  // ni vuelve a sumar el pago. Se limpia al volver / cuando el recibo queda OK.
  const idemKeyRef = useRef(null)
  function getIdemKey() {
    if (idemKeyRef.current) return idemKeyRef.current
    const k = `recibo_idem_${servicioSel.id}`
    let v = null
    try { v = localStorage.getItem(k) } catch (_) {}
    if (!v) {
      v = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
      try { localStorage.setItem(k, v) } catch (_) {}
    }
    idemKeyRef.current = v
    return v
  }
  function limpiarIdemKey() {
    idemKeyRef.current = null
    try { localStorage.removeItem(`recibo_idem_${servicioSel.id}`) } catch (_) {}
  }

  async function subirComprobante(idx, file, { recuperado = false } = {}) {
    if (!file) return
    const val = validarArchivo(file, { permitirPdf: true })
    if (val.error) {
      setErr(val.error)
      limpiarInputsComprobante(idx)
      return
    }
    const stashKey = `recibo_${servicioSel.id}_${idx}`
    // Guardar el archivo en IndexedDB ANTES de subir: si Android mata la
    // pestaña a mitad de camino, al volver se reanuda la subida automáticamente.
    if (!recuperado) await stashPut(stashKey, file)
    updateMedio(idx, 'subiendoComprobante', true)
    updateMedio(idx, 'comproError', '')   // limpiar error previo al reintentar
    setComproFlash({ tipo: 'subiendo', msg: 'Subiendo comprobante…' })
    try {
      // Subir el archivo ORIGINAL sin comprimir ni convertir a JPG: el PDF
      // (que nunca pasó por compresión) siempre funcionó; la rama de imagen
      // con createImageBitmap/canvas era la que fallaba desde galería Android
      const path = `comprobantes/${servicioSel.id}/${Date.now()}_${idx}.${val.ext}`
      const { data, error: upErr } = await conTimeout(
        db.storage.from('evidencias').upload(path, file, {
          upsert: false,
          contentType: val.mime,
        }),
        'La subida tardó demasiado — revisa la señal'
      )
      if (upErr) throw upErr
      // TODO Fase 3/7 (privacidad del bucket): el comprobante NO debería servirse
      // con publicUrl. `recibo_comprobantes.storage_path` ya guarda la ruta cruda
      // (no la URL pública). Plan: marcar el bucket `evidencias` como privado y que
      // admin/coordinador abran el comprobante con `createSignedUrl(storage_path)`.
      // Se mantiene publicUrl en el jsonb por compatibilidad con los visores actuales.
      const { data: { publicUrl } } = db.storage.from('evidencias').getPublicUrl(data.path)
      updateMedio(idx, 'comprobanteUrl', publicUrl)
      // Persistir la URL en la fila del recibo DE INMEDIATO: si la PWA muere
      // después de subir, el comprobante ya quedó en DB (no solo en useState).
      // Usamos el REF (no el closure): si el recibo se guardó mientras la subida
      // corría en segundo plano, reciboIdRef ya tiene el id y se ancla igual.
      const rid = reciboIdRef.current
      if (rid) {
        const { data: row, error: rowErr } = await db.from('recibos_tecnico')
          .select('medios_pago').eq('id', rid).single()
        if (rowErr) throw new Error('Comprobante subido pero no se pudo anclar al recibo: ' + rowErr.message)
        const arr = Array.isArray(row?.medios_pago) ? [...row.medios_pago] : []
        while (arr.length <= idx) arr.push({ metodo: 'TRANSFERENCIA', monto: '', referencia: '', comprobanteUrl: '' })
        arr[idx] = { ...arr[idx], comprobanteUrl: publicUrl }
        const { error: updErr } = await db.from('recibos_tecnico')
          .update({ medios_pago: arr }).eq('id', rid)
        if (updErr) throw new Error('Comprobante subido pero no se pudo anclar al recibo: ' + updErr.message)

        // Fuente formal: registrar el comprobante en recibo_comprobantes por
        // medio_pago_id (no por índice visual). Estrictamente ADITIVO y
        // tragado: si la tabla nueva aún no existe (despliegue gradual) o
        // falla, el flujo de arriba ya dejó el comprobante en DB (jsonb).
        // Guardamos storage_path (no publicUrl) para poder migrar a URL firmada.
        try {
          let medioPagoId = mediosPago[idx]?.medioPagoId || null
          if (!medioPagoId) {
            // El recibo pudo guardarse por la RPC (hay filas formales): mapear
            // idx → medio por orden de creación (mismo orden del array de medios).
            const { data: rows } = await db.from('recibo_medios_pago')
              .select('id').eq('recibo_id', rid)
              .order('created_at', { ascending: true })
            medioPagoId = rows?.[idx]?.id || null
          }
          await db.from('recibo_comprobantes').insert({
            recibo_id:     rid,
            medio_pago_id: medioPagoId,
            servicio_id:   servicioSel.id,
            bucket:        'evidencias',
            storage_path:  data.path,
            mime_type:     val.mime,
            size_bytes:    file.size || null,
            estado:        'PENDIENTE_REVISION',
            uploaded_by:   tecnico?.id || null,
          })
        } catch (_) { /* tabla nueva opcional — no romper el flujo */ }
      }
      await stashDelete(stashKey)
      setComproFlash({ tipo: 'ok', msg: '✅ Comprobante subido correctamente' })
      setTimeout(() => setComproFlash(f => (f?.tipo === 'ok' ? null : f)), 5000)
    } catch (e) {
      updateMedio(idx, 'comproError', String(e.message || e).slice(0, 90))
      setComproFlash({ tipo: 'err', msg: 'No se pudo subir el comprobante. Toca Reintentar.' })
    } finally {
      updateMedio(idx, 'subiendoComprobante', false)
      setReanudando(false)
      // Sin esto, re-seleccionar el MISMO archivo tras un fallo no dispara
      // onChange (el input conserva su value) y el comprobante "no carga"
      limpiarInputsComprobante(idx)
    }
  }

  // Reintentar la subida usando el archivo ya guardado en el teléfono (stash),
  // sin volver a abrir el selector (evita el riesgo de reinicio del selector).
  async function reintentarComprobante(idx) {
    const pendientes = await stashGetByPrefix(`recibo_${servicioSel.id}_${idx}`)
    const blob = pendientes.find(p => p.key === `recibo_${servicioSel.id}_${idx}`)?.blob
    if (blob) subirComprobante(idx, blob, { recuperado: true })
    else setComproOverlay(idx)   // ya no está el archivo: volver a elegirlo
  }

  const esFacturacionMensual = modalidad === 'FACTURACION_MENSUAL' && tipoRecibo === 'VETERINARIA'

  // Cobro superior al valor del recibo — misma condición que valida la RPC
  // (tolerancia de $1 por redondeos). Se permite solo con motivo explícito
  // (migración 041). OJO: declarado DESPUÉS de esFacturacionMensual (TDZ).
  const valorReciboNum = parseFloat(form.valor_servicio) || 0
  const haySobrepago   = !pagoPendiente && !esFacturacionMensual
    && valorReciboNum > 0 && totalMedios > valorReciboNum + 1
  const sobrepagoDiff  = haySobrepago ? totalMedios - valorReciboNum : 0

  // Medios digitales con cobro pero sin comprobante adjunto todavía
  const comprobantesPendientes = mediosPago.filter(m =>
    METODOS_CON_COMPROBANTE.includes(m.metodo) &&
    parseFloat(m.monto) > 0 &&
    !m.comprobanteUrl
  )

  // Arma el texto de las novedades con el formato del front (fmt, etc.) para
  // que la RPC los inserte. Centralizado para reusarlo en RPC y respaldo legacy.
  function construirNovedades(sinComprobante) {
    const detallePagos = mediosPago.map(m => {
      let txt = `${m.metodo}: ${fmt(parseFloat(m.monto)||0)}`
      if (m.referencia) txt += ` (Ref: ${m.referencia})`
      if (m.comprobanteUrl) txt += ` ✅comprobante`
      return txt
    }).join(' | ')
    const novedadPago = (!pagoPendiente && !esFacturacionMensual && totalMedios > 0)
      ? `Técnico recibió ${fmt(totalMedios)} — ${detallePagos}`
      : null
    let novedadNota = null
    if (pagoPendiente) {
      novedadNota = `Recibo generado con pago pendiente — ${fmt(svcData.valor_total || 0)}. El cliente liquidará posteriormente. No. ${form.numero_recibo}.`
    } else if (esFacturacionMensual) {
      novedadNota = comisionFueDescontada
        ? `Recibo VET generado — ${aliado?.nombre || 'aliado'} — Total neto ${fmt(valorVet)} (servicio ${fmt(precioOriginal)} − comisión ${fmt(comisionMonto)}). Queda PENDIENTE para facturación mensual. No. ${form.numero_recibo}.`
        : `Recibo VET generado — ${aliado?.nombre || 'aliado'} — ${fmt(precioOriginal)}. Comisión ${fmt(comisionManual)} pendiente de facturación mensual. No. ${form.numero_recibo}.`
    } else if (sinComprobante.length > 0) {
      novedadNota = `Recibo ${form.numero_recibo} guardado con comprobante PENDIENTE (${sinComprobante.map(m => m.metodo).join(', ')}). El técnico puede reintentarlo desde el módulo Recibos.`
    }
    return { novedadPago, novedadNota }
  }

  // Sube el PDF del recibo al storage SIEMPRE que se guarda (antes solo se
  // subía al enviarlo por WhatsApp) — así coordinación puede abrirlo desde
  // Orbit (Kanban/Gestión) aunque el técnico nunca lo envíe. Fire-and-forget:
  // si falla no afecta el guardado (el envío por WA lo vuelve a subir).
  function subirPdfReciboAlStorage(tipo = tipoRecibo) {
    ;(async () => {
      try {
        const pdfBlob = await descargarPDF(tipo, true, true)
        if (!pdfBlob) return
        const suffix   = tipo === 'VETERINARIA' ? '_VET' : '_CLI'
        const fileName = `recibos/${servicioSel.id}/${form.numero_recibo}${suffix}_${Date.now()}.pdf`
        await db.storage.from('evidencias')
          .upload(fileName, pdfBlob, { upsert: true, contentType: 'application/pdf' })
      } catch (_) { /* best-effort */ }
    })()
  }

  async function guardarRecibo() {
    // Para FACTURACION_MENSUAL vet o pago pendiente: no se requiere cobro inmediato
    if (!esFacturacionMensual && !pagoPendiente && totalMedios <= 0 && saldoPendiente > 0) {
      setErr('Registra al menos un medio de pago con monto.')
      return
    }
    // Cobrar más que el recibo se permite, pero SIEMPRE explicando la diferencia
    if (haySobrepago && !sobrepagoMotivo.trim()) {
      setErr(`Estás cobrando ${fmt(sobrepagoDiff)} más que el valor del recibo. Indica de qué es esa diferencia antes de guardar.`)
      return
    }
    // El comprobante NO bloquea la creación del recibo: si falta, el recibo
    // se guarda igual y queda como "comprobante pendiente" para reintentar
    const sinComprobante = comprobantesPendientes
    setGuardando(true); setErr('')
    try {
      const { novedadPago, novedadNota } = construirNovedades(sinComprobante)
      const medios = pagoPendiente
        ? []
        : mediosPago.map(({ metodo, monto, referencia, comprobanteUrl }) => ({ metodo, monto, referencia, comprobanteUrl }))
      // Corrección de comisión solo si el servicio quedó con comision_aliado=0 (previo al fix VIP)
      const comisionParaGuardar = (esFacturacionMensual && !comisionFueDescontada && comisionGuardada <= 0 && comisionManual > 0)
        ? comisionManual : null

      // ── Camino transaccional e idempotente (RPC) ──────────────────────────
      const { data: rpcData, error: rpcErr } = await db.rpc('guardar_recibo_tecnico', {
        p_servicio_id:            servicioSel.id,
        p_idempotency_key:        getIdemKey(),
        p_tipo:                   tipoRecibo,
        p_numero_recibo:          form.numero_recibo,
        p_fecha_emision:          hoyLocalISO(now),
        p_hora_emision:           horaActual,
        p_valor_total:            form.valor_servicio,
        p_medios:                 medios,
        p_datos_form:             { ...form, pago_pendiente: pagoPendiente },
        p_pago_pendiente:         pagoPendiente,
        p_es_facturacion_mensual: esFacturacionMensual,
        p_actor_id:               tecnico?.id || null,
        p_actor_rol:              tecnico?.rol || 'TECNICO',
        p_comision_aliado:        comisionParaGuardar,
        p_novedad_pago:           novedadPago,
        p_novedad_nota:           novedadNota,
        p_sobrepago_motivo:       haySobrepago ? sobrepagoMotivo.trim() : null,
      })

      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        // La función aún no está desplegada (despliegue gradual) → respaldo legacy
        if (rpcErr.code === 'PGRST202' || /could not find the function|does not exist|schema cache/i.test(msg)) {
          await guardarReciboLegacy(sinComprobante)
          return
        }
        // Errores de validación de la RPC → mensaje claro, sin reintentar
        if (/SERVICIO_CANCELADO/.test(msg)) { setErr('Este servicio fue cancelado. No se puede generar un recibo nuevo — comunícate con el coordinador.'); return }
        if (/SOBREPAGO/.test(msg))          { setErr('El total cobrado supera el valor del recibo. Revisa los montos o indica el motivo de la diferencia.'); return }
        if (/NO_AUTORIZADO/.test(msg))      { setErr('No estás asignado a la recogida de este servicio. Avísale al coordinador.'); return }
        if (/MONTO_NEGATIVO/.test(msg))     { setErr('Los montos de pago no pueden ser negativos.'); return }
        // Cualquier OTRO error de la RPC (bug, drift de esquema, etc.): la RPC es
        // transaccional y ya hizo rollback → NO hay duplicado. Caemos al camino
        // legacy (PostgREST castea los tipos) para no bloquear el cobro del técnico.
        console.warn('[recibo] RPC fallback a legacy:', msg)
        await guardarReciboLegacy(sinComprobante)
        return
      }

      const res = rpcData || {}
      setReciboId(res.recibo_id)
      reciboIdRef.current = res.recibo_id
      // Anclar medio_pago_id a cada medio: asocia comprobantes sin depender del índice
      if (Array.isArray(res.medios) && res.medios.length) {
        setMediosPago(prev => prev.map((m, i) => {
          const match = res.medios.find(x => x.idx === i)
          return match ? { ...m, medioPagoId: match.id } : m
        }))
      }
      if (res.pago_registrado) setPagoRegistrado(true)
      setGuardado(true)
      setTipoFijado(true)
      limpiarIdemKey()
      subirPdfReciboAlStorage()
      if (onGuardado) onGuardado(res.recibo_id)
    } catch (e) {
      setErr('Error al guardar: ' + (e.message || e))
    } finally {
      setGuardando(false)
    }
  }

  // ── Respaldo legacy (sin transacción) — solo si la RPC no está desplegada ──
  // Conserva el comportamiento previo para no romper el flujo durante el
  // despliegue. NO maneja setGuardando (lo hace guardarRecibo).
  async function guardarReciboLegacy(sinComprobante) {
    // Un servicio cancelado no puede generar recibos nuevos
    const { data: svcActual } = await db.from('servicios')
      .select('estado').eq('id', servicioSel.id).maybeSingle()
    if (svcActual?.estado === 'CANCELADO') {
      setErr('Este servicio fue cancelado. No se puede generar un recibo nuevo — comunícate con el coordinador.')
      return
    }
    // Fix #4: valor_cobrado = suma real de medios (no el saldo asumido), igual que la RPC
    const valorCobrado  = pagoPendiente ? 0 : totalMedios
    const { data, error } = await db.from('recibos_tecnico').insert({
        servicio_id:     servicioSel.id,
        tecnico_id:      tecnico?.id || null,
        numero_recibo:   form.numero_recibo,
        tipo:            tipoRecibo,
        fecha_emision:   hoyLocalISO(now),
        hora_emision:    horaActual,
        valor_total:     form.valor_servicio,
        valor_cobrado:   valorCobrado,
        medios_pago:     pagoPendiente ? [] : mediosPago.map(({ metodo, monto, referencia, comprobanteUrl }) => ({ metodo, monto, referencia, comprobanteUrl })),
        datos_form:      {
          ...form, pago_pendiente: pagoPendiente,
          ...(haySobrepago ? { sobrepago_valor: sobrepagoDiff, sobrepago_motivo: sobrepagoMotivo.trim() } : {}),
        },
        estado:          'GUARDADO',
      }).select('id').single()
      if (error) throw error
      setReciboId(data.id)

      if (pagoPendiente) {
        // Pago diferido — no se registra cobro ahora
        await db.from('novedades_servicio').insert({
          servicio_id:    servicioSel.id,
          tipo_novedad:   'NOTA',
          descripcion:    `Recibo generado con pago pendiente — ${fmt(svcData.valor_total || 0)}. El cliente liquidará posteriormente. No. ${form.numero_recibo}.`,
          registrado_por: tecnico?.id || null,
        })
      } else if (esFacturacionMensual) {
        // No se registra cobro ahora — dejar estado_pago como PENDIENTE
        // Si comision_aliado=0 en DB (servicio registrado antes del fix VIP) — corregirlo ahora
        if (!comisionFueDescontada && comisionGuardada <= 0 && comisionManual > 0) {
          await db.from('servicios').update({ comision_aliado: comisionManual }).eq('id', servicioSel.id)
        }
        // Con descuento aplicado (regla Animal City): el total a facturar ya es neto
        const descNovedad = comisionFueDescontada
          ? `Recibo VET generado — ${aliado?.nombre || 'aliado'} — Total neto ${fmt(valorVet)} (servicio ${fmt(precioOriginal)} − comisión ${fmt(comisionMonto)}). Queda PENDIENTE para facturación mensual. No. ${form.numero_recibo}.`
          : `Recibo VET generado — ${aliado?.nombre || 'aliado'} — ${fmt(precioOriginal)}. Comisión ${fmt(comisionManual)} pendiente de facturación mensual. No. ${form.numero_recibo}.`
        await db.from('novedades_servicio').insert({
          servicio_id:    servicioSel.id,
          tipo_novedad:   'NOTA',
          descripcion:    descNovedad,
          registrado_por: tecnico?.id || null,
        })
      } else if (!pagoRegistrado && totalMedios > 0) {
        // Conteo único (migración 027): si otro recibo del servicio ya sumó a
        // valor_pagado (regeneración o doble documento CLIENTE+VET del mismo
        // cobro), ese aporte se resta primero — el mismo cobro no se suma dos
        // veces. Best-effort: si la columna pago_aplicado aún no existe en DB
        // (despliegue gradual), prevAplicado queda 0 y se comporta como antes.
        const { data: prevRecs } = await db.from('recibos_tecnico')
          .select('id, pago_aplicado')
          .eq('servicio_id', servicioSel.id)
          .neq('id', data.id)
          .gt('pago_aplicado', 0)
        const prevAplicado = (prevRecs || []).reduce((a, r) => a + (parseFloat(r.pago_aplicado) || 0), 0)
        const nuevoPagado = Math.max((svcData.valor_pagado || 0) - prevAplicado, 0) + totalMedios
        const nuevoEstado = nuevoPagado >= (svcData.valor_total || 0) ? 'COMPLETO' : 'PARCIAL'
        if (prevRecs?.length) {
          await db.from('recibos_tecnico').update({ pago_aplicado: 0 }).in('id', prevRecs.map(r => r.id))
        }
        await db.from('recibos_tecnico').update({ pago_aplicado: totalMedios }).eq('id', data.id)
        await db.from('servicios').update({
          valor_pagado: nuevoPagado,
          estado_pago:  nuevoEstado,
          medios_pago:  mediosPago.map(m => m.metodo).join(', '),
        }).eq('id', servicioSel.id)
        const detallePagos = mediosPago.map(m => {
          let txt = `${m.metodo}: ${fmt(parseFloat(m.monto)||0)}`
          if (m.referencia) txt += ` (Ref: ${m.referencia})`
          if (m.comprobanteUrl) txt += ` ✅comprobante`
          return txt
        }).join(' | ')
        await db.from('novedades_servicio').insert({
          servicio_id:    servicioSel.id,
          tipo_novedad:   'PAGO_RECIBIDO',
          descripcion:    `Técnico recibió ${fmt(totalMedios)} — ${detallePagos}`,
          valor_ajuste:   totalMedios,
          registrado_por: tecnico?.id || null,
        })
        setPagoRegistrado(true)
      }

      // Dejar rastro visible para el coordinador si quedó comprobante pendiente
      if (!esFacturacionMensual && !pagoPendiente && sinComprobante.length > 0) {
        await db.from('novedades_servicio').insert({
          servicio_id:    servicioSel.id,
          tipo_novedad:   'NOTA',
          descripcion:    `Recibo ${form.numero_recibo} guardado con comprobante PENDIENTE (${sinComprobante.map(m => m.metodo).join(', ')}). El técnico puede reintentarlo desde el módulo Recibos.`,
          registrado_por: tecnico?.id || null,
        })
      }

      // Rastro del cobro superior al recibo (en la RPC lo hace el servidor)
      if (haySobrepago) {
        await db.from('novedades_servicio').insert({
          servicio_id:    servicioSel.id,
          tipo_novedad:   'NOTA',
          descripcion:    `💰 Cobro SUPERIOR al recibo ${form.numero_recibo}: recibió ${fmt(totalMedios)} vs recibo ${fmt(valorReciboNum)} (diferencia +${fmt(sobrepagoDiff)}). Motivo del técnico: ${sobrepagoMotivo.trim()}`,
          valor_ajuste:   sobrepagoDiff,
          registrado_por: tecnico?.id || null,
        })
      }

    setGuardado(true)
    setTipoFijado(true)
    limpiarIdemKey()
    subirPdfReciboAlStorage()
    if (onGuardado) onGuardado(data.id)
  }

  // `ignorarGuardado`: la subida automática al storage corre justo después de
  // setGuardado(true), cuando el estado `guardado` del closure aún es false
  async function descargarPDF(tipo = tipoRecibo, soloBlob = false, ignorarGuardado = false) {
    if (!guardado && !ignorarGuardado) {
      setErr('Debes guardar el recibo primero antes de descargarlo.')
      return null
    }
    if (!soloBlob) setGenerando(true)
    try {
      const valorMostrar = tipo === 'VETERINARIA' ? valorVet : form.valor_servicio
      const totalMostrar = tipo === 'VETERINARIA' ? totalMedios : form.total_recibido
      const mediosPagoTexto = mediosPago
        .filter(m => parseFloat(m.monto) > 0)
        .map(m => {
          let txt = `${m.metodo}: ${fmt(parseFloat(m.monto)||0)}`
          if (m.referencia) txt += ` | Ref: ${m.referencia}`
          if (m.comprobanteUrl) txt += ' ✓comprobante'
          return txt
        })
        .join(' / ') || '—'

      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const W = 210, M = 15, CW = W - M * 2
      let y = 0

      const t     = (text, x, yy, opts = {}) => pdf.text(String(text ?? ''), x, yy, opts)
      const sec   = (label, yy) => {
        pdf.setFillColor(11, 29, 79); pdf.rect(M, yy, CW, 6, 'F')
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255)
        t(label, M + 2, yy + 4.2); return yy + 8
      }
      const field = (label, value, x, yy, w = CW / 2 - 3) => {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 140, 140)
        t(label.toUpperCase(), x, yy)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(25, 25, 25)
        const lines = pdf.splitTextToSize(value || '—', w)
        pdf.text(lines, x, yy + 4.5)
        return yy + 4.5 + lines.length * 4.5
      }
      const hr = (yy) => {
        pdf.setDrawColor(210, 210, 225); pdf.setLineWidth(0.25)
        pdf.line(M, yy, W - M, yy); return yy + 4
      }

      // Cabecera
      pdf.setFillColor(11, 29, 79); pdf.rect(0, 0, W, 30, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(255, 255, 255)
      t('CAMINO AL CIELO', W / 2, 12, { align: 'center' })
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(176, 196, 228)
      t('Funeraria para mascotas  ·  Bogotá, Colombia', W / 2, 18.5, { align: 'center' })
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(196, 168, 122)
      const tipoLabel = tipo === 'VETERINARIA' ? 'RECIBO VETERINARIA / ALIADO' : 'RECIBO DE SERVICIO — CLIENTE'
      t(tipoLabel, W / 2, 26, { align: 'center' })

      pdf.setFillColor(240, 244, 250); pdf.rect(0, 30, W, 11, 'F')
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(11, 29, 79)
      t(`No. ${form.numero_recibo}${tipo === 'VETERINARIA' ? '-VET' : ''}`, M, 37.5)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80)
      t(`Fecha: ${form.fecha}  Hora: ${form.hora}`, W - M, 37.5, { align: 'right' })
      y = 46

      // Banner pago pendiente
      if (pagoPendiente) {
        pdf.setFillColor(254, 243, 199); pdf.setDrawColor(251, 191, 36)
        pdf.setLineWidth(0.6); pdf.rect(M, y, CW, 13, 'FD')
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(146, 64, 14)
        t('PAGO PENDIENTE', W / 2, y + 5.5, { align: 'center' })
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(180, 100, 20)
        t('El cliente liquidara el valor del servicio posteriormente', W / 2, y + 10.5, { align: 'center' })
        y += 17
      }

      y = sec('DATOS DE LA MASCOTA', y)
      const yM = y
      field('Mascota', form.mascota_nombre, M, y)
      field('Especie', form.especie, M + CW / 2, y)
      y = yM + 12
      field('Peso', form.peso ? `${form.peso} kg` : '—', M, y)
      if (tipo !== 'VETERINARIA') field('Veterinaria / Aliado', form.veterinaria, M + CW / 2, y)
      y += 13; y = hr(y)

      y = sec('DATOS DEL PROPIETARIO', y)
      const yP = y
      y = Math.max(field('Nombre completo', form.propietario, M, yP, CW), yP + 10)
      const yP2 = y
      if (tipo !== 'VETERINARIA') {
        field('Teléfono', form.telefono, M, yP2)
        y = yP2 + 12
        y = Math.max(field('Dirección de recogida', form.casa, M, y, CW), y + 10)
      } else {
        field('Teléfono', form.telefono, M, yP2)
        y = yP2 + 12
      }
      y = hr(y)

      y = sec('SERVICIO Y PAGO', y)
      y = Math.max(field('Plan / Servicio', form.servicio, M, y, CW), y + 10)
      const bw = (CW - 4) / 2
      const drawBox = (label, value, x, yy) => {
        pdf.setDrawColor(196, 168, 122); pdf.setLineWidth(0.4); pdf.setFillColor(255, 253, 248)
        pdf.rect(x, yy, bw, 14, 'FD')
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(140, 110, 60)
        t(label.toUpperCase(), x + bw / 2, yy + 4.5, { align: 'center' })
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(11, 29, 79)
        t(fmt(Number(value) || 0), x + bw / 2, yy + 11, { align: 'center' })
      }
      if (tipo === 'VETERINARIA') {
        const lineH = 6.5
        if (comisionFueDescontada) {
          // DESCUENTO_INMEDIATO: desglose completo bruto → comisión → total
          const rows = 3
          pdf.setFillColor(255, 251, 235); pdf.rect(M, y, CW, lineH * rows + 4, 'F')
          pdf.setDrawColor(253, 230, 138); pdf.setLineWidth(0.3)
          pdf.rect(M, y, CW, lineH * rows + 4, 'D')

          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(80, 50, 0)
          t('Precio bruto del servicio:', M + 3, y + lineH)
          pdf.setFont('helvetica', 'bold')
          t(fmt(precioOriginal), W - M - 3, y + lineH, { align: 'right' })

          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(180, 50, 0)
          t(`Comisión aliado (${comisionPct}% del plan ${fmt(valorPlanBase)}):`, M + 3, y + lineH * 2)
          pdf.setFont('helvetica', 'bold')
          t(`– ${fmt(comisionMonto)}`, W - M - 3, y + lineH * 2, { align: 'right' })

          pdf.setFillColor(254, 240, 138); pdf.rect(M, y + lineH * 2 + 1, CW, lineH + 3, 'F')
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(120, 50, 0)
          t('TOTAL A COBRAR:', M + 3, y + lineH * 3 + 1)
          t(fmt(valorVet), W - M - 3, y + lineH * 3 + 1, { align: 'right' })
          y += lineH * 3 + 8
        } else {
          // CREDITO_ACUMULADO / FACTURACION_MENSUAL: aliado paga precio completo
          // Usa comisionManual (editable en UI) para permitir corregir servicios con comision=0 en DB
          const comisionPDF = comisionManual
          const rows = comisionPDF > 0 ? 2 : 1
          pdf.setFillColor(255, 251, 235); pdf.rect(M, y, CW, lineH * rows + 4, 'F')
          pdf.setDrawColor(253, 230, 138); pdf.setLineWidth(0.3)
          pdf.rect(M, y, CW, lineH * rows + 4, 'D')

          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(80, 50, 0)
          t('Valor del servicio:', M + 3, y + lineH)
          pdf.setFont('helvetica', 'bold')
          t(fmt(precioOriginal), W - M - 3, y + lineH, { align: 'right' })

          if (comisionPDF > 0) {
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(150, 80, 0)
            t(`Comisión ${comisionManualPct}% (${fmt(comisionPDF)}) — se gestiona por separado`, M + 3, y + lineH * 2)
          }

          pdf.setFillColor(254, 240, 138); pdf.rect(M, y + lineH * rows + 1, CW, lineH + 3, 'F')
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(120, 50, 0)
          t('TOTAL A COBRAR:', M + 3, y + lineH * (rows + 1) + 1)
          t(fmt(valorVet), W - M - 3, y + lineH * (rows + 1) + 1, { align: 'right' })
          y += lineH * (rows + 1) + 8
        }
      } else {
        // Recibo cliente: valor del servicio + nota de comisión si viene de solicitud con aliado
        drawBox('Valor del servicio', valorMostrar, M, y)
        y += 18
        if (comisionManual > 0 && !comisionFueDescontada && aliado) {
          const modCom = aliado.modalidad_comision === 'FACTURACION_MENSUAL' ? 'facturacion mensual'
                       : aliado.modalidad_comision === 'CREDITO_ACUMULADO'   ? 'credito acumulado'
                       : 'gestion separada'
          pdf.setFillColor(255, 247, 237); pdf.rect(M, y, CW, 9, 'F')
          pdf.setDrawColor(253, 215, 170); pdf.setLineWidth(0.3); pdf.rect(M, y, CW, 9, 'D')
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(146, 64, 14)
          t(`Comision aliado: ${aliado.nombre}`, M + 2, y + 3.5)
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7)
          t(`${fmt(comisionManual)}${comisionManualPct > 0 ? ` (${comisionManualPct}%)` : ''} — ${modCom}`, M + 2, y + 7)
          y += 12
        }
      }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(80, 80, 80)
      t(`Medios de pago: ${mediosPagoTexto}`, M, y); y += 6
      y = hr(y)

      y = sec('ELEMENTOS', y)
      const items = [
        { label: 'Se toma huella', checked: form.toma_huella },
        { label: 'Se toma mechón de pelo', checked: form.toma_mechon },
        { label: 'Entrega de recordatorios básicos', checked: form.entrega_rec_basicos },
        { label: 'Confirmación de foto', checked: form.confirmacion_foto },
      ]
      items.forEach(item => {
        pdf.setDrawColor(item.checked ? 11 : 180, item.checked ? 29 : 180, item.checked ? 79 : 180)
        pdf.setLineWidth(0.35); pdf.rect(M, y - 3.2, 3.8, 3.8, 'D')
        if (item.checked) {
          pdf.setDrawColor(11, 29, 79); pdf.setLineWidth(0.7)
          pdf.line(M + 0.7, y - 1.2, M + 1.7, y + 0.1); pdf.line(M + 1.7, y + 0.1, M + 3.3, y - 2.8)
        }
        pdf.setFont('helvetica', item.checked ? 'bold' : 'normal'); pdf.setFontSize(9)
        pdf.setTextColor(item.checked ? 11 : 130, item.checked ? 29 : 130, item.checked ? 79 : 130)
        t(item.label, M + 6, y); y += 6
      })
      if (form.nombre_recibe) { y += 1; field('Recibido / firmado por', form.nombre_recibe, M, y, CW); y += 11 } else { y += 3 }

      if (form.observaciones?.trim()) {
        y = hr(y); y = sec('OBSERVACIONES', y)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(50, 50, 50)
        const lines = pdf.splitTextToSize(form.observaciones, CW)
        pdf.text(lines, M, y); y += lines.length * 4.8 + 5
      }

      y = hr(y); y = sec('FIRMA DEL CLIENTE', y)
      if (firma) {
        pdf.setDrawColor(200, 210, 225); pdf.setLineWidth(0.3); pdf.setFillColor(250, 252, 255)
        pdf.rect(M, y, CW, 28, 'FD')
        pdf.addImage(firma, 'PNG', M + 5, y + 2, CW - 10, 24); y += 32
      } else {
        pdf.setDrawColor(200, 210, 225); pdf.setLineWidth(0.3)
        pdf.rect(M, y, CW, 22, 'D')
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(180, 180, 180)
        t('Sin firma registrada', W / 2, y + 13, { align: 'center' }); y += 26
      }

      pdf.setFillColor(11, 29, 79); pdf.rect(0, 285, W, 12, 'F')
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(176, 196, 228)
      t(`Técnico: ${tecnico?.nombre || ''} ${tecnico?.apellido || ''}  ·  Camino al Cielo  ·  contacto@caminoalcielo.com.co  ·  ${now.getFullYear()}`, W / 2, 292, { align: 'center' })

      const suffix = tipo === 'VETERINARIA' ? '_VET' : '_CLI'
      if (soloBlob) {
        return pdf.output('blob')
      }
      pdf.save(`Recibo_${form.mascota_nombre}_${form.numero_recibo}${suffix}.pdf`)
      return null
    } catch (e) {
      if (!soloBlob) alert('Error al generar PDF: ' + e.message)
      return null
    } finally {
      if (!soloBlob) setGenerando(false)
    }
  }

  // Cierra el recibo (vuelve a la tarjeta de recogida)
  function cerrar() { if (onVolver) onVolver() }

  async function enviarPorWA() {
    if (!guardado) { setErr('Guarda el recibo primero.'); return }

    // ── Número y nombre del destinatario según tipo de recibo ──────────────
    let waDestino, nombreDestino, msgTipo
    if (tipoRecibo === 'VETERINARIA') {
      waDestino     = aliado?.whatsapp || aliado?.telefono
      nombreDestino = aliado?.contacto_nombre || aliado?.nombre || ''
      msgTipo       = 'VETERINARIA'
      if (!waDestino) { setErr('La veterinaria no tiene número de WhatsApp registrado.'); return }
    } else {
      waDestino     = cliente?.whatsapp || cliente?.telefono
      nombreDestino = form.propietario
      msgTipo       = 'CLIENTE'
      if (!waDestino) { setErr('El cliente no tiene número de WhatsApp registrado.'); return }
    }

    // ── Mensaje según tipo ─────────────────────────────────────────────────
    let msg
    if (msgTipo === 'CLIENTE') {
      msg = [
        `*Recibo de servicio — Camino al Cielo 🐾*`,
        ``,
        `Estimado/a *${form.propietario}*, adjuntamos el recibo de servicio para *${form.mascota_nombre}*.`,
        ``,
        `📋 No. recibo: ${form.numero_recibo}`,
        `📅 Fecha: ${form.fecha}`,
        `🐾 Mascota: ${form.mascota_nombre}`,
        `📦 Plan: ${form.servicio}`,
        `💰 Valor del servicio: ${fmt(Number(form.valor_servicio))}`,
        ``,
        `Gracias por confiar en nosotros 🙏`,
        `_Camino al Cielo · contacto@caminoalcielo.com.co_`,
      ].join('\n')
    } else {
      const mediosTxt = mediosPago
        .filter(m => parseFloat(m.monto) > 0)
        .map(m => {
          let t = `• ${m.metodo}: ${fmt(parseFloat(m.monto)||0)}`
          if (m.referencia) t += ` (Ref: ${m.referencia})`
          return t
        }).join('\n') || '—'
      msg = [
        `*Recibo aliado — Camino al Cielo*`,
        ``,
        `Estimados, adjuntamos el recibo correspondiente al servicio de *${form.mascota_nombre}*.`,
        ``,
        `📋 No. recibo: ${form.numero_recibo}-VET`,
        `📅 Fecha: ${form.fecha}`,
        `📦 Plan: ${form.servicio}`,
        ``,
        ...(comisionFueDescontada ? [
          `💵 Precio bruto: ${fmt(precioOriginal)}`,
          `🔄 Comisión (${comisionPct}%): -${fmt(comisionMonto)}`,
        ] : [
          `💵 Valor del servicio: ${fmt(precioOriginal)}`,
          ...(comisionManual > 0 ? [`ℹ️ Comisión ${comisionManualPct}% (${fmt(comisionManual)}) — se gestiona por separado`] : []),
        ]),
        `✅ *Total a cobrar: ${fmt(valorVet)}*`,
        ``,
        `Medios de pago recibidos:\n${mediosTxt}`,
        ``,
        `_Camino al Cielo · contacto@caminoalcielo.com.co_`,
      ].join('\n')
    }

    setGenerando(true)
    setErr('')
    try {
      // 1. Generar PDF como blob
      const pdfBlob = await descargarPDF(tipoRecibo, true)
      let pdfUrl = null

      // 2. Subir a Supabase Storage para obtener URL pública
      if (pdfBlob) {
        try {
          const suffix   = tipoRecibo === 'VETERINARIA' ? '_VET' : '_CLI'
          const fileName = `recibos/${servicioSel.id}/${form.numero_recibo}${suffix}_${Date.now()}.pdf`
          const { data: up, error: upErr } = await db.storage
            .from('evidencias')
            .upload(fileName, pdfBlob, { upsert: true, contentType: 'application/pdf' })
          if (!upErr && up) {
            const { data: { publicUrl } } = db.storage.from('evidencias').getPublicUrl(up.path)
            pdfUrl = publicUrl
          }
        } catch (_) { /* si falla el upload, enviamos solo el texto */ }
      }

      // 3. Enviar por GHL/Zolutium con PDF adjunto
      await enviarWhatsApp({
        telefono:    waDestino,
        nombre:      nombreDestino,
        mensaje:     msg,
        pdfUrl,
        fromNumber:  LINEAS_WHATSAPP[0]?.numero,
      })
      alert(`Recibo enviado por WhatsApp${pdfUrl ? ' con PDF adjunto' : ''} a ${waDestino} desde la línea oficial.`)
    } catch (e) {
      setErr('Error al enviar: ' + (e.message || e))
    } finally {
      setGenerando(false)
    }
  }

  // ── Pantalla LIVIANA de carga de comprobante ──────────────────────────────
  // Mientras se sube, desmontamos el preview/firma/datos del recibo (pantalla
  // pesada). En celulares con poca RAM, abrir el selector de fotos desde la
  // pantalla pesada hacía que Android matara la PWA al cerrarse el selector
  // (OOM) y la imagen se perdía antes de llegar al código. Liviana = sobrevive,
  // igual que la pantalla de recogida. El técnico entra aquí ANTES de abrir el
  // selector, así la pantalla pesada ya está desmontada cuando se abre.
  if (comproOverlay !== null) {
    const m = mediosPago[comproOverlay] || {}
    // Al elegir el archivo: PRIMERO lo respaldamos en IndexedDB (todavía en esta
    // pantalla liviana), y SOLO DESPUÉS volvemos al recibo y subimos en segundo
    // plano. Clave anti-reinicio: en celulares con poca RAM, Android mata la PWA
    // justo al volver del selector (pasa igual con foto o PDF). Si el archivo ya
    // quedó en el stash ANTES del render pesado, al reabrir el recibo la subida
    // se reanuda sola con ese archivo — el técnico NO tiene que elegirlo de nuevo.
    const alElegir = async e => {
      const file = e.target.files?.[0]
      limpiarPickerAbierto()
      if (!file) { setComproOverlay(null); return }
      // Validación liviana (no decodifica la imagen): rechaza HEIC/tamaño antes de respaldar
      const val = validarArchivo(file, { permitirPdf: true })
      if (val.error) { setErr(val.error); setComproOverlay(null); return }
      const idx = comproOverlay
      await stashPut(`recibo_${servicioSel.id}_${idx}`, file)
      setComproOverlay(null)
      // recuperado:true → subirComprobante no vuelve a guardar en el stash (ya está)
      subirComprobante(idx, file, { recuperado: true })
    }
    return (
      <div ref={topRef} className="min-h-[55vh] flex flex-col">
        <input type="file" accept="image/*,application/pdf"
          ref={el => uploadRefs.current[comproOverlay] = el}
          className="hidden" onChange={alElegir} />
        <input type="file" accept="image/*" capture="environment"
          ref={el => comproCamRefs.current[comproOverlay] = el}
          className="hidden" onChange={alElegir} />

        <button onClick={() => setComproOverlay(null)}
          className="text-[12px] font-semibold text-gray-500 mb-4 self-start">
          ← Volver al recibo
        </button>
        <div className="text-[14px] font-bold text-gray-800 mb-1">Subir comprobante de pago</div>
        <div className="text-[11px] text-gray-400 mb-6">{m.metodo} · {fmt(parseFloat(m.monto) || 0)}</div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => { marcarPickerAbierto(); uploadRefs.current[comproOverlay]?.click() }}
            className="py-8 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 active:scale-98"
            style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
            <span className="text-3xl">🖼</span>
            <span className="text-[13px] font-semibold" style={{ color: '#92400E' }}>Galería / PDF</span>
            <span className="text-[10px] font-bold text-green-700">Recomendado</span>
          </button>
          <button onClick={() => { marcarPickerAbierto(); comproCamRefs.current[comproOverlay]?.click() }}
            className="py-8 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 active:scale-98"
            style={{ borderColor: '#E5E7EB', background: '#FAFAFA' }}>
            <Camera size={28} className="text-gray-400" />
            <span className="text-[13px] font-semibold text-gray-600">Cámara</span>
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-4 leading-snug">
          Elige la foto o el PDF y <strong>vuelves al recibo</strong>: el comprobante se sube solo.
          Si tienes poca señal puede tardar unos segundos; no necesitas esperar aquí.
        </p>
      </div>
    )
  }

  return (
    <div ref={topRef}>
      {/* Aviso FIJO del estado del comprobante — visible sin importar el scroll */}
      {comproFlash && (
        <div className="fixed left-1/2 -translate-x-1/2 top-3 z-50 w-[92%] max-w-md px-4 py-3 rounded-2xl shadow-lg flex items-center gap-3"
          style={{
            background: comproFlash.tipo === 'ok' ? '#DCFCE7' : comproFlash.tipo === 'err' ? '#FEE2E2' : '#DBEAFE',
            border: `1.5px solid ${comproFlash.tipo === 'ok' ? '#86EFAC' : comproFlash.tipo === 'err' ? '#FECACA' : '#BFDBFE'}`,
          }}>
          {comproFlash.tipo === 'subiendo'
            ? <div className="spinner flex-shrink-0" style={{ width: 20, height: 20 }} />
            : comproFlash.tipo === 'ok'
              ? <Check size={20} style={{ color: '#16A34A' }} className="flex-shrink-0" />
              : <AlertCircle size={20} style={{ color: '#DC2626' }} className="flex-shrink-0" />}
          <span className="text-[13px] font-bold flex-1"
            style={{ color: comproFlash.tipo === 'ok' ? '#166534' : comproFlash.tipo === 'err' ? '#991B1B' : '#1E40AF' }}>
            {comproFlash.msg}
          </span>
          {comproFlash.tipo !== 'subiendo' && (
            <button onClick={() => setComproFlash(null)} className="p-0.5 flex-shrink-0"
              style={{ color: comproFlash.tipo === 'ok' ? '#166534' : '#991B1B' }}>
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <span className="text-[13px] font-bold text-gray-800">
          📄 Recibo — {form.mascota_nombre}
        </span>
        {guardado && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto"
            style={{ background: '#D1FAE5', color: '#065F46' }}>
            ✓ Guardado
          </span>
        )}
      </div>

      {/* Selector tipo de recibo — se oculta tras guardar */}
      {!tipoFijado ? (
        <div className="flex gap-2 mb-3">
          {[
            { key: 'CLIENTE',     label: '📄 Para el cliente',    desc: `Valor total: ${fmt(form.valor_servicio)}` },
            ...(aliado ? [{ key: 'VETERINARIA', label: '🏥 Para veterinaria', desc: `Cobrar: ${fmt(valorVet)}` }] : []),
          ].map(op => (
            <button key={op.key} onClick={() => cambiarTipo(op.key)}
              className="flex-1 py-2.5 px-3 rounded-xl border-2 text-left transition-all active:scale-98"
              style={{
                borderColor: tipoRecibo === op.key ? '#1A5CD8' : '#E5E7EB',
                background:  tipoRecibo === op.key ? '#EEF3FB' : '#FAFAFA',
              }}>
              <div className="text-[12px] font-bold" style={{ color: tipoRecibo === op.key ? '#1A5CD8' : '#374151' }}>{op.label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{op.desc}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-[12px] font-semibold"
          style={{ background: '#EEF3FB', color: '#1A5CD8', border: '1.5px solid #BFDBFE' }}>
          {tipoRecibo === 'VETERINARIA' ? '🏥 Recibo veterinaria' : '📄 Recibo cliente'}
          <span className="ml-auto text-[10px] text-blue-400">Generado ✓</span>
        </div>
      )}

      {/* Configurar comisión — solo visible para vet */}
      {tipoRecibo === 'VETERINARIA' && aliado && (
        <div className="rounded-2xl mb-4 overflow-hidden"
          style={{ border: '1.5px solid #FDE68A' }}>
          {comisionFueDescontada ? (
            /* DESCUENTO_INMEDIATO: desglose completo con deducción */
            <>
              <div className="px-4 py-2.5" style={{ background: '#FFF3DC' }}>
                <div className="text-[11px] font-bold text-amber-800 mb-2">Desglose comisión del aliado</div>
                <div className="flex justify-between text-[12px] mb-1">
                  <span className="text-amber-700">Precio bruto del servicio</span>
                  <span className="font-bold text-gray-900">{fmt(precioOriginal)}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-amber-700">Comisión aliado <span className="text-amber-500">(sobre plan {fmt(valorPlanBase)})</span></span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-600 font-bold">– {fmt(comisionMonto)}</span>
                    <div className="flex items-center gap-1 ml-2">
                      <input
                        type="number" min={0} max={100} step={0.5}
                        value={comisionPct}
                        onChange={e => setComisionPct(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                        className="w-14 text-center px-1 py-0.5 rounded-lg border text-[12px] font-bold outline-none"
                        style={{ borderColor: '#F59E0B', color: '#92400E' }}
                      />
                      <span className="text-[11px] font-bold text-amber-700">%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-between px-4 py-2.5" style={{ background: '#FEF08A' }}>
                <span className="text-[13px] font-bold text-amber-900">Total a cobrar</span>
                <span className="text-[16px] font-extrabold text-amber-900">{fmt(valorVet)}</span>
              </div>
            </>
          ) : (
            /* CREDITO_ACUMULADO / FACTURACION_MENSUAL: aliado paga precio completo */
            <>
              <div className="px-4 py-2.5" style={{ background: '#FFF3DC' }}>
                <div className="text-[11px] font-bold text-amber-800 mb-1">Recibo veterinaria / aliado</div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-amber-700">Valor del servicio</span>
                  <span className="font-bold text-gray-900">{fmt(precioOriginal)}</span>
                </div>
                {comisionManual > 0 && (
                  <div className="text-[10px] text-amber-600 mt-1">
                    Comisión {comisionManualPct}% ({fmt(comisionManual)}) — se gestiona por separado
                  </div>
                )}
              </div>
              <div className="flex justify-between px-4 py-2.5" style={{ background: '#FEF08A' }}>
                <span className="text-[13px] font-bold text-amber-900">Total a cobrar</span>
                <span className="text-[16px] font-extrabold text-amber-900">{fmt(valorVet)}</span>
              </div>
              <div className="px-4 py-2 text-[10px] text-amber-700" style={{ background: '#FFFBEB' }}>
                Modalidad <strong>{modalidad.replace(/_/g, ' ')}</strong> — la comisión se liquida aparte, el aliado paga el precio completo aquí.
              </div>
            </>
          )}
        </div>
      )}

      {/* Datos recibo preview */}
      <div style={{
        background: '#ffffff', padding: '16px', borderRadius: '16px',
        border: '1px solid #F3F4F6', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        marginBottom: '14px', fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Encabezado */}
        <div style={{ textAlign: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '2px solid #0B1D4F' }}>
          <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#0B1D4F' }}>CAMINO AL CIELO</div>
          <div style={{ fontSize: '10px', color: '#6B7280' }}>Funeraria para mascotas · Bogotá</div>
          <div style={{ fontSize: '9px', fontWeight: '700', color: '#C4A87A', marginTop: '2px' }}>
            {tipoRecibo === 'VETERINARIA' ? 'RECIBO VETERINARIA / ALIADO' : 'RECIBO DE SERVICIO — CLIENTE'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: '#6B7280' }}>
            <span>No. <strong style={{ color: '#0B1D4F' }}>{form.numero_recibo}{tipoRecibo === 'VETERINARIA' ? '-VET' : ''}</strong></span>
            <span>{form.fecha} · {form.hora}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '12px', rowGap: '6px', marginBottom: '10px', fontSize: '11px' }}>
          <RField label="Mascota" value={form.mascota_nombre} onChange={v => f('mascota_nombre',v)} />
          <RField label="Especie" value={form.especie} onChange={v => f('especie',v)} />
          <RField label="Propietario" value={form.propietario} onChange={v => f('propietario',v)} span2 />
          {tipoRecibo !== 'VETERINARIA' && <RField label="Teléfono" value={form.telefono} onChange={v => f('telefono',v)} />}
          <RField label="Plan" value={form.servicio} onChange={v => f('servicio',v)} span2 />
        </div>

        {/* Cajas de valor */}
        {tipoRecibo === 'VETERINARIA' ? (
          /* Desglose comisión para vet */
          <div style={{ marginBottom: '10px', border: '1.5px solid #FDE68A', borderRadius: '10px', overflow: 'hidden', background: '#FFFBEB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #FDE68A' }}>
              <span style={{ fontSize: '11px', color: '#92400E' }}>Precio del servicio</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#0B1D4F' }}>{fmt(precioOriginal)}</span>
            </div>
            {/* DESCUENTO_INMEDIATO: muestra deducción; CREDITO/FACTURACION: muestra comisión informativa */}
            {comisionFueDescontada ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #FDE68A' }}>
                  <span style={{ fontSize: '11px', color: '#92400E' }}>Comisión aliado ({comisionPct}% del plan {fmt(valorPlanBase)})</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#DC2626' }}>– {fmt(comisionMonto)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#FEF08A' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#92400E' }}>Total a cobrar</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#92400E' }}>{fmt(valorVet)}</span>
                </div>
              </>
            ) : (
              <>
                {comisionManual > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #FDE68A' }}>
                    <span style={{ fontSize: '11px', color: '#92400E' }}>Comisión aliado ({comisionManualPct}%) — se factura aparte</span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#92400E' }}>{fmt(comisionManual)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#FEF08A' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#92400E' }}>Total a cobrar al aliado</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#92400E' }}>{fmt(precioOriginal)}</span>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Recibo cliente: valor del servicio + nota de comisión si aplica */
          <div style={{ marginBottom: '10px' }}>
            <div style={{ border: '1.5px solid #C4A87A', borderRadius: '8px', padding: '8px 12px', textAlign: 'center', background: '#FFFDF8' }}>
              <div style={{ fontSize: '8px', fontWeight: '700', color: '#8C6C3C', textTransform: 'uppercase', marginBottom: '2px' }}>Valor del servicio</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#0B1D4F' }}>{fmt(form.valor_servicio)}</div>
            </div>
            {/* Nota de comisión — solo visible cuando el servicio viene de solicitud de cliente con aliado */}
            {comisionManual > 0 && !comisionFueDescontada && aliado && (
              <div style={{ marginTop: '6px', padding: '6px 10px', borderRadius: '8px', background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                <div style={{ fontSize: '9px', fontWeight: '700', color: '#92400E', marginBottom: '1px' }}>
                  Comision aliado registrada — {aliado.nombre}
                </div>
                <div style={{ fontSize: '9px', color: '#B45309' }}>
                  {fmt(comisionManual)}
                  {comisionManualPct > 0 ? ` (${comisionManualPct}%)` : ''}
                  {' — '}
                  {aliado.modalidad_comision === 'FACTURACION_MENSUAL' ? 'facturacion mensual' :
                   aliado.modalidad_comision === 'CREDITO_ACUMULADO'   ? 'credito acumulado'  : 'gestion separada'}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <RCheck label="Se toma huella" checked={form.toma_huella} onChange={v => f('toma_huella',v)} />
          <RCheck label="Se toma mechón de pelo" checked={form.toma_mechon} onChange={v => f('toma_mechon',v)} />
          <RCheck label="Entrega de recordatorios básicos" checked={form.entrega_rec_basicos} onChange={v => f('entrega_rec_basicos',v)} />
          <RCheck label="Confirmación de foto" checked={form.confirmacion_foto} onChange={v => f('confirmacion_foto',v)} />
        </div>
        {(form.toma_huella || form.toma_mechon || form.entrega_rec_basicos) && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '4px' }}>Recibido por</div>
            <input type="text" value={form.nombre_recibe} onChange={e => f('nombre_recibe', e.target.value)}
              placeholder="Nombre completo…"
              style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FAFAFA', fontSize: '11px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '4px' }}>Observaciones</div>
          <textarea value={form.observaciones} onChange={e => f('observaciones', e.target.value)}
            placeholder="Observaciones, novedades…" rows={2}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FAFAFA', fontSize: '11px', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
        </div>
        <SignaturePad onSigned={setFirma} firmaDataUrl={firma} />
        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #E5E7EB', fontSize: '9px', color: '#9CA3AF', textAlign: 'center' }}>
          Técnico: {tecnico?.nombre} {tecnico?.apellido} · Camino al Cielo
        </div>
      </div>

      {/* ── Medios de pago ── */}
      <div className="mb-4">
        {/* Toggle pago pendiente */}
        {!esFacturacionMensual && !guardado && (
          <button
            onClick={() => setPagoPendiente(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-3 transition-all active:scale-98"
            style={{
              background:   pagoPendiente ? '#FEF3C7' : '#F9FAFB',
              border:       `1.5px solid ${pagoPendiente ? '#F59E0B' : '#E5E7EB'}`,
            }}>
            <div className="text-left">
              <div className="text-[12px] font-bold" style={{ color: pagoPendiente ? '#92400E' : '#374151' }}>
                Pago pendiente
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: pagoPendiente ? '#B45309' : '#9CA3AF' }}>
                {pagoPendiente ? 'El cliente pagará después — sin cobro ahora' : 'El cliente paga ahora'}
              </div>
            </div>
            <div className="w-9 h-5 rounded-full relative flex-shrink-0 transition-all"
              style={{ background: pagoPendiente ? '#F59E0B' : '#D1D5DB' }}>
              <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all"
                style={{ left: pagoPendiente ? '19px' : '2px' }} />
            </div>
          </button>
        )}

        {esFacturacionMensual ? (
          /* FACTURACION_MENSUAL: no se cobra ahora */
          <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
            style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
            <span className="text-xl flex-shrink-0">📋</span>
            <div>
              <p className="text-[12px] font-bold text-blue-800">Facturación mensual — sin cobro en este momento</p>
              <p className="text-[11px] text-blue-600 mt-0.5">El pago de {fmt(saldoPendiente)} quedará pendiente y se facturará al aliado al cierre del mes. El recibo se guarda como constancia del servicio.</p>
            </div>
          </div>
        ) : pagoPendiente ? (
          /* Pago diferido — sin cobro ahora */
          <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
            style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A' }}>
            <span className="text-xl flex-shrink-0">⏳</span>
            <div>
              <p className="text-[12px] font-bold text-amber-800">Pago pendiente — sin cobro en este momento</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                El valor de <strong>{fmt(tipoRecibo === 'CLIENTE' && comisionFueDescontada ? precioOriginal : saldoPendiente)}</strong> quedará pendiente. El recibo se guarda como constancia del servicio.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <CreditCard size={11} /> Medios de pago recibidos
              </div>
              <span className="text-[10px] text-gray-400">
                Pendiente: <strong style={{ color: '#92400E' }}>{fmt(tipoRecibo === 'CLIENTE' && comisionFueDescontada ? precioOriginal : saldoPendiente)}</strong>
              </span>
            </div>
            {/* Tip pago mixto */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-[11px]"
              style={{ background: '#EEF3FB', color: '#1E40AF' }}>
              <span className="text-base">💡</span>
              <span><strong>Pago mixto:</strong> podés combinar efectivo + transferencia + Nequi, etc. Agregá un medio por cada forma recibida.</span>
            </div>
          </>
        )}

        {!esFacturacionMensual && !pagoPendiente && (<><div className="space-y-3">
          {mediosPago.map((m, idx) => {
            const necesitaComprobante = METODOS_CON_COMPROBANTE.includes(m.metodo)
            const tieneComprobante    = !!m.comprobanteUrl
            return (
              <div key={idx} className="rounded-2xl border overflow-hidden"
                style={{ borderColor: necesitaComprobante && !tieneComprobante ? '#FDE68A' : '#E5E7EB' }}>

                {/* Fila principal: método + monto + eliminar */}
                <div className="flex gap-2 items-center p-3">
                  <select value={m.metodo}
                    onChange={e => updateMedio(idx, 'metodo', e.target.value)}
                    className="px-2 py-2 rounded-xl border text-[12px] font-semibold outline-none flex-shrink-0"
                    style={{ borderColor: '#E5E7EB', minWidth: 120 }}>
                    {METODOS_PAGO.map(mp => <option key={mp} value={mp}>{mp}</option>)}
                  </select>
                  <input type="number" inputMode="numeric" step="1000"
                    value={m.monto}
                    onChange={e => updateMedio(idx, 'monto', e.target.value)}
                    placeholder="Monto $"
                    className="flex-1 px-3 py-2 rounded-xl border text-[13px] font-bold outline-none"
                    style={{ borderColor: m.monto ? '#1A5CD8' : '#E5E7EB' }} />
                  {mediosPago.length > 1 && (
                    <button onClick={() => removeMedio(idx)}
                      className="p-2 rounded-xl text-red-400 hover:bg-red-50 flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Sección comprobante — solo para pagos electrónicos */}
                {necesitaComprobante && (
                  <div className="px-3 pb-3 border-t"
                    style={{ borderColor: '#F3F4F6', background: '#FAFAFA' }}>

                    {/* Número de referencia */}
                    <div className="mt-2 mb-2">
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                        No. de referencia / transacción
                      </div>
                      <input
                        type="text"
                        value={m.referencia || ''}
                        onChange={e => updateMedio(idx, 'referencia', e.target.value)}
                        placeholder={`Ej: ${m.metodo === 'NEQUI' || m.metodo === 'DAVIPLATA' ? '123456789' : m.metodo === 'TARJETA' ? 'Últimos 4 dígitos o ref.' : 'Número de transacción'}`}
                        className="w-full px-3 py-2 rounded-xl border text-[12px] font-mono outline-none"
                        style={{ borderColor: m.referencia ? '#1A5CD8' : '#E5E7EB', background: '#fff' }}
                      />
                    </div>

                    {/* Upload comprobante */}
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Comprobante de pago {!tieneComprobante && <span className="font-bold" style={{ color: '#D97706' }}>(pendiente ⏳)</span>}
                    </div>
                    {/* Los inputs de archivo NO viven aquí: la subida se hace desde
                        una pantalla liviana (setComproOverlay) para no morir por RAM. */}
                    {tieneComprobante ? (
                      /* Confirmación del comprobante como ENLACE (toca para ver), igual
                         que el PDF. NO se renderiza <img src={url}> con la imagen completa:
                         decodificar una captura/foto de varios MP a resolución completa
                         dispara OOM en Android y reinicia la PWA (ver feedback_mobile_image_oom).
                         El archivo se abre en pestaña nueva, donde el visor del navegador
                         decodifica fuera del contexto de la app. */
                      <div className="rounded-xl border border-green-200 flex items-center gap-2 px-3 py-4 bg-green-50">
                        <a href={m.comprobanteUrl} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 min-w-0 flex-1">
                          {m.comprobanteUrl.toLowerCase().includes('.pdf')
                            ? <FileText size={22} style={{ color: '#DC2626' }} className="flex-shrink-0" />
                            : <Receipt size={22} style={{ color: '#059669' }} className="flex-shrink-0" />}
                          <div className="min-w-0">
                            <span className="text-[12px] font-bold text-green-700 flex items-center gap-1">
                              <Check size={12} /> Comprobante guardado · pendiente de revisión
                            </span>
                            <span className="text-[11px] text-gray-500">
                              Toca para ver{m.comprobanteUrl.toLowerCase().includes('.pdf') ? ' (PDF)' : ''}
                            </span>
                          </div>
                        </a>
                        <button
                          onClick={e => { e.stopPropagation(); e.preventDefault(); setComproOverlay(idx) }}
                          className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                          style={{ background: '#D1FAE5', color: '#065F46' }}>
                          Cambiar
                        </button>
                      </div>
                    ) : m.subiendoComprobante ? (
                      <div className="w-full px-3 py-3 rounded-xl flex items-center gap-3"
                        style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                        <div className="spinner flex-shrink-0" style={{ width: 20, height: 20 }} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-blue-800">
                            {reanudando ? 'Reanudando la subida…' : 'Subiendo comprobante…'}
                          </p>
                          <p className="text-[11px] text-blue-600">
                            Puedes seguir con el recibo — se guarda solo cuando termine.
                          </p>
                        </div>
                      </div>
                    ) : m.comproError ? (
                      <div className="w-full px-3 py-3 rounded-xl flex items-center gap-3"
                        style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                        <AlertCircle size={18} style={{ color: '#DC2626' }} className="flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-bold text-red-700">No se pudo subir</p>
                          <p className="text-[10px] text-red-500 truncate">{m.comproError}</p>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); e.preventDefault(); reintentarComprobante(idx) }}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0"
                          style={{ background: '#DC2626' }}>
                          Reintentar
                        </button>
                      </div>
                    ) : (
                      <div className="w-full px-3 py-3 rounded-xl flex items-center gap-2"
                        style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                        <Receipt size={16} style={{ color: '#EA580C' }} className="flex-shrink-0" />
                        <p className="text-[11px] font-semibold leading-snug" style={{ color: '#9A3412' }}>
                          El comprobante ahora se sube en la pestaña <b>🧾 Comprob.</b> (abajo).
                          Guardá el recibo y subilo desde ahí — esa pantalla no se reinicia.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Botón agregar medio — prominente, debajo de la lista */}
        <button onClick={addMedio}
          className="w-full py-3 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 mt-2 transition-all active:scale-98 text-[13px] font-bold"
          style={{ borderColor: '#BFDBFE', color: '#1A5CD8', background: '#F0F7FF' }}>
          <Plus size={15} /> Agregar otro medio de pago
        </button>

        {/* Resumen totales */}
        <div className="mt-3 rounded-2xl overflow-hidden border"
          style={{ borderColor: totalMedios >= saldoPendiente ? '#86EFAC' : '#FDE68A' }}>
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ background: '#FAFAFA', borderBottom: '1px solid #F3F4F6' }}>
            <span className="text-[12px] font-semibold text-gray-600">Pendiente a cobrar</span>
            <span className="font-semibold text-[13px]" style={{ color: '#92400E' }}>{fmt(saldoPendiente)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ background: totalMedios > 0 ? '#F0FDF4' : '#FFFBEB' }}>
            <span className="text-[12px] font-semibold text-gray-600">Total cobrado</span>
            <span className="font-extrabold text-[18px]" style={{ color: totalMedios >= saldoPendiente ? '#15803D' : '#D97706' }}>
              {fmt(totalMedios)}
            </span>
          </div>
          {totalMedios > 0 && totalMedios < saldoPendiente && (
            <div className="flex items-center justify-between px-4 py-2"
              style={{ background: '#FEF3C7', borderTop: '1px solid #FDE68A' }}>
              <span className="text-[11px] font-semibold text-amber-700">Queda pendiente</span>
              <span className="font-bold text-[13px] text-amber-800">{fmt(saldoPendiente - totalMedios)}</span>
            </div>
          )}
          {totalMedios >= saldoPendiente && saldoPendiente > 0 && (
            <div className="flex items-center gap-2 px-4 py-2"
              style={{ background: '#D1FAE5', borderTop: '1px solid #86EFAC' }}>
              <CheckCircle size={13} style={{ color: '#16A34A' }} />
              <span className="text-[11px] font-bold text-green-800">Pago completo cubierto</span>
            </div>
          )}
          {haySobrepago && (
            <div className="px-4 py-3 space-y-2" style={{ background: '#FFF7ED', borderTop: '1px solid #FED7AA' }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: '#9A3412' }}>Estás cobrando de más</span>
                <span className="font-extrabold text-[15px]" style={{ color: '#9A3412' }}>+{fmt(sobrepagoDiff)}</span>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: '#C2410C' }}>
                Se puede guardar así, pero indica de qué es esa diferencia — queda registrada en el historial del servicio y en el cuadre.
              </p>
              <input
                value={sobrepagoMotivo}
                onChange={e => setSobrepagoMotivo(e.target.value)}
                placeholder="Ej: adicional huella tomado en sitio, transporte extra…"
                className="w-full px-3 py-2.5 text-[13px] rounded-xl border outline-none bg-white"
                style={{ borderColor: sobrepagoMotivo.trim() ? '#86EFAC' : '#FDBA74' }}
              />
            </div>
          )}
        </div>
        </>)}
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-3 py-2 text-[12px] mb-3">
          <AlertCircle size={13} /> {err}
        </div>
      )}

      {/* Botones de acción */}
      <div className="space-y-2">
        {/* Guardar */}
        {!guardado ? (
          <button onClick={guardarRecibo} disabled={guardando}
            className="w-full py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: '#0B1D4F', color: '#fff' }}>
            <Receipt size={18} />
            {guardando ? 'Guardando recibo…' : '💾 Guardar recibo'}
          </button>
        ) : (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl mb-1"
            style={{ background: '#D1FAE5', border: '1.5px solid #86EFAC' }}>
            <CheckCircle size={16} style={{ color: '#16A34A' }} />
            <span className="text-[12px] font-bold text-green-800 flex-1">Recibo guardado correctamente</span>
          </div>
        )}

        {/* El recibo existe en DB aunque falte el comprobante — se puede reintentar */}
        {guardado && !esFacturacionMensual && !pagoPendiente && comprobantesPendientes.length > 0 && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl"
            style={{ background: '#FFEDD5', border: '1.5px solid #FED7AA' }}>
            <span className="text-base flex-shrink-0">⏳</span>
            <div>
              <p className="text-[12px] font-bold" style={{ color: '#9A3412' }}>Comprobante pendiente. Puedes reintentarlo.</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#C2410C' }}>
                El recibo ya quedó guardado. Sube el comprobante de {comprobantesPendientes.map(m => m.metodo).join(', ')} arriba, ahora o más tarde desde el módulo Recibos.
              </p>
            </div>
          </div>
        )}

        {/* Descargar PDF — solo el del tipo actual */}
        <button onClick={async () => { await descargarPDF(tipoRecibo) }} disabled={generando || !guardado}
          className="w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: tipoRecibo === 'VETERINARIA' ? '#0B1D4F' : '#7C3AED', color: '#fff' }}>
          <Download size={16} />
          {generando ? 'Generando…' : tipoRecibo === 'VETERINARIA'
            ? `🏥 Descargar recibo veterinaria (${fmt(valorVet)})`
            : '📄 Descargar recibo cliente'}
        </button>

        {/* Enviar por WA */}
        <button onClick={async () => { await enviarPorWA() }} disabled={generando || !guardado}
          className="w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: '#25D366', color: '#fff' }}>
          <MessageSquare size={16} /> Enviar por WhatsApp (línea oficial)
        </button>

        {/* Generar el otro tipo (solo disponible tras guardar + si aplica) */}
        {guardado && aliado && (
          <button
            onClick={() => {
              const otroTipo = tipoRecibo === 'CLIENTE' ? 'VETERINARIA' : 'CLIENTE'
              cambiarTipo(otroTipo)
              setTipoFijado(false)
              setGuardado(false)
            }}
            className="w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: '#F3F4F6', color: '#374151' }}>
            {tipoRecibo === 'CLIENTE' ? '🏥 También generar recibo veterinaria' : '📄 También generar recibo cliente'}
          </button>
        )}

        {/* Volver sin cerrar — para cuando solo quieran guardar y volver después */}
        <button onClick={cerrar}
          className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
          ← Volver a la lista de recibos
        </button>
      </div>
    </div>
  )
}

// ─── RECIBO FIELD — solo inline styles para html2canvas (sin Tailwind/oklch) ─
function RField({ label, value, onChange, type = 'text', highlight, span2 }) {
  return (
    <div style={span2 ? { gridColumn: 'span 2' } : {}}>
      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '6px 8px', borderRadius: '8px',
          border: `1px solid ${highlight ? '#1A5CD8' : '#E5E7EB'}`,
          background: highlight ? '#F0FDF4' : '#FAFAFA',
          fontSize: '12px', fontWeight: '600', color: '#111827',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

// ─── RECIBO CHECK ROW — solo inline styles ──────────────────────────────────
function RCheck({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: '16px', height: '16px', flexShrink: 0, accentColor: '#1A5CD8' }} />
      <span style={{ fontSize: '12px', color: '#374151' }}>{label}</span>
    </label>
  )
}
