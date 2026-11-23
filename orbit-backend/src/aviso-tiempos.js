// AVISO DE TIEMPOS al ingresar al cuarto frío (migr. 214).
//
// REPORTE ORBIT 2026-11-20: entre el ingreso a la nevera y el enlace de las
// fotos la familia no recibía ninguna noticia. Este aviso le cuenta, apenas la
// mascota entra al cuarto frío, cuánto tarda el certificado, que le llegará el
// enlace de las fotos y cuánto tardan los recordatorios. El texto por plan vive
// en aviso-tiempos-reglas.js (puro, con pruebas).
//
// 🪤 El disparo es `cuarto_frio.fecha_ingreso_real`, NUNCA `fecha_ingreso`: esa
// la pone el trigger al CREAR el servicio (== created_at). El ingreso se
// registra desde el navegador (TecnicoApp / CuartoFrio.jsx) y el backend no se
// entera: por eso un job cada 10 minutos de día. Lo que entra de noche sale en
// la primera corrida de las 7:00.
//
// Garantías:
//   · UNA fila por servicio (UNIQUE) reclamada ANTES de la red: dos corridas a
//     la vez no mandan dos veces. Un ENVIANDO huérfano no se reintenta solo
//     (preferimos un aviso perdido a uno duplicado); se relanza a mano desde
//     /automatizaciones.
//   · `arranque_desde` (se fija al encender): nada de ingresos viejos.
//   · `horas_max_atraso`: un ingreso registrado tarde o con el flujo caído no
//     dispara un «ya está bajo nuestro cuidado» días después.
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'
import {
  CONFIG_DEFAULTS, reglas, plantillaAviso, textoTiempos, mensajeCompleto, nombreMascota,
} from './aviso-tiempos-reglas.js'

const MOD = 'AVISO_TIEMPOS'
const TAG = '[aviso-tiempos]'

export async function cargarConfigAvisoTiempos() {
  const cfg = { ...CONFIG_DEFAULTS }
  const { rows } = await pool.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD])
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/**
 * Servicios que entraron a la nevera dentro de la ventana y aún no tienen aviso
 * (o lo tienen en ERROR con menos de 3 intentos).
 * $1 horas · $2 arranque (date o null) · $3 planes · $4 tope
 */
const CANDIDATOS = `
  SELECT s.id AS servicio_id
    FROM public.cuarto_frio cf
    JOIN public.servicios s ON s.id = cf.servicio_id
    JOIN public.planes p    ON p.id = s.plan_id
   WHERE cf.fecha_ingreso_real IS NOT NULL
     AND cf.fecha_ingreso_real >= now() - make_interval(hours => $1::int)
     AND ($2::date IS NULL OR (cf.fecha_ingreso_real AT TIME ZONE 'America/Bogota')::date >= $2::date)
     AND s.estado <> 'CANCELADO'
     AND p.codigo = ANY($3::text[])
     AND NOT EXISTS (
       SELECT 1 FROM public.avisos_tiempos_ingreso a
        WHERE a.servicio_id = s.id
          AND (a.estado <> 'ERROR' OR a.intentos >= 3))
   ORDER BY cf.fecha_ingreso_real ASC
   LIMIT $4`

/** Lo que el texto necesita de UN servicio, leído en el momento de enviar. */
async function datosServicio(servicioId) {
  const { rows: [d] } = await pool.query(
    `SELECT s.estado, s.fecha_imagenes_recibidas, s.recordatorios_anticipados,
            p.codigo AS plan, p.tipo_proceso, p.dias_entrega_prometidos,
            m.nombre AS mascota, c.whatsapp,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            cf.fecha_ingreso_real,
            EXISTS (SELECT 1 FROM public.solicitud_imagenes_contactos ct
                     WHERE ct.servicio_id = s.id AND ct.numero = 1 AND ct.estado = 'ENVIADO') AS enlace_enviado,
            (SELECT max(r.tiempo_produccion_dias)
               FROM public.servicio_recordatorios sr
               JOIN public.recordatorios r ON r.id = sr.recordatorio_id
              WHERE sr.servicio_id = s.id AND r.nombre ILIKE 'memopet%'
                AND sr.origen <> 'REMOVIDO' AND sr.estado NOT IN ('NA', 'ENTREGADO')) AS dias_memopet
       FROM public.servicios s
       JOIN public.planes p        ON p.id = s.plan_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
       LEFT JOIN public.cuarto_frio cf ON cf.servicio_id = s.id
      WHERE s.id = $1`, [servicioId])
  return d || null
}

function tiemposDe(d, r) {
  return textoTiempos({
    plan:           d.plan,
    tipoProceso:    d.tipo_proceso,
    diasPlan:       d.dias_entrega_prometidos,
    fotosRecibidas: !!d.fecha_imagenes_recibidas,
    anticipados:    d.recordatorios_anticipados,
    enlaceEnviado:  d.enlace_enviado,
    diasMemopet:    d.dias_memopet,
  }, r)
}

/**
 * Manda el aviso de UN servicio. Reclama la fila antes de la red; nunca marca
 * ENVIADO lo que no salió. Lo usan el job y el «relanzar» de /automatizaciones.
 */
export async function enviarAvisoTiempos({ servicioId, config = null, personalId = null }) {
  if (!uuidOrNull(servicioId)) return { enviado: false, motivo: 'no_encontrado' }
  const cfg = config || await cargarConfigAvisoTiempos()
  const r = reglas(cfg)
  const plantilla = plantillaAviso(cfg)
  if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

  const d = await datosServicio(servicioId)
  if (!d) return { enviado: false, motivo: 'no_encontrado' }

  // Reclamar: nueva → ENVIANDO; una en ERROR se retoma. Cualquier otra = ya está.
  const { rows: [k] } = await pool.query(
    `INSERT INTO public.avisos_tiempos_ingreso (servicio_id, plan_codigo, fecha_ingreso, estado)
     VALUES ($1, $2, $3, 'ENVIANDO')
     ON CONFLICT (servicio_id) DO UPDATE
        SET estado = 'ENVIANDO', updated_at = now()
      WHERE public.avisos_tiempos_ingreso.estado = 'ERROR'
     RETURNING id`, [servicioId, d.plan, d.fecha_ingreso_real])
  if (!k) return { enviado: false, motivo: 'ya_enviado' }

  if (d.estado === 'CANCELADO') { await excluir(k.id, 'Servicio cancelado'); return { enviado: false, motivo: 'cancelado' } }
  const tiempos = tiemposDe(d, r)
  if (!tiempos) { await excluir(k.id, 'Su plan no tiene tiempos que contar'); return { enviado: false, motivo: 'sin_tiempos' } }
  const destino = validoWa(d.whatsapp)
  if (!destino) { await excluir(k.id, 'Sin WhatsApp válido'); return { enviado: false, motivo: 'sin_whatsapp' } }

  const mascota = nombreMascota(d.mascota)
  const mensaje = mensajeCompleto(mascota, tiempos)
  try {
    const res = await enviarPlantillaGenerica({
      telefono:        destino,
      nombre:          d.propietario || '',
      plantillaNombre: plantilla.nombre,
      idioma:          plantilla.idioma,
      category:        plantilla.categoria,
      mensaje,
      bodyParams:      [mascota, tiempos],
      fromNumberId:    LINEA_WA_ID,
      // NULL desde el job: con un id puesto el agente se calla 10 minutos, y la
      // familia suele contestar a este mensaje con preguntas.
      personalId:      uuidOrNull(personalId),
    })
    await pool.query(
      `UPDATE public.avisos_tiempos_ingreso
          SET estado = 'ENVIADO', fecha_envio = now(), mensaje_id = $2, mensaje = $3,
              whatsapp_destino = $4, linea_wa = $5, enviado_por = $6,
              error = NULL, intentos = intentos + 1, updated_at = now()
        WHERE id = $1`,
      [k.id, res?.messageId || null, mensaje, destino, LINEA_WA_NUMERO, uuidOrNull(personalId)])
    return { enviado: true, mensaje_id: res?.messageId || null }
  } catch (e) {
    await pool.query(
      `UPDATE public.avisos_tiempos_ingreso
          SET estado = 'ERROR', error = $2, mensaje = $3, intentos = intentos + 1, updated_at = now()
        WHERE id = $1`, [k.id, String(e.message || '').slice(0, 500), mensaje])
    log(TAG, 'ERROR enviando', servicioId, e.message)
    return { enviado: false, motivo: 'error_envio', error: e.message }
  }
}

async function excluir(id, motivo) {
  await pool.query(
    `UPDATE public.avisos_tiempos_ingreso
        SET estado = 'EXCLUIDO', motivo_exclusion = $2, updated_at = now()
      WHERE id = $1`, [id, motivo])
}

/**
 * El job (cada 10 min, 7:00 a 20:00, todos los días).
 * `dryRun`: no escribe ni envía; devuelve los candidatos con el texto que
 * recibirían — sirve para revisar los mensajes ANTES de encender el flujo, por
 * eso corre aunque esté apagado y sin `arranque_desde`.
 */
export async function jobAvisoTiempos({ dryRun = false } = {}) {
  const cfg = await cargarConfigAvisoTiempos()
  const r = reglas(cfg)
  const res = { activo: r.activo, candidatos: 0, enviados: 0, excluidos: 0, errores: 0, dry_run: dryRun }

  if (!dryRun) {
    if (!r.activo) return res
    if (!r.arranque) { log(TAG, 'SIN arranque_desde — no envía'); return { ...res, motivo: 'sin_arranque_desde' } }
  }

  const { rows: candidatos } = await pool.query(CANDIDATOS, [r.horas, r.arranque, r.planes, r.tope])
  res.candidatos = candidatos.length

  if (dryRun) {
    const muestra = []
    for (const c of candidatos) {
      const d = await datosServicio(c.servicio_id)
      if (!d) continue
      const tiempos = tiemposDe(d, r)
      muestra.push({
        servicio_id: c.servicio_id, plan: d.plan, mascota: nombreMascota(d.mascota),
        whatsapp_valido: !!validoWa(d.whatsapp),
        mensaje: tiempos ? mensajeCompleto(nombreMascota(d.mascota), tiempos) : null,
      })
    }
    return { ...res, plantilla: plantillaAviso(cfg)?.nombre || null, muestra }
  }

  if (!plantillaAviso(cfg)) {
    log(TAG, 'SIN PLANTILLA aprobada —', candidatos.length, 'aviso(s) esperan. Correr crear-plantilla-aviso-tiempos.mjs estado.')
    return { ...res, sin_plantilla: candidatos.length }
  }

  for (const c of candidatos) {
    const e = await enviarAvisoTiempos({ servicioId: c.servicio_id, config: cfg })
    if (e.enviado) res.enviados++
    else if (e.motivo === 'error_envio') res.errores++
    else if (['sin_whatsapp', 'sin_tiempos', 'cancelado'].includes(e.motivo)) res.excluidos++
  }
  if (res.candidatos) log(TAG, JSON.stringify(res))
  return res
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
