// Compras de recordatorios sin servicio — cliente del frontend.
//
// REPARTO (mismo criterio que lib/inventarioApi.js):
//   · Catálogos (recordatorios, especies, personal) y la búsqueda de clientes
//     y mascotas → PostgREST directo: son tablas viejas y es lectura.
//   · TODO lo que escribe la compra → orbit-backend, en transacción y con rol:
//     crearla, abonar, mover una línea, anular. Ver migración 168 y
//     orbit-backend/src/compras-recordatorios.js.
//
// Los archivos (comprobante del pago, foto de la mascota para la cédula) se
// suben al bucket `evidencias` bajo `compras-recordatorios/<compraId>/…` y en
// la base se guarda la RUTA, nunca una URL: las URL públicas viejas apuntaban al
// Supabase Cloud muerto (ver memoria feedback_comprobantes_dos_fuentes).
import { db } from '@/lib/supabase'
import { orbitApi, orbitApiBlob } from '@/lib/orbitApi'

export const METODOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO']

export const ESTADOS_ITEM = [
  { valor: 'PENDIENTE',  label: 'Pendiente',  bg: '#F3F4F6', text: '#4B5563', border: '#E5E7EB' },
  { valor: 'EN_PROCESO', label: 'En proceso', bg: '#EDE9FE', text: '#5B21B6', border: '#DDD6FE' },
  { valor: 'LISTO',      label: 'Listo',      bg: '#D1FAE5', text: '#065F46', border: '#A7F3D0' },
  { valor: 'ENTREGADO',  label: 'Entregado',  bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE' },
]
export const ESTADO_ITEM_META = Object.fromEntries(ESTADOS_ITEM.map(e => [e.valor, e]))

export const ESTADO_COMPRA = {
  PENDIENTE:     { label: 'Pendiente',     variant: 'gray'   },
  EN_PRODUCCION: { label: 'En producción', variant: 'purple' },
  LISTA:         { label: 'Lista',         variant: 'green'  },
  ENTREGADA:     { label: 'Entregada',     variant: 'blue'   },
  ANULADA:       { label: 'Anulada',       variant: 'red'    },
}

export const ESTADO_PAGO = {
  PENDIENTE: { label: 'Sin pagar', variant: 'red'   },
  PARCIAL:   { label: 'Abonado',   variant: 'amber' },
  COMPLETO:  { label: 'Pagado',    variant: 'green' },
}

// ── Backend ─────────────────────────────────────────────────────────────────

export function listarCompras({ q, estado, estadoPago, desde, hasta } = {}) {
  const p = new URLSearchParams()
  if (q)          p.set('q', q)
  if (estado)     p.set('estado', estado)
  if (estadoPago) p.set('estado_pago', estadoPago)
  if (desde)      p.set('desde', desde)
  if (hasta)      p.set('hasta', hasta)
  const qs = p.toString()
  return orbitApi(`/compras-recordatorios${qs ? `?${qs}` : ''}`)
}

export const detalleCompra = id => orbitApi(`/compras-recordatorios/${id}`)

/** El `id` lo genera el navegador (uuid) para que el reintento no duplique. */
export const crearCompra = body =>
  orbitApi('/compras-recordatorios', { method: 'POST', body })

export const registrarPago = (id, pago) =>
  orbitApi(`/compras-recordatorios/${id}/pagos`, { method: 'POST', body: pago })

export const actualizarItem = (id, itemId, patch) =>
  orbitApi(`/compras-recordatorios/${id}/items/${itemId}`, { method: 'POST', body: patch })

export const anularCompra = (id, motivo) =>
  orbitApi(`/compras-recordatorios/${id}/anular`, { method: 'POST', body: { motivo } })

/** ¿Esta línea es la cédula de mascota? Se decide por el nombre del catálogo. */
export const esCedula = nombre => /c[eé]dula/i.test(String(nombre || ''))

/**
 * Descarga el PDF de la cédula (orbit-backend, plantilla cedula-mascota.js).
 * El backend no puede leer el bucket privado: se le manda la URL FIRMADA de la
 * foto, que él baja e incrusta. Sin foto, la cédula sale con el recuadro vacío.
 */
export async function descargarCedula(compraId, itemId, fotoPath) {
  const foto = fotoPath ? await urlFirmada(fotoPath, 300) : null
  const blob = await orbitApiBlob('/pdf/cedula-mascota', { method: 'POST', body: { compra_id: compraId, item_id: itemId, foto } })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `Cedula_${compraId.slice(0, 6)}.pdf`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ── Catálogos y búsqueda (PostgREST) ────────────────────────────────────────

export async function cargarCatalogos() {
  const [{ data: recordatorios, error: e1 }, { data: especies }, { data: personal }] = await Promise.all([
    db.from('recordatorios')
      .select('id, nombre, categoria, precio_base, requiere_imagen, solo_nombre, max_fotos, campos_texto, activo')
      .eq('activo', true).order('nombre'),
    db.from('especies').select('id, nombre').order('nombre'),
    db.from('personal').select('id, nombre, apellido').eq('activo', true).order('nombre'),
  ])
  if (e1) throw e1
  return { recordatorios: recordatorios || [], especies: especies || [], personal: personal || [] }
}

export async function buscarClientes(q) {
  const { data, error } = await db.from('clientes')
    .select('id_cliente, nombre, apellido, cedula_nit, whatsapp, telefono, email, ciudad, mascotas(id_mascota)')
    .or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,cedula_nit.ilike.%${q}%,whatsapp.ilike.%${q}%`)
    .limit(10)
  if (error) throw error
  return data || []
}

export async function mascotasDeCliente(idCliente) {
  const { data, error } = await db.from('mascotas')
    .select('id_mascota, nombre, raza, sexo, tamano, peso_kg, fallecida, especie_id, especies(nombre)')
    .eq('cliente_id', idCliente)
    .order('nombre')
  if (error) throw error
  return data || []
}

// ── Archivos ────────────────────────────────────────────────────────────────

const MAX_MB = 8

/**
 * Sube un archivo al bucket `evidencias` y devuelve su RUTA.
 * `carpeta`: 'comprobantes' (pagos) o 'fotos' (imágenes de la mascota para el ítem).
 */
export async function subirArchivoCompra(compraId, file, carpeta = 'comprobantes') {
  const tipo = (file.type || '').toLowerCase()
  const esImagen = tipo.startsWith('image/')
  if (carpeta === 'fotos' && !esImagen) throw new Error('La foto debe ser una imagen.')
  if (!(esImagen || tipo === 'application/pdf')) throw new Error('El archivo debe ser una imagen o un PDF.')
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo supera ${MAX_MB} MB.`)
  const ext  = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] || 'jpg')
  const path = `compras-recordatorios/${compraId}/${carpeta}/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('evidencias')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error('No se pudo subir el archivo: ' + error.message)
  return path
}

export async function urlFirmada(path, segundos = 600) {
  if (!path) return null
  const { data } = await db.storage.from('evidencias').createSignedUrl(path, segundos)
  return data?.signedUrl || null
}
