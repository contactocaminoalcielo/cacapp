import { useState, useEffect, useRef, useCallback } from 'react'
import { db, dbAdmin } from '@/lib/supabase'
import { petEmoji, fmt } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { crearNotificacion } from '@/lib/notificaciones'
import {
  Phone, MapPin, Clock, CheckCircle, LogOut, Bell,
  Truck, Package, RefreshCw, CreditCard, Camera, Check,
  AlertCircle, X, Snowflake, Weight, MessageSquare, Send,
  FileText, ChevronDown, ChevronUp, History, Download, Pen,
} from 'lucide-react'

const POLL = 30_000

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
      style={{ background: 'linear-gradient(160deg, #263218 0%, #111a0b 100%)' }}>
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
              background: i < pin.length ? '#3D5A27' : 'transparent',
              border: `2px solid ${i < pin.length ? '#3D5A27' : '#D1D5DB'}`,
              transform: i < pin.length ? 'scale(1.25)' : 'scale(1)',
            }} />
          ))}
        </div>
        {err  && <p className="text-center text-red-500 text-sm font-medium mb-3">{err}</p>}
        {busy && <p className="text-center text-sm mb-3" style={{ color: '#3D5A27' }}>Verificando…</p>}
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
            style={{ color: '#3D5A27', width: 180 }} />
        </div>
        {svc.direccion_recogida && (
          <div className="flex items-center gap-2 mb-6 px-4 py-3 rounded-xl" style={{ background: '#F0FDF4' }}>
            <MapPin size={14} style={{ color: '#3D5A27', flexShrink: 0 }} />
            <span className="text-sm text-gray-700">{svc.direccion_recogida}{svc.ciudad_recogida ? `, ${svc.ciudad_recogida}` : ''}</span>
          </div>
        )}
        <button onClick={confirmar} disabled={saving}
          className="w-full py-4 rounded-2xl text-base font-bold disabled:opacity-60 transition-all active:scale-98"
          style={{ background: '#3D5A27', color: '#fff' }}>
          {saving ? 'Iniciando ruta…' : '🚐 Iniciar ruta'}
        </button>
      </div>
    </div>
  )
}

// ─── FOTO EVIDENCIA (reutilizable) ─────────────────────────────────────
function FotoEvidencia({ storagePath, dbSave, fotoUrl, onFotoUploaded, label = 'Foto de la mascota', sublabel = 'Evidencia de recogida' }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr]             = useState('')
  const cameraRef                 = useRef()
  const galeriaRef                = useRef()

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${storagePath}/${Date.now()}.${ext}`
      const { data, error: upErr } = await dbAdmin.storage
        .from('evidencias').upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) throw upErr
      const { data: { publicUrl } } = db.storage.from('evidencias').getPublicUrl(data.path)
      if (dbSave) {
        const { error: dbErr } = await db.from(dbSave.table)
          .update({ [dbSave.column]: publicUrl }).eq('id', dbSave.id)
        if (dbErr) throw dbErr
      }
      onFotoUploaded(publicUrl)
    } catch (e) {
      setErr(e.message || 'Error al subir foto')
    } finally {
      setUploading(false)
      if (cameraRef.current)  cameraRef.current.value  = ''
      if (galeriaRef.current) galeriaRef.current.value = ''
    }
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
                <button onClick={() => cameraRef.current?.click()}
                  className="text-white text-xs font-medium px-2 py-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.25)' }}>
                  📷 Cámara
                </button>
                <button onClick={() => galeriaRef.current?.click()}
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
            <button onClick={() => cameraRef.current?.click()}
              className="py-5 rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 transition-all active:scale-95"
              style={{ borderColor: '#D1D5DB', background: '#FAFAFA' }}>
              <Camera size={28} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Cámara</span>
            </button>
            <button onClick={() => galeriaRef.current?.click()}
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
          style={{ background: '#3D5A27', color: '#fff' }}>
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
    ...(svc.estado_pago !== 'COMPLETO'
      ? [{ id: 'cobro_ok', emoji: '💰', label: `Cobro realizado: ${fmt((svc.valor_total || 0) - (svc.valor_pagado || 0))}` }]
      : []),
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

function RegistroCuartoFrio({ svc, onCompletar }) {
  const cf = svc.cuarto_frio_data || null
  const [peso, setPeso]               = useState(String(svc.mascotas?.peso_kg || ''))
  const [nevera, setNevera]           = useState('')
  const [neveraCustom, setNeveraCustom] = useState(false)
  const [neverasList, setNeverasList] = useState(NEVERAS_DEFAULT)
  const [fotoUrl, setFotoUrl]         = useState(null)
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')

  useEffect(() => {
    db.from('cuarto_frio').select('nevera_codigo').not('nevera_codigo', 'is', null)
      .then(({ data }) => {
        const extras = [...new Set((data || []).map(r => r.nevera_codigo).filter(Boolean))]
        const all = [...new Set([...NEVERAS_DEFAULT, ...extras])].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })
        )
        setNeverasList(all)
      })
  }, [])

  const canConfirm = !!fotoUrl && !!nevera.trim() && !!peso

  async function confirmar() {
    setSaving(true); setErr('')
    try { await onCompletar(svc, { cfId: cf?.id, peso, nevera: nevera.trim(), fotoUrl }) }
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

      {/* Foto pesaje */}
      <FotoEvidencia
        storagePath={cf?.id ? `cuarto_frio/${cf.id}` : `cuarto_frio/temp_${svc.id}`}
        fotoUrl={fotoUrl}
        onFotoUploaded={setFotoUrl}
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
          style={{ borderColor: peso ? '#3D5A27' : '#E5E7EB', color: '#111827' }} />
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

// ─── CARD RECOGIDA ──────────────────────────────────────────────────────
function CardRecogida({ svc, tecnico, onIniciar, onCompletar, onCuartoFrio, onDeclinar }) {
  const [sheetOpen, setSheetOpen]     = useState(false)
  const [declinarOpen, setDeclinarOpen] = useState(false)
  const [motivoDeclina, setMotivoDeclina] = useState('')
  const [fotoUrl, setFotoUrl]         = useState(
    svc.recogidas?.[0]?.foto_recogida_url || null
  )
  const [checked, setChecked]         = useState([])
  const [valorCobrado, setValorCobrado] = useState('')
  const [completing, setCompleting]   = useState(false)
  const [actErr, setActErr]           = useState('')

  const mascota  = svc.mascotas
  const especie  = mascota?.especies?.nombre || ''
  const emoji    = petEmoji(especie)
  const cliente  = mascota?.clientes
  const recogida = svc.recogidas?.[0]
  const cf       = svc.cuarto_frio_data || null

  const pendiente    = svc.estado === 'INGRESADO'
  const enCamino     = svc.estado === 'EN_RECOGIDA'
  const enCuartoFrio = svc.estado === 'EN_CUARTO_FRIO' && !cf?.nevera_codigo

  const itemsReq = ['id_ok']
  const checklistListo = checked.includes('id_ok') && !!fotoUrl

  function toggleCheck(id) {
    setChecked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function completar() {
    setCompleting(true); setActErr('')
    try { await onCompletar(svc, recogida?.id, parseFloat(valorCobrado) || 0) }
    catch (e) { setActErr(e.message || 'Error al completar') }
    finally { setCompleting(false) }
  }

  const BADGE = {
    INGRESADO:    { bg: '#FEF3C7', color: '#92400E', label: 'Pendiente' },
    EN_RECOGIDA:  { bg: '#DBEAFE', color: '#1E40AF', label: 'En camino' },
    EN_CUARTO_FRIO:{ bg: '#EEF3FB', color: '#1D4ED8', label: 'En cuarto frío' },
  }
  const badge = BADGE[svc.estado] || { bg: '#F3F4F6', color: '#374151', label: svc.estado }

  const borderColor = enCamino ? '#93C5FD' : enCuartoFrio ? '#BFDBFE' : '#F0F0F0'
  const borderWidth = (enCamino || enCuartoFrio) ? 2 : 1

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
            </div>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
            style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
        </div>

        {/* Monto */}
        <div className="mb-3">
          {svc.estado_pago === 'COMPLETO' ? (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: '#D1FAE5', color: '#065F46' }}>
              <CheckCircle size={13} /> Pagado completo
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
              <CreditCard size={15} style={{ color: '#D97706', flexShrink: 0 }} />
              <div>
                <div className="text-[11px] text-amber-700 font-medium">Cobrar al cliente</div>
                <div className="text-xl font-extrabold" style={{ color: '#92400E' }}>
                  {fmt((svc.valor_total || 0) - (svc.valor_pagado || 0))}
                </div>
              </div>
              {svc.metodo_pago && (
                <span className="ml-auto text-[11px] font-medium" style={{ color: '#92400E' }}>
                  {svc.metodo_pago}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cliente */}
        {cliente && (
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
              style={{ background: '#3D5A27' }}>
              {(cliente.nombre?.[0] || '').toUpperCase()}{(cliente.apellido?.[0] || '').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-800 leading-tight">{cliente.nombre} {cliente.apellido}</div>
              {cliente.whatsapp && (
                <a href={`https://wa.me/57${String(cliente.whatsapp).replace(/\D/g,'')}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs font-medium flex items-center gap-1" style={{ color: '#25D366' }}>
                  <Phone size={10} /> {cliente.whatsapp}
                </a>
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
              <a href={`tel:${recogida.contacto_telefono}`}
                className="text-xs font-semibold ml-1" style={{ color: '#3D5A27' }}>
                {recogida.contacto_telefono}
              </a>
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
              style={{ background: '#3D5A27', color: '#fff' }}>
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

        {/* ── FASE 2: EN CAMINO ── */}
        {enCamino && (
          <div className="mt-2">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-4 text-sm font-semibold"
              style={{ background: '#DBEAFE', color: '#1E40AF' }}>
              🚐 En camino a la recogida
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

            {/* Valor cobrado — opcional */}
            {svc.estado_pago !== 'COMPLETO' && (
              <div className="mb-4">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <CreditCard size={11} /> Valor recogido en sitio
                </div>
                <div className="rounded-xl px-3 py-2 mb-2 flex items-center justify-between"
                  style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                  <span className="text-[11px] text-amber-700">Pendiente total</span>
                  <span className="font-bold text-sm" style={{ color: '#92400E' }}>
                    {fmt((svc.valor_total || 0) - (svc.valor_pagado || 0))}
                  </span>
                </div>
                <input type="number" inputMode="numeric" step="100"
                  value={valorCobrado} onChange={e => setValorCobrado(e.target.value)}
                  placeholder="Monto recibido (dejar vacío si no cobró)"
                  className="w-full px-4 py-3 rounded-xl border-2 outline-none font-bold text-lg"
                  style={{ borderColor: valorCobrado ? '#3D5A27' : '#E5E7EB', color: '#111827' }} />
                <p className="text-[11px] text-gray-400 mt-1 ml-1">Opcional · Dejar vacío si no se cobró</p>
              </div>
            )}

            {actErr && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-3"
                style={{ background: '#FEE2E2', color: '#991B1B' }}>
                <AlertCircle size={13} /> {actErr}
              </div>
            )}
            <button onClick={completar} disabled={!checklistListo || completing}
              className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98 disabled:opacity-50"
              style={{ background: checklistListo ? '#22C55E' : '#9CA3AF', color: '#fff' }}>
              {completing ? 'Completando…'
                : checklistListo ? '✅ Completar recogida'
                : `Falta: ${!fotoUrl ? 'foto' : ''}${!fotoUrl && !checked.includes('id_ok') ? ' + ' : ''}${!checked.includes('id_ok') ? 'verificar identidad' : ''}`}
            </button>
          </div>
        )}

        {/* ── FASE 3: CUARTO FRÍO ── */}
        {enCuartoFrio && (
          <RegistroCuartoFrio svc={svc} onCompletar={onCuartoFrio} />
        )}

        {/* ── COMENTARIOS ── siempre visibles */}
        <ComentariosSection servicioId={svc.id} personalId={tecnico?.id} />
      </div>
    </>
  )
}

// ─── CARD ENTREGA ───────────────────────────────────────────────────────
function CardEntrega({ ent, onAction }) {
  const [acting, setActing] = useState(false)
  const [actErr, setActErr] = useState('')

  const mascota = ent.servicios?.mascotas
  const especie = mascota?.especies?.nombre || ''
  const emoji   = petEmoji(especie)
  const cliente = mascota?.clientes

  const BADGE = {
    PENDIENTE:  { bg: '#FEF3C7', color: '#92400E', label: 'Pendiente' },
    EN_PROCESO: { bg: '#DBEAFE', color: '#1E40AF', label: 'En camino' },
    ENTREGADA:  { bg: '#D1FAE5', color: '#065F46', label: 'Entregada' },
  }
  const badge = BADGE[ent.estado] || { bg: '#F3F4F6', color: '#374151', label: ent.estado }
  const nextLabel = ent.estado === 'PENDIENTE' ? '🛵 Salir a entregar' : ent.estado === 'EN_PROCESO' ? '✅ Confirmar entrega' : null

  async function accion() {
    setActing(true); setActErr('')
    try { await onAction(ent) }
    catch (e) { setActErr(e.message || 'Error al actualizar') }
    finally { setActing(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-3 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 30 }}>{emoji}</span>
          <div>
            <div className="font-bold text-gray-900 text-base leading-tight">{mascota?.nombre || '—'}</div>
            <div className="text-xs text-gray-500">{especie}</div>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>
      {cliente && (
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: '#C4A87A' }}>
            {(cliente.nombre?.[0] || '').toUpperCase()}{(cliente.apellido?.[0] || '').toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800 leading-tight">{cliente.nombre} {cliente.apellido}</div>
            {cliente.whatsapp && (
              <a href={`https://wa.me/57${String(cliente.whatsapp).replace(/\D/g,'')}`}
                target="_blank" rel="noreferrer"
                className="text-xs font-medium flex items-center gap-1" style={{ color: '#25D366' }}>
                <Phone size={10} /> {cliente.whatsapp}
              </a>
            )}
          </div>
        </div>
      )}
      <div className="mb-3">
        <DireccionLink
          direccion={ent.direccion_entrega || ent.direccion_recogida}
          ciudad={ent.ciudad}
        />
      </div>
      {actErr && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs mb-2"
          style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <AlertCircle size={13} /> {actErr}
        </div>
      )}
      {nextLabel && (
        <button onClick={accion} disabled={acting}
          className="w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-98 disabled:opacity-60"
          style={{ background: ent.estado === 'PENDIENTE' ? '#C4A87A' : '#22C55E', color: '#fff' }}>
          {acting ? 'Actualizando…' : nextLabel}
        </button>
      )}
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
        await dbAdmin.from('estado_cuarto_frio').update({
          ...checklist, comentario: comentario || null,
        }).eq('id', reporteHoy.id)
        reporteId = reporteHoy.id
        await dbAdmin.from('estado_nevera_reporte').delete().eq('reporte_id', reporteId)
      } else {
        const { data, error } = await dbAdmin.from('estado_cuarto_frio').insert({
          registrado_por: tecnico?.id || null,
          ...checklist,
          comentario: comentario || null,
        }).select('id').single()
        if (error) throw error
        reporteId = data.id
      }
      const neveras = Object.entries(neveraData).filter(([, v]) => v.capacidad_pct || v.funcionamiento)
      if (neveras.length > 0) {
        const { error: nErr } = await dbAdmin.from('estado_nevera_reporte').insert(
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
  const [tab, setTab]             = useState('recogidas')
  const [recogidas, setRecogidas] = useState([])
  const [entregas, setEntregas]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [queryErr, setQueryErr]   = useState('')
  const [notif, setNotif]         = useState(null)
  const prevCountRef               = useRef(null)
  const [reporteHoy,     setReporteHoy]     = useState(null)
  const [neverasActivas, setNeverasActivas] = useState([])
  const [misCF,          setMisCF]          = useState([])
  const [reciboSvc,      setReciboSvc]      = useState(null)

  const cargar = useCallback(async (silent = false) => {
    if (!tecnico) return
    if (!silent) setLoading(true)
    setQueryErr('')
    try {
      // ── 1. Servicios asignados (sin join cuarto_frio para evitar errores) ──
      const { data: svcData, error: svcErr } = await db.from('servicios')
        .select(`
          id, estado, estado_pago, metodo_pago, valor_total, valor_pagado,
          mascota_id,
          direccion_recogida, ciudad_recogida, barrio_recogida, indicaciones_recogida,
          mascotas:mascota_id (
            id_mascota, nombre, tamano, especie_id, peso_kg,
            especies ( nombre ),
            clientes:cliente_id ( nombre, apellido, whatsapp, email, telefono )
          ),
          recogidas ( id, contacto_nombre, contacto_telefono, tipo_lugar, fecha_programada, hora_programada, notas, foto_recogida_url ),
          planes:plan_id ( nombre, codigo ),
          aliados:aliado_origen_id ( nombre )
        `)
        .eq('tecnico_id', tecnico.id)
        .in('estado', ['INGRESADO', 'EN_RECOGIDA', 'EN_CUARTO_FRIO'])
        .order('fecha_ingreso', { ascending: false })

      if (svcErr) { setQueryErr(svcErr.message); return }
      const servicios = svcData || []

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
          servicios (
            id, estado,
            mascotas:mascota_id (
              nombre, especie_id,
              especies ( nombre ),
              clientes:cliente_id ( nombre, apellido, whatsapp )
            )
          )
        `)
        .eq('mensajero_id', tecnico.id)
        .in('estado', ['PENDIENTE', 'EN_PROCESO'])
        .order('fecha_programada', { ascending: true, nullsFirst: true })

      // Filtrar EN_CUARTO_FRIO ya registrados
      const nuevasR = serviciosConCF.filter(s =>
        s.estado !== 'EN_CUARTO_FRIO' || !s.cuarto_frio_data?.nevera_codigo
      )
      const nuevasE = entData || []

      const total = nuevasR.length
      if (silent && prevCountRef.current !== null && total > prevCountRef.current) {
        const diff = total - prevCountRef.current
        setNotif(`¡Nueva recogida asignada! (${diff} nueva${diff > 1 ? 's' : ''})`)
        playNotifSound()
        setTimeout(() => setNotif(null), 8000)
      }
      prevCountRef.current = total

      // ── 5. Reporte del día y neveras activas ──
      const todayStr = new Date().toISOString().split('T')[0]
      const [{ data: reporteData }, { data: cfNeveras }] = await Promise.all([
        dbAdmin.from('estado_cuarto_frio')
          .select('*, estado_nevera_reporte(*)')
          .eq('fecha', todayStr)
          .order('created_at', { ascending: false })
          .limit(1),
        db.from('cuarto_frio')
          .select('nevera_codigo')
          .not('nevera_codigo', 'is', null),
      ])
      setReporteHoy(reporteData?.[0] || null)
      // Siempre incluir las neveras base + cualquier código extra del historial
      const dbCodes = (cfNeveras || []).map(r => r.nevera_codigo).filter(Boolean)
      const todasNeveras = [...new Set([...NEVERAS_DEFAULT, ...dbCodes])]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      setNeverasActivas(todasNeveras)

      // Mis registros en cuarto frío (ya registrados con nevera)
      const misCFArr = serviciosConCF.filter(s =>
        s.estado === 'EN_CUARTO_FRIO' && s.cuarto_frio_data?.nevera_codigo
      )
      setMisCF(misCFArr)

      setRecogidas(nuevasR)
      setEntregas(nuevasE)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [tecnico])

  useEffect(() => {
    if (!tecnico) return
    cargar()
    const id = setInterval(() => cargar(true), POLL)
    return () => clearInterval(id)
  }, [tecnico, cargar])

  // Obtener IDs de coordinadores/admins para notificarlos
  async function getCoordinadores() {
    const { data } = await db.from('personal')
      .select('id, nombre, apellido')
      .in('rol_principal_id', [1, 6]) // COORDINADOR=1, ADMIN=6
      .eq('activo', true)
    return data || []
  }

  async function iniciarRecogida(svc, hora) {
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
        hora_llegada: hora,
        mascota:      mascotaNombre,
        lugar,
        tipo_lugar:   tipoLugar,
        wa_cliente:   tipoLugar !== 'CLINICA_ALIADA' ? waCliente : null,
        wa_aliado:    tipoLugar === 'CLINICA_ALIADA'  ? (waTelContacto || waCliente) : null,
      },
    })))
    await cargar()
  }

  async function declinarRecogida(svc, motivo) {
    // Notificar a coordinadores
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

  async function completarRecogida(svc, recogidaId, valorCobrado = 0) {
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
        fecha_realizada: now.toISOString().split('T')[0],
        hora_realizada:  now.toTimeString().slice(0, 5),
      }).eq('id', recogidaId)
    }
    await cargar()
  }

  async function confirmarCuartoFrio(svc, { cfId, peso, nevera, fotoUrl }) {
    const pesoNum = parseFloat(peso) || null
    if (cfId) {
      const { error } = await db.from('cuarto_frio').update({
        nevera_codigo:   nevera,
        peso_kg:         pesoNum,
        estado:          'REFRIGERADO',
        foto_pesaje_url: fotoUrl || null,
      }).eq('id', cfId)
      if (error) throw new Error(error.message)
    }
    // El peso de báscula pasa a ser el oficial para la mascota
    if (pesoNum && svc.mascotas?.id_mascota) {
      await db.from('mascotas').update({ peso_kg: pesoNum }).eq('id_mascota', svc.mascotas.id_mascota)
    }
    await cargar()
  }

  async function accionEntrega(ent) {
    if (ent.estado === 'PENDIENTE') {
      const { error } = await db.from('entregas').update({ estado: 'EN_PROCESO' }).eq('id', ent.id)
      if (error) throw new Error(error.message)
      await db.from('servicios').update({ estado: 'EN_ENTREGA' }).eq('id', ent.servicio_id)
    } else if (ent.estado === 'EN_PROCESO') {
      const { error } = await db.from('entregas').update({
        estado: 'ENTREGADA', fecha_realizada: new Date().toISOString().split('T')[0],
      }).eq('id', ent.id)
      if (error) throw new Error(error.message)
      await db.from('servicios').update({ estado: 'ENTREGADO' }).eq('id', ent.servicio_id)
    }
    await cargar()
  }

  const sinReporteHoy = !reporteHoy
  const TABS = [
    { key: 'recogidas',   label: 'Recogidas', Icon: Truck,     count: recogidas.length,      color: '#3D5A27' },
    { key: 'entregas',    label: 'Entregas',  Icon: Package,   count: entregas.length,       color: '#3D5A27' },
    { key: 'cuarto_frio', label: 'C. Frío',   Icon: Snowflake, count: sinReporteHoy ? 1 : 0, color: '#0E7490' },
    { key: 'recibo',      label: 'Recibo',    Icon: CreditCard, count: 0,                    color: '#7C3AED' },
  ]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F3F4F6', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ background: '#263218' }} className="px-5 pb-4 pt-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold mb-0.5" style={{ color: '#C4A87A' }}>
              Portal técnico · Camino al Cielo
            </div>
            <div className="text-white font-bold text-lg leading-tight">{tecnico.nombre} {tecnico.apellido}</div>
            {tecnico.tipo_vehiculo && (
              <div className="text-[12px] mt-0.5" style={{ color: '#9CA3AF' }}>{tecnico.tipo_vehiculo}</div>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <button onClick={() => cargar()} className="p-2 rounded-full" style={{ color: '#9CA3AF' }}>
              <RefreshCw size={16} />
            </button>
            <button onClick={logout} className="p-2 rounded-full" style={{ color: '#9CA3AF' }}>
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

      {notif && (
        <div className="mx-4 mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
          <Bell size={16} className="flex-shrink-0" style={{ color: '#D97706' }} />
          <span className="text-sm font-semibold" style={{ color: '#92400E' }}>{notif}</span>
        </div>
      )}

      <div className="flex bg-white border-b border-gray-100">
        {TABS.map(({ key, label, Icon, count, color }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-semibold transition-colors"
            style={{
              color: tab === key ? color : '#9CA3AF',
              borderBottom: tab === key ? `2px solid ${color}` : '2px solid transparent',
            }}>
            <Icon size={15} /> {label}
            {count > 0 && (
              <span className="ml-0.5 text-[10px] font-bold min-w-[18px] h-[18px] rounded-full inline-flex items-center justify-center px-1"
                style={{ background: color, color: '#fff' }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <div className="spinner" /><span className="text-sm">Cargando…</span>
          </div>
        ) : tab === 'recogidas' ? (
          recogidas.length === 0
            ? <EmptyState icon="🚐" texto="Sin recogidas asignadas" sub="Cuando el coordinador te asigne una recogida, aparecerá aquí." />
            : <RecogidaList
                recogidas={recogidas} tecnico={tecnico}
                onIniciar={iniciarRecogida}
                onCompletar={completarRecogida}
                onCuartoFrio={confirmarCuartoFrio}
                onDeclinar={declinarRecogida}
              />
        ) : tab === 'entregas' ? (
          entregas.length === 0
            ? <EmptyState icon="📦" texto="Sin entregas asignadas" sub="Cuando te asignen una entrega, aparecerá aquí." />
            : entregas.map(e => <CardEntrega key={e.id} ent={e} onAction={accionEntrega} />)
        ) : tab === 'cuarto_frio' ? (
          <div className="space-y-5">
            <ReporteCuartoFrio
              tecnico={tecnico}
              neverasActivas={neverasActivas}
              reporteHoy={reporteHoy}
              onGuardado={() => cargar(true)}
            />
            <MisCuartoFrioSection
              misCF={misCF}
              tecnico={tecnico}
              onRefresh={() => cargar(true)}
            />
          </div>
        ) : tab === 'recibo' ? (
          <ReciboTab
            recogidas={[...recogidas, ...misCF]}
            tecnico={tecnico}
          />
        ) : null}
      </div>

      <div className="text-center pb-6 pt-2 text-[11px] text-gray-400">
        Se actualiza cada 30 s ·{' '}
        <button onClick={() => cargar()} className="underline">Actualizar ahora</button>
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

function RecogidaList({ recogidas, tecnico, onIniciar, onCompletar, onCuartoFrio, onDeclinar }) {
  const porRecoger   = recogidas.filter(s => s.estado === 'INGRESADO')
  const enCamino     = recogidas.filter(s => s.estado === 'EN_RECOGIDA')
  const cuartoFrio   = recogidas.filter(s => s.estado === 'EN_CUARTO_FRIO')

  const cardProps = { tecnico, onIniciar, onCompletar, onCuartoFrio, onDeclinar }

  return (
    <div>
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
      {cuartoFrio.length > 0 && (
        <div>
          <SeccionHeader color="#0E7490" dot="#CFFAFE" emoji="❄️" titulo="Ingresar al cuarto frío" count={cuartoFrio.length} />
          {cuartoFrio.map(r => <CardRecogida key={r.id} svc={r} {...cardProps} />)}
        </div>
      )}
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
function MisCuartoFrioSection({ misCF, tecnico, onRefresh }) {
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
            <div className="grid grid-cols-3 gap-2 mb-4">
              {NEVERAS_DEFAULT.map(n => (
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
            <input type="text" value={nuevaNevera} onChange={e => setNuevaNevera(e.target.value)}
              placeholder="Código personalizado…"
              className="w-full px-4 py-3 rounded-xl border-2 outline-none font-mono font-bold mb-4"
              style={{ borderColor: nuevaNevera ? '#1D4ED8' : '#E5E7EB', color: '#111827', fontSize: 18 }} />
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
function ReciboTab({ recogidas, tecnico }) {
  const [servicioSel, setServicioSel] = useState(null)
  const [svcData,     setSvcData]     = useState(null)
  const [loading,     setLoading]     = useState(false)

  // Combinar servicios para mostrar: recogidas en camino/cuarto frío + ya en CF
  const opciones = recogidas.filter(s => ['EN_RECOGIDA','EN_CUARTO_FRIO','INGRESADO'].includes(s.estado))

  async function seleccionar(svc) {
    setServicioSel(svc)
    setLoading(true)
    try {
      const { data } = await db.from('servicios')
        .select(`
          id, valor_total, valor_pagado, tipo_acompanamiento,
          mascotas:mascota_id (
            nombre, peso_kg, especie_id, sexo,
            especies(nombre),
            clientes:cliente_id(nombre,apellido,email,telefono,whatsapp,direccion,ciudad)
          ),
          planes:plan_id(nombre,codigo),
          aliados:aliado_origen_id(nombre)
        `)
        .eq('id', svc.id)
        .single()
      const { data: cf } = await db.from('cuarto_frio')
        .select('peso_kg').eq('servicio_id', svc.id).maybeSingle()
      setSvcData({ ...data, peso_confirmado: cf?.peso_kg || null })
    } catch { setSvcData(null) }
    finally { setLoading(false) }
  }

  if (!servicioSel || !svcData) {
    return (
      <div>
        <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">
          📄 Selecciona un servicio para generar el recibo
        </div>
        {opciones.length === 0 ? (
          <EmptyState icon="📄" texto="Sin servicios activos" sub="Los servicios asignados aparecerán aquí." />
        ) : (
          <div className="space-y-2">
            {opciones.map(svc => {
              const m = svc.mascotas
              return (
                <button key={svc.id}
                  onClick={() => seleccionar(svc)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 bg-white rounded-2xl p-4 border border-gray-100 text-left transition-all active:scale-98 shadow-sm">
                  <span style={{ fontSize: 28 }}>{petEmoji(m?.especies?.nombre)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900">{m?.nombre || '—'}</div>
                    <div className="text-[11px] text-gray-500">{m?.clientes?.nombre} {m?.clientes?.apellido}</div>
                  </div>
                  <span className="text-xs font-semibold text-[#7C3AED]">Generar →</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <ReciboForm
      svcData={svcData}
      servicioSel={servicioSel}
      tecnico={tecnico}
      onVolver={() => { setServicioSel(null); setSvcData(null) }}
    />
  )
}

// ─── RECIBO FORM ────────────────────────────────────────────────────────────
function ReciboForm({ svcData, servicioSel, tecnico, onVolver }) {
  const mascota = svcData.mascotas
  const cliente = mascota?.clientes
  const plan    = svcData.planes
  const aliado  = svcData.aliados

  const numeroRecibo = `CAC-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${servicioSel.id.slice(0,6).toUpperCase()}`

  const [form, setForm] = useState({
    fecha:              new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' }),
    numero_recibo:      numeroRecibo,
    mascota_nombre:     mascota?.nombre || '',
    peso:               svcData.peso_confirmado || mascota?.peso_kg || '',
    especie:            mascota?.especies?.nombre || '',
    veterinaria:        aliado?.nombre || '',
    propietario:        `${cliente?.nombre || ''} ${cliente?.apellido || ''}`.trim(),
    email:              cliente?.email || '',
    telefono:           cliente?.telefono || cliente?.whatsapp || '',
    casa:               servicioSel.direccion_recogida || '',
    servicio:           plan?.nombre || '',
    valor_servicio:     svcData.valor_total || 0,
    total_recibido:     (svcData.valor_total || 0) - (svcData.valor_pagado || 0),
    toma_huella:        false,
    toma_mechon:        false,
    entrega_rec_basicos: false,
    nombre_recibe:      '',
    confirmacion_foto:  false,
    observaciones:      '',
  })
  const [firma, setFirma] = useState(null)
  const [generando, setGenerando] = useState(false)
  const reciboRef = useRef(null)

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function descargarPDF() {
    setGenerando(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const W = 210, M = 15, CW = W - M * 2
      let y = 0

      // ── Helpers ──────────────────────────────────────────
      const t = (text, x, yy, opts = {}) => pdf.text(String(text ?? ''), x, yy, opts)
      const sec = (label, yy) => {
        pdf.setFillColor(232, 243, 235)
        pdf.rect(M, yy, CW, 6, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7.5)
        pdf.setTextColor(31, 90, 50)
        t(label, M + 2, yy + 4.2)
        return yy + 8
      }
      const field = (label, value, x, yy, w = CW / 2 - 3) => {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(6.5)
        pdf.setTextColor(140, 140, 140)
        t(label.toUpperCase(), x, yy)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor(25, 25, 25)
        const lines = pdf.splitTextToSize(value || '—', w)
        pdf.text(lines, x, yy + 4.5)
        return yy + 4.5 + lines.length * 4.5
      }
      const hr = (yy) => {
        pdf.setDrawColor(210, 225, 215)
        pdf.setLineWidth(0.25)
        pdf.line(M, yy, W - M, yy)
        return yy + 4
      }

      // ── Cabecera verde ────────────────────────────────────
      pdf.setFillColor(31, 90, 50)
      pdf.rect(0, 0, W, 30, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(20)
      pdf.setTextColor(255, 255, 255)
      t('CAMINO AL CIELO', W / 2, 13, { align: 'center' })
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor(190, 220, 200)
      t('Funeraria para mascotas  ·  Bogotá, Colombia', W / 2, 20, { align: 'center' })
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.setTextColor(196, 168, 122)
      t('RECIBO DE SERVICIO', W / 2, 27, { align: 'center' })

      // ── Número y fecha ────────────────────────────────────
      pdf.setFillColor(244, 247, 244)
      pdf.rect(0, 30, W, 11, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(31, 90, 50)
      t(`No. ${form.numero_recibo}`, M, 37.5)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(80, 80, 80)
      t(`Fecha: ${form.fecha}`, W - M, 37.5, { align: 'right' })

      y = 46

      // ── Mascota ───────────────────────────────────────────
      y = sec('DATOS DE LA MASCOTA', y)
      const yMasc = y
      field('Mascota', form.mascota_nombre, M, y)
      field('Especie', form.especie, M + CW / 2, y)
      y = yMasc + 12
      field('Peso', form.peso ? `${form.peso} kg` : '—', M, y)
      field('Veterinaria / Aliado', form.veterinaria, M + CW / 2, y)
      y += 13
      y = hr(y)

      // ── Propietario ───────────────────────────────────────
      y = sec('DATOS DEL PROPIETARIO', y)
      const yProp = y
      y = Math.max(field('Nombre completo', form.propietario, M, yProp, CW), yProp + 10)
      const yProp2 = y
      field('Correo electrónico', form.email, M, yProp2)
      field('Teléfono', form.telefono, M + CW / 2, yProp2)
      y = yProp2 + 12
      y = Math.max(field('Dirección de recogida', form.casa, M, y, CW), y + 10)
      y = hr(y)

      // ── Servicio ──────────────────────────────────────────
      y = sec('SERVICIO CONTRATADO', y)
      y = Math.max(field('Plan / Servicio', form.servicio, M, y, CW), y + 10)
      // Cajas de valor
      const bw = (CW - 4) / 2
      const drawValBox = (label, value, x, yy) => {
        pdf.setDrawColor(196, 168, 122)
        pdf.setLineWidth(0.4)
        pdf.setFillColor(255, 253, 248)
        pdf.rect(x, yy, bw, 14, 'FD')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(6.5)
        pdf.setTextColor(140, 110, 60)
        t(label.toUpperCase(), x + bw / 2, yy + 4.5, { align: 'center' })
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(13)
        pdf.setTextColor(31, 90, 50)
        t(fmt(Number(value) || 0), x + bw / 2, yy + 11, { align: 'center' })
      }
      drawValBox('Valor del servicio', form.valor_servicio, M, y)
      drawValBox('Total recibido', form.total_recibido, M + bw + 4, y)
      y += 18
      y = hr(y)

      // ── Elementos recibidos ───────────────────────────────
      y = sec('ELEMENTOS RECIBIDOS / ENTREGADOS', y)
      const items = [
        { label: 'Se toma huella', checked: form.toma_huella },
        { label: 'Se toma mechón de pelo', checked: form.toma_mechon },
        { label: 'Entrega de recordatorios básicos', checked: form.entrega_rec_basicos },
        { label: 'Confirmación de foto', checked: form.confirmacion_foto },
      ]
      items.forEach(item => {
        pdf.setDrawColor(item.checked ? 31 : 180, item.checked ? 90 : 180, item.checked ? 50 : 180)
        pdf.setLineWidth(0.35)
        pdf.rect(M, y - 3.2, 3.8, 3.8, 'D')
        if (item.checked) {
          pdf.setDrawColor(31, 90, 50)
          pdf.setLineWidth(0.7)
          pdf.line(M + 0.7, y - 1.2, M + 1.7, y + 0.1)
          pdf.line(M + 1.7, y + 0.1, M + 3.3, y - 2.8)
        }
        pdf.setFont('helvetica', item.checked ? 'bold' : 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor(item.checked ? 25 : 130, item.checked ? 25 : 130, item.checked ? 25 : 130)
        t(item.label, M + 6, y)
        y += 6
      })
      if (form.nombre_recibe) {
        y += 1
        field('Recibido / firmado por', form.nombre_recibe, M, y, CW)
        y += 11
      } else {
        y += 3
      }

      // ── Observaciones ─────────────────────────────────────
      if (form.observaciones?.trim()) {
        y = hr(y)
        y = sec('OBSERVACIONES', y)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor(50, 50, 50)
        const lines = pdf.splitTextToSize(form.observaciones, CW)
        pdf.text(lines, M, y)
        y += lines.length * 4.8 + 5
      }

      // ── Firma ─────────────────────────────────────────────
      y = hr(y)
      y = sec('FIRMA DEL CLIENTE', y)
      if (firma) {
        pdf.setDrawColor(200, 215, 205)
        pdf.setLineWidth(0.3)
        pdf.setFillColor(252, 254, 252)
        pdf.rect(M, y, CW, 28, 'FD')
        pdf.addImage(firma, 'PNG', M + 5, y + 2, CW - 10, 24)
        y += 32
      } else {
        pdf.setDrawColor(200, 215, 205)
        pdf.setLineWidth(0.3)
        pdf.rect(M, y, CW, 22, 'D')
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        pdf.setTextColor(180, 180, 180)
        t('Sin firma registrada', W / 2, y + 13, { align: 'center' })
        y += 26
      }

      // ── Pie de página ─────────────────────────────────────
      pdf.setFillColor(31, 90, 50)
      pdf.rect(0, 285, W, 12, 'F')
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(190, 220, 200)
      t(`Técnico: ${tecnico?.nombre || ''} ${tecnico?.apellido || ''}  ·  Camino al Cielo  ·  contacto@caminoalcielo.com.co  ·  ${new Date().getFullYear()}`, W / 2, 292, { align: 'center' })

      pdf.save(`Recibo_${form.mascota_nombre}_${form.numero_recibo}.pdf`)
    } catch (e) { alert('Error al generar PDF: ' + e.message) }
    finally { setGenerando(false) }
  }

  function enviarWhatsApp() {
    const wa = cliente?.whatsapp || cliente?.telefono
    if (!wa) { alert('No hay número WhatsApp del cliente'); return }
    const msg = [
      `Recibo de servicio — Camino al Cielo 🐾`,
      `No. recibo: *${form.numero_recibo}*`,
      `Fecha: ${form.fecha}`,
      `Mascota: *${form.mascota_nombre}* (${form.especie})`,
      `Propietario: ${form.propietario}`,
      `Plan: ${form.servicio}`,
      `Valor: $${Number(form.valor_servicio).toLocaleString('es-CO')}`,
      `Total recibido: $${Number(form.total_recibido).toLocaleString('es-CO')}`,
      form.toma_huella ? '✅ Se tomó huella' : '',
      form.toma_mechon ? '✅ Se tomó mechón' : '',
      form.entrega_rec_basicos ? `✅ Recordatorios básicos entregados a: ${form.nombre_recibe}` : '',
      form.observaciones ? `Obs: ${form.observaciones}` : '',
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/57${wa.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const FIELD = 'mb-1'
  const LBL   = 'text-[9px] font-bold text-gray-400 uppercase tracking-wider'
  const VAL   = 'text-[12px] text-gray-800'

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onVolver} className="text-[11px] text-[#3D5A27] font-semibold underline">← Volver</button>
        <span className="text-gray-400">|</span>
        <span className="text-[12px] font-semibold text-gray-600">Recibo — {form.mascota_nombre}</span>
      </div>

      {/* ── RECIBO IMPRIMIBLE — solo inline styles (sin Tailwind) para html2canvas ── */}
      <div ref={reciboRef} style={{
        background: '#ffffff', padding: '20px', borderRadius: '16px',
        border: '1px solid #F3F4F6', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        marginBottom: '16px', fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Encabezado */}
        <div style={{ textAlign: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #3D5A27' }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#263218' }}>CAMINO AL CIELO</div>
          <div style={{ fontSize: '11px', color: '#6B7280' }}>Funeraria para mascotas · Bogotá, Colombia</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '11px', fontWeight: '600', color: '#6B7280' }}>
            <span>No. Recibo: <span style={{ color: '#3D5A27', fontWeight: 'bold' }}>{form.numero_recibo}</span></span>
            <span>{form.fecha}</span>
          </div>
        </div>

        {/* Campos en grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '16px', rowGap: '8px', marginBottom: '12px', fontSize: '12px' }}>
          <RField label="Mascota" value={form.mascota_nombre} onChange={v => f('mascota_nombre',v)} />
          <RField label="Peso (kg)" value={form.peso} onChange={v => f('peso',v)} />
          <RField label="Especie" value={form.especie} onChange={v => f('especie',v)} />
          <RField label="Veterinaria / Aliado" value={form.veterinaria} onChange={v => f('veterinaria',v)} />
          <RField label="Propietario" value={form.propietario} onChange={v => f('propietario',v)} span2 />
          <RField label="Correo" value={form.email} onChange={v => f('email',v)} span2 />
          <RField label="Teléfono" value={form.telefono} onChange={v => f('telefono',v)} />
          <RField label="Dirección recogida" value={form.casa} onChange={v => f('casa',v)} />
          <RField label="Plan / Servicio" value={form.servicio} onChange={v => f('servicio',v)} span2 />
          <RField label="Valor del servicio ($)" value={String(form.valor_servicio)} onChange={v => f('valor_servicio', Number(v)||0)} type="number" />
          <RField label="Total recibido ($)" value={String(form.total_recibido)} onChange={v => f('total_recibido', Number(v)||0)} type="number" highlight />
        </div>

        {/* Checkboxes */}
        <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <RCheck label="Se toma huella" checked={form.toma_huella} onChange={v => f('toma_huella',v)} />
          <RCheck label="Se toma mechón de pelo" checked={form.toma_mechon} onChange={v => f('toma_mechon',v)} />
          <RCheck label="Entrega de recordatorios básicos" checked={form.entrega_rec_basicos} onChange={v => f('entrega_rec_basicos',v)} />
          <RCheck label="Confirmación de foto" checked={form.confirmacion_foto} onChange={v => f('confirmacion_foto',v)} />
        </div>

        {/* Nombre quien recibe */}
        {(form.toma_huella || form.toma_mechon || form.entrega_rec_basicos) && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Nombre de quien recibe huella / mechón / recordatorios
            </div>
            <input type="text" value={form.nombre_recibe}
              onChange={e => f('nombre_recibe', e.target.value)}
              placeholder="Nombre completo…"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FAFAFA', fontSize: '12px', outline: 'none', boxSizing: 'border-box', color: '#111827' }} />
          </div>
        )}

        {/* Observaciones */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Observaciones</div>
          <textarea value={form.observaciones} onChange={e => f('observaciones', e.target.value)}
            placeholder="Observaciones, novedades, acuerdos de pago…"
            rows={2}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FAFAFA', fontSize: '12px', outline: 'none', resize: 'none', boxSizing: 'border-box', color: '#111827' }} />
        </div>

        {/* Firma */}
        <SignaturePad onSigned={setFirma} firmaDataUrl={firma} />
        {firma && (
          <img src={firma} alt="Firma" style={{ marginTop: '8px', maxHeight: '64px', border: '1px solid #E5E7EB', borderRadius: '8px' }} />
        )}

        {/* Footer */}
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #E5E7EB', fontSize: '10px', color: '#9CA3AF', textAlign: 'center' }}>
          Técnico: {tecnico?.nombre} {tecnico?.apellido} · Camino al Cielo © {new Date().getFullYear()}
        </div>
      </div>

      {/* Botones de acción */}
      <div className="space-y-2">
        <button onClick={descargarPDF} disabled={generando}
          className="w-full py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: '#7C3AED', color: '#fff' }}>
          <Download size={18} />
          {generando ? 'Generando PDF…' : 'Descargar recibo PDF'}
        </button>
        <button onClick={enviarWhatsApp}
          className="w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: '#25D366', color: '#fff' }}>
          <MessageSquare size={16} /> Enviar resumen por WhatsApp
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
          border: `1px solid ${highlight ? '#3D5A27' : '#E5E7EB'}`,
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
        style={{ width: '16px', height: '16px', flexShrink: 0, accentColor: '#3D5A27' }} />
      <span style={{ fontSize: '12px', color: '#374151' }}>{label}</span>
    </label>
  )
}
