// Archivos recibidos por WhatsApp (migración 094).
//
// Meta NO manda el archivo en el webhook: manda un `id`. Bajarlo son DOS
// llamadas y la URL intermedia vive minutos:
//
//   1. GET /{version}/{media_id}      → { url, mime_type, sha256, file_size }
//   2. GET {url}  con el MISMO Bearer → los bytes
//
// El paso 2 sorprende: es una URL de lookaside.fbsbx.com y AUN ASÍ exige el
// header Authorization. Sin él devuelve un 401 en HTML, no en JSON.
//
// Se baja en el momento de recibir el mensaje. No hay segunda oportunidad
// cómoda: Meta conserva el archivo unos días y la URL, minutos.
import { pool, log } from './db.js'
import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MOD = '[wa-media]'
const GRAPH = 'https://graph.facebook.com'

/**
 * Tope de lo que se guarda. Los límites de WhatsApp son 5 MB para imagen y
 * 16 MB para audio y video; 20 cubre todo salvo documentos grandes, que es
 * justo lo que no queremos dentro de la base.
 */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Lo que el modelo puede mirar. Es la lista de Claude, no la de WhatsApp: los
 * stickers animados son webp pero se rechazan, así que quedan fuera aunque el
 * formato encaje.
 */
const MIRABLES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function elModeloPuedeVerlo(mime) {
  return MIRABLES.has(String(mime || '').split(';')[0].trim().toLowerCase())
}

/** Las notas de voz de WhatsApp llegan como audio/ogg con códec opus. */
export function esVoz(mime) {
  return /^audio\//i.test(String(mime || '').trim())
}

/**
 * Dónde vive Whisper. Es un contenedor vecino en la red de Docker, sin puerto
 * publicado: lo que viaja son notas de voz de clínicas y familias, y no tiene
 * por qué ser alcanzable desde fuera del servidor.
 */
const WHISPER = process.env.WHISPER_URL || 'http://orbit-whisper:8788'

/**
 * Transcribe la nota de voz de un mensaje y la deja escrita en los dos sitios
 * que importan: `whatsapp_media.transcripcion` (la evidencia, sin tocar) y
 * `whatsapp_mensajes.texto` (lo que leen la bandeja y el agente).
 *
 * Nunca lanza. Si Whisper está caído o no entiende nada, el mensaje se queda
 * como "[audio]" y el agente lo trata como lo que no puede oír — se disculpa y
 * lo pasa a una persona. Degradar así es correcto; inventar contenido no.
 */
export async function transcribir({ mensajeId }) {
  const id = parseInt(mensajeId, 10)
  if (!Number.isFinite(id)) return { ok: false, error: 'mensaje inválido' }

  try {
    const { rows: [fila] } = await pool.query(
      `SELECT archivo, mime FROM public.whatsapp_media WHERE mensaje_id = $1`, [id]
    )
    if (!fila?.archivo) return { ok: false, error: 'no hay audio guardado' }

    const inicio = Date.now()
    const r = await fetch(`${WHISPER}/transcribir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fila.archivo,
    })
    const out = await r.json().catch(() => ({}))

    if (!r.ok || !out.ok || !out.texto) {
      const motivo = out.error || (r.ok ? 'no se entendió nada' : `Error ${r.status}`)
      await pool.query(
        `UPDATE public.whatsapp_media SET error = $2 WHERE mensaje_id = $1`,
        [id, `transcripción: ${motivo}`]
      ).catch(() => {})
      log(MOD, `no se pudo transcribir el mensaje ${id} — ${motivo}`)
      return { ok: false, error: motivo }
    }

    const texto = String(out.texto).slice(0, 4000)
    await pool.query(
      `UPDATE public.whatsapp_media SET transcripcion = $2 WHERE mensaje_id = $1`,
      [id, texto]
    )
    // El prefijo NO es decorativo: es lo que le dice al agente (y al coordinador)
    // que esto lo entendió una máquina y puede estar mal.
    await pool.query(
      `UPDATE public.whatsapp_mensajes SET texto = $2 WHERE id = $1`,
      [id, `[nota de voz] ${texto}`]
    )

    log(MOD, `mensaje ${id} transcrito en ${((Date.now() - inicio) / 1000).toFixed(1)}s`
      + ` (${out.duracion}s de audio): ${texto.slice(0, 60)}`)
    return { ok: true, texto }
  } catch (e) {
    log(MOD, `ERROR transcribiendo el mensaje ${id} —`, e.message)
    await pool.query(
      `UPDATE public.whatsapp_media SET error = $2 WHERE mensaje_id = $1`,
      [id, `transcripción: ${e.message}`]
    ).catch(() => {})
    return { ok: false, error: e.message }
  }
}

/**
 * De ESTOS mensajes, cuántas notas de voz se pudieron transcribir y cuántas no.
 * Mismo criterio que `revisarImagenes`: se pregunta por id y no "¿hay algún
 * audio reciente?", para no responder sobre una nota de voz que en realidad
 * nadie entendió.
 */
export async function revisarAudios(mensajeIds) {
  const ids = (mensajeIds || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return { transcritos: 0, fallidos: 0 }

  const { rows: [r] } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE md.transcripcion IS NOT NULL)::int AS transcritos,
       count(*) FILTER (WHERE md.transcripcion IS NULL)::int     AS fallidos
       FROM public.whatsapp_mensajes w
       LEFT JOIN public.whatsapp_media md ON md.mensaje_id = w.id
      WHERE w.id = ANY($1) AND w.tipo = 'audio'`,
    [ids]
  )
  return { transcritos: r?.transcritos || 0, fallidos: r?.fallidos || 0 }
}

/**
 * Baja el archivo de un mensaje y lo guarda. Nunca lanza: que no se pueda bajar
 * una foto no puede tumbar la recepción del mensaje ni al agente. Deja el motivo
 * en la fila para que se vea en la bandeja en vez de desaparecer.
 *
 * @returns {Promise<{ok:boolean, mime?:string, bytes?:number, error?:string}>}
 */
export async function guardarMedia({ mensajeId, waMediaId, mimeDeclarado }) {
  if (!mensajeId || !waMediaId) return { ok: false, error: 'faltan datos del adjunto' }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) {
    await registrar({ mensajeId, waMediaId, error: 'WHATSAPP_ACCESS_TOKEN no configurado' })
    return { ok: false, error: 'sin token' }
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v26.0'
  const auth = { Authorization: `Bearer ${token}` }

  try {
    // ── 1. El id se cambia por una URL firmada ──
    const meta = await fetch(`${GRAPH}/${version}/${waMediaId}`, { headers: auth })
    const info = await meta.json().catch(() => ({}))
    if (!meta.ok || !info?.url) {
      const detalle = info?.error?.message || `Error ${meta.status}`
      await registrar({ mensajeId, waMediaId, mime: mimeDeclarado, error: `no se pudo resolver: ${detalle}` })
      log(MOD, `Meta no dio URL para ${waMediaId} —`, detalle)
      return { ok: false, error: detalle }
    }

    const mime = (info.mime_type || mimeDeclarado || 'application/octet-stream').split(';')[0].trim()
    const tam = Number(info.file_size || 0)
    if (tam > MAX_BYTES) {
      // Se registra igual: en la bandeja tiene que verse que llegó algo y por
      // qué no está, en vez de un hueco sin explicación.
      await registrar({ mensajeId, waMediaId, mime, bytes: tam, error: `pesa ${(tam / 1048576).toFixed(1)} MB, por encima del tope de ${MAX_BYTES / 1048576} MB` })
      log(MOD, `${waMediaId} descartado por tamaño (${tam} bytes)`)
      return { ok: false, error: 'demasiado grande' }
    }

    // ── 2. La URL firmada TAMBIÉN pide el token ──
    const bin = await fetch(info.url, { headers: auth })
    if (!bin.ok) {
      await registrar({ mensajeId, waMediaId, mime, error: `descarga rechazada: ${bin.status}` })
      log(MOD, `descarga rechazada para ${waMediaId} — ${bin.status}`)
      return { ok: false, error: `descarga ${bin.status}` }
    }

    const buf = Buffer.from(await bin.arrayBuffer())
    if (!buf.length) {
      await registrar({ mensajeId, waMediaId, mime, error: 'llegó vacío' })
      return { ok: false, error: 'vacío' }
    }
    // El tamaño anunciado puede mentir; el que manda es el que llegó.
    if (buf.length > MAX_BYTES) {
      await registrar({ mensajeId, waMediaId, mime, bytes: buf.length, error: 'superó el tope al descargar' })
      return { ok: false, error: 'demasiado grande' }
    }

    await registrar({
      mensajeId, waMediaId, mime, bytes: buf.length,
      sha256: info.sha256 || null, archivo: buf,
    })
    log(MOD, `guardado ${mime} de ${buf.length} bytes para el mensaje ${mensajeId}`)
    return { ok: true, mime, bytes: buf.length }
  } catch (e) {
    await registrar({ mensajeId, waMediaId, mime: mimeDeclarado, error: e.message }).catch(() => {})
    log(MOD, `ERROR bajando ${waMediaId} —`, e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Una fila por mensaje, se haya podido bajar o no. El UPDATE del conflicto
 * permite reintentar un fallo sin dejar duplicados.
 */
async function registrar({ mensajeId, waMediaId, mime = null, bytes = null, sha256 = null, archivo = null, error = null }) {
  await pool.query(
    `INSERT INTO public.whatsapp_media (mensaje_id, wa_media_id, mime, bytes, sha256, archivo, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (mensaje_id) DO UPDATE
       SET wa_media_id = EXCLUDED.wa_media_id,
           mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
           archivo = EXCLUDED.archivo, error = EXCLUDED.error`,
    [mensajeId, waMediaId, mime, bytes, sha256, archivo, error]
  ).catch(e => log(MOD, 'no se pudo registrar el adjunto —', e.message))
}

/**
 * Los bytes, para servirlos a la bandeja. Devuelve también el contacto: quien
 * pide un archivo por id no debe poder pescar los de otra conversación sin que
 * quede claro de dónde salen.
 */
export async function leerMedia(mensajeId) {
  const id = parseInt(mensajeId, 10)
  if (!Number.isFinite(id)) return null

  const { rows } = await pool.query(
    `SELECT m.archivo, m.mime, m.bytes, m.error, w.contacto, w.tipo
       FROM public.whatsapp_media m
       JOIN public.whatsapp_mensajes w ON w.id = m.mensaje_id
      WHERE m.mensaje_id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * Las imágenes recientes de una conversación, para dárselas al modelo.
 *
 * Se limitan a propósito: cada imagen son ~1.500 tokens y el historial NO se
 * cachea, así que una foto vieja se re-cobra en cada turno de la conversación.
 * Con las últimas basta — la vet pregunta por lo que acaba de mandar.
 */
/**
 * De ESTOS mensajes concretos, cuántas imágenes puede ver el modelo y cuántas no.
 *
 * Se pregunta por id y no "¿hay alguna foto reciente?" por una razón que parece
 * un detalle y no lo es: si la vet manda dos fotos y una falla al bajarse, la
 * pregunta vaga responde que sí y el agente contesta sobre la que sí tiene
 * mientras ella pregunta por la otra. Con los ids exactos se puede hacer lo
 * correcto con las dos: responder la que se ve y disculparse por la que no.
 */
export async function revisarImagenes(mensajeIds) {
  const ids = (mensajeIds || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return { visibles: 0, fallidas: 0 }

  const { rows: [r] } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE md.archivo IS NOT NULL AND md.mime = ANY($2))::int AS visibles,
       count(*) FILTER (WHERE md.archivo IS NULL OR NOT (md.mime = ANY($2)))::int AS fallidas
       FROM public.whatsapp_mensajes w
       LEFT JOIN public.whatsapp_media md ON md.mensaje_id = w.id
      WHERE w.id = ANY($1) AND w.tipo = 'image'`,
    [ids, [...MIRABLES]]
  )
  return { visibles: r?.visibles || 0, fallidas: r?.fallidas || 0 }
}

export async function imagenesRecientes(contacto, tope = 2) {
  const { rows } = await pool.query(
    `SELECT m.mensaje_id, m.mime, m.archivo
       FROM public.whatsapp_media m
       JOIN public.whatsapp_mensajes w ON w.id = m.mensaje_id
      WHERE w.contacto = $1 AND w.direccion = 'IN'
        AND m.archivo IS NOT NULL
        AND m.mime = ANY($2)
      ORDER BY w.ocurrido_en DESC, w.id DESC
      LIMIT $3`,
    [contacto, [...MIRABLES], tope]
  )
  return rows.reverse()
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar adjuntos: imagen, audio, documento y video (2026-08-14)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué acepta Meta y hasta cuánto, por tipo de mensaje.
 *
 * `documento` acepta cualquier MIME a propósito: es el cajón de sastre de
 * WhatsApp y ahí caen PDF, Word, Excel y lo que traiga la clínica.
 *
 * ⚠️ El tope de Meta para documento es 100 MB, pero aquí son 16: la copia se
 * guarda en la base para poder volver a verla, y un PDF de 100 MB por mensaje
 * engorda la tabla hasta que duele. Si algún día hace falta más, el sitio donde
 * cambiarlo es este, no la pantalla.
 */
const CLASES = {
  image:    { mimes: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024, etiqueta: 'imagen' },
  audio:    {
    mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    max: 16 * 1024 * 1024, etiqueta: 'audio',
  },
  video:    { mimes: ['video/mp4', 'video/3gp', 'video/3gpp'], max: 16 * 1024 * 1024, etiqueta: 'video' },
  // Imagen, audio y video llevan el tope REAL de WhatsApp; los documentos no.
  // El de documentos es NUESTRO: Meta acepta hasta 100 MB (comprobado el
  // 2026-08-19 subiendo un PDF de 31 MB, `{"id":"…"}`), pero un PDF enorme por
  // WhatsApp es un PDF que la clínica no descarga con datos móviles. 64 MB deja
  // pasar cualquier brochure sin abrir la puerta a mandar un video disfrazado.
  document: { mimes: null, max: 64 * 1024 * 1024, etiqueta: 'documento' },
}

/** El tope de cada tipo, en MB. Lo lee el catálogo de materiales y la pantalla. */
export const TOPE_MB = Object.fromEntries(
  Object.entries(CLASES).map(([k, v]) => [k, v.max / 1048576]))

/** Tope del pie de foto/documento. Audio y video NO admiten pie en la API. */
const MAX_PIE = 1024
/** Por encima de esto no se guarda copia local: iría a la tabla en `bytea`. */
const MAX_COPIA = 12 * 1024 * 1024

/** De qué tipo de mensaje se trata, según el MIME que trae el archivo. */
export function claseDeArchivo(mime) {
  const m = String(mime || '').toLowerCase()
  if (CLASES.image.mimes.includes(m)) return 'image'
  if (CLASES.audio.mimes.some(x => m.startsWith(x))) return 'audio'
  if (CLASES.video.mimes.some(x => m.startsWith(x))) return 'video'
  // Una imagen en un formato que WhatsApp no muestra (HEIC, WEBP, GIF) NO se
  // manda como imagen: se rechazaría. Va como documento, que sí llega.
  return 'document'
}

/**
 * Sube el archivo a Meta y lo manda.
 *
 * Va en DOS pasos y no con `link` público a propósito: mandar un enlace
 * obligaría a exponer el archivo en una URL sin sesión, y por esta línea viajan
 * fotos de mascotas fallecidas y datos de familias. Subido, vive en Meta 30
 * días y solo lo alcanza esta cuenta.
 *
 * La copia se guarda además en `whatsapp_media`, igual que lo que entra: sin
 * eso el hilo mostraría un mensaje vacío donde se mandó algo, y el coordinador
 * no sabría qué envió.
 */
/**
 * Deja el audio como una NOTA DE VOZ de verdad: `.ogg` con códec Opus.
 *
 * 🩸 Sin esto la nota de voz no es una nota de voz. Meta lo dice sin rodeos: una
 * nota de voz —icono de micrófono, descarga automática, transcripción— exige
 * `.ogg` con OPUS **y** mandar `voice: true`. Cualquier otro formato llega como
 * un archivo de audio con icono de nota musical, que la clínica tiene que
 * descargar. Se envió `audio/mp4` durante un rato y era justo eso.
 *
 * El problema es que **Chrome no sabe grabar ogg**: graba `audio/webm` con
 * codecs=opus. Pero el códec ya es el bueno — lo único que sobra es el envase.
 * Así que esto no recodifica: `-c:a copy` cambia webm por ogg moviendo los
 * mismos paquetes Opus. Es instantáneo y no pierde un solo bit.
 *
 * Solo si lo que llega NO es Opus (un mp4/AAC de un navegador que no pueda con
 * lo otro) hay que recodificar de verdad, y ahí sí se nota en el tiempo.
 */
async function aNotaDeVoz(buf, mime) {
  const yaEsOpus = /webm|ogg/.test(mime)
  const sello = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const entrada = join(tmpdir(), `voz-${sello}.in`)
  const salida  = join(tmpdir(), `voz-${sello}.ogg`)

  // Por archivo y no por tubería: el demuxer de WebM necesita saltar dentro del
  // fichero y con `pipe:0` falla de formas que no dicen qué pasó.
  try {
    await writeFile(entrada, buf)
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', entrada,
      '-vn',
      ...(yaEsOpus
        ? ['-c:a', 'copy']
        // Mono y 32 kbps: es voz, y es lo que manda WhatsApp. Más es peso que
        // nadie oye.
        : ['-c:a', 'libopus', '-b:a', '32k', '-ac', '1']),
      '-f', 'ogg', salida,
    ]
    await new Promise((resolver, rechazar) => {
      execFile('ffmpeg', args, { timeout: 30_000 }, (err, _out, stderr) =>
        err ? rechazar(new Error(String(stderr || err.message).slice(0, 300))) : resolver())
    })
    return { buf: await readFile(salida) }
  } catch (e) {
    return { error: e.message }
  } finally {
    unlink(entrada).catch(() => {})
    unlink(salida).catch(() => {})
  }
}

export async function enviarArchivo({
  contacto, base64, mime, nombre = 'archivo', pie = '', personalId = null, enviarSobre,
  // Lo graba la bandeja apretando el micrófono. Cambia el formato Y cómo se
  // ve del otro lado, así que no se adivina por el MIME: se dice.
  notaDeVoz = false,
}) {
  const num = String(contacto || '').replace(/\D/g, '')
  if (!num) return { status: 400, body: { ok: false, error: 'Contacto inválido' } }

  // Meta quiere el tipo A SECAS. Al grabar una nota de voz el navegador devuelve
  // `audio/ogg;codecs=opus` o `audio/mp4;codecs=...`, y con el sufijo la subida
  // se rechaza — el códec ya va dentro del archivo, no hace falta anunciarlo.
  mime = String(mime || '').split(';')[0].trim()

  let buf
  try {
    // Red de seguridad: si llega el data URL entero (`data:audio/webm;...;base64,AAA`)
    // se recorta aqui. Node NO se queja al decodificarlo —ignora los caracteres
    // que no son base64— y devuelve bytes basura, asi que el fallo aparece muy
    // lejos de su causa: paso de verdad y se vio como "ffmpeg: datos invalidos".
    const limpio = String(base64 || '')
    buf = Buffer.from(limpio.startsWith('data:') ? limpio.slice(limpio.indexOf(',') + 1) : limpio, 'base64')
  } catch { return { status: 400, body: { ok: false, error: 'No se pudo leer el archivo' } } }
  if (!buf.length) return { status: 400, body: { ok: false, error: 'El archivo llegó vacío' } }

  // ⚠️ ESTO VA ANTES DE CLASIFICAR, y el orden no es un detalle: lo que graba
  // Chrome es `audio/webm`, y para `claseDeArchivo` eso NO es audio — cae en
  // "documento". Clasificar antes de convertir mandaría la nota de voz como un
  // fichero adjunto, que es justo lo que se viene a evitar.
  //
  // Y va antes de subir nada: si falla, no se ha gastado una llamada a Meta.
  if (notaDeVoz) {
    const r = await aNotaDeVoz(buf, mime)
    if (r.error) {
      log(MOD, 'no se pudo convertir la nota de voz —', r.error)
      return {
        status: 500,
        body: { ok: false, error: 'No se pudo preparar la nota de voz. Vuelve a intentarlo o mándala como archivo.' },
      }
    }
    buf = r.buf
    mime = 'audio/ogg'
    nombre = nombre.replace(/\.[^.]+$/, '') + '.ogg'
  }

  const clase = claseDeArchivo(mime)
  const regla = CLASES[clase]
  if (regla.mimes && !regla.mimes.some(x => String(mime).toLowerCase().startsWith(x))) {
    return { status: 400, body: { ok: false, error: `WhatsApp no admite ese formato de ${regla.etiqueta}` } }
  }
  if (buf.length > regla.max) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `Pesa ${(buf.length / 1048576).toFixed(1)} MB y el tope para ${regla.etiqueta} son ${regla.max / 1048576} MB`,
      },
    }
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) return { status: 500, body: { ok: false, error: 'WhatsApp no está configurado en el servidor' } }

  const { rows } = await pool.query(
    `SELECT phone_number_id, ventana_abierta FROM public.v_whatsapp_conversaciones WHERE contacto = $1`,
    [num]
  )
  const conv = rows[0]
  if (!conv) return { status: 404, body: { ok: false, error: 'Conversación no encontrada' } }
  // Se comprueba ANTES de subir: con la ventana cerrada, subir sería gastar la
  // llamada y dejar el archivo en Meta para nada.
  if (!conv.ventana_abierta) {
    return {
      status: 409,
      body: {
        ok: false, ventana_cerrada: true,
        error: 'La ventana de 24 horas se cerró. Para retomar esta conversación hay que enviar una plantilla aprobada.',
      },
    }
  }

  const version = process.env.WHATSAPP_API_VERSION || 'v26.0'
  let mediaId
  try {
    const fd = new FormData()
    fd.append('messaging_product', 'whatsapp')
    fd.append('type', mime)
    fd.append('file', new Blob([buf], { type: mime }), nombre)

    const r = await fetch(`${GRAPH}/${version}/${conv.phone_number_id}/media`, {
      method: 'POST',
      // Sin Content-Type a mano: fetch le pone el boundary del multipart, y
      // ponerlo nosotros lo rompe con un error que no dice nada.
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data?.id) {
      const detalle = data?.error?.error_user_msg || data?.error?.message || `Error ${r.status}`
      log(MOD, 'Meta rechazó la subida —', detalle)
      return { status: 502, body: { ok: false, error: `No se pudo subir el archivo: ${detalle}` } }
    }
    mediaId = data.id
  } catch (e) {
    log(MOD, 'ERROR subiendo archivo —', e.message)
    return { status: 502, body: { ok: false, error: `No se pudo subir el archivo: ${e.message}` } }
  }

  // ⚠️ Solo imagen, video y documento admiten pie. En audio, mandar `caption`
  // hace que Meta rechace el mensaje entero.
  const pieCorto = String(pie || '').trim().slice(0, MAX_PIE)
  const admitePie = clase !== 'audio'
  const contenido = {
    id: mediaId,
    // Lo que convierte un audio en NOTA DE VOZ del lado de la clínica: sin este
    // campo llega con icono de nota musical y hay que descargarlo.
    ...(notaDeVoz ? { voice: true } : {}),
    ...(admitePie && pieCorto ? { caption: pieCorto } : {}),
    // El nombre solo viaja en documento, y es lo que la clínica ve: sin él
    // WhatsApp muestra un archivo sin título que nadie sabe qué es.
    ...(clase === 'document' ? { filename: nombre } : {}),
  }

  const r = await enviarSobre({
    contacto: num,
    payload: { type: clase, [clase]: contenido },
    texto: pieCorto || (clase === 'document' ? `[documento] ${nombre}`
      : notaDeVoz ? '[nota de voz]' : `[${regla.etiqueta}]`),
    tipo: clase,
    personalId,
  })

  // La copia local, para que el hilo lo muestre como muestra lo que entra. Si
  // falla, el mensaje YA se envió: se registra y se sigue.
  if (r?.body?.ok && r.body.mensaje?.id && buf.length <= MAX_COPIA) {
    await pool.query(
      `INSERT INTO public.whatsapp_media (mensaje_id, wa_media_id, mime, bytes, archivo)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (mensaje_id) DO NOTHING`,
      [r.body.mensaje.id, mediaId, mime, buf.length, buf]
    ).catch(e => log(MOD, 'enviado pero no se pudo guardar la copia —', e.message))
  }

  if (r?.body?.ok) log(MOD, `${regla.etiqueta} enviado a ${num} (${(buf.length / 1024).toFixed(0)} kB)`)
  return r
}

/** Compatibilidad: la pantalla vieja en caché sigue llamando a esto. */
export const enviarImagen = enviarArchivo
