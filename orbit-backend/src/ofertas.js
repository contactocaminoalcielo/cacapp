// Ofertas del portal de fotos — reglas canónicas server-side.
//
// El cliente que carga las imágenes de su mascota ve hasta MAX_OFERTAS_PORTAL
// anuncios (los de mayor prioridad que apliquen a su plan) y decide sí/no en
// cada uno. Por cada una que acepte, al enviar el formulario el recordatorio
// ofertado se agrega al servicio como adicional y se cobra al precio de oferta.
//
// Frase rectora: **el precio nunca viene del navegador**. El portal solo manda
// `oferta_id` y `acepta`; el monto, el recordatorio y la elegibilidad se
// resuelven aquí contra la DB dentro de la misma transacción de recepción.
//
// Ver migración 078_ofertas_portal.sql.
import { pideDatosCliente, requiereImagen } from './reglas-imagenes.js'
import { log } from './db.js'

const MOD = 'OFERTAS'

/**
 * Tope de anuncios que ve un cliente en una sesión del portal.
 *
 * Decisión de producto: es un momento sensible (acaba de perder a su mascota),
 * así que se muestran POCOS y los de mayor prioridad — no todo el catálogo.
 * Subir este número satura al cliente y baja la conversión de las demás.
 */
export const MAX_OFERTAS_PORTAL = 2

/**
 * Ofertas que le corresponden a un servicio (array, puede venir vacío).
 *
 * Filtros (todos obligatorios):
 *  - oferta y recordatorio activos, dentro de vigencia (fecha de Bogotá)
 *  - el plan del servicio está entre los planes elegidos (o aplica a todos)
 *  - el cliente NO respondió antes esta oferta (uq servicio+oferta)
 *
 * NO se descarta un recordatorio que el servicio ya lleva: la oferta es
 * justamente "un recuerdo más" y vender un segundo igual es válido (decisión de
 * David, 2026-07-30). Ya pasa en la operación normal — hay servicios con dos
 * Tarjetas de oración, dos Cristales con foto, dos Huellas 3D — y ni la DB
 * (sin UNIQUE sobre servicio+recordatorio) ni Producción se molestan.
 * Qué NO conviene duplicar (un memorial digital, un reporte) se controla al
 * crear la oferta: es la elección del recordatorio, no un filtro automático.
 *
 * Devuelve las primeras `limite` por `orden`. El tope es server-side a
 * propósito: el navegador no decide cuántos anuncios ve ni cuáles.
 */
export async function ofertasParaServicio(client, servicioId, planId, limite = MAX_OFERTAS_PORTAL) {
  if (!planId) return []
  const tope = Math.max(0, Math.min(parseInt(limite) || 0, MAX_OFERTAS_PORTAL))
  if (!tope) return []
  const { rows } = await client.query(
    `SELECT o.id, o.titulo, o.descripcion, o.imagen_url,
            o.precio_oferta, o.precio_lista, o.recordatorio_id,
            r.nombre       AS rec_nombre,
            r.categoria    AS rec_categoria,
            r.precio_base  AS rec_precio_base,
            r.solo_nombre, r.requiere_imagen, r.max_fotos, r.campos_texto
       FROM public.ofertas o
       JOIN public.recordatorios r ON r.id = o.recordatorio_id
      WHERE o.activo = true
        AND COALESCE(r.activo, true) = true
        AND (o.vigencia_desde IS NULL OR o.vigencia_desde <= public.fn_hoy_bogota())
        AND (o.vigencia_hasta IS NULL OR o.vigencia_hasta >= public.fn_hoy_bogota())
        AND (o.aplica_todos_planes
             OR EXISTS (SELECT 1 FROM public.oferta_planes op
                         WHERE op.oferta_id = o.id AND op.plan_id = $2))
        AND NOT EXISTS (SELECT 1 FROM public.oferta_respuestas resp
                         WHERE resp.servicio_id = $1 AND resp.oferta_id = o.id)
      ORDER BY o.orden ASC, o.created_at ASC
      LIMIT $3`,
    [servicioId, planId, tope]
  )
  return rows.map(mapearOferta)
}

/** Fila cruda de `ofertas` + `recordatorios` → forma que consume el portal. */
function mapearOferta(o) {
  const recordatorio = {
    id: o.recordatorio_id,
    nombre: o.rec_nombre,
    categoria: o.rec_categoria,
    solo_nombre: o.solo_nombre,
    requiere_imagen: o.requiere_imagen,
    max_fotos: o.max_fotos,
    campos_texto: Array.isArray(o.campos_texto) ? o.campos_texto : [],
  }
  return {
    id: o.id,
    titulo: o.titulo,
    descripcion: o.descripcion,
    imagen_url: o.imagen_url,
    precio_oferta: Number(o.precio_oferta) || 0,
    // Precio tachado: el de la oferta si lo definieron, si no el del catálogo.
    // Solo tiene sentido mostrarlo si es mayor que el de oferta.
    precio_lista: o.precio_lista != null ? Number(o.precio_lista) : (Number(o.rec_precio_base) || null),
    recordatorio,
    // Qué debe pedirle el portal si acepta (mismas reglas que los demás ítems).
    pide_datos: pideDatosCliente(recordatorio),
    // Si es físico y el servicio no tenía nada que entregar (eco-grupal), aceptar
    // la oferta OBLIGA a pedir los datos de entrega.
    es_fisico: (o.rec_categoria || '') !== 'digital',
  }
}

/**
 * Deja constancia de que el anuncio se le MOSTRÓ al cliente (abrió el link del
 * portal y el anuncio venía adentro). Sin esto la conversión se calcula sobre
 * los que respondieron, no sobre los que vieron: una oferta con 5 rechazos y
 * 200 vistas silenciosas se ve igual que una con 5 rechazos y 5 vistas.
 *
 * Una fila por (servicio, oferta) — las filas son servicios alcanzados y
 * `vistas` cuenta las recargas. **Best-effort**: si falla, se traga el error;
 * medir no puede romperle el portal a un cliente que está subiendo las fotos
 * de su mascota. Va fuera de cualquier transacción de venta.
 */
export async function registrarVistasOfertas(client, servicioId, ofertas) {
  if (!servicioId || !ofertas?.length) return
  try {
    await client.query(
      `INSERT INTO public.oferta_vistas (oferta_id, servicio_id)
       SELECT unnest($1::uuid[]), $2
       ON CONFLICT (servicio_id, oferta_id) DO UPDATE
         SET vistas = public.oferta_vistas.vistas + 1,
             ultima_vista_en = now()`,
      [ofertas.map(o => o.id), servicioId]
    )
  } catch (e) {
    log('[ofertas] no se pudo registrar la vista:', e?.message || e)
  }
}

/**
 * ¿El cliente llenó lo que el recordatorio ofertado necesita?
 * Espejo de `itemCompleto` de imagenes.js; se duplica a propósito para no
 * exportar de allí y crear una dependencia circular entre módulos.
 */
export function ofertaCompleta(oferta, entry, servicioId) {
  const rec = oferta.recordatorio
  if (requiereImagen(rec)) {
    const urls = (entry?.urls || []).filter(u => typeof u === 'string' && u.includes(servicioId))
    if (urls.length < rec.max_fotos) return false
  }
  for (const c of (rec.campos_texto || [])) {
    const arr = entry?.textos?.[c.label] || []
    const need = c.cantidad || 1
    const filled = (Array.isArray(arr) ? arr : []).filter(v => v && String(v).trim()).length
    if (filled < need) return false
  }
  return true
}

/** Deja constancia de que el cliente dijo que NO. No toca nada más. */
export async function registrarRechazoOferta(client, { servicioId, oferta }) {
  await client.query(
    `INSERT INTO public.oferta_respuestas (oferta_id, servicio_id, respuesta, precio_ofrecido)
     VALUES ($1, $2, 'RECHAZADA', $3)
     ON CONFLICT (servicio_id, oferta_id) DO NOTHING`,
    [oferta.id, servicioId, oferta.precio_oferta]
  )
}

/**
 * El cliente aceptó: se vende.
 *
 * 1. Crea el `servicio_recordatorios` (origen ADICIONAL) con sus imágenes/textos
 *    y lo deja EN_PROCESO — igual que el resto de ítems recibidos por el portal.
 * 2. Suma el precio de oferta a `valor_total` (+ `valor_adicionales` si el
 *    servicio lo lleva) y RECALCULA `estado_pago`. Recalcular siempre es
 *    obligatorio: un servicio COMPLETO al que se le agrega un adicional debe
 *    bajar a PARCIAL, si no el saldo desaparece de la cartera de Finanzas.
 *    `saldo_pendiente` NO se toca: es derivado (vista v_kanban).
 * 3. Novedad (queda visible en la ficha del Kanban) + alerta operativa para que
 *    coordinación lo cobre en la entrega.
 *
 * Debe llamarse DENTRO de la transacción de `recibirImagenesPortal`.
 * Devuelve el id del servicio_recordatorio creado.
 */
export async function aplicarOfertaAceptada(client, { servicioId, oferta, entry }) {
  const urls = (entry?.urls || []).filter(u => typeof u === 'string' && u.includes(servicioId))
  const textos = entry?.textos && Object.keys(entry.textos).length ? JSON.stringify(entry.textos) : null
  const precio = Number(oferta.precio_oferta) || 0

  const { rows: srRows } = await client.query(
    `INSERT INTO public.servicio_recordatorios
       (servicio_id, recordatorio_id, origen, estado, cantidad, precio_cobrado,
        imagen_cliente_url, imagenes_cliente_urls, datos_cliente)
     VALUES ($1, $2, 'ADICIONAL', 'EN_PROCESO', 1, $3, $4, $5::text[], $6::jsonb)
     RETURNING id`,
    [servicioId, oferta.recordatorio.id, precio, urls[0] || null, urls, textos]
  )
  const srId = srRows[0].id

  // Dinero. El precio sale de la fila `ofertas`, jamás del payload del cliente.
  if (precio > 0) {
    await client.query(
      `UPDATE public.servicios
          SET valor_total = COALESCE(valor_total, 0) + $2,
              -- NULL significa "este servicio no lleva desglose de adicionales";
              -- ponerle el monto suelto mentiría sobre los adicionales previos.
              valor_adicionales = CASE WHEN valor_adicionales IS NULL
                                       THEN NULL ELSE valor_adicionales + $2 END,
              estado_pago = CASE
                WHEN COALESCE(valor_pagado, 0) >= COALESCE(valor_total, 0) + $2 THEN 'COMPLETO'
                WHEN COALESCE(valor_pagado, 0) > 0 THEN 'PARCIAL'
                ELSE 'PENDIENTE' END
        WHERE id = $1`,
      [servicioId, precio]
    )
  }

  await client.query(
    `INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion, valor_ajuste)
     VALUES ($1, 'NOTA', $2, $3)`,
    [servicioId,
     `Oferta aceptada por el cliente en el portal de fotos: ${oferta.titulo} — ` +
     `${oferta.recordatorio.nombre} por $${precio.toLocaleString('es-CO')}. Pendiente de cobro en la entrega.`,
     precio]
  )

  await client.query(
    `INSERT INTO public.alertas_operativas
       (servicio_id, lote_id, modulo_origen, tipo_alerta, prioridad, mensaje,
        accion_recomendada, clave_dedupe, metadata)
     VALUES ($1, NULL, $2, 'OFERTA_ACEPTADA', 'ALTA', $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [servicioId, MOD,
     `El cliente aceptó la oferta "${oferta.titulo}" (${oferta.recordatorio.nombre}) por $${precio.toLocaleString('es-CO')}`,
     'El adicional ya quedó cargado al servicio y sumado al total. Confirmar el cobro en la entrega.',
     `oferta:${oferta.id}:${servicioId}`,
     JSON.stringify({ oferta_id: oferta.id, servicio_recordatorio_id: srId, precio })]
  )

  await client.query(
    `INSERT INTO public.oferta_respuestas
       (oferta_id, servicio_id, respuesta, precio_ofrecido, servicio_recordatorio_id)
     VALUES ($1, $2, 'ACEPTADA', $3, $4)
     ON CONFLICT (servicio_id, oferta_id) DO NOTHING`,
    [oferta.id, servicioId, precio, srId]
  )

  return srId
}
