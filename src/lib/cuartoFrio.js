// Salida física del cuarto frío — único punto donde se registra que una
// mascota dejó la custodia: estado TRASLADADO + fecha_salida + movimiento
// de auditoría. Lo usan Tenjo (traslado individual completado) y
// LotesGrupales (lote enviado). Cuarto Frío sigue siendo el dueño de la
// custodia: aquí solo se registra el evento de salida, nunca ubicación.
import { db } from '@/lib/supabase'

/**
 * Ingreso físico al cuarto frío — único punto donde se sella a qué HORA entró la
 * mascota a la nevera y quién la ingresó, con su movimiento en la bitácora.
 * (`cuarto_frio.fecha_ingreso` NO sirve para esto: la pone el trigger al crear el
 * servicio, horas antes. Ver migración 046.)
 *
 * NO toca nevera/peso/estado: eso lo escribe cada pantalla en su propio update.
 * Aquí solo se registra el evento. Idempotente: si ya hay hora de ingreso, no la
 * pisa ni duplica el movimiento (reintentos con mala señal, doble toque).
 *
 * @param {string} cuartoFrioId
 * @param {object} opts
 * @param {string} opts.personalId    — quién ingresa la mascota
 * @param {string} opts.neveraNueva   — nevera donde quedó
 * @param {string} opts.notas
 */
export async function registrarIngresoCuartoFrio(cuartoFrioId, { personalId = null, neveraNueva = null, notas = '' } = {}) {
  if (!cuartoFrioId) return

  const { data: reg, error } = await db.from('cuarto_frio')
    .select('id, estado, fecha_ingreso_real')
    .eq('id', cuartoFrioId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!reg || reg.fecha_ingreso_real) return   // ya estaba sellado

  const { error: errUpd } = await db.from('cuarto_frio')
    .update({ fecha_ingreso_real: new Date().toISOString(), registrado_por: personalId })
    .eq('id', cuartoFrioId)
    .is('fecha_ingreso_real', null)            // carrera: gana el primero, nadie pisa
  if (errUpd) throw new Error(errUpd.message)

  const { error: errMov } = await db.from('cuarto_frio_movimientos').insert({
    cuarto_frio_id:  cuartoFrioId,
    personal_id:     personalId,
    tipo:            'INGRESO',
    nevera_anterior: null,
    nevera_nueva:    neveraNueva || null,
    estado_anterior: reg.estado || null,
    estado_nuevo:    'REFRIGERADO',
    notas:           notas || null,
  })
  if (errMov) throw new Error(errMov.message)
}

/**
 * @param {string|string[]} servicioIds — servicio(s) cuya mascota salió físicamente
 * @param {object}  opts
 * @param {string}  opts.personalId — quién registra la salida
 * @param {string}  opts.tipo      — 'SALIDA_TENJO' | 'SALIDA_LOTE_GRUPAL'
 * @param {string}  opts.motivo    — texto para el log de movimientos
 */
export async function registrarSalidaCuartoFrio(servicioIds, { personalId = null, tipo = 'SALIDA_TENJO', motivo = '' } = {}) {
  const ids = (Array.isArray(servicioIds) ? servicioIds : [servicioIds]).filter(Boolean)
  if (!ids.length) return

  // Solo registros aún en custodia (idempotente: si ya tiene salida, no se toca)
  const { data: regs, error } = await db.from('cuarto_frio')
    .select('id, estado, nevera_codigo')
    .in('servicio_id', ids)
    .is('fecha_salida', null)
  if (error) throw new Error(error.message)
  if (!regs?.length) return

  const { error: errUpd } = await db.from('cuarto_frio')
    .update({ estado: 'TRASLADADO', fecha_salida: new Date().toISOString() })
    .in('id', regs.map(r => r.id))
  if (errUpd) throw new Error(errUpd.message)

  const { error: errMov } = await db.from('cuarto_frio_movimientos').insert(regs.map(r => ({
    cuarto_frio_id:  r.id,
    personal_id:     personalId,
    tipo,
    nevera_anterior: r.nevera_codigo || null,
    nevera_nueva:    null,
    estado_anterior: r.estado,
    estado_nuevo:    'TRASLADADO',
    notas:           motivo || null,
  })))
  if (errMov) throw new Error(errMov.message)
}
