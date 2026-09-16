/**
 * Cómo se reparte el dinero de un recibo del técnico.
 *
 * Existe porque tres cosas distintas se estaban llamando igual ("el valor") y
 * el cuadre terminaba cobrándole al técnico plata que nunca le tocó cobrar:
 *
 *   · `precioServicio`  — lo que vale el servicio DESPUÉS de decidir la
 *     eutanasia. Si la cobró el doctor, ese monto no es de Camino: sale del
 *     servicio y por eso no puede quedar como saldo en la cartera.
 *   · `valorRecibo`     — lo que a ESTE técnico le tocaba cobrar. Es lo que se
 *     guarda en `recibos_tecnico.valor_total` y contra lo que el cuadre compara
 *     lo que recogió. Sin esto, desmarcar un adicional le generaba un faltante
 *     falso por ese mismo valor (bug del 7-sep, medido en producción).
 *   · `montoCliente` / `valorVetCobrar` — lo que se prellena como medio de pago
 *     según quién paga el recibo.
 *
 * Lo desmarcado NO se pierde: sigue vivo como saldo del servicio y se persigue
 * en la cartera de Finanzas. La eutanasia del doctor sí desaparece del servicio,
 * porque esa plata nunca fue nuestra.
 */
export function desgloseReciboTecnico({
  precioOriginal = 0,              // bruto del servicio reconstruido por el recibo
  saldoPendiente = 0,              // valor_total − valor_pagado
  valorEutanasia = 0,              // servicios.valor_eutanasia (0 = el total no la incluye)
  eutanasiaCobro = null,           // null | 'TECNICO' | 'VETERINARIO'
  adicionalesExcluidos = 0,        // adicionales que el técnico desmarcó
  comisionMonto = 0,
  descuentoInmediatoVet = false,
  comisionFueDescontada = false,
  aliadoFactMensual = false,
} = {}) {
  const n = v => Number(v) || 0
  // Solo sale del servicio lo que de verdad está dentro de su total.
  const fueraEutanasia = eutanasiaCobro === 'VETERINARIO' ? Math.max(0, n(valorEutanasia)) : 0
  const excluidos      = Math.max(0, n(adicionalesExcluidos))
  const precioServicio = Math.max(0, n(precioOriginal) - fueraEutanasia)
  const saldo          = Math.max(0, n(saldoPendiente) - fueraEutanasia)
  const valorRecibo    = Math.max(0, precioServicio - excluidos)
  // La vet de descuento inmediato paga el neto; las demás, el precio completo.
  const valorVet       = descuentoInmediatoVet
    ? Math.max(0, precioServicio - n(comisionMonto))
    : precioServicio
  const valorVetCobrar = Math.max(0, valorVet - excluidos)
  // Facturación mensual: el técnico no recoge nada (migr. 068).
  const montoCliente   = Math.max(0, (aliadoFactMensual ? 0
    : comisionFueDescontada ? precioServicio : saldo) - excluidos)
  return { fueraEutanasia, precioServicio, valorRecibo, valorVet, valorVetCobrar, montoCliente }
}
