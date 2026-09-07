// Helpers sin dependencia del cliente: permiten verificar paginación y
// concurrencia con respuestas simuladas, sin tocar datos reales.
export async function leerPaginas(construir, { pagina = 1000, maxPaginas = 50 } = {}) {
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 1000) {
    throw new Error('El tamaño de página debe estar entre 1 y 1000')
  }
  const filas = []
  for (let p = 0; p < maxPaginas; p++) {
    const { data, error } = await construir().range(p * pagina, (p + 1) * pagina - 1)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    const lote = data || []
    filas.push(...lote)
    if (lote.length < pagina) return filas
  }
  // Un listado incompleto jamás debe decidir estados ni totales.
  throw new Error('La consulta supera el límite de páginas; acota los filtros para obtener datos completos')
}

export async function mapLimit(valores, fn, limite = 3) {
  const salida = new Array(valores.length)
  let siguiente = 0
  let fallo = false
  await Promise.all(Array.from({ length: Math.min(limite, valores.length) }, async () => {
    while (!fallo && siguiente < valores.length) {
      const i = siguiente++
      try { salida[i] = await fn(valores[i], i) }
      catch (error) { fallo = true; throw error }
    }
  }))
  return salida
}

// Varias peticiones simultáneas comparten una lectura. Si ocurre un cambio
// mientras viaja, una segunda vuelta obtiene su estado más reciente.
export function lecturaSerial(fn) {
  let pendiente = null
  let repetir = false
  let argumentos = []
  return (...args) => {
    argumentos = args
    repetir = true
    if (pendiente) return pendiente
    pendiente = Promise.resolve().then(async () => {
      let resultado
      do {
        repetir = false
        resultado = await fn(...argumentos)
      } while (repetir)
      return resultado
    }).finally(() => { pendiente = null })
    return pendiente
  }
}
