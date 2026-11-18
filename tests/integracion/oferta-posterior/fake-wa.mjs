globalThis.__plantillas = []
export async function enviarPlantillaGenerica(args) {
  if (globalThis.__falla_wa) throw new Error('Meta 400: simulado')
  globalThis.__plantillas.push(args)
  return { messageId: 'wamid.TEST' + globalThis.__plantillas.length, proveedor: 'META' }
}
