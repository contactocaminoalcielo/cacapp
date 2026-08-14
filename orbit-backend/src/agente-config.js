// Configuración del agente de WhatsApp y su base de conocimiento (migración 088).
//
// El agente es AISLADO: no consulta la operación. Todo lo que sabe sale de
// `agente_wa.instrucciones` + `agente_wa_conocimiento`, y este módulo es la
// única puerta para editarlos. Las tablas no están expuestas por PostgREST a
// propósito, así que la pantalla de configuración pasa por aquí.
//
// Este módulo NO ejecuta el agente — solo lo configura. El motor va aparte.
import { pool, log } from './db.js'

const MOD = '[agente-config]'

const TIPOS  = ['TEXTO', 'TABLA', 'IMAGEN', 'DOCUMENTO']
const EFFORT = ['low', 'medium', 'high', 'xhigh', 'max']

// Tope de la columna `bytes` en la migración. Se valida aquí además de en la DB
// para poder devolver un mensaje legible en vez de un error de constraint.
const MAX_BYTES = 5 * 1024 * 1024

const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Lo que la pantalla necesita de una pieza SIN traerse el binario. */
const CAMPOS_KB = `id, agente_id, tipo, titulo, texto, mime, bytes, orden, activo, creado_en`

// ─────────────────────────────────────────────────────────────────────────────
// El agente
// ─────────────────────────────────────────────────────────────────────────────

export async function obtenerAgente({ clave = 'VETERINARIAS' } = {}) {
  const { rows } = await pool.query(
    `SELECT id, clave, nombre, activo, instrucciones, modelo, effort, max_turnos,
            phone_number_ids, espera_ms, espera_max_ms,
            seguimiento_enlace_minutos, seguimiento_enlace_texto, creado_en, actualizado_en
       FROM public.agente_wa WHERE clave = $1`,
    [clave]
  )
  if (!rows.length) return { status: 404, body: { ok: false, error: `No existe el agente ${clave}` } }

  const agente = rows[0]
  const { rows: kb } = await pool.query(
    `SELECT ${CAMPOS_KB} FROM public.agente_wa_conocimiento
      WHERE agente_id = $1 ORDER BY orden, id`,
    [agente.id]
  )

  // El peso del contexto es lo que decide el coste por conversación, así que la
  // pantalla lo muestra en vez de dejarlo invisible hasta que llegue la factura.
  const activos = kb.filter(k => k.activo)
  return {
    status: 200,
    body: {
      ok: true,
      agente,
      conocimiento: kb,
      resumen: {
        piezas_activas:  activos.length,
        imagenes:        activos.filter(k => k.tipo === 'IMAGEN').length,
        caracteres_texto: activos.reduce((n, k) => n + (k.texto?.length || 0), 0)
                          + (agente.instrucciones?.length || 0),
        precios: await revisarPrecios(activos),
      },
    },
  }
}

/**
 * ¿Los precios que el agente tiene escritos siguen siendo los del catálogo?
 *
 * La base de conocimiento es TEXTO congelado: se escribió con los precios de un
 * día y nada la actualiza. El día que alguien cambie una tarifa en
 * Configuración, el agente va a seguir cotizando la vieja a todas las
 * veterinarias — en silencio, y sin que nadie lo note hasta el reclamo. Es la
 * misma familia de errores de dinero que ya nos ha mordido varias veces.
 *
 * No intenta adivinar QUÉ precio corresponde a qué plan (eso obligaría a
 * entender el formato del texto y se rompería al reescribirlo). Solo comprueba
 * lo verificable: que cada cifra con pinta de precio que aparece escrita exista
 * hoy en el catálogo. Si aparece una que ya nadie cobra, está desactualizada.
 */
async function revisarPrecios(piezas) {
  try {
    const { rows } = await pool.query('SELECT DISTINCT precio FROM public.v_precios_por_peso')
    if (!rows.length) return null

    const vigentes = new Set(rows.map(r => Math.round(Number(r.precio))))
    // Solo las piezas que de verdad listan tarifas: buscar cifras en el texto de
    // operación (donde vive el recargo de $10.000) daría falsos positivos.
    const texto = piezas
      .filter(p => /tarifa|precio/i.test(p.titulo || '') && p.texto)
      .map(p => p.texto).join('\n')
    if (!texto) return null

    // Los grupos de miles se toman COMPLETOS (`1.049.000`, no `049.000`): con un
    // patrón de un solo grupo, los precios del millón se partían y se reportaban
    // como desfasados dos cifras que nadie había escrito nunca.
    const escritos = [...new Set(
      (texto.match(/\d{1,3}(?:\.\d{3})+/g) || []).map(s => Number(s.replace(/\./g, '')))
    )]
    const desfasados = escritos.filter(n => !vigentes.has(n))

    return {
      revisados: escritos.length,
      desfasados: desfasados.sort((a, b) => a - b),
    }
  } catch (e) {
    // Un chequeo informativo no puede tumbar la pantalla de configuración.
    log('[agente/precios] no se pudo revisar —', e.message)
    return null
  }
}

export async function guardarAgente({ clave = 'VETERINARIAS', datos = {}, personalId }) {
  const campos = []
  const vals   = []
  const set    = (col, val) => { vals.push(val); campos.push(`${col} = $${vals.length}`) }

  if (datos.instrucciones !== undefined) {
    if (typeof datos.instrucciones !== 'string') {
      return { status: 400, body: { ok: false, error: 'instrucciones debe ser texto' } }
    }
    set('instrucciones', datos.instrucciones)
  }
  if (datos.activo !== undefined) set('activo', !!datos.activo)
  if (datos.modelo !== undefined) {
    if (!datos.modelo) return { status: 400, body: { ok: false, error: 'modelo no puede ir vacío' } }
    set('modelo', datos.modelo)
  }
  if (datos.effort !== undefined) {
    if (!EFFORT.includes(datos.effort)) {
      return { status: 400, body: { ok: false, error: `effort debe ser uno de: ${EFFORT.join(', ')}` } }
    }
    set('effort', datos.effort)
  }
  if (datos.max_turnos !== undefined) {
    const n = Number(datos.max_turnos)
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      return { status: 400, body: { ok: false, error: 'max_turnos debe ser un entero entre 1 y 200' } }
    }
    set('max_turnos', n)
  }
  if (datos.phone_number_ids !== undefined) {
    const ids = Array.isArray(datos.phone_number_ids) ? datos.phone_number_ids : []
    if (ids.some(v => typeof v !== 'string' || !/^\d{5,25}$/.test(v))) {
      return { status: 400, body: { ok: false, error: 'phone_number_ids: solo identificadores numéricos de Meta' } }
    }
    set('phone_number_ids', ids)
  }

  // ── Tiempos (migración 099) ──
  const entero = (v, min, max) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : null
  }
  if (datos.espera_ms !== undefined) {
    const n = entero(datos.espera_ms, 0, 120000)
    if (n === null) return { status: 400, body: { ok: false, error: 'La espera va entre 0 y 120000 ms' } }
    set('espera_ms', n)
  }
  if (datos.espera_max_ms !== undefined) {
    const n = entero(datos.espera_max_ms, 0, 300000)
    if (n === null) return { status: 400, body: { ok: false, error: 'El techo de espera va entre 0 y 300000 ms' } }
    set('espera_max_ms', n)
  }
  // El techo por debajo de la espera partiría la ráfaga justo en el hueco que la
  // espera intenta cubrir. La base también lo prohíbe, pero un CHECK devuelve un
  // error de Postgres ilegible: mejor decirlo aquí.
  if (datos.espera_ms !== undefined && datos.espera_max_ms !== undefined
      && Number(datos.espera_max_ms) < Number(datos.espera_ms)) {
    return { status: 400, body: { ok: false, error: 'El techo no puede ser menor que la espera' } }
  }
  if (datos.seguimiento_enlace_minutos !== undefined) {
    const n = entero(datos.seguimiento_enlace_minutos, 0, 1440)
    if (n === null) return { status: 400, body: { ok: false, error: 'Los minutos van entre 0 (apagado) y 1440' } }
    set('seguimiento_enlace_minutos', n)
  }
  if (datos.seguimiento_enlace_texto !== undefined) {
    const t = String(datos.seguimiento_enlace_texto || '').trim()
    if (t.length > 900) return { status: 400, body: { ok: false, error: 'El recordatorio es demasiado largo' } }
    set('seguimiento_enlace_texto', t || null)
  }

  if (!campos.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }

  set('actualizado_por', personalId || null)
  vals.push(clave)

  const { rows } = await pool.query(
    `UPDATE public.agente_wa SET ${campos.join(', ')}
      WHERE clave = $${vals.length}
      RETURNING id, clave, nombre, activo, instrucciones, modelo, effort, max_turnos,
                phone_number_ids, espera_ms, espera_max_ms,
                seguimiento_enlace_minutos, seguimiento_enlace_texto, actualizado_en`,
    vals
  )
  if (!rows.length) return { status: 404, body: { ok: false, error: `No existe el agente ${clave}` } }

  // Encender o apagar el agente es lo único aquí con efecto sobre gente real:
  // queda en el log para poder reconstruir cuándo empezó a responder.
  if (datos.activo !== undefined) {
    log(MOD, `agente ${clave} ${datos.activo ? 'ENCENDIDO' : 'APAGADO'} por personal=${personalId || '?'}`)
  }
  return { status: 200, body: { ok: true, agente: rows[0] } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base de conocimiento
// ─────────────────────────────────────────────────────────────────────────────

export async function agregarConocimiento({ agenteId, datos = {}, personalId }) {
  const { tipo, titulo } = datos
  if (!TIPOS.includes(tipo)) {
    return { status: 400, body: { ok: false, error: `tipo debe ser uno de: ${TIPOS.join(', ')}` } }
  }
  if (!titulo?.trim()) {
    return { status: 400, body: { ok: false, error: 'El título es obligatorio' } }
  }

  let texto = null, archivo = null, mime = null, bytes = null

  if (tipo === 'IMAGEN') {
    // Llega en base64 desde el navegador; Claude también las consume en base64,
    // así que se guarda el binario y se reconvierte al armar el contexto.
    const b64 = (datos.archivo_base64 || '').replace(/^data:[^;]+;base64,/, '')
    if (!b64) return { status: 400, body: { ok: false, error: 'Falta el archivo de la imagen' } }
    if (!MIMES_IMAGEN.includes(datos.mime)) {
      return { status: 400, body: { ok: false, error: `Formato no admitido. Usa: ${MIMES_IMAGEN.join(', ')}` } }
    }
    archivo = Buffer.from(b64, 'base64')
    bytes   = archivo.length
    mime    = datos.mime
    if (!bytes) return { status: 400, body: { ok: false, error: 'La imagen llegó vacía o mal codificada' } }
    if (bytes > MAX_BYTES) {
      return { status: 400, body: {
        ok: false,
        error: `La imagen pesa ${(bytes / 1048576).toFixed(1)} MB y el tope son 5 MB. Recórtala o bájale la resolución.`,
      } }
    }
  } else {
    texto = (datos.texto || '').trim()
    if (!texto) return { status: 400, body: { ok: false, error: 'El contenido no puede ir vacío' } }
  }

  const { rows } = await pool.query(
    `INSERT INTO public.agente_wa_conocimiento
       (agente_id, tipo, titulo, texto, archivo, mime, bytes, orden, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             COALESCE((SELECT MAX(orden) + 1 FROM public.agente_wa_conocimiento WHERE agente_id = $1), 0),
             $8)
     RETURNING ${CAMPOS_KB}`,
    [agenteId, tipo, titulo.trim(), texto, archivo, mime, bytes, personalId || null]
  )
  return { status: 200, body: { ok: true, pieza: rows[0] } }
}

export async function actualizarConocimiento({ id, datos = {} }) {
  const campos = []
  const vals   = []
  const set    = (col, val) => { vals.push(val); campos.push(`${col} = $${vals.length}`) }

  if (datos.titulo !== undefined) {
    if (!datos.titulo?.trim()) return { status: 400, body: { ok: false, error: 'El título es obligatorio' } }
    set('titulo', datos.titulo.trim())
  }
  if (datos.texto !== undefined) set('texto', datos.texto)
  if (datos.activo !== undefined) set('activo', !!datos.activo)
  if (datos.orden !== undefined) set('orden', Number(datos.orden) || 0)

  if (!campos.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }
  vals.push(id)

  const { rows } = await pool.query(
    `UPDATE public.agente_wa_conocimiento SET ${campos.join(', ')}
      WHERE id = $${vals.length} RETURNING ${CAMPOS_KB}`,
    vals
  )
  if (!rows.length) return { status: 404, body: { ok: false, error: 'La pieza no existe' } }
  return { status: 200, body: { ok: true, pieza: rows[0] } }
}

export async function borrarConocimiento({ id }) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.agente_wa_conocimiento WHERE id = $1`, [id]
  )
  if (!rowCount) return { status: 404, body: { ok: false, error: 'La pieza no existe' } }
  return { status: 200, body: { ok: true } }
}

/** El binario de una imagen, para la vista previa de la pantalla. */
export async function archivoConocimiento({ id }) {
  const { rows } = await pool.query(
    `SELECT mime, archivo FROM public.agente_wa_conocimiento WHERE id = $1 AND tipo = 'IMAGEN'`,
    [id]
  )
  if (!rows.length || !rows[0].archivo) {
    return { status: 404, body: { ok: false, error: 'No hay imagen para esa pieza' } }
  }
  return {
    status: 200,
    body: { ok: true, mime: rows[0].mime, base64: rows[0].archivo.toString('base64') },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bitácora
// ─────────────────────────────────────────────────────────────────────────────

export async function listarEjecuciones({ agenteId, limite = 50 }) {
  const n = Math.min(Math.max(Number(limite) || 50, 1), 200)
  const { rows } = await pool.query(
    `SELECT id, contacto, phone_number_id, origen, entrada, salida, herramientas,
            tokens_entrada, tokens_salida, error, creado_en
       FROM public.agente_wa_ejecuciones
      WHERE agente_id = $1
      ORDER BY creado_en DESC
      LIMIT $2`,
    [agenteId, n]
  )
  return { status: 200, body: { ok: true, ejecuciones: rows } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Valoraciones y reglas (migración 099)
//
// El circuito: en el chat se marca una respuesta del agente como buena o mala y
// se escribe qué debió decir → queda como VALORACIÓN → coordinación revisa y
// asciende las que valgan a REGLA → las reglas activas sí entran en el contexto.
//
// ⚠️ Nada asciende solo, y es deliberado: con cada corrección entrando sola, el
// contexto crece sin control y dos correcciones que se contradigan vuelven al
// agente errático sin que nadie lo note.
// ─────────────────────────────────────────────────────────────────────────────

/** El agente dueño de la línea por la que salió ese mensaje. */
async function agenteDelMensaje(mensajeId) {
  const { rows } = await pool.query(
    `SELECT a.id, m.direccion, m.enviado_por
       FROM public.whatsapp_mensajes m
       LEFT JOIN public.agente_wa a ON m.phone_number_id = ANY(a.phone_number_ids)
      WHERE m.id = $1`,
    [mensajeId]
  )
  return rows[0] || null
}

export async function valorarRespuesta({ mensajeId, buena, correccion, personalId }) {
  const id = Number(mensajeId)
  if (!Number.isInteger(id)) return { status: 400, body: { ok: false, error: 'Mensaje inválido' } }
  if (typeof buena !== 'boolean') return { status: 400, body: { ok: false, error: 'Falta decir si estuvo bien o mal' } }

  const m = await agenteDelMensaje(id)
  if (!m) return { status: 404, body: { ok: false, error: 'Ese mensaje no existe' } }
  if (!m.id) return { status: 400, body: { ok: false, error: 'Ese mensaje no es de una línea con agente' } }
  // Valorar lo que escribió una persona no significa nada: la corrección es
  // para el agente, y `enviado_por` es justo lo que los distingue.
  if (m.direccion !== 'OUT' || m.enviado_por) {
    return { status: 400, body: { ok: false, error: 'Solo se valoran las respuestas del agente' } }
  }

  const texto = String(correccion || '').trim().slice(0, 2000) || null
  const { rows } = await pool.query(
    `INSERT INTO public.agente_wa_valoraciones (mensaje_id, agente_id, buena, correccion, personal_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (mensaje_id) DO UPDATE
        SET buena = EXCLUDED.buena, correccion = EXCLUDED.correccion,
            personal_id = EXCLUDED.personal_id, estado = 'NUEVA',
            creado_en = now(), resuelto_en = NULL
     RETURNING id, mensaje_id, buena, correccion, estado`,
    [id, m.id, !!buena, texto, personalId || null]
  )
  return { status: 200, body: { ok: true, valoracion: rows[0] } }
}

export async function listarValoraciones({ agenteId, estado = 'NUEVA', limite = 100 }) {
  const { rows } = await pool.query(
    `SELECT v.id, v.buena, v.correccion, v.estado, v.creado_en,
            m.contacto, m.texto AS respuesta, m.ocurrido_en,
            p.nombre AS quien,
            (SELECT string_agg(x.texto, ' | ' ORDER BY x.id)
               FROM (SELECT texto, id FROM public.whatsapp_mensajes
                      WHERE contacto = m.contacto AND direccion = 'IN' AND id < m.id
                      ORDER BY id DESC LIMIT 2) x) AS pregunto
       FROM public.agente_wa_valoraciones v
       JOIN public.whatsapp_mensajes m ON m.id = v.mensaje_id
       LEFT JOIN public.personal p ON p.id = v.personal_id
      WHERE v.agente_id = $1 AND ($2 = 'TODAS' OR v.estado = $2)
      ORDER BY v.creado_en DESC
      LIMIT $3`,
    [agenteId, estado, Math.min(Number(limite) || 100, 300)]
  )
  return { status: 200, body: { ok: true, valoraciones: rows } }
}

/** Ascender una corrección a regla. El texto es editable: lo escrito en caliente
 *  suele ser un desahogo ("no le digas eso"), y lo que lee el agente debe ser
 *  una instrucción. */
export async function aplicarValoracion({ id, texto, personalId }) {
  const t = String(texto || '').trim()
  if (t.length < 5) return { status: 400, body: { ok: false, error: 'Escribe la regla: qué debe hacer el agente' } }

  const { rows: [v] } = await pool.query(
    `SELECT id, agente_id FROM public.agente_wa_valoraciones WHERE id = $1`, [Number(id)]
  )
  if (!v) return { status: 404, body: { ok: false, error: 'Esa corrección ya no existe' } }

  const { rows } = await pool.query(
    `INSERT INTO public.agente_wa_reglas (agente_id, texto, valoracion_id, creado_por,
            orden)
     VALUES ($1,$2,$3,$4, COALESCE((SELECT max(orden)+1 FROM public.agente_wa_reglas WHERE agente_id=$1), 0))
     RETURNING id, texto, activo, orden`,
    [v.agente_id, t.slice(0, 2000), v.id, personalId || null]
  )
  await pool.query(
    `UPDATE public.agente_wa_valoraciones SET estado='APLICADA', resuelto_en=now() WHERE id=$1`, [v.id]
  )
  log(MOD, `regla ${rows[0].id} creada desde la corrección ${v.id}`)
  return { status: 200, body: { ok: true, regla: rows[0] } }
}

export async function descartarValoracion({ id }) {
  const { rowCount } = await pool.query(
    `UPDATE public.agente_wa_valoraciones SET estado='DESCARTADA', resuelto_en=now()
      WHERE id=$1 AND estado='NUEVA'`, [Number(id)]
  )
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Esa corrección ya estaba resuelta' } }
  return { status: 200, body: { ok: true } }
}

export async function listarReglas({ agenteId }) {
  const { rows } = await pool.query(
    `SELECT id, texto, activo, orden, creado_en FROM public.agente_wa_reglas
      WHERE agente_id = $1 ORDER BY orden, id`, [agenteId]
  )
  return { status: 200, body: { ok: true, reglas: rows } }
}

export async function crearRegla({ agenteId, texto, personalId }) {
  const t = String(texto || '').trim()
  if (t.length < 5) return { status: 400, body: { ok: false, error: 'La regla no puede ir vacía' } }
  const { rows } = await pool.query(
    `INSERT INTO public.agente_wa_reglas (agente_id, texto, creado_por, orden)
     VALUES ($1,$2,$3, COALESCE((SELECT max(orden)+1 FROM public.agente_wa_reglas WHERE agente_id=$1), 0))
     RETURNING id, texto, activo, orden`,
    [agenteId, t.slice(0, 2000), personalId || null]
  )
  return { status: 200, body: { ok: true, regla: rows[0] } }
}

export async function guardarRegla({ id, datos = {} }) {
  const campos = [], vals = []
  const set = (c, v) => { vals.push(v); campos.push(`${c} = $${vals.length}`) }
  if (datos.texto !== undefined) {
    const t = String(datos.texto || '').trim()
    if (t.length < 5) return { status: 400, body: { ok: false, error: 'La regla no puede ir vacía' } }
    set('texto', t.slice(0, 2000))
  }
  if (datos.activo !== undefined) set('activo', !!datos.activo)
  if (!campos.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }
  vals.push(Number(id))
  const { rows } = await pool.query(
    `UPDATE public.agente_wa_reglas SET ${campos.join(', ')} WHERE id = $${vals.length}
      RETURNING id, texto, activo, orden`, vals
  )
  if (!rows.length) return { status: 404, body: { ok: false, error: 'Esa regla ya no existe' } }
  return { status: 200, body: { ok: true, regla: rows[0] } }
}

export async function borrarRegla({ id }) {
  const { rowCount } = await pool.query(`DELETE FROM public.agente_wa_reglas WHERE id = $1`, [Number(id)])
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Esa regla ya no existe' } }
  return { status: 200, body: { ok: true } }
}
