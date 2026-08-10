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

const signo = d => (d > 0 ? '+' : '−')

/**
 * Un tramo donde el valor se movió SIN que quedara registrado: lo que dejó el
 * paso anterior no coincide con lo que encontró el siguiente (o con lo que
 * cobra hoy el servicio). Es la huella de un camino que no deja traza — así se
 * perdió el rastro del caso BRUNO — y por eso se muestra como un renglón más de
 * la cadena, en su lugar cronológico, no como una nota al pie.
 */
function Salto({ de, a, desde, hasta }) {
  const delta = a - de
  return (
    <div className="border-t border-dashed border-amber-300 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold" style={{ color: '#92400E' }}>
          ⚠ Cambio sin registrar
        </span>
        <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap" style={{ color: '#92400E' }}>
          {fmt(de)} → {fmt(a)}
        </span>
      </div>
      <div className="text-[10px] mt-0.5 leading-snug" style={{ color: '#B45309' }}>
        {signo(delta)}{fmt(Math.abs(delta))} que nadie anotó
        {desde && hasta && <> · entre {fmtDateTime(desde)} y {fmtDateTime(hasta)}</>}
        {desde && !hasta && <> · después de {fmtDateTime(desde)}</>}
      </div>
    </div>
  )
}

/**
 * Cadena de cambios del valor a cobrar de un servicio: de cuánto partió, qué lo
 * movió y en cuánto quedó. Va en la parte de pago porque es ahí donde alguien
 * pregunta "¿por qué cobra esto?" — antes había que abrir la línea de tiempo
 * completa y leer frases sueltas, y los cambios hechos desde el interruptor de
 * comisión ni siquiera aparecían.
 *
 * Sin cambios registrados no renderiza nada: el valor nunca se movió y la caja
 * de pago ya muestra el total.
 */
export default function HistorialValor({ servicioId, valorTotal, className = '' }) {
  const [pasos, setPasos] = useState(null)   // null = cargando

  useEffect(() => {
    let vivo = true
    setPasos(null)
    trazaValorServicio(servicioId).then(r => { if (vivo) setPasos(r) })
    return () => { vivo = false }
  }, [servicioId])

  if (!pasos || !pasos.length) return null

  const num     = v => Number(v) || 0
  const inicial = num(pasos[0].valor_antes)
  const ultimo  = num(pasos[pasos.length - 1].valor_despues)
  const actual  = num(valorTotal)

  // Se arma una sola lista en orden cronológico intercalando los cambios
  // registrados con los saltos que quedaron entre ellos. El último salto (el que
  // va del final de la cadena al total de hoy) es el mismo caso, así que se trata
  // igual en vez de tener dos avisos distintos.
  const filas = []
  pasos.forEach((p, i) => {
    const previo = i === 0 ? null : pasos[i - 1]
    if (previo && Math.abs(num(p.valor_antes) - num(previo.valor_despues)) > 0.5) {
      filas.push({
        tipo: 'salto', clave: `s-${p.id}`,
        de: num(previo.valor_despues), a: num(p.valor_antes),
        desde: previo.created_at, hasta: p.created_at,
      })
    }
    filas.push({ tipo: 'paso', clave: p.id, p })
  })
  if (Math.abs(actual - ultimo) > 0.5) {
    filas.push({
      tipo: 'salto', clave: 'salto-final',
      de: ultimo, a: actual,
      desde: pasos[pasos.length - 1].created_at, hasta: null,
    })
  }
  const saltos = filas.filter(f => f.tipo === 'salto').length

  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/70 p-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-bold text-gray-600">Cómo cambió el valor a cobrar</span>
        {saltos > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>
            {saltos === 1 ? '1 cambio sin registrar' : `${saltos} cambios sin registrar`}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between text-[11px] text-gray-500 pb-1.5">
        <span>Valor inicial</span>
        <span className="font-semibold text-gray-700 tabular-nums">{fmt(inicial)}</span>
      </div>

      {filas.map(f => {
        if (f.tipo === 'salto') {
          return <Salto key={f.clave} de={f.de} a={f.a} desde={f.desde} hasta={f.hasta} />
        }
        const p     = f.p
        const antes = num(p.valor_antes)
        const desp  = num(p.valor_despues)
        const quien = p.personal ? `${p.personal.nombre || ''} ${p.personal.apellido || ''}`.trim() : ''
        return (
          <div key={f.clave} className="border-t border-gray-200 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-gray-600">
                {ICONO[p.motivo_valor] || '•'}{' '}
                {MOTIVO_VALOR_LABEL[p.motivo_valor] || 'Cambio de valor'}
              </span>
              <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap"
                style={{ color: desp > antes ? '#B45309' : '#15803D' }}>
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

      {saltos > 0 && (
        <div className="mt-2 text-[10px] leading-snug rounded-lg px-2 py-1.5"
          style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}>
          Los tramos marcados en ámbar son plata que se movió por fuera de los caminos que dejan
          traza. Vale la pena confirmar el valor antes de cobrar.
        </div>
      )}
    </div>
  )
}
