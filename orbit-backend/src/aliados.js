// Portal de aliados — pre-registro de servicios por veterinaria/aliado.
//
// Frase rectora: "El aliado captura los datos; ORBIT conserva revisión interna
// antes de programar. Una solicitud de aliado NO crea un servicio operativo:
// crea una solicitud (origen='ALIADO') que Coordinador/Admin revisa y convierte
// con el flujo existente del Kanban. Una veterinaria nueva NO opera hasta que un
// humano la aprueba."
//
// Toda la lógica del token pasa por aquí (server-side). El anon NUNCA lee
// aliados.token_acceso: el portal valida el token contra este servicio y, en el
// envío de solicitud, el aliado_id se estampa DESDE el token (la vet no puede
// suplantar a otra). El secreto es el token; sin JWT, igual que el portal de
// imágenes (ver imagenes.js / portal público).
import crypto from 'crypto'
import { pool, log } from './db.js'

const APP_URL = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const uuidOrNull = v => (v && uuidRe.test(String(v)) ? String(v) : null)

// "Clínica Veterinaria Patitas" → "clinica-veterinaria-patitas"
function slug(s) {
  return (s || 'aliado')
    .toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'aliado'
}
// token del enlace: slug legible + 4 bytes aleatorios → no adivinable
const generarToken = nombre => `${slug(nombre)}-${crypto.randomBytes(4).toString('hex')}`

const enlaceAliado = token => `${APP_URL}/#/aliado?c=${encodeURIComponent(token)}`

// Recorta y normaliza un texto; null si queda vacío.
const txt = (v, max = 250) => {
  const s = (v ?? '').toString().trim()
  return s ? s.slice(0, max) : null
}
const soloDigitos = v => (v ?? '').toString().replace(/\D/g, '')

// ─── Flujo A · validar el token del enlace personal ─────────────────────────
// Devuelve solo los datos que el portal necesita para confirmar la veterinaria.
// No expone teléfono/comisión: el aliado no necesita verlos para enviar la solicitud.
export async function validarTokenPortal({ token }) {
  const t = txt(token, 60)
  if (!t) return { status: 400, body: { ok: false, error: 'token_requerido' } }
  const { rows } = await pool.query(
    `SELECT id_aliado, nombre, ciudad, localidad, barrio, direccion, contacto_nombre
       FROM public.aliados
      WHERE token_acceso = $1 AND estado = 'activo' AND activo = true`,
    [t]
  )
  if (!rows[0]) return { status: 404, body: { ok: false, error: 'token_invalido' } }
  return { status: 200, body: { ok: true, aliado: rows[0] } }
}

// ─── Flujo A · crear la solicitud de servicio (origen ALIADO) ───────────────
// Escribe en las MISMAS columnas que /solicitud → la conversión del Kanban
// (convertirSolicitud) la procesa sin cambios. aliado_id sale del token.
export async function crearSolicitudAliado({ token, payload = {} }) {
  const t = txt(token, 60)
  if (!t) return { status: 400, body: { ok: false, error: 'token_requerido' } }

  const { rows: ali } = await pool.query(
    `SELECT id_aliado FROM public.aliados
      WHERE token_acceso = $1 AND estado = 'activo' AND activo = true`,
    [t]
  )
  if (!ali[0]) return { status: 404, body: { ok: false, error: 'token_invalido' } }
  const aliadoId = ali[0].id_aliado

  const prop = payload.propietario || {}
  const masc = payload.mascota || {}
  const rec  = payload.recogida || {}

  // Mínimos para que la solicitud sea convertible (mismos checks que el Kanban).
  const clienteNombre = txt(prop.nombre, 120)
  const whatsapp      = soloDigitos(prop.whatsapp)
  const mascotaNombre = txt(masc.nombre, 120)
  const especieId     = parseInt(masc.especie_id) || null
  const pesoKg        = parseFloat(masc.peso_kg) || 0
  const planId        = uuidOrNull(payload.plan_id)
  const tipoRecogida  = rec.tipo === 'domicilio' ? 'domicilio' : 'veterinaria'
  const direccionDom  = txt(rec.direccion, 250)

  const faltan = []
  if (!clienteNombre)      faltan.push('nombre del propietario')
  if (whatsapp.length < 10) faltan.push('WhatsApp del propietario')
  if (!mascotaNombre)      faltan.push('nombre de la mascota')
  if (!especieId)          faltan.push('especie')
  if (pesoKg <= 0)         faltan.push('peso')
  if (!planId)             faltan.push('plan')
  if (tipoRecogida === 'domicilio' && !direccionDom) faltan.push('dirección de recogida')
  if (faltan.length) return { status: 422, body: { ok: false, error: 'incompleto', faltan } }

  const { rows } = await pool.query(
    `INSERT INTO public.solicitudes_servicio (
        cliente_nombre, cliente_apellido, cliente_cedula, cliente_whatsapp,
        cliente_telefono, cliente_telefono2, cliente_email,
        cliente_ciudad, cliente_localidad, cliente_barrio, cliente_direccion,
        mascota_nombre, especie_id, mascota_peso_kg, mascota_sexo, mascota_raza,
        plan_id, tipo_recogida, aliado_id,
        ciudad, localidad, barrio, direccion,
        hora_aproximada, notas_cliente, origen
     ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,'ALIADO'
     ) RETURNING id`,
    [
      clienteNombre, txt(prop.apellido, 120), txt(prop.cedula, 30), whatsapp.slice(0, 25),
      soloDigitos(prop.telefono).slice(0, 25) || null, soloDigitos(prop.telefono2).slice(0, 25) || null, txt(prop.email, 160),
      txt(prop.ciudad, 80), txt(prop.localidad, 80), txt(prop.barrio, 120), txt(prop.direccion, 250),
      mascotaNombre, especieId, pesoKg, txt(masc.sexo, 20), txt(masc.raza, 120),
      planId, tipoRecogida, aliadoId,
      txt(rec.ciudad, 80), txt(rec.localidad, 80), txt(rec.barrio, 120),
      tipoRecogida === 'domicilio' ? direccionDom : null,
      txt(rec.hora_aproximada, 20), txt(rec.notas, 2000),
    ]
  )
  log('[aliados/solicitud]', 'creada', rows[0].id, 'aliado', aliadoId)
  return { status: 200, body: { ok: true, solicitud_id: rows[0].id } }
}

// ─── Flujo B · una veterinaria NO aliada pide afiliación ────────────────────
// Inserta en aliados con estado 'pendiente_validacion' (sin token). Dedup por
// NIT: si ya existe una vet con ese NIT, NO duplica. Respuesta genérica siempre
// (no revela si existía: anti-enumeración).
export async function registrarAfiliacion({ payload = {} }) {
  const nombre = txt(payload.nombre, 120)
  if (!nombre) return { status: 422, body: { ok: false, error: 'nombre_requerido' } }

  const nit = txt(payload.identificacion_nit, 30)
  if (nit) {
    const { rows: dup } = await pool.query(
      `SELECT 1 FROM public.aliados WHERE identificacion_nit = $1 LIMIT 1`, [nit]
    )
    if (dup[0]) {
      log('[aliados/afiliacion]', 'duplicado por NIT, no se crea')
      return { status: 200, body: { ok: true } }  // respuesta genérica
    }
  }

  await pool.query(
    `INSERT INTO public.aliados (
        nombre, identificacion_nit, contacto_nombre, whatsapp, telefono, email,
        ciudad, localidad, barrio, direccion, notas,
        estado, activo
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendiente_validacion',false)`,
    [
      nombre, nit, txt(payload.contacto_nombre, 120),
      soloDigitos(payload.whatsapp).slice(0, 25) || null,
      soloDigitos(payload.telefono).slice(0, 25) || null,
      txt(payload.email, 160),
      txt(payload.ciudad, 80), txt(payload.localidad, 80), txt(payload.barrio, 120),
      txt(payload.direccion, 250), txt(payload.notas, 2000),
    ]
  )
  log('[aliados/afiliacion]', 'pendiente_validacion creada', nombre)
  return { status: 200, body: { ok: true } }
}

// ─── Aprobar una veterinaria pendiente (Coordinador/Admin, con JWT) ─────────
// Genera el token de acceso (si no tenía), la activa y registra quién/cuándo.
// Idempotente: si ya estaba activa con token, devuelve el token existente.
/**
 * Enlace personal de un aliado YA activo, creando el token si le falta.
 *
 * Existe aparte de `aprobarAliado` a propósito: aquel además pone
 * `estado='activo'` y `activo=true`, que es una decisión de coordinación. El
 * agente de WhatsApp no puede activar a nadie — solo entregar el enlace a quien
 * ya está aprobado. De las 196 veterinarias, la gran mayoría está activa pero
 * sin token (los tokens se generaban uno a uno desde Configuración), así que
 * sin este get-or-create el flujo fallaría para casi todas.
 *
 * Devuelve null si el aliado no existe o no está activo: el que llama decide
 * qué hacer (escalar), nunca inventarse un enlace.
 */
export async function enlacePersonalAliado(aliadoId) {
  const id = uuidOrNull(aliadoId)
  if (!id) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id_aliado, nombre, token_acceso, activo, estado
         FROM public.aliados WHERE id_aliado = $1 FOR UPDATE`,
      [id]
    )
    const a = rows[0]
    if (!a || !a.activo || a.estado === 'pendiente_validacion') {
      await client.query('ROLLBACK')
      return null
    }
    let token = a.token_acceso
    if (!token) {
      token = generarToken(a.nombre)
      await client.query(
        `UPDATE public.aliados SET token_acceso = $2 WHERE id_aliado = $1`,
        [id, token]
      )
      log('[aliados/enlace]', id, 'token generado por el agente')
    }
    await client.query('COMMIT')
    return { nombre: a.nombre, enlace: enlaceAliado(token) }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** El genérico de afiliación: sin token, se le puede dar a cualquiera. */
export const enlaceAfiliacion = () => `${APP_URL}/#/aliado`

export async function aprobarAliado({ aliadoId, personalId }) {
  const id = uuidOrNull(aliadoId)
  if (!id) return { status: 422, body: { ok: false, error: 'aliado_invalido' } }
  const actorId = uuidOrNull(personalId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id_aliado, nombre, token_acceso, estado FROM public.aliados
        WHERE id_aliado = $1 FOR UPDATE`,
      [id]
    )
    const a = rows[0]
    if (!a) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'no_encontrado' } } }

    const token = a.token_acceso || generarToken(a.nombre)
    await client.query(
      `UPDATE public.aliados
          SET estado = 'activo', activo = true,
              token_acceso = $2,
              validado_por = COALESCE($3, validado_por),
              validado_at  = COALESCE(validado_at, now())
        WHERE id_aliado = $1`,
      [id, token, actorId]
    )
    await client.query('COMMIT')
    log('[aliados/aprobar]', id, 'activo')
    return { status: 200, body: { ok: true, token_acceso: token, enlace: enlaceAliado(token) } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}
