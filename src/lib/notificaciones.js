// src/lib/notificaciones.js — helpers para el sistema de notificaciones internas
import { db } from '@/lib/supabase'

export const TIPOS = {
  TECNICO_INICIO_RUTA:  'TECNICO_INICIO_RUTA',   // técnico → coordinador
  TECNICO_DECLINA:      'TECNICO_DECLINA',         // técnico → coordinador
  REASIGNACION_TECNICO: 'REASIGNACION_TECNICO',    // coordinador → técnico nuevo
  REASIGNACION_REMOVIDO:'REASIGNACION_REMOVIDO',   // coordinador → técnico anterior
}

/** Crear una notificación para un usuario */
export async function crearNotificacion({ para_personal_id, de_personal_id, tipo, titulo, mensaje, servicio_id, datos = {} }) {
  const { error } = await db.from('notificaciones').insert({
    para_personal_id,
    de_personal_id,
    tipo,
    titulo,
    mensaje,
    servicio_id,
    datos,
  })
  if (error) console.error('[notif] Error creando notificación:', error.message)
}

/** Obtener notificaciones no leídas de un usuario */
export async function obtenerNoLeidas(personalId) {
  const { data } = await db.from('notificaciones')
    .select('*, servicios(mascotas(nombre,especies(nombre)),planes(nombre))')
    .eq('para_personal_id', personalId)
    .eq('leido', false)
    .order('created_at', { ascending: false })
    .limit(20)
  return data || []
}

/** Marcar como leída */
export async function marcarLeida(id) {
  await db.from('notificaciones').update({ leido: true }).eq('id', id)
}

/** Marcar todas como leídas para un usuario */
export async function marcarTodasLeidas(personalId) {
  await db.from('notificaciones').update({ leido: true }).eq('para_personal_id', personalId).eq('leido', false)
}
