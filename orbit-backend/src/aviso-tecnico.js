// WhatsApp automático al TÉCNICO cuando se le asigna un servicio (migr. 228).
//
// Lo disparan los tres sitios donde coordinación asigna técnico: el registro de
// un servicio nuevo, la conversión de una solicitud en el Kanban y el cambio de
// técnico en la ficha. Las reglas puras (texto, cobro, hora) viven en
// aviso-tecnico-reglas.js y tienen su prueba en tests/aviso-tecnico.test.mjs.
//
// Mismo esqueleto que el aviso de hora a la veterinaria (recogidas-aviso.js):
//  · Best-effort: NUNCA lanza. El técnico ya quedó guardado; que Meta esté
//    caída no puede tumbar el registro ni dejar un botón girando.
//  · El técnico, el teléfono y el dinero se leen de la BASE, no del navegador.
//  · Se RESERVA el envío (fila ENVIANDO) antes de ir a Meta: dos clics o dos
//    pestañas no le mandan dos mensajes. Si falla, la fila queda en ERROR con el
//    motivo y se puede relanzar desde /automatizaciones.
import { pool, log } from './db.js'
import { enviarPlantilla } from './whatsapp-plantillas.js'
import { lineaVeterinarias } from './recogidas-aviso.js'
import { CONFIG_DEFAULTS, plantillaAviso, activo, validoWa, valoresAviso, VARS } from './aviso-tecnico-reglas.js'

const MOD = 'AVISO_TECNICO'
const MOD_CONFIG = 'AVISO_TECNICO_ASIGNACION'

/** Solo tiene sentido avisar una RECOGIDA que todavía no se ha hecho. */
const ESTADOS_AVISABLES = ['INGRESADO', 'EN_RECOGIDA']

/** Ventana anti-duplicado: el mismo técnico, el mismo servicio, dentro de esto → no se repite. */
const VENTANA_DUPLICADO_MIN = 10

const ORIGENES = ['REGISTRO', 'SOLICITUD', 'FICHA', 'RELANZAR']

export async function cargarConfigAvisoTecnico(client = pool) {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD_CONFIG]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/**
 * Manda el aviso al técnico que tiene asignado el servicio AHORA.
 * @returns {{enviado:boolean, motivo?:string, error?:string, destino?:string, tecnico?:string}}
 */
export async function avisarTecnicoAsignado({ servicioId, origen = null, actor = null }) {
  try {
    const config = await cargarConfigAvisoTecnico()
    if (!activo(config)) return { enviado: false, motivo: 'apagado' }
    const plantilla = plantillaAviso(config)
    if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

    const { rows: [d] } = await pool.query(
      `SELECT s.id, s.estado, s.tecnico_id,
              s.direccion_recogida, s.barrio_recogida, s.ciudad_recogida,
              s.indicaciones_recogida, s.notas,
              s.valor_total, s.valor_pagado, s.metodo_pago, s.valor_plan, s.valor_adicionales,
              s.valor_transporte, s.recargo_nocturno, s.descuento_adicional,
              s.comision_aliado, s.comision_descontada, s.valor_eutanasia,
              t.nombre   AS tecnico_nombre, t.whatsapp AS tecnico_whatsapp, t.activo AS tecnico_activo,
              m.nombre   AS mascota, esp.nombre AS especie, p.nombre AS plan,
              c.nombre   AS cliente_nombre, c.apellido AS cliente_apellido,
              c.whatsapp AS cliente_whatsapp, c.telefono AS cliente_telefono,
              r.notas    AS recogida_notas, r.contacto_nombre, r.contacto_telefono
         FROM public.servicios s
         LEFT JOIN public.personal t   ON t.id = s.tecnico_id
         LEFT JOIN public.mascotas m   ON m.id_mascota = s.mascota_id
         LEFT JOIN public.especies esp ON esp.id = m.especie_id
         LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
         LEFT JOIN public.planes p     ON p.id = s.plan_id
         LEFT JOIN LATERAL (
           SELECT rr.notas, rr.contacto_nombre, rr.contacto_telefono
             FROM public.recogidas rr WHERE rr.servicio_id = s.id
            ORDER BY rr.created_at LIMIT 1
         ) r ON true
        WHERE s.id = $1`,
      [servicioId]
    )
    if (!d) return { enviado: false, motivo: 'sin_servicio' }
    if (!d.tecnico_id) return { enviado: false, motivo: 'sin_tecnico' }
    if (!ESTADOS_AVISABLES.includes(d.estado)) return { enviado: false, motivo: 'ya_recogido' }
    if (d.tecnico_activo === false) return { enviado: false, motivo: 'tecnico_inactivo' }

    const destino = validoWa(d.tecnico_whatsapp)
    const org = ORIGENES.includes(origen) ? origen : null
    if (!destino) {
      // Se deja registrado: coordinación tiene que ver que a este técnico no le llega nada.
      await registrarError({ d, org, actor, error: 'El técnico no tiene un WhatsApp válido en Personal' })
      return { enviado: false, motivo: 'sin_whatsapp', tecnico: d.tecnico_nombre }
    }

    const { linea, agenteId, error: errLinea } = await lineaVeterinarias()
    if (errLinea) {
      await registrarError({ d, org, actor, destino, error: errLinea })
      return { enviado: false, motivo: 'sin_linea', error: errLinea }
    }

    // ── Candado ──
    const avisoId = await reservar({ d, org, actor, destino })
    if (!avisoId) return { enviado: false, motivo: 'ya_enviado', tecnico: d.tecnico_nombre }

    const valores = valoresAviso(d)
    const dados = {}
    VARS.forEach(v => { dados[`BODY:${v}`] = valores[v] })

    let r
    try {
      r = await enviarPlantilla({
        contacto: destino,
        nombre:   plantilla.nombre,
        idioma:   plantilla.idioma,
        valores:  dados,
        agenteId,
        linea,
        // NULL a propósito: lo manda el sistema, no una persona metida en el chat.
        // Al técnico el agente no le contesta de todas formas (esNumeroDelPersonal).
        personalId: null,
      })
    } catch (e) {
      await cerrar(avisoId, 'ERROR', { error: e.message })
      log(MOD, `no salió el aviso de ${valores.mascota} a ${valores.tecnico} —`, e.message)
      return { enviado: false, motivo: 'error_envio', error: e.message, tecnico: d.tecnico_nombre }
    }

    if (!r?.body?.ok) {
      const error = r?.body?.error || 'No se pudo enviar la plantilla'
      await cerrar(avisoId, 'ERROR', { error })
      log(MOD, `no salió el aviso de ${valores.mascota} a ${valores.tecnico} —`, error)
      return { enviado: false, motivo: 'error_envio', error, tecnico: d.tecnico_nombre }
    }

    await cerrar(avisoId, 'ENVIADO', { mensajeId: r.body.wa_message_id || null })
    log(MOD, `aviso de ${valores.mascota} enviado a ${valores.tecnico} (${destino})${org ? ` · ${org}` : ''}`)
    return { enviado: true, destino, tecnico: d.tecnico_nombre }
  } catch (e) {
    // Best-effort de verdad: ni un fallo inesperado puede tumbar la asignación.
    log(MOD, 'ERROR', e.message)
    return { enviado: false, motivo: 'error_interno', error: e.message }
  }
}

/**
 * Reserva el envío. Devuelve el id de la fila ENVIANDO, o null si ya hay uno
 * en curso o recién enviado para el MISMO técnico y servicio. El candado de
 * transacción serializa dos peticiones simultáneas (dos pestañas).
 */
async function reservar({ d, org, actor, destino }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`aviso_tecnico:${d.id}:${d.tecnico_id}`])
    const { rows: [ya] } = await client.query(
      `SELECT 1 FROM public.avisos_tecnico
        WHERE servicio_id = $1 AND tecnico_id = $2
          AND ((estado = 'ENVIANDO' AND created_at > now() - interval '1 hour')
            OR (estado = 'ENVIADO'  AND created_at > now() - ($3 || ' minutes')::interval))
        LIMIT 1`,
      [d.id, d.tecnico_id, String(VENTANA_DUPLICADO_MIN)]
    )
    if (ya) { await client.query('ROLLBACK'); return null }
    const { rows: [fila] } = await client.query(
      `INSERT INTO public.avisos_tecnico (servicio_id, tecnico_id, estado, origen, destino, disparado_por)
       VALUES ($1, $2, 'ENVIANDO', $3, $4, $5) RETURNING id`,
      [d.id, d.tecnico_id, org, destino.slice(0, 20), actor?.id || null]
    )
    await client.query('COMMIT')
    return fila.id
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function cerrar(id, estado, { mensajeId = null, error = null } = {}) {
  await pool.query(
    `UPDATE public.avisos_tecnico
        SET estado = $2, mensaje_id = $3, error = $4,
            enviado_en = CASE WHEN $2 = 'ENVIADO' THEN now() ELSE enviado_en END
      WHERE id = $1`,
    [id, estado, mensajeId, error ? String(error).slice(0, 900) : null]
  ).catch(e => log(MOD, 'no se pudo cerrar el aviso —', e.message))
}

async function registrarError({ d, org, actor, destino = null, error }) {
  await pool.query(
    `INSERT INTO public.avisos_tecnico (servicio_id, tecnico_id, estado, origen, destino, error, disparado_por)
     VALUES ($1, $2, 'ERROR', $3, $4, $5, $6)`,
    [d.id, d.tecnico_id, org, destino ? destino.slice(0, 20) : null, String(error).slice(0, 900), actor?.id || null]
  ).catch(e => log(MOD, 'no se pudo registrar el error —', e.message))
}
