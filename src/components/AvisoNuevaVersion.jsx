import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Aviso de versión nueva.
 *
 * Antes el service worker se activaba solo (`skipWaiting` + `autoUpdate`) y
 * `main.jsx` recargaba la pestaña en cuanto tomaba el control. Resultado: cada
 * despliegue recargaba a TODOS los usuarios a la vez, en medio de lo que
 * estuvieran haciendo, y se perdía el registro a medio llenar.
 *
 * Ahora la versión nueva se queda esperando y el usuario decide cuándo entrar:
 * termina lo que está registrando, guarda, y luego actualiza.
 *
 * Dos cosas que en campo salieron mal (2026-07-29):
 *
 * 1. Iba en `bottom-4 right-4` y en el celular caía encima de la nav inferior
 *    fija de TecnicoApp: les tapaba las pestañas de la derecha y no había cómo
 *    cerrarlo. Ahora va ARRIBA (el header del técnico no es sticky, así que no
 *    tapa nada de forma permanente) y trae botón de cerrar.
 *
 * 2. "Actualizar" no siempre hacía nada. En vite-plugin-pwa 1.3.0
 *    `updateServiceWorker(true)` IGNORA el argumento de recargar: solo manda
 *    SKIP_WAITING y la recarga la dispara un listener interno de `controlling`
 *    que además exige `event.isUpdate`. Si no hay worker en espera (pestaña
 *    abierta días, otra pestaña ya activó el SW) o el evento llega sin
 *    `isUpdate`, el mensaje se manda al vacío y el aviso se queda pegado.
 *    Aquí la recarga la controlamos nosotros: `controllerchange` (siempre
 *    llega, hay `clientsClaim: true`) y, si en 3 s no llegó, plan B que borra
 *    SW + cachés y recarga.
 */
export default function AvisoNuevaVersion() {
  const { needRefresh: [necesitaRefresco, setNecesitaRefresco], updateServiceWorker } = useRegisterSW()
  const [actualizando, setActualizando] = useState(false)
  const yaRecargando = useRef(false)

  const recargar = () => {
    if (yaRecargando.current) return
    yaRecargando.current = true
    window.location.reload()
  }

  // Plan B: el SW nuevo nunca tomó el control. Sin SW ni cachés, el navegador
  // vuelve a pedir el index.html a la red y entra la versión nueva.
  const limpiarYRecargar = async () => {
    if (yaRecargando.current) return
    // Sin red no hay versión nueva que traer y borrar la caché dejaría la app
    // en blanco: mejor recargar a secas y que el SW viejo siga sirviendo.
    if (navigator.onLine === false) return recargar()
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
      await Promise.all(regs.map(r => r.unregister()))
      if ('caches' in window) {
        const claves = await caches.keys()
        await Promise.all(claves.map(k => caches.delete(k)))
      }
    } catch (_) { /* da igual: recargamos igual */ }
    recargar()
  }

  const actualizar = async () => {
    if (actualizando) return
    setActualizando(true)
    try {
      navigator.serviceWorker?.addEventListener('controllerchange', recargar, { once: true })
    } catch (_) { /* navegador sin SW: cae en el plan B */ }
    try {
      await updateServiceWorker(true)   // manda SKIP_WAITING al worker en espera
    } catch (_) { /* idem */ }
    setTimeout(limpiarYRecargar, 3000)
  }

  if (!necesitaRefresco) return null

  return (
    <div
      className="fixed inset-x-0 top-0 z-[9999] px-3 pointer-events-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <div className="pointer-events-auto mx-auto flex max-w-[520px] items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Hay una versión nueva de Orbit</p>
          <p className="mt-0.5 text-xs text-gray-500">Guarda lo que estés registrando y luego actualiza.</p>
        </div>
        <button
          onClick={actualizar}
          disabled={actualizando}
          className="flex-shrink-0 rounded-lg bg-[#263218] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {actualizando ? 'Actualizando…' : 'Actualizar'}
        </button>
        <button
          onClick={() => setNecesitaRefresco(false)}
          aria-label="Cerrar aviso"
          className="flex-shrink-0 rounded-full p-1.5 text-gray-400 active:bg-gray-100"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
