// Plantillas de WhatsApp — cliente del backend.
//
// Las plantillas NO viven en Orbit: viven en la cuenta de WhatsApp (WABA) y es
// Meta quien decide si se aprueban. Por eso aquí no hay caché ni estado local —
// la lista se pide siempre a Meta a través del backend, que es el único que
// tiene el token.
//
// Lo que SÍ vive en Orbit es el mapeo: qué dato nuestro rellena cada hueco
// (migraciones 097 y 102). Ver `orbit-backend/src/whatsapp-plantillas.js`.
import { orbitApi } from '@/lib/orbitApi'

/**
 * Las plantillas de la cuenta del agente.
 *
 * Una plantilla vive en una WABA y sale por una línea, y las dos cosas son del
 * AGENTE (migración 115). Sin decir cuál, se usa la del `.env` — que es lo que
 * hubo siempre y acertaba mientras hubo un solo agente.
 */
export function listarPlantillas(agenteId = null) {
  return orbitApi(`/whatsapp/plantillas${agenteId ? `?agenteId=${agenteId}` : ''}`)
}

export function crearPlantilla(cuerpo) {
  return orbitApi('/whatsapp/plantillas', { method: 'POST', body: cuerpo })
}

/**
 * Cambiar el texto de una plantilla que ya existe.
 *
 * Durante meses se dio por hecho que no se podía y que había que borrarla y
 * recrearla. Comprobado contra la API el 2026-08-19: sí se puede. Vuelve a
 * revisión de Meta, pero **conserva el nombre**, y con él todo el mapeo de
 * datos (que va por nombre + idioma, no por el id de Meta).
 */
export function editarPlantilla(nombre, cuerpo) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/editar`, {
    method: 'POST', body: cuerpo,
  })
}

export function borrarPlantilla(nombre, agenteId = null) {
  return orbitApi(
    `/whatsapp/plantillas/${encodeURIComponent(nombre)}${agenteId ? `?agenteId=${agenteId}` : ''}`,
    { method: 'DELETE' })
}

export function enviarPlantilla(nombre, cuerpo) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/enviar`, {
    method: 'POST', body: cuerpo,
  })
}

/**
 * Sube la imagen/video/PDF de una cabecera.
 *
 * Devuelve el `handle` que Meta pide para APROBAR la plantilla y el
 * `material_id` del archivo guardado, que es el que se manda en CADA envío:
 * Meta no reutiliza el del alta. Antes solo devolvía el handle y la plantilla
 * nacía sin archivo con el que enviarse.
 *
 * `soloGuardar` para una plantilla que ya existe: solo le falta el archivo del
 * envío, no otro handle.
 */
export function subirCabecera({ base64, mime, nombre, agenteId = null, plantilla = null, soloGuardar = false }) {
  return orbitApi('/whatsapp/plantillas-cabecera', {
    method: 'POST', body: { base64, mime, nombre, agenteId, plantilla, soloGuardar },
  })
}

/** Guarda qué material se vuelve a subir para cada tarjeta al enviar. */
export function guardarTarjetas(nombre, idioma, agenteId, tarjetas) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/tarjetas`, {
    method: 'PUT', body: { idioma, agenteId, tarjetas },
  })
}

/** Concede o revoca al agente el permiso de usar una plantilla aprobada. */
export function autorizarPlantilla(nombre, {
  agenteId, idioma = 'es_MX', clave = null, descripcion = null, activa = true,
}) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/agente`, {
    method: 'PUT', body: { agenteId, idioma, clave, descripcion, activa },
  })
}

/** Qué archivo acompaña a la cabecera al ENVIAR. `null` lo quita. */
export function asignarCabecera(nombre, idioma, { materialId = null, url = null } = {}, agenteId = null) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/cabecera`, {
    method: 'PUT', body: { idioma, materialId, url, agenteId },
  })
}

/** Buscar el servicio del que salen los datos (mascota, familia, código). */
export function buscarServicios(q) {
  return orbitApi(`/whatsapp/plantillas-servicios?q=${encodeURIComponent(q)}`)
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

/**
 * Los dos modos de nombrar los huecos (`parameter_format`).
 *
 * Con nombre es mejor casi siempre: el hueco dice qué es, el mapeo se lee solo
 * y reordenar una frase no desalinea los datos. Numerado se queda porque es lo
 * que usan las plantillas que ya existen.
 */
export const FORMATOS = [
  {
    valor: 'NAMED', label: 'Con nombre',
    ejemplo: '{{mascota}}',
    ayuda: 'El hueco dice qué es. Si mueves una frase de sitio, el dato la sigue.',
  },
  {
    valor: 'POSITIONAL', label: 'Numeradas',
    ejemplo: '{{1}}',
    ayuda: 'El orden manda. Si intercambias dos frases, hay que renumerar todo.',
  },
]

/** Qué puede llevar el título de una plantilla. */
export const CABECERAS = [
  {
    valor: '', label: 'Sin nada',
    ayuda: 'El mensaje sale sin nada arriba. Para mandar un archivo CON la plantilla —el brochure, '
      + 'el tarifario, una foto— elige Imagen, Video o Documento.',
  },
  { valor: 'TEXT',     label: 'Texto',     ayuda: 'Una línea en negrita arriba. Admite como mucho una variable.' },
  { valor: 'IMAGE',    label: 'Imagen',    ayuda: 'JPG o PNG. Hay que subirla aquí: Meta no acepta una URL al crear la plantilla.' },
  { valor: 'VIDEO',    label: 'Video',     ayuda: 'MP4. Se sube igual que la imagen.' },
  { valor: 'DOCUMENT', label: 'Documento', ayuda: 'PDF. Útil para mandar el brochure o el tarifario con el mensaje.' },
  { valor: 'LOCATION', label: 'Ubicación', ayuda: 'La dirección se manda en cada envío, no se fija aquí.' },
]

export const esMedia = f => ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(f)

/** Los tipos de botón que Meta admite (fuera de autenticación). */
export const BOTONES = [
  { tipo: 'QUICK_REPLY',  label: 'Respuesta rápida', ayuda: 'Al tocarlo, la persona nos escribe: eso REABRE la ventana de 24 horas y deja conversar sin gastar otra plantilla.' },
  { tipo: 'URL',          label: 'Enlace',           ayuda: 'Abre una página. Puede llevar una variable para que cada persona reciba su propio enlace.' },
  { tipo: 'PHONE_NUMBER', label: 'Llamar',           ayuda: 'Marca un número. Uno como mucho por plantilla.' },
  { tipo: 'COPY_CODE',    label: 'Copiar código',    ayuda: 'Copia un código al portapapeles (un cupón, por ejemplo).' },
]

/**
 * Los huecos que aparecen en un texto, en orden de aparición y sin repetir.
 *
 * Devuelve SIEMPRE cadenas: `'1'` o `'mascota'`. Quien necesite el número lo
 * convierte — mezclarlos aquí es lo que hace que un `{{2}}` acabe en el hueco
 * del `{{1}}`.
 */
export function huecosDe(texto) {
  const vistos = []
  for (const m of String(texto || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!vistos.includes(m[1])) vistos.push(m[1])
  }
  return vistos
}

/** Compatibilidad: los huecos numerados de un texto, como números. */
export function variablesDe(texto) {
  return huecosDe(texto).map(Number).filter(Number.isFinite)
}

/** El componente de un tipo dentro de una plantilla de Meta. */
export const componente = (p, tipo) => (p?.components || []).find(c => c.type === tipo)

export const tarjetasDe = p => componente(p, 'CAROUSEL')?.cards || []
export const esCarrusel = p => tarjetasDe(p).length > 0

export const esNamed = p => p?.parameter_format === 'NAMED'

/** El botón de enlace con variable, si lo tiene. */
export const botonConVariable = p =>
  (componente(p, 'BUTTONS')?.buttons || []).find(b => b.type === 'URL' && huecosDe(b.url).length)

/**
 * Todos los huecos de una plantilla, con su sitio.
 *
 * `[{ destino: 'BODY', hueco: '1', clave: 'BODY:1' }, …]` — la `clave` es la
 * misma con la que el backend guarda el mapeo y devuelve los valores, así que
 * pantalla y servidor hablan del mismo hueco sin traducir nada por el camino.
 */
export function huecosDePlantilla(p) {
  const de = (destino, texto) =>
    huecosDe(texto).map(h => ({ destino, hueco: h, clave: `${destino}:${h}` }))
  const cab = componente(p, 'HEADER')
  const todos = [
    ...(cab?.format === 'TEXT' ? de('HEADER', cab.text) : []),
    ...de('BODY', componente(p, 'BODY')?.text),
    ...de('BUTTON', botonConVariable(p)?.url),
  ]
  tarjetasDe(p).forEach((tarjeta, cardIndex) => {
    const comps = tarjeta.components || []
    todos.push(...de(`CARD:${cardIndex}:BODY`, comps.find(c => c.type === 'BODY')?.text))
    ;(comps.find(c => c.type === 'BUTTONS')?.buttons || []).forEach((b, buttonIndex) => {
      if (b.type === 'URL') todos.push(...de(`CARD:${cardIndex}:BUTTON:${buttonIndex}`, b.url))
    })
  })
  return todos
}

/** Cuántas variables tiene el cuerpo. Es lo que hay que rellenar para enviarla. */
export function variablesDelCuerpo(plantilla) {
  return huecosDe(componente(plantilla, 'BODY')?.text)
}

/** Las variables del botón de enlace, si tiene uno dinámico. */
export function variablesDelBoton(plantilla) {
  return huecosDe(botonConVariable(plantilla)?.url)
}

/**
 * Sustituye los huecos por sus valores, para la vista previa.
 *
 * `valores` es un diccionario por hueco (`{ '1': 'Toby', mascota: 'Toby' }`).
 * Lo que no tenga valor se deja como está: ver `{{2}}` en la previa es la señal
 * de que ese hueco va a llegar en blanco.
 */
export function conValores(texto, valores = {}) {
  return String(texto || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (todo, h) => {
    const v = Array.isArray(valores) ? valores[Number(h) - 1] : valores[h]
    return v ? String(v) : todo
  })
}

// ── Qué dato de Orbit va en cada variable (migraciones 097 y 102) ───────────
// Sin esto hay que teclear los valores en cada envío, y es justo lo que lleva a
// crear una plantilla por mascota con el texto quemado.

export function camposDisponibles() {
  return orbitApi('/whatsapp/plantillas-campos')
}

export function variablesDePlantilla(nombre, idioma = 'es_MX', agenteId = null) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/variables?idioma=${idioma}${agenteId ? `&agenteId=${agenteId}` : ''}`)
}

export function guardarVariables(nombre, idioma, variables, cabecera, agenteId = null) {
  const body = { idioma, variables, agenteId }
  // Solo se manda la cabecera si hay algo que decir sobre ella: mandar `null`
  // sin querer borraría el archivo asignado.
  if (cabecera !== undefined) body.cabecera = cabecera
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/variables`, {
    method: 'PUT', body,
  })
}

export function valoresDeServicio(nombre, servicioId, idioma = 'es_MX', agenteId = null) {
  return orbitApi(`/whatsapp/plantillas/${encodeURIComponent(nombre)}/valores/${servicioId}?idioma=${idioma}${agenteId ? `&agenteId=${agenteId}` : ''}`)
}

/** Los campos del catálogo agrupados como se muestran en el desplegable. */
export function porGrupo(campos) {
  const grupos = []
  for (const c of campos) {
    const g = grupos.find(x => x.nombre === (c.grupo || 'Otros'))
    if (g) g.campos.push(c)
    else grupos.push({ nombre: c.grupo || 'Otros', campos: [c] })
  }
  return grupos
}
