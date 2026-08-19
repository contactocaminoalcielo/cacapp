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
// ── Lo que se comprobó contra la API real el 2026-08-19 ─────────────────────
// (WABA 596644673438490, v26.0 — no de memoria: se creó, se editó y se borró)
//
//   ✅ `parameter_format: NAMED` → los huecos se llaman `{{mascota}}` en vez de
//      `{{1}}`. Es la diferencia entre un mapeo que se entiende de un vistazo y
//      uno en el que reordenar una frase desalinea los datos en silencio.
//   ✅ **Editar una plantilla APROBADA** con `POST /{template_id}` devuelve
//      `{"success":true}`. El módulo creía que había que borrarla y recrearla.
//      Al editar vuelve a PENDING, pero conserva nombre e id (y por tanto el
//      mapeo de variables, que va por nombre).
//      ⚠️ Lo que NO se puede es editar una que está **en revisión**: ahí Meta
//      responde "solo se pueden editar si se rechazaron" (`error_subcode
//      2388003`). O sea: APROBADA o RECHAZADA sí, PENDIENTE no.
//   ✅ Cabecera con IMAGEN / VIDEO / PDF. Lo que se rechaza (`error_subcode
//      2388273`) es pasar una URL; hay que subir el archivo por la Resumable
//      Upload API y mandar el `header_handle` que devuelve. Ver `subirCabecera`.
//   ✅ Botones PHONE_NUMBER y COPY_CODE junto a los de siempre.
//
// Variables en /opt/orbit-backend/.env:
//   WHATSAPP_ACCESS_TOKEN — token permanente de la app de Meta
//   WHATSAPP_API_VERSION  — v26.0
//   WHATSAPP_WABA_ID      — la cuenta de WhatsApp donde viven las plantillas
//   WHATSAPP_APP_ID       — opcional: si falta se deduce del propio token
import { pool, log } from './db.js'
import { construirEnlace } from './reglas-imagenes.js'

const MOD = '[wa-plantillas]'
const GRAPH = 'https://graph.facebook.com'

/** Solo minúsculas, números y guion bajo: es lo que Meta acepta como nombre. */
const NOMBRE_VALIDO = /^[a-z0-9_]{1,512}$/

/** Un hueco con nombre: `{{mascota_nombre}}`. Meta exige este mismo formato. */
const PARAM_VALIDO = /^[a-z][a-z0-9_]{0,23}$/

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

const CAMPOS_META = 'name,status,category,previous_category,language,components,quality_score,rejected_reason,parameter_format,id'

// ─────────────────────────────────────────────────────────────────────────────
// Listar / obtener
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

  let ruta = `${waba()}/message_templates?limit=200&fields=${CAMPOS_META}`
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

/**
 * Una plantilla concreta, tal como está HOY en Meta.
 *
 * El envío se arma desde aquí y no desde lo que mande la pantalla: los huecos,
 * su formato (numerados o con nombre) y el tipo de cabecera los decide la
 * plantilla aprobada, no quien pulsa "Enviar". Si alguien la edita en WhatsApp
 * Manager, el envío sigue saliendo bien sin tocar Orbit.
 */
async function obtenerPlantilla(nombre, idioma, token) {
  const r = await meta(
    `${waba()}/message_templates?name=${encodeURIComponent(nombre)}`
    + `&language=${encodeURIComponent(JSON.stringify([idioma]))}`
    + `&fields=${CAMPOS_META}`,
    { token }
  )
  if (!r.ok) return { error: r.error, status: r.status }
  const p = (r.data.data || []).find(x => x.name === nombre && x.language === idioma)
  if (!p) return { error: `No existe la plantilla "${nombre}" en ${idioma} en esta cuenta`, status: 404 }
  return { plantilla: p }
}

/** El componente de un tipo. */
const componente = (p, tipo) => (p?.components || []).find(c => c.type === tipo)

/** Los huecos de un texto, en orden de aparición y sin repetir. */
function huecosDe(texto) {
  const vistos = []
  for (const m of String(texto || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!vistos.includes(m[1])) vistos.push(m[1])
  }
  return vistos
}

/** Los huecos de un componente, ya normalizados a `{destino, posicion|param}`. */
function huecosDeComponente(p, destino) {
  const texto = destino === 'BUTTON'
    ? componente(p, 'BUTTONS')?.buttons?.find(b => b.type === 'URL')?.url
    : componente(p, destino)?.text
  const named = p?.parameter_format === 'NAMED'
  return huecosDe(texto).map(h => (named ? { destino, param: h } : { destino, posicion: Number(h) }))
}

/** La clave con la que se guarda y se busca un hueco. */
const claveHueco = h => `${h.destino}:${h.param ?? h.posicion}`

// ─────────────────────────────────────────────────────────────────────────────
// Crear y editar
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
function revisar({ nombre, categoria, componentes, formato = 'POSITIONAL', nuevaPlantilla = true }) {
  const problemas = []

  if (nuevaPlantilla && !NOMBRE_VALIDO.test(String(nombre || ''))) {
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

  // El pie NUNCA admite variables. No es un tope que Meta vaya a mover: es que
  // el pie es texto fijo por diseño, y el rechazo llega sin decir por qué.
  const pie = componentes.find(c => c?.type === 'FOOTER')
  if (pie && huecosDe(pie.text).length) {
    problemas.push('El pie no admite variables: es texto fijo. Mueve el dato al cuerpo.')
  }

  // Cabecera de imagen/video/documento: Meta pide el archivo YA SUBIDO
  // (`header_handle`). Una URL se rechaza con `error_subcode 2388273`, y ese
  // error no dice qué hacer.
  const cab = componentes.find(c => c?.type === 'HEADER')
  if (cab && cab.format && cab.format !== 'TEXT' && cab.format !== 'LOCATION') {
    if (!cab.example?.header_handle?.[0]) {
      problemas.push(`La cabecera de ${cab.format} necesita el archivo subido a Meta antes de crear la plantilla.`)
    }
  }
  if (cab?.format === 'TEXT' && huecosDe(cab.text).length > 1) {
    problemas.push('El título admite como mucho una variable.')
  }

  // Cada hueco necesita su ejemplo: sin él Meta rechaza, y su error llega
  // después de que la persona ya creyó haber terminado.
  for (const c of componentes) {
    const huecos = huecosDe(c?.text)
    if (!huecos.length) continue

    if (formato === 'NAMED') {
      const malo = huecos.find(h => !PARAM_VALIDO.test(h))
      if (malo) {
        problemas.push(`"{{${malo}}}" no vale como nombre de variable: minúsculas, números y guion bajo, empezando por letra.`)
      }
      const dados = (c.type === 'BODY'
        ? c.example?.body_text_named_params
        : c.example?.header_text_named_params) || []
      const faltan = huecos.filter(h => !dados.some(d => d.param_name === h && String(d.example || '').trim()))
      if (faltan.length) {
        problemas.push(`Falta el ejemplo de ${faltan.map(h => `{{${h}}}`).join(', ')}: Meta necesita uno por variable para poder revisarla.`)
      }
    } else {
      const esperados = [...new Set(huecos.map(Number))].sort((a, b) => a - b)
      if (esperados.some(n => !Number.isInteger(n) || n < 1)) {
        problemas.push(`En ${c.type} hay una variable que no es un número: usa {{1}}, {{2}}… o cambia la plantilla a variables con nombre.`)
      } else if (esperados[0] !== 1 || esperados.some((n, i) => n !== i + 1)) {
        problemas.push(`En ${c.type} las variables deben ir seguidas desde {{1}} (encontradas: ${esperados.join(', ')}).`)
      }
      const ejemplos = c.type === 'BODY'
        ? (c.example?.body_text?.[0] || [])
        : (c.example?.header_text || [])
      if (ejemplos.filter(e => String(e || '').trim()).length !== esperados.length) {
        problemas.push(`En ${c.type} hay ${esperados.length} variable(s) y ${ejemplos.length} ejemplo(s): Meta necesita uno por variable para poder revisarla.`)
      }
    }
  }

  return problemas
}

export async function crearPlantilla({ nombre, idioma = 'es_MX', categoria = 'UTILITY', componentes, formato = 'POSITIONAL' }) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }

  const problemas = revisar({ nombre, categoria, componentes, formato })
  if (problemas.length) {
    return { status: 422, body: { ok: false, error: problemas[0], problemas } }
  }

  const r = await meta(`${waba()}/message_templates`, {
    metodo: 'POST', token,
    cuerpo: {
      name: nombre, language: idioma, category: categoria,
      parameter_format: formato,
      components: componentes,
    },
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

/**
 * Cambia el texto de una plantilla que ya existe.
 *
 * Durante meses se creyó que esto no se podía y que tocaba **borrar y recrear**
 * — de ahí el miedo a tocar una plantilla en uso. Comprobado el 2026-08-19:
 * `POST /{template_id}` sobre una APROBADA responde `{"success":true}`.
 *
 * Lo que sí cambia: vuelve a PENDING y hay que esperar la revisión otra vez. El
 * **nombre y el id se conservan**, así que el mapeo de variables (que va por
 * nombre + idioma) sigue en pie sin tocar nada.
 *
 * ⚠️ El NOMBRE no se puede cambiar; el idioma tampoco. Para eso sí toca crear
 * otra. Y **mientras Meta la revisa no se deja editar** — hay que esperar a que
 * la apruebe o la rechace.
 */
export async function editarPlantilla({ id, nombre, categoria, componentes, formato = 'POSITIONAL' }) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }
  if (!id) return { status: 422, body: { ok: false, error: 'Falta el id de la plantilla a editar' } }

  const problemas = revisar({ nombre, categoria, componentes, formato, nuevaPlantilla: false })
  if (problemas.length) {
    return { status: 422, body: { ok: false, error: problemas[0], problemas } }
  }

  const r = await meta(String(id), {
    metodo: 'POST', token,
    cuerpo: { category: categoria, components: componentes },
  })
  if (!r.ok) {
    log(MOD, `Meta rechazó la edición de ${nombre} —`, r.error)
    return { status: r.status, body: { ok: false, error: r.error, detalle: r.detalle } }
  }

  log(MOD, `plantilla ${nombre} editada (vuelve a revisión)`)
  return {
    status: 200,
    body: {
      ok: true, id,
      aviso: 'Editada. Vuelve a revisión de Meta: mientras tanto no se puede enviar. El mapeo de datos se conserva.',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Borra la plantilla en Meta.
 *
 * Falló durante un tiempo con `(#100) Need permission on either WhatsApp
 * Business Account or owner/shared business` y **no era cuestión de scopes**:
 * el usuario de sistema del backend no estaba asignado a esa WABA. Se arregló
 * con `POST /{waba}/assigned_users`. Si vuelve a salir ese error, mirar
 * `GET /{waba}/assigned_users`, no `debug_token`.
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
          ? 'Este token puede crear plantillas pero no borrarlas: el usuario de sistema no está asignado a esta cuenta de WhatsApp. Revisa GET /{waba}/assigned_users.'
          : r.error,
      },
    }
  }
  // El mapeo de una plantilla que ya no existe solo estorba: la clave es el
  // nombre, y un nombre reutilizado heredaría huecos de otra plantilla.
  await pool.query(
    `DELETE FROM public.whatsapp_plantilla_variables WHERE plantilla = $1`, [nombre]
  ).catch(e => log(MOD, 'no se pudo limpiar el mapeo —', e.message))
  await pool.query(
    `DELETE FROM public.whatsapp_plantilla_cabecera WHERE plantilla = $1`, [nombre]
  ).catch(() => {})

  log(MOD, `plantilla ${nombre} borrada`)
  return { status: 200, body: { ok: true } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subir el archivo de una cabecera (Resumable Upload API)
// ─────────────────────────────────────────────────────────────────────────────

let appIdMemoria = null

/**
 * El id de la app de Meta. Se deduce del propio token si no está en el `.env`.
 *
 * Deducirlo evita el fallo mudo de siempre: una variable de entorno nueva que
 * nadie añadió al servidor y una pantalla que deja de funcionar sin decir por
 * qué (ver `ops_backend_rol_y_url_reales`).
 */
async function appId(token) {
  const delEntorno = (process.env.WHATSAPP_APP_ID || '').trim()
  if (delEntorno) return delEntorno
  if (appIdMemoria) return appIdMemoria
  const r = await meta(
    `debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    { token }
  )
  appIdMemoria = r.ok ? r.data?.data?.app_id || null : null
  return appIdMemoria
}

/**
 * Sube un archivo a Meta y devuelve el `handle` que pide la cabecera.
 *
 * Son DOS llamadas y ninguna se parece a la de subir un archivo a una
 * conversación: se abre una sesión de subida contra la APP (no contra el
 * número) y luego se manda el binario con `Authorization: OAuth` —con `Bearer`
 * falla— y `file_offset: 0`.
 *
 * El handle solo sirve para dar de alta la plantilla; **al enviarla hay que
 * volver a mandar el medio**, y de eso se ocupa `whatsapp_plantilla_cabecera`.
 */
export async function subirCabecera({ base64, mime, nombre = 'archivo' }) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }

  let buf
  try { buf = Buffer.from(String(base64 || ''), 'base64') }
  catch { return { status: 400, body: { ok: false, error: 'No se pudo leer el archivo' } } }
  if (!buf.length) return { status: 400, body: { ok: false, error: 'El archivo llegó vacío' } }

  const app = await appId(token)
  if (!app) return { status: 500, body: { ok: false, error: 'No se pudo saber el id de la app de Meta (WHATSAPP_APP_ID)' } }

  const sesion = await meta(
    `${app}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(mime)}&file_name=${encodeURIComponent(nombre)}`,
    { metodo: 'POST', token }
  )
  if (!sesion.ok) return { status: sesion.status, body: { ok: false, error: sesion.error } }

  const r = await fetch(`${GRAPH}/${version()}/${sesion.data.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: buf,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data?.h) {
    const detalle = data?.error?.error_user_msg || data?.error?.message || `Error ${r.status}`
    log(MOD, 'Meta rechazó la subida de la cabecera —', detalle)
    return { status: 502, body: { ok: false, error: `No se pudo subir el archivo: ${detalle}` } }
  }
  return { status: 200, body: { ok: true, handle: data.h } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Qué dato de Orbit va en cada variable (migraciones 097 y 102)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catálogo CERRADO de lo que puede ir en un hueco.
 *
 * Es una lista fija a propósito. La alternativa —guardar la expresión que
 * escriba quien edita la plantilla— sería dejar que se escriban consultas desde
 * una pantalla; aquí lo que se guarda es una clave de esta tabla y nada más.
 *
 * `col` es el alias que devuelve `RESOLVER`, no una columna suelta: si algún día
 * cambia el modelo de datos, se arregla la consulta y las plantillas siguen
 * funcionando sin tocarlas.
 *
 * `formato` decide cómo se escribe el valor en el mensaje. Una fecha cruda
 * ("2026-08-20") o un precio sin puntos ("350000") delatan que el mensaje lo
 * escribió una máquina.
 *
 * ⚠️ `dinero: true` marca los campos que hablan de plata. **Meta reclasifica de
 * UTILITY a MARKETING una plantilla que menciona precios**, y MARKETING se cobra
 * distinto: la pantalla lo avisa antes de mapear uno.
 */
const CAMPOS = [
  // ── La mascota ────────────────────────────────────────────────────────────
  { clave: 'mascota.nombre',   grupo: 'Mascota', etiqueta: 'Nombre',            col: 'mascota_nombre',   ejemplo: 'Toby' },
  { clave: 'mascota.especie',  grupo: 'Mascota', etiqueta: 'Especie',           col: 'mascota_especie',  ejemplo: 'Perro' },
  { clave: 'mascota.raza',     grupo: 'Mascota', etiqueta: 'Raza',              col: 'mascota_raza',     ejemplo: 'Criollo' },
  { clave: 'mascota.sexo',     grupo: 'Mascota', etiqueta: 'Sexo',              col: 'mascota_sexo',     ejemplo: 'Macho' },
  { clave: 'mascota.tamano',   grupo: 'Mascota', etiqueta: 'Tamaño',            col: 'mascota_tamano',   ejemplo: 'Mediano' },
  { clave: 'mascota.peso',     grupo: 'Mascota', etiqueta: 'Peso (kg)',         col: 'mascota_peso',     ejemplo: '18' },

  // ── La familia ────────────────────────────────────────────────────────────
  // El primer nombre a secas es lo que se usa para saludar: "Hola, Marta" se
  // lee como una persona; "Hola, Marta Gómez Restrepo" se lee como un banco.
  { clave: 'cliente.nombre',    grupo: 'Familia', etiqueta: 'Primer nombre',        col: 'cliente_primer',    ejemplo: 'Marta' },
  { clave: 'cliente.completo',  grupo: 'Familia', etiqueta: 'Nombre y apellido',    col: 'cliente_completo',  ejemplo: 'Marta Gómez' },
  { clave: 'cliente.whatsapp',  grupo: 'Familia', etiqueta: 'WhatsApp',             col: 'cliente_whatsapp',  ejemplo: '573001234567' },
  { clave: 'cliente.ciudad',    grupo: 'Familia', etiqueta: 'Ciudad',               col: 'cliente_ciudad',    ejemplo: 'Bogotá' },
  { clave: 'cliente.direccion', grupo: 'Familia', etiqueta: 'Dirección',            col: 'cliente_direccion', ejemplo: 'Cra 15 # 80-25' },

  // ── El servicio ───────────────────────────────────────────────────────────
  { clave: 'plan.nombre',       grupo: 'Servicio', etiqueta: 'Plan contratado',      col: 'plan_nombre',       ejemplo: 'Standard' },
  { clave: 'plan.dias',         grupo: 'Servicio', etiqueta: 'Días prometidos',      col: 'plan_dias',         ejemplo: '15' },
  { clave: 'servicio.estado',   grupo: 'Servicio', etiqueta: 'Estado',               col: 'estado',            ejemplo: 'En producción', formato: 'estado' },
  { clave: 'servicio.ingreso',  grupo: 'Servicio', etiqueta: 'Fecha de ingreso',     col: 'fecha_ingreso',     ejemplo: '5 de agosto de 2026', formato: 'fecha' },
  { clave: 'servicio.entrega',  grupo: 'Servicio', etiqueta: 'Fecha límite de entrega', col: 'fecha_limite_entrega', ejemplo: '20 de agosto de 2026', formato: 'fecha' },
  { clave: 'servicio.entregado', grupo: 'Servicio', etiqueta: 'Fecha de entrega real', col: 'fecha_entrega_real', ejemplo: '19 de agosto de 2026', formato: 'fecha' },
  { clave: 'servicio.recogida', grupo: 'Servicio', etiqueta: 'Fecha de recogida',    col: 'fecha_recogida',    ejemplo: '5 de agosto de 2026', formato: 'fecha' },
  { clave: 'servicio.tecnico',  grupo: 'Servicio', etiqueta: 'Técnico que recogió',  col: 'tecnico_nombre',    ejemplo: 'Andrés' },
  { clave: 'aliado.nombre',     grupo: 'Servicio', etiqueta: 'Veterinaria aliada',   col: 'aliado_nombre',     ejemplo: 'Veterinaria Patitas' },

  // ── El portal de fotos ────────────────────────────────────────────────────
  // El enlace completo, no el código: pedirle a una familia que "entre a la web
  // y escriba AB12CD" pierde a la mitad por el camino.
  { clave: 'servicio.portal',   grupo: 'Portal de fotos', etiqueta: 'Enlace del portal', col: 'portal_enlace', ejemplo: 'https://orbit.orbitacac.com/#/fotos/AB12CD', formato: 'enlace' },
  { clave: 'servicio.codigo',   grupo: 'Portal de fotos', etiqueta: 'Código de acceso',  col: 'codigo_fotos',  ejemplo: 'AB12CD' },

  // ── Dinero ────────────────────────────────────────────────────────────────
  { clave: 'servicio.valor',    grupo: 'Dinero', etiqueta: 'Valor total',      col: 'valor_total',   ejemplo: '$ 350.000', formato: 'moneda', dinero: true },
  { clave: 'servicio.pagado',   grupo: 'Dinero', etiqueta: 'Valor pagado',     col: 'valor_pagado',  ejemplo: '$ 200.000', formato: 'moneda', dinero: true },
  { clave: 'servicio.saldo',    grupo: 'Dinero', etiqueta: 'Saldo pendiente',  col: 'saldo',         ejemplo: '$ 150.000', formato: 'moneda', dinero: true },
]

const campoPorClave = c => CAMPOS.find(x => x.clave === c)

/**
 * Todo lo que un servicio puede aportar, en una sola fila.
 *
 * El cliente cuelga de la MASCOTA, no del servicio — por eso el join va
 * `servicios → mascotas → clientes` y no directo.
 *
 * Recogida y entrega van por LATERAL con orden explícito: puede haber más de
 * una fila por servicio y un `LIMIT` sin `ORDER BY` devuelve la que quiera el
 * planificador, que es el tipo de fallo que no se ve hasta que el mensaje sale
 * con la fecha de otro intento.
 *
 * Las fechas salen como texto `YYYY-MM-DD` a propósito: convertirlas a `Date`
 * en Node las mueve un día según la zona horaria del contenedor (que corre en
 * Berlín, no en UTC). Se formatean a mano desde ese texto.
 */
const RESOLVER = `
  SELECT m.nombre                                   AS mascota_nombre,
         e.nombre                                   AS mascota_especie,
         m.raza                                     AS mascota_raza,
         m.sexo                                     AS mascota_sexo,
         m.tamano                                   AS mascota_tamano,
         m.peso_kg::text                            AS mascota_peso,
         SPLIT_PART(TRIM(c.nombre), ' ', 1)         AS cliente_primer,
         TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS cliente_completo,
         c.whatsapp                                 AS cliente_whatsapp,
         c.ciudad                                   AS cliente_ciudad,
         c.direccion                                AS cliente_direccion,
         p.nombre                                   AS plan_nombre,
         p.dias_entrega_prometidos::text            AS plan_dias,
         a.nombre                                   AS aliado_nombre,
         s.codigo_fotos                             AS codigo_fotos,
         s.estado                                   AS estado,
         s.fecha_ingreso::text                      AS fecha_ingreso,
         s.fecha_limite_entrega::text               AS fecha_limite_entrega,
         s.fecha_entrega_real::text                 AS fecha_entrega_real,
         rec.fecha_realizada::text                  AS fecha_recogida,
         SPLIT_PART(TRIM(tec.nombre), ' ', 1)        AS tecnico_nombre,
         s.valor_total::text                        AS valor_total,
         s.valor_pagado::text                       AS valor_pagado,
         GREATEST(COALESCE(s.valor_total,0) - COALESCE(s.valor_pagado,0), 0)::text AS saldo
    FROM public.servicios s
    LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
    LEFT JOIN public.especies e ON e.id = m.especie_id
    LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
    LEFT JOIN public.planes   p ON p.id = s.plan_id
    LEFT JOIN public.aliados  a ON a.id_aliado = s.aliado_origen_id
    LEFT JOIN public.personal tec ON tec.id = s.tecnico_id
    LEFT JOIN LATERAL (
      SELECT r.fecha_realizada
        FROM public.recogidas r
       WHERE r.servicio_id = s.id
       ORDER BY r.fecha_realizada DESC NULLS LAST, r.created_at DESC
       LIMIT 1
    ) rec ON TRUE
   WHERE s.id = $1`

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const ESTADOS = {
  INGRESADO: 'ingresado', EN_CUARTO_FRIO: 'en cuarto frío', EN_PROCESO: 'en proceso',
  EN_PRODUCCION: 'en producción', LISTO: 'listo para entrega', EN_ENTREGA: 'en camino',
  ENTREGADO: 'entregado', CANCELADO: 'cancelado',
}

/** `350000` → `$ 350.000`. Sin decimales: en pesos no significan nada. */
function enPesos(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return ''
  return '$ ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** `2026-08-20` → `20 de agosto de 2026`, sin pasar por `Date` (ver RESOLVER). */
function enLetras(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return String(iso || '')
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`
}

/**
 * Meta rechaza el mensaje entero si un parámetro trae saltos de línea,
 * tabuladores o más de cuatro espacios seguidos (#132000). Una dirección
 * copiada de un formulario los trae, y el error no dice cuál de los huecos fue.
 */
const saneado = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()

function formatear(valor, campo) {
  if (valor === null || valor === undefined || valor === '') return ''
  switch (campo?.formato) {
    case 'moneda': return enPesos(valor)
    case 'fecha':  return enLetras(valor)
    case 'estado': return ESTADOS[valor] || String(valor).toLowerCase().replace(/_/g, ' ')
    default:       return saneado(valor)
  }
}

/**
 * Busca un servicio por mascota, familia o código de fotos.
 *
 * Existe para que enviar una plantilla no empiece por **pegar un UUID**: nadie
 * tiene a mano `45c10fbf-9757-…`, así que en la práctica se acababa escribiendo
 * el nombre de la mascota a mano en cada envío — que es el hábito del que salen
 * las 251 plantillas con el texto quemado.
 */
export async function buscarServicios({ q = '', limite = 12 }) {
  const texto = String(q || '').trim()
  if (texto.length < 2) return { status: 200, body: { ok: true, servicios: [] } }

  const { rows } = await pool.query(
    `SELECT s.id, s.estado, s.codigo_fotos, s.fecha_ingreso::text AS fecha_ingreso,
            m.nombre AS mascota,
            TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS cliente,
            c.whatsapp AS whatsapp, p.nombre AS plan
       FROM public.servicios s
       LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes   p ON p.id = s.plan_id
      WHERE m.nombre ILIKE $1
         OR TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) ILIKE $1
         OR c.whatsapp ILIKE $1
         OR s.codigo_fotos ILIKE $1
      ORDER BY s.fecha_ingreso DESC NULLS LAST, s.created_at DESC
      LIMIT $2`,
    [`%${texto}%`, Math.min(Number(limite) || 12, 30)]
  )
  return { status: 200, body: { ok: true, servicios: rows } }
}

export function camposDisponibles() {
  return { status: 200, body: { ok: true, campos: CAMPOS.map(({ col, ...c }) => c) } }
}

export async function variablesDe({ plantilla, idioma = 'es_MX' }) {
  const { rows } = await pool.query(
    `SELECT destino, posicion, param, campo FROM public.whatsapp_plantilla_variables
      WHERE plantilla = $1 AND idioma = $2 ORDER BY destino, posicion NULLS LAST, param`,
    [plantilla, idioma]
  )
  const { rows: [cab] } = await pool.query(
    `SELECT c.material_id, c.url, m.nombre AS material_nombre, m.mime AS material_mime
       FROM public.whatsapp_plantilla_cabecera c
       LEFT JOIN public.whatsapp_materiales m ON m.id = c.material_id
      WHERE c.plantilla = $1 AND c.idioma = $2`,
    [plantilla, idioma]
  )
  return { status: 200, body: { ok: true, variables: rows, cabecera: cab || null } }
}

/** Reemplaza el mapeo entero: es más simple de razonar que ir campo por campo. */
export async function guardarVariables({ plantilla, idioma = 'es_MX', variables = [], cabecera = undefined, personalId = null }) {
  if (!NOMBRE_VALIDO.test(String(plantilla || ''))) {
    return { status: 422, body: { ok: false, error: 'Nombre de plantilla inválido' } }
  }
  const malo = variables.find(v => !campoPorClave(v?.campo))
  if (malo) {
    return { status: 422, body: { ok: false, error: `El dato "${malo.campo}" no está en el catálogo` } }
  }
  const sinHueco = variables.find(v => !v?.param && !(Number(v?.posicion) >= 1))
  if (sinHueco) {
    return { status: 422, body: { ok: false, error: 'Cada dato tiene que ir en un hueco: número o nombre' } }
  }
  const paramMalo = variables.find(v => v?.param && !PARAM_VALIDO.test(v.param))
  if (paramMalo) {
    return { status: 422, body: { ok: false, error: `"${paramMalo.param}" no vale como nombre de variable` } }
  }

  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    await cliente.query(
      `DELETE FROM public.whatsapp_plantilla_variables WHERE plantilla = $1 AND idioma = $2`,
      [plantilla, idioma]
    )
    for (const v of variables) {
      await cliente.query(
        `INSERT INTO public.whatsapp_plantilla_variables
           (plantilla, idioma, destino, posicion, param, campo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [plantilla, idioma, v.destino || 'BODY',
         v.param ? null : Number(v.posicion), v.param || null, v.campo, personalId]
      )
    }

    // `undefined` = la pantalla no habla de la cabecera → no se toca. `null` =
    // la quitó. Sin esa distinción, guardar el mapeo del cuerpo borraría el
    // archivo de la cabecera sin que nadie lo pidiera.
    if (cabecera !== undefined) {
      await cliente.query(
        `DELETE FROM public.whatsapp_plantilla_cabecera WHERE plantilla = $1 AND idioma = $2`,
        [plantilla, idioma]
      )
      if (cabecera && (cabecera.material_id || String(cabecera.url || '').trim())) {
        await cliente.query(
          `INSERT INTO public.whatsapp_plantilla_cabecera
             (plantilla, idioma, material_id, url, actualizado_por)
           VALUES ($1,$2,$3,$4,$5)`,
          [plantilla, idioma, cabecera.material_id || null,
           String(cabecera.url || '').trim() || null, personalId]
        )
      }
    }

    await cliente.query('COMMIT')
    log(MOD, `${plantilla}: ${variables.length} variable(s) asignada(s)`)
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {})
    return { status: 500, body: { ok: false, error: e.message } }
  } finally {
    cliente.release()
  }
}

/**
 * Los valores de un servicio para una plantilla, hueco por hueco.
 *
 * Devuelve también los huecos SIN dato: mandar una plantilla con un `{{2}}`
 * vacío le llega a la persona con un espacio en blanco en mitad de la frase, y
 * es mejor decirlo antes de enviar que después.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El número como lo quiere Meta: dígitos con indicativo, sin `+`.
 *
 * Hace falta AQUÍ y no en la bandeja porque los números de la bandeja llegan de
 * Meta ya internacionales (`573…`), mientras que `clientes.whatsapp` guarda diez
 * dígitos (`3002214704`). Mandar esos diez a Cloud API no es un error visible:
 * Meta acepta la llamada y el mensaje no llega a nadie.
 */
function aInternacional(v) {
  const d = String(v || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10 && d.startsWith('3')) return '57' + d      // celular colombiano
  return d
}

export async function valoresPara({ plantilla, idioma = 'es_MX', servicioId }) {
  // Sin esto, un id mal pegado sale como "Error interno" (22P02) y parece que
  // la pantalla está rota.
  if (!UUID.test(String(servicioId || ''))) {
    return { status: 422, body: { ok: false, error: 'Ese no es el id de un servicio' } }
  }
  const { body: { variables } } = await variablesDe({ plantilla, idioma })
  const { rows: [datos] } = await pool.query(RESOLVER, [servicioId])
  if (!datos) return { status: 404, body: { ok: false, error: 'No se encontró ese servicio' } }

  const valores = {}
  const sinAsignar = []
  for (const v of variables) {
    const campo = campoPorClave(v.campo)
    // El enlace del portal se arma con la misma función que usa el flujo de
    // imágenes: dos formas de construirlo acabarían discrepando y una de ellas
    // mandaría a la familia a una página que no existe.
    const crudo = campo?.col === 'portal_enlace'
      ? (datos.codigo_fotos ? construirEnlace(datos.codigo_fotos) : null)
      : campo ? datos[campo.col] : null
    const valor = formatear(crudo, campo)
    valores[claveHueco(v)] = valor
    if (!valor) sinAsignar.push(`${campo?.etiqueta || v.campo} (${v.destino} {{${v.param ?? v.posicion}}})`)
  }
  return {
    status: 200,
    body: {
      ok: true, variables, valores, sinAsignar,
      // El número de la familia de ese servicio: quien envía no tiene por qué
      // ir a buscarlo a otra pantalla.
      contacto: aInternacional(datos.cliente_whatsapp) || null,
      mascota: datos.mascota_nombre || null,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar
// ─────────────────────────────────────────────────────────────────────────────

/** Los bytes de la cabecera media configurada, si la hay. */
async function cabeceraDe(plantilla, idioma) {
  const { rows: [c] } = await pool.query(
    `SELECT c.url, m.archivo, m.mime, m.nombre_archivo
       FROM public.whatsapp_plantilla_cabecera c
       LEFT JOIN public.whatsapp_materiales m ON m.id = c.material_id
      WHERE c.plantilla = $1 AND c.idioma = $2`,
    [plantilla, idioma]
  )
  return c || null
}

/** Sube el medio de la cabecera al número y devuelve su id en Meta. */
async function mediaDeCabecera(buf, mime, nombre, phoneNumberId, token) {
  const fd = new FormData()
  fd.append('messaging_product', 'whatsapp')
  fd.append('type', mime)
  fd.append('file', new Blob([buf], { type: mime }), nombre || 'archivo')
  const r = await fetch(`${GRAPH}/${version()}/${phoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data?.id) {
    return { error: data?.error?.error_user_msg || data?.error?.message || `Error ${r.status}` }
  }
  return { id: data.id }
}

/**
 * Manda una plantilla a un número. **Esto es lo que funciona fuera de las 24h**
 * — es su única razón de ser; para responder dentro de la ventana está
 * `enviarTexto`, que es más barato y más natural.
 *
 * El sobre se arma leyendo la plantilla REAL en Meta, no lo que mande la
 * pantalla: los huecos, si van numerados o con nombre, y si la cabecera lleva
 * texto o una imagen los decide la plantilla aprobada. Así un cambio hecho en
 * WhatsApp Manager no rompe el envío en silencio.
 *
 * `valores` es un diccionario `{"BODY:1": "Toby", "HEADER:mascota": "Toby"}`.
 * Con `servicioId`, lo mapeado se rellena solo desde Orbit y lo escrito a mano
 * solo manda donde el mapeo no llega.
 */
export async function enviarPlantilla({
  contacto, nombre, idioma = 'es_MX', valores = {}, servicioId = null, personalId = null,
  // Compatibilidad con la forma vieja (arrays posicionales).
  variables = null, variablesBoton = null,
}) {
  const { token, error } = credenciales()
  if (error) return { status: 500, body: { ok: false, error } }

  const { plantilla, error: errPlantilla, status: stPlantilla } = await obtenerPlantilla(nombre, idioma, token)
  if (!plantilla) return { status: stPlantilla || 502, body: { ok: false, error: errPlantilla } }
  if (plantilla.status !== 'APPROVED') {
    return { status: 409, body: { ok: false, error: `La plantilla está ${plantilla.status}: Meta solo deja enviar las aprobadas.` } }
  }

  const dados = { ...valores }
  if (Array.isArray(variables)) variables.forEach((v, i) => { dados[`BODY:${i + 1}`] ??= v })
  if (Array.isArray(variablesBoton)) variablesBoton.forEach((v, i) => { dados[`BUTTON:${i + 1}`] ??= v })

  let num = aInternacional(contacto)

  // Con un servicio, los valores salen de Orbit y no de lo que teclee nadie —
  // que es el punto de asignar variables (migración 097). Lo escrito a mano se
  // respeta solo donde el mapeo no llega.
  if (servicioId) {
    const r = await valoresPara({ plantilla: nombre, idioma, servicioId })
    if (!r.body.ok) return { status: r.status, body: r.body }
    for (const [k, v] of Object.entries(r.body.valores)) { if (v) dados[k] = v }
    if (num.length < 10 && r.body.contacto) num = r.body.contacto
  }

  if (num.length < 10) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const desde = (process.env.WHATSAPP_ALLOWED_PHONE_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0]
  if (!desde) return { status: 500, body: { ok: false, error: 'No hay número configurado para enviar' } }

  const named = plantilla.parameter_format === 'NAMED'
  const parametro = (hueco, valor) => ({
    type: 'text',
    text: saneado(valor),
    ...(named ? { parameter_name: hueco.param } : {}),
  })

  const componentes = []
  const faltan = []
  const recoger = (destino) => huecosDeComponente(plantilla, destino).map(h => {
    const valor = dados[claveHueco(h)]
    if (!String(valor ?? '').trim()) faltan.push(`${destino} {{${h.param ?? h.posicion}}}`)
    return parametro(h, valor)
  })

  // ── Cabecera ──
  const cab = componente(plantilla, 'HEADER')
  if (cab?.format === 'TEXT') {
    const p = recoger('HEADER')
    if (p.length) componentes.push({ type: 'header', parameters: p })
  } else if (cab && cab.format !== 'LOCATION') {
    // Meta NO reutiliza el archivo con el que se aprobó la plantilla: hay que
    // mandarlo en cada envío. De ahí `whatsapp_plantilla_cabecera`.
    const conf = await cabeceraDe(nombre, idioma)
    const clase = cab.format.toLowerCase()   // image | video | document
    if (!conf) {
      return {
        status: 422,
        body: { ok: false, error: `Esta plantilla lleva una cabecera de ${cab.format} y no tiene archivo asignado. Asígnalo en "Datos" antes de enviarla.` },
      }
    }
    if (conf.archivo) {
      const sub = await mediaDeCabecera(conf.archivo, conf.mime, conf.nombre_archivo, desde, token)
      if (sub.error) return { status: 502, body: { ok: false, error: `No se pudo subir la cabecera: ${sub.error}` } }
      componentes.push({
        type: 'header',
        parameters: [{ type: clase, [clase]: { id: sub.id, ...(clase === 'document' ? { filename: conf.nombre_archivo } : {}) } }],
      })
    } else {
      componentes.push({ type: 'header', parameters: [{ type: clase, [clase]: { link: conf.url } }] })
    }
  }

  // ── Cuerpo ──
  const cuerpo = recoger('BODY')
  if (cuerpo.length) componentes.push({ type: 'body', parameters: cuerpo })

  // ── Botón de enlace ──
  // `index` es la POSICIÓN del botón en la lista, no un contador de variables:
  // con un botón de respuesta rápida delante, mandar '0' apunta al botón que no
  // es y Meta rechaza el envío.
  const botones = componente(plantilla, 'BUTTONS')?.buttons || []
  const iUrl = botones.findIndex(b => b.type === 'URL' && huecosDe(b.url).length)
  if (iUrl >= 0) {
    const p = recoger('BUTTON')
    if (p.length) componentes.push({ type: 'button', sub_type: 'url', index: String(iUrl), parameters: p })
  }

  if (faltan.length) {
    return {
      status: 422,
      body: { ok: false, error: `Faltan datos para ${faltan.join(', ')}. Un hueco vacío llega como un espacio en blanco en mitad de la frase.` },
    }
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

  const textos = componentes
    .flatMap(c => (c.parameters || []).filter(p => p.type === 'text').map(p => p.text))

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
  const resumen = `[plantilla ${nombre}]${textos.length ? ' ' + textos.join(' · ') : ''}`

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
