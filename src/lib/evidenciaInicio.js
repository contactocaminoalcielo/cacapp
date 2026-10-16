// Evidencias del inicio del compostaje (migración 178).
// Todo va por orbit-backend: el marco lo dibuja el servidor y el envío pasa
// por la plantilla de Meta. Aquí solo se piden las cosas.
import { orbitApi, orbitApiBlob } from '@/lib/orbitApi'

export const ESTADO_EVIDENCIA = {
  POR_REVISAR: { label: 'Por revisar', color: '#9A5500', bg: '#FFF3DC' },
  ENVIADO:     { label: 'Enviada',     color: '#1D8A55', bg: '#E8F3EB' },
  ERROR:       { label: 'Error',       color: '#C03030', bg: '#FEE8E8' },
  DESCARTADA:  { label: 'Descartada',  color: '#6B7280', bg: '#F3F4F6' },
}

export const listarEvidencias = (estado = 'PENDIENTES') =>
  orbitApi(`/evidencias?estado=${encodeURIComponent(estado)}`)

/** La Jornada lo llama al iniciar el proceso. Best-effort: nunca bloquea. */
export function prepararEvidencia(servicioId) {
  return orbitApi('/evidencias/preparar', { method: 'POST', body: { servicio_id: servicioId } })
    .catch(e => console.warn('[evidencias] no se preparó:', e?.message))
}

/** El marco como Blob. Con `ajustes` es la vista previa sin guardar. */
export const imagenEvidencia = (id, ajustes = null) =>
  orbitApiBlob(`/evidencias/${id}/imagen`, { method: 'POST', body: { ajustes } })

export const guardarAjustesEvidencia = (id, ajustes) =>
  orbitApi(`/evidencias/${id}`, { method: 'PUT', body: ajustes })

export const enviarEvidencia = (id, ajustes) =>
  orbitApi(`/evidencias/${id}/enviar`, { method: 'POST', body: { ajustes } })

export const marcarEvidenciaManual = id =>
  orbitApi(`/evidencias/${id}/manual`, { method: 'POST' })

export const descartarEvidencia = id =>
  orbitApi(`/evidencias/${id}/descartar`, { method: 'POST' })
