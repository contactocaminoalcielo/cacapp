// Materiales que se mandan por WhatsApp: brochure, tarifario, instructivos.
//
// El catálogo lo edita David (migración 101), no vive en el código: el agente
// elige por clave y la `descripcion` de cada uno es lo que lee para saber cuándo
// mandarlo. Mismo patrón que los interactivos y las etiquetas.
//
// Nació de una petición real que el agente no pudo resolver —una vet pidiendo el
// brochure— y que acabó saliendo por la otra línea, a mano.
//
// ⚠️ El envío NO se reimplementa aquí: pasa por `enviarArchivo`, que es el mismo
// camino que usa la bandeja (subir a Meta, mandar por id, guardar la copia). La
// ventana de 24 h, los topes por tipo y la regla de `ultimo_leido_en` no pueden
// vivir en dos sitios: uno se quedaría atrás y el fallo sería mudo.
import { pool, log } from './db.js'
import { enviarArchivo, claseDeArchivo } from './whatsapp-media.js'

const MOD = '[wa-materiales]'

/** El mismo tope que un documento en la bandeja. No dos topes para lo mismo. */
const MAX_BYTES = 16 * 1024 * 1024

/**
 * Los que puede usar el agente, con su descripción: alimenta el enum de la
 * herramienta. Sin `archivo` — aquí solo se decide, no se manda.
 */
export async function catalogoDeMateriales() {
  const { rows } = await pool.query(
    `SELECT clave, nombre, descripcion FROM public.whatsapp_materiales
      WHERE activo AND usa_agente ORDER BY orden, id`
  )
  return rows
}

/**
 * El catálogo para la pantalla.
 *
 * ⚠️ NUNCA se selecciona `archivo`: son megas en base64 dentro de un JSON de
 * lista. El archivo se pide de uno en uno por su propia ruta.
 */
export async function listarMateriales() {
  const { rows } = await pool.query(
    `SELECT id, clave, nombre, descripcion, mime, nombre_archivo, pie, bytes,
            usa_agente, activo, orden, creado_en, actualizado_en
       FROM public.whatsapp_materiales ORDER BY orden, id`
  )
  return { status: 200, body: { ok: true, materiales: rows } }
}

/** Los bytes de uno, para previsualizarlo antes de mandárselo a una clínica. */
export async function leerMaterial(id) {
  const { rows: [m] } = await pool.query(
    `SELECT archivo, mime, nombre_archivo FROM public.whatsapp_materiales WHERE id = $1`,
    [Number(id)]
  )
  return m || null
}

/**
 * Manda uno del catálogo.
 *
 * Recibe `enviarSobre` en vez de importarlo, igual que los interactivos: el lazo
 * con whatsapp-cloud cerraría un ciclo de módulos.
 */
export async function enviarMaterial({ contacto, clave, personalId = null, enviarSobre }) {
  const num = String(contacto || '').replace(/\D/g, '')
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  const { rows: [m] } = await pool.query(
    `SELECT archivo, mime, nombre_archivo, pie FROM public.whatsapp_materiales
      WHERE clave = $1 AND activo`,
    [clave]
  )
  if (!m) return { status: 404, body: { ok: false, error: `No existe el material "${clave}" o está desactivado` } }

  const r = await enviarArchivo({
    contacto: num,
    base64: m.archivo.toString('base64'),
    mime: m.mime,
    nombre: m.nombre_archivo,
    pie: m.pie || '',
    personalId,
    enviarSobre,
  })
  if (r?.body?.ok) log(MOD, `${clave} enviado a ${num}`)
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// Edición del catálogo (la pantalla)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Se valida aquí y no solo en la pantalla: un material mal cargado no falla al
 * guardarlo, falla al ENVIARLO delante de una veterinaria y con un error de Meta
 * que no dice cuál es el problema.
 */
function validar({ mime, buf, nombreArchivo }) {
  if (!String(mime || '').trim()) return 'Falta el tipo de archivo'
  if (!buf || !buf.length) return 'El archivo llegó vacío'
  if (buf.length > MAX_BYTES) {
    return `Pesa ${(buf.length / 1048576).toFixed(1)} MB y el tope son ${MAX_BYTES / 1048576} MB`
  }
  if (!String(nombreArchivo || '').trim()) return 'Ponle un nombre al archivo'

  // Una imagen en HEIC o WEBP (la foto de un iPhone) no es "imagen" para
  // WhatsApp: iría como documento, que sí llega. Se avisa al cargarla y no
  // cuando la clínica reciba un PDF donde esperaba una foto.
  const clase = claseDeArchivo(mime)
  if (clase === 'audio') return 'Los audios no llevan pie ni nombre: para audio, mándalo desde la bandeja'
  return null
}

export async function guardarMaterial({ id, datos = {} }) {
  const clave = String(datos.clave || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (!clave) return { status: 400, body: { ok: false, error: 'Falta la clave' } }

  const campos = [
    clave,
    String(datos.nombre || clave).trim().slice(0, 120),
    String(datos.descripcion || '').trim().slice(0, 600) || null,
    String(datos.nombre_archivo || '').trim().slice(0, 200),
    String(datos.pie || '').trim().slice(0, 1024) || null,
    datos.usa_agente !== false,
    datos.activo !== false,
    Number.isInteger(Number(datos.orden)) ? Number(datos.orden) : 0,
  ]

  // Editar el nombre o la descripción NO obliga a volver a subir el archivo: el
  // que ya está se queda. Solo se toca cuando viene uno nuevo.
  let buf = null
  if (datos.base64) {
    try { buf = Buffer.from(String(datos.base64), 'base64') }
    catch { return { status: 400, body: { ok: false, error: 'No se pudo leer el archivo' } } }
  }

  try {
    if (id) {
      if (buf) {
        const error = validar({ mime: datos.mime, buf, nombreArchivo: campos[3] })
        if (error) return { status: 400, body: { ok: false, error } }
        const { rows } = await pool.query(
          `UPDATE public.whatsapp_materiales
              SET clave=$1, nombre=$2, descripcion=$3, nombre_archivo=$4, pie=$5,
                  usa_agente=$6, activo=$7, orden=$8,
                  archivo=$9, mime=$10, bytes=$11, actualizado_en=now()
            WHERE id=$12 RETURNING id, clave`,
          [...campos, buf, String(datos.mime), buf.length, Number(id)]
        )
        if (!rows.length) return { status: 404, body: { ok: false, error: 'Ese material ya no existe' } }
        log(MOD, `${rows[0].clave} actualizado con archivo nuevo`)
        return { status: 200, body: { ok: true, id: rows[0].id } }
      }

      const { rows } = await pool.query(
        `UPDATE public.whatsapp_materiales
            SET clave=$1, nombre=$2, descripcion=$3, nombre_archivo=$4, pie=$5,
                usa_agente=$6, activo=$7, orden=$8, actualizado_en=now()
          WHERE id=$9 RETURNING id, clave`,
        [...campos, Number(id)]
      )
      if (!rows.length) return { status: 404, body: { ok: false, error: 'Ese material ya no existe' } }
      log(MOD, `${rows[0].clave} actualizado`)
      return { status: 200, body: { ok: true, id: rows[0].id } }
    }

    // Nuevo: sin archivo no hay material que mandar.
    const error = validar({ mime: datos.mime, buf, nombreArchivo: campos[3] })
    if (error) return { status: 400, body: { ok: false, error } }

    const { rows } = await pool.query(
      `INSERT INTO public.whatsapp_materiales
         (clave, nombre, descripcion, nombre_archivo, pie, usa_agente, activo, orden,
          archivo, mime, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, clave`,
      [...campos, buf, String(datos.mime), buf.length]
    )
    log(MOD, `${rows[0].clave} creado (${(buf.length / 1024).toFixed(0)} kB)`)
    return { status: 200, body: { ok: true, id: rows[0].id } }
  } catch (e) {
    // La clave es única: repetirla es el error más probable al crear uno nuevo.
    if (e.code === '23505') {
      return { status: 409, body: { ok: false, error: `Ya existe un material con la clave ${clave}` } }
    }
    throw e
  }
}

export async function borrarMaterial({ id }) {
  const { rowCount } = await pool.query(
    `DELETE FROM public.whatsapp_materiales WHERE id = $1`, [Number(id)]
  )
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Ese material ya no existe' } }
  return { status: 200, body: { ok: true } }
}
