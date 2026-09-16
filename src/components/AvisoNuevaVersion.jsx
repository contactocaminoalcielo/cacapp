import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

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
// ─── Recarga, compartida por el aviso interno y el auto-refresco público ────
// A nivel de módulo y no por componente: solo hay uno vivo a la vez, y así el
// candado anti-doble-recarga vale para los dos.
let recargando = false

function recargarPagina() {
  if (recargando) return
  recargando = true
  window.location.reload()
}

// Plan B: el SW nuevo nunca tomó el control. Sin SW ni cachés, el navegador
// vuelve a pedir el index.html a la red y entra la versión nueva.
async function limpiarYRecargar() {
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

/** Manda SKIP_WAITING y recarga cuando el worker nuevo tome el control. */
function entrarAVersionNueva(updateServiceWorker) {
  try {
    navigator.serviceWorker?.addEventListener('controllerchange', recargarPagina, { once: true })
  } catch (_) { /* navegador sin SW: cae en el plan B */ }
  try {
    updateServiceWorker(true)   // manda SKIP_WAITING al worker en espera
  } catch (_) { /* idem */ }
  setTimeout(limpiarYRecargar, 3000)
}

/**
 * Portales públicos: la versión nueva entra SOLA.
 *
 * Quién sufre esto no es la familia, es la casa. Una familia que solo abre el
 * portal **no tiene service worker** (nada lo registraba en estas rutas), así
 * que su navegador pide el `index.html` a la red y siempre ve lo último. Pero
 * el SW se registra por origen: cualquiera que entre a Orbit con sesión
 * —David, coordinación, los técnicos— queda con uno instalado, y ESE mismo SW
 * le sirve el portal desde la caché cuando abre el enlace de un cliente.
 *
 * Ahí estaba el nudo: con `registerType: 'prompt'` + `skipWaiting: false` el
 * worker nuevo espera a que alguien pulse "Actualizar", y ese aviso está
 * oculto en los portales a propósito (`esRutaPublica` en App.jsx). Nada lo
 * despertaba: el portal seguía mostrando el build viejo mientras quedara otra
 * pestaña de Orbit abierta. Mordió el 16-sep-2026 con la promoción de la 2ª
 * planta: desplegada, verificada en el servidor, e invisible en la pantalla de
 * quien la pidió.
 *
 * 🪤 Aquí NO se usa `useRegisterSW`: ese hook REGISTRA el worker, y le pondría
 * caché a la familia que hoy no tiene ninguna. Esto solo despierta al que ya
 * está instalado; si no hay, no hace nada y la red ya trae lo último.
 *
 * Y solo mientras la persona **no haya tocado nada**. Si ya escribió su
 * dirección o eligió su planta, se queda en la versión que abrió: recargarle
 * la pantalla encima le borraría lo que llevaba.
 */
export function AutoActualizaPublico() {
  const intacto = useRef(true)

  useEffect(() => {
    const tocado = () => { intacto.current = false }
    // `input` cubre lo que escribe; `pointerdown` cubre elegir planta o sumar
    // un extra, que no escriben nada pero sí son trabajo de la persona.
    window.addEventListener('input', tocado, { capture: true, passive: true })
    window.addEventListener('pointerdown', tocado, { capture: true, passive: true })
    return () => {
      window.removeEventListener('input', tocado, { capture: true })
      window.removeEventListener('pointerdown', tocado, { capture: true })
    }
  }, [])

  useEffect(() => {
    // Sin SW controlando esta página no hay nada que despertar: el navegador
    // ya está pidiendo el index.html a la red (`Cache-Control: no-store`).
    if (!navigator.serviceWorker?.controller) return

    let vivo = true
    const entrar = worker => {
      if (!vivo || !intacto.current || !worker) return
      navigator.serviceWorker.addEventListener('controllerchange', recargarPagina, { once: true })
      worker.postMessage({ type: 'SKIP_WAITING' })
      // Plan B, igual que en el aviso interno: si el worker nuevo no toma el
      // control, se borran SW y cachés y se recarga contra la red.
      setTimeout(limpiarYRecargar, 3000)
    }

    navigator.serviceWorker.getRegistration()
      .then(reg => {
        if (!vivo || !reg) return
        // Ya hay uno en espera (lo instaló otra pestaña): a activarlo.
        if (reg.waiting) return entrar(reg.waiting)
        // Si no, preguntar por una versión nueva y esperar a que instale.
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing
          if (!nuevo) return
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed') entrar(reg.waiting || nuevo)
          })
        })
        reg.update().catch(() => { /* sin red: se queda con lo que tiene */ })
      })
      .catch(() => { /* navegador sin SW */ })

    return () => { vivo = false }
  }, [])

  return null
}

export default function AvisoNuevaVersion() {
  const { needRefresh: [necesitaRefresco, setNecesitaRefresco], updateServiceWorker } = useRegisterSW()
  const [actualizando, setActualizando] = useState(false)

  const actualizar = () => {
    if (actualizando) return
    setActualizando(true)
    entrarAVersionNueva(updateServiceWorker)
  }

  // Entra y SALE por el mismo borde: el aviso llega desde arriba y se va por
  // arriba. Antes teleportaba en ambos sentidos y parecía un parpadeo.
  const quieto = useReducedMotion()

  return (
    <AnimatePresence>
      {necesitaRefresco && (
    <motion.div
      initial={quieto ? { opacity: 0 } : { opacity: 0, y: '-100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={quieto ? { opacity: 0 } : { opacity: 0, y: '-100%' }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
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
    </motion.div>
      )}
    </AnimatePresence>
  )
}
