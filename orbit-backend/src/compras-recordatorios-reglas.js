// Reglas puras de las compras de recordatorios — sin base de datos ni Express,
// para poder probarlas con `node --test` desde la raíz del repo
// (tests/compras-recordatorios.test.mjs). compras-recordatorios.js las importa.

export const METODOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO']
export const ESTADOS_ITEM = ['PENDIENTE', 'EN_PROCESO', 'LISTO', 'ENTREGADO']

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra }
}

export const t = (v, max = 200) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
export const num = v => {
  if (v === '' || v === null || v === undefined) return NaN
  return Number(String(v).replace(',', '.'))
}

// { "<label>": ["texto", ...] } — misma forma que servicio_recordatorios.datos_cliente
export function limpiarDatosCliente(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const out = {}
  for (const [k, v] of Object.entries(d)) {
    const key = t(k, 120)
    if (!key) continue
    const arr = (Array.isArray(v) ? v : [v]).map(x => t(x, 500)).filter(Boolean)
    if (arr.length) out[key] = arr
  }
  return Object.keys(out).length ? out : null
}

/**
 * Normaliza las líneas que manda el formulario contra el catálogo.
 *
 * `catalogo` es un mapa id → { nombre, precio_base, activo }. Devuelve las
 * líneas listas para insertar y el total. Lanza (400) ante cualquier cosa que
 * no deba llegar a la base: sin líneas, cantidad no entera, ítem inexistente o
 * inactivo, precio negativo.
 *
 * El precio lo puede fijar el coordinador (descuento, combo); si no lo manda,
 * es el del catálogo. El NOMBRE siempre sale del catálogo, nunca del navegador.
 */
export function normalizarItems(items, catalogo) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Agrega al menos un recordatorio a la compra.')
  }
  const out = []
  for (const it of items) {
    const rec = catalogo[it?.recordatorio_id]
    if (!rec) throw new HttpError(400, 'Uno de los recordatorios no existe en el catálogo.')
    if (rec.activo === false) throw new HttpError(400, `«${rec.nombre}» está inactivo en el catálogo.`)
    const cantidad = Number(it.cantidad ?? 1)
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
      throw new HttpError(400, `Cantidad inválida para «${rec.nombre}» (1 a 99).`)
    }
    const precio = it.precio_unitario === undefined || it.precio_unitario === null || it.precio_unitario === ''
      ? Number(rec.precio_base) || 0
      : num(it.precio_unitario)
    if (!Number.isFinite(precio) || precio < 0) {
      throw new HttpError(400, `Precio inválido para «${rec.nombre}».`)
    }
    out.push({
      recordatorio_id: it.recordatorio_id,
      nombre:          rec.nombre,
      cantidad,
      precio_unitario: Math.round(precio),
      datos_cliente:   limpiarDatosCliente(it.datos_cliente),
      notas:           t(it.notas, 1000),
    })
  }
  const total = out.reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
  return { items: out, total }
}

/**
 * Valida un pago contra lo que falta por cobrar. `saldo` = total − pagado.
 * Devuelve el pago limpio o lanza (400). Un pago no puede pasarse del saldo:
 * un sobrepago aquí no es "propina", es un error de dedo.
 */
export function validarPago(pago, saldo) {
  const monto = num(pago?.monto)
  if (!Number.isFinite(monto) || monto <= 0) throw new HttpError(400, 'El monto del pago debe ser mayor a cero.')
  if (monto > saldo + 0.5) {
    throw new HttpError(400, `El pago (${Math.round(monto)}) supera lo pendiente (${Math.round(saldo)}).`)
  }
  const metodo = String(pago?.metodo || '').toUpperCase()
  if (!METODOS_PAGO.includes(metodo)) throw new HttpError(400, 'Medio de pago inválido.')
  return {
    monto:            Math.round(monto),
    metodo,
    referencia:       t(pago?.referencia, 120),
    comprobante_path: t(pago?.comprobante_path, 500),
  }
}

/**
 * Estado general de una compra a partir de sus líneas. Es la misma regla que
 * el CASE del SQL de la lista; vive aquí para poder probarla y para que quien
 * lea el SQL sepa qué significa cada rama.
 */
export function estadoCompra({ anulada, n, entregados, listos, enProceso }) {
  if (anulada) return 'ANULADA'
  if (n > 0 && entregados === n) return 'ENTREGADA'
  if (n > 0 && listos + entregados === n) return 'LISTA'
  if (enProceso > 0 || listos > 0 || entregados > 0) return 'EN_PRODUCCION'
  return 'PENDIENTE'
}
