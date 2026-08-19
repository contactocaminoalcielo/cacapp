// Envíos masivos de plantillas — cliente del backend (migración 104).
//
// Lo que hay que entender antes de tocar esta pantalla: **esto no se puede
// deshacer**. Por eso el circuito tiene dos tiempos a propósito — crear arma la
// lista y NO manda nada; hace falta un segundo acto deliberado para empezar.
// Todo lo demás (el ritmo, la pausa, el detalle por destinatario) existe para
// que ese segundo acto no dé miedo.
import { orbitApi } from '@/lib/orbitApi'

export const listarAudiencias = () => orbitApi('/whatsapp/audiencias')

/** A cuántos iría y qué huecos quedarían en blanco. NO manda nada. */
export const previsualizar = (cuerpo) =>
  orbitApi('/whatsapp/campanas/previsualizar', { method: 'POST', body: cuerpo })

/** Crea la campaña con su lista ya armada, en BORRADOR. Tampoco manda nada. */
export const crearCampana = (cuerpo) =>
  orbitApi('/whatsapp/campanas', { method: 'POST', body: cuerpo })

export const listarCampanas = () => orbitApi('/whatsapp/campanas')

export const verCampana = (id, estado) =>
  orbitApi(`/whatsapp/campanas/${id}${estado ? `?estado=${estado}` : ''}`)

/** iniciar · pausar · reanudar · cancelar */
export const accionCampana = (id, accion) =>
  orbitApi(`/whatsapp/campanas/${id}/${accion}`, { method: 'POST' })

export const borrarCampana = (id) =>
  orbitApi(`/whatsapp/campanas/${id}`, { method: 'DELETE' })

export const ESTADOS_CAMPANA = {
  BORRADOR:  { label: 'Sin empezar', clase: 'bg-gray-100 text-gray-600 border-gray-200' },
  EN_CURSO:  { label: 'Enviando',    clase: 'bg-blue-50 text-[#1A5CD8] border-blue-200' },
  PAUSADA:   { label: 'Pausada',     clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  TERMINADA: { label: 'Terminada',   clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELADA: { label: 'Cancelada',   clase: 'bg-gray-100 text-gray-500 border-gray-200' },
}

export const ESTADOS_DESTINO = {
  PENDIENTE: { label: 'En cola',  clase: 'text-gray-400' },
  ENVIADO:   { label: 'Enviado',  clase: 'text-emerald-600' },
  FALLIDO:   { label: 'Falló',    clase: 'text-red-600' },
  OMITIDO:   { label: 'Saltado',  clase: 'text-amber-600' },
}

/**
 * Cuánto va a tardar, en palabras.
 *
 * Se enseña ANTES de arrancar porque es la mitad de la decisión: 203 mensajes a
 * 200 por hora es "toda la mañana", y eso cambia si el aviso es urgente.
 */
export function cuantoTarda(total, porHora) {
  if (!total || !porHora) return ''
  const minutos = Math.ceil((total / porHora) * 60)
  if (minutos <= 1) return 'menos de un minuto'
  if (minutos < 60) return `unos ${minutos} minutos`
  const horas = minutos / 60
  if (horas < 2) return 'algo más de una hora'
  if (horas < 10) return `unas ${Math.round(horas)} horas`
  return `unos ${Math.round(horas / 24 * 10) / 10} días`
}
