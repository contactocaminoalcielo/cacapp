export const ESTADOS_AUTOCORREGIBLES = ['EN_PRODUCCION', 'EN_PROCESO', 'EN_CUARTO_FRIO', 'INGRESADO']

// Requiere la colección COMPLETA de ítems, ya cargada para los filtros.
// NA y REMOVIDO no participan; un servicio sin ítems no se adelanta.
export function serviciosListosDesdeItems(servicios) {
  return servicios.filter(s => {
    if (!ESTADOS_AUTOCORREGIBLES.includes(s.estado)) return false
    const items = (s.items_rec || []).filter(i => i.estado !== 'NA' && i.origen !== 'REMOVIDO')
    return items.length > 0 && items.every(i => ['LISTO', 'ENTREGADO'].includes(i.estado))
  }).map(s => s.servicio_id)
}
