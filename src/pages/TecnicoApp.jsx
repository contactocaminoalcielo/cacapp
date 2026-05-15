import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '@/lib/supabase'
import { petEmoji, fmt } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  Phone, MapPin, Clock, CheckCircle, LogOut, Bell,
  Truck, Package, RefreshCw, CreditCard, Camera, Check,
  AlertCircle, X, Snowflake, Weight,
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
      const { data, error: upErr } = await db.storage
        .from('evidencias').upload(path, file, { upsert: true, contentType: file.type })
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
const NEVERAS = ['N1','N2','N3','N4','N5','N6']

function RegistroCuartoFrio({ svc, onCompletar }) {
  const cf = svc.cuarto_frio_data || null
  const [peso, setPeso]               = useState(String(svc.mascotas?.peso_kg || ''))
  const [nevera, setNevera]           = useState('')
  const [neveraCustom, setNeveraCustom] = useState(false)
  const [fotoUrl, setFotoUrl]         = useState(null)
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')

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
        <input type="number" inputMode="decimal" step="0.1"
          value={peso} onChange={e => setPeso(e.target.value)}
          placeholder={svc.mascotas?.peso_kg ? `Registrado: ${svc.mascotas.peso_kg} kg` : 'Ej: 4.5'}
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
              {NEVERAS.map(n => (
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
function CardRecogida({ svc, onIniciar, onCompletar, onCuartoFrio }) {
  const [sheetOpen, setSheetOpen]   = useState(false)
  const [fotoUrl, setFotoUrl]       = useState(
    svc.recogidas?.[0]?.notas?.startsWith('http') ? svc.recogidas[0].notas : null
  )
  const [checked, setChecked]       = useState([])
  const [completing, setCompleting] = useState(false)
  const [actErr, setActErr]         = useState('')

  const mascota  = svc.mascotas
  const especie  = mascota?.especies?.nombre || ''
  const emoji    = petEmoji(especie)
  const cliente  = mascota?.clientes
  const recogida = svc.recogidas?.[0]
  const cf       = svc.cuarto_frio_data || null

  const pendiente    = svc.estado === 'INGRESADO'
  const enCamino     = svc.estado === 'EN_RECOGIDA'
  const enCuartoFrio = svc.estado === 'EN_CUARTO_FRIO' && !cf?.nevera_codigo

  const itemsReq = ['id_ok','rec_ok', ...(svc.estado_pago !== 'COMPLETO' ? ['cobro_ok'] : [])]
  const checklistListo = itemsReq.every(id => checked.includes(id)) && !!fotoUrl

  function toggleCheck(id) {
    setChecked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function completar() {
    setCompleting(true); setActErr('')
    try { await onCompletar(svc, recogida?.id) }
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
          <button onClick={() => setSheetOpen(true)}
            className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-98"
            style={{ background: '#3D5A27', color: '#fff' }}>
            🚐 Iniciar ruta
          </button>
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
              dbSave={recogida?.id ? { table: 'recogidas', column: 'notas', id: recogida.id } : null}
              fotoUrl={fotoUrl}
              onFotoUploaded={setFotoUrl}
              label="Tomar foto de la mascota"
              sublabel="Evidencia de recogida"
            />
            <Checklist svc={svc} fotoUrl={fotoUrl} checked={checked} onChange={toggleCheck} />
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
                : `Completa el checklist (${checked.length + (fotoUrl ? 1 : 0)}/${itemsReq.length + 1})`}
            </button>
          </div>
        )}

        {/* ── FASE 3: CUARTO FRÍO ── */}
        {enCuartoFrio && (
          <RegistroCuartoFrio svc={svc} onCompletar={onCuartoFrio} />
        )}
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

// ─── MAIN ───────────────────────────────────────────────────────────────
export default function TecnicoApp() {
  const { personalData: tecnico, logout } = useAuth()
  const [tab, setTab]             = useState('recogidas')
  const [recogidas, setRecogidas] = useState([])
  const [entregas, setEntregas]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [queryErr, setQueryErr]   = useState('')
  const [notif, setNotif]         = useState(null)
  const prevCountRef              = useRef(null)

  const cargar = useCallback(async (silent = false) => {
    if (!tecnico) return
    if (!silent) setLoading(true)
    setQueryErr('')
    try {
      // ── 1. Servicios asignados (sin join cuarto_frio para evitar errores) ──
      const { data: svcData, error: svcErr } = await db.from('servicios')
        .select(`
          id, estado, estado_pago, metodo_pago, valor_total, valor_pagado,
          direccion_recogida, ciudad_recogida, barrio_recogida, indicaciones_recogida,
          mascotas:mascota_id (
            nombre, tamano, especie_id, peso_kg,
            especies ( nombre ),
            clientes:cliente_id ( nombre, apellido, whatsapp )
          ),
          recogidas ( id, contacto_nombre, contacto_telefono, fecha_programada, hora_programada, notas )
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
          .select('id, servicio_id, nevera_codigo, posicion, peso_registrado_kg, foto_pesaje_url')
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

  async function iniciarRecogida(svc, hora) {
    const { error } = await db.from('servicios').update({ estado: 'EN_RECOGIDA' }).eq('id', svc.id)
    if (error) throw new Error(error.message)
    const recogidaId = svc.recogidas?.[0]?.id
    if (recogidaId && hora) {
      await db.from('recogidas').update({ hora_programada: hora }).eq('id', recogidaId)
    }
    await cargar()
  }

  async function completarRecogida(svc, recogidaId) {
    const { error } = await db.from('servicios').update({ estado: 'EN_CUARTO_FRIO' }).eq('id', svc.id)
    if (error) throw new Error(error.message)
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
    if (cfId) {
      const updateData = {
        nevera_codigo:        nevera,
        peso_registrado_kg:   parseFloat(peso) || null,
        estado:               'REFRIGERADO',
      }
      // foto_pesaje_url requiere migración SQL — se guarda solo si la columna existe
      try {
        await db.from('cuarto_frio').update({ ...updateData, foto_pesaje_url: fotoUrl }).eq('id', cfId)
      } catch {
        // Fallback sin la columna de foto
        await db.from('cuarto_frio').update({
          ...updateData,
          notas: fotoUrl ? `foto_pesaje: ${fotoUrl}` : null,
        }).eq('id', cfId)
      }
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

  const TABS = [
    { key: 'recogidas', label: 'Recogidas', Icon: Truck,   count: recogidas.length },
    { key: 'entregas',  label: 'Entregas',  Icon: Package,  count: entregas.length  },
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
        {TABS.map(({ key, label, Icon, count }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-semibold transition-colors"
            style={{
              color: tab === key ? '#3D5A27' : '#9CA3AF',
              borderBottom: tab === key ? '2px solid #3D5A27' : '2px solid transparent',
            }}>
            <Icon size={15} /> {label}
            {count > 0 && (
              <span className="ml-0.5 text-[10px] font-bold min-w-[18px] h-[18px] rounded-full inline-flex items-center justify-center px-1"
                style={{ background: '#3D5A27', color: '#fff' }}>
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
            : recogidas.map(r => (
              <CardRecogida key={r.id} svc={r}
                onIniciar={iniciarRecogida}
                onCompletar={completarRecogida}
                onCuartoFrio={confirmarCuartoFrio} />
            ))
        ) : (
          entregas.length === 0
            ? <EmptyState icon="📦" texto="Sin entregas asignadas" sub="Cuando te asignen una entrega, aparecerá aquí." />
            : entregas.map(e => <CardEntrega key={e.id} ent={e} onAction={accionEntrega} />)
        )}
      </div>

      <div className="text-center pb-6 pt-2 text-[11px] text-gray-400">
        Se actualiza cada 30 s ·{' '}
        <button onClick={() => cargar()} className="underline">Actualizar ahora</button>
      </div>
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
