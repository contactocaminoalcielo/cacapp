// Etiquetas de alerta para mascotas RECATEGORIZADAS (cambio de plan o de precio
// por peso). Reutilizable en Finanzas (cuadre), Kanban y Gestión. Recibe el
// objeto `recat` = { plan, peso, detallePlan, detallePeso } de
// `recategorizacionesPorServicio` (lib/servicios). Si no hay cambios, no renderiza.
export default function RecatBadges({ recat, size = 'sm', className = '' }) {
  if (!recat || (!recat.plan && !recat.peso)) return null
  const px = size === 'xs' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {recat.plan && (
        <span
          title={recat.detallePlan || 'Este servicio cambió de plan — verifica el valor y la comisión.'}
          className={`${px} font-bold rounded-full bg-[#EEF2FF] text-[#3730A3] whitespace-nowrap cursor-help`}>
          ↔ Plan cambiado
        </span>
      )}
      {recat.peso && (
        <span
          title={recat.detallePeso || 'El precio se recalculó por un cambio de peso.'}
          className={`${px} font-bold rounded-full bg-[#ECFEFF] text-[#0E7490] whitespace-nowrap cursor-help`}>
          ⚖ Recategorizado por peso
        </span>
      )}
    </span>
  )
}
