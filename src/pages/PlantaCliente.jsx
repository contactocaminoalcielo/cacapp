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
import { Ilustracion, ESTILOS, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, VERDE, VIVO, BORDE, ORO } from '@/components/portal/Botanica'

// La paleta y las ilustraciones viven en components/portal/Botanica.jsx: las
// comparte con el portal de fotos.

const pesos = v => `$${Number(v || 0).toLocaleString('es-CO')}`

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
  const puedeEnviar = yaEligio ? hayExtras : !!elegida

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
      })
      if (!r.ok) {
        // Si el enlace se venció mientras llenaba el formulario, no sirve dejarlo
        // reintentando contra una puerta cerrada: se le dice y se cambia de pantalla.
        if (r.error === 'cerrado') { setFase('cerrado'); return }
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
          <Ilustracion nombre="rama" vivo tam={56} />
        </motion.div>
        <p className="text-[14px]" style={{ color: APAGADO }}>Un momento…</p>
      </div>
    </Marco>
  )

  // ── Entrada del código ─────────────────────────────────────────────────────
  if (fase === 'entrada') return (
    <Marco>
      <motion.div {...entra} className="pt-16 pb-10">
        <div className="flex justify-center mb-6"><Ilustracion nombre="helecho" vivo tam={80} /></div>
        <h1 className="font-serif italic text-center text-[30px] leading-tight" style={{ color: HONDO }}>
          Elige su planta
        </h1>
        <p className="text-center text-[15px] leading-relaxed mt-3 mb-8" style={{ color: APAGADO }}>
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
          className="w-full min-h-[56px] rounded-2xl px-4 text-center text-[18px] font-bold tracking-[0.28em]
                     transition-colors duration-200 cac-foco cac-suave"
          style={{ background: '#FFFFFF', border: `1.5px solid ${BORDE}`, color: TINTA }}
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
        <div className="flex justify-center mb-6 opacity-70"><Ilustracion nombre="rama" tam={72} /></div>
        <h1 className="font-serif italic text-[26px] leading-tight mb-3" style={{ color: HONDO }}>
          Este enlace ya descansó
        </h1>
        <p className="text-[15px] leading-relaxed" style={{ color: APAGADO }}>
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
          <motion.div className="flex justify-center mb-7"
            initial={quieto ? false : { scale: 0.86, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}>
            <Ilustracion nombre={nombre} vivo tam={116} />
          </motion.div>
          <h1 className="font-serif italic text-[28px] leading-snug" style={{ color: HONDO }}>
            Gracias{nombreCli ? `, ${nombreCli}` : ''}
          </h1>
          {nombre && (
            <p className="text-[16px] leading-relaxed mt-3" style={{ color: TINTA }}>
              {mascota} seguirá su camino en un <strong style={{ color: HONDO }}>{nombre}</strong>.
            </p>
          )}
          {!!nuevos.length && (
            <div className="mt-7 rounded-2xl p-4 text-left"
                 style={{ background: '#FFFFFF', border: `1px solid ${BORDE}` }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2.5" style={{ color: APAGADO }}>
                Agregaste
              </p>
              {nuevos.map((x, i) => (
                <div key={i} className="flex justify-between gap-3 text-[14px] py-0.5">
                  <span style={{ color: TINTA }}>{x.cantidad} × {x.nombre}</span>
                  <span className="font-bold tabular-nums" style={{ color: ORO }}>{pesos(x.total)}</span>
                </div>
              ))}
              <p className="text-[12px] leading-relaxed mt-3" style={{ color: APAGADO }}>
                Coordinamos el pago contigo en el momento de la entrega.
              </p>
            </div>
          )}
          <p className="text-[14px] leading-relaxed mt-7" style={{ color: APAGADO }}>
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

        <header className="text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: APAGADO }}>
            {nombreCli ? `Hola, ${nombreCli}` : 'Hola'}
          </p>
          <h1 className="font-serif italic text-[30px] leading-[1.15] mt-3" style={{ color: HONDO }}>
            El proceso de {mascota} ha terminado
          </h1>
          <p className="text-[15px] leading-relaxed mt-4" style={{ color: APAGADO }}>
            Su compostaje se completó con todo el cuidado. Ahora {mascota} vuelve a la
            vida en forma de planta, y queremos que seas tú quien elija cuál la acompañará.
          </p>
          {datos?.servicio?.cubiculo && (
            <p className="text-[12px] mt-4 inline-block rounded-full px-3 py-1.5"
               style={{ background: '#FFFFFF', border: `1px solid ${BORDE}`, color: APAGADO }}>
              Cubículo {datos.servicio.cubiculo}
            </p>
          )}
        </header>

        <div className="my-9 flex items-center justify-center gap-3" aria-hidden="true">
          <span className="h-px w-14" style={{ background: BORDE }} />
          <Ilustracion nombre="rama" tam={18} />
          <span className="h-px w-14" style={{ background: BORDE }} />
        </div>

        {/* ── Elección de especie ── */}
        {yaEligio ? (
          <div className="rounded-2xl px-4 py-4 flex items-center gap-3.5"
               style={{ background: '#FFFFFF', border: `1px solid ${BORDE}` }}>
            <Ilustracion nombre={datos?.eleccion?.planta_nombre} vivo tam={44} />
            <p className="text-[14px] leading-relaxed" style={{ color: TINTA }}>
              Ya elegiste <strong style={{ color: HONDO }}>{datos?.eleccion?.planta_nombre}</strong>.
              Si necesitas cambiarla, escríbenos por WhatsApp.
            </p>
          </div>
        ) : (
          <fieldset className="border-0 p-0 m-0">
            <legend className="text-[12px] font-bold uppercase tracking-[0.16em] mb-4" style={{ color: APAGADO }}>
              Elige la planta
            </legend>
            <div className="space-y-3.5">
              {opciones.map(p => {
                const sel = elegida === p.id
                return (
                  <button key={p.id} type="button" onClick={() => setElegida(p.id)}
                    aria-pressed={sel}
                    className="w-full text-left rounded-3xl p-4 flex items-center gap-4 cursor-pointer
                               transition-all duration-200 ease-out cac-foco cac-suave"
                    style={{
                      background: '#FFFFFF',
                      border: `1.5px solid ${sel ? VIVO : BORDE}`,
                      boxShadow: sel
                        ? '0 12px 28px -14px rgba(47,93,69,0.5), inset 0 0 0 3px rgba(78,155,110,0.13)'
                        : '0 2px 10px -8px rgba(42,38,32,0.4)',
                    }}>
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt={`Fotografía de ${p.nombre}`} loading="lazy"
                             className="w-[68px] h-[88px] rounded-2xl object-cover shrink-0" />
                      : <div className="shrink-0"><Ilustracion nombre={p.nombre} vivo={sel} tam={68} /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="font-serif text-[19px] leading-tight" style={{ color: sel ? HONDO : TINTA }}>
                        {p.nombre}
                      </div>
                      {p.descripcion && (
                        <p className="text-[13px] leading-snug mt-1.5" style={{ color: APAGADO }}>{p.descripcion}</p>
                      )}
                      {/* El estado no depende solo del color */}
                      <p className="text-[12px] font-bold mt-2" style={{ color: sel ? VERDE : '#9A9284' }}>
                        {sel ? 'Elegida' : 'Tocar para elegir'}
                      </p>
                    </div>
                  </button>
                )
              })}
              {!opciones.length && (
                <p className="text-[14px] leading-relaxed" style={{ color: APAGADO }}>
                  Estamos preparando las opciones. Escríbenos por WhatsApp y te ayudamos.
                </p>
              )}
            </div>
          </fieldset>
        )}

        {/* ── Extras ya comprados ── */}
        {!!comprados.length && (
          <div className="mt-8 rounded-2xl p-4" style={{ background: '#FFFFFF', border: `1px solid ${BORDE}` }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: APAGADO }}>
              Ya agregaste
            </p>
            {comprados.map(x => (
              <div key={x.planta_id} className="flex justify-between gap-3 text-[14px] py-0.5">
                <span style={{ color: TINTA }}>{x.cantidad} × {x.nombre}</span>
                <span className="tabular-nums" style={{ color: APAGADO }}>{pesos(x.total)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Extras disponibles ── */}
        {!!disponibles.length && (
          <section className="mt-10">
            <h2 className="font-serif italic text-[21px]" style={{ color: HONDO }}>¿Deseas algo más?</h2>
            <p className="text-[13px] leading-relaxed mt-1.5 mb-4" style={{ color: APAGADO }}>
              Es opcional. Si eliges algo, lo coordinamos contigo en la entrega.
            </p>
            <div className="space-y-3.5">
              {disponibles.map(p => {
                const n = extras[p.id] || 0
                return (
                  <div key={p.id} className="rounded-3xl p-4 transition-all duration-200 ease-out"
                    style={{
                      background: '#FFFFFF',
                      border: `1.5px solid ${n > 0 ? VIVO : BORDE}`,
                      boxShadow: n > 0
                        ? '0 12px 28px -14px rgba(47,93,69,0.45)'
                        : '0 2px 10px -8px rgba(42,38,32,0.4)',
                    }}>
                    <div className="flex items-center gap-4">
                      {p.imagen_url
                        ? <img src={p.imagen_url} alt={`Fotografía de ${p.nombre}`} loading="lazy"
                               className="w-14 h-14 rounded-2xl object-cover shrink-0" />
                        : <div className="shrink-0"><Ilustracion nombre={p.nombre} vivo={n > 0} tam={52} /></div>}
                      <div className="min-w-0 flex-1">
                        <div className="font-serif text-[17px] leading-tight" style={{ color: TINTA }}>{p.nombre}</div>
                        {p.descripcion && (
                          <p className="text-[13px] leading-snug mt-1" style={{ color: APAGADO }}>{p.descripcion}</p>
                        )}
                        {/* El precio real es el de la derecha. El tachado es el precio
                            de lista del catálogo (`precio_antes`, migración 158): el
                            backend solo lo manda cuando de verdad es mayor. Se escribe
                            "antes" con todas sus letras porque un tachado a secas no
                            se oye en un lector de pantalla. */}
                        <div className="flex items-baseline gap-2 flex-wrap mt-1.5">
                          <span className="text-[15px] font-bold tabular-nums" style={{ color: ORO }}>
                            {pesos(p.precio)}
                          </span>
                          {p.precio_antes > 0 && (
                            <span className="text-[13px] tabular-nums" style={{ color: APAGADO }}>
                              antes <s>{pesos(p.precio_antes)}</s>
                            </span>
                          )}
                        </div>
                        {p.precio_antes > 0 && (
                          <p className="text-[11.5px] font-semibold leading-snug mt-1" style={{ color: VERDE }}>
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
                                   transition-colors duration-200 cac-foco cac-suave
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ border: `1.5px solid ${BORDE}`, color: TINTA, background: PAPEL }}>
                        <svg width="14" height="2" viewBox="0 0 14 2" aria-hidden="true">
                          <rect width="14" height="2" rx="1" fill="currentColor" />
                        </svg>
                      </button>
                      <span className="w-8 text-center text-[17px] font-bold tabular-nums"
                            aria-live="polite" style={{ color: n > 0 ? HONDO : '#B3AB9C' }}>{n}</span>
                      <button type="button" onClick={() => cambiarExtra(p.id, 1)}
                        aria-label={`Agregar una unidad de ${p.nombre}`}
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white cursor-pointer
                                   transition-transform duration-200 active:scale-95 cac-foco cac-suave"
                        style={{ background: VERDE }}>
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

        {error && (
          <p role="alert" className="text-[13px] mt-6 text-center" style={{ color: '#A33A2A' }}>{error}</p>
        )}
      </motion.div>

      {/* ── Barra de envío ── */}
      <div className="fixed left-0 right-0 bottom-0 z-20 px-5 pt-3"
           style={{ background: `linear-gradient(to top, ${PAPEL2} 78%, rgba(241,240,230,0))`,
                    paddingBottom: 'calc(0.85rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto w-full max-w-[30rem]">
          {totalExtras > 0 && (
            <div className="flex justify-between items-baseline text-[14px] mb-2.5 px-1">
              <span style={{ color: APAGADO }}>Adicionales</span>
              <span className="text-[17px] font-bold tabular-nums" style={{ color: ORO }}>{pesos(totalExtras)}</span>
            </div>
          )}
          <Boton onClick={enviar} disabled={!puedeEnviar || enviando} aria-busy={enviando}>
            {enviando
              ? 'Enviando…'
              : (yaEligio ? 'Agregar a mi entrega' : 'Confirmar mi elección')}
          </Boton>
          {!puedeEnviar && !enviando && !yaEligio && (
            <p className="text-[12px] text-center mt-2.5" style={{ color: APAGADO }}>
              Elige una planta para continuar
            </p>
          )}
        </div>
      </div>
    </Marco>
  )
}
