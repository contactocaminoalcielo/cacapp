// Lo que todas las pantallas del CRM necesitan a mano: el equipo comercial
// (para asignar), la línea de veterinarias (para la bandeja y las plantillas)
// y las alertas, que se refrescan solas.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { crm } from '@/lib/crmApi'
import { mostrarNotif, permisoNotifs } from '@/lib/deviceNotifications'

const Ctx = createContext(null)

export function CrmProvider({ children }) {
  const [equipo, setEquipo] = useState([])
  const [agentes, setAgentes] = useState([])
  const [alertas, setAlertas] = useState({ seguimientos: [], tickets_vencidos: 0, hitos_por_enviar: 0 })
  const avisados = useRef(new Set())

  useEffect(() => {
    crm.equipo().then(r => setEquipo(r.equipo || [])).catch(() => {})
    crm.agentes().then(r => setAgentes(r.agentes || [])).catch(() => {})
  }, [])

  const refrescarAlertas = useCallback(async () => {
    try {
      const r = await crm.alertas()
      setAlertas(r)
      // Aviso del sistema operativo cuando un seguimiento se vence, una sola
      // vez por seguimiento: así suena aunque la pestaña esté de fondo.
      for (const s of r.seguimientos || []) {
        // Los que vencen en los próximos 15 min llegan antes: se avisan al vencer.
        if (avisados.current.has(s.id) || new Date(s.programado_para) > new Date()) continue
        avisados.current.add(s.id)
        if (permisoNotifs() === 'granted') {
          mostrarNotif(`Toca: ${s.titulo}`, {
            body: s.nombre || '', tag: `crm-${s.id}`,
            url: s.aliado_id ? `/crm/veterinarias/${s.aliado_id}` : s.prospecto_id ? `/crm/prospectos/${s.prospecto_id}` : '/crm/agenda',
          }).catch(() => {})
        }
      }
    } catch { /* el siguiente ciclo lo reintenta */ }
  }, [])

  useEffect(() => {
    refrescarAlertas()
    const t = setInterval(refrescarAlertas, 60000)
    return () => clearInterval(t)
  }, [refrescarAlertas])

  const vets = agentes.find(a => a.clave === 'VETERINARIAS')
  const ventas = agentes.find(a => a.clave === 'VENTAS')
  const valor = {
    equipo, agentes, alertas, refrescarAlertas,
    lineaVets: (vets?.phone_number_ids || [])[0] || null,
    agenteVets: vets || null, agenteVentas: ventas || null,
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useCrm() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCrm fuera del CRM')
  return c
}
