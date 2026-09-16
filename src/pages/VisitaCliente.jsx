// Portal público de la VISITA a la planta — se abre desde el aviso de mitad de
// compostaje (migración 159).
//
// Dos cosas en una pantalla: contarle a la familia que el proceso de su
// mascotica va con normalidad, y dejarla pedir el día en que quiere venir a
// verla. Nada más: no se cobra, no se pide dirección, no se decide nada del
// servicio.
//
// ⚠️ LA VISITA NO QUEDA CONFIRMADA AQUÍ y la pantalla lo dice tres veces (en el
// encabezado del formulario, en el botón y en la confirmación). Quien valida
// contra la jornada de Tenjo es la casa. Prometerle a una familia en duelo un
// día que la planta no puede recibir es peor que no ofrecer la visita.
//
// La paleta y las ilustraciones vienen de components/portal/Botanica.jsx: las
// comparte con el portal de fotos y el de plantas. Es la misma familia mirando
// la misma marca en el mismo momento.
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { portalVisita, portalPedirVisita, FRANJA_LABEL } from '@/lib/visitas'
import { Ilustracion, ESTILOS, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, VERDE, VIVO, BORDE } from '@/components/portal/Botanica'
import CasillaDatos from '@/components/CasillaDatos'
import { VERSION as POLITICA_VERSION } from '@/lib/privacidad'

/**
 * Los nombres llegan en MAYÚSCULAS desde la base. Gritar "JOSHUA" en una
 * pantalla dirigida a una familia es áspero: se muestran en su forma natural.
 */
const bonito = s => String(s || '')
  .toLocaleLowerCase('es-CO')
  .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'))

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS  = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Fecha DATE ('2026-09-22') sin cruzar por UTC: mediodía local, siempre. */
const fechaDe = f => new Date(`${f}T12:00:00`)
const fechaLarga = f => {
  if (!f) return ''
  const d = fechaDe(f)
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
}
const fechaCorta = f => {
  if (!f) return ''
  const d = fechaDe(f)
  return `${d.getDate()} de ${MESES[d.getMonth()]}`
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Marco({ children }) {
  return (
    <div className="min-h-screen w-full"
      style={{ background: `radial-gradient(120% 80% at 50% 0%, ${PAPEL} 0%, ${PAPEL2} 100%)`, color: TINTA }}>
      <style>{ESTILOS}</style>
      <div className="mx-auto w-full max-w-[30rem] px-5">{children}</div>
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

/** Botón principal. 52px de alto: por encima del mínimo táctil de 44. */
function Boton({ children, ...props }) {
  return (
    <button
      className="cac-foco cac-suave w-full min-h-[52px] rounded-full px-6 text-[15px] font-semibold
                 text-white transition-all duration-200 ease-out cursor-pointer
                 disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: VERDE, boxShadow: '0 6px 18px -6px rgba(47,107,73,0.55)' }}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * El avance del proceso, dibujado.
 *
 * Es la única prueba que la familia tiene de que "va con normalidad": una
 * barra con el inicio, hoy y el final estimado. Sin fechas exactas del final
 * como promesa — se dice "hacia" porque el operario puede mover el cubículo.
 */
function Avance({ inicio, fin }) {
  if (!inicio || !fin) return null
  const ini = fechaDe(inicio).getTime()
  const f   = fechaDe(fin).getTime()
  const hoy = Date.now()
  const pct = Math.max(6, Math.min(100, Math.round(((hoy - ini) / (f - ini)) * 100)))
  return (
    <div className="mt-6">
      <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: PAPEL2, border: `1px solid ${BORDE}` }}>
        <div className="h-full rounded-full cac-suave"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${HONDO}, ${VIVO})`, transition: 'width 600ms ease-out' }} />
      </div>
      <div className="flex justify-between mt-2 text-[11px]" style={{ color: APAGADO }}>
        <span>Ingresó el {fechaCorta(inicio)}</span>
        <span>hacia {fechaCorta(fin)}</span>
      </div>
    </div>
  )
}

/** Tarjeta de un día ofrecido. */
function Dia({ dia, fecha, activo, onClick }) {
  const d = fechaDe(fecha)
  return (
    <button type="button" onClick={onClick}
      className="cac-foco cac-suave rounded-2xl px-3 py-3 text-left transition-all duration-200 cursor-pointer"
      style={{
        background: activo ? '#EAF3ED' : PAPEL,
        border: `1.5px solid ${activo ? VIVO : BORDE}`,
        boxShadow: activo ? '0 4px 14px -8px rgba(47,107,73,0.55)' : 'none',
      }}
      aria-pressed={activo}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: activo ? VERDE : APAGADO }}>
        {dia}
      </span>
      <span className="block text-[17px] font-semibold leading-tight mt-0.5" style={{ color: TINTA }}>
        {d.getDate()}
      </span>
      <span className="block text-[11px]" style={{ color: APAGADO }}>{MESES[d.getMonth()].slice(0, 3)}</span>
    </button>
  )
}

/** Franja (mañana / tarde). */
function Franja({ f, activo, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="cac-foco cac-suave flex-1 rounded-2xl px-4 py-3 text-left transition-all duration-200 cursor-pointer"
      style={{
        background: activo ? '#EAF3ED' : PAPEL,
        border: `1.5px solid ${activo ? VIVO : BORDE}`,
      }}
      aria-pressed={activo}>
      <span className="block text-[14px] font-semibold" style={{ color: activo ? VERDE : TINTA }}>{f.label}</span>
      {f.detalle && <span className="block text-[11px] mt-0.5" style={{ color: APAGADO }}>{f.detalle}</span>}
    </button>
  )
}

/** Aviso de que la visita está sujeta a disponibilidad. Se repite a propósito. */
function NotaDisponibilidad() {
  return (
    <p className="text-[12px] leading-relaxed rounded-2xl px-4 py-3 mt-4"
      style={{ background: '#FFF8EC', border: '1px solid #F0DFC0', color: '#7A5A1E' }}>
      Ten en cuenta que la visita queda <strong>sujeta a disponibilidad</strong> de la planta ese día.
      Nosotros la revisamos y te confirmamos por WhatsApp.
    </p>
  )
}

// ─── Pantalla ────────────────────────────────────────────────────────────────

export default function VisitaCliente({ codigo: codigoProp }) {
  const quieto = useReducedMotion()
  const [fase,     setFase]     = useState(codigoProp ? 'cargando' : 'entrada')
  const [cInput,   setCInput]   = useState(codigoProp || '')
  const [codigo,   setCodigo]   = useState((codigoProp || '').toUpperCase())
  const [datos,    setDatos]    = useState(null)
  const [fecha,    setFecha]    = useState('')
  const [franja,   setFranja]   = useState('')
  const [personas, setPersonas] = useState(2)
  const [notas,    setNotas]    = useState('')
  const [error,    setError]    = useState('')
  const [enviando, setEnviando] = useState(false)
  const [autorizo, setAutorizo] = useState(false)

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  // Tenjo recibe visitas en una sola jornada (8 a 12). Con una sola franja no
  // hay nada que escoger: se selecciona sola y la pantalla la muestra como dato.
  // Preguntar "¿mañana o mañana?" es un paso que no decide nada.
  useEffect(() => {
    const fs = datos?.franjas || []
    if (fs.length === 1) setFranja(fs[0].clave)
  }, [datos])

  async function cargar(cod) {
    const c = String(cod || '').trim().toUpperCase()
    if (!c) return
    setFase('cargando'); setError(''); setCodigo(c)
    try {
      const r = await portalVisita(c)
      if (r.status === 404 || !r.ok) {
        setError('No encontramos este enlace. Revisa el código o escríbenos por WhatsApp.')
        setFase('entrada')
        return
      }
      setDatos(r)
      setFase(r.cerrado ? 'cerrado' : (r.visita ? 'listo' : 'form'))
    } catch {
      setError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.')
      setFase('entrada')
    }
  }

  const mascota   = bonito(datos?.servicio?.mascota) || 'tu mascotica'
  const nombreCli = bonito(datos?.servicio?.nombre_cliente)
  const cubiculo  = datos?.servicio?.cubiculo
  const dias      = datos?.dias || []
  const franjas   = datos?.franjas || []
  const visita    = datos?.visita || null

  // Un botón apagado sin decir por qué es una pantalla que no se deja usar.
  // Se nombra lo PRIMERO que falta, no todo a la vez.
  const pista = !fecha ? 'Escoge el día en que te gustaría venir'
    : !franja ? 'Escoge la jornada que te queda mejor'
    : !autorizo ? 'Falta marcar la autorización de datos'
    : null

  async function enviar() {
    if (enviando || !fecha || !franja || !autorizo) return
    setEnviando(true); setError('')
    try {
      const r = await portalPedirVisita(codigo, {
        fecha, franja, personas, notas,
        autorizacion: { aceptada: autorizo, politica_version: POLITICA_VERSION },
      })
      if (!r.ok) {
        // El día se llenó mientras la familia decidía: se recarga y se le
        // muestran los que quedan, en vez de dejarla contra un error seco.
        if (r.error === 'dia_no_disponible') {
          setError('Ese día se acaba de llenar. Mira las otras fechas disponibles.')
          setFecha('')
          await cargar(codigo)
          return
        }
        if (r.error === 'ya_tiene_visita') { await cargar(codigo); return }
        setError('No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.')
        return
      }
      setDatos(d => ({ ...d, visita: r.visita }))
      setFase('listo')
    } catch {
      setError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  // ── Entrada por código (quien abre /visita sin el enlace completo) ──
  if (fase === 'entrada') {
    return (
      <Marco>
        <div className="pt-16 pb-6 text-center">
          <div className="flex justify-center mb-1"><Ilustracion nombre="rama" tam={64} /></div>
          <h1 className="font-serif italic text-[26px] leading-tight mt-4" style={{ color: HONDO }}>Visita a la planta</h1>
          <p className="text-[14px] mt-2" style={{ color: APAGADO }}>
            Escribe el código que te enviamos por WhatsApp.
          </p>
        </div>
        <input value={cInput} onChange={e => setCInput(e.target.value.toUpperCase())}
          placeholder="CÓDIGO" aria-label="Código del enlace"
          className="w-full min-h-[52px] text-center text-[18px] tracking-[0.2em] rounded-2xl px-4 cac-foco"
          style={{ background: PAPEL, border: `1.5px solid ${BORDE}`, color: TINTA }} />
        {error && <p role="alert" className="text-[13px] mt-3 text-center" style={{ color: '#A33A2A' }}>{error}</p>}
        <div className="mt-4"><Boton onClick={() => cargar(cInput)} disabled={!cInput.trim()}>Continuar</Boton></div>
        <Firma />
      </Marco>
    )
  }

  if (fase === 'cargando') {
    return (
      <Marco>
        <div className="pt-24 text-center">
          <div className="flex justify-center"><Ilustracion nombre="rama" tam={56} /></div>
          <p className="text-[14px] mt-4" style={{ color: APAGADO }}>Un momento…</p>
        </div>
      </Marco>
    )
  }

  // ── El enlace ya no aplica (salió del cubículo, se entregó o venció) ──
  if (fase === 'cerrado') {
    return (
      <Marco>
        <div className="pt-16 text-center">
          <div className="flex justify-center mb-1"><Ilustracion nombre="rama" tam={64} vivo /></div>
          <h1 className="font-serif italic text-[26px] leading-tight mt-4" style={{ color: HONDO }}>
            El proceso de {mascota} ya terminó
          </h1>
          <p className="text-[14px] leading-relaxed mt-3" style={{ color: APAGADO }}>
            Por eso este enlace ya no recibe visitas al cubículo. Si quieres saber cómo va todo,
            escríbenos por WhatsApp y con gusto te contamos.
          </p>
        </div>
        <Firma />
      </Marco>
    )
  }

  // ── Ya pidió (o ya se la confirmaron) ──
  if (fase === 'listo' && visita) {
    const confirmada = visita.estado === 'PROGRAMADA'
    return (
      <Marco>
        <motion.div
          initial={quieto ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className="pt-16 text-center">
          <div className="flex justify-center mb-1"><Ilustracion nombre="rama" tam={64} vivo /></div>
          <h1 className="font-serif italic text-[26px] leading-tight mt-4" style={{ color: HONDO }}>
            {confirmada ? '¡Te esperamos!' : 'Recibimos tu solicitud'}
          </h1>
          <p className="text-[15px] leading-relaxed mt-3" style={{ color: TINTA }}>
            {confirmada ? 'Tu visita quedó confirmada para el ' : 'Pediste venir el '}
            <strong>{fechaLarga(visita.fecha_visita)}</strong>
            {visita.franja ? ` ${FRANJA_LABEL[visita.franja] || ''}` : ''}.
          </p>
          {!confirmada && (
            <p className="text-[13px] leading-relaxed mt-3" style={{ color: APAGADO }}>
              Estamos revisando la disponibilidad de la planta para ese día y te confirmamos
              por WhatsApp. Si necesitas cambiarlo, respóndenos por ahí mismo.
            </p>
          )}
          {confirmada && (
            <p className="text-[13px] leading-relaxed mt-3" style={{ color: APAGADO }}>
              Si algo cambia, escríbenos por WhatsApp y lo reprogramamos.
            </p>
          )}
        </motion.div>
        <Firma />
      </Marco>
    )
  }

  // ── Pantalla principal ──
  return (
    <Marco>
      <motion.div
        initial={quieto ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>

        {/* El mensaje que motiva todo esto: va bien. */}
        <div className="pt-14 text-center">
          <div className="flex justify-center mb-1"><Ilustracion nombre="rama" tam={64} vivo /></div>
          <h1 className="font-serif italic text-[26px] leading-tight mt-4" style={{ color: HONDO }}>
            El proceso de {mascota} va con normalidad
          </h1>
          <p className="text-[14px] leading-relaxed mt-3" style={{ color: APAGADO }}>
            {nombreCli ? `${nombreCli}, ` : ''}ya vamos por la mitad del compostaje
            {cubiculo ? <> y {mascota} está en el cubículo <strong style={{ color: TINTA }}>{cubiculo}</strong></> : ''}.
            Todo avanza como debe ser.
          </p>
          <Avance inicio={datos?.proceso?.inicio} fin={datos?.proceso?.fin} />
        </div>

        {/* La invitación */}
        <div className="mt-10">
          <h2 className="font-serif italic text-[20px] leading-tight text-center" style={{ color: HONDO }}>
            ¿Te gustaría venir a visitarla?
          </h2>
          <p className="text-[13px] leading-relaxed mt-2 text-center" style={{ color: APAGADO }}>
            Puedes venir a nuestra planta en Tenjo a acompañar a {mascota} un rato.
            Escoge el día que más te sirva.
          </p>
        </div>

        {dias.length === 0 ? (
          <p className="text-[13px] leading-relaxed rounded-2xl px-4 py-3 mt-6 text-center"
            style={{ background: PAPEL, border: `1px solid ${BORDE}`, color: APAGADO }}>
            En este momento no tenemos días disponibles para visitas.
            Escríbenos por WhatsApp y buscamos un espacio contigo.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5 mt-6">
              {dias.map(d => (
                <Dia key={d.fecha} dia={d.dia} fecha={d.fecha}
                  activo={fecha === d.fecha}
                  onClick={() => setFecha(f => (f === d.fecha ? '' : d.fecha))} />
              ))}
            </div>

            {fecha && franjas.length === 1 && (
              <div className="mt-5 rounded-2xl px-4 py-3 text-[13px]"
                style={{ background: PAPEL, border: `1px solid ${BORDE}`, color: TINTA }}>
                Las visitas son <strong>{franjas[0].detalle || 'en la mañana'}</strong>.
                Te confirmamos la hora exacta por WhatsApp.
              </div>
            )}

            {fecha && franjas.length > 1 && (
              <div className="mt-6">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: APAGADO }}>
                  ¿A qué hora te queda mejor?
                </p>
                <div className="flex gap-2.5">
                  {franjas.map(f => (
                    <Franja key={f.clave} f={f} activo={franja === f.clave}
                      onClick={() => setFranja(x => (x === f.clave ? '' : f.clave))} />
                  ))}
                </div>
              </div>
            )}

            {fecha && franja && (
              <div className="mt-6">
                <label htmlFor="personas" className="text-[12px] font-bold block mb-1.5" style={{ color: APAGADO }}>
                  ¿Cuántas personas vienen?
                </label>
                <input id="personas" type="number" inputMode="numeric" min={1} max={20}
                  value={personas}
                  onChange={e => setPersonas(Math.min(Math.max(parseInt(e.target.value) || 1, 1), 20))}
                  className="w-full min-h-[48px] text-[15px] rounded-2xl px-3.5 cac-foco"
                  style={{ background: PAPEL, border: `1.5px solid ${BORDE}`, color: TINTA }} />

                <label htmlFor="notas" className="text-[12px] font-bold block mb-1.5 mt-4" style={{ color: APAGADO }}>
                  ¿Algo que debamos saber? <span style={{ fontWeight: 400 }}>(opcional)</span>
                </label>
                <textarea id="notas" rows={3} value={notas} maxLength={500}
                  onChange={e => setNotas(e.target.value)}
                  placeholder="Por ejemplo, si vienen niños o necesitas ayuda para llegar."
                  className="w-full text-[15px] rounded-2xl px-3.5 py-2.5 cac-foco"
                  style={{ background: PAPEL, border: `1.5px solid ${BORDE}`, color: TINTA }} />
              </div>
            )}

            <NotaDisponibilidad />

            {error && <p role="alert" className="text-[13px] mt-3 text-center" style={{ color: '#A33A2A' }}>{error}</p>}

            <div className="mt-5">
              <CasillaDatos className="mb-3" tono="portal" checked={autorizo} onChange={setAutorizo} />
              <Boton onClick={enviar} disabled={!fecha || !franja || !autorizo || enviando}>
                {enviando ? 'Enviando…' : 'Pedir la visita'}
              </Boton>
              {pista && (
                <p className="text-[12px] mt-2 text-center" style={{ color: APAGADO }}>{pista}</p>
              )}
            </div>
          </>
        )}
      </motion.div>
      <Firma />
    </Marco>
  )
}
