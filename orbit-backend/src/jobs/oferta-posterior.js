// Job diario (14:00 Bogotá, L-V): OFERTA POSTERIOR al servicio (migr. 210).
//
//   1. PREPARAR — siempre, aunque esté apagado: crea las filas de los servicios
//      entregados, para que /ventas-posteriores muestre lo programado.
//   2. REVISAR  — siempre: excluye lo que ya no debe salir (la familia pidió no
//      recibir ofertas, calificó mal, puso una queja…).
//   3. ENVIAR   — solo encendido, con plantilla, y nunca sábado, domingo ni
//      festivo. A las 14:00 para no salir pegado a la encuesta (10:00) ni a las
//      condolencias (11:00): una familia no debe recibir dos mensajes nuestros
//      en la misma hora.
//
// 🪤 `arranque_desde` es obligatorio: sin él, la primera corrida le escribiría
// a cada familia con un servicio entregado en los últimos 6 meses.
import { pool, log } from '../db.js'
import {
  cargarConfigOferta, reglas, plantillaOferta,
  prepararOfertas, revisarExclusiones, enviarOferta,
} from '../oferta-posterior.js'

const TAG = '[oferta-posterior/job]'

export async function jobOfertaPosterior({ dryRun = false } = {}) {
  const config = await cargarConfigOferta()
  const r = reglas(config)
  const prep = await prepararOfertas({ config, dryRun })
  const revisadas = dryRun ? 0 : await revisarExclusiones({ config })
  const res = { ...prep, excluidas_al_revisar: revisadas, activo: r.activo, enviados: 0,
                excluidas_al_enviar: 0, en_espera: 0, sin_whatsapp: 0, errores: 0,
                sin_plantilla: 0, candidatos: 0, dry_run: dryRun }

  if (!r.activo) { log(TAG, 'apagado — solo preparó', JSON.stringify(prep)); return res }
  if (!r.arranque) { log(TAG, 'SIN arranque_desde — no envía'); return { ...res, motivo: 'sin_arranque_desde' } }

  const { rows: [hoy] } = await pool.query(
    `SELECT extract(isodow FROM public.fn_hoy_bogota())::int IN (6, 7)
            OR EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = public.fn_hoy_bogota()) AS descanso`)
  if (hoy.descanso) { log(TAG, 'fin de semana o festivo — hoy no se escribe'); return { ...res, descanso: true } }

  const { rows: candidatos } = await pool.query(
    `SELECT o.id
       FROM public.ofertas_posteriores o
      WHERE o.estado IN ('PENDIENTE', 'ERROR')
        AND o.intentos < 3                   -- un reintento eterno le pega al mismo número cada día
        AND o.fecha_programada <= public.fn_hoy_bogota()
        AND o.fecha_programada >= $1::date
        AND o.fecha_programada >= public.fn_hoy_bogota() - $2::int
      ORDER BY o.fecha_programada ASC, o.created_at ASC
      LIMIT $3`,
    [r.arranque, r.atraso, r.tope])
  res.candidatos = candidatos.length

  if (!plantillaOferta(config)) {
    res.sin_plantilla = candidatos.length
    log(TAG, 'SIN PLANTILLA aprobada —', candidatos.length, 'oferta(s) esperan. Correr crear-plantilla-oferta-posterior.mjs estado.')
    return res
  }
  if (dryRun) { log(TAG, JSON.stringify(res)); return res }

  // Una por una y en orden: la segunda mascotica de una misma familia ve que la
  // primera ya salió y se excluye sola («Ya recibió la oferta por otra mascotica»).
  for (const c of candidatos) {
    const e = await enviarOferta({ id: c.id, config })
    if (e.enviado) res.enviados++
    else if (e.motivo === 'excluida') res.excluidas_al_enviar++
    else if (e.motivo === 'espera_condolencia' || e.motivo === 'no_entregado') res.en_espera++
    else if (e.motivo === 'sin_whatsapp') res.sin_whatsapp++
    else if (e.motivo === 'error_envio') res.errores++
  }
  log(TAG, JSON.stringify(res))
  return res
}
