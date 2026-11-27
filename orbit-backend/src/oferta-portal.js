// Portal de la OFERTA POSTERIOR — /#/oferta/CODIGO (migr. 210).
//
// Público, sin sesión: la llave es el `codigo` de la oferta (32 hex, llega por
// el botón de WhatsApp). Lo que la familia puede hacer aquí:
//   GET  /portal/oferta/:codigo                  → todo lo que se le ofrece
//   POST /portal/oferta/:codigo/evento           → «abrió el formulario de X»
//   POST /portal/oferta/:codigo/borrador         → carpeta temporal para fotos
//   POST /portal/oferta/:codigo/compra           → pedido de recordatorios o cédula
//   POST /portal/oferta/:codigo/afiliacion       → solicitud de plan pre-exequial
//   POST /portal/oferta/:codigo/afiliacion/pago  → reporta el pago de esa solicitud
//   POST /portal/oferta/:codigo/baja             → «no deseo recibir información»
//
// Reglas que no se negocian:
//   · El PRECIO nunca viene del navegador: sale de la base, con el descuento de
//     la configuración, dentro de la transacción.
//   · El código da acceso a COMPRAR, no a LEER: el portal no devuelve teléfono,
//     cédula ni dirección de la ficha (un enlace reenviado no debe filtrar datos).
//   · Recordatorios y cédulas crean una compra normal del módulo de la 168 con
//     `origen = 'OFERTA_POSTERIOR'`: misma tabla, mismo Tablero de Producción.
//   · 🔒 Pre-exequiales NO crea contrato: guarda la solicitud y, como mucho, la
//     deja en «pago reportado». Validar el pago y crear el contrato son de
//     coordinación (ventas-posteriores.js).
import { pool, log } from './db.js'
import { autorizacionDelPayload, registrarAutorizacion, FALTA_AUTORIZACION } from './autorizaciones.js'
import {
  HttpError, t, normalizarItemsPublicos, fotosQuePide, precioPublico, METODOS_PAGO,
} from './compras-recordatorios-reglas.js'
import { prefijoFotos, leerEntrega, leerPagoCliente } from './catalogo-publico.js'
import { nombreMascota } from './condolencias.js'
import { cargarConfigOferta, reglas, registrarExclusion } from './oferta-posterior.js'
import {
  CATEGORIAS, precioConDescuento, ofertaVigente, normalizarSolicitudPreexequial, ReglaError,
} from './oferta-posterior-reglas.js'
import {
  asegurarVenta, moverPorFamilia, registrarEvento, avisarEquipo,
} from './ventas-posteriores.js'

const TAG = '[oferta-portal]'
const CODIGO = /^[0-9a-f]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = v => typeof v === 'string' && UUID.test(v)
const ES_CEDULA = /c[eé]dula/i     // misma convención que src/lib/comprasRecordatorios.js

const NO_DISPONIBLE = { status: 404, body: { ok: false, error: 'no_disponible' } }
const VENCIDA = { status: 410, body: { ok: false, error: 'vencida', mensaje: 'Esta oferta ya cerró. Escríbenos por WhatsApp y con gusto te ayudamos.' } }

/** La oferta de un código, con lo mínimo del servicio. null si no existe o está excluida. */
async function cargarOferta(client, codigo, { bloquear = false } = {}) {
  if (!CODIGO.test(String(codigo || ''))) return null
  const { rows: [o] } = await client.query(
    `SELECT o.id, o.servicio_id, o.estado, o.fecha_envio, o.created_at, o.abierta_en,
            s.mascota_id, m.nombre AS mascota,
            COALESCE(o.cliente_id, m.cliente_id) AS cliente_id,
            c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.cedula_nit,
            c.whatsapp, c.email
       FROM public.ofertas_posteriores o
       JOIN public.servicios s     ON s.id = o.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = COALESCE(o.cliente_id, m.cliente_id)
      WHERE o.codigo = $1 ${bloquear ? 'FOR UPDATE OF o' : ''}`, [codigo])
  if (!o || o.estado === 'EXCLUIDO' || !o.cliente_id) return null
  return o
}

const vigente = (o, r) => ofertaVigente({ fechaEnvio: o.fecha_envio, creadaEn: o.created_at, diasVigencia: r.vigencia })

function venceEl(o, r) {
  const desde = new Date(o.fecha_envio || o.created_at)
  return new Date(desde.getTime() + r.vigencia * 86400000).toISOString()
}

/** "ANA MARÍA" → "Ana": solo el primer nombre, para saludar sin exponer la ficha. */
function primerNombre(nombre) {
  const p = String(nombre || '').trim().split(/\s+/)[0] || ''
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''
}

async function leerPagoYEnvio(client, cfg) {
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'CATALOGO_PUBLICO'`)
  const c = Object.fromEntries(rows.map(x => [x.clave, x.valor]))
  const propio = typeof cfg.datos_pago === 'string' ? cfg.datos_pago.trim() : ''
  return {
    valorEnvio: Math.max(0, Math.round(Number(c.valor_envio) || 0)),
    datosPago: propio || (typeof c.datos_pago === 'string' ? c.datos_pago : ''),
  }
}

// ─── Qué se le ofrece ───────────────────────────────────────────────────────
const COLS_REC = `id, nombre, descripcion, categoria, foto_url, tiempo_produccion_dias,
                  campos_texto, requiere_imagen, solo_nombre, max_fotos, precio_base,
                  precio_publico, activo, venta_publica`

/**
 * Los productos de una categoría para ESTE servicio:
 *   · CEDULAS: lo que se vende al público y se llama «cédula».
 *   · RECORDATORIOS: lo que se vende al público, no es cédula y NO venía ya en
 *     el servicio de la familia («recordatorios que no estuvieron incluidos»).
 */
async function productosPorCategoria(client, servicioId) {
  const { rows } = await client.query(
    `SELECT ${COLS_REC},
            EXISTS (SELECT 1 FROM public.servicio_recordatorios sr
                     WHERE sr.servicio_id = $1 AND sr.recordatorio_id = r.id
                       AND COALESCE(sr.origen, '') <> 'REMOVIDO' AND sr.estado <> 'NA') AS ya_lo_tiene
       FROM public.recordatorios r
      WHERE r.activo AND r.venta_publica
      ORDER BY r.categoria, r.nombre`, [servicioId])
  return {
    CEDULAS: rows.filter(r => ES_CEDULA.test(r.nombre)),
    RECORDATORIOS: rows.filter(r => !ES_CEDULA.test(r.nombre) && !r.ya_lo_tiene),
  }
}

const productosDe = async (client, categoria, servicioId) =>
  (await productosPorCategoria(client, servicioId))[categoria]

function productoPublico(r, descuento) {
  const lista = precioPublico(r)
  return {
    id: r.id, nombre: r.nombre, descripcion: r.descripcion || '', categoria: r.categoria,
    foto_url: r.foto_url || null, tiempo_dias: r.tiempo_produccion_dias ?? null,
    campos_texto: Array.isArray(r.campos_texto) ? r.campos_texto : [],
    fotos: fotosQuePide(r), fisico: r.categoria === 'fisico',
    precio_lista: lista, precio: precioConDescuento(lista, descuento),
  }
}

// Mismo redondeo que `aplicarDescuento` de src/lib/afiliaciones.js: el contrato
// que arme coordinación tiene que dar EXACTAMENTE el valor prometido aquí.
const valorAfiliacion = (lista, p) => Math.round((Number(lista) || 0) * (1 - (Number(p) || 0) / 100))

async function configAfiliaciones(client) {
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = 'AFILIACIONES'`)
  const c = Object.fromEntries(rows.map(x => [x.clave, x.valor]))
  return {
    precios: (c.precios && typeof c.precios === 'object') ? c.precios : {},
    equivalente: (c.plan_equivalente && typeof c.plan_equivalente === 'object')
      ? c.plan_equivalente : { BRONCE: 'BASICO', PLATA: 'STANDARD', ORO: null, DIAMANTE: 'PREMIUM' },
    oroOpciones: Array.isArray(c.oro_opciones) ? c.oro_opciones : [],
    mult1: Number(c.multiplicador_semestre_1) > 0 ? Number(c.multiplicador_semestre_1) : 5,
    mult2: Number(c.multiplicador_semestre_2) > 0 ? Number(c.multiplicador_semestre_2) : 3,
    recargo: Number(c.recargo_municipios) > 0 ? Number(c.recargo_municipios) : 30000,
  }
}

const NIVELES = ['BRONCE', 'PLATA', 'ORO', 'DIAMANTE']
const TIPOS = ['ANUAL', 'VITALICIO']
const lista = (v, validos) => (Array.isArray(v) ? v : validos).map(x => String(x).toUpperCase()).filter(x => validos.includes(x))

/**
 * Los planes pre-exequiales que se muestran: nivel × tipo con PRECIO en
 * Configuración › Afiliaciones (sin precio, no se ofrece). El texto de cada plan
 * (descripción, beneficios, imagen) lo escribe coordinación en `planes_info`;
 * las CONDICIONES salen del contrato real, no se inventan aquí.
 */
async function planesOfrecidos(client, cfg, descuento) {
  const af = await configAfiliaciones(client)
  const niveles = lista(cfg.niveles_ofrecidos, NIVELES)
  const tipos = lista(cfg.tipos_ofrecidos, TIPOS)
  const info = (cfg.planes_info && typeof cfg.planes_info === 'object') ? cfg.planes_info : {}

  // Nombre del plan de servicio que se usa al activar (BRONCE → Básico…).
  const codigos = [...new Set([...Object.values(af.equivalente).filter(Boolean), ...af.oroOpciones])]
  const { rows: planes } = codigos.length
    ? await client.query(`SELECT codigo, nombre FROM public.planes WHERE codigo = ANY($1::text[])`, [codigos])
    : { rows: [] }
  const nombrePlan = Object.fromEntries(planes.map(p => [p.codigo, p.nombre]))

  const out = []
  for (const nivel of niveles) {
    for (const tipo of tipos) {
      const valorLista = Math.round(Number(af.precios?.[tipo]?.[nivel]) || 0)
      if (!(valorLista > 0)) continue
      const eq = af.equivalente[nivel]
      const i = info[nivel] && typeof info[nivel] === 'object' ? info[nivel] : {}
      out.push({
        nivel, tipo, valor_lista: valorLista, valor: valorAfiliacion(valorLista, descuento),
        // La cláusula 5×/3× va sobre el precio de LISTA: el descuento abarata la
        // afiliación, no la activación (decisión de David, migr. 077).
        activacion: tipo === 'ANUAL'
          ? { hasta_180: valorLista * af.mult1, desde_181: valorLista * af.mult2 } : null,
        equivale: (eq ? [eq] : af.oroOpciones).map(c => nombrePlan[c]).filter(Boolean),
        descripcion: t(i.descripcion, 600) || '',
        beneficios: (Array.isArray(i.beneficios) ? i.beneficios : []).map(b => t(b, 200)).filter(Boolean).slice(0, 12),
        imagen_url: /^https:\/\//i.test(String(i.imagen_url || '')) ? String(i.imagen_url) : null,
      })
    }
  }
  return { planes: out, niveles, tipos, recargo: af.recargo }
}

/** Condiciones generales, tal como están en el contrato vigente (lib/afiliaciones.js). */
function condicionesContrato(recargo) {
  const pesos = n => `$${Math.round(n).toLocaleString('es-CO')}`
  return [
    'El plan cubre el servicio funerario de tu mascotica. Su valor es por mascota.',
    'Plan ANUAL: tiene una vigencia de 365 días desde su formalización y es renovable. Durante el primer contrato, usar el servicio tiene un valor de activación por mascota (el que ves en cada plan): uno hasta el día 180 y otro menor desde el día 181. Si renuevas con continuidad, la activación no tiene costo.',
    'Plan VITALICIO: no tiene tiempos de carencia; se puede usar desde la formalización del contrato y rige hasta que se requiera.',
    'La mascotica debe estar viva en el momento del pago. La información falsa anula el contrato.',
    'El plan se cumple prestando el servicio funerario: no se devuelve en dinero ni se cambia por dinero.',
    `La recogida se hace en Bogotá D. C., de 7:00 a. m. a 6:00 p. m., todos los días, sujeta al volumen de rutas. En municipios aledaños (Funza, Mosquera, entre otros) tiene un recargo de ${pesos(recargo)}.`,
    'El descuento de esta oferta aplica al valor de la afiliación, no al valor de activación.',
  ]
}

// ── GET /portal/oferta/:codigo ──────────────────────────────────────────────
//
// 🩸 UNA sola conexión y las consultas EN FILA, no en `Promise.all` sobre el
// pool: el pool del backend tiene 5 conexiones y esta página la abren varias
// familias a la vez justo después del envío de las 14:00. Con siete consultas
// en paralelo, una sola visita se las llevaba todas y el webhook, el agente y
// los jobs se quedaban esperando (el incidente del pool agotado, otra vez).
export async function verOferta({ codigo }) {
  const client = await pool.connect()
  try {
    return await verOfertaCon(client, codigo)
  } finally {
    client.release()
  }
}

async function verOfertaCon(client, codigo) {
  const o = await cargarOferta(client, codigo)
  if (!o) return NO_DISPONIBLE
  const cfg = await cargarConfigOferta(client)
  const r = reglas(cfg)
  const base = {
    ok: true, mascota: nombreMascota(o.mascota), familia: primerNombre(o.cliente_nombre),
    descuentos: r.descuentos,
  }
  if (!vigente(o, r)) return { status: 200, body: { ...base, vigente: false } }

  if (!o.abierta_en) {
    await client.query(`UPDATE public.ofertas_posteriores SET abierta_en = now() WHERE id = $1 AND abierta_en IS NULL`, [o.id])
      .catch(e => log(TAG, 'no se pudo marcar abierta', e.message))
  }

  const productos = await productosPorCategoria(client, o.servicio_id)
  const recs = productos.RECORDATORIOS, ceds = productos.CEDULAS
  const pl = await planesOfrecidos(client, cfg, r.descuentos.PREEXEQUIALES)
  const pago = await leerPagoYEnvio(client, cfg)
  const { rows: especies } = await client.query(`SELECT id, nombre FROM public.especies ORDER BY nombre`)
  const { rows: ventas } = await client.query(
    `SELECT categoria, estado, valor, descuento_pct, solicitud->'plan' AS plan,
            CASE WHEN jsonb_typeof(solicitud->'mascotas') = 'array'
                 THEN jsonb_array_length(solicitud->'mascotas') ELSE 0 END AS n_mascotas
       FROM public.ventas_posteriores WHERE oferta_id = $1`, [o.id])
  const { rows: [baja] } = await client.query(
    `SELECT 1 AS si FROM public.oferta_exclusiones
      WHERE retirado_en IS NULL AND cliente_id = $1 LIMIT 1`, [o.cliente_id])

  // De la solicitud pre-exequial solo vuelve lo necesario para retomar el pago.
  const pre = ventas.find(v => v.categoria === 'PREEXEQUIALES')
  return {
    status: 200,
    body: {
      ...base, vigente: true, vence: venceEl(o, r), baja: !!baja,
      recordatorios: recs.map(x => productoPublico(x, r.descuentos.RECORDATORIOS)),
      cedulas: ceds.map(x => productoPublico(x, r.descuentos.CEDULAS)),
      planes: pl.planes, condiciones: condicionesContrato(pl.recargo),
      especies, valor_envio: pago.valorEnvio, datos_pago: pago.datosPago,
      metodos_pago: METODOS_PAGO.filter(m => m !== 'EFECTIVO'),
      solicitud_plan: pre && pre.plan ? {
        estado: pre.estado, plan: pre.plan, n_mascotas: pre.n_mascotas,
        valor: Number(pre.valor) || 0, total: (Number(pre.valor) || 0) * pre.n_mascotas,
      } : null,
    },
  }
}

// ── POST /portal/oferta/:codigo/evento ──────────────────────────────────────
// La familia abrió una sección (INTERESADO) o empezó su formulario
// (FORMULARIO_INICIADO). Crea la oportunidad si no existía.
// 🔕 NO avisa al equipo (David, 27-nov): abrir el enlace NO es comprar. El aviso
// «NUEVA OPORTUNIDAD» le llegaba a Diseño como si fuera una venta, sin producto
// (33 avisos falsos en 8 días). Diseño solo se entera de una COMPRA real.
export async function eventoOferta({ codigo, payload = {} }) {
  const categoria = String(payload.categoria || '').toUpperCase()
  if (!CATEGORIAS.includes(categoria)) return { status: 400, body: { ok: false, error: 'Categoría inválida' } }
  const paso = payload.paso === 'FORMULARIO_INICIADO' ? 'FORMULARIO_INICIADO' : 'INTERESADO'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const o = await cargarOferta(client, codigo, { bloquear: true })
    if (!o) { await client.query('ROLLBACK'); return NO_DISPONIBLE }
    const r = reglas(await cargarConfigOferta(client))
    if (!vigente(o, r)) { await client.query('ROLLBACK'); return VENCIDA }
    const a = await asegurarVenta(client, { ofertaId: o.id, categoria, origen: 'PORTAL' })
    await moverPorFamilia(client, a.venta, paso, { origen: 'PORTAL' })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
  return { status: 200, body: { ok: true } }
}

// ── POST /portal/oferta/:codigo/borrador ────────────────────────────────────
// Misma carpeta temporal del catálogo público (fotos-clientes/compra-web/<id>/,
// 3 horas): así no hay que abrir ninguna política de almacenamiento nueva.
export async function borradorOferta({ codigo, contexto = {} }) {
  const o = await cargarOferta(pool, codigo)
  if (!o) return NO_DISPONIBLE
  const r = reglas(await cargarConfigOferta())
  if (!vigente(o, r)) return VENCIDA
  const { rows: [b] } = await pool.query(
    `INSERT INTO public.compra_web_borradores (ip) VALUES ($1) RETURNING id, expira_en`,
    [contexto.ip || null])
  return { status: 200, body: { ok: true, borrador: b.id, expira_en: b.expira_en } }
}

async function borradorVivo(client, borrador) {
  const { rows: [b] } = await client.query(
    `SELECT id FROM public.compra_web_borradores
      WHERE id = $1 AND usado_en IS NULL AND expira_en > now() FOR UPDATE`, [borrador])
  if (!b) throw new HttpError(410, 'El pedido venció (pasaron más de 3 horas). Recarga la página y vuelve a armarlo.')
}

function titular(o) {
  return { nombre: o.cliente_nombre, apellido: o.cliente_apellido, documento: o.cedula_nit, telefono: o.whatsapp, email: o.email }
}

/** La mascotica VIVA de una cédula: siempre es nueva en la ficha de la familia. */
async function crearMascotaCedula(client, m, clienteId) {
  const nombre = t(m?.nombre, 80)
  if (!nombre) throw new HttpError(400, 'Escribe el nombre de la mascotica.')
  const especieId = parseInt(m?.especie_id) || null
  if (!especieId) throw new HttpError(400, 'Indica la especie de la mascotica.')
  const { rows: [esp] } = await client.query(`SELECT 1 FROM public.especies WHERE id = $1`, [especieId])
  if (!esp) throw new HttpError(400, 'Indica la especie de la mascotica.')
  if (!['Macho', 'Hembra'].includes(m?.sexo)) throw new HttpError(400, 'Indica si es macho o hembra.')
  const nacimiento = /^\d{4}-\d{2}-\d{2}$/.test(String(m?.fecha_nacimiento || '')) ? m.fecha_nacimiento : null
  const { rows: [r] } = await client.query(
    `INSERT INTO public.mascotas (nombre, especie_id, raza, sexo, tamano, peso_kg, cliente_id, fallecida, fecha_nacimiento, notas)
     VALUES ($1, $2, $3, $4, 'Mediano', 0, $5, false, $6::date, $7) RETURNING id_mascota, nombre`,
    [nombre, especieId, t(m?.raza, 80), m.sexo, clienteId, nacimiento,
     'Registrada desde la oferta posterior (cédula de mascota).'])
  return r
}

// ── POST /portal/oferta/:codigo/compra ──────────────────────────────────────
export async function comprarOferta({ codigo, payload = {}, contexto = {} }) {
  const categoria = String(payload.categoria || '').toUpperCase()
  if (!['RECORDATORIOS', 'CEDULAS'].includes(categoria)) return { status: 400, body: { ok: false, error: 'Categoría inválida' } }
  const borrador = payload.borrador
  if (!esUuid(borrador)) return { status: 400, body: { ok: false, error: 'Pedido inválido. Recarga la página.' } }
  const version = autorizacionDelPayload(payload)
  if (!version) return FALTA_AUTORIZACION

  const client = await pool.connect()
  let aviso = null
  try {
    await client.query('BEGIN')
    const o = await cargarOferta(client, codigo, { bloquear: true })
    if (!o) { await client.query('ROLLBACK'); return NO_DISPONIBLE }

    // Reintento tras un corte de red: la compra ya quedó con ese id.
    const { rows: [ya] } = await client.query(
      `SELECT k.numero, k.total FROM public.compras_recordatorios k
         JOIN public.ventas_posteriores v ON v.id = k.venta_posterior_id
        WHERE k.id = $1 AND v.oferta_id = $2`, [borrador, o.id])
    if (ya) {
      await client.query('ROLLBACK')
      return { status: 200, body: { ok: true, numero: ya.numero, total: Number(ya.total), repetida: true } }
    }

    const cfg = await cargarConfigOferta(client)
    const r = reglas(cfg)
    if (!vigente(o, r)) { await client.query('ROLLBACK'); return VENCIDA }
    await borradorVivo(client, borrador)

    // Solo lo que ESTA oferta le muestra en ESTA categoría, al precio de la base.
    const permitidos = await productosDe(client, categoria, o.servicio_id)
    const catalogo = Object.fromEntries(permitidos.map(x => [x.id, x]))
    const norm = normalizarItemsPublicos(payload.items, catalogo, prefijoFotos(borrador))
    const descuento = r.descuentos[categoria]
    const items = norm.items.map(it => ({
      ...it, precio_unitario: precioConDescuento(precioPublico(catalogo[it.recordatorio_id]), descuento),
    }))
    const subtotal = items.reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
    const { valorEnvio: envioCfg } = await leerPagoYEnvio(client, cfg)
    const valorEnvio = norm.hayFisico ? envioCfg : 0
    const total = subtotal + valorEnvio
    const entrega = leerEntrega(payload.entrega, norm.hayFisico)
    const pagoCliente = leerPagoCliente(payload.pago, borrador)

    // Recordatorios: de la mascotica del servicio. Cédula: de una mascotica viva.
    const mascota = categoria === 'CEDULAS'
      ? await crearMascotaCedula(client, payload.mascota, o.cliente_id)
      : { id_mascota: o.mascota_id, nombre: o.mascota }

    const { venta } = await asegurarVenta(client, { ofertaId: o.id, categoria, origen: 'PORTAL' })

    const { rows: [compra] } = await client.query(
      `INSERT INTO public.compras_recordatorios
         (id, cliente_id, mascota_id, total, notas, registrado_por, origen, valor_envio, entrega,
          pago_cliente, venta_posterior_id)
       VALUES ($1, $2, $3, $4, $5, NULL, 'OFERTA_POSTERIOR', $6, $7, $8, $9)
       RETURNING id, numero`,
      [borrador, o.cliente_id, mascota.id_mascota, total, t(payload.observaciones, 2000),
       valorEnvio, entrega ? JSON.stringify(entrega) : null, JSON.stringify(pagoCliente), venta.id])

    for (const it of items) {
      await client.query(
        `INSERT INTO public.compra_recordatorio_items
           (compra_id, recordatorio_id, nombre, cantidad, precio_unitario, datos_cliente, imagenes_urls, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [compra.id, it.recordatorio_id, it.nombre, it.cantidad, it.precio_unitario,
         it.datos_cliente ? JSON.stringify(it.datos_cliente) : null, it.imagenes_urls, it.notas])
    }

    await registrarAutorizacion(client, {
      origen: 'OFERTA_POSTERIOR', medio: 'PORTAL_WEB', politicaVersion: version,
      titular: titular(o), servicioId: o.servicio_id, clienteId: o.cliente_id, contexto,
      notas: `Compra desde la oferta posterior CR-${compra.numero}`,
    })

    await client.query(
      `INSERT INTO public.compra_recordatorio_eventos (compra_id, tipo, detalle, por)
       VALUES ($1, 'CREADA', $2, NULL)`,
      [compra.id, JSON.stringify({ origen: 'OFERTA_POSTERIOR', categoria, descuento_pct: descuento, total,
                                   subtotal, envio: valorEnvio, items: items.length, pago: pagoCliente.modo })])
    await client.query(`UPDATE public.compra_web_borradores SET usado_en = now() WHERE id = $1`, [borrador])

    await client.query(
      `UPDATE public.ventas_posteriores SET descuento_pct = $2, updated_at = now() WHERE id = $1`,
      [venta.id, descuento])
    const movida = await moverPorFamilia(client, venta, 'COMPRA_REGISTRADA', { compra: `CR-${compra.numero}`, total })
    if (movida.estado === venta.estado) {
      // Ya había comprado antes por esta oferta: la venta no cambia de estado,
      // pero la segunda compra queda en la bitácora.
      await registrarEvento(client, { ventaId: venta.id, tipo: 'COMPRA', detalle: { compra: `CR-${compra.numero}`, total } })
    }

    await client.query('COMMIT')
    log(TAG, `compra CR-${compra.numero}`, { categoria, total, items: items.length, pago: pagoCliente.modo })
    aviso = {
      categoria, servicioId: o.servicio_id, ventaId: venta.id,
      titulo: categoria === 'CEDULAS' ? `🪪 COMPRA ADICIONAL – CÉDULA · CR-${compra.numero}` : `🛒 COMPRA ADICIONAL – RECORDATORIO · CR-${compra.numero}`,
      mensaje: `${items.map(i => i.nombre + (i.cantidad > 1 ? ` ×${i.cantidad}` : '')).join(', ')} · `
        + `${categoria === 'CEDULAS' ? `para ${mascota.nombre}` : `de ${o.mascota}`} · `
        + (pagoCliente.modo === 'COMPROBANTE' ? 'adjuntó comprobante (por verificar)' : 'paga después'),
      numero: compra.numero, total,
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return { status: e.status, body: { ok: false, error: e.message } }
    throw e
  } finally {
    client.release()
  }
  await avisarEquipo(aviso)
  return { status: 201, body: { ok: true, numero: aviso.numero, total: aviso.total } }
}

// ── POST /portal/oferta/:codigo/afiliacion ──────────────────────────────────
// 🔒 Guarda la SOLICITUD. No crea cliente, mascotas ni contrato: eso lo hace
// coordinación en /presequiales cuando el pago esté validado.
const ESTADOS_EDITABLES = ['INTERESADO', 'FORMULARIO_INICIADO', 'FORMULARIO_COMPLETO', 'PENDIENTE_PAGO', 'CERRADA_SIN_VENTA']

export async function solicitarAfiliacion({ codigo, payload = {}, contexto = {} }) {
  const version = autorizacionDelPayload(payload)
  if (!version) return FALTA_AUTORIZACION

  const client = await pool.connect()
  let aviso = null, respuesta = null
  try {
    await client.query('BEGIN')
    const o = await cargarOferta(client, codigo, { bloquear: true })
    if (!o) { await client.query('ROLLBACK'); return NO_DISPONIBLE }
    const cfg = await cargarConfigOferta(client)
    const r = reglas(cfg)
    if (!vigente(o, r)) { await client.query('ROLLBACK'); return VENCIDA }

    const { planes, niveles, tipos } = await planesOfrecidos(client, cfg, r.descuentos.PREEXEQUIALES)
    const { rows: especies } = await client.query(`SELECT id, nombre FROM public.especies`)
    const s = normalizarSolicitudPreexequial(payload, { niveles, tipos, especies })
    const plan = planes.find(p => p.nivel === s.plan.nivel && p.tipo === s.plan.tipo)
    if (!plan) throw new ReglaError('Ese plan no está disponible en este momento. Recarga la página.')

    const { venta } = await asegurarVenta(client, { ofertaId: o.id, categoria: 'PREEXEQUIALES', origen: 'PORTAL' })
    if (!ESTADOS_EDITABLES.includes(venta.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: 'ya_solicitada', mensaje: 'Ya recibimos tu solicitud y estamos trabajando en ella. Si necesitas cambiar algo, escríbenos por WhatsApp.' } }
    }

    const nombreEspecie = Object.fromEntries(especies.map(e => [Number(e.id), e.nombre]))
    const solicitud = {
      ...s,
      mascotas: s.mascotas.map(m => ({ ...m, especie: nombreEspecie[m.especie_id] || null })),
      diligenciada_en: new Date().toISOString(),
    }
    await client.query(
      `UPDATE public.ventas_posteriores
          SET solicitud = $2, valor_lista = $3, descuento_pct = $4, valor = $5,
              pago_cliente = NULL,
              -- Solicitud nueva o corregida = pago por hacer: ninguna validación
              -- anterior (de una venta que se cerró) la puede heredar.
              pago_validado_en = NULL, pago_validado_por = NULL,
              updated_at = now()
        WHERE id = $1`,
      [venta.id, JSON.stringify(solicitud), plan.valor_lista, r.descuentos.PREEXEQUIALES, plan.valor])

    // «Formulario completo» y «Pendiente de pago» son el mismo instante: con el
    // formulario lleno lo único que falta es el pago. Quedan los dos en la bitácora.
    let v = await moverPorFamilia(client, venta, 'FORMULARIO_COMPLETO',
      { plan: `${plan.nivel} ${plan.tipo}`, mascotas: s.mascotas.length })
    v = await moverPorFamilia(client, v, 'PENDIENTE_PAGO')
    if (v.estado === venta.estado) {
      await registrarEvento(client, { ventaId: venta.id, tipo: 'SOLICITUD_ACTUALIZADA',
        detalle: { plan: `${plan.nivel} ${plan.tipo}`, mascotas: s.mascotas.length } })
    }

    await registrarAutorizacion(client, {
      origen: 'OFERTA_POSTERIOR', medio: 'PORTAL_WEB', politicaVersion: version,
      titular: { nombre: s.propietario.nombre, apellido: s.propietario.apellido,
                 documento: s.propietario.documento, telefono: s.propietario.whatsapp, email: s.propietario.email },
      servicioId: o.servicio_id, clienteId: o.cliente_id, contexto,
      notas: `Solicitud de plan pre-exequial ${plan.nivel} ${plan.tipo} desde la oferta posterior`,
    })
    // Con el mismo cliente y ANTES del COMMIT: pedir otra conexión al pool con
    // esta todavía tomada podía devolver 500 por una solicitud que sí se guardó.
    const pago = await leerPagoYEnvio(client, cfg)
    await client.query('COMMIT')

    const total = plan.valor * s.mascotas.length
    respuesta = { ok: true, estado: v.estado, valor: plan.valor, valor_lista: plan.valor_lista,
                  n_mascotas: s.mascotas.length, total, datos_pago: pago.datosPago }
    aviso = {
      categoria: 'PREEXEQUIALES', servicioId: o.servicio_id, ventaId: venta.id,
      titulo: `📋 Solicitud de plan pre-exequial — ${plan.nivel} ${plan.tipo}`,
      mensaje: `${s.propietario.nombre} ${s.propietario.apellido} · ${s.mascotas.length} mascotica(s): `
        + `${s.mascotas.map(m => m.nombre).join(', ')} · Pendiente de pago · Contacto: ${s.propietario.whatsapp}`,
    }
    log(TAG, 'solicitud pre-exequial', venta.id, plan.nivel, plan.tipo, s.mascotas.length)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError || e instanceof ReglaError) return { status: e.status, body: { ok: false, error: e.message } }
    throw e
  } finally {
    client.release()
  }
  await avisarEquipo(aviso)
  return { status: 200, body: respuesta }
}

// ── POST /portal/oferta/:codigo/afiliacion/pago ─────────────────────────────
// La familia REPORTA el pago. No es plata recibida: lo valida coordinación.
export async function reportarPagoAfiliacion({ codigo, payload = {} }) {
  const borrador = payload.borrador
  if (!esUuid(borrador)) return { status: 400, body: { ok: false, error: 'Pago inválido. Recarga la página.' } }

  const client = await pool.connect()
  let aviso = null
  try {
    await client.query('BEGIN')
    const o = await cargarOferta(client, codigo, { bloquear: true })
    if (!o) { await client.query('ROLLBACK'); return NO_DISPONIBLE }
    const { rows: [venta] } = await client.query(
      `SELECT * FROM public.ventas_posteriores
        WHERE oferta_id = $1 AND categoria = 'PREEXEQUIALES' FOR UPDATE`, [o.id])
    if (!venta || !venta.solicitud) throw new HttpError(409, 'Primero completa el formulario de afiliación.')
    if (!['PENDIENTE_PAGO', 'PAGO_REPORTADO'].includes(venta.estado)) {
      throw new HttpError(409, 'Tu pago ya fue recibido y lo estamos revisando. Si necesitas algo, escríbenos por WhatsApp.')
    }
    await borradorVivo(client, borrador)
    const pago = leerPagoCliente({ ...payload, modo: 'COMPROBANTE' }, borrador)

    await client.query(
      `UPDATE public.ventas_posteriores SET pago_cliente = $2, updated_at = now() WHERE id = $1`,
      [venta.id, JSON.stringify(pago)])
    const v = await moverPorFamilia(client, venta, 'PAGO_REPORTADO', { metodo: pago.metodo })
    if (v.estado === venta.estado) {
      await registrarEvento(client, { ventaId: venta.id, tipo: 'PAGO_REPORTADO', detalle: { metodo: pago.metodo, reemplaza: true } })
    }
    await client.query(`UPDATE public.compra_web_borradores SET usado_en = now() WHERE id = $1`, [borrador])
    await client.query('COMMIT')

    const sol = venta.solicitud || {}
    aviso = {
      categoria: 'PREEXEQUIALES', servicioId: o.servicio_id, ventaId: venta.id,
      titulo: '💳 Pago reportado — plan pre-exequial',
      mensaje: `${sol.propietario?.nombre || ''} ${sol.propietario?.apellido || ''} adjuntó el comprobante `
        + `(${pago.metodo}). Hay que VALIDARLO antes de generar el contrato.`,
    }
    log(TAG, 'pago reportado', venta.id)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof HttpError) return { status: e.status, body: { ok: false, error: e.message } }
    throw e
  } finally {
    client.release()
  }
  await avisarEquipo(aviso)
  return { status: 200, body: { ok: true, estado: 'PAGO_REPORTADO' } }
}

// ── POST /portal/oferta/:codigo/baja ────────────────────────────────────────
// «No deseo recibir información», también desde el portal. Funciona aunque la
// oferta esté vencida: el derecho a no ser contactado no caduca.
export async function bajaOferta({ codigo }) {
  if (!CODIGO.test(String(codigo || ''))) return NO_DISPONIBLE
  const { rows: [o] } = await pool.query(
    `SELECT o.id, COALESCE(o.cliente_id, m.cliente_id) AS cliente_id, c.whatsapp
       FROM public.ofertas_posteriores o
       JOIN public.servicios s     ON s.id = o.servicio_id
       JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
       LEFT JOIN public.clientes c ON c.id_cliente = COALESCE(o.cliente_id, m.cliente_id)
      WHERE o.codigo = $1`, [codigo])
  if (!o) return NO_DISPONIBLE
  await registrarExclusion(pool, {
    clienteId: o.cliente_id, telefono: o.whatsapp, origen: 'FAMILIA',
    motivo: 'Lo pidió en el portal de la oferta posterior',
  })
  await pool.query(
    `UPDATE public.ofertas_posteriores
        SET respuesta = 'NO_DESEA', respondido_en = now(), updated_at = now() WHERE id = $1`, [o.id])
  log(TAG, 'baja desde el portal', o.id)
  return { status: 200, body: { ok: true } }
}
