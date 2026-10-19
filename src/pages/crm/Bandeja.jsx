// La bandeja de la línea de veterinarias, dentro del CRM. Es la MISMA bandeja
// que usa coordinación (mismo componente, mismos mensajes): aquí solo se fija
// la línea. El backend, además, no le deja ver otra al rol COMERCIAL.
import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCrm } from '@/components/crm/CrmContext'
import { Cargando, Cabecera } from '@/components/crm/ui'

const Whatsapp = lazy(() => import('@/pages/Whatsapp'))

export default function Bandeja() {
  const { lineaVets, agentes } = useCrm()
  const [params] = useSearchParams()
  const contacto = params.get('contacto')

  if (!agentes.length) return <Cargando />
  if (!lineaVets) return <div className="text-[13px] text-gray-500">La línea de veterinarias no está configurada en Agentes IA.</div>

  return (
    <div className="max-w-[1500px] mx-auto">
      <Cabecera titulo="WhatsApp de veterinarias" sub="La misma bandeja de coordinación, solo con la línea de veterinarias. Lo que respondas aquí sale por esa línea." />
      <Suspense fallback={<Cargando />}>
        <Whatsapp key={contacto || 'todas'} embebido lineaFija={lineaVets} abrirContacto={contacto} />
      </Suspense>
    </div>
  )
}
