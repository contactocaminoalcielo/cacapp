// Piezas compartidas del portal de la oferta posterior (/#/oferta/CODIGO).
// Misma piel botánica del catálogo público y del portal de fotos.
import { fmt } from '@/lib/utils'
import { PAPEL, TINTA, APAGADO, HONDO, VERDE, BORDE, ORO, ESTILOS } from '@/components/portal/Botanica'
import { AlertCircle, ChevronLeft, X } from 'lucide-react'

export const INPUT = 'w-full px-3.5 py-2.5 rounded-xl border text-[14px] outline-none cac-foco bg-white'
export const METODO_LABEL = { TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi', DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', OTRO: 'Otro' }
export const VERDE_SUAVE = '#E4EFE7'

export function Marco({ children }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAPEL }}>
      <style>{ESTILOS}</style>
      {children}
    </div>
  )
}

export function Campo({ label, opcional, children, error, ayuda }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1" style={{ color: TINTA }}>
        {label}{opcional ? <span className="font-normal" style={{ color: APAGADO }}> (opcional)</span> : ' *'}
      </label>
      {children}
      {ayuda && !error && <p className="text-[11.5px] mt-1" style={{ color: APAGADO }}>{ayuda}</p>}
      {error && <p className="text-[11.5px] mt-1 text-red-600">{error}</p>}
    </div>
  )
}

export function Tarjeta({ children, className = '' }) {
  return <div className={`rounded-2xl border p-4 sm:p-5 ${className}`} style={{ background: 'white', borderColor: BORDE }}>{children}</div>
}

/** Botones de elección única (especie, sexo, medio de pago…). */
export function Opciones({ opciones, valor, onChange, estirar = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map(o => {
        const v = typeof o === 'object' ? o.valor : o
        const l = typeof o === 'object' ? o.label : o
        return (
          <button key={String(v)} type="button" onClick={() => onChange(v)} aria-pressed={valor === v}
            className={`cac-foco px-3.5 py-2 rounded-xl border text-[13px] font-semibold ${estirar ? 'flex-1' : ''}`}
            style={valor === v ? { borderColor: VERDE, background: VERDE_SUAVE, color: VERDE } : { borderColor: BORDE, color: APAGADO }}>
            {l}
          </button>
        )
      })}
    </div>
  )
}

/** Precio con descuento: el de antes tachado, el nuevo en oro. */
export function Precio({ lista, precio, grande = false, sufijo = '' }) {
  const hayDescuento = lista > precio
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      {hayDescuento && <span className="text-[11.5px] line-through" style={{ color: APAGADO }}>{fmt(lista)}</span>}
      <span className={`${grande ? 'text-[20px]' : 'text-[15px]'} font-bold whitespace-nowrap`} style={{ color: ORO }}>
        {fmt(precio)}{sufijo && <span className="text-[11px] font-semibold" style={{ color: APAGADO }}> {sufijo}</span>}
      </span>
    </span>
  )
}

export function Etiqueta({ children }) {
  return (
    <span className="inline-block text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#FBEFD9', color: ORO }}>
      {children}
    </span>
  )
}

export function AvisoError({ texto, onCerrar }) {
  if (!texto) return null
  return (
    <div role="alert" className="flex items-start gap-2 px-4 py-3 rounded-xl text-[13px] border bg-red-50 border-red-200 text-red-700">
      <AlertCircle size={15} className="shrink-0 mt-0.5" /><span className="flex-1">{texto}</span>
      {onCerrar && <button type="button" aria-label="Cerrar" onClick={onCerrar}><X size={14} /></button>}
    </div>
  )
}

/** Encabezado de una sección, con el camino de vuelta al inicio de la oferta. */
export function Encabezado({ titulo, subtitulo, onVolver, refArriba }) {
  return (
    <div ref={refArriba} className="px-4 pt-5 pb-3 max-w-3xl mx-auto w-full">
      {onVolver && (
        <button type="button" onClick={onVolver}
          className="cac-foco text-[13px] font-semibold flex items-center gap-1 mb-3 rounded-lg" style={{ color: VERDE }}>
          <ChevronLeft size={15} /> Volver a las opciones
        </button>
      )}
      <div className="text-center">
        <div className="text-[12px] font-bold tracking-[0.18em] uppercase" style={{ color: VERDE }}>Camino al Cielo</div>
        <h1 className="text-[23px] font-bold leading-tight mt-1" style={{ color: HONDO }}>{titulo}</h1>
        {subtitulo && <p className="text-[13.5px] mt-1.5 max-w-md mx-auto" style={{ color: APAGADO }}>{subtitulo}</p>}
      </div>
    </div>
  )
}

/** Los pasos de un formulario largo: dónde va la familia y cuánto le falta. */
export function Pasos({ nombres, actual }) {
  return (
    <div className="flex items-center justify-center gap-1.5 px-4 mb-5 flex-wrap">
      {nombres.map((nombre, i) => (
        <span key={nombre} className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={i === actual ? { background: HONDO, color: 'white' }
            : i < actual ? { background: VERDE_SUAVE, color: VERDE } : { background: '#F1F0E6', color: APAGADO }}>
          {i + 1}. {nombre}
        </span>
      ))}
    </div>
  )
}
