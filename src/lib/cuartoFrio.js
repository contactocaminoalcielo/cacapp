// Salida física del cuarto frío — único punto donde se registra que una
// mascota dejó la custodia: estado TRASLADADO + fecha_salida + movimiento
// de auditoría. Lo usan Tenjo (traslado individual completado) y
// LotesGrupales (lote enviado). Cuarto Frío sigue siendo el dueño de la
// custodia: aquí solo se registra el evento de salida, nunca ubicación.
import { db } from '@/lib/supabase'

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
