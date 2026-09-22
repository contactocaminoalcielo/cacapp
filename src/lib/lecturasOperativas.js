import { db, dbTodo } from './supabase'
import { mapLimit } from './lecturas'
import { FECHA_CORTE } from './constants'

const rpcAusente = error => ['PGRST202', '42883'].includes(error?.code)

export async function cargarContadores() {
  const { data, error } = await db.rpc('orbit_contadores', { p_desde: FECHA_CORTE })
  if (!error) return data
  if (!rpcAusente(error)) throw error
  // Compatibilidad durante despliegue/reversa. No esconder fallos de permisos
  // ni ejecutar una segunda batería de consultas cuando hay un timeout.
  const resultados = await Promise.all([
    db.from('v_alertas').select('*', { count: 'exact', head: true })
      .in('nivel_alerta', ['VENCIDO', 'HOY', 'URGENTE']).gte('fecha_ingreso', FECHA_CORTE),
    db.from('servicio_recordatorios').select('*, servicios!inner(id)', { count: 'exact', head: true })
      .eq('estado', 'PENDIENTE').neq('origen', 'REMOVIDO').gte('servicios.fecha_ingreso', FECHA_CORTE),
    db.from('solicitudes_imagenes').select('*', { count: 'exact', head: true }).eq('estado', 'POR_VALIDAR'),
    db.from('nps_seguimiento').select('*', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
    // Compras de recordatorios sin servicio (migr. 168/170): también se producen.
    db.from('compra_recordatorio_items').select('*, compras_recordatorios!inner(id)', { count: 'exact', head: true })
      .eq('estado', 'PENDIENTE').is('compras_recordatorios.anulada_en', null),
  ])
  for (const r of resultados.slice(0, 4)) if (r.error) throw r.error
  const out = Object.fromEntries(['kanban', 'produccion', 'imagenes', 'nps'].map((k, i) => [k, resultados[i].count || 0]))
  if (!resultados[4].error) out.produccion += resultados[4].count || 0   // si la tabla no existe aún, no tumba el menú
  return out
}

export async function cargarItemsKanban(ids) {
  const permitidos = new Set(ids)
  try {
    const resumen = await dbTodo(() => db.rpc('kanban_items_resumen', { p_desde: FECHA_CORTE }).order('servicio_id'))
    return resumen.filter(s => permitidos.has(s.servicio_id))
      .flatMap(s => s.items.map(i => ({ ...i, servicio_id: s.servicio_id })))
  } catch (error) {
    if (!rpcAusente(error)) throw error
    const unicos = [...permitidos]
    const lotes = Array.from({ length: Math.ceil(unicos.length / 60) }, (_, i) => unicos.slice(i * 60, i * 60 + 60))
    const filas = await mapLimit(lotes, l => dbTodo(() => db.from('servicio_recordatorios')
      .select('servicio_id, recordatorio_id, estado, origen')
      .neq('origen', 'REMOVIDO').in('servicio_id', l).order('id')))
    return filas.flat()
  }
}
