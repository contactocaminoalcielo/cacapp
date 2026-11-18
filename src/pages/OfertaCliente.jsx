// /oferta/CODIGO — portal de la OFERTA POSTERIOR al servicio (migr. 210).
//
// REPORTE ORBIT 2026-11-17: unos dos meses después del fallecimiento, la
// familia recibe por WhatsApp un mensaje con cuatro botones. Cada botón la trae
// aquí, a una de tres secciones:
//   /oferta/CODIGO/recordatorios → recordatorios adicionales (con descuento)
//   /oferta/CODIGO/planes        → planes pre-exequiales para sus otras mascoticas
//   /oferta/CODIGO/cedulas       → cédulas para mascotas
//   /oferta/CODIGO               → las tres opciones a la vista
//
// «El propietario no debería tener que tomar una decisión únicamente leyendo
// texto»: cada opción y cada producto va con su imagen.
//
// Página pública, sin sesión: la llave es el código. No muestra datos de la
// ficha (teléfono, cédula, dirección) — el backend no los envía.
import { useEffect, useState } from 'react'
import { ofertaVer, ofertaBaja } from '@/lib/ofertaPortal'
import { Ilustracion, PAPEL2, TINTA, APAGADO, HONDO, VERDE, BORDE } from '@/components/portal/Botanica'
import { Marco, Etiqueta, AvisoError, VERDE_SUAVE } from '@/components/oferta/comunes'
import PedidoOferta from '@/components/oferta/PedidoOferta'
import PlanesOferta from '@/components/oferta/PlanesOferta'
import { ChevronRight, Loader2, Check, PawPrint, ShieldCheck, IdCard } from 'lucide-react'

const SECCIONES = { recordatorios: 'RECORDATORIOS', planes: 'PREEXEQUIALES', cedulas: 'CEDULAS' }

export default function OfertaCliente({ codigo, seccion = '' }) {
  const [fase, setFase]     = useState('cargando')   // cargando | ok | vencida | no_disponible | error
  const [oferta, setOferta] = useState(null)
  const [vista, setVista]   = useState(SECCIONES[seccion] || 'INICIO')
  const [baja, setBaja]     = useState('')           // '' | confirmar | enviando | hecha
  const [error, setError]   = useState('')

  useEffect(() => {
    let vivo = true
    ofertaVer(codigo).then(r => {
      if (!vivo) return
      if (r.status === 404) { setFase('no_disponible'); return }
      if (r.status !== 200 || !r.ok) { setFase('error'); return }
      setOferta(r)
      if (r.baja) setBaja('hecha')
      setFase(r.vigente ? 'ok' : 'vencida')
    })
    return () => { vivo = false }
  }, [codigo])

  function volver() { setVista('INICIO'); window.scrollTo({ top: 0 }) }

  async function darDeBaja() {
    setBaja('enviando'); setError('')
    const r = await ofertaBaja(codigo)
    if (r.status === 200 && r.ok) { setBaja('hecha'); return }
    setBaja('confirmar')
    setError('No pudimos registrar tu solicitud. Intenta de nuevo o escríbenos por WhatsApp.')
  }

  if (fase === 'cargando') return (
    <Marco><div className="flex-1 flex items-center justify-center py-32"><Loader2 className="animate-spin" style={{ color: VERDE }} /></div></Marco>
  )

  if (fase !== 'ok') return (
    <Marco>
      <div className="text-center py-24 px-6 max-w-md mx-auto">
        <div className="mx-auto w-fit mb-4"><Ilustracion nombre="rama" tam={64} /></div>
        <h1 className="text-[20px] font-bold" style={{ color: HONDO }}>
          {fase === 'vencida' ? 'Esta oferta ya cerró'
            : fase === 'no_disponible' ? 'Este enlace ya no está disponible'
            : 'No pudimos cargar la página'}
        </h1>
        <p className="text-[14px] mt-2 leading-relaxed" style={{ color: APAGADO }}>
          {fase === 'error'
            ? 'Revisa tu conexión y vuelve a abrir el enlace.'
            : 'Si deseas conocer nuestras opciones, escríbenos por WhatsApp y con mucho gusto te ayudamos.'}
        </p>
        {fase === 'vencida' && baja !== 'hecha' && (
          <button type="button" onClick={darDeBaja} disabled={baja === 'enviando'}
            className="cac-foco mt-8 text-[12.5px] underline rounded-lg" style={{ color: APAGADO }}>
            No deseo recibir más información
          </button>
        )}
        {baja === 'hecha' && <p className="mt-8 text-[12.5px]" style={{ color: APAGADO }}>No te enviaremos más información de este tipo. 🤍</p>}
        <p className="mt-8 text-[13px]" style={{ color: APAGADO }}>Camino al Cielo 🌿</p>
      </div>
    </Marco>
  )

  if (vista === 'RECORDATORIOS' || vista === 'CEDULAS') {
    return <PedidoOferta key={vista} codigo={codigo} oferta={oferta} categoria={vista} onVolver={volver} />
  }
  if (vista === 'PREEXEQUIALES') {
    return <PlanesOferta codigo={codigo} oferta={oferta} onVolver={volver} />
  }

  // ── Inicio: las tres opciones, cada una con su imagen ────────────────────
  const d = oferta.descuentos || {}
  const opciones = [
    {
      clave: 'RECORDATORIOS', titulo: 'Recordatorios adicionales', Icono: PawPrint,
      texto: `Piezas hechas a mano para conservar la memoria de ${oferta.mascota}.`,
      imagen: oferta.recordatorios?.find(p => p.foto_url)?.foto_url, descuento: d.RECORDATORIOS,
      hay: oferta.recordatorios?.length > 0,
    },
    {
      clave: 'PREEXEQUIALES', titulo: 'Planes preexequiales', Icono: ShieldCheck,
      texto: 'Para que las demás mascoticas de tu familia tengan asegurada una despedida digna.',
      imagen: oferta.planes?.find(p => p.imagen_url)?.imagen_url, descuento: d.PREEXEQUIALES,
      hay: oferta.planes?.length > 0 || !!oferta.solicitud_plan,
    },
    {
      clave: 'CEDULAS', titulo: 'Cédulas para mascotas', Icono: IdCard,
      texto: 'Su documento de identidad, con un código QR para que te avisen si se pierde.',
      imagen: oferta.cedulas?.find(p => p.foto_url)?.foto_url, descuento: d.CEDULAS,
      hay: oferta.cedulas?.length > 0,
    },
  ].filter(o => o.hay)

  return (
    <Marco>
      <div className="px-5 pt-9 pb-4 text-center max-w-xl mx-auto">
        <div className="text-[12px] font-bold tracking-[0.18em] uppercase" style={{ color: VERDE }}>Camino al Cielo</div>
        <h1 className="text-[24px] font-bold leading-tight mt-2" style={{ color: HONDO }}>
          {oferta.familia ? `${oferta.familia}, gracias por permitirnos acompañarte` : 'Gracias por permitirnos acompañarte'}
        </h1>
        <p className="text-[14.5px] mt-3 leading-relaxed" style={{ color: APAGADO }}>
          Fue un honor ser parte de la despedida de <strong style={{ color: TINTA }}>{oferta.mascota}</strong>. Con mucho respeto
          queremos compartirte algunas opciones para conservar sus recuerdos y para acompañar a las demás mascoticas de tu familia.
        </p>
      </div>

      <div className="px-4 pb-10 max-w-xl mx-auto w-full space-y-3">
        {opciones.map(o => (
          <button key={o.clave} type="button" onClick={() => { setVista(o.clave); window.scrollTo({ top: 0 }) }}
            className="cac-foco w-full text-left rounded-2xl border overflow-hidden flex items-stretch transition-shadow hover:shadow-md"
            style={{ background: 'white', borderColor: BORDE }}>
            <div className="w-28 sm:w-36 shrink-0 flex items-center justify-center" style={{ background: PAPEL2 }}>
              {o.imagen
                ? <img src={o.imagen} alt="" loading="lazy" className="w-full h-full object-cover" />
                : <o.Icono size={40} strokeWidth={1.5} style={{ color: VERDE }} aria-hidden="true" />}
            </div>
            <div className="flex-1 min-w-0 p-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-bold leading-snug" style={{ color: TINTA }}>{o.titulo}</h2>
                <ChevronRight size={18} className="shrink-0" style={{ color: VERDE }} />
              </div>
              <p className="text-[13px] leading-snug" style={{ color: APAGADO }}>{o.texto}</p>
              {o.descuento > 0 && <div><Etiqueta>{o.descuento}% de descuento</Etiqueta></div>}
            </div>
          </button>
        ))}

        {opciones.length === 0 && (
          <div className="rounded-2xl border p-6 text-center text-[14px]" style={{ background: 'white', borderColor: BORDE, color: APAGADO }}>
            Por ahora no tenemos opciones disponibles en línea. Escríbenos por WhatsApp y con mucho gusto te ayudamos.
          </div>
        )}

        {oferta.vence && (
          <p className="text-center text-[12.5px] pt-1" style={{ color: APAGADO }}>
            Estos descuentos están disponibles hasta el {new Date(oferta.vence).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}.
          </p>
        )}

        {/* «No deseo recibir información»: siempre a la mano, nunca escondido. */}
        <div className="pt-6 text-center">
          {baja === 'hecha' ? (
            <p className="text-[13px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: VERDE_SUAVE, color: VERDE }}>
              <Check size={14} /> No te enviaremos más información de este tipo.
            </p>
          ) : baja === 'confirmar' || baja === 'enviando' ? (
            <div className="rounded-2xl border p-4 text-left space-y-3" style={{ background: 'white', borderColor: BORDE }}>
              <p className="text-[13.5px]" style={{ color: TINTA }}>
                ¿Prefieres que no te enviemos más información de este tipo? Seguiremos aquí siempre que nos necesites.
              </p>
              <AvisoError texto={error} />
              <div className="flex gap-2">
                <button type="button" onClick={darDeBaja} disabled={baja === 'enviando'}
                  className="cac-foco flex-1 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-60" style={{ background: HONDO }}>
                  {baja === 'enviando' ? 'Guardando…' : 'Sí, no deseo recibir más'}
                </button>
                <button type="button" onClick={() => { setBaja(''); setError('') }} disabled={baja === 'enviando'}
                  className="cac-foco px-4 py-2.5 rounded-xl border text-[13px] font-semibold" style={{ borderColor: BORDE, color: TINTA }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setBaja('confirmar')}
              className="cac-foco text-[12.5px] underline rounded-lg" style={{ color: APAGADO }}>
              No deseo recibir más información
            </button>
          )}
        </div>
        <p className="text-center text-[13px] pt-4" style={{ color: APAGADO }}>Camino al Cielo 🌿</p>
      </div>
    </Marco>
  )
}
