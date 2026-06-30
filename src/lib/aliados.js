// Cliente del portal de aliados (orbit-backend). Endpoints públicos sin JWT:
// el token del enlace es el secreto, validado server-side. Mismo origen que el
// portal de imágenes (orbit.orbitacac.com/api → nginx → backend), sin CORS.
const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// Flujo A — valida el token del enlace y devuelve la veterinaria.
export const aliadoValidar = token => post('/portal/aliado/validar', { token })

// Flujo A — envía la solicitud de servicio (escribe en solicitudes_servicio).
// payload: { token, propietario, mascota, plan_id, recogida }
export const aliadoCrearSolicitud = payload => post('/portal/aliado/solicitud', payload)

// Flujo B — una veterinaria no aliada pide afiliación (queda pendiente).
export const aliadoAfiliacion = payload => post('/portal/aliado/afiliacion', payload)
