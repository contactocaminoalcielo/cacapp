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
 */
export default function AvisoNuevaVersion() {
  const { needRefresh: [necesitaRefresco], updateServiceWorker } = useRegisterSW()

  if (!necesitaRefresco) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-xs rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-semibold text-gray-900">Hay una versión nueva de Orbit</p>
      <p className="mt-1 text-xs text-gray-500">
        Guarda lo que estés registrando antes de actualizar.
      </p>
      <button
        onClick={() => updateServiceWorker(true)}
        className="mt-3 w-full rounded-lg bg-[#263218] px-3 py-2 text-sm font-medium text-white"
      >
        Actualizar ahora
      </button>
    </div>
  )
}
