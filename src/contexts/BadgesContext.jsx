import { createContext, useContext, useState, useEffect } from 'react'
import { cargarContadores } from '@/lib/lecturasOperativas'
import { lecturaSerial } from '@/lib/lecturas'
import { useAuth } from '@/contexts/AuthContext'
import { useChatWa } from '@/contexts/ChatWaContext'

const BadgesContext = createContext({ kanban: 0, produccion: 0, imagenes: 0, nps: 0, whatsapp: 0 })

export function BadgesProvider({ children }) {
  const [badges, setBadges] = useState({ kanban: 0, produccion: 0, imagenes: 0, nps: 0, whatsapp: 0 })
  const { personalData } = useAuth()
  const { todasConversaciones = [] } = useChatWa() || {}
  // La bandeja de WhatsApp es de coordinación: PRODUCTOR y OPERARIO también
  // pasan por aquí y el backend les respondería 403 cada minuto.
  const veWhatsapp = ['COORDINADOR', 'ADMIN'].includes(personalData?.rol)

  useEffect(() => {
    let vivo = true
    const fetchBadges = lecturaSerial(async () => {
      if (!vivo) return
      const datos = await cargarContadores()
      if (vivo) setBadges(b => ({ ...b, ...datos }))
    })
    const tick = () => fetchBadges().catch(error => console.error('[Badges] Refresco falló:', error))
    tick()
    const id = setInterval(tick, 60000)
    return () => { vivo = false; clearInterval(id) }
  }, [personalData?.id])

  // Mantener el total de TODAS las líneas, como antes. La línea seleccionada
  // del chat tiene su propio contador y no debe cambiar el badge global.
  const whatsapp = veWhatsapp ? todasConversaciones.reduce((n, c) => n + Number(c.sin_leer || 0), 0) : 0
  return <BadgesContext.Provider value={{ ...badges, whatsapp }}>{children}</BadgesContext.Provider>
}

export const useBadges = () => useContext(BadgesContext)
