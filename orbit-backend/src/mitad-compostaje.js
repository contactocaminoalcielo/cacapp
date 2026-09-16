// Aviso de MITAD de compostaje — reglas canónicas server-side (migración 159).
//
// «El proceso de tu mascotica va con normalidad, y si quieres puedes venir a
// verla.» Llena el silencio entre que la mascota entra al cubículo y el aviso
// de fin de compostaje (migración 149), que hasta hoy era lo único que la
// familia recibía en dos o tres meses.
//
// ⚠️ LA MITAD NO ES "UN MES". Es `fecha_compostaje_inicio + meses_compostaje/2`.
// `meses_compostaje` vale 2, 2.5 ó 3 según lo que fijó el operario por cubículo:
// al 16-sep, 19 de 75 mascotas en compostaje NO son de dos meses. Con un mes
// fijo se les escribiría antes de la mitad y el mensaje diría una fecha falsa.
//
// La invitación NO confirma la visita — eso lo decide la casa contra la jornada
// de Tenjo. El texto de la plantilla tiene que decirlo (ver `visitas.js`).
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'
import { construirEnlaceVisita } from './visitas.js'

const MOD = 'MITAD_COMPOSTAJE'

export const CONFIG_DEFAULTS_MITAD = {
  // Arranca APAGADO: sin plantilla aprobada en Meta no hay nada que mandar.
  activo:                 false,
  plantilla:              null,
  max_envios_por_corrida: 20,
  arranque_desde:         null,
}

/** Tokens permitidos en `vars` de la plantilla. Mismo criterio que plantas. */
export const TOKENS_PLANTILLA = ['nombre', 'propietario', 'mascota', 'enlace', 'codigo']

export async function cargarConfigMitad(client) {
  const cfg = { ...CONFIG_DEFAULTS_MITAD }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/**
 * Normaliza la plantilla de config. Devuelve null si no está sembrada o le
 * falta el nombre → quien llama NO debe enviar (deja el aviso PENDIENTE).
 */
export function plantillaMitad(config) {
  const raw = config.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  const vars = Array.isArray(p.vars)
    ? p.vars.filter(v => TOKENS_PLANTILLA.includes(v))
    : ['mascota', 'enlace']
  return {
    nombre:    p.nombre,
    idioma:    p.idioma    || 'es_MX',
    categoria: p.categoria || 'UTILITY',
    vars:      vars.length ? vars : ['mascota', 'enlace'],
  }
}

/**
 * Manda un aviso PENDIENTE (o reintenta uno en ERROR).
 *
 * Nunca marca ENVIADO lo que no salió: sin plantilla devuelve el motivo y deja
 * la fila como está. Un aviso que no salió tiene que verse como no salido.
 */
export async function enviarAvisoMitad({ avisoId, config = null, personalId = null }) {
  if (!uuidOrNull(avisoId)) return { enviado: false, motivo: 'aviso_invalido' }
  const client = await pool.connect()
  try {
    const cfg = config || await cargarConfigMitad(client)
    const plantilla = plantillaMitad(cfg)

    const { rows } = await client.query(
      `SELECT a.id, a.servicio_id, a.estado, a.codigo, a.enlace, a.whatsapp_destino,
              m.nombre AS mascota,
              c.nombre AS cliente_nombre,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              c.whatsapp
         FROM public.avisos_mitad_compostaje a
         JOIN public.servicios s     ON s.id = a.servicio_id
         JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
         LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
        WHERE a.id = $1`,
      [avisoId]
    )
    const a = rows[0]
    if (!a) return { enviado: false, motivo: 'no_encontrado' }
    if (a.estado === 'ENVIADO')   return { enviado: false, motivo: 'ya_enviado' }
    if (a.estado === 'CANCELADO') return { enviado: false, motivo: 'cancelado' }
    if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

    // El número VIGENTE de la ficha manda sobre el guardado al crear el aviso:
    // cuando coordinación corrige el WhatsApp es porque el viejo estaba malo.
    const destino = validoWa(a.whatsapp) || validoWa(a.whatsapp_destino)
    if (!destino) {
      await marcarError(client, avisoId, 'El cliente no tiene un WhatsApp válido')
      return { enviado: false, motivo: 'sin_whatsapp' }
    }

    const enlace = a.enlace || construirEnlaceVisita(a.codigo)
    const valores = {
      nombre:      (a.cliente_nombre || '').split(' ')[0] || a.propietario || '',
      propietario: a.propietario || '',
      mascota:     a.mascota || 'tu mascota',
      enlace,
      codigo:      a.codigo,
    }
    const bodyParams = plantilla.vars.map(v => String(valores[v] ?? ''))

    try {
      const r = await enviarPlantillaGenerica({
        telefono:        destino,
        nombre:          a.propietario || '',
        plantillaNombre: plantilla.nombre,
        idioma:          plantilla.idioma,
        category:        plantilla.categoria,
        bodyParams,
        fromNumberId:    LINEA_WA_ID,
        // NULL a propósito, igual que el aviso a la vet: con el id puesto, el
        // agente se calla 10 minutos en esa conversación (`laLlevaUnHumano`) —
        // y este aviso es justamente de los que hacen que la familia responda.
        personalId:      uuidOrNull(personalId),
      })
      await client.query(
        `UPDATE public.avisos_mitad_compostaje
            SET estado = 'ENVIADO', fecha_envio = now(), mensaje_id = $2,
                whatsapp_destino = $3, linea_wa = $4, enlace = $5,
                error = NULL, intentos = intentos + 1
          WHERE id = $1`,
        [avisoId, r?.messageId || null, destino, LINEA_WA_NUMERO, enlace]
      )
      return { enviado: true, mensaje_id: r?.messageId || null }
    } catch (err) {
      await marcarError(client, avisoId, err.message)
      log('[mitad/enviar] ERROR', avisoId, err.message)
      return { enviado: false, motivo: 'error_envio', error: err.message }
    }
  } finally {
    client.release()
  }
}

async function marcarError(client, avisoId, mensaje) {
  await client.query(
    `UPDATE public.avisos_mitad_compostaje
        SET estado = 'ERROR', error = $2, intentos = intentos + 1
      WHERE id = $1`,
    [avisoId, String(mensaje || '').slice(0, 500)]
  )
}

function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
