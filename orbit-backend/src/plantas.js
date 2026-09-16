// Elección de planta al cumplirse el compostaje — reglas canónicas server-side.
//
// Cuando una mascota completa su proceso en el cubículo (fecha de ingreso +
// `meses_compostaje`), se le avisa a la familia y se le manda un enlace para que
// elija la especie de planta y, si quiere, compre extras.
//
// Frase rectora, heredada de Ofertas: **el precio nunca viene del navegador**.
// El portal manda `{planta_id, adicionales:[{planta_id, cantidad}]}`; el monto,
// la vigencia y la elegibilidad se resuelven aquí contra `plantas`, dentro de la
// misma transacción que suma al servicio.
//
// Ver migración 149_plantas_eleccion_cliente.sql.
import { pool, log } from './db.js'
import { enviarPlantillaGenerica } from './whatsapp.js'
import { LINEA_WA_ID, LINEA_WA_NUMERO } from './linea-wa.js'
import { sanitizarEntrega, entregaNucleoOk } from './entrega.js'
import { autorizacionDelPayload, registrarAutorizacion, titularDeServicio, FALTA_AUTORIZACION }
  from './autorizaciones.js'

const MOD = 'PLANTAS'

export const CONFIG_DEFAULTS_PLANTAS = {
  activo:                 true,
  // Plantilla HSM aprobada por Meta. NULL a propósito: mientras no exista, el
  // job deja el aviso en PENDIENTE y lo reporta. Nunca simula un envío.
  plantilla:              null,
  max_envios_por_corrida: 30,
  arranque_desde:         null,
  max_adicionales:        4,
  dias_ventana_portal:    120,
}

/** Tokens permitidos en `vars` de la plantilla. Mismo criterio que imágenes. */
export const TOKENS_PLANTILLA = ['nombre', 'propietario', 'mascota', 'enlace', 'codigo']

export async function cargarConfigPlantas(client) {
  const cfg = { ...CONFIG_DEFAULTS_PLANTAS }
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MOD]
  )
  rows.forEach(r => { cfg[r.clave] = r.valor })
  return cfg
}

/** Enlace público del portal (HashRouter): base sin barra final + '#/planta/CODIGO'. */
export function construirEnlacePlanta(codigo) {
  const base = (process.env.APP_URL || 'https://orbit.orbitacac.com').replace(/\/+$/, '')
  return `${base}/#/planta/${codigo}`
}

/**
 * Normaliza la plantilla de config. Devuelve null si no está sembrada o le falta
 * el nombre → quien llama NO debe enviar (deja el aviso PENDIENTE).
 */
export function plantillaAviso(config) {
  const raw = config.plantilla
  const p = typeof raw === 'string' ? safeJson(raw) : raw
  if (!p || !p.nombre) return null
  const vars = Array.isArray(p.vars)
    ? p.vars.filter(v => TOKENS_PLANTILLA.includes(v))
    : ['mascota', 'enlace']
  return {
    nombre:    p.nombre,
    idioma:    p.idioma    || 'es_MX',
    categoria: p.categoria || 'UTILITY',
    vars:      vars.length ? vars : ['mascota', 'enlace'],
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

function uuidOrNull(value) {
  if (!value) return null
  const s = String(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null
}

/** Serializa por servicio dentro de la transacción (anti doble-clic / carrera del cron). */
async function lockClave(client, clave) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [clave])
}

// ─── Envío del aviso ────────────────────────────────────────────────────────

/**
 * Manda el aviso de una elección PENDIENTE (o reintenta una en ERROR).
 *
 * Sin plantilla sembrada NO se envía: se devuelve `{ enviado:false, motivo }` y
 * la fila se queda como está. Un aviso que no salió debe verse como no salido —
 * marcar ENVIADO sin haber escrito es la mentira que cuesta un cliente.
 *
 * Idempotente: si ya está ENVIADO o ELEGIDA, no vuelve a escribir.
 */
export async function enviarAvisoPlanta({ eleccionId, config = null, personalId = null }) {
  if (!uuidOrNull(eleccionId)) return { enviado: false, motivo: 'eleccion_invalida' }
  const client = await pool.connect()
  try {
    const cfg = config || await cargarConfigPlantas(client)
    const plantilla = plantillaAviso(cfg)

    const { rows } = await client.query(
      `SELECT pe.id, pe.servicio_id, pe.estado, pe.codigo, pe.enlace, pe.whatsapp_destino,
              m.nombre AS mascota,
              c.nombre AS cliente_nombre,
              TRIM(COALESCE(c.nombre,'') || ' ' || COALESCE(c.apellido,'')) AS propietario,
              c.whatsapp
         FROM public.planta_elecciones pe
         JOIN public.servicios s     ON s.id = pe.servicio_id
         JOIN public.mascotas m      ON m.id_mascota = s.mascota_id
         LEFT JOIN public.clientes c ON c.id_cliente = m.cliente_id
        WHERE pe.id = $1`,
      [eleccionId]
    )
    const e = rows[0]
    if (!e) return { enviado: false, motivo: 'no_encontrada' }
    if (e.estado === 'ELEGIDA')   return { enviado: false, motivo: 'ya_eligio' }
    if (e.estado === 'CANCELADA') return { enviado: false, motivo: 'cancelada' }
    if (e.estado === 'ENVIADO')   return { enviado: false, motivo: 'ya_enviado' }
    if (!plantilla) return { enviado: false, motivo: 'sin_plantilla' }

    // El número VIGENTE de la ficha manda sobre el que se guardó al crear el
    // aviso: cuando coordinación corrige el WhatsApp es justamente porque el
    // viejo estaba malo (mismo criterio que `waVigente` en imágenes).
    const destino = validoWa(e.whatsapp) || validoWa(e.whatsapp_destino)
    if (!destino) {
      await marcarError(client, eleccionId, 'El cliente no tiene un WhatsApp válido')
      return { enviado: false, motivo: 'sin_whatsapp' }
    }

    const enlace = e.enlace || construirEnlacePlanta(e.codigo)
    const valores = {
      nombre:      (e.cliente_nombre || '').split(' ')[0] || e.propietario || '',
      propietario: e.propietario || '',
      mascota:     e.mascota || 'tu mascota',
      enlace,
      codigo:      e.codigo,
    }
    const bodyParams = plantilla.vars.map(v => String(valores[v] ?? ''))

    try {
      const r = await enviarPlantillaGenerica({
        telefono:        destino,
        nombre:          e.propietario || '',
        plantillaNombre: plantilla.nombre,
        idioma:          plantilla.idioma,
        category:        plantilla.categoria,
        bodyParams,
        fromNumberId:    LINEA_WA_ID,
        personalId:      uuidOrNull(personalId),
      })
      await client.query(
        `UPDATE public.planta_elecciones
            SET estado = 'ENVIADO', fecha_envio = now(), mensaje_id = $2,
                whatsapp_destino = $3, linea_wa = $4, enlace = $5,
                error = NULL, intentos = intentos + 1
          WHERE id = $1`,
        [eleccionId, r?.messageId || null, destino, LINEA_WA_NUMERO, enlace]
      )
      return { enviado: true, mensaje_id: r?.messageId || null }
    } catch (err) {
      await marcarError(client, eleccionId, err.message)
      log('[plantas/enviar] ERROR', eleccionId, err.message)
      return { enviado: false, motivo: 'error_envio', error: err.message }
    }
  } finally {
    client.release()
  }
}

function validoWa(v) {
  const s = String(v || '').trim()
  return s.replace(/\D/g, '').length >= 10 ? s : null
}

async function marcarError(client, eleccionId, mensaje) {
  await client.query(
    `UPDATE public.planta_elecciones
        SET estado = 'ERROR', error = $2, intentos = intentos + 1
      WHERE id = $1 AND estado IN ('PENDIENTE','ERROR')`,
    [eleccionId, String(mensaje || '').slice(0, 500)]
  )
}

// ─── Portal público ─────────────────────────────────────────────────────────

/**
 * Lo que ve el cliente al abrir el enlace.
 *
 * En los portales públicos NUNCA se devuelve el error real de la DB (filtra el
 * esquema y no le dice nada a la familia): quien llama traduce con `errorInterno`.
 */
export async function datosPortalPlanta({ codigo }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT pe.id, pe.estado, pe.fecha_cumplida::text AS fecha_cumplida,
              pe.fecha_envio, pe.fecha_eleccion,
              pe.planta_id, pe.planta_nombre, pe.servicio_id,
              m.nombre AS mascota, esp.nombre AS especie,
              c.nombre AS cliente_nombre,
              cu.codigo AS cubiculo,
              -- Lo que la familia ya dejó en el portal de fotos: aquí se
              -- confirma o se corrige, no se vuelve a pedir desde cero.
              s.datos_entrega_cliente, s.datos_entrega_recibidos_en
         FROM public.planta_elecciones pe
         JOIN public.servicios s      ON s.id = pe.servicio_id
         JOIN public.mascotas m       ON m.id_mascota = s.mascota_id
         LEFT JOIN public.especies esp ON esp.id = m.especie_id
         LEFT JOIN public.clientes c  ON c.id_cliente = m.cliente_id
         LEFT JOIN public.lotes_tenjo_items i ON i.id = pe.lote_item_id
         LEFT JOIN public.cubiculos cu ON cu.id = i.cubiculo_id
        WHERE pe.codigo = $1 AND s.estado <> 'CANCELADO'
        ORDER BY pe.created_at DESC
        LIMIT 1`,
      [cod]
    )
    const e = rows[0]
    if (!e) return { status: 404, body: { ok: false, error: 'no_encontrado' } }

    const cfg = await cargarConfigPlantas(client)
    const cerrado = e.estado === 'CANCELADA' || fueraDeVentana(e, cfg)

    // Los comprados van primero: son la exclusión del catálogo de extras. Lo ya
    // comprado no se vuelve a ofrecer — el UNIQUE lo rechazaría igual, pero
    // mostrarlo como disponible haría creer al cliente que puede pedirlo otra vez.
    const { rows: comprados } = await client.query(
      `SELECT planta_id, nombre, cantidad, precio_unitario, total
         FROM public.planta_adicionales WHERE eleccion_id = $1 ORDER BY created_at`,
      [e.id]
    )
    const yaCompradas = comprados.map(a => a.planta_id)

    const [opciones, extras] = await Promise.all([
      catalogo(client, 'elegible'),
      catalogo(client, 'adicional', parseInt(cfg.max_adicionales) || 4, yaCompradas),
    ])

    return { status: 200, body: {
      ok: true,
      cerrado,
      ya_eligio: e.estado === 'ELEGIDA',
      servicio: { mascota: e.mascota, especie: e.especie, cubiculo: e.cubiculo,
                  nombre_cliente: (e.cliente_nombre || '').split(' ')[0] || '' },
      // Se sanea también a la SALIDA: la columna es jsonb y pudo escribirla una
      // versión anterior con campos que ya no existen.
      entrega: sanitizarEntrega(e.datos_entrega_cliente),
      entrega_recibidos_en: e.datos_entrega_recibidos_en,
      eleccion: {
        estado: e.estado,
        fecha_cumplida: e.fecha_cumplida,
        planta_id: e.planta_id,
        planta_nombre: e.planta_nombre,
      },
      opciones,
      adicionales: cerrado ? [] : extras,
      comprados: comprados.map(a => ({ ...a, precio_unitario: Number(a.precio_unitario), total: Number(a.total) })),
    } }
  } finally {
    client.release()
  }
}

/**
 * Catálogo del portal. `excluir` son las plantas que este cliente YA compró.
 *
 * Se descartan DENTRO de la consulta, antes del tope: filtrarlas después dejaba
 * a quien ya compró los primeros extras sin ver los siguientes — el tope se
 * gastaba en filas que nunca se iban a mostrar.
 */
async function catalogo(client, campo, limite = null, excluir = []) {
  const columna = campo === 'elegible' ? 'elegible' : 'adicional'
  const { rows } = await client.query(
    `SELECT id, nombre, descripcion, imagen_url, precio, precio_antes
       FROM public.plantas
      WHERE activo = true AND ${columna} = true
        AND NOT (id = ANY($1::uuid[]))
      ORDER BY orden ASC, nombre ASC
      ${limite ? 'LIMIT ' + parseInt(limite) : ''}`,
    [excluir]
  )
  // `precio_antes` es SOLO vitrina: el precio de lista que el portal tacha al
  // lado del real (migración 158). Se manda ya resuelto —null si no hay
  // promoción de verdad— para que la pantalla no tenga que decidir si un
  // "antes" menor o igual al precio es una oferta. Y jamás se cobra: el monto
  // sale de `precio`, aquí abajo en `responder`.
  return rows.map(p => ({
    ...p,
    precio: Number(p.precio) || 0,
    precio_antes: Number(p.precio_antes) > (Number(p.precio) || 0) ? Number(p.precio_antes) : null,
  }))
}

/**
 * ¿Se venció el enlace? Se cuenta desde el envío; si nunca salió, desde que se
 * cumplió el compostaje.
 *
 * `fecha_cumplida` DEBE llegar como TEXTO 'YYYY-MM-DD' (por eso el `::text` en
 * las consultas): una columna DATE llega a Node como Date de JS, y entonces
 * `String(fecha) + 'T12:00:00'` produce una fecha inválida — la resta da NaN, la
 * comparación es siempre falsa y la ventana NO cerraría nunca. Fallo mudo.
 */
function fueraDeVentana(e, cfg) {
  const dias = parseInt(cfg.dias_ventana_portal) || 120
  const base = e.fecha_envio ? new Date(e.fecha_envio) : new Date(String(e.fecha_cumplida) + 'T12:00:00')
  return (Date.now() - base.getTime()) > dias * 86400000
}

/**
 * El cliente responde: elige especie y, si quiere, compra extras.
 *
 * - La especie se fija UNA vez. Cambiarla después de que la planta ya se preparó
 *   sería una promesa que la planta no puede cumplir: si se equivocó, que nos
 *   escriba. Los extras SÍ se pueden seguir agregando mientras el enlace viva.
 * - Cada extra se cobra al precio de `plantas`, jamás al que mande el navegador.
 * - Todo es una sola transacción: o queda la elección con su cobro, o no queda nada.
 */
export async function guardarEleccionPlanta({ codigo, payload = {}, contexto = {} }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockClave(client, `planta:${cod}`)

    const { rows } = await client.query(
      `SELECT pe.id, pe.servicio_id, pe.estado, pe.planta_id,
              pe.fecha_cumplida::text AS fecha_cumplida, pe.fecha_envio,
              m.nombre AS mascota
         FROM public.planta_elecciones pe
         JOIN public.servicios s ON s.id = pe.servicio_id
         JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
        WHERE pe.codigo = $1 AND s.estado <> 'CANCELADO'
        ORDER BY pe.created_at DESC
        LIMIT 1
        FOR UPDATE OF pe`,
      [cod]
    )
    const e = rows[0]
    if (!e) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'no_encontrado' } } }

    const cfg = await cargarConfigPlantas(client)
    if (e.estado === 'CANCELADA' || fueraDeVentana(e, cfg)) {
      await client.query('ROLLBACK')
      return { status: 410, body: { ok: false, error: 'cerrado' } }
    }

    // Autorización de datos (Ley 1581 de 2012): la familia va a dejar dirección
    // y teléfonos para la entrega de la planta.
    const versionPolitica = autorizacionDelPayload(payload)
    if (!versionPolitica) { await client.query('ROLLBACK'); return FALTA_AUTORIZACION }
    const { clienteId, titular } = await titularDeServicio(client, e.servicio_id)
    await registrarAutorizacion(client, {
      origen: 'PORTAL_PLANTA', medio: 'PORTAL_WEB', politicaVersion: versionPolitica,
      titular, servicioId: e.servicio_id, clienteId, contexto,
    })

    // ── Entrega: la planta es un objeto físico que hay que llevar ──
    // A diferencia del portal de fotos, aquí NO se pregunta si hay algo físico:
    // lo que se está eligiendo ES lo físico. Un servicio 100 % digital nunca
    // llega a esta pantalla, porque sin cubículo no hay compostaje que cumplir.
    // Núcleo requerido igual que en la solicitud de imágenes, para que
    // coordinación reciba siempre la misma forma.
    const entrega = sanitizarEntrega(payload.entrega)
    if (!entregaNucleoOk(entrega)) {
      await client.query('ROLLBACK')
      return { status: 422, body: { ok: false, error: 'entrega_incompleta' } }
    }

    // ── Especie: obligatoria la primera vez, ignorada después ──
    let plantaId = e.planta_id
    let plantaNombre = null
    if (!plantaId) {
      const elegida = uuidOrNull(payload.planta_id)
      if (!elegida) { await client.query('ROLLBACK'); return { status: 422, body: { ok: false, error: 'planta_requerida' } } }
      const { rows: pr } = await client.query(
        `SELECT id, nombre FROM public.plantas
          WHERE id = $1 AND activo = true AND elegible = true`, [elegida]
      )
      if (!pr[0]) { await client.query('ROLLBACK'); return { status: 422, body: { ok: false, error: 'planta_invalida' } } }
      plantaId = pr[0].id
      plantaNombre = pr[0].nombre
    }

    // ── Extras: el precio sale de la DB, y solo de la DB ──
    const pedidos = Array.isArray(payload.adicionales) ? payload.adicionales.slice(0, 20) : []
    const ids = [...new Set(pedidos.map(a => uuidOrNull(a?.planta_id)).filter(Boolean))]
    let comprados = []
    let totalExtras = 0
    if (ids.length) {
      const { rows: disp } = await client.query(
        `SELECT id, nombre, precio FROM public.plantas
          WHERE id = ANY($1::uuid[]) AND activo = true AND adicional = true`, [ids]
      )
      const porId = new Map(disp.map(p => [p.id, p]))
      for (const pedido of pedidos) {
        const p = porId.get(uuidOrNull(pedido?.planta_id))
        if (!p) continue
        const cantidad = Math.max(1, Math.min(parseInt(pedido?.cantidad) || 1, 10))
        const precio = Number(p.precio) || 0
        const total = precio * cantidad
        // ON CONFLICT DO NOTHING + RETURNING: si ya lo había comprado, no
        // devuelve fila y NO se le vuelve a sumar al servicio.
        const { rows: ins } = await client.query(
          `INSERT INTO public.planta_adicionales
             (eleccion_id, servicio_id, planta_id, nombre, cantidad, precio_unitario, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (eleccion_id, planta_id) DO NOTHING
           RETURNING id`,
          [e.id, e.servicio_id, p.id, p.nombre, cantidad, precio, total]
        )
        if (!ins[0]) continue
        comprados.push({ nombre: p.nombre, cantidad, precio, total })
        totalExtras += total
      }
    }

    // ── Dinero: mismo criterio que Ofertas (migración 078) ──
    // `estado_pago` se RECALCULA siempre: un servicio COMPLETO al que se le
    // suma un extra debe bajar a PARCIAL, o el saldo desaparece de la cartera.
    let valorAntes = null, valorDespues = null
    if (totalExtras > 0) {
      const { rows: sv } = await client.query(
        `UPDATE public.servicios
            SET valor_total = COALESCE(valor_total, 0) + $2,
                -- NULL = "este servicio no lleva desglose de adicionales";
                -- ponerle el monto suelto mentiría sobre los adicionales previos.
                valor_adicionales = CASE WHEN valor_adicionales IS NULL
                                         THEN NULL ELSE valor_adicionales + $2 END,
                estado_pago = CASE
                  WHEN COALESCE(valor_pagado, 0) >= COALESCE(valor_total, 0) + $2 THEN 'COMPLETO'
                  WHEN COALESCE(valor_pagado, 0) > 0 THEN 'PARCIAL'
                  ELSE 'PENDIENTE' END
          WHERE id = $1
        RETURNING valor_total`,
        [e.servicio_id, totalExtras]
      )
      const despues = Number(sv[0]?.valor_total)
      if (Number.isFinite(despues)) { valorDespues = despues; valorAntes = despues - totalExtras }
    }

    // PISA lo anterior a propósito (el portal de fotos hace COALESCE y conserva).
    // Aquí la familia acaba de MIRAR estos datos y decir que son los buenos: si
    // corrigió la dirección porque se mudó, conservar la vieja sería el bug.
    // `datos_entrega_recibidos_en` pasa a ser la fecha de esa confirmación.
    await client.query(
      `UPDATE public.servicios
          SET datos_entrega_cliente = $2::jsonb,
              datos_entrega_recibidos_en = now()
        WHERE id = $1`,
      [e.servicio_id, JSON.stringify(entrega)]
    )

    await client.query(
      `UPDATE public.planta_elecciones
          SET estado = 'ELEGIDA',
              planta_id = $2,
              planta_nombre = COALESCE($3, planta_nombre),
              fecha_eleccion = COALESCE(fecha_eleccion, now())
        WHERE id = $1`,
      [e.id, plantaId, plantaNombre]
    )

    // ── Que se nos vea: novedad en la ficha + alerta operativa ──
    const detalleExtras = comprados.length
      ? ' Extras: ' + comprados.map(c => `${c.cantidad}× ${c.nombre} ($${c.total.toLocaleString('es-CO')})`).join(', ') + '.'
      : ''
    if (plantaNombre || comprados.length) {
      await client.query(
        `INSERT INTO public.novedades_servicio
           (servicio_id, tipo_novedad, descripcion, valor_ajuste, valor_antes, valor_despues, motivo_valor)
         VALUES ($1, 'NOTA', $2, $3, $4, $5, $6)`,
        [e.servicio_id,
         (plantaNombre
           ? `El cliente eligió la planta "${plantaNombre}" para ${e.mascota}.`
           : `El cliente agregó extras a la planta de ${e.mascota}.`) + detalleExtras +
         (totalExtras > 0 ? ' Pendiente de cobro.' : ''),
         totalExtras || null,
         valorAntes, valorDespues,
         // El CHECK de la 089 exige antes/después en pareja.
         valorAntes == null ? null : 'ADICIONAL']
      )
    }

    // Dedupe: una alerta por la elección, y una por CADA compra nueva de extras
    // (la clave lleva las plantas compradas). Sin distinguirlas, una compra
    // posterior chocaría con la alerta abierta de la elección y nadie se
    // enteraría del dinero nuevo.
    const claveDedupe = comprados.length
      ? `planta:extras:${e.id}:${[...ids].sort().join(',')}`
      : `planta:eleccion:${e.id}`
    await client.query(
      `INSERT INTO public.alertas_operativas
         (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
       VALUES ($1, $2, 'PLANTA_ELEGIDA', $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [e.servicio_id, MOD,
       totalExtras > 0 ? 'ALTA' : 'MEDIA',
       `${e.mascota}: planta elegida${plantaNombre ? ` — ${plantaNombre}` : ''}.` + detalleExtras,
       totalExtras > 0
         ? 'Los extras ya quedaron sumados al total del servicio. Preparar la planta y confirmar el cobro en la entrega.'
         : 'Preparar la planta de la especie elegida.',
       claveDedupe,
       JSON.stringify({ eleccion_id: e.id, planta_id: plantaId, extras: comprados, valor_extras: totalExtras })]
    )

    await client.query('COMMIT')
    return { status: 200, body: { ok: true, planta: plantaNombre, extras: comprados, valor_extras: totalExtras } }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
