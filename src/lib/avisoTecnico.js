// WhatsApp automático al técnico al asignarle un servicio (migr. 228).
//
// Se llama DESPUÉS de guardar el técnico, desde los tres sitios donde
// coordinación asigna: Registro (nuevo servicio), Kanban → convertir solicitud y
// Kanban → ficha. El backend lee de la base quién es el técnico, su WhatsApp y
// el cobro; aquí solo se manda el servicio y desde dónde se asignó.
//
// Nunca lanza: el técnico ya quedó asignado y eso no se puede deshacer porque
// Meta esté caída. Lo que pase se traduce a un texto para el coordinador.
import { orbitApi } from '@/lib/orbitApi'

export async function avisarTecnicoAsignado(servicioId, origen) {
  if (!servicioId) return null
  try {
    return await orbitApi(`/servicios/${servicioId}/aviso-tecnico`, { method: 'POST', body: { origen } })
  } catch (e) {
    return { enviado: false, motivo: 'error_red', error: e?.message || String(e) }
  }
}

// Motivos que NO son un problema que el coordinador tenga que resolver:
// el flujo está apagado, ya se le avisó hace un momento, o la recogida ya pasó.
const SILENCIOSOS = new Set(['apagado', 'sin_plantilla', 'ya_enviado', 'ya_recogido', 'sin_tecnico', 'sin_servicio'])

const RAZON = {
  sin_whatsapp:     'no tiene un WhatsApp válido en Personal',
  tecnico_inactivo: 'está inactivo en Personal',
  sin_linea:        'la línea de veterinarias no está configurada',
  error_envio:      'Meta rechazó el envío',
  error_interno:    'falló el servidor de Orbit',
  error_red:        'no hubo conexión con el servidor de Orbit',
}

/**
 * `{ ok, texto }` para mostrar, o null si no hay nada que decir.
 * `nombre` = cómo se llama el técnico en pantalla (por si el backend no lo trae).
 */
export function resultadoAvisoTecnico(r, nombre = '') {
  if (!r) return null
  const quien = (r.tecnico || nombre || '').trim().split(/\s+/)[0] || 'El técnico'
  if (r.enviado) return { ok: true, texto: `📲 ${quien} recibió por WhatsApp los datos del servicio y el cobro.` }
  if (SILENCIOSOS.has(r.motivo)) return null
  const razon = RAZON[r.motivo] || r.error || 'no se pudo enviar'
  return { ok: false, texto: `⚠️ No le llegó el WhatsApp a ${quien}: ${razon}. Avísale con «Notificar técnico» en la tarjeta.` }
}
