import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Webhook, Gauge, Clock } from 'lucide-react'
import { crm, PRIORIDADES } from '@/lib/crmApi'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Cabecera, Cargando, Seccion, Campo, Chip, ACENTO } from '@/components/crm/ui'
import { useCrm } from '@/components/crm/CrmContext'

export default function Ajustes() {
  const { personalData } = useAuth()
  const { agenteVentas, agenteVets } = useCrm()
  const [cfg, setCfg] = useState(null)
  const [estado, setEstado] = useState(null)
  const esCoord = ['ADMIN', 'COORDINADOR'].includes(personalData?.rol)

  useEffect(() => { crm.config().then(r => setCfg(r.config)).catch(e => setEstado(e.message)) }, [])

  async function guardar() {
    setEstado('Guardando…')
    try { const r = await crm.guardarConfig(cfg); setCfg(r.config); setEstado('Guardado ✓') } catch (e) { setEstado(e.message) }
  }

  if (!cfg) return <Cargando />
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }))
  const urlLeads = `${location.origin}/api/crm-leads`

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Cabecera titulo="Ajustes del CRM" />

      <Seccion titulo={<span className="inline-flex items-center gap-1.5"><Gauge size={14} /> Cuándo una veterinaria cambia de estado</span>}>
        <p className="text-[12px] text-gray-500 mb-3">Días sin enviar un servicio. Cambiarlos recalcula toda la cartera al instante (nada se guarda: se calcula).</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Campo label="Enfriándose desde"><Input type="number" min="1" value={cfg.dias_enfriandose} onChange={e => set('dias_enfriandose', e.target.value)} /></Campo>
          <Campo label="En riesgo desde"><Input type="number" min="1" value={cfg.dias_en_riesgo} onChange={e => set('dias_en_riesgo', e.target.value)} /></Campo>
          <Campo label="Dormida desde"><Input type="number" min="1" value={cfg.dias_dormida} onChange={e => set('dias_dormida', e.target.value)} /></Campo>
          <Campo label="Sin gestión después de" ayuda="días sin llamada/visita"><Input type="number" min="1" value={cfg.dias_sin_gestion} onChange={e => set('dias_sin_gestion', e.target.value)} /></Campo>
        </div>
      </Seccion>

      <Seccion titulo={<span className="inline-flex items-center gap-1.5"><Clock size={14} /> Plazo para responder un ticket (horas)</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(PRIORIDADES).map(([k, v]) => (
            <Campo key={k} label={v.label}>
              <Input type="number" min="1" value={cfg.sla_horas?.[k] ?? ''} onChange={e => set('sla_horas', { ...cfg.sla_horas, [k]: e.target.value })} />
            </Campo>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={guardar} style={{ background: ACENTO }}>Guardar ajustes</Button>
          {estado && <span className="text-[12.5px] text-gray-500">{estado}</span>}
        </div>
      </Seccion>

      <Seccion titulo={<span className="inline-flex items-center gap-1.5"><Bot size={14} /> Agente de ventas</span>}>
        {!agenteVentas ? <p className="text-[12.5px] text-gray-500">No existe todavía (falta aplicar la migración 180).</p> : (
          <div className="space-y-2 text-[12.5px] text-gray-700">
            <div className="flex items-center gap-2"><b>{agenteVentas.nombre}</b> <Chip color={agenteVentas.activo ? '#059669' : '#94A3B8'}>{agenteVentas.activo ? 'Encendido' : 'Apagado'}</Chip></div>
            <p>Responde por la línea de <b>{agenteVets?.nombre || 'veterinarias'}</b>, pero solo a los números que son <b>prospectos abiertos</b> del CRM. Las aliadas y los números desconocidos siguen con el agente de siempre. Cuando una clínica no registrada pide el enlace de afiliación, entra sola como prospecto.</p>
            <p>Lo que aprende lo deja en la bitácora del prospecto y, si la clínica pide una llamada, te la agenda con alerta.</p>
            {esCoord
              ? <Link to="/agentes/VENTAS" className="inline-block font-semibold" style={{ color: ACENTO }}>Configurar sus instrucciones, probarlo y encenderlo →</Link>
              : <p className="text-gray-500">Para encenderlo o cambiar sus instrucciones, pídeselo a coordinación (Agentes IA → VENTAS).</p>}
          </div>
        )}
      </Seccion>

      <Seccion titulo={<span className="inline-flex items-center gap-1.5"><Webhook size={14} /> Prospectos desde redes y formularios</span>}>
        <div className="space-y-2 text-[12.5px] text-gray-700">
          <p>Cualquier formulario o anuncio (Facebook/Instagram Lead Ads vía Make o Zapier, la página web, una landing) puede crear prospectos solo, enviando un POST a:</p>
          <code className="block bg-gray-50 rounded-lg px-3 py-2 text-[12px] break-all">{urlLeads}</code>
          <p>Con la cabecera <code className="bg-gray-50 px-1 rounded">x-crm-token</code> (la clave <code className="bg-gray-50 px-1 rounded">CRM_LEADS_TOKEN</code> del servidor) y un JSON como:</p>
          <pre className="bg-gray-50 rounded-lg px-3 py-2 text-[11.5px] overflow-x-auto">{`{
  "veterinaria": "Clínica Huellitas",
  "contacto": "Dra. Paula Gómez",
  "telefono": "3001234567",
  "email": "paula@huellitas.co",
  "ciudad": "Bogotá",
  "mensaje": "Quiero información de la alianza",
  "campaign_name": "Anuncio octubre vets"
}`}</pre>
          <p className="text-gray-500">Si el número ya existe no se duplica: se anota en su bitácora que volvió a llegar.</p>
        </div>
      </Seccion>
    </div>
  )
}
