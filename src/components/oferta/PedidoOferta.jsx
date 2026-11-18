// Pedido de RECORDATORIOS ADICIONALES o de una CÉDULA dentro del portal de la
// oferta posterior (migr. 210).
//
// Es el mismo recorrido del catálogo público (productos → personalizar → entrega
// → pago), con tres diferencias:
//   · Los precios traen el descuento de la oferta (el backend los vuelve a
//     calcular al crear la compra: lo de aquí es informativo).
//   · La familia ya es cliente: no se le vuelven a pedir sus datos.
//   · RECORDATORIOS son de la mascotica del servicio; la CÉDULA es para una
//     mascotica VIVA de la familia, así que ahí sí se piden sus datos.
//
// La compra cae en Compras de recordatorios y en el Tablero de Producción como
// «COMPRA ADICIONAL – RECORDATORIO» (o «– CÉDULA»).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ofertaBorrador, ofertaComprar, ofertaEvento, mensajeDeError } from '@/lib/ofertaPortal'
import { subirArchivoCompra } from '@/lib/catalogoPublico'
import { fmt } from '@/lib/utils'
import { Ilustracion, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, VERDE, BORDE, ORO } from '@/components/portal/Botanica'
import CasillaDatos from '@/components/CasillaDatos'
import { VERSION as POLITICA_VERSION } from '@/lib/privacidad'
import {
  Marco, Campo, Tarjeta, Opciones, Precio, Etiqueta, AvisoError, Encabezado, Pasos,
  INPUT, METODO_LABEL, VERDE_SUAVE,
} from './comunes'
import { Camera, Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, Send, Clock, Truck, FileText } from 'lucide-react'

const NOMBRE_PASO = { productos: 'Productos', mascota: 'Tu mascotica', personalizar: 'Personalizar', entrega: 'Entrega', pago: 'Pago' }

/** ¿Una línea tiene todo lo que pide su producto (fotos + textos)? */
function lineaCompleta(p, datos) {
  if (p.fotos > 0 && (datos?.fotos || []).filter(Boolean).length < p.fotos) return false
  for (const c of p.campos_texto || []) {
    const arr = datos?.textos?.[c.label] || []
    if (arr.filter(v => v && String(v).trim()).length < (c.cantidad || 1)) return false
  }
  return true
}

export default function PedidoOferta({ codigo, oferta, categoria, onVolver }) {
  const esCedula = categoria === 'CEDULAS'
  const productos = (esCedula ? oferta.cedulas : oferta.recordatorios) || []
  const descuento = oferta.descuentos?.[categoria] || 0

  const [paso, setPaso]       = useState('productos')
  const [carrito, setCarrito] = useState({})            // { id: cantidad }
  const [lineas, setLineas]   = useState({})            // { id: { fotos:[url], textos:{label:[...]}, notas } }
  const [masc, setMasc]       = useState({ nombre: '', especie_id: '', sexo: '', raza: '', fecha_nacimiento: '' })
  const [entrega, setEntrega] = useState({ direccion: '', ciudad: 'Bogotá', barrio: '', recibe: '', telefono: '', indicaciones: '' })
  const [obs, setObs]         = useState('')
  const [pago, setPago]       = useState({ modo: '', metodo: '', comprobante_url: '' })
  const [autorizo, setAutorizo] = useState(false)
  const [errAutorizo, setErrAutorizo] = useState(null)
  const [borrador, setBorrador] = useState(null)
  const [subiendo, setSubiendo] = useState({})          // { clave: true }
  const [error, setError]     = useState('')
  const [errores, setErrores] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const arriba = useRef(null)
  const avisoFormulario = useRef(false)

  // Abrir la sección ya es interés: queda como oportunidad para el equipo.
  useEffect(() => { ofertaEvento(codigo, { categoria, paso: 'INTERESADO' }) }, [codigo, categoria])

  const elegidos = useMemo(() => productos.filter(p => carrito[p.id] > 0), [productos, carrito])
  const hayFisico = elegidos.some(p => p.fisico)
  const subtotal = elegidos.reduce((a, p) => a + p.precio * carrito[p.id], 0)
  const ahorro = elegidos.reduce((a, p) => a + (p.precio_lista - p.precio) * carrito[p.id], 0)
  const envio = hayFisico ? (oferta.valor_envio || 0) : 0
  const total = subtotal + envio
  const pasos = ['productos', ...(esCedula ? ['mascota'] : []), 'personalizar', ...(hayFisico ? ['entrega'] : []), 'pago']
  const nombreMascota = esCedula ? (masc.nombre.trim() || 'tu mascotica') : oferta.mascota

  function irA(p) { setPaso(p); setError(''); arriba.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  function cambiarCantidad(id, d) {
    setCarrito(c => {
      const n = Math.max(0, Math.min(20, (c[id] || 0) + d))
      const out = { ...c }
      if (n) out[id] = n; else delete out[id]
      return out
    })
  }

  async function asegurarBorrador() {
    if (borrador) return borrador
    const r = await ofertaBorrador(codigo)
    if (r.status !== 200 || !r.borrador) throw new Error(mensajeDeError(r, 'No se pudo preparar el pedido. Intenta de nuevo.'))
    setBorrador(r.borrador)
    return r.borrador
  }

  async function subirFoto(prodId, idx, file) {
    if (!file) return
    const clave = `${prodId}:${idx}`
    setSubiendo(s => ({ ...s, [clave]: true })); setError('')
    try {
      const b = await asegurarBorrador()
      const url = await subirArchivoCompra(b, file)
      setLineas(l => {
        const fotos = [...(l[prodId]?.fotos || [])]
        fotos[idx] = url
        return { ...l, [prodId]: { ...l[prodId], fotos } }
      })
    } catch (e) { setError(e.message) }
    finally { setSubiendo(s => { const o = { ...s }; delete o[clave]; return o }) }
  }

  async function subirComprobante(file) {
    if (!file) return
    setSubiendo(s => ({ ...s, comprobante: true })); setError('')
    try {
      const b = await asegurarBorrador()
      const url = await subirArchivoCompra(b, file, { permitirPdf: true })
      setPago(p => ({ ...p, comprobante_url: url }))
    } catch (e) { setError(e.message) }
    finally { setSubiendo(s => { const o = { ...s }; delete o.comprobante; return o }) }
  }

  function setTexto(prodId, label, i, v) {
    setLineas(l => {
      const textos = { ...(l[prodId]?.textos || {}) }
      const arr = [...(textos[label] || [])]
      arr[i] = v
      textos[label] = arr
      return { ...l, [prodId]: { ...l[prodId], textos } }
    })
  }

  function validar(p) {
    const e = {}
    if (p === 'productos' && !elegidos.length) return esCedula ? 'Escoge la cédula que deseas.' : 'Escoge al menos un recordatorio.'
    if (p === 'mascota') {
      if (!masc.nombre.trim()) e.masc_nombre = 'Escribe el nombre de tu mascotica'
      if (!masc.especie_id) e.especie = 'Escoge la especie'
      if (!masc.sexo) e.sexo = 'Indica si es macho o hembra'
    }
    if (p === 'personalizar') {
      const falta = elegidos.find(x => !lineaCompleta(x, lineas[x.id]))
      if (falta) return `Falta completar «${falta.nombre}»: revisa sus fotos y textos.`
    }
    if (p === 'entrega') {
      if (!entrega.recibe.trim()) e.recibe = 'Escribe quién recibe'
      if (entrega.telefono.replace(/\D/g, '').length < 7) e.telefono = 'Escribe un número de contacto'
      if (!entrega.direccion.trim()) e.direccion = 'Escribe la dirección completa'
      if (!entrega.ciudad.trim()) e.ciudad = 'Escribe la localidad o el municipio'
    }
    setErrores(e)
    return Object.keys(e).length ? 'Revisa los campos marcados.' : ''
  }

  function siguiente() {
    const msg = validar(paso)
    if (msg) { setError(msg); return }
    // Pasar de los productos al formulario: «formulario iniciado» (una sola vez).
    if (paso === 'productos' && !avisoFormulario.current) {
      avisoFormulario.current = true
      ofertaEvento(codigo, { categoria, paso: 'FORMULARIO_INICIADO' })
    }
    irA(pasos[pasos.indexOf(paso) + 1])
  }
  function atras() {
    const i = pasos.indexOf(paso)
    if (i > 0) irA(pasos[i - 1])
  }

  async function enviar() {
    if (!pago.modo) { setError('Escoge cómo vas a pagar.'); return }
    if (pago.modo === 'COMPROBANTE' && (!pago.metodo || !pago.comprobante_url)) { setError('Escoge el medio de pago y adjunta el comprobante.'); return }
    if (!autorizo) { setErrAutorizo('Necesitamos tu autorización para tratar tus datos y atender el pedido.'); return }
    setEnviando(true); setError('')
    try {
      const b = await asegurarBorrador()
      const r = await ofertaComprar(codigo, {
        categoria, borrador: b,
        autorizacion: { aceptada: true, politica_version: POLITICA_VERSION },
        mascota: esCedula ? masc : undefined,
        items: elegidos.map(p => ({
          recordatorio_id: p.id, cantidad: carrito[p.id],
          imagenes_urls: (lineas[p.id]?.fotos || []).filter(Boolean),
          datos_cliente: lineas[p.id]?.textos || null,
          notas: lineas[p.id]?.notas || null,
        })),
        entrega: hayFisico ? entrega : null,
        observaciones: obs,
        pago: pago.modo === 'DESPUES' ? { modo: 'DESPUES' } : pago,
      })
      if ((r.status === 200 || r.status === 201) && r.ok) {
        setResultado(r); window.scrollTo({ top: 0 })
        return
      }
      setError(mensajeDeError(r, 'No se pudo enviar el pedido. Intenta de nuevo.'))
    } catch (e) {
      setError(e.message || 'Hubo un problema de conexión. Revisa tu internet e intenta de nuevo.')
    } finally { setEnviando(false) }
  }

  // ── Sin productos / éxito ────────────────────────────────────────────────
  if (!productos.length) return (
    <Marco>
      <Encabezado onVolver={onVolver} titulo={esCedula ? 'Cédulas para mascotas' : 'Recordatorios adicionales'} />
      <div className="text-center py-12 px-6 max-w-md mx-auto">
        <div className="mx-auto w-fit mb-4"><Ilustracion nombre="rama" tam={64} /></div>
        <p className="text-[15px]" style={{ color: TINTA }}>
          {esCedula ? 'Por ahora no tenemos cédulas disponibles en línea.' : 'Por ahora no tenemos recordatorios adicionales disponibles en línea.'}
        </p>
        <p className="text-[14px] mt-2" style={{ color: APAGADO }}>Escríbenos por WhatsApp y con mucho gusto te contamos las opciones.</p>
      </div>
    </Marco>
  )

  if (resultado) return (
    <Marco>
      <div className="text-center py-16 px-6 max-w-md mx-auto">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: VERDE_SUAVE }}>
          <Check size={30} style={{ color: VERDE }} />
        </div>
        <h1 className="text-[22px] font-bold" style={{ color: HONDO }}>¡Recibimos tu pedido!</h1>
        <p className="text-[15px] mt-2" style={{ color: TINTA }}>Pedido <strong>CR-{resultado.numero}</strong> · Total {fmt(resultado.total)}</p>
        <p className="text-[14px] mt-3 leading-relaxed" style={{ color: APAGADO }}>
          {pago.modo === 'DESPUES'
            ? 'Te escribiremos por WhatsApp para coordinar el pago y empezar a elaborarlo con mucho cariño.'
            : 'Vamos a verificar tu pago y empezaremos a elaborarlo con mucho cariño. Te escribiremos por WhatsApp.'}
        </p>
        <button type="button" onClick={onVolver}
          className="cac-foco mt-7 px-5 py-2.5 rounded-xl border text-[13.5px] font-semibold" style={{ borderColor: BORDE, color: TINTA }}>
          Ver las demás opciones
        </button>
        <p className="mt-8 text-[13px]" style={{ color: APAGADO }}>Camino al Cielo 🌿</p>
      </div>
    </Marco>
  )

  // ── Formulario ───────────────────────────────────────────────────────────
  const esUltimo = paso === 'pago'
  return (
    <Marco>
      <Encabezado refArriba={arriba} onVolver={onVolver}
        titulo={esCedula ? 'Cédulas para mascotas' : `Recordatorios de ${oferta.mascota}`}
        subtitulo={esCedula
          ? 'Un documento de identidad para las mascoticas que te acompañan, con un código QR para que te avisen si alguna se pierde.'
          : 'Escoge, personaliza con sus fotos y te lo hacemos llegar. Hechos a mano, con amor.'} />
      {descuento > 0 && (
        <div className="text-center -mt-1 mb-4"><Etiqueta>{descuento}% de descuento especial para ti</Etiqueta></div>
      )}

      <Pasos nombres={pasos.map(p => NOMBRE_PASO[p])} actual={pasos.indexOf(paso)} />

      <div className="px-4 pb-40 max-w-3xl mx-auto w-full space-y-4">
        {/* ── Productos: cada uno con su foto ── */}
        {paso === 'productos' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productos.map(p => {
              const n = carrito[p.id] || 0
              return (
                <div key={p.id} className="rounded-2xl border overflow-hidden flex flex-col transition-all"
                  style={{ background: 'white', borderColor: n ? VERDE : BORDE, boxShadow: n ? `0 0 0 2px ${VERDE}22` : 'none' }}>
                  <div className={`${p.foto_url ? 'aspect-[16/10]' : 'h-24'} flex items-center justify-center`} style={{ background: PAPEL2 }}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre} loading="lazy" className="w-full h-full object-cover" />
                      : <Ilustracion nombre={p.nombre} tam={44} />}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-bold leading-snug" style={{ color: TINTA }}>{p.nombre}</h3>
                      <Precio lista={p.precio_lista} precio={p.precio} />
                    </div>
                    {p.descripcion && <p className="text-[12.5px] mt-1 leading-snug" style={{ color: APAGADO }}>{p.descripcion}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11.5px]" style={{ color: APAGADO }}>
                      {p.tiempo_dias ? <span className="flex items-center gap-1"><Clock size={11} /> Listo en ~{p.tiempo_dias} día{p.tiempo_dias === 1 ? '' : 's'} hábil{p.tiempo_dias === 1 ? '' : 'es'}</span> : null}
                      {p.fotos > 0 && <span className="flex items-center gap-1"><Camera size={11} /> Pide {p.fotos} foto{p.fotos === 1 ? '' : 's'}</span>}
                      {p.fisico ? <span className="flex items-center gap-1"><Truck size={11} /> Con envío</span> : <span>Digital</span>}
                    </div>
                    <div className="mt-auto pt-3 flex items-center justify-end">
                      {n === 0 ? (
                        <button type="button" onClick={() => cambiarCantidad(p.id, 1)}
                          className="cac-foco px-4 py-2 rounded-xl text-[13px] font-bold text-white" style={{ background: VERDE }}>
                          Deseo adquirirlo
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label="Quitar uno" onClick={() => cambiarCantidad(p.id, -1)}
                            className="cac-foco w-9 h-9 rounded-xl border flex items-center justify-center" style={{ borderColor: BORDE }}><Minus size={15} /></button>
                          <span className="w-6 text-center text-[15px] font-bold" style={{ color: TINTA }}>{n}</span>
                          <button type="button" aria-label="Agregar uno" onClick={() => cambiarCantidad(p.id, 1)}
                            className="cac-foco w-9 h-9 rounded-xl border flex items-center justify-center" style={{ borderColor: BORDE }}><Plus size={15} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── La mascotica de la cédula (está viva) ── */}
        {paso === 'mascota' && (
          <Tarjeta className="space-y-3">
            <p className="text-[14px] font-bold" style={{ color: HONDO }}>¿Para quién es la cédula?</p>
            <p className="text-[12.5px] -mt-1" style={{ color: APAGADO }}>
              Cada pedido es para una mascotica. Si quieres cédulas para varias, al terminar puedes hacer otro pedido.
            </p>
            <Campo label="Nombre de la mascotica" error={errores.masc_nombre}>
              <input className={INPUT} style={{ borderColor: BORDE }} value={masc.nombre} onChange={e => setMasc(m => ({ ...m, nombre: e.target.value }))} />
            </Campo>
            <Campo label="Especie" error={errores.especie}>
              <Opciones opciones={(oferta.especies || []).map(es => ({ valor: String(es.id), label: es.nombre }))}
                valor={masc.especie_id} onChange={v => setMasc(m => ({ ...m, especie_id: v }))} />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Género" error={errores.sexo}>
                <Opciones estirar opciones={['Macho', 'Hembra']} valor={masc.sexo} onChange={v => setMasc(m => ({ ...m, sexo: v }))} />
              </Campo>
              <Campo label="Raza" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={masc.raza} onChange={e => setMasc(m => ({ ...m, raza: e.target.value }))} />
              </Campo>
            </div>
            <Campo label="Fecha de nacimiento" opcional ayuda="Si no la sabes exacta, déjala vacía.">
              <input type="date" className={INPUT} style={{ borderColor: BORDE }} value={masc.fecha_nacimiento}
                max={new Date().toISOString().slice(0, 10)} onChange={e => setMasc(m => ({ ...m, fecha_nacimiento: e.target.value }))} />
            </Campo>
            <div className="rounded-xl p-3 text-[12.5px] leading-snug" style={{ background: PAPEL, color: TINTA }}>
              <strong style={{ color: HONDO }}>Código QR:</strong> la cédula lleva un código que, al escanearlo, abre un WhatsApp
              hacia tu número. Así, si tu mascotica se pierde, quien la encuentre puede avisarte al instante.
            </div>
          </Tarjeta>
        )}

        {/* ── Personalizar: lo que pide CADA producto ── */}
        {paso === 'personalizar' && elegidos.map(p => {
          const d = lineas[p.id] || {}
          const completo = lineaCompleta(p, d)
          const nada = p.fotos === 0 && !(p.campos_texto || []).length
          return (
            <Tarjeta key={p.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-bold" style={{ color: HONDO }}>{p.nombre}{carrito[p.id] > 1 ? ` ×${carrito[p.id]}` : ''}</p>
                {completo
                  ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: VERDE_SUAVE, color: VERDE }}><Check size={11} /> Listo</span>
                  : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FBEFD9', color: ORO }}>Falta completar</span>}
              </div>
              {nada && <p className="text-[13px]" style={{ color: APAGADO }}>No necesita fotos ni textos: lo personalizamos con el nombre de {nombreMascota}.</p>}
              {p.fotos > 0 && (
                <div>
                  <p className="text-[12.5px] font-semibold mb-2" style={{ color: TINTA }}>
                    Sube {p.fotos} foto{p.fotos === 1 ? '' : 's'} de {nombreMascota}
                    {carrito[p.id] > 1 && <span className="font-normal" style={{ color: APAGADO }}> (sirven para las {carrito[p.id]} unidades)</span>}
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {Array.from({ length: p.fotos }).map((_, i) => {
                      const url = d.fotos?.[i]
                      const cargando = subiendo[`${p.id}:${i}`]
                      return (
                        <label key={i} className="cac-foco relative aspect-square rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden"
                          style={{ borderColor: url ? VERDE : BORDE, background: PAPEL }}>
                          {url ? <img src={url} alt="" className="w-full h-full object-cover" />
                            : cargando ? <Loader2 size={20} className="animate-spin" style={{ color: VERDE }} />
                            : <span className="flex flex-col items-center gap-1 text-[11px]" style={{ color: APAGADO }}><Camera size={18} /> Foto {i + 1}</span>}
                          <input type="file" accept="image/*" className="sr-only" disabled={!!cargando}
                            onChange={e => { subirFoto(p.id, i, e.target.files?.[0]); e.target.value = '' }} />
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              {(p.campos_texto || []).map(c => (
                <div key={c.label} className="space-y-2">
                  {Array.from({ length: c.cantidad || 1 }).map((_, i) => (
                    <Campo key={i} label={(c.cantidad || 1) > 1 ? `${c.label} ${i + 1}` : c.label}>
                      <input className={INPUT} style={{ borderColor: BORDE }} value={d.textos?.[c.label]?.[i] || ''}
                        onChange={e => setTexto(p.id, c.label, i, e.target.value)} />
                    </Campo>
                  ))}
                </div>
              ))}
              <Campo label="Algo más que debamos saber para elaborarlo" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={d.notas || ''}
                  onChange={e => setLineas(l => ({ ...l, [p.id]: { ...l[p.id], notas: e.target.value } }))} />
              </Campo>
            </Tarjeta>
          )
        })}

        {/* ── Entrega (solo con algo físico) ── */}
        {paso === 'entrega' && (
          <Tarjeta className="space-y-3">
            <p className="text-[14px] font-bold" style={{ color: HONDO }}>¿A dónde te lo enviamos?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Nombre de quien recibe" error={errores.recibe}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.recibe} onChange={e => setEntrega(x => ({ ...x, recibe: e.target.value }))} />
              </Campo>
              <Campo label="Número de contacto" error={errores.telefono}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="tel" value={entrega.telefono} onChange={e => setEntrega(x => ({ ...x, telefono: e.target.value }))} />
              </Campo>
            </div>
            <Campo label="Dirección completa" error={errores.direccion}>
              <input className={INPUT} style={{ borderColor: BORDE }} placeholder="Calle 45 # 12-34, apto 301" value={entrega.direccion} onChange={e => setEntrega(x => ({ ...x, direccion: e.target.value }))} />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Barrio" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.barrio} onChange={e => setEntrega(x => ({ ...x, barrio: e.target.value }))} />
              </Campo>
              <Campo label="Localidad o municipio" error={errores.ciudad}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.ciudad} onChange={e => setEntrega(x => ({ ...x, ciudad: e.target.value }))} />
              </Campo>
            </div>
            <Campo label="Observaciones para la entrega" opcional>
              <input className={INPUT} style={{ borderColor: BORDE }} placeholder="Portería, horario, punto de referencia…" value={entrega.indicaciones} onChange={e => setEntrega(x => ({ ...x, indicaciones: e.target.value }))} />
            </Campo>
          </Tarjeta>
        )}

        {/* ── Pago ── */}
        {paso === 'pago' && (
          <>
            <Tarjeta>
              <p className="text-[14px] font-bold mb-3" style={{ color: HONDO }}>Tu pedido</p>
              <div className="space-y-1.5 text-[13.5px]" style={{ color: TINTA }}>
                {elegidos.map(p => (
                  <div key={p.id} className="flex justify-between gap-3">
                    <span>{p.nombre}{carrito[p.id] > 1 ? ` ×${carrito[p.id]}` : ''}</span>
                    <span>{fmt(p.precio * carrito[p.id])}</span>
                  </div>
                ))}
                {hayFisico && <div className="flex justify-between gap-3" style={{ color: APAGADO }}><span>Envío</span><span>{fmt(envio)}</span></div>}
                {ahorro > 0 && <div className="flex justify-between gap-3" style={{ color: VERDE }}><span>Tu descuento ({descuento}%)</span><span>−{fmt(ahorro)}</span></div>}
                <div className="flex justify-between gap-3 pt-2 mt-1 border-t text-[15px] font-bold" style={{ borderColor: BORDE }}>
                  <span>Total</span><span style={{ color: ORO }}>{fmt(total)}</span>
                </div>
              </div>
            </Tarjeta>
            <Tarjeta className="space-y-3">
              <p className="text-[14px] font-bold" style={{ color: HONDO }}>¿Cómo quieres pagar?</p>
              {[{ v: 'COMPROBANTE', l: 'Ya pagué — adjunto el comprobante' }, { v: 'DESPUES', l: 'Prefiero pagar después — que me contacten' }].map(o => (
                <button key={o.v} type="button" onClick={() => setPago(p => ({ ...p, modo: o.v }))} aria-pressed={pago.modo === o.v}
                  className="cac-foco w-full text-left px-4 py-3 rounded-xl border-2 text-[13.5px] font-semibold flex items-center gap-2"
                  style={pago.modo === o.v ? { borderColor: VERDE, background: VERDE_SUAVE, color: HONDO } : { borderColor: BORDE, color: TINTA }}>
                  <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: pago.modo === o.v ? VERDE : BORDE }}>
                    {pago.modo === o.v && <span className="w-2 h-2 rounded-full" style={{ background: VERDE }} />}
                  </span>
                  {o.l}
                </button>
              ))}
              {oferta.datos_pago && (pago.modo === 'COMPROBANTE' || pago.modo === '') && (
                <div className="rounded-xl p-3 text-[13px] whitespace-pre-wrap" style={{ background: PAPEL, color: TINTA }}>
                  <p className="font-bold mb-1" style={{ color: HONDO }}>Datos para el pago</p>{oferta.datos_pago}
                </div>
              )}
              {pago.modo === 'COMPROBANTE' && (
                <div className="space-y-3">
                  <Campo label="Medio de pago">
                    <Opciones opciones={(oferta.metodos_pago || []).map(m => ({ valor: m, label: METODO_LABEL[m] || m }))}
                      valor={pago.metodo} onChange={v => setPago(p => ({ ...p, metodo: v }))} />
                  </Campo>
                  <Campo label="Comprobante">
                    <label className="cac-foco flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer text-[13px]"
                      style={{ borderColor: pago.comprobante_url ? VERDE : BORDE, color: pago.comprobante_url ? VERDE : APAGADO }}>
                      {subiendo.comprobante ? <Loader2 size={16} className="animate-spin" />
                        : pago.comprobante_url ? <Check size={16} /> : <FileText size={16} />}
                      {pago.comprobante_url ? 'Comprobante adjunto — toca para cambiarlo' : 'Adjuntar foto o PDF del comprobante'}
                      <input type="file" accept="image/*,application/pdf" className="sr-only"
                        onChange={e => { subirComprobante(e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  </Campo>
                </div>
              )}
              {pago.modo === 'DESPUES' && (
                <p className="text-[13px]" style={{ color: APAGADO }}>Te escribiremos por WhatsApp para coordinar el pago.</p>
              )}
            </Tarjeta>
            <Tarjeta>
              <Campo label="Observaciones" opcional>
                <textarea className={`${INPUT} resize-none`} rows={2} style={{ borderColor: BORDE }} value={obs} onChange={e => setObs(e.target.value)} />
              </Campo>
            </Tarjeta>
            <CasillaDatos variante="titular" tono="portal" checked={autorizo}
              onChange={v => { setAutorizo(v); if (v) setErrAutorizo(null) }} error={errAutorizo} />
          </>
        )}

        <AvisoError texto={error} onCerrar={() => setError('')} />
      </div>

      {/* Barra fija: totales + navegación */}
      <div className="fixed bottom-0 inset-x-0 border-t z-20" style={{ background: 'rgba(255,255,255,0.97)', borderColor: BORDE }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[12px] leading-tight" style={{ color: APAGADO }}>
            <div>Subtotal {fmt(subtotal)}{hayFisico ? ` · Envío ${fmt(envio)}` : ''}</div>
            <div className="text-[16px] font-bold mt-0.5" style={{ color: TINTA }}>Total {fmt(total)}</div>
          </div>
          {paso !== 'productos' && (
            <button type="button" onClick={atras} aria-label="Atrás" className="cac-foco px-3 py-2.5 rounded-xl border text-[13px] font-semibold flex items-center gap-1" style={{ borderColor: BORDE, color: TINTA }}>
              <ChevronLeft size={15} /> <span className="hidden sm:inline">Atrás</span>
            </button>
          )}
          {esUltimo ? (
            <button type="button" onClick={enviar} disabled={enviando || Object.keys(subiendo).length > 0}
              className="cac-foco px-5 py-2.5 rounded-xl text-[13.5px] font-bold text-white flex items-center gap-1.5 disabled:opacity-60" style={{ background: HONDO }}>
              {enviando ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar pedido</>}
            </button>
          ) : (
            <button type="button" onClick={siguiente} disabled={Object.keys(subiendo).length > 0}
              className="cac-foco px-5 py-2.5 rounded-xl text-[13.5px] font-bold text-white flex items-center gap-1 disabled:opacity-60" style={{ background: VERDE }}>
              Continuar <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </Marco>
  )
}
