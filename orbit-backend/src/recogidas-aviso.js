// Aviso a la veterinaria de la hora estimada de llegada del técnico.
//
// El técnico toca "Iniciar ruta", pone la hora, y en ese mismo instante la
// clínica recibe por WhatsApp: «Nuestro técnico Sebastián recogerá a la mascotica
// Luna sobre las 14:30». Antes de esto el aviso existía solo como un toast en el
// Kanban con un `wa.me` que alguien tenía que tocar a mano.
//
// Reglas cerradas con David (2026-09-11), no re-preguntar:
//  · Solo si la recogida es EN la clínica (`tipo_lugar = 'CLINICA_ALIADA'`).
//    Un servicio referido por una vet pero recogido en casa de la familia NO
//    avisa: el técnico no va a la puerta de la clínica.
//  · Sale por la LÍNEA DE VETERINARIAS, que se lee del agente `VETERINARIAS`
//    en `agente_wa` — es un DATO, no una constante de código (ver
//    memory/agentes_multilinea_marco.md). Mandarlo por la línea de familias
//    sería escribirle a la clínica desde un número con el que nunca ha hablado.
//  · Va al WhatsApp del aliado, que es el hilo que ya existe en la bandeja.
//
// Ver migración 154_aviso_vet_recogida.sql.
import { pool, log } from './db.js'
import { enviarPlantilla } from './whatsapp-plantillas.js'

const MOD = 'AVISO_VET'

/** Módulo en `config_operativa` (migración 154). */
const MOD_CONFIG = 'AVISO_VET_RECOGIDA'

/** Clave del agente cuya línea atiende a las veterinarias. */
const AGENTE_VETERINARIAS = 'VETERINARIAS'

export const CONFIG_DEFAULTS_AVISO_VET = {
  // Apagado por defecto: un despliegue no puede ponerse a escribirle solo a las
  // clínicas, y la plantilla puede no estar aprobada todavía.
  activo:    false,
  plantilla: null,
}

export async function cargarConfigAvisoVet(client = pool) {
  const cfg = { ...CONFIG_DEFAULTS_AVISO_VET }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD_CONFIG]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/** Huecos que la plantilla puede pedir. Cerrado a propósito: `vars` viene de
 *  config y sin esta lista una clave inventada llegaría vacía al mensaje. */
export const TOKENS_AVISO_VET = ['tecnico', 'mascota', 'hora', 'clinica']

/**
 * Normaliza la plantilla de config. `null` → quien llama NO envía.
 * Misma forma que `plantillaAviso` de plantas.js.
 */
export function plantillaAvisoVet(config) {
  const raw = config.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  const vars = Array.isArray(p.vars)
    ? p.vars.filter(v => TOKENS_AVISO_VET.includes(v))
    : ['tecnico', 'mascota', 'hora']
  return {
    nombre:    p.nombre,
    idioma:    p.idioma || 'es_MX',
    categoria: p.categoria || 'UTILITY',
    vars,
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

/** Un número sirve si tiene al menos 10 dígitos (mismo criterio que plantas). */
function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

/** "14:30:00" o "14:30" → "14:30". Lo que se le enseña a la clínica. */
function horaCorta(v) {
  const s = String(v || '').trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

/** La línea por la que se habla con las veterinarias, leída del agente. */
async function lineaVeterinarias() {
  const { rows: [a] } = await pool.query(
    `SELECT id, nombre, phone_number_ids
       FROM public.agente_wa WHERE clave = $1 LIMIT 1`,
    [AGENTE_VETERINARIAS]
  )
  if (!a) return { error: `No existe el agente ${AGENTE_VETERINARIAS}: sin él no se sabe por qué línea escribirle a la clínica.` }
  const linea = (a.phone_number_ids || [])[0]
  if (!linea) return { error: `El agente "${a.nombre}" no tiene ninguna línea asignada (Agentes IA → Ajustes).` }
  return { agenteId: a.id, linea }
}

/**
 * Manda el aviso de hora estimada a la veterinaria de un servicio.
 *
 * Best-effort por diseño: NUNCA lanza. El técnico ya guardó su hora y salió a
 * la calle; que Meta esté caída no puede dejarlo con un botón girando ni
 * pidiéndole repetir el paso. Todo lo que pasa se devuelve en `motivo` y se
 * guarda en `recogidas.aviso_vet_*` para que se pueda auditar después.
 *
 * @returns {{enviado:boolean, motivo?:string, error?:string, destino?:string, mensaje_id?:string}}
 */
export async function avisarVetRecogida({ servicioId, hora = null, actor = null }) {
  try {
    const config = await cargarConfigAvisoVet()
    if (config.activo !== true) return { enviado: false, motivo: 'apagado' }

    const plantilla = plantillaAvisoVet(config)
    if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

    // Una sola consulta: la recogida, la mascota, el aliado y el técnico que
    // tiene asignado el servicio AHORA (no el que mande el navegador).
    const { rows: [d] } = await pool.query(
      `SELECT r.id                AS recogida_id,
              r.tipo_lugar,
              r.hora_programada,
              r.contacto_telefono,
              r.aviso_vet_enviado_en,
              m.nombre            AS mascota,
              a.nombre            AS clinica,
              a.whatsapp          AS aliado_whatsapp,
              s.tecnico_id,
              t.nombre            AS tecnico_nombre
         FROM public.servicios s
         JOIN public.recogidas r  ON r.servicio_id = s.id
         LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
         LEFT JOIN public.aliados  a ON a.id_aliado  = s.aliado_origen_id
         LEFT JOIN public.personal t ON t.id         = s.tecnico_id
        WHERE s.id = $1
        ORDER BY r.created_at
        LIMIT 1`,
      [servicioId]
    )
    if (!d) return { enviado: false, motivo: 'sin_recogida' }

    // Un técnico solo avisa por SUS servicios. Sin esto, cualquier sesión de
    // campo podría hacerle llegar un mensaje a cualquier clínica con solo
    // cambiar un id — y saldría por nuestra línea, con nuestra firma.
    // Coordinación y administración no se limitan: reenviar es tarea suya.
    if (actor && !['COORDINADOR', 'ADMIN'].includes(actor.rol) && d.tecnico_id !== actor.id) {
      return { enviado: false, motivo: 'no_es_tu_servicio' }
    }

    if (d.tipo_lugar !== 'CLINICA_ALIADA') return { enviado: false, motivo: 'no_es_clinica' }
    if (d.aviso_vet_enviado_en)            return { enviado: false, motivo: 'ya_enviado' }

    // El número del aliado manda; el de la recogida es el respaldo. 243 de 244
    // aliados activos tienen `whatsapp`, y es el hilo que la clínica ya conoce.
    const destino = validoWa(d.aliado_whatsapp) || validoWa(d.contacto_telefono)
    if (!destino) return { enviado: false, motivo: 'sin_whatsapp' }

    const horaTexto = horaCorta(hora || d.hora_programada)
    if (!horaTexto) return { enviado: false, motivo: 'sin_hora' }

    const { linea, agenteId, error: errLinea } = await lineaVeterinarias()
    if (errLinea) {
      await marcarError(d.recogida_id, errLinea)
      return { enviado: false, motivo: 'sin_linea', error: errLinea }
    }

    // ── Candado ──
    // Se RECLAMA el envío antes de mandarlo: dos toques del técnico con mala
    // señal, o un reintento del navegador, no pueden mandarle dos mensajes a la
    // clínica. Si el envío falla, se devuelve a NULL más abajo.
    const { rowCount } = await pool.query(
      `UPDATE public.recogidas
          SET aviso_vet_enviado_en = now(), aviso_vet_destino = $2, aviso_vet_error = NULL
        WHERE id = $1 AND aviso_vet_enviado_en IS NULL`,
      [d.recogida_id, destino.slice(0, 20)]
    )
    if (!rowCount) return { enviado: false, motivo: 'ya_enviado' }

    const valores = {
      tecnico: (d.tecnico_nombre || 'nuestro técnico').trim(),
      mascota: (d.mascota || 'la mascotica').trim(),
      hora:    horaTexto,
      clinica: (d.clinica || '').trim(),
    }
    // Los huecos van CON NOMBRE (`parameter_format: NAMED`): la clave es
    // `BODY:<param>`, no `BODY:1`. Ver `claveHueco` en whatsapp-plantillas.js —
    // mandar posicionales a una plantilla NAMED devuelve "faltan datos".
    const dados = {}
    plantilla.vars.forEach(v => { dados[`BODY:${v}`] = valores[v] ?? '' })

    // El envío va en su propio try: si la red con Meta se cae, `enviarPlantilla`
    // LANZA en vez de devolver `ok:false`, y sin esto la reclama de arriba se
    // quedaría puesta — la recogida figuraría avisada sin que la clínica haya
    // recibido nada, y ningún reintento la tocaría nunca más.
    let r
    try {
      r = await enviarPlantilla({
        contacto: destino,
        nombre:   plantilla.nombre,
        idioma:   plantilla.idioma,
        valores:  dados,
        agenteId,
        // La línea viaja explícita: con un agente de dos líneas, dejar que escoja
        // "la primera" acierta por casualidad. Ver memory/bandeja_enviar_plantilla.md.
        linea,
        // 🔑 `personalId` va en NULL a propósito, aunque lo dispare el técnico.
        // El agente se calla 10 minutos en una conversación donde una PERSONA
        // acaba de mandar una plantilla (`laLlevaUnHumano` en agente-wa.js), y
        // este aviso es justo el que hace que la clínica escriba de vuelta: con
        // el id puesto, el agente se perdería esa respuesta. Quién lo disparó
        // queda en la novedad del servicio y en la notificación al coordinador.
        personalId: null,
      })
    } catch (e) {
      await soltarReclama(d.recogida_id, e.message)
      log(MOD, `no salió el aviso de ${valores.mascota} a ${destino} —`, e.message)
      return { enviado: false, motivo: 'error_envio', error: e.message }
    }

    if (!r?.body?.ok) {
      const error = r?.body?.error || 'No se pudo enviar la plantilla'
      await soltarReclama(d.recogida_id, error)
      log(MOD, `no salió el aviso de ${valores.mascota} a ${destino} —`, error)
      return { enviado: false, motivo: 'error_envio', error }
    }

    await pool.query(
      `UPDATE public.recogidas
          SET aviso_vet_mensaje_id = $2, aviso_vet_error = NULL
        WHERE id = $1`,
      [d.recogida_id, r.body.wa_message_id || null]
    )
    log(MOD, `aviso de ${valores.mascota} (${horaTexto}) enviado a ${destino}`)
    return {
      enviado: true,
      destino,
      clinica:    valores.clinica || null,
      mensaje_id: r.body.wa_message_id || null,
    }
  } catch (e) {
    // Best-effort de verdad: ni un fallo inesperado puede tumbar el inicio de ruta.
    log(MOD, 'ERROR', e.message)
    return { enviado: false, motivo: 'error_interno', error: e.message }
  }
}

async function marcarError(recogidaId, mensaje) {
  await pool.query(
    `UPDATE public.recogidas SET aviso_vet_error = $2 WHERE id = $1`,
    [recogidaId, String(mensaje).slice(0, 900)]
  ).catch(e => log(MOD, 'no se pudo registrar el error —', e.message))
}

/** Devuelve la reclama: la recogida vuelve a quedar "sin avisar" y con el motivo. */
async function soltarReclama(recogidaId, mensaje) {
  await pool.query(
    `UPDATE public.recogidas
        SET aviso_vet_enviado_en = NULL, aviso_vet_error = $2
      WHERE id = $1`,
    [recogidaId, String(mensaje).slice(0, 900)]
  ).catch(e => log(MOD, 'no se pudo soltar la reclama —', e.message))
}
