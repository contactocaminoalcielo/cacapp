// Bandeja de WhatsApp — cliente de la API del backend propio.
//
// Todo pasa por orbit-backend: las tablas `whatsapp_*` NO están expuestas por
// PostgREST (sin GRANT a authenticated) porque contienen teléfonos y texto libre
// de conversaciones. El permiso se valida en el backend con JWT + rol.
// Ver migraciones 086/087 y orbit-backend/src/whatsapp-cloud.js.
import { orbitApi, orbitApiBlob } from '@/lib/orbitApi'

// Identidad visible de las líneas conocidas. La llave operativa SIEMPRE sigue
// siendo el phone_number_id; el número y el nombre son solo presentación.
//
// 🩸 El id de veterinarias estaba equivocado (`1093403420518278`, que no existe
// en ninguna parte) y por eso su pestaña salía como "ID …540238" en vez de su
// número. Comprobado contra producción: los tres ids vivos son los de abajo.
// Un phone_number_id inventado en un mapa de constantes es justo lo que después
// alguien copia a una decisión de enrutado — y ahí ya no es cosmético.
export const LINEAS_WHATSAPP_INBOX = {
  '1313164878540238': { nombre: 'Veterinarias', numero: '+57 318 096 7711' },
  '1317926468072324': { nombre: 'Camino Al Cielo', numero: '+57 315 989 1247' },
  '894547387070615':  { nombre: 'Línea 318', numero: '+57 318 986 4595' },
}

export function identidadLinea(id, nombresAgente = {}) {
  const conocida = LINEAS_WHATSAPP_INBOX[id]
  return {
    nombre: nombresAgente[id] || conocida?.nombre || `Línea …${String(id || '').slice(-4)}`,
    numero: conocida?.numero || `ID …${String(id || '').slice(-6)}`,
  }
}

export function claveConversacion(contacto, linea) {
  return `${linea || 'sin-linea'}:${contacto || ''}`
}


// ── La LÍNEA viaja en todo (migración 109) ───────────────────────────────────
//
// 🩸 Una conversación es (línea, número), no un número. La misma clínica puede
// hablar por dos líneas y son DOS conversaciones. Cada llamada manda la línea de
// la conversación que está abierta, para que la respuesta salga por donde llegó.
// Sin ella el backend la deduce, y si el número habla por varias, da error en
// vez de elegir — que es justo el fallo que se vino a arreglar.

export function listarConversaciones(q, linea = null) {
  const p = new URLSearchParams()
  if (q?.trim()) p.set('q', q.trim())
  if (linea) p.set('linea', linea)
  const qs = p.toString()
  return orbitApi(`/whatsapp/conversaciones${qs ? `?${qs}` : ''}`)
}

export function abrirHilo(contacto, linea = null) {
  const qs = linea ? `?linea=${encodeURIComponent(linea)}` : ''
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}${qs}`)
}

export function marcarLeido(contacto, linea = null) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/leido`, {
    method: 'POST', body: { linea },
  })
}

export function enviarMensaje(contacto, texto, linea = null) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/enviar`, {
    method: 'POST',
    body: { texto, linea },
  })
}

/**
 * Encender o apagar el agente en ESTA conversación (migración 105).
 *
 * Manda sobre las reglas automáticas —12 h si escribe una persona, 10 min tras
 * una plantilla— porque "de esta clínica me encargo yo" no dura doce horas.
 * ⚠️ No caduca: apagado se queda apagado hasta que alguien lo encienda.
 */
export function cambiarAgente(contacto, activo, linea = null) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/agente`, {
    method: 'POST', body: { activo, linea },
  })
}

/**
 * Bloquea o desbloquea una conversación (migración 131).
 *
 * Más fuerte que pausar, y la diferencia importa: pausar es "de esta me encargo
 * yo" y se quita en un clic; bloquear es "aquí nunca contesta una máquina" — el
 * agente no vuelve solo y ni siquiera acusa recibo, porque cualquier señal de
 * vida invita a un bot a seguir escribiendo. Los mensajes siguen entrando y una
 * persona puede responder igual.
 */
export function bloquearConversacion(contacto, bloqueado, motivo = null, linea = null) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/bloqueo`, {
    method: 'POST', body: { bloqueado, motivo, linea },
  })
}

// ── Etiquetas (migración 090) ────────────────────────────────────────────────
// Son las listas de trabajo de la bandeja. Las pone el agente al clasificar y
// el coordinador a mano; quitarlas es cómo se cierra una novedad.

export function listarEtiquetas() {
  return orbitApi('/whatsapp/etiquetas')
}

export function ponerEtiqueta(contacto, clave, linea = null) {
  return orbitApi(`/whatsapp/conversaciones/${encodeURIComponent(contacto)}/etiquetas`, {
    method: 'POST',
    body: { clave, linea },
  })
}

export function quitarEtiqueta(contacto, clave, linea = null) {
  const qs = linea ? `?linea=${encodeURIComponent(linea)}` : ''
  return orbitApi(
    `/whatsapp/conversaciones/${encodeURIComponent(contacto)}/etiquetas/${encodeURIComponent(clave)}${qs}`,
    { method: 'DELETE' }
  )
}

/** Las listas que ve el coordinador, en el orden en que las mira. */
export const GRUPOS = [
  { clave: 'NOVEDAD',   nombre: 'Novedades' },
  { clave: 'SERVICIO',  nombre: 'Servicios' },
  { clave: 'COMERCIAL', nombre: 'Comercial' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Presentación
// ─────────────────────────────────────────────────────────────────────────────

/** 573001234567 → 300 123 4567 (se cae al original si no calza el formato). */
export function formatearNumero(contacto) {
  const d = String(contacto || '').replace(/\D/g, '')
  const local = d.length > 10 ? d.slice(-10) : d
  if (local.length !== 10) return contacto || ''
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

/** "hace 5 min", "hace 2 h", "ayer", "12 mar" — para la lista de conversaciones. */
export function haceCuanto(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

/** Hora del mensaje dentro del hilo. */
export function horaMensaje(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

/** Separador de día dentro del hilo: "Hoy", "Ayer", "lunes, 12 de marzo". */
export function etiquetaDia(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const hoy = new Date()
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1)
  const mismo = (a, b) => a.toDateString() === b.toDateString()
  if (mismo(d, hoy)) return 'Hoy'
  if (mismo(d, ayer)) return 'Ayer'
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * Cuánto queda de la ventana de 24h de Meta.
 * Pasadas 24h desde el último mensaje del cliente ya no se puede mandar texto
 * libre — solo una plantilla aprobada.
 */
export function restanteVentana(ventanaHasta) {
  if (!ventanaHasta) return null
  const ms = new Date(ventanaHasta).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h} h ${m} m` : `${m} m`
}

// ── Adjuntos (migración 094) ─────────────────────────────────────────────────
// Los bytes no viajan en el hilo (serían megabytes por refresco del polling):
// el hilo dice `tiene_archivo` y la pantalla pide cada archivo por separado.

/** Baja el archivo de un mensaje. Devuelve un Blob; el llamador hace el objectURL. */
export function bajarAdjunto(mensajeId) {
  return orbitApiBlob(`/whatsapp/media/${mensajeId}`)
}

/** Lo que se puede pintar como imagen en el hilo. */
export function esImagen(mime) {
  return /^image\/(jpeg|png|gif|webp)$/i.test(String(mime || ''))
}

/** Los 3 checks de WhatsApp, para los mensajes que enviamos nosotros. */
export const ESTADO_ENVIO = {
  sent:      { icono: '✓',  label: 'Enviado',   clase: 'text-gray-400' },
  delivered: { icono: '✓✓', label: 'Entregado', clase: 'text-gray-400' },
  read:      { icono: '✓✓', label: 'Leído',     clase: 'text-[#1A5CD8]' },
  failed:    { icono: '!',  label: 'Falló',     clase: 'text-red-500' },
}

// ── Enviar adjuntos: imagen, audio, video o documento (2026-08-14) ───────────

/** Topes de WhatsApp por tipo. Pasarse lo rechaza con un error poco claro. */
// Imagen, audio y video son los topes REALES de WhatsApp. El de documento es
// nuestro (Meta admite 100 MB) y tiene que coincidir con `CLASES.document` del
// backend: si aquí dice menos, la pantalla rechaza algo que el servidor acepta.
export const TOPES_ARCHIVO = { imagen: 5, audio: 16, video: 16, documento: 64 }

export function enviarArchivo({ contacto, linea = null, base64, mime, nombre, pie, notaDeVoz = false }) {
  return orbitApi('/whatsapp/archivo', {
    method: 'POST',
    // `notaDeVoz` no se deduce del MIME: un mp3 adjunto y una grabacion del
    // microfono pueden llegar igual y NO se ven igual del otro lado.
    body: { contacto, linea, base64, mime, nombre, pie, notaDeVoz },
  })
}

/**
 * Con qué nombre se guarda un adjunto del hilo al bajarlo.
 *
 * 🩸 Hasta el 2026-09-03 se bajaba como `whatsapp-<id>`, SIN extensión: el
 * certificado o el recibo aterrizaban como un archivo que Windows no sabía
 * abrir, y desde fuera eso se ve igual que "no me deja descargar".
 *
 * El nombre bueno, cuando existe, viene en el propio texto del mensaje: los
 * documentos se guardan como `[documento] NOMBRE.pdf`. En 585 de los 1.228
 * salientes el prefijo viene solo, sin nombre — ahí se arma uno con el mime.
 */
const EXT_POR_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'application/zip': 'zip',
}

export function nombreAdjunto(m) {
  const mime = String(m?.archivo_mime || '').toLowerCase().split(';')[0].trim()
  const ext  = EXT_POR_MIME[mime] || (mime.includes('/') ? mime.split('/')[1] : '') || 'bin'

  const delTexto = /^\[documento\]\s*(.+\S)\s*$/i.exec(m?.texto || '')
  if (delTexto) {
    const limpio = delTexto[1].replace(/[\\/:*?"<>|]/g, '-').trim()
    if (limpio) return /\.[a-z0-9]{2,5}$/i.test(limpio) ? limpio : `${limpio}.${ext}`
  }
  return `whatsapp-${m?.id}.${ext}`
}

/** Solo para saber qué icono y qué texto mostrar antes de enviarlo. */
export function claseArchivo(mime = '') {
  const m = mime.toLowerCase()
  if (m === 'image/jpeg' || m === 'image/png') return 'imagen'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return 'documento'
}

/**
 * Grabar una nota de voz.
 *
 * 🩸 Una nota de voz DE VERDAD —icono de micrófono, descarga automática,
 * transcripción— exige `.ogg` con códec OPUS. Cualquier otro formato llega como
 * un archivo de audio con icono de nota musical, que hay que descargar. Lo dice
 * Meta y se comprobó: durante un rato se mandó `audio/mp4` y era justo eso.
 *
 * Chrome NO sabe grabar ogg, pero sí graba `webm` con codecs=opus — y el códec
 * ya es el bueno. Por eso la lista busca OPUS primero, del envase que sea: el
 * servidor solo tiene que cambiar la caja (`-c:a copy`, instantáneo y sin
 * pérdida). `audio/mp4` queda de último recurso, y ese sí obliga a recodificar.
 */
const FORMATOS_GRABACION = [
  'audio/webm;codecs=opus',   // Chrome, Edge
  'audio/ogg;codecs=opus',    // Firefox — ya llega listo
  'audio/mp4',                // Safari viejo: hay que recodificar en el servidor
]

export function formatoGrabacion() {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATOS_GRABACION.find(f => MediaRecorder.isTypeSupported(f)) || null
}

/** ¿Se puede grabar aquí? Necesita HTTPS y permiso de micrófono. */
export function sePuedeGrabar() {
  return !!(navigator.mediaDevices?.getUserMedia && formatoGrabacion())
}

/** `95` → `1:35`. */
export function duracionAudio(segundos) {
  const m = Math.floor(segundos / 60)
  const s = String(Math.floor(segundos % 60)).padStart(2, '0')
  return `${m}:${s}`
}

/**
 * Deja el archivo listo para enviarlo.
 *
 * Las FOTOS se reducen aquí, en el navegador, por tres razones y ninguna es
 * cosmética:
 *  1. Meta rechaza por encima de 5 MB, y una foto de celular los pasa.
 *  2. La copia se guarda en la base, así que subir el original engorda la tabla
 *     sin que nadie lo note hasta que duele.
 *  3. Se decodifica a un tamaño acotado, NUNCA a resolución completa: en un
 *     Android modesto eso es un cierre por falta de memoria — ya nos pasó en la
 *     app del técnico.
 *
 * Lo demás (audio, video, documentos) viaja tal cual: comprimirlo no se puede
 * en el navegador y recodificarlo sería peor que el problema.
 */
export function prepararArchivo(file, { ladoMax = 1600, calidad = 0.82 } = {}) {
  const clase = claseArchivo(file.type)

  // Un HEIC o un WEBP no son "imagen" para WhatsApp: van como documento, que sí
  // llega, en vez de rebotar con un error de formato.
  if (clase !== 'imagen') {
    return leerComoBase64(file).then(base64 => ({
      base64, mime: file.type || 'application/octet-stream',
      nombre: file.name || 'archivo', clase, previsualizacion: null,
      bytes: file.size,
    }))
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height))
      const w = Math.round(img.width * escala)
      const h = Math.round(img.height * escala)

      const lienzo = document.createElement('canvas')
      lienzo.width = w
      lienzo.height = h
      const ctx = lienzo.getContext('2d')
      // Fondo blanco: un PNG con transparencia sobre JPEG saldría negro.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)

      const dataUrl = lienzo.toDataURL('image/jpeg', calidad)
      lienzo.width = lienzo.height = 0   // suelta la memoria del lienzo
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
      resolve({
        base64, mime: 'image/jpeg',
        nombre: (file.name || 'imagen').replace(/\.[^.]+$/, '') + '.jpg',
        clase: 'imagen', previsualizacion: dataUrl,
        bytes: Math.round(base64.length * 0.75),
      })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen')) }
    img.src = url
  })
}

function leerComoBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    // Se corta por la PRIMERA coma, no con un patron sobre la cabecera.
    //
    // Antes decia `/^data:[^;]*;base64,/` y con un MIME que lleva parametros
    // reventaba en silencio: el de una nota de voz es
    // `data:audio/webm;codecs=opus;base64,...`, ahi `[^;]*` se para en
    // `audio/webm` y ya no encuentra `;base64,` seguido. No casaba, no
    // recortaba nada, y al servidor le llegaba la cabecera pegada al audio —
    // que Node decodifica como basura y ffmpeg rechaza. Con fotos y PDF nunca
    // se noto porque sus MIME no llevan `;`.
    //
    // En un data URL el base64 empieza justo tras la primera coma y nunca
    // contiene comas, asi que esto vale para todos.
    fr.onload  = () => {
      const t = String(fr.result)
      resolve(t.slice(t.indexOf(',') + 1))
    }
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(file)
  })
}
