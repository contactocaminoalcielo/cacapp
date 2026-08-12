// Plantillas de WhatsApp — cliente del backend.
//
// Las plantillas NO viven en Orbit: viven en la cuenta de WhatsApp (WABA) y es
// Meta quien decide si se aprueban. Por eso aquí no hay caché ni estado local —
// la lista se pide siempre a Meta a través del backend, que es el único que
// tiene el token.
import { orbitApi } from '@/lib/orbitApi'

export function listarPlantillas() {
  return orbitApi('/whatsapp/plantillas')
}

export function crearPlantilla(cuerpo) {
  return orbitApi('/whatsapp/plantillas', { method: 'POST', body: cuerpo })
}

export function borrarPlantilla(nombre) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}`, { method: 'DELETE' })
}

export function enviarPlantilla(nombre, cuerpo) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/enviar`, {
    method: 'POST', body: cuerpo,
  })
}

// ── Cómo se lee lo que devuelve Meta ─────────────────────────────────────────

export const ESTADOS = {
  APPROVED: { label: 'Aprobada',   clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING:  { label: 'En revisión', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { label: 'Rechazada',  clase: 'bg-red-50 text-red-700 border-red-200' },
  PAUSED:   { label: 'Pausada',    clase: 'bg-gray-100 text-gray-600 border-gray-200' },
  DISABLED: { label: 'Deshabilitada', clase: 'bg-gray-100 text-gray-600 border-gray-200' },
}

/**
 * Las tres categorías de Meta. La categoría no es una etiqueta: **decide cuánto
 * cuesta cada mensaje** y si hace falta consentimiento del destinatario.
 */
export const CATEGORIAS = [
  {
    valor: 'UTILITY', label: 'Utilidad',
    ayuda: 'Sobre algo que la persona ya pidió o compró: confirmar una recogida, avisar que los recordatorios están listos. Es la más barata.',
  },
  {
    valor: 'MARKETING', label: 'Marketing',
    ayuda: 'Promociones, novedades, reactivar clientes. Cuesta más y la persona puede darse de baja.',
  },
  {
    valor: 'AUTHENTICATION', label: 'Autenticación',
    ayuda: 'Solo códigos de verificación. No la uses para nada más.',
  },
]

export const IDIOMAS = [
  { valor: 'es_MX', label: 'Español (Latinoamérica)' },
  { valor: 'es',    label: 'Español' },
  { valor: 'es_ES', label: 'Español (España)' },
]

/** Las variables {{1}}, {{2}}… que aparecen en un texto, en orden y sin repetir. */
export function variablesDe(texto) {
  const n = [...String(texto || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
  return [...new Set(n)].sort((a, b) => a - b)
}

/** El componente de un tipo dentro de una plantilla de Meta. */
export const componente = (p, tipo) => (p?.components || []).find(c => c.type === tipo)

/**
 * Cuántas variables tiene el cuerpo. Es lo que hay que rellenar para enviarla.
 */
export function variablesDelCuerpo(plantilla) {
  return variablesDe(componente(plantilla, 'BODY')?.text)
}

/** Las variables del botón de enlace, si tiene uno dinámico. */
export function variablesDelBoton(plantilla) {
  const b = componente(plantilla, 'BUTTONS')?.buttons?.find(x => x.type === 'URL')
  return b ? variablesDe(b.url) : []
}

/** Sustituye {{1}}, {{2}}… por los valores dados, para la vista previa. */
export function conValores(texto, valores = []) {
  return String(texto || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = valores[Number(n) - 1]
    return v ? String(v) : `{{${n}}}`
  })
}

// ── Qué dato de Orbit va en cada variable (migración 097) ───────────────────
// Sin esto hay que teclear los valores en cada envío, y es justo lo que lleva a
// crear una plantilla por mascota con el texto quemado.

export function camposDisponibles() {
  return orbitApi('/whatsapp/plantillas-campos')
}

export function variablesDePlantilla(nombre, idioma = 'es_MX') {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/variables?idioma=${idioma}`)
}

export function guardarVariables(nombre, idioma, variables) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/variables`, {
    method: 'PUT', body: { idioma, variables },
  })
}

export function valoresDeServicio(nombre, servicioId, idioma = 'es_MX') {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/valores/${servicioId}?idioma=${idioma}`)
}
