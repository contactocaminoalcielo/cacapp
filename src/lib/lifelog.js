// ─── LIFELOG — diagnóstico de reinicios de la PWA en el celular ───────────────
// Registra eventos de ciclo de vida en localStorage (sobrevive a recargas y a
// que el SO mate la pestaña) para distinguir DOS causas de "la app se reinicia
// al subir el comprobante":
//   - Kill del sistema (OOM): boot 'navigate' tras 'pagehide persisted=false'
//     SIN 'SW:controllerchange' → no arreglable solo en código.
//   - Recarga del Service Worker: aparece 'SW:controllerchange' justo antes del
//     boot 'reload' → arreglable (guard del reload).
// Es temporal; se puede quitar cuando se identifique la causa.

const KEY = 'orbit_lifelog'
const MAX = 40

export function logEvent(name, extra) {
  try {
    const arr = getLog()
    arr.push({ t: Date.now(), name, extra: extra ?? null })
    while (arr.length > MAX) arr.shift()
    localStorage.setItem(KEY, JSON.stringify(arr))
  } catch (_) {}
}

export function getLog() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_) { return [] }
}

export function clearLog() {
  try { localStorage.removeItem(KEY) } catch (_) {}
}

// Engancha los listeners de ciclo de vida. Llamar UNA vez, lo antes posible.
export function initLifelog() {
  try {
    let navType = 'desconocido'
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0]
      navType = nav?.type || navType
    } catch (_) {}
    logEvent('BOOT', { nav: navType, controller: !!navigator.serviceWorker?.controller })

    window.addEventListener('pagehide', e => logEvent('pagehide', { persisted: e.persisted }))
    window.addEventListener('pageshow', e => logEvent('pageshow', { persisted: e.persisted }))
    document.addEventListener('visibilitychange', () => logEvent('visibility', { s: document.visibilityState }))
    // Page Lifecycle API (Chrome): freeze/resume al descartar/restaurar la pestaña
    document.addEventListener('freeze', () => logEvent('freeze'))
    document.addEventListener('resume', () => logEvent('resume'))
    window.addEventListener('error', e => logEvent('JS:error', { m: String(e.message).slice(0, 80) }))
  } catch (_) {}
}
