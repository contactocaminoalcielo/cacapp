// PLANES PRE-EXEQUIALES dentro del portal de la oferta posterior (migr. 210).
//
// Cuatro momentos: ver los planes → diligenciar el formulario → reportar el
// pago → quedar a la espera.
//
// 🔒 Lo que esta pantalla NUNCA hace ni promete: activar un contrato. El
// formulario es una SOLICITUD; el pago lo valida una persona y el contrato lo
// emite coordinación. Por eso el aviso «el diligenciamiento de este formulario
// no significa que el contrato se encuentre activo» sale en el formulario, en
// el pago y en la pantalla final.
//
// Los precios y las condiciones vienen del backend (precio de Configuración ›
// Afiliaciones + descuento de la oferta; condiciones del contrato vigente). El
// texto y la imagen de cada plan los escribe coordinación; si aún no los ha
// escrito, la tarjeta muestra solo lo que sí es cierto: precio y condiciones.
import { useEffect, useRef, useState } from 'react'
import { ofertaAfiliacion, ofertaBorrador, ofertaEvento, ofertaPagoPlan, mensajeDeError } from '@/lib/ofertaPortal'
import { subirArchivoCompra } from '@/lib/catalogoPublico'
import { fmt } from '@/lib/utils'
import { Ilustracion, PAPEL, PAPEL2, TINTA, APAGADO, HONDO, VERDE, BORDE, ORO } from '@/components/portal/Botanica'
import CasillaDatos from '@/components/CasillaDatos'
import { VERSION as POLITICA_VERSION } from '@/lib/privacidad'
import {
  Marco, Campo, Tarjeta, Opciones, Precio, Etiqueta, AvisoError, Encabezado, Pasos,
  INPUT, METODO_LABEL, VERDE_SUAVE,
} from './comunes'
import { Check, ChevronDown, ChevronUp, FileText, Loader2, Plus, Send, ShieldCheck, Trash2, Info } from 'lucide-react'

const NIVEL = { BRONCE: 'Bronce', PLATA: 'Plata', ORO: 'Oro', DIAMANTE: 'Diamante' }
const TIPO = { ANUAL: 'Anual', VITALICIO: 'Vitalicio' }
const TIPO_FRASE = {
  ANUAL: 'Un pago al año, renovable',
  VITALICIO: 'Un solo pago, cubierta de por vida',
}
const AVISO_NO_ACTIVO =
  'Importante: el diligenciamiento de este formulario no significa que el contrato se encuentre activo. '
  + 'La afiliación y emisión del contrato únicamente podrán realizarse una vez se confirme el pago '
  + 'correspondiente y se validen los requisitos del plan.'
const MASCOTA_VACIA = () => ({ key: crypto.randomUUID(), nombre: '', especie_id: '', raza: '', sexo: '', fecha_nacimiento: '', edad: '', peso_kg: '', notas: '' })
const nombrePlan = p => `Plan ${NIVEL[p.nivel] || p.nivel} ${TIPO[p.tipo] || p.tipo}`

function AvisoImportante() {
  return (
    <div className="rounded-xl border p-3.5 flex items-start gap-2.5 text-[13px] leading-snug"
      style={{ background: '#FFF8E6', borderColor: '#F0D9A0', color: '#7A4A00' }}>
      <Info size={16} className="shrink-0 mt-0.5" /><span>{AVISO_NO_ACTIVO}</span>
    </div>
  )
}

export default function PlanesOferta({ codigo, oferta, onVolver }) {
  const planes = oferta.planes || []
  const descuento = oferta.descuentos?.PREEXEQUIALES || 0
  const previa = oferta.solicitud_plan

  // Si ya había una solicitud, se retoma donde quedó.
  const [vista, setVista] = useState(() => !previa ? 'planes'
    : previa.estado === 'PENDIENTE_PAGO' || previa.estado === 'FORMULARIO_COMPLETO' ? 'pago' : 'listo')
  const [plan, setPlan] = useState(null)
  const [cuenta, setCuenta] = useState(() => previa
    ? { plan: previa.plan, n: previa.n_mascotas, valor: previa.valor, total: previa.total, estado: previa.estado }
    : null)
  const [prop, setProp] = useState({ nombre: oferta.familia || '', apellido: '', documento: '', whatsapp: '', email: '', direccion: '', ciudad: 'Bogotá' })
  const [mascotas, setMascotas] = useState([MASCOTA_VACIA()])
  const [formaPago, setFormaPago] = useState('')
  const [autorizo, setAutorizo] = useState(false)
  const [errAutorizo, setErrAutorizo] = useState(null)
  const [verCondiciones, setVerCondiciones] = useState(false)
  const [pago, setPago] = useState({ metodo: '', comprobante_url: '' })
  const [borrador, setBorrador] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [errores, setErrores] = useState({})
  const arriba = useRef(null)

  useEffect(() => { ofertaEvento(codigo, { categoria: 'PREEXEQUIALES', paso: 'INTERESADO' }) }, [codigo])

  function ir(v) { setVista(v); setError(''); arriba.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  function escoger(p) {
    setPlan(p)
    ofertaEvento(codigo, { categoria: 'PREEXEQUIALES', paso: 'FORMULARIO_INICIADO' })
    ir('formulario')
  }

  const setMasc = (key, campo, valor) =>
    setMascotas(ms => ms.map(m => m.key === key ? { ...m, [campo]: valor } : m))

  function validar() {
    const e = {}
    if (!prop.nombre.trim()) e.nombre = 'Escribe tu nombre'
    if (!prop.apellido.trim()) e.apellido = 'Escribe tu apellido'
    if (!prop.documento.replace(/\D/g, '')) e.documento = 'Escribe tu número de documento'
    if (prop.whatsapp.replace(/\D/g, '').length < 10) e.whatsapp = 'Escribe un número válido (10 dígitos)'
    if (prop.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prop.email.trim())) e.email = 'El correo no parece válido'
    if (!prop.direccion.trim()) e.direccion = 'Escribe tu dirección'
    mascotas.forEach(m => {
      if (!m.nombre.trim()) e[`n_${m.key}`] = 'Escribe su nombre'
      if (!m.especie_id) e[`e_${m.key}`] = 'Escoge la especie'
      if (!m.sexo) e[`s_${m.key}`] = 'Indica el sexo'
      const peso = Number(String(m.peso_kg).replace(',', '.'))
      if (!(peso > 0) || peso > 150) e[`p_${m.key}`] = 'Peso aproximado en kilos'
      if (!m.fecha_nacimiento && !m.edad.trim()) e[`f_${m.key}`] = 'Fecha de nacimiento o edad aproximada'
    })
    setErrores(e)
    return Object.keys(e).length === 0
  }

  async function enviarSolicitud() {
    if (!validar()) { setError('Revisa los campos marcados.'); return }
    if (!autorizo) { setErrAutorizo('Necesitamos tu autorización para tratar tus datos y tramitar la afiliación.'); return }
    setEnviando(true); setError('')
    const r = await ofertaAfiliacion(codigo, {
      autorizacion: { aceptada: true, politica_version: POLITICA_VERSION },
      plan: { nivel: plan.nivel, tipo: plan.tipo },
      propietario: prop,
      mascotas: mascotas.map(({ key: _key, ...m }) => m),   // `key` es solo de React: no viaja
      forma_pago: formaPago || null,
    })
    setEnviando(false)
    if (r.status === 200 && r.ok) {
      setCuenta({ plan: { nivel: plan.nivel, tipo: plan.tipo }, n: r.n_mascotas, valor: r.valor, total: r.total, estado: r.estado, datos_pago: r.datos_pago })
      ir('pago')
      return
    }
    setError(mensajeDeError(r, 'No se pudo enviar la solicitud. Intenta de nuevo.'))
  }

  async function subirComprobante(file) {
    if (!file) return
    setSubiendo(true); setError('')
    try {
      let b = borrador
      if (!b) {
        const r = await ofertaBorrador(codigo)
        if (r.status !== 200 || !r.borrador) throw new Error(mensajeDeError(r, 'No se pudo preparar la carga. Intenta de nuevo.'))
        b = r.borrador; setBorrador(b)
      }
      const url = await subirArchivoCompra(b, file, { permitirPdf: true })
      setPago(p => ({ ...p, comprobante_url: url }))
    } catch (e) { setError(e.message) }
    finally { setSubiendo(false) }
  }

  async function reportarPago() {
    if (!pago.metodo || !pago.comprobante_url) { setError('Escoge el medio de pago y adjunta el comprobante.'); return }
    setEnviando(true); setError('')
    const r = await ofertaPagoPlan(codigo, { borrador, metodo: pago.metodo, comprobante_url: pago.comprobante_url })
    setEnviando(false)
    if (r.status === 200 && r.ok) { setCuenta(c => ({ ...c, estado: 'PAGO_REPORTADO' })); ir('listo'); return }
    setError(mensajeDeError(r, 'No se pudo reportar el pago. Intenta de nuevo.'))
  }

  const datosPago = cuenta?.datos_pago ?? oferta.datos_pago

  // ── Sin planes ───────────────────────────────────────────────────────────
  if (!planes.length && vista === 'planes') return (
    <Marco>
      <Encabezado onVolver={onVolver} titulo="Planes preexequiales" />
      <div className="text-center py-12 px-6 max-w-md mx-auto">
        <div className="mx-auto w-fit mb-4"><Ilustracion nombre="rama" tam={64} /></div>
        <p className="text-[15px]" style={{ color: TINTA }}>Por ahora no tenemos planes disponibles en línea.</p>
        <p className="text-[14px] mt-2" style={{ color: APAGADO }}>Escríbenos por WhatsApp y con mucho gusto te contamos las opciones.</p>
      </div>
    </Marco>
  )

  // ── 4 · A la espera ──────────────────────────────────────────────────────
  if (vista === 'listo') {
    const activo = cuenta?.estado === 'AFILIACION_ACTIVA'
    const validado = ['PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO'].includes(cuenta?.estado)
    return (
      <Marco>
        <div ref={arriba} className="text-center py-14 px-6 max-w-md mx-auto">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: VERDE_SUAVE }}>
            {activo ? <ShieldCheck size={30} style={{ color: VERDE }} /> : <Check size={30} style={{ color: VERDE }} />}
          </div>
          <h1 className="text-[22px] font-bold" style={{ color: HONDO }}>
            {activo ? 'Tu afiliación está activa' : validado ? 'Pago validado' : 'Recibimos tu comprobante'}
          </h1>
          {cuenta?.plan && (
            <p className="text-[15px] mt-2" style={{ color: TINTA }}>
              {nombrePlan(cuenta.plan)} · {cuenta.n} mascotica{cuenta.n === 1 ? '' : 's'}
            </p>
          )}
          <p className="text-[14px] mt-3 leading-relaxed" style={{ color: APAGADO }}>
            {activo
              ? 'Tu contrato ya fue emitido. Si no lo has recibido, escríbenos por WhatsApp y te lo enviamos.'
              : validado
                ? 'Tu pago ya fue validado. Estamos emitiendo tu contrato y te lo enviaremos por WhatsApp.'
                : 'Nuestro equipo va a validar tu pago. Cuando esté validado, emitiremos tu contrato y te lo enviaremos por WhatsApp.'}
          </p>
          {!activo && !validado && <div className="mt-5 text-left"><AvisoImportante /></div>}
          <button type="button" onClick={onVolver}
            className="cac-foco mt-7 px-5 py-2.5 rounded-xl border text-[13.5px] font-semibold" style={{ borderColor: BORDE, color: TINTA }}>
            Ver las demás opciones
          </button>
          <p className="mt-8 text-[13px]" style={{ color: APAGADO }}>Camino al Cielo 🌿</p>
        </div>
      </Marco>
    )
  }

  // ── 3 · Pago ─────────────────────────────────────────────────────────────
  if (vista === 'pago') return (
    <Marco>
      <Encabezado refArriba={arriba} onVolver={onVolver} titulo="Tu solicitud está lista"
        subtitulo="Solo falta el pago para que podamos validar tu afiliación y emitir el contrato." />
      <Pasos nombres={['Plan', 'Formulario', 'Pago']} actual={2} />
      <div className="px-4 pb-16 max-w-xl mx-auto w-full space-y-4">
        <Tarjeta>
          <p className="text-[14px] font-bold mb-3" style={{ color: HONDO }}>Resumen</p>
          <div className="space-y-1.5 text-[13.5px]" style={{ color: TINTA }}>
            <div className="flex justify-between gap-3"><span>{cuenta?.plan ? nombrePlan(cuenta.plan) : 'Plan'}</span><span>{fmt(cuenta?.valor)} por mascotica</span></div>
            <div className="flex justify-between gap-3" style={{ color: APAGADO }}><span>Mascoticas</span><span>{cuenta?.n}</span></div>
            <div className="flex justify-between gap-3 pt-2 mt-1 border-t text-[15px] font-bold" style={{ borderColor: BORDE }}>
              <span>Total a pagar</span><span style={{ color: ORO }}>{fmt(cuenta?.total)}</span>
            </div>
          </div>
        </Tarjeta>
        <AvisoImportante />
        <Tarjeta className="space-y-3">
          <p className="text-[14px] font-bold" style={{ color: HONDO }}>Reporta tu pago</p>
          {datosPago
            ? <div className="rounded-xl p-3 text-[13px] whitespace-pre-wrap" style={{ background: PAPEL, color: TINTA }}>
                <p className="font-bold mb-1" style={{ color: HONDO }}>Datos para el pago</p>{datosPago}
              </div>
            : <p className="text-[13px]" style={{ color: APAGADO }}>Te escribiremos por WhatsApp con los datos para el pago.</p>}
          <Campo label="Medio de pago">
            <Opciones opciones={(oferta.metodos_pago || []).map(m => ({ valor: m, label: METODO_LABEL[m] || m }))}
              valor={pago.metodo} onChange={v => setPago(p => ({ ...p, metodo: v }))} />
          </Campo>
          <Campo label="Comprobante">
            <label className="cac-foco flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer text-[13px]"
              style={{ borderColor: pago.comprobante_url ? VERDE : BORDE, color: pago.comprobante_url ? VERDE : APAGADO }}>
              {subiendo ? <Loader2 size={16} className="animate-spin" /> : pago.comprobante_url ? <Check size={16} /> : <FileText size={16} />}
              {pago.comprobante_url ? 'Comprobante adjunto — toca para cambiarlo' : 'Adjuntar foto o PDF del comprobante'}
              <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={subiendo}
                onChange={e => { subirComprobante(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </Campo>
          <AvisoError texto={error} onCerrar={() => setError('')} />
          <button type="button" onClick={reportarPago} disabled={enviando || subiendo}
            className="cac-foco w-full px-5 py-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-60" style={{ background: HONDO }}>
            {enviando ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Reportar mi pago</>}
          </button>
          <p className="text-[12.5px] text-center" style={{ color: APAGADO }}>
            ¿Vas a pagar más tarde? Puedes volver a este enlace cuando tengas el comprobante.
          </p>
        </Tarjeta>
      </div>
    </Marco>
  )

  // ── 2 · Formulario ───────────────────────────────────────────────────────
  if (vista === 'formulario' && plan) {
    const n = mascotas.length
    return (
      <Marco>
        <Encabezado refArriba={arriba} onVolver={onVolver} titulo={nombrePlan(plan)}
          subtitulo="Cuéntanos de ti y de las mascoticas que quieres afiliar." />
        <Pasos nombres={['Plan', 'Formulario', 'Pago']} actual={1} />
        <div className="px-4 pb-16 max-w-xl mx-auto w-full space-y-4">
          <Tarjeta className="space-y-3">
            <p className="text-[14px] font-bold" style={{ color: HONDO }}>Datos del propietario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Nombre" error={errores.nombre}>
                <input className={INPUT} style={{ borderColor: BORDE }} autoComplete="given-name" value={prop.nombre} onChange={e => setProp(p => ({ ...p, nombre: e.target.value }))} />
              </Campo>
              <Campo label="Apellido" error={errores.apellido}>
                <input className={INPUT} style={{ borderColor: BORDE }} autoComplete="family-name" value={prop.apellido} onChange={e => setProp(p => ({ ...p, apellido: e.target.value }))} />
              </Campo>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Documento" error={errores.documento}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="numeric" value={prop.documento} onChange={e => setProp(p => ({ ...p, documento: e.target.value.replace(/\D/g, '') }))} />
              </Campo>
              <Campo label="Número de contacto" error={errores.whatsapp}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="tel" autoComplete="tel" placeholder="3001234567" value={prop.whatsapp} onChange={e => setProp(p => ({ ...p, whatsapp: e.target.value }))} />
              </Campo>
            </div>
            <Campo label="Correo electrónico" opcional error={errores.email}>
              <input className={INPUT} style={{ borderColor: BORDE }} type="email" autoComplete="email" value={prop.email} onChange={e => setProp(p => ({ ...p, email: e.target.value }))} />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Campo label="Dirección" error={errores.direccion}>
                  <input className={INPUT} style={{ borderColor: BORDE }} autoComplete="street-address" value={prop.direccion} onChange={e => setProp(p => ({ ...p, direccion: e.target.value }))} />
                </Campo>
              </div>
              <Campo label="Ciudad" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={prop.ciudad} onChange={e => setProp(p => ({ ...p, ciudad: e.target.value }))} />
              </Campo>
            </div>
          </Tarjeta>

          {mascotas.map((m, i) => (
            <Tarjeta key={m.key} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-bold" style={{ color: HONDO }}>Mascotica {n > 1 ? i + 1 : ''}</p>
                {n > 1 && (
                  <button type="button" onClick={() => setMascotas(ms => ms.filter(x => x.key !== m.key))}
                    className="cac-foco text-[12px] font-semibold flex items-center gap-1 rounded-lg text-red-700">
                    <Trash2 size={13} /> Quitar
                  </button>
                )}
              </div>
              <Campo label="Nombre" error={errores[`n_${m.key}`]}>
                <input className={INPUT} style={{ borderColor: BORDE }} value={m.nombre} onChange={e => setMasc(m.key, 'nombre', e.target.value)} />
              </Campo>
              <Campo label="Especie" error={errores[`e_${m.key}`]}>
                <Opciones opciones={(oferta.especies || []).map(es => ({ valor: String(es.id), label: es.nombre }))}
                  valor={m.especie_id} onChange={v => setMasc(m.key, 'especie_id', v)} />
              </Campo>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo label="Sexo" error={errores[`s_${m.key}`]}>
                  <Opciones estirar opciones={['Macho', 'Hembra']} valor={m.sexo} onChange={v => setMasc(m.key, 'sexo', v)} />
                </Campo>
                <Campo label="Raza" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} value={m.raza} onChange={e => setMasc(m.key, 'raza', e.target.value)} />
                </Campo>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo label="Fecha de nacimiento" opcional error={errores[`f_${m.key}`]}>
                  <input type="date" className={INPUT} style={{ borderColor: BORDE }} value={m.fecha_nacimiento}
                    max={new Date().toISOString().slice(0, 10)} onChange={e => setMasc(m.key, 'fecha_nacimiento', e.target.value)} />
                </Campo>
                <Campo label="…o edad aproximada" opcional>
                  <input className={INPUT} style={{ borderColor: BORDE }} placeholder="3 años" value={m.edad} onChange={e => setMasc(m.key, 'edad', e.target.value)} />
                </Campo>
              </div>
              <Campo label="Peso aproximado (kg)" error={errores[`p_${m.key}`]}>
                <input className={INPUT} style={{ borderColor: BORDE }} inputMode="decimal" placeholder="12" value={m.peso_kg} onChange={e => setMasc(m.key, 'peso_kg', e.target.value)} />
              </Campo>
              <Campo label="Algo más que debamos saber" opcional>
                <input className={INPUT} style={{ borderColor: BORDE }} value={m.notas} onChange={e => setMasc(m.key, 'notas', e.target.value)} />
              </Campo>
            </Tarjeta>
          ))}
          {n < 10 && (
            <button type="button" onClick={() => setMascotas(ms => [...ms, MASCOTA_VACIA()])}
              className="cac-foco w-full px-4 py-3 rounded-xl border-2 border-dashed text-[13.5px] font-semibold flex items-center justify-center gap-1.5"
              style={{ borderColor: BORDE, color: VERDE }}>
              <Plus size={15} /> Agregar otra mascotica
            </button>
          )}

          <Tarjeta className="space-y-3">
            <p className="text-[14px] font-bold" style={{ color: HONDO }}>Plan seleccionado</p>
            <div className="space-y-1.5 text-[13.5px]" style={{ color: TINTA }}>
              <div className="flex justify-between gap-3"><span>{nombrePlan(plan)}</span><Precio lista={plan.valor_lista} precio={plan.valor} sufijo="por mascotica" /></div>
              <div className="flex justify-between gap-3" style={{ color: APAGADO }}><span>Mascoticas</span><span>{n}</span></div>
              <div className="flex justify-between gap-3 pt-2 mt-1 border-t text-[15px] font-bold" style={{ borderColor: BORDE }}>
                <span>Total</span><span style={{ color: ORO }}>{fmt(plan.valor * n)}</span>
              </div>
            </div>
            <Campo label="¿Cómo piensas pagar?" opcional>
              <Opciones opciones={(oferta.metodos_pago || []).map(x => ({ valor: x, label: METODO_LABEL[x] || x }))}
                valor={formaPago} onChange={setFormaPago} />
            </Campo>
            {plan.activacion && (
              <p className="text-[12.5px] leading-snug" style={{ color: APAGADO }}>
                Condición de activación durante el primer año: usar el servicio tiene un valor por mascotica
                de {fmt(plan.activacion.hasta_180)} hasta el día 180 y de {fmt(plan.activacion.desde_181)} desde el día 181.
              </p>
            )}
          </Tarjeta>

          <AvisoImportante />
          <CasillaDatos variante="titular" tono="portal" checked={autorizo}
            onChange={v => { setAutorizo(v); if (v) setErrAutorizo(null) }} error={errAutorizo} />
          <AvisoError texto={error} onCerrar={() => setError('')} />

          <div className="flex gap-3">
            <button type="button" onClick={() => ir('planes')}
              className="cac-foco px-4 py-3 rounded-xl border text-[13.5px] font-semibold" style={{ borderColor: BORDE, color: TINTA }}>
              Cambiar de plan
            </button>
            <button type="button" onClick={enviarSolicitud} disabled={enviando}
              className="cac-foco flex-1 px-5 py-3 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-60" style={{ background: HONDO }}>
              {enviando ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <><Send size={15} /> Enviar solicitud</>}
            </button>
          </div>
        </div>
      </Marco>
    )
  }

  // ── 1 · Los planes ───────────────────────────────────────────────────────
  return (
    <Marco>
      <Encabezado refArriba={arriba} onVolver={onVolver} titulo="Planes preexequiales"
        subtitulo="Para que las demás mascoticas de tu familia tengan asegurada, desde hoy, una despedida digna." />
      {descuento > 0 && (
        <div className="text-center -mt-1 mb-4"><Etiqueta>{descuento}% de descuento en la afiliación</Etiqueta></div>
      )}
      <div className="px-4 pb-16 max-w-3xl mx-auto w-full space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {planes.map(p => (
            <div key={`${p.nivel}-${p.tipo}`} className="rounded-2xl border overflow-hidden flex flex-col" style={{ background: 'white', borderColor: BORDE }}>
              <div className={`${p.imagen_url ? 'aspect-[16/10]' : 'h-24'} flex items-center justify-center`} style={{ background: PAPEL2 }}>
                {p.imagen_url
                  ? <img src={p.imagen_url} alt={nombrePlan(p)} loading="lazy" className="w-full h-full object-cover" />
                  : <ShieldCheck size={38} strokeWidth={1.5} style={{ color: VERDE }} aria-hidden="true" />}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[16px] font-bold leading-snug" style={{ color: TINTA }}>Plan {NIVEL[p.nivel] || p.nivel}</h3>
                    <p className="text-[12px] font-semibold" style={{ color: VERDE }}>{TIPO[p.tipo]} · {TIPO_FRASE[p.tipo]}</p>
                  </div>
                  <Precio lista={p.valor_lista} precio={p.valor} sufijo="por mascotica" />
                </div>
                {p.descripcion && <p className="text-[13px] mt-2 leading-snug" style={{ color: APAGADO }}>{p.descripcion}</p>}
                {p.beneficios.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {p.beneficios.map(b => (
                      <li key={b} className="text-[12.5px] leading-snug flex items-start gap-1.5" style={{ color: TINTA }}>
                        <Check size={13} className="shrink-0 mt-0.5" style={{ color: VERDE }} /> {b}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 space-y-1 text-[12px] leading-snug" style={{ color: APAGADO }}>
                  {p.equivale.length > 0 && <p>Al usarlo, cubre nuestro servicio <strong style={{ color: TINTA }}>{p.equivale.join(' o ')}</strong>.</p>}
                  {p.activacion
                    ? <p>Activación el primer año: {fmt(p.activacion.hasta_180)} hasta el día 180 · {fmt(p.activacion.desde_181)} desde el día 181.</p>
                    : <p>Sin tiempos de carencia: se puede usar desde que se formaliza.</p>}
                </div>
                <button type="button" onClick={() => escoger(p)}
                  className="cac-foco mt-4 px-4 py-2.5 rounded-xl text-[13.5px] font-bold text-white" style={{ background: VERDE }}>
                  Deseo este plan
                </button>
              </div>
            </div>
          ))}
        </div>

        <Tarjeta>
          <button type="button" onClick={() => setVerCondiciones(v => !v)} aria-expanded={verCondiciones}
            className="cac-foco w-full flex items-center justify-between gap-2 text-left rounded-lg">
            <span className="text-[14px] font-bold" style={{ color: HONDO }}>Condiciones, vigencia y restricciones</span>
            {verCondiciones ? <ChevronUp size={16} style={{ color: VERDE }} /> : <ChevronDown size={16} style={{ color: VERDE }} />}
          </button>
          {verCondiciones && (
            <ul className="mt-3 space-y-2">
              {(oferta.condiciones || []).map(c => (
                <li key={c} className="text-[13px] leading-snug flex items-start gap-2" style={{ color: TINTA }}>
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: VERDE }} /> {c}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        <AvisoImportante />
      </div>
    </Marco>
  )
}
