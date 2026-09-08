export async function conLimite(promise, ms, mensaje) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(mensaje)), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

// Acota datos, sesión y archivos; no afecta Edge Functions de IA.
export async function fetchSupabase(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  const storage = url.pathname.startsWith('/storage/v1/')
  if (!storage && !/^\/(auth|rest)\/v1\//.test(url.pathname)) return fetch(input, init)
  const controller = new AbortController()
  const origen = init.signal || input?.signal
  const cancelar = () => controller.abort(origen.reason)
  if (origen?.aborted) cancelar()
  else origen?.addEventListener('abort', cancelar, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('La conexión tardó demasiado. Revisa la señal e intenta de nuevo.')), storage ? 55000 : 30000)
  try { return await fetch(input, { ...init, signal: controller.signal }) }
  finally {
    clearTimeout(timer)
    origen?.removeEventListener('abort', cancelar)
  }
}
