// /catalogo — catálogo público de recordatorios para clientes SIN servicio
// funerario (migr. 200). Un solo enlace que se le comparte a cualquiera:
// escoge productos → sus datos y los de la mascota → las fotos y textos que pide
// CADA producto → entrega (solo si hay algo físico) → pago → listo.
//
// La compra cae en el módulo Compras de recordatorios y en el Tablero de
// Producción como «Compra de recordatorio – Cliente sin servicio funerario».
// El precio que se ve aquí es informativo: el backend lo vuelve a sacar de la
// base al crear la compra.
import { useEffect, useMemo, useRef, useState } from 'react'
import { catalogoVer, catalogoBorrador, catalogoComprar, subirArchivoCompra } from '@/lib/catalogoPublico'
import { fmt } from '@/lib/utils'
import { Ilustracion, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, VERDE, BORDE, ORO, ESTILOS } from '@/components/portal/Botanica'
import CasillaDatos from '@/components/CasillaDatos'
import { VERSION as POLITICA_VERSION } from '@/lib/privacidad'
import { Camera, Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, Send, X, Clock, Truck, AlertCircle, FileText } from 'lucide-react'

const PASOS = ['Productos', 'Tus datos', 'Personalizar', 'Entrega', 'Pago']
const METODO_LABEL = { TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', OTRO: 'Otro' }
const INPUT = 'w-full px-3.5 py-2.5 rounded-xl border text-[14px] outline-none cac-foco bg-white'
const LABEL = 'block text-[12px] font-semibold mb-1'

function Campo({ label, opcional, children, error }) {
  return (
    <div>
      <label className={LABEL} style={{ color: TINTA }}>
        {label}{opcional ? <span className="font-normal" style={{ color: APAGADO }}> (opcional)</span> : ' *'}
      </label>
      {children}
      {error && <p className="text-[11.5px] mt-1 text-red-600">{error}</p>}
    </div>
  )
}

function Tarjeta({ children, className = '' }) {
  return <div className={`rounded-2xl border p-4 sm:p-5 ${className}`} style={{ background: 'white', borderColor: BORDE }}>{children}</div>
}

/** ¿Una línea tiene todo lo que pide su producto (fotos + textos)? */
function lineaCompleta(p, datos) {
  if (p.fotos > 0 && (datos?.fotos || []).filter(Boolean).length < p.fotos) return false
  for (const c of p.campos_texto || []) {
    const arr = datos?.textos?.[c.label] || []
    if (arr.filter(v => v && String(v).trim()).length < (c.cantidad || 1)) return false
  }
  return true
}

export default function CatalogoRecordatorios() {
  const [fase, setFase]       = useState('cargando')    // cargando | form | exito | cerrado | error
  const [cat, setCat]         = useState(null)
  const [paso, setPaso]       = useState(0)
  const [carrito, setCarrito] = useState({})            // { id: cantidad }
  const [lineas, setLineas]   = useState({})            // { id: { fotos:[url], textos:{label:[...]}, notas } }
  const [prop, setProp]       = useState({ nombre: '', apellido: '', cedula: '', whatsapp: '', email: '' })
  const [masc, setMasc]       = useState({ nombre: '', especie_id: '', sexo: '', raza: '', fallecida: null })
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

  useEffect(() => {
    catalogoVer().then(r => {
      if (r.status !== 200 || !r.ok) { setFase('error'); return }
      setCat(r)
      setFase(r.activo && r.productos?.length ? 'form' : 'cerrado')
    }).catch(() => setFase('error'))
  }, [])

  const productos = cat?.productos || []
  const elegidos = useMemo(() => productos.filter(p => carrito[p.id] > 0), [productos, carrito])
  const hayFisico = elegidos.some(p => p.fisico)
  const subtotal = elegidos.reduce((a, p) => a + p.precio * carrito[p.id], 0)
  const envio = hayFisico ? (cat?.valor_envio || 0) : 0
  const total = subtotal + envio
  const pasosVisibles = PASOS.map((_, i) => i).filter(i => i !== 3 || hayFisico)

  function irA(i) { setPaso(i); setError(''); arriba.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
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
    const r = await catalogoBorrador()
    if (r.status !== 200 || !r.borrador) throw new Error(r.error || 'No se pudo preparar el pedido. Intenta de nuevo.')
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

  function validar(i) {
    const e = {}
    if (i === 0 && !elegidos.length) return 'Escoge al menos un recordatorio.'
    if (i === 1) {
      if (!prop.nombre.trim()) e.nombre = 'Escribe tu nombre'
      if (prop.whatsapp.replace(/\D/g, '').length < 10) e.whatsapp = 'Escribe un WhatsApp válido (10 dígitos)'
      if (!masc.nombre.trim()) e.masc_nombre = 'Escribe el nombre de tu mascota'
      if (!masc.especie_id) e.especie = 'Escoge la especie'
      if (masc.fallecida === null) e.fallecida = 'Cuéntanos esto para tratar tu pedido con el cuidado que merece'
    }
    if (i === 2) {
      const falta = elegidos.find(p => !lineaCompleta(p, lineas[p.id]))
      if (falta) return `Falta completar «${falta.nombre}»: revisa sus fotos y textos.`
    }
    if (i === 3 && hayFisico) {
      if (!entrega.direccion.trim()) e.direccion = 'Escribe la dirección'
      if (!entrega.ciudad.trim()) e.ciudad = 'Escribe la ciudad'
      if (!entrega.recibe.trim()) e.recibe = 'Escribe quién recibe'
      if (entrega.telefono.replace(/\D/g, '').length < 7) e.telefono = 'Escribe un teléfono de contacto'
    }
    setErrores(e)
    return Object.keys(e).length ? 'Revisa los campos marcados.' : ''
  }

  function siguiente() {
    const msg = validar(paso)
    if (msg) { setError(msg); return }
    const idx = pasosVisibles.indexOf(paso)
    irA(pasosVisibles[idx + 1])
  }
  function atras() {
    const idx = pasosVisibles.indexOf(paso)
    if (idx > 0) irA(pasosVisibles[idx - 1])
  }

  async function enviar() {
    if (!pago.modo) { setError('Escoge cómo vas a pagar.'); return }
    if (pago.modo === 'COMPROBANTE' && (!pago.metodo || !pago.comprobante_url)) { setError('Escoge el medio de pago y adjunta el comprobante.'); return }
    if (!autorizo) { setErrAutorizo('Necesitamos tu autorización para tratar tus datos y atender el pedido.'); return }
    setEnviando(true); setError('')
    try {
      const b = await asegurarBorrador()
      const r = await catalogoComprar({
        borrador: b,
        autorizacion: { aceptada: true, politica_version: POLITICA_VERSION },
        propietario: prop,
        mascota: { ...masc, fallecida: masc.fallecida === true },
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
        setResultado(r); setFase('exito'); window.scrollTo({ top: 0 })
        return
      }
      setError(r.error === 'falta_autorizacion' ? r.mensaje : (r.error || 'No se pudo enviar el pedido. Intenta de nuevo.'))
    } catch {
      setError('Hubo un problema de conexión. Revisa tu internet e intenta de nuevo.')
    } finally { setEnviando(false) }
  }

  // ── Pantallas de estado ──────────────────────────────────────────────────
  if (fase === 'cargando') return <Marco><div className="flex-1 flex items-center justify-center py-32"><Loader2 className="animate-spin" style={{ color: VERDE }} /></div></Marco>
  if (fase === 'error' || fase === 'cerrado') return (
    <Marco>
      <div className="text-center py-24 px-6">
        <div className="mx-auto w-fit mb-4"><Ilustracion nombre="rama" tam={64} /></div>
        <h1 className="text-[20px] font-bold" style={{ color: HONDO }}>
          {fase === 'cerrado' ? 'El catálogo no está disponible por ahora' : 'No pudimos cargar el catálogo'}
        </h1>
        <p className="text-[14px] mt-2" style={{ color: APAGADO }}>
          {fase === 'cerrado' ? 'Escríbenos por WhatsApp y con gusto te ayudamos con tu recordatorio.' : 'Revisa tu conexión y recarga la página.'}
        </p>
      </div>
    </Marco>
  )
  if (fase === 'exito') return (
    <Marco>
      <div className="text-center py-16 px-6 max-w-md mx-auto">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: '#E4EFE7' }}>
          <Check size={30} style={{ color: VERDE }} />
        </div>
        <h1 className="text-[22px] font-bold" style={{ color: HONDO }}>¡Recibimos tu pedido!</h1>
        <p className="text-[15px] mt-2" style={{ color: TINTA }}>Pedido <strong>CR-{resultado?.numero}</strong> · Total {fmt(resultado?.total)}</p>
        <p className="text-[14px] mt-3 leading-relaxed" style={{ color: APAGADO }}>
          {pago.modo === 'DESPUES'
            ? 'Te escribiremos por WhatsApp para coordinar el pago y empezar a elaborar tus recordatorios con mucho cariño.'
            : 'Vamos a verificar tu pago y empezaremos a elaborar tus recordatorios con mucho cariño. Te escribiremos por WhatsApp.'}
        </p>
        <p className="mt-8 text-[13px]" style={{ color: APAGADO }}>Camino al Cielo 🌿</p>
      </div>
    </Marco>
  )

  // ── Formulario ───────────────────────────────────────────────────────────
  const especies = cat?.especies || []
  const esUltimo = paso === 4
  return (
    <Marco>
      <div ref={arriba} className="px-4 pt-7 pb-3 text-center">
        <div className="text-[12px] font-bold tracking-[0.18em] uppercase" style={{ color: VERDE }}>Camino al Cielo</div>
        <h1 className="text-[24px] font-bold leading-tight mt-1" style={{ color: HONDO }}>Recordatorios para tu mascota</h1>
        <p className="text-[13.5px] mt-1.5 max-w-md mx-auto" style={{ color: APAGADO }}>
          Escoge, personaliza con sus fotos y te lo hacemos llegar. Hechos a mano, con amor.
        </p>
      </div>

      {/* Pasos */}
      <div className="flex items-center justify-center gap-1.5 px-4 mb-5 flex-wrap">
        {pasosVisibles.map((i, n) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={paso === i ? { background: HONDO, color: 'white' }
                : pasosVisibles.indexOf(paso) > n ? { background: '#E4EFE7', color: VERDE } : { background: PAPEL2, color: APAGADO }}>
              {n + 1}. {PASOS[i]}
            </span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-40 max-w-3xl mx-auto w-full space-y-4">
        {/* ── 0 · Catálogo ── */}
        {paso === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productos.map(p => {
              const n = carrito[p.id] || 0
              return (
                <div key={p.id} className="rounded-2xl border overflow-hidden flex flex-col transition-all"
                  style={{ background: 'white', borderColor: n ? VERDE : BORDE, boxShadow: n ? `0 0 0 2px ${VERDE}22` : 'none' }}>
                  {/* Sin foto, una ilustración baja: un recuadro grande vacío ocupaba media pantalla en el celular */}
                  <div className={`${p.foto_url ? 'aspect-[16/10]' : 'h-24'} flex items-center justify-center`} style={{ background: PAPEL2 }}>
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nombre} loading="lazy" className="w-full h-full object-cover" />
                      : <Ilustracion nombre={p.nombre} tam={44} />}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-bold leading-snug" style={{ color: TINTA }}>{p.nombre}</h3>
                      <span className="text-[15px] font-bold whitespace-nowrap" style={{ color: ORO }}>{fmt(p.precio)}</span>
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
                          Agregar
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

        {/* ── 1 · Tus datos ── */}
        {paso === 1 && (
          <>
            <Tarjeta className="space-y-3">
              <p className="text-[14px] font-bold" style={{ color: HONDO }}>Tus datos</p>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Nombre" error={errores.nombre}>
                  <input className={INPUT} style={{ borderColor: BORDE }} value={prop.nombre} onChange={e => setProp(p => ({ ...p, nombre: e.target.value }))} />
                </Campo>
                <Campo label="Apellido" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} value={prop.apellido} onChange={e => setProp(p => ({ ...p, apellido: e.target.value }))} />
                </Campo>
              </div>
              <Campo label="WhatsApp" error={errores.whatsapp}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="tel" placeholder="3001234567" value={prop.whatsapp} onChange={e => setProp(p => ({ ...p, whatsapp: e.target.value }))} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Cédula" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} inputMode="numeric" value={prop.cedula} onChange={e => setProp(p => ({ ...p, cedula: e.target.value.replace(/\D/g, '') }))} />
                </Campo>
                <Campo label="Correo" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} type="email" value={prop.email} onChange={e => setProp(p => ({ ...p, email: e.target.value }))} />
                </Campo>
              </div>
            </Tarjeta>
            <Tarjeta className="space-y-3">
              <p className="text-[14px] font-bold" style={{ color: HONDO }}>Tu mascota</p>
              <Campo label="Nombre de tu mascota" error={errores.masc_nombre}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={masc.nombre} onChange={e => setMasc(m => ({ ...m, nombre: e.target.value }))} />
              </Campo>
              <Campo label="Especie" error={errores.especie}>
                <div className="flex flex-wrap gap-2">
                  {especies.map(es => (
                    <button key={es.id} type="button" onClick={() => setMasc(m => ({ ...m, especie_id: String(es.id) }))}
                      className="cac-foco px-3.5 py-2 rounded-xl border text-[13px] font-semibold"
                      style={masc.especie_id === String(es.id) ? { borderColor: VERDE, background: '#E4EFE7', color: VERDE } : { borderColor: BORDE, color: APAGADO }}>
                      {es.nombre}
                    </button>
                  ))}
                </div>
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Sexo" opcional>
                  <div className="flex gap-2">
                    {['Macho', 'Hembra'].map(s => (
                      <button key={s} type="button" onClick={() => setMasc(m => ({ ...m, sexo: s }))}
                        className="cac-foco flex-1 py-2 rounded-xl border text-[13px] font-semibold"
                        style={masc.sexo === s ? { borderColor: VERDE, background: '#E4EFE7', color: VERDE } : { borderColor: BORDE, color: APAGADO }}>{s}</button>
                    ))}
                  </div>
                </Campo>
                <Campo label="Raza" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} value={masc.raza} onChange={e => setMasc(m => ({ ...m, raza: e.target.value }))} />
                </Campo>
              </div>
              <Campo label="Tu mascota…" error={errores.fallecida}>
                <div className="flex gap-2">
                  {[{ v: false, l: 'Está conmigo' }, { v: true, l: 'Ya partió' }].map(o => (
                    <button key={o.l} type="button" onClick={() => setMasc(m => ({ ...m, fallecida: o.v }))}
                      className="cac-foco flex-1 py-2 rounded-xl border text-[13px] font-semibold"
                      style={masc.fallecida === o.v ? { borderColor: VERDE, background: '#E4EFE7', color: VERDE } : { borderColor: BORDE, color: APAGADO }}>{o.l}</button>
                  ))}
                </div>
              </Campo>
            </Tarjeta>
          </>
        )}

        {/* ── 2 · Personalizar: lo que pide CADA producto ── */}
        {paso === 2 && elegidos.map(p => {
          const d = lineas[p.id] || {}
          const completo = lineaCompleta(p, d)
          const nada = p.fotos === 0 && !(p.campos_texto || []).length
          return (
            <Tarjeta key={p.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-bold" style={{ color: HONDO }}>{p.nombre}{carrito[p.id] > 1 ? ` ×${carrito[p.id]}` : ''}</p>
                {completo
                  ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: '#E4EFE7', color: VERDE }}><Check size={11} /> Listo</span>
                  : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FBEFD9', color: ORO }}>Falta completar</span>}
              </div>
              {nada && <p className="text-[13px]" style={{ color: APAGADO }}>Este recordatorio no necesita fotos ni textos: lo personalizamos con el nombre de tu mascota.</p>}
              {p.fotos > 0 && (
                <div>
                  <p className="text-[12.5px] font-semibold mb-2" style={{ color: TINTA }}>
                    Sube {p.fotos} foto{p.fotos === 1 ? '' : 's'} de {masc.nombre || 'tu mascota'}
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
              <Campo label="Algo que debamos saber de este recordatorio" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={d.notas || ''}
                  onChange={e => setLineas(l => ({ ...l, [p.id]: { ...l[p.id], notas: e.target.value } }))} />
              </Campo>
            </Tarjeta>
          )
        })}

        {/* ── 3 · Entrega (solo con algo físico) ── */}
        {paso === 3 && hayFisico && (
          <Tarjeta className="space-y-3">
            <p className="text-[14px] font-bold" style={{ color: HONDO }}>¿A dónde te lo enviamos?</p>
            <Campo label="Dirección" error={errores.direccion}>
              <input className={INPUT} style={{ borderColor: BORDE }} placeholder="Calle 45 # 12-34, apto 301" value={entrega.direccion} onChange={e => setEntrega(x => ({ ...x, direccion: e.target.value }))} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Ciudad" error={errores.ciudad}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.ciudad} onChange={e => setEntrega(x => ({ ...x, ciudad: e.target.value }))} />
              </Campo>
              <Campo label="Barrio" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.barrio} onChange={e => setEntrega(x => ({ ...x, barrio: e.target.value }))} />
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Quién recibe" error={errores.recibe}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={entrega.recibe} onChange={e => setEntrega(x => ({ ...x, recibe: e.target.value }))} />
              </Campo>
              <Campo label="Teléfono de quien recibe" error={errores.telefono}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="tel" value={entrega.telefono} onChange={e => setEntrega(x => ({ ...x, telefono: e.target.value }))} />
              </Campo>
            </div>
            <Campo label="Indicaciones para la entrega" opcional>
              <input className={INPUT} style={{ borderColor: BORDE }} placeholder="Portería, horario, punto de referencia…" value={entrega.indicaciones} onChange={e => setEntrega(x => ({ ...x, indicaciones: e.target.value }))} />
            </Campo>
          </Tarjeta>
        )}

        {/* ── 4 · Pago ── */}
        {paso === 4 && (
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
                <div className="flex justify-between gap-3 pt-2 mt-1 border-t text-[15px] font-bold" style={{ borderColor: BORDE }}>
                  <span>Total</span><span style={{ color: ORO }}>{fmt(total)}</span>
                </div>
              </div>
            </Tarjeta>
            <Tarjeta className="space-y-3">
              <p className="text-[14px] font-bold" style={{ color: HONDO }}>¿Cómo quieres pagar?</p>
              {[{ v: 'COMPROBANTE', l: 'Ya pagué — adjunto el comprobante' }, { v: 'DESPUES', l: 'Prefiero pagar después — que me contacten' }].map(o => (
                <button key={o.v} type="button" onClick={() => setPago(p => ({ ...p, modo: o.v }))}
                  className="cac-foco w-full text-left px-4 py-3 rounded-xl border-2 text-[13.5px] font-semibold flex items-center gap-2"
                  style={pago.modo === o.v ? { borderColor: VERDE, background: '#E4EFE7', color: HONDO } : { borderColor: BORDE, color: TINTA }}>
                  <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center" style={{ borderColor: pago.modo === o.v ? VERDE : BORDE }}>
                    {pago.modo === o.v && <span className="w-2 h-2 rounded-full" style={{ background: VERDE }} />}
                  </span>
                  {o.l}
                </button>
              ))}
              {cat?.datos_pago && (pago.modo === 'COMPROBANTE' || pago.modo === '') && (
                <div className="rounded-xl p-3 text-[13px] whitespace-pre-wrap" style={{ background: PAPEL, color: TINTA }}>
                  <p className="font-bold mb-1" style={{ color: HONDO }}>Datos para el pago</p>{cat.datos_pago}
                </div>
              )}
              {pago.modo === 'COMPROBANTE' && (
                <div className="space-y-3">
                  <Campo label="Medio de pago">
                    <div className="flex flex-wrap gap-2">
                      {(cat?.metodos_pago || []).map(m => (
                        <button key={m} type="button" onClick={() => setPago(p => ({ ...p, metodo: m }))}
                          className="cac-foco px-3.5 py-2 rounded-xl border text-[13px] font-semibold"
                          style={pago.metodo === m ? { borderColor: VERDE, background: '#E4EFE7', color: VERDE } : { borderColor: BORDE, color: APAGADO }}>
                          {METODO_LABEL[m] || m}
                        </button>
                      ))}
                    </div>
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

        {error && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-[13px] border bg-red-50 border-red-200 text-red-700">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /><span className="flex-1">{error}</span>
            <button type="button" aria-label="Cerrar" onClick={() => setError('')}><X size={14} /></button>
          </div>
        )}
      </div>

      {/* Barra fija: totales + navegación */}
      <div className="fixed bottom-0 inset-x-0 border-t z-20" style={{ background: 'rgba(255,255,255,0.97)', borderColor: BORDE }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[12px] leading-tight" style={{ color: APAGADO }}>
            <div>Subtotal {fmt(subtotal)}{hayFisico ? ` · Envío ${fmt(envio)}` : ''}</div>
            <div className="text-[16px] font-bold mt-0.5" style={{ color: TINTA }}>Total {fmt(total)}</div>
          </div>
          {paso > 0 && (
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

function Marco({ children }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAPEL }}>
      <style>{ESTILOS}</style>
      {children}
    </div>
  )
}
