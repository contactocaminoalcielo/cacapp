// Cliente del portal de aliados (orbit-backend). Endpoints públicos sin JWT:
// el token del enlace es el secreto, validado server-side. Mismo origen que el
// portal de imágenes (orbit.orbitacac.com/api → nginx → backend), sin CORS.
const API_BASE = import.meta.env.VITE_ORBIT_API_URL || 'https://orbit.orbitacac.com/api'

// Columnas de `aliados` que el navegador puede leer: TODAS menos `token_acceso`,
// la llave del portal de cada veterinaria (migr. 194: solo la ve el backend).
// `select('*')` sobre aliados FALLA (permiso de columna): usar esta lista.
// ⚠️ Al agregar una columna a aliados, agrégala aquí Y en el GRANT de la 194.
export const ALIADOS_COLUMNAS = [
  'id_aliado', 'nombre', 'identificacion_nit', 'email', 'telefono', 'whatsapp', 'contacto_nombre',
  'tipo_establecimiento_id', 'ciudad', 'localidad', 'barrio', 'direccion', 'vip', 'numero_sedes',
  'rut_url', 'logo_url', 'modalidad_comision', 'saldo_comision', 'facturacion_mensual', 'notas',
  'activo', 'created_at', 'updated_at', 'horario', 'estado', 'validado_por', 'validado_at',
  'telefono_2', 'contacto_cargo', 'contacto_email', 'contacto_2_nombre', 'contacto_2_telefono',
  'instagram', 'sitio_web', 'atiende_24h', 'num_veterinarios', 'servicios_clinica',
  'referencia_ubicacion', 'lat', 'lng', 'comercial_id', 'notas_comerciales', 'ficha_actualizada_en',
  'ficha_actualizada_por', 'no_contactar', 'no_contactar_motivo', 'no_contactar_desde',
  'no_contactar_por', 'tiene_acceso',
].join(',')

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
