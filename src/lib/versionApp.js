// Traer la versión nueva del código, sin depender del plugin de PWA.
//
// Vive aparte de `components/AvisoNuevaVersion.jsx` a propósito: ese archivo
// importa `virtual:pwa-register/react`, y los PORTALES PÚBLICOS necesitan
// recargar sin arrastrar el registro del service worker a su chunk. Una familia
// que solo abre el portal hoy no tiene ninguno instalado, y ponerle caché sería
// empezar a crearle el problema que esto viene a resolver.
//
// El candado `recargando` es de módulo (no por componente) a propósito: manda
// una sola recarga aunque el aviso interno y el portal pidan la suya a la vez.

let recargando = false

export function recargarPagina() {
  if (recargando) return
  recargando = true
  window.location.reload()
}

// Sin SW ni cachés, el navegador vuelve a pedir el index.html a la red y entra
// la versión nueva. Es el último recurso: lo usa el aviso interno cuando el
// worker nuevo no toma el control, y los portales públicos cuando el backend
// rechaza el envío por algo que solo arregla tener el código nuevo (p. ej. la
// autorización de datos, que un build viejo ni siquiera pide).
export async function limpiarYRecargar() {
  if (recargando) return
  // Sin red no hay versión nueva que traer y borrar la caché dejaría la app
  // en blanco: mejor recargar a secas y que el SW viejo siga sirviendo.
  if (navigator.onLine === false) return recargarPagina()
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map(r => r.unregister()))
    if ('caches' in window) {
      const claves = await caches.keys()
      await Promise.all(claves.map(k => caches.delete(k)))
    }
  } catch (_) { /* da igual: recargamos igual */ }
  recargarPagina()
}
