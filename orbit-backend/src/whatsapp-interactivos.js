// Mensajes interactivos de WhatsApp: botones, menú de lista y botón de enlace.
//
// El catálogo lo edita David (migración 100), no vive en el código: el agente
// elige por clave y la `descripcion` de cada uno es lo que lee para saber
// cuándo usarlo. Mismo patrón que las etiquetas.
//
// ⚠️ LÍMITE DE META: los interactivos solo salen DENTRO de la ventana de 24 h.
// Fuera hace falta plantilla. `enviarSobre` lo valida antes de llamar a Meta,
// igual que el envío de texto.
//
// ⚠️ Los topes de longitud NO son cosmética: Meta rechaza el mensaje entero con
// un error genérico que no dice cuál campo se pasó. Se recortan aquí para que
// un título largo escrito en la pantalla no se convierta en un fallo mudo.
import { pool, log } from './db.js'
import { enlacePersonalAliado, enlaceAfiliacion } from './aliados.js'

const MOD = '[wa-interactivos]'

// Topes de la API de Meta (Cloud API v26).
const MAX = {
  encabezado: 60,
  cuerpo:     1024,
  pie:        60,
  boton:      20,   // rótulo del botón de lista y del CTA
  titulo:     24,   // fila de lista
  desc:       72,   // descripción de fila
  tituloBtn:  20,   // botón de respuesta
  botones:    3,
  filas:      10,
  secciones:  10,
}

const corta = (s, n) => {
  const t = String(s ?? '').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Los que puede usar el agente, con su descripción: alimenta el enum de la herramienta. */
/**
 * Los interactivos que puede usar un agente.
 *
 * `agenteId` filtra por dueño (migración 110). `agente_id` nulo en una fila
 * significa "de todos": así conviven los catálogos propios de cada agente con
 * los comunes, sin obligar a duplicar lo que de verdad se comparte.
 */
export async function catalogoParaAgente(agenteId = null) {
  const { rows } = await pool.query(
    `SELECT clave, nombre, descripcion, tipo FROM public.whatsapp_interactivos
      WHERE activo AND usa_agente
        AND (agente_id IS NULL OR agente_id = $1)
      ORDER BY orden, id`,
    [agenteId]
  )
  return rows
}

export async function listarInteractivos() {
  const { rows } = await pool.query(
    `SELECT id, clave, nombre, descripcion, tipo, encabezado, cuerpo, pie,
            boton_texto, opciones, url, usa_agente, activo, orden
       FROM public.whatsapp_interactivos ORDER BY orden, id`
  )
  return { status: 200, body: { ok: true, interactivos: rows } }
}

/**
 * Resuelve las variables que solo sabe el servidor.
 *
 * Hoy solo `{{enlace_registro}}`, y es a propósito: el enlace personal de una
 * clínica es su credencial, así que **no puede escribirse a mano en el
 * catálogo** — se deriva del número que escribe, igual que en la herramienta
 * del agente. Ver la nota de seguridad en agente-wa.js.
 */
async function resolverUrl(url, contacto) {
  const t = String(url || '')
  if (!t.includes('{{enlace_registro}}')) return t

  const { rows: [conv] } = await pool.query(
    // El aliado se resuelve por el número, así que es el mismo en todas las
    // líneas; el LIMIT solo lo hace determinista ahora que puede haber varias.
    `SELECT aliado_id FROM public.v_whatsapp_conversaciones
      WHERE contacto = $1 AND aliado_id IS NOT NULL LIMIT 1`, [contacto]
  )
  // Sin aliado, el enlace correcto es el de afiliación: es el mismo criterio
  // que usa la herramienta del agente, y de ahí sale que nadie pueda pedir el
  // enlace de otra clínica diciendo su nombre.
  if (!conv?.aliado_id) return t.replace('{{enlace_registro}}', enlaceAfiliacion())

  const datos = await enlacePersonalAliado(conv.aliado_id)
  if (!datos?.enlace) {
    // Existe pero no está habilitada. Activarla es de coordinación, no de aquí.
    throw new Error('Esa clínica figura en el sistema pero no está habilitada: no se le puede mandar el enlace')
  }
  return t.replace('{{enlace_registro}}', datos.enlace)
}

/** El cuerpo que entiende Meta, ya validado y recortado. */
function armarPayload(m, url) {
  const base = {
    body: { text: corta(m.cuerpo, MAX.cuerpo) },
    ...(m.encabezado ? { header: { type: 'text', text: corta(m.encabezado, MAX.encabezado) } } : {}),
    ...(m.pie ? { footer: { text: corta(m.pie, MAX.pie) } } : {}),
  }

  if (m.tipo === 'CTA_URL') {
    return {
      ...base,
      type: 'cta_url',
      action: {
        name: 'cta_url',
        parameters: {
          display_text: corta(m.boton_texto || 'Abrir', MAX.boton),
          url,
        },
      },
    }
  }

  if (m.tipo === 'BOTONES') {
    const ops = (Array.isArray(m.opciones) ? m.opciones : []).slice(0, MAX.botones)
    if (!ops.length) throw new Error('Ese mensaje no tiene botones configurados')
    return {
      ...base,
      type: 'button',
      action: {
        buttons: ops.map((o, i) => ({
          type: 'reply',
          reply: { id: String(o.id || `op${i}`).slice(0, 256), title: corta(o.titulo, MAX.tituloBtn) },
        })),
      },
    }
  }

  // LISTA
  const secciones = (Array.isArray(m.opciones) ? m.opciones : []).slice(0, MAX.secciones)
  // Meta cuenta las filas en TOTAL, no por sección: diez es diez aunque estén
  // repartidas. Pasarse rechaza el mensaje entero.
  let quedan = MAX.filas
  const armadas = []
  for (const s of secciones) {
    if (quedan <= 0) break
    const filas = (Array.isArray(s.filas) ? s.filas : []).slice(0, quedan)
    if (!filas.length) continue
    quedan -= filas.length
    armadas.push({
      title: corta(s.titulo || 'Opciones', MAX.titulo),
      rows: filas.map((f, i) => ({
        id: String(f.id || `f${i}`).slice(0, 200),
        title: corta(f.titulo, MAX.titulo),
        ...(f.descripcion ? { description: corta(f.descripcion, MAX.desc) } : {}),
      })),
    })
  }
  if (!armadas.length) throw new Error('Ese menú no tiene opciones configuradas')

  return {
    ...base,
    type: 'list',
    action: { button: corta(m.boton_texto || 'Ver opciones', MAX.boton), sections: armadas },
  }
}

/** Cómo se ve en la bandeja. Sin esto el hilo mostraría un hueco donde hubo un mensaje. */
function resumen(m) {
  if (m.tipo === 'CTA_URL') return `${m.cuerpo}\n[botón: ${m.boton_texto || 'Abrir'}]`
  if (m.tipo === 'BOTONES') {
    const t = (m.opciones || []).map(o => o.titulo).filter(Boolean).join(' · ')
    return `${m.cuerpo}\n[botones: ${t}]`
  }
  const n = (m.opciones || []).reduce((a, s) => a + (s.filas?.length || 0), 0)
  return `${m.cuerpo}\n[menú "${m.boton_texto || 'Ver opciones'}": ${n} opciones]`
}

/**
 * Envía uno del catálogo.
 *
 * Recibe `enviarSobre` en vez de importarlo: whatsapp-cloud ya importa de aquí
 * indirectamente a través del agente, y el lazo cerraría un ciclo de módulos.
 */
export async function enviarInteractivo({ contacto, linea = null, clave, personalId = null, enviarSobre }) {
  const num = String(contacto || '').replace(/\D/g, '')
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const { rows: [m] } = await pool.query(
    `SELECT * FROM public.whatsapp_interactivos WHERE clave = $1 AND activo`, [clave]
  )
  if (!m) return { status: 404, body: { ok: false, error: `No existe el mensaje "${clave}" o está desactivado` } }

  let interactive
  try {
    const url = m.tipo === 'CTA_URL' ? await resolverUrl(m.url, num) : null
    interactive = armarPayload(m, url)
  } catch (e) {
    return { status: 400, body: { ok: false, error: e.message } }
  }

  const r = await enviarSobre({
    contacto: num,
    // Sale por la MISMA línea por la que llegó la conversación.
    linea,
    payload: { type: 'interactive', interactive },
    texto: resumen(m),
    tipo: 'interactive',
    personalId,
  })
  if (r?.body?.ok) log(MOD, `${clave} enviado a ${num}`)
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// Edición del catálogo (la pantalla)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que Meta exige según el tipo. Se valida aquí y no solo en la pantalla:
 * un mensaje mal armado no falla al guardarlo, falla al ENVIARLO —delante de
 * una veterinaria— y con un error que no explica cuál es el problema.
 */
function validar(d) {
  if (!['BOTONES', 'LISTA', 'CTA_URL'].includes(d.tipo)) return 'Tipo inválido'
  if (!String(d.cuerpo || '').trim()) return 'El mensaje necesita un texto'
  if (String(d.cuerpo).length > MAX.cuerpo) return `El texto no puede pasar de ${MAX.cuerpo} caracteres`

  if (d.tipo === 'CTA_URL') {
    const url = String(d.url || '').trim()
    if (!url) return 'Un botón de enlace necesita una dirección'
    // `{{enlace_registro}}` no es una URL válida hasta que el servidor la
    // resuelve, así que se acepta tal cual y se comprueba el resto.
    if (!url.includes('{{enlace_registro}}') && !/^https?:\/\//i.test(url)) {
      return 'La dirección debe empezar por http:// o https://'
    }
    if (!String(d.boton_texto || '').trim()) return 'Ponle un rótulo al botón'
    return null
  }

  const ops = Array.isArray(d.opciones) ? d.opciones : []

  if (d.tipo === 'BOTONES') {
    if (!ops.length) return 'Añade al menos un botón'
    if (ops.length > MAX.botones) return `WhatsApp admite como mucho ${MAX.botones} botones`
    if (ops.some(o => !String(o?.titulo || '').trim())) return 'Todos los botones necesitan un texto'
    // Dos botones con el mismo id devuelven la misma respuesta y no habría
    // forma de saber cuál tocó la veterinaria.
    const ids = ops.map((o, i) => String(o.id || `op${i}`))
    if (new Set(ids).size !== ids.length) return 'Dos botones no pueden tener el mismo identificador'
    return null
  }

  // LISTA
  if (!String(d.boton_texto || '').trim()) return 'Ponle un rótulo al botón que abre el menú'
  const secciones = ops.filter(s => (s?.filas || []).length)
  if (!secciones.length) return 'Añade al menos una opción al menú'
  const total = secciones.reduce((a, s) => a + s.filas.length, 0)
  // Meta las cuenta en total, no por sección: es el error más fácil de cometer
  // armando un menú de planes.
  if (total > MAX.filas) return `WhatsApp admite ${MAX.filas} opciones en total, y hay ${total}`
  if (secciones.some(s => s.filas.some(f => !String(f?.titulo || '').trim()))) {
    return 'Todas las opciones necesitan un texto'
  }
  return null
}

export async function guardarInteractivo({ id, datos = {} }) {
  const error = validar(datos)
  if (error) return { status: 400, body: { ok: false, error } }

  const clave = String(datos.clave || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (!clave) return { status: 400, body: { ok: false, error: 'Falta la clave' } }

  const vals = [
    clave,
    String(datos.nombre || clave).trim().slice(0, 120),
    String(datos.descripcion || '').trim().slice(0, 600) || null,
    datos.tipo,
    String(datos.encabezado || '').trim().slice(0, MAX.encabezado) || null,
    String(datos.cuerpo).trim(),
    String(datos.pie || '').trim().slice(0, MAX.pie) || null,
    String(datos.boton_texto || '').trim().slice(0, MAX.boton) || null,
    JSON.stringify(datos.opciones || []),
    String(datos.url || '').trim() || null,
    datos.usa_agente !== false,
    datos.activo !== false,
    Number.isInteger(Number(datos.orden)) ? Number(datos.orden) : 0,
  ]

  try {
    if (id) {
      const { rows } = await pool.query(
        `UPDATE public.whatsapp_interactivos
            SET clave=$1, nombre=$2, descripcion=$3, tipo=$4, encabezado=$5, cuerpo=$6,
                pie=$7, boton_texto=$8, opciones=$9::jsonb, url=$10, usa_agente=$11,
                activo=$12, orden=$13, actualizado_en=now()
          WHERE id=$14 RETURNING id, clave`,
        [...vals, Number(id)]
      )
      if (!rows.length) return { status: 404, body: { ok: false, error: 'Ese mensaje ya no existe' } }
      log(MOD, `${rows[0].clave} actualizado`)
      return { status: 200, body: { ok: true, id: rows[0].id } }
    }

    const { rows } = await pool.query(
      `INSERT INTO public.whatsapp_interactivos
         (clave, nombre, descripcion, tipo, encabezado, cuerpo, pie, boton_texto,
          opciones, url, usa_agente, activo, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
       RETURNING id, clave`,
      vals
    )
    log(MOD, `${rows[0].clave} creado`)
    return { status: 200, body: { ok: true, id: rows[0].id } }
  } catch (e) {
    // La clave es única: repetirla es el error más probable al crear uno nuevo.
    if (e.code === '23505') {
      return { status: 409, body: { ok: false, error: `Ya existe un mensaje con la clave ${clave}` } }
    }
    throw e
  }
}

export async function borrarInteractivo({ id }) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.whatsapp_interactivos WHERE id = $1`, [Number(id)]
  )
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Ese mensaje ya no existe' } }
  return { status: 200, body: { ok: true } }
}
