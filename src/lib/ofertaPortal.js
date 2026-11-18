// Cliente del portal de la OFERTA POSTERIOR (orbit-backend, migr. 210).
// Endpoints públicos sin JWT: la llave es el código de la oferta, que llega en
// el enlace del botón de WhatsApp (/#/oferta/CODIGO).
//
// Las fotos y el comprobante se suben con `subirArchivoCompra` del catálogo
// público: es la misma carpeta temporal (compra-web/<borrador>/).
const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

async function llamar(codigo, ruta = '', body) {
  try {
    const res = await fetch(`${API_BASE}/portal/oferta/${encodeURIComponent(codigo)}${ruta}`, body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  } catch {
    return { status: 0, ok: false, error: 'red' }
  }
}

export const ofertaVer        = codigo            => llamar(codigo)
export const ofertaEvento     = (codigo, payload) => llamar(codigo, '/evento', payload)
export const ofertaBorrador   = codigo            => llamar(codigo, '/borrador', {})
export const ofertaComprar    = (codigo, payload) => llamar(codigo, '/compra', payload)
export const ofertaAfiliacion = (codigo, payload) => llamar(codigo, '/afiliacion', payload)
export const ofertaPagoPlan   = (codigo, payload) => llamar(codigo, '/afiliacion/pago', payload)
export const ofertaBaja       = codigo            => llamar(codigo, '/baja', {})

/** El texto que se le muestra a la familia cuando una llamada no sale bien. */
export function mensajeDeError(r, porDefecto = 'No se pudo completar. Intenta de nuevo.') {
  if (!r || r.status === 0) return 'Hubo un problema de conexión. Revisa tu internet e intenta de nuevo.'
  if (r.error === 'falta_autorizacion' || r.error === 'vencida' || r.error === 'ya_solicitada') return r.mensaje || porDefecto
  if (r.error === 'no_disponible') return 'Este enlace ya no está disponible. Escríbenos por WhatsApp y con gusto te ayudamos.'
  if (r.status >= 500) return 'Tuvimos un problema de nuestro lado. Intenta de nuevo en un momento.'
  return r.error || porDefecto
}
