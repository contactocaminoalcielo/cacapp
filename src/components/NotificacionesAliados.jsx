// Avisos de dispositivo (escritorio/celular) para Coordinador/Admin cuando
// llega actividad del portal de aliados. Se monta una vez en AppShell (persiste
// mientras navegas). Escucha el realtime de Supabase y dispara una notificación
// del navegador — sin instalar la app ni Web Push (ver lib/deviceNotifications).
//
// Eventos:
//   1. solicitudes_servicio INSERT con origen='ALIADO' → "Nueva solicitud de aliado"
//   2. aliados INSERT con estado='pendiente_validacion' → "Veterinaria pendiente"
import { useEffect, useState } from 'react'
import { Bell, BellRing, BellOff } from 'lucide-react'
import { db } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { notifsSoportadas, permisoNotifs, pedirPermisoNotifs, mostrarNotif } from '@/lib/deviceNotifications'

const ROLES_DESTINO = ['COORDINADOR', 'ADMIN']

export default function NotificacionesAliados() {
  const { personalData } = useAuth()
  const rol = personalData?.rol
  const aplica = ROLES_DESTINO.includes(rol)

  const [permiso, setPermiso] = useState(() => permisoNotifs())

  // Realtime: una sola suscripción mientras el usuario sea Coord/Admin.
  useEffect(() => {
    if (!aplica) return
    const ch = db.channel('notif-aliados')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes_servicio' },
        ({ new: row }) => {
          if (!row || row.origen !== 'ALIADO') return
          const detalle = [row.mascota_nombre, row.cliente_nombre].filter(Boolean).join(' · ')
          mostrarNotif('Nueva solicitud de aliado', {
            body: detalle || 'Una veterinaria envió una solicitud de servicio',
            tag: `sol-aliado-${row.id}`, url: '/kanban',
          })
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aliados' },
        ({ new: row }) => {
          if (!row || row.estado !== 'pendiente_validacion') return
          mostrarNotif('Veterinaria pendiente de validación', {
            body: row.nombre || 'Una veterinaria nueva pidió afiliación',
            // Al tablero, no a Configuración: ahí es donde ahora se ve la
            // tarjeta verde y se aprueba de un clic. El aviso tiene que dejar
            // a la persona en el sitio donde puede resolverlo.
            tag: `aliado-pend-${row.id_aliado}`, url: '/kanban',
          })
        })
      .subscribe()
    return () => { db.removeChannel(ch) }
  }, [aplica])

  if (!aplica || !notifsSoportadas()) return null

  async function activar() {
    const r = await pedirPermisoNotifs()
    setPermiso(r)
  }

  // Concedido → indicador discreto de que está activo.
  if (permiso === 'granted') {
    return (
      <span title="Avisos de dispositivo activos" className="hidden sm:inline-flex w-8 h-8 items-center justify-center rounded-lg text-[#3D5A27]">
        <BellRing size={16} />
      </span>
    )
  }

  // Bloqueado → hay que reactivarlo desde los ajustes del navegador.
  if (permiso === 'denied') {
    return (
      <span title="Avisos bloqueados — actívalos en los ajustes del navegador para este sitio"
        className="hidden sm:inline-flex w-8 h-8 items-center justify-center rounded-lg text-gray-300">
        <BellOff size={16} />
      </span>
    )
  }

  // Pendiente de dar permiso → botón para activarlo.
  return (
    <button onClick={activar} title="Recibir avisos en este dispositivo cuando un aliado envíe una solicitud"
      className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-bold transition-colors"
      style={{ background: '#F0F7EB', color: '#3D5A27' }}>
      <Bell size={14} /> <span className="hidden sm:inline">Activar avisos</span>
    </button>
  )
}
