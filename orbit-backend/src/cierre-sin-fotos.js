// Cierre de los servicios sin fotos — Ecogrupal y Básico (migración 227).
//
// REPORTE ORBIT 26-nov-2026 (Producción – Diseño): las familias que nunca
// mandaron las fotos dejaban el servicio abierto para siempre, aunque ya habían
// recibido los tres avisos. Ahora, `dias_espera` días CALENDARIO después del 3er
// contacto (el último aviso):
//
//   1. Se manda la plantilla del memorial (`DIGITALES.plantilla_memorial`) con
//      `texto_sin_foto` donde iría el enlace del memorial. Los demás digitales
//      (audio, herramientas de duelo, tarjeta de oración) van fijos en la
//      plantilla y quedan ENTREGADO, igual que en un envío normal.
//   2. Solo si Meta lo acepta, el «Memorial digital» pasa a NA con una nota: sale
//      del tablero de Diseño. Va en la MISMA transacción que la evidencia
//      (`digitales.enviarAutomatico`).
//   3. Ecogrupal → lo cierra como ENTREGADO el trigger de siempre
//      (`fn_cerrar_servicio_sin_ruta`, migr. 148/169) al ver el ítem en NA.
//      Básico → lo cierra este job si todo lo demás está entregado; el Memopet
//      del PLAN puede quedar pendiente (decisión David 26-nov). Si la cápsula,
//      las huellas o el soporte siguen en proceso, se reintenta cada corrida
//      hasta que salgan.
//
// Garantías (mismo patrón que el seguimiento de imágenes, migr. 044):
//   · UNIQUE (servicio_id) en `cierre_sin_fotos`: el envío no sale dos veces.
//   · La reserva ENVIANDO se commitea ANTES de la red. Si el proceso muere ahí,
//     la fila queda ENVIANDO y NADIE la reenvía sola: preferimos un envío
//     perdido a dos mensajes a una familia en duelo.
//   · Cada caso se vuelve a evaluar justo antes de enviar (pudo subir fotos).
//   · Solo los casos nuevos: 3er contacto desde `arranque_desde`.
//   · Nunca sábado, domingo ni festivo.
import { pool, log } from './db.js'
import { enviarAutomatico, cargarConfigDigitales } from './digitales.js'

const TAG = '[cierre-sin-fotos]'
const MODULO = 'CIERRE_SIN_FOTOS'

function bool(v) { return v === true || String(v ?? '').replace(/"/g, '').trim().toLowerCase() === 'true' }
function entero(v, def) { const n = parseInt(String(v ?? '').replace(/"/g, ''), 10); return Number.isFinite(n) ? n : def }
function lista(v) { return Array.isArray(v) ? v.map(String) : [] }
function fechaBogota(ts) {
  return new Date(ts).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' })
}

export async function cargarConfigSinFotos(client = pool) {
  const { rows } = await client.query(
    `SELECT clave, valor FROM public.config_operativa WHERE modulo = $1`, [MODULO])
  const c = Object.fromEntries(rows.map(r => [r.clave, r.valor]))
  const arranque = typeof c.arranque_desde === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.arranque_desde)
    ? c.arranque_desde.slice(0, 10) : null
  const texto = typeof c.texto_sin_foto === 'string' ? c.texto_sin_foto.replace(/\s+/g, ' ').trim() : ''
  const permitidos = (c.pendientes_permitidos && typeof c.pendientes_permitidos === 'object')
    ? Object.fromEntries(Object.entries(c.pendientes_permitidos).map(([k, v]) => [k, lista(v)]))
    : {}
  return {
    activo: bool(c.activo),
    arranque,
    dias: Math.max(1, entero(c.dias_espera, 15)),
    planes: lista(c.planes),
    tope: Math.max(1, Math.min(50, entero(c.max_por_corrida, 20))),
    texto: texto || '(no recibimos la foto)',
    permitidos,
  }
}

async function novedad(servicioId, texto) {
  await pool.query(
    `INSERT INTO public.novedades_servicio (servicio_id, tipo_novedad, descripcion) VALUES ($1, 'NOTA', $2)`,
    [servicioId, `🖼️ Sin fotos · ${texto}`.slice(0, 1000)]
  ).catch(e => log(TAG, 'no se pudo dejar la novedad —', e.message))
}

async function alertaOmitido(servicioId, mascota, motivo) {
  await pool.query(
    `INSERT INTO public.alertas_operativas
       (servicio_id, modulo_origen, tipo_alerta, prioridad, mensaje, accion_recomendada, clave_dedupe, metadata)
     VALUES ($1, 'SOLICITUDES_IMAGENES', 'IMAGENES_SIN_FOTOS_OMITIDO', 'MEDIA', $2, $3, $4, $5::jsonb)
     ON CONFLICT DO NOTHING`,
    [servicioId,
     `${mascota || 'Servicio'}: la familia no mandó fotos y no se pudo cerrar solo — ${motivo}`.slice(0, 500),
     'Revisar el servicio: decidir qué pasa con lo pendiente y cerrarlo a mano.',
     `sin_fotos:${servicioId}`,
     JSON.stringify({ motivo })]
  ).catch(e => log(TAG, 'no se pudo crear la alerta —', e.message))
}

/**
 * Los casos listos: 3er contacto ENVIADO (y no rechazado por Meta) hace
 * `dias` días o más, desde `arranque`, sin fotos, sin digitales enviados, y que
 * no tengan ya un cierre en curso o terminado. Uno por servicio.
 */
async function buscarCandidatos(cfg) {
  const { rows } = await pool.query(
    `WITH ult AS (
       SELECT DISTINCT ON (c.solicitud_id) c.solicitud_id, c.numero, c.enviado_en, c.estado_meta
         FROM public.solicitud_imagenes_contactos c
        WHERE c.estado = 'ENVIADO' AND c.enviado_en IS NOT NULL
        ORDER BY c.solicitud_id, c.enviado_en DESC, c.numero DESC
     )
     SELECT DISTINCT ON (s.id)
            s.id AS servicio_id, sol.id AS solicitud_id, p.codigo AS plan, ult.enviado_en AS ultimo_aviso,
            m.nombre AS mascota
       FROM public.solicitudes_imagenes sol
       JOIN ult                ON ult.solicitud_id = sol.id
       JOIN public.servicios s ON s.id = sol.servicio_id
       JOIN public.planes p    ON p.id = s.plan_id
       JOIN public.mascotas m  ON m.id_mascota = s.mascota_id
       LEFT JOIN public.cierre_sin_fotos x ON x.servicio_id = s.id
      WHERE p.codigo = ANY($1::text[])
        AND sol.estado IN ('ENVIADO', 'SIN_RESPUESTA')
        AND COALESCE(sol.seguimiento_pausado, false) = false
        AND COALESCE(sol.solo_adicional, false) = false
        AND s.fecha_imagenes_recibidas IS NULL
        AND s.estado NOT IN ('ENTREGADO', 'CANCELADO')
        AND ult.numero = 3
        AND ult.estado_meta IS DISTINCT FROM 'failed'
        AND (ult.enviado_en AT TIME ZONE 'America/Bogota')::date >= $2::date
        AND ult.enviado_en <= now() - make_interval(days => $3::int)
        AND NOT EXISTS (SELECT 1 FROM public.digitales_envios d
                         WHERE d.servicio_id = s.id AND d.estado = 'ENVIADO')
        AND (x.id IS NULL
             OR x.estado = 'OMITIDO'
             OR (x.estado = 'ERROR' AND x.intentos < 3 AND x.updated_at < now() - interval '20 hours'))
      ORDER BY s.id, ult.enviado_en`,
    [cfg.planes, cfg.arranque, cfg.dias]
  )
  return rows.sort((a, b) => new Date(a.ultimo_aviso) - new Date(b.ultimo_aviso)).slice(0, cfg.tope)
}

/**
 * ¿Hay algo que impida cerrar este servicio sin fotos? Otro ítem pendiente que
 * necesita foto y que no es el memorial ni un pendiente permitido del plan
 * (p. ej. un Memopet o un Altar comprado como ADICIONAL): eso se cobró y no se
 * puede dejar sin hacer por defecto.
 */
async function bloqueoPorOtraFoto(c, memorialRecId, cfg) {
  const permitidos = cfg.permitidos[c.plan] || []
  const { rows } = await pool.query(
    `SELECT r.nombre, sr.origen
       FROM public.servicio_recordatorios sr
       JOIN public.recordatorios r ON r.id = sr.recordatorio_id
      WHERE sr.servicio_id = $1
        AND COALESCE(sr.origen, '') <> 'REMOVIDO'
        AND sr.estado IN ('PENDIENTE', 'EN_PROCESO')
        AND r.requiere_imagen = true
        AND sr.recordatorio_id IS DISTINCT FROM $2::uuid
        AND NOT (sr.recordatorio_id::text = ANY($3::text[]) AND sr.origen IN ('PLAN', 'VIP'))`,
    [c.servicio_id, memorialRecId, permitidos]
  )
  if (!rows.length) return null
  return `tiene pendiente ${rows.map(r => `${r.nombre}${r.origen === 'ADICIONAL' ? ' (adicional)' : ''}`).join(', ')}, que necesita foto`
}

/** Reserva el caso (ENVIANDO) antes de la red. Devuelve true si este proceso lo tomó. */
async function reservar(c) {
  const { rows } = await pool.query(
    `INSERT INTO public.cierre_sin_fotos (servicio_id, solicitud_id, plan_codigo, ultimo_aviso_en, estado, intentos)
     VALUES ($1, $2, $3, $4, 'ENVIANDO', 1)
     ON CONFLICT (servicio_id) DO UPDATE
       SET estado = 'ENVIANDO', intentos = public.cierre_sin_fotos.intentos + 1,
           motivo = NULL, error = NULL,
           solicitud_id = EXCLUDED.solicitud_id, ultimo_aviso_en = EXCLUDED.ultimo_aviso_en
       WHERE public.cierre_sin_fotos.estado IN ('OMITIDO', 'ERROR')
     RETURNING id`,
    [c.servicio_id, c.solicitud_id, c.plan, c.ultimo_aviso]
  )
  return rows.length > 0
}

async function omitir(c, motivo) {
  await pool.query(
    `INSERT INTO public.cierre_sin_fotos (servicio_id, solicitud_id, plan_codigo, ultimo_aviso_en, estado, motivo)
     VALUES ($1, $2, $3, $4, 'OMITIDO', $5)
     ON CONFLICT (servicio_id) DO UPDATE SET estado = 'OMITIDO', motivo = EXCLUDED.motivo
       WHERE public.cierre_sin_fotos.estado IN ('OMITIDO', 'ERROR', 'ENVIANDO')`,
    [c.servicio_id, c.solicitud_id, c.plan, c.ultimo_aviso, motivo.slice(0, 500)]
  )
  await alertaOmitido(c.servicio_id, c.mascota, motivo)
}

/**
 * Básico: ENTREGADO si todo lo que cuenta ya está entregado. No cuentan: lo NA,
 * lo REMOVIDO, los ítems que el cierre sin ruta ya ignora
 * (`CIERRE_SIN_RUTA.items_no_bloqueantes`, hoy «Día de amor y milagrino») y los
 * pendientes permitidos del PLAN (el Memopet). Una entrega con mensajero o en
 * camino lo frena: esa la cierra quien la está haciendo.
 */
export async function cerrarBasicoSinFotos(servicioId, cfg) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [s] } = await client.query(
      `SELECT s.estado, p.codigo FROM public.servicios s JOIN public.planes p ON p.id = s.plan_id
        WHERE s.id = $1 FOR UPDATE OF s`, [servicioId])
    if (!s) { await client.query('ROLLBACK'); return { cerrado: false, motivo: 'no existe' } }
    if (s.estado === 'ENTREGADO') { await client.query('ROLLBACK'); return { cerrado: true, ya: true } }
    if (s.estado === 'CANCELADO' || s.codigo !== 'BASICO') { await client.query('ROLLBACK'); return { cerrado: false, motivo: s.estado } }

    const { rows: faltan } = await client.query(
      `SELECT r.nombre, sr.estado
         FROM public.servicio_recordatorios sr
         JOIN public.recordatorios r ON r.id = sr.recordatorio_id
        WHERE sr.servicio_id = $1
          AND COALESCE(sr.origen, '') <> 'REMOVIDO'
          AND sr.estado IS DISTINCT FROM 'NA' AND sr.estado IS DISTINCT FROM 'ENTREGADO'
          AND NOT (sr.recordatorio_id::text IN (
                SELECT e #>> '{}' FROM public.config_operativa c, jsonb_array_elements(c.valor) e
                 WHERE c.modulo = 'CIERRE_SIN_RUTA' AND c.clave = 'items_no_bloqueantes'
                   AND jsonb_typeof(c.valor) = 'array'))
          AND NOT (sr.recordatorio_id::text = ANY($2::text[]) AND sr.origen IN ('PLAN', 'VIP'))`,
      [servicioId, cfg.permitidos.BASICO || []])
    if (faltan.length) {
      await client.query('ROLLBACK')
      return { cerrado: false, motivo: `faltan: ${faltan.map(f => `${f.nombre} (${f.estado})`).join(', ')}` }
    }

    const { rows: enRuta } = await client.query(
      `SELECT 1 FROM public.entregas
        WHERE servicio_id = $1 AND estado <> 'ENTREGADA'
          AND (mensajero_id IS NOT NULL OR estado NOT IN ('PENDIENTE', 'DISPONIBLE'))
        FOR UPDATE`, [servicioId])
    if (enRuta.length) { await client.query('ROLLBACK'); return { cerrado: false, motivo: 'tiene una entrega en ruta' } }

    // La entrega PENDIENTE (el cascarón que nace con el servicio) NO se toca: si
    // la foto llega tarde y se hace el Memopet, coordinación la publica como siempre.
    await client.query(
      `UPDATE public.servicios
          SET estado = 'ENTREGADO',
              fecha_entrega_real = COALESCE(fecha_entrega_real, public.fn_hoy_bogota())
        WHERE id = $1 AND estado NOT IN ('ENTREGADO', 'CANCELADO')`, [servicioId])
    await client.query('COMMIT')
    return { cerrado: true }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

/**
 * Los ya enviados que todavía no quedaron ENTREGADO: el Ecogrupal pudo esperar
 * el certificado grupal; el Básico, una pieza física en proceso. Se registra
 * cuándo cerró (por este job o por cualquier otro camino) y se reintenta el Básico.
 */
async function revisarAbiertos(cfg, dryRun) {
  const { rows } = await pool.query(
    `SELECT x.id, x.servicio_id, x.plan_codigo, s.estado
       FROM public.cierre_sin_fotos x JOIN public.servicios s ON s.id = x.servicio_id
      WHERE x.estado = 'ENVIADO' AND x.servicio_cerrado_en IS NULL`)
  const res = { abiertos: rows.length, cerrados: 0, esperando: [] }
  for (const r of rows) {
    let cerrado = r.estado === 'ENTREGADO'
    let motivo = r.estado === 'CANCELADO' ? 'cancelado' : null
    if (!cerrado && !motivo && r.plan_codigo === 'BASICO' && !dryRun) {
      try {
        const c = await cerrarBasicoSinFotos(r.servicio_id, cfg)
        cerrado = c.cerrado
        motivo = c.motivo || null
        if (c.cerrado && !c.ya) {
          await novedad(r.servicio_id, 'El servicio pasó a ENTREGADO. El Memopet queda pendiente en el tablero por si la familia manda la foto.')
        }
      } catch (e) {
        // Un caso que falla no frena a los demás ni al envío del día.
        motivo = `error al cerrar: ${String(e.message || e).slice(0, 300)}`
        log(TAG, 'cerrar básico ERROR', r.servicio_id, e.message)
      }
    }
    if (cerrado) {
      res.cerrados++
      if (!dryRun) await pool.query(
        `UPDATE public.cierre_sin_fotos SET servicio_cerrado_en = now() WHERE id = $1`, [r.id])
    } else {
      res.esperando.push({ servicio_id: r.servicio_id, plan: r.plan_codigo, estado: r.estado, motivo })
    }
  }
  return res
}

export async function jobCierreSinFotos({ dryRun = false } = {}) {
  const cfg = await cargarConfigSinFotos()
  const res = { activo: cfg.activo, dry_run: dryRun, candidatos: 0, enviados: 0, omitidos: 0, errores: [] }
  if (!cfg.activo) { log(TAG, 'apagado'); return res }
  if (!cfg.arranque) { log(TAG, 'SIN arranque_desde — no envía'); return { ...res, motivo: 'sin_arranque_desde' } }
  if (!cfg.planes.length) return { ...res, motivo: 'sin_planes' }

  const lock = await pool.connect()
  let adquirido = false
  try {
    const { rows: [l] } = await lock.query(
      `SELECT pg_try_advisory_lock(hashtext('orbit:cierre-sin-fotos')) AS ok`)
    adquirido = !!l?.ok
    if (!adquirido) return { ...res, omitido: 'Ya hay otra corrida activa' }

    // Los ya enviados primero: cerrar lo que quedó a medias no le escribe a nadie.
    res.cierres = await revisarAbiertos(cfg, dryRun)

    const { rows: [hoy] } = await pool.query(
      `SELECT extract(isodow FROM public.fn_hoy_bogota())::int IN (6, 7)
              OR EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = public.fn_hoy_bogota()) AS descanso`)
    if (hoy.descanso) { log(TAG, 'fin de semana o festivo — hoy no se escribe'); return { ...res, descanso: true } }

    const dig = await cargarConfigDigitales(pool)
    const memorialRecId = dig.recordatorios_tipo?.MEMORIAL || null
    if (!memorialRecId) return { ...res, motivo: 'DIGITALES.recordatorios_tipo.MEMORIAL no está configurado' }

    const candidatos = await buscarCandidatos(cfg)
    res.candidatos = candidatos.length
    if (dryRun) {
      res.servicios = []
      for (const c of candidatos) {
        res.servicios.push({
          servicio_id: c.servicio_id, mascota: c.mascota, plan: c.plan,
          ultimo_aviso: c.ultimo_aviso, bloqueo: await bloqueoPorOtraFoto(c, memorialRecId, cfg),
        })
      }
      log(TAG, 'dry-run', JSON.stringify({ candidatos: res.candidatos }))
      return res
    }

    for (const c of candidatos) {
      try {
        const bloqueo = await bloqueoPorOtraFoto(c, memorialRecId, cfg)
        if (bloqueo) { await omitir(c, bloqueo); res.omitidos++; continue }
        if (!await reservar(c)) continue

        const aviso = fechaBogota(c.ultimo_aviso)
        const nota = `Sin foto de la familia: ${cfg.dias} días después del último aviso (${aviso}) se enviaron los digitales sin memorial. Cierre automático (migr. 227).`
        const r = await enviarAutomatico({
          servicioId: c.servicio_id, personalId: null, telefono: null,
          sinFoto: cfg.texto, notaSinFoto: nota,
        })

        if (r.status === 200 && r.body?.ok) {
          await pool.query(
            `UPDATE public.cierre_sin_fotos
                SET estado = 'ENVIADO', enviado_en = now(), digitales_envio_id = $2, error = NULL
              WHERE servicio_id = $1`, [c.servicio_id, r.body.envio?.id || null])
          res.enviados++
          await novedad(c.servicio_id,
            `Pasaron ${cfg.dias} días desde el último aviso (${aviso}) sin fotos: se enviaron los digitales con «${cfg.texto}» en el lugar del memorial, y el Memorial salió del tablero de Diseño.`)
          if (c.plan === 'BASICO') {
            // El envío ya salió y quedó registrado: si el cierre falla aquí, NO
            // debe caer al catch de abajo (que lo marcaría ERROR y lo reenviaría).
            // Lo reintenta revisarAbiertos en la próxima corrida.
            try {
              const k = await cerrarBasicoSinFotos(c.servicio_id, cfg)
              if (k.cerrado && !k.ya) {
                await novedad(c.servicio_id, 'El servicio pasó a ENTREGADO. El Memopet queda pendiente en el tablero por si la familia manda la foto.')
              }
            } catch (e) {
              log(TAG, 'cerrar básico ERROR (se reintenta mañana)', c.servicio_id, e.message)
            }
          }
          // Ecogrupal: lo cerró el trigger del cierre sin ruta, o lo cerrará
          // cuando salga el certificado grupal. Lo anota revisarAbiertos.
          const { rows: [s] } = await pool.query(`SELECT estado FROM public.servicios WHERE id = $1`, [c.servicio_id])
          if (s?.estado === 'ENTREGADO') {
            await pool.query(`UPDATE public.cierre_sin_fotos SET servicio_cerrado_en = now() WHERE servicio_id = $1`, [c.servicio_id])
          }
        } else if (r.status === 422) {
          // No es un fallo de red: algo del servicio (sin teléfono, memorial ya
          // publicado…). No se reintenta a ciegas: queda para coordinación.
          await omitir(c, r.body?.error || 'no se pudo preparar el envío')
          res.omitidos++
        } else {
          const err = (r.body?.error || `HTTP ${r.status}`).slice(0, 900)
          await pool.query(
            `UPDATE public.cierre_sin_fotos SET estado = 'ERROR', error = $2 WHERE servicio_id = $1`,
            [c.servicio_id, err])
          res.errores.push({ servicio_id: c.servicio_id, error: err })
        }
      } catch (e) {
        const err = String(e.message || e).slice(0, 900)
        log(TAG, 'ERROR', c.servicio_id, err)
        // Si ya estaba reservado queda ERROR (se reintenta mañana, máx. 3).
        await pool.query(
          `UPDATE public.cierre_sin_fotos SET estado = 'ERROR', error = $2
            WHERE servicio_id = $1 AND estado = 'ENVIANDO'`, [c.servicio_id, err]).catch(() => {})
        res.errores.push({ servicio_id: c.servicio_id, error: err })
      }
    }
    log(TAG, JSON.stringify({ ...res, errores: res.errores.length }))
    return res
  } finally {
    if (adquirido) await lock.query(`SELECT pg_advisory_unlock(hashtext('orbit:cierre-sin-fotos'))`).catch(() => {})
    lock.release()
  }
}
