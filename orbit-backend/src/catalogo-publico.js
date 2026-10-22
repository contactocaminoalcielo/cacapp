// Catálogo público de recordatorios (migr. 200) — el enlace /#/catalogo que se
// le comparte a cualquier cliente que NO hizo el servicio funerario con
// nosotros y quiere comprar recordatorios.
//
// Público, sin sesión. Tres llamadas:
//   GET  /portal/catalogo           → productos a la venta, envío, datos de pago
//   POST /portal/catalogo/borrador  → abre la carpeta temporal donde el navegador
//                                     sube las fotos (fotos-clientes/compra-web/<id>/)
//   POST /portal/catalogo/compra    → crea la compra en el módulo de la 168, con
//                                     id = borrador: un reintento no la duplica
//
// La compra que sale de aquí es una compra normal del módulo (misma tabla, mismo
// Tablero de Producción) con `origen = 'CATALOGO_WEB'`. Diferencias a propósito:
//   · El precio NO lo manda el navegador: sale de la base (precio público o el
//     de siempre), y solo se vende lo marcado para venta pública.
//   · Lo que el cliente declara del pago (comprobante o «pago después») va a
//     `pago_cliente`, NO a compra_recordatorio_pagos: el trigger de la 168 suma
//     todo lo que haya ahí, y un comprobante sin revisar no es plata recibida.
//     Coordinación lo registra como pago al verificarlo.
//   · La mascota puede estar viva o haber partido: lo dice el cliente.
import { pool, log } from './db.js'
import { autorizacionDelPayload, registrarAutorizacion, FALTA_AUTORIZACION } from './autorizaciones.js'
import { HttpError, t, normalizarItemsPublicos, fotosQuePide, precioPublico, METODOS_PAGO } from './compras-recordatorios-reglas.js'

const MOD = '[catalogo-publico]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = v => typeof v === 'string' && UUID.test(v)
const soloDigitos = v => String(v ?? '').replace(/\D/g, '')
const STORAGE_BASE = process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/'
const prefijoFotos = borrador => `${STORAGE_BASE}object/public/fotos-clientes/compra-web/${borrador}/`

async function leerConfig(client) {
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'CATALOGO_PUBLICO'`)
  const c = Object.fromEntries(rows.map(r => [r.clave, r.valor]))
  return {
    activo:     c.activo !== false,
    valorEnvio: Math.max(0, Math.round(Number(c.valor_envio) || 0)),
    datosPago:  typeof c.datos_pago === 'string' ? c.datos_pago : '',
  }
}

// ── GET /portal/catalogo ────────────────────────────────────────────────────
export async function verCatalogo() {
  const cfg = await leerConfig(pool)
  const [{ rows: recs }, { rows: especies }] = await Promise.all([
    pool.query(
      `SELECT id, nombre, descripcion, categoria, foto_url, tiempo_produccion_dias,
              campos_texto, requiere_imagen, solo_nombre, max_fotos, precio_base, precio_publico
         FROM public.recordatorios
        WHERE activo AND venta_publica
        ORDER BY categoria, nombre`),
    pool.query(`SELECT id, nombre FROM public.especies ORDER BY nombre`),
  ])
  const productos = recs.map(r => ({
    id: r.id, nombre: r.nombre, descripcion: r.descripcion || '', categoria: r.categoria,
    foto_url: r.foto_url || null, tiempo_dias: r.tiempo_produccion_dias ?? null,
    campos_texto: Array.isArray(r.campos_texto) ? r.campos_texto : [],
    fotos: fotosQuePide(r), precio: precioPublico(r), fisico: r.categoria === 'fisico',
  }))
  return {
    status: 200,
    body: { ok: true, activo: cfg.activo, valor_envio: cfg.valorEnvio, datos_pago: cfg.datosPago,
            metodos_pago: METODOS_PAGO.filter(m => m !== 'EFECTIVO'), productos, especies },
  }
}

// ── POST /portal/catalogo/borrador ──────────────────────────────────────────
export async function abrirBorrador({ contexto = {} }) {
  const cfg = await leerConfig(pool)
  if (!cfg.activo) return { status: 503, body: { ok: false, error: 'El catálogo no está recibiendo pedidos por ahora.' } }
  const { rows: [b] } = await pool.query(
    `INSERT INTO public.compra_web_borradores (ip) VALUES ($1) RETURNING id, expira_en`,
    [contexto.ip || null])
  return { status: 200, body: { ok: true, borrador: b.id, expira_en: b.expira_en } }
}

/**
 * Cliente del pedido. Se reutiliza uno existente solo si es claramente la misma
 * persona: misma cédula Y mismo WhatsApp, o (sin cédula) un único cliente con
 * ese WhatsApp. Si la cédula ya existe con OTRO WhatsApp, no se toca esa ficha:
 * se crea una nueva sin cédula y la cédula declarada queda en notas para que
 * coordinación las una si corresponde.
 */
async function resolverClientePublico(client, p) {
  const nombre   = t(p?.nombre, 80)
  const whatsapp = soloDigitos(p?.whatsapp).slice(0, 25)
  if (!nombre) throw new HttpError(400, 'Escribe tu nombre.')
  if (whatsapp.length < 10) throw new HttpError(400, 'Escribe un número de WhatsApp válido.')
  const cedula = soloDigitos(p?.cedula).slice(0, 30) || null
  let notaCedula = null

  if (cedula) {
    const { rows: [ex] } = await client.query(
      `SELECT * FROM public.clientes WHERE cedula_nit = $1 LIMIT 1`, [cedula])
    if (ex && soloDigitos(ex.whatsapp).endsWith(whatsapp.slice(-10))) return ex
    if (ex) notaCedula = `Cédula declarada en el catálogo web: ${cedula} (ya existe en otra ficha).`
  } else {
    const { rows } = await client.query(
      `SELECT * FROM public.clientes
        WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') LIKE '%' || $1
        LIMIT 2`, [whatsapp.slice(-10)])
    if (rows.length === 1) return rows[0]
  }

  const { rows: [c] } = await client.query(
    `INSERT INTO public.clientes (nombre, apellido, cedula_nit, whatsapp, telefono, email, ciudad, tipo_cliente, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'NORMAL',$8) RETURNING *`,
    [nombre.toUpperCase(), (t(p?.apellido, 80) || '').toUpperCase() || null,
     notaCedula ? null : cedula, whatsapp, soloDigitos(p?.telefono).slice(0, 25) || null,
     t(p?.email, 120), t(p?.ciudad, 60) || 'Bogotá',
     ['Cliente del catálogo web.', notaCedula].filter(Boolean).join(' ')]
  )
  return c
}

async function crearMascotaPublica(client, m, clienteId) {
  const nombre = t(m?.nombre, 80)
  if (!nombre) throw new HttpError(400, 'Escribe el nombre de tu mascota.')
  const especieId = parseInt(m?.especie_id) || null
  if (!especieId) throw new HttpError(400, 'Indica la especie de tu mascota.')
  const sexo = ['Macho', 'Hembra'].includes(m?.sexo) ? m.sexo : 'Macho'
  const { rows: [r] } = await client.query(
    `INSERT INTO public.mascotas (nombre, especie_id, raza, sexo, tamano, peso_kg, cliente_id, fallecida, notas)
     VALUES ($1,$2,$3,$4,'Mediano',0,$5,$6,$7) RETURNING *`,
    [nombre, especieId, t(m?.raza, 80), sexo, clienteId, m?.fallecida === true, 'Registrada desde el catálogo web.']
  )
  return r
}

function leerEntrega(e, hayFisico) {
  if (!hayFisico) return null
  const entrega = {
    direccion:     t(e?.direccion, 200),
    ciudad:        t(e?.ciudad, 60),
    barrio:        t(e?.barrio, 80),
    recibe:        t(e?.recibe, 120),
    telefono:      soloDigitos(e?.telefono).slice(0, 25) || null,
    indicaciones:  t(e?.indicaciones, 500),
  }
  if (!entrega.direccion) throw new HttpError(400, 'Falta la dirección de entrega.')
  if (!entrega.ciudad)    throw new HttpError(400, 'Falta la ciudad de entrega.')
  if (!entrega.recibe)    throw new HttpError(400, 'Falta quién recibe el pedido.')
  if (!entrega.telefono || entrega.telefono.length < 7) throw new HttpError(400, 'Falta el teléfono de quien recibe.')
  return entrega
}

function leerPagoCliente(p, borrador) {
  if (p?.modo === 'DESPUES') return { modo: 'DESPUES', declarado_en: new Date().toISOString() }
  if (p?.modo !== 'COMPROBANTE') throw new HttpError(400, 'Indica cómo vas a pagar.')
  const metodo = String(p?.metodo || '').toUpperCase()
  if (!METODOS_PAGO.includes(metodo) || metodo === 'EFECTIVO') throw new HttpError(400, 'Indica el medio de pago.')
  const url = t(p?.comprobante_url, 500)
  if (!url || !url.startsWith(prefijoFotos(borrador))) throw new HttpError(400, 'Adjunta el comprobante de pago.')
  return { modo: 'COMPROBANTE', metodo, comprobante_url: url, declarado_en: new Date().toISOString() }
}

// ── POST /portal/catalogo/compra ────────────────────────────────────────────
export async function crearCompraPublica({ payload = {}, contexto = {} }) {
  const borrador = payload.borrador
  if (!esUuid(borrador)) return { status: 400, body: { ok: false, error: 'Pedido inválido. Recarga la página.' } }
  const version = autorizacionDelPayload(payload)
  if (!version) return FALTA_AUTORIZACION

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cfg = await leerConfig(client)
    if (!cfg.activo) throw new HttpError(503, 'El catálogo no está recibiendo pedidos por ahora.')

    // Reintento tras un corte de red: la compra ya quedó con ese id.
    const { rows: [ya] } = await client.query(
      `SELECT numero, total FROM public.compras_recordatorios WHERE id = $1`, [borrador])
    if (ya) {
      await client.query('ROLLBACK')
      return { status: 200, body: { ok: true, numero: ya.numero, total: Number(ya.total), repetida: true } }
    }

    const { rows: [b] } = await client.query(
      `SELECT id FROM public.compra_web_borradores
        WHERE id = $1 AND usado_en IS NULL AND expira_en > now() FOR UPDATE`, [borrador])
    if (!b) throw new HttpError(410, 'El pedido venció (pasaron más de 3 horas). Recarga la página y vuelve a armarlo.')

    const ids = [...new Set((payload.items || []).map(i => i?.recordatorio_id).filter(esUuid))]
    const { rows: recs } = ids.length
      ? await client.query(
          `SELECT id, nombre, categoria, precio_base, precio_publico, activo, venta_publica,
                  requiere_imagen, solo_nombre, max_fotos
             FROM public.recordatorios WHERE id = ANY($1::uuid[])`, [ids])
      : { rows: [] }
    const catalogo = Object.fromEntries(recs.map(r => [r.id, r]))
    const { items, subtotal, hayFisico } = normalizarItemsPublicos(payload.items, catalogo, prefijoFotos(borrador))
    const valorEnvio = hayFisico ? cfg.valorEnvio : 0
    const total = subtotal + valorEnvio
    const entrega = leerEntrega(payload.entrega, hayFisico)
    const pagoCliente = leerPagoCliente(payload.pago, borrador)

    const cliente = await resolverClientePublico(client, payload.propietario)
    const mascota = await crearMascotaPublica(client, payload.mascota, cliente.id_cliente)

    const { rows: [compra] } = await client.query(
      `INSERT INTO public.compras_recordatorios
         (id, cliente_id, mascota_id, total, notas, registrado_por, origen, valor_envio, entrega, pago_cliente)
       VALUES ($1, $2, $3, $4, $5, NULL, 'CATALOGO_WEB', $6, $7, $8)
       RETURNING id, numero`,
      [borrador, cliente.id_cliente, mascota.id_mascota, total, t(payload.observaciones, 2000),
       valorEnvio, entrega ? JSON.stringify(entrega) : null, JSON.stringify(pagoCliente)]
    )

    for (const it of items) {
      await client.query(
        `INSERT INTO public.compra_recordatorio_items
           (compra_id, recordatorio_id, nombre, cantidad, precio_unitario, datos_cliente, imagenes_urls, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [compra.id, it.recordatorio_id, it.nombre, it.cantidad, it.precio_unitario,
         it.datos_cliente ? JSON.stringify(it.datos_cliente) : null, it.imagenes_urls, it.notas]
      )
    }

    await registrarAutorizacion(client, {
      origen: 'CATALOGO_RECORDATORIOS', medio: 'PORTAL_WEB', politicaVersion: version,
      titular: {
        nombre: cliente.nombre, apellido: cliente.apellido, documento: cliente.cedula_nit,
        telefono: cliente.whatsapp, email: cliente.email,
      },
      clienteId: cliente.id_cliente, contexto,
      notas: `Compra desde el catálogo web CR-${compra.numero}`,
    })

    await client.query(
      `INSERT INTO public.compra_recordatorio_eventos (compra_id, tipo, detalle, por)
       VALUES ($1, 'CREADA', $2, NULL)`,
      [compra.id, JSON.stringify({ origen: 'CATALOGO_WEB', total, subtotal, envio: valorEnvio,
                                   items: items.length, pago: pagoCliente.modo })]
    )
    await client.query(`UPDATE public.compra_web_borradores SET usado_en = now() WHERE id = $1`, [borrador])

    await client.query('COMMIT')
    log(MOD, `compra web CR-${compra.numero}`, { total, items: items.length, pago: pagoCliente.modo })
    return { status: 201, body: { ok: true, numero: compra.numero, total } }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return { status: e.status, body: { ok: false, error: e.message } }
    throw e
  } finally {
    client.release()
  }
}
