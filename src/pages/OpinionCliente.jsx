// Portal público /#/opinion/CODIGO — el comentario de la encuesta post-entrega
// (migración 206). Se abre desde el botón «Contarnos» que recibe la familia que
// calificó su experiencia como Regular o Mala.
//
// Una sola pregunta y un cuadro de texto. Al enviarlo, coordinación y
// Producción reciben la alerta y el caso queda por atender en /nps.
// ⚠️ Esta página NO ofrece reseña en Google: quien llega aquí respondió
// Regular o Malo (decisión de David, 2026-11-09).
//
// Piel VIVERO (components/portal/Botanica.jsx), la misma del portal de fotos y
// de la visita: es la misma familia mirando la misma marca.
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Ilustracion, ESTILOS, PAPEL, PAPEL2, TINTA, APAGADO, VERDE, BORDE } from '@/components/portal/Botanica'

const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

async function pedir(codigo, opciones) {
  try {
    const res = await fetch(`${API_BASE}/portal/opinion/${encodeURIComponent(codigo)}`, opciones)
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  } catch {
    return { status: 0, ok: false, error: 'red' }
  }
}

/** Los nombres llegan en MAYÚSCULAS desde la base: se muestran en su forma natural. */
const bonito = s => String(s || '')
  .toLocaleLowerCase('es-CO')
  .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'))

function Marco({ children }) {
  return (
    <div className="min-h-screen w-full"
      style={{ background: `radial-gradient(120% 80% at 50% 0%, ${PAPEL} 0%, ${PAPEL2} 100%)`, color: TINTA }}>
      <style>{ESTILOS}</style>
      <div className="mx-auto w-full max-w-[30rem] px-5 py-10">{children}</div>
    </div>
  )
}

function Firma() {
  return (
    <div className="flex flex-col items-center gap-1.5 py-9">
      <span className="block h-px w-10" style={{ background: BORDE }} />
      <p className="font-serif italic text-[13px]" style={{ color: APAGADO }}>Camino al Cielo</p>
    </div>
  )
}

function Aviso({ titulo, texto }) {
  return (
    <div className="flex flex-col items-center text-center pt-10">
      <Ilustracion nombre="rama" tam={64} />
      <h1 className="font-serif text-[24px] leading-tight mt-6">{titulo}</h1>
      <p className="text-[15px] leading-relaxed mt-3 max-w-xs" style={{ color: APAGADO }}>{texto}</p>
    </div>
  )
}

export default function OpinionCliente({ codigo }) {
  const reducir = useReducedMotion()
  const [fase, setFase] = useState('cargando')    // cargando | form | enviado | ya | gracias | no_existe | error
  const [datos, setDatos] = useState(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!codigo) { setFase('no_existe'); return }
    pedir(codigo).then(r => {
      if (r.status === 404) return setFase('no_existe')
      if (!r.ok) return setFase('error')
      setDatos(r)
      if (r.ya_comento) return setFase('ya')
      // Un Bueno no tiene nada que contar aquí (su enlace es el de la reseña).
      setFase(r.satisfaccion === 'REGULAR' || r.satisfaccion === 'MALA' ? 'form' : 'gracias')
    })
  }, [codigo])

  async function enviar(e) {
    e.preventDefault()
    if (texto.trim().length < 3 || enviando) return
    setEnviando(true); setError(null)
    const r = await pedir(codigo, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comentario: texto.trim() }),
    })
    setEnviando(false)
    if (r.ok) return setFase('enviado')
    if (r.error === 'ya_comento') return setFase('ya')
    setError(r.status === 0
      ? 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo; lo que escribiste sigue aquí.'
      : 'No pudimos guardar tu mensaje. Inténtalo de nuevo en un momento.')
  }

  const mascota = bonito(datos?.mascota) || 'tu mascota'

  if (fase === 'cargando') return (
    <Marco><div className="flex justify-center pt-24"><div className="spinner" /></div></Marco>
  )
  if (fase === 'no_existe') return (
    <Marco><Aviso titulo="No encontramos este enlace" texto="Puede que esté incompleto. Si quieres contarnos algo, escríbenos por WhatsApp: con gusto te leemos." /><Firma /></Marco>
  )
  if (fase === 'error') return (
    <Marco><Aviso titulo="Algo no salió bien" texto="No pudimos abrir esta página. Inténtalo de nuevo en un momento." /><Firma /></Marco>
  )
  if (fase === 'ya' || fase === 'enviado') return (
    <Marco>
      <motion.div initial={reducir ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}>
        <Aviso titulo="Gracias por contarnos 🤍"
          texto={`Recibimos tu mensaje sobre ${mascota}. Nuestro equipo lo va a revisar con cuidado y se pondrá en contacto contigo.`} />
      </motion.div>
      <Firma />
    </Marco>
  )
  if (fase === 'gracias') return (
    <Marco><Aviso titulo="Gracias 🤍" texto="Nos alegra mucho haber acompañado a tu familia." /><Firma /></Marco>
  )

  const pregunta = datos?.pregunta || '¿Nos puedes contar qué podríamos mejorar?'
  return (
    <Marco>
      <motion.form onSubmit={enviar}
        initial={reducir ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}>
        <div className="flex flex-col items-center text-center">
          <Ilustracion nombre="rama" tam={56} />
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] mt-5" style={{ color: VERDE }}>
            La entrega de {mascota}
          </p>
          <h1 className="font-serif text-[22px] leading-snug mt-3">{pregunta}</h1>
        </div>

        <label htmlFor="comentario" className="sr-only">Tu comentario</label>
        <textarea id="comentario" value={texto} onChange={e => setTexto(e.target.value)}
          rows={6} maxLength={3000} autoFocus
          placeholder="Escribe aquí con tus palabras…"
          className="cac-foco w-full mt-7 rounded-2xl px-4 py-3 text-[15px] leading-relaxed resize-y"
          style={{ background: '#FFFFFF', border: `1.5px solid ${BORDE}`, color: TINTA }} />

        {error && <p className="text-[13px] mt-3" style={{ color: '#A33A2B' }} role="alert">{error}</p>}

        <button type="submit" disabled={texto.trim().length < 3 || enviando}
          className="cac-foco cac-suave w-full min-h-[52px] mt-5 rounded-full px-6 text-[15px] font-semibold
                     text-white transition-all duration-200 ease-out cursor-pointer
                     disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: VERDE, boxShadow: '0 6px 18px -6px rgba(47,107,73,0.55)' }}>
          {enviando ? 'Enviando…' : 'Enviar mi mensaje'}
        </button>
        <p className="text-[12px] text-center mt-3" style={{ color: APAGADO }}>
          Lo lee directamente nuestro equipo de atención.
        </p>
      </motion.form>
      <Firma />
    </Marco>
  )
}
