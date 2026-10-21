// CRM comercial de veterinarias (migración 180).
//
// Frase rectora: "Las métricas NO se guardan, se calculan." Frecuencia,
// probabilidad, tendencia y riesgo salen de `servicios` en cada consulta: una
// cifra guardada se queda vieja el día que alguien corrige un servicio, y en un
// CRM eso significa llamar a la clínica equivocada.
//
// Todo pasa por aquí (rol `orbit_backend`); el navegador no escribe en `crm_*`.
// Roles: COMERCIAL, COORDINADOR y ADMIN (coordinador ≡ admin).
import express from 'express'
import crypto from 'crypto'
import { pool, log } from './db.js'
import { llamarClaude } from './ia.js'
import { enviarPlantilla, valoresDeFuente } from './whatsapp-plantillas.js'
import { enviarMaterial } from './whatsapp-materiales.js'
import { enviarSobre, enviarTexto, etiquetar } from './whatsapp-cloud.js'

const MOD = '[crm]'
const APP_URL = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')

export const ROLES_CRM = ['COMERCIAL', 'COORDINADOR', 'ADMIN']

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const uuid = v => (v && uuidRe.test(String(v)) ? String(v) : null)
const txt = (v, max = 500) => {
  const s = (v ?? '').toString().trim()
  return s ? s.slice(0, max) : null
}
const digitos = v => (v ?? '').toString().replace(/\D/g, '')
const tel10 = v => { const d = digitos(v); return d ? d.slice(-10) : null }
const entero = (v, min = null, max = null) => {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  if (min !== null && n < min) return min
  if (max !== null && n > max) return max
  return n
}
const fecha = v => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
// Colombia: 3001234567 → 573001234567. Ya con indicativo se deja.
const aWhatsapp = v => {
  const d = digitos(v)
  if (!d) return null
  if (d.length === 10 && d.startsWith('3')) return '57' + d
  return d
}

const ETAPAS = ['NUEVO', 'CONTACTADO', 'INTERESADO', 'REUNION', 'PROPUESTA', 'GANADO', 'PERDIDO']
// Probabilidad de cierre por etapa cuando el comercial no puso una a mano.
const PROB_ETAPA = { NUEVO: 5, CONTACTADO: 15, INTERESADO: 35, REUNION: 50, PROPUESTA: 70, GANADO: 100, PERDIDO: 0 }
const ESTADOS_TICKET = ['ABIERTO', 'EN_PROCESO', 'ESPERANDO_VET', 'RESUELTO', 'CERRADO']
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'URGENTE']
const TIPOS_TICKET = ['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION']
const CATEGORIAS_TICKET = ['COMISION', 'PAGO', 'FACTURACION', 'RECOGIDA', 'ENTREGA', 'CERTIFICADO',
  'RECORDATORIOS', 'ATENCION', 'PRECIOS', 'PLATAFORMA', 'OTRO']
const TIPOS_ACT = ['LLAMADA', 'WHATSAPP', 'VISITA', 'EMAIL', 'REUNION', 'NOTA', 'PLANTILLA', 'MATERIAL', 'SISTEMA']
const RESULTADOS = ['CONTESTO', 'NO_CONTESTO', 'OCUPADO', 'NUMERO_ERRADO', 'BUZON', 'INTERESADO',
  'NO_INTERESADO', 'VOLVER_A_LLAMAR', 'COMPROMISO', 'QUEJA', 'INFORMATIVO']
const TIPOS_SEG = ['LLAMADA', 'WHATSAPP', 'VISITA', 'REUNION', 'TAREA']
const FUENTES = ['MANUAL', 'IMPORTACION', 'REDES', 'WEB', 'PORTAL', 'REFERIDO', 'AGENTE', 'WHATSAPP', 'VISITA', 'OTRO']
const TIPOS_HITO = ['SERVICIOS_TOTAL', 'SERVICIOS_MES', 'PRIMER_SERVICIO', 'REACTIVACION']

const HOY_SQL = `(now() AT TIME ZONE 'America/Bogota')::date`

// ─── Configuración ──────────────────────────────────────────────────────────
const CONFIG_DEFECTO = {
  dias_enfriandose: 30, dias_en_riesgo: 60, dias_dormida: 90, dias_sin_gestion: 21,
  sla_horas: { URGENTE: 4, ALTA: 24, MEDIA: 48, BAJA: 96 },
}

export async function leerConfig() {
  const { rows } = await pool.query(`SELECT clave, valor FROM public.config_operativa WHERE modulo = 'CRM'`)
  const cfg = { ...CONFIG_DEFECTO, sla_horas: { ...CONFIG_DEFECTO.sla_horas } }
  for (const r of rows) {
    if (r.clave === 'sla_horas' && r.valor && typeof r.valor === 'object') Object.assign(cfg.sla_horas, r.valor)
    else if (r.clave in cfg && Number.isFinite(Number(r.valor))) cfg[r.clave] = Number(r.valor)
  }
  return cfg
}

/** La línea de veterinarias y su agente dueño: por donde sale todo lo del CRM. */
export async function lineaVeterinarias() {
  const { rows: [a] } = await pool.query(
    `SELECT id, phone_number_ids FROM public.agente_wa WHERE clave = 'VETERINARIAS'`)
  return { agenteId: a?.id ?? null, linea: (a?.phone_number_ids || [])[0] || null }
}

// ─── Métricas ───────────────────────────────────────────────────────────────
// Una sola consulta para toda la cartera. Los servicios CANCELADOS no cuentan:
// una clínica que mandó tres y se cancelaron no "manda servicios".
const SQL_CARTERA = `
WITH p AS (SELECT ${HOY_SQL} AS hoy),
s AS (
  SELECT s.aliado_origen_id AS aliado_id, s.fecha_ingreso AS f,
         COALESCE(s.valor_total, 0) AS valor, COALESCE(s.comision_aliado, 0) AS comision,
         CASE WHEN NOT COALESCE(s.comision_descontada, false)
              THEN GREATEST(COALESCE(s.comision_aliado,0) - COALESCE(s.comision_pagada,0), 0) ELSE 0 END AS com_pendiente
    FROM public.servicios s
   WHERE s.aliado_origen_id IS NOT NULL AND s.estado <> 'CANCELADO' AND s.fecha_ingreso IS NOT NULL
     AND ($1::uuid IS NULL OR s.aliado_origen_id = $1)
),
agg AS (
  SELECT s.aliado_id,
         count(*)::int                                                       AS total,
         count(*) FILTER (WHERE f >  p.hoy - 30)::int                        AS s30,
         count(*) FILTER (WHERE f >  p.hoy - 90)::int                        AS s90,
         count(*) FILTER (WHERE f <= p.hoy - 90 AND f > p.hoy - 180)::int    AS s90_180,
         count(*) FILTER (WHERE date_trunc('month', f) = date_trunc('month', p.hoy))::int AS mes_actual,
         count(*) FILTER (WHERE date_trunc('month', f) = date_trunc('month', p.hoy) - interval '1 month')::int AS mes_anterior,
         min(f) AS primero, max(f) AS ultimo,
         COALESCE(sum(valor) FILTER (WHERE f > p.hoy - 180), 0)::numeric   AS ingresos_180,
         COALESCE(sum(valor), 0)::numeric                                  AS ingresos_total,
         COALESCE(sum(comision) FILTER (WHERE f > p.hoy - 180), 0)::numeric AS comisiones_180,
         COALESCE(sum(com_pendiente), 0)::numeric                          AS comision_pendiente
    FROM s CROSS JOIN p GROUP BY s.aliado_id
),
act AS (
  SELECT aliado_id, max(realizado_en) AS ultima_gestion, count(*)::int AS gestiones
    FROM public.crm_actividades WHERE aliado_id IS NOT NULL AND tipo <> 'SISTEMA' GROUP BY aliado_id
),
seg AS (
  SELECT aliado_id, min(programado_para) AS proximo_seguimiento
    FROM public.crm_seguimientos WHERE aliado_id IS NOT NULL AND estado = 'PENDIENTE' GROUP BY aliado_id
),
tk AS (
  SELECT aliado_id, count(*)::int AS tickets_abiertos
    FROM public.crm_tickets WHERE estado NOT IN ('RESUELTO','CERRADO') GROUP BY aliado_id
)
SELECT a.id_aliado, a.nombre, a.ciudad, a.localidad, a.barrio, a.direccion, a.telefono, a.whatsapp,
       a.contacto_nombre, a.vip, a.activo, a.estado, a.modalidad_comision, a.comercial_id,
       a.horario, a.created_at, a.no_contactar, a.no_contactar_motivo, a.no_contactar_desde,
       TRIM(CONCAT_WS(' ', pc.nombre, pc.apellido)) AS comercial_nombre,
       COALESCE(agg.total, 0) AS total, COALESCE(agg.s30, 0) AS s30, COALESCE(agg.s90, 0) AS s90,
       COALESCE(agg.s90_180, 0) AS s90_180, COALESCE(agg.mes_actual, 0) AS mes_actual,
       COALESCE(agg.mes_anterior, 0) AS mes_anterior, agg.primero::text AS primero, agg.ultimo::text AS ultimo,
       COALESCE(agg.ingresos_180, 0) AS ingresos_180, COALESCE(agg.ingresos_total, 0) AS ingresos_total,
       COALESCE(agg.comisiones_180, 0) AS comisiones_180, COALESCE(agg.comision_pendiente, 0) AS comision_pendiente,
       (p.hoy - agg.ultimo)  AS dias_sin,
       (p.hoy - agg.primero) AS dias_desde_primero,
       act.ultima_gestion, COALESCE(act.gestiones, 0) AS gestiones,
       seg.proximo_seguimiento, COALESCE(tk.tickets_abiertos, 0) AS tickets_abiertos,
       (SELECT f.id FROM public.crm_fotos f WHERE f.aliado_id = a.id_aliado
         ORDER BY f.es_portada DESC, f.created_at DESC LIMIT 1) AS foto_id
  FROM public.aliados a
  CROSS JOIN p
  LEFT JOIN agg ON agg.aliado_id = a.id_aliado
  LEFT JOIN act ON act.aliado_id = a.id_aliado
  LEFT JOIN seg ON seg.aliado_id = a.id_aliado
  LEFT JOIN tk  ON tk.aliado_id  = a.id_aliado
  LEFT JOIN public.personal pc ON pc.id = a.comercial_id
 WHERE ($1::uuid IS NULL OR a.id_aliado = $1)
 ORDER BY a.nombre`

/**
 * De los conteos a lo que el comercial necesita leer.
 *
 * - `ritmo`: servicios/día, pesando el último trimestre el doble que el anterior.
 * - `probabilidad`: de que mande al menos un servicio en los próximos 30 días,
 *   como un proceso de Poisson con ese ritmo, castigado cuando lleva más del
 *   doble de su intervalo habitual sin mandar (ya no se comporta como antes).
 * - `riesgo`: cuánto se ha salido de su propio patrón — una vet que manda uno al
 *   mes y lleva 40 días no está igual que una que manda uno al día y lleva 40.
 */
export function calcularMetricas(r, cfg) {
  const total = Number(r.total) || 0
  const s90 = Number(r.s90) || 0
  const s90_180 = Number(r.s90_180) || 0
  const ritmo = (2 * s90 + s90_180) / 270
  const intervalo = ritmo > 0 ? 1 / ritmo : null
  const diasSin = r.ultimo ? Number(r.dias_sin) : null

  let p30 = ritmo > 0 ? 1 - Math.exp(-30 * ritmo) : (total ? 0.03 : 0)
  if (intervalo && diasSin > 2 * intervalo) p30 *= Math.max(0.15, (2 * intervalo) / diasSin)

  const variacion = s90_180 ? (s90 - s90_180) / s90_180 : (s90 ? 1 : 0)
  const tendencia = !s90 && !s90_180 ? 'SIN_DATOS'
    : variacion > 0.2 ? 'CRECE' : variacion < -0.2 ? 'CAE' : 'ESTABLE'

  let segmento
  if (!total) segmento = r.estado === 'pendiente_validacion' ? 'POR_VALIDAR' : 'SIN_SERVICIOS'
  else if (diasSin >= cfg.dias_dormida) segmento = 'DORMIDA'
  else if (diasSin >= cfg.dias_en_riesgo) segmento = 'EN_RIESGO'
  else if (diasSin >= cfg.dias_enfriandose) segmento = 'ENFRIANDOSE'
  else if (Number(r.dias_desde_primero) <= 30) segmento = 'NUEVA'
  else segmento = 'ACTIVA'

  const desvio = intervalo && diasSin !== null ? diasSin / Math.max(intervalo, 7) : null
  let riesgo = 'BAJO'
  if (segmento === 'DORMIDA' || segmento === 'EN_RIESGO' || (desvio !== null && desvio >= 3 && total >= 3)) riesgo = 'ALTO'
  else if (segmento === 'ENFRIANDOSE' || tendencia === 'CAE' || (desvio !== null && desvio >= 1.5)) riesgo = 'MEDIO'
  if (!total) riesgo = null

  let proximoEsperado = null
  if (intervalo && r.ultimo && ['ACTIVA', 'NUEVA', 'ENFRIANDOSE'].includes(segmento)) {
    const d = new Date(r.ultimo)
    d.setUTCDate(d.getUTCDate() + Math.round(intervalo))
    proximoEsperado = d.toISOString().slice(0, 10)
  }

  const diasSinGestion = r.ultima_gestion
    ? Math.floor((Date.now() - new Date(r.ultima_gestion).getTime()) / 86400000) : null

  return {
    segmento, riesgo, tendencia,
    variacion: Math.round(variacion * 100),
    probabilidad: Math.round(p30 * 100),
    promedio_mensual: Math.round((s90 / 3) * 10) / 10,
    intervalo_dias: intervalo ? Math.round(intervalo) : null,
    proximo_esperado: proximoEsperado,
    dias_sin_gestion: diasSinGestion,
    sin_contacto: diasSinGestion === null || diasSinGestion >= cfg.dias_sin_gestion,
  }
}

/** Pareto por volumen del último semestre: las que hacen el 80 % son "A". */
function clasificarABC(filas) {
  const vol = f => (Number(f.s90) || 0) + (Number(f.s90_180) || 0)
  const total = filas.reduce((a, f) => a + vol(f), 0)
  const orden = [...filas].filter(f => vol(f) > 0).sort((a, b) => vol(b) - vol(a))
  let acum = 0
  const clase = new Map()
  for (const f of orden) {
    acum += vol(f)
    const share = total ? acum / total : 1
    clase.set(f.id_aliado, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C')
  }
  return clase
}

export async function cartera() {
  const cfg = await leerConfig()
  const { rows } = await pool.query(SQL_CARTERA, [null])
  const abc = clasificarABC(rows)
  return rows.map(r => ({ ...r, ...calcularMetricas(r, cfg), clase: abc.get(r.id_aliado) || null }))
}

/**
 * El resumen que sale en cada ficha sin gastar IA: frases cortas armadas con
 * las cifras. El de IA es aparte y a pedido.
 */
function resumenDeterminista(f, extras = {}) {
  const out = []
  const n = v => Number(v) || 0
  if (!n(f.total)) {
    out.push(f.segmento === 'POR_VALIDAR'
      ? 'Se preregistró en el portal y todavía no está validada: no puede operar hasta aprobarla.'
      : 'Nunca ha enviado un servicio. Es una cuenta por activar.')
  } else {
    const ritmo = f.promedio_mensual >= 1
      ? `manda en promedio ${String(f.promedio_mensual).replace('.', ',')} servicios al mes`
      : f.intervalo_dias ? `manda más o menos uno cada ${f.intervalo_dias} días` : 'no ha mandado en el último semestre'
    out.push(`Lleva ${n(f.total)} servicios en total y ${ritmo}. El último fue hace ${n(f.dias_sin)} días.`)
    if (f.tendencia === 'CAE') out.push(`Va a la baja: ${f.variacion}% frente al trimestre anterior (${n(f.s90)} vs ${n(f.s90_180)}).`)
    if (f.tendencia === 'CRECE') out.push(`Va en crecimiento: +${f.variacion}% frente al trimestre anterior.`)
    if (f.segmento === 'DORMIDA') out.push('Está dormida: hay que reactivarla con una llamada o visita.')
    else if (f.segmento === 'EN_RIESGO') out.push('Está en riesgo de perderse: ya superó con creces su ritmo habitual.')
    else if (f.segmento === 'ENFRIANDOSE') out.push('Se está enfriando: buen momento para un contacto de cortesía.')
    else if (f.proximo_esperado) {
      const [y, mm, dd] = f.proximo_esperado.split('-').map(Number)
      const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
      const cuando = `${dd} de ${meses[mm - 1]}`
      // Si la fecha esperada ya pasó, decirlo así: "se espera el 11 de oct" un
      // 19 de oct se lee como un error y esconde lo importante (va atrasada).
      out.push(new Date(Date.UTC(y, mm - 1, dd)) < new Date(Date.now() - 86400000)
        ? `Por su ritmo ya debería haber mandado otro servicio (se esperaba hacia el ${cuando}).`
        : `Por su ritmo, el próximo servicio se espera hacia el ${cuando}.`)
    }
    out.push(`Probabilidad de que mande en los próximos 30 días: ${f.probabilidad}%.`)
  }
  if (n(f.comision_pendiente) > 0) {
    out.push(`Tiene $ ${Math.round(n(f.comision_pendiente)).toLocaleString('es-CO')} de comisión pendiente por pagarle.`)
  }
  if (n(f.tickets_abiertos)) out.push(`Tiene ${n(f.tickets_abiertos)} ticket(s) abierto(s)${extras.ticketPrincipal ? `: "${extras.ticketPrincipal}"` : ''}.`)
  if (extras.pqrsFamilias) out.push(`Sus familias han dejado ${extras.pqrsFamilias} PQR en los últimos 90 días.`)
  if (f.dias_sin_gestion === null) out.push('Nadie del área comercial la ha gestionado todavía.')
  else if (f.sin_contacto) out.push(`Última gestión comercial hace ${f.dias_sin_gestion} días.`)
  if (!f.horario || !Object.keys(f.horario || {}).length) out.push('Falta el horario en la ficha.')
  return out
}

export async function fichaAliado(id) {
  const aliadoId = uuid(id)
  if (!aliadoId) return { status: 400, body: { ok: false, error: 'Veterinaria inválida' } }

  const { rows: [a] } = await pool.query(
    `SELECT a.*, te.nombre AS tipo_establecimiento,
            TRIM(CONCAT_WS(' ', pc.nombre, pc.apellido)) AS comercial_nombre,
            TRIM(CONCAT_WS(' ', pf.nombre, pf.apellido)) AS ficha_actualizada_por_nombre
       FROM public.aliados a
       LEFT JOIN public.tipo_establecimiento te ON te.id = a.tipo_establecimiento_id
       LEFT JOIN public.personal pc ON pc.id = a.comercial_id
       LEFT JOIN public.personal pf ON pf.id = a.ficha_actualizada_por
      WHERE a.id_aliado = $1`, [aliadoId])
  if (!a) return { status: 404, body: { ok: false, error: 'No existe esa veterinaria' } }
  // El enlace personal es la credencial de la clínica: se entrega armado, para
  // reenviárselo, pero el token suelto no viaja.
  const enlacePortal = a.token_acceso && a.estado === 'activo'
    ? `${APP_URL}/#/aliado?c=${encodeURIComponent(a.token_acceso)}` : null
  delete a.token_acceso

  const todas = await cartera()
  const m = todas.find(r => r.id_aliado === aliadoId) || {}

  const [serie, planes, servicios, actividades, seguimientos, tickets, fotos, pqrs, conv, prospecto, contactos] = await Promise.all([
    pool.query(
      `WITH meses AS (
         SELECT generate_series(date_trunc('month', ${HOY_SQL}) - interval '11 months',
                                date_trunc('month', ${HOY_SQL}), interval '1 month')::date AS mes)
       SELECT to_char(meses.mes, 'YYYY-MM') AS mes,
              count(s.id)::int AS servicios,
              COALESCE(sum(s.valor_total), 0)::numeric AS valor
         FROM meses
         LEFT JOIN public.servicios s ON s.aliado_origen_id = $1 AND s.estado <> 'CANCELADO'
              AND date_trunc('month', s.fecha_ingreso) = meses.mes
        GROUP BY meses.mes ORDER BY meses.mes`, [aliadoId]),
    pool.query(
      `SELECT COALESCE(pl.nombre, 'Sin plan') AS plan, count(*)::int AS n
         FROM public.servicios s LEFT JOIN public.planes pl ON pl.id = s.plan_id
        WHERE s.aliado_origen_id = $1 AND s.estado <> 'CANCELADO'
          AND s.fecha_ingreso > ${HOY_SQL} - 180
        GROUP BY 1 ORDER BY 2 DESC`, [aliadoId]),
    pool.query(
      `SELECT s.id, s.fecha_ingreso::text AS fecha_ingreso, s.estado, s.estado_pago, s.valor_total, s.comision_aliado,
              s.comision_descontada, s.comision_pagada, pl.nombre AS plan, m.nombre AS mascota,
              e.nombre AS especie, TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS cliente
         FROM public.servicios s
         LEFT JOIN public.planes pl ON pl.id = s.plan_id
         LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
         LEFT JOIN public.especies e ON e.id = m.especie_id
         LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
        WHERE s.aliado_origen_id = $1
        ORDER BY s.fecha_ingreso DESC NULLS LAST, s.created_at DESC
        LIMIT 60`, [aliadoId]),
    pool.query(
      `SELECT x.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS autor
         FROM public.crm_actividades x LEFT JOIN public.personal p ON p.id = x.realizado_por
        WHERE x.aliado_id = $1 ORDER BY x.realizado_en DESC LIMIT 100`, [aliadoId]),
    pool.query(
      `SELECT x.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS responsable
         FROM public.crm_seguimientos x LEFT JOIN public.personal p ON p.id = x.responsable_id
        WHERE x.aliado_id = $1 ORDER BY (x.estado = 'PENDIENTE') DESC, x.programado_para DESC LIMIT 50`, [aliadoId]),
    pool.query(
      `SELECT t.id, t.numero, t.tipo, t.categoria, t.prioridad, t.estado, t.asunto, t.vence_en, t.created_at
         FROM public.crm_tickets t WHERE t.aliado_id = $1 ORDER BY t.created_at DESC LIMIT 50`, [aliadoId]),
    pool.query(
      `SELECT id, descripcion, es_portada, mime, bytes, created_at
         FROM public.crm_fotos WHERE aliado_id = $1 ORDER BY es_portada DESC, created_at DESC`, [aliadoId]),
    pool.query(
      `SELECT q.id, q.tipo, q.canal, q.descripcion, q.created_at, m.nombre AS mascota
         FROM public.pqrs q JOIN public.servicios s ON s.id = q.servicio_id
         LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
        WHERE s.aliado_origen_id = $1 ORDER BY q.created_at DESC LIMIT 30`, [aliadoId]),
    pool.query(
      `SELECT contacto, phone_number_id, ultimo_mensaje_en, ultimo_entrante_en, ventana_abierta, sin_leer, ultimo_texto
         FROM public.v_whatsapp_conversaciones
        -- Solo la línea de veterinarias: la misma clínica también recibe por la
        -- de familias (recibos, digitales) y esa no es del área comercial.
        WHERE aliado_id = $1 AND phone_number_id = (SELECT (phone_number_ids)[1] FROM public.agente_wa WHERE clave = 'VETERINARIAS')
        ORDER BY ultimo_mensaje_en DESC NULLS LAST LIMIT 3`, [aliadoId]).catch(() => ({ rows: [] })),
    pool.query(`SELECT id, numero, etapa, fuente, created_at FROM public.crm_prospectos WHERE aliado_id = $1 LIMIT 1`, [aliadoId]),
    pool.query(`SELECT id, nombre, rol, telefono, whatsapp, email, notas, principal, created_at
                  FROM public.crm_aliado_contactos WHERE aliado_id = $1 ORDER BY principal DESC, created_at`, [aliadoId])
      .catch(() => ({ rows: [] })),
  ])

  const pqrs90 = pqrs.rows.filter(q => Date.now() - new Date(q.created_at).getTime() < 90 * 86400000).length
  const abiertos = tickets.rows.filter(t => !['RESUELTO', 'CERRADO'].includes(t.estado))
  const metricas = { ...m, horario: a.horario }

  return {
    status: 200,
    body: {
      ok: true,
      aliado: a,
      metricas: m,
      resumen: resumenDeterminista(metricas, { pqrsFamilias: pqrs90, ticketPrincipal: abiertos[0]?.asunto }),
      serie: serie.rows,
      planes: planes.rows,
      servicios: servicios.rows,
      actividades: actividades.rows,
      seguimientos: seguimientos.rows,
      tickets: tickets.rows,
      fotos: fotos.rows,
      pqrs: pqrs.rows,
      conversaciones: conv.rows,
      prospecto: prospecto.rows[0] || null,
      contactos: contactos.rows,
      enlace_portal: enlacePortal,
    },
  }
}

// ─── Contactos por veterinaria ────────────────────────────────────────────────
const ROLES_CONTACTO = ['DUENO', 'ADMINISTRADOR', 'AUXILIAR', 'ENCARGADO', 'OTRO']

export async function crearContacto(aliadoId, d) {
  const aid = uuid(aliadoId)
  if (!aid) return { status: 400, body: { ok: false, error: 'Veterinaria inválida' } }
  if (!d.nombre?.trim()) return { status: 400, body: { ok: false, error: 'Falta el nombre' } }
  const rol = ROLES_CONTACTO.includes(d.rol) ? d.rol : 'OTRO'

  if (d.principal) {
    await pool.query(`UPDATE public.crm_aliado_contactos SET principal = false WHERE aliado_id = $1`, [aid])
  }
  const { rows: [c] } = await pool.query(
    `INSERT INTO public.crm_aliado_contactos (aliado_id, nombre, rol, telefono, whatsapp, email, notas, principal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [aid, d.nombre.trim(), rol, d.telefono || null, d.whatsapp || null, d.email || null, d.notas || null, !!d.principal])
  return { ok: true, contacto: c }
}

export async function actualizarContacto(id, d) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'ID inválido' } }
  const { rows: [exist] } = await pool.query(`SELECT aliado_id FROM public.crm_aliado_contactos WHERE id = $1`, [cid])
  if (!exist) return { status: 404, body: { ok: false, error: 'No existe' } }

  if (d.principal) {
    await pool.query(`UPDATE public.crm_aliado_contactos SET principal = false WHERE aliado_id = $1 AND id <> $2`, [exist.aliado_id, cid])
  }
  const campos = [], vals = []
  let i = 1
  for (const [k, v] of Object.entries({ nombre: d.nombre, rol: d.rol, telefono: d.telefono, whatsapp: d.whatsapp, email: d.email, notas: d.notas, principal: d.principal })) {
    if (v !== undefined) { campos.push(`${k} = $${i++}`); vals.push(k === 'rol' && !ROLES_CONTACTO.includes(v) ? 'OTRO' : v) }
  }
  if (!campos.length) return { ok: true }
  campos.push(`updated_at = now()`)
  vals.push(cid)
  const { rows: [c] } = await pool.query(`UPDATE public.crm_aliado_contactos SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`, vals)
  return { ok: true, contacto: c }
}

export async function borrarContacto(id) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'ID inválido' } }
  await pool.query(`DELETE FROM public.crm_aliado_contactos WHERE id = $1`, [cid])
  return { ok: true }
}

// Lo que se puede editar de la ficha desde el CRM. `token_acceso`, comisión y
// estado NO: esos son de coordinación y tienen sus propios flujos.
const CAMPOS_FICHA = {
  nombre: v => txt(v, 120), identificacion_nit: v => txt(v, 30), email: v => txt(v, 120),
  telefono: v => txt(digitos(v), 20), whatsapp: v => txt(aWhatsapp(v), 20),
  telefono_2: v => txt(digitos(v), 20), contacto_nombre: v => txt(v, 80),
  contacto_cargo: v => txt(v, 80), contacto_email: v => txt(v, 120),
  contacto_2_nombre: v => txt(v, 80), contacto_2_telefono: v => txt(digitos(v), 20),
  ciudad: v => txt(v, 80), localidad: v => txt(v, 80), barrio: v => txt(v, 80),
  direccion: v => txt(v, 300), referencia_ubicacion: v => txt(v, 300),
  instagram: v => txt(v, 120), sitio_web: v => txt(v, 200),
  numero_sedes: v => txt(v, 10), num_veterinarios: v => entero(v, 0, 999),
  atiende_24h: v => !!v,
  servicios_clinica: v => (Array.isArray(v) ? v.map(x => txt(x, 60)).filter(Boolean).slice(0, 30) : []),
  tipo_establecimiento_id: v => entero(v, 1),
  horario: v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
  lat: v => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null),
  lng: v => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null),
  comercial_id: v => uuid(v), notas_comerciales: v => txt(v, 4000),
}

export async function actualizarFicha(id, datos = {}, personalId) {
  const aliadoId = uuid(id)
  if (!aliadoId) return { status: 400, body: { ok: false, error: 'Veterinaria inválida' } }
  const sets = []
  const vals = []
  for (const [k, limpiar] of Object.entries(CAMPOS_FICHA)) {
    if (!(k in datos)) continue
    const v = limpiar(datos[k])
    if (k === 'nombre' && !v) return { status: 422, body: { ok: false, error: 'El nombre no puede quedar vacío' } }
    vals.push(k === 'horario' ? JSON.stringify(v) : v)
    sets.push(`${k} = $${vals.length}${k === 'horario' ? '::jsonb' : ''}`)
  }
  if (!sets.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }
  vals.push(personalId, aliadoId)
  const { rowCount } = await pool.query(
    `UPDATE public.aliados SET ${sets.join(', ')}, ficha_actualizada_en = now(),
            ficha_actualizada_por = $${vals.length - 1}, updated_at = now()
      WHERE id_aliado = $${vals.length}`, vals)
  if (!rowCount) return { status: 404, body: { ok: false, error: 'No existe esa veterinaria' } }
  return { status: 200, body: { ok: true } }
}

export async function borrarAliado(id) {
  const aliadoId = uuid(id)
  if (!aliadoId) return { status: 400, body: { ok: false, error: 'Veterinaria inválida' } }
  const { rowCount } = await pool.query(
    `UPDATE public.aliados SET estado = 'inactivo', updated_at = now()
      WHERE id_aliado = $1 AND estado != 'inactivo'`, [aliadoId])
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Veterinaria no encontrada o ya está inactiva' } }
  return { status: 200, body: { ok: true } }
}

// ─── Resumen general (tablero de inicio) ────────────────────────────────────
export async function resumenGeneral(personal) {
  const filas = await cartera()
  const porSegmento = {}
  for (const f of filas) porSegmento[f.segmento] = (porSegmento[f.segmento] || 0) + 1

  const [embudo, segs, tks, hitos, fuentes, recientes] = await Promise.all([
    pool.query(
      `SELECT etapa, count(*)::int AS n, COALESCE(sum(potencial_mensual), 0)::int AS potencial,
              COALESCE(sum(potencial_mensual * COALESCE(probabilidad,
                CASE etapa WHEN 'NUEVO' THEN 5 WHEN 'CONTACTADO' THEN 15 WHEN 'INTERESADO' THEN 35
                           WHEN 'REUNION' THEN 50 WHEN 'PROPUESTA' THEN 70 WHEN 'GANADO' THEN 100 ELSE 0 END) / 100.0), 0)::numeric AS ponderado
         FROM public.crm_prospectos GROUP BY etapa`),
    pool.query(
      `SELECT count(*) FILTER (WHERE programado_para < date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')::int AS vencidos,
              count(*) FILTER (WHERE (programado_para AT TIME ZONE 'America/Bogota')::date = ${HOY_SQL})::int AS hoy,
              count(*) FILTER (WHERE (programado_para AT TIME ZONE 'America/Bogota')::date BETWEEN ${HOY_SQL} + 1 AND ${HOY_SQL} + 7)::int AS semana
         FROM public.crm_seguimientos WHERE estado = 'PENDIENTE'
          AND ($1::uuid IS NULL OR responsable_id = $1 OR responsable_id IS NULL)`,
      [personal?.rol === 'COMERCIAL' ? personal.id : null]),
    pool.query(
      `SELECT count(*) FILTER (WHERE estado NOT IN ('RESUELTO','CERRADO'))::int AS abiertos,
              count(*) FILTER (WHERE estado NOT IN ('RESUELTO','CERRADO') AND vence_en < now())::int AS vencidos,
              count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS ultimos_30
         FROM public.crm_tickets`),
    pool.query(`SELECT count(*)::int AS n FROM public.crm_hitos_envios WHERE estado = 'PROPUESTO'`),
    pool.query(`SELECT fuente, count(*)::int AS n FROM public.crm_prospectos GROUP BY fuente ORDER BY 2 DESC`),
    pool.query(
      `SELECT x.id, x.tipo, x.resultado, x.resumen, x.realizado_en, x.aliado_id, x.prospecto_id,
              COALESCE(a.nombre, pr.nombre) AS nombre, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS autor
         FROM public.crm_actividades x
         LEFT JOIN public.aliados a ON a.id_aliado = x.aliado_id
         LEFT JOIN public.crm_prospectos pr ON pr.id = x.prospecto_id
         LEFT JOIN public.personal p ON p.id = x.realizado_por
        ORDER BY x.realizado_en DESC LIMIT 12`),
  ])

  const sum = (k) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0)
  const caidas = filas
    .filter(f => !f.no_contactar && (Number(f.s90_180) || 0) >= 3 && f.tendencia === 'CAE')
    .sort((a, b) => (a.s90 - a.s90_180) - (b.s90 - b.s90_180))
    .slice(0, 8)
  const enRiesgo = filas
    .filter(f => !f.no_contactar && f.riesgo === 'ALTO' && f.segmento !== 'DORMIDA')
    .sort((a, b) => (Number(b.s90_180) + Number(b.s90)) - (Number(a.s90_180) + Number(a.s90)))
    .slice(0, 8)
  const top = [...filas].sort((a, b) => b.mes_actual - a.mes_actual || b.s90 - a.s90).slice(0, 8)
  const recorte = f => ({
    id_aliado: f.id_aliado, nombre: f.nombre, localidad: f.localidad, s90: f.s90, s90_180: f.s90_180,
    mes_actual: f.mes_actual, dias_sin: f.dias_sin, segmento: f.segmento, tendencia: f.tendencia,
    variacion: f.variacion, probabilidad: f.probabilidad, clase: f.clase,
  })

  return {
    status: 200,
    body: {
      ok: true,
      cartera: {
        total: filas.length,
        con_servicios: filas.filter(f => Number(f.total) > 0).length,
        por_segmento: porSegmento,
        servicios_mes: sum('mes_actual'),
        servicios_mes_anterior: sum('mes_anterior'),
        // Lo que se espera en 30 días sumando la probabilidad de cada una.
        activas_esperadas_30: Math.round(filas.reduce((a, f) => a + f.probabilidad / 100, 0)),
        sin_contacto: filas.filter(f => !f.no_contactar && f.sin_contacto && Number(f.total) > 0).length,
        no_contactar: filas.filter(f => f.no_contactar).length,
        comision_pendiente: sum('comision_pendiente'),
      },
      embudo: embudo.rows,
      fuentes: fuentes.rows,
      seguimientos: segs.rows[0],
      tickets: tks.rows[0],
      hitos_por_enviar: hitos.rows[0]?.n || 0,
      caidas: caidas.map(recorte),
      en_riesgo: enRiesgo.map(recorte),
      top: top.map(recorte),
      actividad_reciente: recientes.rows,
    },
  }
}

// ─── Prospectos ─────────────────────────────────────────────────────────────
const CAMPOS_PROSPECTO = {
  nombre: v => txt(v, 160), contacto_nombre: v => txt(v, 120), contacto_cargo: v => txt(v, 80),
  telefono: v => txt(digitos(v), 20), whatsapp: v => txt(aWhatsapp(v), 20), email: v => txt(v, 160),
  ciudad: v => txt(v, 80), localidad: v => txt(v, 80), barrio: v => txt(v, 80), direccion: v => txt(v, 300),
  instagram: v => txt(v, 160), sitio_web: v => txt(v, 200), fuente_detalle: v => txt(v, 200),
  tipo_establecimiento_id: v => entero(v, 1),
  potencial_mensual: v => entero(v, 0, 999), probabilidad: v => entero(v, 0, 100),
  responsable_id: v => uuid(v), notas: v => txt(v, 4000),
}

export async function listarProspectos({ etapa = null, q = null } = {}) {
  const { rows } = await pool.query(
    `SELECT p.*, TRIM(CONCAT_WS(' ', r.nombre, r.apellido)) AS responsable,
            te.nombre AS tipo_establecimiento,
            (SELECT min(s.programado_para) FROM public.crm_seguimientos s
              WHERE s.prospecto_id = p.id AND s.estado = 'PENDIENTE') AS proximo_seguimiento,
            (SELECT count(*)::int FROM public.crm_actividades a WHERE a.prospecto_id = p.id) AS gestiones,
            a.nombre AS aliado_nombre
       FROM public.crm_prospectos p
       LEFT JOIN public.personal r ON r.id = p.responsable_id
       LEFT JOIN public.tipo_establecimiento te ON te.id = p.tipo_establecimiento_id
       LEFT JOIN public.aliados a ON a.id_aliado = p.aliado_id
      WHERE ($1::text IS NULL OR p.etapa = $1)
        AND ($2::text IS NULL OR p.nombre ILIKE '%' || $2 || '%' OR p.contacto_nombre ILIKE '%' || $2 || '%'
             OR p.localidad ILIKE '%' || $2 || '%' OR p.ciudad ILIKE '%' || $2 || '%'
             OR public.wa_tel10(p.whatsapp) LIKE '%' || $2 || '%' OR public.wa_tel10(p.telefono) LIKE '%' || $2 || '%')
      ORDER BY p.orden, p.created_at DESC`,
    [ETAPAS.includes(etapa) ? etapa : null, txt(q, 80)])
  return rows.map(p => ({ ...p, probabilidad_efectiva: p.probabilidad ?? PROB_ETAPA[p.etapa] }))
}

/** ¿Ya existe? Por teléfono (aliados y prospectos) y por nombre normalizado. */
async function buscarDuplicado(client, { nombre, telefono, whatsapp, excluir = null }) {
  const tels = [tel10(telefono), tel10(whatsapp)].filter(t => t && t.length === 10)
  if (tels.length) {
    const { rows: [al] } = await client.query(
      `SELECT id_aliado, nombre, no_contactar FROM public.aliados
        WHERE public.wa_tel10(whatsapp) = ANY($1) OR public.wa_tel10(telefono) = ANY($1) OR public.wa_tel10(telefono_2) = ANY($1)
        LIMIT 1`, [tels])
    if (al) return { tipo: 'ALIADO', id: al.id_aliado, nombre: al.nombre, no_contactar: al.no_contactar }
    const { rows: [pr] } = await client.query(
      `SELECT id, nombre, no_contactar FROM public.crm_prospectos
        WHERE (public.wa_tel10(whatsapp) = ANY($1) OR public.wa_tel10(telefono) = ANY($1))
          AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`, [tels, excluir])
    if (pr) return { tipo: 'PROSPECTO', id: pr.id, nombre: pr.nombre, no_contactar: pr.no_contactar }
  }
  if (nombre) {
    const { rows: [pr] } = await client.query(
      `SELECT id, nombre FROM public.crm_prospectos
        WHERE lower(trim(nombre)) = lower(trim($1)) AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
      [nombre, excluir])
    if (pr) return { tipo: 'PROSPECTO', id: pr.id, nombre: pr.nombre }
    const { rows: [al] } = await client.query(
      `SELECT id_aliado, nombre FROM public.aliados WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1`, [nombre])
    if (al) return { tipo: 'ALIADO', id: al.id_aliado, nombre: al.nombre }
  }
  return null
}

export async function crearProspecto(datos = {}, personalId, { fuente = 'MANUAL', importacionId = null, client = pool, permitirDuplicado = false } = {}) {
  const limpio = {}
  for (const [k, f] of Object.entries(CAMPOS_PROSPECTO)) if (k in datos) limpio[k] = f(datos[k])
  if (!limpio.nombre) return { status: 422, body: { ok: false, error: 'Falta el nombre de la veterinaria' } }
  if (!permitirDuplicado) {
    const dup = await buscarDuplicado(client, limpio)
    if (dup) {
      return { status: 409, body: { ok: false, error: dup.tipo === 'ALIADO'
        ? `Ya es aliada: "${dup.nombre}"` : `Ya está como prospecto: "${dup.nombre}"`, duplicado: dup } }
    }
  }
  const extra = datos.datos && typeof datos.datos === 'object' ? datos.datos : {}
  const cols = Object.keys(limpio)
  const vals = cols.map(k => limpio[k])
  vals.push(FUENTES.includes(fuente) ? fuente : 'OTRO', importacionId, JSON.stringify(extra), personalId || null)
  const { rows: [p] } = await client.query(
    `INSERT INTO public.crm_prospectos (${cols.join(', ')}, fuente, importacion_id, datos, creado_por, orden)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 2},
             $${cols.length + 3}::jsonb, $${cols.length + 4},
             COALESCE((SELECT min(orden) - 1 FROM public.crm_prospectos WHERE etapa = 'NUEVO'), 0))
     RETURNING *`, vals)
  return { status: 201, body: { ok: true, prospecto: p } }
}

export async function actualizarProspecto(id, datos = {}) {
  const pid = uuid(id)
  if (!pid) return { status: 400, body: { ok: false, error: 'Prospecto inválido' } }
  const sets = []; const vals = []
  for (const [k, f] of Object.entries(CAMPOS_PROSPECTO)) {
    if (!(k in datos)) continue
    const v = f(datos[k])
    if (k === 'nombre' && !v) return { status: 422, body: { ok: false, error: 'El nombre no puede quedar vacío' } }
    vals.push(v); sets.push(`${k} = $${vals.length}`)
  }
  if (!sets.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }
  vals.push(pid)
  const { rows: [p] } = await pool.query(
    `UPDATE public.crm_prospectos SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
  if (!p) return { status: 404, body: { ok: false, error: 'No existe ese prospecto' } }
  return { status: 200, body: { ok: true, prospecto: p } }
}

/** Arrastrar en el Kanban: cambia etapa y/o posición. */
export async function moverProspecto(id, { etapa, orden, motivo_perdida } = {}, personalId) {
  const pid = uuid(id)
  if (!pid) return { status: 400, body: { ok: false, error: 'Prospecto inválido' } }
  if (!ETAPAS.includes(etapa)) return { status: 400, body: { ok: false, error: 'Etapa inválida' } }
  const { rows: [antes] } = await pool.query(`SELECT etapa, aliado_id FROM public.crm_prospectos WHERE id = $1`, [pid])
  if (!antes) return { status: 404, body: { ok: false, error: 'No existe ese prospecto' } }
  if (etapa === 'PERDIDO' && !txt(motivo_perdida)) {
    return { status: 422, body: { ok: false, error: 'Para marcarlo perdido escribe el motivo' } }
  }
  if (etapa === 'GANADO' && !antes.aliado_id) {
    return { status: 422, body: { ok: false, error: 'Para ganarlo conviértelo en veterinaria (botón "Convertir en aliada")' } }
  }
  await pool.query(
    `UPDATE public.crm_prospectos
        SET etapa = $2, orden = COALESCE($3, orden),
            motivo_perdida = CASE WHEN $2 = 'PERDIDO' THEN $4 ELSE motivo_perdida END,
            etapa_desde = CASE WHEN etapa <> $2 THEN now() ELSE etapa_desde END
      WHERE id = $1`, [pid, etapa, Number.isFinite(Number(orden)) ? Number(orden) : null, txt(motivo_perdida, 500)])
  if (antes.etapa !== etapa) {
    await pool.query(
      `INSERT INTO public.crm_actividades (prospecto_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, 'SISTEMA', $2, 'SISTEMA', $3)`,
      [pid, `Etapa: ${antes.etapa} → ${etapa}${etapa === 'PERDIDO' ? ` (${txt(motivo_perdida, 200)})` : ''}`, personalId])
  }
  return { status: 200, body: { ok: true } }
}

const generarToken = nombre => {
  const slug = (nombre || 'aliado').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'aliado'
  return `${slug}-${crypto.randomBytes(4).toString('hex')}`
}

/**
 * Ganar un prospecto = que exista como veterinaria. Si ya existía (mismo
 * teléfono), se ata a esa en vez de duplicarla. La nueva nace ACTIVA con su
 * enlace personal: quien la convierte es el área comercial, que ya la validó.
 */
export async function convertirProspecto(id, datos = {}, personalId) {
  const pid = uuid(id)
  if (!pid) return { status: 400, body: { ok: false, error: 'Prospecto inválido' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [p] } = await client.query(`SELECT * FROM public.crm_prospectos WHERE id = $1 FOR UPDATE`, [pid])
    if (!p) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'No existe ese prospecto' } } }
    let aliadoId = uuid(datos.aliado_id) || p.aliado_id
    if (!aliadoId) {
      const dup = await buscarDuplicado(client, { telefono: p.telefono, whatsapp: p.whatsapp })
      if (dup?.tipo === 'ALIADO') aliadoId = dup.id
    }
    let creada = false
    if (!aliadoId) {
      const { rows: [a] } = await client.query(
        `INSERT INTO public.aliados
           (nombre, contacto_nombre, telefono, whatsapp, email, ciudad, localidad, barrio, direccion,
            instagram, sitio_web, contacto_cargo, tipo_establecimiento_id, modalidad_comision,
            estado, activo, token_acceso, validado_por, validado_at, comercial_id, notas_comerciales)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'activo',true,$15,$16,now(),$17,$18)
         RETURNING id_aliado`,
        [p.nombre.slice(0, 120), p.contacto_nombre?.slice(0, 80) || null, p.telefono?.slice(0, 20) || null,
         (p.whatsapp || aWhatsapp(p.telefono))?.slice(0, 20) || null, p.email?.slice(0, 120) || null,
         p.ciudad?.slice(0, 80) || null, p.localidad?.slice(0, 80) || null, p.barrio?.slice(0, 80) || null, p.direccion, p.instagram, p.sitio_web, p.contacto_cargo,
         p.tipo_establecimiento_id,
         ['DESCUENTO_INMEDIATO', 'FACTURACION_MENSUAL'].includes(datos.modalidad_comision) ? datos.modalidad_comision : 'DESCUENTO_INMEDIATO',
         generarToken(p.nombre), personalId, p.responsable_id || personalId, p.notas])
      aliadoId = a.id_aliado
      creada = true
      // Las fotos del prospecto pasan a la ficha.
      await client.query(`UPDATE public.crm_fotos SET aliado_id = $1 WHERE prospecto_id = $2`, [aliadoId, pid])
    }
    await client.query(
      `UPDATE public.crm_prospectos SET etapa = 'GANADO', aliado_id = $2, etapa_desde = now() WHERE id = $1`, [pid, aliadoId])
    // El historial de gestiones acompaña a la veterinaria.
    await client.query(`UPDATE public.crm_actividades SET aliado_id = $1 WHERE prospecto_id = $2 AND aliado_id IS NULL`, [aliadoId, pid])
    await client.query(`UPDATE public.crm_seguimientos SET aliado_id = $1 WHERE prospecto_id = $2 AND aliado_id IS NULL`, [aliadoId, pid])
    await client.query(
      `INSERT INTO public.crm_actividades (aliado_id, prospecto_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, $2, 'SISTEMA', $3, 'SISTEMA', $4)`,
      [aliadoId, pid, creada ? 'Prospecto ganado: se creó la veterinaria aliada' : 'Prospecto ganado: atado a la veterinaria existente', personalId])
    await client.query('COMMIT')
    const { rows: [a] } = await pool.query(`SELECT token_acceso FROM public.aliados WHERE id_aliado = $1`, [aliadoId])
    return {
      status: 200,
      body: { ok: true, aliado_id: aliadoId, creada,
              enlace: a?.token_acceso ? `${APP_URL}/#/aliado?c=${encodeURIComponent(a.token_acceso)}` : null },
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Importa filas ya mapeadas por el navegador (que lee el CSV/Excel). Cada fila
 * trae los campos de `CAMPOS_PROSPECTO` y, en `datos`, lo que no tuvo casilla.
 * Los duplicados NO se crean: se cuentan y se devuelven para revisarlos.
 */
export async function importarProspectos({ filas = [], nombreArchivo = null, fuente = 'IMPORTACION', fuenteDetalle = null, responsableId = null }, personalId) {
  if (!Array.isArray(filas) || !filas.length) return { status: 400, body: { ok: false, error: 'El archivo no trae filas' } }
  if (filas.length > 5000) return { status: 413, body: { ok: false, error: 'Máximo 5.000 filas por importación' } }
  const client = await pool.connect()
  const resultado = { creadas: 0, duplicadas: [], errores: [] }
  try {
    await client.query('BEGIN')
    const { rows: [imp] } = await client.query(
      `INSERT INTO public.crm_importaciones (nombre_archivo, fuente, fuente_detalle, filas_total, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [txt(nombreArchivo, 200), FUENTES.includes(fuente) ? fuente : 'IMPORTACION', txt(fuenteDetalle, 200), filas.length, personalId])
    for (let i = 0; i < filas.length; i++) {
      const f = { ...filas[i], fuente_detalle: filas[i]?.fuente_detalle || fuenteDetalle, responsable_id: filas[i]?.responsable_id || responsableId }
      await client.query('SAVEPOINT fila')
      try {
        const r = await crearProspecto(f, personalId, { fuente: FUENTES.includes(fuente) ? fuente : 'IMPORTACION', importacionId: imp.id, client })
        if (r.status === 201) resultado.creadas++
        else if (r.status === 409) resultado.duplicadas.push({ fila: i + 1, nombre: f.nombre, con: r.body.duplicado })
        else resultado.errores.push({ fila: i + 1, nombre: f.nombre || '', error: r.body.error })
        await client.query('RELEASE SAVEPOINT fila')
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT fila')
        resultado.errores.push({ fila: i + 1, nombre: f.nombre || '', error: e.message.slice(0, 160) })
      }
    }
    await client.query(
      `UPDATE public.crm_importaciones SET creadas = $2, duplicadas = $3, con_error = $4 WHERE id = $1`,
      [imp.id, resultado.creadas, resultado.duplicadas.length, resultado.errores.length])
    await client.query('COMMIT')
    log(MOD, `importación ${imp.id}: ${resultado.creadas} creadas, ${resultado.duplicadas.length} duplicadas, ${resultado.errores.length} con error`)
    return { status: 200, body: { ok: true, importacion_id: imp.id, ...resultado } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Prospectos que llegan solos: formularios web, anuncios de Facebook/Instagram
 * conectados con Make/Zapier, landing pages. Autentica con un token compartido
 * (`CRM_LEADS_TOKEN` en el .env). Acepta nombres de campo comunes en español e
 * inglés para no obligar a armar el JSON exacto.
 */
export async function recibirLead(cuerpo = {}, token) {
  const esperado = process.env.CRM_LEADS_TOKEN
  if (!esperado || !token || token.length !== esperado.length
      || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado))) {
    return { status: 401, body: { ok: false, error: 'No autorizado' } }
  }
  const b = cuerpo || {}
  const pick = (...ks) => { for (const k of ks) if (b[k] != null && String(b[k]).trim()) return b[k]; return null }
  const datos = {
    nombre: pick('nombre', 'veterinaria', 'clinica', 'company', 'company_name', 'empresa', 'full_name', 'name'),
    contacto_nombre: pick('contacto', 'contacto_nombre', 'full_name', 'name', 'first_name'),
    telefono: pick('telefono', 'phone', 'phone_number', 'celular'),
    whatsapp: pick('whatsapp', 'phone_number', 'phone', 'celular'),
    email: pick('email', 'correo'),
    ciudad: pick('ciudad', 'city'),
    localidad: pick('localidad', 'barrio_localidad'),
    direccion: pick('direccion', 'address', 'street_address'),
    notas: pick('mensaje', 'message', 'comentarios', 'notas'),
    fuente_detalle: pick('fuente_detalle', 'campaign_name', 'campana', 'form_name', 'ad_name') || 'Lead entrante',
  }
  const fuente = String(pick('fuente', 'source') || 'REDES').toUpperCase()
  const otros = { ...b }
  delete otros.token
  datos.datos = otros
  const r = await crearProspecto(datos, null, { fuente: FUENTES.includes(fuente) ? fuente : 'REDES' })
  if (r.status === 409) {
    // Ya lo teníamos: se anota que volvió a escribir en vez de perder el lead.
    const d = r.body.duplicado
    await pool.query(
      `INSERT INTO public.crm_actividades (${d.tipo === 'ALIADO' ? 'aliado_id' : 'prospecto_id'}, tipo, resumen, origen)
       VALUES ($1, 'SISTEMA', $2, 'SISTEMA')`,
      [d.id, `Volvió a llegar como lead (${datos.fuente_detalle}). ${datos.notas || ''}`.slice(0, 1000)])
    return { status: 200, body: { ok: true, duplicado: true } }
  }
  if (r.status === 201) log(MOD, `lead entrante: ${r.body.prospecto.nombre}`)
  return { status: r.status === 201 ? 201 : r.status, body: { ok: r.status === 201, error: r.body.error } }
}

// ─── Gestiones ──────────────────────────────────────────────────────────────
export async function registrarActividad(d = {}, personalId, { origen = 'MANUAL' } = {}) {
  const aliadoId = uuid(d.aliado_id)
  const prospectoId = uuid(d.prospecto_id)
  if (!aliadoId && !prospectoId) return { status: 400, body: { ok: false, error: 'Falta la veterinaria o el prospecto' } }
  const tipo = TIPOS_ACT.includes(d.tipo) ? d.tipo : null
  if (!tipo) return { status: 400, body: { ok: false, error: 'Tipo de gestión inválido' } }
  const resumen = txt(d.resumen, 4000)
  if (!resumen) return { status: 422, body: { ok: false, error: 'Escribe qué pasó en la gestión' } }
  const resultado = RESULTADOS.includes(d.resultado) ? d.resultado : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [act] } = await client.query(
      `INSERT INTO public.crm_actividades
         (aliado_id, prospecto_id, tipo, resultado, resumen, compromiso, duracion_min, origen, realizado_por, realizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, now())) RETURNING *`,
      [aliadoId, prospectoId, tipo, resultado, resumen, txt(d.compromiso, 1000),
       entero(d.duracion_min, 0, 600), origen, personalId || null, fecha(d.realizado_en)])

    if (prospectoId) {
      // La primera gestión saca al prospecto de NUEVO; un "interesado" lo sube.
      await client.query(
        `UPDATE public.crm_prospectos
            SET ultima_gestion_en = now(),
                etapa = CASE
                  WHEN etapa = 'NUEVO' AND $2 = 'INTERESADO' THEN 'INTERESADO'
                  WHEN etapa = 'NUEVO' AND $2 IS DISTINCT FROM 'NO_CONTESTO' AND $2 IS DISTINCT FROM 'NUMERO_ERRADO'
                       AND $2 IS DISTINCT FROM 'BUZON' AND $2 IS DISTINCT FROM 'OCUPADO' THEN 'CONTACTADO'
                  WHEN etapa = 'CONTACTADO' AND $2 = 'INTERESADO' THEN 'INTERESADO'
                  ELSE etapa END,
                etapa_desde = CASE WHEN etapa = 'NUEVO' OR (etapa = 'CONTACTADO' AND $2 = 'INTERESADO') THEN now() ELSE etapa_desde END
          WHERE id = $1`, [prospectoId, resultado])
    }

    // Cerrar el seguimiento que originó esta llamada.
    const segId = uuid(d.seguimiento_id)
    if (segId) {
      await client.query(
        `UPDATE public.crm_seguimientos SET estado = 'HECHO', completado_en = now(), completado_por = $2, actividad_id = $3
          WHERE id = $1 AND estado = 'PENDIENTE'`, [segId, personalId, act.id])
    }

    // Y programar el siguiente, si lo pidieron.
    let seguimiento = null
    if (d.siguiente?.programado_para) {
      const r = await crearSeguimiento({
        ...d.siguiente, aliado_id: aliadoId, prospecto_id: prospectoId,
        titulo: d.siguiente.titulo || (resultado === 'NO_CONTESTO' ? 'Volver a llamar (no contestó)' : `Seguimiento: ${resumen.slice(0, 60)}`),
      }, personalId, { client, origen })
      if (r.status !== 201) { await client.query('ROLLBACK'); return r }
      seguimiento = r.body.seguimiento
    }
    await client.query('COMMIT')
    return { status: 201, body: { ok: true, actividad: act, seguimiento } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

export async function listarActividades({ aliadoId = null, prospectoId = null, limite = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT x.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS autor
       FROM public.crm_actividades x LEFT JOIN public.personal p ON p.id = x.realizado_por
      WHERE ($1::uuid IS NULL OR x.aliado_id = $1) AND ($2::uuid IS NULL OR x.prospecto_id = $2)
      ORDER BY x.realizado_en DESC LIMIT $3`, [uuid(aliadoId), uuid(prospectoId), entero(limite, 1, 500) || 100])
  return rows
}

// ─── Seguimientos ───────────────────────────────────────────────────────────
export async function crearSeguimiento(d = {}, personalId, { client = pool, origen = 'MANUAL' } = {}) {
  const aliadoId = uuid(d.aliado_id), prospectoId = uuid(d.prospecto_id), ticketId = uuid(d.ticket_id)
  if (!aliadoId && !prospectoId && !ticketId) return { status: 400, body: { ok: false, error: 'Falta a quién se le hace el seguimiento' } }
  const cuando = fecha(d.programado_para)
  if (!cuando) return { status: 422, body: { ok: false, error: 'Falta la fecha y hora del seguimiento' } }
  const titulo = txt(d.titulo, 200)
  if (!titulo) return { status: 422, body: { ok: false, error: 'Falta el título del seguimiento' } }
  if (!ticketId) {
    const b = await bloqueoDe({ aliadoId, prospectoId }, client)
    if (b) return { status: 423, body: { ok: false, error: `${b.nombre} pidió no ser contactada (${b.motivo}). Desbloquéala primero si cambió de opinión.` } }
  }
  const estadoSeg = d.estado === 'HECHO' ? 'HECHO' : 'PENDIENTE'
  const { rows: [s] } = await client.query(
    `INSERT INTO public.crm_seguimientos
       (aliado_id, prospecto_id, ticket_id, tipo, titulo, notas, programado_para, responsable_id, origen, creado_por, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [aliadoId, prospectoId, ticketId, TIPOS_SEG.includes(d.tipo) ? d.tipo : 'LLAMADA', titulo,
     txt(d.notas, 2000), cuando, uuid(d.responsable_id) || personalId || null, origen, personalId || null, estadoSeg])
  return { status: 201, body: { ok: true, seguimiento: s } }
}

export async function listarSeguimientos({ rango = 'pendientes', responsableId = null, desde = null, hasta = null, tipos = null } = {}) {
  const filtroBase = {
    vencidos:   `s.estado = 'PENDIENTE' AND s.programado_para < now()`,
    hoy:        `s.estado = 'PENDIENTE' AND (s.programado_para AT TIME ZONE 'America/Bogota')::date <= ${HOY_SQL}`,
    semana:     `s.estado = 'PENDIENTE' AND (s.programado_para AT TIME ZONE 'America/Bogota')::date <= ${HOY_SQL} + 7`,
    pendientes: `s.estado = 'PENDIENTE'`,
    hechos:     `s.estado <> 'PENDIENTE' AND s.programado_para > now() - interval '30 days'`,
  }
  const tiposArr = (tipos || '').split(',').map(t => t.trim().toUpperCase()).filter(t => TIPOS_SEG.includes(t))
  const params = [uuid(responsableId)]
  const clausulas = []

  if (desde && hasta) {
    params.push(desde, hasta)
    clausulas.push(`(s.programado_para AT TIME ZONE 'America/Bogota')::date BETWEEN $${params.length - 1} AND $${params.length}`)
  } else {
    clausulas.push(filtroBase[rango] || filtroBase.pendientes)
  }

  clausulas.push(`($1::uuid IS NULL OR s.responsable_id = $1 OR s.responsable_id IS NULL)`)

  if (tiposArr.length > 0) {
    const slots = tiposArr.map((_, i) => `$${params.length + i + 1}`).join(', ')
    clausulas.push(`s.tipo IN (${slots})`)
    params.push(...tiposArr)
  }

  const descending = rango === 'hechos' || (desde && hasta)
  const { rows } = await pool.query(
    `SELECT s.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS responsable,
            a.nombre AS aliado_nombre, a.whatsapp AS aliado_whatsapp, a.telefono AS aliado_telefono,
            pr.nombre AS prospecto_nombre, pr.whatsapp AS prospecto_whatsapp, pr.telefono AS prospecto_telefono,
            t.numero AS ticket_numero, t.asunto AS ticket_asunto
       FROM public.crm_seguimientos s
       LEFT JOIN public.personal p ON p.id = s.responsable_id
       LEFT JOIN public.aliados a ON a.id_aliado = s.aliado_id
       LEFT JOIN public.crm_prospectos pr ON pr.id = s.prospecto_id
       LEFT JOIN public.crm_tickets t ON t.id = s.ticket_id
      WHERE ${clausulas.join(' AND ')}
      ORDER BY s.programado_para ${descending ? 'DESC' : 'ASC'} LIMIT 500`, params)
  return rows
}

export async function actualizarSeguimiento(id, d = {}, personalId) {
  const sid = uuid(id)
  if (!sid) return { status: 400, body: { ok: false, error: 'Seguimiento inválido' } }
  if (d.accion === 'cancelar') {
    await pool.query(`UPDATE public.crm_seguimientos SET estado = 'CANCELADO', completado_en = now(), completado_por = $2 WHERE id = $1`, [sid, personalId])
  } else if (d.accion === 'hecho') {
    await pool.query(`UPDATE public.crm_seguimientos SET estado = 'HECHO', completado_en = now(), completado_por = $2 WHERE id = $1`, [sid, personalId])
  } else if (d.accion === 'reprogramar') {
    const cuando = fecha(d.programado_para)
    if (!cuando) return { status: 422, body: { ok: false, error: 'Falta la nueva fecha' } }
    await pool.query(
      `UPDATE public.crm_seguimientos SET programado_para = $2, estado = 'PENDIENTE', completado_en = NULL, completado_por = NULL,
              notas = CASE WHEN $3::text IS NULL THEN notas ELSE concat_ws(E'\n', notas, $3::text) END
        WHERE id = $1`, [sid, cuando, txt(d.nota, 500)])
  } else {
    const sets = []; const vals = []
    if (d.titulo !== undefined) { vals.push(txt(d.titulo, 200)); sets.push(`titulo = $${vals.length}`) }
    if (d.notas !== undefined) { vals.push(txt(d.notas, 2000)); sets.push(`notas = $${vals.length}`) }
    if (d.tipo !== undefined && TIPOS_SEG.includes(d.tipo)) { vals.push(d.tipo); sets.push(`tipo = $${vals.length}`) }
    if (d.responsable_id !== undefined) { vals.push(uuid(d.responsable_id)); sets.push(`responsable_id = $${vals.length}`) }
    if (!sets.length) return { status: 400, body: { ok: false, error: 'Nada que cambiar' } }
    vals.push(sid)
    await pool.query(`UPDATE public.crm_seguimientos SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
  }
  return { status: 200, body: { ok: true } }
}

/** Lo que alimenta la campana del CRM: lo vencido y lo de hoy. */
export async function alertas(personal) {
  const yo = personal?.rol === 'COMERCIAL' ? personal.id : null
  const [segs, tks, hitos] = await Promise.all([
    pool.query(
      `SELECT s.id, s.tipo, s.titulo, s.programado_para, s.aliado_id, s.prospecto_id, s.ticket_id,
              COALESCE(a.nombre, pr.nombre, 'Ticket #' || t.numero) AS nombre
         FROM public.crm_seguimientos s
         LEFT JOIN public.aliados a ON a.id_aliado = s.aliado_id
         LEFT JOIN public.crm_prospectos pr ON pr.id = s.prospecto_id
         LEFT JOIN public.crm_tickets t ON t.id = s.ticket_id
        WHERE s.estado = 'PENDIENTE' AND s.programado_para <= now() + interval '15 minutes'
          AND ($1::uuid IS NULL OR s.responsable_id = $1 OR s.responsable_id IS NULL)
        ORDER BY s.programado_para LIMIT 50`, [yo]),
    pool.query(
      `SELECT count(*)::int AS n FROM public.crm_tickets
        WHERE estado NOT IN ('RESUELTO','CERRADO') AND vence_en < now()
          AND ($1::uuid IS NULL OR responsable_id = $1 OR responsable_id IS NULL)`, [yo]),
    pool.query(`SELECT count(*)::int AS n FROM public.crm_hitos_envios WHERE estado = 'PROPUESTO'`),
  ])
  return {
    status: 200,
    body: { ok: true, seguimientos: segs.rows, tickets_vencidos: tks.rows[0].n, hitos_por_enviar: hitos.rows[0].n },
  }
}

// ─── Tickets ────────────────────────────────────────────────────────────────
export async function listarTickets({ estado = null, aliadoId = null, q = null } = {}) {
  const { rows } = await pool.query(
    `SELECT t.*, a.nombre AS aliado_nombre, a.whatsapp AS aliado_whatsapp,
            TRIM(CONCAT_WS(' ', r.nombre, r.apellido)) AS responsable,
            (SELECT count(*)::int FROM public.crm_ticket_eventos e WHERE e.ticket_id = t.id AND e.tipo = 'COMENTARIO') AS comentarios
       FROM public.crm_tickets t
       JOIN public.aliados a ON a.id_aliado = t.aliado_id
       LEFT JOIN public.personal r ON r.id = t.responsable_id
      WHERE ($1::text IS NULL OR t.estado = $1)
        AND ($2::uuid IS NULL OR t.aliado_id = $2)
        AND ($3::text IS NULL OR t.asunto ILIKE '%' || $3 || '%' OR a.nombre ILIKE '%' || $3 || '%' OR t.numero::text = $3)
      ORDER BY CASE WHEN t.estado IN ('RESUELTO','CERRADO') THEN 1 ELSE 0 END,
               CASE t.prioridad WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
               t.vence_en NULLS LAST, t.created_at DESC
      LIMIT 1000`,
    [ESTADOS_TICKET.includes(estado) ? estado : null, uuid(aliadoId), txt(q, 80)])
  return rows
}

export async function crearTicket(d = {}, personalId) {
  const aliadoId = uuid(d.aliado_id)
  if (!aliadoId) return { status: 422, body: { ok: false, error: 'Elige la veterinaria' } }
  const asunto = txt(d.asunto, 200)
  if (!asunto) return { status: 422, body: { ok: false, error: 'Escribe el asunto' } }
  const prioridad = PRIORIDADES.includes(d.prioridad) ? d.prioridad : 'MEDIA'
  const cfg = await leerConfig()
  const horas = Number(cfg.sla_horas[prioridad]) || 48
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [t] } = await client.query(
      `INSERT INTO public.crm_tickets
         (aliado_id, tipo, categoria, prioridad, asunto, descripcion, canal, servicio_id, responsable_id, vence_en, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(hours => $10), $11) RETURNING *`,
      [aliadoId, TIPOS_TICKET.includes(d.tipo) ? d.tipo : 'PETICION',
       CATEGORIAS_TICKET.includes(d.categoria) ? d.categoria : 'OTRO', prioridad, asunto,
       txt(d.descripcion, 4000), ['LLAMADA', 'WHATSAPP', 'VISITA', 'EMAIL', 'PORTAL', 'OTRO'].includes(d.canal) ? d.canal : null,
       uuid(d.servicio_id), uuid(d.responsable_id) || personalId, horas, personalId])
    await client.query(
      `INSERT INTO public.crm_ticket_eventos (ticket_id, tipo, texto, autor_id) VALUES ($1, 'CREADO', $2, $3)`,
      [t.id, txt(d.descripcion, 4000) || asunto, personalId])
    await client.query(
      `INSERT INTO public.crm_actividades (aliado_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, 'SISTEMA', $2, 'SISTEMA', $3)`,
      [aliadoId, `Ticket #${t.numero} abierto (${t.categoria}): ${asunto}`, personalId])
    await client.query('COMMIT')
    return { status: 201, body: { ok: true, ticket: t } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

export async function detalleTicket(id) {
  const tid = uuid(id)
  if (!tid) return { status: 400, body: { ok: false, error: 'Ticket inválido' } }
  const { rows: [t] } = await pool.query(
    `SELECT t.*, a.nombre AS aliado_nombre, a.whatsapp AS aliado_whatsapp, a.telefono AS aliado_telefono,
            a.contacto_nombre AS aliado_contacto,
            TRIM(CONCAT_WS(' ', r.nombre, r.apellido)) AS responsable,
            TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS creado_por_nombre,
            m.nombre AS servicio_mascota, s.fecha_ingreso::text AS servicio_fecha
       FROM public.crm_tickets t
       JOIN public.aliados a ON a.id_aliado = t.aliado_id
       LEFT JOIN public.personal r ON r.id = t.responsable_id
       LEFT JOIN public.personal c ON c.id = t.creado_por
       LEFT JOIN public.servicios s ON s.id = t.servicio_id
       LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
      WHERE t.id = $1`, [tid])
  if (!t) return { status: 404, body: { ok: false, error: 'No existe ese ticket' } }
  const { rows: eventos } = await pool.query(
    `SELECT e.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS autor
       FROM public.crm_ticket_eventos e LEFT JOIN public.personal p ON p.id = e.autor_id
      WHERE e.ticket_id = $1 ORDER BY e.created_at`, [tid])
  const { rows: seguimientos } = await pool.query(
    `SELECT * FROM public.crm_seguimientos WHERE ticket_id = $1 ORDER BY programado_para`, [tid])
  return { status: 200, body: { ok: true, ticket: t, eventos, seguimientos } }
}

export async function actualizarTicket(id, d = {}, personalId) {
  const tid = uuid(id)
  if (!tid) return { status: 400, body: { ok: false, error: 'Ticket inválido' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [t] } = await client.query(`SELECT * FROM public.crm_tickets WHERE id = $1 FOR UPDATE`, [tid])
    if (!t) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'No existe ese ticket' } } }
    const evento = (tipo, texto, de = null, a = null) => client.query(
      `INSERT INTO public.crm_ticket_eventos (ticket_id, tipo, texto, de, a, autor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, tipo, texto, de, a, personalId])

    if (d.comentario) {
      const c = txt(d.comentario, 4000)
      if (c) await evento('COMENTARIO', c)
    }
    if (d.estado && d.estado !== t.estado) {
      if (!ESTADOS_TICKET.includes(d.estado)) { await client.query('ROLLBACK'); return { status: 400, body: { ok: false, error: 'Estado inválido' } } }
      const cierra = ['RESUELTO', 'CERRADO'].includes(d.estado)
      const solucion = txt(d.solucion, 4000) || t.solucion
      if (cierra && !solucion) { await client.query('ROLLBACK'); return { status: 422, body: { ok: false, error: 'Para resolverlo escribe la solución' } } }
      await client.query(
        `UPDATE public.crm_tickets SET estado = $2, solucion = $3,
                resuelto_en = CASE WHEN $4 THEN COALESCE(resuelto_en, now()) ELSE NULL END
          WHERE id = $1`, [tid, d.estado, solucion, cierra])
      await evento('ESTADO', cierra ? solucion : txt(d.nota, 1000), t.estado, d.estado)
      if (cierra) {
        await client.query(
          `UPDATE public.crm_seguimientos SET estado = 'HECHO', completado_en = now(), completado_por = $2
            WHERE ticket_id = $1 AND estado = 'PENDIENTE'`, [tid, personalId])
        await client.query(
          `INSERT INTO public.crm_actividades (aliado_id, tipo, resumen, origen, realizado_por)
           VALUES ($1, 'SISTEMA', $2, 'SISTEMA', $3)`,
          [t.aliado_id, `Ticket #${t.numero} ${d.estado.toLowerCase()}: ${solucion}`.slice(0, 1000), personalId])
      }
    }
    if (d.prioridad && d.prioridad !== t.prioridad && PRIORIDADES.includes(d.prioridad)) {
      const cfg = await leerConfig()
      await client.query(
        `UPDATE public.crm_tickets SET prioridad = $2, vence_en = created_at + make_interval(hours => $3) WHERE id = $1`,
        [tid, d.prioridad, Number(cfg.sla_horas[d.prioridad]) || 48])
      await evento('PRIORIDAD', null, t.prioridad, d.prioridad)
    }
    if (d.responsable_id !== undefined && uuid(d.responsable_id) !== t.responsable_id) {
      await client.query(`UPDATE public.crm_tickets SET responsable_id = $2 WHERE id = $1`, [tid, uuid(d.responsable_id)])
      await evento('ASIGNACION', null, t.responsable_id, uuid(d.responsable_id))
    }
    const simples = {
      categoria: v => (CATEGORIAS_TICKET.includes(v) ? v : null), tipo: v => (TIPOS_TICKET.includes(v) ? v : null),
      asunto: v => txt(v, 200), descripcion: v => txt(v, 4000), servicio_id: v => uuid(v),
    }
    for (const [k, f] of Object.entries(simples)) {
      if (d[k] === undefined) continue
      const v = f(d[k])
      if ((k === 'categoria' || k === 'tipo' || k === 'asunto') && !v) continue
      await client.query(`UPDATE public.crm_tickets SET ${k} = $2 WHERE id = $1`, [tid, v])
    }
    await client.query('COMMIT')
    return detalleTicket(tid)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

// ─── Fotos ──────────────────────────────────────────────────────────────────
const MIMES_FOTO = ['image/jpeg', 'image/png', 'image/webp']

export async function subirFoto(d = {}, personalId) {
  const aliadoId = uuid(d.aliado_id), prospectoId = uuid(d.prospecto_id)
  if (!aliadoId && !prospectoId) return { status: 400, body: { ok: false, error: 'Falta a quién pertenece la foto' } }
  if (!MIMES_FOTO.includes(d.mime)) return { status: 415, body: { ok: false, error: 'Solo fotos JPG, PNG o WEBP' } }
  const buf = Buffer.from(String(d.base64 || '').replace(/^data:[^,]+,/, ''), 'base64')
  if (!buf.length) return { status: 400, body: { ok: false, error: 'La foto llegó vacía' } }
  if (buf.length > 6 * 1048576) return { status: 413, body: { ok: false, error: 'La foto pesa más de 6 MB' } }
  const mini = d.miniatura ? Buffer.from(String(d.miniatura).replace(/^data:[^,]+,/, ''), 'base64') : null
  const { rows: [{ n }] } = await pool.query(
    `SELECT count(*)::int AS n FROM public.crm_fotos WHERE ($1::uuid IS NOT NULL AND aliado_id = $1) OR ($2::uuid IS NOT NULL AND prospecto_id = $2)`,
    [aliadoId, prospectoId])
  const { rows: [f] } = await pool.query(
    `INSERT INTO public.crm_fotos (aliado_id, prospecto_id, archivo, miniatura, mime, bytes, descripcion, es_portada, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, descripcion, es_portada, mime, bytes, created_at`,
    [aliadoId, prospectoId, buf, mini && mini.length ? mini : null, d.mime, buf.length, txt(d.descripcion, 300), n === 0, personalId])
  return { status: 201, body: { ok: true, foto: f } }
}

export async function leerFoto(id, { mini = false } = {}) {
  const fid = uuid(id)
  if (!fid) return null
  const { rows: [f] } = await pool.query(
    `SELECT ${mini ? 'COALESCE(miniatura, archivo)' : 'archivo'} AS archivo, CASE WHEN $2 AND miniatura IS NOT NULL THEN 'image/jpeg' ELSE mime END AS mime
       FROM public.crm_fotos WHERE id = $1`, [fid, mini])
  return f || null
}

export async function borrarFoto(id) {
  const fid = uuid(id)
  if (!fid) return { status: 400, body: { ok: false, error: 'Foto inválida' } }
  await pool.query(`DELETE FROM public.crm_fotos WHERE id = $1`, [fid])
  return { status: 200, body: { ok: true } }
}

export async function portadaFoto(id) {
  const fid = uuid(id)
  if (!fid) return { status: 400, body: { ok: false, error: 'Foto inválida' } }
  const { rows: [f] } = await pool.query(`SELECT aliado_id, prospecto_id FROM public.crm_fotos WHERE id = $1`, [fid])
  if (!f) return { status: 404, body: { ok: false, error: 'No existe esa foto' } }
  await pool.query(
    `UPDATE public.crm_fotos SET es_portada = (id = $1)
      WHERE ($2::uuid IS NOT NULL AND aliado_id = $2) OR ($3::uuid IS NOT NULL AND prospecto_id = $3)`,
    [fid, f.aliado_id, f.prospecto_id])
  return { status: 200, body: { ok: true } }
}

// ─── WhatsApp desde la ficha ────────────────────────────────────────────────
async function contactoDe({ aliadoId, prospectoId }) {
  if (aliadoId) {
    const { rows: [a] } = await pool.query(`SELECT nombre, whatsapp, telefono FROM public.aliados WHERE id_aliado = $1`, [aliadoId])
    return a ? { nombre: a.nombre, numero: aWhatsapp(a.whatsapp || a.telefono) } : null
  }
  const { rows: [p] } = await pool.query(`SELECT nombre, whatsapp, telefono FROM public.crm_prospectos WHERE id = $1`, [prospectoId])
  return p ? { nombre: p.nombre, numero: aWhatsapp(p.whatsapp || p.telefono) } : null
}

// ─── No contactar (migración 181) ───────────────────────────────────────────
/** El bloqueo de la ficha, o null. Mira la fila Y el número (otra ficha con ese teléfono). */
export async function bloqueoDe({ aliadoId = null, prospectoId = null, numero = null }, client = pool) {
  const { rows: [b] } = await client.query(
    `SELECT nombre, no_contactar_motivo AS motivo FROM public.aliados WHERE $1::uuid IS NOT NULL AND id_aliado = $1 AND no_contactar
      UNION ALL
     SELECT nombre, no_contactar_motivo FROM public.crm_prospectos WHERE $2::uuid IS NOT NULL AND id = $2 AND no_contactar
      LIMIT 1`, [aliadoId, prospectoId])
  if (b) return b
  if (numero) {
    const { rows: [x] } = await client.query(`SELECT public.fn_crm_no_contactar($1) AS si`, [String(numero)])
    if (x?.si) return { nombre: 'Ese número', motivo: 'está marcado como no contactar' }
  }
  return null
}

/**
 * Bloquear: deja de recibir publicidad y gestión comercial. Al hacerlo se
 * cancelan sus seguimientos pendientes y se descartan sus hitos por enviar; un
 * prospecto abierto pasa a PERDIDO. La operación (recogidas, recibos,
 * certificados) NO se toca: si manda un servicio, se le atiende igual.
 */
export async function cambiarBloqueo({ aliadoId = null, prospectoId = null, bloquear, motivo }, personalId) {
  const tabla = aliadoId ? 'aliados' : 'crm_prospectos'
  const pk = aliadoId ? 'id_aliado' : 'id'
  const id = uuid(aliadoId || prospectoId)
  if (!id) return { status: 400, body: { ok: false, error: 'Ficha inválida' } }
  const m = txt(motivo, 500)
  if (bloquear && !m) return { status: 422, body: { ok: false, error: 'Escribe por qué no quiere ser contactada' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [f] } = await client.query(
      `UPDATE public.${tabla}
          SET no_contactar = $2, no_contactar_motivo = CASE WHEN $2 THEN $3 ELSE NULL END,
              no_contactar_desde = CASE WHEN $2 THEN now() ELSE NULL END,
              no_contactar_por = CASE WHEN $2 THEN $4::uuid ELSE NULL END
        WHERE ${pk} = $1 RETURNING nombre`, [id, !!bloquear, m, personalId])
    if (!f) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'No existe esa ficha' } } }
    const col = aliadoId ? 'aliado_id' : 'prospecto_id'
    let cancelados = 0, descartados = 0
    if (bloquear) {
      cancelados = (await client.query(
        `UPDATE public.crm_seguimientos SET estado = 'CANCELADO', completado_en = now(), completado_por = $2
          WHERE ${col} = $1 AND estado = 'PENDIENTE'`, [id, personalId])).rowCount
      if (aliadoId) {
        descartados = (await client.query(
          `UPDATE public.crm_hitos_envios SET estado = 'DESCARTADO', resuelto_en = now(), resuelto_por = $2,
                  error = 'No contactar'
            WHERE aliado_id = $1 AND estado IN ('PROPUESTO','ERROR')`, [id, personalId])).rowCount
      } else {
        await client.query(
          `UPDATE public.crm_prospectos SET etapa = 'PERDIDO', etapa_desde = now(),
                  motivo_perdida = 'No quiere ser contactado: ' || $2
            WHERE id = $1 AND etapa NOT IN ('GANADO','PERDIDO')`, [id, m])
      }
    }
    await client.query(
      `INSERT INTO public.crm_actividades (${col}, tipo, resumen, origen, realizado_por)
       VALUES ($1, 'SISTEMA', $2, 'SISTEMA', $3)`,
      [id, bloquear
        ? `🚫 Marcada como NO CONTACTAR: ${m}${cancelados ? ` · ${cancelados} seguimiento(s) cancelado(s)` : ''}${descartados ? ` · ${descartados} hito(s) descartado(s)` : ''}`
        : `✅ Desbloqueada: se puede volver a contactar${m ? ` (${m})` : ''}`, personalId])
    await client.query('COMMIT')
    log(MOD, `${tabla} ${id} ${bloquear ? 'BLOQUEADA' : 'desbloqueada'} por ${personalId}`)
    return { status: 200, body: { ok: true, cancelados, descartados } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/** Plantilla aprobada a una vet o prospecto, por la línea de veterinarias. */
export async function enviarPlantillaCrm(d = {}, personalId) {
  const aliadoId = uuid(d.aliado_id), prospectoId = uuid(d.prospecto_id)
  const c = await contactoDe({ aliadoId, prospectoId })
  if (!c?.numero) return { status: 422, body: { ok: false, error: 'No tiene WhatsApp en la ficha' } }
  const b = await bloqueoDe({ aliadoId, prospectoId, numero: c.numero })
  if (b) return { status: 423, body: { ok: false, error: `No se envía: ${b.nombre} pidió no ser contactada (${b.motivo}).` } }
  const { agenteId, linea } = await lineaVeterinarias()
  const idioma = txt(d.idioma, 10) || 'es_MX'
  let valores = {}
  if (aliadoId) {
    const r = await valoresDeFuente({ plantilla: d.nombre, idioma, fuente: 'ALIADO', refId: aliadoId, agenteId }).catch(() => null)
    if (r?.ok) valores = r.valores
  }
  for (const [k, v] of Object.entries(d.valores && typeof d.valores === 'object' ? d.valores : {})) {
    if (String(v ?? '').trim()) valores[k] = v
  }
  const r = await enviarPlantilla({ contacto: c.numero, nombre: d.nombre, idioma, valores, agenteId, linea, personalId })
  if (r.body?.ok) {
    await pool.query(
      `INSERT INTO public.crm_actividades (aliado_id, prospecto_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, $2, 'PLANTILLA', $3, 'MANUAL', $4)`,
      [aliadoId, prospectoId, `Plantilla enviada por WhatsApp: ${d.nombre}`, personalId])
  }
  return r
}

export async function enviarMaterialCrm(d = {}, personalId) {
  const aliadoId = uuid(d.aliado_id), prospectoId = uuid(d.prospecto_id)
  const c = await contactoDe({ aliadoId, prospectoId })
  if (!c?.numero) return { status: 422, body: { ok: false, error: 'No tiene WhatsApp en la ficha' } }
  const b = await bloqueoDe({ aliadoId, prospectoId, numero: c.numero })
  if (b) return { status: 423, body: { ok: false, error: `No se envía: ${b.nombre} pidió no ser contactada (${b.motivo}).` } }
  const { agenteId, linea } = await lineaVeterinarias()
  const r = await enviarMaterial({
    contacto: c.numero, linea, clave: d.clave, agenteId: Number(d.agente_id) || agenteId,
    personalId, enviarSobre,
  })
  if (r.body?.ok) {
    await pool.query(
      `INSERT INTO public.crm_actividades (aliado_id, prospecto_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, $2, 'MATERIAL', $3, 'MANUAL', $4)`,
      [aliadoId, prospectoId, `Material enviado por WhatsApp: ${d.clave}`, personalId])
  }
  return r
}

// ─── Hitos ──────────────────────────────────────────────────────────────────
export async function listarReglas() {
  const { rows } = await pool.query(
    `SELECT r.*, (SELECT count(*)::int FROM public.crm_hitos_envios e WHERE e.regla_id = r.id AND e.estado = 'ENVIADO') AS enviados,
            (SELECT count(*)::int FROM public.crm_hitos_envios e WHERE e.regla_id = r.id AND e.estado = 'PROPUESTO') AS propuestos
       FROM public.crm_hitos_reglas r ORDER BY r.created_at`)
  return rows
}

export async function guardarRegla(id, d = {}, personalId) {
  const tipo = TIPOS_HITO.includes(d.tipo) ? d.tipo : null
  const nombre = txt(d.nombre, 120)
  if (!nombre || !tipo) return { status: 422, body: { ok: false, error: 'Falta el nombre o el tipo del hito' } }
  const modo = d.modo === 'AUTOMATICO' ? 'AUTOMATICO' : 'PROPONER'
  const activo = !!d.activo
  const plantilla = txt(d.plantilla, 120)
  if (activo && !plantilla) return { status: 422, body: { ok: false, error: 'Para encender el hito elige la plantilla aprobada' } }
  const vals = [nombre, tipo, entero(d.umbral, 1, 100000) || 1, !!d.repetir, plantilla, txt(d.idioma, 10) || 'es_MX',
    JSON.stringify(d.valores && typeof d.valores === 'object' ? d.valores : {}), modo, activo]
  if (uuid(id)) {
    vals.push(uuid(id))
    const { rows: [r] } = await pool.query(
      `UPDATE public.crm_hitos_reglas SET nombre=$1, tipo=$2, umbral=$3, repetir=$4, plantilla=$5, idioma=$6,
              valores=$7::jsonb, modo=$8, activo=$9 WHERE id=$10 RETURNING *`, vals)
    if (!r) return { status: 404, body: { ok: false, error: 'No existe ese hito' } }
    return { status: 200, body: { ok: true, regla: r } }
  }
  vals.push(personalId)
  const { rows: [r] } = await pool.query(
    `INSERT INTO public.crm_hitos_reglas (nombre, tipo, umbral, repetir, plantilla, idioma, valores, modo, activo, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *`, vals)
  return { status: 201, body: { ok: true, regla: r } }
}

export async function borrarRegla(id) {
  const rid = uuid(id)
  if (!rid) return { status: 400, body: { ok: false, error: 'Hito inválido' } }
  await pool.query(`DELETE FROM public.crm_hitos_reglas WHERE id = $1`, [rid])
  return { status: 200, body: { ok: true } }
}

/**
 * Busca a quién le toca cada hito encendido. Solo mira hitos cruzados en los
 * últimos 7 días: encender "gracias por 10 servicios" no puede proponerle de
 * golpe un mensaje a las 120 clínicas que pasaron los 10 hace meses.
 */
const SQL_CANDIDATOS = {
  SERVICIOS_TOTAL: `
    WITH s AS (
      SELECT s.aliado_origen_id AS aliado_id, s.fecha_ingreso AS f,
             row_number() OVER (PARTITION BY s.aliado_origen_id ORDER BY s.fecha_ingreso, s.created_at, s.id) AS n
        FROM public.servicios s
       WHERE s.aliado_origen_id IS NOT NULL AND s.estado <> 'CANCELADO' AND s.fecha_ingreso IS NOT NULL)
    SELECT aliado_id, n::int AS valor, 'T' || n AS periodo FROM s
     WHERE f > ${HOY_SQL} - 7
       AND (CASE WHEN $2::boolean THEN n % $1::int = 0 ELSE n = $1::int END)`,
  SERVICIOS_MES: `
    SELECT s.aliado_origen_id AS aliado_id, count(*)::int AS valor,
           'M' || to_char(${HOY_SQL}, 'YYYY-MM') AS periodo
      FROM public.servicios s
     WHERE s.aliado_origen_id IS NOT NULL AND s.estado <> 'CANCELADO'
       AND date_trunc('month', s.fecha_ingreso) = date_trunc('month', ${HOY_SQL})
     GROUP BY 1 HAVING count(*) >= $1::int AND $2::boolean IS NOT NULL`,
  PRIMER_SERVICIO: `
    SELECT aliado_id, 1 AS valor, 'P' AS periodo FROM (
      SELECT s.aliado_origen_id AS aliado_id, min(s.fecha_ingreso) AS primero
        FROM public.servicios s
       WHERE s.aliado_origen_id IS NOT NULL AND s.estado <> 'CANCELADO' GROUP BY 1) x
     WHERE primero > ${HOY_SQL} - 7 AND $1::int IS NOT NULL AND $2::boolean IS NOT NULL`,
  REACTIVACION: `
    WITH s AS (
      SELECT s.aliado_origen_id AS aliado_id, s.fecha_ingreso AS f,
             lag(s.fecha_ingreso) OVER (PARTITION BY s.aliado_origen_id ORDER BY s.fecha_ingreso, s.created_at) AS antes
        FROM public.servicios s
       WHERE s.aliado_origen_id IS NOT NULL AND s.estado <> 'CANCELADO' AND s.fecha_ingreso IS NOT NULL)
    SELECT aliado_id, (f - antes)::int AS valor, 'R' || f::text AS periodo FROM s
     WHERE f > ${HOY_SQL} - 7 AND antes IS NOT NULL AND (f - antes) >= $1::int AND $2::boolean IS NOT NULL`,
}

export async function evaluarHitos({ enviarAutomaticos = true } = {}) {
  const { rows: reglas } = await pool.query(`SELECT * FROM public.crm_hitos_reglas WHERE activo AND plantilla IS NOT NULL`)
  const resumen = { reglas: reglas.length, propuestos: 0, enviados: 0, errores: 0 }
  for (const r of reglas) {
    const { rows: cands } = await pool.query(SQL_CANDIDATOS[r.tipo], [r.umbral, r.repetir])
    for (const c of cands) {
      const { rows: [e] } = await pool.query(
        `INSERT INTO public.crm_hitos_envios (regla_id, aliado_id, periodo, valor)
         SELECT $1, $2, $3, $4 FROM public.aliados a WHERE a.id_aliado = $2 AND a.activo AND NOT a.no_contactar
         ON CONFLICT (regla_id, aliado_id, periodo) DO NOTHING RETURNING id`,
        [r.id, c.aliado_id, c.periodo, c.valor])
      if (!e) continue
      resumen.propuestos++
      if (r.modo === 'AUTOMATICO' && enviarAutomaticos) {
        const out = await enviarHito(e.id, null)
        if (out.body?.ok) resumen.enviados++; else resumen.errores++
      }
    }
  }
  log(MOD, `hitos: ${JSON.stringify(resumen)}`)
  return resumen
}

export async function listarHitosEnvios({ estado = 'PROPUESTO' } = {}) {
  const { rows } = await pool.query(
    `SELECT e.*, r.nombre AS regla, r.tipo, r.umbral, r.plantilla, a.nombre AS aliado_nombre, a.whatsapp,
            TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS resuelto_por_nombre
       FROM public.crm_hitos_envios e
       JOIN public.crm_hitos_reglas r ON r.id = e.regla_id
       JOIN public.aliados a ON a.id_aliado = e.aliado_id
       LEFT JOIN public.personal p ON p.id = e.resuelto_por
      WHERE ($1::text IS NULL OR e.estado = $1)
      ORDER BY e.propuesto_en DESC LIMIT 300`,
    [['PROPUESTO', 'ENVIADO', 'DESCARTADO', 'ERROR'].includes(estado) ? estado : null])
  return rows
}

/** Reemplaza {valor}, {nombre}, {contacto}, {mes} en los valores fijos de la regla. */
function rellenar(texto, ctx) {
  return String(texto ?? '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m))
}

export async function enviarHito(id, personalId) {
  const eid = uuid(id)
  if (!eid) return { status: 400, body: { ok: false, error: 'Envío inválido' } }
  const { rows: [e] } = await pool.query(
    `SELECT e.*, r.plantilla, r.idioma, r.valores, r.nombre AS regla, a.nombre AS aliado_nombre,
            a.contacto_nombre, a.whatsapp, a.telefono
       FROM public.crm_hitos_envios e
       JOIN public.crm_hitos_reglas r ON r.id = e.regla_id
       JOIN public.aliados a ON a.id_aliado = e.aliado_id
      WHERE e.id = $1`, [eid])
  if (!e) return { status: 404, body: { ok: false, error: 'No existe ese envío' } }
  if (e.estado === 'ENVIADO') return { status: 409, body: { ok: false, error: 'Ya se envió' } }
  if (!e.plantilla) return { status: 422, body: { ok: false, error: 'El hito no tiene plantilla' } }
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const ctx = { valor: e.valor, nombre: e.aliado_nombre, contacto: e.contacto_nombre || e.aliado_nombre,
                mes: meses[new Date().getMonth()] }
  const fijos = {}
  // Un hueco en blanco NO pisa el dato mapeado: se deja que salga del mapeo.
  for (const [k, v] of Object.entries(e.valores || {})) if (String(v ?? '').trim()) fijos[k] = rellenar(v, ctx)
  const r = await enviarPlantillaCrm({ aliado_id: e.aliado_id, nombre: e.plantilla, idioma: e.idioma, valores: fijos }, personalId)
  await pool.query(
    `UPDATE public.crm_hitos_envios SET estado = $2, error = $3, resuelto_en = now(), resuelto_por = $4 WHERE id = $1`,
    [eid, r.body?.ok ? 'ENVIADO' : 'ERROR', r.body?.ok ? null : String(r.body?.error || 'Error').slice(0, 500), personalId])
  if (r.body?.ok) {
    await pool.query(
      `INSERT INTO public.crm_actividades (aliado_id, tipo, resumen, origen, realizado_por)
       VALUES ($1, 'SISTEMA', $2, 'SISTEMA', $3)`, [e.aliado_id, `Hito "${e.regla}" (${e.valor}) celebrado por WhatsApp`, personalId])
  }
  return r
}

export async function descartarHito(id, personalId) {
  const eid = uuid(id)
  if (!eid) return { status: 400, body: { ok: false, error: 'Envío inválido' } }
  await pool.query(
    `UPDATE public.crm_hitos_envios SET estado = 'DESCARTADO', resuelto_en = now(), resuelto_por = $2
      WHERE id = $1 AND estado IN ('PROPUESTO','ERROR')`, [eid, personalId])
  return { status: 200, body: { ok: true } }
}

// ─── Configuración y equipo ─────────────────────────────────────────────────
export async function guardarConfig(d = {}, personalId) {
  const permitidas = ['dias_enfriandose', 'dias_en_riesgo', 'dias_dormida', 'dias_sin_gestion', 'sla_horas']
  for (const k of permitidas) {
    if (!(k in d)) continue
    let v = d[k]
    if (k === 'sla_horas') {
      if (!v || typeof v !== 'object') continue
      v = Object.fromEntries(PRIORIDADES.map(p => [p, entero(v[p], 1, 2000) || CONFIG_DEFECTO.sla_horas[p]]))
    } else {
      v = entero(v, 1, 3650)
      if (!v) continue
    }
    await pool.query(
      `INSERT INTO public.config_operativa (modulo, clave, valor, actualizado_por, updated_at)
       VALUES ('CRM', $1, $2::jsonb, $3, now())
       ON CONFLICT (modulo, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, updated_at = now()`,
      [k, JSON.stringify(v), personalId])
  }
  const cfg = await leerConfig()
  if (!(cfg.dias_enfriandose < cfg.dias_en_riesgo && cfg.dias_en_riesgo < cfg.dias_dormida)) {
    return { status: 422, body: { ok: false, error: 'Los días deben ir en orden: enfriándose < en riesgo < dormida', config: cfg } }
  }
  return { status: 200, body: { ok: true, config: cfg } }
}

export async function equipo() {
  const { rows } = await pool.query(
    `SELECT p.id, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS nombre, r.nombre AS rol
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
      WHERE p.activo AND r.nombre IN ('COMERCIAL','COORDINADOR','ADMIN')
      ORDER BY (r.nombre = 'COMERCIAL') DESC, p.nombre`)
  return rows
}

/** La consulta de servicios de aliados (el "tablero en modo lectura"). */
export async function servicios({ desde = null, hasta = null, aliadoId = null, estado = null, q = null } = {}) {
  const { rows } = await pool.query(
    `SELECT s.id, s.fecha_ingreso::text AS fecha_ingreso, s.estado, s.estado_pago, s.valor_total, s.comision_aliado,
            s.comision_descontada, s.comision_pagada, s.fecha_limite_entrega::text AS fecha_limite_entrega,
            s.fecha_entrega_real::text AS fecha_entrega_real,
            pl.nombre AS plan, m.nombre AS mascota, e.nombre AS especie,
            TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS cliente,
            a.id_aliado, a.nombre AS aliado_nombre
       FROM public.servicios s
       JOIN public.aliados a ON a.id_aliado = s.aliado_origen_id
       LEFT JOIN public.planes pl ON pl.id = s.plan_id
       LEFT JOIN public.mascotas m ON m.id_mascota = s.mascota_id
       LEFT JOIN public.especies e ON e.id = m.especie_id
       LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
      WHERE s.fecha_ingreso >= COALESCE($1::date, ${HOY_SQL} - 60)
        AND s.fecha_ingreso <= COALESCE($2::date, ${HOY_SQL})
        AND ($3::uuid IS NULL OR s.aliado_origen_id = $3)
        AND ($4::text IS NULL OR s.estado = $4)
        AND ($5::text IS NULL OR a.nombre ILIKE '%' || $5 || '%' OR m.nombre ILIKE '%' || $5 || '%'
             OR c.nombre ILIKE '%' || $5 || '%' OR c.apellido ILIKE '%' || $5 || '%')
      ORDER BY s.fecha_ingreso DESC, s.created_at DESC LIMIT 3000`,
    [/^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : null, /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : null,
     uuid(aliadoId), txt(estado, 30), txt(q, 80)])
  return rows
}

// ─── Copiloto IA ────────────────────────────────────────────────────────────
const SISTEMA_COPILOTO =
  'Eres el copiloto del área comercial de Camino al Cielo, funeraria de mascotas en Bogotá. ' +
  'Las veterinarias aliadas nos refieren servicios (cremación, compostaje) y ganan comisión. ' +
  'Hablas en español de Colombia, directo y útil, sin relleno. Nunca inventes cifras: usa solo ' +
  'los datos que te dan. Si falta un dato, dilo.'

async function contextoParaIA({ aliadoId, prospectoId }) {
  if (aliadoId) {
    const f = await fichaAliado(aliadoId)
    if (f.status !== 200) return null
    const b = f.body
    const a = b.aliado
    const m = b.metricas
    const ultimosWa = b.conversaciones[0]
      ? (await pool.query(
          `SELECT direccion, texto, ocurrido_en FROM public.whatsapp_mensajes
            WHERE contacto = $1 AND phone_number_id = $2 AND texto IS NOT NULL
            ORDER BY ocurrido_en DESC LIMIT 15`, [b.conversaciones[0].contacto, b.conversaciones[0].phone_number_id])).rows.reverse()
      : []
    return [
      `VETERINARIA: ${a.nombre} (${a.localidad || a.ciudad || 'sin zona'}). Contacto: ${a.contacto_nombre || '—'} ${a.contacto_cargo ? `(${a.contacto_cargo})` : ''}.`,
      `Estado: ${a.estado}${a.vip ? ', VIP' : ''}. Modalidad de comisión: ${a.modalidad_comision}. Aliada desde ${String(a.created_at).slice(0, 10)}.`,
      `Métricas: segmento ${m.segmento}, clase ${m.clase || '—'}, ${m.total} servicios en total, ${m.s30} en 30 días, ${m.s90} en 90 días, ${m.s90_180} en los 90 anteriores, tendencia ${m.tendencia} (${m.variacion}%), último hace ${m.dias_sin ?? '—'} días, probabilidad 30 días ${m.probabilidad}%, riesgo ${m.riesgo || '—'}, comisión pendiente $${Math.round(m.comision_pendiente || 0)}.`,
      `Serie mensual (12 meses): ${b.serie.map(s => `${s.mes}:${s.servicios}`).join(', ')}.`,
      `Planes del último semestre: ${b.planes.map(p => `${p.plan} ${p.n}`).join(', ') || 'ninguno'}.`,
      `Notas comerciales: ${a.notas_comerciales || '—'}`,
      `Gestiones recientes:\n${b.actividades.slice(0, 12).map(x => `- ${String(x.realizado_en).slice(0, 10)} ${x.tipo}${x.resultado ? '/' + x.resultado : ''}: ${x.resumen}${x.compromiso ? ' | compromiso: ' + x.compromiso : ''}`).join('\n') || '- ninguna'}`,
      `Tickets: ${b.tickets.slice(0, 8).map(t => `#${t.numero} ${t.categoria} ${t.estado}: ${t.asunto}`).join('; ') || 'ninguno'}.`,
      `PQR de sus familias: ${b.pqrs.slice(0, 5).map(q => `${q.tipo}: ${String(q.descripcion || '').slice(0, 100)}`).join('; ') || 'ninguna'}.`,
      `Últimos WhatsApp:\n${ultimosWa.map(x => `${x.direccion === 'IN' ? 'Vet' : 'Nosotros'}: ${String(x.texto).slice(0, 200)}`).join('\n') || '- sin conversación'}`,
    ].join('\n')
  }
  const { rows: [p] } = await pool.query(`SELECT * FROM public.crm_prospectos WHERE id = $1`, [prospectoId])
  if (!p) return null
  const acts = await listarActividades({ prospectoId, limite: 15 })
  return [
    `PROSPECTO: ${p.nombre} (${p.localidad || p.ciudad || 'sin zona'}). Contacto: ${p.contacto_nombre || '—'}. Fuente: ${p.fuente} ${p.fuente_detalle || ''}.`,
    `Etapa: ${p.etapa} desde ${String(p.etapa_desde).slice(0, 10)}. Potencial: ${p.potencial_mensual ?? '—'} servicios/mes.`,
    `Notas: ${p.notas || '—'}. Datos extra: ${JSON.stringify(p.datos || {}).slice(0, 500)}`,
    `Gestiones:\n${acts.map(x => `- ${String(x.realizado_en).slice(0, 10)} ${x.tipo}${x.resultado ? '/' + x.resultado : ''}: ${x.resumen}`).join('\n') || '- ninguna'}`,
  ].join('\n')
}

const ACCIONES_COPILOTO = {
  resumen: 'Escribe un diagnóstico de esta cuenta en 5 viñetas máximo: situación, qué cambió, riesgos u oportunidades y lo más importante a tener en cuenta antes de llamar.',
  siguiente: 'Recomienda la SIGUIENTE MEJOR ACCIÓN comercial con esta cuenta: qué hacer, cuándo, por qué canal y qué decir. Concreto, máximo 6 líneas.',
  guion: 'Escribe un guion corto de llamada telefónica para esta cuenta: saludo, motivo, 3 preguntas clave, cómo manejar la objeción más probable y el cierre con un compromiso concreto.',
  mensaje: 'Redacta un mensaje de WhatsApp para esta cuenta (máximo 5 líneas, cercano, sin emojis excesivos) que sirva para lo que la situación pide ahora. Solo el mensaje, sin explicación.',
}

export async function copiloto(d = {}) {
  const aliadoId = uuid(d.aliado_id), prospectoId = uuid(d.prospecto_id)
  if (!aliadoId && !prospectoId) return { status: 400, body: { ok: false, error: 'Falta la cuenta' } }
  const accion = ACCIONES_COPILOTO[d.accion] ? d.accion : 'resumen'
  const ctx = await contextoParaIA({ aliadoId, prospectoId })
  if (!ctx) return { status: 404, body: { ok: false, error: 'No existe esa cuenta' } }
  const extra = txt(d.instruccion, 600)
  const texto = await llamarClaude({
    system: SISTEMA_COPILOTO,
    prompt: `${ctx}\n\nTAREA: ${ACCIONES_COPILOTO[accion]}${extra ? `\nIndicación del comercial: ${extra}` : ''}`,
    maxTokens: 900,
    canal: 'CRM',
  })
  return { status: 200, body: { ok: true, texto } }
}

// ─── Para el agente de ventas ───────────────────────────────────────────────
/** ¿Este número es un prospecto abierto (no una aliada)? Lo pregunta el agente. */
export async function prospectoAbiertoPorNumero(contacto) {
  const t = tel10(contacto)
  if (!t || t.length !== 10) return null
  const { rows: [al] } = await pool.query(
    `SELECT 1 FROM public.aliados WHERE public.wa_tel10(whatsapp) = $1 OR public.wa_tel10(telefono) = $1 LIMIT 1`, [t])
  if (al) return null
  const { rows: [p] } = await pool.query(
    `SELECT * FROM public.crm_prospectos
      WHERE (public.wa_tel10(whatsapp) = $1 OR public.wa_tel10(telefono) = $1)
        AND etapa NOT IN ('GANADO','PERDIDO') AND NOT no_contactar
      ORDER BY updated_at DESC LIMIT 1`, [t])
  return p || null
}

export function contextoProspectoParaAgente(p) {
  if (!p) return null
  return `Este número es el PROSPECTO "${p.nombre}" (etapa ${p.etapa}${p.contacto_nombre ? `, contacto ${p.contacto_nombre}` : ''}`
    + `${p.localidad || p.ciudad ? `, ${p.localidad || p.ciudad}` : ''}). Todavía NO es aliada.`
    + (p.notas ? ` Lo que sabe el comercial: ${String(p.notas).slice(0, 300)}` : '')
}

/** La herramienta `registrar_interes_comercial` del agente VENTAS. */
export async function registrarInteresDesdeAgente({ contacto, entrada = {} }) {
  let p = await prospectoAbiertoPorNumero(contacto)
  if (!p) {
    const r = await crearProspecto({
      nombre: entrada.nombre_clinica || `WhatsApp ${digitos(contacto).slice(-10)}`,
      contacto_nombre: entrada.contacto_nombre, whatsapp: contacto, ciudad: entrada.ciudad,
      localidad: entrada.localidad, fuente_detalle: 'Escribió a la línea de veterinarias',
    }, null, { fuente: 'AGENTE', permitirDuplicado: true })
    if (r.status !== 201) return { ok: false, error: r.body.error }
    p = r.body.prospecto
  } else {
    const cambios = {}
    if (entrada.nombre_clinica && /^WhatsApp \d+$/.test(p.nombre)) cambios.nombre = entrada.nombre_clinica
    if (entrada.contacto_nombre && !p.contacto_nombre) cambios.contacto_nombre = entrada.contacto_nombre
    if (entrada.ciudad && !p.ciudad) cambios.ciudad = entrada.ciudad
    if (entrada.localidad && !p.localidad) cambios.localidad = entrada.localidad
    if (Object.keys(cambios).length) await actualizarProspecto(p.id, cambios)
  }
  const interes = ['ALTO', 'MEDIO', 'BAJO', 'NINGUNO'].includes(entrada.interes) ? entrada.interes : 'MEDIO'
  const resultado = interes === 'NINGUNO' ? 'NO_INTERESADO' : interes === 'BAJO' ? 'INFORMATIVO' : 'INTERESADO'
  const resumen = txt(entrada.resumen, 1500) || 'Conversación con el agente de ventas'
  const siguiente = entrada.quiere_llamada ? {
    tipo: 'LLAMADA',
    titulo: `Llamar: lo pidió por WhatsApp${entrada.hora_preferida ? ` (${entrada.hora_preferida})` : ''}`,
    // Sin hora concreta, la próxima hora hábil: que no se quede para mañana.
    programado_para: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    notas: entrada.hora_preferida ? `Hora que pidió: ${entrada.hora_preferida}` : null,
    responsable_id: p.responsable_id,
  } : null
  const r = await registrarActividad({
    prospecto_id: p.id, tipo: 'WHATSAPP', resultado, resumen,
    compromiso: entrada.quiere_llamada ? `Quiere llamada ${entrada.hora_preferida || ''}`.trim() : null,
    siguiente,
  }, null, { origen: 'AGENTE' })
  if (interes === 'ALTO') await pool.query(`UPDATE public.crm_prospectos SET etapa = 'INTERESADO', etapa_desde = now() WHERE id = $1 AND etapa IN ('NUEVO','CONTACTADO')`, [p.id])
  return r.status === 201
    ? { ok: true, nota: entrada.quiere_llamada ? 'Quedó agendada la llamada con el área comercial.' : 'Quedó registrado para el área comercial.' }
    : { ok: false, error: r.body?.error }
}

// ─── Traspasos entre agentes (migración 182) ────────────────────────────────
/** La ficha (aliada o prospecto) de un número, para dejar las cosas en su bitácora. */
async function fichaPorNumero(contacto) {
  const t = tel10(contacto)
  if (!t || t.length !== 10) return {}
  const { rows: [a] } = await pool.query(
    `SELECT id_aliado, nombre, vip, modalidad_comision, estado, activo FROM public.aliados
      WHERE public.wa_tel10(whatsapp) = $1 OR public.wa_tel10(telefono) = $1 OR public.wa_tel10(telefono_2) = $1
      ORDER BY activo DESC NULLS LAST LIMIT 1`, [t])
  if (a) return { aliado: a }
  const { rows: [pr] } = await pool.query(
    `SELECT id, nombre, etapa FROM public.crm_prospectos
      WHERE public.wa_tel10(whatsapp) = $1 OR public.wa_tel10(telefono) = $1
      ORDER BY updated_at DESC LIMIT 1`, [t])
  return pr ? { prospecto: pr } : {}
}

async function diasTraspaso() {
  const { rows: [r] } = await pool.query(
    `SELECT valor FROM public.config_operativa WHERE modulo = 'CRM' AND clave = 'dias_traspaso_comercial'`)
  return Math.max(1, Number(r?.valor) || 7)
}

/**
 * El traspaso vivo de una conversación, si lo hay. Vencido = como si no
 * existiera (vuelve a operación); se cierra al leerlo para dejar rastro.
 */
export async function traspasoVivo(phoneNumberId, contacto) {
  const { rows: [t] } = await pool.query(
    `SELECT * FROM public.agente_wa_traspasos
      WHERE phone_number_id = $1 AND contacto = $2 AND cerrado_en IS NULL`, [phoneNumberId, contacto])
  if (!t) return null
  if (new Date(t.hasta) < new Date()) {
    await pool.query(
      `UPDATE public.agente_wa_traspasos SET cerrado_en = now(), cerrado_motivo = 'Venció sin mensajes' WHERE id = $1`, [t.id])
    return null
  }
  return t
}

/** Cada respuesta del comercial corre la red de seguridad. */
export async function extenderTraspaso(id) {
  const dias = await diasTraspaso()
  await pool.query(
    `UPDATE public.agente_wa_traspasos SET hasta = now() + make_interval(days => $2) WHERE id = $1 AND cerrado_en IS NULL`,
    [id, dias])
}

/** Veterinarias → comercial. */
export async function pasarAComercial({ phoneNumberId, contacto, desdeAgenteId, haciaAgenteId, motivo }) {
  if (!haciaAgenteId) return { ok: false, error: 'El agente comercial no está disponible: atiéndela tú.' }
  const dias = await diasTraspaso()
  await pool.query(
    `INSERT INTO public.agente_wa_traspasos (phone_number_id, contacto, agente_id, desde_agente_id, motivo, hasta)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     ON CONFLICT (phone_number_id, contacto) WHERE cerrado_en IS NULL
     DO UPDATE SET agente_id = EXCLUDED.agente_id, motivo = EXCLUDED.motivo, hasta = EXCLUDED.hasta`,
    [phoneNumberId, contacto, haciaAgenteId, desdeAgenteId, txt(motivo, 300), dias])
  const f = await fichaPorNumero(contacto)
  const resumen = `🤖 El agente de veterinarias pasó la conversación al agente comercial: ${txt(motivo, 300) || 'tema comercial'}`
  if (f.aliado || f.prospecto) {
    await pool.query(
      `INSERT INTO public.crm_actividades (aliado_id, prospecto_id, tipo, resumen, origen)
       VALUES ($1, $2, 'WHATSAPP', $3, 'AGENTE')`, [f.aliado?.id_aliado || null, f.prospecto?.id || null, resumen])
  }
  // Una aliada hablando de algo comercial es una oportunidad: que el área
  // comercial lo vea en su Agenda (uno solo pendiente por cuenta, sin duplicar).
  if (f.aliado) {
    await pool.query(
      `INSERT INTO public.crm_seguimientos (aliado_id, tipo, titulo, notas, programado_para, origen)
       SELECT $1, 'WHATSAPP', $2, $3, now() + interval '2 hours', 'AGENTE'
        WHERE NOT EXISTS (SELECT 1 FROM public.crm_seguimientos
                           WHERE aliado_id = $1 AND estado = 'PENDIENTE' AND origen = 'AGENTE')
          AND NOT EXISTS (SELECT 1 FROM public.aliados WHERE id_aliado = $1 AND no_contactar)`,
      [f.aliado.id_aliado, 'Revisar conversación comercial por WhatsApp', txt(motivo, 300)])
  }
  log(MOD, `${contacto} → agente comercial (${txt(motivo, 80) || 'sin motivo'})`)
  return { ok: true, nota: 'Listo: el área comercial le responde este mismo mensaje. NO escribas nada más.' }
}

/** Comercial → veterinarias. Solo existe si hubo traspaso: un prospecto es del comercial. */
export async function devolverAOperacion({ phoneNumberId, contacto, motivo }) {
  const { rowCount } = await pool.query(
    `UPDATE public.agente_wa_traspasos SET cerrado_en = now(), cerrado_motivo = $3
      WHERE phone_number_id = $1 AND contacto = $2 AND cerrado_en IS NULL`,
    [phoneNumberId, contacto, txt(motivo, 300) || 'Devuelta a operación'])
  if (!rowCount) {
    return { ok: false, error: 'Esta clínica es un prospecto y la atiendes tú. Si pide una recogida, tómala con registrar_solicitud.' }
  }
  const f = await fichaPorNumero(contacto)
  if (f.aliado || f.prospecto) {
    await pool.query(
      `INSERT INTO public.crm_actividades (aliado_id, prospecto_id, tipo, resumen, origen)
       VALUES ($1, $2, 'WHATSAPP', $3, 'AGENTE')`,
      [f.aliado?.id_aliado || null, f.prospecto?.id || null, `🤖 El agente comercial devolvió la conversación a operación: ${txt(motivo, 300) || ''}`.trim()])
  }
  log(MOD, `${contacto} → de vuelta a operación (${txt(motivo, 80) || ''})`)
  return { ok: true, nota: 'Listo: el agente de operación le responde este mismo mensaje. NO escribas nada más.' }
}

/** Lo que sabe el comercial de una aliada que le pasaron. */
export async function contextoAliadaParaVentas(phoneNumberId, contacto) {
  const f = await fichaPorNumero(contacto)
  if (!f.aliado) return null
  const t = await traspasoVivo(phoneNumberId, contacto)
  const a = f.aliado
  return `Este número es de la veterinaria ALIADA "${a.nombre}" (ya registrada${a.vip ? ', VIP' : ''}; comisión `
    + `${a.modalidad_comision === 'FACTURACION_MENSUAL' ? 'por facturación mensual' : 'descontada en cada servicio'}). `
    + `No le ofrezcas afiliarse.${t?.motivo ? ` Te la pasaron por: ${t.motivo}.` : ''} No des cifras de comisiones `
    + 'pendientes: si reclama un pago, usa reportar_reclamo.'
}

const CATEGORIAS_RECLAMO = ['COMISION', 'PAGO', 'FACTURACION', 'RECOGIDA', 'ENTREGA', 'CERTIFICADO', 'RECORDATORIOS', 'ATENCION', 'OTRO']

/**
 * Un reclamo dicho por WhatsApp: ticket ALTA + alerta para revisarlo. Si ya hay
 * un ticket abierto del mismo tema en las últimas 48 h, se le suma como nota en
 * vez de abrir otro (la vet insiste en el mismo reclamo).
 */
export async function reportarReclamo({ contacto, entrada = {} }) {
  const categoria = CATEGORIAS_RECLAMO.includes(entrada.categoria) ? entrada.categoria : 'OTRO'
  const asunto = txt(entrada.asunto, 200) || 'Reclamo por WhatsApp'
  const detalle = txt(entrada.detalle, 3000)
  const f = await fichaPorNumero(contacto)

  if (!f.aliado) {
    // Sin aliada no hay ticket (el ticket cuelga de una veterinaria): queda en la
    // bitácora del prospecto, si lo es, y como alerta para el área comercial.
    if (f.prospecto) {
      await pool.query(
        `INSERT INTO public.crm_actividades (prospecto_id, tipo, resultado, resumen, origen)
         VALUES ($1, 'WHATSAPP', 'QUEJA', $2, 'AGENTE')`, [f.prospecto.id, `Reclamo: ${asunto}${detalle ? ` — ${detalle}` : ''}`])
      await pool.query(
        `INSERT INTO public.crm_seguimientos (prospecto_id, tipo, titulo, notas, programado_para, origen)
         VALUES ($1, 'LLAMADA', $2, $3, now(), 'AGENTE')`, [f.prospecto.id, `Revisar reclamo: ${asunto}`, detalle])
    }
    return { ok: true, nota: 'Quedó registrado para el equipo. Dile que lo revisan y le responden; no prometas fechas ni montos.' }
  }

  const { rows: [abierto] } = await pool.query(
    `SELECT id, numero FROM public.crm_tickets
      WHERE aliado_id = $1 AND categoria = $2 AND estado NOT IN ('RESUELTO','CERRADO')
        AND created_at > now() - interval '48 hours'
      ORDER BY created_at DESC LIMIT 1`, [f.aliado.id_aliado, categoria])
  if (abierto) {
    await pool.query(
      `INSERT INTO public.crm_ticket_eventos (ticket_id, tipo, texto) VALUES ($1, 'COMENTARIO', $2)`,
      [abierto.id, `🤖 La veterinaria volvió a escribir por WhatsApp: ${asunto}${detalle ? ` — ${detalle}` : ''}`])
    return { ok: true, ticket: abierto.numero,
      nota: `Ya había un caso abierto (#${abierto.numero}); se le sumó lo que dijo. Dile que el equipo ya lo está revisando.` }
  }

  const r = await crearTicket({
    aliado_id: f.aliado.id_aliado, tipo: 'RECLAMO', categoria, prioridad: 'ALTA', canal: 'WHATSAPP',
    asunto, descripcion: `${detalle || asunto}\n\n(Registrado por el agente de WhatsApp)`,
  }, null)
  if (r.status !== 201) return { ok: false, error: r.body?.error || 'No se pudo registrar' }
  // La alerta: aparece en la Agenda y suena en la campana del CRM ya mismo.
  await crearSeguimiento({
    ticket_id: r.body.ticket.id, aliado_id: f.aliado.id_aliado, tipo: 'TAREA',
    titulo: `Revisar reclamo #${r.body.ticket.numero}: ${asunto}`, programado_para: new Date().toISOString(), notas: detalle,
  }, null, { origen: 'AGENTE' })
  log(MOD, `reclamo de ${f.aliado.nombre} → ticket #${r.body.ticket.numero} (${categoria})`)
  return { ok: true, ticket: r.body.ticket.numero,
    nota: `Quedó registrado como caso #${r.body.ticket.numero}. Dile que el equipo lo revisa y le responde; no prometas fechas ni montos.` }
}

// ─── Familias en la línea de veterinarias (migración 184) ───────────────────
/**
 * La veterinaria que nombró una familia ("mi mascota está en Patitas"), contra
 * las aliadas. Por parecido (pg_trgm), quitando las palabras que todas comparten
 * ("clínica", "veterinaria"…). Solo se acepta si el mejor candidato es claro:
 * ante la duda no se le atribuye nada a nadie — una comisión mal puesta es peor
 * que una por asignar.
 */
async function aliadaPorNombre(nombre) {
  const limpio = s => `lower(translate(regexp_replace(${s}, '\\m(cl[ií]nica|veterinari[ao]s?|vet|centro|hospital|consultorio|m[eé]dico|sas|s\\.a\\.s)\\M', ' ', 'gi'), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))`
  const { rows } = await pool.query(
    `SELECT id_aliado, nombre, similarity(${limpio('nombre')}, ${limpio('$1')}) AS sim
       FROM public.aliados WHERE activo
      ORDER BY sim DESC LIMIT 2`, [String(nombre || '')])
  const [a, b] = rows
  // Claramente ninguna aliada se le parece: es otra veterinaria (prospecto).
  if (!a || Number(a.sim) < 0.3) return { ninguna: true }
  // Parecida a una, o a dos a la vez ("Patitas" vs "Patotas" y "Paticas"): no se adivina.
  if (Number(a.sim) < 0.45 || (b && Number(a.sim) - Number(b.sim) < 0.1)) {
    return { dudosa: [a, b].filter(Boolean).map(x => x.nombre) }
  }
  return { aliado: a }
}

/**
 * Una FAMILIA escribió a la línea de veterinarias. Se le da el enlace de
 * atención al cliente con su mensaje ya escrito, se marca la conversación y se
 * anota quién la refirió.
 */
export async function derivarFamilia({ phoneNumberId, contacto, entrada = {} }) {
  const num = digitos(contacto)
  const { rows: [cfg] } = await pool.query(
    `SELECT valor FROM public.config_operativa WHERE modulo = 'CRM' AND clave = 'linea_atencion_cliente'`)
  const linea = aWhatsapp(typeof cfg?.valor === 'string' ? cfg.valor : '573193585508')
  const resumen = txt(entrada.resumen, 400)
  const vet = txt(entrada.veterinaria, 120)
  const mensaje = ['Hola, escribí a la línea de veterinarias y me indicaron este número.', resumen,
    vet ? `Mi mascota está en / me refirió la veterinaria ${vet}.` : null].filter(Boolean).join(' ')
  const enlace = `https://wa.me/${linea}?text=${encodeURIComponent(mensaje)}`

  // Que no vuelva a pasar por el filtro: la conversación queda marcada.
  await etiquetar({ contacto: num, linea: phoneNumberId, clave: 'PARTICULAR', origen: 'AGENTE',
    motivo: (resumen || 'Familia derivada a atención al cliente').slice(0, 200) }).catch(e => log(MOD, 'no se pudo marcar PARTICULAR —', e.message))

  // Si se había colado como prospecto (pidió "el enlace" y parecía una clínica), se retira.
  const t = tel10(num)
  if (t && t.length === 10) {
    await pool.query(
      `UPDATE public.crm_prospectos
          SET etapa = 'PERDIDO', etapa_desde = now(), motivo_perdida = 'Era una familia (particular), no una clínica'
        WHERE (public.wa_tel10(whatsapp) = $1 OR public.wa_tel10(telefono) = $1)
          AND fuente IN ('WHATSAPP','AGENTE') AND etapa NOT IN ('GANADO','PERDIDO')`, [t])
    await pool.query(
      `UPDATE public.agente_wa_traspasos SET cerrado_en = now(), cerrado_motivo = 'Era una familia'
        WHERE phone_number_id = $1 AND contacto = $2 AND cerrado_en IS NULL`, [phoneNumberId, num])
  }

  // La veterinaria que la refirió: comisión (si es aliada) u oportunidad (si no lo es).
  let referida = null
  if (vet) {
    const m = await aliadaPorNombre(vet)
    const a = m.aliado
    const nota = `📣 Una familia (WhatsApp ${num}) dijo que su mascota está en esta veterinaria / que la refirió`
      + `${resumen ? `: ${resumen}` : ''}. Se derivó a atención al cliente (${linea}) — asignar la veterinaria al servicio para su comisión.`
    if (a) {
      await pool.query(
        `INSERT INTO public.crm_actividades (aliado_id, tipo, resumen, origen) VALUES ($1, 'WHATSAPP', $2, 'AGENTE')`,
        [a.id_aliado, nota.slice(0, 1000)])
      referida = { aliada: a.nombre }
    } else if (m.dudosa) {
      // Ni se atribuye ni se crea un prospecto: lo resuelve una persona al
      // tomar el servicio (el mensaje a atención al cliente lleva el nombre).
      log(MOD, `${num}: la familia nombró "${vet}" — parecida a ${m.dudosa.join(' / ')}, no se atribuye sola`)
      referida = { dudosa: m.dudosa }
    } else {
      const r = await crearProspecto({
        nombre: vet, fuente_detalle: `Una familia dijo que su mascota estaba allí (WhatsApp ${num})`, notas: resumen,
      }, null, { fuente: 'REFERIDO' })
      const pid = r.body?.prospecto?.id || (r.body?.duplicado?.tipo === 'PROSPECTO' ? r.body.duplicado.id : null)
      const aid = r.body?.duplicado?.tipo === 'ALIADO' ? r.body.duplicado.id : null
      if (pid || aid) {
        await pool.query(
          `INSERT INTO public.crm_actividades (prospecto_id, aliado_id, tipo, resumen, origen) VALUES ($1, $2, 'WHATSAPP', $3, 'AGENTE')`,
          [pid, aid, nota.slice(0, 1000)])
      }
      referida = { prospecto: vet }
    }
  }
  log(MOD, `${num}: familia derivada a atención al cliente${vet ? ` (refirió: ${vet} → ${referida?.aliada ? 'aliada ' + referida.aliada : referida?.dudosa ? 'dudosa' : 'prospecto'})` : ''}`)

  // El enlace lo manda el SISTEMA como botón, con el mensaje del agente encima.
  // Pedirle al modelo que lo pegara salió mal en el ensayo: lo recortó a
  // "wa.me/573193585508" y la familia perdía el mensaje ya escrito.
  const cuerpo = txt(entrada.mensaje, 900)
    || 'Esta línea es exclusiva para clínicas veterinarias. Para atenderte de inmediato, toca el botón y '
      + 'escríbenos a nuestra línea de atención al cliente: tu mensaje ya va escrito. 🐾'
  const env = await enviarSobre({
    contacto: num, linea: phoneNumberId, tipo: 'interactive', personalId: null,
    texto: `${cuerpo} [botón: Atención al cliente]`,
    payload: { type: 'interactive', interactive: {
      type: 'cta_url', body: { text: cuerpo },
      action: { name: 'cta_url', parameters: { display_text: 'Atención al cliente', url: enlace } },
    } },
  }).catch(e => ({ body: { ok: false, error: e.message } }))
  if (env?.body?.ok) {
    return { ok: true, enviado: true,
      nota: 'Tu mensaje y el botón a atención al cliente YA le llegaron. NO escribas nada más.' }
  }
  log(MOD, `${num}: no salió el botón de atención al cliente — ${env?.body?.error || '?'}`)
  return { ok: true, enviado: false, enlace,
    nota: 'No se pudo mandar el botón. Escríbele tu mensaje y pega este enlace COMPLETO, carácter por carácter: ' + enlace }
}

// ─── Campañas ────────────────────────────────────────────────────────────────
const TIPOS_AUDIENCIA = ['TODAS', 'ACTIVAS', 'ENFRIANDOSE', 'EN_RIESGO', 'DORMIDAS', 'PROSPECTOS', 'MANUAL']
const ESTADOS_CAMPANA = ['BORRADOR', 'LISTA', 'ENVIANDO', 'COMPLETADA', 'CANCELADA']

export async function listarCampanas() {
  const { rows } = await pool.query(
    `SELECT c.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS creado_por_nombre,
            a.nombre AS agente_nombre
       FROM public.crm_campanas c
       LEFT JOIN public.personal p ON p.id = c.creado_por
       LEFT JOIN public.agente_wa a ON a.id = c.agente_id
      ORDER BY c.created_at DESC LIMIT 200`)
  return rows
}

export async function crearCampana(d = {}, personalId) {
  const nombre = txt(d.nombre, 160)
  if (!nombre) return { status: 422, body: { ok: false, error: 'Falta el nombre de la campaña' } }
  const tipoAudiencia = TIPOS_AUDIENCIA.includes(d.tipo_audiencia) ? d.tipo_audiencia : 'ACTIVAS'
  const { rows: [c] } = await pool.query(
    `INSERT INTO public.crm_campanas
       (nombre, descripcion, tipo_audiencia, plantilla_nombre, idioma, variables_plantilla, agente_id, programada_para, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [nombre, txt(d.descripcion, 1000), tipoAudiencia, txt(d.plantilla_nombre, 200) || null,
     txt(d.idioma, 10) || 'es_MX',
     d.variables_plantilla && typeof d.variables_plantilla === 'object' ? JSON.stringify(d.variables_plantilla) : null,
     entero(d.agente_id) || null, fecha(d.programada_para), personalId])
  return { status: 201, body: { ok: true, campana: c } }
}

export async function actualizarCampana(id, d = {}) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'Campaña inválida' } }
  const { rows: [actual] } = await pool.query(`SELECT estado FROM public.crm_campanas WHERE id = $1`, [cid])
  if (!actual) return { status: 404, body: { ok: false, error: 'No existe esa campaña' } }
  if (['ENVIANDO', 'COMPLETADA'].includes(actual.estado)) {
    return { status: 409, body: { ok: false, error: 'No se puede editar una campaña ya enviada' } }
  }
  const sets = []; const vals = []
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if (d.nombre !== undefined) { const n = txt(d.nombre, 160); if (!n) return { status: 422, body: { ok: false, error: 'Nombre vacío' } }; add('nombre', n) }
  if (d.descripcion !== undefined) add('descripcion', txt(d.descripcion, 1000))
  if (d.tipo_audiencia !== undefined && TIPOS_AUDIENCIA.includes(d.tipo_audiencia)) add('tipo_audiencia', d.tipo_audiencia)
  if (d.estado !== undefined && ESTADOS_CAMPANA.includes(d.estado)) add('estado', d.estado)
  if (d.plantilla_nombre !== undefined) add('plantilla_nombre', txt(d.plantilla_nombre, 200) || null)
  if (d.idioma !== undefined) add('idioma', txt(d.idioma, 10) || 'es_MX')
  if (d.variables_plantilla !== undefined) add('variables_plantilla', d.variables_plantilla && typeof d.variables_plantilla === 'object' ? JSON.stringify(d.variables_plantilla) : null)
  if (d.agente_id !== undefined) add('agente_id', entero(d.agente_id) || null)
  if (d.programada_para !== undefined) add('programada_para', fecha(d.programada_para))
  if (!sets.length) return { status: 400, body: { ok: false, error: 'Nada que guardar' } }
  add('updated_at', new Date().toISOString())
  vals.push(cid)
  const { rows: [c] } = await pool.query(`UPDATE public.crm_campanas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
  return { status: 200, body: { ok: true, campana: c } }
}

export async function borrarCampana(id) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'Campaña inválida' } }
  const { rows: [c] } = await pool.query(`SELECT estado FROM public.crm_campanas WHERE id = $1`, [cid])
  if (!c) return { status: 404, body: { ok: false, error: 'No existe esa campaña' } }
  if (c.estado === 'ENVIANDO') return { status: 409, body: { ok: false, error: 'No se puede borrar mientras se está enviando' } }
  await pool.query(`DELETE FROM public.crm_campanas WHERE id = $1`, [cid])
  return { status: 200, body: { ok: true } }
}

export async function detalleCampana(id) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'Campaña inválida' } }
  const { rows: [c] } = await pool.query(
    `SELECT c.*, TRIM(CONCAT_WS(' ', p.nombre, p.apellido)) AS creado_por_nombre, a.nombre AS agente_nombre
       FROM public.crm_campanas c
       LEFT JOIN public.personal p ON p.id = c.creado_por
       LEFT JOIN public.agente_wa a ON a.id = c.agente_id
      WHERE c.id = $1`, [cid])
  if (!c) return { status: 404, body: { ok: false, error: 'No existe esa campaña' } }
  const { rows: envios } = await pool.query(
    `SELECT e.*, al.nombre AS nombre_aliado
       FROM public.crm_campana_envios e
       LEFT JOIN public.aliados al ON al.id_aliado = e.aliado_id
      WHERE e.campana_id = $1 ORDER BY e.created_at DESC LIMIT 500`, [cid])
  return { status: 200, body: { ok: true, campana: c, envios } }
}

/** Vista previa: cuántos destinatarios quedarían según la audiencia. */
export async function previaCampana(id) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'Campaña inválida' } }
  const { rows: [c] } = await pool.query(`SELECT tipo_audiencia FROM public.crm_campanas WHERE id = $1`, [cid])
  if (!c) return { status: 404, body: { ok: false, error: 'No existe esa campaña' } }
  const destinatarios = await obtenerDestinatarios(c.tipo_audiencia, cid)
  return { status: 200, body: { ok: true, total: destinatarios.length, destinatarios: destinatarios.slice(0, 50) } }
}

/** Construye la lista de destinatarios según el tipo de audiencia. */
async function obtenerDestinatarios(tipoAudiencia, campanaId) {
  const hoy = `(now() AT TIME ZONE 'America/Bogota')::date`
  if (tipoAudiencia === 'MANUAL') {
    const { rows } = await pool.query(
      `SELECT e.numero_wa, e.nombre_destino, e.aliado_id, e.prospecto_id
         FROM public.crm_campana_envios e WHERE e.campana_id = $1 AND e.estado = 'PENDIENTE'`, [campanaId])
    return rows
  }
  if (tipoAudiencia === 'PROSPECTOS') {
    const { rows } = await pool.query(
      `SELECT whatsapp AS numero_wa, nombre AS nombre_destino, NULL::uuid AS aliado_id, id AS prospecto_id
         FROM public.crm_prospectos
        WHERE whatsapp IS NOT NULL AND etapa NOT IN ('GANADO','PERDIDO') AND NOT COALESCE(no_contactar, false)
        ORDER BY created_at DESC LIMIT 500`)
    return rows
  }
  // Aliados: filtrar por segmento usando días sin actividad
  const condicion = {
    TODAS:       `true`,
    ACTIVAS:     `(${hoy} - agg.ultimo) < 60`,
    ENFRIANDOSE: `(${hoy} - agg.ultimo) BETWEEN 30 AND 59`,
    EN_RIESGO:   `(${hoy} - agg.ultimo) BETWEEN 60 AND 89`,
    DORMIDAS:    `(${hoy} - agg.ultimo) >= 90`,
  }[tipoAudiencia] || `true`
  const { rows } = await pool.query(
    `WITH agg AS (
       SELECT s.aliado_origen_id AS aliado_id, max(s.fecha_ingreso::date) AS ultimo
         FROM public.servicios s
        WHERE s.estado <> 'CANCELADO' GROUP BY 1
     )
     SELECT a.whatsapp AS numero_wa, a.nombre AS nombre_destino, a.id_aliado AS aliado_id, NULL::uuid AS prospecto_id
       FROM public.aliados a
       LEFT JOIN agg ON agg.aliado_id = a.id_aliado
      WHERE a.whatsapp IS NOT NULL
        AND NOT COALESCE(a.no_contactar, false)
        AND ${condicion}
      ORDER BY a.nombre LIMIT 1000`)
  return rows
}

export async function enviarCampana(id, personalId) {
  const cid = uuid(id)
  if (!cid) return { status: 400, body: { ok: false, error: 'Campaña inválida' } }
  const { rows: [c] } = await pool.query(`SELECT * FROM public.crm_campanas WHERE id = $1`, [cid])
  if (!c) return { status: 404, body: { ok: false, error: 'No existe esa campaña' } }
  if (!['BORRADOR', 'LISTA'].includes(c.estado)) {
    return { status: 409, body: { ok: false, error: `La campaña está ${c.estado}: solo se pueden enviar las en BORRADOR o LISTA` } }
  }
  if (!c.plantilla_nombre) {
    return { status: 422, body: { ok: false, error: 'La campaña no tiene plantilla asignada' } }
  }

  await pool.query(`UPDATE public.crm_campanas SET estado = 'ENVIANDO', updated_at = now() WHERE id = $1`, [cid])

  const destinatarios = await obtenerDestinatarios(c.tipo_audiencia, cid)
  if (!destinatarios.length) {
    await pool.query(`UPDATE public.crm_campanas SET estado = 'COMPLETADA', total = 0, updated_at = now() WHERE id = $1`, [cid])
    return { status: 200, body: { ok: true, total: 0, enviados: 0, fallidos: 0 } }
  }

  // Vaciar envíos anteriores (re-envío desde LISTA)
  await pool.query(`DELETE FROM public.crm_campana_envios WHERE campana_id = $1`, [cid])

  let enviados = 0, fallidos = 0
  const vars = c.variables_plantilla || {}

  for (const dest of destinatarios) {
    const nombre = dest.nombre_destino || ''
    // Reemplaza el token {{nombre}} con el nombre real del destinatario
    const valores = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, String(v || '').replace(/\{\{nombre\}\}/gi, nombre)])
    )
    try {
      const r = await enviarPlantilla({
        contacto: dest.numero_wa,
        nombre: c.plantilla_nombre,
        idioma: c.idioma || 'es_MX',
        valores,
        agenteId: c.agente_id || null,
        personalId,
      })
      const exito = r.status === 200 && r.body?.ok
      await pool.query(
        `INSERT INTO public.crm_campana_envios
           (campana_id, aliado_id, prospecto_id, nombre_destino, numero_wa, estado, wam_id, enviado_en, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [cid, dest.aliado_id || null, dest.prospecto_id || null, nombre, dest.numero_wa,
         exito ? 'ENVIADO' : 'FALLIDO', r.body?.wa_message_id || null,
         exito ? new Date().toISOString() : null, exito ? null : (r.body?.error || 'Error desconocido')])
      if (exito) enviados++; else fallidos++
    } catch (e) {
      await pool.query(
        `INSERT INTO public.crm_campana_envios (campana_id, aliado_id, prospecto_id, nombre_destino, numero_wa, estado, error)
         VALUES ($1,$2,$3,$4,$5,'FALLIDO',$6)`,
        [cid, dest.aliado_id || null, dest.prospecto_id || null, nombre, dest.numero_wa, e.message.slice(0, 300)])
      fallidos++
    }
  }

  await pool.query(
    `UPDATE public.crm_campanas SET estado = 'COMPLETADA', total = $2, enviados = $3, fallidos = $4, updated_at = now() WHERE id = $1`,
    [cid, destinatarios.length, enviados, fallidos])

  log(MOD, `campaña ${c.nombre}: ${destinatarios.length} dest, ${enviados} ok, ${fallidos} fallidos`)
  return { status: 200, body: { ok: true, total: destinatarios.length, enviados, fallidos } }
}

// ─── Rutas ──────────────────────────────────────────────────────────────────
export function crearRouterCrm({ requireAuth, requireRol, errorInterno }) {
  const r = express.Router()
  const rol = requireRol(...ROLES_CRM)
  r.use(requireAuth, rol)
  const responder = (tag, fn) => async (req, res) => {
    try {
      const out = await fn(req)
      if (out && typeof out.status === 'number' && out.body) return res.status(out.status).json(out.body)
      res.json(out)
    } catch (e) { errorInterno(res, `crm/${tag}`, e) }
  }
  const P = req => req.personal

  r.get('/resumen', responder('resumen', req => resumenGeneral(P(req))))
  r.get('/cartera', responder('cartera', async () => ({ ok: true, aliados: await cartera(), config: await leerConfig() })))
  r.get('/alertas', responder('alertas', req => alertas(P(req))))
  r.get('/equipo', responder('equipo', async () => ({ ok: true, equipo: await equipo() })))
  r.get('/config', responder('config', async () => ({ ok: true, config: await leerConfig() })))
  r.put('/config', responder('config-guardar', req => guardarConfig(req.body || {}, P(req).id)))
  r.get('/servicios', responder('servicios', async req => ({ ok: true, servicios: await servicios({
    desde: req.query.desde, hasta: req.query.hasta, aliadoId: req.query.aliado, estado: req.query.estado, q: req.query.q }) })))

  r.get('/aliados/:id', responder('ficha', req => fichaAliado(req.params.id)))
  r.put('/aliados/:id', responder('ficha-guardar', req => actualizarFicha(req.params.id, req.body || {}, P(req).id)))
  r.delete('/aliados/:id', responder('aliada-eliminar', req => borrarAliado(req.params.id)))
  r.post('/aliados/:id/plantilla', responder('plantilla', req => enviarPlantillaCrm({ ...req.body, aliado_id: req.params.id }, P(req).id)))
  r.post('/aliados/:id/material', responder('material', req => enviarMaterialCrm({ ...req.body, aliado_id: req.params.id }, P(req).id)))

  r.get('/prospectos', responder('prospectos', async req => ({ ok: true, prospectos: await listarProspectos({ etapa: req.query.etapa, q: req.query.q }) })))
  r.post('/prospectos', responder('prospecto-crear', req => crearProspecto(req.body || {}, P(req).id, {
    fuente: FUENTES.includes(req.body?.fuente) ? req.body.fuente : 'MANUAL', permitirDuplicado: !!req.body?.forzar })))
  r.post('/prospectos/importar', responder('importar', req => importarProspectos({
    filas: req.body?.filas, nombreArchivo: req.body?.nombre_archivo, fuente: req.body?.fuente,
    fuenteDetalle: req.body?.fuente_detalle, responsableId: uuid(req.body?.responsable_id) }, P(req).id)))
  r.get('/prospectos/:id', responder('prospecto', async req => {
    const id = uuid(req.params.id)
    const { rows: [p] } = await pool.query(
      `SELECT p.*, TRIM(CONCAT_WS(' ', r.nombre, r.apellido)) AS responsable FROM public.crm_prospectos p
         LEFT JOIN public.personal r ON r.id = p.responsable_id WHERE p.id = $1`, [id])
    if (!p) return { status: 404, body: { ok: false, error: 'No existe ese prospecto' } }
    const [acts, segs, fotos, conv] = await Promise.all([
      listarActividades({ prospectoId: id }),
      pool.query(`SELECT * FROM public.crm_seguimientos WHERE prospecto_id = $1 ORDER BY (estado='PENDIENTE') DESC, programado_para DESC`, [id]),
      pool.query(`SELECT id, descripcion, es_portada, created_at FROM public.crm_fotos WHERE prospecto_id = $1 ORDER BY es_portada DESC, created_at DESC`, [id]),
      pool.query(
        `SELECT contacto, phone_number_id, ultimo_mensaje_en, ventana_abierta, sin_leer, ultimo_texto
           FROM public.whatsapp_contactos c
           LEFT JOIN LATERAL (SELECT ventana_abierta, sin_leer, ultimo_texto FROM public.v_whatsapp_conversaciones v
                               WHERE v.contacto = c.contacto AND v.phone_number_id = c.phone_number_id) v ON true
          WHERE public.wa_tel10(c.contacto) IN (public.wa_tel10($1), public.wa_tel10($2))
            AND c.phone_number_id = (SELECT (phone_number_ids)[1] FROM public.agente_wa WHERE clave = 'VETERINARIAS')
          ORDER BY ultimo_mensaje_en DESC NULLS LAST LIMIT 3`, [p.whatsapp || '', p.telefono || '']).catch(() => ({ rows: [] })),
    ])
    return { status: 200, body: { ok: true, prospecto: { ...p, probabilidad_efectiva: p.probabilidad ?? PROB_ETAPA[p.etapa] },
      actividades: acts, seguimientos: segs.rows, fotos: fotos.rows, conversaciones: conv.rows } }
  }))
  r.put('/prospectos/:id', responder('prospecto-guardar', req => actualizarProspecto(req.params.id, req.body || {})))
  r.post('/prospectos/:id/mover', responder('prospecto-mover', req => moverProspecto(req.params.id, req.body || {}, P(req).id)))
  r.post('/prospectos/:id/convertir', responder('prospecto-convertir', req => convertirProspecto(req.params.id, req.body || {}, P(req).id)))
  r.post('/prospectos/:id/plantilla', responder('prospecto-plantilla', req => enviarPlantillaCrm({ ...req.body, prospecto_id: req.params.id, aliado_id: null }, P(req).id)))
  r.post('/aliados/:id/contactos', responder('contacto-crear', req => crearContacto(req.params.id, req.body || {})))
  r.put('/aliados/:id/contactos/:cid', responder('contacto-editar', req => actualizarContacto(req.params.cid, req.body || {})))
  r.delete('/aliados/:id/contactos/:cid', responder('contacto-borrar', req => borrarContacto(req.params.cid)))
  r.post('/aliados/:id/bloqueo', responder('bloqueo', req => cambiarBloqueo({ aliadoId: req.params.id, bloquear: !!req.body?.bloquear, motivo: req.body?.motivo }, P(req).id)))
  r.post('/prospectos/:id/bloqueo', responder('prospecto-bloqueo', req => cambiarBloqueo({ prospectoId: req.params.id, bloquear: !!req.body?.bloquear, motivo: req.body?.motivo }, P(req).id)))
  r.post('/prospectos/:id/material', responder('prospecto-material', req => enviarMaterialCrm({ ...req.body, prospecto_id: req.params.id, aliado_id: null }, P(req).id)))

  r.get('/actividades', responder('actividades', async req => ({ ok: true, actividades: await listarActividades({
    aliadoId: req.query.aliado, prospectoId: req.query.prospecto, limite: req.query.limite }) })))
  r.post('/actividades', responder('actividad', req => registrarActividad(req.body || {}, P(req).id)))

  r.get('/seguimientos', responder('seguimientos', async req => ({ ok: true, seguimientos: await listarSeguimientos({
    rango: req.query.rango, responsableId: req.query.mios === '1' ? P(req).id : null,
    desde: req.query.desde || null, hasta: req.query.hasta || null,
    tipos: req.query.tipos || null }) })))
  r.post('/seguimientos', responder('seguimiento', req => crearSeguimiento(req.body || {}, P(req).id)))
  r.put('/seguimientos/:id', responder('seguimiento-cambiar', req => actualizarSeguimiento(req.params.id, req.body || {}, P(req).id)))

  r.get('/tickets', responder('tickets', async req => ({ ok: true, tickets: await listarTickets({
    estado: req.query.estado, aliadoId: req.query.aliado, q: req.query.q }) })))
  r.post('/tickets', responder('ticket-crear', req => crearTicket(req.body || {}, P(req).id)))
  r.get('/tickets/:id', responder('ticket', req => detalleTicket(req.params.id)))
  r.put('/tickets/:id', responder('ticket-cambiar', req => actualizarTicket(req.params.id, req.body || {}, P(req).id)))

  r.post('/fotos', responder('foto-subir', req => subirFoto(req.body || {}, P(req).id)))
  r.get('/fotos/:id', async (req, res) => {
    try {
      const f = await leerFoto(req.params.id, { mini: req.query.mini === '1' })
      if (!f) return res.status(404).json({ ok: false, error: 'No existe esa foto' })
      res.set('Content-Type', f.mime)
      res.set('Cache-Control', 'private, max-age=86400')
      res.send(f.archivo)
    } catch (e) { errorInterno(res, 'crm/foto', e) }
  })
  r.delete('/fotos/:id', responder('foto-borrar', req => borrarFoto(req.params.id)))
  r.post('/fotos/:id/portada', responder('foto-portada', req => portadaFoto(req.params.id)))

  r.get('/hitos/reglas', responder('hitos-reglas', async () => ({ ok: true, reglas: await listarReglas() })))
  r.post('/hitos/reglas', responder('hito-crear', req => guardarRegla(null, req.body || {}, P(req).id)))
  r.put('/hitos/reglas/:id', responder('hito-guardar', req => guardarRegla(req.params.id, req.body || {}, P(req).id)))
  r.delete('/hitos/reglas/:id', responder('hito-borrar', req => borrarRegla(req.params.id)))
  r.get('/hitos/envios', responder('hitos-envios', async req => ({ ok: true, envios: await listarHitosEnvios({ estado: req.query.estado || null }) })))
  r.post('/hitos/evaluar', responder('hitos-evaluar', async () => ({ ok: true, ...(await evaluarHitos({ enviarAutomaticos: false })) })))
  r.post('/hitos/envios/:id/enviar', responder('hito-enviar', req => enviarHito(req.params.id, P(req).id)))
  r.post('/hitos/envios/:id/descartar', responder('hito-descartar', req => descartarHito(req.params.id, P(req).id)))

  r.post('/copiloto', responder('copiloto', req => copiloto(req.body || {})))
  // Los agentes que el CRM puede usar (plantillas, materiales). El delegado
  // (VENTAS) no tiene línea propia: se muestra con la de su dueño.
  r.get('/agentes', responder('agentes', async () => {
    const { rows } = await pool.query(
      `SELECT a.id, a.clave, a.nombre, a.activo, a.categoria, a.delegado_de,
              COALESCE(NULLIF(a.phone_number_ids, '{}'), d.phone_number_ids, '{}') AS phone_number_ids
         FROM public.agente_wa a LEFT JOIN public.agente_wa d ON d.id = a.delegado_de
        WHERE a.clave IN ('VETERINARIAS','VENTAS') ORDER BY a.id`)
    return { ok: true, agentes: rows }
  }))

  // ── Campañas ──────────────────────────────────────────────────────────────
  r.get('/campanas', responder('campanas', async () => ({ ok: true, campanas: await listarCampanas() })))
  r.post('/campanas', responder('campana-crear', req => crearCampana(req.body || {}, P(req).id)))
  r.get('/campanas/:id', responder('campana', req => detalleCampana(req.params.id)))
  r.put('/campanas/:id', responder('campana-guardar', req => actualizarCampana(req.params.id, req.body || {})))
  r.delete('/campanas/:id', responder('campana-borrar', req => borrarCampana(req.params.id)))
  r.post('/campanas/:id/enviar', responder('campana-enviar', req => enviarCampana(req.params.id, P(req).id)))
  r.post('/campanas/:id/previa', responder('campana-previa', req => previaCampana(req.params.id)))

  // ── Invitar aliada ─────────────────────────────────────────────────────────
  // Envía el enlace de afiliación por la API de WhatsApp de vets. Si la vet
  // nunca ha conversado con nosotros, linea se pasa explícitamente (lineaDe
  // falla para números sin historial).
  r.post('/invitar-aliada', responder('invitar-aliada', async req => {
    const { whatsapp } = req.body || {}
    if (!whatsapp) return { status: 400, body: { ok: false, error: 'Falta número de WhatsApp' } }
    const { linea } = await lineaVeterinarias()
    if (!linea) return { status: 500, body: { ok: false, error: 'Línea de veterinarias no configurada' } }
    const texto = `Hola 👋, te compartimos el enlace para registrar tu clínica o veterinaria en Camino al Cielo y pedir recogidas con facilidad:\nhttps://orbit.orbitacac.com/#/aliado`
    const r = await enviarTexto({ contacto: whatsapp, linea, texto, personalId: P(req).id })
    // Si no hay conversación previa, WA solo acepta plantillas; devolvemos la señal
    // para que el frontend abra wa.me en su lugar.
    if (r.status === 404 || r.body?.error?.includes('Conversación no encontrada')) {
      const num = String(whatsapp).replace(/\D/g, '')
      const n57 = num.length === 10 ? `57${num}` : num
      const msg = encodeURIComponent(`Hola 👋, te compartimos el enlace para registrar tu clínica o veterinaria en Camino al Cielo: https://orbit.orbitacac.com/#/aliado`)
      return { status: 200, body: { ok: false, sin_conversacion: true, wa_href: `https://wa.me/${n57}?text=${msg}` } }
    }
    return r
  }))

  return r
}
