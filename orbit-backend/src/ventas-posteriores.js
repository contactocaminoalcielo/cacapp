// VENTAS POSTERIORES — las oportunidades que deja la oferta posterior (migr. 210).
//
// REPORTE ORBIT 2026-11-17: «crear un módulo que permita visualizar todas las
// oportunidades generadas por esta automatización», por categoría
// (Recordatorios · Pre-exequiales · Cédulas), con su estado y su bitácora.
//
// Una venta = una oferta + una categoría (UNIQUE). Nace cuando la familia toca
// un botón de la plantilla o abre esa sección del portal.
//   · RECORDATORIOS y CÉDULAS terminan en una COMPRA del módulo Compras de
//     recordatorios (compras_recordatorios.venta_posterior_id). De ahí en
//     adelante —producción, pago, entrega— manda la compra: aquí no se duplica.
//   · PRE-EXEQUIALES sigue los nueve estados del reporte. 🔒 Orbit NUNCA crea
//     un contrato solo: el pago lo valida una persona, y el contrato lo crea
//     coordinación en /presequiales (esta pantalla solo le deja los datos
//     puestos y enlaza el contrato cuando existe).
//
// Este archivo tiene (1) los ayudantes que comparten el webhook, el portal y la
// pantalla, y (2) lo que hace coordinación en /ventas-posteriores.
import { pool, log } from './db.js'
import {
  CATEGORIAS, estadosDeCategoria, avanzaPorFamilia, puedePasarCoordinacion,
} from './oferta-posterior-reglas.js'

const TAG = '[ventas-posteriores]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = v => typeof v === 'string' && UUID.test(v)

export const NOMBRE_CATEGORIA = {
  RECORDATORIOS: 'Recordatorios adicionales',
  PREEXEQUIALES: 'Plan pre-exequial',
  CEDULAS: 'Cédula para mascota',
}

// ─── Ayudantes compartidos ──────────────────────────────────────────────────

export async function registrarEvento(client, { ventaId, tipo, detalle = null, por = null }) {
  // clock_timestamp() y no el DEFAULT now(): dentro de una transacción now() es
  // la hora de INICIO, así que dos eventos seguidos («formulario completo» →
  // «pendiente de pago») quedaban con la misma hora y la bitácora los barajaba.
  await client.query(
    `INSERT INTO public.venta_posterior_eventos (venta_id, tipo, detalle, por, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())`,
    [ventaId, tipo, detalle ? JSON.stringify(detalle) : null, por])
}

/**
 * La venta de (oferta, categoría): la crea si no existe. Idempotente por el
 * UNIQUE — dos toques seguidos al mismo botón no abren dos oportunidades.
 * Devuelve { venta, creada }.
 */
export async function asegurarVenta(client, { ofertaId, categoria, origen = 'PORTAL' }) {
  if (!CATEGORIAS.includes(categoria)) throw new Error(`Categoría inválida: ${categoria}`)
  const { rows: [nueva] } = await client.query(
    `INSERT INTO public.ventas_posteriores (oferta_id, categoria)
     VALUES ($1, $2)
     ON CONFLICT (oferta_id, categoria) DO NOTHING
     RETURNING *`, [ofertaId, categoria])
  if (nueva) {
    await registrarEvento(client, { ventaId: nueva.id, tipo: 'CREADA', detalle: { origen } })
    return { venta: nueva, creada: true }
  }
  const { rows: [venta] } = await client.query(
    `SELECT * FROM public.ventas_posteriores WHERE oferta_id = $1 AND categoria = $2 FOR UPDATE`,
    [ofertaId, categoria])
  return { venta, creada: false }
}

/**
 * Mueve la venta por algo que hizo la FAMILIA. Solo hacia adelante y nunca más
 * allá de «pago reportado» (reglas en `avanzaPorFamilia`). Devuelve la venta
 * (movida o tal cual).
 */
export async function moverPorFamilia(client, venta, nuevo, detalle = null) {
  if (!avanzaPorFamilia(venta.categoria, venta.estado, nuevo)) return venta
  const { rows: [v] } = await client.query(
    `UPDATE public.ventas_posteriores
        SET estado = $2, motivo_cierre = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`, [venta.id, nuevo])
  await registrarEvento(client, {
    ventaId: venta.id, tipo: 'ESTADO', detalle: { de: venta.estado, a: nuevo, ...(detalle || {}) },
  })
  return v
}

// A quién le toca cada categoría (reporte, punto 18): recordatorios y cédulas a
// Diseño/Producción; pre-exequiales a coordinación (decisión de David, 17-nov).
const ROLES_AVISO = {
  RECORDATORIOS: ['COORDINADOR', 'ADMIN', 'PRODUCTOR'],
  CEDULAS:       ['COORDINADOR', 'ADMIN', 'PRODUCTOR'],
  PREEXEQUIALES: ['COORDINADOR', 'ADMIN'],
}

/** La campana del equipo. Best-effort: avisar nunca rompe el flujo de la familia. */
export async function avisarEquipo({ categoria, servicioId, titulo, mensaje, ventaId = null }) {
  try {
    await pool.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, servicio_id, datos)
       SELECT p.id, 'VENTA_POSTERIOR', $1, $2, $3, $4::jsonb
         FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
        WHERE r.nombre = ANY($5::text[]) AND p.activo`,
      [String(titulo).slice(0, 200), String(mensaje || '').slice(0, 500), servicioId,
       JSON.stringify({ venta_id: ventaId, categoria }), ROLES_AVISO[categoria] || ROLES_AVISO.PREEXEQUIALES])
  } catch (e) { log(TAG, 'aviso al equipo no enviado:', e.message) }
}

/** El texto del aviso «🔔 NUEVA OPORTUNIDAD» del reporte. */
export function textoOportunidad({ propietario, mascota, categoria, telefono }) {
  return `Propietario: ${propietario || 'sin nombre'} · Mascotica del servicio: ${mascota || '—'} · `
    + `Interés: ${NOMBRE_CATEGORIA[categoria] || categoria} · Contacto: ${telefono || 'sin número'}`
}

// ─── /ventas-posteriores (coordinación) ─────────────────────────────────────

const BASE_LISTA = `
  FROM public.ventas_posteriores v
  JOIN public.ofertas_posteriores o ON o.id = v.oferta_id
  JOIN public.servicios s           ON s.id = o.servicio_id
  JOIN public.mascotas m            ON m.id_mascota = s.mascota_id
  LEFT JOIN public.clientes c       ON c.id_cliente = COALESCE(o.cliente_id, m.cliente_id)
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n,
           COALESCE(sum(k.total), 0)::numeric AS total,
           COALESCE(sum(k.valor_pagado), 0)::numeric AS pagado,
           string_agg('CR-' || k.numero, ', ' ORDER BY k.numero) AS numeros
      FROM public.compras_recordatorios k
     WHERE k.venta_posterior_id = v.id AND k.anulada_en IS NULL
  ) cr ON TRUE`

const ESTADOS_FILTRO = [...new Set([...estadosDeCategoria('PREEXEQUIALES'), ...estadosDeCategoria('CEDULAS')])]

export async function listarVentas({ categoria = null, estado = null, q = null } = {}) {
  const cat = CATEGORIAS.includes(categoria) ? categoria : null
  const est = estado === 'ABIERTAS' || ESTADOS_FILTRO.includes(estado) ? estado : null
  const texto = String(q || '').trim().slice(0, 80) || null
  const digitos = texto ? texto.replace(/\D/g, '') : ''

  const { rows: ventas } = await pool.query(
    `SELECT v.id, v.categoria, v.estado, v.valor_lista, v.descuento_pct, v.valor,
            v.numero_contrato, v.afiliacion_id, v.pago_validado_en, v.motivo_cierre,
            v.created_at, v.updated_at,
            (v.pago_cliente IS NOT NULL) AS pago_reportado,
            v.solicitud->'plan' AS plan,
            CASE WHEN jsonb_typeof(v.solicitud->'mascotas') = 'array'
                 THEN jsonb_array_length(v.solicitud->'mascotas') ELSE 0 END AS n_mascotas,
            o.id AS oferta_id, o.servicio_id, o.fecha_envio, o.respuesta,
            m.nombre AS mascota,
            TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
            c.whatsapp,
            cr.n AS compras, cr.total AS compras_total, cr.pagado AS compras_pagado, cr.numeros AS compras_numeros
       ${BASE_LISTA}
      WHERE ($1::text IS NULL OR v.categoria = $1)
        AND ($2::text IS NULL
             OR ($2 = 'ABIERTAS' AND v.estado NOT IN ('AFILIACION_ACTIVA', 'COMPRA_REGISTRADA', 'CERRADA_SIN_VENTA'))
             OR v.estado = $2)
        AND ($3::text IS NULL
             OR m.nombre ILIKE '%' || $3 || '%'
             OR c.nombre ILIKE '%' || $3 || '%'
             OR c.apellido ILIKE '%' || $3 || '%'
             OR ($4::text <> '' AND regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g') LIKE '%' || $4 || '%'))
      ORDER BY (v.estado IN ('PAGO_REPORTADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO', 'PAGO_VALIDADO', 'PENDIENTE_CONTRATO')) DESC,
               v.updated_at DESC
      LIMIT 500`,
    [cat, est, texto, digitos])

  // Los números del encabezado, sobre TODO (no sobre las 500 de la lista).
  const { rows: resumen } = await pool.query(
    `SELECT categoria, estado, count(*)::int AS n
       FROM public.ventas_posteriores GROUP BY 1, 2`)
  return { ventas, resumen }
}

/**
 * El número de la burbuja del menú: lo que espera una ACCIÓN del equipo.
 * No cuenta a quien solo tocó un botón o abrió el formulario (eso es interés,
 * no una tarea). Sí cuenta:
 *   · pre-exequiales con la solicitud completa y aún sin afiliación activa
 *     (llamar, validar el pago o crear el contrato);
 *   · compras de la oferta (recordatorios o cédulas) con pago sin confirmar.
 */
export const ESTADOS_PRE_PENDIENTES = [
  'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO', 'PAGO_REPORTADO',
  'PAGO_VALIDADO', 'PENDIENTE_CONTRATO', 'CONTRATO_GENERADO',
]
export async function contarPendientes() {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM public.ventas_posteriores
         WHERE categoria = 'PREEXEQUIALES' AND estado = ANY($1::text[])) AS preexequiales,
       (SELECT count(DISTINCT v.id)::int
          FROM public.ventas_posteriores v
          JOIN public.compras_recordatorios k ON k.venta_posterior_id = v.id AND k.anulada_en IS NULL
         WHERE v.categoria IN ('RECORDATORIOS', 'CEDULAS') AND v.estado <> 'CERRADA_SIN_VENTA'
           AND COALESCE(k.valor_pagado, 0) < COALESCE(k.total, 0)) AS compras`,
    [ESTADOS_PRE_PENDIENTES])
  return { total: r.preexequiales + r.compras, preexequiales: r.preexequiales, compras: r.compras }
}

export async function detalleVenta({ id }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const { rows: [v] } = await pool.query(
    `SELECT v.*, o.servicio_id, o.codigo, o.fecha_envio, o.respuesta, o.fecha_fallecimiento::text,
            o.estado AS oferta_estado,
            m.nombre AS mascota, p.nombre AS plan_servicio,
            c.id_cliente AS cliente_id, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
            c.cedula_nit AS cliente_cedula, c.whatsapp AS cliente_whatsapp, c.email AS cliente_email,
            pv.nombre AS pago_validado_por_nombre
       FROM public.ventas_posteriores v
       JOIN public.ofertas_posteriores o ON o.id = v.oferta_id
       JOIN public.servicios s           ON s.id = o.servicio_id
       JOIN public.mascotas m            ON m.id_mascota = s.mascota_id
       LEFT JOIN public.planes p         ON p.id = s.plan_id
       LEFT JOIN public.clientes c       ON c.id_cliente = COALESCE(o.cliente_id, m.cliente_id)
       LEFT JOIN public.personal pv      ON pv.id = v.pago_validado_por
      WHERE v.id = $1`, [id])
  if (!v) return { status: 404, body: { ok: false, error: 'Venta no encontrada' } }

  const [{ rows: eventos }, { rows: compras }] = await Promise.all([
    pool.query(
      `SELECT e.id, e.tipo, e.detalle, e.created_at, pe.nombre AS por_nombre
         FROM public.venta_posterior_eventos e
         LEFT JOIN public.personal pe ON pe.id = e.por
        WHERE e.venta_id = $1 ORDER BY e.created_at DESC, e.id LIMIT 200`, [id]),
    pool.query(
      `SELECT k.id, k.numero, k.total, k.valor_pagado, k.estado_pago, k.anulada_en, k.created_at,
              (SELECT string_agg(i.nombre || CASE WHEN i.cantidad > 1 THEN ' ×' || i.cantidad ELSE '' END, ', ' ORDER BY i.nombre)
                 FROM public.compra_recordatorio_items i WHERE i.compra_id = k.id) AS items
         FROM public.compras_recordatorios k
        WHERE k.venta_posterior_id = $1 ORDER BY k.created_at DESC`, [id]),
  ])
  return { status: 200, body: { ok: true, venta: v, eventos, compras, estados: estadosDeCategoria(v.categoria) } }
}

const ANTES_DE_VALIDAR = ['INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO', 'PAGO_REPORTADO']

/** Coordinación mueve la venta a mano (con nota). Cerrar sin venta exige motivo. */
export async function cambiarEstadoVenta({ id, estado, nota, personalId }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const texto = String(nota || '').trim().slice(0, 500) || null
  if (estado === 'CERRADA_SIN_VENTA' && !texto) {
    return { status: 400, body: { ok: false, error: 'Escribe por qué se cierra sin venta.' } }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [v] } = await client.query(
      `SELECT * FROM public.ventas_posteriores WHERE id = $1 FOR UPDATE`, [id])
    if (!v) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Venta no encontrada' } } }

    // Pasar a PAGO_VALIDADO por aquí ES validar el pago.
    const valida = estado === 'PAGO_VALIDADO'
    const r = puedePasarCoordinacion(v.categoria, v.estado, estado, { pagoValidado: valida || !!v.pago_validado_en })
    if (!r.ok) { await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: r.error } } }

    // Devolverla a antes del pago validado quita la validación (se marcó por
    // error). Cerrarla sin venta TAMBIÉN: si la familia vuelve y diligencia otra
    // solicitud, esa es una solicitud nueva que nadie ha pagado — una validación
    // vieja no puede autorizar su contrato.
    const quitaValidacion = v.categoria === 'PREEXEQUIALES'
      && (ANTES_DE_VALIDAR.includes(estado) || estado === 'CERRADA_SIN_VENTA')
    await client.query(
      `UPDATE public.ventas_posteriores
          SET estado = $2,
              motivo_cierre = CASE WHEN $2 = 'CERRADA_SIN_VENTA' THEN $3 ELSE NULL END,
              pago_validado_en  = CASE WHEN $4::boolean THEN now() WHEN $5::boolean THEN NULL ELSE pago_validado_en END,
              pago_validado_por = CASE WHEN $4::boolean THEN $6::uuid WHEN $5::boolean THEN NULL ELSE pago_validado_por END,
              updated_at = now()
        WHERE id = $1`,
      [id, estado, texto, valida && !v.pago_validado_en, quitaValidacion, personalId])
    await registrarEvento(client, {
      ventaId: id, tipo: 'ESTADO', por: personalId,
      detalle: { de: v.estado, a: estado, ...(texto ? { nota: texto } : {}) },
    })
    await client.query('COMMIT')
    log(TAG, 'estado', id, v.estado, '→', estado)
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * «Pago validado» del reporte: una persona confirma que la plata llegó. Deja la
 * venta en PENDIENTE_CONTRATO (el siguiente paso es crear el contrato).
 */
export async function validarPagoVenta({ id, nota, personalId }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const texto = String(nota || '').trim().slice(0, 500) || null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [v] } = await client.query(
      `SELECT * FROM public.ventas_posteriores WHERE id = $1 FOR UPDATE`, [id])
    if (!v) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Venta no encontrada' } } }
    if (v.categoria !== 'PREEXEQUIALES') {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'El pago de recordatorios y cédulas se registra en la compra, en Compras de recordatorios.' } }
    }
    if (!v.solicitud) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'La familia todavía no ha completado el formulario: no hay nada que cobrar.' } }
    }
    if (v.pago_validado_en) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'Este pago ya estaba validado.' } }
    }
    await client.query(
      `UPDATE public.ventas_posteriores
          SET estado = 'PENDIENTE_CONTRATO', pago_validado_en = now(), pago_validado_por = $2,
              motivo_cierre = NULL, updated_at = now()
        WHERE id = $1`, [id, personalId])
    await registrarEvento(client, {
      ventaId: id, tipo: 'PAGO_VALIDADO', por: personalId,
      detalle: { de: v.estado, a: 'PENDIENTE_CONTRATO', ...(texto ? { nota: texto } : {}) },
    })
    await client.query('COMMIT')
    log(TAG, 'pago validado', id)
    return { status: 200, body: { ok: true } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

export async function notaVenta({ id, texto, personalId }) {
  if (!esUuid(id)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const nota = String(texto || '').trim().slice(0, 1000)
  if (!nota) return { status: 400, body: { ok: false, error: 'Escribe la nota.' } }
  const { rowCount } = await pool.query(
    `UPDATE public.ventas_posteriores SET updated_at = now() WHERE id = $1`, [id])
  if (!rowCount) return { status: 404, body: { ok: false, error: 'Venta no encontrada' } }
  await registrarEvento(pool, { ventaId: id, tipo: 'NOTA', detalle: { nota }, por: personalId })
  return { status: 200, body: { ok: true } }
}

/**
 * Enlaza el contrato que coordinación acaba de crear en /presequiales. Un
 * contrato recién creado ya está VIGENTE, así que la venta queda en
 * AFILIACION_ACTIVA (y la bitácora guarda el paso por «contrato generado»).
 * 🔒 Sin pago validado responde 409: es la regla dura del reporte.
 */
export async function vincularAfiliacion({ id, afiliacionId, personalId }) {
  if (!esUuid(id) || !esUuid(afiliacionId)) return { status: 400, body: { ok: false, error: 'Id inválido' } }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [v] } = await client.query(
      `SELECT * FROM public.ventas_posteriores WHERE id = $1 FOR UPDATE`, [id])
    if (!v) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'Venta no encontrada' } } }
    if (v.categoria !== 'PREEXEQUIALES') {
      await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'Esta venta no es de un plan pre-exequial.' } }
    }
    if (!v.pago_validado_en) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'Primero hay que validar el pago: sin pago validado no hay contrato ni afiliación activa.' } }
    }
    const { rows: [a] } = await client.query(
      `SELECT a.id, a.estado,
              (SELECT k.numero_contrato FROM public.afiliacion_contratos k
                WHERE k.afiliacion_id = a.id ORDER BY k.numero DESC LIMIT 1) AS numero_contrato
         FROM public.afiliaciones a WHERE a.id = $1`, [afiliacionId])
    if (!a) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'No se encontró esa afiliación.' } } }

    await client.query(
      `UPDATE public.ventas_posteriores
          SET estado = 'AFILIACION_ACTIVA', afiliacion_id = $2, numero_contrato = $3,
              motivo_cierre = NULL, updated_at = now()
        WHERE id = $1`, [id, a.id, a.numero_contrato])
    await registrarEvento(client, {
      ventaId: id, tipo: 'CONTRATO_GENERADO', por: personalId,
      detalle: { de: v.estado, a: 'CONTRATO_GENERADO', numero_contrato: a.numero_contrato },
    })
    await registrarEvento(client, {
      ventaId: id, tipo: 'ESTADO', por: personalId,
      detalle: { de: 'CONTRATO_GENERADO', a: 'AFILIACION_ACTIVA', numero_contrato: a.numero_contrato },
    })
    await client.query('COMMIT')
    log(TAG, 'afiliación enlazada', id, a.numero_contrato)
    return { status: 200, body: { ok: true, numero_contrato: a.numero_contrato } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}
