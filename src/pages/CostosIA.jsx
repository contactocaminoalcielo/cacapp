// Costos de la IA — pantalla propia.
//
// Estaba dentro de la pantalla del agente, y ahí se queda corto: el gasto no es
// de UN agente, es de todos juntos más lo que factura Meta por la mensajería.
// Con varias líneas por venir, la pregunta pasa a ser "¿cuánto me cuesta CADA
// línea?", y eso no cabe en la ficha de un agente.
//
// ⏳ Los filtros por línea todavía no están: `costos_uso` ya guarda `agente_id`
// en cada renglón, así que el dato está — falta el selector y agrupar por él.
import Topbar from '@/components/layout/Topbar'
import PanelCostos from '@/components/agente/PanelCostos'

export default function CostosIA() {
  return (
    <>
      <Topbar />
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <p className="text-[13px] text-gray-500 leading-snug max-w-2xl">
          Lo que se ha gastado de verdad, con las cantidades que reporta cada proveedor:
          los tokens de Claude, los caracteres de la voz y lo que factura Meta por los
          mensajes. Sumado de todas las líneas.
        </p>

        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <PanelCostos />
        </section>
      </div>
    </>
  )
}
