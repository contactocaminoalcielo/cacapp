// El catálogo comercial: los archivos que se le mandan a una veterinaria
// (brochure, tarifario, presentación) y las plantillas aprobadas de la línea.
// Reusa las pantallas de Agentes IA; aquí solo se fijan los agentes de vets.
import { lazy, Suspense, useState } from 'react'
import { useCrm } from '@/components/crm/CrmContext'
import { Cabecera, Cargando, Pestanas } from '@/components/crm/ui'

const MaterialesWhatsapp = lazy(() => import('@/pages/MaterialesWhatsapp'))
const PlantillasWhatsapp = lazy(() => import('@/pages/PlantillasWhatsapp'))

export default function Recursos() {
  const { agenteVets, agenteVentas } = useCrm()
  const [pestana, setPestana] = useState('ventas')

  return (
    <div className="max-w-6xl mx-auto">
      <Cabecera titulo="Recursos y plantillas" sub="Lo que se le envía a las veterinarias: archivos del catálogo y mensajes aprobados por Meta." />
      <Pestanas valor={pestana} onCambio={setPestana} opciones={[
        { valor: 'ventas', label: 'Catálogo comercial (prospectos)' },
        { valor: 'vets', label: 'Catálogo de aliadas' },
        { valor: 'plantillas', label: 'Plantillas de WhatsApp' },
      ]} />
      <p className="text-[12px] text-gray-500 mt-3 mb-4">
        {pestana === 'ventas' && 'Archivos que el agente de ventas puede mandar a un prospecto y que tú puedes enviar desde cualquier ficha (presentación, beneficios de la alianza, tabla de comisiones).'}
        {pestana === 'vets' && 'Archivos del agente de la línea de veterinarias (brochure, tarifario). También se pueden enviar desde la ficha.'}
        {pestana === 'plantillas' && 'Las plantillas se crean aquí y Meta las aprueba. Las de agradecimiento se usan en Hitos. Fuera de las 24 h, una plantilla es la única forma de escribirle a una vet.'}
      </p>
      <Suspense fallback={<Cargando />}>
        {pestana === 'ventas' && (agenteVentas ? <MaterialesWhatsapp key="ventas" embebido agenteId={agenteVentas.id} /> : <Cargando />)}
        {pestana === 'vets' && (agenteVets ? <MaterialesWhatsapp key="vets" embebido agenteId={agenteVets.id} /> : <Cargando />)}
        {pestana === 'plantillas' && <PlantillasWhatsapp embebido />}
      </Suspense>
    </div>
  )
}
