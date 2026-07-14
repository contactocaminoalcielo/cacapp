import { createContext, useContext, useState, useEffect } from 'react'
import { db } from '@/lib/supabase'
import { FECHA_CORTE } from '@/lib/constants'

const BadgesContext = createContext({ kanban: 0, produccion: 0, imagenes: 0, nps: 0 })

export function BadgesProvider({ children }) {
  const [badges, setBadges] = useState({ kanban: 0, produccion: 0, imagenes: 0, nps: 0 })

  async function fetchBadges() {
    try {
      const [a, p, i, n] = await Promise.all([
        db.from('v_alertas').select('*', { count: 'exact', head: true }).in('nivel_alerta', ['VENCIDO','HOY','URGENTE'])
          .gte('fecha_ingreso', FECHA_CORTE),
        db.from('servicio_recordatorios').select('*, servicios!inner(id)', { count: 'exact', head: true }).eq('estado', 'PENDIENTE').neq('origen', 'REMOVIDO')
          .gte('servicios.fecha_ingreso', FECHA_CORTE),
        db.from('solicitudes_imagenes').select('*', { count: 'exact', head: true }).eq('estado', 'POR_VALIDAR'),
        db.from('nps_seguimiento').select('*', { count: 'exact', head: true }).eq('estado', 'PENDIENTE'),
      ])
      setBadges({ kanban: a.count || 0, produccion: p.count || 0, imagenes: i.count || 0, nps: n.count || 0 })
    } catch (e) {}
  }

  useEffect(() => {
    fetchBadges()
    const id = setInterval(fetchBadges, 60000)
    return () => clearInterval(id)
  }, [])

  return <BadgesContext.Provider value={badges}>{children}</BadgesContext.Provider>
}

export const useBadges = () => useContext(BadgesContext)
