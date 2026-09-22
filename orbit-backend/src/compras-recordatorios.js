// Compras de recordatorios SIN servicio — cédula de mascota, un memopet suelto,
// una huella más. Migración 168.
//
// REPARTO CON EL FRONTEND (mismo criterio que inventario.js y ofertas.js):
//   · Los catálogos (recordatorios, especies) y la búsqueda de clientes y
//     mascotas los lee la pantalla por PostgREST: son tablas viejas y es lectura.
//   · TODO lo que escribe la compra pasa por aquí: crearla (cliente + mascota +
//     líneas + pago inicial + autorización de datos, en UNA transacción),
//     registrar un abono, mover el estado de una línea, anularla. Cada escritura
//     deja su fila en `compra_recordatorio_eventos`.
//
// Reglas que no se negocian:
//   · `valor_pagado` NUNCA se escribe desde aquí: lo recalcula el trigger de la
//     migración 168 con cada pago, en la misma transacción.
//   · El precio de la línea es un snapshot. El coordinador puede ajustarlo al
//     vender (descuento, promoción) pero el ítem tiene que existir y estar
//     activo en el catálogo; el nombre se copia de ahí, no del navegador.
//   · Nada se borra. Anular = fecha + motivo + quién. Los pagos se quedan.
import { pool, log } from './db.js'
import { autorizacionDelPayload, registrarAutorizacion, contextoPeticion } from './autorizaciones.js'
import {
  HttpError, t, num, limpiarDatosCliente, normalizarItems, validarPago, ESTADOS_ITEM,
} from './compras-recordatorios-reglas.js'

export { METODOS_PAGO, ESTADOS_ITEM, normalizarItems, validarPago, estadoCompra } from './compras-recordatorios-reglas.js'

const MOD = '[compras-recordatorios]'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = v => typeof v === 'string' && UUID.test(v)

// ── Lectura ─────────────────────────────────────────────────────────────────

const SQL_ESTADO = `
  CASE WHEN c.anulada_en IS NOT NULL THEN 'ANULADA'
       WHEN it.n > 0 AND it.entregados = it.n THEN 'ENTREGADA'
       WHEN it.n > 0 AND it.listos + it.entregados = it.n THEN 'LISTA'
       WHEN it.en_proceso > 0 OR it.listos > 0 OR it.entregados > 0 THEN 'EN_PRODUCCION'
       ELSE 'PENDIENTE' END`

const SQL_LATERAL_ITEMS = `
  LEFT JOIN LATERAL (
    SELECT count(*)::int                                       AS n,
           count(*) FILTER (WHERE i.estado = 'ENTREGADO')::int AS entregados,
           count(*) FILTER (WHERE i.estado = 'LISTO')::int     AS listos,
           count(*) FILTER (WHERE i.estado = 'EN_PROCESO')::int AS en_proceso,
           string_agg(i.nombre || CASE WHEN i.cantidad > 1 THEN ' ×' || i.cantidad ELSE '' END,
                      ', ' ORDER BY i.created_at)               AS resumen
      FROM public.compra_recordatorio_items i
     WHERE i.compra_id = c.id
  ) it ON true`

/**
 * Lista + cifras de cabecera. Todo agregado EN SQL: el tope mudo de 1000 filas
 * de PostgREST no aplica aquí, pero sumar en el navegador seguiría siendo la
 * forma más fácil de mostrar un total falso.
 */
export async function listarCompras(req, res) {
  try {
    const q      = t(req.query.q, 80)
    const estado = t(req.query.estado, 20)
    const pago   = t(req.query.estado_pago, 20)
    const desde  = t(req.query.desde, 10)
    const hasta  = t(req.query.hasta, 10)
    const { rows } = await pool.query(
      `WITH base AS (
         SELECT c.id, c.numero, c.total, c.valor_pagado, c.estado_pago, c.notas,
                c.created_at, c.anulada_en,
                cl.id_cliente, cl.nombre AS cliente_nombre, cl.apellido AS cliente_apellido,
                cl.whatsapp AS cliente_whatsapp,
                m.id_mascota, m.nombre AS mascota_nombre, e.nombre AS especie_nombre,
                p.nombre AS registrado_por_nombre,
                it.n AS items, it.entregados, it.listos, it.en_proceso, it.resumen,
                ${SQL_ESTADO} AS estado
           FROM public.compras_recordatorios c
           JOIN public.clientes cl ON cl.id_cliente = c.cliente_id
           JOIN public.mascotas m  ON m.id_mascota  = c.mascota_id
           LEFT JOIN public.especies e ON e.id = m.especie_id
           LEFT JOIN public.personal p ON p.id = c.registrado_por
           ${SQL_LATERAL_ITEMS}
          WHERE ($1::text IS NULL
                 OR c.numero::text = $1
                 OR cl.nombre ILIKE '%' || $1 || '%'
                 OR cl.apellido ILIKE '%' || $1 || '%'
                 OR cl.whatsapp ILIKE '%' || $1 || '%'
                 OR cl.cedula_nit ILIKE '%' || $1 || '%'
                 OR m.nombre ILIKE '%' || $1 || '%'
                 OR it.resumen ILIKE '%' || $1 || '%')
            AND ($3::date IS NULL OR c.created_at >= $3::date)
            AND ($4::date IS NULL OR c.created_at < ($4::date + 1))
       )
       SELECT * FROM base
        WHERE ($2::text IS NULL OR estado = $2)
          AND ($5::text IS NULL OR estado_pago = $5)
        ORDER BY created_at DESC, numero DESC
        LIMIT 300`,
      [q, estado, desde, hasta, pago]
    )

    // Cifras de cabecera, sin los filtros de la lista: son del módulo, no de
    // la búsqueda. La cartera excluye las anuladas.
    const { rows: [r] } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE c.anulada_en IS NULL
                            AND c.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Bogota'))::int AS compras_mes,
         COALESCE(sum(c.total) FILTER (WHERE c.anulada_en IS NULL
                            AND c.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Bogota')), 0) AS vendido_mes,
         COALESCE(sum(c.total - c.valor_pagado) FILTER (WHERE c.anulada_en IS NULL), 0)  AS por_cobrar,
         count(*) FILTER (WHERE c.anulada_en IS NULL AND it.n > 0
                            AND it.entregados < it.n AND it.listos + it.entregados < it.n)::int AS por_producir,
         count(*) FILTER (WHERE c.anulada_en IS NULL AND it.n > 0
                            AND it.entregados < it.n AND it.listos + it.entregados = it.n)::int AS listas
       FROM public.compras_recordatorios c
       ${SQL_LATERAL_ITEMS}`
    )
    res.json({ compras: rows, resumen: r })
  } catch (e) {
    log(MOD, 'listarCompras', e.message)
    // El frontend sale por `git push` y la migración va a mano: va a haber una
    // ventana en que la pantalla exista y las tablas no. Mejor decirlo.
    if (e.code === '42P01') {
      return res.status(503).json({ error: 'Las compras de recordatorios todavía no existen en la base de datos. Falta aplicar la migración 168.' })
    }
    res.status(500).json({ error: 'No se pudieron leer las compras' })
  }
}

async function leerDetalle(client, id) {
  const { rows: [c] } = await client.query(
    `SELECT c.*, ${SQL_ESTADO} AS estado,
            it.n AS items_n, it.entregados, it.listos, it.en_proceso,
            row_to_json(cl.*) AS cliente,
            json_build_object(
              'id_mascota', m.id_mascota, 'nombre', m.nombre, 'raza', m.raza, 'sexo', m.sexo,
              'tamano', m.tamano, 'peso_kg', m.peso_kg, 'fallecida', m.fallecida,
              'especie_id', m.especie_id, 'especie', e.nombre,
              'edad_anios', m.edad_anios, 'edad_declarada_en', m.edad_declarada_en::text
            ) AS mascota,
            p.nombre AS registrado_por_nombre, p.apellido AS registrado_por_apellido,
            pa.nombre AS anulada_por_nombre
       FROM public.compras_recordatorios c
       JOIN public.clientes cl ON cl.id_cliente = c.cliente_id
       JOIN public.mascotas m  ON m.id_mascota  = c.mascota_id
       LEFT JOIN public.especies e ON e.id = m.especie_id
       LEFT JOIN public.personal p  ON p.id = c.registrado_por
       LEFT JOIN public.personal pa ON pa.id = c.anulada_por
       ${SQL_LATERAL_ITEMS}
      WHERE c.id = $1`,
    [id]
  )
  if (!c) return null
  const [{ rows: items }, { rows: pagos }, { rows: eventos }] = await Promise.all([
    client.query(
      `SELECT i.*, i.fecha_inicio_prod::text AS fecha_inicio_prod,
              i.fecha_fin_prod::text AS fecha_fin_prod, i.fecha_entrega::text AS fecha_entrega,
              r.campos_texto, r.max_fotos, r.requiere_imagen, r.solo_nombre, r.categoria,
              r.tiempo_produccion_dias,
              pa.nombre AS asignado_nombre, pa.apellido AS asignado_apellido
         FROM public.compra_recordatorio_items i
         JOIN public.recordatorios r ON r.id = i.recordatorio_id
         LEFT JOIN public.personal pa ON pa.id = i.asignado_a
        WHERE i.compra_id = $1
        ORDER BY i.created_at, i.id`, [id]),
    client.query(
      `SELECT p.*, pe.nombre AS registrado_por_nombre
         FROM public.compra_recordatorio_pagos p
         LEFT JOIN public.personal pe ON pe.id = p.registrado_por
        WHERE p.compra_id = $1
        ORDER BY p.created_at, p.id`, [id]),
    client.query(
      `SELECT ev.*, pe.nombre AS por_nombre, pe.apellido AS por_apellido
         FROM public.compra_recordatorio_eventos ev
         LEFT JOIN public.personal pe ON pe.id = ev.por
        WHERE ev.compra_id = $1
        ORDER BY ev.created_at DESC, ev.id DESC
        LIMIT 200`, [id]),
  ])
  return { ...c, items, pagos, eventos }
}

export async function detalleCompra(req, res) {
  if (!esUuid(req.params.id)) return res.status(400).json({ error: 'Id inválido' })
  try {
    const d = await leerDetalle(pool, req.params.id)
    if (!d) return res.status(404).json({ error: 'Compra no encontrada' })
    res.json(d)
  } catch (e) {
    log(MOD, 'detalleCompra', e.message)
    res.status(500).json({ error: 'No se pudo leer la compra' })
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

async function evento(client, { compraId, itemId = null, tipo, detalle = null, por }) {
  await client.query(
    `INSERT INTO public.compra_recordatorio_eventos (compra_id, item_id, tipo, detalle, por)
     VALUES ($1, $2, $3, $4, $5)`,
    [compraId, itemId, tipo, detalle ? JSON.stringify(detalle) : null, por]
  )
}

/** Cliente existente (por id) o nuevo. Con cédula repetida se reutiliza el que ya existe. */
async function resolverCliente(client, cliente) {
  if (esUuid(cliente?.id_cliente)) {
    const { rows: [c] } = await client.query(
      `SELECT * FROM public.clientes WHERE id_cliente = $1`, [cliente.id_cliente])
    if (!c) throw new HttpError(400, 'El cliente elegido ya no existe.')
    return { cliente: c, nuevo: false }
  }
  const n = cliente?.nuevo
  if (!n) throw new HttpError(400, 'Elige un cliente o registra uno nuevo.')
  const nombre   = t(n.nombre, 80)
  const whatsapp = t(n.whatsapp, 25)
  if (!nombre)   throw new HttpError(400, 'El nombre del cliente es obligatorio.')
  if (!whatsapp) throw new HttpError(400, 'El WhatsApp del cliente es obligatorio.')
  const cedula = t(n.cedula_nit, 30)
  if (cedula) {
    const { rows: [ex] } = await client.query(
      `SELECT * FROM public.clientes WHERE cedula_nit = $1 LIMIT 1`, [cedula])
    if (ex) return { cliente: ex, nuevo: false }
  }
  const tipo = ['NORMAL', 'VIP', 'RECURRENTE'].includes(n.tipo_cliente) ? n.tipo_cliente : 'NORMAL'
  const notas = [n.barrio ? `Barrio: ${t(n.barrio, 80)}` : '', n.localidad ? `Localidad: ${t(n.localidad, 80)}` : '']
    .filter(Boolean).join('. ') || null
  const { rows: [c] } = await client.query(
    `INSERT INTO public.clientes
       (nombre, apellido, cedula_nit, whatsapp, telefono, telefono2, email, direccion, ciudad, tipo_cliente, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [nombre.toUpperCase(), (t(n.apellido, 80) || '').toUpperCase() || null, cedula, whatsapp,
     t(n.telefono, 25), t(n.telefono2, 25), t(n.email, 120), (t(n.direccion, 200) || '')?.toUpperCase() || null,
     t(n.ciudad, 60) || 'Bogotá', tipo, notas]
  )
  return { cliente: c, nuevo: true }
}

/**
 * Mascota existente (tiene que ser DEL cliente) o nueva. Una mascota nueva
 * aquí nace VIVA: la cédula se le hace a la mascota que está en casa. Es la
 * diferencia con Registro.jsx, que la crea fallecida porque ahí se está
 * registrando el servicio funerario.
 */
async function resolverMascota(client, mascota, clienteId) {
  if (esUuid(mascota?.id_mascota)) {
    const { rows: [m] } = await client.query(
      `SELECT * FROM public.mascotas WHERE id_mascota = $1 AND cliente_id = $2`,
      [mascota.id_mascota, clienteId])
    if (!m) throw new HttpError(400, 'La mascota elegida no es de ese cliente.')
    return m
  }
  const n = mascota?.nueva
  if (!n) throw new HttpError(400, 'Elige una mascota o registra una nueva.')
  const nombre = t(n.nombre, 80)
  if (!nombre) throw new HttpError(400, 'El nombre de la mascota es obligatorio.')
  const especieId = parseInt(n.especie_id) || null
  const sexo   = ['Macho', 'Hembra'].includes(n.sexo) ? n.sexo : 'Macho'
  const tamano = ['Mini', 'Pequeño', 'Mediano', 'Grande', 'Gigante'].includes(n.tamano) ? n.tamano : 'Mediano'
  const peso   = num(n.peso_kg)
  const edad   = parseInt(n.edad_anios)
  const conEdad = Number.isInteger(edad) && edad >= 0 && edad <= 40
  const { rows: [m] } = await client.query(
    `INSERT INTO public.mascotas
       (nombre, especie_id, raza, sexo, tamano, peso_kg, notas, cliente_id, fallecida,
        edad_anios, edad_declarada_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,
             CASE WHEN $10::boolean THEN public.fn_hoy_bogota() ELSE NULL END)
     RETURNING *`,
    [nombre, especieId, t(n.raza, 80), sexo, tamano,
     Number.isFinite(peso) && peso > 0 ? peso : 0, t(n.notas, 1000), clienteId,
     conEdad ? edad : null, conEdad]
  )
  return m
}

/**
 * POST /compras-recordatorios
 * Cuerpo: { id?, cliente: {id_cliente} | {nuevo:{...}}, mascota: {id_mascota} | {nueva:{...}},
 *           items: [{recordatorio_id, cantidad, precio_unitario?, datos_cliente?, notas?}],
 *           pago?: {monto, metodo, referencia?, comprobante_path?}, notas?,
 *           autorizacion: { aceptada: true, politica_version } }
 *
 * `id` lo puede generar el navegador (uuid): así el comprobante se sube ANTES
 * a `evidencias/compras-recordatorios/<id>/…` y, si el usuario reintenta tras
 * un corte de red, la segunda petición encuentra la compra y no la duplica.
 */
export async function crearCompra(req, res) {
  const body = req.body || {}
  const por  = req.personal.id
  const id   = esUuid(body.id) ? body.id : null

  // La autorización de datos es obligatoria (Ley 1581/2012): sin ella no nos
  // quedamos con los datos. Se exige aunque el cliente ya exista — es la
  // constancia de ESTA captura, igual que en el registro interno.
  const version = autorizacionDelPayload(body)
  if (!version) {
    return res.status(422).json({ error: 'Falta marcar la autorización de tratamiento de datos.', codigo: 'falta_autorizacion' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (id) {
      const { rows: [ya] } = await client.query(
        `SELECT id FROM public.compras_recordatorios WHERE id = $1`, [id])
      if (ya) {
        await client.query('ROLLBACK')
        const d = await leerDetalle(pool, id)
        return res.status(200).json({ ...d, repetida: true })
      }
    }

    const { cliente, nuevo: clienteNuevo } = await resolverCliente(client, body.cliente)
    const mascota = await resolverMascota(client, body.mascota, cliente.id_cliente)

    const ids = [...new Set((body.items || []).map(i => i?.recordatorio_id).filter(esUuid))]
    const { rows: recs } = ids.length
      ? await client.query(`SELECT id, nombre, precio_base, activo FROM public.recordatorios WHERE id = ANY($1::uuid[])`, [ids])
      : { rows: [] }
    const catalogo = Object.fromEntries(recs.map(r => [r.id, r]))
    const { items, total } = normalizarItems(body.items, catalogo)

    const pago = body.pago && num(body.pago.monto) > 0 ? validarPago(body.pago, total) : null

    const { rows: [compra] } = await client.query(
      `INSERT INTO public.compras_recordatorios
         (id, cliente_id, mascota_id, total, notas, registrado_por)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
       RETURNING id, numero`,
      [id, cliente.id_cliente, mascota.id_mascota, total, t(body.notas, 2000), por]
    )

    for (const it of items) {
      await client.query(
        `INSERT INTO public.compra_recordatorio_items
           (compra_id, recordatorio_id, nombre, cantidad, precio_unitario, datos_cliente, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [compra.id, it.recordatorio_id, it.nombre, it.cantidad, it.precio_unitario,
         it.datos_cliente ? JSON.stringify(it.datos_cliente) : null, it.notas]
      )
    }

    if (pago) {
      await client.query(
        `INSERT INTO public.compra_recordatorio_pagos
           (compra_id, monto, metodo, referencia, comprobante_path, registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [compra.id, pago.monto, pago.metodo, pago.referencia, pago.comprobante_path, por]
      )
    }

    await registrarAutorizacion(client, {
      origen: 'COMPRA_RECORDATORIOS',
      medio:  'DECLARADA_POR_PERSONAL',
      politicaVersion: version,
      titular: {
        nombre: cliente.nombre, apellido: cliente.apellido,
        documento: cliente.cedula_nit, telefono: cliente.whatsapp, email: cliente.email,
      },
      clienteId: cliente.id_cliente,
      declaradaPor: por,
      contexto: contextoPeticion(req),
      notas: `Compra de recordatorios CR-${compra.numero}`,
    })

    await evento(client, {
      compraId: compra.id, tipo: 'CREADA', por,
      detalle: { total, items: items.length, cliente_nuevo: clienteNuevo,
                 mascota_nueva: !esUuid(body.mascota?.id_mascota), pago: pago?.monto || 0 },
    })
    if (pago) {
      await evento(client, { compraId: compra.id, tipo: 'PAGO', por,
        detalle: { monto: pago.monto, metodo: pago.metodo, inicial: true } })
    }

    await client.query('COMMIT')
    log(MOD, `compra CR-${compra.numero} creada`, { total, items: items.length, pago: pago?.monto || 0 })
    const d = await leerDetalle(pool, compra.id)
    res.status(201).json(d)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra })
    log(MOD, 'crearCompra', e.message)
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos (cédula o identificación repetida).' })
    if (e.code === '23514') return res.status(400).json({ error: 'Un dato no pasó la validación de la base: ' + e.message })
    res.status(500).json({ error: 'No se pudo registrar la compra' })
  } finally {
    client.release()
  }
}

/** POST /compras-recordatorios/:id/pagos — un abono más. */
export async function registrarPago(req, res) {
  const id = req.params.id
  if (!esUuid(id)) return res.status(400).json({ error: 'Id inválido' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [c] } = await client.query(
      `SELECT id, numero, total, valor_pagado, anulada_en
         FROM public.compras_recordatorios WHERE id = $1 FOR UPDATE`, [id])
    if (!c) throw new HttpError(404, 'Compra no encontrada')
    if (c.anulada_en) throw new HttpError(400, 'La compra está anulada: no se le registran pagos.')
    const saldo = Number(c.total) - Number(c.valor_pagado)
    const pago  = validarPago(req.body, saldo)
    await client.query(
      `INSERT INTO public.compra_recordatorio_pagos
         (compra_id, monto, metodo, referencia, comprobante_path, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, pago.monto, pago.metodo, pago.referencia, pago.comprobante_path, req.personal.id]
    )
    await evento(client, { compraId: id, tipo: 'PAGO', por: req.personal.id,
      detalle: { monto: pago.monto, metodo: pago.metodo, referencia: pago.referencia } })
    await client.query('COMMIT')
    log(MOD, `pago en CR-${c.numero}`, pago.monto, pago.metodo)
    res.json(await leerDetalle(pool, id))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
    log(MOD, 'registrarPago', e.message)
    res.status(500).json({ error: 'No se pudo registrar el pago' })
  } finally {
    client.release()
  }
}

/**
 * PATCH /compras-recordatorios/:id/items/:itemId
 * Cuerpo: { estado?, asignado_a?, notas?, datos_cliente?, imagenes_urls? }
 * Las fechas de producción siguen la regla de Producción: al salir de
 * PENDIENTE se estampa el inicio; LISTO estampa el fin (y volver atrás lo
 * borra); ENTREGADO estampa la entrega.
 */
export async function actualizarItem(req, res) {
  const { id, itemId } = req.params
  if (!esUuid(id) || !esUuid(itemId)) return res.status(400).json({ error: 'Id inválido' })
  const b = req.body || {}
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [c] } = await client.query(
      `SELECT anulada_en, numero FROM public.compras_recordatorios WHERE id = $1 FOR UPDATE`, [id])
    if (!c) throw new HttpError(404, 'Compra no encontrada')
    if (c.anulada_en) throw new HttpError(400, 'La compra está anulada.')
    const { rows: [it] } = await client.query(
      `SELECT * FROM public.compra_recordatorio_items WHERE id = $1 AND compra_id = $2`, [itemId, id])
    if (!it) throw new HttpError(404, 'Línea no encontrada')

    const cambios = {}
    if (b.estado !== undefined) {
      if (!ESTADOS_ITEM.includes(b.estado)) throw new HttpError(400, 'Estado inválido.')
      cambios.estado = b.estado
    }
    if (b.asignado_a !== undefined) {
      if (b.asignado_a !== null && b.asignado_a !== '' && !esUuid(b.asignado_a)) throw new HttpError(400, 'Asignado inválido.')
      cambios.asignado_a = b.asignado_a || null
    }
    if (b.notas !== undefined)         cambios.notas = t(b.notas, 1000)
    if (b.datos_cliente !== undefined) cambios.datos_cliente = limpiarDatosCliente(b.datos_cliente)
    if (b.imagenes_urls !== undefined) {
      if (!Array.isArray(b.imagenes_urls)) throw new HttpError(400, 'imagenes_urls debe ser una lista.')
      cambios.imagenes_urls = b.imagenes_urls.map(u => t(u, 500)).filter(Boolean).slice(0, 20)
    }
    if (!Object.keys(cambios).length) throw new HttpError(400, 'Nada que cambiar.')

    const estado = cambios.estado ?? it.estado
    await client.query(
      `UPDATE public.compra_recordatorio_items SET
         estado        = $3,
         asignado_a    = $4,
         notas         = $5,
         datos_cliente = $6,
         imagenes_urls = $7,
         fecha_inicio_prod = CASE WHEN $3 <> 'PENDIENTE' THEN COALESCE(fecha_inicio_prod, public.fn_hoy_bogota()) ELSE fecha_inicio_prod END,
         fecha_fin_prod    = CASE WHEN $3 IN ('LISTO','ENTREGADO') THEN COALESCE(fecha_fin_prod, public.fn_hoy_bogota()) ELSE NULL END,
         fecha_entrega     = CASE WHEN $3 = 'ENTREGADO' THEN COALESCE(fecha_entrega, public.fn_hoy_bogota()) ELSE NULL END
       WHERE id = $1 AND compra_id = $2`,
      [itemId, id, estado,
       'asignado_a' in cambios ? cambios.asignado_a : it.asignado_a,
       'notas' in cambios ? cambios.notas : it.notas,
       'datos_cliente' in cambios
         ? (cambios.datos_cliente ? JSON.stringify(cambios.datos_cliente) : null)
         : (it.datos_cliente ? JSON.stringify(it.datos_cliente) : null),
       'imagenes_urls' in cambios ? cambios.imagenes_urls : it.imagenes_urls]
    )

    if (cambios.estado && cambios.estado !== it.estado) {
      await evento(client, { compraId: id, itemId, tipo: 'ESTADO_ITEM', por: req.personal.id,
        detalle: { de: it.estado, a: cambios.estado, item: it.nombre } })
    }
    const otros = Object.keys(cambios).filter(k => k !== 'estado')
    if (otros.length) {
      await evento(client, { compraId: id, itemId, tipo: 'DATOS_ITEM', por: req.personal.id,
        detalle: { campos: otros, item: it.nombre } })
    }
    await client.query('COMMIT')
    res.json(await leerDetalle(pool, id))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
    log(MOD, 'actualizarItem', e.message)
    res.status(500).json({ error: 'No se pudo actualizar la línea' })
  } finally {
    client.release()
  }
}

/** POST /compras-recordatorios/:id/anular — { motivo }. Los pagos se quedan. */
export async function anularCompra(req, res) {
  const id = req.params.id
  if (!esUuid(id)) return res.status(400).json({ error: 'Id inválido' })
  const motivo = t(req.body?.motivo, 500)
  if (!motivo) return res.status(400).json({ error: 'Escribe el motivo de la anulación.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [c] } = await client.query(
      `SELECT numero, anulada_en, valor_pagado FROM public.compras_recordatorios WHERE id = $1 FOR UPDATE`, [id])
    if (!c) throw new HttpError(404, 'Compra no encontrada')
    if (c.anulada_en) throw new HttpError(400, 'Ya estaba anulada.')
    await client.query(
      `UPDATE public.compras_recordatorios
          SET anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
        WHERE id = $1`, [id, req.personal.id, motivo])
    await evento(client, { compraId: id, tipo: 'ANULADA', por: req.personal.id,
      detalle: { motivo, pagado_hasta_entonces: Number(c.valor_pagado) } })
    await client.query('COMMIT')
    log(MOD, `CR-${c.numero} anulada`, motivo)
    res.json(await leerDetalle(pool, id))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message })
    log(MOD, 'anularCompra', e.message)
    res.status(500).json({ error: 'No se pudo anular la compra' })
  } finally {
    client.release()
  }
}
