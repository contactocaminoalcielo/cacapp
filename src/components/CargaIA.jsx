import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, MessageSquare, X, Sparkles, Upload, CheckCircle, Mic, MicOff, StopCircle } from 'lucide-react'
import { extraerDesdeTexto, extraerDesdeImagen } from '@/lib/ia'

// ─── Tab Voz ──────────────────────────────────────────────────────────────────
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

function TabVoz({ onTranscript }) {
  const [grabando,   setGrabando]   = useState(false)
  const [transcript, setTranscript] = useState('')
  const [soportado,  setSoportado]  = useState(true)
  const [errMic,     setErrMic]     = useState('')
  const recognRef  = useRef(null)
  const grabandoRef = useRef(false)

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSoportado(false); return }

    function crearRecognition() {
      const r = new SR()
      r.lang = 'es-CO'
      r.continuous    = !esIOS  // iOS no soporta continuous
      r.interimResults = !esIOS

      r.onresult = e => {
        let texto = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) texto += e.results[i][0].transcript + ' '
        }
        if (texto) setTranscript(prev => (prev + texto).trimStart())
      }

      r.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setErrMic('Permiso de micrófono denegado. Acepta el permiso en tu navegador.')
          setGrabando(false); grabandoRef.current = false
        } else if (e.error === 'network') {
          setErrMic('Error de red. Verifica tu conexión e intenta de nuevo.')
          setGrabando(false); grabandoRef.current = false
        }
        // no-speech es normal, ignorar
      }

      r.onend = () => {
        // En iOS reinicia automáticamente mientras el botón esté activo
        if (grabandoRef.current && esIOS) {
          try { recognRef.current.start() } catch {}
        } else if (!esIOS) {
          setGrabando(false); grabandoRef.current = false
        }
      }

      return r
    }

    recognRef.current = crearRecognition()
    return () => { try { recognRef.current?.stop() } catch {} }
  }, [])

  function toggleGrabar() {
    if (!recognRef.current) return
    setErrMic('')
    if (grabando) {
      grabandoRef.current = false
      recognRef.current.stop()
      setGrabando(false)
    } else {
      setTranscript('')
      grabandoRef.current = true
      try {
        recognRef.current.start()
        setGrabando(true)
      } catch (e) {
        setErrMic('No se pudo iniciar el micrófono. Verifica los permisos.')
      }
    }
  }

  if (!soportado) return (
    <div className="text-center py-6 px-4">
      <MicOff size={32} className="mx-auto mb-3 text-gray-300" />
      <p className="text-sm text-gray-500 font-medium">Reconocimiento de voz no disponible</p>
      <p className="text-xs text-gray-400 mt-1">Usa Chrome en Android o Safari en iOS 15+</p>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Botón grabar */}
      <div className="flex flex-col items-center gap-3">
        <motion.button
          onClick={toggleGrabar}
          whileTap={{ scale: 0.93 }}
          className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all"
          style={{ background: grabando ? '#DC2626' : '#3D5A27' }}
          animate={grabando ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={grabando ? { repeat: Infinity, duration: 1.2 } : {}}
        >
          {grabando
            ? <StopCircle size={32} color="#fff" />
            : <Mic size={32} color="#fff" />
          }
        </motion.button>
        <p className="text-[13px] font-semibold" style={{ color: grabando ? '#DC2626' : '#6B7280' }}>
          {grabando ? '● Grabando... toca para detener' : 'Toca para dictar'}
        </p>
        {grabando && (
          <p className="text-[11px] text-gray-400 text-center max-w-xs">
            Habla con claridad: nombre del cliente, mascota, dirección, teléfono...
          </p>
        )}
      </div>

      {errMic && (
        <div className="px-4 py-3 rounded-xl text-[13px] font-medium" style={{ background: '#FEF2F2', color: '#DC2626' }}>
          {errMic}
        </div>
      )}

      {/* Transcript */}
      {transcript && (
        <div className="relative">
          <div className="px-4 py-3 rounded-xl text-[13px] text-gray-700 leading-relaxed min-h-[72px]"
            style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            {transcript}
          </div>
          <button
            onClick={() => setTranscript('')}
            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.15)', color: '#6B7280' }}
          >
            <X size={11} />
          </button>
        </div>
      )}

      {transcript && !grabando && (
        <button
          onClick={() => onTranscript(transcript)}
          className="w-full h-11 rounded-xl font-bold text-[13px] text-white flex items-center justify-center gap-2"
          style={{ background: '#3D5A27' }}
        >
          <Sparkles size={14} /> Extraer datos del dictado
        </button>
      )}

      {!transcript && !grabando && (
        <p className="text-[11px] text-gray-400 text-center">
          Dicta todos los datos del servicio en voz alta — nombre, mascota, dirección, teléfono
        </p>
      )}
    </div>
  )
}

// ─── Principal ─────────────────────────────────────────────────────────────────
export default function CargaIA({ onDatos, onClose }) {
  const [tab,     setTab]     = useState('foto')
  const [texto,   setTexto]   = useState('')
  const [imagen,  setImagen]  = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [exito,   setExito]   = useState(false)
  const fileRef = useRef()

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImagen(file); setPreview(URL.createObjectURL(file)); setError('')
  }

  async function procesar(textoOverride) {
    setError(''); setLoading(true)
    try {
      let datos
      if (tab === 'foto') {
        if (!imagen) { setError('Selecciona una imagen primero'); return }
        datos = await extraerDesdeImagen(imagen)
      } else {
        const src = textoOverride ?? texto
        if (!src?.trim()) { setError('Falta el texto o dictado'); return }
        datos = await extraerDesdeTexto(src)
      }
      setExito(true)
      setTimeout(() => { onDatos(datos); onClose() }, 800)
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('API_KEY') || msg.includes('401'))
        setError('API key inválida. Revisa CLAUDE_KEY en src/lib/ia.js')
      else if (msg.includes('Failed to fetch') || msg.includes('NetworkError'))
        setError('Sin conexión. Verifica tu internet.')
      else
        setError(`Error: ${msg || 'Intenta de nuevo'}`)
    } finally {
      setLoading(false)
    }
  }

  const TABS = [
    { key: 'foto',     label: 'Foto',     Icon: Camera },
    { key: 'voz',      label: 'Voz',      Icon: Mic },
    { key: 'whatsapp', label: 'WhatsApp', Icon: MessageSquare },
  ]

  const puedeEnviar = tab === 'foto'
    ? !!imagen
    : tab === 'whatsapp'
    ? !!texto.trim()
    : false // voz tiene su propio botón

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 48 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#FEF9EE' }}>
              <Sparkles size={16} style={{ color: '#C4A87A' }} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-[15px] leading-tight">Cargar con IA</h2>
              <p className="text-[11px] text-gray-400">Pre-llena el formulario automáticamente</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: '1px solid #F3F4F6' }}>
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setError('') }}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-semibold transition-all"
              style={{
                color:        tab === key ? '#3D5A27' : '#9CA3AF',
                borderBottom: tab === key ? '2px solid #3D5A27' : '2px solid transparent',
              }}
            >
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <AnimatePresence mode="wait">

            {tab === 'foto' && (
              <motion.div key="foto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
                {preview ? (
                  <div className="relative rounded-xl overflow-hidden">
                    <img src={preview} alt="Vista previa" className="w-full max-h-52 object-cover" />
                    <button onClick={() => { setImagen(null); setPreview(null) }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { fileRef.current.removeAttribute('capture'); fileRef.current?.click() }}
                      className="border-2 border-dashed border-gray-200 rounded-xl py-7 flex flex-col items-center gap-2 text-gray-400 hover:border-[#3D5A27] hover:text-[#3D5A27] transition-colors">
                      <Upload size={22} /><span className="text-xs font-medium">Galería</span>
                    </button>
                    <button onClick={() => { fileRef.current.setAttribute('capture', 'environment'); fileRef.current?.click() }}
                      className="border-2 border-dashed border-gray-200 rounded-xl py-7 flex flex-col items-center gap-2 text-gray-400 hover:border-[#3D5A27] hover:text-[#3D5A27] transition-colors">
                      <Camera size={22} /><span className="text-xs font-medium">Cámara</span>
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-2 text-center">Papel de veterinaria, nota manuscrita, formulario impreso</p>
              </motion.div>
            )}

            {tab === 'voz' && (
              <motion.div key="voz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TabVoz onTranscript={t => procesar(t)} />
              </motion.div>
            )}

            {tab === 'whatsapp' && (
              <motion.div key="whatsapp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-[12px] text-gray-500 mb-2">Pega el mensaje tal como llegó — sin editarlo:</p>
                <textarea
                  value={texto}
                  onChange={e => { setTexto(e.target.value); setError('') }}
                  placeholder="Ej: Buenas, soy del veterinario X. La paciente es Luna, perrita de 3 años, 5kg, la dueña es María García, cel 3001234567..."
                  rows={6}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[13px] resize-none focus:outline-none focus:border-[#3D5A27] transition-colors"
                />
              </motion.div>
            )}

          </AnimatePresence>

          {error && (
            <div className="px-4 py-3 rounded-xl text-[13px] font-medium" style={{ background: '#FEF2F2', color: '#DC2626' }}>
              {error}
            </div>
          )}

          {/* Botón procesar — solo foto y whatsapp (voz tiene el suyo propio) */}
          {tab !== 'voz' && (
            <motion.button
              onClick={() => procesar()}
              disabled={loading || !puedeEnviar || exito}
              whileTap={{ scale: 0.97 }}
              className="w-full h-12 rounded-xl font-bold text-[14px] text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: exito ? '#16A34A' : '#3D5A27' }}
            >
              {exito ? (
                <><CheckCircle size={16} /> ¡Datos extraídos!</>
              ) : loading ? (
                <><span className="spinner w-4 h-4" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Procesando con IA...</>
              ) : (
                <><Sparkles size={16} /> Extraer datos automáticamente</>
              )}
            </motion.button>
          )}

          {loading && tab === 'voz' && (
            <div className="flex items-center justify-center gap-2 py-2 text-[13px] text-gray-500">
              <span className="spinner w-4 h-4" />
              Procesando dictado con IA...
            </div>
          )}

          <p className="text-center text-[11px] text-gray-400">
            Revisa y corrige los datos antes de confirmar el servicio
          </p>
        </div>
      </motion.div>
    </div>
  )
}
