// Estado de pago de los adicionales, igual en Producción, Preparar entrega y el
// mensajero (REPORTES ORBIT 23-nov). El cálculo vive en lib/pagoAdicionalesCalculo.js;
// aquí solo se pinta y se ofrece la única marca manual (migr. 217).
import { useState } from 'react'
import { fmt } from '@/lib/utils'
import { etiquetaPagoConcepto, marcarPagoEnVeterinaria, ESTADO_PAGO_ITEM } from '@/lib/pagoAdicionales'

const CORTO = {
  [ESTADO_PAGO_ITEM.PAGADO]:             'Pagado',
  [ESTADO_PAGO_ITEM.PAGADO_VETERINARIA]: 'Pagado (vet)',
  [ESTADO_PAGO_ITEM.PENDIENTE]:          'Por cobrar',
  [ESTADO_PAGO_ITEM.PARCIAL]:            'Por cobrar',
}

/** Chip compacto para pills y tablas. `concepto` = pago.porItem[itemId]. */
export function PagoTag({ concepto, largo = false }) {
  const et = etiquetaPagoConcepto(concepto, fmt)
  if (!et || concepto.estado === ESTADO_PAGO_ITEM.SIN_COSTO) return null
  return (
    <span title={et.texto}
      style={{
        background: et.bg, color: et.color, border: `1px solid ${et.borde}`,
        borderRadius: 999, padding: largo ? '2px 8px' : '0 5px', fontSize: largo ? 11 : 9,
        fontWeight: 800, lineHeight: largo ? '16px' : '14px', whiteSpace: 'nowrap',
      }}>
      {largo ? et.texto : CORTO[concepto.estado]}
    </span>
  )
}

/** Resumen de a quién le corresponde el saldo del servicio. */
export function ResumenSaldoServicio({ pago, compacto = false }) {
  if (!pago || !(pago.saldo > 0)) return null
  const vet = pago.aliadoNombre || 'la veterinaria'
  return (
    <div className={compacto ? 'flex flex-wrap gap-1.5' : 'grid gap-2 sm:grid-cols-2'}>
      <div className="rounded-xl px-3 py-2" style={{ background: pago.pendientePropietario > 0 ? '#FFFBEB' : '#F0FDF4', border: `1px solid ${pago.pendientePropietario > 0 ? '#FDE68A' : '#BBF7D0'}` }}>
        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: pago.pendientePropietario > 0 ? '#92400E' : '#166534' }}>
          Pago del propietario
        </div>
        <div className="text-[13px] font-extrabold" style={{ color: pago.pendientePropietario > 0 ? '#B45309' : '#15803D' }}>
          {pago.pendientePropietario > 0 ? `Debe ${fmt(pago.pendientePropietario)}` : 'Al día — no se le cobra nada'}
        </div>
      </div>
      {pago.saldoVeterinaria > 0 && (
        <div className="rounded-xl px-3 py-2" style={{ background: '#F0FDFA', border: '1px solid #99F6E4' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#115E59' }}>
            Saldo de {vet} con Camino al Cielo
          </div>
          <div className="text-[13px] font-extrabold" style={{ color: '#0F766E' }}>{fmt(pago.saldoVeterinaria)}</div>
          <div className="text-[10px]" style={{ color: '#0F766E' }}>Lo cobra coordinación a la veterinaria. No se le cobra al propietario.</div>
        </div>
      )}
    </div>
  )
}

/**
 * Panel del estado de pago de UN adicional, con la marca «el propietario ya lo pagó
 * en la veterinaria» cuando el servicio viene de una veterinaria.
 */
export function PanelPagoAdicional({ servicioId, item, pago, personalId, onCambio }) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const c = pago?.porItem?.[item.id]
  if (!c) return null
  const et = etiquetaPagoConcepto(c, fmt)
  const marcado = c.motivoVeterinaria === 'MARCADO'
  const porRecibo = c.motivoVeterinaria === 'RECIBO_VET'
  // También se ofrece para negar la regla del recibo (marcado por recibo → desmarcar)
  // y para volver a marcar uno que se negó.
  const puedeMarcar = pago.esVet && c.precio > 0
    && (marcado || porRecibo || c.negadoVeterinaria || c.estado === ESTADO_PAGO_ITEM.PENDIENTE || c.estado === ESTADO_PAGO_ITEM.PARCIAL)
  const activo = marcado || porRecibo

  async function cambiar(valor) {
    setGuardando(true); setError('')
    try {
      await marcarPagoEnVeterinaria({ servicioId, item: { id: item.id, nombre: c.nombre }, pagado: valor, personalId, aliadoNombre: pago.aliadoNombre })
      await onCambio?.()
    } catch (e) { setError(e.message || 'No se pudo guardar') }
    finally { setGuardando(false) }
  }

  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: et?.borde || '#E5E7EB' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Estado de pago</span>
        <PagoTag concepto={c} largo />
      </div>
      <div className="text-[11px] text-gray-500">
        Valor del adicional: <b>{fmt(c.precio)}</b>
        {c.abonado > 0 && <> · abonado: <b>{fmt(c.abonado)}</b></>}
      </div>
      {porRecibo && (
        <p className="text-[11px]" style={{ color: '#115E59' }}>
          Ya estaba en el servicio cuando se hizo el recibo de la veterinaria: se asume que la clínica se lo cobró al
          propietario. Si no fue así, desmarca la casilla.
        </p>
      )}
      {c.dudoso && (
        <p className="text-[11px]" style={{ color: '#92400E' }}>
          El servicio tiene pagos sin concepto aparte del recibo del técnico: uno pudo ser este adicional. Confírmalo antes
          de cobrarlo (si ya lo pagó, regístralo en Finanzas atado a este ítem).
        </p>
      )}
      {puedeMarcar && (
        <label className="flex items-start gap-2 text-[12px] font-semibold text-gray-700 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={activo} disabled={guardando}
            onChange={e => cambiar(e.target.checked)} />
          <span>
            El propietario ya lo pagó en la veterinaria
            <span className="block text-[11px] font-normal text-gray-500">
              No se le cobra en la entrega; el valor queda en el saldo de la veterinaria con Camino al Cielo.
            </span>
          </span>
        </label>
      )}
      {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
    </div>
  )
}
