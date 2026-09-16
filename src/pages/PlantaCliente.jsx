// Portal público donde la familia elige la planta en la que queda su mascota
// al terminar el compostaje (migración 149). Sin sesión: el código del enlace es
// el secreto, y es el MISMO del portal de fotos — el cliente ya lo tiene.
//
// El precio nunca sale de aquí: esta pantalla manda ids y cantidades, y el
// backend resuelve el monto contra `plantas` dentro de su transacción.
//
// ── Sobre el diseño ─────────────────────────────────────────────────────────
// Esta pantalla la abre alguien que acaba de perder a su mascota. No se parece
// al resto de Orbit a propósito: fondo de papel cálido en vez del azul de la
// marca, titulares en Playfair itálica (ya cargada en index.html, no pide una
// fuente más) y un verde profundo en vez del azul corporativo.
//
// **No usa iconos de librería.** Cada especie tiene su ILUSTRACIÓN dibujada a
// mano en SVG —la fronda del helecho, el zigzag del pescadito—, así el momento
// de elegir se parece a mirar plantas y no a llenar un formulario. Un ícono
// genérico repetido en las dos tarjetas volvería intercambiable justo lo único
// que la familia tiene que decidir.
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { portalPlanta, portalElegirPlanta } from '@/lib/plantas'
import { Ilustracion } from '@/components/portal/Botanica'
import { ESTILOS_VIVERO, FondoVivero, Brota, useFuentesVivero,
         CAMPO, TINTA, MUSGO, SELVA, BROTE, HOJA, LINDE, MIEL } from '@/components/portal/Vivero'
import { LOCALIDADES_BOGOTA } from '@/components/ui/localidad-select'

// La paleta y las ilustraciones viven en components/portal/Botanica.jsx: las
// comparte con el portal de fotos.

const pesos = v => `$${Number(v || 0).toLocaleString('es-CO')}`

// ─── Datos de entrega ────────────────────────────────────────────────────────
// Los trae la familia desde la solicitud de imágenes (`servicios.datos_entrega_cliente`).
// Aquí NO se vuelven a pedir desde cero: se muestran para confirmar, y solo si
// faltan —o si la familia dice que cambiaron— se abre el formulario.
//
// El núcleo obligatorio es el mismo que en el portal de fotos: sin dirección,
// sin quién recibe y sin teléfono, el mensajero no puede salir. Ojo, esto es
// solo la reja de la pantalla; la de verdad la pone el backend.
const ENTREGA_VACIA = {
  direccion: '', barrio: '', localidad: '', recibe: '',
  telefono: '', telefono_adicional: '', horarios: '',
}
const CAMPOS_ENTREGA_REQ = ['direccion', 'recibe', 'telefono']
const FUERA_BOGOTA = 'Fuera de Bogotá'
const nucleoOk = e => CAMPOS_ENTREGA_REQ.every(k => String(e?.[k] || '').trim())

/**
 * Los nombres llegan en MAYÚSCULAS desde la base (así se registran en la
 * operación). Gritar "JOSHUA" en la pantalla donde una familia se despide es
 * áspero: aquí se muestran en su forma natural. Solo cambia lo que se ve; el
 * dato no se toca.
 */
const bonito = s => String(s || '')
  .toLocaleLowerCase('es-CO')
  .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CO'))

// ─── Piezas de la página ─────────────────────────────────────────────────────

function Marco({ children }) {
  useFuentesVivero()
  return (
    <div className="vv-cuerpo min-h-screen w-full" style={{ color: TINTA }}>
      <style>{ESTILOS_VIVERO}</style>
      <FondoVivero />
      <div className="mx-auto w-full max-w-[30rem] px-5">{children}</div>
    </div>
  )
}

function Firma() {
  return (
    <div className="flex flex-col items-center gap-2 py-10">
      <Ilustracion nombre="rama" tam={16} />
      <p className="vv-firma italic text-[13px]" style={{ color: MUSGO }}>Camino al Cielo</p>
    </div>
  )
}

/** Botón principal. 52px de alto: por encima del mínimo táctil de 44. */
function Boton({ children, ...props }) {
  return (
    <button
      className="vv-foco vv-suave w-full min-h-[52px] rounded-full px-6 text-[15px] font-semibold
                 text-white transition-all duration-200 ease-out cursor-pointer
                 disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: `linear-gradient(180deg, #35895A 0%, ${BROTE} 100%)`,
               boxShadow: '0 10px 24px -10px rgba(22,56,42,0.7)' }}
      {...props}
    >
      {children}
    </button>
  )
}

/** Una línea de la tarjeta de solo lectura. Nada que confirmar sin poder leerlo. */
function DatoEntrega({ etiqueta, valor }) {
  if (!String(valor || '').trim()) return null
  return (
    <div className="py-2 flex gap-3 items-baseline">
      <p className="text-[13px] shrink-0 w-[92px]" style={{ color: MUSGO }}>{etiqueta}</p>
      <p className="text-[15px] leading-snug flex-1" style={{ color: TINTA }}>{valor}</p>
    </div>
  )
}

/**
 * Campo de texto. El borde verde al llenarse es la única señal de avance que
 * tiene la familia en el formulario; el asterisco NO va solo en color, lleva
 * también el texto "obligatorio" en el aviso de la barra.
 */
function CampoEntrega({ campo, label, value, onChange, placeholder, inputMode, requerido }) {
  const lleno = !!String(value || '').trim()
  const id = `entrega-${campo}`
  return (
    <div>
      <label htmlFor={id} className="text-[13px] block mb-1.5" style={{ color: MUSGO }}>
        {label}{requerido && <span aria-hidden="true" style={{ color: '#A33A2A' }}> *</span>}
      </label>
      <input id={id} type="text" inputMode={inputMode} required={requerido}
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full min-h-[48px] text-[15px] rounded-2xl px-3.5 py-2.5 transition-colors
                   duration-200 vv-foco vv-suave"
        style={{ background: 'rgba(255,255,255,0.92)', border: `1.5px solid ${lleno ? HOJA : LINDE}`,
                 color: TINTA }} />
    </div>
  )
}

/** Localidad: mismo catálogo que el portal de fotos, no una lista aparte. */
function CampoLocalidad({ value, onChange }) {
  const lleno = !!String(value || '').trim()
  return (
    <div>
      <label htmlFor="entrega-localidad" className="text-[13px] block mb-1.5" style={{ color: MUSGO }}>
        Localidad
      </label>
      {/* Se deja la flecha NATIVA: sin ella el campo se ve igual que "Barrio" y
          la familia intenta escribir encima. */}
      <select id="entrega-localidad" value={value || ''} onChange={e => onChange(e.target.value)}
        className="w-full min-h-[48px] text-[15px] rounded-2xl px-3 py-2.5 transition-colors
                   duration-200 vv-foco vv-suave"
        style={{ background: 'rgba(255,255,255,0.92)', border: `1.5px solid ${lleno ? HOJA : LINDE}`,
                 color: lleno ? TINTA : MUSGO }}>
        <option value="">Selecciona…</option>
        {LOCALIDADES_BOGOTA.map(l => <option key={l} value={l}>{l}</option>)}
        <option value={FUERA_BOGOTA}>{FUERA_BOGOTA}</option>
      </select>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PlantaCliente({ codigo: codigoProp }) {
  const quieto = useReducedMotion()
  const [fase,      setFase]      = useState(codigoProp ? 'cargando' : 'entrada')
  const [cInput,    setCInput]    = useState(codigoProp || '')
  const [codigo,    setCodigo]    = useState((codigoProp || '').toUpperCase())
  const [datos,     setDatos]     = useState(null)
  const [elegida,   setElegida]   = useState('')
  const [extras,    setExtras]    = useState({})   // { [planta_id]: cantidad }
  const [error,     setError]     = useState('')
  const [enviando,  setEnviando]  = useState(false)
  const [resultado, setResultado] = useState(null)
  // Entrega: `editando` abre el formulario; `confirmada` es el "sí, están bien"
  // explícito. Se mantienen separados porque teclear en el formulario ya vale
  // como confirmación, pero mirar una tarjeta de solo lectura no.
  const [entrega,    setEntrega]    = useState(ENTREGA_VACIA)
  const [editandoEntrega, setEditandoEntrega] = useState(true)
  const [entregaConfirmada, setEntregaConfirmada] = useState(false)

  useEffect(() => { if (codigoProp) cargar(codigoProp) }, [codigoProp])

  async function cargar(cod) {
    const c = String(cod || '').trim().toUpperCase()
    if (!c) return
    setFase('cargando'); setError(''); setCodigo(c)
    try {
      const r = await portalPlanta(c)
      if (r.status === 404 || !r.ok) {
        setError('No encontramos este enlace. Revisa el código o escríbenos por WhatsApp.')
        setFase('entrada')
        return
      }
      setDatos(r)
      setElegida(r.eleccion?.planta_id || '')
      // Si lo que ya dejó está completo, se le muestra para confirmar. Si viene
      // a medias, se abre el formulario con lo que haya: volver a escribir una
      // dirección que ya dio es exactamente lo que no queremos.
      const previa = { ...ENTREGA_VACIA, ...(r.entrega || {}) }
      const completa = nucleoOk(previa)
      setEntrega(previa)
      setEditandoEntrega(!completa)
      setEntregaConfirmada(false)
      setFase(r.cerrado ? 'cerrado' : (r.ya_eligio && !r.adicionales?.length ? 'listo' : 'form'))
    } catch {
      setError('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.')
      setFase('entrada')
    }
  }

  const mascota     = bonito(datos?.servicio?.mascota) || 'tu mascota'
  const nombreCli   = bonito(datos?.servicio?.nombre_cliente)
  const yaEligio    = !!datos?.ya_eligio
  const opciones    = datos?.opciones || []
  const disponibles = datos?.adicionales || []
  const comprados   = datos?.comprados || []
  const totalExtras = disponibles.reduce((s, p) => s + (extras[p.id] || 0) * (p.precio || 0), 0)
  const hayExtras   = Object.keys(extras).length > 0
  // Teclear en el formulario ya vale como confirmación; mirar la tarjeta, no.
  const entregaLista = editandoEntrega ? nucleoOk(entrega) : entregaConfirmada
  const puedeEnviar  = (yaEligio ? hayExtras : !!elegida) && entregaLista
  const setE = (k, v) => setEntrega(p => ({ ...p, [k]: v }))

  // Un botón apagado sin decir por qué es una pantalla que no se deja usar.
  // Se nombra lo PRIMERO que falta, no todo a la vez.
  const pista = (!yaEligio && !elegida) ? 'Elige una planta para continuar'
    : !entregaLista ? (editandoEntrega
        ? 'Completa dirección, quién recibe y teléfono para continuar'
        : 'Confirma los datos de entrega para continuar')
    : null

  function cambiarExtra(id, delta) {
    setExtras(p => {
      const n = { ...p }
      const v = (n[id] || 0) + delta
      if (v <= 0) delete n[id]; else n[id] = Math.min(v, 10)
      return n
    })
  }

  async function enviar() {
    if (enviando) return
    setEnviando(true); setError('')
    try {
      const r = await portalElegirPlanta(codigo, {
        planta_id: yaEligio ? undefined : elegida,
        adicionales: Object.entries(extras).map(([planta_id, cantidad]) => ({ planta_id, cantidad })),
        // Se manda siempre, aunque no haya cambiado: el backend refresca
        // `datos_entrega_recibidos_en` y esa fecha es la prueba de que la
        // familia miró estos datos hoy y no hace tres meses.
        entrega,
      })
      if (!r.ok) {
        // Si el enlace se venció mientras llenaba el formulario, no sirve dejarlo
        // reintentando contra una puerta cerrada: se le dice y se cambia de pantalla.
        if (r.error === 'cerrado') { setFase('cerrado'); return }
        // El backend también revisa el núcleo: si llega aquí es que la pantalla
        // dejó pasar algo. Se abre el formulario, o el aviso no tendría dónde
        // resolverse.
        if (r.error === 'entrega_incompleta') {
          setEditandoEntrega(true)
          setEntregaConfirmada(false)
          setError('Nos faltan la dirección, quién recibe y un teléfono para poder llevarla.')
          return
        }
        setError('No pudimos guardar tu elección. Inténtalo de nuevo en un momento.')
        return
      }
      setResultado(r)
      setFase('listo')
    } catch {
      setError('No pudimos guardar tu elección. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const entra = quieto ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 },
                               transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } }

  // ── Cargando ───────────────────────────────────────────────────────────────
  if (fase === 'cargando') return (
    <Marco>
      <div className="flex flex-col items-center justify-center gap-4 py-28">
        <motion.div
          animate={quieto ? {} : { opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}>
          <Ilustracion nombre="rama" vivo tam={60} />
        </motion.div>
        <p className="text-[14px]" style={{ color: MUSGO }}>Un momento…</p>
      </div>
    </Marco>
  )

  // ── Entrada del código ─────────────────────────────────────────────────────
  if (fase === 'entrada') return (
    <Marco>
      <motion.div {...entra} className="pt-16 pb-10">
        <Brota className="mb-7"><Ilustracion nombre="helecho" vivo tam={96} /></Brota>
        <h1 className="vv-titular text-center text-[31px] leading-tight" style={{ color: SELVA }}>
          Elige su planta
        </h1>
        <p className="text-center text-[16px] leading-[1.6] mt-3 mb-8" style={{ color: MUSGO }}>
          Escribe el código que te enviamos por WhatsApp.
        </p>
        <label htmlFor="codigo-planta" className="sr-only">Código del enlace</label>
        <input
          id="codigo-planta"
          value={cInput}
          onChange={e => setCInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && cargar(cInput)}
          placeholder="CÓDIGO"
          autoComplete="off"
          autoCapitalize="characters"
          className="vv-vidrio w-full min-h-[56px] rounded-2xl px-4 text-center text-[18px] font-semibold
                     tracking-[0.28em] transition-colors duration-200 vv-foco vv-suave"
          style={{ color: TINTA }}
        />
        {error && (
          <p role="alert" className="text-[13px] text-center mt-3" style={{ color: '#A33A2A' }}>{error}</p>
        )}
        <div className="mt-5">
          <Boton onClick={() => cargar(cInput)} disabled={!cInput.trim()}>Continuar</Boton>
        </div>
      </motion.div>
      <Firma />
    </Marco>
  )

  // ── Enlace cerrado ─────────────────────────────────────────────────────────
  if (fase === 'cerrado') return (
    <Marco>
      <motion.div {...entra} className="pt-24 pb-6 text-center">
        <div className="flex justify-center mb-6 opacity-70"><Ilustracion nombre="rama" tam={80} /></div>
        <h1 className="vv-titular text-[27px] leading-tight mb-3" style={{ color: SELVA }}>
          Este enlace ya descansó
        </h1>
        <p className="text-[16px] leading-[1.6]" style={{ color: MUSGO }}>
          Escríbenos por WhatsApp y seguimos contigo con mucho gusto.
        </p>
      </motion.div>
      <Firma />
    </Marco>
  )

  // ── Gracias ────────────────────────────────────────────────────────────────
  if (fase === 'listo') {
    const nombre = resultado?.planta || datos?.eleccion?.planta_nombre
    const nuevos = resultado?.extras || []
    return (
      <Marco>
        <motion.div {...entra} className="pt-20 pb-4 text-center">
          {/* La planta elegida crece una vez, ya alimentada. Es el cierre del
              gesto que abrio la pantalla. */}
          <Brota className="mb-7" retraso={120}>
            <Ilustracion nombre={nombre} vivo tam={132} />
          </Brota>
          <h1 className="vv-titular text-[29px] leading-snug" style={{ color: SELVA }}>
            Gracias{nombreCli ? `, ${nombreCli}` : ''}
          </h1>
          {nombre && (
            <p className="text-[17px] leading-[1.55] mt-3" style={{ color: TINTA }}>
              {mascota} seguirá su camino en un <strong style={{ color: SELVA }}>{nombre}</strong>.
            </p>
          )}
          {!!nuevos.length && (
            <div className="vv-vidrio mt-7 rounded-[24px] p-4 text-left">
              <p className="vv-titular text-[17px] mb-2.5" style={{ color: SELVA }}>Agregaste</p>
              {nuevos.map((x, i) => (
                <div key={i} className="flex justify-between gap-3 text-[14px] py-0.5">
                  <span style={{ color: TINTA }}>{x.cantidad} × {x.nombre}</span>
                  <span className="font-bold tabular-nums" style={{ color: MIEL }}>{pesos(x.total)}</span>
                </div>
              ))}
              <p className="text-[12px] leading-relaxed mt-3" style={{ color: MUSGO }}>
                Coordinamos el pago contigo en el momento de la entrega.
              </p>
            </div>
          )}
          <p className="text-[14px] leading-relaxed mt-7" style={{ color: MUSGO }}>
            Te escribiremos para coordinar la entrega.
          </p>
        </motion.div>
        <Firma />
      </Marco>
    )
  }

  // ── Formulario ─────────────────────────────────────────────────────────────
  return (
    <Marco>
      <motion.div {...entra} className="pt-14" style={{ paddingBottom: '10.5rem' }}>

        {/* El nombre de la mascota es lo más grande de la pantalla: es de lo
            único que trata. El saludo va DENTRO de la frase y no como rótulo
            en mayúsculas encima — un "HOLA, MARÍA" tracked-out es adorno de
            plantilla, no información. */}
        <header>
          <Brota alinear="flex-start" className="mb-7">
            <Ilustracion nombre="rama" vivo tam={124} />
          </Brota>
          <h1 className="vv-titular text-[33px] leading-[1.07]" style={{ color: SELVA }}>
            El proceso de {mascota} ha terminado
          </h1>
          <p className="text-[16px] leading-[1.62] mt-4" style={{ color: MUSGO }}>
            {nombreCli ? `${nombreCli}, su` : 'Su'} compostaje se completó con todo el cuidado.
            Ahora {mascota} vuelve a la vida en forma de planta, y queremos que seas tú quien
            elija cuál la acompañará.
          </p>
          {datos?.servicio?.cubiculo && (
            <p className="vv-vidrio text-[13px] mt-5 inline-block rounded-full px-3.5 py-1.5"
               style={{ color: MUSGO }}>
              Cubículo {datos.servicio.cubiculo}
            </p>
          )}
        </header>

        {/* ── Elección de especie ── */}
        {yaEligio ? (
          <div className="vv-vidrio mt-10 rounded-[28px] px-4 py-4 flex items-center gap-3.5">
            <Ilustracion nombre={datos?.eleccion?.planta_nombre} vivo tam={44} />
            <p className="text-[14px] leading-relaxed" style={{ color: TINTA }}>
              Ya elegiste <strong style={{ color: SELVA }}>{datos?.eleccion?.planta_nombre}</strong>.
              Si necesitas cambiarla, escríbenos por WhatsApp.
            </p>
          </div>
        ) : (
          <fieldset className="border-0 p-0 m-0 mt-10">
            <legend className="vv-titular text-[23px] leading-tight mb-4" style={{ color: SELVA }}>
              ¿En cuál quieres que siga?
            </legend>
            <div className="space-y-3.5">
              {opciones.map(p => {
                const sel = elegida === p.id
                return (
                  <button key={p.id} type="button" onClick={() => setElegida(p.id)}
                    aria-pressed={sel}
                    className="vv-vidrio w-full text-left rounded-[28px] p-4 flex items-center gap-4
                               cursor-pointer transition-all duration-300 ease-out vv-foco vv-suave"
                    style={{
                      border: `1.5px solid ${sel ? HOJA : 'rgba(255,255,255,0.85)'}`,
                      // La elegida se LEVANTA del vidrio: es la respuesta al toque, no adorno.
                      transform: sel ? 'translateY(-2px)' : 'none',
                      boxShadow: sel
                        ? '0 26px 44px -26px rgba(18,48,33,0.75), inset 0 0 0 3px rgba(88,169,122,0.16)'
                        : '0 18px 40px -30px rgba(18,48,33,0.5)',
                    }}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt={`Fotografía de ${p.nombre}`} loading="lazy"
                             className="w-[68px] h-[88px] rounded-2xl object-cover shrink-0" />
                      : <div className="shrink-0"><Ilustracion nombre={p.nombre} vivo={sel} tam={68} /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="vv-titular text-[21px] leading-tight" style={{ color: sel ? SELVA : TINTA }}>
                        {p.nombre}
                      </div>
                      {p.descripcion && (
                        <p className="text-[13px] leading-snug mt-1.5" style={{ color: MUSGO }}>{p.descripcion}</p>
                      )}
                      {/* El estado no depende solo del color */}
                      <p className="text-[13px] font-semibold mt-2" style={{ color: sel ? BROTE : MUSGO }}>
                        {sel ? 'Elegida' : 'Tocar para elegir'}
                      </p>
                    </div>
                  </button>
                )
              })}
              {!opciones.length && (
                <p className="text-[14px] leading-relaxed" style={{ color: MUSGO }}>
                  Estamos preparando las opciones. Escríbenos por WhatsApp y te ayudamos.
                </p>
              )}
            </div>
          </fieldset>
        )}

        {/* ── Extras ya comprados ── */}
        {!!comprados.length && (
          <div className="vv-vidrio mt-8 rounded-[24px] p-4">
            <p className="vv-titular text-[17px] mb-2" style={{ color: SELVA }}>Ya agregaste</p>
            {comprados.map(x => (
              <div key={x.planta_id} className="flex justify-between gap-3 text-[14px] py-0.5">
                <span style={{ color: TINTA }}>{x.cantidad} × {x.nombre}</span>
                <span className="tabular-nums" style={{ color: MUSGO }}>{pesos(x.total)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Extras disponibles ── */}
        {!!disponibles.length && (
          <section className="mt-10">
            <h2 className="vv-titular text-[23px]" style={{ color: SELVA }}>¿Deseas algo más?</h2>
            <p className="text-[13px] leading-relaxed mt-1.5 mb-4" style={{ color: MUSGO }}>
              Es opcional. Si eliges algo, lo coordinamos contigo en la entrega.
            </p>
            <div className="space-y-3.5">
              {disponibles.map(p => {
                const n = extras[p.id] || 0
                return (
                  <div key={p.id} className="vv-vidrio rounded-[28px] p-4 transition-all duration-300 ease-out"
                    style={{
                      border: `1.5px solid ${n > 0 ? HOJA : 'rgba(255,255,255,0.85)'}`,
                      boxShadow: n > 0
                        ? '0 26px 44px -26px rgba(18,48,33,0.7)'
                        : '0 18px 40px -30px rgba(18,48,33,0.5)',
                    }}>
                    <div className="flex items-center gap-4">
                      {p.imagen_url
                        ? <img src={p.imagen_url} alt={`Fotografía de ${p.nombre}`} loading="lazy"
                               className="w-14 h-14 rounded-2xl object-cover shrink-0" />
                        : <div className="shrink-0"><Ilustracion nombre={p.nombre} vivo={n > 0} tam={52} /></div>}
                      <div className="min-w-0 flex-1">
                        <div className="vv-titular text-[17px] leading-tight" style={{ color: TINTA }}>{p.nombre}</div>
                        {p.descripcion && (
                          <p className="text-[13px] leading-snug mt-1" style={{ color: MUSGO }}>{p.descripcion}</p>
                        )}
                        {/* El precio real es el de la derecha. El tachado es el precio
                            de lista del catálogo (`precio_antes`, migración 158): el
                            backend solo lo manda cuando de verdad es mayor. Se escribe
                            "antes" con todas sus letras porque un tachado a secas no
                            se oye en un lector de pantalla. */}
                        <div className="flex items-baseline gap-2 flex-wrap mt-1.5">
                          <span className="text-[15px] font-bold tabular-nums" style={{ color: MIEL }}>
                            {pesos(p.precio)}
                          </span>
                          {p.precio_antes > 0 && (
                            <span className="text-[13px] tabular-nums" style={{ color: MUSGO }}>
                              antes <s>{pesos(p.precio_antes)}</s>
                            </span>
                          )}
                        </div>
                        {p.precio_antes > 0 && (
                          <p className="text-[11.5px] font-semibold leading-snug mt-1" style={{ color: BROTE }}>
                            Precio especial por tu plan de compostaje
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Controles de 44px: por debajo de eso el dedo falla */}
                    <div className="flex items-center justify-end gap-2 mt-3">
                      <button type="button" onClick={() => cambiarExtra(p.id, -1)} disabled={!n}
                        aria-label={`Quitar una unidad de ${p.nombre}`}
                        className="w-11 h-11 rounded-full flex items-center justify-center cursor-pointer
                                   transition-colors duration-200 vv-foco vv-suave
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ border: `1.5px solid ${LINDE}`, color: TINTA, background: CAMPO }}>
                        <svg width="14" height="2" viewBox="0 0 14 2" aria-hidden="true">
                          <rect width="14" height="2" rx="1" fill="currentColor" />
                        </svg>
                      </button>
                      <span className="w-8 text-center text-[17px] font-bold tabular-nums"
                            aria-live="polite" style={{ color: n > 0 ? SELVA : '#B3AB9C' }}>{n}</span>
                      <button type="button" onClick={() => cambiarExtra(p.id, 1)}
                        aria-label={`Agregar una unidad de ${p.nombre}`}
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white cursor-pointer
                                   transition-transform duration-200 active:scale-95 vv-foco vv-suave"
                        style={{ background: BROTE }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                          <path d="M7 0.8v12.4M0.8 7h12.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Entrega ── */}
        <section className="mt-10">
          <h2 className="vv-titular text-[23px]" style={{ color: SELVA }}>¿A dónde la llevamos?</h2>

          {!editandoEntrega ? (
            <>
              <p className="text-[13px] leading-relaxed mt-1.5 mb-4" style={{ color: MUSGO }}>
                Estos son los datos que nos dejaste. Confírmanos si siguen estando bien.
              </p>
              <div className="vv-vidrio rounded-[28px] p-4"
                   style={{ border: `1.5px solid ${entregaConfirmada ? HOJA : 'rgba(255,255,255,0.85)'}` }}>
                <DatoEntrega etiqueta="Dirección" valor={entrega.direccion} />
                {(entrega.barrio || entrega.localidad) &&
                  <DatoEntrega etiqueta="Barrio / localidad" valor={[entrega.barrio, entrega.localidad].filter(Boolean).join(' · ')} />}
                <DatoEntrega etiqueta="Quién recibe" valor={entrega.recibe} />
                <DatoEntrega etiqueta="Teléfono" valor={[entrega.telefono, entrega.telefono_adicional].filter(Boolean).join(' · ')} />
                {entrega.horarios && <DatoEntrega etiqueta="Horarios" valor={entrega.horarios} />}
              </div>
              <div className="flex gap-2.5 mt-3.5">
                <button type="button" onClick={() => setEntregaConfirmada(true)}
                  aria-pressed={entregaConfirmada}
                  className="flex-1 min-h-[48px] rounded-full px-4 text-[14px] font-semibold cursor-pointer
                             transition-all duration-200 ease-out vv-foco vv-suave"
                  style={entregaConfirmada
                    ? { background: BROTE, color: '#FFFFFF', border: `1.5px solid ${BROTE}` }
                    : { background: 'rgba(255,255,255,0.72)', color: SELVA, border: `1.5px solid ${LINDE}` }}>
                  {entregaConfirmada ? 'Datos confirmados' : 'Sí, están bien'}
                </button>
                <button type="button"
                  onClick={() => { setEditandoEntrega(true); setEntregaConfirmada(false) }}
                  className="flex-1 min-h-[48px] rounded-full px-4 text-[14px] font-semibold cursor-pointer
                             transition-all duration-200 ease-out vv-foco vv-suave"
                  style={{ background: 'rgba(255,255,255,0.45)', color: TINTA, border: `1.5px solid ${LINDE}` }}>
                  Cambiaron
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed mt-1.5 mb-4" style={{ color: MUSGO }}>
                Para poder llevarte a {mascota} necesitamos saber dónde y con quién dejarla.
              </p>
              <div className="vv-vidrio rounded-[28px] p-4 space-y-3.5">
                <CampoEntrega campo="direccion" label="Dirección" requerido value={entrega.direccion}
                  onChange={v => setE('direccion', v)} placeholder="Calle, carrera, conjunto, apto…" />
                <div className="grid grid-cols-2 gap-3">
                  <CampoEntrega campo="barrio" label="Barrio" value={entrega.barrio}
                    onChange={v => setE('barrio', v)} placeholder="Barrio / sector" />
                  <CampoLocalidad value={entrega.localidad} onChange={v => setE('localidad', v)} />
                </div>
                <CampoEntrega campo="recibe" label="¿Quién recibe?" requerido value={entrega.recibe}
                  onChange={v => setE('recibe', v)} placeholder="Nombre de quien recibe" />
                <div className="grid grid-cols-2 gap-3">
                  <CampoEntrega campo="telefono" label="Teléfono" requerido value={entrega.telefono}
                    onChange={v => setE('telefono', v)} placeholder="Celular" inputMode="tel" />
                  <CampoEntrega campo="telefono_adicional" label="Otro teléfono" value={entrega.telefono_adicional}
                    onChange={v => setE('telefono_adicional', v)} placeholder="Opcional" inputMode="tel" />
                </div>
                <CampoEntrega campo="horarios" label="Horarios en que hay alguien" value={entrega.horarios}
                  onChange={v => setE('horarios', v)} placeholder="Ej.: entre semana después de las 5 p. m." />
                <p className="text-[12px] leading-relaxed" style={{ color: MUSGO }}>
                  Nos ayuda a coordinar mejor. Ten en cuenta que <strong>no confirmamos una hora
                  exacta</strong>; te avisaremos cuando vayamos en camino.
                </p>
              </div>
            </>
          )}
        </section>

        {error && (
          <p role="alert" className="text-[13px] mt-6 text-center" style={{ color: '#A33A2A' }}>{error}</p>
        )}
      </motion.div>

      {/* ── Barra de envío ── */}
      <div className="vv-vidrio vv-vidrio-hondo fixed left-0 right-0 bottom-0 z-20 px-5 pt-3.5"
           style={{ borderRadius: '28px 28px 0 0', borderBottom: 'none',
                    boxShadow: '0 -18px 40px -30px rgba(18,48,33,0.6)',
                    paddingBottom: 'calc(0.95rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto w-full max-w-[30rem]">
          {totalExtras > 0 && (
            <div className="flex justify-between items-baseline text-[14px] mb-2.5 px-1">
              <span style={{ color: MUSGO }}>Adicionales</span>
              <span className="text-[17px] font-bold tabular-nums" style={{ color: MIEL }}>{pesos(totalExtras)}</span>
            </div>
          )}
          <Boton onClick={enviar} disabled={!puedeEnviar || enviando} aria-busy={enviando}>
            {enviando
              ? 'Enviando…'
              : (yaEligio ? 'Agregar a mi entrega' : 'Confirmar mi elección')}
          </Boton>
          {!puedeEnviar && !enviando && pista && (
            <p className="text-[12px] text-center mt-2.5" style={{ color: MUSGO }}>{pista}</p>
          )}
        </div>
      </div>
    </Marco>
  )
}
