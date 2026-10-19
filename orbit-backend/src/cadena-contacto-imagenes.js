// Cadena de contacto de la solicitud de imágenes (migración 186).
//
// Reporte de Producción y Diseño (15-oct-2026): cuando el 1er contacto no le
// llega al cliente por un problema de SU número, Orbit se quedaba ahí. Ahora:
//
//   1. PRINCIPAL        — se registra el fallo (número, fecha/hora, error) como
//                          novedad del servicio.
//   2. CLIENTE_ALTERNO  — otro celular del cliente (whatsapp/telefono/telefono2
//                          que no se haya probado), con la MISMA plantilla del
//                          contacto 1, por la línea de familias.
//   3. VETERINARIA      — sin más números (o fallaron todos), se le pide apoyo a
//                          la clínica que remitió el servicio, por la línea de
//                          veterinarias, con `plantilla_apoyo_vet`. Sin
//                          plantilla aprobada no se envía: queda la alerta.
//   4. COORDINACION     — no hay a quién más escribir: alerta ALTA para llamar.
//
// 🔑 El rechazo de Meta llega DESPUÉS del envío, por el webhook (los 76 fallos
// medidos el 19-oct estaban «ENVIADO» en la bitácora). Por eso esto es un job
// que corre cada 10 minutos y mira el acuse (`whatsapp_mensajes.estado`), no un
// efecto del envío.
//
// Solo dispara con errores DEL NÚMERO (`errores_numero`). Un 131042 (la cuenta
// de Meta sin pago) falla igual con cualquier número: escribirle a la vet por
// eso sería molestarla por un problema nuestro.
//
// Garantías: UNIQUE (solicitud, canal, destino) → un paso no sale dos veces;
// la reserva (ENVIANDO) se commitea ANTES de la red; si el cliente ya subió
// fotos o la solicitud se cerró, la cadena se detiene.
import { pool, log } from './db.js'
import { cargarConfigImagenes, construirEnlace, plantillaSolicitud, mensajeSolicitud } from './reglas-imagenes.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { enviarPlantilla } from './whatsapp-plantillas.js'
import { lineaVeterinarias } from './recogidas-aviso.js'
import { explicarErrorWa } from './errores-wa.js'

const MOD = '[cadena-imagenes]'
const ERRORES_NUMERO_DEFAULT = ['130472', '131026', '131049']
export const TOKENS_APOYO_VET = ['clinica', 'propietario', 'mascota', 'telefono']

const digitos = v => String(v || '').replace(/\D/g, '')
const ult10 = v => digitos(v).slice(-10)
// Celular colombiano: 10 dígitos que empiezan por 3. Un fijo (601…) no tiene
// WhatsApp y mandarle es gastar un paso de la cadena en un fallo seguro.
const esCelular = v => /^3\d{9}$/.test(ult10(v))

/** Código de Meta (13xxxx) dentro de un texto de error, o null. */
export function codigoError(texto) {
  const m = String(texto || '').match(/(?:^|\D)(13\d{4})(?:\D|$)/)
  return m ? m[1] : null
}

function horaBogota(ts = new Date()) {
  return new Date(ts).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function causa(error) {
  const e = explicarErrorWa(error)
  return e ? e.titulo : String(error || 'sin detalle').slice(0, 120)
}

function plantillaApoyoVet(config) {
  let p = config.plantilla_apoyo_vet
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
  if (!p || !p.nombre) return null
  return {
    nombre: p.nombre,
    idioma: p.idioma || 'es_MX',
    vars: Array.isArray(p.vars) ? p.vars.filter(v => TOKENS_APOYO_VET.includes(v)) : ['clinica', 'propietario', 'mascota'],
  }
}

async function novedad(servicioId, texto) {
  await pool.query(
    `INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion) VALUES ($1, 'NOTA', $2)`,
    [servicioId, `📵 Imágenes · ${texto}`.slice(0, 1000)]
  ).catch(e => log(MOD, 'no se pudo dejar la novedad —', e.message))
}

async function alerta(servicioId, { clave, prioridad = 'ALTA', mensaje, accion, metadata = {} }) {
  await pool.query(
    `INSERT INTO public.alertas_operativas
       (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
     VALUES ($1, 'SOLICITUDES_IMAGENES', 'IMAGENES_SIN_CONTACTO', $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [servicioId, prioridad, mensaje, accion, clave, JSON.stringify(metadata)]
  ).catch(e => log(MOD, 'no se pudo crear la alerta —', e.message))
}

/** Todo lo que la cadena necesita saber de una solicitud, leído de nuevo cada vez. */
async function cargarCaso(solicitudId) {
  const { rows: [d] } = await pool.query(
    `SELECT sol.id, sol.servicio_id, sol.estado, sol.wa_fallido, sol.wa_alterno,
            s.fecha_imagenes_recibidas, s.codigo_fotos, s.estado AS servicio_estado,
            p.codigo AS plan_codigo, m.nombre AS mascota,
            c.nombre AS cliente_nombre, c.whatsapp, c.telefono, c.telefono2,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            a.nombre AS clinica, a.whatsapp AS clinica_whatsapp, a.telefono AS clinica_telefono
       FROM public.solicitudes_imagenes sol
       JOIN public.servicios s     ON s.id = sol.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       LEFT JOIN public.planes p   ON p.id = s.plan_id
       LEFT JOIN public.aliados a  ON a.id_aliado = s.aliado_origen_id
      WHERE sol.id = $1`,
    [solicitudId]
  )
  if (!d) return null
  const { rows: pasos } = await pool.query(
    `SELECT canal, destino, estado FROM public.solicitud_imagenes_cadena WHERE solicitud_id = $1`, [solicitudId]
  )
  return { ...d, pasos }
}

const cerrado = caso => !caso || caso.fecha_imagenes_recibidas || ['RECIBIDO', 'CANCELADO'].includes(caso.estado)

/** Reserva un paso. Devuelve el id, o null si ese paso ya existía. */
async function reservar(caso, { canal, destino, estado = 'ENVIANDO', disparoMessageId = null, disparoError = null, plantilla = null }) {
  const { rows } = await pool.query(
    `INSERT INTO public.solicitud_imagenes_cadena
       (solicitud_id, servicio_id, canal, destino, estado, disparo_message_id, disparo_error, plantilla)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (solicitud_id, canal, destino) DO NOTHING
     RETURNING id`,
    [caso.id, caso.servicio_id, canal, destino || '', estado, disparoMessageId, disparoError, plantilla]
  )
  return rows[0]?.id || null
}

async function marcar(id, { estado, messageId = null, error = null }) {
  await pool.query(
    `UPDATE public.solicitud_imagenes_cadena
        SET estado = $2, message_id = COALESCE($3, message_id), ultimo_error = $4,
            enviado_en = CASE WHEN $2 = 'ENVIADO' THEN now() ELSE enviado_en END
      WHERE id = $1`,
    [id, estado, messageId, error ? String(error).slice(0, 900) : null]
  )
}

/**
 * Arranca la cadena por un contacto que falló. Idempotente: el PRINCIPAL de una
 * solicitud se registra una sola vez.
 */
export async function iniciarCadena({ solicitudId, destino, messageId, error, dryRun = false }) {
  const caso = await cargarCaso(solicitudId)
  if (cerrado(caso)) return { omitido: 'cerrada' }
  if (dryRun) return { iniciaria: true, destino, error: codigoError(error) }

  const id = await reservar(caso, {
    canal: 'PRINCIPAL', destino, estado: 'REGISTRADO', disparoMessageId: messageId, disparoError: error,
  })
  if (!id) return { omitido: 'ya_iniciada' }
  await pool.query(`UPDATE public.solicitudes_imagenes SET wa_fallido = $2 WHERE id = $1`, [solicitudId, destino])
  await novedad(caso.servicio_id,
    `la solicitud NO le llegó al ${destino} (${horaBogota()}): ${causa(error)} [${codigoError(error) || 'sin código'}].`)
  return siguientePaso(solicitudId)
}

/** Decide y ejecuta el paso que sigue: otro número del cliente o la veterinaria. */
async function siguientePaso(solicitudId) {
  const caso = await cargarCaso(solicitudId)
  if (cerrado(caso)) return { omitido: 'cerrada' }

  const probados = new Set([caso.wa_fallido, ...caso.pasos
    .filter(p => ['PRINCIPAL', 'CLIENTE_ALTERNO'].includes(p.canal)).map(p => p.destino)]
    .map(ult10).filter(Boolean))
  const alterno = [caso.whatsapp, caso.telefono, caso.telefono2]
    .filter(esCelular)
    .find(n => !probados.has(ult10(n)))

  if (alterno) return enviarAlterno(caso, alterno)
  return escalarVet(caso)
}

async function enviarAlterno(caso, numero) {
  const config = await cargarConfigImagenes(pool)
  const plantilla = plantillaSolicitud(config, caso.plan_codigo)
  if (!plantilla?.nombre || !caso.codigo_fotos) return escalarVet(caso)

  const id = await reservar(caso, { canal: 'CLIENTE_ALTERNO', destino: numero, plantilla: plantilla.nombre })
  if (!id) return { omitido: 'alterno_ya_intentado' }

  const enlace = construirEnlace(caso.codigo_fotos)
  try {
    const r = await enviarPlantillaGenerica({
      telefono: numero,
      nombre: caso.propietario || caso.cliente_nombre || '',
      plantillaNombre: plantilla.nombre,
      idioma: plantilla.idioma,
      category: plantilla.categoria,
      mensaje: mensajeSolicitud({ nombre: caso.cliente_nombre || caso.propietario, mascota: caso.mascota, enlace }),
      // Mismas 2 variables del contacto 1: {{1}} mascota, {{2}} enlace.
      bodyParams: [caso.mascota || '', enlace],
    })
    await marcar(id, { estado: 'ENVIADO', messageId: r?.messageId || null })
    await novedad(caso.servicio_id, `se reenvió la solicitud al otro número del cliente, ${numero} (${horaBogota()}). Orbit revisa si le llega.`)
    log(MOD, caso.mascota, '→ alterno', numero)
    return { paso: 'CLIENTE_ALTERNO', destino: numero }
  } catch (e) {
    await marcar(id, { estado: 'ERROR', error: e.message })
    await novedad(caso.servicio_id, `tampoco salió al ${numero} (${horaBogota()}): ${causa(e.message)}.`)
    // Un rechazo del número sigue la cadena; uno de la cuenta, no.
    const cfg = await cargarConfigImagenes(pool)
    if (esErrorDeNumero(e.message, cfg)) return siguientePaso(caso.id)
    return pasoCoordinacion(caso, `el envío al otro número falló por un problema que no es del número (${causa(e.message)})`)
  }
}

function esErrorDeNumero(error, config) {
  const codigos = Array.isArray(config.errores_numero) ? config.errores_numero.map(String) : ERRORES_NUMERO_DEFAULT
  const c = codigoError(error)
  return !!c && codigos.includes(c)
}

async function escalarVet(caso) {
  const destino = [caso.clinica_whatsapp, caso.clinica_telefono].find(esCelular)
  if (!caso.clinica) return pasoCoordinacion(caso, 'no llegó a ningún número del cliente y el servicio no lo remitió una veterinaria')
  if (!destino) return pasoCoordinacion(caso, `no llegó a ningún número del cliente y la clínica ${caso.clinica} no tiene WhatsApp registrado`)

  const config = await cargarConfigImagenes(pool)
  const plantilla = plantillaApoyoVet(config)
  const contexto = { solicitud_id: caso.id, clinica: caso.clinica, clinica_whatsapp: destino, mascota: caso.mascota, propietario: caso.propietario }

  if (!plantilla) {
    const id = await reservar(caso, { canal: 'VETERINARIA', destino, estado: 'SIN_PLANTILLA' })
    if (!id) return { omitido: 'vet_ya_escalada' }
    await novedad(caso.servicio_id, `no llegó a ningún número del cliente. Hay que pedirle apoyo a ${caso.clinica} (${destino}): la plantilla automática para clínicas aún no está aprobada.`)
    await alerta(caso.servicio_id, {
      clave: `CADENA_IMG_VET:${caso.id}`,
      mensaje: `La solicitud de imágenes de ${caso.mascota} no le llega a ${caso.propietario || 'la familia'} por WhatsApp`,
      accion: `Escríbele a ${caso.clinica} (${destino}) para que nos ayude a contactar al propietario o nos dé un número actualizado.`,
      metadata: contexto,
    })
    return { paso: 'VETERINARIA', estado: 'SIN_PLANTILLA' }
  }

  const id = await reservar(caso, { canal: 'VETERINARIA', destino, plantilla: plantilla.nombre })
  if (!id) return { omitido: 'vet_ya_escalada' }

  const valores = {
    clinica: caso.clinica || '', propietario: caso.propietario || 'el propietario',
    mascota: caso.mascota || 'su mascota', telefono: caso.wa_fallido || caso.whatsapp || '',
  }
  const dados = {}
  plantilla.vars.forEach(v => { dados[`BODY:${v}`] = valores[v] ?? '' })

  let r = null, error = null
  try {
    const { linea, agenteId, error: errLinea } = await lineaVeterinarias()
    if (errLinea) throw new Error(errLinea)
    // `personalId` en null a propósito: con una persona como autora el agente
    // se calla 10 min (`laLlevaUnHumano`) y se perdería la respuesta de la
    // clínica, que es justo lo que se busca. Igual que el aviso de recogida.
    r = await enviarPlantilla({ contacto: destino, nombre: plantilla.nombre, idioma: plantilla.idioma,
                                valores: dados, agenteId, linea, personalId: null })
    if (!r?.body?.ok) error = r?.body?.error || 'No se pudo enviar la plantilla'
  } catch (e) { error = e.message }

  if (error) {
    await marcar(id, { estado: 'ERROR', error })
    return pasoCoordinacion(caso, `no se le pudo escribir a ${caso.clinica} (${destino}): ${causa(error)}`)
  }
  await marcar(id, { estado: 'ENVIADO', messageId: r.body.wa_message_id || null })
  await novedad(caso.servicio_id, `no llegó a ningún número del cliente: se le pidió apoyo a ${caso.clinica} (${destino}) por la línea de veterinarias (${horaBogota()}).`)
  await alerta(caso.servicio_id, {
    clave: `CADENA_IMG_VET:${caso.id}`, prioridad: 'MEDIA',
    mensaje: `Se le pidió a ${caso.clinica} ayuda para contactar a ${caso.propietario || 'la familia'} de ${caso.mascota}`,
    accion: 'Revisa la respuesta de la clínica en la bandeja de veterinarias y actualiza el WhatsApp del cliente.',
    metadata: contexto,
  })
  log(MOD, caso.mascota, '→ vet', caso.clinica, destino)
  return { paso: 'VETERINARIA', destino }
}

async function pasoCoordinacion(caso, motivo) {
  const id = await reservar(caso, { canal: 'COORDINACION', destino: '', estado: 'REGISTRADO', disparoError: motivo })
  if (!id) return { omitido: 'coordinacion_ya_avisada' }
  await novedad(caso.servicio_id, `${motivo}. Queda en manos de coordinación.`)
  await alerta(caso.servicio_id, {
    clave: `CADENA_IMG_COORD:${caso.id}`,
    mensaje: `No hay cómo hacerle llegar la solicitud de imágenes de ${caso.mascota} a ${caso.propietario || 'la familia'}`,
    accion: `Llamar a la familia o conseguir otro número. Motivo: ${motivo}.`,
    metadata: { solicitud_id: caso.id, motivo },
  })
  return { paso: 'COORDINACION' }
}

/**
 * Job (cada 10 min, 7-20 h): arranca cadenas por contactos 1 que fallaron y
 * revisa el acuse de los pasos ya enviados.
 */
export async function jobCadenaContactoImagenes({ dryRun = false } = {}) {
  const config = await cargarConfigImagenes(pool)
  if (!(config.cadena_contacto_activa === true || config.cadena_contacto_activa === 'true')) {
    return { activa: false }
  }
  const desde = config.cadena_contacto_desde
  if (!desde) return { activa: true, error: 'falta cadena_contacto_desde' }
  const resultado = { iniciadas: [], revisados: [], errores: [] }

  // ── A. Contactos 1 que no llegaron por un error del número ────────────────
  // El acuse puede repetirse por wamid: se toma el último.
  const { rows: fallos } = await pool.query(
    `SELECT c.solicitud_id, c.whatsapp_destino, c.message_id,
            COALESCE(w.error, c.ultimo_error) AS error
       FROM public.solicitud_imagenes_contactos c
       JOIN public.solicitudes_imagenes sol ON sol.id = c.solicitud_id
       JOIN public.servicios s ON s.id = c.servicio_id
       LEFT JOIN LATERAL (
         SELECT estado, error FROM public.whatsapp_mensajes wm
          WHERE wm.wa_message_id = c.message_id
          ORDER BY wm.estado_en DESC NULLS LAST LIMIT 1
       ) w ON c.message_id IS NOT NULL
      WHERE c.numero = 1
        AND c.created_at >= $1::timestamptz
        AND (w.estado = 'failed' OR c.estado = 'ERROR')
        AND sol.estado NOT IN ('RECIBIDO', 'CANCELADO')
        AND s.fecha_imagenes_recibidas IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.solicitud_imagenes_cadena k
                         WHERE k.solicitud_id = c.solicitud_id AND k.canal = 'PRINCIPAL')
      LIMIT 50`,
    [String(desde)]
  )
  for (const f of fallos) {
    if (!esErrorDeNumero(f.error, config)) continue
    try {
      const r = await iniciarCadena({ solicitudId: f.solicitud_id, destino: f.whatsapp_destino,
                                      messageId: f.message_id, error: f.error, dryRun })
      resultado.iniciadas.push({ solicitud_id: f.solicitud_id, ...r })
    } catch (e) {
      resultado.errores.push({ solicitud_id: f.solicitud_id, error: e.message })
      log(MOD, 'ERROR iniciando', f.solicitud_id, e.message)
    }
  }

  // ── B. Pasos enviados: ¿llegaron? ─────────────────────────────────────────
  const { rows: enviados } = await pool.query(
    `SELECT k.id, k.solicitud_id, k.servicio_id, k.canal, k.destino, w.estado AS acuse, w.error
       FROM public.solicitud_imagenes_cadena k
       LEFT JOIN LATERAL (
         SELECT estado, error FROM public.whatsapp_mensajes wm
          WHERE wm.wa_message_id = k.message_id
          ORDER BY wm.estado_en DESC NULLS LAST LIMIT 1
       ) w ON k.message_id IS NOT NULL
      WHERE k.estado = 'ENVIADO'
        AND k.canal IN ('CLIENTE_ALTERNO', 'VETERINARIA')
        AND w.estado IN ('delivered', 'read', 'failed')`
  )
  for (const k of enviados) {
    if (dryRun) { resultado.revisados.push({ id: k.id, acuse: k.acuse }); continue }
    try {
      if (k.acuse === 'failed') {
        await marcar(k.id, { estado: 'ERROR', error: k.error })
        if (k.canal === 'CLIENTE_ALTERNO') {
          await novedad(k.servicio_id, `tampoco le llegó al ${k.destino} (${horaBogota()}): ${causa(k.error)}.`)
          const caso = await cargarCaso(k.solicitud_id)
          const r = esErrorDeNumero(k.error, config)
            ? await siguientePaso(k.solicitud_id)
            : await pasoCoordinacion(caso, `el envío al otro número falló por un problema que no es del número (${causa(k.error)})`)
          resultado.revisados.push({ id: k.id, acuse: 'failed', siguiente: r })
        } else {
          const caso = await cargarCaso(k.solicitud_id)
          const r = await pasoCoordinacion(caso, `el mensaje a la clínica (${k.destino}) no llegó: ${causa(k.error)}`)
          resultado.revisados.push({ id: k.id, acuse: 'failed', siguiente: r })
        }
      } else {
        await marcar(k.id, { estado: 'LLEGO' })
        if (k.canal === 'CLIENTE_ALTERNO') {
          // El 2º y 3er contacto irán a este número (enviarContacto).
          await pool.query(`UPDATE public.solicitudes_imagenes SET wa_alterno = $2 WHERE id = $1`, [k.solicitud_id, k.destino])
          await novedad(k.servicio_id, `le llegó al otro número del cliente, ${k.destino}. Los siguientes contactos van a ese número.`)
        } else {
          await novedad(k.servicio_id, `el mensaje de apoyo le llegó a la clínica (${k.destino}).`)
        }
        resultado.revisados.push({ id: k.id, acuse: k.acuse })
      }
    } catch (e) {
      resultado.errores.push({ id: k.id, error: e.message })
      log(MOD, 'ERROR revisando', k.id, e.message)
    }
  }

  if (resultado.iniciadas.length || resultado.revisados.length) {
    log(MOD, `iniciadas ${resultado.iniciadas.length} · revisados ${resultado.revisados.length}${dryRun ? ' (dry)' : ''}`)
  }
  return { activa: true, dryRun, ...resultado }
}
