// Inventario — fase 1: kardex, saldos y costo.
//
// REPARTO CON EL FRONTEND (mismo criterio que ofertas.js):
//   · El CATÁLOGO (insumos, proveedores, presentaciones) lo edita la pantalla
//     directo por PostgREST. Es configuración.
//   · TODO MOVIMIENTO pasa por aquí. Un movimiento cambia el saldo y el costo
//     promedio, y de ahí salen los números de Finanzas. Necesita rol, necesita
//     validación y —en la importación— necesita transacción.
//
// ⚠️ REGLA DE ORO: el inventario NUNCA bloquea la operación. Si no hay stock,
// la salida se registra igual y el saldo queda negativo. Un negativo es la
// señal de que faltó registrar una entrada, no un motivo para frenar a
// producción. Aquí no hay ni un solo `if (stock < cantidad) return error`.
//
// El saldo y el costo promedio los mantiene el trigger de la migración 120, en
// la misma transacción del INSERT. Este módulo NUNCA escribe `stock_actual` ni
// `costo_promedio` a mano: se desviarían del kardex sin que nadie lo note.
import { pool, log } from './db.js'

const MOD = '[inventario]'

// El signo lo decide el servidor a partir del tipo, no el navegador. Mandar una
// salida en positivo era el error de dedo más fácil de cometer y el más caro:
// habría sumado stock inventado en vez de restarlo.
const TIPOS = {
  ENTRADA_COMPRA:     { signo: +1, exigeCosto: true  },
  ENTRADA_AJUSTE:     { signo: +1, exigeCosto: false },
  ENTRADA_DEVOLUCION: { signo: +1, exigeCosto: false },
  ENTRADA_TRASLADO:   { signo: +1, exigeCosto: false },
  SALIDA_PRODUCCION:  { signo: -1, exigeCosto: false },
  SALIDA_MERMA:       { signo: -1, exigeCosto: false },
  SALIDA_AJUSTE:      { signo: -1, exigeCosto: false },
  SALIDA_TRASLADO:    { signo: -1, exigeCosto: false },
}

// El PRODUCTOR tiene el material en la mano: es quien ve que se rompió una
// lámina. Puede reportar la merma y nada más.
const TIPOS_PRODUCTOR = new Set(['SALIDA_MERMA'])

function puedeRegistrar(rol, tipo) {
  if (rol === 'ADMIN' || rol === 'COORDINADOR') return true
  if (rol === 'PRODUCTOR') return TIPOS_PRODUCTOR.has(tipo)
  return false
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Existencias + cifras de cabecera.
 *
 * Todo se agrega EN SQL a propósito. `PGRST_DB_MAX_ROWS=1000` corta cualquier
 * consulta sin avisar y el kardex pasa las mil filas en semanas: sumar los
 * movimientos en el navegador daría saldos falsos con cara de exactos.
 */
export async function listarStock(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.v_inventario_stock
        WHERE ($1::boolean IS NOT TRUE) OR activo
        ORDER BY
          CASE estado_stock WHEN 'NEGATIVO' THEN 0 WHEN 'REPONER' THEN 1 ELSE 2 END,
          nombre`,
      [req.query.solo_activos !== 'false']
    )
    const resumen = {
      insumos:        rows.length,
      valor_total:    rows.reduce((a, r) => a + Number(r.valor_inventario || 0), 0),
      a_reponer:      rows.filter(r => r.estado_stock === 'REPONER').length,
      en_negativo:    rows.filter(r => r.estado_stock === 'NEGATIVO').length,
      sin_costo:      rows.filter(r => Number(r.costo_promedio) === 0).length,
    }
    res.json({ resumen, insumos: rows })
  } catch (e) {
    log(MOD, 'listarStock', e.message)
    // El frontend se despliega solo con `git push` y el backend y la migración
    // van a mano: va a haber una ventana en que la pantalla exista y las tablas
    // no. Mejor decirlo que devolver un 500 mudo que parece una caída.
    if (e.code === '42P01') {
      return res.status(503).json({
        error: 'El inventario todavía no está creado en la base de datos. Falta aplicar la migración 120.' })
    }
    res.status(500).json({ error: 'No se pudo leer el inventario' })
  }
}

/**
 * Kardex. Paginado SIEMPRE con ORDER BY explícito: un `limit` sin orden deja
 * fuera justo las filas nuevas, que son las que uno viene a mirar.
 */
export async function listarMovimientos(req, res) {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const { rows } = await pool.query(
      `SELECT m.*,
              i.nombre       AS insumo_nombre,
              i.unidad_base,
              p.nombre       AS registrado_por_nombre,
              (-m.cantidad * m.costo_unitario) AS valor
         FROM public.inventario_movimientos m
         JOIN public.inventario_insumos i ON i.id = m.insumo_id
         LEFT JOIN public.personal p      ON p.id = m.registrado_por
        WHERE ($1::uuid IS NULL OR m.insumo_id = $1)
          AND ($2::text IS NULL OR m.tipo = $2)
          AND ($3::date IS NULL OR m.created_at >= $3::date)
          AND ($4::date IS NULL OR m.created_at < ($4::date + 1))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $5 OFFSET $6`,
      [req.query.insumo_id || null, req.query.tipo || null,
       req.query.desde || null, req.query.hasta || null, limit, offset]
    )
    res.json({ movimientos: rows, hay_mas: rows.length === limit })
  } catch (e) {
    log(MOD, 'listarMovimientos', e.message)
    res.status(500).json({ error: 'No se pudo leer el kardex' })
  }
}

/**
 * Verificación de saldos: la columna contra la suma del kardex.
 *
 * No debería encontrar nada nunca —el trigger mantiene los dos en la misma
 * transacción y el kardex es inmutable— y justo por eso vale la pena correrla:
 * el día que aparezca una diferencia, es que alguien encontró un camino nuevo.
 */
export async function verificarSaldos(_req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.nombre, i.stock_actual,
              COALESCE(k.suma, 0) AS suma_kardex,
              i.stock_actual - COALESCE(k.suma, 0) AS diferencia
         FROM public.inventario_insumos i
         LEFT JOIN (
           SELECT insumo_id, SUM(cantidad) AS suma
             FROM public.inventario_movimientos GROUP BY insumo_id
         ) k ON k.insumo_id = i.id
        WHERE i.stock_actual <> COALESCE(k.suma, 0)
        ORDER BY i.nombre`
    )
    res.json({ ok: rows.length === 0, descuadres: rows })
  } catch (e) {
    log(MOD, 'verificarSaldos', e.message)
    res.status(500).json({ error: 'No se pudo verificar' })
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Registra un movimiento. `cantidad` llega SIEMPRE positiva desde la pantalla;
 * el signo lo pone el tipo.
 *
 * Si viene `presentacion_id`, la cantidad se convierte a la unidad de consumo:
 * se compran 2 bultos y entran 50.000 gramos. Sin esto el costo por pieza sale
 * mal por órdenes de magnitud.
 */
export async function registrarMovimiento(req, res) {
  const {
    insumo_id, tipo, motivo, servicio_id = null,
    presentacion_id = null, ubicacion = 'BOGOTA',
  } = req.body || {}

  const def = TIPOS[tipo]
  if (!insumo_id || !def) return res.status(400).json({ error: 'Insumo o tipo de movimiento inválido' })
  if (!puedeRegistrar(req.personal?.rol, tipo)) {
    return res.status(403).json({ error: 'Tu rol no puede registrar este tipo de movimiento' })
  }

  let cantidad = Math.abs(Number(req.body?.cantidad) || 0)
  let costo    = Number(req.body?.costo_unitario) || 0
  if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor que cero' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (presentacion_id) {
      const { rows } = await client.query(
        `SELECT factor::float8 AS factor FROM public.inventario_presentaciones
          WHERE id = $1 AND insumo_id = $2`, [presentacion_id, insumo_id])
      if (!rows[0]) throw Object.assign(new Error('La presentación no es de este insumo'), { status: 400 })
      // El precio llega POR PRESENTACIÓN y el kardex cuesta por unidad de consumo.
      if (costo > 0) costo = costo / rows[0].factor
      cantidad = cantidad * rows[0].factor
    }

    // Una entrada de compra sin costo deja el promedio congelado en el valor
    // viejo y nadie lo nota: el saldo sube, el costo no, y el margen queda
    // mintiendo. Mejor un error aquí que un número creíble y falso después.
    if (def.exigeCosto && costo <= 0) {
      throw Object.assign(
        new Error('Una entrada por compra necesita el costo. Si fue una donación o un traslado, usa "Ajuste de entrada".'),
        { status: 400 })
    }

    const { rows } = await client.query(
      `INSERT INTO public.inventario_movimientos
         (insumo_id, ubicacion, tipo, cantidad, costo_unitario, motivo, servicio_id, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, cantidad, costo_unitario`,
      [insumo_id, ubicacion, tipo, def.signo * cantidad, costo,
       motivo || null, servicio_id, req.personal?.id || null]
    )

    const { rows: saldo } = await client.query(
      `SELECT stock_actual, costo_promedio FROM public.inventario_insumos WHERE id = $1`,
      [insumo_id])

    await client.query('COMMIT')
    res.json({ ok: true, movimiento: rows[0], saldo: saldo[0] })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    log(MOD, 'registrarMovimiento', e.message)
    res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo registrar el movimiento' })
  } finally {
    client.release()
  }
}

/**
 * Revierte un movimiento.
 *
 * No lo borra: el kardex es inmutable (trigger de la 120). Se estampa
 * `revertido_en` en el original y se inserta el contrario con
 * `origen_tipo='REVERSA'`. Esa pareja es lo que deja el índice único libre para
 * que el mismo origen pueda volver a consumir cuando corresponda.
 */
export async function revertirMovimiento(req, res) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `SELECT * FROM public.inventario_movimientos WHERE id = $1 FOR UPDATE`, [req.params.id])
    const mov = rows[0]
    if (!mov)               throw Object.assign(new Error('El movimiento no existe'), { status: 404 })
    if (mov.revertido_en)   throw Object.assign(new Error('Ese movimiento ya está revertido'), { status: 409 })
    if (mov.origen_tipo === 'REVERSA') {
      throw Object.assign(new Error('Una reversa no se revierte: registra el movimiento que corresponda'), { status: 400 })
    }

    await client.query(
      `UPDATE public.inventario_movimientos SET revertido_en = now() WHERE id = $1`, [mov.id])

    // El contrario conserva el costo del original para que el valor del
    // inventario vuelva exactamente a donde estaba.
    const contrario = Number(mov.cantidad) > 0 ? 'SALIDA_AJUSTE' : 'ENTRADA_AJUSTE'
    await client.query(
      `INSERT INTO public.inventario_movimientos
         (insumo_id, ubicacion, tipo, cantidad, costo_unitario, origen_tipo, origen_id,
          servicio_id, motivo, registrado_por)
       VALUES ($1, $2, $3, $4, $5, 'REVERSA', $6, $7, $8, $9)`,
      [mov.insumo_id, mov.ubicacion, contrario, -Number(mov.cantidad), mov.costo_unitario,
       mov.id, mov.servicio_id,
       `Reversa de ${mov.tipo}` + (req.body?.motivo ? ` — ${req.body.motivo}` : ''),
       req.personal?.id || null]
    )

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    log(MOD, 'revertirMovimiento', e.message)
    res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo revertir' })
  } finally {
    client.release()
  }
}

/**
 * Carga inicial del catálogo desde un CSV ya parseado por la pantalla.
 *
 * Va en UNA transacción: o entra el catálogo entero o no entra nada. Una carga
 * a medias es peor que ninguna, porque el saldo parcial parece completo.
 *
 * El saldo inicial se registra como ENTRADA_AJUSTE, no como compra: no es una
 * compra, es lo que había el día que se contó. El costo declarado se siembra
 * en el insumo al crearlo — que es lo único honesto cuando todavía no hay
 * historia de compras de la cual promediar.
 */
export async function importarCatalogo(req, res) {
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : []
  if (!filas.length) return res.status(400).json({ error: 'No llegó ninguna fila' })
  if (filas.length > 500) return res.status(400).json({ error: 'Máximo 500 filas por importación' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let creados = 0, actualizados = 0, conSaldo = 0
    const errores = []

    for (const [i, f] of filas.entries()) {
      const nombre = (f.nombre || '').trim()
      if (!nombre) { errores.push(`Fila ${i + 2}: sin nombre`); continue }

      const costo  = Number(f.costo_unitario) || 0
      const saldo  = Number(f.stock_inicial)  || 0
      const minimo = Number(f.stock_minimo)   || 0

      // Proveedor por nombre: se crea si no existe, así el CSV no obliga a
      // cargar proveedores primero.
      let proveedorId = null
      const provNombre = (f.proveedor || '').trim()
      if (provNombre) {
        const { rows } = await client.query(
          `INSERT INTO public.inventario_proveedores (nombre) VALUES ($1)
           ON CONFLICT (lower(nombre)) DO UPDATE SET nombre = EXCLUDED.nombre
           RETURNING id`, [provNombre])
        proveedorId = rows[0].id
      }

      const { rows: ins } = await client.query(
        `INSERT INTO public.inventario_insumos
           (nombre, codigo, categoria, unidad_base, stock_minimo,
            costo_promedio, costo_ultimo, proveedor_id)
         VALUES ($1, NULLIF($2,''), NULLIF($3,''), COALESCE(NULLIF($4,''), 'unidad'),
                 $5::numeric, $6::numeric, NULLIF($6::numeric, 0), $7)
         ON CONFLICT (lower(nombre)) DO UPDATE SET
           codigo       = COALESCE(NULLIF(EXCLUDED.codigo, ''),    inventario_insumos.codigo),
           categoria    = COALESCE(NULLIF(EXCLUDED.categoria, ''), inventario_insumos.categoria),
           -- Un cero en el CSV no borra un mínimo ya configurado: reimportar el
           -- mismo archivo no puede desarmar lo que alguien ajustó a mano.
           stock_minimo = COALESCE(NULLIF(EXCLUDED.stock_minimo, 0), inventario_insumos.stock_minimo),
           proveedor_id = COALESCE(EXCLUDED.proveedor_id, inventario_insumos.proveedor_id),
           updated_at   = now()
         RETURNING id, (xmax = 0) AS es_nuevo`,
        [nombre, f.codigo || '', f.categoria || '', f.unidad_base || '',
         minimo, costo, proveedorId])

      const insumo = ins[0]
      insumo.es_nuevo ? creados++ : actualizados++

      // El saldo inicial solo se siembra en insumos nuevos. Reimportar el mismo
      // CSV por segunda vez no puede duplicar existencias — y reimportar por
      // error es exactamente lo que pasa cuando algo falla a mitad de camino.
      if (insumo.es_nuevo && saldo > 0) {
        await client.query(
          `INSERT INTO public.inventario_movimientos
             (insumo_id, tipo, cantidad, costo_unitario, motivo, registrado_por)
           VALUES ($1, 'ENTRADA_AJUSTE', $2, $3, 'Carga inicial del catálogo', $4)`,
          [insumo.id, saldo, costo, req.personal?.id || null])
        conSaldo++
      }
    }

    if (errores.length === filas.length) {
      throw Object.assign(new Error(errores.slice(0, 5).join(' · ')), { status: 400 })
    }

    await client.query('COMMIT')
    log(MOD, `importación: ${creados} nuevos, ${actualizados} actualizados, ${conSaldo} con saldo`)
    res.json({ ok: true, creados, actualizados, con_saldo: conSaldo, errores })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    log(MOD, 'importarCatalogo', e.message)
    res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo importar el catálogo' })
  } finally {
    client.release()
  }
}
