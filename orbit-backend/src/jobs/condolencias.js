// Job diario (11:00 Bogotá, L-V): CONDOLENCIAS al mes del fallecimiento (migr. 209).
//
//   1. PREPARAR — siempre, aunque esté apagado: crea las filas de los servicios
//      recién entregados, para que /condolencias muestre lo programado.
//   2. ENVIAR   — solo encendido, con plantilla, y nunca sábado, domingo ni
//      festivo (lo de esos días sale el siguiente día hábil, dentro de
//      `dias_max_atraso`). A las 11:00 y no a las 10:00 para no salir pegado a
//      la encuesta post-entrega.
//
// 🪤 `arranque_desde` es obligatorio: sin él, la primera corrida le escribiría
// a cada familia con un servicio entregado en los últimos 4 meses.
import { pool, log } from '../db.js'
import {
  cargarConfigCondolencias, reglas, plantillaCondolencias,
  prepararCondolencias, enviarCondolencia,
} from '../condolencias.js'

const TAG = '[condolencias/job]'

export async function jobCondolencias({ dryRun = false } = {}) {
  const config = await cargarConfigCondolencias()
  const r = reglas(config)
  const prep = await prepararCondolencias({ config, dryRun })
  const res = { ...prep, activo: r.activo, enviados: 0, sin_whatsapp: 0, errores: 0,
                sin_plantilla: 0, candidatos: 0, dry_run: dryRun }

  if (!r.activo) { log(TAG, 'apagado — solo preparó', JSON.stringify(prep)); return res }
  if (!r.arranque) { log(TAG, 'SIN arranque_desde — no envía'); return { ...res, motivo: 'sin_arranque_desde' } }

  const { rows: [hoy] } = await pool.query(
    `SELECT extract(isodow FROM public.fn_hoy_bogota())::int IN (6, 7)
            OR EXISTS (SELECT 1 FROM public.festivos f WHERE f.fecha = public.fn_hoy_bogota()) AS descanso`)
  if (hoy.descanso) { log(TAG, 'fin de semana o festivo — hoy no se escribe'); return { ...res, descanso: true } }

  const { rows: candidatos } = await pool.query(
    `SELECT k.id
       FROM public.condolencias k
      WHERE k.estado IN ('PENDIENTE', 'ERROR')
        AND k.intentos < 3                   -- un reintento eterno le pega al mismo número cada día
        AND k.fecha_programada <= public.fn_hoy_bogota()
        AND k.fecha_programada >= $1::date
        AND k.fecha_programada >= public.fn_hoy_bogota() - $2::int
      ORDER BY k.fecha_programada ASC
      LIMIT $3`,
    [r.arranque, r.atraso, r.tope])
  res.candidatos = candidatos.length

  if (!plantillaCondolencias(config)) {
    res.sin_plantilla = candidatos.length
    log(TAG, 'SIN PLANTILLA aprobada —', candidatos.length, 'condolencia(s) esperan. Correr crear-plantilla-condolencias.mjs estado.')
    return res
  }
  if (dryRun) { log(TAG, JSON.stringify(res)); return res }

  for (const c of candidatos) {
    const e = await enviarCondolencia({ id: c.id, config })
    if (e.enviado) res.enviados++
    else if (e.motivo === 'sin_whatsapp') res.sin_whatsapp++
    else if (e.motivo === 'error_envio') res.errores++
  }
  log(TAG, JSON.stringify(res))
  return res
}
