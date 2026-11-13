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
  // Precio de los restos cálcicos en el portal de fotos (migración 176).
  // NULL = no se ofrecen: un precio inventado aquí sería dinero cobrado sin
  // que nadie lo decidiera.
  restos_calcicos_precio: null,
}

/** Precio vigente de los restos cálcicos, o null si no se ofrecen. */
export function precioRestosCalcicos(cfg) {
  const n = Number(cfg?.restos_calcicos_precio)
  return Number.isFinite(n) && n > 0 ? n : null
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
    // Eligió en el portal de fotos y el compostaje no se ha cumplido: avisarle
    // ahora sería mandarle a confirmar una entrega que todavía no existe.
    if (e.estado === 'RESERVADA') return { enviado: false, motivo: 'compostaje_en_curso' }
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
              pe.planta_id, pe.planta_nombre, pe.servicio_id, pe.restos_calcicos,
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
    // RESERVADA: el compostaje sigue en curso y este enlace todavía no se le ha
    // mandado a nadie. No hay nada que confirmar aún.
    if (!e || e.estado === 'RESERVADA') return { status: 404, body: { ok: false, error: 'no_encontrado' } }

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
      // La especie ya se fijó en el portal de fotos (primer contacto): aquí
      // no se vuelve a preguntar, pero la familia SÍ tiene que confirmar la
      // entrega. Es distinto de `ya_eligio`, que es "ya confirmó todo".
      especie_fijada: !!e.planta_id,
      restos_calcicos: e.restos_calcicos === true,
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
      `SELECT pe.id, pe.servicio_id, pe.estado, pe.planta_id, pe.planta_nombre,
              pe.restos_calcicos,
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
    if (!e || e.estado === 'RESERVADA') { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'no_encontrado' } } }

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
    const { comprados, totalExtras, ids } = await comprarExtras(client, {
      eleccionId: e.id, servicioId: e.servicio_id, pedidos: payload.adicionales,
    })

    // ── Dinero: mismo criterio que Ofertas (migración 078) ──
    const { valorAntes, valorDespues } = await sumarAlServicio(client, e.servicio_id, totalExtras)

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
    // La especie pudo fijarse meses antes, en el portal de fotos: el nombre se
    // toma de la fila para que la alerta de la entrega no salga sin especie.
    const especie = plantaNombre || e.planta_nombre
    const conRestos = e.restos_calcicos === true
      ? ' ⚠ LLEVA RESTOS CÁLCICOS: entregarlos junto con la planta.' : ''
    await client.query(
      `INSERT INTO public.alertas_operativas
         (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
       VALUES ($1, $2, 'PLANTA_ELEGIDA', $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [e.servicio_id, MOD,
       totalExtras > 0 || conRestos ? 'ALTA' : 'MEDIA',
       `${e.mascota}: planta elegida${especie ? ` — ${especie}` : ''}.` + detalleExtras + conRestos,
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


// ─── Dinero y extras: un solo camino para los tres portales ─────────────────
// Portal de la planta, portal de fotos (segunda planta, 205) y portal de visita
// (restos, 205) cobran igual: el precio sale de la DB y se suma al servicio en
// la misma transacción.

/**
 * Suma `monto` al total del servicio y RECALCULA `estado_pago`: un servicio
 * COMPLETO al que se le suma algo debe bajar a PARCIAL, o el saldo desaparece
 * de la cartera (mismo criterio que Ofertas, migración 078).
 */
async function sumarAlServicio(client, servicioId, monto) {
  if (!(monto > 0)) return { valorAntes: null, valorDespues: null }
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
    [servicioId, monto]
  )
  const despues = Number(sv[0]?.valor_total)
  return Number.isFinite(despues)
    ? { valorAntes: despues - monto, valorDespues: despues }
    : { valorAntes: null, valorDespues: null }
}

/**
 * Compra plantas extra (`plantas.adicional = true`) para una elección. Solo
 * ids y cantidades del navegador; el precio, de `plantas`. Lo ya comprado no
 * se vuelve a cobrar (UNIQUE eleccion_id + planta_id). NO suma al servicio:
 * eso lo hace quien llama con `sumarAlServicio`, una sola vez por todo.
 */
async function comprarExtras(client, { eleccionId, servicioId, pedidos }) {
  const lista = Array.isArray(pedidos) ? pedidos.slice(0, 20) : []
  const ids = [...new Set(lista.map(a => uuidOrNull(a?.planta_id)).filter(Boolean))]
  const comprados = []
  let totalExtras = 0
  if (!ids.length) return { comprados, totalExtras, ids }
  const { rows: disp } = await client.query(
    `SELECT id, nombre, precio FROM public.plantas
      WHERE id = ANY($1::uuid[]) AND activo = true AND adicional = true`, [ids]
  )
  const porId = new Map(disp.map(p => [p.id, p]))
  for (const pedido of lista) {
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
      [eleccionId, servicioId, p.id, p.nombre, cantidad, precio, total]
    )
    if (!ins[0]) continue
    comprados.push({ nombre: p.nombre, cantidad, precio, total })
    totalExtras += total
  }
  return { comprados, totalExtras, ids }
}

/** La fila de la elección del servicio; si no existe, la crea RESERVADA. */
async function eleccionReservada(client, { servicioId, codigo }) {
  const { rows } = await client.query(
    `SELECT id, estado, planta_id, planta_nombre, restos_calcicos, restos_respuesta, restos_foto_url
       FROM public.planta_elecciones WHERE servicio_id = $1 FOR UPDATE`, [servicioId]
  )
  if (rows[0]) return rows[0]
  const { rows: ins } = await client.query(
    `INSERT INTO public.planta_elecciones (servicio_id, estado, codigo, enlace)
     VALUES ($1, 'RESERVADA', $2, $3)
     RETURNING id, estado, planta_id, planta_nombre, restos_calcicos, restos_respuesta, restos_foto_url`,
    [servicioId, codigo, construirEnlacePlanta(codigo)]
  )
  return ins[0]
}

// ─── Primer contacto: el paso de la planta en el portal de fotos ────────────
// Migraciones 176 y 205. La familia de Compets elige la especie y, si quiere,
// una SEGUNDA PLANTA (producto adicional con su precio) desde la solicitud de
// imágenes. Los restos cálcicos YA NO se preguntan aquí: pasaron al portal de
// visita (205), más cerca del proceso en planta. Todo en la MISMA fila de
// `planta_elecciones` (estado RESERVADA); el job la despierta al cumplirse.

/**
 * Lo que el portal de fotos muestra en el paso de la planta, o null si a este
 * servicio no le aplica o ya no queda nada por decidir.
 */
export async function plantaParaPortalFotos(client, { servicioId, tipoProceso }) {
  if (tipoProceso !== 'COMPOSTAJE_INDIVIDUAL') return null
  const cfg = await cargarConfigPlantas(client)
  const { rows } = await client.query(
    `SELECT id, estado, planta_id, planta_nombre
       FROM public.planta_elecciones WHERE servicio_id = $1`, [servicioId]
  )
  const e = rows[0]
  if (e?.estado === 'CANCELADA') return null

  const { rows: comprados } = e ? await client.query(
    `SELECT planta_id, nombre, cantidad, total FROM public.planta_adicionales
      WHERE eleccion_id = $1 ORDER BY created_at`, [e.id]
  ) : { rows: [] }

  const [opciones, adicionales] = await Promise.all([
    e?.planta_id ? [] : catalogo(client, 'elegible'),
    catalogo(client, 'adicional', parseInt(cfg.max_adicionales) || 4, comprados.map(c => c.planta_id)),
  ])
  if (!opciones.length && !adicionales.length) return null

  return {
    // Sin precios: la especie va incluida en el plan.
    opciones: opciones.map(({ id, nombre, descripcion, imagen_url }) => ({ id, nombre, descripcion, imagen_url })),
    elegida: e?.planta_id ? { planta_id: e.planta_id, nombre: e.planta_nombre } : null,
    // La segunda planta: el precio va solo para MOSTRARLO; al cobrar se relee.
    adicionales,
    comprados: comprados.map(c => ({ nombre: c.nombre, cantidad: c.cantidad, total: Number(c.total) })),
  }
}

/**
 * Guarda el paso de la planta del portal de fotos. Corre DENTRO de la
 * transacción del portal (quien llama hace BEGIN/COMMIT).
 *
 * payload: `{ planta_id, adicionales: [{planta_id, cantidad}] }` — nunca un precio.
 * (`restos_calcicos: true` lo puede mandar todavía una pestaña con el portal
 * viejo en caché: se respeta para no perder una compra que la familia hizo.)
 * Devuelve `{ ok:false, error }` si falta la especie (el portal responde 422),
 * o `{ ok:true, planta, extras, restos_valor }`.
 */
export async function reservarPlantaPortalFotos(client, { servicioId, codigo, mascota, payload }) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const { rows } = await client.query(
    `SELECT id, estado, planta_id FROM public.planta_elecciones WHERE servicio_id = $1 FOR UPDATE`, [servicioId]
  )
  if (rows[0]?.estado === 'CANCELADA') return { ok: true, planta: null, extras: [], restos_valor: 0 }

  // ── Especie: solo si todavía no hay una ──
  let plantaId = null, plantaNombre = null
  if (!rows[0]?.planta_id) {
    const opciones = await catalogo(client, 'elegible')
    if (opciones.length) {
      const elegida = opciones.find(o => o.id === uuidOrNull(p.planta_id))
      if (!elegida) return { ok: false, error: 'planta_requerida' }
      plantaId = elegida.id
      plantaNombre = elegida.nombre
    }
  }
  const pideExtras = Array.isArray(p.adicionales) && p.adicionales.length > 0
  const pideRestos = p.restos_calcicos === true
  if (!plantaId && !pideExtras && !pideRestos) return { ok: true, planta: null, extras: [], restos_valor: 0 }

  const e = await eleccionReservada(client, { servicioId, codigo })
  if (plantaId) {
    await client.query(
      `UPDATE public.planta_elecciones
          SET planta_id = $2, planta_nombre = $3, fecha_eleccion = COALESCE(fecha_eleccion, now())
        WHERE id = $1 AND planta_id IS NULL`,
      [e.id, plantaId, plantaNombre]
    )
  }

  // ── Segunda planta ──
  const { comprados, totalExtras, ids } = await comprarExtras(client, {
    eleccionId: e.id, servicioId, pedidos: p.adicionales,
  })
  const { valorAntes, valorDespues } = await sumarAlServicio(client, servicioId, totalExtras)

  const partes = []
  if (plantaId) partes.push(`Desde el portal de fotos, la familia eligió la planta "${plantaNombre}" para ${mascota}.`)
  if (comprados.length) {
    partes.push('Compró ' + comprados.map(c => `${c.cantidad}× ${c.nombre} ($${c.total.toLocaleString('es-CO')})`).join(', ') +
      ' como planta adicional. Pendiente de cobro.')
  }
  if (partes.length) {
    await client.query(
      `INSERT INTO public.novedades_servicio
         (servicio_id, tipo_novedad, descripcion, valor_ajuste, valor_antes, valor_despues, motivo_valor)
       VALUES ($1, 'NOTA', $2, $3, $4, $5, $6)`,
      [servicioId, partes.join(' '), totalExtras || null, valorAntes, valorDespues,
       valorAntes == null ? null : 'ADICIONAL']
    )
  }
  if (comprados.length) {
    await client.query(
      `INSERT INTO public.alertas_operativas
         (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
       VALUES ($1, $2, 'PLANTA_ELEGIDA', 'ALTA', $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [servicioId, MOD,
       `${mascota}: la familia compró una segunda planta desde el primer contacto (` +
         comprados.map(c => `${c.cantidad}× ${c.nombre}`).join(', ') + `).`,
       'Ya quedó sumada al total del servicio. Prever la planta adicional y confirmar el cobro en la entrega.',
       `planta:extras:${e.id}:${[...ids].sort().join(',')}`,
       JSON.stringify({ eleccion_id: e.id, extras: comprados, valor_extras: totalExtras, origen: 'PORTAL_FOTOS' })]
    )
  }

  let restosValor = 0
  if (pideRestos && !e.restos_calcicos) {
    restosValor = await cobrarRestos(client, { eleccionId: e.id, servicioId, mascota, origen: 'portal de fotos' })
  }

  return { ok: true, planta: plantaId ? plantaNombre : null, extras: comprados, restos_valor: restosValor }
}

// ─── Restos cálcicos (migración 205: se piden en el portal de VISITA) ───────

/**
 * Cobra los restos cálcicos y avisa a quien los tiene que separar (Tenjo) y a
 * coordinación. Devuelve lo cobrado (0 si ya estaban o no hay precio).
 * `AND restos_calcicos = false` es el candado anti doble cobro si la familia
 * reenvía: sin fila devuelta no se suma nada al servicio.
 */
async function cobrarRestos(client, { eleccionId, servicioId, mascota, origen }) {
  const precio = precioRestosCalcicos(await cargarConfigPlantas(client))
  if (precio == null) return 0
  const { rows: rc } = await client.query(
    `UPDATE public.planta_elecciones
        SET restos_calcicos = true, restos_calcicos_valor = $2, restos_calcicos_en = now(),
            restos_respuesta = 'SI', restos_respuesta_en = now()
      WHERE id = $1 AND restos_calcicos = false
        AND restos_cancelado_en IS NULL   -- se retractó (208): una pestaña vieja no los vuelve a cobrar
      RETURNING id`,
    [eleccionId, precio]
  )
  if (!rc[0]) return 0
  const { valorAntes, valorDespues } = await sumarAlServicio(client, servicioId, precio)
  const precioTxt = `$${precio.toLocaleString('es-CO')}`

  await client.query(
    `INSERT INTO public.novedades_servicio
       (servicio_id, tipo_novedad, descripcion, valor_ajuste, valor_antes, valor_despues, motivo_valor)
     VALUES ($1, 'NOTA', $2, $3, $4, $5, $6)`,
    [servicioId, `Desde el ${origen}, la familia pidió los RESTOS CÁLCICOS de ${mascota} (${precioTxt}). Pendiente de cobro.`,
     precio, valorAntes, valorDespues, valorAntes == null ? null : 'ADICIONAL']
  )
  await client.query(
    `INSERT INTO public.alertas_operativas
       (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
     VALUES ($1, $2, 'RESTOS_CALCICOS', 'ALTA', $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [servicioId, MOD,
     `⚠️ ESTE SERVICIO TIENE SOLICITUD DE RESTOS CÁLCICOS — ${mascota} (${precioTxt}).`,
     'Planta Tenjo: separar los restos cálcicos al sacar la mascota del cubículo. Se entregan con la planta, en su cenizario personalizado. Confirmar el cobro en la entrega.',
     `restos:${servicioId}`,
     JSON.stringify({ eleccion_id: eleccionId, valor: precio })]
  )
  // OPERARIO = el equipo de la planta de Tenjo, que es quien los separa.
  await client.query(
    `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
     SELECT p.id, 'RESTOS_CALCICOS', '⚠️ Servicio con solicitud de restos cálcicos', $1, $2::jsonb
     FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
     WHERE r.nombre IN ('COORDINADOR','ADMIN','OPERARIO') AND p.activo`,
    [`${mascota}: la familia pidió los restos cálcicos (${precioTxt}). Separarlos al sacarla del cubículo y entregarlos con la planta.`,
     JSON.stringify({ servicio_id: servicioId })]
  )
  return precio
}

/** Base pública de una foto subida desde el portal de visita (la valida el backend). */
function prefijoFotoRestos(codigo) {
  const base = (process.env.STORAGE_PUBLIC_BASE || 'https://db.orbitacac.com/storage/v1/').replace(/\/?$/, '/')
  return `${base}object/public/fotos-clientes/restos-calcicos/${codigo}/`
}

/**
 * Lo que el portal de visita muestra de los restos, o null si no aplica:
 * no es compostaje individual, la elección se canceló, no hay precio, ya dijo
 * que no, o ya está todo (pidió y mandó la foto).
 */
export async function restosParaPortalVisita(client, { servicioId }) {
  const { rows: sv } = await client.query(
    `SELECT pl.tipo_proceso FROM public.servicios s LEFT JOIN public.planes pl ON pl.id = s.plan_id WHERE s.id = $1`,
    [servicioId]
  )
  if (sv[0]?.tipo_proceso !== 'COMPOSTAJE_INDIVIDUAL') return null
  const { rows } = await client.query(
    `SELECT estado, restos_calcicos, restos_respuesta, restos_foto_url
       FROM public.planta_elecciones WHERE servicio_id = $1`, [servicioId]
  )
  const e = rows[0]
  if (e?.estado === 'CANCELADA') return null
  if (e?.restos_respuesta === 'NO') return null
  if (e?.restos_calcicos) return { precio: null, comprado: true, falta_foto: !e.restos_foto_url }
  const precio = precioRestosCalcicos(await cargarConfigPlantas(client))
  return precio == null ? null : { precio, comprado: false, falta_foto: true }
}

/**
 * La familia responde los restos desde el portal de visita.
 * payload: `{ respuesta: 'SI'|'NO', foto_url }`. Con SÍ la foto es obligatoria
 * (David 2026-11-03: sin foto no queda solicitud), y tiene que ser una subida
 * a la carpeta de ESTE enlace — una URL cualquiera no entra.
 */
export async function responderRestosVisita({ codigo, payload = {} }) {
  const cod = (codigo || '').trim().toUpperCase()
  if (!cod) return { status: 400, body: { ok: false, error: 'Código requerido' } }
  const respuesta = String(payload.respuesta || '').toUpperCase()
  if (!['SI', 'NO'].includes(respuesta)) return { status: 422, body: { ok: false, error: 'respuesta_invalida' } }
  const fotoUrl = typeof payload.foto_url === 'string' ? payload.foto_url.trim() : ''

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockClave(client, `restos:${cod}`)
    const { rows } = await client.query(
      `SELECT a.servicio_id, s.estado AS estado_servicio, s.codigo_fotos, i.cubiculo_liberado_en, m.nombre AS mascota
         FROM public.avisos_mitad_compostaje a
         JOIN public.servicios s ON s.id = a.servicio_id
         JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
         LEFT JOIN public.lotes_tenjo_items i ON i.id = a.lote_item_id
        WHERE a.codigo = $1 AND s.estado <> 'CANCELADO'
        LIMIT 1`,
      [cod]
    )
    const a = rows[0]
    if (!a) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'no_encontrado' } } }
    // Ya salió del cubículo: los restos se separan ahí, después no hay cómo.
    if (a.cubiculo_liberado_en || a.estado_servicio === 'ENTREGADO') {
      await client.query('ROLLBACK'); return { status: 410, body: { ok: false, error: 'cerrado' } }
    }
    const info = await restosParaPortalVisita(client, { servicioId: a.servicio_id })
    if (!info || (info.comprado && !info.falta_foto)) {
      await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'no_aplica' } }
    }

    const e = await eleccionReservada(client, { servicioId: a.servicio_id, codigo: a.codigo_fotos || cod })

    if (respuesta === 'NO') {
      if (info.comprado) { await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'ya_comprados' } } }
      await client.query(
        `UPDATE public.planta_elecciones SET restos_respuesta = 'NO', restos_respuesta_en = now() WHERE id = $1`, [e.id])
      await client.query('COMMIT')
      return { status: 200, body: { ok: true, respuesta: 'NO' } }
    }

    if (!fotoUrl || !fotoUrl.startsWith(prefijoFotoRestos(cod))) {
      await client.query('ROLLBACK'); return { status: 422, body: { ok: false, error: 'foto_requerida' } }
    }
    const valor = info.comprado ? 0
      : await cobrarRestos(client, { eleccionId: e.id, servicioId: a.servicio_id, mascota: a.mascota, origen: 'portal de visita' })
    if (!info.comprado && !valor) {
      // Sin precio configurado o ya cobrados por otra pestaña: no se finge una compra.
      await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'no_aplica' } }
    }
    await client.query(
      `UPDATE public.planta_elecciones
          SET restos_foto_url = $2, restos_foto_en = now(),
              restos_respuesta = 'SI', restos_respuesta_en = COALESCE(restos_respuesta_en, now())
        WHERE id = $1`,
      [e.id, fotoUrl]
    )
    await client.query(
      `INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion)
       VALUES ($1, 'NOTA', $2)`,
      [a.servicio_id, `La familia envió la FOTO – CENIZARIO RESTOS CÁLCICOS de ${a.mascota} desde el portal de visita.`]
    )
    // PRODUCTOR = Diseño/Producción: con la foto ya pueden personalizar el cenizario.
    await client.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
       SELECT p.id, 'RESTOS_CALCICOS', 'Foto para el cenizario de restos cálcicos', $1, $2::jsonb
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('PRODUCTOR','COORDINADOR','ADMIN') AND p.activo`,
      [`${a.mascota}: llegó la foto para personalizar el cenizario de sus restos cálcicos. Ver Producción.`,
       JSON.stringify({ servicio_id: a.servicio_id })]
    )
    await client.query('COMMIT')
    return { status: 200, body: { ok: true, respuesta: 'SI', valor } }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ─── Tablero Producción–Diseño: cenizarios de restos (migración 205) ────────
// Seguimiento APARTE de las líneas de recordatorio (David 2026-11-03): marcar
// el cenizario listo no mueve el estado del servicio.

export async function cenizariosRestos() {
  const { rows } = await pool.query(
    `SELECT pe.id, pe.servicio_id, pe.restos_calcicos_en, pe.restos_foto_url, pe.restos_foto_en,
            pe.restos_cenizario_listo_en, pe.planta_nombre,
            trim(coalesce(pl.nombre, '') || ' ' || coalesce(pl.apellido, '')) AS listo_por,
            m.nombre AS mascota, esp.nombre AS especie,
            trim(coalesce(c.nombre, '') || ' ' || coalesce(c.apellido, '')) AS propietario,
            cu.codigo AS cubiculo, s.estado AS servicio_estado, i.cubiculo_liberado_en
       FROM public.planta_elecciones pe
       JOIN public.servicios s ON s.id = pe.servicio_id
       JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
       LEFT JOIN public.especies esp ON esp.id = m.especie_id
       LEFT JOIN public.clientes c   ON c.id_cliente = m.cliente_id
       LEFT JOIN public.personal pl  ON pl.id = pe.restos_cenizario_listo_por
       LEFT JOIN LATERAL (
         SELECT li.cubiculo_id, li.cubiculo_liberado_en FROM public.lotes_tenjo_items li
          WHERE li.servicio_id = pe.servicio_id ORDER BY li.created_at DESC LIMIT 1
       ) i ON true
       LEFT JOIN public.cubiculos cu ON cu.id = i.cubiculo_id
      WHERE pe.restos_calcicos = true AND pe.estado <> 'CANCELADA'
        AND s.estado NOT IN ('CANCELADO', 'ENTREGADO')
      ORDER BY (pe.restos_cenizario_listo_en IS NOT NULL), (pe.restos_foto_url IS NOT NULL), pe.restos_calcicos_en`
  )
  return { status: 200, body: { ok: true, cenizarios: rows } }
}

export async function marcarCenizarioRestos({ eleccionId, listo, personalId }) {
  const id = uuidOrNull(eleccionId)
  if (!id) return { status: 400, body: { ok: false, error: 'Elección inválida' } }
  const { rows } = await pool.query(
    `UPDATE public.planta_elecciones
        SET restos_cenizario_listo_en  = CASE WHEN $2 THEN now() ELSE NULL END,
            restos_cenizario_listo_por = CASE WHEN $2 THEN $3::uuid ELSE NULL END
      WHERE id = $1 AND restos_calcicos = true
        AND ($2 = false OR restos_foto_url IS NOT NULL)
      RETURNING id`,
    [id, listo === true, uuidOrNull(personalId)]
  )
  if (!rows[0]) return { status: 409, body: { ok: false, error: listo ? 'Sin la foto no se puede marcar listo' : 'No encontrado' } }
  return { status: 200, body: { ok: true } }
}

// ─── Cancelar los restos cálcicos (migración 208) ───────────────────────────
/**
 * La familia se retractó. Deshace lo que hizo `cobrarRestos`, en una sola
 * transacción: quita la marca (Tenjo, Producción, certificado y recibo dejan de
 * contarlos), resta el valor del servicio y recalcula `estado_pago`, descarta
 * la alerta y avisa a Tenjo y Producción para que no los separen ni hagan el
 * cenizario. La foto, el valor y la fecha de compra se conservan como historia.
 * Si ya estaba pagado, queda saldo a favor: se devuelve en `saldo_a_favor`.
 */
export async function cancelarRestos({ servicioId, motivo, personalId }) {
  const id = uuidOrNull(servicioId)
  if (!id) return { status: 400, body: { ok: false, error: 'Servicio inválido' } }
  const motivoLimpio = String(motivo || '').trim().slice(0, 500)
  if (motivoLimpio.length < 3) return { status: 422, body: { ok: false, error: 'Escribe el motivo' } }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [s] } = await client.query(
      `SELECT s.estado::text AS estado, m.nombre AS mascota
         FROM public.servicios s JOIN public.mascotas m ON m.id_mascota = s.mascota_id
        WHERE s.id = $1 FOR UPDATE OF s`, [id])
    if (!s) { await client.query('ROLLBACK'); return { status: 404, body: { ok: false, error: 'No encontrado' } } }
    if (['ENTREGADO', 'CANCELADO'].includes(s.estado)) {
      await client.query('ROLLBACK')
      return { status: 409, body: { ok: false, error: `El servicio ya está ${s.estado.toLowerCase()}: no se pueden cancelar los restos` } }
    }
    const { rows: [e] } = await client.query(
      `UPDATE public.planta_elecciones
          SET restos_calcicos = false,
              restos_respuesta = 'NO', restos_respuesta_en = now(),
              restos_cancelado_en = now(), restos_cancelado_por = $2, restos_cancelado_motivo = $3
        WHERE servicio_id = $1 AND restos_calcicos = true
        RETURNING id, restos_calcicos_valor, restos_cenizario_listo_en`,
      [id, uuidOrNull(personalId), motivoLimpio])
    if (!e) { await client.query('ROLLBACK'); return { status: 409, body: { ok: false, error: 'Este servicio no tiene restos cálcicos pedidos' } } }

    const valor = Number(e.restos_calcicos_valor) || 0
    let valorAntes = null, valorDespues = null, saldoAFavor = 0, estadoPago = null
    if (valor > 0) {
      // Espejo de sumarAlServicio: lo que se sumó como adicional se resta igual.
      const { rows: [sv] } = await client.query(
        `UPDATE public.servicios
            SET valor_total = GREATEST(COALESCE(valor_total, 0) - $2, 0),
                valor_adicionales = CASE WHEN valor_adicionales IS NULL
                                         THEN NULL ELSE GREATEST(valor_adicionales - $2, 0) END,
                estado_pago = CASE
                  WHEN COALESCE(valor_pagado, 0) >= GREATEST(COALESCE(valor_total, 0) - $2, 0) THEN 'COMPLETO'
                  WHEN COALESCE(valor_pagado, 0) > 0 THEN 'PARCIAL'
                  ELSE 'PENDIENTE' END
          WHERE id = $1
        RETURNING valor_total, estado_pago, COALESCE(valor_pagado, 0) AS pagado`,
        [id, valor])
      estadoPago = sv.estado_pago
      valorDespues = Number(sv.valor_total)
      valorAntes = valorDespues + valor
      saldoAFavor = Math.max(Number(sv.pagado) - valorDespues, 0)
    }
    const valorTxt = `$${valor.toLocaleString('es-CO')}`
    await client.query(
      `INSERT INTO public.novedades_servicio
         (servicio_id, tipo_novedad, descripcion, valor_ajuste, valor_antes, valor_despues, motivo_valor, registrado_por)
       VALUES ($1, 'NOTA', $2, $3, $4, $5, $6, $7)`,
      [id,
       `Restos cálcicos de ${s.mascota} CANCELADOS: la familia se retractó. `
         + (valor > 0 ? `Se descuentan ${valorTxt} del valor a cobrar. ` : '')
         + (saldoAFavor > 0 ? `Ya estaba pagado: queda saldo a favor de $${saldoAFavor.toLocaleString('es-CO')}. ` : '')
         + `Motivo: ${motivoLimpio}`,
       valor > 0 ? -valor : null, valorAntes, valorDespues, valorAntes == null ? null : 'ITEM_QUITADO',
       uuidOrNull(personalId)])
    await client.query(
      `UPDATE public.alertas_operativas
          SET estado = 'DESCARTADA', fecha_resolucion = now(), usuario_resolvio = $2
        WHERE clave_dedupe = $1 AND estado IN ('ABIERTA', 'EN_GESTION')`,
      [`restos:${id}`, uuidOrNull(personalId)])
    // Los mismos que recibieron el pedido (Tenjo) y la foto (Producción).
    await client.query(
      `INSERT INTO public.notificaciones (para_personal_id, tipo, titulo, mensaje, datos)
       SELECT p.id, 'RESTOS_CALCICOS', '❌ Restos cálcicos cancelados', $1, $2::jsonb
       FROM public.personal p JOIN public.roles_personal r ON r.id = p.rol_principal_id
       WHERE r.nombre IN ('COORDINADOR','ADMIN','OPERARIO','PRODUCTOR') AND p.activo`,
      [`${s.mascota}: la familia ya NO quiere los restos cálcicos. No separarlos ni hacer su cenizario`
         + (e.restos_cenizario_listo_en ? ' (el cenizario ya estaba listo: apartarlo).' : '.'),
       JSON.stringify({ servicio_id: id })])
    await client.query('COMMIT')
    log('[restos-calcicos]', 'cancelados', id, valor, saldoAFavor ? `saldo a favor ${saldoAFavor}` : '')
    return { status: 200, body: { ok: true, valor, valor_total: valorDespues, estado_pago: estadoPago, saldo_a_favor: saldoAFavor } }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
