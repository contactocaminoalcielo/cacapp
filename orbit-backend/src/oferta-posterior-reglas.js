// Reglas puras de la OFERTA POSTERIOR al servicio (migr. 210) — sin base de
// datos ni Express, para probarlas con `node --test` desde la raíz del repo
// (tests/oferta-posterior.test.mjs). oferta-posterior.js, oferta-portal.js y
// ventas-posteriores.js las importan.

export const CATEGORIAS = ['RECORDATORIOS', 'PREEXEQUIALES', 'CEDULAS']

// Texto EXACTO de los botones de la plantilla, en el orden del reporte.
// 🪤 Tope de Meta: 25 caracteres por botón y SIN emojis (error 2388060 — ya nos
// rechazó la plantilla de la encuesta por eso el 10-nov).
export const BOTONES = [
  'Recordatorios adicionales',   // 25: justo en el tope
  'Planes preexequiales',
  'Cedulas para mascotas',
  'No deseo informacion',
]

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Qué quiso la familia al tocar un botón. Tolera tildes, mayúsculas y emojis
 * (Meta devuelve el texto del botón tal cual se aprobó).
 * Devuelve 'RECORDATORIOS' | 'PREEXEQUIALES' | 'CEDULAS' | 'NO_DESEA' | null.
 * 🪤 «No deseo» se mira PRIMERO: «No deseo información de recordatorios» no es
 * interés en recordatorios.
 */
export function respuestaDeBoton(texto) {
  const t = sinTildes(texto)
  if (!t.trim()) return null
  if (/\bno deseo\b/.test(t)) return 'NO_DESEA'
  if (/\brecordatorios? adicional/.test(t)) return 'RECORDATORIOS'
  if (/\bpreexequial|\bpre-exequial|\bpre exequial/.test(t)) return 'PREEXEQUIALES'
  if (/\bcedulas?\b/.test(t)) return 'CEDULAS'
  return null
}

/**
 * ¿El texto es EXACTAMENTE uno de los cuatro botones de la plantilla? Es lo que
 * usa el webhook para decidir si se queda con el mensaje: `respuestaDeBoton` es
 * tolerante a propósito («cédulas», «no deseo…») y, sola, se tragaría un botón
 * parecido de otra plantilla o del agente — y hasta daría de baja a una familia
 * que tocó «No deseo…» en otro mensaje. Los botones de plantilla llegan con su
 * texto tal cual se aprobó, así que la igualdad exacta no pierde nada.
 */
export function esBotonDeLaOferta(texto) {
  const t = sinTildes(texto).trim()
  return !!t && BOTONES.some(b => sinTildes(b) === t)
}

/** Porcentaje de la config ya acotado a 0–90: un 100 % regalaría el catálogo. */
export function pct(v, def = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(Math.round(n), 0), 90)
}

/**
 * Precio con descuento, bajado a la centena (no hay monedas de $37). Siempre
 * hacia ABAJO: redondear al más cercano podía dejar el precio «con descuento»
 * por encima del original en valores pequeños.
 */
export function precioConDescuento(precio, porcentaje) {
  const base = Math.max(0, Math.round(Number(precio) || 0))
  const p = pct(porcentaje)
  if (!p) return base
  const crudo = (base * (100 - p)) / 100
  return crudo >= 100 ? Math.floor(crudo / 100) * 100 : Math.floor(crudo)
}

/**
 * ¿La oferta sigue viva para comprar con descuento? Vence `diasVigencia`
 * después del envío. Sin fecha de envío (abierta a mano por coordinación) vale
 * desde su creación.
 */
export function ofertaVigente({ fechaEnvio, creadaEn, diasVigencia, ahora = new Date() }) {
  const desde = fechaEnvio || creadaEn
  if (!desde) return false
  const dias = Math.min(Math.max(parseInt(diasVigencia) || 30, 1), 365)
  return ahora.getTime() - new Date(desde).getTime() <= dias * 86400000
}

// ─── Estados de una venta posterior ─────────────────────────────────────────
// Los del reporte para pre-exequiales, más los dos de cierre. Recordatorios y
// cédulas usan el tramo corto: INTERESADO → FORMULARIO_INICIADO → COMPRA_REGISTRADA
// (de ahí en adelante manda la compra: producción, pago y entrega viven en
// Compras de recordatorios, no se duplican aquí).
export const ESTADOS_VENTA = [
  'INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO',
  'PAGO_REPORTADO', 'PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO',
  'AFILIACION_ACTIVA', 'COMPRA_REGISTRADA', 'CERRADA_SIN_VENTA',
]
export const ESTADOS_FINALES = ['AFILIACION_ACTIVA', 'COMPRA_REGISTRADA', 'CERRADA_SIN_VENTA']

const ORDEN_PREEX = [
  'INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO',
  'PAGO_REPORTADO', 'PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA',
]
const ORDEN_COMPRA = ['INTERESADO', 'FORMULARIO_INICIADO', 'COMPRA_REGISTRADA']

export function estadosDeCategoria(categoria) {
  return [...(categoria === 'PREEXEQUIALES' ? ORDEN_PREEX : ORDEN_COMPRA), 'CERRADA_SIN_VENTA']
}

/**
 * ¿Lo que hace la FAMILIA en el portal puede mover la venta a `nuevo`?
 * Solo hacia adelante: abrir otra vez el formulario no devuelve a
 * FORMULARIO_INICIADO una solicitud que ya está completa, y nada que haga la
 * familia pasa de PAGO_REPORTADO (validar el pago y el contrato son de
 * coordinación). Una venta cerrada sin venta se reabre solo con una acción
 * real de la familia, no con volver a abrir la página.
 */
export function avanzaPorFamilia(categoria, actual, nuevo) {
  const orden = categoria === 'PREEXEQUIALES' ? ORDEN_PREEX : ORDEN_COMPRA
  const tope = categoria === 'PREEXEQUIALES' ? orden.indexOf('PAGO_REPORTADO') : orden.length - 1
  const a = orden.indexOf(actual), n = orden.indexOf(nuevo)
  if (n < 0 || n > tope) return false
  // Una venta que coordinación cerró solo se reabre si la familia HACE algo
  // (empieza el formulario, compra, solicita): volver a mirar la página
  // (INTERESADO) no borra el cierre ni su motivo.
  if (actual === 'CERRADA_SIN_VENTA') return nuevo !== 'INTERESADO'
  if (a < 0) return false
  return n > a
}

/**
 * ¿Coordinación puede poner la venta en `nuevo`? Cualquier estado de su
 * categoría, con una excepción dura del reporte: NO hay contrato ni afiliación
 * activa sin pago validado.
 */
export function puedePasarCoordinacion(categoria, actual, nuevo, { pagoValidado = false, tieneCompra = false } = {}) {
  if (!estadosDeCategoria(categoria).includes(nuevo)) return { ok: false, error: 'Ese estado no aplica a esta venta.' }
  if (nuevo === actual) return { ok: false, error: 'La venta ya está en ese estado.' }
  // «Compra registrada» SIN compra era una venta sin producto: Diseño no sabía
  // qué hacer (REPORTE ORBIT 27-nov). Solo se llega con la compra y sus líneas.
  if (nuevo === 'COMPRA_REGISTRADA' && !tieneCompra) {
    return { ok: false, error: 'Para marcarla como comprada, registra la compra con sus productos (botón «Registrar la compra»): así le llega a Diseño con los datos.' }
  }
  if (categoria === 'PREEXEQUIALES'
      && ['PENDIENTE_CONTRATO', 'CONTRATO_GENERADO', 'AFILIACION_ACTIVA'].includes(nuevo)
      && !pagoValidado) {
    return { ok: false, error: 'Primero hay que validar el pago: sin pago validado no hay contrato ni afiliación activa.' }
  }
  return { ok: true }
}

/**
 * Lo que codifica el QR de la cédula: abre WhatsApp con el dueño, con un
 * mensaje ya escrito. Si alguien encuentra a la mascota, escanea y escribe.
 * Devuelve null sin un celular colombiano válido (10 dígitos, empieza por 3).
 */
export function enlaceQrPropietario(telefono, mascota = '') {
  const d = String(telefono || '').replace(/\D/g, '')
  const diez = d.length >= 10 ? d.slice(-10) : ''
  if (!/^3\d{9}$/.test(diez)) return null
  const nombre = String(mascota || '').trim().slice(0, 40)
  const texto = nombre
    ? `Hola, encontré a ${nombre} y quiero ayudar a que vuelva a casa.`
    : 'Hola, encontré a tu mascota y quiero ayudar a que vuelva a casa.'
  return `https://wa.me/57${diez}?text=${encodeURIComponent(texto)}`
}

// ─── Solicitud de afiliación pre-exequial (formulario público) ──────────────
const txt = (v, max = 200) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export class ReglaError extends Error {
  constructor(message) { super(message); this.status = 400 }
}

/**
 * Limpia y valida lo que manda el formulario de pre-exequiales. El PRECIO no
 * viene de aquí: lo pone el backend desde la configuración.
 * `niveles`/`tipos` = los que se ofrecen hoy. Lanza ReglaError (400).
 */
export function normalizarSolicitudPreexequial(p, { niveles = [], tipos = [], especies = [] } = {}) {
  const nivel = String(p?.plan?.nivel || '').toUpperCase()
  const tipo = String(p?.plan?.tipo || '').toUpperCase()
  if (!niveles.includes(nivel)) throw new ReglaError('Escoge el plan que deseas.')
  if (!tipos.includes(tipo)) throw new ReglaError('Indica si el plan es anual o vitalicio.')

  const prop = p?.propietario || {}
  const propietario = {
    nombre:    txt(prop.nombre, 80),
    apellido:  txt(prop.apellido, 80),
    documento: String(prop.documento || '').replace(/\D/g, '').slice(0, 30) || null,
    whatsapp:  String(prop.whatsapp || '').replace(/\D/g, '').slice(0, 25) || null,
    email:     txt(prop.email, 120),
    direccion: txt(prop.direccion, 200),
    ciudad:    txt(prop.ciudad, 60),
  }
  if (!propietario.nombre) throw new ReglaError('Escribe tu nombre completo.')
  if (!propietario.apellido) throw new ReglaError('Escribe tu apellido.')
  if (!propietario.documento) throw new ReglaError('Escribe tu número de documento.')
  if (!propietario.whatsapp || propietario.whatsapp.length < 10) throw new ReglaError('Escribe un número de contacto válido.')
  if (!propietario.direccion) throw new ReglaError('Escribe tu dirección.')
  if (propietario.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(propietario.email)) {
    throw new ReglaError('El correo no parece válido.')
  }

  const lista = Array.isArray(p?.mascotas) ? p.mascotas : []
  if (!lista.length) throw new ReglaError('Agrega al menos una mascotica.')
  if (lista.length > 10) throw new ReglaError('Máximo 10 mascoticas por solicitud.')
  const idsEspecie = especies.map(e => Number(e.id))
  const mascotas = lista.map((m, i) => {
    const n = i + 1
    const nombre = txt(m?.nombre, 80)
    if (!nombre) throw new ReglaError(`Falta el nombre de la mascotica ${n}.`)
    const especieId = parseInt(m?.especie_id) || null
    if (!especieId || (idsEspecie.length && !idsEspecie.includes(especieId))) {
      throw new ReglaError(`Indica la especie de ${nombre}.`)
    }
    const sexo = ['Macho', 'Hembra'].includes(m?.sexo) ? m.sexo : null
    if (!sexo) throw new ReglaError(`Indica el sexo de ${nombre}.`)
    const peso = Number(String(m?.peso_kg ?? '').replace(',', '.'))
    if (!Number.isFinite(peso) || peso <= 0 || peso > 150) throw new ReglaError(`Escribe el peso aproximado de ${nombre} en kilos.`)
    const nacimiento = /^\d{4}-\d{2}-\d{2}$/.test(String(m?.fecha_nacimiento || '')) ? m.fecha_nacimiento : null
    const edad = txt(m?.edad, 40)
    if (!nacimiento && !edad) throw new ReglaError(`Indica la fecha de nacimiento o la edad aproximada de ${nombre}.`)
    return {
      nombre, especie_id: especieId, raza: txt(m?.raza, 80), sexo,
      fecha_nacimiento: nacimiento, edad, peso_kg: Math.round(peso * 10) / 10,
      notas: txt(m?.notas, 300),
    }
  })

  return {
    plan: { nivel, tipo },
    propietario, mascotas,
    forma_pago: txt(p?.forma_pago, 40),
    observaciones: txt(p?.observaciones, 1000),
  }
}
