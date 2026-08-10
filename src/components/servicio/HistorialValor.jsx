import { useEffect, useState } from 'react'
import { fmt, fmtDateTime } from '@/lib/utils'
import { trazaValorServicio, MOTIVO_VALOR_LABEL } from '@/lib/servicios'

const ICONO = {
  PESO:         '⚖️',
  PLAN:         '📋',
  ADICIONAL:    '➕',
  ITEM_QUITADO: '➖',
  COMISION:     '🏥',
  CORRECCION:   '✏️',
}

/**
 * Cadena de cambios del valor a cobrar de un servicio: de cuánto partió, qué lo
 * movió y en cuánto quedó. Va en la parte de pago porque es ahí donde alguien
 * pregunta "¿por qué cobra esto?" — antes había que abrir la línea de tiempo
 * completa y leer frases sueltas, y los cambios hechos desde el interruptor de
 * comisión ni siquiera aparecían.
 *
 * Si el total actual NO coincide con el último cambio registrado, se avisa: es
 * la señal de que alguien movió el valor por un camino que no deja rastro (así
 * se perdió el del caso BRUNO). No es una acusación, es un "revísalo".
 *
 * Sin cambios registrados no renderiza nada: el valor nunca se movió y la caja
 * de pago ya muestra el total.
 */
export default function HistorialValor({ servicioId, valorTotal, className = '' }) {
  const [pasos, setPasos]     = useState(null)   // null = cargando

  useEffect(() => {
    let vivo = true
    setPasos(null)
    trazaValorServicio(servicioId).then(r => { if (vivo) setPasos(r) })
    return () => { vivo = false }
  }, [servicioId])

  if (!pasos || !pasos.length) return null

  const inicial   = Number(pasos[0].valor_antes) || 0
  const ultimo    = Number(pasos[pasos.length - 1].valor_despues) || 0
  const actual    = Number(valorTotal) || 0
  const descuadre = Math.abs(actual - ultimo) > 0.5

  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/70 p-3 ${className}`}>
      <div className="text-[11px] font-bold text-gray-600 mb-2">Cómo cambió el valor a cobrar</div>

      <div className="flex items-baseline justify-between text-[11px] text-gray-500 pb-1.5">
        <span>Valor inicial</span>
        <span className="font-semibold text-gray-700 tabular-nums">{fmt(inicial)}</span>
      </div>

      {pasos.map(p => {
        const antes  = Number(p.valor_antes) || 0
        const desp   = Number(p.valor_despues) || 0
        const sube   = desp > antes
        const quien  = p.personal ? `${p.personal.nombre || ''} ${p.personal.apellido || ''}`.trim() : ''
        return (
          <div key={p.id} className="border-t border-gray-200 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-gray-600">
                {ICONO[p.motivo_valor] || '•'}{' '}
                {MOTIVO_VALOR_LABEL[p.motivo_valor] || 'Cambio de valor'}
              </span>
              <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap"
                style={{ color: sube ? '#B45309' : '#15803D' }}>
                {fmt(antes)} → {fmt(desp)}
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {fmtDateTime(p.created_at)}{quien ? ` · ${quien}` : ''}
            </div>
            {p.descripcion && (
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{p.descripcion}</div>
            )}
          </div>
        )
      })}

      <div className="flex items-baseline justify-between border-t-2 border-gray-300 pt-1.5 mt-0.5">
        <span className="text-[11px] font-bold text-gray-700">Total actual</span>
        <span className="text-[12px] font-extrabold text-gray-900 tabular-nums">{fmt(actual)}</span>
      </div>

      {descuadre && (
        <div className="mt-2 text-[10px] leading-snug rounded-lg px-2 py-1.5"
          style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}>
          <b>⚠ Hay un cambio sin registrar.</b> El último movimiento anotado dejó el valor en{' '}
          <b>{fmt(ultimo)}</b>, pero hoy el servicio cobra <b>{fmt(actual)}</b>{' '}
          ({actual > ultimo ? '+' : '−'}{fmt(Math.abs(actual - ultimo))}). Alguien lo movió por
          fuera de los caminos que dejan traza — vale la pena confirmarlo antes de cobrar.
        </div>
      )}
    </div>
  )
}
