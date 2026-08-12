// Plantillas de WhatsApp — el único modo de escribirle a alguien fuera de las 24h.
//
// Meta solo deja texto libre dentro de las 24 horas siguientes al último mensaje
// del cliente. Pasado ese plazo hace falta una plantilla APROBADA por Meta, y la
// aprobación tarda de minutos a días: por eso se preparan antes de necesitarlas.
//
// ⚠️ Las plantillas viven en la **WABA**, no en el número, y NO viajan entre
// WABAs. Por eso `WHATSAPP_WABA_ID` apunta a la cuenta DESTINO —donde va a
// quedar la línea de veterinarias— y no a la actual: lo que se prepare aquí es
// lo que existirá el día del cambio.
//
// 🩸 EL ERROR QUE ESTE MÓDULO VIENE A CORREGIR: en la WABA vieja hay **251
// plantillas** con nombres como `mango_compet_26_3_2026` — una por mascota, con
// el texto quemado. Eso obliga a esperar una aprobación de Meta por cada
// servicio y llena el cupo de la cuenta. Una sola plantilla con `{{1}}` sirve
// para todas: se aprueba una vez y se usa siempre.
//
// Variables en /opt/orbit-backend/.env:
//   WHATSAPP_ACCESS_TOKEN — token permanente de la app de Meta
//   WHATSAPP_API_VERSION  — v26.0
//   WHATSAPP_WABA_ID      — la cuenta de WhatsApp donde viven las plantillas
import { pool, log } from './db.js'

const MOD = '[wa-plantillas]'
const GRAPH = 'https://graph.facebook.com'

/** Solo minúsculas, números y guion bajo: es lo que Meta acepta como nombre. */
const NOMBRE_VALIDO = /^[a-z0-9_]{1,512}$/

const CATEGORIAS = ['UTILITY', 'MARKETING', 'AUTHENTICATION']

const version = () => process.env.WHATSAPP_API_VERSION || 'v26.0'
const waba = () => (process.env.WHATSAPP_WABA_ID || '').trim()

function credenciales() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) return { error: 'Falta WHATSAPP_ACCESS_TOKEN en el servidor' }
  if (!waba()) return { error: 'Falta WHATSAPP_WABA_ID en el servidor: no se sabe en qué cuenta crear las plantillas' }
  return { token }
}

/**
 * Llama a Meta y devuelve su error tal cual cuando lo hay.
 *
 * Los mensajes de Meta son específicos y útiles ("las plantillas con título
 * IMAGE requieren un ejemplo") — traducirlos o resumirlos solo quita
 * información a quien está tratando de que le aprueben algo.
 */
async function meta(ruta, { metodo = 'GET', token, cuerpo = null } = {}) {
  const r = await fetch(`${GRAPH}/${version()}/${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data?.error) {
    const e = data?.error || {}
    return { ok: false, status: r.status || 502, error: e.error_user_msg || e.message || `Error ${r.status}`, detalle: e }
  }
  return { ok: true, data }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas las plantillas de la cuenta, paginando hasta el final.
 *
 * `previous_category` viaja a propósito: **Meta reclasifica**. Una plantilla
 * enviada como UTILITY vuelve como MARKETING si el texto le suena promocional
 * (basta mencionar precios), y MARKETING se cobra distinto y exige
 * consentimiento. Si no se muestra, el cambio pasa desapercibido hasta la
 * factura.
 */
export async function listarPlantillas() {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }

  const campos = 'name,status,category,previous_category,language,components,quality_score,rejected_reason,parameter_format,id'
  let ruta = `${waba()}/message_templates?limit=200&fields=${campos}`
  const plantillas = []

  while (ruta) {
    const r = await meta(ruta, { token })
    if (!r.ok) return { status: r.status, body: { ok: false, error: r.error } }
    plantillas.push(...(r.data.data || []))
    const siguiente = r.data.paging?.next
    ruta = siguiente ? siguiente.replace(`${GRAPH}/${version()}/`, '') : null
  }

  return {
    status: 200,
    body: {
      ok: true,
      waba: waba(),
      total: plantillas.length,
      plantillas: plantillas.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Crear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revisa lo que se puede revisar aquí y deja el resto a Meta.
 *
 * A propósito NO se replican los topes de longitud ni las reglas de botones de
 * Meta: cambian sin avisar y una copia desactualizada rechazaría plantillas
 * perfectamente válidas. Se comprueba lo que es verdad siempre —el formato del
 * nombre, que haya cuerpo, que cada variable tenga ejemplo— y el veredicto lo
 * da Meta, con su mensaje textual.
 */
function revisar({ nombre, categoria, componentes }) {
  const problemas = []

  if (!NOMBRE_VALIDO.test(String(nombre || ''))) {
    problemas.push('El nombre solo admite minúsculas, números y guion bajo (ej: recordatorios_listos).')
  }
  if (!CATEGORIAS.includes(categoria)) {
    problemas.push(`La categoría debe ser una de: ${CATEGORIAS.join(', ')}.`)
  }
  if (!Array.isArray(componentes) || !componentes.length) {
    problemas.push('La plantilla necesita al menos un cuerpo.')
    return problemas
  }

  const cuerpo = componentes.find(c => c?.type === 'BODY')
  if (!cuerpo || !String(cuerpo.text || '').trim()) {
    problemas.push('El cuerpo del mensaje no puede quedar vacío.')
  }

  // Cada {{n}} necesita su ejemplo: sin él Meta rechaza, y su error llega
  // después de que la persona ya creyó haber terminado.
  for (const c of componentes) {
    const texto = String(c?.text || '')
    const vars = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
    if (!vars.length) continue

    const esperados = [...new Set(vars)].sort((a, b) => a - b)
    if (esperados[0] !== 1 || esperados.some((n, i) => n !== i + 1)) {
      problemas.push(`En ${c.type} las variables deben ir seguidas desde {{1}} (encontradas: ${esperados.join(', ')}).`)
    }
    const ejemplos = c.type === 'BODY'
      ? (c.example?.body_text?.[0] || [])
      : (c.example?.header_text || [])
    if (ejemplos.length !== esperados.length) {
      problemas.push(`En ${c.type} hay ${esperados.length} variable(s) y ${ejemplos.length} ejemplo(s): Meta necesita uno por variable para poder revisarla.`)
    }
  }

  return problemas
}

export async function crearPlantilla({ nombre, idioma = 'es_MX', categoria = 'UTILITY', componentes }) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }

  const problemas = revisar({ nombre, categoria, componentes })
  if (problemas.length) {
    return { status: 422, body: { ok: false, error: problemas[0], problemas } }
  }

  const r = await meta(`${waba()}/message_templates`, {
    metodo: 'POST', token,
    cuerpo: { name: nombre, language: idioma, category: categoria, components: componentes },
  })
  if (!r.ok) {
    log(MOD, `Meta rechazó la plantilla ${nombre} —`, r.error)
    return { status: r.status, body: { ok: false, error: r.error, detalle: r.detalle } }
  }

  log(MOD, `plantilla ${nombre} enviada a revisión (${r.data.category || categoria})`)
  return {
    status: 200,
    body: {
      ok: true, id: r.data.id, estado: r.data.status, categoria: r.data.category,
      // Meta puede recategorizar en el acto. Decirlo aquí evita la sorpresa en
      // la factura: MARKETING se cobra distinto que UTILITY.
      aviso: r.data.category && r.data.category !== categoria
        ? `Meta la reclasificó como ${r.data.category} (la enviaste como ${categoria}). Se cobra distinto: revisa el texto si esperabas ${categoria}.`
        : null,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ El token del backend CREA pero no BORRA: para borrar, Meta pide permiso
 * sobre el negocio dueño de la WABA, que este token no tiene (comprobado
 * 2026-08-12: `(#100) Need permission on either WhatsApp Business Account or
 * owner/shared business`). Se devuelve ese mensaje con la salida real —
 * WhatsApp Manager— en vez de un 500 sin explicación.
 */
export async function borrarPlantilla({ nombre }) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }
  if (!NOMBRE_VALIDO.test(String(nombre || ''))) {
    return { status: 422, body: { ok: false, error: 'Nombre de plantilla inválido' } }
  }

  const r = await meta(`${waba()}/message_templates?name=${encodeURIComponent(nombre)}`, {
    metodo: 'DELETE', token,
  })
  if (!r.ok) {
    const sinPermiso = /permission/i.test(r.error || '')
    return {
      status: r.status,
      body: {
        ok: false,
        error: sinPermiso
          ? 'Este token puede crear plantillas pero no borrarlas: Meta exige permiso sobre el negocio dueño de la cuenta. Bórrala desde WhatsApp Manager.'
          : r.error,
      },
    }
  }
  log(MOD, `plantilla ${nombre} borrada`)
  return { status: 200, body: { ok: true } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manda una plantilla a un número. **Esto es lo que funciona fuera de las 24h**
 * — es su única razón de ser; para responder dentro de la ventana está
 * `enviarTexto`, que es más barato y más natural.
 *
 * `variables` son los valores de {{1}}, {{2}}… en orden. `variablesBoton` son
 * los del botón con enlace dinámico, si lo tiene.
 */
export async function enviarPlantilla({ contacto, nombre, idioma = 'es_MX', variables = [], variablesBoton = [], personalId = null }) {
  const num = String(contacto || '').replace(/\D/g, '')
  if (num.length < 10) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) return { status: 500, body: { ok: false, error: 'WhatsApp no está configurado en el servidor' } }

  const desde = (process.env.WHATSAPP_ALLOWED_PHONE_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0]
  if (!desde) return { status: 500, body: { ok: false, error: 'No hay número configurado para enviar' } }

  const componentes = []
  if (variables.length) {
    componentes.push({
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v ?? '') })),
    })
  }
  if (variablesBoton.length) {
    componentes.push({
      type: 'button', sub_type: 'url', index: '0',
      parameters: variablesBoton.map(v => ({ type: 'text', text: String(v ?? '') })),
    })
  }

  const r = await meta(`${desde}/messages`, {
    metodo: 'POST', token,
    cuerpo: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: num,
      type: 'template',
      template: { name: nombre, language: { code: idioma }, ...(componentes.length ? { components: componentes } : {}) },
    },
  })

  if (!r.ok) {
    log(MOD, `Meta rechazó el envío de ${nombre} a ${num} —`, r.error)
    // Igual que en la bandeja: queda el rastro del intento fallido, para que no
    // desaparezca sin dejar huella.
    await pool.query(
      `INSERT INTO public.whatsapp_mensajes
         (phone_number_id, contacto, direccion, tipo, texto, estado, estado_en, error, enviado_por)
       VALUES ($1,$2,'OUT','template',$3,'failed',now(),$4,$5)`,
      [desde, num, `[plantilla ${nombre}]`, r.error, personalId]
    ).catch(e => log(MOD, 'no se pudo registrar el fallo —', e.message))
    return { status: r.status, body: { ok: false, error: r.error } }
  }

  const wamid = r.data?.messages?.[0]?.id || null
  // El texto que se guarda es el nombre de la plantilla y sus valores: sin esto
  // la bandeja mostraría un hueco donde hubo un mensaje real.
  const resumen = `[plantilla ${nombre}]${variables.length ? ' ' + variables.join(' · ') : ''}`

  const { rows } = await pool.query(
    `INSERT INTO public.whatsapp_mensajes
       (phone_number_id, contacto, direccion, wa_message_id, tipo, texto, estado, estado_en, enviado_por)
     VALUES ($1,$2,'OUT',$3,'template',$4,'sent',now(),$5)
     ON CONFLICT DO NOTHING
     RETURNING id, direccion, tipo, texto, estado, ocurrido_en, wa_message_id`,
    [desde, num, wamid, resumen, personalId]
  )

  // Mandar una plantilla es hablarle a alguien, así que cuenta como atendido —
  // pero solo si lo hizo una persona. Ver el bug del 11-ago en whatsapp-cloud.js.
  if (personalId) {
    await pool.query(
      `UPDATE public.whatsapp_contactos SET ultimo_leido_en = now() WHERE contacto = $1`, [num]
    ).catch(() => {})
  }

  log(MOD, `plantilla ${nombre} enviada a ${num} (wamid=${wamid || '-'})`)
  return { status: 200, body: { ok: true, wa_message_id: wamid, mensaje: rows[0] || null } }
}
