// Notificaciones de dispositivo (escritorio/celular) vía la API del navegador.
// Funcionan mientras ORBIT está ABIERTO en una pestaña/PWA — NO requieren
// instalar la app ni Web Push (no hay VAPID ni service worker custom). El
// disparo viene del realtime de Supabase (ver components/NotificacionesAliados).
//
// Compatibilidad:
//  - Escritorio (Chrome/Edge/Firefox): new Notification() con click → navega.
//  - Android Chrome: new Notification() es ilegal → fallback a
//    ServiceWorkerRegistration.showNotification() (notifica; el click no navega
//    sin handler en el SW, que aquí es generateSW de Workbox).
//  - iOS Safari sin instalar: la API no existe → degrada a no hacer nada.

const ICON = '/icon-192.png'

export function notifsSoportadas() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function permisoNotifs() {
  return notifsSoportadas() ? Notification.permission : 'unsupported'
}

export async function pedirPermisoNotifs() {
  if (!notifsSoportadas()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

// Muestra una notificación si hay permiso. `url` es un hash de ruta (ej '/kanban').
export async function mostrarNotif(titulo, { body, tag, url } = {}) {
  if (permisoNotifs() !== 'granted') return
  // 1) Intento directo (escritorio): permite click → navegar.
  try {
    const n = new Notification(titulo, { body, tag, icon: ICON, badge: ICON, renotify: !!tag })
    if (url) {
      n.onclick = () => {
        try { window.focus() } catch {}
        try { window.location.hash = url } catch {}
        n.close()
      }
    }
    return
  } catch {
    // 2) Fallback (Android): la API directa es ilegal → usar el service worker.
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration()
      if (reg?.showNotification) {
        await reg.showNotification(titulo, { body, tag, icon: ICON, badge: ICON, data: { url } })
      }
    } catch {}
  }
}
